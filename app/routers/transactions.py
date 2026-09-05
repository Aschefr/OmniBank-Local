from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List, Optional
from datetime import date, datetime

from app.database import get_db
from app.models import Transaction, Account, RecurrenceTemplate
from app.schemas.api_schemas import TransactionCreate, TransactionUpdate, TransactionOut
from app.services.history_service import record_action, snapshot_entity
from app.services import stats_cache

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

@router.get("/", response_model=List[TransactionOut])
def get_transactions(
    skip: int = 0,
    limit: int = 1000,
    search: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
    unreconciled_only: bool = Query(False),
    order: str = Query("desc"),
    db: Session = Depends(get_db)
):
    query = db.query(Transaction).filter(
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    )
    if account_id is not None:
        query = query.filter(
            or_(
                Transaction.from_account_id == account_id,
                Transaction.to_account_id == account_id
            )
        )
    if unreconciled_only:
        query = query.filter(Transaction.reconciliation_date == None)
    if search:
        import unicodedata
        from sqlalchemy import func
        def _strip_accents(s):
            return "".join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn').lower().strip()

        search_str = search.strip()
        clean_search = _strip_accents(search_str)
        search_pattern = f"%{clean_search}%"
        # Support searching description, category, or amount if search is numeric
        try:
            val = float(search_str.replace(',', '.'))
            amount_filter = and_(Transaction.amount >= val - 0.05, Transaction.amount <= val + 0.05)
            query = query.filter(
                or_(
                    func.unaccent(Transaction.description).like(search_pattern),
                    func.unaccent(Transaction.category).like(search_pattern),
                    amount_filter
                )
            )
        except ValueError:
            query = query.filter(
                or_(
                    func.unaccent(Transaction.description).like(search_pattern),
                    func.unaccent(Transaction.category).like(search_pattern)
                )
            )
    if order and order.lower() == "asc":
        return query.order_by(Transaction.date_operation.asc(), Transaction.id.asc()).offset(skip).limit(limit).all()
    return query.order_by(Transaction.date_operation.desc(), Transaction.id.desc()).offset(skip).limit(limit).all()

@router.get("/descriptions")
def get_unique_descriptions(db: Session = Depends(get_db)):
    # Group by description, get the most recent transaction for each
    from sqlalchemy import func
    
    # We can fetch all distinct descriptions by getting the latest transaction for each
    subquery = db.query(
        Transaction.description,
        func.max(Transaction.date_operation).label('max_date')
    ).group_by(Transaction.description).subquery()
    
    latest_txs = db.query(Transaction).join(
        subquery,
        (Transaction.description == subquery.c.description) & 
        (Transaction.date_operation == subquery.c.max_date)
    ).all()
    
    # In case there are multiple txs on the same max_date for a description, we just take the first one we process
    result = {}
    for tx in latest_txs:
        if tx.description and tx.description not in result:
            result[tx.description] = {
                "category": tx.category,
                "from_account_id": tx.from_account_id,
                "to_account_id": tx.to_account_id
            }
            
    # Sort alphabetically by key
    return {k: result[k] for k in sorted(result.keys())}

@router.post("/", response_model=TransactionOut)
def create_transaction(tx: TransactionCreate, db: Session = Depends(get_db)):
    db_tx = Transaction(**tx.model_dump())
    # Auto-set audit timestamp if created_by is present (org mode)
    if db_tx.created_by:
        db_tx.created_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    db.add(db_tx)
    if db_tx.recurrence_id and db_tx.reconciliation_date:
        template = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == db_tx.recurrence_id).first()
        if template:
            template.amount = db_tx.amount
    db.flush()
    action_id = record_action(db, "transaction", db_tx.id, "CREATE", None, snapshot_entity(db_tx), user_name=db_tx.created_by)
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_tx)
    db_tx.action_id = action_id
    return db_tx

@router.get("/{tx_id}", response_model=TransactionOut)
def get_transaction(tx_id: int, db: Session = Depends(get_db)):
    db_tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not db_tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return db_tx

