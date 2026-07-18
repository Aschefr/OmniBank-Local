from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

import httpx
import json
import codecs
from datetime import date

from app.database import get_db
from app.models import GlobalConfig, Transaction, Account, Category, RecurrenceTemplate, Budget, ChatSession, ChatMessage
from app.services.finance_engine import calculate_balances, get_net_worth
from app.schemas.api_schemas import ChatSessionCreate, ChatSessionUpdate, ChatContextUpdate, ChatRegenerateContext, ChatSendMessage, ChatMessageUpdate

import logging

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# In-memory tracker: which sessions currently have an AI generation in progress
_generating_sessions = set()
# Sessions that should create a notification when generation completes (user left the page)
_notify_on_complete = set()


# ─── Shared Ollama helpers (importable by other routers) ──────────────────────

def get_ollama_config(db: Session) -> dict:
    """Return Ollama config dict with keys: enabled, url, model, temperature, num_ctx."""
    def _val(key):
        row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        return row.value if row else None

    enabled = _val("enable_ai") in ("true", "True", "1")
    return {
        "enabled": enabled,
        "url": _val("ollama_url"),
        "model": _val("ollama_model"),
        "temperature": float(_val("ollama_temperature") or 0.3),
        "num_ctx": int(_val("ollama_context") or 4096),
    }


def call_ollama_sync(prompt: str, cfg: dict, extra_options: dict = None) -> str:
    """Blocking (sync) call to Ollama — use from non-async endpoints only.
    extra_options: additional Ollama options (e.g. num_predict) merged on top of defaults."""
    import httpx as _httpx
    url = (cfg.get("url") or "").rstrip("/")
    model = cfg.get("model") or ""
    if not url or not model:
        raise ValueError("Ollama URL ou modèle non configuré.")
    options = {"temperature": cfg.get("temperature", 0.3), "num_ctx": cfg.get("num_ctx", 4096)}
    if extra_options:
        options.update(extra_options)
    resp = _httpx.post(
        f"{url}/api/chat",
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": options,
        },
        timeout=120.0,
    )
    return resp.json().get("message", {}).get("content", "")

def get_net_worth_tool(db: Session) -> dict:
    return {
        "reconciled_net_worth_euros": get_net_worth(db, only_reconciled=True),
        "projected_net_worth_euros_today": get_net_worth(db, end_date=date.today(), only_reconciled=False)
    }

def get_balances_tool(db: Session) -> dict:
    accounts = {a.id: a.name for a in db.query(Account).all()}
    
    rec_b = calculate_balances(db, only_reconciled=True)
    proj_b = calculate_balances(db, end_date=date.today(), only_reconciled=False)
    
    return {
        "reconciled_balances": {accounts.get(k, f"Compte {k}"): v for k, v in rec_b.items()},
        "projected_balances_today": {accounts.get(k, f"Compte {k}"): v for k, v in proj_b.items()}
    }

def get_recent_transactions_tool(db: Session, limit: int = 15) -> dict:
    recent_txs = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).limit(limit).all()
    
    return {"transactions": [
        {
            "id": tx.id,
            "date": tx.date_operation.isoformat() if tx.date_operation else None, 
            "description": tx.description, 
            "amount": tx.amount, 
            "type": tx.type, 
            "category": tx.category,
            "status": "Rapproché" if tx.reconciliation_date else "Non Rapproché"
        }
        for tx in recent_txs
    ]}

def search_transactions_tool(db: Session, description_query: str = None, category: str = None, type: str = None, start_date: str = None, end_date: str = None, min_amount: float = None, max_amount: float = None, limit: int = 50) -> dict:
    try:
        if min_amount is not None:
            min_amount = float(min_amount)
        if max_amount is not None:
            max_amount = float(max_amount)
        if limit is not None:
            limit = int(limit)
    except (ValueError, TypeError):
        return {"error": "Invalid min_amount, max_amount or limit. Expected numeric values."}
        
    query = db.query(Transaction)
    if description_query:
        query = query.filter(Transaction.description.ilike(f"%{description_query}%"))
    if category:
        query = query.filter(Transaction.category == category)
    if type:
        query = query.filter(Transaction.type == type)
    if start_date:
        try:
            query = query.filter(Transaction.date_operation >= date.fromisoformat(start_date))
        except (ValueError, TypeError):
            pass
    if end_date:
        try:
            query = query.filter(Transaction.date_operation <= date.fromisoformat(end_date))
        except (ValueError, TypeError):
            pass
    if min_amount is not None:
        query = query.filter(Transaction.amount >= min_amount)
    if max_amount is not None:
        query = query.filter(Transaction.amount <= max_amount)
    
    txs = query.order_by(Transaction.date_operation.desc()).limit(limit).all()
    return {"transactions": [
        {
            "id": tx.id,
            "date": tx.date_operation.isoformat() if tx.date_operation else None,
            "description": tx.description,
            "amount": tx.amount,
            "type": tx.type,
            "category": tx.category,
            "status": "Rapproché" if tx.reconciliation_date else "Non Rapproché"
        }
        for tx in txs
    ]}

def get_spending_analytics_tool(db: Session, start_date: str, end_date: str) -> dict:
    try:
        d_start = date.fromisoformat(start_date)
        d_end = date.fromisoformat(end_date)
    except (ValueError, TypeError):
        return {"error": "Invalid or missing date format. Expected YYYY-MM-DD strings."}
    
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= d_start,
        Transaction.date_operation <= d_end
    ).all()
    
    by_type = {}
    by_category = {}
    total_income = 0.0
    total_expense = 0.0
    
    for tx in txs:
        tx_type = tx.type or "neutral"
        category = tx.category or "Sans catégorie"
        
        if tx_type not in by_type:
            by_type[tx_type] = {"total_amount": 0.0, "count": 0}
        by_type[tx_type]["total_amount"] += tx.amount
        by_type[tx_type]["count"] += 1
        
        if category not in by_category:
            by_category[category] = {"total_amount": 0.0, "count": 0, "type": tx_type}
        by_category[category]["total_amount"] += tx.amount
        by_category[category]["count"] += 1
        
        if tx_type == "income":
            total_income += tx.amount
        elif tx_type in ("expense_var", "expense_fixed"):
            total_expense += tx.amount
            
    total_income = round(total_income, 2)
    total_expense = round(total_expense, 2)
    net_savings = round(total_income - total_expense, 2)
    
    for t in by_type:
        by_type[t]["total_amount"] = round(by_type[t]["total_amount"], 2)
    for c in by_category:
        by_category[c]["total_amount"] = round(by_category[c]["total_amount"], 2)
        
    return {
        "period": {"start": start_date, "end": end_date},
        "totals": {
            "total_income": total_income,
            "total_expense": total_expense,
            "net_savings": net_savings
        },
        "by_type": by_type,
        "by_category": by_category
    }

def get_budgets_status_tool(db: Session, year: int = None, month: int = None) -> dict:
    from app.routers.budgets import get_budget_status
    today = date.today()
    try:
        y = int(year) if year is not None else today.year
        m = int(month) if month is not None else today.month
    except (ValueError, TypeError):
        return {"error": "Invalid year or month format. Expected integers."}
    
    status_data = get_budget_status(year=y, month=m, db=db)
    
    envelopes = []
    total_budgeted = 0.0
    total_spent_committed = 0.0
    total_spent_reconciled = 0.0
    total_income = 0.0

    for b in status_data.get("budgets", []):
        total_budgeted += b.get("budget_amount", 0.0)
        total_spent_committed += b.get("expenses", 0.0)
        total_spent_reconciled += b.get("reconciled_expenses", 0.0)
        total_income += b.get("income", 0.0)

        envelopes.append({
            "id": b.get("id"),
            "name": b.get("name"),
            "type": b.get("envelope_type", "spending"),
            "period": b.get("period", "monthly"),
            "limit": b.get("budget_amount", 0.0),
            "spent": b.get("expenses", 0.0),
            "remaining": b.get("balance", 0.0),
            "percent": b.get("percent", 0.0)
        })

    net_spent_committed = round(total_spent_committed - total_income, 2)
    net_spent_reconciled = round(total_spent_reconciled - total_income, 2)
    total_remaining = round(total_budgeted - net_spent_committed, 2)

    summary = {
        "total_budgeted": round(total_budgeted, 2),
        "total_spent_committed": round(total_spent_committed, 2),
        "total_spent_reconciled": round(total_spent_reconciled, 2),
        "total_income": round(total_income, 2),
        "net_spent_committed": net_spent_committed,
        "net_spent_reconciled": net_spent_reconciled,
        "total_remaining": total_remaining
    }

    return {"year": y, "month": m, "summary": summary, "budgets": envelopes}

def get_recurrence_templates_tool(db: Session) -> dict:
    templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
    return {"templates": [
        {
            "id": t.id,
            "description": t.description,
            "amount": t.amount,
            "type": t.type,
            "category": t.category,
            "frequency": t.frequency,
            "day_of_month": t.day_of_month
        }
        for t in templates
    ]}

def get_net_worth_history_tool(db: Session, months: int = 12) -> dict:
    try:
        months = int(months) if months is not None else 12
    except (ValueError, TypeError):
        return {"error": "Invalid months format. Expected integer."}
    from app.routers.stats import get_trends
    trends = get_trends("total", db)
    if "error" in trends:
        return trends
    
    history = trends.get("history", [])
    monthly_points = {}
    for pt in history:
        date_str = pt["date"]
        month_key = date_str[:7]
        monthly_points[month_key] = pt
        
    sorted_months = sorted(monthly_points.keys())
    result_points = [monthly_points[m] for m in sorted_months[-months:]]
    return {
        "current_balance": trends.get("current_balance"),
        "net_worth_history": result_points
    }

