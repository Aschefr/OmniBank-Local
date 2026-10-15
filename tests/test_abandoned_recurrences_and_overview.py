import pytest
from datetime import date, timedelta
from app.database import SessionLocal
from app.models import RecurrenceTemplate, Transaction
from app.routers.maintenance import (
    _find_abandoned_recurrences,
    preview_abandoned_recurrences,
    apply_abandoned_recurrences,
    AbandonedRecurrencesApplyRequest,
    get_maintenance_overview
)


def test_abandoned_recurrences_and_overview_lifecycle():
    db = SessionLocal()
    created_tpl_ids = []
    created_tx_ids = []

    try:
        today = date.today()

        # 1. Create a dummy active template that is abandoned (monthly, last confirmed 120 days ago)
        tpl1 = RecurrenceTemplate(
            description="Test Abandoned Box Monthly",
            amount=29.99,
            frequency="Monthly",
            type="expense_fixed",
            is_closed=False
        )
        db.add(tpl1)
        db.commit()
        db.refresh(tpl1)
        created_tpl_ids.append(tpl1.id)

        # Add an old confirmed transaction (120 days ago)
        old_date = today - timedelta(days=120)
        tx_old = Transaction(
            description="Test Abandoned Box Monthly",
            amount=29.99,
            date_operation=old_date,
            reconciliation_date=old_date,
            recurrence_id=tpl1.id,
            type="expense_fixed"
        )
        # Add 2 future phantom transactions (unreconciled)
        tx_future1 = Transaction(
            description="Test Abandoned Box Monthly",
            amount=29.99,
            date_operation=today + timedelta(days=10),
            reconciliation_date=None,
            recurrence_id=tpl1.id,
            type="expense_fixed"
        )
        tx_future2 = Transaction(
            description="Test Abandoned Box Monthly",
            amount=29.99,
            date_operation=today + timedelta(days=40),
            reconciliation_date=None,
            recurrence_id=tpl1.id,
            type="expense_fixed"
        )
        db.add_all([tx_old, tx_future1, tx_future2])
        db.commit()
        created_tx_ids.extend([tx_old.id, tx_future1.id, tx_future2.id])

        # 2. Test Overview endpoint
        overview = get_maintenance_overview(db)
        assert "tools" in overview
        assert "abandoned_recurrences" in overview["tools"]
        assert overview["tools"]["abandoned_recurrences"]["count"] >= 1
        assert overview["tools"]["abandoned_recurrences"]["status"] == "warning"

        # 3. Test Preview endpoint
        preview = preview_abandoned_recurrences(db)
        assert preview["count"] >= 1
        found = [t for t in preview["templates"] if t["id"] == tpl1.id]
        assert len(found) == 1
        item = found[0]
        assert item["unpointed_count"] == 2
        assert "Inactif depuis 120 jours" in item["reason"]

        f1_id = tx_future1.id
        f2_id = tx_future2.id

        # 4. Apply fix: Close tpl1 and purge phantom unreconciled transactions
        apply_req = AbandonedRecurrencesApplyRequest(
            template_ids=[tpl1.id],
            purge_unreconciled=True,
            unlink_mismatched=True
        )
        res = apply_abandoned_recurrences(apply_req, db)
        assert res["closed_templates"] == 1
        assert res["purged_transactions"] == 2

        # 5. Verify DB state: template is closed, phantom transactions are gone
        db.refresh(tpl1)
        assert tpl1.is_closed is True

        surviving_future = db.query(Transaction).filter(
            Transaction.id.in_([f1_id, f2_id])
        ).all()
        assert len(surviving_future) == 0

        # Confirmed transaction still exists
        db.refresh(tx_old)
        assert tx_old.id is not None

        # 6. Verify template no longer appears in preview
        preview_after = preview_abandoned_recurrences(db)
        found_after = [t for t in preview_after["templates"] if t["id"] == tpl1.id]
        assert len(found_after) == 0

    finally:
        # Cleanup test data
        for tx_id in created_tx_ids:
            tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
            if tx:
                db.delete(tx)
        for tpl_id in created_tpl_ids:
            tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
            if tpl:
                db.delete(tpl)
        db.commit()
        db.close()
