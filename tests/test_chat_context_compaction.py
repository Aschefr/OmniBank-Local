"""Estimation des tokens et compaction du contexte du chat."""
import asyncio
import json

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, ChatMessage, ChatSession, GlobalConfig
from app.services.chat import chat_compression
from app.services.chat.chat_compression import (
    _select_messages_to_compress, build_replay_messages, compaction_threshold, estimate_payload_tokens,
    record_real_usage, start_compression,
)
from app.services.chat.ollama_client import DEFAULT_NUM_CTX, MIN_NUM_CTX, get_ollama_config, normalize_num_ctx


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _conversation(db, n_exchanges, size=40):
    session = ChatSession(title="t", role="advisor")
    db.add(session)
    db.commit()
    for i in range(n_exchanges):
        db.add(ChatMessage(session_id=session.id, role="user", content=f"question {i} " + "q" * size))
        db.commit()
        db.add(ChatMessage(session_id=session.id, role="assistant", content=f"réponse {i} " + "r" * size))
        db.commit()
    db.add(ChatMessage(session_id=session.id, role="user", content="question en cours"))
    db.commit()
    msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session.id).order_by(ChatMessage.id).all()
    return session, msgs


CFG = {"url": "http://ollama.test", "model": "m", "num_ctx": 32768, "temperature": 0.3}


def test_context_size_has_a_floor_and_a_single_default(db):
    assert normalize_num_ctx(None) == DEFAULT_NUM_CTX == 32768
    assert normalize_num_ctx("4096") == MIN_NUM_CTX == 16384
    assert normalize_num_ctx("65536") == 65536
    assert get_ollama_config(db)["num_ctx"] == DEFAULT_NUM_CTX
    db.add(GlobalConfig(key="ollama_context", value="8192"))
    db.commit()
    assert get_ollama_config(db)["num_ctx"] == MIN_NUM_CTX


def test_compaction_threshold_is_capped_without_changing_the_context():
    assert compaction_threshold(16384) == 12288
    assert compaction_threshold(32768) == 24576
    assert compaction_threshold(65536) == 32768
    assert compaction_threshold(131072) == 32768


def test_estimate_is_corrected_by_the_real_ollama_count():
    msgs = [{"role": "user", "content": "x" * 3600}]
    raw = estimate_payload_tokens(msgs, None, "calib-model")
    record_real_usage("calib-model", msgs, None, int(raw * 0.8))
    assert estimate_payload_tokens(msgs, None, "calib-model") == pytest.approx(raw * 0.8, rel=0.02)
    # Les autres modèles ne sont pas affectés
    assert estimate_payload_tokens(msgs, None, "other-model") == raw


def test_only_the_latest_summary_is_sent_to_the_model(db):
    session, msgs = _conversation(db, 3)
    session.compressed_context = "RÉSUMÉ 2 (inclut le résumé 1)"
    session.compression_stack = json.dumps([{"context": "RÉSUMÉ 1", "after_id": msgs[1].id}])
    session.last_compressed_message_id = msgs[3].id
    payload = build_replay_messages("SYS", session, msgs)
    system = payload[0]["content"]
    assert "RÉSUMÉ 2" in system and "RÉSUMÉ 1" not in system
    assert [m["content"] for m in payload[1:]] == [m.content for m in msgs[4:]]


def test_replayed_messages_drop_reasoning_and_action_cards(db):
    session, _ = _conversation(db, 0)
    db.add(ChatMessage(session_id=session.id, role="assistant",
                       content="<!-- TOOLS_USED: x -->\n<think>long raisonnement</think>Réponse\n\n```action\n{}\n```"))
    db.commit()
    msgs = db.query(ChatMessage).filter(ChatMessage.session_id == session.id).order_by(ChatMessage.id).all()
    assert build_replay_messages("SYS", session, msgs)[-1]["content"] == "Réponse"


