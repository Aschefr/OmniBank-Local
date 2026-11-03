"""Intégrité des enveloppes : une dépense ne compte que dans une enveloppe, pas d'enveloppe de dépenses sans
catégorie, synchronisation récurrence -> enveloppe ramenée à la période de l'enveloppe."""
from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, Budget, BudgetCategory, GlobalConfig, Transaction
from app.routers.budgets import BudgetCreate, BudgetUpdate
from app.services.budget_service import (
    create_new_budget, get_budget_status_data, sync_budget_from_recurrence_change, update_existing_budget,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _create(db, name, cats, period="monthly", **kw):
    return create_new_budget(BudgetCreate(name=name, monthly_amount=100.0, period=period, categories=cats, **kw), db)


def test_same_category_in_two_envelopes_is_refused(db):
    _create(db, "Courses", ["Alimentation"])
    with pytest.raises(HTTPException) as e:
        _create(db, "Repas", ["Restaurant", "Alimentation"])
    assert e.value.status_code == 409 and "« Alimentation » (enveloppe « Courses »)" in e.value.detail
    # Une enveloppe annuelle recoupe aussi une mensuelle (périodes permanentes)
    with pytest.raises(HTTPException):
        _create(db, "Alimentation annuelle", ["Alimentation"], period="yearly")


def test_organisation_dated_envelopes_may_reuse_a_category_without_overlap(db):
    _create(db, "Colis Noël 2025", ["Colis Noel"], period="custom",
            start_date="2025-10-01", end_date="2026-04-01", account_ids=[1])
    # Exercice suivant, sans chevauchement : autorisé
    _create(db, "Colis Noël 2026", ["Colis Noel"], period="custom",
            start_date="2026-10-01", end_date="2027-04-01", account_ids=[1])
    # Même période mais autre compte : pas de double comptage, autorisé
    _create(db, "Colis Noël 2026 (fonctionnement)", ["Colis Noel"], period="custom",
            start_date="2026-10-01", end_date="2027-04-01", account_ids=[2])
    # Chevauchement sur le même compte : refusé
    with pytest.raises(HTTPException):
        _create(db, "Colis Noël bis", ["Colis Noel"], period="custom",
                start_date="2026-12-01", end_date="2026-12-31", account_ids=[1])


def test_update_cannot_take_a_category_from_another_envelope(db):
    _create(db, "Courses", ["Alimentation"])
    other = _create(db, "Loisirs", ["Cinéma"])
    with pytest.raises(HTTPException):
        update_existing_budget(other["id"], BudgetUpdate(categories=["Cinéma", "Alimentation"]), db)
    db.expire_all()
    assert {c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == other["id"])} == {"Cinéma"}


def _legacy(db, name, cats, **kw):
    """Enveloppe créée avant la règle : posée directement en base, sans validation."""
    b = Budget(name=name, monthly_amount=100.0, period=kw.pop("period", "monthly"), envelope_type="spending", **kw)
    db.add(b)
    db.flush()
    db.add_all([BudgetCategory(budget_id=b.id, category_name=c) for c in cats])
    db.commit()
    return b.id


def test_existing_shared_category_does_not_block_other_changes(db):
    first = _legacy(db, "Courses", ["Alimentation"])
    second = _legacy(db, "Vie courante", ["Alimentation", "Pharmacie"])
    assert update_existing_budget(first, BudgetUpdate(monthly_amount=250.0), db)["monthly_amount"] == 250.0
    assert update_existing_budget(second, BudgetUpdate(is_locked=True), db)["is_locked"] is True
    # Le formulaire renvoie toutes les catégories : la même liste passe, avec un autre nom
    saved = update_existing_budget(second, BudgetUpdate(name="Quotidien", categories=["Alimentation", "Pharmacie"]), db)
    assert saved["name"] == "Quotidien"


