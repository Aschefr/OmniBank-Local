"""Robustesse de la boucle de génération : fusion des tours, outil en échec, raisonnement non rejoué."""
import asyncio
import re
import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, ChatSession, ChatMessage
from app.services.chat import chat_orchestrator as orch
from app.services.chat.chat_orchestrator import merge_phase_texts


def test_merge_skips_paragraphs_already_written():
    first = "### Diagnostic\n\nVotre reste à vivre est de **120 €**.\n\nDeux enveloppes dépassent."
    second = "Votre reste à vivre est de 120 € !\n\nLa prochaine paie arrive le 29."
    merged = merge_phase_texts(first, second)
    assert merged.count("reste à vivre") == 1
    assert merged.endswith("La prochaine paie arrive le 29.")


def test_merge_full_restatement_keeps_single_copy():
    text = "Paragraphe A.\n\nParagraphe B."
    assert merge_phase_texts(text, text) == text
    assert merge_phase_texts("", "Réponse") == "Réponse"
    assert merge_phase_texts("Analyse", "") == "Analyse"


class _FakeOllama:
    """Ollama simulé au niveau HTTP : tour 1 = raisonnement + appel d'outil, tour 2 = réponse."""
    def __init__(self, turns):
        self.turns = turns
        self.payloads = []

    def stream(self, method, url, json=None, timeout=None):
        self.payloads.append(json)
        lines = self.turns[min(len(self.payloads), len(self.turns)) - 1]
        outer = self

        class _Resp:
            status_code = 200

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def aiter_lines(self):
                for l in lines:
                    yield _json.dumps(l)
        return _Resp()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


_json = json

TURNS = [
    [{"message": {"thinking": "je réfléchis"}},
     {"message": {"content": "", "tool_calls": [{"function": {"name": "get_account_balances", "arguments": {}}}]}},
     {"message": {"content": ""}, "done": True}],
    [{"message": {"content": "Réponse finale."}, "done": True}],
]


