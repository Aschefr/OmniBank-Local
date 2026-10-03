import json
import pytest
from datetime import date, datetime, timezone
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.models import BankConnection, Account, Notification, GlobalConfig, Transaction
from app.services.bank_sync.auto_sync import execute_auto_sync_for_connection
from app.services.bank_sync.sync_service import BankSyncService


@pytest.fixture
def db_session():
    test_engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=test_engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()
        test_engine.dispose()


def test_autopilot_silent_when_no_actions(db_session, monkeypatch):
    """Quand l'Auto-Pilote est actif en arrière-plan et qu'il n'y a aucune action ni mouvement, aucune notification n'est émise."""
    # Activer l'Auto-Pilote
    cfg = GlobalConfig(key="auto_pilot_enabled", value="true")
    db_session.add(cfg)

    conn = BankConnection(
        label="Banque Populaire",
        backend="woob",
        is_active=True
    )
    db_session.add(conn)
    db_session.commit()

    # Mock retournant 0 transaction
    mock_preview = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Chèque",
                "transactions": []
            }
        ]
    }
    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", lambda **kwargs: mock_preview)

    execute_auto_sync_for_connection(db_session, conn, "test_pw", trigger_source="scheduled")

    # Vérifier qu'AUCUNE notification n'a été créée (ni bank_sync, ni autopilot, ni "À jour")
    notifs = db_session.query(Notification).all()
    assert len(notifs) == 0, f"Attendu 0 notification mais reçu: {[n.title for n in notifs]}"


def test_autopilot_notification_when_actions_performed(db_session, monkeypatch):
    """Quand l'Auto-Pilote est actif et traite des opérations, une notification dédiée Auto-Pilote est émise."""
    cfg = GlobalConfig(key="auto_pilot_enabled", value="true")
    db_session.add(cfg)

    conn = BankConnection(
        label="Crédit Agricole",
        backend="woob",
        is_active=True
    )
    db_session.add(conn)
    db_session.commit()

    # Mocking process_incoming_batch pour simuler 2 auto-rapprochements et 1 écriture autonome
    mock_preview = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": []
            }
        ]
    }
    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", lambda **kwargs: mock_preview)

    def mock_process_incoming_batch(db, conn_id, preview, profile_id=None):
        return {
            "status": "completed",
            "auto_reconciled": 2,
            "auto_committed": 1,
            "promoted_recurrences": 1,
            "pending": 0,
            "total": 3
        }

    import app.services.bank_sync.auto_sync as auto_sync_mod
    monkeypatch.setattr("app.services.autopilot_service.process_incoming_batch", mock_process_incoming_batch)

    execute_auto_sync_for_connection(db_session, conn, "test_pw", trigger_source="scheduled")

    notifs = db_session.query(Notification).filter(Notification.type == "autopilot").all()
    assert len(notifs) == 1
    n = notifs[0]
    assert "🤖 Auto-Pilote : Crédit Agricole" in n.title
    assert "2 opérations auto-rapprochées" in n.content
    assert "1 écriture enregistrée" in n.content
    assert "1 récurrence détectée" in n.content

    link_data = json.loads(n.link_data)
    assert link_data["view"] == "autopilot"
    assert link_data["action"] == "open_pending"
    assert link_data["auto_reconciled"] == 2
    assert link_data["auto_committed"] == 1


def test_manual_sync_preserves_standard_notification(db_session, monkeypatch):
    """Même avec l'Auto-Pilote actif, un relevé déclenché manuellement conserve la notification classique."""
    cfg = GlobalConfig(key="auto_pilot_enabled", value="true")
    db_session.add(cfg)

    conn = BankConnection(
        label="BoursoBank",
        backend="woob",
        is_active=True
    )
    db_session.add(conn)
    db_session.commit()

    # Mock retournant 0 transaction
    mock_preview = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": []
            }
        ]
    }
    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", lambda **kwargs: mock_preview)

    execute_auto_sync_for_connection(db_session, conn, "test_pw", trigger_source="manual")

    notifs = db_session.query(Notification).all()
    assert len(notifs) == 1
    n = notifs[0]
    # En manuel, conserve la notification classique "Relevé À jour"
    assert n.type == "bank_sync"
    assert "Relevé BoursoBank : À jour" in n.title
    link_data = json.loads(n.link_data)
    assert link_data["view"] == "accounts"


