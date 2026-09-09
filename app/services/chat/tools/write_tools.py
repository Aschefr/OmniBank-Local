"""
app/services/chat/tools/write_tools.py — Outils de mutation CRUD (transactions, budgets, récurrences, catégories, facts).
"""
import json
import logging
import calendar
import statistics as _stats
from datetime import date, timedelta
from typing import List, Optional
from collections import defaultdict
from sqlalchemy.orm import Session

from app.models import (
    Transaction, Account, Category, RecurrenceTemplate,
    Budget, BudgetAllocation, AIFact, OrgUser, ActionHistory, GlobalConfig
)
from app.services.finance_engine import (
    calculate_balances, get_net_worth, calculate_rest_to_live,
    predict_next_paycheck, get_main_account
)
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

def apply_transaction_correction_tool(db: Session, transaction_id: int, category: str = None, description: str = None, amount: float = None, type: str = None, force_write: bool = False) -> dict:
    from app.models import Transaction, Category
    from app.services.history_service import record_action, snapshot_entity
    tx = db.query(Transaction).filter(Transaction.id == int(transaction_id)).first()
    if not tx:
        return {"success": False, "error": "Transaction not found"}
        
    if not force_write:
        return {"success": True, "pending_validation": True, "transaction_id": transaction_id}
        
    old_snapshot = snapshot_entity(tx)
    changes = {}
    if category is not None:
        cat_exists = db.query(Category).filter(Category.name == category).first()
        if not cat_exists:
            new_cat = Category(name=category, type=type or tx.type or "expense_var")
            db.add(new_cat)
            db.flush()
        tx.category = category
        changes["category"] = category
        
    if description is not None:
        tx.description = description
        changes["description"] = description
        
    if amount is not None:
        tx.amount = float(amount)
        changes["amount"] = float(amount)
        
    if type is not None:
        tx.type = type
        changes["type"] = type
        
    if changes:
        db.flush()
        action_id = record_action(db, "transaction", tx.id, "UPDATE", old_snapshot, snapshot_entity(tx))
        db.commit()
        return {"success": True, "transaction_id": transaction_id, "updated_fields": changes, "action_id": action_id}
        
    return {"success": False, "error": "No fields to update"}


def create_budget_envelope_tool(db: Session, name: str, monthly_amount: float, period: str = "monthly", categories: list = None, is_project: bool = False, force_write: bool = False) -> dict:
    from app.models import Budget
    
    dup = db.query(Budget).filter(Budget.name == name, Budget.is_closed == False).first()
    if dup:
        return {"success": False, "error": f"L'enveloppe de budget '{name}' existe déjà."}
        
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.models import BudgetCategory
    from app.services.history_service import record_action, snapshot_entity
    b = Budget(
        name=name,
        monthly_amount=float(monthly_amount),
        period=period or "monthly",
        is_project=is_project,
        is_closed=False
    )
    db.add(b)
    db.flush()
    
    if categories:
        for cat_name in categories:
            db.add(BudgetCategory(budget_id=b.id, category_name=cat_name))
        db.flush()
        
    action_id = record_action(db, "budget", b.id, "CREATE", None, snapshot_entity(b, db))
    db.commit()
    return {"success": True, "budget_id": b.id, "name": name, "action_id": action_id}


def update_budget_envelope_tool(db: Session, budget_id: int, name: str = None, monthly_amount: float = None, period: str = None, categories: list = None, is_closed: bool = None, force_write: bool = False) -> dict:
    from app.models import Budget
    
    b = db.query(Budget).filter(Budget.id == int(budget_id)).first()
    if not b:
        return {"success": False, "error": "Budget envelope not found"}
        
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.models import BudgetCategory
    from app.services.history_service import record_action, snapshot_entity
    old_snapshot = snapshot_entity(b, db)
    
    if name is not None:
        b.name = name
    if monthly_amount is not None:
        b.monthly_amount = float(monthly_amount)
    if period is not None:
        b.period = period
    if is_closed is not None:
        b.is_closed = is_closed
        
    if categories is not None:
        db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).delete()
        for cat_name in categories:
            db.add(BudgetCategory(budget_id=b.id, category_name=cat_name))
            
    db.flush()
    action_id = record_action(db, "budget", b.id, "UPDATE", old_snapshot, snapshot_entity(b, db))
    db.commit()
    return {"success": True, "budget_id": b.id, "action_id": action_id}


