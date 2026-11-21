"""
Annuler une liaison de l'Auto-Pilote après l'avoir déplacée vers une autre prévision puis remise : l'annulation porte
sur la bonne prévision, sans reprendre l'état (et l'identifiant) de celle qui l'a portée entre-temps.
"""
import json
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, AutopilotDecisionLog, Base, RecurrenceTemplate, Transaction
from app.services import stats_cache
from app.services.autopilot_service import (
    link_review_transaction, rollback_autopilot_decision, unlink_forecast_decision,
)
from app.services.history_service import record_action, snapshot_entity

LABEL = "0765432 MUTUELLE DU NORD"
BANK_CSV = "woob_coming_bank_0001_a"


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add(Account(id=1, name="Courant", type="Compte courant", initial_balance=1000.0))
    session.commit()
    yield session
    session.close()


def _forecast(db, name, amount, day, csv_id):
    tpl = RecurrenceTemplate(description=name, amount=amount, type="expense_fixed", category="Assurance",
                             frequency="Monthly", day_of_month=day.day, from_account_id=1)
    db.add(tpl)
    db.flush()
    tx = Transaction(description=name, amount=amount, type="expense_fixed", category="Assurance", date_operation=day,
                     from_account_id=1, recurrence_id=tpl.id, csv_id=csv_id)
    db.add(tx)
    db.flush()
    return tx


@pytest.fixture
def linked(db):
    """L'Auto-Pilote lie une ligne « à venir » de 8,40 € à la prévision « Vie » (prévue 8,00 €)."""
    life = _forecast(db, "Assurance - Vie", 8.00, date(2026, 11, 22), "1001")
    legal = _forecast(db, "Assurance - Juridique", 7.90, date(2026, 12, 22), "1002")
    db.commit()
    before = snapshot_entity(life)
    life.amount, life.csv_id, life.raw_description = 8.40, BANK_CSV, LABEL
    db.flush()
    record_action(db, "transaction", life.id, "UPDATE", before, snapshot_entity(life), user_name="test")
    decision = AutopilotDecisionLog(
        batch_id="b1", decision_type="reconciliation", action="LINKED_COMING_PENDING_REVIEW", entity_type="transaction",
        entity_id=life.id, conn_id=1, account_id=1, confidence_score=65.0,
        raw_snapshot=json.dumps({"before": before, "after": snapshot_entity(life), "matched_db_id": life.id,
                                 "decision_reason": "deviant"}, default=str),
    )
    db.add(decision)
    db.commit()
    return life, legal, decision


def test_undoing_after_moving_the_line_away_and_back_targets_the_right_forecast(db, linked):
    life, legal, decision = linked
    # Déplacée vers la prévision du mois suivant, puis déliée depuis le journal : la ligne revient sur « Vie »
    link_review_transaction(db, tx_id=life.id, target_forecast_id=legal.id, learn_rule=False)
    unlink_forecast_decision(db, decision.id)
    db.refresh(life)
    assert life.csv_id == BANK_CSV
    assert json.loads(decision.raw_snapshot)["before"]["id"] == life.id

    rollback_autopilot_decision(db, decision.id)

    db.refresh(life)
    db.refresh(legal)
    assert (life.csv_id, life.amount, life.raw_description) == ("1001", 8.00, None)
    assert (legal.csv_id, legal.amount) == ("1002", 7.90)
    assert db.get(AutopilotDecisionLog, decision.id).is_undone


def test_undoing_a_decision_whose_snapshot_belongs_to_another_forecast(db, linked):
    """Décisions déjà abîmées par une version précédente : l'instantané « avant » est celui d'une autre prévision."""
    life, legal, decision = linked
    snap = json.loads(decision.raw_snapshot)
    snap["before"] = snapshot_entity(legal)
    decision.raw_snapshot = json.dumps(snap, default=str)
    db.commit()

    rollback_autopilot_decision(db, decision.id)

    db.refresh(life)
    db.refresh(legal)
    assert (life.csv_id, life.amount, life.description) == ("1001", 8.00, "Assurance - Vie")
    assert life.reconciliation_date is None and life.raw_description is None
    assert (legal.csv_id, legal.amount) == ("1002", 7.90)
