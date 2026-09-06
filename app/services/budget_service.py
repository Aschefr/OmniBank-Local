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