@pytest.fixture
def gen_env(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr(orch, "get_engine", lambda pid: engine)
    monkeypatch.setattr(orch, "get_ollama_config", lambda db: {
        "enabled": True, "url": "http://x", "model": "m", "temperature": 0.2, "num_ctx": 32768})
    monkeypatch.setattr(orch, "load_system_prompt", lambda *a, **k: "SYSTEM")
    monkeypatch.setattr(orch, "build_entity_snapshots", lambda *a, **k: None)

    class _NoThread:
        def __init__(self, *a, **k):
            pass

        def start(self):
            pass
    monkeypatch.setattr(orch.threading, "Thread", _NoThread)
    db = sessionmaker(bind=engine)()
    s = ChatSession(role="advisor", title="Test")
    db.add(s)
    db.commit()
    u = ChatMessage(session_id=s.id, role="user", content="Mes soldes ?")
    db.add(u)
    db.commit()
    yield s.id, u.id, db
    db.close()


def _generate(monkeypatch, gen_env, tool_impl):
    sid, uid, db = gen_env
    fake = _FakeOllama(TURNS)
    monkeypatch.setattr(orch.httpx, "AsyncClient", lambda *a, **k: fake)
    monkeypatch.setattr(orch, "get_account_balances_tool", tool_impl)
    q = asyncio.Queue()
    req = orch.ChatSendMessage(content="Mes soldes ?", lang="fr")
    asyncio.run(orch._run_generation_task(sid, req, q, {}, "p", uid))
    events = []
    while not q.empty():
        c = q.get_nowait()
        if c:
            events.append(c)
    db.expire_all()
    answer = db.query(ChatMessage).filter(ChatMessage.session_id == sid, ChatMessage.role == "assistant").first()
    return fake, events, answer


def test_failing_tool_does_not_abort_the_answer(monkeypatch, gen_env):
    def boom(db):
        raise ValueError("NoneType has no attribute balance")
    fake, events, answer = _generate(monkeypatch, gen_env, boom)
    assert answer is not None and "Réponse finale." in answer.content
    assert not any('"error"' in e for e in events), events
    tool_msgs = [m for m in fake.payloads[1]["messages"] if m.get("role") == "tool"]
    assert json.loads(tool_msgs[0]["content"])["error"] == "tool_failed"
    assert "NoneType" not in tool_msgs[0]["content"]


def test_reasoning_is_not_sent_back_to_the_model(monkeypatch, gen_env):
    fake, events, answer = _generate(monkeypatch, gen_env, lambda db: {"accounts": []})
    assistant_turn = [m for m in fake.payloads[1]["messages"] if m.get("role") == "assistant"][0]
    assert "<think>" not in assistant_turn["content"]
    assert "je réfléchis" not in assistant_turn["content"]


def test_no_guessed_action_when_model_already_called_one(monkeypatch, gen_env):
    """Live case: transfer prepared by the model, prose mentions the earlier bridge -> no extra reversed card."""
    sid, uid, db = gen_env
    turns = [
        [{"message": {"content": "", "tool_calls": [{"function": {"name": "create_planned_transfer", "arguments": {
            "from_account": "Compte Courant", "to_account": "Livret A", "amount": 250, "date_operation": "2026-11-30"}}}]}},
         {"message": {"content": ""}, "done": True}],
        [{"message": {"content": "J'ai préparé l'enregistrement du virement de précaution de 250 € depuis votre Livret A "
                                 "vers votre Compte Courant. Veuillez l'examiner et le valider ci-dessous."}, "done": True}],
    ]
    fake = _FakeOllama(turns)
    monkeypatch.setattr(orch.httpx, "AsyncClient", lambda *a, **k: fake)
    monkeypatch.setattr(orch, "create_planned_transfer_tool", lambda db, **k: {"status": "pending_validation"})
    q = asyncio.Queue()
    asyncio.run(orch._run_generation_task(sid, orch.ChatSendMessage(content="x", lang="fr"), q, {}, "p", uid))
    db.expire_all()
    answer = db.query(ChatMessage).filter(ChatMessage.session_id == sid, ChatMessage.role == "assistant").first()
    assert answer.content.count("```action") == 1


PROMISE = ("J'ai préparé un virement de 250 € de votre Compte Courant vers votre Livret A, prévu le 30 novembre. "
           "Vous pouvez l'examiner et la valider ci-dessous.")


def _run_turns(monkeypatch, gen_env, turns):
    sid, uid, db = gen_env
    fake = _FakeOllama(turns)
    monkeypatch.setattr(orch.httpx, "AsyncClient", lambda *a, **k: fake)
    monkeypatch.setattr(orch, "create_planned_transfer_tool", lambda db, **k: {"status": "pending_validation"})
    q = asyncio.Queue()
    asyncio.run(orch._run_generation_task(sid, orch.ChatSendMessage(content="Oui, enregistrez-le.", lang="fr"), q, {}, "p", uid))
    streamed = ""
    while not q.empty():
        c = q.get_nowait()
        if c and c.startswith("data: {"):
            streamed += json.loads(c[6:]).get("content", "")
    db.expire_all()
    answer = db.query(ChatMessage).filter(ChatMessage.session_id == sid, ChatMessage.role == "assistant").first()
    return fake, streamed, answer.content


def test_promised_action_without_call_is_requested_from_the_model(monkeypatch, gen_env):
    turns = [
        [{"message": {"content": PROMISE}, "done": True}],
        [{"message": {"content": "", "tool_calls": [{"function": {"name": "create_planned_transfer", "arguments": {
            "from_account": "Compte Courant", "to_account": "Livret A", "amount": 250, "date_operation": "2026-11-30"}}}]}},
         {"message": {"content": "Texte de relance à ne pas afficher"}, "done": True}],
    ]
    fake, streamed, content = _run_turns(monkeypatch, gen_env, turns)
    assert len(fake.payloads) == 2
    assert "[Message automatique]" in fake.payloads[1]["messages"][-1]["content"]
    actions = re.findall(r"```action\s*(.*?)\s*```", content, re.S)
    assert len(actions) == 1
    params = json.loads(actions[0])["params"]
    assert (params["from_account"], params["to_account"], params["date_operation"]) == ("Compte Courant", "Livret A", "2026-11-30")
    assert content.count("J'ai préparé") == 1
    assert "relance" not in content and "relance" not in streamed


def test_promised_action_still_not_called_gets_a_notice_not_a_guess(monkeypatch, gen_env):
    turns = [
        [{"message": {"content": PROMISE}, "done": True}],
        [{"message": {"content": "D'accord."}, "done": True}],
    ]
    fake, streamed, content = _run_turns(monkeypatch, gen_env, turns)
    assert "```action" not in content
    assert "n'a pas pu être préparée" in content
    assert "D'accord." not in content
