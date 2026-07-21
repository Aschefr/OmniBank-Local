from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import extract
from pydantic import BaseModel
from datetime import date
from typing import Optional, List
import json

from app.database import get_db
from app.models import Budget, BudgetCategory, BudgetAllocation, Transaction, GlobalConfig, Account
from app.services.history_service import record_action, snapshot_entity

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


def _safe_parse_budget_date(s: str, field_name: str) -> Optional[date]:
    """Parse une date YYYY-MM-DD pour les budgets — HTTPException 400 si invalide."""
    if not s:
        return None
    try:
        d = date.fromisoformat(s.strip())
        if d.year < 1900 or d.year > 2200:
            raise HTTPException(
                status_code=400,
                detail=f"Champ '{field_name}' invalide : année hors plage (1900-2200)."
            )
        return d
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Champ '{field_name}' invalide : '{s}'. Format attendu YYYY-MM-DD."
        )


# ─── Schemas ──────────────────────────────────────────────────────────────────

class BudgetCreate(BaseModel):
    name: str
    monthly_amount: float
    period: Optional[str] = "monthly"
    is_project: Optional[bool] = False
    categories: Optional[List[str]] = []
    start_date: Optional[str] = None  # YYYY-MM-DD for custom period
    end_date: Optional[str] = None
    account_ids: Optional[List[int]] = None  # Improvement_04: scope to specific accounts (org mode)
    envelope_type: Optional[str] = "spending"  # "spending" or "savings" (tirelire)

class BudgetUpdate(BaseModel):
    name: Optional[str] = None
    monthly_amount: Optional[float] = None
    period: Optional[str] = None
    is_project: Optional[bool] = None
    is_closed: Optional[bool] = None
    categories: Optional[List[str]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    account_ids: Optional[List[int]] = None  # Improvement_04
    envelope_type: Optional[str] = None

class AllocationCreate(BaseModel):
    amount: float
    date: Optional[str] = None  # YYYY-MM-DD, defaults to today
    note: Optional[str] = None
    account_id: Optional[int] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_account_ids(raw: str) -> list:
    """Parse JSON string of account IDs from DB column."""
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


def _serialize_account_ids(ids: list) -> str:
    """Serialize account IDs list to JSON string for DB storage."""
    if not ids:
        return None
    return json.dumps(ids)


def _budget_to_dict(b: Budget, db: Session) -> dict:
    cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all()
    return {
        "id": b.id,
        "name": b.name,
        "monthly_amount": b.monthly_amount,
        "period": b.period,
        "is_project": b.is_project,
        "is_closed": b.is_closed,
        "categories": [c.category_name for c in cats],
        "start_date": b.start_date.isoformat() if b.start_date else None,
        "end_date": b.end_date.isoformat() if b.end_date else None,
        "account_ids": _parse_account_ids(b.account_ids),
        "envelope_type": b.envelope_type or "spending",
    }


# ─── CRUD endpoints ───────────────────────────────────────────────────────────

@router.get("/")
def get_budgets(db: Session = Depends(get_db)):
    budgets = db.query(Budget).order_by(Budget.name).all()
    if not budgets:
        return []
    
    budget_ids = [b.id for b in budgets]
    all_cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_(budget_ids)).all()
    cats_by_budget = {}
    for c in all_cats:
        cats_by_budget.setdefault(c.budget_id, []).append(c.category_name)
        
    return [
        {
            "id": b.id,
            "name": b.name,
            "monthly_amount": b.monthly_amount,
            "period": b.period,
            "is_project": b.is_project,
            "is_closed": b.is_closed,
            "categories": cats_by_budget.get(b.id, []),
            "start_date": b.start_date.isoformat() if b.start_date else None,
            "end_date": b.end_date.isoformat() if b.end_date else None,
            "account_ids": _parse_account_ids(b.account_ids),
            "envelope_type": b.envelope_type or "spending",
        }
        for b in budgets
    ]


@router.post("/")
def create_budget(data: BudgetCreate, db: Session = Depends(get_db)):
    _start = _safe_parse_budget_date(data.start_date, "start_date") if data.start_date else None
    _end = _safe_parse_budget_date(data.end_date, "end_date") if data.end_date else None
    # Tirelire: force period to indefinite
    period = data.period
    if data.envelope_type == "savings":
        period = "indefinite"
    b = Budget(
        name=data.name,
        monthly_amount=data.monthly_amount,
        period=period,
        is_project=data.is_project,
        is_closed=False,
        start_date=_start,
        end_date=_end,
        account_ids=_serialize_account_ids(data.account_ids),
        envelope_type=data.envelope_type or "spending",
    )
    db.add(b)
    db.flush()

    for cat_name in (data.categories or []):
        db.add(BudgetCategory(budget_id=b.id, category_name=cat_name))
    db.flush()
    action_id = record_action(db, "budget", b.id, "CREATE", None, snapshot_entity(b, db))
    db.commit()
    db.refresh(b)

    res = _budget_to_dict(b, db)
    res["action_id"] = action_id
    return res


