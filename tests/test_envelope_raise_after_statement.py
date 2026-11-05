"""Plafond d'enveloppe relevé d'après des opérations pas encore classées : juste après un relevé, les lignes
inconnues sont dans la catégorie filet de sécurité, puis l'IA les reclasse. Une proposition d'ajout de catégorie
faite à ce moment-là ne doit pas relever le plafond plus tard avec un montant qui n'existe plus."""
import json
from datetime import date

import pytest
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    Account, ActionHistory, AutopilotDecisionLog, Base, Budget, BudgetCategory, GlobalConfig, Transaction,
)
from app.services import budget_service as bs

TODAY = date.today()
MONTHS = [TODAY.replace(day=1) - relativedelta(months=k) for k in range(3)]


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    s.add(Account(id=1, name="Courant"))
    s.add(GlobalConfig(key="auto_create_budget_envelopes", value="false"))
    s.commit()
    yield s
    s.close()


def _spend(db, cat, amount, months=MONTHS):
    txs = []
    for m in months:
        when = min(m.replace(day=5), TODAY)
        tx = Transaction(date_operation=when, date_saisie=when, description=f"op {when}", amount=amount,
                         type="expense_var", category=cat, from_account_id=1)
        db.add(tx)
        txs.append(tx)
    db.commit()
    return txs


def _envelope(db, name, cats, amount):
    b = Budget(name=name, monthly_amount=amount, period="monthly", envelope_type="spending")
    db.add(b)
    db.flush()
    for c in cats:
        db.add(BudgetCategory(budget_id=b.id, category_name=c))
    db.commit()
    return b


def _set_auto(db, on):
    db.query(GlobalConfig).filter(GlobalConfig.key == "auto_create_budget_envelopes").update(
        {"value": "true" if on else "false"})
    db.commit()


def _pending_addition(db, budget, cat, add):
    """Proposition d'ajout calculée au moment de l'analyse, avec le montant de ce moment-là."""
    d = AutopilotDecisionLog(batch_id="t", decision_type="budget_enrichment_suggestion", action="SUGGESTED",
                             entity_type="budget", entity_id=budget.id, conn_id=-1,
                             raw_snapshot=json.dumps({"target_budget_id": budget.id, "target_budget_name": budget.name,
                                                      "new_category": cat, "category": cat, "categories": [cat],
                                                      "current_amount": budget.monthly_amount, "additional_amount": add,
                                                      "suggested_amount": budget.monthly_amount + add,
                                                      "observed_months": 2}))
    db.add(d)
    db.commit()
    return d


def _cycle(db):
    applied = []
    bs.suggest_new_envelopes(db, force=True, auto_applied=applied)
    return applied


def test_lines_not_yet_classified_never_raise_an_envelope(db):
    divers = _envelope(db, "Divers et Imprévus", ["Divers"], 50.0)
    _spend(db, "Dépenses diverses", 700.0)
    _set_auto(db, True)

    assert _cycle(db) == []
    db.refresh(divers)
    assert divers.monthly_amount == 50.0
    assert db.query(BudgetCategory).filter(BudgetCategory.category_name == "Dépenses diverses").count() == 0
    assert db.query(AutopilotDecisionLog).count() == 0


def test_lines_not_yet_classified_are_not_proposed_either(db):
    _envelope(db, "Divers et Imprévus", ["Divers"], 50.0)
    _spend(db, "Dépenses diverses", 700.0)

    assert bs.suggest_new_envelopes(db, force=True) == []
    assert bs.get_all_pending_budget_suggestions(db) == []


def test_turning_auto_creation_on_applies_the_current_amount_not_the_old_one(db):
    sorties = _envelope(db, "Sorties", ["Cinéma"], 50.0)
    _spend(db, "Café & Bar", 40.0)
    pending = _pending_addition(db, sorties, "Café & Bar", 700.0)

    _set_auto(db, True)
    _cycle(db)

    db.refresh(sorties)
    assert sorties.monthly_amount == 90.0
    db.refresh(pending)
    assert pending.action == "AUTO_COMMIT"
    snap = json.loads(pending.raw_snapshot)
    assert snap["current_amount"] == 50.0 and snap["suggested_amount"] == 90.0


def test_addition_whose_operations_were_reclassified_expires_instead_of_raising(db):
    sorties = _envelope(db, "Sorties", ["Cinéma"], 50.0)
    txs = _spend(db, "Café & Bar", 300.0)
    pending = _pending_addition(db, sorties, "Café & Bar", 300.0)
    for tx in txs[1:]:
        tx.category = "Cinéma"  # reclassées par l'IA après l'analyse
    db.commit()

    _set_auto(db, True)
    assert _cycle(db) == []

    db.refresh(sorties)
    db.refresh(pending)
    assert sorties.monthly_amount == 50.0 and pending.action == "EXPIRED"
    assert db.query(BudgetCategory).filter(BudgetCategory.category_name == "Café & Bar").count() == 0


def test_pending_list_shows_the_current_amount_and_drops_outdated_additions(db):
    sorties = _envelope(db, "Sorties", ["Cinéma"], 50.0)
    _spend(db, "Café & Bar", 40.0)
    live = _pending_addition(db, sorties, "Café & Bar", 700.0)
    gone = _pending_addition(db, sorties, "Jeux vidéo", 300.0)  # plus aucune opération dans cette catégorie

    items = {s["decision_id"]: s for s in bs.get_all_pending_budget_suggestions(db) if s["type"] == "enrichment"}

    assert list(items) == [live.id]
    assert items[live.id]["additional_amount"] == 40.0 and items[live.id]["suggested_amount"] == 90.0
    db.refresh(gone)
    assert gone.action == "EXPIRED"


def test_automatic_raise_is_signed_and_shows_the_previous_limit(db):
    sorties = _envelope(db, "Sorties", ["Cinéma"], 50.0)
    _spend(db, "Café & Bar", 40.0)
    _pending_addition(db, sorties, "Café & Bar", 40.0)

    _set_auto(db, True)
    _cycle(db)

    entry = db.query(ActionHistory).filter(ActionHistory.entity_type == "budget").one()
    assert entry.user_name == bs.AUTO_ENVELOPES_USER
    notice = bs.get_auto_applied_notice(db)
    assert [(n["name"], n["old_amount"], n["amount"]) for n in notice] == [("Sorties", 50.0, 90.0)]


def test_user_approval_keeps_the_amount_they_chose(db):
    sorties = _envelope(db, "Sorties", ["Cinéma"], 50.0)
    _spend(db, "Café & Bar", 40.0)
    pending = _pending_addition(db, sorties, "Café & Bar", 700.0)

    bs.apply_budget_suggestion(db, pending.id, custom_amount=120.0)

    db.refresh(sorties)
    assert sorties.monthly_amount == 120.0
    assert db.query(ActionHistory).filter(ActionHistory.entity_type == "budget").one().user_name is None
