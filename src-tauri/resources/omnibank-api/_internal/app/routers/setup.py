from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status")
def get_setup_status(db: Session = Depends(get_db)):
    """Check if initial setup is needed (no accounts = first launch or DB wiped)."""
    has_accounts = db.query(Account).first() is not None
    return {"needs_setup": not has_accounts}
