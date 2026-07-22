from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import extract
from pydantic import BaseModel
from datetime import date
from typing import Optional, List
import json
import logging
import re
from collections import defaultdict
from app.database import get_db
from app.models import Budget, BudgetCategory, BudgetAllocation, Transaction, GlobalConfig, Account
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

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



class BulkDeleteRequest(BaseModel):
    target_type: str  # "monthly", "yearly", "spending", "project", "savings", "all"


@router.post("/bulk_delete")
def bulk_delete_budgets(data: BulkDeleteRequest, db: Session = Depends(get_db)):
    query = db.query(Budget).filter(Budget.is_closed == False)
    if data.target_type == "monthly":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None), (Budget.period == "monthly") | (Budget.period == None))
    elif data.target_type == "yearly":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None), Budget.period == "yearly")
    elif data.target_type == "spending":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None))
    elif data.target_type == "project":
        query = query.filter(Budget.is_project == True)
    elif data.target_type == "savings":
        query = query.filter(Budget.envelope_type == "savings")
    elif data.target_type == "all":
        pass
    else:
        raise HTTPException(status_code=400, detail="Type d'enveloppe invalide.")

    budgets_to_delete = query.all()
    deleted_count = len(budgets_to_delete)
    if not budgets_to_delete:
        return {"ok": True, "deleted_count": 0}

    budget_ids = [b.id for b in budgets_to_delete]
    db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_(budget_ids)).delete(synchronize_session=False)
    db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(budget_ids)).delete(synchronize_session=False)
    for b in budgets_to_delete:
        old_snapshot = snapshot_entity(b, db)
        record_action(db, "budget", b.id, "DELETE", old_snapshot, None)
        db.delete(b)

    db.commit()
    return {"ok": True, "deleted_count": deleted_count}


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