def test_existing_shared_category_can_be_removed_but_no_new_one_added(db):
    _legacy(db, "Courses", ["Alimentation"])
    _legacy(db, "Loisirs", ["Cinéma"])
    second = _legacy(db, "Vie courante", ["Alimentation", "Pharmacie"])
    with pytest.raises(HTTPException) as e:
        update_existing_budget(second, BudgetUpdate(categories=["Alimentation", "Pharmacie", "Cinéma"]), db)
    assert e.value.status_code == 409 and "Cinéma" in e.value.detail and "Alimentation" not in e.value.detail
    db.rollback()
    saved = update_existing_budget(second, BudgetUpdate(categories=["Pharmacie"]), db)
    assert saved["categories"] == ["Pharmacie"]


def test_envelope_without_category_stays_editable_until_categories_are_sent(db):
    empty = _legacy(db, "Héritée", [])
    assert update_existing_budget(empty, BudgetUpdate(monthly_amount=80.0), db)["monthly_amount"] == 80.0
    with pytest.raises(HTTPException) as e:
        update_existing_budget(empty, BudgetUpdate(categories=[]), db)
    assert e.value.status_code == 400


def test_reopening_a_closed_envelope_still_checks_for_conflicts(db):
    _legacy(db, "Courses", ["Alimentation"])
    closed = _legacy(db, "Ancienne", ["Alimentation"], is_closed=True)
    with pytest.raises(HTTPException):
        update_existing_budget(closed, BudgetUpdate(is_closed=False), db)


def test_update_notice_migration_targets_profiles_with_envelopes(db):
    from app.migrations.versions.v33_budget_update_notice import upgrade
    conn = db.connection()
    upgrade(conn)
    assert db.query(GlobalConfig).filter(GlobalConfig.key == "budget_update_notice").first() is None
    _legacy(db, "Courses", ["Alimentation"])
    conn = db.connection()
    upgrade(conn)
    db.commit()
    assert db.query(GlobalConfig).filter(GlobalConfig.key == "budget_update_notice").one().value == "true"


def test_closed_envelope_frees_its_categories(db):
    old = _create(db, "Ancien", ["Alimentation"])
    update_existing_budget(old["id"], BudgetUpdate(is_closed=True), db)
    _create(db, "Nouveau", ["Alimentation"])


def test_spending_envelope_needs_categories_but_projects_and_piggy_banks_do_not(db):
    with pytest.raises(HTTPException) as e:
        _create(db, "Vide", [])
    assert e.value.status_code == 400
    _create(db, "Voyage", [], is_project=True)
    _create(db, "Tirelire", [], envelope_type="savings")


def test_legacy_envelope_without_category_no_longer_counts_every_expense(db):
    db.add(Budget(name="Héritée", monthly_amount=100.0, period="monthly", envelope_type="spending"))
    db.add(Transaction(date_operation=date.today(), description="Courses", amount=-80.0, type="expense_var",
                       category="Alimentation", from_account_id=1))
    db.commit()
    status = get_budget_status_data(db=db)
    assert status["budgets"][0]["spent"] == 0


@pytest.mark.parametrize("period, frequency, delta, expected", [
    ("monthly", "Semi-Annually", 60.0, 110.0),   # 60 € deux fois par an = 10 €/mois
    ("monthly", "Monthly", 15.0, 115.0),
    ("yearly", "Monthly", 15.0, 280.0),          # 15 €/mois = 180 €/an
])
def test_recurrence_sync_converts_to_the_envelope_period(db, period, frequency, delta, expected):
    db.add(GlobalConfig(key="auto_apply_budget_suggestions", value="true"))
    db.commit()
    b = _create(db, "Assurances", ["Assurance"], period=period)
    if period == "yearly":
        db.query(Budget).filter(Budget.id == b["id"]).update({"monthly_amount": 100.0})
        db.commit()
    sync_budget_from_recurrence_change(db, "Assurance", "hike", delta, frequency=frequency)
    assert db.query(Budget).get(b["id"]).monthly_amount == expected


def test_recurrence_sync_leaves_dated_envelopes_alone(db):
    db.add(GlobalConfig(key="auto_apply_budget_suggestions", value="true"))
    db.commit()
    b = _create(db, "Événement", ["Billetterie"], period="custom", start_date="2026-01-01", end_date="2026-12-31")
    assert sync_budget_from_recurrence_change(db, "Billetterie", "hike", 50.0) is None
    assert db.query(Budget).get(b["id"]).monthly_amount == 100.0
