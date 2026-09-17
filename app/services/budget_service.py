from typing import Optional, List
from datetime import date, datetime, timedelta
import json
import logging
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, or_
from fastapi import HTTPException
from app.models import Budget, BudgetCategory, BudgetAllocation, Transaction, Account, GlobalConfig
from app.services.history_service import record_action, snapshot_entity
from app.services.stats_utils import winsorize_values

logger = logging.getLogger(__name__)

def _accumulate_tx(txs, match_fn=None):
    """Accumule income/expenses totaux et rapprochés pour un itérable de TX.

    Args:
        txs: itérable de transactions (peut être un générateur filtré par date).
        match_fn: fonction optionnelle (tx) -> bool pour filtrer par compte.
            Si None, toutes les TX sont acceptées.
    Returns:
        tuple (expenses, income, reconciled_expenses, reconciled_income)
    """
    expenses = income = reconciled_expenses = reconciled_income = 0.0
    for tx in txs:
        if match_fn is not None and not match_fn(tx):
            continue
        if tx.type == "income":
            income += abs(tx.amount)
            if tx.reconciliation_date:
                reconciled_income += abs(tx.amount)
        else:
            expenses += abs(tx.amount)
            if tx.reconciliation_date:
                reconciled_expenses += abs(tx.amount)
    return expenses, income, reconciled_expenses, reconciled_income


def safe_parse_budget_date(s: str, field_name: str) -> Optional[date]:
    """Parse une date YYYY-MM-DD pour les budgets — HTTPException 400 si invalide."""
    from app.utils.date_utils import require_date
    if not s:
        return None
    return require_date(s.strip(), field_name)

def parse_account_ids(raw: str) -> list:
    """Parse JSON string of account IDs from DB column."""
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []

def serialize_account_ids(ids: list) -> str:
    """Serialize account IDs list to JSON string for DB storage."""
    if not ids:
        return None
    return json.dumps(ids)

def budget_to_dict(b: Budget, db: Session) -> dict:
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
        "account_ids": parse_account_ids(b.account_ids),
        "envelope_type": b.envelope_type or "spending",
        "is_locked": bool(b.is_locked) if b.is_locked is not None else False,
        "base_annual_amount": b.base_annual_amount,
    }

def get_all_budgets(db: Session) -> List[dict]:
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
            "account_ids": parse_account_ids(b.account_ids),
            "envelope_type": b.envelope_type or "spending",
            "is_locked": bool(b.is_locked) if b.is_locked is not None else False,
            "base_annual_amount": b.base_annual_amount,
        }
        for b in budgets
    ]

def create_new_budget(data, db: Session) -> dict:
    _start = safe_parse_budget_date(data.start_date, "start_date") if data.start_date else None
    _end = safe_parse_budget_date(data.end_date, "end_date") if data.end_date else None
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
        account_ids=serialize_account_ids(data.account_ids),
        envelope_type=data.envelope_type or "spending",
        is_locked=bool(getattr(data, "is_locked", False) or False),
        base_annual_amount=getattr(data, "base_annual_amount", None) or (data.monthly_amount * 12 if period != "yearly" else data.monthly_amount),
    )
    db.add(b)
    db.flush()

    for cat_name in (data.categories or []):
        db.add(BudgetCategory(budget_id=b.id, category_name=cat_name))
    db.flush()
    action_id = record_action(db, "budget", b.id, "CREATE", None, snapshot_entity(b, db))
    db.commit()
    db.refresh(b)

    res = budget_to_dict(b, db)
    res["action_id"] = action_id
    return res

def update_existing_budget(budget_id: int, data, db: Session) -> dict:
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")

    old_snapshot = snapshot_entity(b, db)
    dump_data = data.model_dump(exclude_unset=True) if hasattr(data, "model_dump") else data.dict(exclude_unset=True)
    for k, v in dump_data.items():
        if k == "categories":
            continue
        if k in ("start_date", "end_date"):
            setattr(b, k, safe_parse_budget_date(v, k) if v else None)
            continue
        if k == "account_ids":
            setattr(b, k, serialize_account_ids(v))
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
    res = budget_to_dict(b, db)
    res["action_id"] = action_id
    return res

def delete_single_budget(budget_id: int, db: Session) -> dict:
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

def bulk_delete_budgets_by_type(target_type: str, db: Session) -> dict:
    query = db.query(Budget).filter(Budget.is_closed == False)
    if target_type == "monthly":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None), (Budget.period == "monthly") | (Budget.period == None))
    elif target_type == "yearly":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None), Budget.period == "yearly")
    elif target_type == "spending":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None))
    elif target_type == "project":
        query = query.filter(Budget.is_project == True)
    elif target_type == "savings":
        query = query.filter(Budget.envelope_type == "savings")
    elif target_type == "all":
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

def get_budget_status_data(year: int = None, month: int = None, date_start: str = None, date_end: str = None, period_filter: str = None, db: Session = None):
    today = date.today()
    y = year or today.year
    m = month or today.month

    custom_start = None
    custom_end = None
    if date_start and date_end:
        try:
            custom_start = safe_parse_budget_date(date_start, "date_start")
            custom_end = safe_parse_budget_date(date_end, "date_end")
            if custom_start and custom_end and custom_start > custom_end:
                custom_start, custom_end = custom_end, custom_start
        except HTTPException:
            pass

    q = db.query(Budget).filter(Budget.is_closed == False)
    if period_filter and period_filter != "all":
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
        res = {"year": y, "month": m, "budgets": []}
        if period_filter == "all":
            res["statusByType"] = {
                "monthly": {"year": y, "month": m, "budgets": []},
                "yearly": {"year": y, "month": m, "budgets": []},
                "indefinite": {"year": y, "month": m, "budgets": []},
                "custom": {"year": y, "month": m, "budgets": []},
            }
        return res

    budget_ids = [b.id for b in budgets]

    all_cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_(budget_ids)).all()
    cats_by_budget = {}
    for c in all_cats:
        cats_by_budget.setdefault(c.budget_id, []).append(c.category_name)

    savings_budget_ids = [b.id for b in budgets if (b.envelope_type or "spending") == "savings"]
    allocs_by_budget = {}
    if savings_budget_ids:
        all_allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(savings_budget_ids)).all()
        for a in all_allocs:
            allocs_by_budget.setdefault(a.budget_id, []).append(a)

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

    spending_budgets = [b for b in budgets
                       if (b.envelope_type or "spending") != "savings" and not b.is_project]
    all_category_txs = []
    txs_by_cat = {}
    if spending_budgets:
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
        for tx in all_category_txs:
            cat_key = tx.category or "Sans catégorie"
            txs_by_cat.setdefault(cat_key, []).append(tx)

    result = []

    for b in budgets:
        cats = cats_by_budget.get(b.id, [])
        acc_ids = parse_account_ids(b.account_ids)
        acc_ids_set = set(acc_ids) if acc_ids else None

        def _match_account(tx, _ids=acc_ids_set):
            if not _ids:
                return True
            return (tx.from_account_id in _ids or tx.to_account_id in _ids)

        expenses = 0.0
        income = 0.0
        reconciled_expenses = 0.0
        reconciled_income = 0.0

        if (b.envelope_type or "spending") == "savings":
            expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                txs_by_budget_id.get(b.id, []), _match_account
            )

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

        if b.is_project:
            expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                txs_by_budget_id.get(b.id, []), _match_account
            )
        else:
            # Fast category-indexed tx lookup
            if cats:
                target_txs = []
                for c in cats:
                    target_txs.extend(txs_by_cat.get(c, []))
            else:
                target_txs = all_category_txs

            if b.period == "indefinite":
                expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                    target_txs, _match_account
                )
            elif b.period == "custom" and b.start_date and b.end_date:
                expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                    (tx for tx in target_txs if b.start_date <= tx.date_operation <= b.end_date),
                    _match_account
                )
            elif b.period == "yearly":
                expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                    (tx for tx in target_txs if tx.date_operation.year == y),
                    _match_account
                )
            elif custom_start and custom_end:
                expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                    (tx for tx in target_txs if custom_start <= tx.date_operation <= custom_end),
                    _match_account
                )
            else:
                expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                    (tx for tx in target_txs if tx.date_operation.year == y and tx.date_operation.month == m),
                    _match_account
                )

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

    all_acc_ids = set()
    for r in result:
        all_acc_ids.update(r.get("account_ids") or [])
    acc_name_map = {}
    if all_acc_ids:
        for a in db.query(Account).filter(Account.id.in_(list(all_acc_ids))).all():
            acc_name_map[a.id] = a.name
    for r in result:
        r["account_names"] = [acc_name_map.get(aid, f"#{aid}") for aid in (r.get("account_ids") or [])]

    response_data = {"year": y, "month": m, "budgets": result}
    if period_filter == "all":
        response_data["statusByType"] = {
            "monthly": {"year": y, "month": m, "budgets": [r for r in result if r.get("period") in ("monthly", None)]},
            "yearly": {"year": y, "month": m, "budgets": [r for r in result if r.get("period") == "yearly"]},
            "indefinite": {"year": y, "month": m, "budgets": [r for r in result if r.get("period") == "indefinite"]},
            "custom": {"year": y, "month": m, "budgets": [r for r in result if r.get("period") == "custom"]},
        }
    return response_data

