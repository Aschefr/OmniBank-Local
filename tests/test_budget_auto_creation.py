"""Auto-création d'enveloppes : les propositions en attente en profitent, une proposition sans objet n'immobilise
plus ses catégories, et ce que l'utilisateur retire ne revient pas tout seul au cycle suivant."""
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
from app.services.autopilot_service import rollback_autopilot_decision
from app.services.history_service import undo_action

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


def _spend(db, cat, amount=40.0):
    for m in MONTHS:
        when = min(m.replace(day=5), TODAY)
        db.add(Transaction(date_operation=when, date_saisie=when, description=f"{cat} {when}", amount=amount,
                           type="expense_var", category=cat, from_account_id=1))
    db.commit()


def _set_auto(db, on):
    db.query(GlobalConfig).filter(GlobalConfig.key == "auto_create_budget_envelopes").update(
        {"value": "true" if on else "false"})
    db.commit()


def _names(db):
    return sorted(b.name for b in db.query(Budget).all())


def _cycle(db):
    applied = []
    pending = bs.suggest_new_envelopes(db, force=True, auto_applied=applied)
    return applied, pending


def test_pending_proposals_are_created_once_auto_creation_is_on(db):
    _spend(db, "Bricolage")
    pending = bs.suggest_new_envelopes(db, force=True)
    assert [p["name"] for p in pending] == ["Bricolage"] and _names(db) == []

    _set_auto(db, True)
    applied, pending = _cycle(db)

    assert pending == [] and _names(db) == ["Bricolage"]
    assert [(a["type"], a["name"]) for a in applied] == [("creation", "Bricolage")]
    decision = db.query(AutopilotDecisionLog).one()
    assert decision.action == "AUTO_COMMIT" and decision.entity_id == db.query(Budget).one().id
    # Le cycle suivant ne refait rien
    assert _cycle(db) == ([], []) and _names(db) == ["Bricolage"]


def test_proposal_on_a_deleted_envelope_no_longer_blocks_its_category(db):
    target = Budget(name="Sorties", monthly_amount=100.0, period="monthly", envelope_type="spending")
    db.add(target)
    db.flush()
    db.add(BudgetCategory(budget_id=target.id, category_name="Cinéma"))
    db.commit()
    _spend(db, "Cinéma")
    _spend(db, "Café & Bar")
    db.add(AutopilotDecisionLog(batch_id="b", decision_type="budget_enrichment_suggestion", action="SUGGESTED",
                                entity_type="budget", entity_id=target.id, conn_id=-1,
                                raw_snapshot='{"target_budget_id": %d, "new_category": "Café & Bar", '
                                             '"categories": ["Café & Bar"], "additional_amount": 40.0, '
                                             '"observed_months": 3}' % target.id))
    db.commit()
    bs.delete_single_budget(target.id, db)

    pending = bs.suggest_new_envelopes(db, force=True)

    # La proposition devenue sans objet n'est pas un refus : la catégorie est de nouveau proposée
    assert {c for p in pending for c in p["categories"]} == {"Cinéma", "Café & Bar"}
    assert "Café & Bar" not in bs._get_dismissed_categories(db)
    assert db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.action == "EXPIRED").count() == 1


def test_deleted_envelope_comes_back_as_a_proposal_not_as_an_envelope(db):
    _spend(db, "Bricolage")
    _set_auto(db, True)
    _cycle(db)
    budget = db.query(Budget).one()

    bs.delete_single_budget(budget.id, db)
    applied, pending = _cycle(db)

    assert applied == [] and _names(db) == []
    assert [p["name"] for p in pending] == ["Bricolage"]
    # Et reste une proposition aux cycles suivants
    applied, _ = _cycle(db)
    assert applied == [] and _names(db) == []


def test_undo_of_an_auto_created_envelope_does_not_recreate_it(db):
    _spend(db, "Bricolage")
    _set_auto(db, True)
    _cycle(db)
    action = db.query(ActionHistory).filter(ActionHistory.entity_type == "budget").one()

    ok, _ = undo_action(db, action)
    db.commit()
    assert ok and _names(db) == []

    applied, _ = _cycle(db)
    assert applied == [] and _names(db) == []
    assert [p["name"] for p in bs.get_all_pending_budget_suggestions(db)] == ["Bricolage"]


def test_rollback_from_the_control_center_does_not_recreate_it(db):
    _spend(db, "Bricolage")
    _set_auto(db, True)
    _cycle(db)
    decision = db.query(AutopilotDecisionLog).one()

    rollback_autopilot_decision(db, decision.id)
    applied, _ = _cycle(db)

    assert applied == [] and _names(db) == []