def test_autopilot_disabled_preserves_standard_notification(db_session, monkeypatch):
    """Quand l'Auto-Pilote est désactivé, le relevé automatique génère la notification classique standard."""
    cfg = GlobalConfig(key="auto_pilot_enabled", value="false")
    db_session.add(cfg)

    conn = BankConnection(
        label="Fortuneo",
        backend="woob",
        is_active=True
    )
    db_session.add(conn)
    db_session.commit()

    mock_preview = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": []
            }
        ]
    }
    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", lambda **kwargs: mock_preview)

    execute_auto_sync_for_connection(db_session, conn, "test_pw", trigger_source="scheduled")

    notifs = db_session.query(Notification).all()
    assert len(notifs) == 1
    n = notifs[0]
    assert n.type == "bank_sync"
    assert "Relevé Fortuneo : À jour" in n.title


def test_last_statement_snapshot_store_and_endpoint(db_session):
    """Vérifie la persistance du snapshot du dernier relevé et sa récupération via l'endpoint last-statement."""
    from app.services.bank_sync.pending_store import (
        save_last_statement_snapshot,
        get_last_statement_snapshot,
        _LAST_STATEMENT_SNAPSHOTS
    )
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db

    # S'assurer que le cache mémoire est propre
    _LAST_STATEMENT_SNAPSHOTS.clear()

    statement_payload = {
        "batch_id": "test_batch_123",
        "total_count": 2,
        "auto_reconciled_count": 1,
        "auto_committed_count": 1,
        "pending_count": 0,
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Test",
                "transactions": [
                    {
                        "csv_id": "tx_1",
                        "date_operation": "2026-09-28",
                        "description": "Salaire Test",
                        "amount": 2500.0,
                        "audit_status": "auto_reconciled",
                        "audit_matched_id": 42
                    },
                    {
                        "csv_id": "tx_2",
                        "date_operation": "2026-09-28",
                        "description": "Courses Test",
                        "amount": 45.5,
                        "audit_status": "auto_committed",
                        "audit_created_id": 101
                    }
                ]
            }
        ]
    }

    # Créer une transaction en base pour tester l'enrichissement automatique de catégorie
    tx_db = Transaction(
        id=42,
        csv_id="tx_1",
        date_saisie=date(2026, 9, 28),
        date_operation=date(2026, 9, 28),
        description="Salaire Test",
        amount=2500.0,
        type="income",
        category="Revenus/Salaires",
        to_account_id=1
    )
    db_session.add(tx_db)
    db_session.commit()

    # 1. Sauvegarde du snapshot pour la connexion #7
    save_last_statement_snapshot(db_session, 7, statement_payload, profile_id="default")
    db_session.commit()

    # 2. Récupération directe en Python
    retrieved = get_last_statement_snapshot(db_session, conn_id=7, profile_id="default")
    assert retrieved is not None
    assert retrieved["batch_id"] == "test_batch_123"
    assert retrieved["total_count"] == 2
    assert len(retrieved["accounts"][0]["transactions"]) == 2

    # 3. Test de l'endpoint FastAPI GET /api/bank-sync/last-statement
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        res = client.get("/api/bank-sync/last-statement?conn_id=7")
        assert res.status_code == 200
        data = res.json()
        assert data["batch_id"] == "test_batch_123"
        assert data["conn_id"] == 7
        assert data["auto_reconciled_count"] == 1
        assert data["accounts"][0]["transactions"][0]["audit_status"] == "auto_reconciled"
        # Vérification que la catégorie a bien été enrichie dynamiquement depuis la base
        assert data["accounts"][0]["transactions"][0]["category"] == "Revenus/Salaires"

        # Requête sans conn_id (prend le plus récent)
        res_any = client.get("/api/bank-sync/last-statement")
        assert res_any.status_code == 200
        data_any = res_any.json()
        assert data_any["conn_id"] == 7
    finally:
        app.dependency_overrides.clear()


