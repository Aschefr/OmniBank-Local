"""
tests/test_autopilot_step2.py
-----------------------------
Pack de Test 2 pour l'Étape 2 de l'Auto-Pilote :
- T2.1 : Auto-rapprochement haute certitude (Score >= 85, pointage instantané en base)
- T2.2 : Zone d'arbitrage / Rapprochement suggéré (60 <= Score < 85, maintien dans le Sas)
- T2.3 : Anti-collision sur montants homonymes avec discriminant textuel (Abonnement A vs B)
- T2.4 : Anti-collision absolue sans discriminant (conflit de score -> Sas d'attente)
- T2.5 : Garantie de non-régression lorsque auto_pilot_enabled = False (Sas uniquement)
- T2.6 : Réversibilité Undo/Redo via history_service
- T2.7 : Traçabilité et intégrité de AutopilotDecisionLog
"""
import json
import pytest
from datetime import date, datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account,
    Transaction,
    GlobalConfig,
    AutopilotDecisionLog,
    ActionHistory
)
from app.services.reconciliation_engine import check_reconciliation, evaluate_candidate
from app.services.autopilot_service import (
    process_incoming_batch,
    is_autopilot_enabled,
    set_autopilot_enabled
)
from app.services.history_service import undo_action
from app.services.bank_sync_scheduler import _PENDING_SYNC_DATA


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée pour les tests Step 2."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Création d'un compte courant de référence
    acc = Account(id=1, name="Compte Courant", type="checking", initial_balance=2500.0)
    db.add(acc)

    # Initialisation des configs par défaut
    db.add(GlobalConfig(key="auto_pilot_enabled", value="true"))
    db.add(GlobalConfig(key="bank_sync_on_vault_unlock", value="true"))
    db.add(GlobalConfig(key="last_auto_sync_attempt", value=""))
    db.commit()

    # Réinitialisation du sas mémoire
    _PENDING_SYNC_DATA.clear()

    try:
        yield db
    finally:
        db.close()
        _PENDING_SYNC_DATA.clear()


def test_t2_1_high_confidence_auto_reconciliation(test_db):
    """
    T2.1 : Prévision existante : Loyer 750,00 € au 01/10.
    Relevé bancaire : Débit 750,00 € 'PRLV LOYER' le 02/10.
    Score >= 90 pts -> Rapprochement automatique instantané en base.
    """
    # 1. Créer la prévision non pointée en base
    tx_loyer = Transaction(
        id=101,
        date_operation=date(2026, 10, 1),
        date_saisie=date(2026, 9, 25),
        description="Loyer",
        amount=750.0,
        type="expense_fixed",
        category="Logement",
        from_account_id=1,
        reconciliation_date=None
    )
    test_db.add(tx_loyer)
    test_db.commit()

    # 2. Vérifier le calcul du score composite pur
    bank_tx_date = date(2026, 10, 2)
    bank_amount = -750.0
    rec_info = check_reconciliation(
        test_db,
        tx_date=bank_tx_date,
        tx_amount=bank_amount,
        account_id=1,
        bank_label="PRLV LOYER",
        csv_id="woob_loyer_123"
    )

    assert rec_info is not None
    assert rec_info["id"] == 101
    assert rec_info["match_score"] >= 90
    assert rec_info["collision_detected"] is False
    assert rec_info["auto_committed"] is True

    # 3. Exécuter l'ingestion via AutoPilotService
    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-10-02",
                        "description": "PRLV LOYER",
                        "raw_description": "PRLV LOYER",
                        "amount": 750.0,
                        "raw_amount": -750.0,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 101,
                        "match_score": rec_info["match_score"],
                        "collision_detected": rec_info["collision_detected"],
                        "csv_id": "woob_loyer_123",
                        "account_id": 1,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data, profile_id="default")

    # 4. Vérifications métier
    assert res["status"] == "completed"
    assert res["auto_reconciled"] == 1
    assert res["pending"] == 0

    # L'opération en base doit être pointée
    test_db.refresh(tx_loyer)
    assert tx_loyer.reconciliation_date is not None
    assert tx_loyer.csv_id == "woob_loyer_123"

    # Journal de décision Auto-Pilote
    decision = test_db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.entity_id == 101).first()
    assert decision is not None
    assert decision.decision_type == "reconciliation"
    assert decision.action == "AUTO_COMMIT"
    assert decision.confidence_score >= 90
    assert decision.is_undone is False

    # Entrée Undo/Redo dans ActionHistory
    action = test_db.query(ActionHistory).filter(ActionHistory.entity_id == 101).order_by(ActionHistory.id.desc()).first()
    assert action is not None
    assert action.action_type == "UPDATE"
    assert action.user_name == "Auto-Pilote"


