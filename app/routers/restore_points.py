"""
Points de restauration de l'Auto-Pilote : liste, restauration et rejeu du lot gardé.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.database import SessionLocal, dispose_engine, get_current_db_path
from app.profile_manager import get_active_profile
from app.services import restore_points as rp

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/autopilot/restore-points", tags=["autopilot"])


class RestoreRequest(BaseModel):
    replay: bool = True


@router.get("")
def list_restore_points():
    """Points du profil, du plus récent au plus ancien (sans les lignes gardées)."""
    return rp.list_points(get_active_profile()["id"])


@router.post("/{point_id}/restore")
def restore(point_id: str, payload: Optional[RestoreRequest] = None):
    """Remet les données du profil telles qu'au point, puis rejoue au besoin les lignes du lot avec la version actuelle."""
    replay = payload.replay if payload else True
    pid = get_active_profile()["id"]
    db_path = get_current_db_path()
    dispose_engine(pid)
    try:
        result = rp.restore_point(db_path, pid, point_id)
    except ValueError as err:
        raise HTTPException(status_code=404, detail=str(err))

    from app.init_data import init_db
    from app.profile_manager import sync_profile_metadata_from_db
    from app.services import stats_cache
    from app.services.bank_sync.pending_store import _PENDING_SYNC_DATA, clear_all_pending_sync
    init_db()
    sync_profile_metadata_from_db()
    stats_cache.invalidate()
    _PENDING_SYNC_DATA.pop(pid, None)

    point = result["point"]
    replayed = None
    db = SessionLocal()
    try:
        clear_all_pending_sync(db, profile_id=pid)
        if replay and point.get("preview_data") and point.get("conn_id") is not None:
            from app.services.autopilot_service import process_incoming_batch
            from app.services.bank_sync.import_engine import re_evaluate_preview_data
            # Les lignes gardées portent les rapprochements calculés à l'époque : on les refait avec la version actuelle
            preview = re_evaluate_preview_data(db, point["preview_data"])
            summary = process_incoming_batch(db, point["conn_id"], preview, profile_id=pid, restore_point=False)
            replayed = {"batch_id": summary.get("batch_id"), "lines": point.get("line_count", 0)}
    finally:
        db.close()
    stats_cache.invalidate()
    return {
        "ok": True,
        "restored_point_id": point_id,
        "restored_at": point.get("created_at"),
        "undo_point_id": result["undo_point_id"],
        "replayed": replayed,
    }
