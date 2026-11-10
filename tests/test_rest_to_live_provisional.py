"""Reste à vivre provisoire : mois complets d'historique avant le mois en cours (premier relevé = historique court)."""

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Transaction
from app.services.simulator_engine import RECENT_HISTORY_MONTHS, history_months

TODAY = date(2026, 11, 10)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def _tx(db, day, skipped=False):
    db.add(Transaction(date_operation=day, amount=12.5, description="Boulangerie", type="expense_var", is_skipped=skipped))
    db.commit()


def test_no_transaction_means_no_history_to_judge(db):
    assert history_months(db, TODAY) is None


def test_a_first_statement_this_month_counts_zero_months(db):
    _tx(db, date(2026, 11, 3))
    assert history_months(db, TODAY) == 0


def test_full_months_before_the_current_one(db):
    _tx(db, date(2026, 9, 28))
    assert history_months(db, TODAY) == 2
    _tx(db, date(2026, 5, 2))
    assert history_months(db, TODAY) == 6 >= RECENT_HISTORY_MONTHS


def test_skipped_and_future_operations_do_not_count(db):
    _tx(db, date(2026, 1, 15), skipped=True)
    _tx(db, date(2026, 12, 5))
    assert history_months(db, TODAY) is None
