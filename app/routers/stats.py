from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import date
import calendar

from app.database import get_db
from app.models import Account, Transaction
from app.schemas.api_schemas import AccountOut
from app.services.finance_engine import calculate_balances, get_net_worth, calculate_rest_to_live, get_overdraft_warning, predict_next_paycheck, get_main_account

router = APIRouter(prefix="/api/stats", tags=["stats"])


def _safe_date(s: str, fallback: date = None) -> date:
    """Parse une date YYYY-MM-DD en toute sécurité.
    Si la chaîne est invalide ou absurde, retourne `fallback`.
    En contexte API, appeler avec raise_on_error=True pour renvoyer un 400 propre.
    """
    if not s:
        return fallback
    try:
        d = date.fromisoformat(s.strip())
        if d.year < 1900 or d.year > 2200:
            return fallback
        return d
    except (ValueError, AttributeError):
        return fallback


def _require_date(s: str, param_name: str) -> date:
    """Parse une date et lève HTTPException 400 si invalide."""
    d = _safe_date(s)
    if d is None:
        raise HTTPException(
            status_code=400,
            detail=f"Paramètre '{param_name}' invalide : '{s}'. Format attendu : YYYY-MM-DD (ex: 2025-01-15)."
        )
    return d

@router.get("/accounts")
def get_accounts(db: Session = Depends(get_db)):
    accounts = db.query(Account).all()
    # User wants only reconciled transactions for current balance
    balances = calculate_balances(db, only_reconciled=True)
    
    result = []
    for acc in accounts:
        result.append({
            "id": acc.id,
            "name": acc.name,
            "type": acc.type,
            "is_closed": acc.is_closed,
            "color": acc.color,
            "balance": balances.get(acc.id, 0.0)
        })
    return result

