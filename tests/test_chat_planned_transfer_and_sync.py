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
from app.services.chat.chat_orchestrator import execute_chat_action, WRITE_TOOLS


def test_write_tools_includes_planned_transfer_and_sync():
    assert "create_planned_transfer" in WRITE_TOOLS
    assert "trigger_bank_sync" in WRITE_TOOLS



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


def test_register_notify_on_complete_lifecycle(db_session):
    import json
    from app.models import Notification
    from app.services.chat.chat_orchestrator import (
        register_notify_on_complete,
        _generating_sessions,
        _notify_on_complete,
        _resolve_profile_id,
    )

    pid = _resolve_profile_id()
    test_session_id = 99999
    key = (pid, test_session_id)

    # 1. When session is actively generating: adds to _notify_on_complete set
    _generating_sessions.add(key)
    try:
        res = register_notify_on_complete(test_session_id, db_session)
        assert res.get("ok") is True
        assert key in _notify_on_complete
    finally:
        _generating_sessions.discard(key)
        _notify_on_complete.discard(key)

    # 2. When session is not generating: creates an immediate Notification
    res2 = register_notify_on_complete(test_session_id, db_session)
    assert res2.get("ok") is True
    notif = db_session.query(Notification).filter(
        Notification.type == "system",
        Notification.link_data == json.dumps({"session_id": test_session_id}),
    ).order_by(Notification.id.desc()).first()
    assert notif is not None
    assert "Réponse IA disponible" in notif.title
    assert notif.created_at is not None

    # Clean up test notification
    db_session.delete(notif)
    db_session.commit()


def test_update_budget_envelope_name_fallback(db_session):
    from app.models import Budget
    from app.services.chat.tools.write_tools import update_budget_envelope_tool, delete_budget_envelope_tool

    # Create a test budget
    b = Budget(name="Impots Test Fallback", monthly_amount=79.0, period="monthly", is_closed=False)
    db_session.add(b)
    db_session.commit()
    real_id = b.id

    try:
        # LLM passed a hallucinated ID (e.g. 1 or 99999), but with accented or exact name
        res = update_budget_envelope_tool(
            db_session,
            budget_id=999999,
            name="Impôts Test Fallback",
            monthly_amount=410.0,
            force_write=True
        )
        assert res.get("success") is True
        assert res.get("budget_id") == real_id

        # Verify DB was updated
        db_session.refresh(b)
        assert b.monthly_amount == 410.0

        # Test delete with name fallback
        res_del = delete_budget_envelope_tool(
            db_session,
            budget_id=888888,
            name="Impots Test Fallback",
            force_write=True
        )
        assert res_del.get("success") is True
        assert res_del.get("budget_id") == real_id
    finally:
        # Cleanup if still exists
        remaining = db_session.query(Budget).filter(Budget.id == real_id).first()
        if remaining:
            db_session.delete(remaining)
            db_session.commit()


def test_update_recurrence_template_description_fallback(db_session):
    from app.models import RecurrenceTemplate
    from app.services.chat.tools.write_tools import update_recurrence_template_tool, delete_recurrence_template_tool

    # Create a test recurrence
    tpl = RecurrenceTemplate(
        description="Abonnement Netflix Test",
        amount=-15.99,
        frequency="Monthly",
        category="Loisirs",
        type="expense_fixed",
        day_of_month=5,
        is_closed=False,
        from_account_id=1
    )
    db_session.add(tpl)
    db_session.commit()
    real_id = tpl.id

    try:
        # Update with wrong ID but matching description
        res = update_recurrence_template_tool(
            db_session,
            template_id=777777,
            description="Abonnement Netflix Test",
            amount=-19.99,
            force_write=True
        )
        assert res.get("success") is True
        assert res.get("template_id") == real_id

        db_session.refresh(tpl)
        assert tpl.amount == -19.99

        # Delete with wrong ID but matching description
        res_del = delete_recurrence_template_tool(
            db_session,
            template_id=666666,
            description="Abonnement Netflix Test",
            force_write=True
        )
        assert res_del.get("success") is True
        assert res_del.get("template_id") == real_id
    finally:
        rem = db_session.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == real_id).first()
        if rem:
            db_session.delete(rem)
            db_session.commit()


