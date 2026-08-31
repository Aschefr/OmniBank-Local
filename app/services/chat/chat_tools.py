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
    from datetime import date, timedelta
    from app.models import Transaction, BudgetCategory
    today = date.today()
    try:
        y = int(year) if year is not None else today.year
        m = int(month) if month is not None else today.month
    except (ValueError, TypeError):
        return {"error": "Invalid year or month format. Expected integers."}
    
    status_data = get_budget_status(year=y, month=m, db=db)
    
    # Pre-calculate 3-month and 6-month historical spending by budget envelope and categories
    three_months_ago = today - timedelta(days=90)
    six_months_ago = today - timedelta(days=180)
    
    past_txs_6m = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.date_operation <= today,
        Transaction.type.in_(("expense_var", "expense_fixed")),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).all()
    
    # Map category names to budget ids
    budget_cats = db.query(BudgetCategory).all()
    cat_to_budget = {bc.category_name.strip().lower(): bc.budget_id for bc in budget_cats if bc.category_name}
    
    # Accumulate spending per budget
    spent_by_b_3m = defaultdict(float)
    spent_by_b_6m = defaultdict(float)
    for t in past_txs_6m:
        b_id = t.budget_id
        if not b_id and t.category:
            b_id = cat_to_budget.get(t.category.strip().lower())
        if b_id:
            spent_by_b_6m[b_id] += t.amount
            if t.date_operation >= three_months_ago:
                spent_by_b_3m[b_id] += t.amount

    envelopes = []
    total_budgeted = 0.0
    total_spent_committed = 0.0
    total_spent_reconciled = 0.0
    total_income = 0.0

    for b in status_data.get("budgets", []):
        b_id = b.get("id")
        total_budgeted += b.get("budget_amount", 0.0)
        total_spent_committed += b.get("expenses", 0.0)
        total_spent_reconciled += b.get("reconciled_expenses", 0.0)
        total_income += b.get("income", 0.0)

        avg_3m = round(spent_by_b_3m.get(b_id, 0.0) / 3.0, 2) if b_id else 0.0
        avg_6m = round(spent_by_b_6m.get(b_id, 0.0) / 6.0, 2) if b_id else 0.0

        envelopes.append({
            "id": b_id,
            "name": b.get("name"),
            "type": b.get("envelope_type", "spending"),
            "period": b.get("period", "monthly"),
            "limit": b.get("budget_amount", 0.0),
            "spent": b.get("expenses", 0.0),
            "remaining": b.get("balance", 0.0),
            "percent": b.get("percent", 0.0),
            "historical_monthly_avg_spent_3m": avg_3m,
            "historical_monthly_avg_spent_6m": avg_6m
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

    # Calculate suggested 50/30/20 reference if history is insufficient
    total_avg_6m = sum(b["historical_monthly_avg_spent_6m"] for b in envelopes)
    from app.services.finance_engine import predict_next_paycheck
    try:
        paycheck = predict_next_paycheck(db)
        salary = paycheck.get("amount", 0.0) if paycheck else 0.0
    except Exception:
        salary = 0.0
        
    reference_guidance = None
    if total_avg_6m < 50.0 and salary > 0:
        reference_guidance = {
            "basis": "prudential_rule_50_30_20",
            "monthly_income_reference_euros": salary,
            "recommended_needs_50pct_euros": round(salary * 0.50, 2),
            "recommended_wants_30pct_euros": round(salary * 0.30, 2),
            "recommended_savings_20pct_euros": round(salary * 0.20, 2),
            "note": "Historique réel récent insuffisant. Étalonnage standard 50/30/20 proposé à titre indicatif."
        }

    return {
        "year": y,
        "month": m,
        "summary": summary,
        "budgets": envelopes,
        "reference_guidance": reference_guidance
    }

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

def calculate_daily_variable_spending_rate(db: Session, account_id: int, today: date, horizon_days: int = 90) -> dict:
    """
    Calcule le rythme de dépenses variables quotidien via une cascade intelligente à 3 niveaux :
    1. Historique réel des dépenses variables sur les 90 derniers jours (avec filtrage IQR des outliers).
    2. Fallback Enveloppes Budgétaires : somme mensuelle des enveloppes 'spending' / 30.416.
    3. Fallback Prudentiel Salaire (Cold Start Total) : 35% du salaire net prévu / 30.416.
    """
    from datetime import timedelta
    from app.models import Transaction, Budget
    from app.services.finance_engine import predict_next_paycheck
    import statistics as _stats
    
    ninety_days_ago = today - timedelta(days=90)
    
    # 1. Vérifier l'historique réel des dépenses variables hors récurrences
    past_var_txs = db.query(Transaction).filter(
        Transaction.from_account_id == account_id,
        Transaction.to_account_id.is_(None),
        Transaction.type == "expense_var",
        Transaction.date_operation >= ninety_days_ago,
        Transaction.date_operation <= today,
        Transaction.recurrence_id.is_(None),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).all()
    
    excluded_outliers = []
    normal_var_txs = list(past_var_txs)
    
    if len(past_var_txs) >= 5:
        amounts = sorted([t.amount for t in past_var_txs])
        q1 = amounts[len(amounts) // 4]
        q3 = amounts[3 * len(amounts) // 4]
        iqr = q3 - q1
        upper_fence = q3 + 3.0 * iqr
        median_amt = _stats.median(amounts)
        
        normal_var_txs = []
        for t in past_var_txs:
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
            else:
                normal_var_txs.append(t)
                
    # Calculer l'emprise temporelle observée
    valid_dates = [t.date_operation for t in past_var_txs if t.date_operation]
    min_date = min(valid_dates, default=today)
    observed_days = max(1, (today - min_date).days + 1)
    total_var_spent = sum(t.amount for t in normal_var_txs)
    
    # ── ÉTAGE 1 : Historique réel suffisant (>= 15 jours d'activité observée) ──
    if observed_days >= 15 and len(normal_var_txs) >= 3 and total_var_spent > 0:
        denominator_days = min(90.0, float(observed_days))
        daily_rate = round(total_var_spent / denominator_days, 2)
        return {
            "daily_rate_euros": daily_rate,
            "monthly_equivalent_euros": round(daily_rate * 30.416, 2),
            "source_mode": "historical_real",
            "source_label": f"Moyenne réelle constatée ({daily_rate:.2f} €/j sur {int(denominator_days)} jours observés)",
            "observed_days": int(denominator_days),
            "excluded_outliers": excluded_outliers
        }
        
    # ── ÉTAGE 2 : Fallback Enveloppes Budgétaires Actives ──
    active_spending_budgets = db.query(Budget).filter(
        Budget.envelope_type == "spending",
        Budget.is_closed == False
    ).all()
    total_budget_limit = sum(b.monthly_amount for b in active_spending_budgets if b.monthly_amount)
    
    if total_budget_limit > 0:
        daily_rate = round(total_budget_limit / 30.416, 2)
        return {
            "daily_rate_euros": daily_rate,
            "monthly_equivalent_euros": round(total_budget_limit, 2),
            "source_mode": "budget_envelopes",
            "source_label": f"Enveloppes budgétaires actives ({total_budget_limit:.2f} €/mois = {daily_rate:.2f} €/j)",
            "observed_days": 0,
            "excluded_outliers": []
        }
        
    # ── ÉTAGE 3 : Fallback Ratio Prudentiel Salaire (Cold Start Total) ──
    from app.models import GlobalConfig, RecurrenceTemplate
    salary_amount = 0.0
    try:
        paycheck = predict_next_paycheck(db)
        if paycheck and paycheck.get("amount"):
            salary_amount = float(paycheck.get("amount") or 0.0)
    except Exception:
        salary_amount = 0.0
        
    if not salary_amount or salary_amount <= 0:
        conf_sal = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
        if conf_sal and conf_sal.value:
            try:
                salary_amount = float(conf_sal.value)
            except Exception:
                pass
                
    if not salary_amount or salary_amount <= 0:
        inc_tpl = db.query(RecurrenceTemplate).filter(
            RecurrenceTemplate.type == "income",
            RecurrenceTemplate.is_closed == False
        ).first()
        if inc_tpl and inc_tpl.amount:
            salary_amount = float(inc_tpl.amount)
        
    if salary_amount and salary_amount > 0:
        # Ratio standard de dépenses de vie : 35% du revenu net
        monthly_prudential = round(salary_amount * 0.35, 2)
        daily_rate = round(monthly_prudential / 30.416, 2)
        return {
            "daily_rate_euros": daily_rate,
            "monthly_equivalent_euros": monthly_prudential,
            "source_mode": "prudential_salary_ratio",
            "source_label": f"Estimation prudentielle standard (35% du salaire net = {monthly_prudential:.2f} €/mois, soit {daily_rate:.2f} €/j)",
            "observed_days": 0,
            "excluded_outliers": []
        }
        
    return {
        "daily_rate_euros": 0.0,
        "monthly_equivalent_euros": 0.0,
        "source_mode": "none",
        "source_label": "Aucun historique ni budget disponible (0.00 €/j)",
        "observed_days": 0,
        "excluded_outliers": []
    }

def forecast_balances_history_tool(db: Session, days: int = 30) -> dict:
    from datetime import date, timedelta
    import calendar
    from app.services.finance_engine import calculate_balances, get_main_account, predict_next_paycheck, get_liquid_net_worth
    from app.models import RecurrenceTemplate, Transaction, Budget, BudgetAllocation
    from collections import defaultdict
    
    try:
        days = int(days)
    except Exception:
        days = 30
        
    today = date.today()
    end_date = today + timedelta(days=days)
    
    account = get_main_account(db)
    if not account:
        return {"error": "No checking account found"}
        
    # Current reconciled balance
    balances = calculate_balances(db, only_reconciled=True)
    current_balance = balances.get(account.id, 0.0)
    
    # Liquid net worth across all accounts (savings cushion)
    liquid_total, _ = get_liquid_net_worth(db, only_reconciled=True, precomputed_balances=balances)
    
    # Load all active recurrence templates
    templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
    template_ids = {t.id for t in templates}

    # --- Next predicted paycheck and multi-cycle salary projection ---
    projected_income_events = []
    paycheck_info = None
    next_pay_date = None
    try:
        paycheck_info = predict_next_paycheck(db)
        first_pay_date = paycheck_info.get("date")
        pay_amount = paycheck_info.get("amount", 0.0)
        next_pay_date = first_pay_date
        
        # Check if there is already an active income template for salary
        has_salary_template = any(
            t.type == "income" and t.amount > 500
            for t in templates
        )
        
        if pay_amount and pay_amount > 0 and isinstance(first_pay_date, date) and not has_salary_template:
            cur_pay_date = first_pay_date
            while cur_pay_date <= end_date:
                if cur_pay_date > today:
                    projected_income_events.append({
                        "date": cur_pay_date.isoformat(),
                        "amount_euros": pay_amount,
                        "source": "predicted_paycheck",
                        "logical_period": f"{cur_pay_date.year:04d}-{cur_pay_date.month:02d}"
                    })
                # Advance to next month's pay date (same day of month)
                target_month = cur_pay_date.month + 1
                target_year = cur_pay_date.year
                if target_month > 12:
                    target_month = 1
                    target_year += 1
                
                day_target = first_pay_date.day
                max_days = calendar.monthrange(target_year, target_month)[1]
                cur_pay_date = date(target_year, target_month, min(day_target, max_days))
    except Exception as e:
        logger.warning(f"[forecast] Error projecting multi-month paychecks: {e}")

    # --- Unreconciled pending expenses (already entered by user for current cycle) ---
    pending_expenses = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation <= end_date,
        Transaction.from_account_id == account.id,
        Transaction.to_account_id.is_(None),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).all()

    pending_transfers = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation <= end_date,
        Transaction.from_account_id == account.id,
        Transaction.to_account_id != None,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).all()

    pending_by_date = defaultdict(float)
    pending_total = 0.0
    for t in pending_expenses + pending_transfers:
        if t.recurrence_id and t.recurrence_id in template_ids:
            continue  # Covered by recurrence template
        tx_date = t.date_operation if t.date_operation and t.date_operation > today else today
        if tx_date > end_date:
            continue
        pending_by_date[tx_date.isoformat()] += t.amount
        pending_total += t.amount

    # Savings reservations (tirelires)
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
    savings_reserved = max(savings_reserved, 0.0)

    # Calculate daily average VARIABLE spending via Intelligent Cascade
    spending_rate_info = calculate_daily_variable_spending_rate(db, account.id, today, horizon_days=days)
    daily_avg_var_spend = spending_rate_info["daily_rate_euros"]
    excluded_outliers = spending_rate_info.get("excluded_outliers", [])
    data_source_mode = spending_rate_info["source_mode"]
    data_source_note = spending_rate_info["source_label"]

    # Date cutoff: planned expenses cover the period until next paycheck
    cycle_cutoff_date = next_pay_date if isinstance(next_pay_date, date) else today

    # Effective starting balance
    effective_balance = round(current_balance - savings_reserved, 2)

    # Project chronologically day-by-day
    points = [{"date": today.isoformat(), "projected_balance_euros": effective_balance, "real_bank_balance_euros": current_balance}]
    running_balance = effective_balance
    running_bank_balance = current_balance

    monthly_breakdown = defaultdict(lambda: {
        "projected_income": 0.0,
        "fixed_expenses": 0.0,
        "variable_expenses": 0.0,
        "end_balance": 0.0,
        "end_real_bank_balance": 0.0
    })

    sim_date = today
    while sim_date < end_date:
        sim_date += timedelta(days=1)
        month_key = f"{sim_date.year:04d}-{sim_date.month:02d}"
        
        # 1. Variable expenses:
        # - Current cycle: deduct real planned expenses on their scheduled dates.
        # - Future cycles (or dates without scheduled entries): apply estimated daily variable spend.
        date_key = sim_date.isoformat()
        has_pending = date_key in pending_by_date
        
        if has_pending:
            day_var = pending_by_date[date_key]
            running_balance -= day_var
            running_bank_balance -= day_var
            monthly_breakdown[month_key]["variable_expenses"] += day_var
        elif sim_date > cycle_cutoff_date:
            running_balance -= daily_avg_var_spend
            running_bank_balance -= daily_avg_var_spend
            monthly_breakdown[month_key]["variable_expenses"] += daily_avg_var_spend
        
        # 2. Recurrence templates
        for t in templates:
            freq = (t.frequency or "Monthly").strip().lower()
            applies = False
            dom = t.day_of_month or 1
            
            if freq in ("monthly", "mensuel", "mensuelle"):
                max_d = calendar.monthrange(sim_date.year, sim_date.month)[1]
                if sim_date.day == min(dom, max_d):
                    applies = True
            elif freq in ("weekly", "hebdomadaire", "hebdo"):
                if sim_date.weekday() == (dom % 7):
                    applies = True
            elif freq in ("bi-weekly", "biweekly", "bimensuel", "bimensuelle"):
                if sim_date.weekday() == (dom % 7) and (sim_date.isocalendar()[1] % 2 == 0):
                    applies = True
            elif freq in ("bi-monthly", "bimonthly", "bimestriel", "bimestrielle"):
                max_d = calendar.monthrange(sim_date.year, sim_date.month)[1]
                if sim_date.day == min(dom, max_d) and (sim_date.month % 2 == 0):
                    applies = True
            elif freq in ("quarterly", "trimestriel", "trimestrielle"):
                max_d = calendar.monthrange(sim_date.year, sim_date.month)[1]
                if sim_date.day == min(dom, max_d) and ((sim_date.month - 1) % 3 == 0):
                    applies = True
            elif freq in ("semi-annually", "semiannual", "semestriel", "semestrielle"):
                max_d = calendar.monthrange(sim_date.year, sim_date.month)[1]
                if sim_date.day == min(dom, max_d) and ((sim_date.month - 1) % 6 == 0):
                    applies = True
            elif freq in ("yearly", "annuel", "annuelle", "annual"):
                month_target = getattr(t, "month_of_year", None) or 1
                max_d = calendar.monthrange(sim_date.year, sim_date.month)[1]
                if sim_date.month == month_target and sim_date.day == min(dom, max_d):
                    applies = True
                    
            if applies:
                if t.type == "income":
                    running_balance += t.amount
                    running_bank_balance += t.amount
                    monthly_breakdown[month_key]["projected_income"] += t.amount
                elif t.from_account_id == account.id and t.type in ("expense_fixed", "expense_var"):
                    running_balance -= t.amount
                    running_bank_balance -= t.amount
                    monthly_breakdown[month_key]["fixed_expenses"] += t.amount

        # 3. Projected paychecks
        for income_event in projected_income_events:
            if income_event["date"] == sim_date.isoformat():
                running_balance += income_event["amount_euros"]
                running_bank_balance += income_event["amount_euros"]
                monthly_breakdown[month_key]["projected_income"] += income_event["amount_euros"]

        monthly_breakdown[month_key]["end_balance"] = round(running_balance, 2)
        monthly_breakdown[month_key]["end_real_bank_balance"] = round(running_bank_balance, 2)
        
        points.append({
            "date": sim_date.isoformat(),
            "projected_balance_euros": round(running_balance, 2),
            "real_bank_balance_euros": round(running_bank_balance, 2)
        })

    # Format monthly breakdown for AI interpretation
    breakdown_list = [
        {
            "period": k,
            "projected_income_euros": round(v["projected_income"], 2),
            "fixed_expenses_euros": round(v["fixed_expenses"], 2),
            "variable_expenses_euros": round(v["variable_expenses"], 2),
            "projected_end_balance_euros": round(v["end_balance"], 2),
            "projected_real_bank_balance_euros": round(v["end_real_bank_balance"], 2)
        }
        for k, v in sorted(monthly_breakdown.items())
    ]

    income_note = (
        f"{len(projected_income_events)} salaire(s) prévu(s) projeté(s) sur les cycles mensuels de l'horizon."
        if projected_income_events
        else "Revenus basés sur les modèles de récurrence enregistrés."
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
        "total_liquid_savings_cushion_euros": round(liquid_total, 2),
        "daily_average_variable_spend_euros": daily_avg_var_spend,
        "daily_average_source_mode": data_source_mode,
        "daily_average_source_note": data_source_note,
        "daily_average_note": "Variable spending rate applied on dates not covered by planned transactions.",
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
            "Les fonds sont physiquement disponibles et évitent un découvert bancaire réel."
        ) if savings_reserved > 0 else "",
        "effective_starting_balance_euros": effective_balance,
        "real_bank_starting_balance_euros": current_balance,
        "real_overdraft_threshold_euros": round(-savings_reserved, 2) if savings_reserved > 0 else 0.0,
        "monthly_breakdown": breakdown_list,
        "history": points
    }

def detect_anomalies_and_subscriptions_tool(db: Session) -> dict:
    from app.models import Transaction, Account, RecurrenceTemplate
    from datetime import date, timedelta
    from collections import defaultdict
    import statistics
    from app.services.finance_engine import get_overdraft_warning
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    thirty_days_ago = today - timedelta(days=30)
    
    accounts_map = {a.id: a.name for a in db.query(Account).all()}
    active_templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
    template_descs = {t.description.strip().lower() for t in active_templates if t.description}
    
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.date_operation <= today,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).order_by(Transaction.date_operation.desc(), Transaction.id.desc()).all()
    
    # 1. Subscription & Price Increase Detection
    candidates = defaultdict(list)
    for t in txs:
        if t.type in ("expense_var", "expense_fixed") and t.amount > 3.0:
            candidates[t.description.strip().lower()].append(t)
            
    detected_subs = []
    price_increases = []
    unregistered_subs = []
    
    for desc, items in candidates.items():
        if len(items) >= 3:
            amounts = [i.amount for i in items]
            dates = sorted([i.date_operation for i in items])
            intervals = [(dates[idx] - dates[idx-1]).days for idx in range(1, len(dates))]
            avg_interval = statistics.mean(intervals) if intervals else 0
            
            if 24 <= avg_interval <= 36: # Monthly pattern
                acc_name = accounts_map.get(items[0].from_account_id or items[0].to_account_id, "Compte courant")
                recent_amt = items[0].amount
                sub_entry = {
                    "description": items[0].description,
                    "amount_euros": recent_amt,
                    "annual_cost_euros": round(recent_amt * 12, 2),
                    "account_name": acc_name,
                    "interval_days": round(avg_interval, 1),
                    "frequency": "Monthly",
                    "charges_count_6m": len(items)
                }
                detected_subs.append(sub_entry)
                
                # Check for price increases (compare most recent vs older charges)
                older_amounts = [it.amount for it in items[1:]]
                min_old = min(older_amounts)
                if recent_amt > min_old * 1.05 and (recent_amt - min_old) >= 1.0:
                    delta = round(recent_amt - min_old, 2)
                    pct = round((delta / min_old) * 100, 1)
                    price_increases.append({
                        "description": items[0].description,
                        "old_amount_euros": min_old,
                        "new_amount_euros": recent_amt,
                        "increase_euros": delta,
                        "increase_percent": f"+{pct}%",
                        "account_name": acc_name
                    })
                    
                # Check if unregistered in recurrence templates
                if desc not in template_descs and not any(desc in td or td in desc for td in template_descs):
                    unregistered_subs.append(sub_entry)

    # 2. Recent Spending Spikes (outliers vs category median OR budget envelope ratio)
    from app.models import Budget, BudgetCategory
    budget_cats = db.query(BudgetCategory).all()
    cat_to_budget_obj = {}
    for bc in budget_cats:
        if bc.category_name and bc.budget_id:
            b_obj = db.query(Budget).filter(Budget.id == bc.budget_id, Budget.is_closed == False).first()
            if b_obj:
                cat_to_budget_obj[bc.category_name.strip().lower()] = b_obj

    recent_txs = [t for t in txs if t.date_operation >= thirty_days_ago and t.type in ("expense_var", "expense_fixed")]
    by_cat = defaultdict(list)
    for t in txs:
        if t.category and t.type in ("expense_var", "expense_fixed"):
            by_cat[t.category.strip().lower()].append(t.amount)
            
    recent_spikes = []
    for t in recent_txs:
        cat_key = (t.category or "").strip().lower()
        cat_amounts = by_cat.get(cat_key, [])
        is_spike = False
        spike_detail = {}
        
        # Method A: Historical statistical outlier (>= 5 charges)
        if len(cat_amounts) >= 5 and t.amount > 50.0:
            cat_med = statistics.median(cat_amounts)
            if t.amount > max(cat_med * 3.0, 100.0):
                is_spike = True
                spike_detail = {
                    "detection_basis": "historical_median_outlier",
                    "category_median_euros": round(cat_med, 2),
                    "note": f"Dépense > 3x la médiane habituelle ({cat_med:.2f} €) de la catégorie."
                }
        # Method B: Fallback on Budget Envelope (Cold start / few transactions)
        elif cat_key in cat_to_budget_obj and t.amount >= 50.0:
            b_obj = cat_to_budget_obj[cat_key]
            b_limit = b_obj.monthly_amount or 0.0
            if b_limit > 0 and t.amount >= (0.40 * b_limit):
                pct_env = round((t.amount / b_limit) * 100, 1)
                is_spike = True
                spike_detail = {
                    "detection_basis": "budget_envelope_consumption",
                    "envelope_name": b_obj.name,
                    "envelope_monthly_limit_euros": b_limit,
                    "consumed_envelope_percent": f"{pct_env}%",
                    "note": f"Achat isolé consommant {pct_env}% de l'enveloppe mensuelle '{b_obj.name}'."
                }
                
        if is_spike:
            spike_data = {
                "transaction_id": t.id,
                "date": t.date_operation.isoformat() if t.date_operation else None,
                "description": t.description,
                "amount_euros": t.amount,
                "category": t.category,
            }
            spike_data.update(spike_detail)
            recent_spikes.append(spike_data)

    # 3. Overdraft Warning from Engine
    overdraft_info = None
    try:
        od = get_overdraft_warning(db)
        if od:
            overdraft_info = {
                "will_overdraft": True,
                "projected_date": od["date"].isoformat() if isinstance(od["date"], date) else str(od["date"]),
                "transaction_description": od["transaction_description"],
                "transaction_amount_euros": od["transaction_amount"],
                "projected_negative_balance_euros": od["projected_balance"],
                "transaction_id": od.get("transaction_id")
            }
    except Exception as e:
        logger.warning(f"[detect_anomalies] Error calculating overdraft warning: {e}")

    # 4. Duplicate detection with accounting & bank reconciliation awareness
    duplicates = []
    seen = {}
    for t in txs:
        if t.type in ("expense_var", "expense_fixed"):
            acc_id = t.from_account_id or t.to_account_id
            acc_name = accounts_map.get(acc_id, "Compte courant")
            is_rec = t.reconciliation_date is not None
            key = (acc_id, t.date_operation, t.description.strip().lower(), round(t.amount, 2))
            
            if key in seen:
                orig = seen[key]
                orig_rec = orig.reconciliation_date is not None
                
                if orig_rec and is_rec:
                    continue
                
                if not orig_rec and is_rec:
                    rec_status = "one_unreconciled_phantom_one_bank"
                    target_delete_id = orig.id
                    accounting_advice = (
                        f"Saisie manuelle/prévisionnelle #{orig.id} en doublon avec l'opération bancaire réelle #{t.id} sur {acc_name}. "
                        f"La suppression de la saisie manuelle #{orig.id} nettoiera le doublon sans impacter le solde bancaire officiel."
                    )
                elif orig_rec and not is_rec:
                    rec_status = "one_bank_one_unreconciled_phantom"
                    target_delete_id = t.id
                    accounting_advice = (
                        f"Saisie manuelle/prévisionnelle #{t.id} en doublon avec l'opération bancaire réelle #{orig.id} sur {acc_name}. "
                        f"La suppression de la saisie manuelle #{t.id} nettoiera le doublon sans impacter le solde bancaire officiel."
                    )
                else:
                    rec_status = "both_unreconciled"
                    target_delete_id = t.id
                    accounting_advice = (
                        f"Deux saisies manuelles ou prévisionnelles non rapprochées sur {acc_name}. "
                        f"La suppression de l'une d'elles (#{t.id}) est sûre et évite un double décompte prévisionnel."
                    )
                
                duplicates.append({
                    "original_transaction_id": orig.id,
                    "original_date": orig.date_operation.isoformat(),
                    "original_is_reconciled": orig_rec,
                    "duplicate_transaction_id": t.id,
                    "duplicate_date": t.date_operation.isoformat(),
                    "duplicate_is_reconciled": is_rec,
                    "target_unreconciled_id_to_delete": target_delete_id,
                    "account_name": acc_name,
                    "description": t.description,
                    "amount_euros": t.amount,
                    "reconciliation_status": rec_status,
                    "accounting_advice": accounting_advice
                })
            else:
                seen[key] = t
                
    return {
        "overdraft_warning": overdraft_info,
        "detected_subscriptions": detected_subs,
        "price_increases_detected": price_increases,
        "unregistered_subscriptions": unregistered_subs,
        "recent_spending_spikes": recent_spikes[:5],
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
    from app.models import Transaction, RecurrenceTemplate, Budget
    from datetime import date, timedelta
    from app.services.finance_engine import predict_next_paycheck
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.date_operation <= today,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).all()
    
    total_income = sum(t.amount for t in txs if t.type == "income")
    total_fixed = sum(t.amount for t in txs if t.type == "expense_fixed")
    total_var = sum(t.amount for t in txs if t.type == "expense_var")
    
    monthly_income = round(total_income / 6.0, 2)
    monthly_fixed = round(total_fixed / 6.0, 2)
    monthly_var = round(total_var / 6.0, 2)
    
    # ── CASCADE INTELLIGENTE SI HISTORIQUE INSUFFISANT ──
    data_mode = "historical_6m"
    if monthly_income < 100.0:
        sal = 0.0
        try:
            paycheck = predict_next_paycheck(db)
            if paycheck and paycheck.get("amount"):
                sal = float(paycheck.get("amount") or 0.0)
        except Exception:
            sal = 0.0
            
        if not sal or sal <= 0:
            from app.models import GlobalConfig
            conf_sal = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
            if conf_sal and conf_sal.value:
                try:
                    sal = float(conf_sal.value)
                except Exception:
                    pass
                    
        if not sal or sal <= 0:
            inc_tpl = db.query(RecurrenceTemplate).filter(
                RecurrenceTemplate.type == "income",
                RecurrenceTemplate.is_closed == False
            ).first()
            if inc_tpl and inc_tpl.amount:
                sal = float(inc_tpl.amount)
            
        if sal > 0:
            monthly_income = sal
            # Fixed charges from templates
            active_tpls = db.query(RecurrenceTemplate).filter(
                RecurrenceTemplate.is_closed == False,
                RecurrenceTemplate.type.in_(("expense_fixed", "expense_var"))
            ).all()
            monthly_fixed = round(sum(t.amount for t in active_tpls), 2)
            
            # Variable expenses from active budgets
            active_budgets = db.query(Budget).filter(
                Budget.envelope_type == "spending",
                Budget.is_closed == False
            ).all()
            total_b = sum(b.monthly_amount for b in active_budgets if b.monthly_amount)
            if total_b > 0:
                monthly_var = round(total_b, 2)
                data_mode = "projected_envelopes_and_templates"
            else:
                monthly_var = round(sal * 0.35, 2)
                data_mode = "projected_prudential_ratio"
                
    savings = round(monthly_income - monthly_fixed - monthly_var, 2)
    
    # 50/30/20 standard percentages
    needs_pct = round((monthly_fixed / monthly_income * 100) if monthly_income > 0 else 0, 1)
    wants_pct = round((monthly_var / monthly_income * 100) if monthly_income > 0 else 0, 1)
    savings_pct = round((savings / monthly_income * 100) if monthly_income > 0 else 0, 1)
    
    return {
        "data_source_mode": data_mode,
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
        "target_50_30_20_benchmarks": {
            "target_needs_50pct_euros": round(monthly_income * 0.50, 2),
            "target_wants_30pct_euros": round(monthly_income * 0.30, 2),
            "target_savings_20pct_euros": round(monthly_income * 0.20, 2)
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
    from app.models import Budget, BudgetAllocation, Transaction
    from datetime import date
    
    today = date.today()
    paycheck = predict_next_paycheck(db)
    next_pay_date = paycheck["date"]
    
    rest_to_live = calculate_rest_to_live(db, today, next_pay_date)

    days_until_paycheck = 30
    if isinstance(next_pay_date, date):
        days_until_paycheck = max(1, (next_pay_date - today).days)
    daily_budget = round(rest_to_live / days_until_paycheck, 2) if rest_to_live > 0 else 0.0

    # Savings buffer
    savings_budgets = db.query(Budget).filter(Budget.envelope_type == "savings", Budget.is_closed == False).all()
    savings_total = 0.0
    for sb in savings_budgets:
        allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == sb.id).all()
        alloc_bal = sum(a.amount for a in allocs)
        txs = db.query(Transaction).filter(
            Transaction.budget_id == sb.id,
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()
        tx_inc = sum(abs(t.amount) for t in txs if t.type == "income")
        tx_exp = sum(abs(t.amount) for t in txs if t.type != "income")
        savings_total += max((tx_inc - tx_exp) + alloc_bal, 0.0)
    
    return {
        "current_rest_to_live_euros": rest_to_live,
        "daily_budget_available_euros": daily_budget,
        "days_until_next_paycheck": days_until_paycheck,
        "savings_safety_buffer_euros": round(savings_total, 2),
        "next_predicted_paycheck": {
            "date": next_pay_date.isoformat() if isinstance(next_pay_date, date) else str(next_pay_date),
            "amount": paycheck["amount"],
            "is_override": paycheck["is_override"],
            "logical_period": paycheck["logical_period"]
        }
    }

def get_spending_trends_tool(db: Session) -> dict:
    """
    Computes multi-month historical spending averages (3, 6, 12 months), savings rates,
    and identifies categories with significant spending changes (+/- X%).
    """
    from datetime import date, timedelta
    from collections import defaultdict
    from app.models import Transaction

    today = date.today()

    def _calc_period(days: int, months_count: float):
        start = today - timedelta(days=days)
        txs = db.query(Transaction).filter(
            Transaction.date_operation >= start,
            Transaction.date_operation <= today,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()
        inc = sum(t.amount for t in txs if t.type == "income")
        fixed = sum(t.amount for t in txs if t.type == "expense_fixed")
        var = sum(t.amount for t in txs if t.type == "expense_var")
        tot_exp = fixed + var
        sav = inc - tot_exp
        rate = round((sav / inc * 100), 1) if inc > 0 else 0.0
        
        # Category breakdown
        by_cat = defaultdict(float)
        for t in txs:
            if t.type in ("expense_var", "expense_fixed"):
                cname = t.category or "Sans catégorie"
                by_cat[cname] += t.amount

        return {
            "monthly_avg_income": round(inc / months_count, 2),
            "monthly_avg_fixed_expenses": round(fixed / months_count, 2),
            "monthly_avg_variable_expenses": round(var / months_count, 2),
            "monthly_avg_total_expenses": round(tot_exp / months_count, 2),
            "monthly_avg_net_savings": round(sav / months_count, 2),
            "savings_rate_percent": rate,
            "category_monthly_averages": {k: round(v / months_count, 2) for k, v in by_cat.items()}
        }

    p3m = _calc_period(90, 3.0)
    p6m = _calc_period(180, 6.0)
    p12m = _calc_period(365, 12.0)

    # Detect category shifts between 3m and 6m
    cats_3m = p3m["category_monthly_averages"]
    cats_6m = p6m["category_monthly_averages"]
    
    growing_categories = []
    shrinking_categories = []

    all_cats = set(cats_3m.keys()) | set(cats_6m.keys())
    for cat in all_cats:
        avg3 = cats_3m.get(cat, 0.0)
        avg6 = cats_6m.get(cat, 0.0)
        if avg6 > 20.0 or avg3 > 20.0:  # Ignore negligible amounts
            delta = avg3 - avg6
            pct_change = round((delta / avg6 * 100), 1) if avg6 > 0 else 100.0
            if pct_change >= 15.0 and delta >= 20.0:
                growing_categories.append({
                    "category": cat,
                    "avg_monthly_3m_euros": avg3,
                    "avg_monthly_6m_euros": avg6,
                    "increase_euros": round(delta, 2),
                    "change_percent": f"+{pct_change}%"
                })
            elif pct_change <= -15.0 and delta <= -20.0:
                shrinking_categories.append({
                    "category": cat,
                    "avg_monthly_3m_euros": avg3,
                    "avg_monthly_6m_euros": avg6,
                    "decrease_euros": round(abs(delta), 2),
                    "change_percent": f"{pct_change}%"
                })

    growing_categories.sort(key=lambda x: x["avg_monthly_3m_euros"], reverse=True)
    shrinking_categories.sort(key=lambda x: x["avg_monthly_6m_euros"], reverse=True)

    return {
        "averages_3_months": {
            "monthly_income_euros": p3m["monthly_avg_income"],
            "monthly_expenses_euros": p3m["monthly_avg_total_expenses"],
            "monthly_fixed_euros": p3m["monthly_avg_fixed_expenses"],
            "monthly_variable_euros": p3m["monthly_avg_variable_expenses"],
            "monthly_savings_euros": p3m["monthly_avg_net_savings"],
            "savings_rate_percent": p3m["savings_rate_percent"]
        },
        "averages_6_months": {
            "monthly_income_euros": p6m["monthly_avg_income"],
            "monthly_expenses_euros": p6m["monthly_avg_total_expenses"],
            "monthly_fixed_euros": p6m["monthly_avg_fixed_expenses"],
            "monthly_variable_euros": p6m["monthly_avg_variable_expenses"],
            "monthly_savings_euros": p6m["monthly_avg_net_savings"],
            "savings_rate_percent": p6m["savings_rate_percent"]
        },
        "averages_12_months": {
            "monthly_income_euros": p12m["monthly_avg_income"],
            "monthly_expenses_euros": p12m["monthly_avg_total_expenses"],
            "savings_rate_percent": p12m["savings_rate_percent"]
        },
        "notable_spending_changes": {
            "growing_categories_recent": growing_categories[:5],
            "shrinking_categories_recent": shrinking_categories[:5]
        }
    }

def get_dashboard_synthesis_tool(db: Session, year: int = None, month: int = None) -> dict:
    """
    Returns the complete monthly synthesis mirroring what the user sees in the OmniBank dashboard.
    """
    import calendar
    from datetime import date
    from app.models import Transaction, Budget, BudgetAllocation
    from app.routers.budgets import get_budget_status
    from app.services.finance_engine import calculate_rest_to_live, predict_next_paycheck

    today = date.today()
    y = int(year) if year is not None else today.year
    m = int(month) if month is not None else today.month

    # Current month date bounds
    start_cur = date(y, m, 1)
    end_cur = date(y, m, calendar.monthrange(y, m)[1])

    # Previous month date bounds
    if m == 1:
        prev_y, prev_m = y - 1, 12
    else:
        prev_y, prev_m = y, m - 1
    start_prev = date(prev_y, prev_m, 1)
    end_prev = date(prev_y, prev_m, calendar.monthrange(prev_y, prev_m)[1])

    def _query_month_totals(s, e):
        txs = db.query(Transaction).filter(
            Transaction.date_operation >= s,
            Transaction.date_operation <= e,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()
        inc = sum(t.amount for t in txs if t.type == "income")
        fix = sum(t.amount for t in txs if t.type == "expense_fixed")
        var = sum(t.amount for t in txs if t.type == "expense_var")
        return round(inc, 2), round(fix, 2), round(var, 2), round(fix + var, 2), round(inc - (fix + var), 2)

    cur_inc, cur_fix, cur_var, cur_exp, cur_sav = _query_month_totals(start_cur, end_cur)
    prev_inc, prev_fix, prev_var, prev_exp, prev_sav = _query_month_totals(start_prev, end_prev)

    # Budget Envelopes Status
    b_status = get_budget_status(year=y, month=m, db=db)
    envelopes = []
    for b in b_status.get("budgets", []):
        pct = b.get("percent", 0.0)
        status_label = "healthy"
        if pct >= 100.0:
            status_label = "overspent"
        elif pct >= 80.0:
            status_label = "warning"

        envelopes.append({
            "name": b.get("name"),
            "envelope_type": b.get("envelope_type", "spending"),
            "limit_euros": b.get("budget_amount", 0.0),
            "spent_euros": b.get("expenses", 0.0),
            "remaining_euros": b.get("balance", 0.0),
            "percent_spent": pct,
            "status": status_label
        })

    # Reste à vivre
    paycheck = predict_next_paycheck(db)
    rtl = calculate_rest_to_live(db, today, paycheck["date"]) if (y == today.year and m == today.month) else None

    return {
        "period": {"year": y, "month": m},
        "monthly_totals": {
            "total_income_euros": cur_inc,
            "total_expenses_fixed_euros": cur_fix,
            "total_expenses_variable_euros": cur_var,
            "total_expenses_euros": cur_exp,
            "net_savings_euros": cur_sav,
            "savings_rate_percent": round((cur_sav / cur_inc * 100), 1) if cur_inc > 0 else 0.0
        },
        "comparison_vs_previous_month": {
            "previous_month_period": f"{prev_y}-{prev_m:02d}",
            "income_delta_euros": round(cur_inc - prev_inc, 2),
            "expenses_delta_euros": round(cur_exp - prev_exp, 2),
            "net_savings_delta_euros": round(cur_sav - prev_sav, 2)
        },
        "current_reste_a_vivre_euros": rtl,
        "budget_envelopes": envelopes
    }


def audit_transactions_integrity_tool(db: Session) -> dict:
    from app.models import Transaction, RecurrenceTemplate
    from datetime import date, timedelta
    
    today = date.today()
    thirty_days_ago = today - timedelta(days=30)
    forty_five_days_ago = today - timedelta(days=45)
    
    # 1. Past unreconciled transactions (> 30 days old)
    past_unreconciled = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation < thirty_days_ago,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).order_by(Transaction.date_operation.desc()).limit(20).all()
    
    past_unrec_list = [
        {
            "id": t.id,
            "date": t.date_operation.isoformat() if t.date_operation else None,
            "description": t.description,
            "amount_euros": t.amount,
            "category": t.category,
            "days_overdue": (today - t.date_operation).days if t.date_operation else 0
        }
        for t in past_unreconciled
    ]
    
    # 2. Uncategorized transactions
    uncategorized = db.query(Transaction).filter(
        (Transaction.category == None) | (Transaction.category == "") | (Transaction.category == "Sans catégorie"),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).order_by(Transaction.date_operation.desc()).limit(20).all()
    
    uncat_list = [
        {
            "id": t.id,
            "date": t.date_operation.isoformat() if t.date_operation else None,
            "description": t.description,
            "amount_euros": t.amount,
            "type": t.type
        }
        for t in uncategorized
    ]
    
    # 3. Suspicious or inverted transactions
    suspicious = []
    recent_txs = db.query(Transaction).filter(
        Transaction.date_operation >= today - timedelta(days=90),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).all()
    
    for t in recent_txs:
        issue = None
        if t.amount is None or t.amount <= 0:
            issue = "Montant nul ou négatif invalide"
        elif t.type == "income" and any(k in (t.description or "").lower() for k in ["retrait", "carte", "cb ", "paiement", "prelevement"]):
            issue = "Recette potentiellement classée par erreur en débit"
        elif t.type in ("expense_var", "expense_fixed") and any(k in (t.description or "").lower() for k in ["salaire", "remboursement", "virement reçu", "caf", "cpam"]):
            issue = "Dépense potentiellement classée par erreur (semble être un revenu ou remboursement)"
            
        if issue:
            suspicious.append({
                "id": t.id,
                "date": t.date_operation.isoformat() if t.date_operation else None,
                "description": t.description,
                "amount_euros": t.amount,
                "current_type": t.type,
                "potential_issue": issue
            })

    # 4. Missing expected recurring charges
    active_templates = db.query(RecurrenceTemplate).filter(
        RecurrenceTemplate.is_closed == False,
        RecurrenceTemplate.type.in_(("expense_fixed", "expense_var"))
    ).all()
    
    missing_recurrences = []
    for tpl in active_templates:
        tx_found = db.query(Transaction).filter(
            Transaction.date_operation >= forty_five_days_ago,
            (Transaction.recurrence_id == tpl.id) | (Transaction.description.ilike(f"%{tpl.description}%"))
        ).first()
        if not tx_found:
            missing_recurrences.append({
                "template_id": tpl.id,
                "description": tpl.description,
                "expected_amount_euros": tpl.amount,
                "frequency": tpl.frequency,
                "day_of_month": tpl.day_of_month,
                "note": "Aucun débit constaté sur les 45 derniers jours pour ce modèle récurrent actif."
            })
            
    return {
        "summary": {
            "unreconciled_past_count": len(past_unrec_list),
            "uncategorized_count": len(uncat_list),
            "suspicious_entries_count": len(suspicious),
            "missing_recurring_charges_count": len(missing_recurrences)
        },
        "unreconciled_past_transactions": past_unrec_list,
        "uncategorized_transactions": uncat_list,
        "suspicious_transactions": suspicious[:10],
        "missing_recurring_charges": missing_recurrences
    }

def simulate_financial_scenario_tool(db: Session, horizon_months: int = 12, project_name: str = None, one_off_amount: float = 0.0, recurring_monthly_amount: float = 0.0, recurring_duration_months: int = 12) -> dict:
    from app.services.simulator_engine import run_simulation
    from datetime import date, timedelta
    from app.models import Transaction
    
    try:
        horizon_months = max(3, min(int(horizon_months), 36))
    except Exception:
        horizon_months = 12
        
    one_off = float(one_off_amount or 0.0)
    rec_monthly = float(recurring_monthly_amount or 0.0)
    rec_dur = max(1, min(int(recurring_duration_months or horizon_months), horizon_months))
    p_name = project_name or "Projet Simulé"
    
    custom_events = []
    if one_off > 0:
        custom_events.append({
            "label": f"{p_name} (Apport/Achat unique)",
            "event_type": "one_off_expense",
            "amount": one_off,
            "duration_months": 1
        })
    if rec_monthly > 0:
        custom_events.append({
            "label": f"{p_name} (Mensualité/Charge)",
            "event_type": "recurring_expense",
            "amount": rec_monthly,
            "duration_months": rec_dur
        })
        
    sim_result = run_simulation(
        db,
        horizon_months=horizon_months,
        custom_events=custom_events if custom_events else None
    )
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    txs_inc = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.date_operation <= today,
        Transaction.type == "income",
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).all()
    avg_income = (sum(t.amount for t in txs_inc) / 6.0) if txs_inc else 0.0
    max_debt_capacity_33pct = round(avg_income * 0.33, 2)
    
    baseline_end = sim_result.get("baseline_trajectory", [{}])[-1].get("end_balance", 0.0) if sim_result.get("baseline_trajectory") else 0.0
    simulated_end = sim_result.get("simulated_trajectory", [{}])[-1].get("end_balance", 0.0) if sim_result.get("simulated_trajectory") else 0.0
    
    return {
        "project_name": p_name,
        "simulation_horizon_months": horizon_months,
        "project_cost_summary": {
            "initial_one_off_euros": one_off,
            "monthly_commitment_euros": rec_monthly,
            "monthly_duration_months": rec_dur,
            "total_project_cost_euros": round(one_off + (rec_monthly * rec_dur), 2)
        },
        "user_borrowing_capacity": {
            "monthly_average_income_euros": round(avg_income, 2),
            "max_recommended_monthly_debt_33pct_euros": max_debt_capacity_33pct,
            "is_within_recommended_debt_capacity": rec_monthly <= max_debt_capacity_33pct if avg_income > 0 else True
        },
        "trajectory_comparison": {
            "baseline_balance_end_horizon_euros": baseline_end,
            "simulated_balance_end_horizon_euros": simulated_end,
            "net_worth_impact_euros": round(simulated_end - baseline_end, 2),
            "min_simulated_balance_euros": sim_result.get("kpis", {}).get("min_simulated_balance", 0.0),
            "first_overdraft_month": sim_result.get("kpis", {}).get("first_overdraft_month")
        },
        "is_financially_viable": sim_result.get("kpis", {}).get("min_simulated_balance", 0.0) >= 0.0
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
            "name": "audit_transactions_integrity",
            "description": "Audit the database transactions for data integrity: unreconciled past operations (>30 days), un-categorized operations, suspicious/inverted entries, and missing regular recurring debits. Use this in Auditor mode.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_financial_scenario",
            "description": "Run a comprehensive What-If financial sandbox simulation for a future project (vehicle purchase, real estate, sabbatical, renovations) over 3 to 36 months. Computes trajectory, net worth impact, debt capacity ratio, and overdraft risk. Use this in Simulator mode.",
            "parameters": {
                "type": "object",
                "properties": {
                    "horizon_months": {"type": "integer", "description": "Simulation horizon in months (e.g. 6, 12, 24). Default is 12."},
                    "project_name": {"type": "string", "description": "Human name for the project (e.g. 'Achat Moto', 'Travaux Cuisine')."},
                    "one_off_amount": {"type": "number", "description": "Initial one-off expense or down payment."},
                    "recurring_monthly_amount": {"type": "number", "description": "Monthly recurring cost or loan repayment."},
                    "recurring_duration_months": {"type": "integer", "description": "Duration in months of the recurring monthly cost."}
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_financial_summary",
            "description": "Get the current 'Reste à vivre' (left to live) amount, daily spending ceiling, days remaining until next paycheck, savings safety buffer, and predicted paycheck details. Use this when the user asks about remaining budget or paycheck projections.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_spending_trends",
            "description": "Get historical spending and income averages over 3, 6, and 12 months, overall savings rate, and identify categories with recent notable spending growth or reduction. Use this for deep financial health analysis and budget optimization advice.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_dashboard_synthesis",
            "description": "Get the complete monthly dashboard synthesis: total income, fixed vs variable expenses, net savings, comparison against previous month (M-1), and consumption status of all budget envelopes. Use this when the user asks about their overall monthly progress or dashboard metrics.",
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

