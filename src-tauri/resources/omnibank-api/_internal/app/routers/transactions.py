from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import date, datetime

from app.database import get_db
from app.models import Transaction, Account, RecurrenceTemplate
from app.schemas.api_schemas import TransactionCreate, TransactionUpdate, TransactionOut

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

@router.get("/", response_model=List[TransactionOut])
def get_transactions(skip: int = 0, limit: int = 1000, db: Session = Depends(get_db)):
    # Order by date_operation desc
    return db.query(Transaction).order_by(Transaction.date_operation.desc()).offset(skip).limit(limit).all()

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
    db_tx = Transaction(**tx.dict())
    # Auto-set audit timestamp if created_by is present (org mode)
    if db_tx.created_by:
        db_tx.created_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    db.add(db_tx)
    db.commit()
    db.refresh(db_tx)
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
        
    update_data = tx_update.dict(exclude_unset=True)
    # Auto-set audit timestamp if modified_by is present (org mode)
    if "modified_by" in update_data and update_data["modified_by"]:
        update_data["modified_at"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    for key, value in update_data.items():
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
                    
    db.commit()
    db.refresh(db_tx)
    return db_tx

@router.delete("/{tx_id}")
def delete_transaction(tx_id: int, db: Session = Depends(get_db)):
    db_tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not db_tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    db.delete(db_tx)
    db.commit()
    return {"ok": True}

@router.post("/{tx_id}/toggle_reconciliation")
def toggle_reconciliation(tx_id: int, db: Session = Depends(get_db)):
    db_tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not db_tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
        
    if db_tx.reconciliation_date:
        db_tx.reconciliation_date = None
    else:
        db_tx.reconciliation_date = date.today()
        
    db.commit()
    db.refresh(db_tx)
    return {"reconciliation_date": db_tx.reconciliation_date}

@router.delete("/all/clear", status_code=200)
def clear_all_transactions(db: Session = Depends(get_db)):
    """Deletes all user data from the database (Danger Zone)."""
    from app.models import BudgetCategory, Budget, RecurrenceTemplate, Account, Category
    db.query(Transaction).delete()
    db.query(BudgetCategory).delete()
    db.query(Budget).delete()
    db.query(RecurrenceTemplate).delete()
    db.query(Account).delete()
    db.query(Category).delete()
    db.commit()
    return {"ok": True, "message": "All user data has been deleted"}