@router.get("/dashboard")
def get_dashboard_stats(db: Session = Depends(get_db)):
    today = date.today()
    
    # User wants net worth to be based only on reconciled transactions
    net_worth = get_net_worth(db, only_reconciled=True)
    
    pay_info = predict_next_paycheck(db)
    next_pay_date = pay_info["date"]
    next_pay_amount = pay_info["amount"]
    is_pay_override = pay_info["is_override"]
    is_pay_validated = pay_info.get("is_period_validated", False)
    validated_pay_date = pay_info.get("validated_pay_date", None)
    pay_history = pay_info.get("history", [])
        
    rest_to_live = calculate_rest_to_live(db, today, next_pay_date)
    
    # Use dynamic main account
    main_acc = get_main_account(db)
    warning = get_overdraft_warning(db) if main_acc else None
    
    # Calculate unreconciled expenses before next pay
    unreconciled_expenses = 0.0
    if next_pay_date and main_acc:
        unrec_txs = db.query(Transaction).filter(
            Transaction.date_operation <= next_pay_date,
            Transaction.reconciliation_date.is_(None),
            Transaction.from_account_id == main_acc.id
        ).all()
        unreconciled_expenses = sum(tx.amount for tx in unrec_txs)
        
    total_unreconciled_expenses = 0.0
    if main_acc:
        all_unrec_txs = db.query(Transaction).filter(
            Transaction.reconciliation_date.is_(None),
            Transaction.from_account_id == main_acc.id
        ).all()
        total_unreconciled_expenses = sum(tx.amount for tx in all_unrec_txs)
        
    # Hide overdraft warning if the risk date is after the next predicted pay date
    if warning and next_pay_date:
        if warning["date"] > next_pay_date:
            warning = None
            
    # Calculate global budget summary grouped by period type for sidebar bars
    from app.routers.budgets import get_budget_status, _parse_account_ids
    from app.models import Account
    budget_data = get_budget_status(today.year, today.month, db=db)
    period_groups = {}
    savings_summary = {"funded": 0, "goal": 0, "balance": 0, "count": 0}
    for b in budget_data["budgets"]:
        # Separate savings (tirelire) from spending
        if (b.get("envelope_type") or "spending") == "savings":
            savings_summary["funded"] += b.get("funded", 0)
            savings_summary["goal"] += b.get("budget_amount", 0)
            savings_summary["balance"] += b.get("balance", 0)
            savings_summary["count"] += 1
            continue

        p = b.get("period", "monthly")
        if p not in period_groups:
            period_groups[p] = {"target": 0, "expenses": 0, "reconciled_expenses": 0, "accounts": {}}
        period_groups[p]["target"] += b["budget_amount"] + b.get("income", 0)
        period_groups[p]["expenses"] += b.get("expenses", 0)
        period_groups[p]["reconciled_expenses"] += b.get("reconciled_expenses", 0)

        # Improvement_04: Sub-group by account scope
        acc_ids = b.get("account_ids") or []
        acc_key = ",".join(str(x) for x in sorted(acc_ids)) if acc_ids else "__global__"
        if acc_key not in period_groups[p]["accounts"]:
            period_groups[p]["accounts"][acc_key] = {
                "target": 0, "expenses": 0, "reconciled_expenses": 0,
                "account_ids": acc_ids
            }
        period_groups[p]["accounts"][acc_key]["target"] += b["budget_amount"] + b.get("income", 0)
        period_groups[p]["accounts"][acc_key]["expenses"] += b.get("expenses", 0)
        period_groups[p]["accounts"][acc_key]["reconciled_expenses"] += b.get("reconciled_expenses", 0)

    # Resolve account names for sidebar display
    all_acc_ids = set()
    for pg in period_groups.values():
        for sub in pg["accounts"].values():
            all_acc_ids.update(sub.get("account_ids") or [])
    if all_acc_ids:
        acc_map = {a.id: {"name": a.name, "color": a.color} for a in db.query(Account).filter(Account.id.in_(list(all_acc_ids))).all()}
        for pg in period_groups.values():
            for sub in pg["accounts"].values():
                sub["account_names"] = [acc_map.get(aid, {}).get("name", f"#{aid}") for aid in (sub.get("account_ids") or [])]
                first_acc = acc_map.get((sub.get("account_ids") or [None])[0]) if sub.get("account_ids") else None
                sub["accent_color"] = first_acc["color"] if first_acc and first_acc.get("color") else None
    
    return {
        "net_worth": net_worth,
        "rest_to_live": rest_to_live,
        "next_pay_date": next_pay_date,
        "next_pay_amount": next_pay_amount,
        "is_pay_override": is_pay_override,
        "is_pay_validated": is_pay_validated,
        "validated_pay_date": validated_pay_date,
        "pay_history": pay_history,
        "overdraft_warning": warning,
        "unreconciled_expenses": unreconciled_expenses,
        "total_unreconciled_expenses": total_unreconciled_expenses,
        "budget_summary": period_groups,
        "savings_summary": savings_summary,
    }

from pydantic import BaseModel

class PaycheckOverride(BaseModel):
    date: str
    amount: float

@router.post("/override_paycheck")
def override_paycheck(data: PaycheckOverride, db: Session = Depends(get_db)):
    from app.services.finance_engine import predict_next_paycheck
    from app.models import GlobalConfig
    
    pay_info = predict_next_paycheck(db)
    logical_period = pay_info.get("logical_period")
    
    # Save or update date override
    conf_date = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_date").first()
    if conf_date:
        conf_date.value = data.date
    else:
        db.add(GlobalConfig(key="override_paycheck_date", value=data.date))
        
    # Save or update amount override
    conf_amount = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
    if conf_amount:
        conf_amount.value = str(data.amount)
    else:
        db.add(GlobalConfig(key="override_paycheck_amount", value=str(data.amount)))
        
    # Save logical period for this override
    if logical_period:
        conf_period = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_period").first()
        if conf_period:
            conf_period.value = logical_period
        else:
            db.add(GlobalConfig(key="override_paycheck_period", value=logical_period))
            
    db.commit()
    return {"ok": True}


