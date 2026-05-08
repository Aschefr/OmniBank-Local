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
    current_month_start = today.replace(day=1)
    try:
        last_year_start = today.replace(year=today.year - 1)
    except ValueError:
        last_year_start = today.replace(year=today.year - 1, day=28) # Leap year handling

    # Calculate last 12 months sum
    yearly_results = db.query(
        Transaction.category,
        func.sum(Transaction.amount)
    ).filter(
        Transaction.date_operation >= last_year_start,
        Transaction.category != None,
        Transaction.type != "income"
    ).group_by(Transaction.category).all()
    
    # Calculate current month sum
    monthly_results = db.query(
        Transaction.category,
        func.sum(Transaction.amount)
    ).filter(
        Transaction.date_operation >= current_month_start,
        Transaction.category != None,
        Transaction.type != "income"
    ).group_by(Transaction.category).all()

    # Aggregate incomes as well
    yearly_income = db.query(
        Transaction.category,
        func.sum(Transaction.amount)
    ).filter(
        Transaction.date_operation >= last_year_start,
        Transaction.category != None,
        Transaction.type == "income"
    ).group_by(Transaction.category).all()

    monthly_income = db.query(
        Transaction.category,
        func.sum(Transaction.amount)
    ).filter(
        Transaction.date_operation >= current_month_start,
        Transaction.category != None,
        Transaction.type == "income"
    ).group_by(Transaction.category).all()

    averages = {}
    
    # Process expenses
    for cat, total in yearly_results:
        if cat not in averages: averages[cat] = {"current_month": 0.0, "yearly_average": 0.0}
        averages[cat]["yearly_average"] = abs(float(total or 0)) / 12.0
        
    for cat, total in monthly_results:
        if cat not in averages: averages[cat] = {"current_month": 0.0, "yearly_average": 0.0}
        averages[cat]["current_month"] = abs(float(total or 0))

    # Process incomes
    for cat, total in yearly_income:
        if cat not in averages: averages[cat] = {"current_month": 0.0, "yearly_average": 0.0}
        averages[cat]["yearly_average"] = abs(float(total or 0)) / 12.0
        
    for cat, total in monthly_income:
        if cat not in averages: averages[cat] = {"current_month": 0.0, "yearly_average": 0.0}
        averages[cat]["current_month"] = abs(float(total or 0))

    return averages

@router.post("/", response_model=CategoryOut)
def create_category(cat: CategoryBase, db: Session = Depends(get_db)):
    db_cat = db.query(Category).filter(Category.name == cat.name).first()
    if db_cat:
        raise HTTPException(status_code=400, detail="Category already exists")
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
