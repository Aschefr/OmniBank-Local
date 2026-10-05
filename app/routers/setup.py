from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account

router = APIRouter(prefix="/api/setup", tags=["setup"])


@router.get("/status")
def get_setup_status(db: Session = Depends(get_db)):
    """Check if initial setup is needed (no accounts = first launch or DB wiped)."""
    has_accounts = db.query(Account).first() is not None
    from app.services.demo_seed import is_demo_active
    return {"needs_setup": not has_accounts, "demo_active": is_demo_active(db)}


@router.post("/seed-demo")
def seed_demo_data(db: Session = Depends(get_db)):
    """Injecte un jeu de données de démonstration enrichi (6 mois d'historique, Auto-Pilote, budgets)."""
    from app.services.demo_seed import seed_demo
    return seed_demo(db)


@router.post("/reset-demo")
def reset_demo_data(
    x_confirm_danger: Optional[str] = Header(None, alias="X-Confirm-Danger"),
    db: Session = Depends(get_db)
):
    """Supprime uniquement les données de démonstration (les données réelles sont conservées)."""
    if x_confirm_danger != "reset-demo":
        raise HTTPException(status_code=400, detail="En-tête de confirmation manquant (X-Confirm-Danger: reset-demo).")
    from app.services.demo_seed import reset_demo
    return reset_demo(db)


@router.post("/reset-all")
def reset_all_data(
    x_confirm_danger: Optional[str] = Header(None, alias="X-Confirm-Danger"),
    db: Session = Depends(get_db)
):
    """Remise à zéro complète : données financières, marqueurs de démo et réglages d'onboarding."""
    if x_confirm_danger != "reset-all":
        raise HTTPException(status_code=400, detail="En-tête de confirmation manquant (X-Confirm-Danger: reset-all).")
    from app.models import (
        Transaction, BudgetAllocation, BudgetCategory, Budget, RecurrenceTemplate, Category,
        AutopilotDecisionLog, GlobalConfig
    )
    from app.services import stats_cache
    from app.services.demo_seed import DEMO_FLAG_KEY, MANIFEST_KEY
    for model in (Transaction, AutopilotDecisionLog, BudgetAllocation, BudgetCategory, Budget,
                  RecurrenceTemplate, Category, Account):
        db.query(model).delete(synchronize_session=False)
    db.query(GlobalConfig).filter(GlobalConfig.key.in_(
        [DEMO_FLAG_KEY, MANIFEST_KEY, "main_account_id", "base_pay_day", "base_pay_amount",
         "base_pay_type", "base_pay_day_2"]
    )).delete(synchronize_session=False)
    db.commit()
    stats_cache.invalidate()
    return {"ok": True, "needs_setup": True}
