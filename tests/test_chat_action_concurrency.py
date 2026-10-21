"""Tests de non-régression issus de la revue de l'audit Chat IA (#1 concurrence)."""
import pytest
from fastapi import HTTPException

from app.services.chat import chat_orchestrator as co


def test_concurrent_apply_is_rejected(monkeypatch):
    """Une seconde requête pour la même action, pendant que la première s'exécute, doit être rejetée (409)."""
    key_holder = {}

    def fake_unlocked(db, action, params, message_id, action_id, *args, **kwargs):
        # Pendant l'exécution de la 1re requête, on simule une 2e requête concurrente
        with pytest.raises(HTTPException) as exc:
            co.execute_chat_action(db, action, params, message_id=message_id, action_id=action_id)
        key_holder["status"] = exc.value.status_code
        return {"success": True}

    monkeypatch.setattr(co, "_execute_chat_action_unlocked", fake_unlocked)
    res = co.execute_chat_action(None, "create_category", {"name": "X"}, message_id=42, action_id="act_42_0")
    assert res["success"] is True
    assert key_holder["status"] == 409
    # Le verrou est libéré après exécution
    assert not co._ACTIONS_IN_FLIGHT


def test_lock_released_on_error(monkeypatch):
    def boom(*a, **k):
        raise HTTPException(status_code=400, detail="err")

    monkeypatch.setattr(co, "_execute_chat_action_unlocked", boom)
    with pytest.raises(HTTPException):
        co.execute_chat_action(None, "create_category", {}, message_id=1, action_id="act_1_0")
    assert not co._ACTIONS_IN_FLIGHT
