"""Modèles recommandés : la liste, ses réglages, et les routes qui la servent (sans réseau)."""
import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import GlobalConfig
from app.routers import config as config_router
from app.services import ai_model_catalog as catalog
from app.services.chat.ollama_client import MIN_NUM_CTX


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def run(coro):
    return asyncio.run(coro)


def test_one_model_per_tier_with_usable_settings():
    tiers = [m["tier"] for m in catalog.CATALOG]
    assert sorted(tiers) == ["minimum", "recommended", "top"]
    for m in catalog.CATALOG:
        assert 0 <= m["temperature"] <= 1
        assert m["num_ctx"] >= MIN_NUM_CTX, "under the app's minimum context, Ollama would reload the model"
        assert m["size_gb"] > 0 and m["vram_gb"] > 0 and m["typical_seconds"] > 0


def test_catalog_without_url_lists_the_models_as_not_installed(db):
    res = run(config_router.get_ollama_catalog(db=db))
    assert res["downloadable"] is False
    assert [m["name"] for m in res["models"]] == [m["name"] for m in catalog.CATALOG]
    assert not any(m["installed"] for m in res["models"])


def test_catalog_marks_installed_models(db, monkeypatch):
    db.add(GlobalConfig(key="ollama_url", value="http://ollama.test:11434"))
    db.commit()
    first = catalog.CATALOG[0]["name"]

    async def yes(url):
        return True

    async def installed(url):
        return {first}

    monkeypatch.setattr(catalog, "is_ollama", yes)
    monkeypatch.setattr(catalog, "installed_models", installed)
    res = run(config_router.get_ollama_catalog(db=db))
    assert res["downloadable"] is True
    assert {m["name"]: m["installed"] for m in res["models"]}[first] is True
    assert sum(m["installed"] for m in res["models"]) == 1


def test_pull_refuses_a_model_outside_the_list(db, monkeypatch):
    db.add(GlobalConfig(key="ollama_url", value="http://ollama.test:11434"))
    db.commit()

    async def yes(url):
        return True

    monkeypatch.setattr(catalog, "is_ollama", yes)
    with pytest.raises(HTTPException) as e:
        run(config_router.pull_ollama_model({"model": "some-other:7b"}, db=db))
    assert e.value.status_code == 400


def test_pull_refuses_a_server_that_is_not_ollama(db, monkeypatch):
    db.add(GlobalConfig(key="ollama_url", value="http://localai.test:8080"))
    db.commit()

    async def no(url):
        return False

    monkeypatch.setattr(catalog, "is_ollama", no)
    with pytest.raises(HTTPException) as e:
        run(config_router.pull_ollama_model({"model": catalog.CATALOG[0]["name"]}, db=db))
    assert e.value.status_code == 400


def test_progress_never_goes_backwards_when_a_new_layer_starts():
    size = 4.0
    first = catalog._percent({"a": (2e9, 2e9)}, size)
    second = catalog._percent({"a": (2e9, 2e9), "b": (0, 2e9)}, size)
    assert second >= first
    assert catalog._percent({"a": (4e9, 4e9)}, size) == 99