def get_budget_transactions_data(budget_id: int, year: int = None, month: int = None, db: Session = None):
    today = date.today()
    y = year or today.year
    m = month or today.month

    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")

    cats = [c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).all()]
    acc_ids = parse_account_ids(b.account_ids)

    def _apply_account_filter(q):
        if not acc_ids:
            return q
        return q.filter(or_(
            Transaction.from_account_id.in_(acc_ids),
            Transaction.to_account_id.in_(acc_ids)
        ))

    if (b.envelope_type or "spending") == "savings" or b.is_project:
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
        q = db.query(Transaction).filter(
            extract('year', Transaction.date_operation) == y,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    else:
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

def get_allocations_data(budget_id: int, db: Session):
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

def create_allocation_data(budget_id: int, data, db: Session):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")
        
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

    alloc = BudgetAllocation(
        budget_id=budget_id,
        amount=data.amount,
        date=safe_parse_budget_date(data.date, "date") if data.date else date.today(),
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

def delete_allocation_data(budget_id: int, alloc_id: int, db: Session):
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

def compute_savings_overflow_data(db: Session):
    try:
        from app.services.finance_engine import calculate_rest_to_live, predict_next_paycheck
        today = date.today()
        pay_info = predict_next_paycheck(db)
        next_pay_date = pay_info.get("date") if isinstance(pay_info, dict) else None
        rest_to_live = calculate_rest_to_live(db, today, next_pay_date)
        if rest_to_live < 0:
            savings_budgets = db.query(Budget).filter(Budget.is_closed == False, Budget.envelope_type == "savings").all()
            if not savings_budgets:
                return None
            savings_ids = [b.id for b in savings_budgets]
            allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(savings_ids)).all()
            txs = db.query(Transaction.budget_id, Transaction.type, Transaction.amount).filter(Transaction.budget_id.in_(savings_ids)).all()
            
            alloc_by_b = {}
            for a in allocs:
                alloc_by_b.setdefault(a.budget_id, []).append(a)
            tx_by_b = {}
            for t in txs:
                tx_by_b.setdefault(t.budget_id, []).append(t)
                
            total_savings_balance = 0.0
            for b in savings_budgets:
                income = sum(abs(t.amount) for t in tx_by_b.get(b.id, []) if t.type == "income")
                expenses = sum(abs(t.amount) for t in tx_by_b.get(b.id, []) if t.type != "income")
                b_allocs = alloc_by_b.get(b.id, [])
                alloc_deposits = sum(a.amount for a in b_allocs if a.amount > 0)
                alloc_withdrawals = sum(abs(a.amount) for a in b_allocs if a.amount < 0)
                funded = income + alloc_deposits
                withdrawn = expenses + alloc_withdrawals
                balance = funded - withdrawn
                total_savings_balance += balance
                
            overflow_amount = abs(rest_to_live)
            return {
                "overflow_amount": round(overflow_amount, 2),
                "total_savings": round(max(total_savings_balance, 0), 2),
                "fully_consumed": overflow_amount >= max(total_savings_balance, 0)
            }
    except Exception as e:
        logger.warning(f"[budget] Error computing savings overflow: {e}")
    return None

def get_budget_capacity_data(db: Session):
    from app.services.finance_engine import get_accounts_available_balances
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    one_year_ago = today - timedelta(days=365)
    
    start_of_year = date(today.year, 1, 1)
    remaining_months = 12 - today.month

    org_mode_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
    is_org_mode = (org_mode_conf and org_mode_conf.value == "true")
    
    income_txs = db.query(Transaction.amount, Transaction.date_operation).filter(
        Transaction.type == "income",
        Transaction.date_operation >= one_year_ago,
        Transaction.date_operation <= today
    ).all()

    ytd_income = sum(tx.amount for tx in income_txs if tx.date_operation >= start_of_year)
    six_month_income = sum(tx.amount for tx in income_txs if tx.date_operation >= six_months_ago)
    
    avg_monthly_income = 0.0
    paycheck_data = None
    if not is_org_mode:
        from app.services.finance_engine import predict_next_paycheck
        paycheck_data = predict_next_paycheck(db)
        if paycheck_data and paycheck_data.get("amount", 0.0) > 0:
            avg_monthly_income = round(paycheck_data["amount"], 2)
            
    if avg_monthly_income == 0.0:
        avg_monthly_income = round(six_month_income / 6.0, 2)
        
    avg_yearly_income = round(ytd_income + (remaining_months * avg_monthly_income), 2)
    
    expense_txs = db.query(Transaction.amount, Transaction.date_operation).filter(
        Transaction.type.in_(["expense_fixed", "expense_var"]),
        Transaction.date_operation >= one_year_ago,
        Transaction.date_operation <= today
    ).all()
    
    ytd_expenses = sum(abs(tx.amount) for tx in expense_txs if tx.date_operation >= start_of_year)
    six_month_expenses = sum(abs(tx.amount) for tx in expense_txs if tx.date_operation >= six_months_ago)
    
    avg_monthly_expenses = round(six_month_expenses / 6.0, 2)
    avg_yearly_expenses = round(ytd_expenses + (remaining_months * avg_monthly_expenses), 2)
    
    active_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    explicit_monthly_budgeted = sum(b.monthly_amount for b in active_budgets if b.period in ("monthly", None) and (b.envelope_type or "spending") != "savings")
    explicit_yearly_budgeted = sum(b.monthly_amount for b in active_budgets if b.period == "yearly" and (b.envelope_type or "spending") != "savings")
    
    is_monthly_fallback = False
    if explicit_monthly_budgeted > 0:
        effective_monthly_budgeted = explicit_monthly_budgeted
    else:
        effective_monthly_budgeted = avg_monthly_expenses
        is_monthly_fallback = True

    is_yearly_fallback = False
    if explicit_yearly_budgeted > 0:
        effective_yearly_budgeted = (explicit_monthly_budgeted * 12) + explicit_yearly_budgeted
    else:
        effective_yearly_budgeted = avg_yearly_expenses
        is_yearly_fallback = True

    monthly_details_fr = ""
    monthly_details_en = ""
    yearly_details_fr = ""
    yearly_details_en = ""

    if is_org_mode or avg_monthly_income == round(six_month_income / 6.0, 2):
        fallback_avg_income = round(six_month_income / 6.0, 2)
        if fallback_avg_income > 0:
            avg_monthly_income = fallback_avg_income
            avg_yearly_income = round(ytd_income + (remaining_months * avg_monthly_income), 2)
        monthly_details_fr = "Basé sur la moyenne glissante des recettes des 6 derniers mois (aligné sur l'analyse des dépenses)."
        monthly_details_en = "Based on the 6-month rolling average of receipts (aligned with spending analysis)."
        yearly_details_fr = f"Recettes réelles de l'année en cours (YTD : {round(ytd_income, 2):,.2f} €) + recettes moyennes pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_details_en = f"Actual YTD receipts ({round(ytd_income, 2):,.2f} €) + average receipts for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €)."
    elif not is_org_mode and avg_monthly_income > 0 and paycheck_data and paycheck_data.get("amount", 0.0) > 0:
        monthly_details_fr = "Basé sur votre salaire mensuel prédit / configuré."
        monthly_details_en = "Based on your predicted / configured monthly salary."
        
        yearly_details_fr = f"Recettes réelles de l'année en cours (YTD : {round(ytd_income, 2):,.2f} €) + salaires prévus pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_details_en = f"Actual YTD receipts ({round(ytd_income, 2):,.2f} €) + projected salary for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €)."
    else:
        monthly_details_fr = "Basé sur la moyenne glissante des recettes des 6 derniers mois."
        monthly_details_en = "Based on the 6-month rolling average of receipts."
        
        yearly_details_fr = f"Recettes réelles de l'année en cours (YTD : {round(ytd_income, 2):,.2f} €) + recettes moyennes pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_details_en = f"Actual YTD receipts ({round(ytd_income, 2):,.2f} €) + average receipts for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €)."

    if is_monthly_fallback:
        monthly_budgeted_details_fr = "Aucune enveloppe configurée. Estimation basée sur la moyenne de vos dépenses réelles des 6 derniers mois."
        monthly_budgeted_details_en = "No configured envelope. Estimated based on your average real spending over the last 6 months."
    else:
        monthly_budgeted_details_fr = "Montant total réservé par vos enveloppes mensuelles actives."
        monthly_budgeted_details_en = "Total amount reserved by your active monthly envelopes."

    if is_yearly_fallback:
        yearly_budgeted_details_fr = "Aucune enveloppe configurée. Estimation basée sur vos dépenses YTD + la moyenne projetée sur l'année."
        yearly_budgeted_details_en = "No configured envelope. Estimated based on YTD spending + projected yearly average."
    else:
        yearly_budgeted_details_fr = "Montant total réservé par vos enveloppes pour l'année complète (Enveloppes annuelles + 12 × Enveloppes mensuelles)."
        yearly_budgeted_details_en = "Total amount reserved by your envelopes for the full year (Yearly envelopes + 12 × Monthly envelopes)."

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
        "accounts": list(account_balances.values()),
        "savings_overflow": compute_savings_overflow_data(db)
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Étape 5 — Découverte Déterministe d'Enveloppes & Recalibrage Budgétaire
# Mode Preview/Suggestion exclusif : aucune mutation directe sans approbation
# ═══════════════════════════════════════════════════════════════════════════════

