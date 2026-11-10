"""Serveur Ollama joint mais modèle absent (404 « model not found ») : un message clair, pas « HTTP 404 »."""

import httpx
import pytest
from fastapi import HTTPException

from app.services.chat import ollama_client
from app.services.chat.ollama_client import call_ollama_sync, missing_model_message

NOT_FOUND = '{"error":"model \\"exemple:7b\\" not found, try pulling it first"}'


def test_message_names_the_model_and_says_the_connection_works():
    fr = missing_model_message(404, NOT_FOUND, "exemple:7b", "fr")
    en = missing_model_message(404, NOT_FOUND, "exemple:7b", "en")
    assert "exemple:7b" in fr and "connexion fonctionne" in fr and "Configuration > Assistant IA" in fr
    assert "exemple:7b" in en and "connection works" in en and "Configuration > AI assistant" in en


@pytest.mark.parametrize("status, body", [(404, "404 page not found"), (500, NOT_FOUND), (404, "")])
def test_other_errors_are_left_alone(status, body):
    assert missing_model_message(status, body, "exemple:7b") is None


def test_sync_call_reports_the_missing_model(monkeypatch):
    def fake_post(url, json=None, timeout=None):
        return httpx.Response(404, text=NOT_FOUND)

    monkeypatch.setattr(ollama_client.httpx, "post", fake_post)
    with pytest.raises(HTTPException) as exc:
        call_ollama_sync("bonjour", {"url": "http://127.0.0.1:1", "model": "exemple:7b"})
    assert "exemple:7b" in exc.value.detail and "HTTP 404" not in exc.value.detail
