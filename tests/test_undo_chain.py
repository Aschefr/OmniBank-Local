"""
Chaîne d'annulation : liaisons, échanges de lignes, « Annuler le lot », flèches Annuler / Rétablir de l'en-tête.
Une action de l'utilisateur se défait et se refait en un seul appui, et aucune ligne de la banque ne se perd.
"""
import json
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, ActionHistory, AutopilotDecisionLog, Base, RecurrenceTemplate, Transaction
from app.services import stats_cache
from app.services.autopilot_service import (
    link_review_transaction, rollback_autopilot_cycle, rollback_autopilot_decision, unlink_forecast_decision,
)
from app.services.bank_sync.pending_store import clear_all_pending_sync
from app.services.history_service import (
    last_undoable, next_redoable, record_action, redo_entry, snapshot_entity, undo_entry,
)

LABEL = "0765432 MUTUELLE DU NORD"
DAY = date(2026, 11, 23)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add(Account(id=1, name="Courant", type="Compte courant", initial_balance=1000.0))
    session.commit()
    yield session
    clear_all_pending_sync(session)
    session.close()


def _forecast(db, name, amount, day=DAY, csv_id=None):
    tpl = RecurrenceTemplate(description=name, amount=amount, type="expense_fixed", category="Assurance",
                             frequency="Monthly", day_of_month=day.day, from_account_id=1)
    db.add(tpl)
    db.flush()
    tx = Transaction(description=name, amount=amount, type="expense_fixed", category="Assurance", date_operation=day,
                     from_account_id=1, recurrence_id=tpl.id, csv_id=csv_id)
    db.add(tx)
    db.flush()
    return tx


def _autolink(db, forecast, amount, csv_id, batch="b1"):
    """L'Auto-Pilote lie une ligne « à venir » à la prévision, comme un relevé."""
    before = snapshot_entity(forecast)
    forecast.amount, forecast.csv_id, forecast.raw_description = amount, csv_id, LABEL
    db.flush()
    record_action(db, "transaction", forecast.id, "UPDATE", before, snapshot_entity(forecast),
                  user_name="Automatisme (Liaison à venir)")
    d = AutopilotDecisionLog(
        batch_id=batch, decision_type="reconciliation", action="LINKED_COMING", entity_type="transaction",
        entity_id=forecast.id, conn_id=1, account_id=1, confidence_score=80.0,
        raw_snapshot=json.dumps({"before": before, "after": snapshot_entity(forecast), "matched_db_id": forecast.id,
                                 "bank_tx": {"csv_id": csv_id, "date_operation": DAY.isoformat(), "raw_amount": -amount,
                                             "amount": amount, "description": LABEL, "raw_description": LABEL,
                                             "account_id": 1}}, default=str))
    db.add(d)
    db.commit()
    return d


@pytest.fixture
def insurances(db):
    home = _forecast(db, "Assurance - Habitation", 48.00, csv_id="1001")
    car = _forecast(db, "Assurance - Auto", 68.00)
    car_next = Transaction(description="Assurance - Auto", amount=68.00, type="expense_fixed", category="Assurance",
                           date_operation=date(2026, 12, 23), from_account_id=1, recurrence_id=car.recurrence_id)
    db.add(car_next)
    db.commit()
    d_home = _autolink(db, home, 50.90, "woob_coming_bank_0001_home")
    d_car = _autolink(db, car, 70.90, "woob_coming_bank_0001_car")
    return home, car, car_next, d_home, d_car


def _state(db):
    db.expire_all()
    return sorted((t.id, t.csv_id, round(t.amount, 2), t.comment, t.raw_description) for t in db.query(Transaction).all())


def _press(db, fn):
    action = last_undoable(db) if fn is undo_entry else next_redoable(db)
    ok, _ = fn(db, action)
    assert ok
    db.commit()


def test_moving_a_line_is_undone_and_redone_in_one_press(db, insurances):
    _home, car, car_next, _dh, d_car = insurances
    before = _state(db)
    link_review_transaction(db, tx_id=car.id, target_forecast_id=car_next.id, learn_rule=False)
    after = _state(db)

    _press(db, undo_entry)
    assert _state(db) == before
    assert db.get(AutopilotDecisionLog, d_car.id).entity_id == car.id

    _press(db, redo_entry)
    assert _state(db) == after
    assert db.get(AutopilotDecisionLog, d_car.id).entity_id == car_next.id


def test_linking_onto_a_forecast_that_holds_a_line_swaps_the_lines(db, insurances):
    home, car, _next, d_home, d_car = insurances
    link_review_transaction(db, tx_id=car.id, target_forecast_id=home.id, learn_rule=False)
    db.expire_all()
    assert (home.csv_id, home.amount) == ("woob_coming_bank_0001_car", 70.90)
    assert (car.csv_id, car.amount) == ("woob_coming_bank_0001_home", 50.90)
    assert db.get(AutopilotDecisionLog, d_home.id).entity_id == car.id

    unlink_forecast_decision(db, d_car.id)
    db.expire_all()
    assert (home.csv_id, home.amount) == ("woob_coming_bank_0001_home", 50.90)
    assert (car.csv_id, car.amount) == ("woob_coming_bank_0001_car", 70.90)
    assert db.get(AutopilotDecisionLog, d_home.id).entity_id == home.id


def test_redo_follows_the_undo_order(db, insurances):
    home, car, car_next, _dh, _dc = insurances
    link_review_transaction(db, tx_id=car.id, target_forecast_id=car_next.id, learn_rule=False)
    link_review_transaction(db, tx_id=home.id, target_forecast_id=car.id, learn_rule=False)
    after = _state(db)
    _press(db, undo_entry)
    _press(db, undo_entry)
    _press(db, redo_entry)
    _press(db, redo_entry)
    assert _state(db) == after
    assert next_redoable(db) is None


