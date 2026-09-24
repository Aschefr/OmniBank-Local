"""
app/routers/autopilot.py — API Router pour le Centre de Contrôle Auto-Pilote.
Fournit les routes pour la consultation d'état, les KPIs, le Decision Feed,
les opérations d'annulation/rollback sémantique et le réglage du seuil de tolérance.
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.profile_manager import get_active_profile
from app.schemas.api_schemas import (
    AutopilotStatusOut,
    AutopilotToggleRequest,
    AutopilotSubtoggleRequest,
    AutopilotThresholdIn,
    AutopilotThresholdOut,
    AutopilotKPIOut,
    AutopilotDecisionFeedOut,
    AutopilotOverrideRequest,
    AutopilotRollbackCycleOut,
    AutopilotReviewItem,
    AutopilotReviewUpdateRequest,
    AutopilotReviewLinkRequest,
    AutopilotThresholdPreviewOut,
)
from app.services.autopilot_service import (
    get_autopilot_status,
    set_autopilot_enabled,
    set_autopilot_subtoggle,
    get_auto_reconcile_threshold,
    set_auto_reconcile_threshold,
    get_autopilot_kpis,
    get_autopilot_decisions_feed,
    rollback_autopilot_decision,
    rollback_autopilot_cycle,
    override_autopilot_decision,
    unpoint_autopilot_decision,
    mark_autopilot_visited,
    get_review_queue,
    validate_review_transaction,
    update_review_transaction,
    link_review_transaction,
    preview_threshold_impact,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/autopilot", tags=["autopilot"])


@router.get("/status", response_model=AutopilotStatusOut)
def get_status(db: Session = Depends(get_db)):
    """Retourne l'état complet du mode Auto-Pilote, les sous-options actives et le seuil de tolérance."""
    active_pid = get_active_profile().get("id", "default")
    return get_autopilot_status(db, profile_id=active_pid)


@router.post("/toggle", response_model=AutopilotStatusOut)
def toggle_autopilot(payload: AutopilotToggleRequest, db: Session = Depends(get_db)):
    """Active ou désactive le mode maître Auto-Pilote."""
    active_pid = get_active_profile().get("id", "default")
    set_autopilot_enabled(db, payload.enabled)
    return get_autopilot_status(db, profile_id=active_pid)


@router.post("/subtoggle", response_model=AutopilotStatusOut)
def toggle_subtoggle(payload: AutopilotSubtoggleRequest, db: Session = Depends(get_db)):
    """Active ou désactive une brique élémentaire d'autonomie."""
    active_pid = get_active_profile().get("id", "default")
    try:
        set_autopilot_subtoggle(db, key=payload.key, enabled=payload.enabled)
        return get_autopilot_status(db, profile_id=active_pid)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"[AutoPilot] Erreur mise à jour brique {payload.key}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur mise à jour brique d'autonomie.")


@router.get("/threshold", response_model=AutopilotThresholdOut)
def get_threshold(db: Session = Depends(get_db)):
    """Retourne le seuil de tolérance (score de confiance) configuré."""
    val = get_auto_reconcile_threshold(db)
    return {"threshold": val}


@router.put("/threshold", response_model=AutopilotThresholdOut)
def update_threshold(payload: AutopilotThresholdIn, db: Session = Depends(get_db)):
    """Met à jour le seuil de tolérance (score de confiance, 70.0 - 99.0)."""
    if payload.threshold < 70.0 or payload.threshold > 99.0:
        raise HTTPException(
            status_code=400,
            detail="Le seuil de tolérance doit être compris entre 70% et 99%."
        )
    val, applied_count = set_auto_reconcile_threshold(db, payload.threshold, apply_to_existing=payload.apply_to_existing)
    return {"threshold": val, "applied_count": applied_count}


@router.get("/threshold-preview", response_model=AutopilotThresholdPreviewOut)
def get_threshold_preview(
    threshold: float = Query(..., ge=70.0, le=99.0),
    db: Session = Depends(get_db)
):
    """Simule l'impact d'un seuil de tolérance sur les opérations ayant un score de confiance."""
    return preview_threshold_impact(db, threshold)


@router.get("/review-queue", response_model=List[AutopilotReviewItem])
def get_autopilot_review_queue(db: Session = Depends(get_db)):
    """Retourne les transactions enregistrées en attente de revue manuelle (needs_review == True)."""
    active_pid = get_active_profile().get("id", "default")
    return get_review_queue(db, profile_id=active_pid)


