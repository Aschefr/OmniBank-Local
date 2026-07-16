from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database import get_db
from app.models import ActionHistory
from app.services import history_service

router = APIRouter(prefix="/api/history", tags=["history"])

@router.get("")
def get_history(limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    actions = db.query(ActionHistory).order_by(desc(ActionHistory.timestamp)).offset(offset).limit(limit).all()
    res = []
    for act in actions:
        res.append({
            "id": act.id,
            "timestamp": act.timestamp.isoformat() if act.timestamp else None,
            "entity_type": act.entity_type,
            "entity_id": act.entity_id,
            "action_type": act.action_type,
            "previous_state": act.previous_state,
            "new_state": act.new_state,
            "is_undone": act.is_undone,
            "user_name": act.user_name
        })
    return res

@router.post("/{action_id}/undo")
def undo_action_endpoint(action_id: int, db: Session = Depends(get_db)):
    action = db.query(ActionHistory).filter(ActionHistory.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
        
    try:
        success, warning = history_service.undo_action(db, action)
        if not success:
            raise HTTPException(status_code=400, detail=warning or "Failed to undo action")
        db.commit()
        return {"ok": True, "warning": warning}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/purge")
def purge_history(older_than_days: int = Query(90), db: Session = Depends(get_db)):
    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=older_than_days)
    db.query(ActionHistory).filter(ActionHistory.timestamp < cutoff).delete()
    db.commit()
    return {"ok": True, "message": f"History older than {older_than_days} days purged"}

@router.get("/status")
def get_history_status(db: Session = Depends(get_db)):
    last_action = db.query(ActionHistory).order_by(desc(ActionHistory.timestamp)).first()
    if not last_action:
        return {"can_undo": False, "can_redo": False}
    
    can_undo = db.query(ActionHistory).filter(ActionHistory.is_undone == False).order_by(desc(ActionHistory.timestamp)).first() is not None
    can_redo = db.query(ActionHistory).filter(ActionHistory.is_undone == True).order_by(desc(ActionHistory.timestamp)).first() is not None
    
    return {"can_undo": can_undo, "can_redo": can_redo}

@router.post("/undo_last")
def undo_last_action(db: Session = Depends(get_db)):
    action = db.query(ActionHistory).filter(ActionHistory.is_undone == False).order_by(desc(ActionHistory.timestamp)).first()
    if not action:
        raise HTTPException(status_code=400, detail="Nothing to undo")
    try:
        success, warning = history_service.undo_action(db, action)
        if not success:
            raise HTTPException(status_code=400, detail=warning or "Failed to undo action")
        db.commit()
        return {"ok": True, "warning": warning, "entity_type": action.entity_type, "action_type": action.action_type}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/redo_last")
def redo_last_action(db: Session = Depends(get_db)):
    action = db.query(ActionHistory).filter(ActionHistory.is_undone == True).order_by(desc(ActionHistory.timestamp)).first()
    if not action:
        raise HTTPException(status_code=400, detail="Nothing to redo")
    try:
        success, warning = history_service.redo_action(db, action)
        if not success:
            raise HTTPException(status_code=400, detail=warning or "Failed to redo action")
        db.commit()
        return {"ok": True, "warning": warning, "entity_type": action.entity_type, "action_type": action.action_type}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

