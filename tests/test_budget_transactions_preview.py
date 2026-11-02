"""Opérations d'une enveloppe : celles de ses catégories enregistrées sur sa période, et l'aperçu du
formulaire qui montre celles que suivraient d'autres catégories avant enregistrement."""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, Budget, BudgetCategory, Transaction
from app.services import budget_service as bs


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Account(id=1, name="Courant"), Account(id=2, name="Joint")])
    for d, cat, acc in [
        (date(2026, 10, 30), "Courses", 1),   # début du cycle de paie
        (date(2026, 11, 3), "Courses", 1),
        (date(2026, 11, 5), "Boulangerie", 2),
        (date(2026, 11, 29), "Courses", 1),   # cycle suivant
        (date(2025, 6, 1), "Courses", 1),     # autre année
        (date(2026, 11, 4), "Loisirs", 1),
    ]:
        s.add(Transaction(date_operation=d, description=f"{cat} {d}", amount=-10.0, type="expense_var",
                          category=cat, from_account_id=acc))
    s.commit()
    yield s
    s.close()


def _dates(rows):
    return sorted(r["date"] for r in rows)


def test_saved_envelope_follows_the_pay_cycle(db):
    b = Budget(name="Courses", monthly_amount=300.0, period="monthly", envelope_type="spending")
    db.add(b)
    db.flush()
    db.add(BudgetCategory(budget_id=b.id, category_name="Courses"))
    db.commit()
    rows = bs.get_budget_transactions_data(b.id, 2026, 11, db, date_start="2026-10-30", date_end="2026-11-28")
    assert _dates(rows) == ["2026-10-30", "2026-11-03"]


def test_preview_uses_the_categories_being_edited(db):
    rows = bs.preview_budget_transactions_data(db, ["Courses", "Boulangerie"], "monthly", year=2026, month=11,
                                               date_start="2026-10-30", date_end="2026-11-28")
    assert _dates(rows) == ["2026-10-30", "2026-11-03", "2026-11-05"]
    assert {r["category"] for r in rows} == {"Courses", "Boulangerie"}


def test_preview_without_category_is_empty(db):
    assert bs.preview_budget_transactions_data(db, [], "monthly", year=2026, month=11) == []


def test_preview_by_period_and_accounts(db):
    yearly = bs.preview_budget_transactions_data(db, ["Courses"], "yearly", year=2026)
    assert _dates(yearly) == ["2026-10-30", "2026-11-03", "2026-11-29"]
    all_time = bs.preview_budget_transactions_data(db, ["Courses"], "indefinite")
    assert len(all_time) == 4
    dated = bs.preview_budget_transactions_data(db, ["Courses"], "custom", start_date="2026-11-01", end_date="2026-11-30")
    assert _dates(dated) == ["2026-11-03", "2026-11-29"]
    joint_only = bs.preview_budget_transactions_data(db, ["Courses", "Boulangerie"], "indefinite", account_ids=[2])
    assert _dates(joint_only) == ["2026-11-05"]