@router.post("/validate_pay_period")
def validate_pay_period(action: str = None, db: Session = Depends(get_db)):
    from app.models import GlobalConfig
    from app.services.finance_engine import predict_next_paycheck
    from datetime import date
    
    conf = db.query(GlobalConfig).filter(GlobalConfig.key == "last_validated_pay_period").first()
    conf_date = db.query(GlobalConfig).filter(GlobalConfig.key == "last_validated_pay_date").first()
    
    if action == "reset":
        if conf:
            db.delete(conf)
        if conf_date:
            db.delete(conf_date)
        if conf or conf_date:
            db.commit()
        return {"ok": True, "period": None, "action": "reset"}
        
    # Get the currently predicted next paycheck date to validate that period!
    pay_info = predict_next_paycheck(db)
    next_pay_date = pay_info["date"]
    period_str = pay_info.get("logical_period")
    if not period_str:
        period_str = f"{next_pay_date.year:04d}-{next_pay_date.month:02d}"
        
    if conf:
        conf.value = period_str
    else:
        db.add(GlobalConfig(key="last_validated_pay_period", value=period_str))
        
    if action == "force":
        # The user forced the month without receiving a paycheck. 
        # Inject an override with amount 0 for this logical period so it affects history estimations.
        conf_ov_date = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_date").first()
        if conf_ov_date:
            conf_ov_date.value = next_pay_date.isoformat()
        else:
            db.add(GlobalConfig(key="override_paycheck_date", value=next_pay_date.isoformat()))
            
        conf_ov_amt = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
        if conf_ov_amt:
            conf_ov_amt.value = "0.0"
        else:
            db.add(GlobalConfig(key="override_paycheck_amount", value="0.0"))
            
        conf_ov_per = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_period").first()
        if conf_ov_per:
            conf_ov_per.value = period_str
        else:
            db.add(GlobalConfig(key="override_paycheck_period", value=period_str))
        
    today_str = date.today().isoformat()
    if conf_date:
        conf_date.value = today_str
    else:
        db.add(GlobalConfig(key="last_validated_pay_date", value=today_str))
    
    db.commit()
    return {"ok": True, "period": period_str, "action": action}

@router.delete("/override_paycheck")
def delete_override_paycheck(db: Session = Depends(get_db)):
    from app.models import GlobalConfig
    for key in ("override_paycheck_date", "override_paycheck_amount", "override_paycheck_period"):
        override = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        if override:
            db.delete(override)
    db.commit()
    return {"ok": True}



@router.get("/main_account")
def get_main_account_info(db: Session = Depends(get_db)):
    """Returns the currently detected main account (auto or user-set)."""
    from app.services.finance_engine import get_main_account
    acc = get_main_account(db)
    if not acc:
        return None
    return {"id": acc.id, "name": acc.name, "type": acc.type}


@router.post("/main_account/{account_id}")
def set_main_account(account_id: int, db: Session = Depends(get_db)):
    """Override the auto-detected main account."""
    from app.models import GlobalConfig
    conf = db.query(GlobalConfig).filter(GlobalConfig.key == "main_account_id").first()
    if conf:
        conf.value = str(account_id)
    else:
        db.add(GlobalConfig(key="main_account_id", value=str(account_id)))
    db.commit()
    return {"ok": True}


