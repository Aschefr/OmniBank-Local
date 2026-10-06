import pytest
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.models import Transaction, BankLabelMapping, Account, Category
from app.services.autopilot_service import validate_review_transaction
from app.main import app


@pytest.fixture
def review_test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    acc = Account(id=1, name="Courant", currency="EUR", is_closed=False, type="Compte courant")
    cat = Category(id=1, name="Remboursement", type="income")
    db.add_all([acc, cat])
    db.commit()

    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(review_test_db):
    def override_get_db():
        try:
            yield review_test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_validate_review_transaction_force_keep_current(review_test_db):
    # 1. Créer une transaction avec needs_review=True et un libellé brut distinct
    tx = Transaction(
        id=3163,
        date_saisie=date(2026, 10, 5),
        date_operation=date(2026, 10, 5),
        amount=137.50,
        type="income",
        category="Remboursement",
        description="Marine - Part impots 2025",
        raw_description="VIR INST de MLLE MARINE PLAZA",
        needs_review=True,
        confidence_score=65.0,
        to_account_id=1
    )
    review_test_db.add(tx)
    review_test_db.commit()
    review_test_db.refresh(tx)

    # 2. Valider avec force_keep_current=True
    res = validate_review_transaction(review_test_db, tx_id=tx.id, force_keep_current=True)
    assert res["success"] is True

    # 3. Vérifier que needs_review est False et description inchangée
    review_test_db.refresh(tx)
    assert tx.needs_review is False
    assert tx.description == "Marine - Part impots 2025"

    # 4. Vérifier que la règle d'apprentissage BankLabelMapping a été créée / apprise
    mapping = review_test_db.query(BankLabelMapping).filter(
        BankLabelMapping.clean_description == "Marine - Part impots 2025"
    ).first()
    assert mapping is not None
    assert mapping.is_manual is True


def test_api_review_validate_endpoint(client, review_test_db):
    tx = Transaction(
        id=3164,
        date_saisie=date(2026, 10, 5),
        date_operation=date(2026, 10, 5),
        amount=50.0,
        type="expense_var",
        category="Remboursement",
        description="Frais divers",
        raw_description="PRELEVEMENT DIVERS",
        needs_review=True,
        confidence_score=70.0,
        from_account_id=1
    )
    review_test_db.add(tx)
    review_test_db.commit()

    response = client.post("/api/autopilot/review/3164/validate?force_keep_current=true")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["id"] == 3164

    review_test_db.refresh(tx)
    assert tx.needs_review is False


def test_validate_review_with_competing_candidate_preserved(review_test_db):
    # Créer une prévision concurrente sur le même compte avec montant similaire
    cand = Transaction(
        id=4000,
        date_saisie=date(2026, 10, 5),
        date_operation=date(2026, 10, 5),
        amount=150.0,
        type="income",
        category="Autre",
        description="Aide de Marine",
        raw_description=None,
        recurrence_id=10,
        to_account_id=1
    )
    tx = Transaction(
        id=4001,
        date_saisie=date(2026, 10, 5),
        date_operation=date(2026, 10, 5),
        amount=150.0,
        type="income",
        category="Remboursement",
        description="Marine - Part impots 2025",
        raw_description="VIR INST de MLLE MARINE PLAZA",
        needs_review=True,
        confidence_score=65.0,
        to_account_id=1
    )
    review_test_db.add_all([cand, tx])
    review_test_db.commit()

    # Quand l'utilisateur clique sur "C'est OK" (force_keep_current=True)
    res = validate_review_transaction(review_test_db, tx_id=tx.id, force_keep_current=True)
    assert res["success"] is True

    review_test_db.refresh(tx)
    # L'opération courante doit être préservée et NON écrasée par la prévision candidate
    assert tx.needs_review is False
    assert tx.description == "Marine - Part impots 2025"
