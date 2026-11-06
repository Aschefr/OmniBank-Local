"""Le classement des libellés par lot désactive le raisonnement des modèles qui réfléchissent (qwen3.x,
gemma4:12b et plus) : sinon ils épuisent num_predict avant le JSON et toutes les catégories reviennent vides."""
import json

import httpx

from app.services.chat import ollama_client

CFG = {"enabled": True, "url": "http://ollama.test:11434", "model": "qwen3.5:9b", "num_ctx": 32768}
ANSWER = {"Cb Carrefour City": {"name": "Carrefour City", "category": "Alimentation"}}


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = body if isinstance(body, str) else json.dumps(body)

    def json(self):
        return self._body


def test_batch_asks_for_no_thinking(monkeypatch):
    sent = []

    def fake_post(url, json=None, timeout=None):
        sent.append(json)
        return _Resp(200, {"message": {"content": __import__("json").dumps(ANSWER)}})

    monkeypatch.setattr(httpx, "post", fake_post)
    res = ollama_client.call_ollama_batch(["Cb Carrefour City"], ["Alimentation"], cfg=CFG, suggest_names=True)
    assert sent[0]["think"] is False
    assert res["Cb Carrefour City"]["category"] == "Alimentation"


def test_batch_accepts_a_list_of_objects_wrapped_under_one_key():
    raw = json.dumps({"transactions": [
        {"description": "Cb Carrefour City", "name": "Carrefour City", "category": "Alimentation"}]})
    res = ollama_client._parse_and_validate_batch_response(raw, ["Cb Carrefour City"], ["Alimentation"], suggest_names=True)
    assert res["Cb Carrefour City"]["category"] == "Alimentation"
    assert res["Cb Carrefour City"]["name"] == "Carrefour City"


def test_batch_retries_without_think_when_the_model_refuses_it(monkeypatch):
    sent = []

    def fake_post(url, json=None, timeout=None):
        sent.append(dict(json))
        if "think" in json:
            return _Resp(400, '{"error":"model does not support thinking"}')
        return _Resp(200, {"message": {"content": __import__("json").dumps(ANSWER)}})

    monkeypatch.setattr(httpx, "post", fake_post)
    res = ollama_client.call_ollama_batch(["Cb Carrefour City"], ["Alimentation"], cfg=CFG, suggest_names=True)
    assert len(sent) == 2 and "think" not in sent[1]
    assert res["Cb Carrefour City"]["category"] == "Alimentation"
