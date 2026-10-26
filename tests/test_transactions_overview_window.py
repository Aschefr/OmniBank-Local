"""
tests/test_transactions_overview_window.py — Test du paramètre de filtrage optimisé overview_window sur /api/transactions/.
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

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestSession = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def setup_tx_db():
    Base.metadata.create_all(bind=test_engine)
    db = TestSession()
    db.query(Transaction).delete()
    db.query(Account).delete()

    acc = Account(id=1, name="Compte Test", type="Compte courant", initial_balance=1000.0)
    db.add(acc)

    today = date.today()
    # 1. Non rapprochée passée (devrait être incluse)
    t1 = Transaction(
        id=1,
        from_account_id=1,
        amount=50.0,
        type="expense_var",
        date_operation=today - timedelta(days=90),
        reconciliation_date=None,
        description="Non rapprochée ancienne"
    )
    # 2. Non rapprochée future (devrait être incluse)
    t2 = Transaction(
        id=2,
        from_account_id=1,
        amount=100.0,
        type="expense_fixed",
        date_operation=today + timedelta(days=10),
        reconciliation_date=None,
        description="Non rapprochée future"
    )
    # 3. Rapprochée récente (< 60 jours, devrait être incluse)
    t3 = Transaction(
        id=3,
        from_account_id=1,
        amount=25.0,
        type="expense_var",
        date_operation=today - timedelta(days=20),
        reconciliation_date=today - timedelta(days=19),
        description="Rapprochée récente"
    )
    # 4. Rapprochée ancienne (> 60 jours, NE devrait PAS être incluse dans overview_window)
    t4 = Transaction(
        id=4,
        from_account_id=1,
        amount=200.0,
        type="expense_fixed",
        date_operation=today - timedelta(days=120),
        reconciliation_date=today - timedelta(days=119),
        description="Rapprochée très ancienne"
    )

    db.add_all([t1, t2, t3, t4])
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


def test_overview_window_filters_correctly():
    client = TestClient(app)

    # Sans overview_window : 4 transactions
    res_all = client.get("/api/transactions/")
    assert res_all.status_code == 200
    assert len(res_all.json()) == 4

    # Avec overview_window : seules t1, t2, t3 sont retournées (t4 exclue)
    res_ov = client.get("/api/transactions/?overview_window=true")
    assert res_ov.status_code == 200
    items = res_ov.json()
    assert len(items) == 3
    ids = {item["id"] for item in items}
    assert ids == {1, 2, 3}
