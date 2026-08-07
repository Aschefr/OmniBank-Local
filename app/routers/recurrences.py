from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from dateutil.relativedelta import relativedelta

import calendar

from app.database import get_db
from app.models import RecurrenceTemplate, Transaction, Category
from app.schemas.api_schemas import RecurrenceTemplateCreate, RecurrenceTemplateOut, PropagateRequest, WizardGenerateRequest, RecurrenceCloseRequest
from app.services.history_service import record_action, snapshot_entity
from app.services import stats_cache

router = APIRouter(prefix="/api/recurrences", tags=["recurrences"])

def _upgrade_category_if_needed(category_name: str, tpl_type: str, db: Session):
    if not category_name or tpl_type != "expense_fixed":
        return
    db_cat = db.query(Category).filter(Category.name == category_name).first()
    if db_cat and db_cat.type == "expense_var":
        db_cat.type = "expense_fixed"

@router.get("/", response_model=List[RecurrenceTemplateOut])
def get_templates(include_closed: bool = False, db: Session = Depends(get_db)):
    if include_closed:
        return db.query(RecurrenceTemplate).all()
    return db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed == None)
    ).all()

@router.post("/", response_model=RecurrenceTemplateOut)
def create_template(tpl: RecurrenceTemplateCreate, db: Session = Depends(get_db)):
    db_tpl = RecurrenceTemplate(**tpl.dict())
    db.add(db_tpl)
    _upgrade_category_if_needed(db_tpl.category, db_tpl.type, db)
    db.flush()
    action_id = record_action(db, "recurrence_template", db_tpl.id, "CREATE", None, snapshot_entity(db_tpl))
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_tpl)
    db_tpl.action_id = action_id
    return db_tpl

@router.put("/{tpl_id}", response_model=RecurrenceTemplateOut)
def update_template(tpl_id: int, tpl_update: RecurrenceTemplateCreate, db: Session = Depends(get_db)):
    db_tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
    if not db_tpl:
        raise HTTPException(status_code=404, detail="Template not found")
        
    old_snapshot = snapshot_entity(db_tpl)
    was_closed = db_tpl.is_closed
    # Check if structural parameters are changing (frequency, day, amount, etc.)
    # is_closed changes alone should NOT trigger transaction deletion
    structural_changed = (
        db_tpl.frequency != tpl_update.frequency or
        db_tpl.day_of_month != tpl_update.day_of_month or
        db_tpl.month_of_year != tpl_update.month_of_year or
        db_tpl.amount != tpl_update.amount or
        db_tpl.type != tpl_update.type or
        db_tpl.category != tpl_update.category or
        db_tpl.from_account_id != tpl_update.from_account_id or
        db_tpl.to_account_id != tpl_update.to_account_id
    )
    
    update_data = tpl_update.dict(exclude_unset=True)
    for key, value in update_data.items():
        if hasattr(db_tpl, key):
            setattr(db_tpl, key, value)
    _upgrade_category_if_needed(db_tpl.category, db_tpl.type, db)
    
    if structural_changed:
        # Delete all unreconciled transactions for this template to force regeneration
        db.query(Transaction).filter(
            Transaction.recurrence_id == tpl_id,
            Transaction.reconciliation_date == None
        ).delete()
    elif not was_closed and db_tpl.is_closed:
        # Template is being closed without structural changes: purge future unreconciled transactions after today
        db.query(Transaction).filter(
            Transaction.recurrence_id == tpl_id,
            Transaction.reconciliation_date == None,
            Transaction.date_operation > date.today()
        ).delete()
        
    db.flush()
    action_id = record_action(db, "recurrence_template", db_tpl.id, "UPDATE", old_snapshot, snapshot_entity(db_tpl))
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_tpl)
    db_tpl.action_id = action_id
    return db_tpl

