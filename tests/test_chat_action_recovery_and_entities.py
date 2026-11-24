import pytest
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import json as _json
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.models import ChatMessage, ChatSession, Account, RecurrenceTemplate, Transaction
from app.services.chat.chat_snapshot import build_entity_snapshots
from app.main import app


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield db
    finally:
        db.close()
        app.dependency_overrides.pop(get_db, None)


def test_build_entity_snapshots_includes_recurrence_and_transaction(test_db):
    acc = Account(name="Banque Populaire", type="checking", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    rec = RecurrenceTemplate(
        description="Abonnement Fibre Test",
        amount=39.99,
        category="Abonnements",
        frequency="Monthly",
        day_of_month=5,
        type="expense_fixed",
        from_account_id=acc.id
    )
    tx = Transaction(
        description="Garage Express Test",
        amount=-150.0,
        category="Automobile",
        date_operation=date(2026, 10, 15),
        from_account_id=acc.id
    )
    test_db.add_all([rec, tx])
    test_db.commit()

    text = "Votre abonnement Abonnement Fibre Test a été prélevé et la facture Garage Express Test est réglée."
    snapshots = build_entity_snapshots(
        final_text=text,
        db=test_db,
        year=2026,
        month=10
    )

    assert "recurrence:Abonnement Fibre Test" in snapshots
    rec_snap = snapshots["recurrence:Abonnement Fibre Test"]
    assert rec_snap["type"] == "recurrence"
    assert rec_snap["amount"] == 39.99
    assert rec_snap["from_account"] == "Banque Populaire"

    assert "transaction:Garage Express Test" in snapshots
    tx_snap = snapshots["transaction:Garage Express Test"]
    assert tx_snap["type"] == "transaction"
    assert tx_snap["amount"] == -150.0
    assert tx_snap["category"] == "Automobile"


def _fake_ollama(monkeypatch, response_message, seen, json_answers=()):
    """Ollama simulé : répond à la relance avec le message donné (appels d'outils), puis aux demandes en JSON
    structuré (paramètre format) avec json_answers, dans l'ordre."""
    import httpx
    from app.services.chat import chat_orchestrator as orch
    answers = list(json_answers)

    def handler(request):
        body = _json.loads(request.content)
        seen.append(body)
        if "format" in body:
            answer = answers.pop(0) if answers else {}
            return httpx.Response(200, json={"message": {"content": _json.dumps(answer)}, "done": True})
        return httpx.Response(200, json={"message": response_message, "done": True})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(orch.httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(orch, "get_ollama_config", lambda db: {
        "enabled": True, "url": "http://ollama.test", "model": "m", "temperature": 0.2, "num_ctx": 32768})
    monkeypatch.setattr(orch, "load_system_prompt", lambda *a, **k: "SYSTEM")


def _promise_message(db, role="advisor"):
    sess = ChatSession(title="Récupération", role=role)
    db.add(sess)
    db.commit()
    db.add(ChatMessage(session_id=sess.id, role="user", content="Remets 150 € du livret sur le compte courant."))
    db.commit()
    msg = ChatMessage(session_id=sess.id, role="assistant", content=(
        "J'ai préparé un virement de 150 € du Livret vers le compte courant, à valider ci-dessous."
        "\n\n*(⚠️ L'action annoncée n'a pas pu être préparée. Redemandez-la pour obtenir la carte de validation.)*"))
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def test_recover_actions_asks_the_model_instead_of_guessing(test_db, monkeypatch):
    seen = []
    call = {"function": {"name": "create_planned_transfer",
                         "arguments": {"from_account": "Livret", "to_account": "Compte courant", "amount": 150}}}
    _fake_ollama(monkeypatch, {"content": "", "tool_calls": [call]}, seen)
    msg = _promise_message(test_db)

    data = TestClient(app).post(f"/api/chat/messages/{msg.id}/recover-actions?lang=fr").json()

    assert data["ok"] is True and len(data["actions"]) == 1
    action = data["actions"][0]
    assert action["action"] == "create_planned_transfer" and action["params"]["amount"] == 150
    assert action["params"]["category"] == "Virement interne"  # même conversion que pendant la génération
    # La relance porte sur la conversation jusqu'à ce message, avec uniquement les outils d'écriture
    sent = seen[0]
    assert sent["messages"][-1]["role"] == "user" and "aucun outil n'a été appelé" in sent["messages"][-1]["content"]
    assert sent["messages"][-2]["role"] == "assistant"
    assert {t["function"]["name"] for t in sent["tools"]} >= {"create_planned_transfer"}
    assert "get_account_balances" not in {t["function"]["name"] for t in sent["tools"]}
    # Carte ajoutée au message, avis « non préparée » retiré
    test_db.refresh(msg)
    assert "```action" in msg.content and "n'a pas pu être préparée" not in msg.content


def test_recover_actions_fills_the_announced_action_as_json(test_db, monkeypatch):
    """Le modèle répond encore en texte à la relance : il remplit alors l'action annoncée en JSON structuré."""
    test_db.add_all([Account(name="Compte courant", type="checking"), Account(name="Livret", type="savings")])
    test_db.commit()
    seen = []
    transfer = {"from_account": "Livret", "to_account": "Compte courant", "amount": 150}
    _fake_ollama(monkeypatch, {"content": "Je vais maintenant préparer le virement."}, seen,
                 [{"actions": ["create_planned_transfer"]}, transfer])
    msg = _promise_message(test_db)

    data = TestClient(app).post(f"/api/chat/messages/{msg.id}/recover-actions?lang=fr").json()

    assert data["ok"] is True and [a["action"] for a in data["actions"]] == ["create_planned_transfer"]
    assert {k: data["actions"][0]["params"][k] for k in transfer} == transfer
    pick, fill = [b for b in seen if "format" in b]
    # La demande et la réponse annoncée servent de contexte, sans l'avis « non préparée »
    prompt = pick["messages"][0]["content"]
    assert "Remets 150 € du livret" in prompt and "J'ai préparé un virement de 150 €" in prompt
    assert "n'a pas pu être préparée" not in prompt
    assert fill["format"]["properties"]["to_account"]["enum"] == ["Compte courant", "Livret"]
    test_db.refresh(msg)
    assert "```action" in msg.content and "n'a pas pu être préparée" not in msg.content


def test_recover_actions_only_fills_creations_named_by_existing_names():
    """Rien qui vise un élément par son identifiant (invisible ici) ni aucune suppression."""
    from app.services.chat.announced_action_fill import FILLABLE_ACTIONS, _is_complete
    from app.services.chat.tools import TOOL_MAP
    for name in FILLABLE_ACTIONS:
        props = TOOL_MAP[name]["function"]["parameters"]["properties"]
        assert not any(k.endswith("_id") for k in props), name
        assert not name.startswith("delete_"), name
    assert not _is_complete("create_planned_transfer", {"from_account": "A", "to_account": "A", "amount": 10})
    assert not _is_complete("create_planned_transfer", {"from_account": "A", "to_account": "B", "amount": 0})
    assert not _is_complete("create_planned_transfer", {"from_account": "A", "amount": 10})
    assert _is_complete("create_planned_transfer", {"from_account": "A", "to_account": "B", "amount": 10})


def test_recover_actions_without_tool_call_adds_nothing(test_db, monkeypatch):
    _fake_ollama(monkeypatch, {"content": "Je ne peux pas."}, [], [{"actions": ["none"]}])
    msg = _promise_message(test_db)
    before = msg.content

    data = TestClient(app).post(f"/api/chat/messages/{msg.id}/recover-actions").json()

    assert data["ok"] is False and data["actions"] == []
    test_db.refresh(msg)
    assert msg.content == before


def test_recover_actions_offers_actions_the_role_does_not_have(test_db, monkeypatch):
    """Une conversation « Simulation de projet » n'a aucun outil d'écriture : le modèle peut quand même avoir annoncé
    un virement. La récupération lui propose toutes les actions, chaque carte restant à valider."""
    seen = []
    call = {"function": {"name": "create_planned_transfer",
                         "arguments": {"from_account": "Compte courant", "to_account": "Livret", "amount": 500}}}
    _fake_ollama(monkeypatch, {"content": "", "tool_calls": [call]}, seen)
    msg = _promise_message(test_db, role="simulator")

    data = TestClient(app).post(f"/api/chat/messages/{msg.id}/recover-actions?lang=fr").json()

    assert data["ok"] is True and data["actions"][0]["action"] == "create_planned_transfer"
    from app.services.chat.chat_orchestrator import WRITE_TOOLS
    assert {t["function"]["name"] for t in seen[0]["tools"]} == WRITE_TOOLS