def get_envelopes_impact_tool(db: Session, amount: float, budget_id: int = None) -> dict:
    from app.models import Budget, BudgetAllocation, Transaction
    amount = float(amount)
    
    # 1. Calculate impact on global Left to Live
    from app.services.finance_engine import calculate_rest_to_live, predict_next_paycheck
    from datetime import date
    today = date.today()
    paycheck = predict_next_paycheck(db)
    next_pay_date = paycheck["date"]
    current_rtl = calculate_rest_to_live(db, today, next_pay_date)
    new_rtl = round(current_rtl - amount, 2)
    
    result = {
        "current_left_to_live_euros": current_rtl,
        "simulated_left_to_live_euros": new_rtl,
        "is_left_to_live_overdrawn": new_rtl < 0,
        "envelope_impact": None
    }
    
    # 2. Calculate impact on specific budget envelope if provided
    if budget_id is not None:
        try:
            budget_id = int(budget_id)
            b = db.query(Budget).filter(Budget.id == budget_id).first()
            if b:
                # Calculate current spent
                allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == b.id).all()
                alloc_balance = sum(a.amount for a in allocs)
                txs = db.query(Transaction).filter(Transaction.budget_id == b.id).all()
                tx_income = sum(abs(t.amount) for t in txs if t.type == "income")
                tx_expenses = sum(abs(t.amount) for t in txs if t.type != "income")
                current_spent = round(tx_expenses - tx_income - alloc_balance, 2)
                
                remaining = round(b.budget_amount - current_spent, 2)
                new_remaining = round(remaining - amount, 2)
                
                result["envelope_impact"] = {
                    "budget_name": b.name,
                    "budget_limit_euros": b.budget_amount,
                    "current_spent_euros": current_spent,
                    "current_remaining_euros": remaining,
                    "simulated_remaining_euros": new_remaining,
                    "is_envelope_overspent": new_remaining < 0
                }
        except Exception as e:
            result["error"] = str(e)
            
    return result

def suggest_transaction_category_tool(db: Session, description: str) -> dict:
    from app.models import Transaction
    if not description:
        return {"suggested_category": None, "confidence": "none"}
        
    # Search history for exact or similar transaction description
    txs = db.query(Transaction.category, Transaction.description).filter(
        Transaction.category.isnot(None),
        Transaction.category != ""
    ).all()
    
    # Simple match
    desc_lower = description.lower()
    matches = {}
    for tx in txs:
        if tx.description and tx.description.lower() in desc_lower or desc_lower in tx.description.lower():
            matches[tx.category] = matches.get(tx.category, 0) + 1
            
    if matches:
        best_cat = max(matches, key=matches.get)
        return {"suggested_category": best_cat, "confidence": "high" if matches[best_cat] > 2 else "medium"}
        
    return {"suggested_category": None, "confidence": "low"}

def forecast_balances_history_tool(db: Session, days: int = 30) -> dict:
    from datetime import date, timedelta
    from app.services.finance_engine import calculate_balances, get_main_account
    from app.models import RecurrenceTemplate, Transaction
    
    try:
        days = int(days)
    except:
        days = 30
        
    today = date.today()
    end_date = today + timedelta(days=days)
    
    account = get_main_account(db)
    if not account:
        return {"error": "No checking account found"}
        
    # Current reconciled balance
    balances = calculate_balances(db, only_reconciled=True)
    current_balance = balances.get(account.id, 0.0)
    
    # Load all active recurrence templates
    templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
    
    # Calculate daily average VARIABLE spending only (exclude recurring charges)
    # Recurring charges will be applied separately via templates to avoid double counting
    thirty_days_ago = today - timedelta(days=30)
    past_var_txs = db.query(Transaction).filter(
        Transaction.from_account_id == account.id,
        Transaction.to_account_id.is_(None),
        Transaction.date_operation >= thirty_days_ago,
        Transaction.date_operation <= today,
        Transaction.recurrence_id.is_(None)  # Exclude recurring transactions
    ).all()
    total_var_spent_30d = sum(t.amount for t in past_var_txs)
    daily_avg_var_spend = round(total_var_spent_30d / 30.0, 2)
    
    # Project chronologically day-by-day
    points = [{"date": today.isoformat(), "projected_balance_euros": current_balance}]
    running_balance = current_balance
    
    sim_date = today
    while sim_date < end_date:
        sim_date += timedelta(days=1)
        
        # Deduct daily average VARIABLE spend only
        running_balance -= daily_avg_var_spend
        
        # Apply recurrence templates (charges & income) on their scheduled day
        for t in templates:
            applies = False
            if t.frequency == "Monthly" and t.day_of_month == sim_date.day:
                applies = True
            elif t.frequency == "Weekly" and sim_date.weekday() == (t.day_of_month % 7 if t.day_of_month else 0):
                applies = True
            elif t.frequency == "Bimonthly" and t.day_of_month == sim_date.day and sim_date.month % 2 == 0:
                applies = True
                
            if applies:
                if t.type == "income":
                    running_balance += t.amount
                elif t.from_account_id == account.id and t.type in ("expense_fixed", "expense_var"):
                    running_balance -= t.amount
                    
        points.append({
            "date": sim_date.isoformat(),
            "projected_balance_euros": round(running_balance, 2)
        })
        
    return {
        "checking_account": account.name,
        "daily_average_variable_spend_euros": daily_avg_var_spend,
        "daily_average_note": "Variable spending only (non-recurring). Recurring charges applied separately via templates.",
        "forecast_days": days,
        "history": points
    }

def detect_anomalies_and_subscriptions_tool(db: Session) -> dict:
    from app.models import Transaction
    from datetime import date, timedelta
    from collections import defaultdict
    import statistics
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.date_operation <= today
    ).all()
    
    # 1. Subscription detection (recurring values at recurring intervals)
    candidates = defaultdict(list)
    for t in txs:
        if t.type in ("expense_var", "expense_fixed") and t.amount > 5.0:
            candidates[t.description.lower()].append(t)
            
    detected_subs = []
    for desc, items in candidates.items():
        if len(items) >= 3:
            # Check if amounts are very close
            amounts = [i.amount for i in items]
            if len(set(amounts)) == 1 or (statistics.stdev(amounts) / statistics.mean(amounts) < 0.05):
                # Check intervals
                dates = sorted([i.date_operation for i in items])
                intervals = [(dates[i] - dates[i-1]).days for i in range(1, len(dates))]
                avg_interval = statistics.mean(intervals) if intervals else 0
                if 25 <= avg_interval <= 35: # Monthly sub
                    detected_subs.append({
                        "description": items[0].description,
                        "amount_euros": items[0].amount,
                        "interval_days": round(avg_interval, 1),
                        "frequency": "Monthly"
                    })
                    
    # 2. Duplicate detection (same date, same description, same amount)
    duplicates = []
    seen = {}
    for t in txs:
        if t.type in ("expense_var", "expense_fixed"):
            key = (t.date_operation, t.description.lower(), t.amount)
            if key in seen:
                duplicates.append({
                    "original_transaction_id": seen[key].id,
                    "duplicate_transaction_id": t.id,
                    "date": t.date_operation.isoformat(),
                    "description": t.description,
                    "amount_euros": t.amount
                })
            else:
                seen[key] = t
                
    return {
        "detected_subscriptions": detected_subs,
        "potential_duplicate_charges": duplicates
    }

def apply_transaction_correction_tool(db: Session, transaction_id: int, category: str = None, description: str = None, amount: float = None, type: str = None) -> dict:
    from app.models import Transaction, Category
    from app.services.history_service import record_action, snapshot_entity
    tx = db.query(Transaction).filter(Transaction.id == int(transaction_id)).first()
    if not tx:
        return {"success": False, "error": "Transaction not found"}
        
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

def get_saving_recommendations_tool(db: Session) -> dict:
    from app.models import Transaction
    from datetime import date, timedelta
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.date_operation <= today
    ).all()
    
    total_income = sum(t.amount for t in txs if t.type == "income")
    total_fixed = sum(t.amount for t in txs if t.type == "expense_fixed")
    total_var = sum(t.amount for t in txs if t.type == "expense_var")
    
    monthly_income = round(total_income / 6.0, 2)
    monthly_fixed = round(total_fixed / 6.0, 2)
    monthly_var = round(total_var / 6.0, 2)
    
    savings = round(monthly_income - monthly_fixed - monthly_var, 2)
    
    # 50/30/20 standard percentages
    needs_pct = round((monthly_fixed / monthly_income * 100) if monthly_income > 0 else 0, 1)
    wants_pct = round((monthly_var / monthly_income * 100) if monthly_income > 0 else 0, 1)
    savings_pct = round((savings / monthly_income * 100) if monthly_income > 0 else 0, 1)
    
    return {
        "monthly_averages": {
            "income_euros": monthly_income,
            "needs_fixed_euros": monthly_fixed,
            "wants_variable_euros": monthly_var,
            "net_savings_euros": savings
        },
        "ratio_50_30_20_actual": {
            "needs_percent": needs_pct,
            "wants_percent": wants_pct,
            "savings_percent": savings_pct
        },
        "recommendation": "Augmenter l'épargne" if savings_pct < 20 else "Structure saine et équilibrée"
    }