def test_compaction_keeps_the_last_two_exchanges(db):
    session, msgs = _conversation(db, 4)
    to_compress = _select_messages_to_compress(session, msgs, trigger_msg_id=msgs[-1].id)
    # 4 échanges + question en cours : les 2 premiers échanges sont résumés, les 2 derniers restent intacts
    assert to_compress == msgs[:4]


def test_compaction_of_a_short_history_still_summarizes(db):
    session, msgs = _conversation(db, 1)
    assert _select_messages_to_compress(session, msgs, trigger_msg_id=msgs[-1].id) == msgs[:2]


def test_compaction_merges_previous_summary_and_works_in_chunks(db, monkeypatch):
    session, msgs = _conversation(db, 6, size=30000)  # ~8 300 tokens par message
    session.compressed_context = "ANCIEN RÉSUMÉ"
    db.commit()
    prompts = []

    async def fake_summarize(prompt, cfg, num_predict):
        prompts.append(prompt)
        return f"RÉSUMÉ {len(prompts)}", "stop"

    monkeypatch.setattr(chat_compression, "_summarize", fake_summarize)
    result = asyncio.run(start_compression(db, session, msgs, dict(CFG), trigger_msg_id=msgs[-1].id))

    # 8 messages à résumer, trop longs pour une seule requête en 32K : plusieurs morceaux enchaînés
    assert len(prompts) > 1
    assert "ANCIEN RÉSUMÉ" in prompts[0]
    assert f"RÉSUMÉ {len(prompts) - 1}" in prompts[-1]
    assert result == session.compressed_context == f"RÉSUMÉ {len(prompts)}"
    assert session.last_compressed_message_id == msgs[7].id
    # L'ancien résumé est fusionné dans le nouveau : il n'est plus envoyé tel quel
    assert "ANCIEN RÉSUMÉ" not in build_replay_messages("S", session, msgs)[0]["content"]


def test_summary_call_is_async_without_reasoning_and_same_context(monkeypatch):
    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append(body)
        if "think" in body:
            return httpx.Response(400, json={"error": "model does not support thinking"})
        return httpx.Response(200, json={"message": {"content": "<think>x</think>Résumé"}, "done_reason": "stop"})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(chat_compression.httpx, "AsyncClient",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    content, reason = asyncio.run(chat_compression._summarize("p", dict(CFG), num_predict=800))
    assert (content, reason) == ("Résumé", "stop")
    assert seen[0]["think"] is False
    assert all(b["options"]["num_ctx"] == CFG["num_ctx"] for b in seen)
    assert "think" not in seen[1]  # nouvel essai pour un modèle sans mode raisonnement


def test_title_call_disables_reasoning_with_fallback(monkeypatch):
    from app.services.chat import ollama_client
    seen = []

    def fake_post(url, json=None, timeout=None):
        seen.append(dict(json))
        if "think" in json:
            return httpx.Response(400, json={"error": "model does not support thinking"})
        return httpx.Response(200, json={"message": {"content": "Épargne vélo"}})

    monkeypatch.setattr(ollama_client.httpx, "post", fake_post)
    out = ollama_client.call_ollama_sync("p", dict(CFG), extra_options={"num_predict": 30, "think": False})
    assert out == "Épargne vélo"
    assert seen[0]["think"] is False and "think" not in seen[0]["options"]
    assert "think" not in seen[1]


def test_session_messages_endpoint_reports_usage_against_compaction_threshold():
    from fastapi.testclient import TestClient
    from app.main import app
    client = TestClient(app)
    sid = client.post("/api/chat/sessions", json={"title": "t", "role": "advisor"}).json()["id"]
    try:
        usage = client.get(f"/api/chat/sessions/{sid}/messages?lang=en").json()["token_usage"]
        assert usage["limit"] == compaction_threshold(usage["num_ctx"])
        assert 0 < usage["used"] < usage["limit"]
    finally:
        client.delete(f"/api/chat/sessions/{sid}")
