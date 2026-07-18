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

def make_action_label(action) -> str:
    if not action:
        return ""
    entity_map = {
        "transaction": "l'opération",
        "account": "le compte",
        "budget": "l'enveloppe de budget",
        "budget_allocation": "l'alimentation de tirelire",
        "recurrence_template": "la charge récurrente",
        "category": "la catégorie",
        "org_user": "l'utilisateur"
    }
    action_map = {
        "CREATE": "Création de",
        "UPDATE": "Modification de",
        "DELETE": "Suppression de"
    }
    
    ent = entity_map.get(action.entity_type, action.entity_type)
    act_type = action_map.get(action.action_type, action.action_type)
    
    details = ""
    try:
        import json
        state = action.new_state or action.old_state
        if state:
            if isinstance(state, str):
                state = json.loads(state)
            if isinstance(state, dict):
                name = state.get("name") or state.get("description") or state.get("category_name") or state.get("label") or state.get("category")
                amount = state.get("amount") or state.get("monthly_amount")
                if name:
                    details += f" '{name}'"
                if amount:
                    details += f" ({amount} €)"
    except Exception:
        pass
        
    return f"{act_type} {ent}{details}"


def _extract(action):
    """Return {entity_type, action_type, name?, amount?} or None."""
    if not action:
        return None
    name = None
    amount = None
    try:
        import json
        st = action.new_state or action.previous_state
        if st:
            if isinstance(st, str):
                st = json.loads(st)
            if isinstance(st, dict):
                name = (st.get("name") or st.get("description") or
                        st.get("category_name") or st.get("label") or
                        st.get("category"))
                amount = st.get("amount") or st.get("monthly_amount")
    except Exception:
        pass
    return {
        "entity_type": action.entity_type,
        "action_type": action.action_type,
        "name": name,
        "amount": amount
    }


@router.get("/status")
def get_history_status(db: Session = Depends(get_db)):
    action_to_undo = db.query(ActionHistory).filter(ActionHistory.is_undone == False).order_by(desc(ActionHistory.timestamp)).first()
    action_to_redo = db.query(ActionHistory).filter(ActionHistory.is_undone == True).order_by(desc(ActionHistory.timestamp)).first()
    
    can_undo = action_to_undo is not None
    can_redo = action_to_redo is not None
    
    return {
        "can_undo": can_undo,
        "can_redo": can_redo,
        "undo": _extract(action_to_undo) if can_undo else None,
        "redo": _extract(action_to_redo) if can_redo else None
    }

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

