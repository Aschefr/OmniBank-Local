from fastapi import APIRouter, Depends, HTTPException, Query, Header
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from typing import List, Optional
from datetime import date, datetime, timedelta

from app.database import get_db
from app.models import Transaction, Account, RecurrenceTemplate
from app.schemas.api_schemas import TransactionCreate, TransactionUpdate, TransactionOut
from app.services.history_service import record_action, snapshot_entity
import logging
from app.services import stats_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

@router.get("/", response_model=List[TransactionOut])
def get_transactions(
    skip: int = 0,
    limit: int = 1000,
    search: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
    unreconciled_only: bool = Query(False),
    overview_window: bool = Query(False),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
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
    if overview_window:
        # Fenêtre optimisée pour la vue d'ensemble :
        # Inclut toutes les opérations non rapprochées (passées, courantes et futures)
        # + toutes les opérations pointées des 60 derniers jours (cycle en cours & précédent)
        d_min = (date.today() - timedelta(days=60)).strftime("%Y-%m-%d")
        query = query.filter(
            or_(
                Transaction.reconciliation_date == None,
                Transaction.date_operation >= d_min
            )
        )
    elif unreconciled_only:
        query = query.filter(Transaction.reconciliation_date == None)

    if date_from:
        query = query.filter(Transaction.date_operation >= date_from)
    if date_to:
        query = query.filter(Transaction.date_operation <= date_to)
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

@router.get("/autopilot/history")
def get_transactions_autopilot_history(limit: int = 5, db: Session = Depends(get_db)):
    """Retourne les dernières actions automatiques appliquées aux transactions (rapprochements et nouvelles écritures)."""
    from app.services.autopilot_service import get_operations_automations_history
    try:
        return get_operations_automations_history(db, limit=limit)
    except Exception as e:
        logger.error(f"[Transactions AutoPilot] Erreur récupération historique: {e}")
        return []

@router.post("/", response_model=TransactionOut)
def create_transaction(tx: TransactionCreate, db: Session = Depends(get_db)):
    db_tx = Transaction(**tx.model_dump())
    # Ensure bidirectional transactions are always typed as transfer
    if db_tx.from_account_id and db_tx.to_account_id:
        db_tx.type = "transfer"
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

def _is_field_changed(old_val, new_val) -> bool:
    if old_val is None and new_val is None:
        return False
    if (old_val is None and new_val is not None) or (old_val is not None and new_val is None):
        if old_val in (None, "") and new_val in (None, ""):
            return False
        return True
    if isinstance(new_val, (date, datetime)) and isinstance(old_val, str):
        return new_val.isoformat() != old_val
    if isinstance(old_val, (date, datetime)) and isinstance(new_val, str):
        return old_val.isoformat() != new_val
    if isinstance(old_val, (int, float)) and isinstance(new_val, (int, float)):
        return abs(float(old_val) - float(new_val)) > 1e-4
    return old_val != new_val


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

    # Detect fields actually modified by user
    changed_keys = {k for k, v in update_data.items() if _is_field_changed(old_snapshot.get(k), v)}
    propagatable_keys = changed_keys - {
        'date_operation', 'reconciliation_date', 'id', 'created_at',
        'created_by', 'modified_at', 'modified_by', 'is_skipped'
    }

    for key, value in update_data.items():
        if key != "is_skipped": # Handled specifically above
            setattr(db_tx, key, value)
        
    # Ensure bidirectional transactions are always typed as transfer
    if db_tx.from_account_id and db_tx.to_account_id:
        db_tx.type = "transfer"

    old_template_snapshot = None
    old_future_snapshots = []
    future_txs = []
    template = None

    if propagate and db_tx.recurrence_id and propagatable_keys:
        template = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == db_tx.recurrence_id).first()
        if template:
            old_template_snapshot = snapshot_entity(template)

        # Update all future instances belonging to the same recurrence
        future_txs = db.query(Transaction).filter(
            Transaction.recurrence_id == db_tx.recurrence_id,
            Transaction.date_operation > db_tx.date_operation
        ).all()
        old_future_snapshots = [snapshot_entity(ftx) for ftx in future_txs]

        for ftx in future_txs:
            for key in propagatable_keys:
                if hasattr(ftx, key):
                    setattr(ftx, key, update_data[key])
            if ftx.from_account_id and ftx.to_account_id:
                ftx.type = "transfer"
        
        # Update the template itself
        if template:
            for key in propagatable_keys:
                if hasattr(template, key):
                    setattr(template, key, update_data[key])
            if template.from_account_id and template.to_account_id:
                template.type = "transfer"

    db.flush()

    if old_future_snapshots or old_template_snapshot:
        old_snapshot["_propagated_template"] = old_template_snapshot
        old_snapshot["_propagated_txs"] = old_future_snapshots

    new_snapshot = snapshot_entity(db_tx)
    if old_future_snapshots or old_template_snapshot:
        new_template_snapshot = snapshot_entity(template) if template else None
        new_future_snapshots = [snapshot_entity(ftx) for ftx in future_txs]
        new_snapshot["_propagated_template"] = new_template_snapshot
        new_snapshot["_propagated_txs"] = new_future_snapshots

    action_id = record_action(db, "transaction", db_tx.id, "UPDATE", old_snapshot, new_snapshot, user_name=db_tx.modified_by)
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
