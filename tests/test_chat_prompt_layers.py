"""Prompt système en couches : personnalité modifiable, règles fixes neutres, aperçu de Configuration."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, GlobalConfig
from app.services.chat import chat_prompt
from app.services.chat.chat_prompt import (
    DEFAULT_PERSONALITY, ROLE_MISSIONS, build_system_prompt_layers, load_system_prompt, rules_block,
)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


# Data from a real profile that used to be hard-coded as examples in the prompt
PERSONAL_SNIPPETS = ["CA Centre-Est", "Remboursement Papa", "Wordpress", "2 520", "template_id=63", "Impôts 413", "Audible"]


@pytest.mark.parametrize("role", list(ROLE_MISSIONS))
def test_fixed_layers_contain_no_personal_data(role):
    text = DEFAULT_PERSONALITY + ROLE_MISSIONS[role] + rules_block(role, "fr")
    for snippet in PERSONAL_SNIPPETS:
        assert snippet.lower() not in text.lower(), (role, snippet)


def test_french_uses_vous_and_hides_internal_names():
    rules = rules_block("advisor", "fr")
    assert "« vous »" in rules and "never « tu »" in rules
    assert "Never show the user internal names" in rules
    assert "Never announce a check you are not doing" in rules
    assert "« vous »" not in rules_block("advisor", "en")


def test_actions_only_on_request():
    rules = rules_block("advisor", "fr")
    assert "Prepare an action only when the user asks for a change or agrees to one you offered" in rules
    assert "MUST systematically" not in rules


def test_personality_is_editable_and_falls_back_to_default(db):
    assert load_system_prompt(db=db).startswith(DEFAULT_PERSONALITY)
    db.add(GlobalConfig(key=chat_prompt.PERSONALITY_CONFIG_KEY, value="Tu es un assistant très bref."))
    db.commit()
    prompt = load_system_prompt(db=db)
    assert prompt.startswith("Tu es un assistant très bref.")
    assert DEFAULT_PERSONALITY not in prompt
    # The fixed rules stay whatever the personality says
    assert "WRITE ACTIONS RULE" in prompt


def test_layers_order_and_prompt_equals_their_join(db):
    layers = build_system_prompt_layers("forecaster", [], "fr", db=db)
    assert [l["id"] for l in layers] == ["personality", "role", "rules", "guide", "context"]
    assert load_system_prompt("forecaster", [], "fr", db=db) == "\n\n".join(l["text"] for l in layers)
    assert "CURRENT DATE" in layers[-1]["text"]


def test_unknown_role_uses_advisor():
    assert build_system_prompt_layers("nope")[1]["text"] == ROLE_MISSIONS["advisor"]


def test_preview_endpoint(db):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db

    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        _check_preview(client)
    finally:
        app.dependency_overrides.pop(get_db, None)


def _check_preview(client):
    res = client.get("/api/chat/prompt/preview?role=auditor&lang=fr")
    assert res.status_code == 200
    data = res.json()
    assert [l["id"] for l in data["layers"]] == ["personality", "role", "rules", "guide", "context"]
    assert data["prompt_tokens"] > 0 and data["tools_tokens"] > 0
    assert client.get("/api/chat/prompt/personality-default").json()["default"] == DEFAULT_PERSONALITY


def test_interface_guide_is_editable_with_default(db):
    from app.services.chat.chat_prompt import DEFAULT_APP_GUIDE, APP_GUIDE_CONFIG_KEY
    assert DEFAULT_APP_GUIDE in load_system_prompt(db=db)
    db.add(GlobalConfig(key=APP_GUIDE_CONFIG_KEY, value="GUIDE PERSO : tout est dans Cockpit."))
    db.commit()
    prompt = load_system_prompt(db=db)
    assert "GUIDE PERSO" in prompt and DEFAULT_APP_GUIDE not in prompt


@pytest.mark.parametrize("question", [
    "Quelle est ma prochaine grosse dépense et où en sont mes comptes ?",
    "Mon budget transport coince ce mois-ci",
    "Crée une enveloppe budget vacances à 200 €",
])
def test_questions_about_own_data_do_not_pull_documentation(question):
    from app.services.chat.knowledge_service import resolve_relevant_knowledge
    assert resolve_relevant_knowledge(question) is None


@pytest.mark.parametrize("question", [
    "Comment marche le rapprochement ?",
    "C'est quoi une enveloppe dynamique ?",
])
def test_how_it_works_questions_get_documentation(question):
    from app.services.chat.knowledge_service import resolve_relevant_knowledge
    assert resolve_relevant_knowledge(question) is not None


def test_follow_up_keeps_the_topic_of_the_conversation(db):
    from app.models import ChatSession, ChatMessage
    s = ChatSession(role="advisor", title="t")
    db.add(s)
    db.commit()
    for content in ("Comment fonctionne l'auto-pilote ?", "Et pour les opérations déjà rapprochées ?"):
        db.add(ChatMessage(session_id=s.id, role="user", content=content))
        db.commit()
    follow_up = "Et pour les opérations déjà rapprochées ?"
    prompt = load_system_prompt(db=db, session_id=s.id, user_query=follow_up)
    assert "AUTO-PILOTE" in prompt.upper() and "AUTHORITATIVE OMNIBANK APPLICATION RULES" in prompt
    # Same follow-up in a fresh conversation: no documentation
    s2 = ChatSession(role="advisor", title="t2")
    db.add(s2)
    db.commit()
    db.add(ChatMessage(session_id=s2.id, role="user", content=follow_up))
    db.commit()
    assert "AUTHORITATIVE OMNIBANK APPLICATION RULES" not in load_system_prompt(db=db, session_id=s2.id, user_query=follow_up)