import uuid
from app.models import AutopilotDecisionLog, Notification, RecurrenceTemplate


def get_unbudgeted_categories(db: Session, lookback_months: int = 3) -> List[str]:
    """Retourne les catégories de dépenses variables actives (3 derniers mois) non encore associées à un budget.
    Exclut formellement :
    - Les revenus, transferts et virements internes
    - Les charges fixes / emprunts / prêts (gérés par les récurrences et le Reste à Vivre)
    - Les catégories inactives sans transaction dans les 3 derniers mois
    """
    from app.models import Category
    today = date.today()
    start_date = today.replace(day=1) - timedelta(days=lookback_months * 31)

    # Catégories déjà budgétées (budgets non fermés)
    budgeted_cats_q = (
        db.query(BudgetCategory.category_name)
        .join(Budget, Budget.id == BudgetCategory.budget_id)
        .filter(Budget.is_closed == False, Budget.envelope_type == "spending")
        .distinct()
    )
    budgeted_set = {row[0] for row in budgeted_cats_q.all()}

    # Catégories explicitement non-dépenses variables dans le référentiel
    non_spending_cats = db.query(Category.name).filter(
        Category.type.in_(["income", "transfer", "savings", "expense_fixed"])
    ).all()
    excluded_names = {c[0].strip().lower() for c in non_spending_cats if c[0]}

    transfer_and_loan_keywords = (
        "transfert", "compte vers compte", "virement interne", "virement",
        "épargne", "epargne", "virement compte à compte",
        "prêt", "pret", "emprunt", "crédit", "credit", "remboursement",
        "fixes", "fixe", "abonnement", "loyer", "assurance", "mutuelle"
    )

    # Catégories ayant des dépenses variables RÉELLES et RÉCENTES (3 derniers mois)
    active_cats_q = (
        db.query(Transaction.category)
        .filter(
            Transaction.category.isnot(None),
            Transaction.category != "",
            Transaction.type == "expense_var",
            Transaction.date_operation >= start_date,
            Transaction.date_operation < today.replace(day=1),
            # Exclure formellement les écritures avec un compte source ET un compte cible (virements internes)
            ~(Transaction.from_account_id.isnot(None) & Transaction.to_account_id.isnot(None)),
        )
        .distinct()
    )
    active_set = {row[0] for row in active_cats_q.all()}

    orphan = [
        c for c in sorted(active_set - budgeted_set)
        if c.strip().lower() not in excluded_names
        and not any(kw in c.strip().lower() for kw in transfer_and_loan_keywords)
    ]
    logger.debug(f"[Budgets] Catégories variables orphelines récentes détectées : {len(orphan)} ({orphan[:5]}...)")
    return orphan


def _get_dismissed_categories(db: Session) -> set:
    """Retourne les catégories explicitement refusées (garantie anti-harcèlement)."""
    dismissed = (
        db.query(AutopilotDecisionLog.raw_snapshot)
        .filter(
            AutopilotDecisionLog.decision_type == "budget_creation_suggestion",
            AutopilotDecisionLog.action == "DISMISSED",
            AutopilotDecisionLog.is_undone == False,
        )
        .all()
    )
    result = set()
    for row in dismissed:
        if row[0]:
            try:
                import json as _json
                snap = _json.loads(row[0])
                if "categories" in snap and isinstance(snap["categories"], list):
                    result.update(snap["categories"])
                elif "category" in snap:
                    result.add(snap["category"])
            except Exception:
                pass
    return result


