"""
app/services/chat/chat_tools.py — Définitions et implémentations des 15 outils RAG et d'écriture financière pour Ollama.
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

def get_monthly_overview_tool(db: Session, year: int = None, month: int = None) -> dict:
    import calendar
    today = date.today()
    try:
        y = int(year) if year is not None else today.year
        m = int(month) if month is not None else today.month
    except (ValueError, TypeError):
        return {"error": "Invalid year or month format. Expected integers."}
        
    start_date = date(y, m, 1)
    end_date = date(y, m, calendar.monthrange(y, m)[1])
    
    budgets = get_budgets_status_tool(db, y, m)
    spending = get_spending_analytics_tool(db, start_date.isoformat(), end_date.isoformat())
    summary = get_financial_summary_tool(db)
    balances = get_balances_tool(db)
    
    return {
        "period": {"year": y, "month": m},
        "budget_status": budgets,
        "spending_analytics": spending,
        "financial_summary": summary,
        "account_balances": balances
    }

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
    from app.services.finance_engine import calculate_balances, get_main_account, predict_next_paycheck
    from app.models import RecurrenceTemplate, Transaction
    import statistics as _stats
    
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
    template_ids = {t.id for t in templates}

    # --- Unreconciled pending expenses (already entered, not yet debited) ---
    # These are KNOWN future outflows that the user has already planned/entered.
    # Ignoring them would make the projection overly optimistic vs the real RTL.
    from app.services.finance_engine import predict_next_paycheck as _predict_paycheck
    try:
        _pay_info = _predict_paycheck(db)
        _next_pay_date = _pay_info.get("date", end_date)
    except Exception:
        _next_pay_date = end_date

    pending_expenses = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation <= end_date,
        Transaction.from_account_id == account.id,
        Transaction.to_account_id.is_(None),  # Expense only (not transfers)
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).all()

    pending_transfers = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation <= end_date,
        Transaction.from_account_id == account.id,
        Transaction.to_account_id != None,  # Transfer out
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).all()

    # Build a date-indexed map of pending outflows for the simulation.
    # Exclude those linked to recurrence templates (they'll be projected via templates).
    from collections import defaultdict
    pending_by_date = defaultdict(float)
    pending_total = 0.0
    for t in pending_expenses + pending_transfers:
        if t.recurrence_id and t.recurrence_id in template_ids:
            continue  # Will be covered by the template projection — skip to avoid double count
        tx_date = t.date_operation if t.date_operation and t.date_operation > today else today
        # Cap to forecast window
        if tx_date > end_date:
            continue
        pending_by_date[tx_date.isoformat()] += t.amount
        pending_total += t.amount

    # Savings reservations (tirelire) — reserved funds that aren't available for spending
    from app.models import Budget, BudgetAllocation
    savings_reserved = 0.0
    savings_budgets = db.query(Budget).filter(
        Budget.envelope_type == "savings",
        Budget.is_closed == False
    ).all()
    for sb in savings_budgets:
        allocs = db.query(BudgetAllocation).filter(
            BudgetAllocation.budget_id == sb.id,
            (BudgetAllocation.account_id == account.id) | (BudgetAllocation.account_id == None)
        ).all()
        alloc_balance = sum(a.amount for a in allocs)
        txs = db.query(Transaction).filter(
            Transaction.budget_id == sb.id,
            (Transaction.from_account_id == account.id) | (Transaction.to_account_id == account.id),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()
        tx_income = sum(abs(t.amount) for t in txs if t.type == "income")
        tx_expenses = sum(abs(t.amount) for t in txs if t.type != "income")
        savings_reserved += (tx_income - tx_expenses) + alloc_balance
    savings_reserved = max(savings_reserved, 0)

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

    # --- Outlier detection (IQR + absolute + relative thresholds) ---
    # Exceptional one-time purchases (e.g. vehicle, major appliance) should NOT
    # be projected as daily recurring spending.  They are already reflected in
    # the current_balance (deducted once) but must not inflate daily_avg.
    excluded_outliers = []
    normal_var_txs = list(past_var_txs)

    if len(past_var_txs) >= 5:
        amounts = sorted([t.amount for t in past_var_txs])
        q1 = amounts[len(amounts) // 4]
        q3 = amounts[3 * len(amounts) // 4]
        iqr = q3 - q1
        upper_fence = q3 + 3.0 * iqr          # 3×IQR — very conservative
        median_amt = _stats.median(amounts)

        normal_var_txs = []
        for t in past_var_txs:
            # All three conditions must be met to classify as outlier:
            #  1. Exceeds statistical upper fence (3×IQR)
            #  2. Absolute amount > 500 € (small amounts are never outliers)
            #  3. Amount > 5× the median (truly exceptional relative to habits)
            is_outlier = (
                t.amount > upper_fence
                and t.amount > 500
                and t.amount > 5 * median_amt
            )
            if is_outlier:
                excluded_outliers.append({
                    "transaction_id": t.id,
                    "description": t.description,
                    "amount_euros": t.amount,
                    "date": t.date_operation.isoformat() if t.date_operation else None,
                    "category": t.category
                })
                logger.info(
                    f"[forecast] Outlier exclu de la projection : "
                    f"{t.description} — {t.amount} € "
                    f"(fence={upper_fence:.2f}, médiane={median_amt:.2f})"
                )
            else:
                normal_var_txs.append(t)

    total_var_spent_30d = sum(t.amount for t in normal_var_txs)
    daily_avg_var_spend = round(total_var_spent_30d / 30.0, 2)

    # Collect predicted paycheck(s) that fall within the forecast window.
    # This is critical: if the user's salary is NOT a RecurrenceTemplate, it would
    # otherwise be missing from the projection, causing a false "going negative" alert.
    projected_income_events = []
    try:
        paycheck = predict_next_paycheck(db)
        pay_date = paycheck.get("date")
        pay_amount = paycheck.get("amount", 0.0)
        if pay_amount and pay_amount > 0 and isinstance(pay_date, date):
            if today < pay_date <= end_date:
                projected_income_events.append({
                    "date": pay_date.isoformat(),
                    "amount_euros": pay_amount,
                    "source": "predicted_paycheck",
                    "logical_period": paycheck.get("logical_period", "")
                })
    except Exception:
        pass
    
    # Effective starting balance = reconciled - savings reservations
    # This is the conservative "spending budget" view.  Tirelires are virtual
    # envelopes on the SAME bank account — the money is physically there and
    # can be tapped in an emergency, preventing a real overdraft.
    effective_balance = round(current_balance - savings_reserved, 2)

    # Project chronologically day-by-day
    points = [{"date": today.isoformat(), "projected_balance_euros": effective_balance}]
    running_balance = effective_balance
    
    sim_date = today
    while sim_date < end_date:
        sim_date += timedelta(days=1)
        
        # Deduct daily average VARIABLE spend only
        running_balance -= daily_avg_var_spend

        # Deduct pending unreconciled expenses on their scheduled date
        date_key = sim_date.isoformat()
        if date_key in pending_by_date:
            running_balance -= pending_by_date[date_key]
        
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

        # Inject predicted paycheck on its expected date
        for income_event in projected_income_events:
            if income_event["date"] == sim_date.isoformat():
                running_balance += income_event["amount_euros"]
                    
        points.append({
            "date": sim_date.isoformat(),
            "projected_balance_euros": round(running_balance, 2)
        })
        
    income_note = (
        f"{len(projected_income_events)} salaire(s) prévu(s) inclus dans cette projection."
        if projected_income_events
        else "Aucun salaire prévu trouvé dans la fenêtre de projection. Si votre salaire n'est pas configuré comme récurrence, mettez à jour via set_predicted_paycheck."
    )

    outlier_note = ""
    if excluded_outliers:
        descs = ", ".join(
            f"{o['description']} ({o['amount_euros']} €)" for o in excluded_outliers
        )
        outlier_note = (
            f"{len(excluded_outliers)} dépense(s) exceptionnelle(s) détectée(s) et "
            f"exclue(s) de la moyenne quotidienne variable : {descs}. "
            f"Ces montants sont déjà déduits du solde actuel mais ne sont pas "
            f"projetés comme dépenses récurrentes futures."
        )

    return {
        "checking_account": account.name,
        "daily_average_variable_spend_euros": daily_avg_var_spend,
        "daily_average_note": "Variable spending only (non-recurring). Recurring charges applied separately via templates.",
        "forecast_days": days,
        "projected_income_events": projected_income_events,
        "income_note": income_note,
        "excluded_outliers": excluded_outliers,
        "outlier_note": outlier_note,
        "pending_unreconciled_expenses_euros": round(pending_total, 2),
        "savings_reserved_euros": round(savings_reserved, 2),
        "savings_safety_buffer_euros": round(savings_reserved, 2),
        "savings_safety_note": (
            "Les tirelires sont des enveloppes virtuelles sur le même compte courant. "
            "Les fonds sont physiquement disponibles et peuvent être utilisés en cas "
            "de dépassement du reste à vivre pour éviter un découvert réel. "
            "Le découvert bancaire réel ne survient que si le solde total du compte "
            "(incluant les fonds tirelires) devient négatif."
        ) if savings_reserved > 0 else "",
        "effective_starting_balance_euros": effective_balance,
        "real_overdraft_threshold_euros": round(-savings_reserved, 2) if savings_reserved > 0 else 0.0,
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
            "description": "Get aggregated raw spending and income statistics for a specific period, grouped by category and transaction type. Do NOT use this tool for tracking budget envelope limits or remaining budget envelope balances — use get_budgets_status for that.",
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
            "description": "Get consumption progress and remaining balances of all budget envelopes and savings for a specific year and month. Use this to check if envelopes are overspent or how much budget is left, NOT for raw spending reports.",
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
            "description": "Forecast account balances and left-to-live trend over next 30, 60, or 90 days. This simulation ALREADY automatically includes future recurring templates and predicted paychecks (salaries/income). Do NOT assume future income is missing from the forecast results.",
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
            "name": "get_monthly_overview",
            "description": "Get a comprehensive monthly overview including budget envelopes status, category spending statistics, rest-to-live details, next paycheck predictions, and account balances in one single tool call. Use this as a starting point when the user asks about their monthly budget status or overall financial situation.",
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
    },
    {
        "type": "function",
        "function": {
            "name": "store_financial_fact",
            "description": "Store a persistent financial fact about the user (e.g., rent amount, financial goals, recurring events) to the memory database. Set private_to_session to true if the fact should only be remembered within this chat session, or false if it should be remembered globally across all conversations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Unique technical key for the fact (e.g. 'monthly_rent_euros', 'savings_goal_euros')."},
                    "value": {"type": "string", "description": "The fact value (could be a number, short text, or JSON string)."},
                    "private_to_session": {"type": "boolean", "description": "If true, this fact is isolated to this conversation. If false, it is shared across all conversations. Default is false."}
                },
                "required": ["key", "value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "forget_financial_fact",
            "description": "Delete a persistent financial fact about the user from the memory database. Key and private_to_session must match the parameters used when storing.",
            "parameters": {
                "type": "object",
                "properties": {
                    "key": {"type": "string", "description": "Technical key of the fact to delete."},
                    "private_to_session": {"type": "boolean", "description": "Must match the visibility setting used when storing. Default is false."}
                },
                "required": ["key"]
            }
        }
    }
]

