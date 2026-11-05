"""« Créer une nouvelle série » : l'opération modifiée quitte son ancienne récurrence et en démarre une nouvelle."""

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

OLD_LABEL = "Impôts - Complément 2025"
NEW_LABEL = "Impôts - Complément 2026"
TODAY = date.today()


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    db.add(Account(id=1, name="Compte courant", type="checking", initial_balance=1000.0))
    db.add(RecurrenceTemplate(
        id=1, description=OLD_LABEL, amount=120.0, frequency="Monthly", category="Impôts",
        type="expense_fixed", from_account_id=1, day_of_month=15, max_occurrences=24,
    ))
    dates = [TODAY - relativedelta(months=1), TODAY + relativedelta(days=5), TODAY + relativedelta(months=1, days=5), TODAY + relativedelta(months=2, days=5)]
    for i, d in enumerate(dates):
        db.add(Transaction(
            id=100 + i, description=OLD_LABEL, amount=120.0, date_operation=d, type="expense_fixed", category="Impôts",
            from_account_id=1, recurrence_id=1, reconciliation_date=d if i == 0 else None,
        ))
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


def _payload(db_session, tx_id, **changes):
    tx = db_session.get(Transaction, tx_id)
    data = {
        "description": tx.description, "amount": tx.amount, "date_operation": tx.date_operation.isoformat(),
        "category": tx.category, "type": tx.type, "from_account_id": tx.from_account_id,
    }
    data.update(changes)
    return data


def _old_series_untouched(db_session, detached_date=None):
    tpl = db_session.get(RecurrenceTemplate, 1)
    assert (tpl.description, tpl.amount, tpl.is_closed) == (OLD_LABEL, 120.0, False)
    old = db_session.query(Transaction).filter(Transaction.recurrence_id == 1).order_by(Transaction.id).all()
    assert [t.id for t in old if not t.is_skipped] == [100, 102, 103], "Les occurrences futures déjà générées restent sur l'ancienne série"
    assert {t.description for t in old} == {OLD_LABEL}
    markers = [t for t in old if t.is_skipped]
    assert len(markers) == 1, "Une occurrence ignorée remplace l'opération détachée"
    marker = markers[0]
    assert (marker.date_operation, marker.amount, marker.reconciliation_date is not None) == (detached_date or TODAY + relativedelta(days=5), 120.0, True)


def test_new_series_detaches_the_operation_and_leaves_the_old_series(client, db_session):
    res = client.put("/api/transactions/101?propagate=false&new_series=true", json=_payload(db_session, 101, description=NEW_LABEL, amount=150.0))
    assert res.status_code == 200
    db_session.expire_all()

    edited = db_session.get(Transaction, 101)
    new_tpl = db_session.get(RecurrenceTemplate, edited.recurrence_id)
    assert new_tpl.id != 1
    assert (new_tpl.description, new_tpl.amount, new_tpl.frequency, new_tpl.max_occurrences) == (NEW_LABEL, 150.0, "Monthly", 24)
    assert new_tpl.day_of_month == edited.date_operation.day
    _old_series_untouched(db_session)

    generated = db_session.query(Transaction).filter(Transaction.recurrence_id == new_tpl.id, Transaction.id != 101).all()
    assert generated, "La nouvelle série prévoit ses occurrences à venir"
    assert all(t.date_operation > edited.date_operation and t.description == NEW_LABEL and t.amount == 150.0 for t in generated)


def test_undo_restores_the_old_series_and_redo_brings_the_new_one_back(client, db_session):
    res = client.put("/api/transactions/101?propagate=false&new_series=true", json=_payload(db_session, 101, description=NEW_LABEL))
    action_id = res.json()["action_id"]
    db_session.expire_all()
    new_tpl_id = db_session.get(Transaction, 101).recurrence_id

    assert client.post(f"/api/history/{action_id}/undo").status_code == 200
    db_session.expire_all()
    edited = db_session.get(Transaction, 101)
    assert (edited.description, edited.recurrence_id) == (OLD_LABEL, 1)
    assert db_session.get(RecurrenceTemplate, new_tpl_id) is None
    assert db_session.query(Transaction).filter(Transaction.recurrence_id == new_tpl_id).count() == 0
    assert db_session.query(Transaction).filter(Transaction.is_skipped == True).count() == 0, "L'annulation retire l'occurrence ignorée"
    tpl = db_session.get(RecurrenceTemplate, 1)
    assert (tpl.description, tpl.is_closed) == (OLD_LABEL, False)
    assert sorted(t.id for t in db_session.query(Transaction).filter(Transaction.recurrence_id == 1)) == [100, 101, 102, 103]

    assert client.post(f"/api/history/{action_id}/redo").status_code == 200
    db_session.expire_all()
    edited = db_session.get(Transaction, 101)
    assert (edited.description, edited.recurrence_id) == (NEW_LABEL, new_tpl_id)
    assert db_session.get(RecurrenceTemplate, new_tpl_id).description == NEW_LABEL
    assert db_session.query(Transaction).filter(Transaction.recurrence_id == new_tpl_id, Transaction.id != 101).count() > 0
    _old_series_untouched(db_session)


