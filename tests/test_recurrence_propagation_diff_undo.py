import pytest
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Transaction, RecurrenceTemplate, Account, Category, ActionHistory
from app.services.history_service import undo_action, redo_action


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Pre-populate sample accounts and categories
    acc = Account(id=1, name="CA Centre-Est", type="checking", initial_balance=1000.0)
    cat1 = Category(id=1, name="Prêt Conso", type="expense_fixed")
    cat2 = Category(id=2, name="Prêt Consommation", type="expense_fixed")
    db.add_all([acc, cat1, cat2])
    db.commit()

    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_propagation_diff_only_category(client, db_session):
    """
    Scenario:
    - Template with amount 189.90 and category 'Prêt Conso'.
    - Occurrence 1 (date 2025-12-05) has amount 206.00 (exceptional initial fee), category 'Prêt Conso'.
    - Occurrence 2 (date 2026-01-05) has amount 189.90, category 'Prêt Conso'.
    - Occurrence 3 (date 2026-02-05) has amount 189.90, category 'Prêt Conso'.
    - User edits Occurrence 1: only changes category to 'Prêt Consommation' with propagate=True.
    - Expected:
      - Occurrence 1 has category 'Prêt Consommation' and amount 206.00.
      - Occurrences 2 & 3 have category 'Prêt Consommation', BUT their amount remains 189.90 (NOT overwritten by 206.00)!
      - Template has category 'Prêt Consommation', BUT template.amount remains 189.90!
    """
    # 1. Create template
    tpl = RecurrenceTemplate(
        id=1,
        description="Crédit Conso CA - 10k",
        amount=189.90,
        frequency="Monthly",
        category="Prêt Conso",
        type="expense_fixed",
        from_account_id=1,
        day_of_month=5
    )
    db_session.add(tpl)
    db_session.commit()

    # 2. Create occurrences
    tx1 = Transaction(
        id=101,
        description="Crédit Conso CA - 10k",
        amount=206.00,
        date_operation=date(2025, 12, 5),
        reconciliation_date=date(2025, 12, 6),
        type="expense_fixed",
        category="Prêt Conso",
        from_account_id=1,
        recurrence_id=1
    )
    tx2 = Transaction(
        id=102,
        description="Crédit Conso CA - 10k",
        amount=189.90,
        date_operation=date(2026, 1, 5),
        type="expense_fixed",
        category="Prêt Conso",
        from_account_id=1,
        recurrence_id=1
    )
    tx3 = Transaction(
        id=103,
        description="Crédit Conso CA - 10k",
        amount=189.90,
        date_operation=date(2026, 2, 5),
        type="expense_fixed",
        category="Prêt Conso",
        from_account_id=1,
        recurrence_id=1
    )
    db_session.add_all([tx1, tx2, tx3])
    db_session.commit()

    # 3. User edits tx1: form payload sends amount=206.00 (unchanged on tx1) and category='Prêt Consommation'
    payload = {
        "description": "Crédit Conso CA - 10k",
        "amount": 206.00,
        "date_operation": "2025-12-05",
        "reconciliation_date": "2025-12-06",
        "category": "Prêt Consommation",
        "type": "expense_fixed",
        "from_account_id": 1
    }
    res = client.put("/api/transactions/101?propagate=true", json=payload)
    assert res.status_code == 200

    db_session.expire_all()
    tx1_db = db_session.query(Transaction).filter_by(id=101).first()
    tx2_db = db_session.query(Transaction).filter_by(id=102).first()
    tx3_db = db_session.query(Transaction).filter_by(id=103).first()
    tpl_db = db_session.query(RecurrenceTemplate).filter_by(id=1).first()

    # Check tx1
    assert tx1_db.category == "Prêt Consommation"
    assert tx1_db.amount == 206.00

    # Check future occurrences: category propagated, amount NOT overwritten!
    assert tx2_db.category == "Prêt Consommation"
    assert tx2_db.amount == 189.90

    assert tx3_db.category == "Prêt Consommation"
    assert tx3_db.amount == 189.90

    # Check template: category updated, amount NOT overwritten!
    assert tpl_db.category == "Prêt Consommation"
    assert tpl_db.amount == 189.90