def test_category_removed_from_an_envelope_is_not_put_back(db):
    budget = Budget(name="Maison", monthly_amount=100.0, period="monthly", envelope_type="spending")
    db.add(budget)
    db.flush()
    db.add_all([BudgetCategory(budget_id=budget.id, category_name="Bricolage"),
                BudgetCategory(budget_id=budget.id, category_name="Jardin")])
    db.commit()
    _spend(db, "Bricolage")
    _spend(db, "Jardin")
    _set_auto(db, True)
    _cycle(db)

    db.query(BudgetCategory).filter(BudgetCategory.category_name == "Jardin").delete()
    db.commit()
    applied, _ = _cycle(db)

    assert applied == [] and _names(db) == ["Maison"]


def test_turning_it_off_and_on_starts_from_the_current_state(db):
    _spend(db, "Bricolage")
    _set_auto(db, True)
    _cycle(db)
    bs.delete_single_budget(db.query(Budget).one().id, db)
    _cycle(db)

    # Désactiver puis réactiver : le choix est explicite, et l'option s'applique aussitôt
    _set_auto(db, False)
    _cycle(db)
    assert db.query(GlobalConfig).filter(GlobalConfig.key == bs.AUTO_KNOWN_CATEGORIES_KEY).first() is None
    _set_auto(db, True)
    result = bs.activate_auto_creation(db)

    assert [a["name"] for a in result["auto_applied"]] == ["Bricolage"] and _names(db) == ["Bricolage"]


def test_refused_categories_and_locked_targets_stay_untouched(db):
    _spend(db, "Bricolage")
    _spend(db, "Cinéma")
    locked = Budget(name="Verrouillée", monthly_amount=100.0, period="monthly", envelope_type="spending", is_locked=True)
    db.add(locked)
    db.flush()
    db.add(BudgetCategory(budget_id=locked.id, category_name="Divers"))
    db.commit()
    pending = bs.suggest_new_envelopes(db, force=True)
    bricolage = next(p for p in pending if "Bricolage" in p["categories"])
    bs.dismiss_budget_suggestion(db, bricolage["decision_id"])
    db.add(AutopilotDecisionLog(batch_id="b", decision_type="budget_enrichment_suggestion", action="SUGGESTED",
                                entity_type="budget", entity_id=locked.id, conn_id=-1,
                                raw_snapshot='{"target_budget_id": %d, "new_category": "Sport", '
                                             '"categories": ["Sport"], "additional_amount": 30.0, '
                                             '"observed_months": 3}' % locked.id))
    db.commit()

    _set_auto(db, True)
    bs.activate_auto_creation(db)

    names = _names(db)
    assert not any("Bricolage" in n for n in names) and "Cinéma" in names
    assert db.query(Budget).filter(Budget.id == locked.id).one().monthly_amount == 100.0
    assert not db.query(BudgetCategory).filter(BudgetCategory.category_name == "Sport").first()


# ── Récapitulatif sur la page Budgets, jusqu'à validation ──

def test_notice_lists_what_was_added_until_dismissed(db):
    _spend(db, "Bricolage")
    _set_auto(db, True)
    assert bs.get_auto_applied_notice(db) == []
    _cycle(db)

    items = bs.get_auto_applied_notice(db)
    assert [(i["name"], i["created"], i["categories"]) for i in items] == [("Bricolage", True, ["Bricolage"])]
    # Reste affiché au fil des cycles
    _cycle(db)
    assert len(bs.get_auto_applied_notice(db)) == 1

    bs.dismiss_auto_applied_notice(db)
    assert bs.get_auto_applied_notice(db) == []
    _cycle(db)
    assert bs.get_auto_applied_notice(db) == []


def test_notice_groups_by_envelope_and_follows_later_removals(db):
    budget = Budget(name="Sorties", monthly_amount=100.0, period="monthly", envelope_type="spending")
    db.add(budget)
    db.flush()
    db.add(BudgetCategory(budget_id=budget.id, category_name="Cinéma"))
    db.commit()
    for cat in ("Café", "Concerts"):
        db.add(BudgetCategory(budget_id=budget.id, category_name=cat))
        db.flush()
        bs._note_auto_applied(db, [], "enrichment", "Sorties", budget.id, [cat])
    db.commit()

    items = bs.get_auto_applied_notice(db)
    assert len(items) == 1 and items[0]["categories"] == ["Café", "Concerts"] and items[0]["created"] is False

    db.query(BudgetCategory).filter(BudgetCategory.category_name == "Café").delete()
    db.commit()
    assert bs.get_auto_applied_notice(db)[0]["categories"] == ["Concerts"]

    bs.delete_single_budget(budget.id, db)
    assert bs.get_auto_applied_notice(db) == []


def test_notice_holds_several_additions_in_a_background_session(db):
    """Le cycle de fond tourne sans autoflush : deux ajouts de suite ne doivent pas créer deux fois le réglage."""
    db.autoflush = False
    _spend(db, "Bricolage")
    _spend(db, "Cinéma")
    _set_auto(db, True)
    _cycle(db)
    assert len(bs.get_auto_applied_notice(db)) == 2