def test_undo_refused_once_the_new_series_was_used(client, db_session):
    res = client.put("/api/transactions/101?new_series=true", json=_payload(db_session, 101, description=NEW_LABEL))
    action_id = res.json()["action_id"]
    db_session.expire_all()
    new_tpl_id = db_session.get(Transaction, 101).recurrence_id
    later = db_session.query(Transaction).filter(Transaction.recurrence_id == new_tpl_id, Transaction.id != 101).first()
    later.reconciliation_date = later.date_operation
    db_session.commit()

    assert client.post(f"/api/history/{action_id}/undo").status_code == 409


def test_new_series_route_for_an_already_saved_operation(client, db_session):
    db_session.get(Transaction, 101).description = NEW_LABEL
    db_session.commit()
    res = client.post("/api/transactions/101/new-series")
    assert res.status_code == 200
    db_session.expire_all()
    new_tpl_id = db_session.get(Transaction, 101).recurrence_id
    assert new_tpl_id != 1 and db_session.get(RecurrenceTemplate, new_tpl_id).description == NEW_LABEL

    assert client.post(f"/api/history/{res.json()['action_id']}/undo").status_code == 200
    db_session.expire_all()
    assert db_session.get(Transaction, 101).recurrence_id == 1
    assert db_session.get(RecurrenceTemplate, new_tpl_id) is None


def test_new_series_refused_without_recurrence(client, db_session):
    db_session.add(Transaction(id=200, description="Ponctuelle", amount=10.0, date_operation=TODAY, type="expense_var", from_account_id=1))
    db_session.commit()
    assert client.post("/api/transactions/200/new-series").status_code == 400


def test_plain_update_and_propagation_unchanged(client, db_session):
    client.put("/api/transactions/101?propagate=true", json=_payload(db_session, 101, description=NEW_LABEL))
    db_session.expire_all()
    assert db_session.query(RecurrenceTemplate).count() == 1
    assert db_session.get(Transaction, 101).recurrence_id == 1
    assert db_session.get(Transaction, 102).description == NEW_LABEL


def _series(db_session, tpl_id, frequency, dates, max_occurrences=None, reconciled=1):
    db_session.add(RecurrenceTemplate(
        id=tpl_id, description=OLD_LABEL, amount=300.0, frequency=frequency, category="Impôts", type="expense_fixed",
        from_account_id=1, day_of_month=dates[0].day, month_of_year=dates[0].month, max_occurrences=max_occurrences,
    ))
    ids = []
    for i, d in enumerate(dates):
        tx = Transaction(description=OLD_LABEL, amount=300.0, date_operation=d, type="expense_fixed", category="Impôts",
                         from_account_id=1, recurrence_id=tpl_id, reconciliation_date=d if i < reconciled else None)
        db_session.add(tx)
        db_session.flush()
        ids.append(tx.id)
    db_session.commit()
    return ids


def _detach_and_generate(client, db_session, tx_id):
    res = client.put(f"/api/transactions/{tx_id}?new_series=true", json=_payload(db_session, tx_id, description=NEW_LABEL))
    assert res.status_code == 200
    assert client.post("/api/recurrences/generate_to_end_of_year").status_code == 200
    db_session.expire_all()
    return res.json()["action_id"]


def _occurrences(db_session, tpl_id):
    return db_session.query(Transaction).filter(Transaction.recurrence_id == tpl_id).order_by(Transaction.date_operation, Transaction.id).all()


def test_last_yearly_occurrence_detached_is_not_recreated(client, db_session):
    due = TODAY + relativedelta(days=5)
    last_year, detached = _series(db_session, 2, "Yearly", [due - relativedelta(years=1), due])
    _detach_and_generate(client, db_session, detached)

    old = _occurrences(db_session, 2)
    assert [t.id for t in old if not t.is_skipped] == [last_year], "L'ancienne série ne recrée pas l'occurrence détachée"
    assert [(t.date_operation, t.amount) for t in old if t.is_skipped] == [(due, 300.0)]


def test_limited_series_gets_no_extra_occurrence(client, db_session):
    dates = [TODAY - relativedelta(months=1)] + [TODAY + relativedelta(months=k, days=5) for k in range(3)]
    ids = _series(db_session, 2, "Monthly", dates, max_occurrences=4)
    _detach_and_generate(client, db_session, ids[1])

    old = _occurrences(db_session, 2)
    assert len(old) == 4, "Le marqueur compte dans la limite : rien n'est ajouté à la fin"
    assert [t.id for t in old if not t.is_skipped] == [ids[0], ids[2], ids[3]]


def test_undo_after_generation_leaves_no_duplicate_nor_marker(client, db_session):
    due = TODAY + relativedelta(days=5)
    last_year, detached = _series(db_session, 2, "Yearly", [due - relativedelta(years=1), due])
    action_id = _detach_and_generate(client, db_session, detached)
    new_tpl_id = db_session.get(Transaction, detached).recurrence_id

    assert client.post(f"/api/history/{action_id}/undo").status_code == 200
    db_session.expire_all()
    old = _occurrences(db_session, 2)
    assert [t.id for t in old] == [last_year, detached]
    assert not any(t.is_skipped for t in old)
    assert db_session.get(RecurrenceTemplate, new_tpl_id) is None


def test_marker_is_not_an_operation_to_reconcile(client, db_session):
    client.put("/api/transactions/101?new_series=true", json=_payload(db_session, 101, description=NEW_LABEL))
    db_session.expire_all()
    marker = db_session.query(Transaction).filter(Transaction.is_skipped == True).one()
    pending = client.get("/api/transactions/?unreconciled_only=true").json()
    assert marker.id not in {t["id"] for t in pending}