def test_cluster_undo_redo_on_propagated_update(client, db_session):
    """
    Scenario:
    - User modifies a transaction with propagate=True (changes both description and amount).
    - Future occurrences and template are updated.
    - User clicks Undo on this action in history.
    - Expected:
      - tx1 is reverted.
      - ALL future occurrences are reverted to their exact previous states.
      - Template is reverted to its exact previous state.
    - User clicks Redo:
      - All entities in the cluster are re-applied.
    """
    tpl = RecurrenceTemplate(
        id=2,
        description="Abonnement Box",
        amount=30.00,
        frequency="Monthly",
        category="Telecoms",
        type="expense_fixed",
        from_account_id=1,
        day_of_month=10
    )
    db_session.add(tpl)
    db_session.commit()

    tx1 = Transaction(
        id=201,
        description="Abonnement Box",
        amount=30.00,
        date_operation=date(2026, 1, 10),
        type="expense_fixed",
        category="Telecoms",
        from_account_id=1,
        recurrence_id=2
    )
    tx2 = Transaction(
        id=202,
        description="Abonnement Box",
        amount=30.00,
        date_operation=date(2026, 2, 10),
        type="expense_fixed",
        category="Telecoms",
        from_account_id=1,
        recurrence_id=2
    )
    db_session.add_all([tx1, tx2])
    db_session.commit()

    # User modifies tx1: amount changes from 30.00 to 35.00, description to "Fibre Box"
    payload = {
        "description": "Fibre Box",
        "amount": 35.00,
        "date_operation": "2026-01-10",
        "category": "Telecoms",
        "type": "expense_fixed",
        "from_account_id": 1
    }
    res = client.put("/api/transactions/201?propagate=true", json=payload)
    assert res.status_code == 200
    action_id = res.json()["action_id"]

    # Verify propagated state
    db_session.expire_all()
    tx1_db = db_session.query(Transaction).filter_by(id=201).first()
    tx2_db = db_session.query(Transaction).filter_by(id=202).first()
    tpl_db = db_session.query(RecurrenceTemplate).filter_by(id=2).first()

    assert tx1_db.amount == 35.00
    assert tx1_db.description == "Fibre Box"
    assert tx2_db.amount == 35.00
    assert tx2_db.description == "Fibre Box"
    assert tpl_db.amount == 35.00
    assert tpl_db.description == "Fibre Box"

    # UNDO via history endpoint
    res_undo = client.post(f"/api/history/{action_id}/undo")
    assert res_undo.status_code == 200
    assert res_undo.json()["ok"] is True

    db_session.expire_all()
    tx1_db = db_session.query(Transaction).filter_by(id=201).first()
    tx2_db = db_session.query(Transaction).filter_by(id=202).first()
    tpl_db = db_session.query(RecurrenceTemplate).filter_by(id=2).first()

    # Verify full cluster restoration
    assert tx1_db.amount == 30.00
    assert tx1_db.description == "Abonnement Box"
    assert tx2_db.amount == 30.00
    assert tx2_db.description == "Abonnement Box"
    assert tpl_db.amount == 30.00
    assert tpl_db.description == "Abonnement Box"

    # REDO via history endpoint
    res_redo = client.post(f"/api/history/{action_id}/redo")
    assert res_redo.status_code == 200
    assert res_redo.json()["ok"] is True

    db_session.expire_all()
    tx1_db = db_session.query(Transaction).filter_by(id=201).first()
    tx2_db = db_session.query(Transaction).filter_by(id=202).first()
    tpl_db = db_session.query(RecurrenceTemplate).filter_by(id=2).first()

    # Verify full cluster re-application
    assert tx1_db.amount == 35.00
    assert tx1_db.description == "Fibre Box"
    assert tx2_db.amount == 35.00
    assert tx2_db.description == "Fibre Box"
    assert tpl_db.amount == 35.00
    assert tpl_db.description == "Fibre Box"


