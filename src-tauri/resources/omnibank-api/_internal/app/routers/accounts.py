from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models import Account
from app.schemas.api_schemas import AccountBase, AccountOut

router = APIRouter(prefix="/api/accounts", tags=["accounts"])

@router.get("/", response_model=List[AccountOut])
def get_accounts(db: Session = Depends(get_db)):
    return db.query(Account).all()

@router.post("/", response_model=AccountOut)
def create_account(acc: AccountBase, db: Session = Depends(get_db)):
    new_acc = Account(**acc.dict())
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)
    return new_acc

@router.put("/{acc_id}", response_model=AccountOut)
def update_account(acc_id: int, acc: AccountBase, db: Session = Depends(get_db)):
    db_acc = db.query(Account).filter(Account.id == acc_id).first()
    if not db_acc:
        raise HTTPException(status_code=404, detail="Account not found")
    
    for key, value in acc.dict().items():
        setattr(db_acc, key, value)
        
    db.commit()
    db.refresh(db_acc)
    return db_acc

@router.delete("/{acc_id}")
def delete_account(acc_id: int, db: Session = Depends(get_db)):
    db_acc = db.query(Account).filter(Account.id == acc_id).first()
    if not db_acc:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(db_acc)
    db.commit()
    return {"ok": True}
