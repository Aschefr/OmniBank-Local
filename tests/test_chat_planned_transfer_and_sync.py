"""
tests/test_chat_planned_transfer_and_sync.py — Tests for create_planned_transfer_tool,
trigger_bank_sync_tool, and their orchestration in chat actions.
"""
from datetime import date
from unittest.mock import patch, MagicMock
import pytest
from app.database import SessionLocal
from app.models import Account, Transaction, BankConnection
from app.services.chat.tools.write_tools import (
    create_planned_transfer_tool,
    trigger_bank_sync_tool,
)
from app.services.chat.chat_orchestrator import execute_chat_action


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_create_planned_transfer_dry_run(db_session):
    res = create_planned_transfer_tool(
        db_session,
        from_account="Livret A",
        to_account="Compte Courant",
        amount=280.0,
        force_write=False
    )
    assert res.get("success") is True
    assert res.get("pending_validation") is True


def test_create_planned_transfer_execution(db_session):
    # Ensure two test accounts exist
    acc1 = db_session.query(Account).filter(Account.type == "savings").first()
    acc2 = db_session.query(Account).filter(Account.type == "checking").first()
    
    if not acc1:
        acc1 = Account(name="Test Livret Epargne", type="savings", initial_balance=1000.0)
        db_session.add(acc1)
        db_session.flush()
    if not acc2:
        acc2 = Account(name="Test Compte Courant", type="checking", initial_balance=200.0)
        db_session.add(acc2)
        db_session.flush()
    db_session.commit()

    res = create_planned_transfer_tool(
        db_session,
        from_account=acc1.name,
        to_account=acc2.name,
        amount=280.0,
        description="Virement de précaution test",
        date_operation=date.today().isoformat(),
        force_write=True
    )

    assert res.get("success") is True
    tx_id = res.get("transaction_id")
    assert tx_id is not None

    tx = db_session.query(Transaction).filter(Transaction.id == tx_id).first()
    assert tx is not None
    assert tx.amount == 280.0
    assert tx.type == "transfer"
    assert tx.category == "Virement interne"
    assert tx.from_account_id == acc1.id
    assert tx.to_account_id == acc2.id
    assert tx.reconciliation_date is None

    # Clean up test transaction
    db_session.delete(tx)
    db_session.commit()


def test_create_planned_transfer_nonexistent_account(db_session):
    res = create_planned_transfer_tool(
        db_session,
        from_account="NonExistentSource999",
        to_account="NonExistentTarget999",
        amount=150.0,
        force_write=True
    )
    assert res.get("success") is False
    assert "introuvables" in res.get("error", "").lower()


def test_trigger_bank_sync_dry_run(db_session):
    res = trigger_bank_sync_tool(db_session, force_write=False)
    assert res.get("success") is True
    assert res.get("pending_validation") is True


def test_trigger_bank_sync_no_connections(db_session):
    with patch("app.models.BankConnection") as mock_conn:
        # If query for active connections returns empty list
        with patch.object(db_session, "query") as mock_query:
            mock_query.return_value.filter.return_value.all.return_value = []
            res = trigger_bank_sync_tool(db_session, force_write=True)
            assert res.get("success") is False
            assert "aucune connexion bancaire" in res.get("error", "").lower()


def test_trigger_bank_sync_locked_vault(db_session):
    # Mock active connections exist but vault is locked
    with patch.object(db_session, "query") as mock_query:
        mock_conn = MagicMock()
        mock_conn.is_active = True
        mock_query.return_value.filter.return_value.all.return_value = [mock_conn]

        with patch("app.services.credential_vault.VaultSessionManager.is_unlocked", return_value=False):
            res = trigger_bank_sync_tool(db_session, force_write=True)
            assert res.get("success") is False
            assert "coffre-fort" in res.get("error", "").lower()


def test_trigger_bank_sync_success_when_unlocked(db_session):
    with patch.object(db_session, "query") as mock_query:
        mock_conn = MagicMock()
        mock_conn.is_active = True
        mock_query.return_value.filter.return_value.all.return_value = [mock_conn]

        with patch("app.services.credential_vault.VaultSessionManager.is_unlocked", return_value=True):
            with patch("app.services.bank_sync.auto_sync.is_background_sync_running", return_value=False):
                with patch("app.services.bank_sync.auto_sync.trigger_manual_auto_sync") as mock_launch:
                    mock_launch.return_value = {"ok": True, "message": "Synchronisation lancée"}
                    res = trigger_bank_sync_tool(db_session, force_write=True)
                    assert res.get("success") is True
                    assert "Synchronisation lancée" in res.get("message")
                    assert res.get("connections_count") == 1
                    mock_launch.assert_called_once()


def test_execute_chat_action_routing(db_session):
    # Test routing to create_planned_transfer
    acc1 = db_session.query(Account).filter(Account.type == "savings").first()
    acc2 = db_session.query(Account).filter(Account.type == "checking").first()
    if acc1 and acc2:
        res = execute_chat_action(
            db_session,
            action="create_planned_transfer",
            params={
                "from_account": acc1.name,
                "to_account": acc2.name,
                "amount": 50.0,
                "description": "Test action routing"
            }
        )
        assert res.get("success") is True
        tx_id = res.get("transaction_id")
        tx = db_session.query(Transaction).filter(Transaction.id == tx_id).first()
        if tx:
            db_session.delete(tx)
            db_session.commit()