def _compute_monthly_averages_for_ai(db: Session, already_used_cats: set, anchor_date: date, window_months: int = 3) -> dict:
    """
    Compute monthly averages and stats for the LLM prompt based on a configurable window (3, 6, or 12 months).
    Detects fixed charges (CV < 2%) and exceptional project expenses.
    """
    from dateutil.relativedelta import relativedelta
    from collections import defaultdict
    import statistics

    window_start = anchor_date - relativedelta(months=window_months)
    # Ensure current month full coverage up to end of current month
    end_of_current_month = date(anchor_date.year, anchor_date.month, 1) + relativedelta(months=1, days=-1)

    # Query expense transactions in the window (including standard 'expense' type and any negative amounts)
    from sqlalchemy import or_
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= window_start,
        Transaction.date_operation <= end_of_current_month,
        or_(
            Transaction.type.in_(["expense", "expense_fixed", "expense_var"]),
            Transaction.amount < 0
        )
    ).all()

    cat_monthly: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cat_type: dict[str, str] = {}
    cat_descriptions: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    cat_amounts_list: dict[str, list[float]] = defaultdict(list)

    for tx in txs:
        # Guarantee strictly that neutral/transfer operations (type 'transfer', 'neutral' or having from/to account) are excluded
        if tx.type in ["transfer", "neutral"] or (tx.from_account_id and tx.to_account_id):
            continue

        cat = tx.category or "Sans catégorie"
        if cat in already_used_cats:
            continue

        month_key = tx.date_operation.strftime("%Y-%m")
        amt = abs(tx.amount)
        cat_monthly[cat][month_key] += amt
        cat_amounts_list[cat].append(amt)
        cat_type[cat] = tx.type

        desc = (tx.description or "").strip()
        if desc:
            cat_descriptions[cat][desc] += 1

    # Pre-fetch RecurrenceTemplates to detect explicitly declared yearly/bi-annual recurrences per category
    from app.models import RecurrenceTemplate
    recurrence_templates = db.query(RecurrenceTemplate).all()
    yearly_recurrence_cats = set()
    yearly_recurrence_sums = defaultdict(float)

    for t in recurrence_templates:
        freq_lower = (t.frequency or "").lower()
        if freq_lower in ("yearly", "semi-annually", "bi-annually", "annuel", "bi-annuel") or t.month_of_year is not None:
            if t.category:
                yearly_recurrence_cats.add(t.category)
                yearly_recurrence_sums[t.category] += abs(t.amount or 0.0)

    # Fetch all registered categories in DB to ensure no unused category is omitted
    from app.models import Category
    db_cat_names = set(c[0] for c in db.query(Category.name).all() if c[0])
    tx_cat_names = set(c[0] for c in db.query(Transaction.category).distinct().all() if c[0])
    all_all_cats = (db_cat_names | tx_cat_names) - already_used_cats

    if not cat_monthly and not all_all_cats:
        return {}

    # Calculate overall median monthly spending per active category to detect exceptional spikes
    all_cat_totals = [sum(m.values()) / max(len(m), 1) for m in cat_monthly.values()]
    median_cat_avg = statistics.median(all_cat_totals) if all_cat_totals else 100.0

    result = {}
    # 1. Process active categories with transactions in analysis window
    for cat, monthly_sums in cat_monthly.items():
        total = sum(monthly_sums.values())
        active_months_cnt = len(monthly_sums)
        # Average monthly expenditure across the full analysis window for variable expenses
        avg = round(total / max(window_months, 1), 2)
        
        desc_counts = cat_descriptions.get(cat, {})
        top_descs = [d for d, _ in sorted(desc_counts.items(), key=lambda x: -x[1])[:5]]
        
        # Fixed amount detection: For expense_fixed, use the exact sum of the most recent active month
        monthly_values = list(monthly_sums.values())
        is_fixed = (cat_type.get(cat) == "expense_fixed")
        fixed_amount = round(total / max(active_months_cnt, 1), 2)

        if is_fixed and monthly_values:
            # Find the most recent active month's exact sum for this fixed category
            sorted_months = sorted(monthly_sums.keys(), reverse=True)
            most_recent_month = sorted_months[0]
            fixed_amount = round(monthly_sums[most_recent_month], 2)
        elif len(cat_amounts_list[cat]) >= 2:
            amounts = cat_amounts_list[cat]
            if len(set(amounts)) == 1:
                is_fixed = True
                fixed_amount = round(amounts[0], 2)

        # Exceptional project expense detection (2x median & <= 2 active months)
        is_exceptional = (avg > (2.0 * median_cat_avg)) and (active_months_cnt <= 2) and (cat_type.get(cat) == "expense_var")

        # Period detection: PRIORITIZE explicit RecurrenceTemplate frequency if registered as yearly/semi-annually
        if cat in yearly_recurrence_cats:
            suggested_period = "yearly"
            # Use exact sum from recurrence template if available, else sum of actual occurrences
            rec_total = yearly_recurrence_sums.get(cat, 0.0)
            total_year_val = round(rec_total if rec_total > 0 else total, 2)
        else:
            # Variable/Fixed expense period classification:
            # Everyday variable expenses default to "monthly".
            # Only classify as "yearly" if:
            # - It is an exceptional project expense (large single purchase)
            # - OR it is a fixed charge/subscription with 1 single payment per year (active_months_cnt == 1 when window_months >= 6)
            if is_exceptional:
                suggested_period = "yearly"
            elif is_fixed and active_months_cnt == 1 and window_months >= 6:
                suggested_period = "yearly"
            else:
                suggested_period = "monthly"
            total_year_val = round(total, 2)

        # Calculate current active month spent and 3-month recent average
        current_month_key = anchor_date.strftime("%Y-%m")
        current_month_spent = round(monthly_sums.get(current_month_key, 0.0), 2)

        m3_keys = [(anchor_date - relativedelta(months=i)).strftime("%Y-%m") for i in range(3)]
        sum_3m = sum(monthly_sums.get(k, 0.0) for k in m3_keys)
        recent_3m_avg = round(sum_3m / 3.0, 2)

        result[cat] = {
            "avg": fixed_amount if is_fixed else avg,
            "current_month_spent": current_month_spent,
            "recent_3m_avg": recent_3m_avg,
            "total_year": total_year_val,
            "active_months_cnt": active_months_cnt,
            "suggested_period": suggested_period,
            "type": cat_type.get(cat, "expense_var"),
            "top_descs": top_descs,
            "is_fixed": is_fixed,
            "fixed_amount": fixed_amount,
            "is_exceptional": is_exceptional,
        }

    # 2. Process inactive unused categories (no transactions in analysis window)
    for cat in all_all_cats:
        if cat not in result:
            result[cat] = {
                "avg": 0.0,
                "current_month_spent": 0.0,
                "recent_3m_avg": 0.0,
                "total_year": 0.0,
                "active_months_cnt": 0,
                "suggested_period": "monthly",
                "type": "expense_var",
                "top_descs": [],
                "is_fixed": False,
                "fixed_amount": 0.0,
                "is_exceptional": False,
            }

    return result


import time

AI_TASK_STATUS = {
    "state": "IDLE",
    "step_key": "ai_status_preparing",
    "elapsed_seconds": 0,
    "max_seconds": 300,
    "result": None,
    "error": None,
    "start_time": None,
}


class AiSuggestRequest(BaseModel):
    window_months: int = 3
    lang: Optional[str] = "fr"


