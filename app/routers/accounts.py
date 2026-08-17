from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Account, Budget
from app.schemas.api_schemas import AccountBase, AccountOut
from app.services.history_service import record_action, snapshot_entity
from app.services import stats_cache

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

@router.get("/", response_model=List[AccountOut])
def get_accounts(db: Session = Depends(get_db)):
    return db.query(Account).all()

@router.post("/", response_model=AccountOut)
def create_account(acc: AccountBase, db: Session = Depends(get_db)):
    new_acc = Account(**acc.model_dump())
    db.add(new_acc)
    db.flush()
    action_id = record_action(db, "account", new_acc.id, "CREATE", None, snapshot_entity(new_acc))
    db.commit()
    stats_cache.invalidate()
    db.refresh(new_acc)
    new_acc.action_id = action_id
    return new_acc

@router.put("/{acc_id}", response_model=AccountOut)
def update_account(acc_id: int, acc: AccountBase, db: Session = Depends(get_db)):
    db_acc = db.query(Account).filter(Account.id == acc_id).first()
    if not db_acc:
        raise HTTPException(status_code=404, detail="Account not found")
    
    old_snapshot = snapshot_entity(db_acc)
    for key, value in acc.model_dump().items():
        setattr(db_acc, key, value)
        
    db.flush()
    action_id = record_action(db, "account", db_acc.id, "UPDATE", old_snapshot, snapshot_entity(db_acc))
    db.commit()
    stats_cache.invalidate()
    db.refresh(db_acc)
    db_acc.action_id = action_id
    return db_acc

@router.delete("/{acc_id}")
def delete_account(acc_id: int, db: Session = Depends(get_db)):
    db_acc = db.query(Account).filter(Account.id == acc_id).first()
    if not db_acc:
        raise HTTPException(status_code=404, detail="Account not found")
    old_snapshot = snapshot_entity(db_acc)

    # Nettoyer les références orphelines dans les budgets
    import json
    budgets_with_accounts = db.query(Budget).filter(Budget.account_ids.isnot(None)).all()
    for b in budgets_with_accounts:
        try:
            ids = json.loads(b.account_ids) if isinstance(b.account_ids, str) else (b.account_ids or [])
            if acc_id in ids:
                ids.remove(acc_id)
                b.account_ids = json.dumps(ids) if ids else None
        except (json.JSONDecodeError, TypeError):
            pass

    db.delete(db_acc)
    action_id = record_action(db, "account", acc_id, "DELETE", old_snapshot, None)
    db.commit()
    stats_cache.invalidate()
    return {"ok": True, "action_id": action_id}


from datetime import date
from pydantic import BaseModel
from typing import Optional
from app.models import Transaction
from app.services.loan_engine import compute_amortization_monthly, compute_savings_estimated_interest

class ApplyInterestRequest(BaseModel):
    amount: float
    date_operation: Optional[date] = None
    description: Optional[str] = "Intérêts annuels"
    category: Optional[str] = "Intérêts"


@router.get("/{acc_id}/financial-info")
def get_account_financial_info(acc_id: int, db: Session = Depends(get_db)):
    acc = db.query(Account).filter(Account.id == acc_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    t = (acc.type or "").lower()
    is_loan = any(k in t for k in ["prêt", "pret", "emprunt", "loan", "crédit", "credit"])
    
    from app.services.finance_engine import calculate_balances
    balances = calculate_balances(db, only_reconciled=False)
    current_balance = balances.get(acc.id, acc.initial_balance or 0.0)

    if is_loan:
        amortization = compute_amortization_monthly(
            crd=current_balance,
            annual_rate_pct=acc.interest_rate,
            monthly_payment=acc.monthly_payment,
            insurance=acc.loan_insurance or 0.0
        )
        borrowed = acc.borrowed_amount or abs(acc.initial_balance or 0.0)
        repaid = max(0.0, borrowed - abs(current_balance))
        pct_repaid = round((repaid / borrowed * 100.0), 1) if borrowed > 0 else 0.0
        return {
            "account_id": acc.id,
            "type": "loan",
            "current_balance": current_balance,
            "borrowed_amount": borrowed,
            "repaid_amount": repaid,
            "repaid_percent": pct_repaid,
            "interest_rate": acc.interest_rate,
            "monthly_payment": acc.monthly_payment,
            "loan_insurance": acc.loan_insurance,
            "loan_end_date": acc.loan_end_date,
            "amortization": amortization
        }
    else:
        today = date.today()
        months_left = max(1, 12 - today.month + 1)
        savings = compute_savings_estimated_interest(
            balance=current_balance,
            annual_rate_pct=acc.interest_rate,
            months_remaining=months_left
        )
        return {
            "account_id": acc.id,
            "type": "savings",
            "current_balance": current_balance,
            "interest_rate": acc.interest_rate,
            "estimated_interest": savings["estimated_interest"],
            "months_remaining": months_left
        }


@router.post("/{acc_id}/apply-interest")
def apply_savings_interest(acc_id: int, req: ApplyInterestRequest, db: Session = Depends(get_db)):
    acc = db.query(Account).filter(Account.id == acc_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    op_date = req.date_operation or date(date.today().year, 12, 31)
    new_tx = Transaction(
        date_saisie=date.today(),
        date_operation=op_date,
        description=req.description or "Intérêts annuels",
        amount=abs(req.amount),
        type="income",
        category=req.category or "Intérêts",
        to_account_id=acc.id
    )
    db.add(new_tx)
    db.flush()
    action_id = record_action(db, "transaction", new_tx.id, "CREATE", None, snapshot_entity(new_tx))
    db.commit()
    stats_cache.invalidate()
    return {"ok": True, "transaction_id": new_tx.id, "action_id": action_id}