def search_similar_past_spends_tool(db: Session, keyword: str) -> dict:
    from app.models import Transaction
    from datetime import date, timedelta
    
    today = date.today()
    one_year_ago_start = today - timedelta(days=400)
    one_year_ago_end = today - timedelta(days=330)
    
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= one_year_ago_start,
        Transaction.date_operation <= one_year_ago_end,
        Transaction.description.ilike(f"%{keyword}%")
    ).all()
    
    return {
        "keyword": keyword,
        "historical_period": f"{one_year_ago_start.isoformat()} to {one_year_ago_end.isoformat()}",
        "transactions": [
            {
                "date": t.date_operation.isoformat(),
                "description": t.description,
                "amount_euros": t.amount,
                "category": t.category
            } for t in txs
        ]
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

def simulate_loan_amortization_tool(db: Session, principal: float, rate_percent: float, years: int) -> dict:
    principal = float(principal)
    rate_percent = float(rate_percent)
    years = int(years)
    
    monthly_rate = (rate_percent / 100.0) / 12.0
    months = years * 12
    
    if monthly_rate == 0:
        monthly_payment = principal / months
    else:
        monthly_payment = principal * (monthly_rate * (1 + monthly_rate) ** months) / (((1 + monthly_rate) ** months) - 1)
        
    total_paid = monthly_payment * months
    total_interest = total_paid - principal
    
    # Impact on left to live
    from app.services.finance_engine import calculate_rest_to_live, predict_next_paycheck
    from datetime import date
    today = date.today()
    paycheck = predict_next_paycheck(db)
    next_pay_date = paycheck["date"]
    current_rtl = calculate_rest_to_live(db, today, next_pay_date)
    new_rtl = round(current_rtl - monthly_payment, 2)
    
    return {
        "principal_euros": principal,
        "annual_rate_percent": rate_percent,
        "duration_years": years,
        "monthly_payment_euros": round(monthly_payment, 2),
        "total_interest_euros": round(total_interest, 2),
        "total_paid_euros": round(total_paid, 2),
        "current_rest_to_live_euros": current_rtl,
        "projected_rest_to_live_euros": new_rtl
    }

def get_financial_summary_tool(db: Session) -> dict:
    from app.services.finance_engine import calculate_rest_to_live, predict_next_paycheck
    from datetime import date
    
    today = date.today()
    paycheck = predict_next_paycheck(db)
    next_pay_date = paycheck["date"]
    
    rest_to_live = calculate_rest_to_live(db, today, next_pay_date)
    
    return {
        "current_rest_to_live_euros": rest_to_live,
        "next_predicted_paycheck": {
            "date": next_pay_date.isoformat() if isinstance(next_pay_date, date) else str(next_pay_date),
            "amount": paycheck["amount"],
            "is_override": paycheck["is_override"],
            "logical_period": paycheck["logical_period"]
        }
    }

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_financial_summary",
            "description": "Get the current 'Reste à vivre' (left to live) amount and the next predicted paycheck details (amount, date, logical period). Use this when the user asks about their remaining budget, budget difficulties, or paycheck/income projections.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_net_worth",
            "description": "Get the total net worth of the user (all accounts and savings combined). Returns reconciled balance (cleared in bank) and projected balance (including future/planned transactions).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_account_balances",
            "description": "Get the balances of all bank accounts and savings envelopes separately. Returns reconciled and projected balances.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_transactions",
            "description": "Search user transactions with various filters. Returns a list of transactions matching the criteria.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description_query": {
                        "type": "string",
                        "description": "Optional keyword search on transaction description."
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category name."
                    },
                    "type": {
                        "type": "string",
                        "description": "Optional transaction type: expense_var, expense_fixed, income, transfer, neutral."
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Optional start date in YYYY-MM-DD format."
                    },
                    "end_date": {
                        "type": "string",
                        "description": "Optional end date in YYYY-MM-DD format."
                    },
                    "min_amount": {
                        "type": "number",
                        "description": "Optional minimum amount."
                    },
                    "max_amount": {
                        "type": "number",
                        "description": "Optional maximum amount."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of transactions to return (default 50)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_spending_analytics",
            "description": "Get aggregated spending and income statistics for a specific period, grouped by category and transaction type.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start date of the analysis period (YYYY-MM-DD)."
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date of the analysis period (YYYY-MM-DD)."
                    }
                },
                "required": ["start_date", "end_date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_budgets_status",
            "description": "Get status of all budget envelopes and savings for a specific year and month.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {
                        "type": "integer",
                        "description": "Optional year. Defaults to current year."
                    },
                    "month": {
                        "type": "integer",
                        "description": "Optional month (1-12). Defaults to current month."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_recurrence_templates",
            "description": "Get the list of all active recurrence templates (regular bills, salaries, transfers).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_net_worth_history",
            "description": "Get the historical net worth trend data points grouped by month.",
            "parameters": {
                "type": "object",
                "properties": {
                    "months": {
                        "type": "integer",
                        "description": "Number of past months to retrieve (default 12)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_envelopes_impact",
            "description": "Simulate the impact of a planned purchase (amount) on user budget envelopes or savings. Returns remaining capacity.",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "The cost of the simulated purchase."},
                    "budget_id": {"type": "integer", "description": "Optional budget envelope ID to test."}
                },
                "required": ["amount"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_transaction_category",
            "description": "Suggest the most likely category for a transaction description based on existing database history.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "Transaction description (e.g. 'Amazon', 'LIDL')."}
                },
                "required": ["description"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "forecast_balances_history",
            "description": "Forecast account balances and left-to-live trend over next 30, 60, or 90 days using recurring transactions and average historical spend.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {"type": "integer", "description": "Number of days to forecast (30, 60, 90). Default is 30."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "detect_anomalies_and_subscriptions",
            "description": "Detect possible active subscriptions, duplicate charges, or suspicious expense spikes in recent months.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "apply_transaction_correction",
            "description": "Directly modify a transaction category, date, or amount in the database upon user request.",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {"type": "integer", "description": "The ID of the transaction to update."},
                    "category": {"type": "string", "description": "New category name (optional)."},
                    "description": {"type": "string", "description": "New description (optional)."},
                    "amount": {"type": "number", "description": "New amount (optional)."},
                    "type": {"type": "string", "description": "New type: expense_var, expense_fixed, income (optional)."}
                },
                "required": ["transaction_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_saving_recommendations",
            "description": "Analyze financial history of last 6 months to suggest a tailored saving rule (e.g. 50/30/20 rule adaptation).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_similar_past_spends",
            "description": "Search database for similar seasonal expenditures from the previous year (e.g. comparing holiday, heating, or gift spends).",
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "description": "Description keyword to look for in past year transactions."}
                },
                "required": ["keyword"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_csv_export_link",
            "description": "Create a temporary CSV file with filtered transactions matching user criteria, and return the download URL.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {"type": "string", "description": "Optional category filter."},
                    "start_date": {"type": "string", "description": "Optional start date filter (YYYY-MM-DD)."},
                    "end_date": {"type": "string", "description": "Optional end date filter (YYYY-MM-DD)."},
                    "type": {"type": "string", "description": "Optional transaction type filter."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_loan_amortization",
            "description": "Calculate loan monthly payments, total interest, and project its impact on the user's Reste à Vivre.",
            "parameters": {
                "type": "object",
                "properties": {
                    "principal": {"type": "number", "description": "The amount to borrow."},
                    "rate_percent": {"type": "number", "description": "Annual interest rate (e.g. 3.5)."},
                    "years": {"type": "integer", "description": "Duration of loan in years."}
                },
                "required": ["principal", "rate_percent", "years"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_budget_envelope",
            "description": "Create a new budget envelope with a specific limit, period (monthly, yearly, custom), and optional category names.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of the budget envelope."},
                    "monthly_amount": {"type": "number", "description": "Amount allocated to this budget (monthly value)."},
                    "period": {"type": "string", "description": "Period: monthly, yearly, custom, indefinite."},
                    "categories": {"type": "array", "items": {"type": "string"}, "description": "List of category names linked to this budget."},
                    "is_project": {"type": "boolean", "description": "True if this budget is a project (tracked via transactions budget_id)."}
                },
                "required": ["name", "monthly_amount"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_budget_envelope",
            "description": "Update details of an existing budget envelope.",
            "parameters": {
                "type": "object",
                "properties": {
                    "budget_id": {"type": "integer", "description": "The ID of the budget to update."},
                    "name": {"type": "string", "description": "New name (optional)."},
                    "monthly_amount": {"type": "number", "description": "New budget amount (optional)."},
                    "period": {"type": "string", "description": "New period (optional)."},
                    "categories": {"type": "array", "items": {"type": "string"}, "description": "New list of categories (optional)."},
                    "is_closed": {"type": "boolean", "description": "True to archive/close the budget."}
                },
                "required": ["budget_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_budget_envelope",
            "description": "Delete a budget envelope from the database.",
            "parameters": {
                "type": "object",
                "properties": {
                    "budget_id": {"type": "integer", "description": "The ID of the budget to delete."}
                },
                "required": ["budget_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_transaction",
            "description": "Delete a specific transaction from the database (e.g. to resolve a duplicate entry).",
            "parameters": {
                "type": "object",
                "properties": {
                    "transaction_id": {"type": "integer", "description": "The ID of the transaction to delete."}
                },
                "required": ["transaction_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "allocate_savings_funds",
            "description": "Add or withdraw funds from a savings envelope (tirelire). Positive amount to deposit, negative to withdraw.",
            "parameters": {
                "type": "object",
                "properties": {
                    "budget_id": {"type": "integer", "description": "The ID of the savings budget to allocate funds to/from."},
                    "amount": {"type": "number", "description": "Amount to allocate. Positive for deposit, negative for withdrawal."},
                    "note": {"type": "string", "description": "Optional comment or reason for this allocation."}
                },
                "required": ["budget_id", "amount"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_recurrence_template",
            "description": "Create a new recurring transaction template (bill, salary, regular transfer).",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Transaction amount (positive for income, negative for expense)."},
                    "description": {"type": "string", "description": "Description of the recurrence."},
                    "frequency": {"type": "string", "description": "Frequency: Weekly, Bi-weekly, Semi-monthly, Monthly, Quarterly, Semiannual, Yearly."},
                    "category": {"type": "string", "description": "Category name."},
                    "type": {"type": "string", "description": "Type: expense_fixed, expense_var, income, transfer, neutral."},
                    "day_of_month": {"type": "integer", "description": "Day of the month the transaction occurs (1-31)."},
                    "start_date": {"type": "string", "description": "Start date in YYYY-MM-DD format."}
                },
                "required": ["amount", "description", "frequency", "category", "type", "day_of_month"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "update_recurrence_template",
            "description": "Update details of an existing recurrence template.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "integer", "description": "The ID of the template to update."},
                    "amount": {"type": "number", "description": "New amount (optional)."},
                    "description": {"type": "string", "description": "New description (optional)."},
                    "frequency": {"type": "string", "description": "New frequency (optional)."},
                    "category": {"type": "string", "description": "New category name (optional)."},
                    "type": {"type": "string", "description": "New type (optional)."},
                    "day_of_month": {"type": "integer", "description": "New day of month (optional)."},
                    "is_active": {"type": "boolean", "description": "True to activate, False to pause (optional)."}
                },
                "required": ["template_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_recurrence_template",
            "description": "Delete a recurrence template.",
            "parameters": {
                "type": "object",
                "properties": {
                    "template_id": {"type": "integer", "description": "The ID of the template to delete."}
                },
                "required": ["template_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "create_category",
            "description": "Create a new transaction category.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of the new category."},
                    "type": {"type": "string", "description": "Category type: expense_var, expense_fixed, income, neutral."}
                },
                "required": ["name", "type"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "delete_category",
            "description": "Delete a category from the database.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Name of the category to delete."}
                },
                "required": ["name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_predicted_paycheck",
            "description": "Set/override the predicted paycheck details (estimated amount, day of month, or custom date).",
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {"type": "number", "description": "Estimated paycheck amount."},
                    "day_of_month": {"type": "integer", "description": "Estimated day of month."},
                    "date_override": {"type": "string", "description": "Force a specific date for the next paycheck in YYYY-MM-DD format (optional)."}
                },
                "required": ["amount", "day_of_month"]
            }
        }
    }
]

def load_system_prompt(role: str = 'advisor', categories: list = None, lang: str = 'fr') -> str:
    if role == 'simulator':
        prompt = """You are the Project Simulation Engine for OmniBank.
Your goal is to help the user simulate financial projects (purchasing a house, planning a trip, taking a loan) and compute their impact on the user's net worth and budgets.
CRITICAL: Do NOT ask the user for permission to consult their budgets, accounts, or recurrences, and do NOT tell the user that you need to consult them. Instead, IMMEDIATELY call the appropriate tools (like `get_budgets_status`, `get_account_balances`, or `get_recurrence_templates`) in your very first step to retrieve the necessary data.
Present your answers using clear markdown tables and LaTeX formatting for calculations."""
    elif role == 'alerts':
        prompt = """You are the Alert Analyst for OmniBank.
Your goal is to proactively identify anomalies, overspending, unnecessary subscription costs, or overdraft risks in the user's accounts.
Use the database tools to check recent transactions and active budget levels. Be direct and highlight potential issues in a concise markdown format."""
    elif role == 'optimizer':
        prompt = """You are the Subscription and Expenses Optimizer for OmniBank.
Your goal is to analyze the user's recurring transactions, bills, and recent transactions to identify optimization opportunities, excessive subscription costs, or potential duplicates."""
    elif role == 'budget_planner':
        prompt = """You are the Budget Planner for OmniBank.
Your goal is to analyze the user's spending habits over the last 12 months, compare them to their current budget envelopes, and recommend realistic budget envelope allocations."""
    elif role == 'forecaster':
        prompt = """You are the Cash Flow Forecaster for OmniBank.
Your goal is to project the user's account balances over the next 3 months, taking into account their planned recurring transactions and historical average spending."""
    elif role == 'auditor':
        prompt = """You are the Transaction Auditor for OmniBank.
Your goal is to scan the user's transaction history for data entry inconsistencies, categorization errors, suspicious duplicates, or delayed/forgotten reconciliations."""
    else: # advisor
        prompt = """You are the Premium Personal Financial Advisor for OmniBank.
Your goal is to help the user understand their financial situation, track their expenses, manage budgets, and make smart saving decisions.
CRITICAL: Do NOT ask the user for permission to consult their budgets, accounts, or recurrences, and do NOT tell the user that you need to consult them. Instead, IMMEDIATELY call the appropriate tools in your very first step to retrieve the necessary data.
Always use the tools provided to query the database first before answering. Do not guess, make up numbers, or apologize if you don't know without checking.
- Note that you are also the author of the proactive financial health reports (bilans périodiques proactifs) sent as notifications to the user (starting with status emojis 🟢, 🟡, 🔴). If the user asks about or wants to deepen a financial report they received, acknowledge that you analyzed and wrote it, and immediately use the tools (especially `detect_anomalies_and_subscriptions`, `get_financial_summary`, and `forecast_balances_history`) to double-check their current status and explain your reasoning in detail.
- Call `get_financial_summary` to retrieve the current Reste à Vivre (left to live) amount and the next predicted/scheduled paycheck details. ALWAYS call this tool first if the user asks about remaining budget, financial difficulties for the upcoming period, or paycheck projections. Do NOT assume a zero or extremely low income for future months without checking the predicted paycheck amount first.
- If the user asks whether they will finish the month comfortably, or about financial difficulty/overdraft risks before the end of the month/upcoming period, you MUST call BOTH `get_financial_summary` AND `forecast_balances_history` (with `days` set to the number of days until the end of the month or 30 days) to project their actual balance based on variable spending habits and recurring templates. Do NOT rely solely on the static 'Reste à Vivre' number; explain the daily average variable spending and recurrences that will occur before the end of the month to back up your projection.
- Call `get_account_balances` to check bank account/savings balances.
- Call `get_spending_analytics` to calculate total income/expense or spending per category over a date range. Do not read raw transactions to sum them up yourself.
- Call `search_transactions` to find specific transactions (by keyword, category, date).
- Call `get_budgets_status` to see budget progress (envelope limits, spent amounts, remaining balances).
- Call `get_recurrence_templates` to inspect regular bills.
- Call `get_net_worth_history` to analyze wealth growth.
Always be concise, professional, and helpful."""

    today_str = date.today().isoformat()
    prompt += f"\n\nCURRENT DATE REFERENCE: Today is {today_str}."
    prompt += """

GREETINGS & SIMPLE MESSAGES RULE:
- If the user's message is a simple greeting, salutation, or polite introductory message (e.g., "Bonjour", "Hello", "Salut", "Coucou", "How are you", etc.) without any specific financial questions or queries, do NOT call any database or analysis tools.
- Instead, respond politely and briefly, offering to help them manage their finances, budgets, or simulations.

RECONCILIATION & FUTURE TRANSACTIONS RULE:
- In normal mode, the user manages their budget and expenses between regular pay dates.
- It is perfectly normal and expected for transactions with a future date (where `date_operation` is in the future relative to the CURRENT DATE REFERENCE above) to be in the "Unreconciled" (Non Rapproché) state, as they represent scheduled/planned operations that have not occurred yet.
- Do NOT flag future or scheduled transactions as anomalies, forgotten reconciliations, or errors.
- Only consider a transaction as a potentially forgotten or delayed reconciliation if its date is in the PAST (older than today) and it is still unreconciled.

DUPLICATES & CORRECTIONS RULE:
- Do NOT correct duplicate transactions by changing their amount (e.g., making it negative or trying to 'cancel' it) or category.
- To resolve or eliminate a duplicate transaction, you MUST call the `delete_transaction` tool (e.g. to propose its deletion) or explicitly suggest deletion.

WRITE ACTIONS RULE (CRITICAL):
- When you use any write action tools (like `create_budget_envelope`, `update_budget_envelope`, `delete_budget_envelope`, `allocate_savings_funds`, `create_recurrence_template`, `update_recurrence_template`, `delete_recurrence_template`, `create_category`, `delete_category`, `set_predicted_paycheck`, `delete_transaction`), these actions are NOT applied directly in the database.
- Instead, they are placed in a queue requiring user validation.
- Therefore, in your response text, you MUST NOT say "J'ai mis à jour / créé / modifié / supprimé..." or "I have updated / created / modified / deleted...".
- Instead, you MUST state that you have **prepared the proposed action** (e.g. prepared the paycheck forecast update) and that the user must review and validate it.
- Example (FR): "J'ai préparé la mise à jour de votre prévision de paie à 2400 € le 29 du mois. Veuillez l'examiner et la valider ci-dessous."
- Example (EN): "I have prepared the paycheck forecast update to 2400 on the 29th. Please review and validate it below."""

    cat_list = ", ".join(f'"{c}"' for c in (categories or []))
    prompt += f"""

IMPORTANT: If you suggest correcting a transaction (re-categorizing, correcting a duplicate, modifying an anomaly, or executing `apply_transaction_correction` / `detect_anomalies_and_subscriptions`), you MUST append this single-line JSON block immediately at the end of your explanation on its own line:
{{"id": 123, "updates": {{"category": "New Category", "description": "New description", "amount": -20.5}}}}
Replace 123 with the real transaction ID, and specify in "updates" the fields to modify.
This JSON block will trigger an interactive human-in-the-loop review button in the UI for the user to confirm.
EXISTING CATEGORIES (prefer these): {cat_list}
If none fits, propose a short and precise new category name. Only propose one JSON action at a time."""

    if lang == 'fr':
        prompt += "\n\nIMPORTANT: You must write your response in French."
    else:
        prompt += "\n\nIMPORTANT: You must write your response in English."

    return prompt

def estimate_tokens(text: str) -> int:
    return len(text) // 4

def start_compression(db: Session, session: ChatSession, messages: List[ChatMessage], cfg: dict, lang: str = "fr", custom_instruction: str = None, trigger_msg_id: int = None) -> str | None:
    """Compress conversation history into compressed_context without deleting any messages.
    
    Compresses from the last compression point (or beginning) up to the last AI message
    before the trigger. The trigger message and the future AI response remain uncompressed.
    Uses dedicated LLM parameters (temperature=0.1, num_predict=2048) for faithful, concise summaries.
    Returns the new compressed_context string, or None on failure.
    """
    # Compress all messages from the last boundary (or beginning) up to (not including) the trigger
    if trigger_msg_id:
        if session.last_compressed_message_id:
            to_compress = [m for m in messages if m.id > session.last_compressed_message_id and m.id < trigger_msg_id]
        else:
            to_compress = [m for m in messages if m.id < trigger_msg_id]
    else:
        # Fallback (regenerate without trigger): use existing last_compressed_message_id or compress all
        if session.last_compressed_message_id:
            to_compress = [m for m in messages if m.id > session.last_compressed_message_id]
        else:
            to_compress = messages
    
    if not to_compress:
        return None  # Nothing new to compress

    formatted_history = []
    if session.compressed_context:
        formatted_history.append(f"[Previously compressed summary]\n{session.compressed_context}\n\n[New messages to add to summary]")
    for msg in to_compress:
        role_prefix = "U" if msg.role == "user" else "A"
        formatted_history.append(f"{role_prefix}: {msg.content}")
    history_text = "\n".join(formatted_history)

    # Prompt in English, with language instruction for the response
    lang_instruction = ""
    if lang and lang.lower() == "fr":
        lang_instruction = "\nIMPORTANT: Write the summary in French."
    elif lang and lang.lower() != "en":
        lang_instruction = f"\nIMPORTANT: Write the summary in {lang}."
    else:
        lang_instruction = "\nIMPORTANT: Write the summary in English."

    custom_instr_block = ""
    if custom_instruction:
        custom_instr_block = f"\nAdditional user instruction for this summary: {custom_instruction}"

    prompt = f"""{history_text}

=== COMPRESSION INSTRUCTIONS (CRITICAL — READ CAREFULLY) ===
You are a memory compactor for a financial AI assistant. Summarize the conversation ABOVE.

RULES:
1. Output ONLY the summary. No intro, no commentary, no titles.
2. Use bullet points for key facts. Keep it dense and informative.
3. U: = user said, A: = assistant said.
4. Remove ALL greetings, politeness, filler, repetitions.
5. KEEP ALL financial data: amounts, dates, account names, categories, decisions made.
6. KEEP conversation flow (who asked what, what was decided).
7. Target: 30-50% of original size.{lang_instruction}{custom_instr_block}

NOW WRITE THE SUMMARY BELOW:"""

    # Use dedicated compression parameters: lower temperature for faithfulness, limited output length
    compression_cfg = dict(cfg)
    compression_cfg["temperature"] = 0.1
    compression_options = {"temperature": 0.1, "num_ctx": cfg["num_ctx"], "num_predict": 2048}

    try:
        compacted = call_ollama_sync(prompt, compression_cfg, extra_options={"num_predict": 2048})
        if compacted:
            compacted = compacted.strip()
            # If this is a subsequent compression, push the old context onto the stack
            if session.bubble_after_id and session.compressed_context:
                import json
                stack = json.loads(session.compression_stack) if session.compression_stack else []
                stack.append({
                    "context": session.compressed_context,
                    "after_id": session.bubble_after_id
                })
                session.compression_stack = json.dumps(stack)

            session.compressed_context = compacted
            # Track the last message ID that is now covered by the compressed context
            session.last_compressed_message_id = to_compress[-1].id
            # Place bubble after the last compressed message (not after the trigger)
            session.bubble_after_id = to_compress[-1].id
            session.compressing = False
            session.buffered_message = None
            session.compression_started_at = None
            db.commit()
            db.refresh(session)
            return compacted
    except Exception as e:
        logger.error(f"[Compression] Error during start_compression: {e}")
        session.compressing = False
        session.compression_started_at = None
        db.commit()
    return None

def generate_session_title(db_session_factory, session_id: int, user_message: str, cfg: dict):
    """Generate a session title in a background task using its own DB session.
    Uses a dedicated DB session to avoid conflicts with the streaming response,
    and retries once after a delay if Ollama is busy."""
    import time
    prompt = f"""Conversation first message: "{user_message}"

=== INSTRUCTIONS ===
Generate a concise 3-5 word title for this conversation based on the user's first message. 
Output ONLY the title, no quotation marks, no commentary, no intro, nothing else.
Write the title in the same language as the message.

NOW GENERATE THE TITLE:"""

    max_attempts = 2
    for attempt in range(1, max_attempts + 1):
        db = None
        try:
            # Wait for the main Ollama response to likely finish before requesting title
            if attempt == 1:
                time.sleep(3)
            else:
                time.sleep(10)

            title = call_ollama_sync(prompt, cfg)
            if title:
                clean_title = title.strip().strip('"').strip("'").split("\n")[0].strip()
                if clean_title:
                    db = db_session_factory()
                    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
                    if session:
                        session.title = clean_title
                        db.commit()
                        print(f"[Chat] Auto-title for session {session_id}: {clean_title}")
                    return  # Success
        except Exception as e:
            print(f"[Chat] Title generation attempt {attempt}/{max_attempts} failed for session {session_id}: {e}")
        finally:
            if db is not None:
                try:
                    db.close()
                except Exception:
                    pass

    print(f"[Chat] All title generation attempts failed for session {session_id}")

@router.get("/sessions")
async def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(ChatSession).order_by(ChatSession.created_at.desc()).all()
    return [{
        "id": s.id,
        "title": s.title,
        "role": s.role,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "has_compressed_context": bool(s.compressed_context)
    } for s in sessions]

@router.post("/sessions")
async def create_session(req: ChatSessionCreate, db: Session = Depends(get_db)):
    session = ChatSession(role=req.role)
    if req.title:
        session.title = req.title
    db.add(session)
    db.commit()
    db.refresh(session)
    return {
        "id": session.id,
        "title": session.title,
        "role": session.role,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "has_compressed_context": False
    }

@router.put("/sessions/{id}")
async def update_session(id: int, req: ChatSessionUpdate, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    if req.title is not None:
        session.title = req.title
    if req.role is not None:
        session.role = req.role
    db.commit()
    return {"ok": True}

@router.delete("/sessions/{id}")
async def delete_session(id: int, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    db.delete(session)
    db.commit()
    return {"ok": True}

@router.get("/sessions/{id}/generating")
async def is_session_generating(id: int):
    """Check if an AI response is currently being generated for this session."""
    return {"generating": id in _generating_sessions}

@router.post("/sessions/{id}/notify-on-complete")
async def notify_on_complete(id: int, db: Session = Depends(get_db)):
    """Register that a notification should be created when generation completes for this session."""
    if id in _generating_sessions:
        # Still generating — register for later notification in the finally block
        _notify_on_complete.add(id)
    else:
        # Generation already finished — create notification immediately
        from app.models import Notification
        logger.info(f"[Chat] Generation already complete for session {id} — creating notification now")
        notif = Notification(
            type="system",
            title="Réponse IA disponible 💬",
            content="Votre conseiller IA a terminé sa réponse. Retrouvez-la dans votre conversation.",
            link_data=json.dumps({"session_id": id}),
            is_read=False
        )
        db.add(notif)
        db.commit()
    return {"ok": True}

@router.get("/sessions/{id}/messages")
async def get_session_messages(id: int, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
    
    cfg = get_ollama_config(db)
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    sys_prompt = load_system_prompt(session.role, categories, 'fr')
    
    tools_tokens = estimate_tokens(json.dumps(TOOLS))
    used = estimate_tokens(sys_prompt) + tools_tokens + 500  # 500 tokens for system prompt wrapper format
    if session.compressed_context:
        used += estimate_tokens(session.compressed_context)
    # Filter messages to only count those after last_compressed_message_id
    if session.last_compressed_message_id:
        messages_for_tokens = [m for m in messages if m.id > session.last_compressed_message_id]
    else:
        messages_for_tokens = messages
    for m in messages_for_tokens:
        used += estimate_tokens(m.content)
        
    return {
        "compressed_context": session.compressed_context,
        "compressing": bool(session.compressing),
        "last_compressed_message_id": session.last_compressed_message_id,
        "bubble_after_id": session.bubble_after_id,
        "compression_stack": session.compression_stack,
        "messages": [{
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "timestamp": m.timestamp.isoformat() if m.timestamp else None
        } for m in messages],
        "token_usage": {
            "used": used,
            "limit": cfg["num_ctx"]
        }
    }

@router.put("/sessions/{id}/context")
async def update_session_context(id: int, req: ChatContextUpdate, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    session.compressed_context = req.compressed_context
    db.commit()
    return {"ok": True}

@router.delete("/sessions/{id}/compressed-context")
async def delete_compressed_context(id: int, db: Session = Depends(get_db)):
    """Remove the compressed context summary. The conversation reverts to raw mode
    (natural LLM sliding window). Next time 90% is reached, compression triggers again."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    session.compressed_context = None
    session.last_compressed_message_id = None
    session.bubble_after_id = None
    session.compression_stack = None
    session.compressing = False
    session.buffered_message = None
    session.compression_started_at = None
    db.commit()
    return {"ok": True}

@router.get("/sessions/{id}/compression-status")
async def get_compression_status(id: int, db: Session = Depends(get_db)):
    """Return current compression state. Used by frontend polling during active compression."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    return {
        "compressing": bool(session.compressing),
        "compressed_context": session.compressed_context,
        "last_compressed_message_id": session.last_compressed_message_id,
        "bubble_after_id": session.bubble_after_id,
        "compression_stack": session.compression_stack
    }

@router.post("/sessions/{id}/regenerate-compressed-context")
async def regenerate_compressed_context(id: int, req: ChatRegenerateContext, db: Session = Depends(get_db)):
    """Re-run the compression with an optional custom instruction, replacing the existing summary."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    
    cfg = get_ollama_config(db)
    if not cfg["enabled"] or not cfg["url"] or not cfg["model"]:
        raise HTTPException(status_code=400, detail="Ollama URL ou Modèle non configuré.")
    
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
    
    # Reset compression point and stack so we compress the full conversation
    session.last_compressed_message_id = None
    session.bubble_after_id = None
    session.compression_stack = None
    db.commit()

    new_context = start_compression(db, session, messages, cfg, custom_instruction=req.instruction)
    if new_context is None:
        raise HTTPException(status_code=500, detail="La compression a échoué. Vérifiez votre configuration Ollama.")
    
    return {"compressed_context": new_context}

@router.delete("/messages/{id}")
async def delete_message(id: int, db: Session = Depends(get_db)):
    message = db.query(ChatMessage).filter(ChatMessage.id == id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message non trouvé")

    session_id = message.session_id

    # Cascade delete: all subsequent messages in the session
    subsequent = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.timestamp > message.timestamp
    ).all()
    for m in subsequent:
        db.delete(m)

    # Delete the message itself
    db.delete(message)

    # If the deleted message is before or at the compression boundary,
    # clear the compressed context (the summary references deleted content)
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session and session.last_compressed_message_id and message.id <= session.last_compressed_message_id:
        session.compressed_context = None
        session.last_compressed_message_id = None
        session.bubble_after_id = None
        session.compression_stack = None

    db.commit()
    return {"ok": True}

@router.post("/sessions/{id}/system-message")
async def add_system_message(id: int, req: ChatSendMessage, db: Session = Depends(get_db)):
    """Insert a message into a session without triggering AI generation.
    Used for feedback messages (e.g. after applying an AI action)."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    
    if req.update_last_assistant:
        last_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.desc()).first()
        if last_msg and last_msg.role == "assistant":
            last_msg.content = req.content
            db.commit()
            return {"ok": True}

    msg = ChatMessage(session_id=id, role=req.role or "assistant", content=req.content)
    db.add(msg)
    db.commit()
    return {"ok": True}


class ChatApplyActionRequest(BaseModel):
    action: str
    params: dict


@router.post("/apply-action")
async def apply_chat_action(req: ChatApplyActionRequest, db: Session = Depends(get_db)):
    action = req.action
    params = req.params
    
    if action == "create_budget_envelope":
        res = create_budget_envelope_tool(db, name=params.get("name"), monthly_amount=params.get("monthly_amount"), period=params.get("period", "monthly"), categories=params.get("categories"), is_project=params.get("is_project", False), force_write=True)
    elif action == "update_budget_envelope":
        res = update_budget_envelope_tool(db, budget_id=params.get("budget_id"), name=params.get("name"), monthly_amount=params.get("monthly_amount"), period=params.get("period"), categories=params.get("categories"), is_closed=params.get("is_closed"), force_write=True)
    elif action == "delete_budget_envelope":
        res = delete_budget_envelope_tool(db, budget_id=params.get("budget_id"), force_write=True)
    elif action == "allocate_savings_funds":
        res = allocate_savings_funds_tool(db, budget_id=params.get("budget_id"), amount=params.get("amount"), note=params.get("note"), force_write=True)
    elif action == "create_recurrence_template":
        res = create_recurrence_template_tool(db, amount=params.get("amount"), description=params.get("description"), frequency=params.get("frequency"), category=params.get("category"), type=params.get("type"), day_of_month=params.get("day_of_month"), force_write=True)
    elif action == "update_recurrence_template":
        res = update_recurrence_template_tool(db, template_id=params.get("template_id"), amount=params.get("amount"), description=params.get("description"), frequency=params.get("frequency"), category=params.get("category"), type=params.get("type"), day_of_month=params.get("day_of_month"), is_active=params.get("is_active"), force_write=True)
    elif action == "delete_recurrence_template":
        res = delete_recurrence_template_tool(db, template_id=params.get("template_id"), force_write=True)
    elif action == "create_category":
        res = create_category_tool(db, name=params.get("name"), type=params.get("type"), force_write=True)
    elif action == "delete_category":
        res = delete_category_tool(db, name=params.get("name"), force_write=True)
    elif action == "set_predicted_paycheck":
        res = set_predicted_paycheck_tool(db, amount=params.get("amount"), day_of_month=params.get("day_of_month"), date_override=params.get("date_override"), force_write=True)
    elif action == "delete_transaction":
        res = delete_transaction_tool(db, transaction_id=params.get("transaction_id"), force_write=True)
    else:
        raise HTTPException(status_code=400, detail=f"Action '{action}' non reconnue")
        
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Erreur lors de l'exécution"))
        
    return res

@router.post("/sessions/{id}/message")
async def send_message(id: int, req: ChatSendMessage, request: Request = None, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    
    cfg = get_ollama_config(db)
    if not cfg["enabled"] or not cfg["url"] or not cfg["model"]:
        raise HTTPException(status_code=400, detail="Ollama URL ou Modèle non configuré.")
        
    url = cfg["url"].rstrip("/")
    model = cfg["model"]
    
    # Save user message to database
    user_msg = ChatMessage(session_id=id, role="user", content=req.content)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)
    
    # Get all messages
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
    
    # Check if first message to trigger title generation
    is_first_exchange = (len(messages) == 1)
    
    # Context Compression check
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    sys_prompt = load_system_prompt(session.role, categories, req.lang)
    
    options = {"temperature": cfg["temperature"], "num_ctx": cfg["num_ctx"]}
    
    # Estimate token budget — only count messages AFTER the last compression point
    tools_tokens = estimate_tokens(json.dumps(TOOLS))
    total_tokens = estimate_tokens(sys_prompt) + tools_tokens + 500
    if session.compressed_context:
        total_tokens += estimate_tokens(session.compressed_context)
    if session.last_compressed_message_id:
        messages_after_compression = [m for m in messages if m.id > session.last_compressed_message_id]
    else:
        messages_after_compression = messages
    for m in messages_after_compression:
        total_tokens += estimate_tokens(m.content)
    
    # Check if compression is needed at 90% threshold
    needs_compression = (total_tokens > int(cfg["num_ctx"] * 0.85))
    
    # Build Ollama payload — always use filtered messages (those after compression point)
    def build_ollama_payload(current_session, current_messages):
        """Build Ollama message list, filtering out messages already covered by compressed_context."""
        sys_content = sys_prompt
        # Include all historical compression contexts from the stack
        if current_session.compression_stack:
            import json as _json
            try:
                stack = _json.loads(current_session.compression_stack)
                for entry in stack:
                    sys_content += f"\n\n[COMPRESSED HISTORY]\n{entry['context']}"
            except Exception:
                pass
        if current_session.compressed_context:
            sys_content += f"\n\n[CONTEXT SUMMARY — earlier conversation]\n{current_session.compressed_context}"
        payload_msgs = [{"role": "system", "content": sys_content}]
        # Only include messages AFTER the compression point
        if current_session.last_compressed_message_id:
            filtered = [m for m in current_messages if m.id > current_session.last_compressed_message_id]
        else:
            filtered = current_messages
        for m in filtered:
            payload_msgs.append({"role": m.role, "content": m.content})
        return payload_msgs
    
    ollama_msgs = build_ollama_payload(session, messages)
    
    async def generate_response():
        nonlocal ollama_msgs  # Allow reassigning after compression
        final_text = ""
        _response_saved = False
        _done_sent = False
        _client_disconnected = False
        _tools_meta = ""
        _generating_sessions.add(id)
        try:
            # --- Compression step (synchronous, inside the SSE generator) ---
            if needs_compression:
                from datetime import datetime as _dt
                # Mark session as compressing
                session.compressing = True
                session.compression_started_at = _dt.utcnow()
                db.commit()
                # Notify frontend that compression is starting
                yield f"data: {json.dumps({'compressing': True})}\n\n"
                # Run compression synchronously (blocking) within the generator
                new_context = start_compression(db, session, messages, cfg, lang=req.lang, trigger_msg_id=user_msg.id)
                db.refresh(session)
                # Rebuild the Ollama payload with updated session state
                updated_messages = db.query(ChatMessage).filter(
                    ChatMessage.session_id == id
                ).order_by(ChatMessage.timestamp.asc()).all()
                ollama_msgs = build_ollama_payload(session, updated_messages)
                # Compute token_usage after compression (immediate feedback for the token counter)
                tools_tokens_post = estimate_tokens(json.dumps(TOOLS))
                used_post = estimate_tokens(sys_prompt) + tools_tokens_post + 500
                if session.compressed_context:
                    used_post += estimate_tokens(session.compressed_context)
                if session.last_compressed_message_id:
                    post_msgs = [m for m in updated_messages if m.id > session.last_compressed_message_id]
                else:
                    post_msgs = updated_messages
                for m in post_msgs:
                    used_post += estimate_tokens(m.content)
                # Notify frontend that compression is done
                yield f"data: {json.dumps({'compressing': False, 'compressed_context': new_context or '', 'last_compressed_message_id': session.last_compressed_message_id, 'bubble_after_id': session.bubble_after_id, 'compression_stack': session.compression_stack, 'token_usage': {'used': used_post, 'limit': cfg['num_ctx']}})}\n\n"

            async with httpx.AsyncClient() as client:
                tool_desc_map = {
                    "get_financial_summary": "Analyse du reste à vivre et des prévisions de salaire...",
                    "get_net_worth": "Consultation du patrimoine net global...",
                    "get_account_balances": "Interrogation du solde des comptes...",
                    "search_transactions": "Recherche de transactions...",
                    "get_spending_analytics": "Calcul des statistiques de dépenses...",
                    "get_budgets_status": "Vérification de l'état des budgets...",
                    "get_recurrence_templates": "Examen des charges récurrentes...",
                    "get_net_worth_history": "Analyse de l'historique du patrimoine...",
                    "get_envelopes_impact": "Simulation de l'impact sur vos enveloppes budgétaires...",
                    "suggest_transaction_category": "Recherche d'une suggestion de catégorie...",
                    "forecast_balances_history": "Calcul des prévisions de solde...",
                    "detect_anomalies_and_subscriptions": "Recherche d'abonnements et de doublons...",
                    "apply_transaction_correction": "Application de la modification sur l'opération...",
                    "get_saving_recommendations": "Génération de vos préconisations d'épargne...",
                    "search_similar_past_spends": "Analyse comparative des dépenses passées...",
                    "generate_csv_export_link": "Génération du lien de téléchargement CSV...",
                    "simulate_loan_amortization": "Simulation d'amortissement de prêt...",
                    "create_budget_envelope": "Création de la nouvelle enveloppe de budget...",
                    "update_budget_envelope": "Mise à jour de l'enveloppe de budget...",
                    "delete_budget_envelope": "Suppression de l'enveloppe de budget...",
                    "allocate_savings_funds": "Enregistrement de l'alimentation/retrait de la tirelire...",
                    "create_recurrence_template": "Création du modèle de transaction récurrente...",
                    "update_recurrence_template": "Mise à jour du modèle de récurrence...",
                    "delete_recurrence_template": "Suppression du modèle de récurrence...",
                    "create_category": "Création de la nouvelle catégorie...",
                    "delete_category": "Suppression de la catégorie...",
                    "set_predicted_paycheck": "Mise à jour de la date/montant théorique de salaire..."
                }

                # Helper: stream a request to Ollama, yield content chunks, return full text
                async def _stream_ollama(payload_data):
                    """Stream Ollama response, yielding SSE chunks. Returns (full_text, tool_calls_list)."""
                    collected_text = ""
                    collected_tool_calls = []
                    in_thinking = False

                    async with client.stream("POST", f"{url}/api/chat", json=payload_data, timeout=httpx.Timeout(300.0, connect=10.0)) as stream_resp:
                        if stream_resp.status_code != 200:
                            yield f"data: {json.dumps({'error': 'Ollama error: ' + str(stream_resp.status_code)})}\n\n"
                            return
                        async for line in stream_resp.aiter_lines():
                            if not line:
                                continue
                            try:
                                json_chunk = json.loads(line)
                            except json.JSONDecodeError:
                                continue

                            msg_obj = json_chunk.get("message", {})

                            # Intercept native tool_calls from stream
                            tc_list = msg_obj.get("tool_calls")
                            if tc_list:
                                collected_tool_calls.extend(tc_list)
                                continue

                            reasoning = msg_obj.get("reasoning_content", "")
                            content = msg_obj.get("content", "")

                            chunk_to_send = ""
                            if reasoning:
                                if not in_thinking:
                                    chunk_to_send += "<think>\n"
                                    in_thinking = True
                                chunk_to_send += reasoning
                            else:
                                if in_thinking:
                                    chunk_to_send += "\n</think>\n\n"
                                    in_thinking = False
                                chunk_to_send += content

                            if chunk_to_send:
                                collected_text += chunk_to_send
                                yield f"data: {json.dumps({'content': chunk_to_send})}\n\n"

                    if in_thinking:
                        collected_text += "\n</think>\n\n"
                        yield f"data: {json.dumps({'content': chr(10) + '</think>' + chr(10) + chr(10)})}\n\n"

                    # Attach results as a special final yield
                    yield {"_result": collected_text, "_tool_calls": collected_tool_calls}

                # ─── Phase 1: Stream with tools ───
                payload = {
                    "model": model,
                    "messages": ollama_msgs,
                    "tools": TOOLS,
                    "stream": True,
                    "options": options,
                    "keep_alive": "30m"
                }

                phase1_text = ""
                detected_tool_calls = []
                async for chunk in _stream_ollama(payload):
                    if isinstance(chunk, dict) and "_result" in chunk:
                        phase1_text = chunk["_result"]
                        detected_tool_calls = chunk["_tool_calls"]
                    else:
                        # Accumulate text progressively for safety (client may disconnect)
                        if isinstance(chunk, str) and chunk.startswith('data: '):
                            try:
                                d = json.loads(chunk[6:].strip())
                                if d.get('content'):
                                    final_text += d['content']
                            except: pass
                        if request and await request.is_disconnected():
                            _client_disconnected = True
                            return
                        yield chunk

                # ─── Phase 2: If tool calls detected, execute and re-stream ───
                if detected_tool_calls:
                    # Build assistant message with tool_calls for Ollama history
                    assistant_tc_msg = {"role": "assistant", "tool_calls": detected_tool_calls, "content": phase1_text}
                    ollama_msgs.append(assistant_tc_msg)

                    detected_write_actions = []
                    import asyncio
                    for tool_call in detected_tool_calls:
                        if request and await request.is_disconnected():
                            _client_disconnected = True
                            return
                        fn_name = tool_call["function"]["name"]
                        fn_args = tool_call["function"].get("arguments", {})
                        
                        if fn_name in [
                            "create_budget_envelope", "update_budget_envelope", "delete_budget_envelope",
                            "allocate_savings_funds", "create_recurrence_template", "update_recurrence_template",
                            "delete_recurrence_template", "create_category", "delete_category", "set_predicted_paycheck",
                            "delete_transaction"
                        ]:
                            detected_write_actions.append({"action": fn_name, "params": fn_args})

                        desc_status = tool_desc_map.get(fn_name, f"Exécution de {fn_name}...")
                        yield f"data: {json.dumps({'status': desc_status})}\n\n"
                        await asyncio.sleep(0.8)

                        tool_result = {}
                        if fn_name == "get_financial_summary":
                            tool_result = get_financial_summary_tool(db)
                        elif fn_name == "get_net_worth":
                            tool_result = get_net_worth_tool(db)
                        elif fn_name == "get_account_balances":
                            tool_result = get_balances_tool(db)
                        elif fn_name == "search_transactions":
                            tool_result = search_transactions_tool(db, fn_args.get("description_query"), fn_args.get("category"), fn_args.get("type"), fn_args.get("start_date"), fn_args.get("end_date"), fn_args.get("min_amount"), fn_args.get("max_amount"), fn_args.get("limit", 50))
                        elif fn_name == "get_spending_analytics":
                            tool_result = get_spending_analytics_tool(db, fn_args.get("start_date"), fn_args.get("end_date"))
                        elif fn_name == "get_budgets_status":
                            tool_result = get_budgets_status_tool(db, fn_args.get("year"), fn_args.get("month"))
                        elif fn_name == "get_recurrence_templates":
                            tool_result = get_recurrence_templates_tool(db)
                        elif fn_name == "get_net_worth_history":
                            tool_result = get_net_worth_history_tool(db, fn_args.get("months", 12))
                        elif fn_name == "get_envelopes_impact":
                            tool_result = get_envelopes_impact_tool(db, fn_args.get("amount"), fn_args.get("budget_id"))
                        elif fn_name == "suggest_transaction_category":
                            tool_result = suggest_transaction_category_tool(db, fn_args.get("description"))
                        elif fn_name == "forecast_balances_history":
                            tool_result = forecast_balances_history_tool(db, fn_args.get("days", 30))
                        elif fn_name == "detect_anomalies_and_subscriptions":
                            tool_result = detect_anomalies_and_subscriptions_tool(db)
                        elif fn_name == "apply_transaction_correction":
                            tool_result = apply_transaction_correction_tool(db, fn_args.get("transaction_id"), fn_args.get("category"), fn_args.get("description"), fn_args.get("amount"), fn_args.get("type"))
                        elif fn_name == "create_budget_envelope":
                            tool_result = create_budget_envelope_tool(db, fn_args.get("name"), fn_args.get("monthly_amount"), fn_args.get("period", "monthly"), fn_args.get("categories"), fn_args.get("is_project", False))
                        elif fn_name == "update_budget_envelope":
                            tool_result = update_budget_envelope_tool(db, fn_args.get("budget_id"), fn_args.get("name"), fn_args.get("monthly_amount"), fn_args.get("period"), fn_args.get("categories"), fn_args.get("is_closed"))
                        elif fn_name == "delete_budget_envelope":
                            tool_result = delete_budget_envelope_tool(db, fn_args.get("budget_id"))
                        elif fn_name == "allocate_savings_funds":
                            tool_result = allocate_savings_funds_tool(db, fn_args.get("budget_id"), fn_args.get("amount"), fn_args.get("note"))
                        elif fn_name == "create_recurrence_template":
                            tool_result = create_recurrence_template_tool(db, fn_args.get("amount"), fn_args.get("description"), fn_args.get("frequency"), fn_args.get("category"), fn_args.get("type"), fn_args.get("day_of_month"))
                        elif fn_name == "update_recurrence_template":
                            tool_result = update_recurrence_template_tool(db, fn_args.get("template_id"), fn_args.get("amount"), fn_args.get("description"), fn_args.get("frequency"), fn_args.get("category"), fn_args.get("type"), fn_args.get("day_of_month"), fn_args.get("is_active"))
                        elif fn_name == "delete_recurrence_template":
                            tool_result = delete_recurrence_template_tool(db, fn_args.get("template_id"))
                        elif fn_name == "create_category":
                            tool_result = create_category_tool(db, fn_args.get("name"), fn_args.get("type"))
                        elif fn_name == "delete_category":
                            tool_result = delete_category_tool(db, fn_args.get("name"))
                        elif fn_name == "set_predicted_paycheck":
                            tool_result = set_predicted_paycheck_tool(db, fn_args.get("amount"), fn_args.get("day_of_month"), fn_args.get("date_override"))
                        elif fn_name == "delete_transaction":
                            tool_result = delete_transaction_tool(db, fn_args.get("transaction_id"))
                        elif fn_name == "get_saving_recommendations":
                            tool_result = get_saving_recommendations_tool(db)
                        elif fn_name == "search_similar_past_spends":
                            tool_result = search_similar_past_spends_tool(db, fn_args.get("keyword"))
                        elif fn_name == "generate_csv_export_link":
                            tool_result = generate_csv_export_link_tool(db, fn_args.get("category"), fn_args.get("start_date"), fn_args.get("end_date"), fn_args.get("type"))
                        elif fn_name == "simulate_loan_amortization":
                            tool_result = simulate_loan_amortization_tool(db, fn_args.get("principal"), fn_args.get("rate_percent"), fn_args.get("years"))
                        else:
                            tool_result = {"error": f"Tool '{fn_name}' is not supported or defined."}

                        ollama_msgs.append({
                            "role": "tool",
                            "name": fn_name,
                            "content": json.dumps(tool_result, ensure_ascii=False)
                        })

                    # Track tools metadata for DB
                    fn_names = [tc["function"]["name"] for tc in detected_tool_calls]
                    _tools_meta = f"<!-- TOOLS_USED: {','.join(fn_names)} -->\n"

                    # Phase 2b: Stream final response with tool results (no tools this time)
                    payload_final = {
                        "model": model,
                        "messages": ollama_msgs,
                        "stream": True,
                        "options": options,
                        "keep_alive": "30m"
                    }
                    final_text = ""  # Reset for phase2 (will be re-accumulated)
                    async for chunk in _stream_ollama(payload_final):
                        if isinstance(chunk, dict) and "_result" in chunk:
                            final_text = chunk["_result"]
                        else:
                            # Accumulate text progressively for safety (client may disconnect)
                            if isinstance(chunk, str) and chunk.startswith('data: '):
                                try:
                                    d = json.loads(chunk[6:].strip())
                                    if d.get('content'):
                                        final_text += d['content']
                                except: pass
                            if request and await request.is_disconnected():
                                _client_disconnected = True
                                return
                            yield chunk

                else:
                    # No tool calls — phase1 already streamed everything
                    final_text = phase1_text

                # If write actions were detected, inject validation block at the end
                if detected_tool_calls and 'detected_write_actions' in locals() and detected_write_actions:
                    action_str = ""
                    for action in detected_write_actions:
                        action_str += f"\n\n```action\n{json.dumps(action, ensure_ascii=False)}\n```"
                    if action_str:
                        final_text += action_str
                        yield f"data: {json.dumps({'content': action_str})}\n\n"

                if not final_text:
                    yield f"data: {json.dumps({'error': 'Le modèle na pas fourni de réponse. Vérifiez votre configuration Ollama.'})}\n\n"
            
            # Save assistant response to DB
            if final_text:
                bot_msg = ChatMessage(session_id=id, role="assistant", content=_tools_meta + final_text)
                db.add(bot_msg)
                db.commit()
                _response_saved = True
                
            # Calculate final token usage — filter by compression point
            final_messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
            tools_tokens_final = estimate_tokens(json.dumps(TOOLS))
            used_tokens = estimate_tokens(sys_prompt) + tools_tokens_final + 500
            if session.compressed_context:
                used_tokens += estimate_tokens(session.compressed_context)
            if session.last_compressed_message_id:
                final_msgs_filtered = [m for m in final_messages if m.id > session.last_compressed_message_id]
            else:
                final_msgs_filtered = final_messages
            for m in final_msgs_filtered:
                used_tokens += estimate_tokens(m.content)
                
            yield f"data: {json.dumps({'token_usage': {'used': used_tokens, 'limit': cfg['num_ctx']}})}\n\n"
            
            if is_first_exchange:
                from app.database import SessionLocal
                import threading
                print(f"[Chat] Launching title generation thread for session {id}")
                threading.Thread(
                    target=generate_session_title,
                    args=(SessionLocal, id, req.content, cfg),
                    daemon=True
                ).start()
            
            yield "data: [DONE]\n\n"
            # If we reach here, the client received everything — no notification needed
            _done_sent = True
                
        except GeneratorExit:
            _client_disconnected = True
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            
        finally:
            # Safety net: if Ollama failed mid-stream and response wasn't saved, save what we have
            if final_text and not _response_saved and not _client_disconnected:
                try:
                    bot_msg = ChatMessage(session_id=id, role="assistant", content=_tools_meta + final_text)
                    db.add(bot_msg)
                    db.commit()
                    _response_saved = True
                    logger.info(f"[Chat] Saved partial AI response for session {id}")
                except Exception as save_err:
                    logger.error(f"[Chat] Failed to persist AI response: {save_err}")
            
            # If user left the page during generation, create notification now that response is saved
            if id in _notify_on_complete:
                _notify_on_complete.discard(id)
                if _response_saved:
                    try:
                        from app.models import Notification
                        logger.info(f"[Chat] Generation complete for session {id} — creating notification")
                        notif = Notification(
                            type="system",
                            title="Réponse IA disponible 💬",
                            content="Votre conseiller IA a terminé sa réponse. Retrouvez-la dans votre conversation.",
                            link_data=json.dumps({"session_id": id}),
                            is_read=False
                        )
                        db.add(notif)
                        db.commit()
                    except Exception as notif_err:
                        logger.error(f"[Chat] Failed to create completion notification: {notif_err}")
            _generating_sessions.discard(id)
        
    return StreamingResponse(generate_response(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})

@router.post("/sessions/{id}/regenerate")
async def regenerate_response(id: int, request: Request = None, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
        
    # Find last assistant message and delete it
    last_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.desc()).first()
    if last_msg and last_msg.role == "assistant":
        db.delete(last_msg)
        db.commit()
        
    # Get the last user message to feed to the send_message endpoint
    last_user_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id, ChatMessage.role == "user").order_by(ChatMessage.timestamp.desc()).first()
    if not last_user_msg:
        raise HTTPException(status_code=400, detail="Aucun message utilisateur à régénérer")
        
    # Call standard message logic by simulating a new send
    req = ChatSendMessage(content=last_user_msg.content)
    # Delete the user message from DB before re-sending so send_message doesn't duplicate it
    db.delete(last_user_msg)
    db.commit()
    
    return await send_message(id, req, request=request, db=db)

@router.put("/messages/{id}")
async def edit_message(id: int, req: ChatMessageUpdate, request: Request = None, db: Session = Depends(get_db)):
    message = db.query(ChatMessage).filter(ChatMessage.id == id).first()
    if not message or message.role != "user":
        raise HTTPException(status_code=400, detail="Seuls les messages utilisateur peuvent être édités")
        
    session_id = message.session_id
    
    # Delete all subsequent messages in the session
    subsequent = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.timestamp > message.timestamp
    ).all()
    for m in subsequent:
        db.delete(m)
        
    # Delete the edited message itself so send_message doesn't duplicate
    db.delete(message)
    db.commit()
    
    # Send the new edited content
    send_req = ChatSendMessage(content=req.content)
    return await send_message(session_id, send_req, request=request, db=db)

class AutoCatRequest(BaseModel):
    description: str
    amount: float = None

@router.post("/autocategorize")
async def autocategorize(req: AutoCatRequest, db: Session = Depends(get_db)):
    """Ask Ollama to suggest a category for a transaction, preferring existing ones."""
    ollama_url_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_url").first()
    ollama_model_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_model").first()

    if not ollama_url_conf or not ollama_url_conf.value or not ollama_model_conf or not ollama_model_conf.value:
        raise HTTPException(status_code=400, detail="Ollama non configuré.")

    url = ollama_url_conf.value.rstrip("/")
    model = ollama_model_conf.value
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    cat_list = ", ".join(f'"{c}"' for c in categories)

    amount_str = f" de {req.amount} €" if req.amount else ""
    prompt = f"""Tu es un assistant de catégorisation financière.
CATÉGORIES EXISTANTES : {cat_list}

Transaction : "{req.description}"{amount_str}

Réponds UNIQUEMENT avec le nom de la catégorie la plus appropriée, en privilégiant une catégorie existante.
Si aucune ne convient vraiment, propose un nom court (2-3 mots max).
Réponds avec SEULEMENT le nom, sans ponctuation, sans explication."""

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{url}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.1, "num_ctx": 512}
            })
            resp.raise_for_status()
            data = resp.json()
            suggested = data.get("message", {}).get("content", "").strip().strip('"').strip("'")
            return {"category": suggested, "existing_categories": categories}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