@router.put("/{budget_id}")
def update_budget(budget_id: int, data: BudgetUpdate, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")

    old_snapshot = snapshot_entity(b, db)
    for k, v in data.dict(exclude_unset=True).items():
        if k == "categories":
            continue  # handled below
        if k in ("start_date", "end_date"):
            setattr(b, k, _safe_parse_budget_date(v, k) if v else None)
            continue
        if k == "account_ids":
            setattr(b, k, _serialize_account_ids(v))
            continue
        setattr(b, k, v)

    if data.categories is not None:
        db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).delete()
        for cat_name in data.categories:
            db.add(BudgetCategory(budget_id=budget_id, category_name=cat_name))

    db.flush()
    action_id = record_action(db, "budget", b.id, "UPDATE", old_snapshot, snapshot_entity(b, db))
    db.commit()
    db.refresh(b)
    res = _budget_to_dict(b, db)
    res["action_id"] = action_id
    return res


@router.delete("/{budget_id}")
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")
    old_snapshot = snapshot_entity(b, db)
    db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).delete()
    db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == budget_id).delete()
    db.delete(b)
    action_id = record_action(db, "budget", budget_id, "DELETE", old_snapshot, None)
    db.commit()
    return {"ok": True, "action_id": action_id}


# ─── Status endpoint ──────────────────────────────────────────────────────────

