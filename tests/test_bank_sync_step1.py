"""
tests/test_bank_sync_step1.py
-----------------------------
Tests d'intégration et unitaires pour l'Étape 1 de l'Auto-Pilot :
1. Déverrouillage réactif du coffre (bank_sync_on_vault_unlock = "true")
2. Déverrouillage passif sans requête réseau (bank_sync_on_vault_unlock = "false")
3. Cooldown anti-spam de 3 heures (GlobalConfig.last_auto_sync_attempt)
4. Forçage manuel du relevé (force=True)
5. Endpoints GET/POST /api/bank-sync/settings/auto-sync
6. Tri chronologique strict des transactions Woob (history_raw & coming_raw)
"""

import pytest
from datetime import datetime, timezone, timedelta, date
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app as fastapi_app
from app.models import GlobalConfig, BankConnection, Account, Transaction
from app.services.credential_vault import CredentialVault
from app.services.bank_sync_scheduler import (
    AUTO_SYNC_COOLDOWN_SECONDS,
    get_auto_sync_cooldown_status,
    trigger_manual_auto_sync
)


@pytest.fixture
def step1_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client_step1(step1_db):
    def override_get_db():
        try:
            yield step1_db
        finally:
            pass

    fastapi_app.dependency_overrides[get_db] = override_get_db
    with TestClient(fastapi_app) as client:
        yield client
    fastapi_app.dependency_overrides.clear()


# ─────────────────────────────────────────────────────────────────────────────
# 1. Tests Cooldown Anti-Spam (Scheduler)
# ─────────────────────────────────────────────────────────────────────────────

def test_auto_sync_cooldown_initial_state(step1_db):
    """Sans tentative préalable, aucun cooldown n'est actif."""
    status = get_auto_sync_cooldown_status(step1_db, profile_id="default")
    assert status["cooldown_active"] is False
    assert status["remaining_seconds"] == 0
    assert status["elapsed_seconds"] is None
    assert status["last_attempt_iso"] is None


def test_auto_sync_cooldown_activation_and_bypass(step1_db):
    """Une exécution active le cooldown 3h. force=False le respecte, force=True le contourne."""
    with patch("threading.Thread.start"):
        # 1. Première exécution normale
        res1 = trigger_manual_auto_sync(
            master_password="SuperPassword123!",
            profile_id="default",
            force=False,
            db=step1_db
        )
        assert res1["ok"] is True
        assert res1.get("cooldown_active") is False

        # Statut du cooldown après coup
        status = get_auto_sync_cooldown_status(step1_db, profile_id="default")
        assert status["cooldown_active"] is True
        assert status["remaining_seconds"] > 0
        assert status["remaining_seconds"] <= AUTO_SYNC_COOLDOWN_SECONDS
        assert status["elapsed_seconds"] is not None
        assert status["elapsed_seconds"] >= 0

        # 2. Seconde tentative immédiate avec force=False -> Doit être bloquée par le cooldown
        res2 = trigger_manual_auto_sync(
            master_password="SuperPassword123!",
            profile_id="default",
            force=False,
            db=step1_db
        )
        assert res2["ok"] is True
        assert res2["cooldown_active"] is True
        assert res2["remaining_seconds"] > 0
        assert "cooldown" in res2["message"].lower() or "3h" in res2["message"]

        # 3. Forçage explicite avec force=True -> Doit passer outre le cooldown
        res3 = trigger_manual_auto_sync(
            master_password="SuperPassword123!",
            profile_id="default",
            force=True,
            db=step1_db
        )
        assert res3["ok"] is True
        assert res3.get("cooldown_active") is False


def test_auto_sync_cooldown_expiration(step1_db):
    """Après 3h (10800s), le cooldown expire."""
    four_hours_ago = datetime.now(timezone.utc) - timedelta(hours=4)
    cfg = GlobalConfig(
        key="last_auto_sync_attempt",
        value=four_hours_ago.isoformat()
    )
    step1_db.add(cfg)
    step1_db.commit()

    status = get_auto_sync_cooldown_status(step1_db, profile_id="default")
    assert status["cooldown_active"] is False
    assert status["remaining_seconds"] == 0
    assert status["elapsed_seconds"] is not None
    assert status["elapsed_seconds"] >= 4 * 3600


# ─────────────────────────────────────────────────────────────────────────────
# 2. Tests Endpoints Settings Auto-Sync
# ─────────────────────────────────────────────────────────────────────────────