def _get_monthly_spending_for_category(db: Session, category: str, lookback_months: int = 3) -> List[float]:
    """Calcule les dépenses mensuelles par catégorie sur les N derniers mois."""
    from dateutil.relativedelta import relativedelta
    today = date.today()
    start_date = today.replace(day=1) - relativedelta(months=lookback_months)

    txs = (
        db.query(Transaction)
        .filter(
            Transaction.category == category,
            Transaction.type.notin_(["income", "transfer"]),
            ~(Transaction.from_account_id.isnot(None) & Transaction.to_account_id.isnot(None)),
            Transaction.date_operation >= start_date,
            Transaction.date_operation < today.replace(day=1),
        )
        .all()
    )

    # Grouper par mois
    monthly = {}
    for tx in txs:
        key = f"{tx.date_operation.year}-{tx.date_operation.month:02d}"
        monthly[key] = monthly.get(key, 0.0) + abs(tx.amount)

    # Remplir les mois vides avec 0
    result = []
    cursor = start_date.replace(day=1)
    end_cursor = today.replace(day=1)
    while cursor < end_cursor:
        key = f"{cursor.year}-{cursor.month:02d}"
        result.append(monthly.get(key, 0.0))
        cursor += relativedelta(months=1)

    return result


def _call_ollama_for_budget_grouping(cats: List[str], cat_stats: dict, ollama_cfg: dict) -> List[dict]:
    """Demande à Ollama de regrouper sémantiquement les catégories orphelines."""
    from app.services.chat.ollama_client import call_ollama_sync
    import json as _json
    import re as _re

    cat_lines = [f'- "{c}" ({cat_stats[c]["avg_monthly"]} €/mois)' for c in cats]
    formatted = "\n".join(cat_lines)
    nb_cats = len(cats)

    prompt = f"""You are an expert personal finance assistant.
Group these {nb_cats} expense categories into cohesive, thematic budget envelopes (aim for 4 to 8 envelopes, grouping 2 to 4 related categories together whenever logical, such as Food & Groceries, Transport & Fuel, Housing, Health & Wellness, Leisure, Tech):

{formatted}

RULES:
1. Group related categories together into cohesive envelopes. Do not isolate each category into its own envelope unless it is truly unique.
2. Every category from the input list must belong to exactly one envelope. Use exact category names.
3. Response MUST be a JSON object with a single key "envelopes":
{{
  "envelopes": [
    {{"name": "Envelope Name in French", "categories": ["Cat1", "Cat2"], "justification": "Short justification in French"}},
    ...
  ]
}}"""

    raw = call_ollama_sync(prompt, ollama_cfg, extra_options={"format": "json"})
    if not raw or not raw.strip():
        return []

    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = _re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = _re.sub(r"\s*```$", "", cleaned)

    data = _json.loads(cleaned)
    raw_envelopes = []
    if isinstance(data, dict) and "envelopes" in data and isinstance(data["envelopes"], list):
        raw_envelopes = data["envelopes"]
    elif isinstance(data, list):
        raw_envelopes = data

    cat_lower_map = {c.strip().lower(): c for c in cats}
    grouped_proposals = []
    assigned_cats = set()

    for item in raw_envelopes:
        if not isinstance(item, dict):
            continue
        env_name = (item.get("name") or "").strip()
        env_cats_raw = item.get("categories") or []
        if isinstance(env_cats_raw, str):
            env_cats_raw = [x.strip() for x in env_cats_raw.split(",") if x.strip()]
        
        valid_cats = []
        for rc in env_cats_raw:
            clean_rc = rc.strip().lower()
            if clean_rc in cat_lower_map:
                actual_cat = cat_lower_map[clean_rc]
                if actual_cat not in assigned_cats:
                    valid_cats.append(actual_cat)
                    assigned_cats.add(actual_cat)

        if valid_cats:
            grouped_proposals.append({
                "name": env_name or valid_cats[0],
                "categories": valid_cats,
                "justification": item.get("justification") or f"Regroupement sémantique IA de {len(valid_cats)} catégorie(s)",
            })

    # Compléter les catégories éventuellement oubliées par le LLM
    for c in cats:
        if c not in assigned_cats:
            grouped_proposals.append({
                "name": c,
                "categories": [c],
                "justification": "Catégorie non regroupée par l'IA",
            })

    return grouped_proposals