@router.get("/status")
def get_budget_status(year: int = None, month: int = None, date_start: str = None, date_end: str = None, period_filter: str = None, db: Session = Depends(get_db)):
    """Returns spending vs budget for each envelope.
    Supports day-granularity via date_start/date_end (YYYY-MM-DD) or month-level via year/month.
    period_filter: optional, one of 'monthly', 'yearly', 'indefinite', 'custom' to return only that type.

    PERF: Bulk-loads all budgets, categories, allocations, and transactions in a small
    number of SQL queries, then aggregates in Python memory — O(1) queries instead of O(N×M).
    """
    today = date.today()
    y = year or today.year
    m = month or today.month

    # Parse custom date range if provided (only used for monthly budgets)
    custom_start = None
    custom_end = None
    if date_start and date_end:
        try:
            custom_start = _safe_parse_budget_date(date_start, "date_start")
            custom_end = _safe_parse_budget_date(date_end, "date_end")
            if custom_start and custom_end and custom_start > custom_end:
                custom_start, custom_end = custom_end, custom_start
        except HTTPException:
            pass  # Dates invalides = pas de filtre custom (fallback mensuel)

    # ── 1. Bulk-load budgets ──────────────────────────────────────────────────
    q = db.query(Budget).filter(Budget.is_closed == False)
    if period_filter:
        if period_filter == "custom":
            q = q.filter(Budget.period == "custom")
        elif period_filter == "indefinite":
            q = q.filter(Budget.period == "indefinite")
        elif period_filter == "yearly":
            q = q.filter(Budget.period == "yearly")
        elif period_filter == "monthly":
            q = q.filter(Budget.period.in_(["monthly", None]))
    budgets = q.all()
    if not budgets:
        return {"year": y, "month": m, "budgets": []}

    budget_ids = [b.id for b in budgets]

    # ── 2. Bulk-load categories (1 query) ─────────────────────────────────────
    all_cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_(budget_ids)).all()
    cats_by_budget = {}
    for c in all_cats:
        cats_by_budget.setdefault(c.budget_id, []).append(c.category_name)

    # ── 3. Bulk-load allocations for savings envelopes (1 query) ──────────────
    savings_budget_ids = [b.id for b in budgets if (b.envelope_type or "spending") == "savings"]
    allocs_by_budget = {}
    if savings_budget_ids:
        all_allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(savings_budget_ids)).all()
        for a in all_allocs:
            allocs_by_budget.setdefault(a.budget_id, []).append(a)

    # ── 4. Bulk-load transactions ─────────────────────────────────────────────
    # We load ALL transactions that could match ANY budget, using the widest
    # possible filter. This is at most 2 queries:
    #   A) budget_id-linked transactions (for savings + project envelopes)
    #   B) category-based transactions (for spending envelopes)

    # (A) Transactions linked by budget_id (savings + project)
    budget_id_linked_ids = [b.id for b in budgets
                           if (b.envelope_type or "spending") == "savings" or b.is_project]
    txs_by_budget_id = {}
    if budget_id_linked_ids:
        linked_txs = db.query(
            Transaction.budget_id,
            Transaction.from_account_id,
            Transaction.to_account_id,
            Transaction.type,
            Transaction.amount,
            Transaction.reconciliation_date
        ).filter(Transaction.budget_id.in_(budget_id_linked_ids)).all()
        for tx in linked_txs:
            txs_by_budget_id.setdefault(tx.budget_id, []).append(tx)

    # (B) Category-based transactions (for spending envelopes: indefinite, custom, yearly, monthly)
    # Load them in a single query grouped by key dimensions to let SQLite do the aggregation.
    spending_budgets = [b for b in budgets
                       if (b.envelope_type or "spending") != "savings" and not b.is_project]
    all_category_txs = []
    if spending_budgets:
        from sqlalchemy import func
        tx_query = db.query(
            Transaction.from_account_id,
            Transaction.to_account_id,
            Transaction.type,
            Transaction.category,
            Transaction.reconciliation_date,
            Transaction.date_operation,
            func.sum(func.abs(Transaction.amount)).label("amount")
        ).filter(
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        
        # Optimize: only load transactions starting from the earliest relevant date
        has_indefinite = any(b.period == "indefinite" for b in spending_budgets)
        if not has_indefinite:
            dates = []
            if any(b.period in ("monthly", None) for b in spending_budgets):
                if custom_start:
                    dates.append(custom_start)
                else:
                    dates.append(date(y, m, 1))
            if any(b.period == "yearly" for b in spending_budgets):
                dates.append(date(y, 1, 1))
            for b in spending_budgets:
                if b.period == "custom" and b.start_date:
                    dates.append(b.start_date)
            if dates:
                min_date = min(dates)
                tx_query = tx_query.filter(Transaction.date_operation >= min_date)
                
        tx_query = tx_query.group_by(
            Transaction.from_account_id,
            Transaction.to_account_id,
            Transaction.type,
            Transaction.category,
            Transaction.reconciliation_date,
            Transaction.date_operation
        )
        all_category_txs = tx_query.all()

    # ── 5. Process each budget in memory ──────────────────────────────────────
    result = []

    for b in budgets:
        cats = cats_by_budget.get(b.id, [])
        acc_ids = _parse_account_ids(b.account_ids)  # Improvement_04
        acc_ids_set = set(acc_ids) if acc_ids else None

        def _match_account(tx):
            if not acc_ids_set:
                return True
            return (tx.from_account_id in acc_ids_set or tx.to_account_id in acc_ids_set)

        expenses = 0.0
        income = 0.0
        reconciled_expenses = 0.0
        reconciled_income = 0.0

        # ── Tirelire (savings) mode: track via budget_id + manual allocations ──
        if (b.envelope_type or "spending") == "savings":
            for tx in txs_by_budget_id.get(b.id, []):
                if not _match_account(tx):
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)

            # Manual allocations (from bulk-loaded data)
            allocs = allocs_by_budget.get(b.id, [])
            alloc_deposits = sum(a.amount for a in allocs if a.amount > 0)
            alloc_withdrawals = sum(abs(a.amount) for a in allocs if a.amount < 0)

            funded = round(income + alloc_deposits, 2)
            withdrawn = round(expenses + alloc_withdrawals, 2)
            balance = round(funded - withdrawn, 2)
            budget_amount = b.monthly_amount
            pct = round((balance / budget_amount * 100) if budget_amount > 0 else 0, 1)

            result.append({
                "id": b.id,
                "name": b.name,
                "categories": cats,
                "is_project": b.is_project,
                "is_closed": b.is_closed,
                "envelope_type": "savings",
                "budget_amount": budget_amount,
                "funded": funded,
                "withdrawn": withdrawn,
                "balance": balance,
                "percent": min(pct, 999),
                "remaining": round(budget_amount - balance, 2),
                # Backward-compat fields for summary bars
                "expenses": withdrawn,
                "reconciled_expenses": round(reconciled_expenses + alloc_withdrawals, 2),
                "income": funded,
                "spent": max(withdrawn - funded, 0),
                "reconciled_spent": 0,
                "net": round(withdrawn - funded, 2),
                "period": b.period,
                "start_date": b.start_date.isoformat() if b.start_date else None,
                "end_date": b.end_date.isoformat() if b.end_date else None,
                "account_ids": acc_ids,
            })
            continue

        # ── Project envelopes: track via budget_id ──
        if b.is_project:
            for tx in txs_by_budget_id.get(b.id, []):
                if not _match_account(tx):
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)

        # ── Category-based spending envelopes: filter from pre-loaded transactions ──
        elif b.period == "indefinite":
            cats_set = set(cats) if cats else None
            for tx in all_category_txs:
                if not _match_account(tx):
                    continue
                if cats_set and (tx.category or "Sans catégorie") not in cats_set:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        elif b.period == "custom" and b.start_date and b.end_date:
            cats_set = set(cats) if cats else None
            for tx in all_category_txs:
                if tx.date_operation < b.start_date or tx.date_operation > b.end_date:
                    continue
                if not _match_account(tx):
                    continue
                if cats_set and (tx.category or "Sans catégorie") not in cats_set:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        elif b.period == "yearly":
            cats_set = set(cats) if cats else None
            for tx in all_category_txs:
                if tx.date_operation.year != y:
                    continue
                if not _match_account(tx):
                    continue
                if cats_set and (tx.category or "Sans catégorie") not in cats_set:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        elif custom_start and custom_end:
            cats_set = set(cats) if cats else None
            for tx in all_category_txs:
                if tx.date_operation < custom_start or tx.date_operation > custom_end:
                    continue
                if not _match_account(tx):
                    continue
                if cats_set and (tx.category or "Sans catégorie") not in cats_set:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        else:
            # Default: monthly
            cats_set = set(cats) if cats else None
            for tx in all_category_txs:
                if tx.date_operation.year != y or tx.date_operation.month != m:
                    continue
                if not _match_account(tx):
                    continue
                if cats_set and (tx.category or "Sans catégorie") not in cats_set:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)


        expenses = round(expenses, 2)
        income = round(income, 2)
        spent = round(expenses - income, 2)
        
        reconciled_expenses = round(reconciled_expenses, 2)
        reconciled_income = round(reconciled_income, 2)
        reconciled_spent = round(reconciled_expenses - reconciled_income, 2)

        budget_amount = b.monthly_amount
        pct = round((max(spent, 0) / budget_amount * 100) if budget_amount > 0 else 0, 1)
        reconciled_pct = round((max(reconciled_spent, 0) / budget_amount * 100) if budget_amount > 0 else 0, 1)

        result.append({
            "id": b.id,
            "name": b.name,
            "categories": cats,
            "is_project": b.is_project,
            "is_closed": b.is_closed,
            "envelope_type": b.envelope_type or "spending",
            "budget_amount": budget_amount,
            "expenses": expenses,
            "reconciled_expenses": reconciled_expenses,
            "income": income,
            "spent": max(spent, 0),
            "reconciled_spent": max(reconciled_spent, 0),
            "net": spent,
            "remaining": round(budget_amount - spent, 2),
            "percent": pct,
            "reconciled_percent": reconciled_pct,
            "period": b.period,
            "start_date": b.start_date.isoformat() if b.start_date else None,
            "end_date": b.end_date.isoformat() if b.end_date else None,
            "account_ids": acc_ids,
        })

    # Resolve account names for all budget results
    all_acc_ids = set()
    for r in result:
        all_acc_ids.update(r.get("account_ids") or [])
    acc_name_map = {}
    if all_acc_ids:
        for a in db.query(Account).filter(Account.id.in_(list(all_acc_ids))).all():
            acc_name_map[a.id] = a.name
    for r in result:
        r["account_names"] = [acc_name_map.get(aid, f"#{aid}") for aid in (r.get("account_ids") or [])]

    return {"year": y, "month": m, "budgets": result}