@router.put("/{tx_id}", response_model=TransactionOut)
def update_transaction(tx_id: int, tx_update: TransactionUpdate, propagate: bool = False, db: Session = Depends(get_db)):
    db_tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not db_tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
        
    old_snapshot = snapshot_entity(db_tx)
    update_data = tx_update.model_dump(exclude_unset=True)
    # Auto-set audit timestamp if modified_by is present (org mode)
    if "modified_by" in update_data and update_data["modified_by"]:
        update_data["modified_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
        
    # Special handling for is_skipped in update (non-destructive: amount is preserved)
    if "is_skipped" in update_data:
        was_skipped = db_tx.is_skipped
        new_skipped = update_data["is_skipped"]
        if new_skipped and not was_skipped:
            db_tx.is_skipped = True
            if not db_tx.reconciliation_date:
                db_tx.reconciliation_date = date.today()
        elif not new_skipped and was_skipped:
            db_tx.is_skipped = False
            db_tx.reconciliation_date = None
                    
    for key, value in update_data.items():
        if key != "is_skipped": # Handled specifically above
            setattr(db_tx, key, value)
        
    if propagate and db_tx.recurrence_id:
        # Update all future instances belonging to the same recurrence
        future_txs = db.query(Transaction).filter(
            Transaction.recurrence_id == db_tx.recurrence_id,
            Transaction.date_operation > db_tx.date_operation
        ).all()
        for ftx in future_txs:
            for key, value in update_data.items():
                if key not in ['date_operation', 'reconciliation_date']: # Do not propagate dates
                    setattr(ftx, key, value)
        
        # Update the template itself
        template = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == db_tx.recurrence_id).first()
        if template:
            for key, value in update_data.items():
                if hasattr(template, key) and key not in ['date_operation', 'reconciliation_date']:
                    setattr(template, key, value)
                    
    if db_tx.recurrence_id and db_tx.reconciliation_date:
        template = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == db_tx.recurrence_id).first()
        if template:
            template.amount = db_tx.amount
    db.flush()
    action_id = record_action(db, "transaction", db_tx.id, "UPDATE", old_snapshot, snapshot_entity(db_tx), user_name=db_tx.modified_by)
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_tx)
    db_tx.action_id = action_id
    return db_tx

@router.delete("/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    db_tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not db_tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    old_snapshot = snapshot_entity(db_tx)
    user_name = db_tx.modified_by or db_tx.created_by
    db.delete(db_tx)
    action_id = record_action(db, "transaction", tx_id, "DELETE", old_snapshot, None, user_name=user_name)
    db.commit()
    stats_cache.invalidate()
    return {"ok": True, "action_id": action_id}

@router.post("/{tx_id}/toggle_reconciliation")
def toggle_reconciliation(tx_id: int, db: Session = Depends(get_db)):
    db_tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not db_tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
        
    old_snapshot = snapshot_entity(db_tx)
    if db_tx.reconciliation_date:
        db_tx.reconciliation_date = None
    else:
        db_tx.reconciliation_date = date.today()
        
    if db_tx.recurrence_id and db_tx.reconciliation_date:
        template = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == db_tx.recurrence_id).first()
        if template:
            template.amount = db_tx.amount
    db.flush()
    action_id = record_action(db, "transaction", db_tx.id, "UPDATE", old_snapshot, snapshot_entity(db_tx), user_name=db_tx.modified_by or db_tx.created_by)
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_tx)
    return {"reconciliation_date": db_tx.reconciliation_date, "action_id": action_id}

@router.post("/{tx_id}/toggle_skip")
def toggle_skip(tx_id: int, db: Session = Depends(get_db)):
    db_tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not db_tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
        
    old_snapshot = snapshot_entity(db_tx)
    if db_tx.is_skipped:
        # Unskip: clear flag and remove auto-reconciliation (amount was never changed)
        db_tx.is_skipped = False
        db_tx.reconciliation_date = None
    else:
        # Skip: flag only, preserve original amount
        db_tx.is_skipped = True
        db_tx.reconciliation_date = date.today()
        
    db.flush()
    action_id = record_action(db, "transaction", db_tx.id, "UPDATE", old_snapshot, snapshot_entity(db_tx), user_name=db_tx.modified_by or db_tx.created_by)
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_tx)
    return {
        "is_skipped": db_tx.is_skipped,
        "amount": db_tx.amount,
        "reconciliation_date": db_tx.reconciliation_date,
        "action_id": action_id
    }

@router.delete("/all/clear", status_code=200)
def clear_all_transactions(
    x_confirm_danger: Optional[str] = Header(None, alias="X-Confirm-Danger"),
    db: Session = Depends(get_db)
):
    """Deletes all user data from the database (Danger Zone) - requires explicit confirmation header."""
    if x_confirm_danger != "clear":
        raise HTTPException(
            status_code=400,
            detail="En-tête de confirmation obligatoire manquant (X-Confirm-Danger: clear)."
        )
    from app.models import BudgetCategory, Budget, RecurrenceTemplate, Account, Category
    db.query(Transaction).delete()
    db.query(BudgetCategory).delete()
    db.query(Budget).delete()
    db.query(RecurrenceTemplate).delete()
    db.query(Account).delete()
    db.query(Category).delete()
    db.commit()
    stats_cache.invalidate()
    return {"ok": True, "message": "All user data has been deleted"}
