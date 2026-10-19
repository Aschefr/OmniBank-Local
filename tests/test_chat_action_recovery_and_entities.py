import pytest
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.models import ChatMessage, ChatSession, Account, RecurrenceTemplate, Transaction
from app.services.chat.chat_action_recovery import (
    has_unemitted_promised_action,
    extract_unemitted_actions,
    append_actions_to_text,
)
from app.services.chat.chat_snapshot import build_entity_snapshots
from app.main import app


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield db
    finally:
        db.close()
        app.dependency_overrides.pop(get_db, None)


def test_has_unemitted_promised_action():
    text_with_promise_1 = (
        "1. Sécurisation de la Trésorerie : J'ai préparé l'enregistrement d'un virement de précaution de 310 EUR "
        "de votre Épargne disponible vers votre compte courant. Veuillez l'examiner et le valider ci-dessous."
    )
    assert has_unemitted_promised_action(text_with_promise_1) is True

    text_with_promise_2 = (
        "Pour optimiser votre liquidité, j'ai également préparé l'enregistrement du virement de retour de 250 EUR "
        "de CA Centre-Est vers Livret A, à planifier le 29 octobre 2026. Veuillez l'examiner et le valider ci-dessous."
    )
    assert has_unemitted_promised_action(text_with_promise_2) is True

    text_without_promise = (
        "Voici un aperçu de vos dépenses pour le mois d'octobre. Vous avez dépensé 1200 EUR au total."
    )
    assert has_unemitted_promised_action(text_without_promise) is False


def test_extract_unemitted_actions_and_deduplication(test_db):
    # Setup test accounts
    acc_checking = Account(name="CA Centre-Est", type="checking", initial_balance=500.0)
    acc_savings = Account(name="Livret A", type="savings", initial_balance=3000.0)
    test_db.add_all([acc_checking, acc_savings])
    test_db.commit()

    text = (
        "Recommandation : Le dossier signale un besoin de fonds de précaution. Il est fortement recommandé "
        "de procéder au virement de précaution de ~310 EUR de votre Épargne disponible vers votre compte courant.\n\n"
        "1. Sécurisation : J'ai préparé l'enregistrement d'un virement de précaution de 310 EUR de votre Épargne disponible "
        "vers votre compte courant. Veuillez l'examiner et le valider ci-dessous.\n"
        "2. Rééquilibrage : Pour optimiser votre liquidité, j'ai également préparé l'enregistrement du virement de retour de 250 EUR "
        "de CA Centre-Est vers Livret A, à planifier le 29 octobre 2026. Veuillez l'examiner et le valider ci-dessous."
    )

    actions = extract_unemitted_actions(text, test_db, target_year=2026, target_month=10)
    assert len(actions) == 2

    # Check first action: 310 EUR savings -> checking
    act1 = actions[0]
    assert act1["action"] == "create_planned_transfer"
    assert act1["params"]["amount"] == 310.0
    assert act1["params"]["from_account"] == "Livret A"
    assert act1["params"]["to_account"] == "CA Centre-Est"

    # Check second action: 250 EUR checking -> savings with date 2026-10-29
    act2 = actions[1]
    assert act2["action"] == "create_planned_transfer"
    assert act2["params"]["amount"] == 250.0
    assert act2["params"]["from_account"] == "CA Centre-Est"
    assert act2["params"]["to_account"] == "Livret A"
    assert act2["params"]["date_operation"] == "2026-10-29"

    # Test appending actions to text
    new_text = append_actions_to_text("Test content", actions)
    assert "```action" in new_text
    assert '"create_planned_transfer"' in new_text


def test_recover_actions_endpoint(test_db):
    client = TestClient(app)

    # Setup test accounts & session
    acc_checking = Account(name="Compte Courant Test", type="checking", initial_balance=100.0)
    acc_savings = Account(name="Livret Epargne Test", type="savings", initial_balance=2000.0)
    test_db.add_all([acc_checking, acc_savings])
    test_db.commit()

    chat_sess = ChatSession(title="Session Test Recovery", role="analyste")
    test_db.add(chat_sess)
    test_db.commit()

    msg_content = (
        "J'ai préparé l'enregistrement d'un virement de précaution de 150 EUR de votre Livret Epargne Test "
        "vers votre Compte Courant Test. Veuillez l'examiner et le valider ci-dessous."
    )
    msg = ChatMessage(session_id=chat_sess.id, role="assistant", content=msg_content)
    test_db.add(msg)
    test_db.commit()
    test_db.refresh(msg)

    response = client.post(f"/api/chat/messages/{msg.id}/recover-actions")
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert len(data["actions"]) == 1
    assert data["actions"][0]["params"]["amount"] == 150.0
    assert "```action" in data["new_content"]

    # Verify message in DB was updated
    test_db.refresh(msg)
    assert "```action" in msg.content


def test_build_entity_snapshots_includes_recurrence_and_transaction(test_db):
    acc = Account(name="Banque Populaire", type="checking", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    rec = RecurrenceTemplate(
        description="Abonnement Fibre Test",
        amount=39.99,
        category="Abonnements",
        frequency="Monthly",
        day_of_month=5,
        type="expense_fixed",
        from_account_id=acc.id
    )
    tx = Transaction(
        description="Garage Express Test",
        amount=-150.0,
        category="Automobile",
        date_operation=date(2026, 10, 15),
        from_account_id=acc.id
    )
    test_db.add_all([rec, tx])
    test_db.commit()

    text = "Votre abonnement Abonnement Fibre Test a été prélevé et la facture Garage Express Test est réglée."
    snapshots = build_entity_snapshots(
        final_text=text,
        db=test_db,
        year=2026,
        month=10
    )

    assert "recurrence:Abonnement Fibre Test" in snapshots
    rec_snap = snapshots["recurrence:Abonnement Fibre Test"]
    assert rec_snap["type"] == "recurrence"
    assert rec_snap["amount"] == 39.99
    assert rec_snap["from_account"] == "Banque Populaire"

    assert "transaction:Garage Express Test" in snapshots
    tx_snap = snapshots["transaction:Garage Express Test"]
    assert tx_snap["type"] == "transaction"
    assert tx_snap["amount"] == -150.0
    assert tx_snap["category"] == "Automobile"