def suggest_new_envelopes(
    db: Session,
    profile_id: str = None,
    force: bool = False,
    engine_override: Optional[str] = None,
) -> List[dict]:
    """Volet A — Détection et suggestion de création d'enveloppes pour les catégories orphelines.
    
    Supporte deux moteurs configurables :
    1. Déterministe (défaut) : calcul Winsorisé 100% hors-ligne, zéro dépendance Ollama.
    2. Assisté par IA (Ollama) : regroupement sémantique multi-catégories avec fallback automatique transparent si Ollama est indisponible.
    """
    cfg_enabled = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_creation_suggestions").first()
    if cfg_enabled and cfg_enabled.value and cfg_enabled.value.strip().lower() == "false":
        logger.debug("[Budgets] Suggestions de création désactivées par l'utilisateur.")
        return []

    orphan_cats = get_unbudgeted_categories(db)
    if not orphan_cats:
        logger.debug("[AutoPilot Budgets] Aucune catégorie orpheline détectée.")
        return []

    # Exclure les catégories déjà refusées
    dismissed = _get_dismissed_categories(db)

    # Exclure les catégories ayant déjà une suggestion SUGGESTED en cours
    already_suggested = set()
    pending = (
        db.query(AutopilotDecisionLog.raw_snapshot)
        .filter(
            AutopilotDecisionLog.decision_type == "budget_creation_suggestion",
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.is_undone == False,
        )
        .all()
    )
    for row in pending:
        if row[0]:
            try:
                import json as _json
                snap = _json.loads(row[0])
                if "categories" in snap and isinstance(snap["categories"], list):
                    already_suggested.update(snap["categories"])
                elif "category" in snap:
                    already_suggested.add(snap["category"])
            except Exception:
                pass

    eligible_cats = [c for c in orphan_cats if c not in dismissed and c not in already_suggested]
    if not eligible_cats:
        return []

    # Seuil plancher configurable
    min_threshold = 30.0
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_minimum_threshold").first()
    if cfg and cfg.value:
        try:
            min_threshold = float(cfg.value)
        except (ValueError, TypeError):
            pass

    # Vérifier si l'option d'auto-création est activée
    cfg_auto_create = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_create_budget_envelopes").first()
    is_auto_create = bool(cfg_auto_create and cfg_auto_create.value.strip().lower() == "true")

    # Moteur sélectionné (déterministe par défaut)
    engine_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_suggestion_engine").first()
    chosen_engine = (engine_override or (engine_cfg.value if engine_cfg else None) or "deterministic").strip().lower()

    # Calculer les métriques d'historique de chaque catégorie éligible (avec filtre strict >= 2 mois)
    cat_stats = {}
    for cat in eligible_cats:
        monthly_vals = _get_monthly_spending_for_category(db, cat, lookback_months=3)
        non_zero = [v for v in monthly_vals if v > 0]
        if len(non_zero) < 2:
            continue
        cleaned, _, _ = winsorize_values(non_zero, sensitivity=3)
        avg = sum(cleaned) / len(cleaned) if cleaned else 0.0
        if avg > 0:
            cat_stats[cat] = {
                "monthly_values": [round(v, 2) for v in monthly_vals],
                "observed_months": len(non_zero),
                "avg_monthly": round(avg, 2),
                "suggested_amount": round(avg, 2),
            }

    if not cat_stats:
        return []

    proposals_data = []

    if chosen_engine == "ai":
        from app.services.chat.ollama_client import get_ollama_config
        ollama_cfg = get_ollama_config(db)
        ai_success = False
        if ollama_cfg.get("enabled") and ollama_cfg.get("url") and ollama_cfg.get("model"):
            try:
                ai_groups = _call_ollama_for_budget_grouping(list(cat_stats.keys()), cat_stats, ollama_cfg)
                if ai_groups:
                    for grp in ai_groups:
                        grp_cats = [c for c in grp.get("categories", []) if c in cat_stats]
                        if not grp_cats:
                            continue
                        total_amt = round(sum(cat_stats[c]["suggested_amount"] for c in grp_cats), 2)
                        max_obs = max(cat_stats[c]["observed_months"] for c in grp_cats)
                        proposals_data.append({
                            "name": grp.get("name") or grp_cats[0],
                            "categories": grp_cats,
                            "suggested_amount": total_amt,
                            "avg_monthly": total_amt,
                            "observed_months": max_obs,
                            "engine": "ai",
                            "justification": grp.get("justification") or f"Regroupement sémantique IA ({len(grp_cats)} catégories)",
                        })
                    ai_success = True
            except Exception as e:
                logger.warning(f"[AutoPilot Budgets] Échec appel IA Ollama ({e}). Repli automatique sur le moteur déterministe.")

        if not ai_success:
            for cat, st in cat_stats.items():
                proposals_data.append({
                    "name": cat,
                    "categories": [cat],
                    "suggested_amount": st["suggested_amount"],
                    "avg_monthly": st["avg_monthly"],
                    "observed_months": st["observed_months"],
                    "monthly_values": st["monthly_values"],
                    "engine": "deterministic_fallback",
                    "justification": "Calcul déterministe hors-ligne (repli automatique)",
                })
    else:
        for cat, st in cat_stats.items():
            proposals_data.append({
                "name": cat,
                "categories": [cat],
                "suggested_amount": st["suggested_amount"],
                "avg_monthly": st["avg_monthly"],
                "observed_months": st["observed_months"],
                "monthly_values": st["monthly_values"],
                "engine": "deterministic",
                "justification": f"Moyenne constatée sur {st['observed_months']} mois",
            })

    batch_id = str(uuid.uuid4())
    suggestions = []
    import json as _json

    for prop in proposals_data:
        cats = prop["categories"]
        main_cat = cats[0] if len(cats) == 1 else prop["name"]

        snapshot = _json.dumps({
            "name": prop["name"],
            "category": main_cat,
            "categories": cats,
            "suggested_amount": prop["suggested_amount"],
            "avg_monthly": prop["avg_monthly"],
            "observed_months": prop["observed_months"],
            "monthly_values": prop.get("monthly_values", []),
            "engine": prop["engine"],
            "justification": prop.get("justification", ""),
            "is_one_off": False,
        })

        action_status = "SUGGESTED"
        created_budget_id = None

        if is_auto_create and prop["observed_months"] >= 2:
            from app.services.history_service import record_action, snapshot_entity
            b = Budget(
                name=prop["name"],
                monthly_amount=prop["suggested_amount"],
                period="monthly",
                is_project=False,
                is_closed=False,
                envelope_type="spending",
                is_locked=False,
                base_annual_amount=prop["suggested_amount"] * 12,
            )
            db.add(b)
            db.flush()
            for c in cats:
                db.add(BudgetCategory(budget_id=b.id, category_name=c))
            db.flush()
            record_action(db, "budget", b.id, "CREATE", None, snapshot_entity(b, db))
            action_status = "AUTO_COMMIT"
            created_budget_id = b.id
            logger.info(f"[AutoPilot Budgets] Auto-création de l'enveloppe '{prop['name']}' ({prop['suggested_amount']} €).")

        decision = AutopilotDecisionLog(
            batch_id=batch_id,
            decision_type="budget_creation_suggestion",
            action=action_status,
            entity_type="budget",
            entity_id=created_budget_id,
            conn_id=-1,
            account_id=None,
            raw_snapshot=snapshot,
            confidence_score=85.0 if prop["observed_months"] >= 2 else 60.0,
        )
        db.add(decision)
        db.flush()

        if action_status == "SUGGESTED":
            suggestions.append({
                "decision_id": decision.id,
                "type": "creation",
                "name": prop["name"],
                "category": main_cat,
                "categories": cats,
                "suggested_amount": prop["suggested_amount"],
                "avg_monthly": prop["avg_monthly"],
                "observed_months": prop["observed_months"],
                "engine": prop["engine"],
                "justification": prop.get("justification", ""),
                "is_one_off": False,
            })

    if suggestions or is_auto_create:
        db.commit()
        logger.info(f"[AutoPilot Budgets] Cycle de découverte terminé ({chosen_engine}) : {len(suggestions)} suggestion(s) en attente.")
    else:
        db.commit()

    return suggestions


# Alias de compatibilité
suggest_new_envelopes_deterministic = suggest_new_envelopes


def calculate_envelope_historical_spending(
    db: Session, budget: Budget, lookback_months: int = 3, sensitivity: int = 3
) -> tuple:
    """Calcule les dépenses mensuelles des catégories associées à une enveloppe avec Winsorizing
    et extrait le détail précis par catégorie (breakdown).
    
    Returns:
        (avg_spending, observed_months, monthly_values, category_breakdown)
    """
    cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget.id).all()
    cat_names = [c.category_name for c in cats]
    if not cat_names:
        return 0.0, 0, [], []

    today = date.today()
    start_date = today.replace(day=1) - timedelta(days=lookback_months * 31)

    txs = (
        db.query(Transaction)
        .filter(
            Transaction.category.in_(cat_names),
            Transaction.type.notin_(["income", "transfer"]),
            ~(Transaction.from_account_id.isnot(None) & Transaction.to_account_id.isnot(None)),
            Transaction.date_operation >= start_date,
            Transaction.date_operation < today.replace(day=1),
        )
        .all()
    )

    # Breakdown détaillé par catégorie individuelle
    category_breakdown = []
    for cname in cat_names:
        c_txs = [tx for tx in txs if tx.category == cname]
        c_total = sum(abs(tx.amount) for tx in c_txs)
        c_avg = c_total / lookback_months if lookback_months > 0 else 0.0
        category_breakdown.append({
            "category": cname,
            "total_spending": round(c_total, 2),
            "avg_monthly": round(c_avg, 2),
        })
    category_breakdown.sort(key=lambda x: x["avg_monthly"], reverse=True)

    # Grouper par mois
    monthly = {}
    for tx in txs:
        key = f"{tx.date_operation.year}-{tx.date_operation.month:02d}"
        monthly[key] = monthly.get(key, 0.0) + abs(tx.amount)

    # Construire la série chronologique complète
    values = []
    cursor = start_date.replace(day=1)
    end_cursor = today.replace(day=1)
    while cursor < end_cursor:
        key = f"{cursor.year}-{cursor.month:02d}"
        values.append(monthly.get(key, 0.0))
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)

    non_zero = [v for v in values if v > 0]
    if not non_zero:
        return 0.0, 0, values, category_breakdown

    cleaned, _, _ = winsorize_values(non_zero, sensitivity=sensitivity)
    avg = sum(cleaned) / len(cleaned) if cleaned else 0.0

    return round(avg, 2), len(non_zero), [round(v, 2) for v in values], category_breakdown