def delete_budget_envelope_tool(db: Session, budget_id: int, force_write: bool = False) -> dict:
    from app.models import Budget
    
    b = db.query(Budget).filter(Budget.id == int(budget_id)).first()
    if not b:
        return {"success": False, "error": "Budget envelope not found"}
        
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.models import BudgetCategory
    from app.services.history_service import record_action, snapshot_entity
    old_snapshot = snapshot_entity(b, db)
    
    db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).delete()
    db.delete(b)
    db.flush()
    
    action_id = record_action(db, "budget", int(budget_id), "DELETE", old_snapshot, None)
    db.commit()
    return {"success": True, "budget_id": budget_id, "action_id": action_id}


def allocate_savings_funds_tool(db: Session, budget_id: int, amount: float, note: str = None, force_write: bool = False) -> dict:
    from app.models import Budget
    
    b = db.query(Budget).filter(Budget.id == int(budget_id)).first()
    if not b:
        return {"success": False, "error": "Savings envelope not found"}
    if (b.envelope_type or "spending") != "savings":
        return {"success": False, "error": "This budget envelope is not a savings (tirelire) envelope."}
        
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.models import BudgetAllocation
    from app.services.history_service import record_action, snapshot_entity
    alloc = BudgetAllocation(
        budget_id=b.id,
        amount=float(amount),
        note=note or "Allocation IA"
    )
    db.add(alloc)
    db.flush()
    
    action_id = record_action(db, "budget_allocation", alloc.id, "CREATE", None, snapshot_entity(alloc))
    db.commit()
    return {"success": True, "budget_id": b.id, "allocation_id": alloc.id, "amount": amount, "action_id": action_id}


def create_recurrence_template_tool(db: Session, amount: float, description: str, frequency: str, category: str, type: str, day_of_month: int, force_write: bool = False) -> dict:
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.models import RecurrenceTemplate
    from app.services.history_service import record_action, snapshot_entity
    tpl = RecurrenceTemplate(
        amount=float(amount),
        description=description,
        frequency=frequency,
        category=category,
        type=type,
        day_of_month=int(day_of_month),
        is_closed=False,
        from_account_id=1  # Default to first account
    )
    db.add(tpl)
    db.flush()
    
    action_id = record_action(db, "recurrence_template", tpl.id, "CREATE", None, snapshot_entity(tpl))
    db.commit()
    return {"success": True, "template_id": tpl.id, "description": description, "action_id": action_id}


def update_recurrence_template_tool(db: Session, template_id: int, amount: float = None, description: str = None, frequency: str = None, category: str = None, type: str = None, day_of_month: int = None, is_active: bool = None, force_write: bool = False) -> dict:
    from app.models import RecurrenceTemplate
    
    tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == int(template_id)).first()
    if not tpl:
        return {"success": False, "error": "Recurrence template not found"}
        
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.services.history_service import record_action, snapshot_entity
    old_snapshot = snapshot_entity(tpl)
    
    if amount is not None:
        tpl.amount = float(amount)
    if description is not None:
        tpl.description = description
    if frequency is not None:
        tpl.frequency = frequency
    if category is not None:
        tpl.category = category
    if type is not None:
        tpl.type = type
    if day_of_month is not None:
        tpl.day_of_month = int(day_of_month)
    if is_active is not None:
        tpl.is_active = is_active
        
    db.flush()
    action_id = record_action(db, "recurrence_template", tpl.id, "UPDATE", old_snapshot, snapshot_entity(tpl))
    db.commit()
    return {"success": True, "template_id": tpl.id, "action_id": action_id}


