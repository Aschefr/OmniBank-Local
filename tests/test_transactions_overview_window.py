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
    # 4. Rapprochée moyenne (90 jours : exclue d'overview_window mais incluse dans timeline_window)
    t4 = Transaction(
        id=4,
        from_account_id=1,
        amount=200.0,
        type="expense_fixed",
        date_operation=today - timedelta(days=90),
        reconciliation_date=today - timedelta(days=89),
        recurrence_id=10,
        description="Rapprochée moyenne avec récurrence"
    )
    # 5. Rapprochée très ancienne (150 jours : exclue d'overview_window et de timeline_window)
    t5 = Transaction(
        id=5,
        from_account_id=1,
        amount=300.0,
        type="expense_fixed",
        date_operation=today - timedelta(days=150),
        reconciliation_date=today - timedelta(days=149),
        recurrence_id=11,
        description="Rapprochée très ancienne avec récurrence"
    )

    db.add_all([t1, t2, t3, t4, t5])
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

    # Sans filtre : 5 transactions
    res_all = client.get("/api/transactions/")
    assert res_all.status_code == 200
    assert len(res_all.json()) == 5

    # Avec overview_window (<60j ou non pointée) : t1, t2, t3 retournées (t4 et t5 exclues)
    res_ov = client.get("/api/transactions/?overview_window=true")
    assert res_ov.status_code == 200
    items = res_ov.json()
    assert len(items) == 3
    ids = {item["id"] for item in items}
    assert ids == {1, 2, 3}


def test_timeline_window_filters_correctly():
    client = TestClient(app)

    # Avec timeline_window (<120j ou non pointée) : t1, t2, t3, t4 retournées (t5 exclue car 150j)
    res_tl = client.get("/api/transactions/?timeline_window=true")
    assert res_tl.status_code == 200
    items = res_tl.json()
    assert len(items) == 4
    ids = {item["id"] for item in items}
    assert ids == {1, 2, 3, 4}


def test_has_recurrence_filter():
    client = TestClient(app)

    # has_recurrence=true : t4 et t5 ont un recurrence_id
    res_rec = client.get("/api/transactions/?has_recurrence=true")
    assert res_rec.status_code == 200
    items = res_rec.json()
    assert len(items) == 2
    ids = {item["id"] for item in items}
    assert ids == {4, 5}

    # has_recurrence=false : t1, t2, t3 n'ont pas de recurrence_id
    res_no_rec = client.get("/api/transactions/?has_recurrence=false")
    assert res_no_rec.status_code == 200
    items_no = res_no_rec.json()
    assert len(items_no) == 3
    ids_no = {item["id"] for item in items_no}
    assert ids_no == {1, 2, 3}