def _extract_json_envelopes(cleaned_raw: str) -> list[dict]:
    """
    Robustly parses LLM JSON outputs supporting multiple envelope schema formats:
    - Array of objects: [{"name": "Santé", "categories": ["Dentiste"]}]
    - Wrapped dict: {"envelopes": [{"name": "Santé", "categories": ["Dentiste"]}]}
    - Key-value dict mapping envelope name to categories array: {"Santé": ["Dentiste"], "Assurances": ["Assurance"]}
    - Regex fallback for loose/truncated JSON objects
    """
    parsed_objs = []
    
    # 1. Direct json parse
    try:
        data_json = json.loads(cleaned_raw)
        if isinstance(data_json, list):
            for item in data_json:
                if isinstance(item, dict):
                    if "name" in item or "title" in item or "enveloppe" in item:
                        parsed_objs.append(item)
                    elif len(item) == 1:
                        k, v = next(iter(item.items()))
                        if isinstance(v, list):
                            parsed_objs.append({"name": k, "categories": v})
        elif isinstance(data_json, dict):
            # Check wrapper list keys
            for key in ["envelopes", "proposals", "enveloppes", "budgets", "categories", "suggestions", "items", "data", "result", "enveloppes_budgetaires", "propositions"]:
                if key in data_json and isinstance(data_json[key], list):
                    for item in data_json[key]:
                        if isinstance(item, dict):
                            if "name" in item or "title" in item or "enveloppe" in item:
                                parsed_objs.append(item)
                            elif len(item) == 1:
                                k, v = next(iter(item.items()))
                                if isinstance(v, list):
                                    parsed_objs.append({"name": k, "categories": v})
                    break

            if not parsed_objs:
                # Direct key-value dict: {"Santé": ["Dentiste"], "Assurances": ["Assurance"]}
                for k, v in data_json.items():
                    if isinstance(v, list) and len(v) > 0:
                        if isinstance(v[0], str):
                            parsed_objs.append({"name": k, "categories": v})
                        elif isinstance(v[0], dict):
                            parsed_objs.extend(v)
    except Exception as err:
        logger.warning(f"[AI Budget] Échec json.loads: {err}")

    # 2. Extract outermost JSON array [...]
    if not parsed_objs:
        array_match = re.search(r'\[.*\]', cleaned_raw, re.DOTALL)
        if array_match:
            try:
                data = json.loads(array_match.group(0))
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            if "name" in item or "title" in item or "enveloppe" in item:
                                parsed_objs.append(item)
            except Exception:
                pass

    # 3. Fallback to line-by-line or regex object extraction
    if not parsed_objs:
        matches = re.findall(r'\{[^{}]*\}', cleaned_raw, re.DOTALL)
        for m in matches:
            try:
                item = json.loads(m)
                if isinstance(item, dict):
                    if "name" in item or "title" in item or "enveloppe" in item:
                        parsed_objs.append(item)
            except Exception:
                pass

    return parsed_objs


@router.get("/ai_suggest/status")
def get_ai_suggest_status():
    if AI_TASK_STATUS["state"] in ["PREPARING", "SENDING", "THINKING", "PARSING"] and AI_TASK_STATUS.get("start_time"):
        AI_TASK_STATUS["elapsed_seconds"] = int(time.time() - AI_TASK_STATUS["start_time"])
    return AI_TASK_STATUS


@router.post("/ai_suggest/cancel")
def cancel_ai_suggest():
    global AI_TASK_STATUS
    AI_TASK_STATUS.update({
        "state": "IDLE",
        "step_key": "ai_status_idle",
        "elapsed_seconds": 0,
        "start_time": None,
        "error": None,
    })
    return {"status": "cancelled"}


