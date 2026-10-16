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


def test_transaction_fallback_correction_and_deletion(db_session):
    from app.models import Transaction, Account
    from app.services.chat.tools.write_tools import apply_transaction_correction_tool, delete_transaction_tool

    acc = db_session.query(Account).first()
    if not acc:
        acc = Account(name="Test Account Tx", type="checking", initial_balance=500.0)
        db_session.add(acc)
        db_session.flush()

    # Create a test transaction
    tx = Transaction(
        description="Acompte Provisionnel DGFIP",
        amount=331.0,
        category="Inconnu",
        type="expense_var",
        date_operation=date(2026, 10, 15),
        from_account_id=acc.id
    )
    db_session.add(tx)
    db_session.commit()
    real_tx_id = tx.id

    try:
        # 1. Update with hallucinated transaction_id but matching description & amount
        res_update = apply_transaction_correction_tool(
            db_session,
            transaction_id=999999,
            description="Acompte DGFIP",
            amount=331.0,
            category="Impôts",
            force_write=True
        )
        assert res_update.get("success") is True
        assert res_update.get("transaction_id") == real_tx_id

        db_session.refresh(tx)
        assert tx.category == "Impôts"

        # 2. Delete with hallucinated transaction_id but matching description & amount
        res_del = delete_transaction_tool(
            db_session,
            transaction_id=888888,
            description="DGFIP",
            amount=331.0,
            force_write=True
        )
        assert res_del.get("success") is True
        assert res_del.get("transaction_id") == real_tx_id

        # Verify deletion from DB
        deleted_tx = db_session.query(Transaction).filter(Transaction.id == real_tx_id).first()
        assert deleted_tx is None
    finally:
        remaining = db_session.query(Transaction).filter(Transaction.id == real_tx_id).first()
        if remaining:
            db_session.delete(remaining)
            db_session.commit()


def test_store_and_forget_financial_facts(db_session):
    from app.models import AIFact
    from app.services.chat.tools.write_tools import store_financial_fact_tool, forget_financial_fact_tool
    from app.services.chat.chat_briefing import generate_financial_briefing

    test_key = "test_acompte_impots_2026"
    test_val = "Acompte impôts de +331 €/mois jusqu'en décembre 2026"

    try:
        # 1. Store fact
        res_store = store_financial_fact_tool(db_session, key=test_key, value=test_val)
        assert res_store.get("success") is True
        assert res_store.get("ok") is True

        fact_row = db_session.query(AIFact).filter(AIFact.fact_key == test_key).first()
        assert fact_row is not None
        assert fact_row.fact_value == test_val

        # 2. Verify fact appears in briefing Live Financial Dossier
        briefing = generate_financial_briefing(db_session)
        assert "Known Financial Facts & Memory (ai_facts)" in briefing
        assert test_val in briefing

        # 3. Forget fact
        res_forget = forget_financial_fact_tool(db_session, key=test_key)
        assert res_forget.get("success") is True
        assert res_forget.get("ok") is True

        fact_row_after = db_session.query(AIFact).filter(AIFact.fact_key == test_key).first()
        assert fact_row_after is None
    finally:
        cleanup_fact = db_session.query(AIFact).filter(AIFact.fact_key == test_key).first()
        if cleanup_fact:
            db_session.delete(cleanup_fact)
            db_session.commit()


def test_bridge_restitution_briefing_prompt(db_session):
    from datetime import timedelta
    from app.models import Account, Transaction
    from app.services.chat.chat_briefing import generate_financial_briefing
    from app.services.chat.tools.write_tools import create_planned_transfer_tool

    # Ensure checking and savings accounts exist
    savings = db_session.query(Account).filter(Account.type == "savings").first()
    checking = db_session.query(Account).filter(Account.type == "checking").first()
    if not savings:
        savings = Account(name="Livret A Test", type="savings", initial_balance=2000.0)
        db_session.add(savings)
        db_session.flush()
    if not checking:
        checking = Account(name="Courant Test", type="checking", initial_balance=50.0)
        db_session.add(checking)
        db_session.flush()
    db_session.commit()

    today = date.today()

    # Create bridge transfer from savings to checking (e.g. 250 EUR)
    bridge_tx = Transaction(
        amount=250.0,
        type="transfer",
        category="Virement interne",
        description="Virement pont Livret A -> Courant",
        date_operation=today,
        from_account_id=savings.id,
        to_account_id=checking.id
    )
    db_session.add(bridge_tx)
    db_session.commit()

    return_tx_id = None
    try:
        # 1. Briefing should detect pending restitution
        briefing_before = generate_financial_briefing(db_session)
        assert "Pending Savings Restitution" in briefing_before
        assert "250.00" in briefing_before
        assert "ACTION REQUIRED: Propose scheduling the return transfer" in briefing_before

        # 2. Schedule the return transfer
        res_return = create_planned_transfer_tool(
            db_session,
            from_account=checking.name,
            to_account=savings.name,
            amount=250.0,
            description="Reconstitution épargne de précaution Livret A",
            date_operation=(today + timedelta(days=5)).isoformat(),
            force_write=True
        )
        assert res_return.get("success") is True
        return_tx_id = res_return.get("transaction_id")

        # 3. Briefing should now show scheduled restitution instead of pending
        briefing_after = generate_financial_briefing(db_session)
        assert "Scheduled Savings Restitution" in briefing_after
        assert "Pending Savings Restitution" not in briefing_after

    finally:
        # Cleanup
        db_session.delete(bridge_tx)
        if return_tx_id:
            rtx = db_session.query(Transaction).filter(Transaction.id == return_tx_id).first()
            if rtx:
                db_session.delete(rtx)
        db_session.commit()