@router.post("/{tpl_id}/close", response_model=RecurrenceTemplateOut)
def close_template(tpl_id: int, req: Optional[RecurrenceCloseRequest] = None, db: Session = Depends(get_db)):
    """Close a recurrence template and purge unreconciled transactions strictly after the closure_date."""
    db_tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
    if not db_tpl:
        raise HTTPException(status_code=404, detail="Template not found")
        
    old_snapshot = snapshot_entity(db_tpl)
    db_tpl.is_closed = True
    
    cutoff_date = (req.closure_date if req and req.closure_date else date.today())
    
    # Purge future unreconciled transactions after cutoff date
    db.query(Transaction).filter(
        Transaction.recurrence_id == tpl_id,
        Transaction.reconciliation_date == None,
        Transaction.date_operation > cutoff_date
    ).delete()
    
    db.flush()
    action_id = record_action(db, "recurrence_template", db_tpl.id, "CLOSE", old_snapshot, snapshot_entity(db_tpl))
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_tpl)
    db_tpl.action_id = action_id
    return db_tpl

@router.post("/{tpl_id}/reopen", response_model=RecurrenceTemplateOut)
def reopen_template(tpl_id: int, db: Session = Depends(get_db)):
    """Re-open a closed recurrence template and generate future instances."""
    db_tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
    if not db_tpl:
        raise HTTPException(status_code=404, detail="Template not found")
        
    old_snapshot = snapshot_entity(db_tpl)
    db_tpl.is_closed = False
    
    db.flush()
    action_id = record_action(db, "recurrence_template", db_tpl.id, "REOPEN", old_snapshot, snapshot_entity(db_tpl))
    db.commit()
    
    # Regenerate recurrences for this template
    generate_recurrences(template_id=tpl_id, db=db)
    
    stats_cache.invalidate()
    db.refresh(db_tpl)
    db_tpl.action_id = action_id
    return db_tpl

@router.delete("/{tpl_id}")
def delete_template(tpl_id: int, db: Session = Depends(get_db)):
    db_tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
    if not db_tpl:
        raise HTTPException(status_code=404, detail="Template not found")
        
    old_snapshot = snapshot_entity(db_tpl)
    # Delete unreconciled transactions generated by this template
    db.query(Transaction).filter(
        Transaction.recurrence_id == tpl_id,
        Transaction.reconciliation_date == None
    ).delete()
    
    db.delete(db_tpl)
    action_id = record_action(db, "recurrence_template", tpl_id, "DELETE", old_snapshot, None)
    db.commit()
    stats_cache.invalidate()
    return {"ok": True, "action_id": action_id}

