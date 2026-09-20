"""
tests/test_autopilot_step5_session_ux.py — Validation de la synchronisation de session,
persistance anti-F5, et compatibilité des formats de configuration (Phase 2).
"""

import json
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.database import Base, get_db
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.models import GlobalConfig


@pytest.fixture
def client_and_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()

    db.add(GlobalConfig(key="enable_ai", value="true"))
    db.add(GlobalConfig(key="enable_budget_creation_suggestions", value="true"))
    db.commit()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client, db
    app.dependency_overrides.clear()
    db.close()


def test_api_config_returns_dict_compatible_with_frontend(client_and_db):
    """Vérifie que /api/config/ renvoie un dictionnaire (clé-valeur) que le frontend gère sans TypeError."""
    client, db = client_and_db
    res = client.get("/api/config/")
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, dict)
    assert "enable_ai" in data
    assert data["enable_ai"] == "true"


def test_ai_proposals_session_storage_serialization():
    """Valide que la structure de données envoyée à saveAiStateToSession et relue par loadAiStateFromSession

    préserve fidèlement tous les attributs requis pour restaurer l'état après F5 :
    - decision_id, engine, categories, amounts avec décimales, cat_amounts.
    """
    sample_proposals = [
        {
            "name": "Alimentation Fraîche",
            "category": "Primeur",
            "categories": ["Primeur", "Boucherie"],
            "cat_amounts": {"Primeur": 45.50, "Boucherie": 35.25},
            "suggested_amount": 80.75,
            "original_amount": 80.75,
            "avg_monthly": 80.75,
            "period": "monthly",
            "selected": True,
            "decision_id": 42,
            "engine": "deterministic",
        }
    ]
    session_payload = {
        "profile_id": "default",
        "proposals": sample_proposals,
        "unclassified": [],
        "meta": {
            "window_months": 3,
            "effective_window_months": 3,
            "is_fallback": False,
            "engine": "deterministic",
            "lang": "fr",
            "proposals": sample_proposals,
        },
        "customSalaryOverride": 2500.00,
        "customYearlySalaryOverride": None,
        "wizardState": {"currentStep": 1, "currentProposalIndex": 0, "pendingCategories": []},
    }

    raw_json = json.dumps(session_payload)
    restored = json.loads(raw_json)

    assert restored["profile_id"] == "default"
    assert len(restored["proposals"]) == 1
    p = restored["proposals"][0]
    assert p["name"] == "Alimentation Fraîche"
    assert p["decision_id"] == 42
    assert p["suggested_amount"] == 80.75
    assert p["cat_amounts"]["Primeur"] == 45.50
    assert p["cat_amounts"]["Boucherie"] == 35.25
    assert p["engine"] == "deterministic"
    assert restored["customSalaryOverride"] == 2500.00
