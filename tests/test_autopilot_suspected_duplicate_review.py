"""
tests/test_autopilot_suspected_duplicate_review.py
--------------------------------------------------
Vérifie le routage des opérations avec suspicion de doublon prévisionnel
vers la Review Queue d'Auto-Pilote (au lieu du Sas bancaire résiduel) :
1. Auto-commit avec needs_review=True et reconciliation_date=None.
2. Traçabilité AUTO_COMMIT_SUSPECTED_DUPLICATE_PENDING_REVIEW.
3. Détection de la prévision candidate dans get_review_queue.
4. Validation (force_keep_current) : pointage automatique et action AUTO_COMMIT.
5. Liaison (link_review_transaction) : fusion avec la prévision et dédoublonnage parfait.
"""

from datetime import date, timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Transaction, Category, AutopilotDecisionLog, GlobalConfig
from app.services.autopilot_service import (
    process_incoming_batch,
    get_review_queue,
    validate_review_transaction,
    link_review_transaction,
    find_candidate_forecasts_for_tx,
)


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()

    # Configuration Auto-Pilote activé et seuil à 80%
    db.add_all([
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="auto_pilot_confidence_threshold", value="80"),
        GlobalConfig(key="autopilot_auto_commit_incoming", value="true"),
    ])

    acc = Account(id=1, name="CA Centre-Est", currency="EUR", is_closed=False, type="Compte courant")
    cat = Category(id=1, name="Assurance", type="expense_var")
    db.add_all([acc, cat])
    db.commit()

    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)


def test_suspected_duplicate_routed_to_review_queue_not_sas(db_session):
    # 1. Créer une prévision comptable non pointée (ex: -100.00 € Ouverture PER le 07/10/2026)
    forecast = Transaction(
        id=3358,
        date_saisie=date(2026, 10, 1),
        date_operation=date(2026, 10, 7),
        description="Ouverture PER (Kun Yang)",
        amount=100.00,
        type="expense_var",
        category="Assurance",
        from_account_id=1,
        reconciliation_date=None,
        needs_review=False
    )
    db_session.add(forecast)
    db_session.commit()

    # 2. Arrivée d'un relevé bancaire avec un libellé brut 'SURAVENIR' (-100.00 € le 15/10/2026)
    preview_data = {
        "accounts": [{
            "account_id": 1,
            "account_name": "CA Centre-Est",
            "transactions": [
                {
                    "date_operation": "2026-10-15",
                    "description": "Suravenir",
                    "raw_description": "SURAVENIR",
                    "amount": 100.00,
                    "raw_amount": -100.00,
                    "is_reconciled": False,
                    "already_reconciled": False,
                    "matched_db_id": None,
                    "category": "Assurance",
                    "csv_id": "woob_suravenir_test_01",
                    "account_id": 1,
                    "is_coming": False,
                    "smart_suggested": True,
                    "smart_source": "ai",
                    "smart_confidence": 0.85
                }
            ]
        }]
    }

    # 3. Traitement par l'Auto-Pilote
    res = process_incoming_batch(db_session, 1, preview_data)

    # L'opération ne doit PAS être bloquée dans le sas (pending == 0)
    assert res["status"] == "completed"
    assert res["pending"] == 0
    assert res["auto_committed"] == 1
    assert res["needs_review"] == 1

    # Vérifier l'état de la transaction créée en base
    new_tx = db_session.query(Transaction).filter(Transaction.csv_id == "woob_suravenir_test_01").first()
    assert new_tx is not None
    assert new_tx.needs_review is True
    # Pointage suspendu en attente d'arbitrage
    assert new_tx.reconciliation_date is None
    assert new_tx.amount == 100.00

    # Vérifier le log de décision Auto-Pilote
    dlog = db_session.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.entity_id == new_tx.id
    ).first()
    assert dlog is not None
    assert dlog.action == "AUTO_COMMIT_SUSPECTED_DUPLICATE_PENDING_REVIEW"

    # Vérifier que la Review Queue présente l'opération avec sa prévision candidate
    queue = get_review_queue(db_session)
    assert len(queue) == 1
    item = queue[0]
    assert item["id"] == new_tx.id
    assert len(item["candidate_forecasts"]) >= 1
    candidate = item["candidate_forecasts"][0]
    assert candidate["id"] == forecast.id
    assert candidate["description"] == "Ouverture PER (Kun Yang)"
    assert candidate["amt_diff"] == 0.0


def test_validate_review_suspected_duplicate(db_session):
    # Transaction créée avec suspicion de doublon
    tx = Transaction(
        id=5001,
        date_saisie=date(2026, 10, 15),
        date_operation=date(2026, 10, 15),
        description="Suravenir",
        raw_description="SURAVENIR",
        amount=100.00,
        type="expense_var",
        category="Assurance",
        from_account_id=1,
        reconciliation_date=None,
        needs_review=True
    )
    db_session.add(tx)
    dlog = AutopilotDecisionLog(
        batch_id="batch_test",
        decision_type="new_entry",
        action="AUTO_COMMIT_SUSPECTED_DUPLICATE_PENDING_REVIEW",
        entity_type="transaction",
        entity_id=tx.id,
        account_id=1
    )
    db_session.add(dlog)
    db_session.commit()

    # L'utilisateur choisit [✓ C'est OK (Conserver telle quelle)]
    validate_review_transaction(db_session, tx.id, force_keep_current=True)

    db_session.refresh(tx)
    db_session.refresh(dlog)

    assert tx.needs_review is False
    assert tx.reconciliation_date == date(2026, 10, 15)
    assert dlog.action == "AUTO_COMMIT"


def test_link_review_suspected_duplicate(db_session):
    forecast = Transaction(
        id=3358,
        date_saisie=date(2026, 10, 1),
        date_operation=date(2026, 10, 7),
        description="Ouverture PER (Kun Yang)",
        amount=100.00,
        type="expense_var",
        category="Assurance",
        from_account_id=1,
        reconciliation_date=None,
        needs_review=False
    )
    review_tx = Transaction(
        id=5002,
        date_saisie=date(2026, 10, 15),
        date_operation=date(2026, 10, 15),
        description="Suravenir",
        raw_description="SURAVENIR",
        amount=100.00,
        type="expense_var",
        category="Assurance",
        from_account_id=1,
        csv_id="woob_suravenir_link_01",
        reconciliation_date=None,
        needs_review=True
    )
    db_session.add_all([forecast, review_tx])
    db_session.commit()

    # L'utilisateur choisit [🔗 Lier à cette prévision]
    link_review_transaction(db_session, tx_id=review_tx.id, target_forecast_id=forecast.id)

    db_session.refresh(forecast)
    # L'opération de revue temporaire doit avoir été supprimée
    assert db_session.query(Transaction).filter(Transaction.id == review_tx.id).first() is None

    # La prévision est enrichie, rapprochée et acquittée
    assert forecast.needs_review is False
    assert forecast.reconciliation_date is not None
    assert forecast.raw_description == "SURAVENIR"
    assert forecast.csv_id == "woob_suravenir_link_01"
