"""
Tests pour le module de synchronisation bancaire (Woob & CredentialVault)
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app as fastapi_app
from app.models import BankConnection, Account, Transaction
from app.services.credential_vault import CredentialVault
from app.services.bank_sync_service import get_all_bank_backends


def test_credential_vault_lifecycle():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    conn_id = 99
    creds = {"login": "user123", "password": "password456", "website": "www.ca-centrest.fr"}
    master_pw = "SuperMasterKey_2026!"

    # 1. Chiffrement
    assert CredentialVault.store_credentials(db, conn_id, creds, master_pw)
    assert CredentialVault.has_credentials(db, conn_id)

    # 2. Déchiffrement réussi
    decrypted = CredentialVault.retrieve_credentials(db, conn_id, master_pw)
    assert decrypted == creds

    # 3. Échec avec mauvais mot de passe
    assert CredentialVault.retrieve_credentials(db, conn_id, "BadPassword") is None

    # 4. Suppression
    assert CredentialVault.delete_credentials(db, conn_id)
    assert not CredentialVault.has_credentials(db, conn_id)


def test_backend_discovery():
    backends = get_all_bank_backends()
    assert len(backends) >= 50
    backend_names = [b.name for b in backends]
    assert "cragr" in backend_names
    assert "boursorama" in backend_names


@pytest.fixture(autouse=True)
def setup_test_db():
    from sqlalchemy.pool import StaticPool
    import app.models  # Ensure all models are registered in Base.metadata
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db
    yield
    fastapi_app.dependency_overrides.clear()


def test_bank_connections_api():
    client = TestClient(fastapi_app)

    # 1. Backends list
    res = client.get("/api/bank-sync/backends")
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 50

    # 2. Create connection
    payload = {
        "backend": "cragr",
        "label": "Mon Crédit Agricole Test",
        "master_password": "TestPassword_123",
        "credentials": {
            "login": "04113708641",
            "password": "secret",
            "website": "www.ca-centrest.fr"
        }
    }
    create_res = client.post("/api/bank-sync/connections", json=payload)
    assert create_res.status_code == 200
    conn_data = create_res.json()
    conn_id = conn_data["id"]
    assert conn_data["label"] == "Mon Crédit Agricole Test"
    assert conn_data["has_credentials"] is True
    # Zéro mot de passe exposé dans la réponse !
    assert "password" not in conn_data
    assert "credentials" not in conn_data

    # 3. List connections
    list_res = client.get("/api/bank-sync/connections")
    assert list_res.status_code == 200
    conns = list_res.json()
    assert any(c["id"] == conn_id for c in conns)

    # 4. Update mapping
    update_res = client.put(f"/api/bank-sync/connections/{conn_id}", json={
        "account_mapping": {"04113708641": 1}
    })
    assert update_res.status_code == 200

    # 5. Delete connection
    del_res = client.delete(f"/api/bank-sync/connections/{conn_id}")
    assert del_res.status_code == 200


def test_vault_session_manager_and_unlock():
    from app.services.credential_vault import VaultSessionManager
    client = TestClient(fastapi_app)

    # 1. Lock / Status initial
    VaultSessionManager.lock_session()
    status = VaultSessionManager.get_status()
    assert status["is_unlocked"] is False

    # 2. Unlock via API
    unlock_res = client.post("/api/bank-sync/vault/unlock", json={
        "master_password": "MyMasterKey123!",
        "remember_days": 5
    })
    assert unlock_res.status_code == 200
    data = unlock_res.json()
    assert data["ok"] is True
    assert data["is_unlocked"] is True
    assert data["remaining_days"] == 5
    token = data["vault_token"]

    # 3. Status with token
    status_res = client.get(f"/api/bank-sync/vault/status?token={token}")
    assert status_res.status_code == 200
    assert status_res.json()["is_unlocked"] is True

    # 4. Password retrieval
    assert VaultSessionManager.get_password(token) == "MyMasterKey123!"

    # 5. Lock
    lock_res = client.post(f"/api/bank-sync/vault/lock?token={token}")
    assert lock_res.status_code == 200
    assert VaultSessionManager.get_status(token)["is_unlocked"] is False


def test_auto_sync_settings_and_pending():
    client = TestClient(fastapi_app)

    # 1. Get settings
    res = client.get("/api/bank-sync/settings/auto-sync")
    assert res.status_code == 200
    assert "enabled" in res.json()
    assert "interval_hours" in res.json()

    # 2. Update settings
    post_res = client.post("/api/bank-sync/settings/auto-sync", json={
        "enabled": True,
        "interval_hours": 12
    })
    assert post_res.status_code == 200

    # 3. Verify update
    res2 = client.get("/api/bank-sync/settings/auto-sync")
    assert res2.json()["enabled"] is True
    assert res2.json()["interval_hours"] == 12

    # 4. Get pending sync
    pending_res = client.get("/api/bank-sync/pending")
    assert pending_res.status_code == 200
    pdata = pending_res.json()
    assert "total_matches" in pdata
    assert "total_new" in pdata
    assert "matches_by_tx_id" in pdata

    # 5. Trigger manual auto sync while locked -> 401
    from app.services.credential_vault import VaultSessionManager
    VaultSessionManager.lock_session()
    locked_res = client.post("/api/bank-sync/trigger-auto-sync", json={})
    assert locked_res.status_code == 401

    # 6. Trigger manual auto sync with explicit password -> 200
    success_res = client.post("/api/bank-sync/trigger-auto-sync", json={"master_password": "TestPassword"})
    assert success_res.status_code == 200
    assert success_res.json()["ok"] is True

    # 7. Check error notification creation via execute_auto_sync_for_connection
    from app.services.bank_sync_scheduler import execute_auto_sync_for_connection
    from app.models import Notification
    # Create dummy connection in test db
    test_db = next(fastapi_app.dependency_overrides[get_db]())
    test_conn = BankConnection(backend="cragr", label="Test CA Error", is_active=True)
    test_db.add(test_conn)
    test_db.commit()
    test_db.refresh(test_conn)

    # Calling with bad password creates error notification
    execute_auto_sync_for_connection(test_db, test_conn, "bad_pw")
    notifs = test_db.query(Notification).filter(Notification.type == "bank_sync_error").all()
    assert len(notifs) >= 1
    assert "Échec relevé" in notifs[0].title


def test_ghost_rows_endpoints_lifecycle():
    from app.services.bank_sync_scheduler import _PENDING_SYNC_DATA, save_pending_sync_data
    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    # 1. Create a bank connection and an account
    conn = BankConnection(backend="boursorama", label="Boursorama Test", is_active=True)
    acc = Account(name="Compte Courant Test", initial_balance=1000.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 2. Populate _PENDING_SYNC_DATA with 3 ghost transactions
    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "connection_id": conn.id,
                "transactions": [
                    {
                        "csv_id": "ghost_tx_001",
                        "description": "Supermarché Bio",
                        "amount": 42.50,
                        "raw_amount": -42.50,
                        "date_operation": "2026-08-15",
                        "category": "Alimentation",
                        "account_id": acc.id,
                        "is_reconciled": False
                    },
                    {
                        "csv_id": "ghost_tx_002",
                        "description": "Facture Electricite",
                        "amount": 80.00,
                        "raw_amount": -80.00,
                        "date_operation": "2026-08-16",
                        "category": "Logement",
                        "account_id": acc.id,
                        "is_reconciled": False
                    },
                    {
                        "csv_id": "ghost_tx_003",
                        "description": "Virement Remboursement",
                        "amount": 120.00,
                        "raw_amount": 120.00,
                        "date_operation": "2026-08-17",
                        "category": "Revenus",
                        "account_id": acc.id,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, preview_data)

    # 3. Check pending endpoint returns 3 new
    res_pending = client.get("/api/bank-sync/pending")
    assert res_pending.status_code == 200
    pdata = res_pending.json()
    assert pdata["total_new"] == 3

    # 4. Commit single ghost (ghost_tx_001)
    res_commit_single = client.post("/api/bank-sync/commit-ghost", json={
        "connection_id": conn.id,
        "transaction": {
            "csv_id": "ghost_tx_001",
            "description": "Supermarché Bio Validé",
            "amount": 42.50,
            "raw_amount": -42.50,
            "date_operation": "2026-08-15",
            "category": "Alimentation",
            "account_id": acc.id,
            "is_reconciled": False
        }
    })
    assert res_commit_single.status_code == 200
    assert res_commit_single.json()["ok"] is True

    # Verify transaction is in database
    tx1 = test_db.query(Transaction).filter(Transaction.csv_id == "ghost_tx_001").first()
    assert tx1 is not None
    assert tx1.description == "Supermarché Bio Validé"
    assert tx1.reconciliation_date is not None

    # Check pending count decreased to 2
    res_pending2 = client.get("/api/bank-sync/pending")
    assert res_pending2.json()["total_new"] == 2

    # 5. Dismiss single ghost (ghost_tx_002)
    res_dismiss = client.post("/api/bank-sync/dismiss-ghost/ghost_tx_002")
    assert res_dismiss.status_code == 200
    assert res_dismiss.json()["dismissed"] is True

    # Verify ghost_tx_002 was NOT saved in database
    tx2 = test_db.query(Transaction).filter(Transaction.csv_id == "ghost_tx_002").first()
    assert tx2 is None

    # Check pending count decreased to 1
    res_pending3 = client.get("/api/bank-sync/pending")
    assert res_pending3.json()["total_new"] == 1

    # 6. Commit all remaining ghosts (ghost_tx_003)
    res_commit_all = client.post("/api/bank-sync/commit-all-ghosts")
    assert res_commit_all.status_code == 200
    assert res_commit_all.json()["committed_count"] == 1

    # Verify ghost_tx_003 is in database
    tx3 = test_db.query(Transaction).filter(Transaction.csv_id == "ghost_tx_003").first()
    assert tx3 is not None
    assert tx3.type == "income"
    assert tx3.reconciliation_date is not None

    # Check pending count is now 0
    res_pending4 = client.get("/api/bank-sync/pending")
    assert res_pending4.json()["total_new"] == 0


def test_vault_multi_profile_isolation():
    """Vérifie l'isolation stricte des sessions de coffre-fort entre profils distincts."""
    from app.services.credential_vault import VaultSessionManager

    # Nettoyage initial
    VaultSessionManager.lock_session(profile_id="profile_a")
    VaultSessionManager.lock_session(profile_id="profile_b")

    # 1. Déverrouiller Profile A
    token_a = VaultSessionManager.create_session("Password_A_123!", duration_days=7, profile_id="profile_a")
    assert token_a is not None
    assert VaultSessionManager.is_unlocked(profile_id="profile_a") is True

    # 2. Profile B doit impérativement être verrouillé
    assert VaultSessionManager.is_unlocked(profile_id="profile_b") is False
    assert VaultSessionManager.get_password(profile_id="profile_b") is None

    # 3. Le token de Profile A ne doit JAMAIS donner accès au mot de passe de Profile B
    assert VaultSessionManager.get_password(token=token_a, profile_id="profile_b") is None
    status_b_with_token_a = VaultSessionManager.get_status(token=token_a, profile_id="profile_b")
    assert status_b_with_token_a["is_unlocked"] is False

    # 4. Déverrouiller Profile B avec un mot de passe indépendant
    token_b = VaultSessionManager.create_session("Password_B_456!", duration_days=3, profile_id="profile_b")
    assert token_b is not None
    assert VaultSessionManager.is_unlocked(profile_id="profile_b") is True

    # 5. Chaque profil récupère uniquement son propre mot de passe maître
    assert VaultSessionManager.get_password(token=token_a, profile_id="profile_a") == "Password_A_123!"
    assert VaultSessionManager.get_password(token=token_b, profile_id="profile_b") == "Password_B_456!"
    assert VaultSessionManager.get_password(profile_id="profile_a") == "Password_A_123!"
    assert VaultSessionManager.get_password(profile_id="profile_b") == "Password_B_456!"

    # 6. Verrouiller Profile A ne doit pas impacter Profile B
    VaultSessionManager.lock_session(profile_id="profile_a")
    assert VaultSessionManager.is_unlocked(profile_id="profile_a") is False
    assert VaultSessionManager.is_unlocked(profile_id="profile_b") is True
    assert VaultSessionManager.get_password(profile_id="profile_b") == "Password_B_456!"

    # 7. Verrouiller Profile B
    VaultSessionManager.lock_session(profile_id="profile_b")
    assert VaultSessionManager.is_unlocked(profile_id="profile_b") is False