@router.post("/ai_suggest")
def ai_suggest_budgets(data: Optional[AiSuggestRequest] = None, db: Session = Depends(get_db)):
    """
    Analyse spending per category over window_months and asks Ollama to suggest budget envelopes.
    Enforces salary capping, fixed charge exactness, and exceptional project separation.
    """
    from app.routers.chat import get_ollama_config, call_ollama_sync
    from app.services.finance_engine import predict_next_paycheck

    global AI_TASK_STATUS
    AI_TASK_STATUS.update({
        "state": "PREPARING",
        "step_key": "ai_status_preparing",
        "elapsed_seconds": 0,
        "max_seconds": 300,
        "result": None,
        "error": None,
        "start_time": time.time(),
    })

    window_months = data.window_months if data and data.window_months in (3, 6, 12) else 3

    cfg = get_ollama_config(db)
    if not cfg.get("enabled"):
        AI_TASK_STATUS["state"] = "ERROR"
        AI_TASK_STATUS["error"] = "IA non activée dans les paramètres."
        raise HTTPException(status_code=400, detail="IA non activée dans les paramètres.")

    # 1. Get predicted regular salary
    paycheck_info = predict_next_paycheck(db)
    regular_salary = paycheck_info.get("amount", 0.0) if paycheck_info else 0.0

    # 2. Get existing budgets to collect used categories and engaged monthly capacity
    existing_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    already_used_cats = set()
    already_engaged_monthly = 0.0

    for b in existing_budgets:
        if (b.envelope_type or "spending") != "savings":
            if b.period == "yearly":
                already_engaged_monthly += (b.monthly_amount / 12.0)
            else:
                already_engaged_monthly += b.monthly_amount
        for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all():
            already_used_cats.add(c.category_name)

    available_monthly_budget = max(0.0, regular_salary - already_engaged_monthly)

    # 3. Anchor date
    latest_past_tx = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).first()
    anchor_date = latest_past_tx.date_operation if latest_past_tx else date.today()

    cat_data = _compute_monthly_averages_for_ai(db, already_used_cats, anchor_date, window_months=window_months)

    # Auto-extend analysis window to 6m or 12m if no transactions found in requested window for unused categories
    active_cats = [c for c, info in cat_data.items() if info.get("avg", 0) > 0 or info.get("total_year", 0) > 0]
    effective_window = window_months
    if len(active_cats) == 0 and window_months < 12:
        for try_w in (6, 12):
            if try_w > window_months:
                try_data = _compute_monthly_averages_for_ai(db, already_used_cats, anchor_date, window_months=try_w)
                try_active = [c for c, info in try_data.items() if info.get("avg", 0) > 0 or info.get("total_year", 0) > 0]
                if len(try_active) > 0 or try_w == 12:
                    cat_data = try_data
                    effective_window = try_w
                    window_months = try_w
                    logger.info(f"[AI Budget] Auto-extended analysis window to {effective_window} months")
                    break

    if not cat_data:
        raise HTTPException(status_code=400, detail="Toutes vos dépenses sont déjà couvertes par vos enveloppes actuelles.")

    nb_cats = len(cat_data)

    cat_lines = []
    for cat, info in sorted(cat_data.items(), key=lambda x: -x[1]["avg"]):
        period_str = "ANNUAL" if info.get("suggested_period") == "yearly" else "MONTHLY"
        fix_str = "FIXED" if info["is_fixed"] else "VARIABLE"
        desc_str = f" | Examples: {', '.join(info['top_descs'][:3])}" if info["top_descs"] else ""
        cat_lines.append(f'- Category: "{cat}" | Recurrence: {period_str} | Type: {fix_str}{desc_str}')
    formatted_cats = "\n".join(cat_lines)

    target_lang = "English" if (data and data.lang == "en") else "French"

    prompt = f"""You are an expert personal financial advisor. Analyze these {nb_cats} real financial spending categories:

{formatted_cats}

TASK: Group these categories into 10 to 14 precise, targeted thematic budget envelopes.

RULES:
1. Create between 10 and 14 specific envelopes. Do not create huge mixed groups.
2. Separate loans/mortgages from insurance, telecom from cloud services, and vehicle maintenance from toll fees.
3. In the "categories" list for each envelope, include ONLY the exact category names from the input list.
4. EVERY input category MUST be assigned to an envelope.

LANGUAGE REQUIREMENT:
Write all envelope names and reason justifications in {target_lang}.

Response format (JSON object with key "envelopes"):
{{
  "envelopes": [
    {{"name": "Envelope Name in {target_lang}", "categories": ["ExactCatName1", "ExactCatName2"], "reason": "Justification in {target_lang}"}},
    ...
  ]
}}"""

    # Pass format="json" and num_predict=4000 (sufficient for 10-14 JSON envelopes)
    AI_TASK_STATUS["state"] = "SENDING"
    AI_TASK_STATUS["step_key"] = "ai_status_sending"

    try:
        raw = call_ollama_sync(prompt, cfg, extra_options={"num_predict": 4000, "format": "json"})
    except Exception as e:
        AI_TASK_STATUS["state"] = "ERROR"
        AI_TASK_STATUS["step_key"] = "ai_status_error"
        AI_TASK_STATUS["error"] = str(e)
        raise e

    AI_TASK_STATUS["state"] = "PARSING"
    AI_TASK_STATUS["step_key"] = "ai_status_parsing"

    import re
    cleaned_raw = re.sub(r'```(?:json)?', '', raw).strip()
    parsed_objs = _extract_json_envelopes(cleaned_raw)
    logger.debug(f"[AI Budget] {len(parsed_objs)} objets JSON parsés depuis la réponse LLM")

    import unicodedata
    from difflib import SequenceMatcher

    def _normalize_cat_key(s: str) -> str:
        if not s:
            return ""
        s = unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('utf-8')
        s = re.sub(r'[^a-z0-9]', ' ', s.lower())
        words = [re.sub(r's$', '', w) for w in s.split() if w]
        return ''.join(words)

    # Build a fuzzy lookup: normalize category names (lowercase, stemmed ASCII) to match LLM variations
    cat_name_lookup = {_normalize_cat_key(real_name): real_name for real_name in cat_data.keys()}

    def _resolve_cat_name(llm_name):
        """Resolve an LLM-returned category name to the real cat_data key safely."""
        if not llm_name or not isinstance(llm_name, str):
            return None
        
        # Clean up any potential bracketed/parenthesized annotations attached by LLM
        clean_llm_raw = re.sub(r'\[.*?\]|\(.*?\)', '', llm_name).strip()

        # 1. Direct string match
        if clean_llm_raw in cat_data:
            return clean_llm_raw
        if llm_name in cat_data:
            return llm_name
            
        clean_llm = _normalize_cat_key(clean_llm_raw)
        if not clean_llm:
            return None

        # 2. Exact normalized lookup match
        if clean_llm in cat_name_lookup:
            return cat_name_lookup[clean_llm]

        # 3. Substring & Similarity ratio match
        candidates = []
        for clean_key, real_name in cat_name_lookup.items():
            if clean_key == clean_llm:
                return real_name
            if clean_key in clean_llm or clean_llm in clean_key:
                candidates.append((len(clean_key), real_name))
            else:
                ratio = SequenceMatcher(None, clean_key, clean_llm).ratio()
                if ratio >= 0.65:
                    candidates.append((ratio * 10, real_name))

        if candidates:
            candidates.sort(key=lambda x: -x[0])
            return candidates[0][1]

        return None

    proposals = []
    used_in_proposals = set()

    # --- Helper to build a proposal dict from a list of categories ---
    def _build_proposal(name, sub_cats, reason_override=None):
        is_all_fixed = all(cat_data[c]["is_fixed"] or cat_data[c]["type"] == "expense_fixed" for c in sub_cats)
        all_exceptional = all(cat_data[c]["is_exceptional"] for c in sub_cats)
        
        yearly_count = sum(1 for c in sub_cats if cat_data[c].get("suggested_period") == "yearly")
        monthly_count = len(sub_cats) - yearly_count
        suggested_period = "yearly" if yearly_count > monthly_count else "monthly"

        cat_amounts = {}
        for c in sub_cats:
            c_period = cat_data[c].get("suggested_period", "monthly")
            c_is_fixed = cat_data[c]["is_fixed"]
            c_fixed_val = cat_data[c]["fixed_amount"]
            c_avg_val = cat_data[c]["avg"]
            c_tot_yr = cat_data[c]["total_year"]

            if suggested_period == "yearly":
                # Proposal is yearly: yearly items contribute total_year, monthly items contribute avg * 12
                val = c_tot_yr if c_period == "yearly" else round((c_fixed_val if c_is_fixed else c_avg_val) * 12.0, 2)
            else:
                # Proposal is monthly: monthly items contribute fixed or avg, yearly items contribute total_year / 12
                val = (c_fixed_val if c_is_fixed else c_avg_val) if c_period == "monthly" else round(c_tot_yr / 12.0, 2)
            
            cat_amounts[c] = val

        base_amount = round(sum(cat_amounts.values()), 2)

        top_merchants = []
        for c in sub_cats:
            top_merchants.extend(cat_data[c]["top_descs"])
        unique_merchants = list(dict.fromkeys(top_merchants))[:4]
        merchant_str = f" ({', '.join(unique_merchants)})" if unique_merchants else ""
        cats_str = ", ".join(sub_cats)

        if is_all_fixed:
            if data and data.lang == "en":
                cats_str = ", ".join(sub_cats)
                merchant_str = f" with sample transactions: {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Contractual fixed expense ({cats_str}){merchant_str}."
            else:
                cats_str = ", ".join(sub_cats)
                merchant_str = f" avec exemples d'opérations : {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Charge fixe contractuelle ({cats_str}){merchant_str}."
        elif all_exceptional:
            if data and data.lang == "en":
                cats_str = ", ".join(sub_cats)
                merchant_str = f" with sample transactions: {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"One-off/project expense detected ({cats_str}){merchant_str}."
            else:
                cats_str = ", ".join(sub_cats)
                merchant_str = f" avec exemples d'opérations : {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Dépense ponctuelle/projet détectée ({cats_str}){merchant_str}."
        else:
            if data and data.lang == "en":
                cats_str = ", ".join(sub_cats)
                merchant_str = f" with sample transactions: {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Based on the last {window_months} months ({cats_str}){merchant_str}."
            else:
                cats_str = ", ".join(sub_cats)
                merchant_str = f" avec exemples d'opérations : {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Basé sur les {window_months} derniers mois ({cats_str}){merchant_str}."

        cat_details = {
            c: {"amount": cat_amounts[c], "top_descs": cat_data[c]["top_descs"], "is_fixed": cat_data[c]["is_fixed"]}
            for c in sub_cats
        }

        # Calculate real historical actual spent for these categories
        if suggested_period == "yearly":
            historical_actual_amount = round(sum(cat_data[c]["total_year"] for c in sub_cats), 2)
        else:
            historical_actual_amount = round(sum(cat_data[c]["avg"] for c in sub_cats), 2)

        current_month_spent = round(sum(cat_data[c].get("current_month_spent", 0.0) for c in sub_cats), 2)
        recent_3m_avg = round(sum(cat_data[c].get("recent_3m_avg", 0.0) for c in sub_cats), 2)

        return {
            "name": name,
            "categories": sub_cats,
            "cat_amounts": cat_amounts,
            "cat_details": cat_details,
            "suggested_amount": base_amount,
            "historical_actual_amount": historical_actual_amount,
            "current_month_spent": current_month_spent,
            "recent_3m_avg": recent_3m_avg,
            "suggested_period": suggested_period,
            "is_fixed": is_all_fixed,
            "has_fixed_mix": False,
            "fixed_sum": base_amount if is_all_fixed else 0.0,
            "is_exceptional": all_exceptional,
            "justification": reason_override or justification,
        }

    for obj in parsed_objs:
        if isinstance(obj, dict):
            name = obj.get("name") or obj.get("title") or obj.get("enveloppe") or obj.get("label") or obj.get("nom")
            reason = obj.get("reason") or obj.get("justification") or obj.get("description") or obj.get("motif")
            cats = obj.get("categories") or obj.get("cats") or obj.get("category_list") or obj.get("items") or obj.get("liste") or []
            
            if isinstance(cats, str):
                try:
                    cats = json.loads(cats)
                except Exception:
                    cats = [c.strip().strip('"').strip("'") for c in cats.split(',') if c.strip()]
            
            if not name or not cats or not isinstance(cats, list):
                continue

            # Resolve LLM category names to real cat_data keys (fuzzy & stemmed match)
            resolved_cats = []
            for c in cats:
                real = _resolve_cat_name(c)
                if real and real not in used_in_proposals:
                    resolved_cats.append(real)
            clean_cats = resolved_cats

            if clean_cats:
                # Only split if the LLM mixed monthly and yearly categories in the same envelope
                monthly_cats = [c for c in clean_cats if cat_data[c].get("suggested_period", "monthly") == "monthly"]
                yearly_cats = [c for c in clean_cats if cat_data[c].get("suggested_period") == "yearly"]

                if monthly_cats and yearly_cats:
                    # Real mix: split into two sub-proposals, preserving original LLM name
                    used_in_proposals.update(clean_cats)
                    proposals.append(_build_proposal(f"{name}", monthly_cats, reason))
                    proposals.append(_build_proposal(f"{name} (Annuels)", yearly_cats, reason))
                else:
                    # No mix: keep the LLM's envelope intact
                    used_in_proposals.update(clean_cats)
                    proposals.append(_build_proposal(name, clean_cats, reason))

    # Collect unclassified orphan categories
    orphan_cats = [c for c in cat_data.keys() if c not in used_in_proposals]
    logger.debug(f"[AI Budget] {len(proposals)} enveloppes LLM acceptées, {len(orphan_cats)} catégories non classées sur {len(cat_data)}")
    
    unclassified_categories = []
    for c in orphan_cats:
        unclassified_categories.append({
            "name": c,
            "avg": cat_data[c]["avg"],
            "current_month_spent": cat_data[c].get("current_month_spent", 0.0),
            "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0),
            "total_year": cat_data[c].get("total_year", 0.0),
            "suggested_period": cat_data[c].get("suggested_period", "monthly"),
            "top_descs": cat_data[c].get("top_descs", []),
        })

    if not proposals and not unclassified_categories:
        raise HTTPException(status_code=500, detail="L'IA n'a pas pu générer de propositions valides.")

    # 4. Salary Capping & Prorating Logic:
    total_new_fixed_monthly = sum(
        (p["suggested_amount"] / 12.0 if p["suggested_period"] == "yearly" else p["suggested_amount"])
        for p in proposals if p["is_fixed"]
    )
    total_new_var_monthly = sum(
        (p["suggested_amount"] / 12.0 if p["suggested_period"] == "yearly" else p["suggested_amount"])
        for p in proposals if not p["is_fixed"] and not p["is_exceptional"]
    )

    remaining_for_variables = max(0.0, available_monthly_budget - total_new_fixed_monthly)

    # Prorate variable proposals if they exceed remaining available budget, but keep a floor (minimum 25% of average)
    is_capped = False
    if total_new_var_monthly > remaining_for_variables and total_new_var_monthly > 0:
        is_capped = True
        raw_ratio = remaining_for_variables / total_new_var_monthly
        # Use a minimum floor of 0.25 so no envelope is reduced to 0€
        effective_ratio = max(0.25, raw_ratio)
        for p in proposals:
            if not p["is_fixed"] and not p["is_exceptional"]:
                p["suggested_amount"] = round(p["suggested_amount"] * effective_ratio, 2)
                for cat in p["cat_amounts"]:
                    p["cat_amounts"][cat] = round(p["cat_amounts"][cat] * effective_ratio, 2)
                adjusted_suffix = " (Adjusted to available salary)" if (data and data.lang == "en") else " (Ajusté au salaire disponible)"
                p["justification"] += adjusted_suffix

    result_payload = {
        "proposals": proposals,
        "unclassified_categories": unclassified_categories,
        "cat_averages": {c: cat_data[c]["avg"] for c in cat_data},
        "regular_salary": regular_salary,
        "already_engaged_monthly": round(already_engaged_monthly, 2),
        "available_monthly_budget": round(available_monthly_budget, 2),
        "is_capped": is_capped,
        "window_months": effective_window,
        "requested_window_months": data.window_months if data else 3,
        "effective_window_months": effective_window,
    }
    AI_TASK_STATUS["state"] = "SUCCESS"
    AI_TASK_STATUS["step_key"] = "ai_status_success"
    AI_TASK_STATUS["result"] = result_payload
    return result_payload


