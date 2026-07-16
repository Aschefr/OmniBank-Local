from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Account
from app.schemas.api_schemas import AccountBase, AccountOut
from app.services.history_service import record_action, snapshot_entity

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

@router.get("/", response_model=List[AccountOut])
def get_accounts(db: Session = Depends(get_db)):
    return db.query(Account).all()

@router.post("/", response_model=AccountOut)
def create_account(acc: AccountBase, db: Session = Depends(get_db)):
    new_acc = Account(**acc.dict())
    db.add(new_acc)
    db.flush()
    action_id = record_action(db, "account", new_acc.id, "CREATE", None, snapshot_entity(new_acc))
    db.commit()
    db.refresh(new_acc)
    new_acc.action_id = action_id
    return new_acc

@router.put("/{acc_id}", response_model=AccountOut)
def update_account(acc_id: int, acc: AccountBase, db: Session = Depends(get_db)):
    db_acc = db.query(Account).filter(Account.id == acc_id).first()
    if not db_acc:
        raise HTTPException(status_code=404, detail="Account not found")
    
    old_snapshot = snapshot_entity(db_acc)
    for key, value in acc.dict().items():
        setattr(db_acc, key, value)
        
    db.flush()
    action_id = record_action(db, "account", db_acc.id, "UPDATE", old_snapshot, snapshot_entity(db_acc))
    db.commit()
    db.refresh(db_acc)
    db_acc.action_id = action_id
    return db_acc

@router.delete("/{acc_id}")
def delete_account(acc_id: int, db: Session = Depends(get_db)):
    db_acc = db.query(Account).filter(Account.id == acc_id).first()
    if not db_acc:
        raise HTTPException(status_code=404, detail="Account not found")
    old_snapshot = snapshot_entity(db_acc)
    db.delete(db_acc)
    action_id = record_action(db, "account", acc_id, "DELETE", old_snapshot, None)
    db.commit()
    return {"ok": True, "action_id": action_id}
