"""
tests/test_cockpit_forecast.py — Tests unitaires & API pour la synthèse prévisionnelle multi-horizons du Cockpit (Chantier 5 / LOT-05).
"""
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Account, Transaction, RecurrenceTemplate, Scenario, ScenarioEvent, Category, GlobalConfig
from app.services.simulator_engine import get_cockpit_forecast_summary

# Setup isolated in-memory DB for forecast tests
forecast_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=forecast_engine)


@pytest.fixture(autouse=True)
def setup_forecast_db():
    Base.metadata.create_all(bind=forecast_engine)
    db = TestingSessionLocal()
    db.query(ScenarioEvent).delete()
    db.query(Scenario).delete()
    db.query(Transaction).delete()
    db.query(RecurrenceTemplate).delete()
    db.query(Account).delete()
    db.query(Category).delete()
    db.query(GlobalConfig).delete()

    acc_main = Account(id=1, name="Compte Courant Test", type="Compte courant", initial_balance=2500.0)
    acc_sav = Account(id=2, name="Livret A Test", type="Livret", initial_balance=10000.0)
    db.add_all([acc_main, acc_sav])
    db.add(Category(name="Salaire", type="income"))
    db.add(GlobalConfig(key="pay_category", value="Salaire"))

    rec = RecurrenceTemplate(
        id=1,
        description="Loyer mensuel",
        amount=600.0,
        type="expense_fixed",
        frequency="Monthly",
        from_account_id=1
    )
    db.add(rec)
    db.commit()
    db.close()

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)


def test_cockpit_forecast_summary_basic():
    db = TestingSessionLocal()
    today = date.today()

    # Add scheduled transactions within 7 days
    tx1 = Transaction(
        from_account_id=1,
        amount=45.0,
        type="expense_var",
        category="Alimentation",
        description="Courses Monoprix",
        date_operation=today + timedelta(days=2),
        reconciliation_date=None
    )
    tx2 = Transaction(
        to_account_id=1,
        amount=200.0,
        type="income",
        category="Virement",
        description="Remboursement Sécu",
        date_operation=today + timedelta(days=4),
        reconciliation_date=None
    )
    # Transaction far in future (> 7 days)
    tx3 = Transaction(
        from_account_id=1,
        amount=80.0,
        type="expense_fixed",
        category="Assurance",
        description="Assurance Habitation",
        date_operation=today + timedelta(days=15),
        reconciliation_date=None
    )
    db.add_all([tx1, tx2, tx3])
    db.commit()

    summary = get_cockpit_forecast_summary(db=db, account_id=1)

    assert "next_month" in summary
    assert "short_term_7d" in summary
    assert "cycle_forecast" in summary
    assert "trajectory_3m" in summary

    # Next month checks (Cap sur le mois prochain)
    nm = summary["next_month"]
    assert "month_label" in nm
    assert "projected_income" in nm
    assert "fixed_charges" in nm
    assert "variable_expenses" in nm
    assert "projected_net" in nm
    assert "projected_end_balance" in nm
    assert "seasonal_pct" in nm

    # Short term 7d checks
    st = summary["short_term_7d"]
    assert st["count"] == 2
    assert st["incoming"] == 200.0
    assert st["outgoing"] == 45.0
    assert st["net"] == 155.0
    assert len(st["operations"]) == 2

    # Cycle forecast checks
    cf = summary["cycle_forecast"]
    assert cf["initial_balance"] == 2500.0
    assert "projected_income" in cf
    assert "fixed_charges" in cf
    assert "total_expenses" in cf

    # Trajectory 3m checks
    traj = summary["trajectory_3m"]
    assert len(traj["months"]) == 3
    assert traj["start_balance"] == 2500.0
    assert "total_3m_savings" in traj
    assert "trend" in traj
    assert traj["trend"] in ("growing", "stable", "declining")
    db.close()


def test_cockpit_forecast_api_endpoint():
    client = TestClient(app)
    response = client.get("/api/simulator/forecast-summary?account_id=1")
    assert response.status_code == 200
    data = response.json()

    assert "next_month" in data
    assert "short_term_7d" in data
    assert "cycle_forecast" in data
    assert "trajectory_3m" in data
    assert "month_label" in data["next_month"]
    assert data["short_term_7d"]["count"] >= 0
    assert len(data["trajectory_3m"]["months"]) == 3


def test_cockpit_forecast_coming_transactions():
    """Vérifie la prise en compte des opérations à venir dans les prévisions 7j."""
    db = TestingSessionLocal()
    today = date.today()

    tx_coming = Transaction(
        from_account_id=1,
        amount=171.07,
        type="expense_fixed",
        category="Facture énergie",
        description="Octopus Energie",
        date_operation=today + timedelta(days=1),
        reconciliation_date=None,
        csv_id="woob_coming_999"
    )
    db.add(tx_coming)
    db.commit()

    summary = get_cockpit_forecast_summary(db=db, account_id=1)
    st = summary["short_term_7d"]
    assert any(op["description"] == "Octopus Energie" for op in st["operations"])
    db.close()

