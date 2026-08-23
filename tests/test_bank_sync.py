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