def test_t2_2_suggested_match_arbitration_zone(test_db):
    """
    T2.2 : Prévision existante : Retrait DAB 40,00 € au 05/10.
    Relevé : Débit 40,00 € 'RETRAIT DAB' le 18/10 (écart de 13 jours).
    Score calculé entre 60 et 85 pts -> Pas d'auto-commit, maintien dans le Sas d'attente.
    """
    tx_dab = Transaction(
        id=102,
        date_operation=date(2026, 10, 5),
        description="Retrait DAB",
        amount=40.0,
        type="expense_var",
        from_account_id=1,
        reconciliation_date=None
    )
    test_db.add(tx_dab)
    test_db.commit()

    # Écart de 13 jours
    bank_tx_date = date(2026, 10, 18)
    bank_amount = -40.0

    rec_info = check_reconciliation(
        test_db,
        tx_date=bank_tx_date,
        tx_amount=bank_amount,
        account_id=1,
        bank_label="RETRAIT DAB"
    )

    assert rec_info is not None
    assert rec_info["id"] == 102
    assert 60 <= rec_info["match_score"] < 85
    assert rec_info["suggested_match"] is True
    assert rec_info["auto_committed"] is False

    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-10-18",
                        "description": "RETRAIT DAB",
                        "raw_description": "RETRAIT DAB",
                        "amount": 40.0,
                        "raw_amount": -40.0,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 102,
                        "match_score": rec_info["match_score"],
                        "collision_detected": rec_info["collision_detected"],
                        "csv_id": "woob_dab_123",
                        "account_id": 1,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data, profile_id="default")

    # Vérifications : 0 auto-reconciled, 1 pending dans le Sas
    assert res["auto_reconciled"] == 0
    assert res["pending"] == 1

    # La prévision en base ne doit PAS être modifiée
    test_db.refresh(tx_dab)
    assert tx_dab.reconciliation_date is None

    # L'opération doit résider dans le sas d'attente
    pending_sas = _PENDING_SYNC_DATA.get("default", {})
    assert 1 in pending_sas
    assert len(pending_sas[1]["accounts"][0]["transactions"]) == 1


def test_t2_3_anti_collision_with_textual_discriminant(test_db):
    """
    T2.3 : Deux prévisions identiques en montant (15,00 €) au même jour :
    - Abonnement A (15,00 €)
    - Abonnement B (15,00 €)
    Relevé : Débit 15,00 € 'ABO A'.
    Similarité textuelle -> Rapprochement sur la prévision A.
    La prévision B reste ouverte et intacte.
    """
    tx_a = Transaction(
        id=201,
        date_operation=date(2026, 10, 1),
        description="Abonnement A",
        amount=15.0,
        type="expense_fixed",
        from_account_id=1,
        reconciliation_date=None
    )
    tx_b = Transaction(
        id=202,
        date_operation=date(2026, 10, 1),
        description="Abonnement B",
        amount=15.0,
        type="expense_fixed",
        from_account_id=1,
        reconciliation_date=None
    )
    test_db.add_all([tx_a, tx_b])
    test_db.commit()

    rec_info = check_reconciliation(
        test_db,
        tx_date=date(2026, 10, 1),
        tx_amount=-15.0,
        account_id=1,
        bank_label="ABO A"
    )

    assert rec_info is not None
    assert rec_info["id"] == 201  # Prévision A sélectionnée
    assert rec_info["match_score"] >= 85
    assert rec_info["collision_detected"] is False

    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-10-01",
                        "description": "ABO A",
                        "raw_description": "ABO A",
                        "amount": 15.0,
                        "raw_amount": -15.0,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 201,
                        "match_score": rec_info["match_score"],
                        "collision_detected": False,
                        "csv_id": "woob_abo_a",
                        "account_id": 1,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data, profile_id="default")
    assert res["auto_reconciled"] == 1
    assert res["pending"] == 0

    test_db.refresh(tx_a)
    test_db.refresh(tx_b)
    # Prévision A pointée, Prévision B intacte
    assert tx_a.reconciliation_date is not None
    assert tx_b.reconciliation_date is None