class AiRefineRequest(BaseModel):
    window_months: int = 3
    lang: Optional[str] = "fr"
    existing_proposals: list[dict] = []
    unclassified_categories: list[dict] = []


@router.post("/ai_suggest/refine")
def ai_refine_budgets(data: AiRefineRequest, db: Session = Depends(get_db)):
    """
    Refines unclassified categories using an AI second pass to place them into existing proposals or create targeted new ones.
    """
    from app.routers.chat import get_ollama_config, call_ollama_sync

    if not data.unclassified_categories:
        return {"proposals": data.existing_proposals, "unclassified_categories": []}

    cfg = get_ollama_config(db)
    if not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="IA non activée dans les paramètres.")

    # 1. Existing budgets for already used categories
    existing_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    already_used_cats = set()
    for b in existing_budgets:
        for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all():
            already_used_cats.add(c.category_name)

    latest_past_tx = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).first()
    anchor_date = latest_past_tx.date_operation if latest_past_tx else date.today()

    cat_data = _compute_monthly_averages_for_ai(db, already_used_cats, anchor_date, window_months=data.window_months)

    unclassified_names = [item.get("name") if isinstance(item, dict) else item for item in data.unclassified_categories]
    unclassified_cats = [c for c in unclassified_names if c in cat_data]

    if not unclassified_cats:
        return {"proposals": data.existing_proposals, "unclassified_categories": []}

    existing_names = [p.get("name") for p in data.existing_proposals if p.get("name")]
    
    cat_lines = []
    for cat in unclassified_cats:
        info = cat_data[cat]
        period_str = "ANNUAL" if info.get("suggested_period") == "yearly" else "MONTHLY"
        desc_str = f" | Examples: {', '.join(info['top_descs'][:3])}" if info["top_descs"] else ""
        cat_lines.append(f'- Category: "{cat}" | Recurrence: {period_str}{desc_str}')
    formatted_cats = "\n".join(cat_lines)

    existing_env_str = ", ".join(f'"{n}"' for n in existing_names)

    target_lang = "English" if data.lang == "en" else "French"

    prompt = f"""You are an expert personal financial advisor. Here are {len(unclassified_cats)} unclassified financial categories:

{formatted_cats}

Current budget envelopes: [{existing_env_str}]

TASK: Assign EVERY unclassified category above to the most appropriate existing envelope OR create a new dedicated envelope for it.

LANGUAGE REQUIREMENT:
Write envelope names and reason justifications in {target_lang}.

Response format (JSON object with key "envelopes"):
{{
  "envelopes": [
    {{"name": "Existing or New Envelope Name in {target_lang}", "categories": ["ExactCatName1"], "reason": "Justification in {target_lang}"}},
    ...
  ]
}}"""

    try:
        raw = call_ollama_sync(prompt, cfg, extra_options={"num_predict": 1500, "format": "json"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'affinage IA : {str(e)}")

    import re
    cleaned_raw = re.sub(r'```(?:json)?', '', raw).strip()

    parsed_objs = _extract_json_envelopes(cleaned_raw)

    # Merge refined categories into existing proposals or build new ones
    updated_proposals = list(data.existing_proposals)
    placed_cats = set()

    for obj in parsed_objs:
        if isinstance(obj, dict):
            name = obj.get("name") or obj.get("title") or obj.get("enveloppe")
            cats = obj.get("categories") or obj.get("cats") or []
            if isinstance(cats, str):
                cats = [c.strip().strip('"').strip("'") for c in cats.split(',') if c.strip()]
            if not name or not cats or not isinstance(cats, list):
                continue

            valid_cats = [c for c in cats if c in cat_data and c not in placed_cats]
            if not valid_cats:
                continue

            # Check if matching existing proposal
            matched_prop = None
            for p in updated_proposals:
                if (p.get("name") or "").strip().lower() == name.strip().lower():
                    matched_prop = p
                    break

            if matched_prop:
                matched_prop["categories"].extend(valid_cats)
                # Recalculate amounts
                sub_cats = list(dict.fromkeys(matched_prop["categories"]))
                matched_prop["categories"] = sub_cats
                for c in valid_cats:
                    c_period = cat_data[c].get("suggested_period", "monthly")
                    c_val = cat_data[c]["avg"] if c_period == "monthly" else round(cat_data[c]["total_year"] / 12.0, 2)
                    matched_prop["cat_amounts"][c] = c_val
                matched_prop["suggested_amount"] = round(sum(matched_prop["cat_amounts"].values()), 2)
            else:
                # Build new proposal
                cat_amounts = {}
                for c in valid_cats:
                    c_period = cat_data[c].get("suggested_period", "monthly")
                    cat_amounts[c] = cat_data[c]["avg"] if c_period == "monthly" else round(cat_data[c]["total_year"] / 12.0, 2)
                base_amount = round(sum(cat_amounts.values()), 2)
                updated_proposals.append({
                    "name": name,
                    "categories": valid_cats,
                    "cat_amounts": cat_amounts,
                    "cat_details": {c: {"amount": cat_amounts[c], "top_descs": cat_data[c]["top_descs"], "is_fixed": cat_data[c]["is_fixed"]} for c in valid_cats},
                    "suggested_amount": base_amount,
                    "historical_actual_amount": base_amount,
                    "current_month_spent": round(sum(cat_data[c].get("current_month_spent", 0.0) for c in valid_cats), 2),
                    "recent_3m_avg": round(sum(cat_data[c].get("recent_3m_avg", 0.0) for c in valid_cats), 2),
                    "suggested_period": "monthly",
                    "is_fixed": False,
                    "has_fixed_mix": False,
                    "fixed_sum": 0.0,
                    "is_exceptional": False,
                    "justification": f"Enveloppe d'affinage IA ({', '.join(valid_cats)}).",
                })
            placed_cats.update(valid_cats)

    remaining_unclassified = [
        {
            "name": c,
            "avg": cat_data[c]["avg"],
            "current_month_spent": cat_data[c].get("current_month_spent", 0.0),
            "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0),
            "total_year": cat_data[c].get("total_year", 0.0),
            "suggested_period": cat_data[c].get("suggested_period", "monthly"),
            "top_descs": cat_data[c].get("top_descs", []),
        }
        for c in unclassified_cats if c not in placed_cats
    ]

    return {
        "proposals": updated_proposals,
        "unclassified_categories": remaining_unclassified,
    }


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
    
    # Monthly capacity: use explicit monthly envelopes if any
    is_monthly_fallback = False
    if explicit_monthly_budgeted > 0:
        effective_monthly_budgeted = explicit_monthly_budgeted
    else:
        effective_monthly_budgeted = 0.0
        is_monthly_fallback = True

    # Yearly capacity: use explicit yearly envelopes + annualized monthly envelopes if any
    is_yearly_fallback = False
    if explicit_yearly_budgeted > 0 or explicit_monthly_budgeted > 0:
        effective_yearly_budgeted = explicit_yearly_budgeted + (explicit_monthly_budgeted * 12.0)
    else:
        effective_yearly_budgeted = 0.0
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
        monthly_budgeted_details_fr = "Aucune enveloppe mensuelle existante."
        monthly_budgeted_details_en = "No existing monthly envelope."
    else:
        monthly_budgeted_details_fr = "Somme de vos enveloppes mensuelles actives configurées."
        monthly_budgeted_details_en = "Sum of your configured active monthly envelopes."

    if is_yearly_fallback:
        yearly_budgeted_details_fr = "Aucune enveloppe annuelle existante."
        yearly_budgeted_details_en = "No existing yearly envelope."
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
