"""
Tests unitaires pour la cohérence stricte des calculs de dates limites (Edge Cases) :
- Dépense avant paie (J-1) : comptabilisée dans RTL et dans unreconciled_expenses.
- Dépense le jour J de la paie (J) : exclue de RTL et de unreconciled_expenses (règle < next_pay_date).
- Dépense après paie (J+1) : exclue de RTL et de unreconciled_expenses.
- Pointage immédiat : mise à jour instantanée du solde pointé, du RTL et des dépenses non-pointées.
- Opération ignorée (is_skipped) : exclue du calcul de reste à vivre.
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
from app.services import stats_cache
from tests.generate_test_db import build_test_db

TEST_DB_PATH = "data/omnibank_test_date_boundaries.db"

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


def test_date_boundary_j_minus_1_vs_j_vs_j_plus_1():
    """
    Vérifie la frontière exacte < next_pay_date :
    - next_pay_date = future date (today + 15 days)
    - Tx A (J-1, 50€) : Doit être incluse dans RTL et unreconciled_expenses
    - Tx B (Jour J, 30€) : Doit être EXCLUE de RTL et unreconciled_expenses (< strict)
    - Tx C (J+1, 20€) : Doit être EXCLUE de RTL et unreconciled_expenses
    """
    target_pay_date = date.today() + timedelta(days=15)
    pay_str = target_pay_date.strftime("%Y-%m-%d")
    j_minus_1 = (target_pay_date - timedelta(days=1)).strftime("%Y-%m-%d")
    j_day = pay_str
    j_plus_1 = (target_pay_date + timedelta(days=1)).strftime("%Y-%m-%d")

    # 1. Configurer une paie manuelle
    res = client.post("/api/stats/override_paycheck", json={
        "date": pay_str,
        "amount": 2500.0
    })
    assert res.status_code == 200

    # 2. Récupérer le compte principal
    accounts_res = client.get("/api/accounts/")
    assert accounts_res.status_code == 200
    main_account_id = accounts_res.json()[0]["id"]

    # 3. Créer les 3 transactions non rapprochées
    # Tx A : J-1 -> 50.00 €
    client.post("/api/transactions/", json={
        "date_saisie": (date.today() - timedelta(days=2)).strftime("%Y-%m-%d"),
        "date_operation": j_minus_1,
        "description": "Dépense J-1 avant paie",
        "amount": 50.0,
        "type": "expense",
        "from_account_id": main_account_id
    })

    # Tx B : Jour J paie -> 30.00 €
    client.post("/api/transactions/", json={
        "date_saisie": (date.today() - timedelta(days=2)).strftime("%Y-%m-%d"),
        "date_operation": j_day,
        "description": "Dépense Jour J paie",
        "amount": 30.0,
        "type": "expense",
        "from_account_id": main_account_id
    })

    # Tx C : J+1 après paie -> 20.00 €
    client.post("/api/transactions/", json={
        "date_saisie": (date.today() - timedelta(days=2)).strftime("%Y-%m-%d"),
        "date_operation": j_plus_1,
        "description": "Dépense J+1 après paie",
        "amount": 20.0,
        "type": "expense",
        "from_account_id": main_account_id
    })

    # 4. Vérifier le dashboard
    dash = client.get("/api/stats/dashboard").json()
    assert dash["next_pay_date"] == pay_str

    # unreconciled_expenses ne doit contenir QUE la dépense J-1 (50€), ni J (30€) ni J+1 (20€)
    assert dash["unreconciled_expenses"] == 50.0

    # Solde initial seeded = 5870.00 €
    # RTL = solde rapproché (5870€) - dépenses avant paie (50€) = 5820.00 €
    assert dash["rest_to_live"] == 5820.0


def test_reconciliation_toggle_updates_rtl_immediately():
    """Vérifie que pointer une dépense met à jour instantanément RTL et dépenses non rapprochées."""
    target_pay_date = date.today() + timedelta(days=15)
    pay_str = target_pay_date.strftime("%Y-%m-%d")
    op_str = (date.today() + timedelta(days=2)).strftime("%Y-%m-%d")

    client.post("/api/stats/override_paycheck", json={
        "date": pay_str,
        "amount": 2000.0
    })
    accounts_res = client.get("/api/accounts/")
    main_acc_id = accounts_res.json()[0]["id"]

    # Créer une dépense de 100€ avant la paie
    tx_res = client.post("/api/transactions/", json={
        "date_saisie": date.today().strftime("%Y-%m-%d"),
        "date_operation": op_str,
        "description": "Achat Test",
        "amount": 100.0,
        "type": "expense",
        "from_account_id": main_acc_id
    })
    assert tx_res.status_code == 200
    tx_id = tx_res.json()["id"]

    # Avant pointage
    dash1 = client.get("/api/stats/dashboard").json()
    assert dash1["unreconciled_expenses"] == 100.0
    assert dash1["rest_to_live"] == 5770.0  # 5870 - 100

    # Pointer l'opération
    toggle_res = client.post(f"/api/transactions/{tx_id}/toggle_reconciliation")
    assert toggle_res.status_code == 200
    assert toggle_res.json()["reconciliation_date"] is not None

    # Après pointage : le solde rapproché passe à 5770€, et unreconciled_expenses = 0€
    dash2 = client.get("/api/stats/dashboard").json()
    assert dash2["unreconciled_expenses"] == 0.0
    # RTL = solde pointé (5770€) - 0€ = 5770.00 €
    assert dash2["rest_to_live"] == 5770.0


def test_skipped_transaction_excluded_from_rtl():
    """Vérifie qu'une opération ignorée (skip) n'impacte pas le reste à vivre."""
    target_pay_date = date.today() + timedelta(days=15)
    pay_str = target_pay_date.strftime("%Y-%m-%d")
    op_str = (date.today() + timedelta(days=3)).strftime("%Y-%m-%d")

    client.post("/api/stats/override_paycheck", json={
        "date": pay_str,
        "amount": 2000.0
    })
    accounts_res = client.get("/api/accounts/")
    main_acc_id = accounts_res.json()[0]["id"]

    tx_res = client.post("/api/transactions/", json={
        "date_saisie": date.today().strftime("%Y-%m-%d"),
        "date_operation": op_str,
        "description": "Abonnement Annulé",
        "amount": 80.0,
        "type": "expense",
        "from_account_id": main_acc_id
    })
    assert tx_res.status_code == 200
    tx_id = tx_res.json()["id"]

    # Skip l'opération
    skip_res = client.post(f"/api/transactions/{tx_id}/toggle_skip")
    assert skip_res.status_code == 200
    assert skip_res.json()["is_skipped"] is True

    dash = client.get("/api/stats/dashboard").json()
    assert dash["unreconciled_expenses"] == 0.0
    assert dash["rest_to_live"] == 5870.0
