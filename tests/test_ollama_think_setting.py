"""Réglage « Laisser le modèle réfléchir » : activé par défaut (rien envoyé à Ollama), désactivé = think=False."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import GlobalConfig
from app.services.chat.ollama_client import get_ollama_config


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_thinking_is_on_by_default(client, db_session):
    assert get_ollama_config(db_session)["think"] is True
    assert client.get("/api/config/").json()["ollama_think"] == "true"


@pytest.mark.parametrize("value, expected", [("false", False), ("true", True)])
def test_saved_value_is_read(db_session, value, expected):
    db_session.add(GlobalConfig(key="ollama_think", value=value))
    db_session.commit()
    assert get_ollama_config(db_session)["think"] is expected
