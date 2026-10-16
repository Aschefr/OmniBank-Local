"""
tests/test_autopilot_fluctuating_recurrence.py
----------------------------------------------
Vérifie la détection et le traitement des opérations récurrentes à montants fluctuants
(ex: prévision Sosh à 14,99 € vs débit réel Orange à 46,79 € avec hors-forfait / frais variables) :
1. Détection de la collision prévisionnelle malgré l'écart de montant.
2. Non-auto-commit silencieux : routage obligatoire en Review Queue (needs_review=True, score <= 70%).
3. Présence de la prévision candidate dans candidate_forecasts pour liaison en 1 clic.
4. Liaison (link_review_transaction) : fusion, mise à jour du montant et dédoublonnage.
5. Maintien du Full-Auto pour les opérations isolées sans prévision concurrente.
"""

from datetime import date, timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Transaction, Category, AutopilotDecisionLog, GlobalConfig, RecurrenceTemplate
from app.services.autopilot_service import (
    process_incoming_batch,
    get_review_queue,
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
        GlobalConfig(key="auto_link_deviant_recurrences", value="true"),
    ])

    acc = Account(id=1, name="CA Centre-Est", currency="EUR", is_closed=False, type="Compte courant")
    cat_telecom = Category(id=1, name="Telecoms", type="expense_var")
    cat_courses = Category(id=2, name="Courses", type="expense_var")
    db.add_all([acc, cat_telecom, cat_courses])
    db.commit()

    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)


def test_fluctuating_recurrence_routed_to_review_queue(db_session):
    """
    Scénario Sosh 14,99 € vs Orange 46,79 € :
    L'opération arrive avec un montant différent (hors-forfait).
    Elle ne doit PAS être validée aveuglément comme nouvelle écriture avec 85% de confiance,
    mais atterrir dans la Review Queue pour permettre la liaison à la prévision.
    """
    # 1. Prévision existante issue d'une récurrence
    rule = RecurrenceTemplate(
        id=53,
        description="Sosh - Mensualitée",
        amount=14.99,
        category="Telecoms",
        type="expense_fixed",
        day_of_month=20,
        from_account_id=1,
        frequency="Monthly",
        is_closed=False
    )
    forecast = Transaction(
        id=2417,
        date_saisie=date(2026, 10, 1),
        date_operation=date(2026, 10, 20),
        description="Sosh - Mensualitée",
        amount=14.99,
        type="expense_fixed",
        category="Telecoms",
        from_account_id=1,
        recurrence_id=53,
        reconciliation_date=None,
        needs_review=False,
        csv_id="2351"  # ID legacy import CSV
    )
    db_session.add_all([rule, forecast])
    db_session.commit()

    # 2. Arrivée d'une opération bancaire Orange à 46.79 € (hors-forfait)
    preview_data = {
        "accounts": [{
            "account_id": 1,
            "account_name": "CA Centre-Est",
            "transactions": [
                {
                    "date_operation": "2026-10-19",
                    "description": "Orange",
                    "raw_description": "ORANGE SA-ORANGE",
                    "amount": 46.79,
                    "raw_amount": -46.79,
                    "is_reconciled": False,
                    "already_reconciled": False,
                    "matched_db_id": None,
                    "category": "Telecoms",
                    "csv_id": "woob_coming_cragr_04113708641_2e272ee5abd3",
                    "account_id": 1,
                    "is_coming": False,
                    "smart_suggested": True,
                    "smart_source": "ai",
                    "smart_confidence": 0.85
                }
            ]
        }]
    }

    result = process_incoming_batch(
        db=db_session,
        conn_id=1,
        preview_data=preview_data
    )

    # 3. Vérifications : l'opération doit nécessiter une revue manuelle
    assert result["needs_review"] == 1
    assert result["auto_committed"] == 1  # Créé en base avec needs_review=True

    # Vérifier la transaction créée en base
    created_tx = db_session.query(Transaction).filter(
        Transaction.csv_id == "woob_coming_cragr_04113708641_2e272ee5abd3"
    ).first()
    assert created_tx is not None
    assert created_tx.needs_review is True
    assert created_tx.reconciliation_date is None
    assert created_tx.confidence_score <= 70.0  # Abaissé sous le seuil de 80%

    # Vérifier le log de décision
    decision = db_session.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.entity_id == created_tx.id
    ).first()
    assert decision is not None
    assert decision.action == "AUTO_COMMIT_SUSPECTED_DUPLICATE_PENDING_REVIEW"

    # 4. Vérifier la Review Queue et la prévision suggérée
    queue = get_review_queue(db_session)
    assert len(queue) == 1
    assert queue[0]["id"] == created_tx.id
    assert len(queue[0]["candidate_forecasts"]) >= 1

    candidate = queue[0]["candidate_forecasts"][0]
    assert candidate["id"] == 2417
    assert candidate["description"] == "Sosh - Mensualitée"
    assert candidate["amount"] == 14.99

    # 5. Tester la liaison (1-click link)
    link_review_transaction(
        db=db_session,
        tx_id=created_tx.id,
        target_forecast_id=candidate["id"]
    )

    # Vérifier que la prévision a été mise à jour et pointée
    db_session.refresh(forecast)
    assert forecast.amount == 46.79
    assert "Auto-ajusté : 14.99 € → 46.79 €" in (forecast.comment or "")
    # Pour une opération à venir (woob_coming_), la prévision reste non pointée jusqu'au débit officiel
    assert forecast.reconciliation_date is None
    assert forecast.needs_review is False

    # Vérifier que la transaction de revue temporaire a été supprimée
    deleted_review = db_session.query(Transaction).filter(Transaction.id == created_tx.id).first()
    assert deleted_review is None


