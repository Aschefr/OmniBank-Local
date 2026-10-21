import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app as fastapi_app
from app.services.chat.chat_compression import extract_fallback_title, clean_llm_title
from app.models import ChatSession, ChatMessage


def test_clean_llm_title_deepseek_r1_tags():
    raw = "<think>\nLet's produce a 3-word title in French\n</think>\n**Analyse du budget**."
    cleaned = clean_llm_title(raw)
    assert cleaned == "Analyse du budget"


def test_clean_llm_title_prefixes_and_quotes():
    raw = 'Titre : "Évolution des dépenses"'
    assert clean_llm_title(raw) == "Évolution des dépenses"

    raw_en = 'Title: Savings Overview'
    assert clean_llm_title(raw_en) == "Savings Overview"


def test_clean_llm_title_word_and_char_limits():
    raw = "Ceci est un titre beaucoup trop long qui dépasse largement la limite autorisée de cinq mots"
    cleaned = clean_llm_title(raw)
    words = cleaned.split()
    assert len(words) <= 5
    assert len(cleaned) <= 45


def test_extract_fallback_title_deep_dive_context():
    hint = "Bilan mensuel Octobre 2026 - Risque de découvert"
    title = extract_fallback_title("Que dois-je faire ?", context_hint=hint)
    assert "Bilan" in title
    assert "Approfondissement" in title or "Octobre" in title
    assert len(title) <= 45


def test_extract_fallback_title_heuristics():
    assert "reste à vivre" in extract_fallback_title("calcule mon reste a vivre").lower()
    assert "solde" in extract_fallback_title("combien de solde sur mes comptes").lower()
    assert "abonnement" in extract_fallback_title("audit de mes abonnements svp").lower()
    assert "virement" in extract_fallback_title("faire un virement entre comptes").lower()


def test_session_ordering_by_last_activity():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db

    db = TestingSessionLocal()
    # Create two sessions
    session1 = ChatSession(title="Old Session", role="assistant")
    session2 = ChatSession(title="Recent Session", role="assistant")
    db.add(session1)
    db.add(session2)
    db.commit()

    s1_id = session1.id
    s2_id = session2.id

    now = datetime.now()
    # session1 gets a message now + 1 hour (more recent activity)
    msg1 = ChatMessage(session_id=s1_id, role="user", content="hello session 1", timestamp=now + timedelta(hours=1))
    # session2 gets a message now (less recent activity)
    msg2 = ChatMessage(session_id=s2_id, role="user", content="hello session 2", timestamp=now)
    db.add(msg1)
    db.add(msg2)
    db.commit()
    db.close()

    client = TestClient(fastapi_app)
    resp = client.get("/api/chat/sessions")
    assert resp.status_code == 200
    sessions = resp.json()
    assert len(sessions) >= 2

    # Find the positions of session1 and session2
    ids = [s["id"] for s in sessions]
    idx1 = ids.index(s1_id)
    idx2 = ids.index(s2_id)

    # session1 must come before session2 because of more recent activity
    assert idx1 < idx2
    assert "last_activity_at" in sessions[0]

    fastapi_app.dependency_overrides.clear()


def test_regenerate_session_title_endpoint():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db

    db = TestingSessionLocal()
    session = ChatSession(title="Placeholder", role="assistant")
    db.add(session)
    db.commit()
    sess_id = session.id

    msg = ChatMessage(session_id=sess_id, role="user", content="Peux-tu faire un audit de mes abonnements ?")
    db.add(msg)
    db.commit()
    db.close()

    client = TestClient(fastapi_app)
    resp = client.post(f"/api/chat/sessions/{sess_id}/regenerate-title")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == sess_id
    assert "abonnement" in data["title"].lower()

    fastapi_app.dependency_overrides.clear()


def test_bulk_delete_sessions():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    fastapi_app.dependency_overrides[get_db] = override_get_db

    db = TestingSessionLocal()
    s1 = ChatSession(title="S1", role="assistant")
    s2 = ChatSession(title="S2", role="assistant")
    s3 = ChatSession(title="S3", role="assistant")
    db.add_all([s1, s2, s3])
    db.commit()
    s1_id, s2_id, s3_id = s1.id, s2.id, s3.id
    db.close()

    client = TestClient(fastapi_app)
    resp = client.post("/api/chat/sessions/bulk-delete", json={"session_ids": [s1_id, s2_id]})
    assert resp.status_code == 200
    assert resp.json()["deleted_count"] == 2

    # Check remaining sessions
    resp2 = client.get("/api/chat/sessions")
    remaining_ids = [s["id"] for s in resp2.json()]
    assert s1_id not in remaining_ids
    assert s2_id not in remaining_ids
    assert s3_id in remaining_ids

    fastapi_app.dependency_overrides.clear()


def test_generating_and_stop_endpoints():
    client = TestClient(fastapi_app)
    # Check generating status
    resp = client.get("/api/chat/sessions/999/generating")
    assert resp.status_code == 200
    assert resp.json()["generating"] is False

    # Check stop endpoint
    resp = client.post("/api/chat/sessions/999/stop")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert resp.json()["stopped"] is False