@router.post("/{tpl_id}/propagate")
def propagate_recurrence(tpl_id: int, req: PropagateRequest, db: Session = Depends(get_db)):
    tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
    if not tpl:
        raise HTTPException(status_code=404, detail="Template not found")
        
    tx = db.query(Transaction).filter(Transaction.id == req.transaction_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Origin transaction not found")
        
    old_date = tx.date_operation
    
    # Update template
    tpl.amount = req.new_amount
    tpl.day_of_month = req.new_date.day
    
    # Update origin transaction exactly
    tx.date_operation = req.new_date
    tx.amount = req.new_amount
    
    # Find all unreconciled transactions for this template from old_date onwards (excluding origin)
    txs = db.query(Transaction).filter(
        Transaction.recurrence_id == tpl_id,
        Transaction.date_operation > old_date,
        Transaction.reconciliation_date == None
    ).all()
    
    updated_count = 1
    for t in txs:
        t.amount = req.new_amount
        
        # update day of month safely
        last_day = calendar.monthrange(t.date_operation.year, t.date_operation.month)[1]
        safe_day = min(req.new_date.day, last_day)
        t.date_operation = t.date_operation.replace(day=safe_day)
        updated_count += 1
        
    # Generate missing transactions up to the rolling window from the date being edited
    from app.models import GlobalConfig
    config_row = db.query(GlobalConfig).filter(GlobalConfig.key == "recurrence_generation_months").first()
    gen_months = int(config_row.value) if (config_row and config_row.value.isdigit()) else 12
    end_date = req.new_date + relativedelta(months=gen_months)
    current_date = req.new_date
    if tpl.frequency == "Monthly":
        current_date += relativedelta(months=1)
    elif tpl.frequency == "Yearly":
        current_date += relativedelta(years=1)
    elif tpl.frequency == "Weekly":
        current_date += relativedelta(weeks=1)
    elif tpl.frequency == "Quarterly":
        current_date += relativedelta(months=3)
    elif tpl.frequency == "Semi-Annually":
        current_date += relativedelta(months=6)
    elif tpl.frequency in ("Bi-Weekly", "Bi-Monthly"):
        current_date += relativedelta(weeks=2)
 
    existing_count = 0
    if tpl.max_occurrences:
        existing_count = db.query(Transaction).filter(
            Transaction.recurrence_id == tpl.id
        ).count()
    tpl_generated = 0
    
    while True:
        if tpl.max_occurrences and (existing_count + tpl_generated) >= tpl.max_occurrences:
            break
        if not tpl.max_occurrences and current_date > end_date:
            break
            
        exists = db.query(Transaction).filter(
            Transaction.recurrence_id == tpl.id,
            Transaction.date_operation == current_date
        ).first()
    
        if not exists:
            new_tx = Transaction(
                date_saisie=date.today(),
                date_operation=current_date,
                description=tpl.description,
                amount=tpl.amount,
                type=tpl.type,
                category=tpl.category,
                is_monthly=(tpl.frequency == "Monthly"),
                is_yearly=(tpl.frequency == "Yearly"),
                from_account_id=tpl.from_account_id,
                to_account_id=tpl.to_account_id,
                recurrence_id=tpl.id
            )
            db.add(new_tx)
            updated_count += 1
            tpl_generated += 1
            
        if tpl.frequency == "Monthly":
            current_date += relativedelta(months=1)
        elif tpl.frequency == "Yearly":
            current_date += relativedelta(years=1)
        elif tpl.frequency == "Weekly":
            current_date += relativedelta(weeks=1)
        elif tpl.frequency == "Quarterly":
            current_date += relativedelta(months=3)
        elif tpl.frequency == "Semi-Annually":
            current_date += relativedelta(months=6)
        elif tpl.frequency in ("Bi-Weekly", "Bi-Monthly"):
            current_date += relativedelta(weeks=2)
        else:
            break
            
    db.commit()
    stats_cache.invalidate()
    return {"updated": updated_count}

def auto_close_abandoned_templates(db: Session):
    """
    Automatically mark templates as closed (is_closed = True) if they have
    reconciled history but no confirmed transactions in the current year
    or the previous year. This catches truly abandoned recurring expenses.
    
    NOTE: Templates whose last confirmed transaction is 0€ (paused subscriptions)
    are NOT closed here. They are simply skipped during generation to avoid
    creating future transactions while preserving the user's is_closed state.
    """
    from datetime import date
    from sqlalchemy import text
    from app.models import RecurrenceTemplate
    today = date.today()
    current_year = today.year
    
    # Find all recurrence_ids that have reconciled history
    sql_history = """
        SELECT DISTINCT recurrence_id 
        FROM transactions 
        WHERE recurrence_id IS NOT NULL 
          AND reconciliation_date IS NOT NULL
    """
    rec_ids_with_history = [row[0] for row in db.execute(text(sql_history))]
    if not rec_ids_with_history:
        return
        
    # Find templates that have reconciled history in current year or previous year, OR any transaction in current year or future
    sql_recent = """
        SELECT DISTINCT recurrence_id 
        FROM transactions 
        WHERE recurrence_id IS NOT NULL 
          AND (
            (reconciliation_date IS NOT NULL AND CAST(strftime('%Y', date_operation) AS INTEGER) >= :prev_year)
            OR (CAST(strftime('%Y', date_operation) AS INTEGER) >= :curr_year)
          )
    """
    rec_ids_recent = {row[0] for row in db.execute(text(sql_recent), {"curr_year": current_year, "prev_year": current_year - 1})}
    
    abandoned_ids = [rid for rid in rec_ids_with_history if rid not in rec_ids_recent]
    
    if abandoned_ids:
        db.query(RecurrenceTemplate).filter(
            RecurrenceTemplate.id.in_(abandoned_ids),
            (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed == None)
        ).update({RecurrenceTemplate.is_closed: True}, synchronize_session=False)
        db.commit()


def _is_template_zeroed(db: Session, tpl_id: int) -> bool:
    """Check if a template's latest confirmed (non-skipped) transaction has amount == 0.
    
    Used to skip generation for paused subscriptions without closing the template.
    """
    latest_conf = db.query(Transaction).filter(
        Transaction.recurrence_id == tpl_id,
        Transaction.reconciliation_date != None,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).order_by(Transaction.date_operation.desc()).first()
    return latest_conf is not None and latest_conf.amount == 0


@router.post("/generate_to_end_of_year")
def generate_recurrences(template_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Generate instances for active templates until the end of the current year.
    
    If template_id is specified, only that template is processed.
    
    IMPORTANT: Only generates for templates that already have at least one transaction
    linked via recurrence_id. This prevents orphaned/legacy templates from flooding
    the database with unwanted past occurrences.
    """
    auto_close_abandoned_templates(db)
    query = db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed == None)
    )
    if template_id is not None:
        query = query.filter(RecurrenceTemplate.id == template_id)
        
    templates = query.all()
    today = date.today()
    from app.models import GlobalConfig
    config_row = db.query(GlobalConfig).filter(GlobalConfig.key == "recurrence_generation_months").first()
    gen_months = int(config_row.value) if (config_row and config_row.value.isdigit()) else 12
    end_date = today + relativedelta(months=gen_months)
    
    generated_count = 0
    
    for tpl in templates:
        # Skip templates whose latest confirmed transaction is 0€ (paused subscriptions)
        # This prevents generating future transactions without altering is_closed state
        if _is_template_zeroed(db, tpl.id):
            continue
            
        # Anchor on the latest existing transaction belonging to this template
        latest_tx = db.query(Transaction).filter(
            Transaction.recurrence_id == tpl.id
        ).order_by(Transaction.date_operation.desc()).first()
        
        amount_to_use = tpl.amount
        
        if not latest_tx:
            # If no transactions exist, anchor on the current month to start generating from now
            current_date = date(today.year, today.month, 1) + relativedelta(day=tpl.day_of_month or 1)
            if tpl.frequency == "Yearly":
                current_date = date(today.year, tpl.month_of_year or 1, 1) + relativedelta(day=tpl.day_of_month or 1)
                if current_date < today:
                    current_date = date(today.year + 1, tpl.month_of_year or 1, 1) + relativedelta(day=tpl.day_of_month or 1)
        else:
            current_date = latest_tx.date_operation
            # Advance by one interval before generating new occurrences
            if tpl.frequency == "Monthly":
                current_date += relativedelta(months=1)
            elif tpl.frequency == "Yearly":
                current_date += relativedelta(years=1)
            elif tpl.frequency == "Weekly":
                current_date += relativedelta(weeks=1)
            elif tpl.frequency == "Quarterly":
                current_date += relativedelta(months=3)
            elif tpl.frequency == "Semi-Annually":
                current_date += relativedelta(months=6)
            elif tpl.frequency in ("Bi-Weekly", "Bi-Monthly"):
                current_date += relativedelta(weeks=2)
            else:
                continue
            
            # GUARD: Never generate transactions in the past.
            # Fast-forward until current_date is at least in the current month.
            first_of_current_month = date(today.year, today.month, 1)
            while current_date < first_of_current_month:
                if tpl.frequency == "Monthly":
                    current_date += relativedelta(months=1)
                elif tpl.frequency == "Yearly":
                    current_date += relativedelta(years=1)
                elif tpl.frequency == "Weekly":
                    current_date += relativedelta(weeks=1)
                elif tpl.frequency == "Quarterly":
                    current_date += relativedelta(months=3)
                elif tpl.frequency == "Semi-Annually":
                    current_date += relativedelta(months=6)
                elif tpl.frequency in ("Bi-Weekly", "Bi-Monthly"):
                    current_date += relativedelta(weeks=2)
                else:
                    break
        
        # Hard ceiling: never generate past rolling end date
        if current_date > end_date:
            continue
            
        existing_count = db.query(Transaction).filter(
            Transaction.recurrence_id == tpl.id
        ).count()
        
        tpl_generated = 0
            
        while current_date <= end_date:
            # Stop if max occurrences reached
            if tpl.max_occurrences and (existing_count + tpl_generated) >= tpl.max_occurrences:
                break
                
            # Duplicate check: strictly by recurrence_id (and appropriate period depending on frequency)
            # IMPORTANT: SQLite stores dates as TEXT, so we use strftime() not extract().
            from sqlalchemy import func
            if tpl.frequency == "Monthly":
                year_month = current_date.strftime('%Y-%m')
                already_exists = db.query(Transaction).filter(
                    Transaction.recurrence_id == tpl.id,
                    func.strftime('%Y-%m', Transaction.date_operation) == year_month
                ).first()
            elif tpl.frequency == "Yearly":
                year_val = current_date.strftime('%Y')
                already_exists = db.query(Transaction).filter(
                    Transaction.recurrence_id == tpl.id,
                    func.strftime('%Y', Transaction.date_operation) == year_val
                ).first()
            else:
                already_exists = db.query(Transaction).filter(
                    Transaction.recurrence_id == tpl.id,
                    Transaction.date_operation == current_date
                ).first()
            
            if not already_exists:
                new_tx = Transaction(
                    date_saisie=today,
                    date_operation=current_date,
                    description=tpl.description,
                    amount=amount_to_use,
                    type=tpl.type,
                    category=tpl.category,
                    is_monthly=(tpl.frequency == "Monthly"),
                    is_yearly=(tpl.frequency == "Yearly"),
                    from_account_id=tpl.from_account_id,
                    to_account_id=tpl.to_account_id,
                    recurrence_id=tpl.id
                )
                db.add(new_tx)
                generated_count += 1
                tpl_generated += 1
                
            if tpl.frequency == "Monthly":
                current_date += relativedelta(months=1)
            elif tpl.frequency == "Yearly":
                current_date += relativedelta(years=1)
            elif tpl.frequency == "Weekly":
                current_date += relativedelta(weeks=1)
            elif tpl.frequency == "Quarterly":
                current_date += relativedelta(months=3)
            elif tpl.frequency == "Semi-Annually":
                current_date += relativedelta(months=6)
            elif tpl.frequency in ("Bi-Weekly", "Bi-Monthly"):
                current_date += relativedelta(weeks=2)
            else:
                break # safeguard
                
    db.commit()
    stats_cache.invalidate()
    return {"generated_instances": generated_count}

@router.post("/wizard_generate")
def wizard_generate(req: WizardGenerateRequest, db: Session = Depends(get_db)):
    """Apply wizard updates, add new templates, and generate for the target year."""
    # 1. Update existing templates
    for update in req.updates:
        tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == update.id).first()
        if tpl:
            if not update.renew:
                tpl.is_closed = True
            else:
                if update.amount is not None:
                    tpl.amount = update.amount
                if update.day_of_month is not None:
                    tpl.day_of_month = update.day_of_month
                if update.category is not None:
                    tpl.category = update.category
                if update.frequency is not None:
                    tpl.frequency = update.frequency

    # 2. Add new templates
    for new_tpl in req.new_templates:
        db_tpl = RecurrenceTemplate(**new_tpl.dict())
        db.add(db_tpl)
        
    db.commit()
    stats_cache.invalidate()

    # 3. Generate instances for target year
    generated_count = 0
    if req.generate_instances:
        templates = db.query(RecurrenceTemplate).filter(
            (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed == None)
        ).all()
        
        today = date.today()
        start_of_year = date(req.target_year, 1, 1)
        end_of_year = date(req.target_year, 12, 31)
        
        for tpl in templates:
            # Start date for generating
            current_date = date(req.target_year, 1, tpl.day_of_month or 1)
            
            # Adjust if frequency is Yearly and month is specified
            if tpl.frequency == "Yearly":
                current_date = date(req.target_year, tpl.month_of_year or 1, tpl.day_of_month or 1)
                
            existing_count = 0
            if tpl.max_occurrences:
                existing_count = db.query(Transaction).filter(
                    Transaction.recurrence_id == tpl.id
                ).count()
            tpl_generated = 0
                
            while True:
                if tpl.max_occurrences and (existing_count + tpl_generated) >= tpl.max_occurrences:
                    break
                if not tpl.max_occurrences and current_date > end_of_year:
                    break
                    
                from sqlalchemy import func
                if tpl.frequency == "Monthly":
                    exists = db.query(Transaction).filter(
                        Transaction.recurrence_id == tpl.id,
                        func.strftime('%Y-%m', Transaction.date_operation) == current_date.strftime('%Y-%m')
                    ).first()
                elif tpl.frequency == "Yearly":
                    exists = db.query(Transaction).filter(
                        Transaction.recurrence_id == tpl.id,
                        func.strftime('%Y', Transaction.date_operation) == current_date.strftime('%Y')
                    ).first()
                else:
                    exists = db.query(Transaction).filter(
                        Transaction.recurrence_id == tpl.id,
                        Transaction.date_operation == current_date
                    ).first()
                
                if not exists and current_date >= start_of_year:
                    new_tx = Transaction(
                        date_saisie=today,
                        date_operation=current_date,
                        description=tpl.description,
                        amount=tpl.amount,
                        type=tpl.type,
                        category=tpl.category,
                        is_monthly=(tpl.frequency == "Monthly"),
                        is_yearly=(tpl.frequency == "Yearly"),
                        from_account_id=tpl.from_account_id,
                        to_account_id=tpl.to_account_id,
                        recurrence_id=tpl.id
                    )
                    db.add(new_tx)
                    generated_count += 1
                    tpl_generated += 1
                    
                if tpl.frequency == "Monthly":
                    current_date += relativedelta(months=1)
                elif tpl.frequency == "Yearly":
                    current_date += relativedelta(years=1)
                elif tpl.frequency == "Weekly":
                    current_date += relativedelta(weeks=1)
                elif tpl.frequency == "Quarterly":
                    current_date += relativedelta(months=3)
                elif tpl.frequency == "Semi-Annually":
                    current_date += relativedelta(months=6)
                elif tpl.frequency in ("Bi-Weekly", "Bi-Monthly"):
                    current_date += relativedelta(weeks=2)
                else:
                    break
                    
    db.commit()
    stats_cache.invalidate()
    return {"generated_instances": generated_count}


from pydantic import BaseModel
from typing import Optional

class RecurrenceCategoryUpdate(BaseModel):
    category: Optional[str] = None

@router.patch("/{tpl_id}/category", response_model=RecurrenceTemplateOut)
def update_recurrence_category(tpl_id: int, req: RecurrenceCategoryUpdate, db: Session = Depends(get_db)):
    db_tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
    if not db_tpl:
        raise HTTPException(status_code=404, detail="Template not found")
        
    db_tpl.category = req.category
    
    # Cascade to unreconciled transactions of this template
    db.query(Transaction).filter(
        Transaction.recurrence_id == tpl_id,
        Transaction.reconciliation_date == None
    ).update({"category": req.category}, synchronize_session=False)
    
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_tpl)
    return db_tpl