def test_reconciliation_strict_direction_credit_vs_debit(db_session):
    """Vérifie qu'un crédit bancaire (+81.70€) ne peut jamais matcher une dépense, et qu'un débit (-81.70€) ne peut jamais matcher une recette."""
    from app.services.reconciliation_engine import check_reconciliation

    # Dépense (débit) : Amazon - Bouilloire
    tx_debit = Transaction(
        id=5001,
        date_saisie=date(2026, 9, 21),
        date_operation=date(2026, 9, 22),
        description="Amazon - Bouilloire Cadeau",
        amount=81.70,
        type="expense_var",
        category="Cadeaux",
        from_account_id=1,
        to_account_id=None
    )
    # Recette (crédit) : Remboursement Amazon
    tx_credit = Transaction(
        id=5002,
        date_saisie=date(2026, 9, 28),
        date_operation=date(2026, 9, 25),
        description="Remboursement Amazon",
        amount=81.70,
        type="income",
        category="Remboursement",
        from_account_id=None,
        to_account_id=1
    )
    db_session.add(tx_debit)
    db_session.add(tx_credit)
    db_session.commit()

    # 1. Opération bancaire au CRÉDIT (+81.70)
    match_credit = check_reconciliation(
        db_session,
        tx_date=date(2026, 9, 25),
        tx_amount=81.70,
        account_id=1,
        bank_label="AMAZON PAYMENTS EUROPE S C A AMA"
    )
    assert match_credit is not None
    assert match_credit["id"] == 5002
    assert match_credit["description"] == "Remboursement Amazon"
    assert match_credit["type"] == "income"

    # 2. Opération bancaire au DÉBIT (-81.70)
    match_debit = check_reconciliation(
        db_session,
        tx_date=date(2026, 9, 22),
        tx_amount=-81.70,
        account_id=1,
        bank_label="AMAZON PAYMENTS EUROPE S C A AMA"
    )
    assert match_debit is not None
    assert match_debit["id"] == 5001
    assert match_debit["description"] == "Amazon - Bouilloire Cadeau"
    assert match_debit["type"] == "expense_var"


def test_autopilot_silent_mode_is_read_flag(db_session, monkeypatch):
    """Vérifie le mode silencieux strict :
    - 100% autonome (aucune action manuelle requise) : is_read=True (pas d'alarme/badge cloche)
    - Action attendue (matches > 0 ou new_txs > 0) : is_read=False (badge cloche actif)
    """
    cfg = GlobalConfig(key="auto_pilot_enabled", value="true")
    db_session.add(cfg)

    conn = BankConnection(
        label="Boursorama",
        backend="woob",
        is_active=True
    )
    db_session.add(conn)
    db_session.commit()

    mock_preview = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": []
            }
        ]
    }
    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", lambda **kwargs: mock_preview)

    # Cas 1 : 100% autonome (pending == 0)
    monkeypatch.setattr("app.services.autopilot_service.process_incoming_batch", lambda db, conn_id, preview, profile_id=None: {
        "status": "completed",
        "auto_reconciled": 3,
        "auto_committed": 0,
        "promoted_recurrences": 0,
        "pending": 0,
        "total": 3
    })

    execute_auto_sync_for_connection(db_session, conn, "test_pw", trigger_source="scheduled")

    notif_auto = db_session.query(Notification).filter(Notification.type == "autopilot").order_by(Notification.id.desc()).first()
    assert notif_auto is not None
    assert notif_auto.is_read is True, "Une action 100% autonome doit être marquée lue (is_read=True) pour rester silencieuse"

    # Cas 2 : Action manuelle attendue (nouvelle transaction à classer)
    mock_preview_with_pending = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "csv_id": "tx_new_to_classify",
                        "is_reconciled": False,
                        "is_dismissed": False,
                        "is_auto_dismissed": False,
                        "_excluded": False
                    }
                ]
            }
        ]
    }
    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", lambda **kwargs: mock_preview_with_pending)
    monkeypatch.setattr("app.services.autopilot_service.process_incoming_batch", lambda db, conn_id, preview, profile_id=None: {
        "status": "completed",
        "auto_reconciled": 1,
        "auto_committed": 0,
        "promoted_recurrences": 0,
        "pending": 1,
        "total": 2
    })

    from app.services.bank_sync.pending_store import save_pending_sync_data
    save_pending_sync_data(db_session, conn.id, mock_preview_with_pending, profile_id="default")

    execute_auto_sync_for_connection(db_session, conn, "test_pw", trigger_source="scheduled")

    notif_pending = db_session.query(Notification).filter(Notification.type == "autopilot").order_by(Notification.id.desc()).first()
    assert notif_pending is not None
    assert notif_pending.is_read is False, "Une action nécessitant l'intervention de l'utilisateur doit avoir is_read=False"



