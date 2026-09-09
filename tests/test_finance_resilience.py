"""
Tests de non-régression et de résilience pour finance_engine.py et database.py.
Vérifie la robustesse face aux configurations corrompues, aux entrées invalides et
au bon enregistrement des fonctions SQLite sans planter l'application.
"""
import os
import sys
import logging
import pytest
from datetime import date
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.models import Account, GlobalConfig
from app.services.finance_engine import get_main_account, predict_next_paycheck
from app.database import _configure_sqlite_pragmas
from tests.generate_test_db import build_test_db

TEST_DB_PATH = "data/omnibank_test_finance_resilience.db"

engine = create_engine(
    f"sqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
    poolclass=NullPool
)
_configure_sqlite_pragmas(engine)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    build_test_db(engine)
    yield
    engine.dispose()


def test_get_main_account_resilience_corrupted_config(caplog):
    """Vérifie que get_main_account ne plante pas si main_account_id est corrompu."""
    db = TestingSessionLocal()
    try:
        # 1. Valeur invalide non numérique
        conf = db.query(GlobalConfig).filter(GlobalConfig.key == "main_account_id").first()
        if not conf:
            conf = GlobalConfig(key="main_account_id", value="ABC_CORRUPTED")
            db.add(conf)
        else:
            conf.value = "ABC_CORRUPTED"
        db.commit()

        with caplog.at_level(logging.WARNING):
            acc = get_main_account(db)
            assert acc is not None, "get_main_account doit retourner un compte de repli"
            # Un log d'avertissement en français doit avoir été émis
            assert any("main_account_id" in record.message for record in caplog.records)

        # 2. Valeur inexistante
        conf.value = "999999"
        db.commit()
        acc = get_main_account(db)
        assert acc is not None, "get_main_account doit retourner un compte de repli en cas d'ID inexistant"
    finally:
        db.close()


def test_predict_next_pay_date_resilience_corrupted_override(caplog):
    """Vérifie que predict_next_pay_date gère avec résilience les overrides corrompus."""
    db = TestingSessionLocal()
    try:
        # Injection d'un override de date invalide
        conf_date = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_date").first()
        if not conf_date:
            conf_date = GlobalConfig(key="override_paycheck_date", value="bad-date-format")
            db.add(conf_date)
        else:
            conf_date.value = "bad-date-format"
        db.commit()

        with caplog.at_level(logging.WARNING):
            res = predict_next_paycheck(db)
            assert res is not None
            assert "date" in res
            assert isinstance(res["date"], date)
            # L'erreur de format doit être tracée sans faire crasher le calcul
            assert any("override" in record.message.lower() for record in caplog.records)
    finally:
        db.close()


def test_sqlite_pragmas_and_unaccent_function():
    """Vérifie que les PRAGMAs et la fonction UNACCENT SQLite sont opérationnels."""
    db = TestingSessionLocal()
    try:
        # Test de la fonction personnalisée UNACCENT
        row = db.execute(text("SELECT UNACCENT('Événement Hôtelier Çà et Là')")).scalar()
        assert row == "evenement hotelier ca et la"

        # Test qu'une valeur None ne plante pas UNACCENT
        row_none = db.execute(text("SELECT UNACCENT(NULL)")).scalar()
        assert row_none == ""

        # Test PRAGMA busy_timeout
        timeout = db.execute(text("PRAGMA busy_timeout")).scalar()
        assert timeout == 30000
    finally:
        db.close()
