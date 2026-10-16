"""
Test de non-régression pour les endpoints de flux SSE de synchronisation bancaire :
- /api/bank-sync/connections/{conn_id}/sync-stream
- /api/bank-sync/connections/{conn_id}/test-stream
Vérifie qu'aucune exception UnboundLocalError n'est levée lors de l'accès à get_active_profile.
"""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app as fastapi_app
from app.models import BankConnection
from app.services.credential_vault import VaultSessionManager, CredentialVault


@pytest.fixture(autouse=True)
def setup_db_for_stream():
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


def test_sync_stream_endpoint_no_unbound_local_error():
    client = TestClient(fastapi_app, raise_server_exceptions=False)

    # Créer une connexion en base
    from app.database import get_db
    db = next(fastapi_app.dependency_overrides[get_db]())
    conn = BankConnection(
        backend="creditmutuel",
        label="Crédit Mutuel Test",
        is_active=True
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    conn_id = conn.id

    # Créer un vault token valide
    token = VaultSessionManager.create_session("MyMasterPassword123!", profile_id="default")

    # Mocker BankSyncService.sync_connection pour ne pas appeler woob réellement
    with patch("app.services.bank_sync_service.BankSyncService.sync_connection") as mock_sync:
        mock_sync.return_value = None
        # On appelle le flux SSE
        response = client.get(f"/api/bank-sync/connections/{conn_id}/sync-stream?vault_token={token}")
        # La requête ne doit surtout pas planter avec une erreur 500 UnboundLocalError
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"


def test_test_stream_endpoint_no_unbound_local_error():
    client = TestClient(fastapi_app, raise_server_exceptions=False)

    from app.database import get_db
    db = next(fastapi_app.dependency_overrides[get_db]())
    conn = BankConnection(
        backend="creditmutuel",
        label="Crédit Mutuel Test",
        is_active=True
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)
    conn_id = conn.id

    token = VaultSessionManager.create_session("MyMasterPassword123!", profile_id="default")
    CredentialVault.store_credentials(db, conn_id, {"login": "user", "password": "pwd"}, "MyMasterPassword123!")
    db.commit()

    with patch("app.services.bank_sync_service.BankSyncService.test_connection_and_list_accounts") as mock_test:
        mock_test.return_value = []
        response = client.get(f"/api/bank-sync/connections/{conn_id}/test-stream?vault_token={token}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