def compute_budget_ema_suggestion(
    current_budget: float,
    avg_spending: float,
    base_annual_amount: float,
    observed_months: int,
    min_threshold: float,
    alpha: float = 0.20,
) -> dict:
    """Calcule la suggestion EMA avec double plafond de dérive (±10%/mois, ±25%/an).
    
    Returns:
        dict avec suggested_amount, delta_pct, drift_limit_reached, raw_ema
    """
    if observed_months < 1 or current_budget <= 0:
        return {
            "suggested_amount": current_budget,
            "delta_pct": 0.0,
            "drift_limit_reached": False,
            "raw_ema": current_budget,
            "capped_reason": None,
        }

    # 1. Calcul brut EMA
    raw_ema = (1 - alpha) * current_budget + alpha * avg_spending

    # 2. Borne mensuelle ±10%
    max_monthly = current_budget * 1.10
    min_monthly = current_budget * 0.90
    capped = max(min(raw_ema, max_monthly), min_monthly)
    capped_reason = None
    if raw_ema > max_monthly:
        capped_reason = "monthly_cap_up"
    elif raw_ema < min_monthly:
        capped_reason = "monthly_cap_down"

    # 3. Borne annuelle ±25% vs base_annual_amount
    drift_limit_reached = False
    if base_annual_amount and base_annual_amount > 0:
        monthly_base = base_annual_amount / 12.0
        max_annual = monthly_base * 1.25
        min_annual = monthly_base * 0.75
        if capped > max_annual:
            capped = max_annual
            drift_limit_reached = True
            capped_reason = "annual_cap_up"
        elif capped < min_annual:
            capped = min_annual
            drift_limit_reached = True
            capped_reason = "annual_cap_down"

    # 4. Seuil plancher
    capped = max(capped, min_threshold)

    suggested = round(capped, 2)
    delta_pct = round(((suggested - current_budget) / current_budget) * 100, 1) if current_budget > 0 else 0.0

    return {
        "suggested_amount": suggested,
        "delta_pct": delta_pct,
        "drift_limit_reached": drift_limit_reached,
        "raw_ema": round(raw_ema, 2),
        "capped_reason": capped_reason,
    }


def evaluate_monthly_budget_suggestions(
    db: Session, force: bool = False
) -> List[dict]:
    """Volet B — Évaluation mensuelle et suggestion de recalibrage EMA des enveloppes existantes.
    
    Règle Anti-Thrashing : exécuté uniquement au 1er du mois / nouveau cycle,
    sauf si force=True (ex: test unitaire ou recalcul forcé).
    Si l'option auto_apply_budget_suggestions est activée, applique directement le recalibrage
    avec traçabilité et rollback possible.
    """
    today = date.today()
    current_period = f"{today.year}-{today.month:02d}"

    cfg_enabled = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_recalibration_suggestions").first()
    if cfg_enabled and cfg_enabled.value and cfg_enabled.value.strip().lower() == "false":
        logger.debug("[Budgets] Suggestions de recalibrage désactivées par l'utilisateur.")
        return []

    if not force:
        cfg_period = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_recalibration_period").first()
        if cfg_period and cfg_period.value == current_period:
            logger.debug(f"[AutoPilot Budgets] Période {current_period} déjà recalibrée. Anti-thrashing actif.")
            return []

    # Seuil plancher configurable
    min_threshold = 30.0
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_minimum_threshold").first()
    if cfg and cfg.value:
        try:
            min_threshold = float(cfg.value)
        except (ValueError, TypeError):
            pass

    # Option d'auto-application du recalibrage
    cfg_auto_apply = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_apply_budget_suggestions").first()
    is_auto_apply = bool(cfg_auto_apply and cfg_auto_apply.value.strip().lower() == "true")

    # Filtre d'éligibilité strict
    budgets = (
        db.query(Budget)
        .filter(
            Budget.envelope_type == "spending",
            Budget.period == "monthly",
            Budget.is_project == False,
            Budget.is_closed == False,
            Budget.is_locked == False,
        )
        .all()
    )

    if not budgets:
        logger.debug("[AutoPilot Budgets] Aucune enveloppe éligible au recalibrage.")
        return []

    # Exclure les budgets ayant déjà une suggestion SUGGESTED en cours
    pending = (
        db.query(AutopilotDecisionLog.entity_id)
        .filter(
            AutopilotDecisionLog.decision_type == "budget_suggestion",
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.entity_type == "budget",
            AutopilotDecisionLog.is_undone == False,
        )
        .all()
    )
    already_suggested_ids = {row[0] for row in pending if row[0]}

    # Vérifier les budgets dont un recalibrage a été DISMISSED pour cette période
    today = date.today()
    month_start = datetime(today.year, today.month, 1)
    dismissed_ids = set()
    dismissed_q = (
        db.query(AutopilotDecisionLog.entity_id)
        .filter(
            AutopilotDecisionLog.decision_type == "budget_suggestion",
            AutopilotDecisionLog.action == "DISMISSED",
            AutopilotDecisionLog.entity_type == "budget",
            AutopilotDecisionLog.is_undone == False,
            AutopilotDecisionLog.created_at >= month_start,
        )
        .all()
    )
    dismissed_ids = {row[0] for row in dismissed_q if row[0]}

    batch_id = str(uuid.uuid4())
    suggestions = []

    for b in budgets:
        if b.id in already_suggested_ids or b.id in dismissed_ids:
            continue

        avg_spending, observed_months, monthly_vals, category_breakdown = calculate_envelope_historical_spending(db, b)

        if observed_months < 1:
            continue

        base_annual = b.base_annual_amount or (b.monthly_amount * 12)
        ema_result = compute_budget_ema_suggestion(
            current_budget=b.monthly_amount,
            avg_spending=avg_spending,
            base_annual_amount=base_annual,
            observed_months=observed_months,
            min_threshold=min_threshold,
        )

        # Ne pas suggérer si delta < 2% (insignifiant)
        if abs(ema_result["delta_pct"]) < 2.0:
            continue

        import json as _json
        snapshot = _json.dumps({
            "budget_id": b.id,
            "budget_name": b.name,
            "current_amount": b.monthly_amount,
            "suggested_amount": ema_result["suggested_amount"],
            "delta_pct": ema_result["delta_pct"],
            "avg_spending": avg_spending,
            "observed_months": observed_months,
            "monthly_values": monthly_vals,
            "drift_limit_reached": ema_result["drift_limit_reached"],
            "raw_ema": ema_result["raw_ema"],
            "base_annual_amount": base_annual,
            "categories": [c["category"] for c in category_breakdown],
            "category_breakdown": category_breakdown,
        })

        action_status = "SUGGESTED"

        # Si l'option auto-application est activée et que le plafond de dérive annuelle n'est pas atteint
        if is_auto_apply and not ema_result["drift_limit_reached"]:
            from app.services.history_service import record_action, snapshot_entity
            old_snapshot = snapshot_entity(b, db)
            b.monthly_amount = ema_result["suggested_amount"]
            db.flush()
            record_action(db, "budget", b.id, "UPDATE", old_snapshot, snapshot_entity(b, db))
            action_status = "AUTO_COMMIT"
            logger.info(f"[AutoPilot Budgets] Auto-application du recalibrage pour '{b.name}' ({ema_result['suggested_amount']} €).")

        decision = AutopilotDecisionLog(
            batch_id=batch_id,
            decision_type="budget_suggestion",
            action=action_status,
            entity_type="budget",
            entity_id=b.id,
            conn_id=-1,
            account_id=None,
            raw_snapshot=snapshot,
            confidence_score=85.0 if not ema_result["drift_limit_reached"] else 70.0,
        )
        db.add(decision)
        db.flush()

        if action_status == "SUGGESTED":
            suggestions.append({
                "decision_id": decision.id,
                "type": "recalibration",
                "budget_id": b.id,
                "budget_name": b.name,
                "current_amount": b.monthly_amount,
                "suggested_amount": ema_result["suggested_amount"],
                "delta_pct": ema_result["delta_pct"],
                "avg_spending": avg_spending,
                "observed_months": observed_months,
                "drift_limit_reached": ema_result["drift_limit_reached"],
                "category_breakdown": category_breakdown,
            })

    # Mettre à jour la période de dernière exécution
    period_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_recalibration_period").first()
    if period_cfg:
        period_cfg.value = current_period
    else:
        db.add(GlobalConfig(key="last_budget_recalibration_period", value=current_period))

    if suggestions or is_auto_apply:
        notif = Notification(
            type="autopilot_budget",
            title=f"📊 {len(suggestions)} suggestion(s) budgétaire(s)",
            content=f"{len(suggestions)} ajustement(s) d'enveloppe(s) proposé(s) pour {current_period}.",
            detailed_content=None,
            link_data='{"view": "budgets"}',
        )
        db.add(notif)
        db.commit()
        logger.info(f"[AutoPilot Budgets] {len(suggestions)} suggestion(s) de recalibrage émise(s) pour {current_period}.")
    else:
        db.commit()
        logger.debug(f"[AutoPilot Budgets] Aucune suggestion de recalibrage en attente pour {current_period}.")

    return suggestions


