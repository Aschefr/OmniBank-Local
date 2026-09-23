"""
app/routers/autopilot.py — API Router pour le Centre de Contrôle Auto-Pilote.
Fournit les routes pour la consultation d'état, les KPIs, le Decision Feed,
les opérations d'annulation/rollback sémantique et le réglage du seuil de tolérance.
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.profile_manager import get_active_profile
from app.schemas.api_schemas import (
    AutopilotStatusOut,
    AutopilotToggleRequest,
    AutopilotThresholdIn,
    AutopilotThresholdOut,
    AutopilotKPIOut,
    AutopilotDecisionFeedOut,
    AutopilotOverrideRequest,
    AutopilotRollbackCycleOut,
)
from app.services.autopilot_service import (
    get_autopilot_status,
    set_autopilot_enabled,
    get_auto_reconcile_threshold,
    set_auto_reconcile_threshold,
    get_autopilot_kpis,
    get_autopilot_decisions_feed,
    rollback_autopilot_decision,
    rollback_autopilot_cycle,
    override_autopilot_decision,
    unpoint_autopilot_decision,
    mark_autopilot_visited,
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
    val = set_auto_reconcile_threshold(db, payload.threshold)
    return {"threshold": val}


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
