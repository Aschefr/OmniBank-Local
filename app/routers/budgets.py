from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from app.database import get_db

from app.services import budget_service
from app.services import budget_ai_service
from app.services import stats_cache
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
    is_locked: Optional[bool] = False
    base_annual_amount: Optional[float] = None


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
    is_locked: Optional[bool] = None
    base_annual_amount: Optional[float] = None


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
    outlier_sensitivity: Optional[int] = 2
    engine: Optional[str] = None


class AiRefineRequest(BaseModel):
    window_months: int = 3
    lang: Optional[str] = "fr"
    outlier_sensitivity: Optional[int] = 2
    existing_proposals: list[dict] = []
    unclassified_categories: list[dict] = []


class AiRecalculateRequest(BaseModel):
    window_months: int = 3
    outlier_sensitivity: int = 2
    existing_proposals: list[dict] = []
    unclassified_categories: list[dict] = []


class ApproveSuggestionPayload(BaseModel):
    custom_amount: Optional[float] = None


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
        result = budget_service.create_new_budget(data, db)
        stats_cache.invalidate()
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur lors de la création d'un budget: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la création de l'enveloppe : {str(e)}")


@router.put("/{budget_id}")
def update_budget(budget_id: int, data: BudgetUpdate, db: Session = Depends(get_db)):
    try:
        result = budget_service.update_existing_budget(budget_id, data, db)
        stats_cache.invalidate()
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur lors de la mise à jour du budget {budget_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la mise à jour : {str(e)}")


@router.delete("/{budget_id}")
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    try:
        result = budget_service.delete_single_budget(budget_id, db)
        stats_cache.invalidate()
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur lors de la suppression du budget {budget_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la suppression : {str(e)}")


@router.post("/bulk_delete")
def bulk_delete_budgets(data: BulkDeleteRequest, db: Session = Depends(get_db)):
    try:
        result = budget_service.bulk_delete_budgets_by_type(data.target_type, db)
        stats_cache.invalidate()
        return result
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
        result = budget_service.create_allocation_data(budget_id=budget_id, data=data, db=db)
        stats_cache.invalidate()
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur create_allocation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors du dépôt sur la tirelire : {str(e)}")


@router.delete("/{budget_id}/allocations/{alloc_id}")
def delete_allocation(budget_id: int, alloc_id: int, db: Session = Depends(get_db)):
    try:
        result = budget_service.delete_allocation_data(budget_id=budget_id, alloc_id=alloc_id, db=db)
        stats_cache.invalidate()
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur delete_allocation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur serveur lors de la suppression de l'allocation : {str(e)}")


# ─── AI Suggestion Endpoints ──────────────────────────────────────────────────

@router.get("/ai_suggest/status")
def get_ai_suggest_status(db: Session = Depends(get_db)):
    from app.profile_manager import get_active_profile
    pid = get_active_profile()["id"]
    return budget_ai_service.get_ai_suggest_status(profile_id=pid)


@router.post("/ai_suggest/cancel")
def cancel_ai_suggest(db: Session = Depends(get_db)):
    from app.profile_manager import get_active_profile
    pid = get_active_profile()["id"]
    return budget_ai_service.cancel_ai_suggest(profile_id=pid)


@router.post("/ai_suggest")
async def ai_suggest_budgets(data: Optional[AiSuggestRequest] = None, db: Session = Depends(get_db)):
    try:
        from app.profile_manager import get_active_profile
        pid = get_active_profile()["id"]
        window_months = data.window_months if data else 3
        lang = data.lang if data else "fr"
        outlier_sensitivity = data.outlier_sensitivity if (data and data.outlier_sensitivity is not None) else 2
        engine = data.engine if data else None
        return await budget_ai_service.ai_suggest_budgets_service(
            window_months=window_months,
            lang=lang,
            outlier_sensitivity=outlier_sensitivity,
            engine=engine,
            db=db,
            profile_id=pid
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur ai_suggest: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Erreur d'analyse IA : {str(e)}")


@router.post("/ai_suggest/refine")
async def ai_refine_budgets(data: AiRefineRequest, db: Session = Depends(get_db)):
    try:
        return await budget_ai_service.ai_refine_budgets_service(
            window_months=data.window_months,
            lang=data.lang,
            outlier_sensitivity=data.outlier_sensitivity if data.outlier_sensitivity is not None else 2,
            existing_proposals=data.existing_proposals,
            unclassified_categories=data.unclassified_categories,
            db=db
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur ai_refine: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"Erreur d'affinage IA : {str(e)}")


@router.post("/ai_suggest/recalculate")
def ai_recalculate_budgets(data: AiRecalculateRequest, db: Session = Depends(get_db)):
    try:
        return budget_ai_service.ai_recalculate_amounts_service(
            window_months=data.window_months,
            outlier_sensitivity=data.outlier_sensitivity,
            existing_proposals=data.existing_proposals,
            unclassified_categories=data.unclassified_categories,
            db=db
        )
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur ai_recalculate: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erreur de recalcul : {str(e)}")


# ─── AutoPilot Budget Suggestions (Étape 5) ──────────────────────────────────

@router.get("/autopilot/suggestions")
def get_autopilot_budget_suggestions(db: Session = Depends(get_db)):
    """Liste toutes les suggestions budgétaires en attente (créations + recalibrages)."""
    try:
        return budget_service.get_all_pending_budget_suggestions(db)
    except Exception as e:
        logger.error(f"[Budgets AutoPilot] Erreur récupération suggestions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autopilot/suggestions/{decision_id}/approve")
def approve_autopilot_budget_suggestion(
    decision_id: int,
    payload: Optional[ApproveSuggestionPayload] = Body(None),
    db: Session = Depends(get_db)
):
    """Valide une suggestion budgétaire (création ou recalibrage) en 1 clic (avec support de montant personnalisé)."""
    try:
        custom_amount = payload.custom_amount if payload else None
        result = budget_service.apply_budget_suggestion(db, decision_id, custom_amount=custom_amount)
        stats_cache.invalidate()
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets AutoPilot] Erreur approbation suggestion {decision_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autopilot/suggestions/{decision_id}/dismiss")
def dismiss_autopilot_budget_suggestion(decision_id: int, db: Session = Depends(get_db)):
    """Rejette une suggestion budgétaire (garantie anti-harcèlement)."""
    try:
        result = budget_service.dismiss_budget_suggestion(db, decision_id)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets AutoPilot] Erreur rejet suggestion {decision_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/autopilot/suggestions/dismissed")
def get_dismissed_autopilot_budget_suggestions(
    limit: int = 50, db: Session = Depends(get_db)
):
    """Retourne l'historique des suggestions budgétaires écartées."""
    try:
        return budget_service.get_dismissed_budget_suggestions(db, limit=limit)
    except Exception as e:
        logger.error(f"[Budgets AutoPilot] Erreur récupération suggestions écartées: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/autopilot/history")
def get_budget_automations_history_endpoint(
    limit: int = 50, db: Session = Depends(get_db)
):
    """Retourne l'historique des actions automatiques budgétaires exécutées."""
    try:
        return budget_service.get_budget_automations_history(db, limit=limit)
    except Exception as e:
        logger.error(f"[Budgets Automations] Erreur récupération historique des actions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autopilot/suggestions/{decision_id}/reactivate")
def reactivate_autopilot_budget_suggestion(
    decision_id: int, db: Session = Depends(get_db)
):
    """Réactive une suggestion budgétaire précédemment écartée."""
    try:
        return budget_service.reactivate_budget_suggestion(db, decision_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Budgets AutoPilot] Erreur réactivation suggestion {decision_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/autopilot/suggestions/dismissed")
def clear_dismissed_autopilot_budget_suggestions(db: Session = Depends(get_db)):
    """Purge l'ensemble de l'historique des suggestions budgétaires écartées."""
    try:
        return budget_service.clear_dismissed_budget_suggestions(db)
    except Exception as e:
        logger.error(f"[Budgets AutoPilot] Erreur purge suggestions écartées: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


class BulkSuggestionActionRequest(BaseModel):
    decision_ids: Optional[List[int]] = None


@router.post("/autopilot/suggestions/approve-all")
def approve_all_autopilot_budget_suggestions(
    data: Optional[BulkSuggestionActionRequest] = None, db: Session = Depends(get_db)
):
    """Valide en masse les suggestions budgétaires (ou la sélection spécifiée)."""
    try:
        ids = data.decision_ids if data else None
        result = budget_service.apply_all_budget_suggestions(db, ids)
        stats_cache.invalidate()
        return result
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur approbation groupée suggestions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autopilot/suggestions/dismiss-all")
def dismiss_all_autopilot_budget_suggestions(
    data: Optional[BulkSuggestionActionRequest] = None, db: Session = Depends(get_db)
):
    """Rejette en masse les suggestions budgétaires (ou la sélection spécifiée)."""
    try:
        ids = data.decision_ids if data else None
        result = budget_service.dismiss_all_budget_suggestions(db, ids)
        return result
    except Exception as e:
        logger.error(f"[Budgets Router] Erreur rejet groupé suggestions: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/autopilot/recalibrate")
def trigger_budget_recalibration(
    engine: Optional[str] = None, db: Session = Depends(get_db)
):
    """Déclencheur forcé de recalibrage pour preview et tests."""
    try:
        from datetime import datetime, timezone
        from app.models import GlobalConfig
        creation_results = budget_service.suggest_new_envelopes(db, force=True, engine_override=engine)
        recalib_results = budget_service.evaluate_monthly_budget_suggestions(db, force=True)
        stats_cache.invalidate()

        now_iso = datetime.now(timezone.utc).isoformat()
        cfg_last = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_autopilot_run_at").first()
        if cfg_last:
            cfg_last.value = now_iso
        else:
            db.add(GlobalConfig(key="last_budget_autopilot_run_at", value=now_iso))
        db.commit()

        return {
            "new_envelopes": creation_results,
            "recalibrations": recalib_results,
            "total": len(creation_results) + len(recalib_results)
        }
    except Exception as e:
        logger.error(f"[Budgets AutoPilot] Erreur recalibrage forcé: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/autopilot/status")
def get_budget_autopilot_status(db: Session = Depends(get_db)):
    """Retourne le statut temporel et la cadence d'exécution de l'auto-pilote des budgets."""
    try:
        from app.models import GlobalConfig, Budget
        last_run_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_autopilot_run_at").first()
        last_period_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_recalibration_period").first()
        active_count = db.query(Budget).filter(Budget.is_closed == False).count()
        pending_sugg = budget_service.get_all_pending_budget_suggestions(db)

        cfg_creation = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_creation_suggestions").first()
        cfg_auto_create = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_create_budget_envelopes").first()
        cfg_recalib = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_recalibration_suggestions").first()
        cfg_auto_apply = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_apply_budget_suggestions").first()
        cfg_engine = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_suggestion_engine").first()

        return {
            "ok": True,
            "last_run_at": last_run_cfg.value if last_run_cfg and last_run_cfg.value else None,
            "last_period": last_period_cfg.value if last_period_cfg and last_period_cfg.value else None,
            "active_envelopes_count": active_count,
            "is_cold_start": active_count < 3,
            "pending_count": len(pending_sugg),
            "enable_creation": not (cfg_creation and cfg_creation.value and cfg_creation.value.strip().lower() == "false"),
            "auto_create": bool(cfg_auto_create and cfg_auto_create.value.strip().lower() == "true"),
            "enable_recalibration": not (cfg_recalib and cfg_recalib.value and cfg_recalib.value.strip().lower() == "false"),
            "auto_apply": bool(cfg_auto_apply and cfg_auto_apply.value.strip().lower() == "true"),
            "engine": (cfg_engine.value if cfg_engine and cfg_engine.value else "deterministic").strip().lower(),
        }
    except Exception as e:
        logger.error(f"[Budgets AutoPilot] Erreur récupération statut: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