def test_t2_4_anti_collision_without_textual_discriminant(test_db):
    """
    T2.4 : Deux prévisions strictement identiques en montant et libellé :
    - Retrait DAB (40,00 €) au 05/10
    - Retrait DAB (40,00 €) au 05/10
    Relevé : Débit 40,00 € 'RETRAIT DAB' au 05/10.
    Égalité parfaite de score -> collision_detected = True.
    Zéro auto-commit arbitraire en base, maintien dans le Sas pour arbitrage.
    """
    tx_dab1 = Transaction(
        id=301,
        date_operation=date(2026, 10, 5),
        description="Retrait DAB",
        amount=40.0,
        type="expense_var",
        from_account_id=1,
        reconciliation_date=None
    )
    tx_dab2 = Transaction(
        id=302,
        date_operation=date(2026, 10, 5),
        description="Retrait DAB",
        amount=40.0,
        type="expense_var",
        from_account_id=1,
        reconciliation_date=None
    )
    test_db.add_all([tx_dab1, tx_dab2])
    test_db.commit()

    rec_info = check_reconciliation(
        test_db,
        tx_date=date(2026, 10, 5),
        tx_amount=-40.0,
        account_id=1,
        bank_label="RETRAIT DAB"
    )

    assert rec_info is not None
    assert rec_info["collision_detected"] is True
    assert rec_info["suggested_match"] is True
    assert rec_info["auto_committed"] is False

    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-10-05",
                        "description": "RETRAIT DAB",
                        "raw_description": "RETRAIT DAB",
                        "amount": 40.0,
                        "raw_amount": -40.0,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": rec_info["id"],
                        "match_score": rec_info["match_score"],
                        "collision_detected": rec_info["collision_detected"],
                        "csv_id": "woob_collision_dab",
                        "account_id": 1,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data, profile_id="default")
    assert res["auto_reconciled"] == 0
    assert res["pending"] == 1

    # Les deux prévisions doivent rester intactes (non pointées)
    test_db.refresh(tx_dab1)
    test_db.refresh(tx_dab2)
    assert tx_dab1.reconciliation_date is None
    assert tx_dab2.reconciliation_date is None


def test_t2_5_non_regression_when_autopilot_disabled(test_db):
    """
    T2.5 : auto_pilot_enabled = False.
    Même situation qu'en T2.1 (Loyer 750 €).
    Résultat : 0 commit en base, 100% de délégation au Sas d'attente.
    """
    set_autopilot_enabled(test_db, False)
    assert is_autopilot_enabled(test_db) is False

    tx_loyer = Transaction(
        id=401,
        date_operation=date(2026, 10, 1),
        description="Loyer",
        amount=750.0,
        type="expense_fixed",
        from_account_id=1,
        reconciliation_date=None
    )
    test_db.add(tx_loyer)
    test_db.commit()

    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-10-02",
                        "description": "PRLV LOYER",
                        "raw_description": "PRLV LOYER",
                        "amount": 750.0,
                        "raw_amount": -750.0,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 401,
                        "match_score": 95,
                        "collision_detected": False,
                        "csv_id": "woob_loyer_disabled",
                        "account_id": 1,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data, profile_id="default")

    assert res["status"] == "delegated_to_sas"
    assert res["auto_reconciled"] == 0
    assert res["pending"] == 1

    # La prévision en base est STRICTEMENT inchangée
    test_db.refresh(tx_loyer)
    assert tx_loyer.reconciliation_date is None

    # Zéro entrée DecisionLog
    logs = test_db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.entity_id == 401).all()
    assert len(logs) == 0