def get_all_pending_budget_suggestions(db: Session) -> List[dict]:
    """Retourne toutes les suggestions budgétaires en attente (créations + recalibrages).
    Purge automatiquement toute ancienne suggestion sur achat ponctuel isolé (< 2 mois sans récurrence).
    """
    import json as _json
    pending = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion"]),
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.is_undone == False,
        )
        .order_by(AutopilotDecisionLog.created_at.desc())
        .all()
    )

    cfg_creation = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_creation_suggestions").first()
    creation_enabled = not (cfg_creation and cfg_creation.value and cfg_creation.value.strip().lower() == "false")

    cfg_recalib = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_recalibration_suggestions").first()
    recalib_enabled = not (cfg_recalib and cfg_recalib.value and cfg_recalib.value.strip().lower() == "false")

    results = []
    has_purged = False
    for d in pending:
        if d.decision_type == "budget_creation_suggestion" and not creation_enabled:
            continue
        if d.decision_type == "budget_suggestion" and not recalib_enabled:
            continue

        snap = {}
        if d.raw_snapshot:
            try:
                snap = _json.loads(d.raw_snapshot)
            except Exception:
                pass

        # Purge de sécurité : si une suggestion de création concerne un achat ponctuel isolé (< 2 mois) ou une charge non éligible (prêt, crédit, charge fixe)
        if d.decision_type == "budget_creation_suggestion":
            observed = snap.get("observed_months", 0)
            is_one_off = snap.get("is_one_off", False)
            cat = (snap.get("category") or "").strip()
            cat_lower = cat.lower()
            ineligible_keywords = (
                "prêt", "pret", "emprunt", "crédit", "credit", "remboursement",
                "fixes", "fixe", "abonnement", "loyer", "assurance", "mutuelle"
            )
            is_ineligible = (
                observed < 2
                or is_one_off
                or any(kw in cat_lower for kw in ineligible_keywords)
            )
            if is_ineligible:
                d.action = "DISMISSED"
                has_purged = True
                logger.info(f"[Budgets] Purge automatique de la suggestion création inadaptée ({cat}, {snap.get('suggested_amount')} €).")
                continue

            # Si une enveloppe active existe déjà pour cette catégorie, la suggestion est considérée traitée
            cats = snap.get("categories", [cat] if cat else [])
            existing_budget = (
                db.query(Budget)
                .join(BudgetCategory, BudgetCategory.budget_id == Budget.id)
                .filter(
                    BudgetCategory.category_name.in_(cats),
                    Budget.is_closed == False
                )
                .first()
            )
            if existing_budget:
                d.action = "AUTO_COMMIT"
                d.entity_id = existing_budget.id
                has_purged = True
                logger.info(f"[Budgets] Clôture automatique de la suggestion pour '{cat}' : enveloppe active existante (id={existing_budget.id}).")
                continue

        entry = {
            "decision_id": d.id,
            "decision_type": d.decision_type,
            "type": "creation" if d.decision_type == "budget_creation_suggestion" else "recalibration",
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "confidence_score": d.confidence_score,
            **snap,
        }
        results.append(entry)

    if has_purged:
        db.commit()

    return results


def apply_all_budget_suggestions(db: Session, decision_ids: Optional[List[int]] = None) -> dict:
    """Approuve en masse toutes les suggestions budgétaires valides (ou les identifiants fournis)."""
    q = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion"]),
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.is_undone == False,
        )
    )
    if decision_ids:
        q = q.filter(AutopilotDecisionLog.id.in_(decision_ids))

    pending = q.all()
    results = []
    for d in pending:
        try:
            res = apply_budget_suggestion(db, d.id)
            results.append(res)
        except Exception as e:
            logger.warning(f"[Budgets] Échec approbation unitaire {d.id} dans le traitement groupé: {e}")

    return {
        "ok": True,
        "count": len(results),
        "items": results,
    }


def dismiss_all_budget_suggestions(db: Session, decision_ids: Optional[List[int]] = None) -> dict:
    """Rejette en masse toutes les suggestions budgétaires en attente (ou les identifiants fournis)."""
    q = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion"]),
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.is_undone == False,
        )
    )
    if decision_ids:
        q = q.filter(AutopilotDecisionLog.id.in_(decision_ids))

    pending = q.all()
    results = []
    for d in pending:
        try:
            res = dismiss_budget_suggestion(db, d.id)
            results.append(res)
        except Exception as e:
            logger.warning(f"[Budgets] Échec rejet unitaire {d.id} dans le traitement groupé: {e}")

    return {
        "ok": True,
        "count": len(results),
        "items": results,
    }


