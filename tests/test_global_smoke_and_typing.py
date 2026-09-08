"""
tests/test_global_smoke_and_typing.py — Test d'Intégrité Globale & Smoke Test Applicatif.
Vérifie :
1. Que TOUTES les annotations de types de tous les modules dans app/ sont résolubles sans NameError
   (détecte les imports manquants comme Any, Optional, Dict même sous Python 3.14 / PEP 649).
2. Que l'application FastAPI complète démarre et répond sur ses endpoints de santé.
"""

import importlib
import inspect
import pkgutil
import typing
import pytest
from fastapi.testclient import TestClient

import app
from app.main import app as fastapi_app
from app.database import get_db, Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


def test_all_app_modules_type_annotations_integrity():
    """
    Parcourt récursivement l'ensemble des fichiers python du dossier `app/`.
    Force l'évaluation de toutes les annotations de types via `typing.get_type_hints()`
    sur chaque fonction et méthode pour détecter tout import manquant (NameError).
    """
    from pathlib import Path

    errors = []
    visited_modules = 0
    visited_functions = 0

    app_dir = Path("app")
    for py_file in app_dir.rglob("*.py"):
        if py_file.name.startswith("__") and py_file.name != "__init__.py":
            continue
        rel = py_file.with_suffix("")
        mod_name = ".".join(rel.parts)
        visited_modules += 1

        try:
            mod = importlib.import_module(mod_name)
        except Exception as e:
            errors.append(f"Erreur d'importation du module {mod_name} : {e}")
            continue

        for attr_name, obj in inspect.getmembers(mod, inspect.isfunction):
            if getattr(obj, "__module__", None) == mod_name:
                visited_functions += 1
                try:
                    typing.get_type_hints(obj)
                except NameError as ne:
                    errors.append(f"NameError dans {mod_name}.{attr_name}() : {ne}")
                except Exception:
                    pass

    assert visited_modules > 10, f"Trop peu de modules analysés ({visited_modules})"
    assert visited_functions > 50, f"Trop peu de fonctions analysées ({visited_functions})"
    assert len(errors) == 0, f"Erreurs d'annotations détectées dans app/ :\n" + "\n".join(errors)


def test_global_app_startup_and_health_endpoints():
    """
    Smoke test applicatif global :
    Démarre l'application FastAPI complète avec TestClient et vérifie la disponibilité
    des endpoints vitaux du système.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    fastapi_app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(fastapi_app) as client:
            # 1. Version
            res_ver = client.get("/api/version")
            assert res_ver.status_code == 200

            # 2. Setup status
            res_setup = client.get("/api/setup/status")
            assert res_setup.status_code == 200

            # 3. Config
            res_cfg = client.get("/api/config/")
            assert res_cfg.status_code == 200

            # 4. Smart labels simulate
            res_sim = client.post("/api/smart-labels/simulate", json={"raw_label": "TEST COMMERCANT 75"})
            assert res_sim.status_code == 200
            assert "description" in res_sim.json()
    finally:
        fastapi_app.dependency_overrides.clear()
        db.close()
