"""
Déplacer une ligne de la banque d'une prévision à une autre : la prévision libérée retrouve son montant prévu, et la
liste « Lier » montre les prévisions qui portent déjà une ligne de la banque avec leur montant prévu.
"""
from datetime import date

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, RecurrenceTemplate, Transaction
from app.services import stats_cache
from app.services.autopilot_service import link_review_transaction, list_link_candidates
from app.services.history_service import record_action, snapshot_entity

LABEL = "0765432 MUTUELLE DU NORD"


def _unaccent(text):
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFD", text or "") if unicodedata.category(c) != "Mn").lower()


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    event.listen(engine, "connect", lambda conn, _rec: conn.create_function("UNACCENT", 1, _unaccent))
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add(Account(id=1, name="Courant", type="Compte courant", initial_balance=1000.0))
    session.commit()
    yield session
    session.close()


def _forecast(db, name, amount, day):
    tpl = RecurrenceTemplate(description=name, amount=amount, type="expense_fixed", category="Assurance",
                             frequency="Monthly", day_of_month=day.day, from_account_id=1)
    db.add(tpl)
    db.flush()
    tx = Transaction(description=name, amount=amount, type="expense_fixed", category="Assurance", date_operation=day,
                     from_account_id=1, recurrence_id=tpl.id)
    db.add(tx)
    db.flush()
    return tx


def _hold(db, forecast, amount, csv_id):
    """L'Auto-Pilote lie une ligne « à venir » à la prévision : elle prend le montant de la banque."""
    before = snapshot_entity(forecast)
    forecast.amount, forecast.csv_id, forecast.raw_description = amount, csv_id, LABEL
    db.flush()
    record_action(db, "transaction", forecast.id, "UPDATE", before, snapshot_entity(forecast), user_name="test")
    db.commit()


@pytest.fixture
def insurances(db):
    home = _forecast(db, "Assurance - Habitation", 48.00, date(2026, 11, 22))
    car = _forecast(db, "Assurance - Auto", 68.00, date(2026, 11, 25))
    car_next = Transaction(description="Assurance - Auto", amount=68.00, type="expense_fixed", category="Assurance",
                           date_operation=date(2026, 12, 25), from_account_id=1, recurrence_id=car.recurrence_id)
    skipped = Transaction(description="Assurance - Auto", amount=68.00, type="expense_fixed", category="Assurance",
                          date_operation=date(2026, 10, 25), from_account_id=1, recurrence_id=car.recurrence_id,
                          is_skipped=True)
    db.add_all([car_next, skipped])
    db.commit()
    _hold(db, home, 70.90, "woob_coming_bank_0001_a")   # la ligne de l'Auto, liée à tort à l'Habitation
    return home, car, car_next, skipped


def test_moving_the_bank_line_away_gives_the_forecast_back_its_planned_amount(db, insurances):
    home, car, _next, _skipped = insurances
    link_review_transaction(db, tx_id=home.id, target_forecast_id=car.id, learn_rule=False)
    db.refresh(home)
    db.refresh(car)
    assert car.amount == 70.90 and car.csv_id == "woob_coming_bank_0001_a"
    assert home.amount == 48.00 and home.csv_id is None


def test_link_list_shows_the_planned_amount_and_puts_close_dates_first(db, insurances):
    home, car, car_next, skipped = insurances
    review = Transaction(description="Assurance", amount=50.70, type="expense_fixed", date_operation=date(2026, 11, 23),
                         from_account_id=1, raw_description=LABEL, csv_id="woob_coming_bank_0001_b", needs_review=True)
    db.add(review)
    db.commit()
    items = list_link_candidates(db, review.id, search="assurance")
    ids = [i["id"] for i in items]
    assert skipped.id not in ids
    assert ids.index(home.id) < ids.index(car_next.id) and ids.index(car.id) < ids.index(car_next.id)
    held = next(i for i in items if i["id"] == home.id)
    assert held["holds_bank_line"] is True
    assert held["amount"] == 70.90 and held["planned_amount"] == 48.00
    assert next(i for i in items if i["id"] == car.id)["holds_bank_line"] is False
