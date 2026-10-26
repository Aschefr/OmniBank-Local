"""
tests/test_rhythm_averages.py — Tests unitaires pour le calcul serveur du rythme de dépenses et moyennes historiques.
Vérifie la robustesse de calculate_rhythm_averages() et de l'endpoint /api/stats/rhythm.
"""
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Account, Transaction
from app.services.finance_engine import calculate_rhythm_averages


test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def setup_rhythm_db():
    Base.metadata.create_all(bind=test_engine)
    db = TestSession()
    db.query(Transaction).delete()
    db.query(Account).delete()

    acc = Account(id=1, name="Compte Test", type="Compte courant")
    db.add(acc)

    today = date.today()
    # 10 dépenses variables régulières de 50€
    for i in range(10):
        tx = Transaction(
            id=i + 1,
            date_operation=today - timedelta(days=i * 5),
            amount=50.0,
            type="expense_var",
            from_account_id=1,
            description=f"Courses #{i}"
        )
        db.add(tx)

    # 1 charge fixe de 600€
    tx_fix = Transaction(
        id=20,
        date_operation=today - timedelta(days=15),
        amount=600.0,
        type="expense_fixed",
        from_account_id=1,
        description="Loyer"
    )
    db.add(tx_fix)

    # 1 revenu de 2500€
    tx_inc = Transaction(
        id=21,
        date_operation=today - timedelta(days=20),
        amount=2500.0,
        type="income",
        to_account_id=1,
        description="Salaire"
    )
    db.add(tx_inc)

    # 1 outlier exceptionnel (3000€)
    tx_outlier = Transaction(
        id=22,
        date_operation=today - timedelta(days=25),
        amount=3000.0,
        type="expense_var",
        from_account_id=1,
        description="Achat exceptionnel"
    )
    db.add(tx_outlier)
    db.commit()
    db.close()

    def override_get_db():
        session = TestSession()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)


def test_calculate_rhythm_averages_basic():
    session = TestSession()
    try:
        res = calculate_rhythm_averages(session, lookback="6m", account_id=1, sensitivity=2)
        assert res["nbDays"] == 180
        assert res["account_id"] == 1
        assert res["lookback"] == "6m"
        assert res["dailyVar"] > 0
        # dailyVarClean doit être inférieur à dailyVar grâce au plafonnement de l'outlier
        assert res["dailyVarClean"] < res["dailyVar"]
        assert res["dailyFixed"] > 0
        assert res["dailyIncome"] > 0
        assert res["variable"] > 0
        assert res["fixed"] > 0
        assert res["income"] > 0
    finally:
        session.close()


def test_calculate_rhythm_averages_all_lookback():
    session = TestSession()
    try:
        today = date.today()
        earliest = today - timedelta(days=400)
        old_tx = Transaction(
            id=99,
            date_operation=earliest,
            amount=100.0,
            type="expense_var",
            from_account_id=1,
            description="Ancien achat"
        )
        session.add(old_tx)
        session.commit()

        res = calculate_rhythm_averages(session, lookback="all", account_id=1)
        assert res["nbDays"] >= 400
        assert res["lookback"] == "all"
        assert res["dailyVarClean"] > 0
    finally:
        session.close()


def test_get_rhythm_endpoint():
    client = TestClient(app)
    response = client.get("/api/stats/rhythm?lookback=6m&account_id=1")
    assert response.status_code == 200
    data = response.json()
    assert "dailyVarClean" in data
    assert "income" in data
    assert "fixed" in data
    assert "variable" in data
    assert data["account_id"] == 1
    assert data["lookback"] == "6m"
