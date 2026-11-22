from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.database import get_db
from app.models import ActionHistory
from app.services import history_service
from app.services.history_service import check_undo_safety
from app.services import stats_cache

router = APIRouter(prefix="/api/history", tags=["history"])

# Une autre opération porte déjà la ligne de la banque que l'annulation voudrait remettre
_BANK_LINE_CONFLICT = "Impossible : une autre opération porte maintenant cette ligne de la banque."


def _apply(db: Session, fn, action: ActionHistory, failure: str, extra: dict = None):
    try:
        success, warning = fn(db, action)
        if not success:
            raise HTTPException(status_code=400, detail=warning or failure)
        db.commit()
        stats_cache.invalidate()
        return {"ok": True, "warning": warning, **(extra or {})}
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_BANK_LINE_CONFLICT)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


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

@router.get("/{action_id}/check")
def check_undo_endpoint(action_id: int, db: Session = Depends(get_db)):
    """Vérifie si l'annulation d'une action est sûre avant de procéder."""
    action = db.query(ActionHistory).filter(ActionHistory.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    return check_undo_safety(db, action)

@router.post("/{action_id}/undo")
def undo_action_endpoint(action_id: int, db: Session = Depends(get_db)):
    action = db.query(ActionHistory).filter(ActionHistory.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")

    # Vérification de sécurité des dépendances
    safety = check_undo_safety(db, action)
    if not safety["safe"]:
        raise HTTPException(status_code=409, detail={
            "reason": safety["reason"],
            "conflicts": safety["conflicts"]
        })

    return _apply(db, history_service.undo_entry, action, "Failed to undo action")

@router.post("/{action_id}/redo")
def redo_action_endpoint(action_id: int, db: Session = Depends(get_db)):
    action = db.query(ActionHistory).filter(ActionHistory.id == action_id).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    return _apply(db, history_service.redo_entry, action, "Failed to redo action")

@router.delete("/purge")
def purge_history(older_than_days: int = Query(90), db: Session = Depends(get_db)):
    from datetime import datetime, timedelta, timezone
    cutoff = datetime.now(timezone.utc) - timedelta(days=older_than_days)
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
    action_to_undo = history_service.representative(db, history_service.last_undoable(db))
    action_to_redo = history_service.representative(db, history_service.next_redoable(db))
    return {
        "can_undo": action_to_undo is not None,
        "can_redo": action_to_redo is not None,
        "undo": _extract(action_to_undo) if action_to_undo else None,
        "redo": _extract(action_to_redo) if action_to_redo else None
    }


@router.post("/undo_last")
def undo_last_action(db: Session = Depends(get_db)):
    action = history_service.last_undoable(db)
    if not action:
        raise HTTPException(status_code=400, detail="Nothing to undo")
    return _apply(db, history_service.undo_entry, action, "Failed to undo action",
                  {"entity_type": action.entity_type, "action_type": action.action_type})


@router.post("/redo_last")
def redo_last_action(db: Session = Depends(get_db)):
    action = history_service.next_redoable(db)
    if not action:
        raise HTTPException(status_code=400, detail="Nothing to redo")
    return _apply(db, history_service.redo_entry, action, "Failed to redo action",
                  {"entity_type": action.entity_type, "action_type": action.action_type})