def test_propagation_diff_only_amount(client, db_session):
    """
    Scenario:
    - User modifies a transaction with propagate=True: changes ONLY amount (e.g. 100 to 120).
    - Description and category remain untouched across future transactions and template.
    """
    tpl = RecurrenceTemplate(
        id=3,
        description="Assurance Auto",
        amount=100.00,
        frequency="Monthly",
        category="Assurance",
        type="expense_fixed",
        from_account_id=1,
        day_of_month=15
    )
    db_session.add(tpl)
    db_session.commit()

    tx1 = Transaction(
        id=301,
        description="Assurance Auto",
        amount=100.00,
        date_operation=date(2026, 3, 15),
        type="expense_fixed",
        category="Assurance",
        from_account_id=1,
        recurrence_id=3
    )
    tx2 = Transaction(
        id=302,
        description="Assurance Auto",
        amount=100.00,
        date_operation=date(2026, 4, 15),
        type="expense_fixed",
        category="Assurance",
        from_account_id=1,
        recurrence_id=3
    )
    db_session.add_all([tx1, tx2])
    db_session.commit()

    payload = {
        "description": "Assurance Auto",
        "amount": 120.00,
        "date_operation": "2026-03-15",
        "category": "Assurance",
        "type": "expense_fixed",
        "from_account_id": 1
    }
    res = client.put("/api/transactions/301?propagate=true", json=payload)
    assert res.status_code == 200

    db_session.expire_all()
    tx1_db = db_session.query(Transaction).filter_by(id=301).first()
    tx2_db = db_session.query(Transaction).filter_by(id=302).first()
    tpl_db = db_session.query(RecurrenceTemplate).filter_by(id=3).first()

    assert tx1_db.amount == 120.00
    assert tx2_db.amount == 120.00
    assert tpl_db.amount == 120.00
    assert tx2_db.category == "Assurance"
    assert tpl_db.category == "Assurance"


def test_update_single_occurrence_no_propagate_even_when_reconciled(client, db_session):
    """
    Scenario:
    - User modifies an exceptional occurrence (e.g. amount 206 instead of 189) with propagate=False.
    - Transaction has a reconciliation_date.
    - Template and future transactions must NOT be touched.
    """
    tpl = RecurrenceTemplate(
        id=4,
        description="Facture Gaz",
        amount=189.90,
        frequency="Monthly",
        category="Energie",
        type="expense_fixed",
        from_account_id=1,
        day_of_month=20
    )
    db_session.add(tpl)
    db_session.commit()

    tx1 = Transaction(
        id=401,
        description="Facture Gaz",
        amount=189.90,
        date_operation=date(2026, 1, 20),
        reconciliation_date=date(2026, 1, 21),
        type="expense_fixed",
        category="Energie",
        from_account_id=1,
        recurrence_id=4
    )
    tx2 = Transaction(
        id=402,
        description="Facture Gaz",
        amount=189.90,
        date_operation=date(2026, 2, 20),
        type="expense_fixed",
        category="Energie",
        from_account_id=1,
        recurrence_id=4
    )
    db_session.add_all([tx1, tx2])
    db_session.commit()

    payload = {
        "description": "Facture Gaz - Regularisation",
        "amount": 250.00,
        "date_operation": "2026-01-20",
        "reconciliation_date": "2026-01-21",
        "category": "Energie",
        "type": "expense_fixed",
        "from_account_id": 1
    }
    res = client.put("/api/transactions/401?propagate=false", json=payload)
    assert res.status_code == 200

    db_session.expire_all()
    tx1_db = db_session.query(Transaction).filter_by(id=401).first()
    tx2_db = db_session.query(Transaction).filter_by(id=402).first()
    tpl_db = db_session.query(RecurrenceTemplate).filter_by(id=4).first()

    assert tx1_db.amount == 250.00
    assert tx1_db.description == "Facture Gaz - Regularisation"
    # Future occurrence remains untouched!
    assert tx2_db.amount == 189.90
    assert tx2_db.description == "Facture Gaz"
    # Template baseline remains untouched!
    assert tpl_db.amount == 189.90
    assert tpl_db.description == "Facture Gaz"