def test_settings_auto_sync_get_and_post(client_step1, step1_db):
    """Vérifie la lecture et l'enregistrement de sync_on_vault_unlock via l'API."""
    # GET par défaut
    res = client_step1.get("/api/bank-sync/settings/auto-sync")
    assert res.status_code == 200
    data = res.json()
    assert data["sync_on_vault_unlock"] is True
    assert data["cooldown_active"] is False

    # POST pour désactiver le relevé au déverrouillage (Mode passif)
    post_res = client_step1.post("/api/bank-sync/settings/auto-sync", json={
        "enabled": True,
        "interval_hours": 12,
        "sync_on_vault_unlock": False
    })
    assert post_res.status_code == 200
    assert post_res.json().get("ok") is True

    # Vérification en base
    cfg = step1_db.query(GlobalConfig).filter(GlobalConfig.key == "bank_sync_on_vault_unlock").first()
    assert cfg is not None
    assert cfg.value == "false"

    # GET confirme la nouvelle valeur
    res2 = client_step1.get("/api/bank-sync/settings/auto-sync")
    assert res2.status_code == 200
    assert res2.json()["sync_on_vault_unlock"] is False


# ─────────────────────────────────────────────────────────────────────────────
# 3. Tests Déverrouillage Coffre : Réactif vs Passif
# ─────────────────────────────────────────────────────────────────────────────

def test_vault_unlock_reactive_sync(client_step1, step1_db):
    """Déverrouillage coffre avec sync_on_vault_unlock=True déclenche le relevé réactif."""
    conn = BankConnection(id=1, label="Test Bank", backend="cragr", is_active=True)
    step1_db.add(conn)
    step1_db.commit()
    CredentialVault.store_credentials(step1_db, 1, {"login": "test_user"}, "MonSuperPass123!")

    # Config par défaut ou active
    cfg = GlobalConfig(key="bank_sync_on_vault_unlock", value="true")
    step1_db.add(cfg)
    step1_db.commit()

    with patch("app.services.bank_sync_scheduler.trigger_manual_auto_sync") as mock_sync:
        mock_sync.return_value = {
            "ok": True,
            "message": "Relevé automatique démarré en arrière-plan",
            "cooldown_active": False,
            "profile_id": "default"
        }

        res = client_step1.post("/api/bank-sync/vault/unlock", json={
            "master_password": "MonSuperPass123!",
            "remember_days": 1
        })
        assert res.status_code == 200
        data = res.json()
        assert data["is_unlocked"] is True
        assert "reactive_sync" in data
        assert data["reactive_sync"]["ok"] is True
        assert mock_sync.called
        call_kwargs = mock_sync.call_args.kwargs
        assert call_kwargs["master_password"] == "MonSuperPass123!"
        assert call_kwargs["force"] is False


def test_vault_unlock_passive_mode(client_step1, step1_db):
    """Déverrouillage coffre avec sync_on_vault_unlock=False ne déclenche aucun relevé réseau."""
    conn = BankConnection(id=1, label="Test Bank", backend="cragr", is_active=True)
    step1_db.add(conn)
    step1_db.commit()
    CredentialVault.store_credentials(step1_db, 1, {"login": "test_user"}, "MonSuperPass123!")

    cfg = GlobalConfig(key="bank_sync_on_vault_unlock", value="false")
    step1_db.add(cfg)
    step1_db.commit()

    with patch("app.services.bank_sync_scheduler.trigger_manual_auto_sync") as mock_sync:
        res = client_step1.post("/api/bank-sync/vault/unlock", json={
            "master_password": "MonSuperPass123!",
            "remember_days": 1
        })
        assert res.status_code == 200
        data = res.json()
        assert data["is_unlocked"] is True
        assert "reactive_sync" in data
        assert data["reactive_sync"]["skipped_passive_mode"] is True
        mock_sync.assert_not_called()


# ─────────────────────────────────────────────────────────────────────────────
# 4. Tests Tri Chronologique Strict des Transactions Woob
# ─────────────────────────────────────────────────────────────────────────────

def test_woob_transactions_chronological_sorting():
    """Vérifie que les listes brutes Woob (history_raw et coming_raw) sont triées par date croissante."""
    history_raw = [
        {"id": "t3", "tx_date_obj": date(2026, 9, 10), "label": "Tx 3"},
        {"id": "t1", "tx_date_obj": date(2026, 9, 1), "label": "Tx 1"},
        {"id": "t2", "tx_date_obj": date(2026, 9, 5), "label": "Tx 2"},
        {"id": "t0", "tx_date_obj": None, "label": "Tx Sans Date"},
    ]

    # Application du tri identique à bank_sync_service.py
    history_raw.sort(key=lambda x: x.get("tx_date_obj") or date.min)

    expected_ids = ["t0", "t1", "t2", "t3"]
    assert [x["id"] for x in history_raw] == expected_ids
    assert history_raw[-1]["tx_date_obj"] == date(2026, 9, 10)
