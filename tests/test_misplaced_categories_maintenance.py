import pytest
from app.database import SessionLocal
from app.models import Category, Transaction, RecurrenceTemplate
from app.routers.maintenance import (
    _audit_misplaced_categories,
    preview_misplaced_categories,
    apply_misplaced_categories,
    MisplacedCategoriesApplyRequest,
    CategoryFixItem
)


def test_misplaced_categories_maintenance_lifecycle():
    db = SessionLocal()
    try:
        # Create a test category with wrong type
        test_cat_name = "Test Virement Interne Anomaly"
        existing_cat = db.query(Category).filter(Category.name == test_cat_name).first()
        if existing_cat:
            db.delete(existing_cat)
            db.commit()

        test_cat = Category(name=test_cat_name, type="expense_fixed")
        db.add(test_cat)
        db.commit()

        # Add 3 bidirectional transactions
        tx1 = Transaction(description="Virement test 1", amount=150.0, type="expense_fixed", category=test_cat_name, from_account_id=1, to_account_id=2)
        tx2 = Transaction(description="Virement test 2", amount=200.0, type="expense_fixed", category=test_cat_name, from_account_id=1, to_account_id=2)
        tx3 = Transaction(description="Virement test 3", amount=350.0, type="expense_fixed", category=test_cat_name, from_account_id=2, to_account_id=1)
        db.add_all([tx1, tx2, tx3])

        # Add a recurrence template
        tmpl = RecurrenceTemplate(description="Virement test mensuel", amount=150.0, type="expense_fixed", category=test_cat_name, from_account_id=1, to_account_id=2, frequency="Monthly")
        db.add(tmpl)
        db.commit()

        # Step 1: Preview audit
        preview = preview_misplaced_categories(db)
        found = [c for c in preview["categories"] if c["name"] == test_cat_name]
        assert len(found) == 1
        assert found[0]["current_type"] == "expense_fixed"
        assert found[0]["suggested_type"] == "transfer"
        assert found[0]["total_txs"] == 3
        assert found[0]["bidi_txs"] == 3

        # Step 2: Apply fix
        req = MisplacedCategoriesApplyRequest(
            fixes=[CategoryFixItem(category=test_cat_name, new_type="transfer")],
            sync_all_tx_types=True
        )
        res = apply_misplaced_categories(req, db)
        assert res["categories_fixed"] >= 1

        # Step 3: Verify DB updates
        db.refresh(test_cat)
        assert test_cat.type == "transfer"

        db.refresh(tx1)
        db.refresh(tx2)
        db.refresh(tx3)
        assert tx1.type == "transfer"
        assert tx2.type == "transfer"
        assert tx3.type == "transfer"

        db.refresh(tmpl)
        assert tmpl.type == "transfer"

        # Step 4: Preview again, anomaly must be resolved
        preview2 = preview_misplaced_categories(db)
        found2 = [c for c in preview2["categories"] if c["name"] == test_cat_name]
        assert len(found2) == 0

        # Clean up
        db.delete(tx1)
        db.delete(tx2)
        db.delete(tx3)
        db.delete(tmpl)
        db.delete(test_cat)
        db.commit()

    finally:
        db.close()
