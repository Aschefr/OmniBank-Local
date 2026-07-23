from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db

from app.services import budget_service
from app.services import budget_ai_service
from app.services.budget_service import (
    parse_account_ids as _parse_account_ids,
    serialize_account_ids as _serialize_account_ids,
    safe_parse_budget_date as _safe_parse_budget_date,
    budget_to_dict as _budget_to_dict,
)

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class BudgetCreate(BaseModel):
    name: str
    monthly_amount: float
    period: Optional[str] = "monthly"
    is_project: Optional[bool] = False
    categories: Optional[List[str]] = []
    start_date: Optional[str] = None  # YYYY-MM-DD for custom period
    end_date: Optional[str] = None
    account_ids: Optional[List[int]] = None
    envelope_type: Optional[str] = "spending"  # "spending" or "savings"


class BudgetUpdate(BaseModel):
    name: Optional[str] = None
    monthly_amount: Optional[float] = None
    period: Optional[str] = None
    is_project: Optional[bool] = None
    is_closed: Optional[bool] = None
    categories: Optional[List[str]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    account_ids: Optional[List[int]] = None
    envelope_type: Optional[str] = None


class AllocationCreate(BaseModel):
    amount: float
    date: Optional[str] = None  # YYYY-MM-DD, defaults to today
    note: Optional[str] = None
    account_id: Optional[int] = None


class BulkDeleteRequest(BaseModel):
    target_type: str  # "monthly", "yearly", "spending", "project", "savings", "all"


class AiSuggestRequest(BaseModel):
    window_months: int = 3
    lang: Optional[str] = "fr"


class AiRefineRequest(BaseModel):
    window_months: int = 3
    lang: Optional[str] = "fr"
    existing_proposals: list[dict] = []
    unclassified_categories: list[dict] = []


import logging
logger = logging.getLogger(__name__)

# ─── CRUD Endpoints ───────────────────────────────────────────────────────────

@router.get("/")
def get_budgets(db: Session = Depends(get_db)):
    try:
        return budget_service.get_all_budgets(db)
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur lors de la récupération des budgets: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la lecture des budgets : {str(e)}")


@router.post("/")
def create_budget(data: BudgetCreate, db: Session = Depends(get_db)):
    try:
        return budget_service.create_new_budget(data, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur lors de la création d'un budget: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la création de l'enveloppe : {str(e)}")


@router.put("/{budget_id}")
def update_budget(budget_id: int, data: BudgetUpdate, db: Session = Depends(get_db)):
    try:
        return budget_service.update_existing_budget(budget_id, data, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur lors de la mise à jour du budget {budget_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la mise à jour : {str(e)}")


@router.delete("/{budget_id}")
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    try:
        return budget_service.delete_single_budget(budget_id, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur lors de la suppression du budget {budget_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la suppression : {str(e)}")


@router.post("/bulk_delete")
def bulk_delete_budgets(data: BulkDeleteRequest, db: Session = Depends(get_db)):
    try:
        return budget_service.bulk_delete_budgets_by_type(data.target_type, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur lors de la suppression en masse ({data.target_type}): {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors du nettoyage : {str(e)}")


# ─── Status & Details Endpoints ───────────────────────────────────────────────

@router.get("/status")
def get_budget_status(
    year: int = None,
    month: int = None,
    date_start: str = None,
    date_end: str = None,
    period_filter: str = None,
    db: Session = Depends(get_db)
):
    try:
        return budget_service.get_budget_status_data(
            year=year,
            month=month,
            date_start=date_start,
            date_end=date_end,
            period_filter=period_filter,
            db=db
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur get_budget_status: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors du calcul du statut budgétaire : {str(e)}")


@router.get("/capacity")
def get_budget_capacity(db: Session = Depends(get_db)):
    try:
        return budget_service.get_budget_capacity_data(db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur get_budget_capacity: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors du calcul des capacités : {str(e)}")


@router.get("/{budget_id}/transactions")
def get_budget_transactions(budget_id: int, year: int = None, month: int = None, db: Session = Depends(get_db)):
    try:
        return budget_service.get_budget_transactions_data(budget_id=budget_id, year=year, month=month, db=db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur get_budget_transactions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la lecture des transactions : {str(e)}")


# ─── Allocations Endpoints (Tirelire / Savings) ──────────────────────────────

@router.get("/{budget_id}/allocations")
def get_allocations(budget_id: int, db: Session = Depends(get_db)):
    try:
        return budget_service.get_allocations_data(budget_id=budget_id, db=db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur get_allocations: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la lecture des allocations : {str(e)}")


@router.post("/{budget_id}/allocations")
def create_allocation(budget_id: int, data: AllocationCreate, db: Session = Depends(get_db)):
    try:
        return budget_service.create_allocation_data(budget_id=budget_id, data=data, db=db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur create_allocation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors du dépôt sur la tirelire : {str(e)}")


@router.delete("/{budget_id}/allocations/{alloc_id}")
def delete_allocation(budget_id: int, alloc_id: int, db: Session = Depends(get_db)):
    try:
        return budget_service.delete_allocation_data(budget_id=budget_id, alloc_id=alloc_id, db=db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur delete_allocation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la suppression de l'allocation : {str(e)}")


# ─── AI Suggestion Endpoints ──────────────────────────────────────────────────

@router.get("/ai_suggest/status")
def get_ai_suggest_status():
    return budget_ai_service.get_ai_suggest_status()


@router.post("/ai_suggest/cancel")
def cancel_ai_suggest():
    return budget_ai_service.cancel_ai_suggest()


@router.post("/ai_suggest")
def ai_suggest_budgets(data: Optional[AiSuggestRequest] = None, db: Session = Depends(get_db)):
    try:
        window_months = data.window_months if data else 3
        lang = data.lang if data else "fr"
        return budget_ai_service.ai_suggest_budgets_service(window_months=window_months, lang=lang, db=db)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur ai_suggest: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'analyse IA : {str(e)}")


@router.post("/ai_suggest/refine")
def ai_refine_budgets(data: AiRefineRequest, db: Session = Depends(get_db)):
    try:
        return budget_ai_service.ai_refine_budgets_service(
            window_months=data.window_months,
            lang=data.lang,
            existing_proposals=data.existing_proposals,
            unclassified_categories=data.unclassified_categories,
            db=db
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur ai_refine: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'affinage IA : {str(e)}")