def test_isolated_transaction_auto_committed_in_full_auto(db_session):
    """
    Vérifie qu'une vraie transaction isolée (sans prévision concurrente)
    continue à être auto-validée sans intervention de l'utilisateur.
    """
    preview_data = {
        "accounts": [{
            "account_id": 1,
            "account_name": "CA Centre-Est",
            "transactions": [
                {
                    "date_operation": "2026-10-15",
                    "description": "Auchan",
                    "raw_description": "AUCHAN SUPERMARCHE",
                    "amount": 25.50,
                    "raw_amount": -25.50,
                    "is_reconciled": False,
                    "already_reconciled": False,
                    "matched_db_id": None,
                    "category": "Courses",
                    "csv_id": "woob_auchan_test_01",
                    "account_id": 1,
                    "is_coming": False,
                    "smart_suggested": True,
                    "smart_source": "ai",
                    "smart_confidence": 0.88
                }
            ]
        }]
    }

    result = process_incoming_batch(
        db=db_session,
        conn_id=1,
        preview_data=preview_data
    )

    # L'opération doit être 100% auto-validée sans revue
    assert result["needs_review"] == 0
    assert result["auto_committed"] == 1

    created_tx = db_session.query(Transaction).filter(
        Transaction.csv_id == "woob_auchan_test_01"
    ).first()
    assert created_tx is not None
    assert created_tx.needs_review is False
    assert created_tx.reconciliation_date is not None
    assert created_tx.confidence_score >= 80.0

    decision = db_session.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.entity_id == created_tx.id
    ).first()
    assert decision.action == "AUTO_COMMIT"


