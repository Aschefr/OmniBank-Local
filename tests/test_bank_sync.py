"""
Tests pour le module de synchronisation bancaire (Woob & CredentialVault)
"""

import pytest
from datetime import date
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
    from app.database import _configure_sqlite_pragmas
    import app.models  # Ensure all models are registered in Base.metadata
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    _configure_sqlite_pragmas(engine)
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


def test_auto_sync_notification_coming_distinction(monkeypatch):
    """Vérifie qu'une synchronisation automatique distinguant 1 op à rapprocher et 1 op en attente génère le bon libellé."""
    import json
    from app.services.bank_sync_scheduler import execute_auto_sync_for_connection
    from app.services.bank_sync_service import BankSyncService
    from app.models import Notification

    test_db = next(fastapi_app.dependency_overrides[get_db]())
    conn = BankConnection(backend="cragr", label="Crédit Agricole Test", is_active=True)
    test_db.add(conn)
    test_db.commit()
    test_db.refresh(conn)

    mock_preview = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "date_operation": "2026-08-28",
                        "description": "Opération Confirmée",
                        "amount": 50.0,
                        "raw_amount": -50.0,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 101,
                        "is_coming": False
                    },
                    {
                        "date_operation": "2026-08-29",
                        "description": "Paiement Carte En Attente",
                        "amount": 25.0,
                        "raw_amount": -25.0,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": 102,
                        "is_coming": True
                    },
                    {
                        "date_operation": "2026-08-30",
                        "description": "Nouvelle transaction",
                        "amount": 10.0,
                        "raw_amount": -10.0,
                        "is_reconciled": False,
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", lambda **kwargs: mock_preview)

    execute_auto_sync_for_connection(test_db, conn, "dummy_pw")

    notif = test_db.query(Notification).filter(
        Notification.type == "bank_sync",
        Notification.title.contains("Crédit Agricole Test")
    ).order_by(Notification.id.desc()).first()

    assert notif is not None
    assert "1 opération à rapprocher" in notif.content
    assert "1 opération en attente" in notif.content
    assert "1 nouvelle opération" in notif.content
    assert "pointer" not in notif.content.lower()

    link_data = json.loads(notif.link_data)
    assert link_data["matches"] == 1
    assert link_data["coming"] == 1
    assert link_data["new_txs"] == 1



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


def test_coming_transactions_workflow():
    """Vérifie le cycle de vie des opérations bancaires à venir (is_coming)."""
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync
    from app.services.bank_sync_service import BankSyncService

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test CA Coming", is_active=True)
    acc = Account(name="Compte Courant Coming Test", initial_balance=500.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. Simuler des données de preview avec une opération à venir
    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "connection_id": conn.id,
                "transactions": [
                    {
                        "csv_id": "woob_coming_cragr_01_abc123",
                        "description": "CB Station Service En Attente",
                        "amount": 55.00,
                        "raw_amount": -55.00,
                        "date_operation": "2026-08-22",
                        "category": "Transports",
                        "account_id": acc.id,
                        "is_reconciled": False,
                        "is_coming": True
                    }
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, preview_data)

    # 2. Vérifier que get_all_pending_sync la renvoie avec is_coming=True et dans total_new
    pending = get_all_pending_sync(test_db)
    assert pending["total_new"] == 1
    assert pending["total_matches"] == 0
    tx_pending = pending["accounts"][0]["transactions"][0]
    assert tx_pending["is_coming"] is True
    assert tx_pending["is_reconciled"] is False

    # 3. Valider l'opération fantôme à venir via l'API commit-ghost
    res_commit = client.post("/api/bank-sync/commit-ghost", json={
        "connection_id": conn.id,
        "transaction": tx_pending
    })
    assert res_commit.status_code == 200

    # 4. Vérifier en base : l'opération doit impérativement avoir reconciliation_date à None
    saved_tx = test_db.query(Transaction).filter(Transaction.csv_id == "woob_coming_cragr_01_abc123").first()
    assert saved_tx is not None
    assert saved_tx.amount == 55.00
    assert saved_tx.type == "expense_var"
    assert saved_tx.reconciliation_date is None, "Une opération à venir doit être insérée sans date de rapprochement"


def test_coming_transaction_state_discrepancy():
    """
    Vérifie la détection d'une discordance d'état (opération pointée en local dans OmniBank
    mais trouvée dans les opérations à venir / en attente de la banque en ligne).
    """
    from datetime import date
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync

    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test CA Discrepancy", is_active=True)
    acc = Account(name="Compte Courant Discrepancy Test", initial_balance=800.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. Créer une transaction déjà pointée en local dans OmniBank
    local_reconciled_tx = Transaction(
        description="Plein Essence Reconciled Local",
        amount=45.00,
        type="expense_var",
        date_saisie=date(2026, 8, 22),
        date_operation=date(2026, 8, 22),
        reconciliation_date=date(2026, 8, 22),
        from_account_id=acc.id,
        created_by="Manuel"
    )
    test_db.add(local_reconciled_tx)
    test_db.commit()
    test_db.refresh(local_reconciled_tx)

    # 2. Simuler une opération à venir reçue de la banque (is_coming = True)
    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "connection_id": conn.id,
                "transactions": [
                    {
                        "csv_id": "woob_coming_discrepancy_001",
                        "description": "CB Station Carburant En Attente",
                        "amount": 45.00,
                        "raw_amount": -45.00,
                        "date_operation": "2026-08-22",
                        "category": "Transports",
                        "account_id": acc.id,
                        "is_reconciled": False,
                        "is_coming": True
                    }
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, preview_data)

    # 3. get_all_pending_sync doit détecter que la transaction est déjà rapprochée en base mais is_coming = True
    pending = get_all_pending_sync(test_db)
    assert pending["total_discrepancies"] == 1
    assert local_reconciled_tx.id in pending["discrepancies_by_tx_id"]
    disc_info = pending["discrepancies_by_tx_id"][local_reconciled_tx.id]
    assert disc_info["is_coming"] is True
    assert disc_info["already_reconciled"] is True
    assert disc_info["matched_db_id"] == local_reconciled_tx.id


def test_bank_balance_reconciliation_and_delta_indicators():
    """
    Vérifie la transmission du solde bancaire réel (bank_balance), le calcul du solde local pointé
    (local_reconciled_balance), et le comportement face à un écart de solde dans get_all_pending_sync.
    """
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync

    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test CA Balance", is_active=True)
    acc = Account(name="Compte Test Balance", initial_balance=1000.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. Simuler des données de sync où la banque indique un solde de 950.0€
    # et il y a une opération fantôme de -50.0€ (qui comble exactement l'écart).
    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "connection_id": conn.id,
                "bank_balance": 950.00,
                "local_reconciled_balance": 1000.00,
                "transactions": [
                    {
                        "csv_id": "woob_cragr_delta_tx_50",
                        "description": "Abonnement Internet",
                        "amount": 50.00,
                        "raw_amount": -50.00,
                        "date_operation": "2026-08-22",
                        "category": "Abonnements",
                        "account_id": acc.id,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, preview_data)

    # 2. Vérifier que get_all_pending_sync retourne bank_balance et recalcule local_reconciled_balance
    pending = get_all_pending_sync(test_db)
    assert len(pending["accounts"]) == 1
    acc_out = pending["accounts"][0]
    assert acc_out["bank_balance"] == 950.00
    assert acc_out["local_reconciled_balance"] == 1000.00

    # Delta calculé = bank_balance - local_reconciled_balance = -50.00
    delta = round(acc_out["bank_balance"] - acc_out["local_reconciled_balance"], 2)
    assert delta == -50.00

    # L'opération fantôme de -50.00 comble exactement l'écart
    ghost_tx = acc_out["transactions"][0]
    assert ghost_tx["raw_amount"] == delta


def test_orphan_internal_transfer_auto_linking():
    """
    Vérifie que lorsqu'un compte B synchronise un virement vers un compte A,
    et qu'une écriture de crédit isolée du même montant existait déjà sur A,
    le système détecte le virement orphelin (is_orphan_transfer_link=True)
    et fusionne les écritures en un virement interne sans créer de doublon.
    """
    from datetime import date
    from app.services.bank_sync_service import BankSyncService
    from app.routers.csv_parser import check_reconciliation

    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn_b = BankConnection(backend="boursorama", label="Boursorama AutoLink", is_active=True)
    acc_a = Account(name="CA Centre Est AutoLink", initial_balance=500.0)
    acc_b = Account(name="Boursorama Business AutoLink", initial_balance=1000.0)
    test_db.add_all([conn_b, acc_a, acc_b])
    test_db.commit()
    test_db.refresh(conn_b)
    test_db.refresh(acc_a)
    test_db.refresh(acc_b)

    # 1. Créer une écriture de crédit isolée existante sur le compte A (ex: +600 €)
    orphan_credit = Transaction(
        date_saisie=date(2026, 8, 4),
        date_operation=date(2026, 8, 4),
        description="Transfert de Amify Studio",
        amount=600.0,
        type="income",
        from_account_id=None,
        to_account_id=acc_a.id,
        reconciliation_date=date(2026, 8, 4)
    )
    test_db.add(orphan_credit)
    test_db.commit()
    test_db.refresh(orphan_credit)

    # 2. Vérifier que check_reconciliation pour un débit de -600 € sur le compte B détecte l'orphelin sur le compte A
    rec_info = check_reconciliation(
        test_db,
        tx_date=date(2026, 8, 4),
        tx_amount=-600.0,
        account_id=acc_b.id
    )
    assert rec_info is not None
    assert rec_info.get("is_orphan_transfer_link") is True
    assert rec_info["id"] == orphan_credit.id
    assert rec_info["orphan_account_id"] == acc_a.id

    # 3. Exécuter commit_reviewed_transactions avec l'opération de Boursorama
    items = [
        {
            "account_id": acc_b.id,
            "date_operation": "2026-08-04",
            "description": "Virement vers CA Centre Est",
            "amount": 600.0,
            "raw_amount": -600.0,
            "is_reconciled": True,
            "is_orphan_transfer_link": True,
            "matched_db_id": orphan_credit.id,
            "category": "Virements internes"
        }
    ]
    res = BankSyncService.commit_reviewed_transactions(
        db=test_db,
        connection_id=conn_b.id,
        transactions_data=items
    )
    assert res["reconciled"] == 1
    assert res["imported"] == 0

    # 4. Vérifier en base : l'écriture initiale a été mise à jour en virement interne (from=B, to=A)
    # et AUCUNE nouvelle transaction n'a été créée !
    test_db.refresh(orphan_credit)
    assert orphan_credit.type == "transfer"
    assert orphan_credit.from_account_id == acc_b.id
    assert orphan_credit.to_account_id == acc_a.id
    assert orphan_credit.reconciliation_date is not None

    total_txs_a = test_db.query(Transaction).filter(
        (Transaction.from_account_id == acc_a.id) | (Transaction.to_account_id == acc_a.id)
    ).count()
    assert total_txs_a == 1, "Le compte A ne doit avoir qu'une SEULE transaction de 600 €, pas deux !"


def test_coming_transaction_reconcile_and_unreconcile_continuity():
    """
    Vérifie la continuité d'état complète lors du cycle :
    1. Opération à venir détectée (is_coming = True) -> badge 'À venir' (total_matches = 1).
    2. Pointage en 1 clic (/reconcile-fast/{id}) -> rapprochée, bascule en discordance d'état (total_discrepancies = 1).
    3. Dépointage (/toggle_reconciliation) -> revient immédiatement à l'état 'À venir' sans discontinuité !
    """
    from datetime import date
    from fastapi.testclient import TestClient
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test CA Continuity", is_active=True)
    acc = Account(name="Compte Test Continuity", initial_balance=500.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. Transaction locale non rapprochée dans OmniBank
    local_tx = Transaction(
        description="Achat Magasin Local",
        amount=30.00,
        type="expense_var",
        date_saisie=date(2026, 8, 23),
        date_operation=date(2026, 8, 23),
        reconciliation_date=None,
        from_account_id=acc.id,
        created_by="Manuel"
    )
    test_db.add(local_tx)
    test_db.commit()
    test_db.refresh(local_tx)

    # 2. Opération à venir reçue de la banque (is_coming = True)
    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "connection_id": conn.id,
                "transactions": [
                    {
                        "csv_id": "woob_coming_continuity_001",
                        "description": "CB Achat Magasin En Attente",
                        "amount": 30.00,
                        "raw_amount": -30.00,
                        "date_operation": "2026-08-23",
                        "category": "Alimentation",
                        "account_id": acc.id,
                        "is_reconciled": False,
                        "is_coming": True
                    }
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, preview_data)

    # ÉTAPE 1 : État initial -> Correspondance trouvée pour opération à venir
    pending1 = get_all_pending_sync(test_db)
    assert pending1["total_matches"] == 1
    assert pending1["total_discrepancies"] == 0
    assert local_tx.id in pending1["matches_by_tx_id"]
    assert pending1["matches_by_tx_id"][local_tx.id]["is_coming"] is True

    # ÉTAPE 2 : Pointage rapide via API /reconcile-fast/{id}
    res_rec = client.post(f"/api/bank-sync/reconcile-fast/{local_tx.id}")
    assert res_rec.status_code == 200
    test_db.refresh(local_tx)
    assert local_tx.reconciliation_date is not None

    # Vérifier l'état pending après pointage -> Bascule en discordance d'état
    pending2 = get_all_pending_sync(test_db)
    assert pending2["total_matches"] == 0
    assert pending2["total_discrepancies"] == 1
    assert local_tx.id in pending2["discrepancies_by_tx_id"]

    # ÉTAPE 3 : Annulation du pointage via API /toggle_reconciliation
    res_unrec = client.post(f"/api/transactions/{local_tx.id}/toggle_reconciliation")
    assert res_unrec.status_code == 200
    test_db.refresh(local_tx)
    assert local_tx.reconciliation_date is None

    # Vérifier l'état pending après dépointage -> Revient immédiatement à l'état 'À venir' !
    pending3 = get_all_pending_sync(test_db)
    assert pending3["total_matches"] == 1
    assert pending3["total_discrepancies"] == 0
    assert local_tx.id in pending3["matches_by_tx_id"]
    assert pending3["matches_by_tx_id"][local_tx.id]["is_coming"] is True


def test_reconcile_all_pending_skips_coming_operations():
    """
    Vérifie que le pointage en lot (reconcile-all-pending) ne pointe QUE les opérations
    confirmées/imputées et préserve les opérations à venir (is_coming = True).
    """
    from datetime import date
    from fastapi.testclient import TestClient
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test CA Batch Coming", is_active=True)
    acc = Account(name="Compte Test Batch Coming", initial_balance=500.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. Opération confirmée
    tx_confirmed = Transaction(
        description="Achat Confirmé Reçu",
        amount=50.00,
        type="expense_var",
        date_saisie=date(2026, 8, 20),
        date_operation=date(2026, 8, 20),
        reconciliation_date=None,
        from_account_id=acc.id,
        created_by="Manuel"
    )
    # 2. Opération à venir
    tx_coming = Transaction(
        description="Abonnement A Venir",
        amount=15.00,
        type="expense_var",
        date_saisie=date(2026, 8, 25),
        date_operation=date(2026, 8, 25),
        reconciliation_date=None,
        from_account_id=acc.id,
        created_by="Manuel"
    )
    test_db.add_all([tx_confirmed, tx_coming])
    test_db.commit()
    test_db.refresh(tx_confirmed)
    test_db.refresh(tx_coming)

    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "connection_id": conn.id,
                "transactions": [
                    {
                        "csv_id": "woob_confirmed_001",
                        "description": "Achat Confirmé Relevé",
                        "amount": 50.00,
                        "raw_amount": -50.00,
                        "date_operation": "2026-08-20",
                        "category": "Achats",
                        "account_id": acc.id,
                        "is_reconciled": False,
                        "is_coming": False
                    },
                    {
                        "csv_id": "woob_coming_002",
                        "description": "Abonnement A Venir Banque",
                        "amount": 15.00,
                        "raw_amount": -15.00,
                        "date_operation": "2026-08-25",
                        "category": "Services",
                        "account_id": acc.id,
                        "is_reconciled": False,
                        "is_coming": True
                    }
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, preview_data)

    pending = get_all_pending_sync(test_db)
    assert pending["total_matches"] == 2
    assert pending["total_confirmed_matches"] == 1
    assert pending["total_coming_matches"] == 1

    # Déclencher le pointage en lot
    res = client.post("/api/bank-sync/reconcile-all-pending")
    assert res.status_code == 200
    assert res.json()["reconciled_count"] == 1

    test_db.refresh(tx_confirmed)
    test_db.refresh(tx_coming)

    # La confirmée est pointée
    assert tx_confirmed.reconciliation_date is not None
    # L'opération à venir reste non pointée
    assert tx_coming.reconciliation_date is None


def test_commit_reviewed_sync_preserves_coming_operations_unreconciled():
    """
    Vérifie que la validation dans la modale de revue (POST /api/bank-sync/connections/{conn_id}/commit)
    ne pointe PAS les opérations 'en attente' (is_coming = True), même si elles matchent une opération en base.
    """
    from datetime import date
    from fastapi.testclient import TestClient

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test Commit Coming", is_active=True)
    acc = Account(name="Compte Test Commit Coming", initial_balance=1000.0)
    test_db.add_all([conn, acc])
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. Opération existante locale prévue / non pointée
    local_tx = Transaction(
        description="Google One Abonnement IA+ 5To",
        amount=21.99,
        type="expense_fix",
        category="Abonnements",
        date_saisie=date(2026, 8, 24),
        date_operation=date(2026, 8, 26),
        reconciliation_date=None,
        from_account_id=acc.id,
        created_by="Manuel"
    )
    test_db.add(local_tx)
    test_db.commit()
    test_db.refresh(local_tx)

    # 2. Payload envoyé par la modale de revue avec is_coming = True
    commit_payload = {
        "transactions": [
            {
                "account_id": acc.id,
                "date_operation": "2026-08-24",
                "description": "X1208 Google One Dublin",
                "raw_description": "X1208 Google One Dublin",
                "amount": 21.99,
                "raw_amount": -21.99,
                "category": "Abonnements",
                "csv_id": "google_coming_001",
                "is_reconciled": True,
                "already_reconciled": False,
                "matched_db_id": local_tx.id,
                "is_coming": True
            }
        ]
    }

    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync

    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "connection_id": conn.id,
                "transactions": [
                    {
                        "csv_id": "google_coming_001",
                        "description": "X1208 Google One Dublin",
                        "amount": 21.99,
                        "raw_amount": -21.99,
                        "date_operation": "2026-08-24",
                        "category": "Abonnements",
                        "account_id": acc.id,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": local_tx.id,
                        "is_coming": True
                    }
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, preview_data)

    res = client.post(f"/api/bank-sync/connections/{conn.id}/commit", json=commit_payload)
    assert res.status_code == 200
    res_data = res.json()
    assert res_data["reconciled"] == 0

    test_db.refresh(local_tx)
    # L'opération locale ne doit PAS avoir de date de pointage
    assert local_tx.reconciliation_date is None
    # La catégorie peut être mise à jour
    assert local_tx.category == "Abonnements"

    # Vérifier que l'opération à venir reste mémorisée dans le sas
    pending_after = get_all_pending_sync(test_db)
    assert pending_after["total_coming_matches"] == 1
    assert local_tx.id in pending_after["matches_by_tx_id"]
    assert pending_after["matches_by_tx_id"][local_tx.id]["is_coming"] is True


def test_link_ghost_preserves_coming_unreconciled():
    """
    Vérifie que la liaison d'un fantôme 'à venir' (is_coming = True) ne force pas la date de pointage.
    """
    from datetime import date
    from fastapi.testclient import TestClient

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Compte Test Link Coming", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    local_tx = Transaction(
        description="Achat Futur en attente",
        amount=45.00,
        type="expense_var",
        category="Divers",
        date_saisie=date(2026, 8, 25),
        date_operation=date(2026, 8, 28),
        reconciliation_date=None,
        from_account_id=acc.id,
        created_by="Manuel"
    )
    test_db.add(local_tx)
    test_db.commit()
    test_db.refresh(local_tx)

    link_payload = {
        "csv_id": "ghost_coming_link_123",
        "target_tx_id": local_tx.id,
        "description": "Achat Futur en attente (Banque)",
        "amount": 45.00,
        "category": "Divers",
        "is_coming": True,
        "reconciliation_date": None
    }

    res = client.post("/api/bank-sync/link-ghost", json=link_payload)
    assert res.status_code == 200
    assert res.json()["reconciliation_date"] is None

    test_db.refresh(local_tx)
    assert local_tx.reconciliation_date is None
    assert local_tx.description == "Achat Futur en attente (Banque)"
    assert local_tx.csv_id == "ghost_coming_link_123"


def test_re_evaluate_preview_endpoint_live_db_changes():
    """
    Vérifie que l'endpoint POST /api/bank-sync/re-evaluate-preview re-calcule
    dynamiquement le statut de réconciliation en temps réel quand une opération
    est supprimée ou ajoutée en base SQLite.
    """
    from datetime import date
    from app.database import get_db
    test_db = next(fastapi_app.dependency_overrides[get_db]())
    client = TestClient(fastapi_app)

    acc = Account(name="Compte Courant Test", type="checking", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # 1. Créer une transaction en base
    tx_in_db = Transaction(
        from_account_id=acc.id,
        date_operation=date(2026, 8, 23),
        date_saisie=date(2026, 8, 23),
        amount=2.67,
        type="expense_var",
        description="X1208 GOULINOU LES AVENIER",
        reconciliation_date=date(2026, 8, 23)
    )
    test_db.add(tx_in_db)
    test_db.commit()
    test_db.refresh(tx_in_db)

    # Données d'aperçu initial (simulant le cache)
    cached_preview = {
        "connection_id": 1,
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "bank_balance": 1000.0,
                "transactions": [
                    {
                        "csv_id": "tx_goulinou_1",
                        "date_operation": "2026-08-23",
                        "raw_amount": -2.67,
                        "amount": 2.67,
                        "description": "X1208 GOULINOU LES AVENIER",
                        "is_coming": True,
                        "is_reconciled": True,
                        "matched_db_id": tx_in_db.id
                    }
                ]
            }
        ]
    }

    # Premier appel : la transaction est bien rapprochée
    res1 = client.post("/api/bank-sync/re-evaluate-preview", json=cached_preview)
    assert res1.status_code == 200
    data1 = res1.json()
    t1 = data1["accounts"][0]["transactions"][0]
    assert t1["is_reconciled"] is True
    assert t1["matched_db_id"] == tx_in_db.id

    # 2. L'utilisateur supprime la transaction de sa DB locale
    test_db.delete(tx_in_db)
    test_db.commit()

    # Deuxième appel avec le même JSON de cache :
    # La réévaluation détecte automatiquement l'absence de l'opération en base !
    res2 = client.post("/api/bank-sync/re-evaluate-preview", json=cached_preview)
    assert res2.status_code == 200
    data2 = res2.json()
    t2 = data2["accounts"][0]["transactions"][0]
    assert t2["is_reconciled"] is False
    assert t2["matched_db_id"] is None
    assert t2["is_coming"] is True


def test_ghost_commit_coming_preserves_unreconciled_state():
    """
    Cas 1 : Vérifie qu'une opération fantôme en attente en ligne (is_coming = True)
    ajoutée en base via /commit-ghost n'a PAS de date de rapprochement d'office
    (reconciliation_date doit rester None).
    """
    from datetime import date
    from fastapi.testclient import TestClient

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test Ghost Coming", is_active=True)
    acc = Account(name="Compte Test Ghost Coming", initial_balance=1000.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. Envoi d'un commit-ghost pour une opération coming
    payload = {
        "connection_id": conn.id,
        "transaction": {
            "csv_id": "woob_coming_ghost_test_123",
            "description": "Abonnement Service X",
            "raw_description": "X1208 ABONNEMENT SERVICE X",
            "amount": 15.99,
            "raw_amount": -15.99,
            "date_operation": "2026-08-23",
            "category": "Abonnements",
            "account_id": acc.id,
            "is_reconciled": False,
            "is_coming": True,
            "reconciliation_date": None
        }
    }

    res = client.post("/api/bank-sync/commit-ghost", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True

    # 2. Vérification en base : l'opération a bien été créée SANS date de rapprochement
    saved_tx = test_db.query(Transaction).filter(Transaction.csv_id == "woob_coming_ghost_test_123").first()
    assert saved_tx is not None
    assert saved_tx.amount == 15.99
    assert saved_tx.description == "Abonnement Service X"
    assert saved_tx.reconciliation_date is None, "Une opération en attente en ligne ajoutée en base ne doit pas avoir de date de rapprochement !"


def test_two_pass_matching_same_amount_confirmed_and_coming():
    """
    Cas 2 : Si plusieurs opérations de même montant sont présentes (ex: 25.99 € Google One),
    l'une passée et déjà pointée (date_op=10/08, recon=20/08), l'autre future/non pointée (date_op=23/08).
    Vérifie que :
    - La transaction bancaire confirmée du 10/08 matche l'opération déjà pointée du 10/08 (already_reconciled=True).
    - La transaction bancaire en attente (coming) du 23/08 matche la prédiction du 23/08 (already_reconciled=False, À pointer).
    - Aucune inversion ni fausse discordance d'état ne se produit.
    """
    from datetime import date
    from fastapi.testclient import TestClient

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test Matching Same Amount", is_active=True)
    acc = Account(name="Compte Test Multi Amount", initial_balance=2000.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. En base locale :
    # Opération 1 : passée le 10/08, pointée le 20/08
    tx_past = Transaction(
        description="Google One Crédits IA",
        amount=25.99,
        type="expense_var",
        category="IA",
        date_operation=date(2026, 8, 10),
        reconciliation_date=date(2026, 8, 20),
        from_account_id=acc.id
    )
    # Opération 2 : prévue le 23/08, non pointée (prédiction)
    tx_planned = Transaction(
        description="Google One Crédits IA",
        amount=25.99,
        type="expense_var",
        category="IA",
        date_operation=date(2026, 8, 23),
        reconciliation_date=None,
        from_account_id=acc.id
    )
    test_db.add(tx_past)
    test_db.add(tx_planned)
    test_db.commit()
    test_db.refresh(tx_past)
    test_db.refresh(tx_planned)

    # 2. Données bancaires en cache/relevé :
    # - Transaction bancaire confirmée du 10/08 (-25.99 €)
    # - Transaction bancaire en attente du 23/08 (-25.99 €)
    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "bank_balance": 1948.02,
                "transactions": [
                    # L'ordre par date décroissante met le 23/08 en premier dans la liste brute
                    {
                        "csv_id": "woob_coming_23aug",
                        "date_operation": "2026-08-23",
                        "description": "X1208 Google One Dublin",
                        "raw_description": "X1208 Google One Dublin",
                        "amount": 25.99,
                        "raw_amount": -25.99,
                        "is_coming": True,
                        "account_id": acc.id
                    },
                    {
                        "csv_id": "woob_hist_10aug",
                        "date_operation": "2026-08-10",
                        "description": "GOOGLE ONE DUBLIN",
                        "raw_description": "GOOGLE ONE DUBLIN",
                        "amount": 25.99,
                        "raw_amount": -25.99,
                        "is_coming": False,
                        "account_id": acc.id
                    }
                ]
            }
        ]
    }

    # 3. Réévaluation dynamique en direct
    res = client.post("/api/bank-sync/re-evaluate-preview", json=preview_data)
    assert res.status_code == 200
    data = res.json()

    txs = data["accounts"][0]["transactions"]
    tx_coming = next(t for t in txs if t["csv_id"] == "woob_coming_23aug")
    tx_hist = next(t for t in txs if t["csv_id"] == "woob_hist_10aug")

    # 4. Assertions strictes :
    # La transaction d'historique (10/08) doit matcher tx_past et être DÉJÀ RAPPROCHÉE (doublon ignoré)
    assert tx_hist["is_reconciled"] is True
    assert tx_hist["already_reconciled"] is True
    assert tx_hist["matched_db_id"] == tx_past.id

    # La transaction en attente (23/08) doit matcher tx_planned et être À POINTER (non encore rapprochée)
    assert tx_coming["is_reconciled"] is True
    assert tx_coming["already_reconciled"] is False
    assert tx_coming["matched_db_id"] == tx_planned.id


def test_delete_db_transaction_instantly_turns_coming_into_ghost_suggestion():
    """
    Vérifie qu'après suppression d'une opération en DB qui était matchée avec une transaction
    en attente de la banque (is_coming = True), l'appel à /api/bank-sync/pending rebascule
    instantanément l'opération en is_reconciled = False (nouvelle opération / ghost à ajouter).
    """
    from datetime import date
    from fastapi.testclient import TestClient
    from app.services.bank_sync_scheduler import save_pending_sync_data

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    conn = BankConnection(backend="cragr", label="Test Delete Reappear Ghost", is_active=True)
    acc = Account(name="Compte Test Reappear", initial_balance=1500.0)
    test_db.add(conn)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(conn)
    test_db.refresh(acc)

    # 1. Opération en DB
    db_tx = Transaction(
        description="Restaurant Le Gourmet",
        amount=42.50,
        type="expense_var",
        category="Restaurants",
        date_operation=date(2026, 8, 23),
        reconciliation_date=None,
        from_account_id=acc.id
    )
    test_db.add(db_tx)
    test_db.commit()
    test_db.refresh(db_tx)

    # 2. Relevé bancaire dans le sas d'attente (initialement matché)
    pending_payload = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "bank_balance": 1457.50,
                "transactions": [
                    {
                        "csv_id": "woob_coming_resto_4250",
                        "date_operation": "2026-08-23",
                        "description": "LE GOURMET RESTAURANT",
                        "raw_description": "LE GOURMET RESTAURANT",
                        "amount": 42.50,
                        "raw_amount": -42.50,
                        "is_coming": True,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": db_tx.id,
                        "account_id": acc.id
                    }
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, pending_payload)

    # Vérification initiale : pending indique 1 match, 0 new
    res1 = client.get("/api/bank-sync/pending")
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["total_matches"] == 1
    assert data1["total_new"] == 0
    t1 = data1["accounts"][0]["transactions"][0]
    assert t1["is_reconciled"] is True
    assert t1["matched_db_id"] == db_tx.id

    # 3. L'utilisateur supprime la transaction de la DB
    res_del = client.delete(f"/api/transactions/{db_tx.id}")
    assert res_del.status_code == 200

    # 4. Immédiatement après, l'appel à /api/bank-sync/pending doit re-calculer et montrer 1 nouvelle opération
    res2 = client.get("/api/bank-sync/pending")
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["total_matches"] == 0
    assert data2["total_new"] == 1, "L'opération doit immédiatement redevenir une nouvelle opération (ghost) à ajouter !"
    t2 = data2["accounts"][0]["transactions"][0]
    assert t2["is_reconciled"] is False, "L'opération ne doit plus être marquée comme rapprochée !"
    assert t2["matched_db_id"] is None
    assert t2["is_coming"] is True


def test_reconcile_balance_delta_initial_balance_mode():
    """
    Vérifie l'ajustement rapide d'un écart de solde via mise à jour du solde initial (sans écriture).
    """
    from fastapi.testclient import TestClient
    from app.services.finance_engine import calculate_balances

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Livret A Test Delta", initial_balance=5592.78, type="Livret")
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # Écart de +125.98 € constaté avec la banque
    delta = 125.98
    res = client.post(f"/api/accounts/{acc.id}/reconcile-balance-delta", json={
        "mode": "initial_balance",
        "delta": delta
    })
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["mode"] == "initial_balance"
    assert data["new_initial_balance"] == 5718.76

    test_db.refresh(acc)
    # Vérification que le solde calculé est exactement conforme et qu'aucune fausse transaction n'a été créée
    balances = calculate_balances(test_db, only_reconciled=True)
    assert round(balances.get(acc.id, 0.0), 2) == 5718.76

    tx_count = test_db.query(Transaction).filter((Transaction.from_account_id == acc.id) | (Transaction.to_account_id == acc.id)).count()
    assert tx_count == 0


def test_reconcile_balance_delta_transaction_mode():
    """
    Vérifie l'ajustement rapide d'un écart de solde via création d'une opération d'intérêts pointée.
    """
    from fastapi.testclient import TestClient
    from app.services.finance_engine import calculate_balances

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Livret LDD Test Delta", initial_balance=45.79, type="Livret")
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # Écart de +0.54 € correspondant aux intérêts annuels
    delta = 0.54
    res = client.post(f"/api/accounts/{acc.id}/reconcile-balance-delta", json={
        "mode": "transaction",
        "delta": delta,
        "transaction_description": "Intérêts annuels 2026",
        "transaction_category": "Intérêts"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["mode"] == "transaction"
    assert data["transaction_id"] is not None

    # Vérification de la transaction créée
    created_tx = test_db.query(Transaction).filter(Transaction.id == data["transaction_id"]).first()
    assert created_tx is not None
    assert created_tx.amount == 0.54
    assert created_tx.type == "income"
    assert created_tx.to_account_id == acc.id
    assert created_tx.reconciliation_date is not None
    assert created_tx.description == "Intérêts annuels 2026"

    # Vérification du solde pointé calculé
    balances = calculate_balances(test_db, only_reconciled=True)
    assert round(balances.get(acc.id, 0.0), 2) == 46.33


def test_link_ghost_to_transaction():
    """
    Vérifie la liaison manuelle d'une opération fantôme vers une transaction existante en base.
    """
    from datetime import date
    from fastapi.testclient import TestClient

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Compte Courant Test Link", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # 1. Création d'une transaction existante en base avec un montant erroné saisi par l'utilisateur
    db_tx = Transaction(
        description="Courses Intermarché",
        amount=54.20,
        type="expense_var",
        category="Alimentation",
        date_saisie=date.today(),
        date_operation=date.today(),
        from_account_id=acc.id,
        reconciliation_date=None
    )
    test_db.add(db_tx)
    test_db.commit()
    test_db.refresh(db_tx)

    # 2. Appel de l'endpoint link-ghost avec le montant réel en ligne (56.80 €) et le libellé conservé
    link_payload = {
        "csv_id": "woob_ghost_link_test_999",
        "target_tx_id": db_tx.id,
        "description": "Courses Intermarché",
        "amount": 56.80,
        "category": "Alimentation",
        "reconciliation_date": date.today().isoformat()
    }

    res = client.post("/api/bank-sync/link-ghost", json=link_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["updated_tx_id"] == db_tx.id

    # 3. Vérification de la mise à jour en base
    test_db.refresh(db_tx)
    assert db_tx.amount == 56.80
    assert db_tx.description == "Courses Intermarché"
    assert db_tx.reconciliation_date == date.today()
    assert db_tx.csv_id == "woob_ghost_link_test_999"


def test_transactions_search_and_filter():
    """
    Vérifie le filtre de recherche de GET /api/transactions/ (recherche par libellé, montant, compte et statut non pointé).
    """
    from datetime import date
    from fastapi.testclient import TestClient

    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc1 = Account(name="Compte Search 1", initial_balance=100.0)
    acc2 = Account(name="Compte Search 2", initial_balance=100.0)
    test_db.add(acc1)
    test_db.add(acc2)
    test_db.commit()
    test_db.refresh(acc1)
    test_db.refresh(acc2)

    tx1 = Transaction(
        description="Paiement Restaurant Le Gourmet",
        amount=42.50,
        type="expense_var",
        category="Restaurants",
        date_saisie=date.today(),
        date_operation=date.today(),
        from_account_id=acc1.id,
        reconciliation_date=None
    )
    tx2 = Transaction(
        description="Abonnement Fibre Internet",
        amount=29.99,
        type="expense_fixed",
        category="Internet",
        date_saisie=date.today(),
        date_operation=date.today(),
        from_account_id=acc1.id,
        reconciliation_date=date.today()
    )
    tx3 = Transaction(
        description="Paiement Restaurant Pizzeria",
        amount=18.00,
        type="expense_var",
        category="Restaurants",
        date_saisie=date.today(),
        date_operation=date.today(),
        from_account_id=acc2.id,
        reconciliation_date=None
    )
    test_db.add_all([tx1, tx2, tx3])
    test_db.commit()

    # Recherche par texte
    res = client.get("/api/transactions/?search=Restaurant")
    assert res.status_code == 200
    items = res.json()
    assert len(items) >= 2

    # Recherche par compte + non pointé uniquement
    res = client.get(f"/api/transactions/?account_id={acc1.id}&unreconciled_only=true")
    assert res.status_code == 200
    items = res.json()
    descs = [t["description"] for t in items]
    assert "Paiement Restaurant Le Gourmet" in descs
    assert "Abonnement Fibre Internet" not in descs

    # Recherche par montant numérique
    res = client.get("/api/transactions/?search=42.50")
    assert res.status_code == 200
    items = res.json()
    assert any(t["description"] == "Paiement Restaurant Le Gourmet" for t in items)


def test_re_evaluate_preview_with_rejected_matches():
    """Vérifie que les paires csv_id <-> db_id rejetées sont bien exclues du matching automatique."""
    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Compte Test Rejet", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    tx_wrong = Transaction(
        description="Floatplane Sub",
        amount=2.67,
        type="expense_var",
        category="Abonnements",
        date_saisie=date.today(),
        date_operation=date.today(),
        from_account_id=acc.id,
        reconciliation_date=None
    )
    test_db.add(tx_wrong)
    test_db.commit()
    test_db.refresh(tx_wrong)

    preview_payload = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "transactions": [
                    {
                        "csv_id": "woob_goulinou_001",
                        "description": "Goulinou Intermarche",
                        "amount": 2.67,
                        "raw_amount": -2.67,
                        "date_operation": date.today().isoformat(),
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    # 1. Sans rejet : le moteur fait un match automatique
    res_normal = client.post("/api/bank-sync/re-evaluate-preview", json=preview_payload)
    assert res_normal.status_code == 200
    tx_res = res_normal.json()["accounts"][0]["transactions"][0]
    assert tx_res["is_reconciled"] is True
    assert tx_res["matched_db_id"] == tx_wrong.id

    # 2. Avec rejet explicite de cette paire : le moteur refuse le match
    preview_with_rejected = {
        **preview_payload,
        "rejected_matches": [
            {"csv_id": "woob_goulinou_001", "db_id": tx_wrong.id}
        ]
    }
    res_rejected = client.post("/api/bank-sync/re-evaluate-preview", json=preview_with_rejected)
    assert res_rejected.status_code == 200
    tx_res_rej = res_rejected.json()["accounts"][0]["transactions"][0]
    assert tx_res_rej["is_reconciled"] is False
    assert tx_res_rej["matched_db_id"] is None


def test_re_evaluate_preview_with_force_matches():
    """Vérifie que les paires forcées manuellement court-circuitent le matching automatique."""
    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Compte Test Force", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    tx_target = Transaction(
        description="Floatplane DB Record",
        amount=2.67,
        type="expense_var",
        category="Loisirs",
        date_saisie=date.today(),
        date_operation=date.today(),
        from_account_id=acc.id,
        reconciliation_date=None
    )
    test_db.add(tx_target)
    test_db.commit()
    test_db.refresh(tx_target)

    # Montant en ligne légèrement différent (2.68 != 2.67), normalement non matché automatiquement
    preview_payload = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "transactions": [
                    {
                        "csv_id": "woob_paypal_fp_002",
                        "description": "Paypal Floatplane",
                        "amount": 2.68,
                        "raw_amount": -2.68,
                        "date_operation": date.today().isoformat(),
                        "is_coming": False
                    }
                ]
            }
        ],
        "force_matches": [
            {"csv_id": "woob_paypal_fp_002", "db_id": tx_target.id}
        ]
    }

    res = client.post("/api/bank-sync/re-evaluate-preview", json=preview_payload)
    assert res.status_code == 200
    tx_res = res.json()["accounts"][0]["transactions"][0]
    assert tx_res["is_reconciled"] is True
    assert tx_res["matched_db_id"] == tx_target.id
    assert tx_res["db_description"] == "Floatplane DB Record"


def test_re_evaluate_preview_unlink_and_relink_user_story():
    """Scénario complet : Délier Goulinou de Floatplane, lier Goulinou à Intermarché et Paypal à Floatplane."""
    client = TestClient(fastapi_app)
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Compte Story", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    tx_fp = Transaction(
        description="Floatplane",
        amount=2.67,
        type="expense_var",
        date_saisie=date.today(),
        date_operation=date.today(),
        from_account_id=acc.id,
        reconciliation_date=None
    )
    tx_inter = Transaction(
        description="Courses Intermarche",
        amount=2.67,
        type="expense_var",
        date_saisie=date.today(),
        date_operation=date.today(),
        from_account_id=acc.id,
        reconciliation_date=None
    )
    test_db.add_all([tx_fp, tx_inter])
    test_db.commit()
    test_db.refresh(tx_fp)
    test_db.refresh(tx_inter)

    # Relevé avec Goulinou (2.67) et Paypal Floatplane (2.68)
    preview_payload = {
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "transactions": [
                    {
                        "csv_id": "tx_goulinou",
                        "description": "Goulinou",
                        "amount": 2.67,
                        "raw_amount": -2.67,
                        "date_operation": date.today().isoformat(),
                        "is_coming": False
                    },
                    {
                        "csv_id": "tx_paypal_fp",
                        "description": "Paypal Floatplane",
                        "amount": 2.68,
                        "raw_amount": -2.68,
                        "date_operation": date.today().isoformat(),
                        "is_coming": False
                    }
                ]
            }
        ],
        "rejected_matches": [
            {"csv_id": "tx_goulinou", "db_id": tx_fp.id}
        ],
        "force_matches": [
            {"csv_id": "tx_goulinou", "db_id": tx_inter.id},
            {"csv_id": "tx_paypal_fp", "db_id": tx_fp.id}
        ]
    }

    res = client.post("/api/bank-sync/re-evaluate-preview", json=preview_payload)
    assert res.status_code == 200
    txs = res.json()["accounts"][0]["transactions"]
    
    goulinou = next(t for t in txs if t["csv_id"] == "tx_goulinou")
    paypal = next(t for t in txs if t["csv_id"] == "tx_paypal_fp")

    assert goulinou["is_reconciled"] is True
    assert goulinou["matched_db_id"] == tx_inter.id
    assert goulinou["db_description"] == "Courses Intermarche"

    assert paypal["is_reconciled"] is True
    assert paypal["matched_db_id"] == tx_fp.id
    assert paypal["db_description"] == "Floatplane"


def test_csv_multi_account_import_to_pending():
    """Vérifie l'extraction multi-comptes depuis un relevé fichier et son injection dans le sas d'attente (opérations fantômes)."""
    client = TestClient(fastapi_app)
    db = next(fastapi_app.dependency_overrides[get_db]())

    # 1. Créer 2 comptes en base : Courant et Livret A
    acc_courant = Account(name="CA Centre-Est Courant", type="Compte courant", initial_balance=1000.0)
    acc_livret = Account(name="Livret A", type="Épargne", initial_balance=5000.0)
    db.add_all([acc_courant, acc_livret])
    db.commit()

    # 2. Préparer un CSV multi-comptes typique (Crédit Agricole)
    csv_content = (
        "Compte de dépôt N° 123456789\n"
        "Solde au 24/08/2026 : 1 250,50 €\n"
        "Date;Libellé;Débit;Crédit\n"
        "24/08/2026;PRLV EDF;-85,00;\n"
        "23/08/2026;VIR SALAIRE;;2500,00\n"
        "\n"
        "Livret A N° 987654321\n"
        "Solde au 24/08/2026 : 5 100,00 €\n"
        "Date;Libellé;Débit;Crédit\n"
        "20/08/2026;INTERETS LIVRET;;100,00\n"
    )

    import io
    file_payload = {"file": ("releve_ca.csv", io.BytesIO(csv_content.encode("utf-8-sig")), "text/csv")}

    # 3. Appeler le endpoint /api/csv/import_to_pending
    res = client.post("/api/csv/import_to_pending", files=file_payload)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["_source"] == "csv_import"
    assert len(data["accounts"]) == 2

    # Vérifier le mapping automatique des comptes
    sec_courant = next((a for a in data["accounts"] if "dépôt" in a["section_title"].lower() or "courant" in a["account_name"].lower()), None)
    sec_livret = next((a for a in data["accounts"] if "livret" in a["section_title"].lower() or "livret" in a["account_name"].lower()), None)

    assert sec_courant is not None
    assert sec_courant["account_id"] == acc_courant.id
    assert len(sec_courant["transactions"]) == 2
    assert sec_courant["bank_balance"] == 1250.50

    assert sec_livret is not None
    assert sec_livret["account_id"] == acc_livret.id
    assert len(sec_livret["transactions"]) == 1
    assert sec_livret["bank_balance"] == 5100.00

    # 4. Vérifier que les opérations sont désormais dans le sas d'attente (/api/bank-sync/pending)
    pending_res = client.get("/api/bank-sync/pending")
    assert pending_res.status_code == 200
    pending_data = pending_res.json()

    # Doit contenir les 3 opérations fantômes au total
    total_txs = sum(len(a.get("transactions", [])) for a in pending_data.get("accounts", []))
    assert total_txs >= 3

    # 5. Valider une opération fantôme individuelle via /commit-ghost
    tx_to_commit = sec_courant["transactions"][0]
    commit_res = client.post("/api/bank-sync/commit-ghost", json={
        "connection_id": -1,
        "transaction": {
            **tx_to_commit,
            "account_id": acc_courant.id
        }
    })
    assert commit_res.status_code == 200
    assert commit_res.json()["ok"] is True

    # Vérifier en DB que la transaction a bien été insérée avec created_by "Import Relevé"
    db_tx = db.query(Transaction).filter(Transaction.csv_id == tx_to_commit["csv_id"]).first()
    assert db_tx is not None
    assert db_tx.description == "PRLV EDF"
    assert db_tx.amount == 85.00
    assert db_tx.created_by == "Import Relevé"

    # 6. Valider le reste via /commit-all-ghosts
    commit_all_res = client.post("/api/bank-sync/commit-all-ghosts")
    assert commit_all_res.status_code == 200
    assert commit_all_res.json()["ok"] is True

    # Vérifier que le sas est maintenant vide d'opérations fantômes mais conserve les comptes et soldes
    pending_after = client.get("/api/bank-sync/pending").json()
    assert sum(len(a.get("transactions", [])) for a in pending_after.get("accounts", [])) == 0
    assert len(pending_after.get("accounts", [])) >= 2
    livret_acc = next((a for a in pending_after["accounts"] if a["account_id"] == acc_livret.id), None)
    assert livret_acc is not None
    assert livret_acc["bank_balance"] == 5100.00


def test_csv_import_commit_preserves_bank_balance_and_discrepancy():
    """
    Vérifie qu'après validation et sauvegarde d'un import de relevé dans le cockpit,
    le compte et son solde bancaire sont conservés dans le sas afin que l'écart de solde
    continue d'être visible et ajustable dans le Dashboard.
    """
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync, CSV_IMPORT_CONN_ID, clear_all_pending_sync
    test_db = next(fastapi_app.dependency_overrides[get_db]())
    clear_all_pending_sync(test_db)

    acc = Account(name="Livret A Test", type="Épargne", initial_balance=5592.78)
    test_db.add(acc)
    test_db.commit()

    # 1. Sauvegarder le relevé dans le sas avec solde banque = 5718.76 € et 1 opération
    save_pending_sync_data(test_db, CSV_IMPORT_CONN_ID, {
        "_source": "csv_import",
        "accounts": [{
            "account_id": acc.id,
            "account_name": "Livret A Test",
            "bank_balance": 5718.76,
            "transactions": [
                {"csv_id": "tx_comm_1", "date_operation": "2026-08-20", "amount": 50.0, "raw_amount": 50.0, "description": "Intérêts"}
            ]
        }]
    })

    client = TestClient(fastapi_app)

    # 2. Commiter la transaction via /api/bank-sync/connections/-1/commit
    commit_res = client.post("/api/bank-sync/connections/-1/commit", json={
        "transactions": [{
            "account_id": acc.id,
            "csv_id": "tx_comm_1",
            "date_operation": "2026-08-20",
            "amount": 50.0,
            "raw_amount": 50.0,
            "description": "Intérêts"
        }]
    })
    assert commit_res.status_code == 200

    # 3. Vérifier que /api/bank-sync/pending conserve le compte, son solde banque et le calcul d'écart
    pending = client.get("/api/bank-sync/pending").json()
    assert len(pending["accounts"]) == 1
    p_acc = pending["accounts"][0]
    assert p_acc["account_id"] == acc.id
    assert p_acc["bank_balance"] == 5718.76
    assert len(p_acc["transactions"]) == 0
    # Le solde pointé est recalculé en direct
    assert p_acc["local_reconciled_balance"] is not None



def test_check_reconciliation_prevents_anachronistic_far_match():
    """
    Vérifie qu'un débit passé en banque (ex: 19/08) ne matche PAS une prévision future (ex: 24/08)
    même si le montant est exactement identique (25.99 €).
    """
    from datetime import date
    from app.routers.csv_parser import check_reconciliation
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Compte Test Scoring", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # Prévision future en DB au 24/08
    future_tx = Transaction(
        description="Google One Crédits IA",
        amount=25.99,
        type="expense_var",
        category="IA",
        date_saisie=date(2026, 8, 24),
        date_operation=date(2026, 8, 24),
        reconciliation_date=None,
        from_account_id=acc.id
    )
    test_db.add(future_tx)
    test_db.commit()
    test_db.refresh(future_tx)

    # Débit bancaire passé du 19/08 (5 jours avant la prévision)
    bank_date = date(2026, 8, 19)
    res = check_reconciliation(
        test_db,
        tx_date=bank_date,
        tx_amount=-25.99,
        account_id=acc.id,
        is_coming=False,
        bank_label="X1208 Google One Dublin"
    )

    # Ne doit PAS matcher la prévision future du 24/08
    assert res is None


def test_check_reconciliation_composite_scoring_and_confidence():
    """
    Vérifie le calcul du score composite (montant + proximité temporelle + similarité textuelle).
    """
    from datetime import date
    from app.routers.csv_parser import check_reconciliation
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Compte Test Score Exact", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # Transaction locale au 24/08
    local_tx = Transaction(
        description="Abonnement Netflix",
        amount=19.99,
        type="expense_fix",
        category="Loisirs",
        date_saisie=date(2026, 8, 24),
        date_operation=date(2026, 8, 24),
        reconciliation_date=None,
        from_account_id=acc.id
    )
    test_db.add(local_tx)
    test_db.commit()
    test_db.refresh(local_tx)

    # Match parfait même jour J=0 et libellé concordant
    res_perfect = check_reconciliation(
        test_db,
        tx_date=date(2026, 8, 24),
        tx_amount=-19.99,
        account_id=acc.id,
        is_coming=False,
        bank_label="PRLV SEPA NETFLIX SERVICES 1234"
    )
    assert res_perfect is not None
    assert res_perfect["id"] == local_tx.id
    assert res_perfect["match_score"] >= 80

    # Match à J+1 avec libellé concordant
    res_close = check_reconciliation(
        test_db,
        tx_date=date(2026, 8, 25),
        tx_amount=-19.99,
        account_id=acc.id,
        is_coming=False,
        bank_label="PRLV SEPA NETFLIX SERVICES 1234"
    )
    assert res_close is not None
    assert res_close["id"] == local_tx.id
    assert res_close["match_score"] >= 70


def test_sync_online_then_xlsx_import_replaces_account_data():
    """
    Vérifie qu'après une synchronisation en ligne sur 3 comptes, un import de fichier (XLSX/CSV)
    sur l'un de ces comptes (ex: Livret A) remplace fidèlement les anciennes données du Livret A
    dans le sas sans créer de doublon de compte ni de barre de solde redondante.
    """
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync, CSV_IMPORT_CONN_ID, clear_all_pending_sync
    test_db = next(fastapi_app.dependency_overrides[get_db]())
    clear_all_pending_sync(test_db)

    # 1. Créer les comptes en base
    acc_courant = Account(name="CA Centre-Est", type="Compte courant", initial_balance=480.10)
    acc_livret_a = Account(name="Livret A", type="Épargne", initial_balance=5592.78)
    acc_ldd = Account(name="Livret LDD", type="Épargne", initial_balance=45.79)
    test_db.add_all([acc_courant, acc_livret_a, acc_ldd])
    test_db.commit()

    conn = BankConnection(label="Crédit Agricole", backend="cragr", last_sync_status="success", account_mapping="{}")
    test_db.add(conn)
    test_db.commit()

    # 2. Synchronisation en ligne (conn.id)
    online_preview = {
        "accounts": [
            {
                "account_id": acc_courant.id,
                "account_name": "CA Centre-Est",
                "bank_balance": 480.10,
                "transactions": [
                    {"csv_id": "woob_tx_1", "date_operation": "2026-08-25", "amount": 26.99, "raw_amount": -26.99, "description": "Amazon"}
                ]
            },
            {
                "account_id": acc_livret_a.id,
                "account_name": "Livret A",
                "bank_balance": 5700.00,  # Ancien solde en ligne
                "transactions": [
                    {"csv_id": "woob_tx_old_livret", "date_operation": "2026-08-01", "amount": 10.00, "raw_amount": 10.00, "description": "Virement Ancien"}
                ]
            },
            {
                "account_id": acc_ldd.id,
                "account_name": "Livret LDD",
                "bank_balance": 46.33,
                "transactions": []
            }
        ]
    }
    save_pending_sync_data(test_db, conn.id, online_preview)

    pending_step1 = get_all_pending_sync(test_db)
    assert len(pending_step1["accounts"]) == 3

    # 3. Import d'un relevé XLSX / CSV de 12 mois pour le Livret A (CSV_IMPORT_CONN_ID = -1)
    file_import_preview = {
        "_source": "csv_import",
        "accounts": [
            {
                "account_id": acc_livret_a.id,
                "account_name": "Livret A",
                "bank_balance": 5718.76,  # Nouveau solde plus récent issu du fichier 12 mois
                "transactions": [
                    {"csv_id": "csv_tx_livret_1", "date_operation": "2026-08-20", "amount": 50.00, "raw_amount": 50.00, "description": "Intérêts 12M"},
                    {"csv_id": "csv_tx_livret_2", "date_operation": "2026-07-15", "amount": 100.00, "raw_amount": 100.00, "description": "Versement été"}
                ]
            }
        ]
    }
    save_pending_sync_data(test_db, CSV_IMPORT_CONN_ID, file_import_preview)

    # 4. Vérifier que get_all_pending_sync ne contient AUCUN doublon de compte
    pending_step2 = get_all_pending_sync(test_db)
    accounts = pending_step2["accounts"]
    assert len(accounts) == 3, f"Attendu 3 comptes uniques, obtenu {len(accounts)} comptes: {[a['account_name'] for a in accounts]}"

    acc_names = [a["account_name"] for a in accounts]
    assert acc_names.count("Livret A") == 1
    assert acc_names.count("CA Centre-Est") == 1
    assert acc_names.count("Livret LDD") == 1

    livret_entry = next(a for a in accounts if a["account_id"] == acc_livret_a.id)
    # Les données les plus récentes doivent avoir remplacé les anciennes
    assert livret_entry["bank_balance"] == 5718.76
    assert livret_entry["connection_id"] == CSV_IMPORT_CONN_ID
    assert len(livret_entry["transactions"]) == 2
    assert {t["csv_id"] for t in livret_entry["transactions"]} == {"csv_tx_livret_1", "csv_tx_livret_2"}


def test_xlsx_import_then_sync_online_replaces_account_data():
    """
    Vérifie qu'un import de relevé fichier suivi d'une synchronisation en ligne
    remplace l'ancienne entrée de fichier sans laisser de résidu orphelin.
    """
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync, CSV_IMPORT_CONN_ID, clear_all_pending_sync
    test_db = next(fastapi_app.dependency_overrides[get_db]())
    clear_all_pending_sync(test_db)

    acc = Account(name="Livret A", type="Épargne", initial_balance=5000.0)
    test_db.add(acc)
    test_db.commit()

    conn = BankConnection(label="Boursorama", backend="boursorama", last_sync_status="success", account_mapping="{}")
    test_db.add(conn)
    test_db.commit()

    # 1. Import fichier d'abord
    save_pending_sync_data(test_db, CSV_IMPORT_CONN_ID, {
        "accounts": [{
            "account_id": acc.id,
            "account_name": "Livret A",
            "bank_balance": 5200.0,
            "transactions": [{"csv_id": "file_1", "date_operation": "2026-08-01", "amount": 200.0, "raw_amount": 200.0, "description": "File tx"}]
        }]
    })

    # 2. Sync en ligne ensuite
    save_pending_sync_data(test_db, conn.id, {
        "accounts": [{
            "account_id": acc.id,
            "account_name": "Livret A",
            "bank_balance": 5250.0,
            "transactions": [{"csv_id": "online_1", "date_operation": "2026-08-26", "amount": 250.0, "raw_amount": 250.0, "description": "Online tx"}]
        }]
    })

    pending = get_all_pending_sync(test_db)
    assert len(pending["accounts"]) == 1
    assert pending["accounts"][0]["bank_balance"] == 5250.0
    assert pending["accounts"][0]["connection_id"] == conn.id
    assert len(pending["accounts"][0]["transactions"]) == 1
    assert pending["accounts"][0]["transactions"][0]["csv_id"] == "online_1"


def test_multi_file_import_different_accounts_merges_properly():
    """
    Vérifie que l'import successif de fichiers pour des comptes distincts
    conserve bien l'ensemble des comptes importés dans le sas.
    """
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync, CSV_IMPORT_CONN_ID, clear_all_pending_sync
    test_db = next(fastapi_app.dependency_overrides[get_db]())
    clear_all_pending_sync(test_db)

    acc1 = Account(name="Compte Courant", type="Compte courant", initial_balance=100.0)
    acc2 = Account(name="Livret LDD", type="Épargne", initial_balance=200.0)
    test_db.add_all([acc1, acc2])
    test_db.commit()

    # Import fichier 1 (Compte Courant)
    save_pending_sync_data(test_db, CSV_IMPORT_CONN_ID, {
        "accounts": [{
            "account_id": acc1.id,
            "account_name": "Compte Courant",
            "bank_balance": 150.0,
            "transactions": [{"csv_id": "c1_tx", "date_operation": "2026-08-10", "amount": 50.0, "raw_amount": 50.0, "description": "Tx Courant"}]
        }]
    })

    # Import fichier 2 (Livret LDD)
    save_pending_sync_data(test_db, CSV_IMPORT_CONN_ID, {
        "accounts": [{
            "account_id": acc2.id,
            "account_name": "Livret LDD",
            "bank_balance": 220.0,
            "transactions": [{"csv_id": "c2_tx", "date_operation": "2026-08-12", "amount": 20.0, "raw_amount": 20.0, "description": "Tx LDD"}]
        }]
    })

    pending = get_all_pending_sync(test_db)
    assert len(pending["accounts"]) == 2
    acc_map = {a["account_id"]: a for a in pending["accounts"]}
    assert acc_map[acc1.id]["bank_balance"] == 150.0
    assert acc_map[acc2.id]["bank_balance"] == 220.0


def test_check_reconciliation_30_days_window_for_reconciled_transactions():
    """
    Vérifie qu'une opération déjà pointée en base avec 22 jours de décalage de date
    est bien détectée et matchée grâce à l'élargissement de la fenêtre à 30 jours.
    """
    from datetime import date
    from app.routers.csv_parser import check_reconciliation
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="Compte Test 30j", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # Opération locale saisie et pointée au 02/07/2026
    tx = Transaction(
        description="DELKO MORESTEL VILLE",
        amount=179.28,
        type="expense_var",
        category="Divers",
        date_saisie=date(2026, 7, 2),
        date_operation=date(2026, 7, 2),
        reconciliation_date=date(2026, 7, 2),
        from_account_id=acc.id
    )
    test_db.add(tx)
    test_db.commit()

    # Relevé distant arrivant avec date bancaire au 24/07/2026 (22 jours après)
    rec = check_reconciliation(
        test_db,
        tx_date=date(2026, 7, 24),
        tx_amount=-179.28,
        account_id=acc.id,
        is_coming=False,
        bank_label="X1208 DELKO MORESTEL VILLE"
    )

    assert rec is not None
    assert rec["id"] == tx.id
    assert rec["already_reconciled"] is True
    assert rec["match_score"] >= 40


def test_auto_exclusion_on_conformed_balance():
    """
    Vérifie que lorsque les soldes sont conformes (banque == local),
    une ancienne opération inconnue (>15j) est auto-exclue du sas (is_auto_dismissed=True, total_new non incrémenté).
    """
    from datetime import date
    from app.services.bank_sync_scheduler import save_pending_sync_data, get_all_pending_sync, CSV_IMPORT_CONN_ID, clear_all_pending_sync
    test_db = next(fastapi_app.dependency_overrides[get_db]())
    clear_all_pending_sync(test_db)

    acc = Account(name="Compte Solde Conforme", initial_balance=480.10)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # Import d'un lot avec solde banque identique (480.10) et une vieille opération non matchée du 23/06/2026
    save_pending_sync_data(test_db, CSV_IMPORT_CONN_ID, {
        "accounts": [{
            "account_id": acc.id,
            "account_name": "Compte Solde Conforme",
            "bank_balance": 480.10,
            "transactions": [{
                "csv_id": "old_tx_conformed",
                "date_operation": "2026-06-23",
                "amount": 25.99,
                "raw_amount": -25.99,
                "description": "Google One Credits IA"
            }]
        }]
    })

    pending = get_all_pending_sync(test_db)
    assert len(pending["accounts"]) == 1
    # total_new ne doit PAS compter cette vieille opération car solde conforme
    assert pending["total_new"] == 0

    tx_item = pending["accounts"][0]["transactions"][0]
    assert tx_item["is_auto_dismissed"] is True
    assert tx_item["_excluded"] is True


def test_persistent_dismiss_and_restore_cycle():
    """
    Vérifie le cycle complet :
    1. Dismiss d'une opération via POST /api/bank-sync/dismiss-ghost/{csv_id} -> stocké en base
    2. Re-évaluation -> l'opération reste marquée is_dismissed=True et _excluded=True
    3. Restauration via POST /api/bank-sync/restore-ghost/{csv_id} -> l'opération est réintégrée
    """
    from app.services.bank_sync_scheduler import (
        save_pending_sync_data, get_all_pending_sync,
        CSV_IMPORT_CONN_ID, clear_all_pending_sync,
        get_dismissed_transactions
    )
    test_db = next(fastapi_app.dependency_overrides[get_db]())
    clear_all_pending_sync(test_db)
    client = TestClient(fastapi_app)

    acc = Account(name="Compte Dismiss Persist", initial_balance=100.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    csv_id = "test_persist_ghost_99"
    save_pending_sync_data(test_db, CSV_IMPORT_CONN_ID, {
        "accounts": [{
            "account_id": acc.id,
            "account_name": "Compte Dismiss Persist",
            "bank_balance": 150.0,
            "transactions": [{
                "csv_id": csv_id,
                "date_operation": "2026-08-20",
                "amount": 50.0,
                "raw_amount": -50.0,
                "description": "Achat Test"
            }]
        }]
    })

    # Avant dismiss : 1 nouvelle opération
    pending_before = get_all_pending_sync(test_db)
    assert pending_before["total_new"] == 1

    # 1. Dismiss via API
    res_dismiss = client.post(f"/api/bank-sync/dismiss-ghost/{csv_id}")
    assert res_dismiss.status_code == 200
    assert res_dismiss.json()["dismissed"] is True

    # Vérifier persistance
    dismissed_map = get_dismissed_transactions(test_db)
    assert csv_id in dismissed_map

    # 2. Re-évaluation
    pending_after_dismiss = get_all_pending_sync(test_db)
    assert pending_after_dismiss["total_new"] == 0

    # 3. Restauration via API
    res_restore = client.post(f"/api/bank-sync/restore-ghost/{csv_id}")
    assert res_restore.status_code == 200
    assert res_restore.json()["restored"] is True

    # Vérifier retrait de la persistance
    dismissed_map_after = get_dismissed_transactions(test_db)
    assert csv_id not in dismissed_map_after

    # 4. Vérifier réintégration
    pending_after_restore = get_all_pending_sync(test_db)
    assert pending_after_restore["total_new"] == 1


def test_check_reconciliation_prefers_close_unreconciled_over_far_reconciled_recurrence():
    """
    Vérifie qu'en présence d'une récurrence mensuelle (ex: Google One à 21.99 €) :
      - Mois N-1 (26/07/2026) : Déjà pointée en base (reconciliation_date != None)
      - Mois N   (26/08/2026) : En attente de pointage (reconciliation_date == None)
      - Débit bancaire réel au 24/08/2026 (-21.99 €)
    La fonction check_reconciliation DOIT privilégier la prévision du mois N (score ~93)
    au lieu de classer le débit en doublon du mois N-1 (score ~67).
    """
    from datetime import date
    from app.routers.csv_parser import check_reconciliation
    from app.services.bank_sync_service import BankSyncService
    test_db = next(fastapi_app.dependency_overrides[get_db]())

    acc = Account(name="CA Centre-Est Test Recurrence", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    # 1. Écriture du mois passé (juillet) - déjà rapprochée
    tx_july = Transaction(
        description="Google One Abonnement IA+ 5To",
        amount=21.99,
        type="expense_fix",
        category="Google",
        date_saisie=date(2026, 7, 26),
        date_operation=date(2026, 7, 26),
        reconciliation_date=date(2026, 7, 26),
        from_account_id=acc.id
    )
    # 2. Prévision du mois en cours (août) - non pointée
    tx_august = Transaction(
        description="Google One Abonnement IA+ 5To",
        amount=21.99,
        type="expense_fix",
        category="Google",
        date_saisie=date(2026, 8, 26),
        date_operation=date(2026, 8, 26),
        reconciliation_date=None,
        from_account_id=acc.id
    )
    test_db.add_all([tx_july, tx_august])
    test_db.commit()
    test_db.refresh(tx_july)
    test_db.refresh(tx_august)

    # 3. Arrivée du débit bancaire au 24/08/2026
    bank_date = date(2026, 8, 24)
    bank_csv_id = "woob_cragr_12345_googleone_aug"

    rec = check_reconciliation(
        test_db,
        tx_date=bank_date,
        tx_amount=-21.99,
        account_id=acc.id,
        is_coming=False,
        bank_label="X1208 Google One Dublin",
        csv_id=bank_csv_id
    )

    # Doit matcher la prévision d'août (non pointée) et NON le doublon de juillet
    assert rec is not None
    assert rec["id"] == tx_august.id
    assert rec["already_reconciled"] is False
    assert rec["match_score"] >= 80

    # 4. Enregistrement / Validation du pointage via BankSyncService
    commit_res = BankSyncService.commit_reviewed_transactions(
        db=test_db,
        connection_id=1,
        transactions_data=[{
            "account_id": acc.id,
            "is_reconciled": True,
            "already_reconciled": False,
            "matched_db_id": tx_august.id,
            "csv_id": bank_csv_id,
            "is_coming": False,
            "amount": 21.99,
            "raw_amount": -21.99,
            "date_operation": "2026-08-24"
        }]
    )
    assert commit_res["reconciled"] == 1

    # 5. Vérifier que tx_august est désormais pointée et a hérité du csv_id
    test_db.refresh(tx_august)
    assert tx_august.reconciliation_date is not None
    assert tx_august.csv_id == bank_csv_id

    # 6. Deuxième passage de synchronisation : doit maintenant reconnaître le match exact (Passe 0) déjà pointé
    rec_second_pass = check_reconciliation(
        test_db,
        tx_date=bank_date,
        tx_amount=-21.99,
        account_id=acc.id,
        is_coming=False,
        bank_label="X1208 Google One Dublin",
        csv_id=bank_csv_id
    )
    assert rec_second_pass is not None
    assert rec_second_pass["id"] == tx_august.id
    assert rec_second_pass["already_reconciled"] is True
    assert rec_second_pass["match_score"] == 100


def test_cragr_hotfix_client_id_mire_options():
    """Verify that _apply_module_hotfixes patches cragr AppConfigPage to read clientId from mireOptions."""
    from woob.core import Woob
    from app.services.bank_sync_service import _apply_module_hotfixes

    w = Woob()
    _apply_module_hotfixes(w, "cragr")

    import sys
    pages_mod = sys.modules.get("woob_modules.cragr.pages")
    assert pages_mod is not None
    assert hasattr(pages_mod, "AppConfigPage")

    # Test that AppConfigPage retrieves clientId from mireOptions
    class MockAppPage(pages_mod.AppConfigPage):
        def __init__(self, doc):
            self.doc = doc

    test_doc = {
        "environment": "prod",
        "mireOptions": {
            "userType": "customer",
            "clientId": "mock_ca_client_id_999",
            "loginMethod": "GET"
        }
    }
    page = MockAppPage(test_doc)
    assert page.get_client_id() == "mock_ca_client_id_999"

    # Test that nested recursive clientId works
    nested_doc = {
        "deep": {
            "nested": {
                "clientId": "mock_deep_nested_456"
            }
        }
    }
    page_nested = MockAppPage(nested_doc)
    assert page_nested.get_client_id() == "mock_deep_nested_456"

    # Test that fallback to public client ID works if no clientId present
    empty_doc = {"unknown": "data"}
    page_empty = MockAppPage(empty_doc)
    assert page_empty.get_client_id() == "cb811bccb65f9f25d74430e1cca02fed3a3c1deaccfe2ebfb1b52b7eb68cd284"


def test_cragr_hotfix_backend_instance_and_other_banks():
    """Verify that _apply_module_hotfixes patches classes on backend.browser and does not affect other backends."""
    from woob.core import Woob
    from app.services.bank_sync_service import _apply_module_hotfixes

    w = Woob()
    
    # Test on a custom backend mock
    class DummyPage:
        def __init__(self, doc):
            self.doc = doc
        def get_client_id(self):
            return self.doc.get("clientId")

    class DummyEndpoint:
        klass = DummyPage

    class DummyBrowser:
        espace_config = DummyEndpoint()
        caconnect_config = DummyEndpoint()

    class DummyBackend:
        browser = DummyBrowser()

    backend_mock = DummyBackend()
    _apply_module_hotfixes(w, "cragr", backend=backend_mock)

    # Verify that DummyPage was patched
    inst = DummyPage({"mireOptions": {"clientId": "backend_instance_test_789"}})
    assert inst.get_client_id() == "backend_instance_test_789"

    # Verify other backend does not crash and leaves untouched
    _apply_module_hotfixes(w, "other_unknown_backend")


def test_2fa_clean_error_messages():
    from woob.exceptions import NeedInteractiveFor2FA, AppValidation, DecoupledValidation
    from app.services.bank_sync_service import clean_error_message

    assert "Authentification forte requise" in clean_error_message(NeedInteractiveFor2FA())
    assert "Validation sur l'application mobile" in clean_error_message(AppValidation("Veuillez confirmer sur votre mobile"))
    assert "Validation sur l'application mobile" in clean_error_message(AppValidation(""))
    assert "Validation sur l'application mobile" in clean_error_message(DecoupledValidation(""))


def test_bank_sync_2fa_need_interactive_retry():
    import threading, time
    from unittest.mock import MagicMock
    from woob.exceptions import NeedInteractiveFor2FA
    from woob.tools.value import Value
    from app.services.bank_sync_service import (
        BankSyncService,
        register_2fa_session,
        unregister_2fa_session,
    )
    import app.services.bank_sync_service as bss

    session_id = "test_sess_need_interactive"
    register_2fa_session(session_id)
    events = []

    class FakeAccount:
        id = "acc_need_interactive"
        label = "Compte Courant"
        type = 1
        balance = 1000.0
        currency = "EUR"
        iban = "FR76..."

    call_count = 0

    def mock_iter_accounts():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise NeedInteractiveFor2FA()
        return [FakeAccount()]

    mock_backend = MagicMock()
    mock_backend.config = {"request_information": Value("request_information", default=None)}
    mock_backend.browser = MagicMock()
    mock_backend.browser.is_interactive = False
    mock_backend.iter_accounts = mock_iter_accounts

    orig_get_woob = bss.get_woob
    mock_woob = MagicMock()
    mock_woob.load_backend.return_value = mock_backend
    bss.get_woob = lambda: mock_woob

    try:
        accs = BankSyncService.test_connection_and_list_accounts(
            backend_name="creditmutuel",
            credentials={"login": "user", "password": "pw"},
            session_id=session_id,
            event_callback=lambda evt, data: events.append((evt, data))
        )
        assert len(accs) == 1
        assert accs[0].id == "acc_need_interactive"
        assert call_count == 2
        assert mock_backend.browser.is_interactive is True
    finally:
        bss.get_woob = orig_get_woob
        unregister_2fa_session(session_id)


def test_bank_sync_2fa_app_validation_flow():
    import threading, time
    from unittest.mock import MagicMock
    from woob.exceptions import AppValidation
    from woob.tools.value import Value
    from app.services.bank_sync_service import (
        BankSyncService,
        register_2fa_session,
        unregister_2fa_session,
        deliver_2fa_response,
    )
    import app.services.bank_sync_service as bss

    session_id = "test_sess_app_validation"
    register_2fa_session(session_id)
    events = []

    class FakeAccount:
        id = "acc_app_val"
        label = "Compte Courant CM"
        type = 1
        balance = 2500.0
        currency = "EUR"
        iban = "FR76..."

    call_count = 0

    def mock_iter_accounts():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise AppValidation("Veuillez confirmer sur votre smartphone")
        return [FakeAccount()]

    mock_backend = MagicMock()
    mock_backend.config = {
        "request_information": Value("request_information", default=None),
        "resume": Value("resume", default=None)
    }
    mock_backend.browser = MagicMock()
    mock_backend.browser.is_interactive = True
    mock_backend.iter_accounts = mock_iter_accounts

    orig_get_woob = bss.get_woob
    mock_woob = MagicMock()
    mock_woob.load_backend.return_value = mock_backend
    bss.get_woob = lambda: mock_woob

    def delayed_user_response():
        time.sleep(0.15)
        deliver_2fa_response(session_id, {"response_type": "app_validated", "value": None})

    threading.Thread(target=delayed_user_response, daemon=True).start()

    try:
        accs = BankSyncService.test_connection_and_list_accounts(
            backend_name="creditmutuel",
            credentials={"login": "user", "password": "pw"},
            session_id=session_id,
            event_callback=lambda evt, data: events.append((evt, data))
        )
        assert len(accs) == 1
        assert accs[0].id == "acc_app_val"
        assert call_count == 2
        assert mock_backend.config["resume"].get() is True
        event_types = [e[0] for e in events]
        assert "2fa_required" in event_types
        assert "progress" in event_types
    finally:
        bss.get_woob = orig_get_woob
        unregister_2fa_session(session_id)


def test_bank_sync_2fa_app_validation_auto_detect():
    """Vérifie que la validation mobile passe automatiquement sans aucun clic manuel dans OmniBank."""
    from unittest.mock import MagicMock
    from woob.exceptions import AppValidation
    from woob.tools.value import Value
    from app.services.bank_sync_service import (
        BankSyncService,
        register_2fa_session,
        unregister_2fa_session,
    )
    import app.services.bank_sync_service as bss

    session_id = "test_sess_auto_detect"
    register_2fa_session(session_id)
    events = []

    class FakeAccount:
        id = "acc_auto_detect"
        label = "Compte Crédit Mutuel Auto"
        type = 1
        balance = 1234.56
        currency = "EUR"
        iban = "FR7610278060000123456789012"

    call_count = 0

    def mock_iter_accounts():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # La banque demande la confirmation sur le smartphone
            raise AppValidation("Veuillez confirmer sur votre application mobile bancaire.")
        # Dès le 2e appel (après auto-resume), la confirmation mobile a été validée côté banque
        return [FakeAccount()]

    mock_backend = MagicMock()
    mock_backend.config = {
        "request_information": Value("request_information", default=None),
        "resume": Value("resume", default=None)
    }
    mock_backend.browser = MagicMock()
    mock_backend.browser.is_interactive = True
    mock_backend.iter_accounts = mock_iter_accounts

    orig_get_woob = bss.get_woob
    mock_woob = MagicMock()
    mock_woob.load_backend.return_value = mock_backend
    bss.get_woob = lambda: mock_woob

    # NOTE : Aucun thread delayed_user_response() ni deliver_2fa_response() n'est appelé !
    # Tout doit se débloquer et réussir automatiquement grâce à l'auto-polling.
    try:
        accs = BankSyncService.test_connection_and_list_accounts(
            backend_name="creditmutuel",
            credentials={"login": "user", "password": "pw"},
            session_id=session_id,
            event_callback=lambda evt, data: events.append((evt, data))
        )
        assert len(accs) == 1
        assert accs[0].id == "acc_auto_detect"
        assert call_count == 2
        assert mock_backend.config["resume"].get() is True
        event_types = [e[0] for e in events]
        assert "2fa_required" in event_types
        # Vérifier que le payload 2fa_required contient bien auto_poll: True
        required_evt = next(e[1] for e in events if e[0] == "2fa_required")
        assert required_evt.get("auto_poll") is True
    finally:
        bss.get_woob = orig_get_woob
        unregister_2fa_session(session_id)


def test_bank_sync_2fa_browser_question_flow():
    import threading, time
    from unittest.mock import MagicMock
    from woob.exceptions import BrowserQuestion
    from woob.tools.value import Value
    from app.services.bank_sync_service import (
        BankSyncService,
        register_2fa_session,
        unregister_2fa_session,
        deliver_2fa_response,
    )
    import app.services.bank_sync_service as bss

    session_id = "test_sess_otp_question"
    register_2fa_session(session_id)
    events = []

    class FakeAccount:
        id = "acc_bnp_otp"
        label = "Compte BNP OTP"
        type = 1
        balance = 950.0
        currency = "EUR"
        iban = "FR76..."

    call_count = 0

    def mock_iter_accounts():
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise BrowserQuestion(Value("otp", label="Entrez le code SMS reçu"))
        return [FakeAccount()]

    mock_backend = MagicMock()
    mock_backend.config = {
        "request_information": Value("request_information", default=None),
        "otp": Value("otp", default=None)
    }
    mock_backend.browser = MagicMock()
    mock_backend.browser.is_interactive = True
    mock_backend.iter_accounts = mock_iter_accounts

    orig_get_woob = bss.get_woob
    mock_woob = MagicMock()
    mock_woob.load_backend.return_value = mock_backend
    bss.get_woob = lambda: mock_woob

    def delayed_user_otp():
        time.sleep(0.15)
        deliver_2fa_response(session_id, {"response_type": "otp_code", "value": "123456"})

    threading.Thread(target=delayed_user_otp, daemon=True).start()

    try:
        accs = BankSyncService.test_connection_and_list_accounts(
            backend_name="bnp",
            credentials={"login": "user", "password": "pw"},
            session_id=session_id,
            event_callback=lambda evt, data: events.append((evt, data))
        )
        assert len(accs) == 1
        assert accs[0].id == "acc_bnp_otp"
        assert call_count == 2
        assert mock_backend.config["otp"].get() == "123456"
        event_types = [e[0] for e in events]
        assert "2fa_required" in event_types
    finally:
        bss.get_woob = orig_get_woob
        unregister_2fa_session(session_id)


def test_multi_profile_pending_sync_and_cache_isolation():
    """
    Vérifie l'étanchéité stricte des données du sas d'attente (pending sync)
    et du cache entre deux profils distincts ayant un conn_id identique (ex: conn_id=1).
    """
    from app.services.bank_sync_scheduler import (
        save_pending_sync_data,
        get_all_pending_sync,
        clear_all_pending_sync,
        _PENDING_SYNC_DATA
    )
    from app.services import stats_cache
    from app.models import BankConnection, Account

    test_db = next(fastapi_app.dependency_overrides[get_db]())

    # Connexion id=1 sur test_db
    conn = test_db.query(BankConnection).filter(BankConnection.id == 1).first()
    if not conn:
        conn = BankConnection(id=1, backend="cragr", label="Crédit Agricole", is_active=True)
        test_db.add(conn)
        test_db.commit()

    # Données Profil 1 ("default")
    data_prof1 = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "CA Centre-Est",
                "bank_balance": 1500.0,
                "connection_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_prof1_quentin",
                        "date_operation": "2026-09-02",
                        "description": "VIR INST de MLLE MARINE PLAZA",
                        "raw_amount": 137.50,
                        "amount": 137.50,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }

    # Données Profil 2 ("p_thomas")
    data_prof2 = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Crédit Mutuel Thomas",
                "bank_balance": 3200.0,
                "connection_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_prof2_thomas",
                        "date_operation": "2026-09-03",
                        "description": "ACHAT MATERIEL CSE",
                        "raw_amount": -450.00,
                        "amount": 450.00,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }

    try:
        # Enregistrer les deux sas avec conn_id=1 mais sur des profile_id différents
        save_pending_sync_data(test_db, 1, data_prof1, profile_id="default")
        save_pending_sync_data(test_db, 1, data_prof2, profile_id="p_thomas")

        # Vérifier que les structures mémoire sont strictement cloisonnées
        assert "default" in _PENDING_SYNC_DATA
        assert "p_thomas" in _PENDING_SYNC_DATA
        assert _PENDING_SYNC_DATA["default"][1]["accounts"][0]["transactions"][0]["csv_id"] == "tx_prof1_quentin"
        assert _PENDING_SYNC_DATA["p_thomas"][1]["accounts"][0]["transactions"][0]["csv_id"] == "tx_prof2_thomas"

        # Vérifier que get_all_pending_sync pour p_thomas n'expose AUCUNE donnée de default
        pending_thomas = get_all_pending_sync(test_db, profile_id="p_thomas")
        thomas_descriptions = [
            tx["description"]
            for acc in pending_thomas.get("accounts", [])
            for tx in acc.get("transactions", [])
        ]
        assert "ACHAT MATERIEL CSE" in thomas_descriptions
        assert "VIR INST de MLLE MARINE PLAZA" not in thomas_descriptions

        # Vérifier le fonctionnement de l'invalidation globale du cache stats
        stats_cache.set("default", "test_key", {"val": 1})
        stats_cache.set("p_thomas", "test_key", {"val": 2})
        assert stats_cache.get("default", "test_key") is not None
        assert stats_cache.get("p_thomas", "test_key") is not None

        stats_cache.invalidate()
        assert stats_cache.get("default", "test_key") is None
        assert stats_cache.get("p_thomas", "test_key") is None
    finally:
        clear_all_pending_sync(test_db, profile_id="default")
        clear_all_pending_sync(test_db, profile_id="p_thomas")





















