"""Relevé manuel : bloqué depuis un appareil non déverrouillé, même si le coffre est ouvert sur un autre appareil.
Le rappel du planificateur garde la session du serveur."""
from unittest.mock import patch

import pytest

from app.services.bank_sync import auto_sync
from app.services.credential_vault import VaultSessionManager

PID = "p_device_lock_test"


@pytest.fixture
def other_device_session():
    token = VaultSessionManager.create_session("mot-de-passe-invente", 1, profile_id=PID)
    yield token
    VaultSessionManager.lock_session(profile_id=PID)


def _call(**kw):
    # On s'arrête juste après le contrôle du coffre : la suite (connexions, thread) n'est pas en jeu ici.
    with patch.object(auto_sync, "_resolve_profile_id", return_value=PID), \
         patch("app.database.get_engine", side_effect=RuntimeError("passé le contrôle")):
        try:
            return auto_sync.trigger_manual_auto_sync(profile_id=PID, **kw)
        except RuntimeError:
            return {"ok": True, "passed_vault_check": True}


def test_manual_without_device_token_is_refused(other_device_session):
    res = _call(force=True, trigger_source="manual", device_only=True)
    assert res["ok"] is False
    assert "cet appareil" in res["detail"]
    assert "verrouill" in res["detail"].lower()


def test_manual_with_foreign_or_bad_token_is_refused(other_device_session):
    res = _call(force=True, trigger_source="manual", device_only=True, vault_token="jeton-inconnu")
    assert res["ok"] is False


def test_manual_with_this_device_token_passes(other_device_session):
    res = _call(force=True, trigger_source="manual", device_only=True, vault_token=other_device_session)
    assert res["ok"] is True


def test_manual_with_master_password_passes(other_device_session):
    res = _call(force=True, trigger_source="manual", device_only=True, master_password="mot-de-passe-invente")
    assert res["ok"] is True


def test_scheduled_uses_server_session(other_device_session):
    res = _call(force=False, trigger_source="scheduled")
    assert res["ok"] is True


def test_router_requires_device_for_manual():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    with patch("app.services.bank_sync_scheduler.trigger_manual_auto_sync") as mock_sync:
        mock_sync.return_value = {"ok": True}
        client.post("/api/bank-sync/trigger-auto-sync", json={"force": True, "trigger_source": "manual"})
        assert mock_sync.call_args.kwargs["device_only"] is True
        client.post("/api/bank-sync/trigger-auto-sync", json={"force": False, "trigger_source": "scheduled"})
        assert mock_sync.call_args.kwargs["device_only"] is False


def test_chat_apply_action_forwards_device_token():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    with patch("app.routers.chat.execute_chat_action") as mock_exec:
        mock_exec.return_value = {"success": True}
        client.post("/api/chat/apply-action", json={"action": "trigger_bank_sync", "params": {}},
                    headers={"X-OmniBank-Vault-Token": "jeton-appareil"})
        assert mock_exec.call_args.kwargs["vault_token"] == "jeton-appareil"
