"""
app/services/chat/tools/read_tools.py — Outils RAG en lecture seule (aucune mutation DB).
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
    import calendar
    from app.models import Transaction, BudgetCategory, RecurrenceTemplate
    today = date.today()
    try:
        y = int(year) if year is not None else today.year
        m = int(month) if month is not None else today.month
    except (ValueError, TypeError):
        return {"error": "Invalid year or month format. Expected integers."}
    
    last_day = calendar.monthrange(y, m)[1]
    start_date_str = f"{y:04d}-{m:02d}-01"
    end_date_str = f"{y:04d}-{m:02d}-{last_day:02d}"
    is_future = (y > today.year) or (y == today.year and m > today.month)
    is_past = (y < today.year) or (y == today.year and m < today.month)
    is_current = (y == today.year and m == today.month)

    french_months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
    period_label = f"{french_months[m-1]} {y}"

    target_period = {
        "year": y,
        "month": m,
        "start_date": start_date_str,
        "end_date": end_date_str,
        "is_future": is_future,
        "is_past": is_past,
        "is_current": is_current,
        "period_label": period_label
    }

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

    # For future months, project planned recurring commitments (avoiding double-counting if transactions already exist)
    planned_by_budget = defaultdict(float)
    if is_future:
        from sqlalchemy import func
        rec_templates = db.query(RecurrenceTemplate).filter(
            RecurrenceTemplate.is_closed == False,
            RecurrenceTemplate.type.in_(("expense_fixed", "expense_var"))
        ).all()

        target_month_start = date(y, m, 1)
        target_month_end = date(y, m, calendar.monthrange(y, m)[1])
        existing_target_month_txs = db.query(Transaction).filter(
            Transaction.date_operation >= target_month_start,
            Transaction.date_operation <= target_month_end,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()
        existing_rec_ids_in_target_month = {t.recurrence_id for t in existing_target_month_txs if t.recurrence_id}
        existing_descs_in_target_month = {t.description.strip().lower() for t in existing_target_month_txs if t.description}

        tx_counts = dict(
            db.query(Transaction.recurrence_id, func.count(Transaction.id))
            .filter(Transaction.recurrence_id.isnot(None))
            .group_by(Transaction.recurrence_id)
            .all()
        )

        last_tx_dates = dict(
            db.query(Transaction.recurrence_id, func.max(Transaction.date_operation))
            .filter(Transaction.recurrence_id.isnot(None))
            .group_by(Transaction.recurrence_id)
            .all()
        )

        for rt in rec_templates:
            # 1. Skip if transaction already exists in the target month (prevent duplicate counting with actual_spent)
            if rt.id in existing_rec_ids_in_target_month:
                continue
            if rt.description and rt.description.strip().lower() in existing_descs_in_target_month:
                continue

            # 2. Check max occurrences (e.g. 3x or 4x payments completed)
            occ_count = tx_counts.get(rt.id, 0)
            if rt.max_occurrences and occ_count >= rt.max_occurrences:
                continue

            amt = abs(rt.amount)
            freq = (rt.frequency or "monthly").lower()

            norm_amt = 0.0
            if "year" in freq or "annuel" in freq:
                target_moy = rt.month_of_year
                if not target_moy and rt.id in last_tx_dates and last_tx_dates[rt.id]:
                    target_moy = last_tx_dates[rt.id].month
                if target_moy == m:
                    norm_amt = amt
            elif "quarter" in freq or "trimestr" in freq:
                target_moy = rt.month_of_year or (last_tx_dates[rt.id].month if (rt.id in last_tx_dates and last_tx_dates[rt.id]) else 1)
                if (m - target_moy) % 3 == 0:
                    norm_amt = amt
            elif "semi" in freq or "semestr" in freq:
                target_moy = rt.month_of_year or (last_tx_dates[rt.id].month if (rt.id in last_tx_dates and last_tx_dates[rt.id]) else 1)
                if (m - target_moy) % 6 == 0:
                    norm_amt = amt
            elif "week" in freq or "hebdo" in freq:
                norm_amt = amt * 4.33
            elif "bi-week" in freq or "quinz" in freq:
                norm_amt = amt * 2.16
            else: # Monthly
                norm_amt = amt
            
            b_id = cat_to_budget.get(rt.category.strip().lower()) if rt.category else None
            if b_id and norm_amt > 0:
                planned_by_budget[b_id] += norm_amt

    envelopes = []
    total_budgeted = 0.0
    total_spent_committed = 0.0
    total_spent_reconciled = 0.0
    total_income = 0.0

    for b in status_data.get("budgets", []):
        b_id = b.get("id")
        limit_val = b.get("budget_amount", 0.0)
        actual_spent = b.get("expenses", 0.0)
        reconciled_spent = b.get("reconciled_expenses", 0.0)
        income_val = b.get("income", 0.0)

        planned_rec = round(planned_by_budget.get(b_id, 0.0), 2) if is_future else 0.0
        # Strict parity with Budgets view: spent is exactly what is committed/recorded in the ledger
        display_spent = actual_spent
        remaining_val = round(limit_val - display_spent, 2)
        pct_val = round((display_spent / limit_val * 100) if limit_val > 0 else 0.0, 1)

        total_budgeted += limit_val
        total_spent_committed += display_spent
        total_spent_reconciled += reconciled_spent
        total_income += income_val

        avg_3m = round(spent_by_b_3m.get(b_id, 0.0) / 3.0, 2) if b_id else 0.0
        avg_6m = round(spent_by_b_6m.get(b_id, 0.0) / 6.0, 2) if b_id else 0.0

        envelopes.append({
            "id": b_id,
            "name": b.get("name"),
            "envelope_type": b.get("envelope_type", "spending"),
            "limit": limit_val,
            "spent": display_spent,
            "actual_spent_in_db": actual_spent,
            "planned_uncommitted_recurring": planned_rec,
            "total_projected_spent": round(actual_spent + planned_rec, 2),
            "reconciled_spent": reconciled_spent,
            "remaining": remaining_val,
            "percent": pct_val,
            "is_future_period": is_future,
            "planned_recurring_commitments": planned_rec,
            "period": b.get("period", "monthly"),
            "status": "exceeded" if display_spent > limit_val else ("warning" if pct_val >= 80 else "ok"),
            "categories": b.get("categories", []),
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

    if is_future:
        tot_planned_rec = round(sum(planned_by_budget.values()), 2)
        summary["planned_uncommitted_recurring_total"] = tot_planned_rec
        summary["future_period_note"] = f"Période future ({period_label}) : Les montants 'spent' de chaque enveloppe correspondent exactement aux opérations et récurrences engagées visibles dans l'écran Budgets (total engagé: {total_spent_committed:.2f} €). Citez toujours 'spent' comme le montant engagé de l'enveloppe."

    # Calculate suggested 50/30/20 reference if history is insufficient
    total_avg_6m = sum(b["historical_monthly_avg_spent_6m"] for b in envelopes)
    from app.services.finance_engine import predict_next_paycheck
    try:
        paycheck = predict_next_paycheck(db)
        salary = paycheck.get("amount", 0.0) if paycheck else 0.0
    except Exception as e:
        logger.warning(f"Erreur lors de la prédiction du salaire dans get_budget_summary_tool: {e}")
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
        "target_period": target_period,
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
    
    is_future = (y > today.year) or (y == today.year and m > today.month)
    is_past = (y < today.year) or (y == today.year and m < today.month)
    is_current = (y == today.year and m == today.month)
    french_months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]

    return {
        "target_period": {
            "year": y,
            "month": m,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "is_future": is_future,
            "is_past": is_past,
            "is_current": is_current,
            "period_label": f"{french_months[m-1]} {y}"
        },
        "budget_status": budgets,
        "spending_analytics": spending,
        "financial_summary": summary,
        "account_balances": balances
    }

def get_active_recurrence_templates(db: Session, template_type: str = None, template_types: tuple = None) -> list:
    """
    Returns only truly active recurrence templates, strictly excluding:
    - closed templates (is_closed == True)
    - completed/exhausted templates where max_occurrences is reached.
    """
    from sqlalchemy import func
    from app.models import RecurrenceTemplate, Transaction

    query = db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed == None)
    )
    if template_type:
        query = query.filter(RecurrenceTemplate.type == template_type)
    elif template_types:
        query = query.filter(RecurrenceTemplate.type.in_(template_types))

    templates = query.all()
    if not templates:
        return []

    # Count existing non-skipped transactions for each template
    tx_counts = dict(
        db.query(Transaction.recurrence_id, func.count(Transaction.id))
        .filter(
            Transaction.recurrence_id.in_([t.id for t in templates]),
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
        )
        .group_by(Transaction.recurrence_id)
        .all()
    )

    active = []
    for t in templates:
        if t.max_occurrences and tx_counts.get(t.id, 0) >= t.max_occurrences:
            continue
        active.append(t)
    return active

def _compute_recurrence_schedule(t, last_tx_date = None) -> tuple:
    """
    Returns (applicable_months: list[int], frequency_human: str, next_expected_date: Optional[str])
    """
    from datetime import date
    freq = (t.frequency or "monthly").strip().lower()
    day = t.day_of_month or 1
    base_m = t.month_of_year or (last_tx_date.month if last_tx_date else 1)
    
    french_months = [
        "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
        "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
    ]
    
    today = date.today()
    applicable_months = []
    freq_human = ""
    next_date = None
    
    if "year" in freq or "annuel" in freq:
        applicable_months = [base_m]
        freq_human = f"Annuel (1 fois par an en {french_months[base_m-1]})"
        cand_year = today.year
        cand = date(cand_year, base_m, min(day, 28))
        if cand <= today:
            cand = date(cand_year + 1, base_m, min(day, 28))
        next_date = cand.isoformat()
    elif "semi" in freq or "semestr" in freq:
        m2 = (base_m + 5) % 12 + 1
        applicable_months = sorted([base_m, m2])
        freq_human = f"Semestriel / 2 fois par an (Tous les 6 mois : {french_months[applicable_months[0]-1]} et {french_months[applicable_months[1]-1]})"
        cands = []
        for y in (today.year, today.year + 1):
            for m in applicable_months:
                cands.append(date(y, m, min(day, 28)))
        future_cands = [c for c in cands if c > today]
        if future_cands:
            next_date = min(future_cands).isoformat()
    elif "quarter" in freq or "trimestr" in freq:
        applicable_months = sorted([(base_m - 1 + 3 * i) % 12 + 1 for i in range(4)])
        months_str = ", ".join(french_months[m-1] for m in applicable_months)
        freq_human = f"Trimestriel / 4 fois par an (Tous les 3 mois : {months_str})"
        cands = []
        for y in (today.year, today.year + 1):
            for m in applicable_months:
                cands.append(date(y, m, min(day, 28)))
        future_cands = [c for c in cands if c > today]
        if future_cands:
            next_date = min(future_cands).isoformat()
    elif "bi-week" in freq or "bi-month" in freq or "quinzain" in freq:
        applicable_months = list(range(1, 13))
        freq_human = "Toutes les 2 semaines (Bi-mensuel)"
    elif "week" in freq or "hebdo" in freq:
        applicable_months = list(range(1, 13))
        freq_human = "Hebdomadaire (Toutes les semaines)"
    else: # monthly
        applicable_months = list(range(1, 13))
        freq_human = f"Mensuel (Tous les mois vers le {day})"
        cand = date(today.year, today.month, min(day, 28))
        if cand <= today:
            m = today.month + 1 if today.month < 12 else 1
            y = today.year if today.month < 12 else today.year + 1
            cand = date(y, m, min(day, 28))
        next_date = cand.isoformat()

    return applicable_months, freq_human, next_date

def get_recurrence_templates_tool(db: Session, include_completed: bool = False) -> dict:
    from sqlalchemy import func
    from datetime import date
    from app.models import RecurrenceTemplate, Transaction

    today = date.today()

    templates = db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed == None)
    ).all()

    tx_counts = dict(
        db.query(Transaction.recurrence_id, func.count(Transaction.id))
        .filter(
            Transaction.recurrence_id.isnot(None),
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
        )
        .group_by(Transaction.recurrence_id)
        .all()
    )

    # Find the most recent reconciled operation
    last_reconciled_map = {}
    for tx in db.query(Transaction).filter(
        Transaction.recurrence_id.isnot(None),
        Transaction.reconciliation_date.isnot(None),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).order_by(Transaction.date_operation.desc()).all():
        if tx.recurrence_id not in last_reconciled_map:
            last_reconciled_map[tx.recurrence_id] = {
                "date": tx.date_operation.isoformat() if tx.date_operation else None,
                "amount": tx.amount,
                "date_obj": tx.date_operation
            }

    # Find the very next upcoming planned transaction from DB if already scheduled
    next_planned_map = {}
    for tx in db.query(Transaction).filter(
        Transaction.recurrence_id.isnot(None),
        Transaction.reconciliation_date.is_(None),
        Transaction.date_operation >= today,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).order_by(Transaction.date_operation.asc()).all():
        if tx.recurrence_id not in next_planned_map:
            next_planned_map[tx.recurrence_id] = tx.date_operation.isoformat()

    result = []
    for t in templates:
        occ_count = tx_counts.get(t.id, 0)
        is_completed = bool(t.max_occurrences and occ_count >= t.max_occurrences)
        remaining = max(0, t.max_occurrences - occ_count) if t.max_occurrences else None

        if is_completed and not include_completed:
            continue

        last_rec = last_reconciled_map.get(t.id)
        last_dt_obj = last_rec.get("date_obj") if last_rec else None
        applicable_months, freq_human, computed_next_date = _compute_recurrence_schedule(t, last_dt_obj)
        next_expected_date = next_planned_map.get(t.id, computed_next_date)

        result.append({
            "id": t.id,
            "description": t.description,
            "amount": t.amount,
            "type": t.type,
            "category": t.category,
            "frequency": t.frequency,
            "frequency_human": freq_human,
            "applicable_months": applicable_months,
            "day_of_month": t.day_of_month,
            "month_of_year": t.month_of_year,
            "max_occurrences": t.max_occurrences,
            "occurrences_generated": occ_count,
            "remaining_occurrences": remaining,
            "is_completed": is_completed,
            "status": "completed" if is_completed else "active",
            "last_reconciled_payment": {
                "date": last_rec["date"],
                "amount": last_rec["amount"]
            } if last_rec else None,
            "next_expected_date": next_expected_date
        })

    return {"templates": result, "total_active": len(result)}

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
    except Exception as e:
        logger.debug(f"Impossible d'obtenir le montant de paie pour l'étage prudentiel: {e}")
        salary_amount = 0.0
        
    if not salary_amount or salary_amount <= 0:
        conf_sal = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
        if conf_sal and conf_sal.value:
            try:
                salary_amount = float(conf_sal.value)
            except (ValueError, TypeError) as e:
                logger.warning(f"Valeur invalide pour override_paycheck_amount ('{conf_sal.value}'): {e}")
                
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
    except (ValueError, TypeError):
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
    
    # Load all active recurrence templates (strictly excluding completed max_occurrences)
    templates = get_active_recurrence_templates(db)
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
        except Exception as e:
            logger.debug(f"Impossible de récupérer le montant de salaire: {e}")
            sal = 0.0
            
        if not sal or sal <= 0:
            from app.models import GlobalConfig
            conf_sal = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
            if conf_sal and conf_sal.value:
                try:
                    sal = float(conf_sal.value)
                except (ValueError, TypeError) as e:
                    logger.warning(f"Valeur invalide pour override_paycheck_amount ('{conf_sal.value}'): {e}")
                    
        if not sal or sal <= 0:
            inc_tpls = get_active_recurrence_templates(db, template_type="income")
            if inc_tpls and inc_tpls[0].amount:
                sal = float(inc_tpls[0].amount)
            
        if sal > 0:
            monthly_income = sal
            # Fixed charges from active templates
            active_tpls = get_active_recurrence_templates(db, template_types=("expense_fixed", "expense_var"))
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

    is_future = (y > today.year) or (y == today.year and m > today.month)
    is_past = (y < today.year) or (y == today.year and m < today.month)
    is_current = (y == today.year and m == today.month)
    french_months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"]

    return {
        "target_period": {
            "year": y,
            "month": m,
            "start_date": start_cur.isoformat(),
            "end_date": end_cur.isoformat(),
            "is_future": is_future,
            "is_past": is_past,
            "is_current": is_current,
            "period_label": f"{french_months[m-1]} {y}"
        },
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