# ─── Budget transactions detail ───────────────────────────────────────────────

@router.get("/{budget_id}/transactions")
def get_budget_transactions(budget_id: int, year: int = None, month: int = None, db: Session = Depends(get_db)):
    """Return all transactions contributing to a budget envelope."""
    from datetime import date as _date
    today = _date.today()
    y = year or today.year
    m = month or today.month

    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")

    cats = [c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).all()]
    acc_ids = _parse_account_ids(b.account_ids)  # Improvement_04

    def _apply_account_filter(q):
        """Apply account scope filter to query if budget has account_ids."""
        if not acc_ids:
            return q
        from sqlalchemy import or_
        return q.filter(or_(
            Transaction.from_account_id.in_(acc_ids),
            Transaction.to_account_id.in_(acc_ids)
        ))

    if (b.envelope_type or "spending") == "savings" or b.is_project:
        # Savings (tirelire) and project envelopes: only transactions assigned via budget_id
        q = db.query(Transaction).filter(Transaction.budget_id == budget_id)
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif b.period == "indefinite":
        q = db.query(Transaction).filter(
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif b.period == "custom" and b.start_date and b.end_date:
        q = db.query(Transaction).filter(
            Transaction.date_operation >= b.start_date,
            Transaction.date_operation <= b.end_date,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif b.period == "yearly":
        # Yearly budgets: filter by full year only
        q = db.query(Transaction).filter(
            extract('year', Transaction.date_operation) == y,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    else:
        # Monthly budgets: filter by year + month
        q = db.query(Transaction).filter(
            extract('year', Transaction.date_operation) == y,
            extract('month', Transaction.date_operation) == m,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()

    return [{
        "id": tx.id,
        "date": tx.date_operation.isoformat(),
        "description": tx.description,
        "amount": tx.amount,
        "type": tx.type,
        "category": tx.category,
        "is_income": tx.type == "income",
        "is_reconciled": tx.reconciliation_date is not None,
    } for tx in txs]


# ─── AI Suggestion endpoint ───────────────────────────────────────────────────

def _compute_monthly_averages_for_ai(db: Session, already_used_cats: set, anchor_date: date) -> dict:
    """
    Compute TRUE monthly averages (total_per_cat / nb_months) for the LLM prompt.
    Uses a 12-month window ending at anchor_date.
    This is separate from the UI category averages used in the envelope modal badges.
    Returns {category_name: {"avg": float, "type": str, "top_descs": list[str]}}.
    """
    from dateutil.relativedelta import relativedelta
    from collections import defaultdict

    twelve_months_ago = anchor_date - relativedelta(months=12)

    # Query all transactions in the 12-month window
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= twelve_months_ago,
        Transaction.date_operation <= anchor_date,
        Transaction.type.in_(["expense_fixed", "expense_var", "income", "neutral"]),
    ).all()

    # Monthly sums per category + type tracking + description collection
    cat_monthly: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cat_type: dict[str, str] = {}
    cat_descriptions: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for tx in txs:
        cat = tx.category or "Sans catégorie"
        if cat in already_used_cats:
            continue

        month_key = tx.date_operation.strftime("%Y-%m")
        cat_monthly[cat][month_key] += abs(tx.amount)
        cat_type[cat] = tx.type  # Last seen type wins (categories have consistent types)

        desc = (tx.description or "").strip()
        if desc:
            cat_descriptions[cat][desc] += 1

    if not cat_monthly:
        return {}

    # Count how many distinct months had data in the window
    all_months = set()
    for monthly in cat_monthly.values():
        all_months.update(monthly.keys())
    nb_months = max(len(all_months), 1)

    result = {}
    for cat, monthly_sums in cat_monthly.items():
        total = sum(monthly_sums.values())
        avg = round(total / nb_months, 2)
        desc_counts = cat_descriptions.get(cat, {})
        top_descs = [d for d, _ in sorted(desc_counts.items(), key=lambda x: -x[1])[:5]]
        result[cat] = {
            "avg": avg,
            "type": cat_type.get(cat, "expense_var"),
            "top_descs": top_descs,
        }

    return result


@router.post("/ai_suggest")
def ai_suggest_budgets(db: Session = Depends(get_db)):
    """
    Analyse the last 6 months of spending per category and asks Ollama
    to suggest logical budget envelopes with amounts.
    Returns a list of proposals [{name, categories, suggested_amount}].
    """
    from app.routers.chat import get_ollama_config, call_ollama_sync

    cfg = get_ollama_config(db)
    if not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="IA non activée dans les paramètres.")

    # Get existing budgets to collect already assigned categories
    existing_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    already_used_cats = set()
    for b in existing_budgets:
        for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all():
            already_used_cats.add(c.category_name)

    print(f"[AI-SUGGEST] already_used_cats ({len(already_used_cats)}): {sorted(already_used_cats)}")

    # Anchor on the latest PAST transaction (not future recurrences),
    # so the 12-month window covers actual historical spending.
    latest_past_tx = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).first()
    anchor_date = latest_past_tx.date_operation if latest_past_tx else date.today()
    print(f"[AI-SUGGEST] Anchor date: {anchor_date}")

    # Debug: show ALL distinct categories in transactions within the window
    from dateutil.relativedelta import relativedelta as _rd
    _six = anchor_date - _rd(months=6)
    all_tx_cats = db.query(Transaction.category, Transaction.type).filter(
        Transaction.date_operation >= _six,
        Transaction.date_operation <= anchor_date,
    ).distinct().all()
    print(f"[AI-SUGGEST] ALL categories in transactions (6mo): {len(all_tx_cats)} found")

    # Compute true monthly averages for the LLM (separate from UI averages)
    cat_data = _compute_monthly_averages_for_ai(db, already_used_cats, anchor_date)

    if not cat_data:
        raise HTTPException(status_code=400, detail="Toutes vos dépenses sont déjà couvertes par vos enveloppes actuelles, ou aucune donnée suffisante.")

    # Group by transaction type for the prompt
    type_labels = {
        "expense_fixed": "Dépense fixe",
        "expense_var": "Dépense variable",
        "income": "Recette",
        "neutral": "Neutre",
    }
    type_groups: dict[str, list[str]] = {}
    for cat, info in sorted(cat_data.items(), key=lambda x: -x[1]["avg"]):
        t = info["type"]
        label = type_labels.get(t, t)
        if label not in type_groups:
            type_groups[label] = []
        desc_str = f" (Exemples : {', '.join(info['top_descs'])})" if info["top_descs"] else ""
        type_groups[label].append(f"  - {cat}: {info['avg']:.2f}€/mois{desc_str}")

    avg_lines_parts = []
    for group_label, lines in type_groups.items():
        avg_lines_parts.append(f"\n### {group_label}")
        avg_lines_parts.extend(lines)
    avg_lines = "\n".join(avg_lines_parts)

    nb_cats = len(cat_data)

    # Build explicit list of exact category names for the prompt
    exact_cat_names = ", ".join(f'"{c}"' for c in cat_data.keys())

    prompt = f"""Tu es un conseiller financier expert. Voici les dépenses moyennes mensuelles de l'utilisateur sur les 12 derniers mois, UNIQUEMENT pour les catégories qui ne sont PAS encore dans un budget. Elles sont regroupées par type de transaction :

{avg_lines}

IMPORTANT : Voici la liste EXACTE des {nb_cats} noms de catégories à utiliser (copie-les EXACTEMENT, sans modifier l'orthographe) :
{exact_cat_names}

Tu DOIS proposer suffisamment d'enveloppes pour que CHAQUE catégorie ci-dessus soit incluse dans exactement une enveloppe. Regroupe les catégories similaires si pertinent, mais ne laisse AUCUNE catégorie de côté. Ne réutilise JAMAIS la même catégorie dans deux enveloppes. Utilise UNIQUEMENT les noms exacts listés ci-dessus dans le champ "categories".
Pour chaque enveloppe, réponds UNIQUEMENT en JSON valide, un objet par ligne, avec ce format exact :
{{"name": "Nom de l'enveloppe", "categories": ["Cat1", "Cat2"], "suggested_amount": 250.00, "reason": "Explication courte"}}

Ne réponds rien d'autre que les lignes JSON. Pas de markdown, pas de texte autour."""

    # Request enough output tokens for all categories (num_predict),
    # without overriding the user's configured context window (num_ctx).
    print(f"[AI-SUGGEST] Envoi au LLM: {nb_cats} categories non couvertes")
    print(f"[AI-SUGGEST] Prompt ({len(prompt)} chars)")
    
    raw = call_ollama_sync(prompt, cfg, extra_options={"num_predict": 4096})

    print(f"[AI-SUGGEST] Reponse brute du LLM ({len(raw)} chars)")
    try:
        print(raw)
    except UnicodeEncodeError:
        print(raw.encode('ascii', 'replace').decode())

    # Strip markdown code fences that some models wrap around JSON
    import re
    raw = re.sub(r'```(?:json)?\s*', '', raw)

    proposals = []
    used_in_proposals = set()

    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith("{"):
            try:
                obj = json.loads(line)
                if "name" in obj and "suggested_amount" in obj:
                    cats = obj.get("categories", [])
                    # Deduplicate: keep only categories not yet assigned in this batch
                    clean_cats = [c for c in cats if c not in used_in_proposals and c in cat_data]
                    
                    if clean_cats: # Only add proposal if it still has valid categories
                        used_in_proposals.update(clean_cats)
                        proposals.append({
                            "name": obj["name"],
                            "categories": clean_cats,
                            "suggested_amount": float(obj["suggested_amount"]),
                            "reason": obj.get("reason", ""),
                        })
                        print(f"[AI-SUGGEST] [OK] Enveloppe acceptee: {obj['name']} -> {clean_cats}")
                    else:
                        print(f"[AI-SUGGEST] [WARN] Enveloppe rejetee (cats invalides/doublons): {obj.get('name')} -> {cats}")
            except Exception as e:
                print(f"[AI-SUGGEST] [ERR] Ligne JSON invalide: {line[:100]}... -> {e}")

    # Log uncovered categories
    covered = used_in_proposals
    uncovered = set(cat_data.keys()) - covered
    if uncovered:
        print(f"[AI-SUGGEST] [WARN] {len(uncovered)} categories NON couvertes par le LLM: {uncovered}")

    if not proposals:
        raise HTTPException(status_code=500, detail="L'IA n'a pas pu générer de propositions valides.")

    print(f"[AI-SUGGEST] [OK] {len(proposals)} enveloppes proposees, {len(covered)}/{nb_cats} categories couvertes")
    return {"proposals": proposals}


# ─── Allocation CRUD (for savings / tirelire envelopes) ───────────────────────

@router.get("/{budget_id}/allocations")
def get_allocations(budget_id: int, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")
    allocs = db.query(BudgetAllocation).filter(
        BudgetAllocation.budget_id == budget_id
    ).order_by(BudgetAllocation.date.desc()).all()
    return [
        {
            "id": a.id,
            "budget_id": a.budget_id,
            "amount": a.amount,
            "date": a.date.isoformat() if a.date else None,
            "note": a.note,
            "account_id": a.account_id,
            "created_at": a.created_at,
        }
        for a in allocs
    ]


@router.post("/{budget_id}/allocations")
def create_allocation(budget_id: int, data: AllocationCreate, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")
        
    # Validation for withdrawals: cannot withdraw more than what is hosted on the target account
    if data.amount < 0:
        from app.services.finance_engine import get_main_account
        main_account = get_main_account(db)
        main_acc_id = main_account.id if main_account else None
        
        target_acc_id = data.account_id if data.account_id is not None else main_acc_id
        
        allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == budget_id).all()
        current_hosted = 0.0
        for a in allocs:
            a_acc_id = a.account_id if a.account_id is not None else main_acc_id
            if a_acc_id == target_acc_id:
                current_hosted += a.amount
                
        withdrawal_amount = abs(data.amount)
        if withdrawal_amount > round(current_hosted, 2) + 0.001:
            acc_obj = db.query(Account).filter(Account.id == target_acc_id).first() if target_acc_id else None
            acc_name = acc_obj.name if acc_obj else "Compte principal"
            raise HTTPException(
                status_code=400,
                detail=f"Retrait impossible : le compte '{acc_name}' ne contient que {round(current_hosted, 2):,.2f} € d'épargne dans cette tirelire.".replace(",", " ").replace(".", ",")
            )

    from datetime import datetime
    alloc = BudgetAllocation(
        budget_id=budget_id,
        amount=data.amount,
        date=_safe_parse_budget_date(data.date, "date") if data.date else date.today(),
        note=data.note,
        account_id=data.account_id,
        created_at=datetime.now().isoformat(),
    )
    db.add(alloc)
    db.flush()
    action_id = record_action(db, "budget_allocation", alloc.id, "CREATE", None, snapshot_entity(alloc))
    db.commit()
    db.refresh(alloc)
    return {
        "id": alloc.id,
        "budget_id": alloc.budget_id,
        "amount": alloc.amount,
        "date": alloc.date.isoformat() if alloc.date else None,
        "note": alloc.note,
        "account_id": alloc.account_id,
        "created_at": alloc.created_at,
        "action_id": action_id,
    }


@router.get("/capacity")
def get_budget_capacity(db: Session = Depends(get_db)):
    """
    Returns the budget capacity metrics:
    - Monthly: Sum of active monthly budgets vs monthly average income (last 6 months).
    - Yearly: Sum of active yearly budgets vs yearly average income (last 12 months).
    - Available balances per account (real vs available after deducting savings).
    """
    from datetime import date, timedelta
    from app.services.finance_engine import get_accounts_available_balances
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    one_year_ago = today - timedelta(days=365)
    
    start_of_year = date(today.year, 1, 1)
    remaining_months = 12 - today.month

    # 1. Check if we are in Org Mode or Personal Mode
    org_mode_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
    is_org_mode = (org_mode_conf and org_mode_conf.value == "true")
    
    # Query all income transactions for YTD and 6-month calculations
    income_txs = db.query(Transaction.amount, Transaction.date_operation).filter(
        Transaction.type == "income",
        Transaction.date_operation >= one_year_ago,
        Transaction.date_operation <= today
    ).all()

    ytd_income = sum(tx.amount for tx in income_txs if tx.date_operation >= start_of_year)
    six_month_income = sum(tx.amount for tx in income_txs if tx.date_operation >= six_months_ago)
    
    avg_monthly_income = 0.0
    if not is_org_mode:
        from app.services.finance_engine import predict_next_paycheck
        paycheck_data = predict_next_paycheck(db)
        if paycheck_data and paycheck_data.get("amount", 0.0) > 0:
            avg_monthly_income = round(paycheck_data["amount"], 2)
            
    if avg_monthly_income == 0.0:
        avg_monthly_income = round(six_month_income / 6.0, 2)
        
    # Projected yearly income: YTD actual income + (remaining months * baseline monthly income)
    avg_yearly_income = round(ytd_income + (remaining_months * avg_monthly_income), 2)
    
    # 2. Calculate actual historical expenses (for YTD and fallback)
    expense_txs = db.query(Transaction.amount, Transaction.date_operation).filter(
        Transaction.type.in_(["expense_fixed", "expense_var"]),
        Transaction.date_operation >= one_year_ago,
        Transaction.date_operation <= today
    ).all()
    
    ytd_expenses = sum(abs(tx.amount) for tx in expense_txs if tx.date_operation >= start_of_year)
    six_month_expenses = sum(abs(tx.amount) for tx in expense_txs if tx.date_operation >= six_months_ago)
    
    avg_monthly_expenses = round(six_month_expenses / 6.0, 2)
    # Projected yearly expenses for fallback: YTD actual + (remaining months * avg monthly expenses)
    avg_yearly_expenses = round(ytd_expenses + (remaining_months * avg_monthly_expenses), 2)
    
    # 3. Sum active budget allocations
    active_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    explicit_monthly_budgeted = sum(b.monthly_amount for b in active_budgets if b.period in ("monthly", None) and (b.envelope_type or "spending") != "savings")
    explicit_yearly_budgeted = sum(b.monthly_amount for b in active_budgets if b.period == "yearly" and (b.envelope_type or "spending") != "savings")
    
    # Monthly capacity: use explicit monthly envelopes if any, else fallback to historical average expenses
    is_monthly_fallback = False
    if explicit_monthly_budgeted > 0:
        effective_monthly_budgeted = explicit_monthly_budgeted
    else:
        effective_monthly_budgeted = avg_monthly_expenses
        is_monthly_fallback = True

    # Yearly capacity: use explicit yearly envelopes + annualized monthly envelopes if any, else fallback to historical average expenses
    is_yearly_fallback = False
    if explicit_yearly_budgeted > 0 or explicit_monthly_budgeted > 0:
        effective_yearly_budgeted = explicit_yearly_budgeted + (explicit_monthly_budgeted * 12.0)
    else:
        effective_yearly_budgeted = avg_yearly_expenses
        is_yearly_fallback = True

    # Build detailed calculation explanations for tooltips (income & budgeted/expenses)
    if not is_org_mode and avg_monthly_income > 0 and paycheck_data and paycheck_data.get("amount", 0.0) > 0:
        monthly_details_fr = "Basé sur votre salaire mensuel prédit / configuré."
        monthly_details_en = "Based on your predicted / configured monthly salary."
        
        yearly_details_fr = f"Recettes réelles de l'année en cours (YTD : {round(ytd_income, 2):,.2f} €) + salaires prévus pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_details_en = f"Actual YTD receipts ({round(ytd_income, 2):,.2f} €) + projected salary for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €)."
    else:
        monthly_details_fr = "Basé sur la moyenne glissante des recettes des 6 derniers mois."
        monthly_details_en = "Based on the 6-month rolling average of receipts."
        
        yearly_details_fr = f"Recettes réelles de l'année en cours (YTD : {round(ytd_income, 2):,.2f} €) + recettes moyennes pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_details_en = f"Actual YTD receipts ({round(ytd_income, 2):,.2f} €) + average receipts for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €)."

    # Budgeted / Expenses calculation details
    if is_monthly_fallback:
        monthly_budgeted_details_fr = f"Moyenne glissante des dépenses réelles des 6 derniers mois ({round(six_month_expenses, 2):,.2f} € / 6).".replace(",", " ").replace(".", ",")
        monthly_budgeted_details_en = f"Rolling 6-month average of actual expenses ({round(six_month_expenses, 2):,.2f} € / 6)."
    else:
        monthly_budgeted_details_fr = "Somme de vos enveloppes mensuelles actives configurées."
        monthly_budgeted_details_en = "Sum of your configured active monthly envelopes."

    if is_yearly_fallback:
        yearly_budgeted_details_fr = f"Dépenses réelles de l'année en cours (YTD : {round(ytd_expenses, 2):,.2f} €) + dépenses moyennes pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_expenses, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_budgeted_details_en = f"Actual YTD expenses ({round(ytd_expenses, 2):,.2f} €) + average expenses for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_expenses, 2):,.2f} €)."
    else:
        yearly_budgeted_details_fr = "Somme des enveloppes annuelles + (enveloppes mensuelles × 12)."
        yearly_budgeted_details_en = "Sum of yearly envelopes + (monthly envelopes × 12)."

    # 4. Available balances
    account_balances = get_accounts_available_balances(db)
    
    return {
        "monthly": {
            "budgeted": round(effective_monthly_budgeted, 2),
            "average_income": avg_monthly_income,
            "engagement_ratio": round((effective_monthly_budgeted / avg_monthly_income * 100) if avg_monthly_income > 0 else 0, 1),
            "is_fallback": is_monthly_fallback,
            "details_fr": monthly_details_fr,
            "details_en": monthly_details_en,
            "budgeted_details_fr": monthly_budgeted_details_fr,
            "budgeted_details_en": monthly_budgeted_details_en,
        },
        "yearly": {
            "budgeted": round(effective_yearly_budgeted, 2),
            "average_income": avg_yearly_income,
            "engagement_ratio": round((effective_yearly_budgeted / avg_yearly_income * 100) if avg_yearly_income > 0 else 0, 1),
            "is_fallback": is_yearly_fallback,
            "details_fr": yearly_details_fr,
            "details_en": yearly_details_en,
            "budgeted_details_fr": yearly_budgeted_details_fr,
            "budgeted_details_en": yearly_budgeted_details_en,
        },
        "accounts": list(account_balances.values())
    }


@router.delete("/{budget_id}/allocations/{alloc_id}")
def delete_allocation(budget_id: int, alloc_id: int, db: Session = Depends(get_db)):
    alloc = db.query(BudgetAllocation).filter(
        BudgetAllocation.id == alloc_id,
        BudgetAllocation.budget_id == budget_id
    ).first()
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation non trouvée.")
    old_snapshot = snapshot_entity(alloc)
    db.delete(alloc)
    action_id = record_action(db, "budget_allocation", alloc_id, "DELETE", old_snapshot, None)
    db.commit()
    return {"ok": True, "action_id": action_id}
