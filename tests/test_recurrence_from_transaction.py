"""« Opération récurrente » activé sur une opération existante : la série part d'elle et prévoit les suivantes."""

from datetime import date

import pytest
from dateutil.relativedelta import relativedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Account, RecurrenceTemplate, Transaction

TODAY = date.today()
FIRST = TODAY.replace(day=1)


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    db.add(Account(id=1, name="Compte courant", type="checking", initial_balance=1000.0))
    db.add(Transaction(id=10, description="Abonnement Exemple", amount=19.99, date_operation=FIRST, type="expense_var",
                       category="Abonnements", from_account_id=1, reconciliation_date=FIRST))
    db.commit()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_existing_operation_becomes_the_first_of_a_monthly_series(client, db_session):
    res = client.post("/api/recurrences/from-transaction/10", json={"frequency": "Monthly", "type": "expense_fixed"})
    assert res.status_code == 200
    db_session.expire_all()

    tx = db_session.get(Transaction, 10)
    tpl = db_session.get(RecurrenceTemplate, tx.recurrence_id)
    assert (tpl.description, tpl.amount, tpl.category, tpl.frequency, tpl.day_of_month, tpl.from_account_id) == \
        ("Abonnement Exemple", 19.99, "Abonnements", "Monthly", 1, 1)
    assert (tx.type, tx.is_monthly, tx.reconciliation_date) == ("expense_fixed", True, FIRST)

    later = db_session.query(Transaction).filter(Transaction.recurrence_id == tpl.id, Transaction.id != 10).all()
    assert later, "Les prochaines échéances sont prévues"
    assert min(t.date_operation for t in later) == FIRST + relativedelta(months=1)
    assert all(t.reconciliation_date is None and t.amount == 19.99 for t in later)


def test_limit_is_kept(client, db_session):
    client.post("/api/recurrences/from-transaction/10", json={"frequency": "Monthly", "max_occurrences": 3})
    db_session.expire_all()
    tpl_id = db_session.get(Transaction, 10).recurrence_id
    assert db_session.get(RecurrenceTemplate, tpl_id).max_occurrences == 3
    assert db_session.query(Transaction).filter(Transaction.recurrence_id == tpl_id).count() == 3


def test_operation_already_in_a_series_is_refused(client, db_session):
    assert client.post("/api/recurrences/from-transaction/10", json={"frequency": "Monthly"}).status_code == 200
    assert client.post("/api/recurrences/from-transaction/10", json={"frequency": "Monthly"}).status_code == 409
    assert client.post("/api/recurrences/from-transaction/999", json={"frequency": "Monthly"}).status_code == 404
    assert db_session.query(RecurrenceTemplate).count() == 1