def test_t2_6_undo_redo_reversibility(test_db):
    """
    T2.6 : Vérification de la réversibilité Undo/Redo via history_service.
    Un auto-rapprochement annulé remet la prévision en état non pointé.
    """
    tx_sub = Transaction(
        id=501,
        date_operation=date(2026, 10, 10),
        description="Netflix",
        amount=17.99,
        type="expense_fixed",
        from_account_id=1,
        reconciliation_date=None
    )
    test_db.add(tx_sub)
    test_db.commit()

    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-10-10",
                        "description": "NETFLIX.COM",
                        "raw_description": "NETFLIX.COM",
                        "amount": 17.99,
                        "raw_amount": -17.99,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 501,
                        "match_score": 95,
                        "collision_detected": False,
                        "csv_id": "woob_netflix_123",
                        "account_id": 1,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data, profile_id="default")
    assert res["auto_reconciled"] == 1

    test_db.refresh(tx_sub)
    assert tx_sub.reconciliation_date is not None

    # Récupérer l'action d'historique créée
    action = test_db.query(ActionHistory).filter(ActionHistory.entity_id == 501).order_by(ActionHistory.id.desc()).first()
    assert action is not None
    assert action.action_type == "UPDATE"
    assert action.is_undone is False

    # Déclencher le Undo
    success, reason = undo_action(test_db, action)
    assert success is True
    test_db.commit()

    test_db.refresh(tx_sub)
    # L'état antérieur est fidèlement restauré
    assert tx_sub.reconciliation_date is None
    assert action.is_undone is True


def test_t2_7_decision_log_structure_and_json_payload(test_db):
    """
    T2.7 : Vérifie la structure exhaustive, l'indexation et les données JSON de AutopilotDecisionLog.
    """
    tx = Transaction(
        id=601,
        date_operation=date(2026, 10, 15),
        description="Assurance Habitation",
        amount=32.50,
        type="expense_fixed",
        from_account_id=1,
        reconciliation_date=None
    )
    test_db.add(tx)
    test_db.commit()

    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-10-15",
                        "description": "PRLV ASSURANCE",
                        "raw_description": "PRLV ASSURANCE HABITATION",
                        "amount": 32.50,
                        "raw_amount": -32.50,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 601,
                        "match_score": 92.0,
                        "collision_detected": False,
                        "csv_id": "woob_assur_123",
                        "account_id": 1,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data, profile_id="default")
    assert res["status"] == "completed"

    log_entry = test_db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.entity_id == 601).first()
    assert log_entry is not None
    assert log_entry.batch_id == res["batch_id"]
    assert log_entry.decision_type == "reconciliation"
    assert log_entry.action == "AUTO_COMMIT"
    assert log_entry.entity_type == "transaction"
    assert log_entry.conn_id == 1
    assert log_entry.account_id == 1
    assert log_entry.confidence_score == 92.0
    assert log_entry.is_undone is False
    assert log_entry.created_at is not None

    # Désérialisation du snapshot
    snap = json.loads(log_entry.raw_snapshot)
    assert "before" in snap
    assert "after" in snap
    assert snap["before"]["reconciliation_date"] is None
    assert snap["after"]["reconciliation_date"] is not None


def test_t2_8_csv_import_flow_with_autopilot(test_db):
    """
    T2.8 : Vérifie l'intégration du flux CSV avec AutoPilotService (CSV_IMPORT_CONN_ID).
    """
    from app.services.bank_sync_scheduler import CSV_IMPORT_CONN_ID

    tx = Transaction(
        id=701,
        date_operation=date(2026, 9, 20),
        description="EDF Electricité",
        amount=89.0,
        type="expense_fixed",
        from_account_id=1,
        reconciliation_date=None
    )
    test_db.add(tx)
    test_db.commit()

    csv_preview = {
        "_source": "csv_import",
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-09-20",
                        "description": "PRLV EDF",
                        "raw_description": "PRLV EDF CLIENT 123",
                        "amount": 89.0,
                        "raw_amount": -89.0,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 701,
                        "match_score": 95.0,
                        "collision_detected": False,
                        "csv_id": "csv_edf_0",
                        "account_id": 1,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(test_db, conn_id=CSV_IMPORT_CONN_ID, preview_data=csv_preview, profile_id="default")
    assert res["auto_reconciled"] == 1
    assert res["pending"] == 0

    log = test_db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.entity_id == 701).first()
    assert log is not None
    assert log.conn_id is None  # Les imports fichiers n'ont pas de conn_id réseau
    assert log.account_id == 1