def delete_recurrence_template_tool(db: Session, template_id: int, force_write: bool = False) -> dict:
    from app.models import RecurrenceTemplate
    
    tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == int(template_id)).first()
    if not tpl:
        return {"success": False, "error": "Recurrence template not found"}
        
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.services.history_service import record_action, snapshot_entity
    old_snapshot = snapshot_entity(tpl)
    db.delete(tpl)
    db.flush()
    
    action_id = record_action(db, "recurrence_template", int(template_id), "DELETE", old_snapshot, None)
    db.commit()
    return {"success": True, "template_id": template_id, "action_id": action_id}


def create_category_tool(db: Session, name: str, type: str, force_write: bool = False) -> dict:
    from app.models import Category
    
    dup = db.query(Category).filter(Category.name == name).first()
    if dup:
        return {"success": False, "error": f"La catégorie '{name}' existe déjà."}
        
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.services.history_service import record_action, snapshot_entity
    cat = Category(name=name, type=type)
    db.add(cat)
    db.flush()
    
    action_id = record_action(db, "category", cat.id, "CREATE", None, snapshot_entity(cat))
    db.commit()
    return {"success": True, "category_id": cat.id, "name": name, "action_id": action_id}


def delete_category_tool(db: Session, name: str, force_write: bool = False) -> dict:
    from app.models import Category
    
    cat = db.query(Category).filter(Category.name == name).first()
    if not cat:
        return {"success": False, "error": "Category not found"}
        
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.services.history_service import record_action, snapshot_entity
    old_snapshot = snapshot_entity(cat)
    db.delete(cat)
    db.flush()
    
    action_id = record_action(db, "category", cat.id, "DELETE", old_snapshot, None)
    db.commit()
    return {"success": True, "name": name, "action_id": action_id}


def delete_transaction_tool(db: Session, transaction_id: int, force_write: bool = False) -> dict:
    from app.models import Transaction
    from app.services.history_service import record_action, snapshot_entity
    
    tx = db.query(Transaction).filter(Transaction.id == int(transaction_id)).first()
    if not tx:
        return {"success": False, "error": "Transaction not found"}
        
    if not force_write:
        return {"success": True, "pending_validation": True}
        
    old_snapshot = snapshot_entity(tx)
    db.delete(tx)
    db.flush()
    
    action_id = record_action(db, "transaction", int(transaction_id), "DELETE", old_snapshot, None)
    db.commit()
    return {"success": True, "transaction_id": transaction_id, "action_id": action_id}


def set_predicted_paycheck_tool(db: Session, amount: float, day_of_month: int, date_override: str = None, force_write: bool = False) -> dict:
    if not force_write:
        return {"success": True, "pending_validation": True}

    from app.models import GlobalConfig
    from app.services.finance_engine import predict_next_paycheck
    from app.services.history_service import record_action
    import calendar

    # Use the actual logical period so the override applies to the right month
    pay_info = predict_next_paycheck(db)
    period = pay_info.get("logical_period")

    from datetime import date as dt
    today = dt.today()

    # Build override date from date_override or day_of_month in the logical period's month
    if date_override:
        actual_date_override = date_override
    elif period:
        y, m = period.split("-")
        try:
            actual_date_override = dt(int(y), int(m), day_of_month).isoformat()
        except ValueError:
            last_day = calendar.monthrange(int(y), int(m))[1]
            actual_date_override = dt(int(y), int(m), last_day).isoformat()
    else:
        actual_date_override = today.isoformat()

    def _set(key, val):
        row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        old_val = row.value if row else None
        if not row:
            row = GlobalConfig(key=key, value=str(val))
            db.add(row)
        else:
            row.value = str(val)
        return old_val

    old_amount = _set("override_paycheck_amount", amount)
    old_period = _set("override_paycheck_period", period)
    old_date = _set("override_paycheck_date", actual_date_override)

    record_action(db, "paycheck_override", 0, "UPDATE", {
        "override_paycheck_amount": old_amount,
        "override_paycheck_period": old_period,
        "override_paycheck_date": old_date,
    }, {
        "override_paycheck_amount": str(amount),
        "override_paycheck_period": period,
        "override_paycheck_date": actual_date_override,
        "amount": amount,
    })
        
    db.flush()
    db.commit()
    return {
        "success": True,
        "amount": amount,
        "day_of_month": day_of_month,
        "date_override": date_override,
        "previous_amount": old_amount,
    }