def test_a_new_action_empties_the_redo_stack(db, insurances):
    home, car, car_next, _dh, _dc = insurances
    link_review_transaction(db, tx_id=car.id, target_forecast_id=car_next.id, learn_rule=False)
    _press(db, undo_entry)
    link_review_transaction(db, tx_id=home.id, target_forecast_id=car.id, learn_rule=False)
    assert next_redoable(db) is None


def test_undoing_the_batch_frees_the_bank_lines_and_gives_planned_amounts_back(db, insurances):
    home, car, _next, _dh, _dc = insurances
    rollback_autopilot_cycle(db, "b1")
    db.expire_all()
    assert (home.csv_id, home.amount, home.raw_description) == ("1001", 48.00, None)
    assert (car.csv_id, car.amount) == (None, 68.00)


def test_undoing_the_batch_after_a_manual_move(db, insurances):
    home, car, car_next, _dh, _dc = insurances
    link_review_transaction(db, tx_id=car.id, target_forecast_id=car_next.id, learn_rule=False)
    rollback_autopilot_cycle(db, "b1")
    db.expire_all()
    assert all(not (t.csv_id or "").startswith("woob_") for t in (home, car, car_next))
    assert (car.amount, car_next.amount) == (68.00, 68.00)


def test_undoing_a_decision_then_pressing_undo_brings_the_link_back(db, insurances):
    _home, car, _next, _dh, d_car = insurances
    linked = _state(db)
    rollback_autopilot_decision(db, d_car.id)
    db.expire_all()
    assert car.csv_id is None
    _press(db, undo_entry)
    assert _state(db) == linked
    assert db.get(AutopilotDecisionLog, d_car.id).is_undone is False


def test_undoing_the_creation_of_an_operation_undoes_its_decision_too(db):
    tx = Transaction(description="Boulangerie", amount=6.20, type="expense_var", date_operation=DAY, from_account_id=1,
                     csv_id="woob_bank_0001_bread", raw_description="X1234 BOULANGERIE")
    db.add(tx)
    db.flush()
    record_action(db, "transaction", tx.id, "CREATE", None, snapshot_entity(tx), user_name="Automatisme")
    d = AutopilotDecisionLog(batch_id="b2", decision_type="new_entry", action="AUTO_COMMIT", entity_type="transaction",
                             entity_id=tx.id, conn_id=1, account_id=1)
    db.add(d)
    db.commit()

    _press(db, undo_entry)
    assert db.get(AutopilotDecisionLog, d.id).is_undone is True
    _press(db, redo_entry)
    assert db.get(AutopilotDecisionLog, d.id).is_undone is False
    assert db.query(ActionHistory).filter(ActionHistory.is_undone == True).count() == 0


def test_undoing_the_batch_after_a_swap_and_a_second_move(db, insurances):
    """Une opération à vérifier liée sur l'Auto (échange), puis la ligne de l'Auto reliée ailleurs : « Annuler le lot »
    défait les deux liaisons dans l'ordre inverse, puis le lot ; aucune prévision ne garde une ligne ou un montant."""
    home, car, car_next, _dh, _dc = insurances
    review = Transaction(description="Grill du marché", amount=24.00, type="expense_var", date_operation=DAY,
                         from_account_id=1, csv_id="woob_coming_bank_0001_grill", raw_description="X1234 GRILL",
                         needs_review=True)
    db.add(review)
    db.flush()
    db.add(AutopilotDecisionLog(batch_id="b1", decision_type="new_entry", action="AUTO_COMMIT_COMING_PENDING_REVIEW",
                                entity_type="transaction", entity_id=review.id, conn_id=1, account_id=1,
                                raw_snapshot=json.dumps({"bank_tx": {"csv_id": "woob_coming_bank_0001_grill",
                                                                     "raw_amount": -24.0, "amount": 24.0,
                                                                     "account_id": 1}})))
    db.commit()
    link_review_transaction(db, tx_id=review.id, target_forecast_id=car.id, learn_rule=False)
    db.expire_all()
    assert (review.csv_id, car.csv_id) == ("woob_coming_bank_0001_car", "woob_coming_bank_0001_grill")
    link_review_transaction(db, tx_id=review.id, target_forecast_id=car_next.id, learn_rule=False)

    rollback_autopilot_cycle(db, "b1")
    db.expire_all()
    for forecast, planned in ((home, 48.00), (car, 68.00), (car_next, 68.00)):
        assert not (forecast.csv_id or "").startswith("woob_")
        assert (forecast.amount, forecast.comment, forecast.raw_description) == (planned, None, None)
    assert db.get(Transaction, review.id) is None


def test_unlinking_keeps_the_journal_on_the_operation_that_holds_the_line(db, insurances):
    """Deux déplacements de la même ligne, puis délier : la décision pointe sur l'opération qui porte sa ligne, et
    toute prévision sans ligne de la banque garde son montant prévu."""
    home, car, car_next, _dh, d_car = insurances
    link_review_transaction(db, tx_id=car.id, target_forecast_id=car_next.id, learn_rule=False)
    link_review_transaction(db, tx_id=car_next.id, target_forecast_id=home.id, learn_rule=False)

    unlink_forecast_decision(db, d_car.id)
    db.expire_all()
    holder = db.query(Transaction).filter(Transaction.csv_id == "woob_coming_bank_0001_car").one()
    assert db.get(AutopilotDecisionLog, d_car.id).entity_id == holder.id
    for forecast, planned in ((home, 48.00), (car, 68.00), (car_next, 68.00)):
        if not (forecast.csv_id or "").startswith("woob_"):
            assert (forecast.amount, forecast.raw_description) == (planned, None)