def apply_budget_suggestion(db: Session, decision_id: int) -> dict:
    """Approuve une suggestion budgétaire : crée l'enveloppe ou applique le recalibrage."""
    import json as _json

    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == decision_id).first()
    if not decision:
        raise HTTPException(status_code=404, detail="Suggestion non trouvée.")
    if decision.action != "SUGGESTED":
        raise HTTPException(status_code=400, detail="Cette suggestion a déjà été traitée.")

    snap = {}
    if decision.raw_snapshot:
        try:
            snap = _json.loads(decision.raw_snapshot)
        except Exception:
            pass

    if decision.decision_type == "budget_creation_suggestion":
        # Création d'enveloppe
        envelope_name = snap.get("name") or snap.get("category", "Sans nom")
        amount = float(snap.get("suggested_amount", 30.0))
        period = snap.get("suggested_period", "monthly")
        base_annual = amount if period == "yearly" else amount * 12

        b = Budget(
            name=envelope_name,
            monthly_amount=amount,
            period=period,
            is_project=False,
            is_closed=False,
            envelope_type="spending",
            is_locked=False,
            base_annual_amount=base_annual,
        )
        db.add(b)
        db.flush()

        cats = snap.get("categories", [])
        if not cats and snap.get("category"):
            cats = [snap.get("category")]
        for c in cats:
            db.add(BudgetCategory(budget_id=b.id, category_name=c))
        db.flush()

        action_id = record_action(db, "budget", b.id, "CREATE", None, snapshot_entity(b, db))
        decision.action = "AUTO_COMMIT"
        decision.entity_id = b.id
        db.commit()

        logger.info(f"[AutoPilot Budgets] Enveloppe '{envelope_name}' créée avec succès ({amount} €).")
        return {
            "ok": True,
            "type": "creation",
            "budget_id": b.id,
            "name": envelope_name,
            "amount": amount,
            "action_id": action_id,
        }

    elif decision.decision_type == "budget_suggestion":
        # Recalibrage
        budget_id = snap.get("budget_id") or decision.entity_id
        if not budget_id:
            raise HTTPException(status_code=400, detail="ID de budget manquant.")

        b = db.query(Budget).filter(Budget.id == budget_id).first()
        if not b:
            raise HTTPException(status_code=404, detail="Budget non trouvé.")

        old_snapshot = snapshot_entity(b, db)
        new_amount = snap.get("suggested_amount", b.monthly_amount)
        b.monthly_amount = new_amount
        db.flush()

        action_id = record_action(db, "budget", b.id, "UPDATE", old_snapshot, snapshot_entity(b, db))
        decision.action = "AUTO_COMMIT"
        db.commit()

        logger.info(f"[AutoPilot Budgets] Enveloppe '{b.name}' actualisée à {new_amount} €.")
        return {
            "ok": True,
            "type": "recalibration",
            "budget_id": b.id,
            "name": b.name,
            "old_amount": snap.get("current_amount"),
            "new_amount": new_amount,
            "action_id": action_id,
        }

    raise HTTPException(status_code=400, detail="Type de suggestion inconnu.")


def dismiss_budget_suggestion(db: Session, decision_id: int) -> dict:
    """Rejette / écarte une suggestion budgétaire (garantie anti-harcèlement avec support de réactivation)."""
    import json as _json
    from datetime import datetime
    from app.services.history_service import record_action, snapshot_entity

    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == decision_id).first()
    if not decision:
        raise HTTPException(status_code=404, detail="Suggestion non trouvée.")
    if decision.action != "SUGGESTED":
        raise HTTPException(status_code=400, detail="Cette suggestion a déjà été traitée.")

    old_snapshot = snapshot_entity(decision, db)
    decision.action = "DISMISSED"

    if decision.raw_snapshot:
        try:
            snap = _json.loads(decision.raw_snapshot)
            snap["dismissed_at"] = datetime.utcnow().isoformat()
            snap["dismissed_period"] = datetime.utcnow().strftime("%Y-%m")
            decision.raw_snapshot = _json.dumps(snap)
        except Exception:
            pass

    db.flush()

    new_snapshot = snapshot_entity(decision, db)
    action_id = record_action(db, "autopilot_decision", decision.id, "UPDATE", old_snapshot, new_snapshot)
    db.commit()

    logger.info(f"[AutoPilot Budgets] Suggestion {decision_id} écartée (type={decision.decision_type}, action_id={action_id}).")
    return {"ok": True, "decision_id": decision_id, "action": "DISMISSED", "action_id": action_id}


def reactivate_budget_suggestion(db: Session, decision_id: int) -> dict:
    """Réactive une suggestion budgétaire précédemment écartée (DISMISSED -> SUGGESTED)."""
    import json as _json
    from app.services.history_service import record_action, snapshot_entity

    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == decision_id).first()
    if not decision:
        raise HTTPException(status_code=404, detail="Suggestion non trouvée.")
    if decision.action != "DISMISSED":
        raise HTTPException(status_code=400, detail="Seule une suggestion écartée peut être réactivée.")

    if decision.decision_type == "budget_suggestion" and decision.entity_id:
        b = db.query(Budget).filter(Budget.id == decision.entity_id).first()
        if not b or b.is_closed:
            raise HTTPException(status_code=400, detail="L'enveloppe associée n'existe plus ou est clôturée.")

    old_snapshot = snapshot_entity(decision, db)
    decision.action = "SUGGESTED"

    if decision.raw_snapshot:
        try:
            snap = _json.loads(decision.raw_snapshot)
            snap.pop("dismissed_at", None)
            snap.pop("dismissed_period", None)
            decision.raw_snapshot = _json.dumps(snap)
        except Exception:
            pass

    db.flush()

    new_snapshot = snapshot_entity(decision, db)
    action_id = record_action(db, "autopilot_decision", decision.id, "UPDATE", old_snapshot, new_snapshot)
    db.commit()

    logger.info(f"[AutoPilot Budgets] Suggestion {decision_id} réactivée (statut SUGGESTED, action_id={action_id}).")
    return {"ok": True, "decision_id": decision_id, "action": "SUGGESTED", "action_id": action_id}


def get_dismissed_budget_suggestions(db: Session, limit: int = 50) -> List[dict]:
    """Retourne l'historique des suggestions budgétaires écartées (DISMISSED)."""
    import json as _json
    from app.models import AutopilotDecisionLog

    dismissed = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion"]),
            AutopilotDecisionLog.action == "DISMISSED",
            AutopilotDecisionLog.is_undone == False,
        )
        .order_by(AutopilotDecisionLog.created_at.desc())
        .limit(limit)
        .all()
    )

    results = []
    for d in dismissed:
        snap = {}
        if d.raw_snapshot:
            try:
                snap = _json.loads(d.raw_snapshot)
            except Exception:
                pass

        name = snap.get("name") or snap.get("budget_name") or snap.get("category") or f"Enveloppe #{d.entity_id or d.id}"
        suggested_amount = snap.get("suggested_amount") or snap.get("amount") or 0.0
        current_amount = snap.get("current_amount")
        delta_pct = snap.get("delta_pct")

        results.append({
            "decision_id": d.id,
            "decision_type": d.decision_type,
            "type": "creation" if d.decision_type == "budget_creation_suggestion" else "recalibration",
            "name": name,
            "suggested_amount": suggested_amount,
            "current_amount": current_amount,
            "delta_pct": delta_pct,
            "confidence_score": d.confidence_score,
            "dismissed_at": snap.get("dismissed_at") or (d.created_at.isoformat() if d.created_at else None),
            "dismissed_period": snap.get("dismissed_period"),
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "categories": snap.get("categories", []),
            "category": snap.get("category"),
            "avg_spending": snap.get("avg_spending"),
            "justification": snap.get("justification", ""),
        })
    return results


def clear_dismissed_budget_suggestions(db: Session) -> dict:
    """Supprime l'historique des suggestions budgétaires écartées (DISMISSED)."""
    from app.models import AutopilotDecisionLog

    deleted_count = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion"]),
            AutopilotDecisionLog.action == "DISMISSED",
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    logger.info(f"[AutoPilot Budgets] Historique des suggestions écartées purgé ({deleted_count} entrées supprimées).")
    return {"ok": True, "count": deleted_count}

