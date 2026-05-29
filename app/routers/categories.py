from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Category, Transaction, RecurrenceTemplate, BudgetCategory
from sqlalchemy import func
from datetime import date
from app.schemas.api_schemas import CategoryBase, CategoryOut

router = APIRouter(prefix="/api/categories", tags=["categories"])

@router.get("/", response_model=List[CategoryOut])
def get_categories(db: Session = Depends(get_db)):
    return db.query(Category).order_by(Category.type, Category.name).all()

@router.get("/averages")
def get_categories_averages(db: Session = Depends(get_db)):
    today = date.today()

    # Anchor on the latest PAST transaction (exclude future recurrences)
    from sqlalchemy import extract
    latest_past_tx = db.query(Transaction).filter(
        Transaction.date_operation <= today
    ).order_by(Transaction.date_operation.desc()).first()
    anchor = latest_past_tx.date_operation if latest_past_tx else today

    try:
        last_year_start = anchor.replace(year=anchor.year - 1)
    except ValueError:
        last_year_start = anchor.replace(year=anchor.year - 1, day=28)

    current_month_start = today.replace(day=1)

    # Count distinct months with expense data for accurate averaging
    from collections import defaultdict
    all_txs = db.query(Transaction).filter(
        Transaction.date_operation >= last_year_start,
        Transaction.date_operation <= anchor,
        Transaction.category != None,
    ).all()

    cat_monthly_sums = defaultdict(lambda: defaultdict(float))
    cat_current_month = defaultdict(float)

    for tx in all_txs:
        cat = tx.category
        month_key = tx.date_operation.strftime("%Y-%m")
        cat_monthly_sums[cat][month_key] += abs(tx.amount)
        if tx.date_operation >= current_month_start and tx.date_operation <= today:
            cat_current_month[cat] += abs(tx.amount)

    # Count total distinct months across all data for a global denominator
    all_months = set()
    for monthly in cat_monthly_sums.values():
        all_months.update(monthly.keys())
    nb_months = max(len(all_months), 1)

    averages = {}
    for cat, monthly in cat_monthly_sums.items():
        total = sum(monthly.values())
        averages[cat] = {
            "current_month": round(cat_current_month.get(cat, 0.0), 2),
            "yearly_average": round(total / nb_months, 2),
        }

    return averages

@router.post("/", response_model=CategoryOut)
def create_category(cat: CategoryBase, force_move: bool = False, db: Session = Depends(get_db)):
    db_cat = db.query(Category).filter(Category.name == cat.name).first()
    if db_cat:
        if db_cat.type == cat.type:
            return db_cat
            
        # Type mismatch! Check if it's currently used in transactions or recurrence templates
        tx_count = db.query(Transaction).filter(Transaction.category == cat.name).count()
        tpl_count = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.category == cat.name).count()
        is_used = (tx_count > 0 or tpl_count > 0)
        
        if not is_used or force_move:
            db_cat.type = cat.type
            db_cat.is_closed = False # Ensure open
            db.commit()
            db.refresh(db_cat)
            return db_cat
        else:
            raise HTTPException(
                status_code=409,
                detail=f"Category '{cat.name}' already exists as a '{db_cat.type}' category and is currently in use."
            )
            
    new_cat = Category(**cat.dict())
    db.add(new_cat)
    db.commit()
    db.refresh(new_cat)
    return new_cat


@router.put("/{cat_id}", response_model=CategoryOut)
def update_category(cat_id: int, cat: CategoryBase, db: Session = Depends(get_db)):
    db_cat = db.query(Category).filter(Category.id == cat_id).first()
    if not db_cat:
        raise HTTPException(status_code=404, detail="Category not found")
        
    old_name = db_cat.name
    new_name = cat.name
    
    db_cat.name = new_name
    db_cat.type = cat.type
    db_cat.is_closed = cat.is_closed
    
    # If name changed, cascade update to other tables
    if old_name != new_name:
        # Check if the new name already exists in another category to prevent unique constraint error
        if db.query(Category).filter(Category.name == new_name, Category.id != cat_id).first():
            raise HTTPException(status_code=400, detail="A category with this name already exists")
            
        db.query(Transaction).filter(Transaction.category == old_name).update({"category": new_name})
        db.query(RecurrenceTemplate).filter(RecurrenceTemplate.category == old_name).update({"category": new_name})
        db.query(BudgetCategory).filter(BudgetCategory.category_name == old_name).update({"category_name": new_name})
        
    db.commit()
    db.refresh(db_cat)
    return db_cat

@router.delete("/{cat_id}")
def delete_category(cat_id: int, reallocate_to: str = None, db: Session = Depends(get_db)):
    db_cat = db.query(Category).filter(Category.id == cat_id).first()
    if not db_cat:
        raise HTTPException(status_code=404, detail="Category not found")
        
    old_name = db_cat.name
    
    # If reallocation requested, update existing records
    if reallocate_to:
        db.query(Transaction).filter(Transaction.category == old_name).update({"category": reallocate_to})
        db.query(RecurrenceTemplate).filter(RecurrenceTemplate.category == old_name).update({"category": reallocate_to})
        db.query(BudgetCategory).filter(BudgetCategory.category_name == old_name).update({"category_name": reallocate_to})
        
    db.delete(db_cat)
    db.commit()
    return {"ok": True}


# ─── Improvement_04: Categories filtered by account scope ─────────────────────

@router.get("/by_accounts")
def get_categories_by_accounts(account_ids: str, db: Session = Depends(get_db)):
    """Return categories that have at least one transaction on the given accounts.
    account_ids: comma-separated list of account IDs (e.g. '1,3').
    """
    from sqlalchemy import or_

    acc_ids = [int(x) for x in account_ids.split(',') if x.strip()]
    if not acc_ids:
        return db.query(Category).order_by(Category.type, Category.name).all()

    # Find distinct category names from transactions on these accounts
    cat_names = db.query(Transaction.category).filter(
        or_(
            Transaction.from_account_id.in_(acc_ids),
            Transaction.to_account_id.in_(acc_ids)
        ),
        Transaction.category != None,
    ).distinct().all()

    used_names = {row[0] for row in cat_names if row[0]}

    if not used_names:
        return []

    cats = db.query(Category).filter(
        Category.name.in_(used_names)
    ).order_by(Category.type, Category.name).all()

    return [{"id": c.id, "name": c.name, "type": c.type, "is_closed": c.is_closed} for c in cats]
