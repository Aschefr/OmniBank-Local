"""
Tests unitaires pour l'intégration de l'impact bénéfique des recettes prévues
sur le Reste à vivre (RTL) et le Risque de découvert (get_overdraft_warning).
"""
import os
import sys
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.database import get_db
from app.models import Account, Transaction, GlobalConfig
from app.services import stats_cache
from app.services.finance_engine import get_overdraft_warning, calculate_rest_to_live
from tests.generate_test_db import build_test_db

TEST_DB_PATH = "data/omnibank_test_income_impact.db"

engine = create_engine(
    f"sqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
    poolclass=NullPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    from app.database import _engines, _session_factories
    _engines['default'] = engine
    _session_factories['default'] = TestingSessionLocal
    build_test_db(engine)
    stats_cache.invalidate()
    yield
    stats_cache.invalidate()
    engine.dispose()

client = TestClient(app)


def test_overdraft_covered_by_planned_income():
    """
    Vérifie qu'un risque de découvert sans recettes est marqué comme 'covered_by_income = True'
    lorsque des recettes prévues sur la période couvrent le découvert.
    """
    db = TestingSessionLocal()
    try:
        # Créer un compte avec solde initial 100€
        acc = Account(name="Test Compte Découvert", type="Compte courant", initial_balance=100.0)
        db.add(acc)
        db.commit()
        db.refresh(acc)

        today = date.today()

        # Dépense non rapprochée de 150€ à J+5 -> solde sans recettes = -50€ (découvert)
        exp = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=5),
            description="Loyer partiel",
            amount=150.0,
            type="expense_fixed",
            from_account_id=acc.id,
            to_account_id=None,
            reconciliation_date=None
        )
        # Recette non rapprochée de 200€ à J+3 -> couvre le découvert (solde final = +150€, mini = +100€ ou +300€)
        inc = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=3),
            description="Remboursement attendu",
            amount=200.0,
            type="income",
            from_account_id=None,
            to_account_id=acc.id,
            reconciliation_date=None
        )
        db.add_all([exp, inc])
        db.commit()

        warning = get_overdraft_warning(db, account_id=acc.id)
        assert warning is not None
        assert warning["projected_balance"] == -50.0
        assert warning["covered_by_income"] is True
        assert warning["planned_income_total"] == 200.0
        assert warning["planned_income_before_risk"] == 200.0
        assert warning["projected_balance_with_income"] >= 0.0
    finally:
        db.close()


def test_overdraft_partially_reduced_by_planned_income():
    """
    Vérifie qu'un risque de découvert est marqué comme non couvert mais avec solde projeté atténué
    lorsque les recettes réduisent le déficit sans l'annuler complètement.
    """
    db = TestingSessionLocal()
    try:
        acc = Account(name="Test Compte Découvert Partiel", type="Compte courant", initial_balance=50.0)
        db.add(acc)
        db.commit()
        db.refresh(acc)

        today = date.today()

        # Dépense non rapprochée de 200€ à J+5 -> solde sans recettes = -150€
        exp = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=5),
            description="Grosse dépense",
            amount=200.0,
            type="expense_fixed",
            from_account_id=acc.id,
            to_account_id=None,
            reconciliation_date=None
        )
        # Recette non rapprochée de 50€ à J+2 -> solde mini avec recettes = -100€ (découvert réduit)
        inc = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=2),
            description="Acompte",
            amount=50.0,
            type="income",
            from_account_id=None,
            to_account_id=acc.id,
            reconciliation_date=None
        )
        db.add_all([exp, inc])
        db.commit()

        warning = get_overdraft_warning(db, account_id=acc.id)
        assert warning is not None
        assert warning["projected_balance"] == -150.0
        assert warning["covered_by_income"] is False
        assert warning["planned_income_total"] == 50.0
        assert warning["projected_balance_with_income"] == -100.0
        assert warning["with_income_risk_amount"] == -100.0
    finally:
        db.close()


def test_dashboard_stats_endpoint_includes_planned_income():
    """
    Vérifie que l'endpoint /api/stats/dashboard renvoie bien unreconciled_income et rest_to_live_with_income.
    """
    res = client.get("/api/stats/dashboard")
    assert res.status_code == 200
    data = res.json()
    assert "rest_to_live" in data
    assert "rest_to_live_with_income" in data
    assert "unreconciled_income" in data
    assert "total_unreconciled_income" in data
    assert data["rest_to_live_with_income"] == round(data["rest_to_live"] + data["unreconciled_income"], 2)