@router.post("/review/{tx_id}/validate")
def validate_review(tx_id: int, db: Session = Depends(get_db)):
    """Acquitte et valide une opération de la file de revue."""
    active_pid = get_active_profile().get("id", "default")
    try:
        return validate_review_transaction(db, tx_id=tx_id, profile_id=active_pid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[AutoPilot] Erreur validation revue tx {tx_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de la validation de la revue.")


@router.post("/review/{tx_id}/update")
def update_review(
    tx_id: int,
    payload: AutopilotReviewUpdateRequest,
    db: Session = Depends(get_db)
):
    """Corrige la description ou catégorie d'une opération en attente de revue et l'acquitte (ou la lie)."""
    active_pid = get_active_profile().get("id", "default")
    try:
        return update_review_transaction(
            db,
            tx_id=tx_id,
            description=payload.description,
            category=payload.category,
            amount=payload.amount,
            target_forecast_id=payload.target_forecast_id,
            learn_rule=payload.learn_rule,
            profile_id=active_pid
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[AutoPilot] Erreur modification revue tx {tx_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de la modification de l'opération.")


@router.post("/review/{tx_id}/link")
def link_review(
    tx_id: int,
    payload: AutopilotReviewLinkRequest,
    db: Session = Depends(get_db)
):
    """Fusionne et lie une opération de revue avec une prévision existante."""
    active_pid = get_active_profile().get("id", "default")
    try:
        return link_review_transaction(
            db,
            tx_id=tx_id,
            target_forecast_id=payload.target_forecast_id,
            learn_rule=payload.learn_rule,
            description=payload.description,
            category=payload.category,
            amount=payload.amount,
            profile_id=active_pid
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[AutoPilot] Erreur liaison revue tx {tx_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de la liaison de l'opération.")



@router.get("/kpis", response_model=AutopilotKPIOut)
def get_kpis(db: Session = Depends(get_db)):
    """Retourne les métriques clés de performance et de gain de temps."""
    active_pid = get_active_profile().get("id", "default")
    return get_autopilot_kpis(db, profile_id=active_pid)


@router.get("/decisions", response_model=AutopilotDecisionFeedOut)
def get_decisions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    decision_type: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    show_undone: bool = Query(True),
    db: Session = Depends(get_db)
):
    """Retourne le flux paginé et filtré des décisions prises par l'Auto-Pilote."""
    return get_autopilot_decisions_feed(
        db,
        limit=limit,
        offset=offset,
        decision_type=decision_type,
        batch_id=batch_id,
        show_undone=show_undone
    )


@router.post("/decisions/{decision_id}/override")
def override_decision(
    decision_id: int,
    payload: AutopilotOverrideRequest,
    db: Session = Depends(get_db)
):
    """Corrige manuellement une décision et renforce l'apprentissage local."""
    active_pid = get_active_profile().get("id", "default")
    try:
        return override_autopilot_decision(
            db,
            decision_id=decision_id,
            new_category=payload.new_category,
            new_description=payload.new_description,
            new_amount=payload.new_amount,
            learn_rule=payload.learn_rule,
            profile_id=active_pid
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[AutoPilot] Erreur override décision {decision_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de la modification de la décision.")


@router.post("/decisions/{decision_id}/unpoint")
def unpoint_decision(
    decision_id: int,
    db: Session = Depends(get_db)
):
    """Dépointe une transaction auto-rapprochée en restaurant son état initial."""
    active_pid = get_active_profile().get("id", "default")
    try:
        return unpoint_autopilot_decision(db, decision_id=decision_id, profile_id=active_pid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[AutoPilot] Erreur dépointage décision {decision_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors du dépointage de l'opération.")


@router.post("/decisions/{decision_id}/rollback")
def rollback_single_decision(
    decision_id: int,
    db: Session = Depends(get_db)
):
    """Annule sémantiquement une décision individuelle."""
    active_pid = get_active_profile().get("id", "default")
    try:
        return rollback_autopilot_decision(db, decision_id=decision_id, profile_id=active_pid)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"[AutoPilot] Erreur rollback décision {decision_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de l'annulation de la décision.")


@router.post("/rollback-cycle/{batch_id}", response_model=AutopilotRollbackCycleOut)
def rollback_batch_cycle(
    batch_id: str,
    db: Session = Depends(get_db)
):
    """Annule toutes les décisions d'un lot et reconstitue le lot complet dans le Sas d'attente."""
    active_pid = get_active_profile().get("id", "default")
    try:
        return rollback_autopilot_cycle(db, batch_id=batch_id, profile_id=active_pid)
    except Exception as e:
        logger.error(f"[AutoPilot] Erreur rollback cycle {batch_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Erreur lors de l'annulation du cycle.")


@router.post("/mark-visited")
def mark_visited(db: Session = Depends(get_db)):
    """Enregistre la date de consultation du Centre de Contrôle pour mettre à jour le badge de notification."""
    visited_at = mark_autopilot_visited(db)
    return {"success": True, "visited_at": visited_at}