def test_fluctuating_recurrence_confirmed_debit_points_forecast(db_session):
    """
    Vérifie qu'une opération débitée confirmée (non 'woob_coming_')
    qui est liée par l'utilisateur met à jour le montant ET applique le pointage.
    """
    rule = RecurrenceTemplate(
        id=60,
        description="EDF Electricité",
        amount=50.00,
        category="Énergie",
        type="expense_var",
        day_of_month=15,
        from_account_id=1,
        frequency="Monthly",
        is_closed=False
    )
    forecast = Transaction(
        id=3001,
        date_saisie=date(2026, 10, 1),
        date_operation=date(2026, 10, 15),
        description="EDF Electricité",
        amount=50.00,
        type="expense_var",
        category="Énergie",
        from_account_id=1,
        recurrence_id=60,
        reconciliation_date=None,
        needs_review=False,
    )
    db_session.add_all([rule, forecast])
    db_session.commit()

    # Facture réelle débitée de 160.00 € (régularisation hivernale / forte fluctuation > facteur 3)
    preview_data = {
        "accounts": [{
            "account_id": 1,
            "account_name": "CA Centre-Est",
            "transactions": [
                {
                    "date_operation": "2026-10-16",
                    "description": "EDF",
                    "raw_description": "PRLV SEPA EDF CLIENT 874628",
                    "amount": 160.00,
                    "raw_amount": -160.00,
                    "is_reconciled": False,
                    "already_reconciled": False,
                    "matched_db_id": None,
                    "category": "Énergie",
                    "csv_id": "woob_cragr_04113708641_edf_oct",
                    "account_id": 1,
                    "is_coming": False,
                    "smart_suggested": True,
                    "smart_source": "ai",
                    "smart_confidence": 0.85
                }
            ]
        }]
    }

    result = process_incoming_batch(
        db=db_session,
        conn_id=1,
        preview_data=preview_data
    )

    assert result["needs_review"] == 1
    queue = get_review_queue(db_session)
    assert len(queue) == 1
    assert queue[0]["candidate_forecasts"][0]["id"] == 3001

    # Lier à la prévision
    link_review_transaction(
        db=db_session,
        tx_id=queue[0]["id"],
        target_forecast_id=3001
    )

    db_session.refresh(forecast)
    assert forecast.amount == 160.00
    assert "Auto-ajusté : 50.00 € → 160.00 €" in (forecast.comment or "")
    assert forecast.csv_id == "woob_cragr_04113708641_edf_oct"
    assert forecast.reconciliation_date is not None
    assert forecast.needs_review is False


def test_already_reconciled_legacy_csv_id_not_duplicated(db_session):
    """
    Vérifie qu'une opération historique déjà pointée en base avec un csv_id hérité (import CSV '2331')
    n'est PAS ressaisie en double lorsqu'elle est renvoyée par Woob dans la fenêtre historique de 30 jours.
    """
    # Opération historique déjà pointée en septembre
    existing_recon = Transaction(
        id=2394,
        date_saisie=date(2026, 9, 1),
        date_operation=date(2026, 9, 20),
        description="Sosh - Mensualitée",
        amount=39.99,
        type="expense_fixed",
        category="Telecoms",
        from_account_id=1,
        reconciliation_date=date(2026, 9, 18),
        needs_review=False,
        csv_id="2331"  # Ancien ID CSV
    )
    db_session.add(existing_recon)
    db_session.commit()

    # Woob renvoie l'opération de septembre dans son flux bancaire avec son remote_id
    preview_data = {
        "accounts": [{
            "account_id": 1,
            "account_name": "CA Centre-Est",
            "transactions": [
                {
                    "date_operation": "2026-09-18",
                    "description": "Orange",
                    "raw_description": "ORANGE SA-ORANGE",
                    "amount": 39.99,
                    "raw_amount": -39.99,
                    "is_reconciled": False,
                    "already_reconciled": False,
                    "matched_db_id": None,
                    "category": "Telecoms",
                    "csv_id": "woob_cragr_04113708641_20435904eeee",
                    "account_id": 1,
                    "is_coming": False,
                    "smart_suggested": True,
                    "smart_source": "ai",
                    "smart_confidence": 0.85
                }
            ]
        }]
    }

    result = process_incoming_batch(
        db=db_session,
        conn_id=1,
        preview_data=preview_data
    )

    # Aucune création en double ni revue requise : reconnue comme déjà pointée
    assert result["auto_committed"] == 0
    assert result["needs_review"] == 0

    # Vérifier qu'aucune nouvelle transaction n'a été créée
    all_txs = db_session.query(Transaction).all()
    assert len(all_txs) == 1
    assert all_txs[0].id == 2394
    # Le csv_id a été mis à jour avec le vrai remote_id Woob
    assert all_txs[0].csv_id == "woob_cragr_04113708641_20435904eeee"

