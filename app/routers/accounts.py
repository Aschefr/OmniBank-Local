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
