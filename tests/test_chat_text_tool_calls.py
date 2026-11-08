"""Appels d'outils écrits en texte par le modèle, et tour de synthèse forcée sans outils."""
import asyncio
import json

from app.models import ChatMessage
from app.services.chat import chat_orchestrator as orch
from app.services.chat.text_tool_calls import extract_text_tool_calls
from tests.test_chat_generation_robustness import _FakeOllama, gen_env  # noqa: F401 (fixture)

TOOLS = {"get_account_balances", "search_transactions"}


def test_short_form_becomes_a_real_call():
    calls, text = extract_text_tool_calls('Je regarde.\n<tool_call name="get_account_balances"/>', TOOLS)
    assert calls == [{"function": {"name": "get_account_balances", "arguments": {}}}]
    assert text == "Je regarde."


def test_attributes_and_json_bodies_become_arguments():
    calls, _ = extract_text_tool_calls('<tool_call name="search_transactions" query="Netflix"/>', TOOLS)
    assert calls[0]["function"]["arguments"] == {"query": "Netflix"}
    calls, _ = extract_text_tool_calls('<tool_call name="search_transactions">{"query": "EDF"}</tool_call>', TOOLS)
    assert calls[0]["function"]["arguments"] == {"query": "EDF"}
    calls, _ = extract_text_tool_calls(
        '<tool_call>{"name": "search_transactions", "arguments": {"query": "Loyer"}}</tool_call>', TOOLS)
    assert calls == [{"function": {"name": "search_transactions", "arguments": {"query": "Loyer"}}}]


def test_unknown_tool_is_removed_without_a_call():
    calls, text = extract_text_tool_calls('Voici.\n<tool_call name="delete_everything"/>', TOOLS)
    assert calls == [] and text == "Voici."


def test_reasoning_and_plain_text_are_left_alone():
    thinking = '<think>\nje pourrais faire <tool_call name="get_account_balances"/>\n</think>\n\nRéponse.'
    assert extract_text_tool_calls(thinking, TOOLS) == ([], thinking)
    assert extract_text_tool_calls("Rien à signaler.", TOOLS) == ([], "Rien à signaler.")


def _run(monkeypatch, gen_env, fake):  # noqa: F811
    sid, uid, db = gen_env
    monkeypatch.setattr(orch.httpx, "AsyncClient", lambda *a, **k: fake)
    monkeypatch.setattr(orch, "get_account_balances_tool", lambda db: {"accounts": [{"name": "Compte Courant", "balance": 1200}]})
    q = asyncio.Queue()
    asyncio.run(orch._run_generation_task(sid, orch.ChatSendMessage(content="Mes soldes ?", lang="fr"), q, {}, "p", uid))
    screen = ""  # ce que la bulle affiche, comme chat_stream.js : clear_text vide la bulle
    while not q.empty():
        c = q.get_nowait()
        if c and c.startswith("data: {"):
            d = json.loads(c[6:])
            if d.get("clear_text"):
                screen = ""
            screen += d.get("content", "")
    db.expire_all()
    answer = db.query(ChatMessage).filter(ChatMessage.session_id == sid, ChatMessage.role == "assistant").first()
    return screen, answer.content


def test_text_call_is_executed_and_never_shown(monkeypatch, gen_env):  # noqa: F811
    fake = _FakeOllama([
        [{"message": {"content": '<tool_call name="get_account_balances"/>'}, "done": True}],
        [{"message": {"content": "Votre compte courant affiche 1 200 €."}, "done": True}],
    ])
    screen, content = _run(monkeypatch, gen_env, fake)
    tool_msgs = [m for m in fake.payloads[1]["messages"] if m.get("role") == "tool"]
    assert tool_msgs and "1200" in tool_msgs[0]["content"]
    assert "1 200 €" in content
    assert "tool_call" not in content and "tool_call" not in screen


def test_forced_synthesis_is_bounded_and_cleaned(monkeypatch, gen_env):  # noqa: F811
    call = [{"message": {"content": "", "tool_calls": [{"function": {"name": "get_account_balances", "arguments": {}}}]}},
            {"message": {"content": ""}, "done": True}]
    synth = [{"message": {"content": 'Vous avez 1 200 €.\n<tool_call name="get_account_balances"/>'}, "done": True}]
    fake = _FakeOllama([call] * orch_max_iterations() + [synth])
    screen, content = _run(monkeypatch, gen_env, fake)
    last = fake.payloads[-1]
    assert "tools" not in last
    assert last["think"] is False
    assert last["options"]["num_predict"] == orch.SYNTHESIS_MAX_TOKENS
    assert "1 200 €" in content
    assert "tool_call" not in content and "tool_call" not in screen


def orch_max_iterations():
    return 4  # MAX_TOOL_ITERATIONS, local à la boucle du conseiller


class _NoThinkingModel(_FakeOllama):
    """Modèle sans mode raisonnement : Ollama refuse « think » avec une erreur HTTP 400."""
    def stream(self, method, url, json=None, timeout=None):
        if "think" not in json:
            return super().stream(method, url, json=json, timeout=timeout)
        self.payloads.append(json)

        class _Refused:
            status_code = 400

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def aread(self):
                return b'{"error":"\\"m\\" does not support thinking"}'
        return _Refused()


def test_model_without_thinking_is_retried_without_the_setting(monkeypatch, gen_env):  # noqa: F811
    monkeypatch.setattr(orch, "get_ollama_config", lambda db: {
        "enabled": True, "url": "http://x", "model": "m", "temperature": 0.2, "num_ctx": 32768, "think": False})
    fake = _NoThinkingModel([[{"message": {"content": "Bonjour."}, "done": True}]])
    screen, content = _run(monkeypatch, gen_env, fake)
    assert [("think" in p) for p in fake.payloads] == [True, False]
    assert content.strip() == "Bonjour." and "Erreur" not in screen