@router.get("/categories_by_month")
def get_categories_by_month(months: int = 12, reconciled: str = "all", year: int = None, account_ids: str = None, date_start: str = None, date_end: str = None, db: Session = Depends(get_db)):
    """Returns spending per category per month for the last N months (or a specific year), grouped by transaction type.
    reconciled: 'all' | 'reconciled' | 'unreconciled'
    year: if provided, show Jan-Dec of that year instead of rolling months
    date_start/date_end: YYYY-MM-DD, overrides year and months params for day-granularity custom range
    """
    import calendar
    today = date.today()

    # Custom date range takes priority
    if date_start and date_end:
        d_start = _require_date(date_start, "date_start")
        d_end = _require_date(date_end, "date_end")
        # Garantir que start <= end (échange silencieux si inversés)
        if d_start > d_end:
            d_start, d_end = d_end, d_start

        # Generate month_keys spanning the range
        month_keys = []
        cur_y, cur_m = d_start.year, d_start.month
        while (cur_y, cur_m) <= (d_end.year, d_end.month):
            month_keys.append(f"{cur_y:04d}-{cur_m:02d}")
            cur_m += 1
            if cur_m > 12:
                cur_m = 1
                cur_y += 1

        query = db.query(Transaction).filter(
            Transaction.date_operation >= d_start,
            Transaction.date_operation <= d_end
        )
    elif year:
        # Specific year: all 12 months (including future — unreconciled ops may exist)
        month_keys = [f"{year:04d}-{m:02d}" for m in range(1, 13)]
        date_from = date(year, 1, 1)
        date_to = date(year, 12, 31)
        query = db.query(Transaction).filter(
            Transaction.date_operation >= date_from,
            Transaction.date_operation <= date_to
        )
    else:
        # Rolling N months from today
        month_keys = []
        for i in range(months - 1, -1, -1):
            m = today.month - i
            y = today.year
            while m <= 0:
                m += 12
                y -= 1
            month_keys.append(f"{y:04d}-{m:02d}")
        query = db.query(Transaction).filter(
            Transaction.date_operation >= date(today.year - (months // 12 + 1), 1, 1)
        )
    # Reconciliation filter
    if reconciled == "reconciled":
        query = query.filter(Transaction.reconciliation_date != None)
    elif reconciled == "unreconciled":
        query = query.filter(Transaction.reconciliation_date == None)

    # Account filter
    acc_ids_list = None
    if account_ids:
        acc_ids_list = [int(x) for x in account_ids.split(',') if x.strip()]
        if acc_ids_list:
            from sqlalchemy import or_
            query = query.filter(or_(
                Transaction.from_account_id.in_(acc_ids_list),
                Transaction.to_account_id.in_(acc_ids_list)
            ))

    txs = query.all()

    # Group: {type: {category: {month_key: amount}}}
    TYPE_ORDER = ["expense_var", "expense_fixed", "income", "transfer", "neutral"]
    grouped = {t: {} for t in TYPE_ORDER}

    for tx in txs:
        mk = tx.date_operation.strftime("%Y-%m")
        if mk not in month_keys:
            continue
        tx_type = tx.type or "neutral"
        if tx_type not in grouped:
            grouped[tx_type] = {}
        cat = tx.category or "Sans cat\u00e9gorie"
        if cat not in grouped[tx_type]:
            grouped[tx_type][cat] = {}
        grouped[tx_type][cat][mk] = round(grouped[tx_type][cat].get(mk, 0.0) + tx.amount, 2)

    # Sort categories within each type by total desc, remove empty types
    result = {}
    for tx_type in TYPE_ORDER:
        cat_data = grouped.get(tx_type, {})
        if not cat_data:
            continue
        totals_per_cat = {cat: sum(v.values()) for cat, v in cat_data.items()}
        sorted_cats = sorted(cat_data.keys(), key=lambda c: -totals_per_cat[c])
        result[tx_type] = {
            "categories": {cat: cat_data[cat] for cat in sorted_cats},
            "totals_per_cat": totals_per_cat,
            "totals_per_month": {
                mk: round(sum(cat_data[c].get(mk, 0.0) for c in cat_data), 2)
                for mk in month_keys
            },
            "grand_total": round(sum(totals_per_cat.values()), 2)
        }

    # ----- Annual totals: scan ALL years in DB (with same reconciliation filter) -----
    all_query = db.query(Transaction)
    if reconciled == "reconciled":
        all_query = all_query.filter(Transaction.reconciliation_date != None)
    elif reconciled == "unreconciled":
        all_query = all_query.filter(Transaction.reconciliation_date == None)
    all_txs = all_query.all()
    
    # Apply same account filter to annual totals
    if acc_ids_list:
        all_txs = [tx for tx in all_txs if (tx.from_account_id in acc_ids_list or tx.to_account_id in acc_ids_list)]

    # Collect distinct years
    years_set = set()
    for tx in all_txs:
        if tx.date_operation:
            years_set.add(tx.date_operation.year)
    years = sorted(years_set)

    # annual_totals: {type: {category: {year: amount}}}
    annual: dict = {}
    for tx in all_txs:
        if not tx.date_operation:
            continue
        yr = str(tx.date_operation.year)
        tx_type = tx.type or "neutral"
        cat = tx.category or "Sans cat\u00e9gorie"
        if tx_type not in annual:
            annual[tx_type] = {}
        if cat not in annual[tx_type]:
            annual[tx_type][cat] = {}
        annual[tx_type][cat][yr] = round(annual[tx_type][cat].get(yr, 0.0) + tx.amount, 2)

    # Attach annual totals to result (keep same type/cat structure)
    for tx_type, type_data in result.items():
        ann_type = annual.get(tx_type, {})
        type_data["annual_by_cat"] = {
            cat: {str(y): ann_type.get(cat, {}).get(str(y), 0.0) for y in years}
            for cat in type_data["categories"]
        }
        type_data["annual_totals_per_year"] = {
            str(y): round(sum(ann_type.get(cat, {}).get(str(y), 0.0) for cat in type_data["categories"]), 2)
            for y in years
        }

    return {"months": month_keys, "years": [str(y) for y in years], "by_type": result}


@router.get("/trends/{account_id}")
def get_trends(account_id: str, db: Session = Depends(get_db)):
    """Returns the historical daily balances for an account, or 'total'."""
    from datetime import timedelta
    today = date.today()
    
    if account_id == "total":
        accounts = db.query(Account).all()
        target_account_ids = [a.id for a in accounts]
        starting_balance = sum(a.initial_balance for a in accounts)
        tx_query = db.query(Transaction).order_by(Transaction.date_operation.asc())
    else:
        try:
            acc_id = int(account_id)
        except ValueError:
            return {"error": "Invalid account id"}
        account = db.query(Account).filter(Account.id == acc_id).first()
        if not account:
            return {"error": "Account not found"}
        target_account_ids = [acc_id]
        starting_balance = account.initial_balance
        tx_query = db.query(Transaction).filter(
            (Transaction.from_account_id == acc_id) | (Transaction.to_account_id == acc_id)
        ).order_by(Transaction.date_operation.asc())
        
    transactions = tx_query.all()
    
    if not transactions:
        return {"current_balance": round(starting_balance, 2), "history": [{"date": today.isoformat(), "balance": round(starting_balance, 2)}]}
        
    start_date = transactions[0].date_operation
    if start_date > today:
        start_date = today

    daily_changes = {}
    for tx in transactions:
        d = tx.date_operation.isoformat()
        if d not in daily_changes:
            daily_changes[d] = 0.0
            
        if tx.from_account_id in target_account_ids and tx.to_account_id in target_account_ids:
            pass # Net change is 0
        elif tx.from_account_id in target_account_ids:
            daily_changes[d] -= tx.amount
        elif tx.to_account_id in target_account_ids:
            daily_changes[d] += tx.amount

    history = []
    current_date = start_date
    current_bal = starting_balance
    
    while current_date <= today:
        d_str = current_date.isoformat()
        if d_str in daily_changes:
            current_bal += daily_changes[d_str]
            
        history.append({
            "date": d_str,
            "balance": round(current_bal, 2)
        })
        current_date += timedelta(days=1)
        
    return {"current_balance": round(current_bal, 2), "history": history}

