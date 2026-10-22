"""
Tests pour le support des variantes de réponses et la navigation multi-versions sur les messages du chat.
"""
import json
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import ChatMessage, ChatSession


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


def test_chat_message_variant_model_methods(test_db):
    session = ChatSession(title="Test Session", role="advisor")
    test_db.add(session)
    test_db.commit()

    msg = ChatMessage(session_id=session.id, role="assistant", content="Version 1 initiale")
    test_db.add(msg)
    test_db.commit()

    # Quand variants est None, get_variants_list retourne 1 variante par défaut
    v_list = msg.get_variants_list()
    assert len(v_list) == 1
    assert v_list[0]["content"] == "Version 1 initiale"
    assert v_list[0]["origin"] == "initial"

    # Ajout d'une 2ème variante
    v_list.append({"content": "Version 2 affinée", "origin": "regenerated"})
    msg.variants = json.dumps(v_list)
    test_db.commit()

    # Bascule vers variante 1
    success = msg.set_active_variant(1)
    assert success is True
    assert msg.active_variant_index == 1
    assert msg.content == "Version 2 affinée"

    # Tentative d'accès à un index hors bornes
    assert msg.set_active_variant(99) is False
    assert msg.active_variant_index == 1


def test_switch_and_delete_variant_endpoints(test_db):
    client = TestClient(app)

    session = ChatSession(title="Session Variantes", role="advisor")
    test_db.add(session)
    test_db.commit()

    variants = [
        {"content": "Réponse version 1", "origin": "initial"},
        {"content": "Réponse version 2 enrichie", "origin": "regenerated"},
        {"content": "Réponse version 3 optimisée", "origin": "auto_correction"},
    ]
    msg = ChatMessage(
        session_id=session.id,
        role="assistant",
        content="Réponse version 1",
        variants=json.dumps(variants),
        active_variant_index=0
    )
    test_db.add(msg)
    test_db.commit()

    # 1. Tester la récupération via get_session_messages
    res_get = client.get(f"/api/chat/sessions/{session.id}/messages")
    assert res_get.status_code == 200
    data = res_get.json()
    assert len(data["messages"]) == 1
    m_data = data["messages"][0]
    assert m_data["active_variant_index"] == 0
    assert len(m_data["variants"]) == 3

    # 2. Basculer vers la variante 1 (version 2)
    res_switch = client.patch(f"/api/chat/messages/{msg.id}/variant", json={"variant_index": 1})
    assert res_switch.status_code == 200
    switch_data = res_switch.json()
    assert switch_data["ok"] is True
    assert switch_data["active_variant_index"] == 1
    assert switch_data["content"] == "Réponse version 2 enrichie"

    # Vérifier persistance en DB
    test_db.refresh(msg)
    assert msg.active_variant_index == 1
    assert msg.content == "Réponse version 2 enrichie"

    # 3. Supprimer la variante à l'index 0
    res_del = client.delete(f"/api/chat/messages/{msg.id}/variants/0")
    assert res_del.status_code == 200
    del_data = res_del.json()
    assert del_data["ok"] is True
    assert del_data["variants_count"] == 2
    # L'index actif a été réajusté de 1 vers 0 car index 0 a été supprimé
    assert del_data["active_variant_index"] == 0
    assert del_data["content"] == "Réponse version 2 enrichie"

    # 4. Supprimer encore une variante (il n'en reste plus qu'1)
    res_del_2 = client.delete(f"/api/chat/messages/{msg.id}/variants/1")
    assert res_del_2.status_code == 200
    assert res_del_2.json()["variants_count"] == 1

    # 5. Tentative de suppression de la dernière variante restante -> doit renvoyer 400
    res_del_fail = client.delete(f"/api/chat/messages/{msg.id}/variants/0")
    assert res_del_fail.status_code == 400
    assert "Impossible de supprimer la seule version existante" in res_del_fail.json()["detail"]