def generate_csv_export_link_tool(db: Session, category: str = None, start_date: str = None, end_date: str = None, type: str = None) -> dict:
    import uuid
    import pandas as pd
    from app.models import Transaction
    from datetime import date
    
    query = db.query(Transaction)
    if category:
        query = query.filter(Transaction.category == category)
    if start_date:
        query = query.filter(Transaction.date_operation >= date.fromisoformat(start_date))
    if end_date:
        query = query.filter(Transaction.date_operation <= date.fromisoformat(end_date))
    if type:
        query = query.filter(Transaction.type == type)
        
    txs = query.all()
    
    # Build dataframe
    records = []
    for t in txs:
        records.append({
            "Date": t.date_operation.isoformat() if t.date_operation else "",
            "Description": t.description,
            "Montant": t.amount,
            "Type": t.type,
            "Catégorie": t.category
        })
        
    if not records:
        return {"error": "Aucune opération trouvée avec ces critères."}
        
    filename = f"export_{uuid.uuid4().hex[:8]}.csv"
    filepath = f"static/{filename}"
    df = pd.DataFrame(records)
    df.to_csv(filepath, index=False, sep=";", encoding="utf-8-sig")
    
    return {
        "download_url": f"/static/{filename}",
        "matching_records_count": len(records)
    }

def store_financial_fact_tool(db: Session, key: str, value: str, private_to_session: bool = False, session_id: int = None, user_name: str = None) -> dict:
    from app.models import AIFact, OrgUser
    try:
        logger.info(f"[store_financial_fact_tool] key={key}, value={value}, private={private_to_session}, session_id={session_id}, user_name={user_name}")
        user_id = None
        if user_name:
            user = db.query(OrgUser).filter(OrgUser.name == user_name).first()
            if user:
                user_id = user.id
        
        # Check if fact already exists
        query = db.query(AIFact).filter(AIFact.fact_key == key)
        if user_id:
            query = query.filter(AIFact.user_id == user_id)
        else:
            query = query.filter(AIFact.user_id.is_(None))
            
        if private_to_session and session_id:
            query = query.filter(AIFact.session_id == session_id)
        else:
            query = query.filter(AIFact.session_id.is_(None))
            
        existing = query.first()
        if existing:
            existing.fact_value = str(value)
        else:
            new_fact = AIFact(
                user_id=user_id,
                session_id=session_id if private_to_session else None,
                fact_key=key,
                fact_value=str(value)
            )
            db.add(new_fact)
        db.commit()
        logger.info(f"[store_financial_fact_tool] Fact '{key}' successfully saved.")
        return {"ok": True, "message": f"Fact '{key}' successfully saved."}
    except Exception as e:
        logger.error(f"[store_financial_fact_tool] Error saving fact '{key}': {e}", exc_info=True)
        return {"error": str(e)}

def forget_financial_fact_tool(db: Session, key: str, private_to_session: bool = False, session_id: int = None, user_name: str = None) -> dict:
    from app.models import AIFact, OrgUser
    try:
        user_id = None
        if user_name:
            user = db.query(OrgUser).filter(OrgUser.name == user_name).first()
            if user:
                user_id = user.id
                
        query = db.query(AIFact).filter(AIFact.fact_key == key)
        if user_id:
            query = query.filter(AIFact.user_id == user_id)
        else:
            query = query.filter(AIFact.user_id.is_(None))
            
        if private_to_session and session_id:
            query = query.filter(AIFact.session_id == session_id)
        else:
            query = query.filter(AIFact.session_id.is_(None))
            
        fact = query.first()
        if fact:
            db.delete(fact)
            db.commit()
            return {"ok": True, "message": f"Fact '{key}' successfully forgotten."}
        return {"ok": False, "message": f"Fact '{key}' not found."}
    except Exception as e:
        return {"error": str(e)}

