"""
OmniBank-Local — Routeur Chat API.
Contrôleur déclaratif pour les sessions de discussion IA, l'envoi de messages en streaming SSE,
les actions interactives, les faits financiers mémorisés et l'auto-catégorisation.
"""

import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AIFact, Category, ChatMessage, ChatSession, OrgUser
from app.schemas.api_schemas import (
    AIFactCreate,
    AIFactOut,
    ChatContextUpdate,
    ChatMessageUpdate,
    ChatRegenerateContext,
    ChatSendMessage,
    ChatSessionCreate,
    ChatSessionUpdate,
)

# ─── Re-exports depuis les sous-modules pour rétrocompatibilité ──────────────
from app.services.chat.ollama_client import (  # noqa: F401
    call_ollama_async,
    call_ollama_sync,
    get_ollama_config,
)
from app.services.chat.chat_tools import *  # noqa: F401,F403
from app.services.chat.chat_tools import TOOLS  # noqa: F401
from app.services.chat.chat_prompt import load_system_prompt  # noqa: F401
from app.services.chat.chat_snapshot import build_entity_snapshots  # noqa: F401
from app.services.chat.chat_compression import (  # noqa: F401
    estimate_tokens,
    generate_session_title,
    start_compression,
)
from app.services.chat.chat_orchestrator import (  # noqa: F401
    _generating_sessions,
    _notify_on_complete,
    autocategorize_transaction,
    detect_mentioned_month_year,
    execute_chat_action,
    generate_chat_stream,
    is_session_generating,
    register_notify_on_complete,
)

# Alias de compatibilité
_detect_mentioned_month_year = detect_mentioned_month_year

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)


# ─── Sessions ───────────────────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(ChatSession).order_by(ChatSession.created_at.desc()).all()
    return [{
        "id": s.id,
        "title": s.title,
        "role": s.role,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "has_compressed_context": bool(s.compressed_context),
    } for s in sessions]


@router.post("/sessions")
async def create_session(req: ChatSessionCreate, db: Session = Depends(get_db)):
    session = ChatSession(role=req.role)
    if req.title:
        session.title = req.title
    db.add(session)
    db.commit()
    db.refresh(session)
    return {
        "id": session.id,
        "title": session.title,
        "role": session.role,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "has_compressed_context": False,
    }


@router.put("/sessions/{id}")
async def update_session(id: int, req: ChatSessionUpdate, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    if req.title is not None:
        session.title = req.title
    if req.role is not None:
        session.role = req.role
    db.commit()
    return {"ok": True}


@router.delete("/sessions/{id}")
async def delete_session(id: int, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    db.delete(session)
    db.commit()
    return {"ok": True}


@router.get("/sessions/{id}/generating")
async def is_session_generating_endpoint(id: int):
    """Vérifie si une réponse IA est actuellement en cours de génération pour cette session."""
    return {"generating": is_session_generating(id)}


@router.post("/sessions/{id}/notify-on-complete")
async def notify_on_complete_endpoint(id: int, db: Session = Depends(get_db)):
    """Enregistre qu'une notification doit être créée lorsque la génération se termine."""
    return register_notify_on_complete(id, db)


# ─── Messages & Contexte ───────────────────────────────────────────────────

@router.get("/sessions/{id}/messages")
async def get_session_messages(id: int, user_name: Optional[str] = None, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()

    cfg = get_ollama_config(db)
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    sys_prompt = load_system_prompt(session.role, categories, 'fr', db=db, session_id=session.id, user_name=user_name)

    tools_tokens = estimate_tokens(json.dumps(TOOLS))
    used = estimate_tokens(sys_prompt) + tools_tokens + 500
    if session.compressed_context:
        used += estimate_tokens(session.compressed_context)

    if session.last_compressed_message_id:
        messages_for_tokens = [m for m in messages if m.id > session.last_compressed_message_id]
    else:
        messages_for_tokens = messages
    for m in messages_for_tokens:
        used += estimate_tokens(m.content)

    return {
        "compressed_context": session.compressed_context,
        "compressing": bool(session.compressing),
        "last_compressed_message_id": session.last_compressed_message_id,
        "bubble_after_id": session.bubble_after_id,
        "compression_stack": session.compression_stack,
        "messages": [{
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "timestamp": m.timestamp.isoformat() if m.timestamp else None,
            "entity_snapshots": json.loads(m.entity_snapshots) if m.entity_snapshots else None,
        } for m in messages],
        "token_usage": {
            "used": used,
            "limit": cfg["num_ctx"],
        },
    }


@router.put("/sessions/{id}/context")
async def update_session_context(id: int, req: ChatContextUpdate, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    session.compressed_context = req.compressed_context
    db.commit()
    return {"ok": True}


@router.delete("/sessions/{id}/compressed-context")
async def delete_compressed_context(id: int, db: Session = Depends(get_db)):
    """Réinitialise le résumé de contexte compressé pour revenir en mode brut."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    session.compressed_context = None
    session.last_compressed_message_id = None
    session.bubble_after_id = None
    session.compression_stack = None
    session.compressing = False
    session.buffered_message = None
    session.compression_started_at = None
    db.commit()
    return {"ok": True}


@router.get("/sessions/{id}/compression-status")
async def get_compression_status(id: int, db: Session = Depends(get_db)):
    """Retourne l'état actuel de la compression en cours pour le polling frontend."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    return {
        "compressing": bool(session.compressing),
        "compressed_context": session.compressed_context,
        "last_compressed_message_id": session.last_compressed_message_id,
        "bubble_after_id": session.bubble_after_id,
        "compression_stack": session.compression_stack,
    }


@router.post("/sessions/{id}/regenerate-compressed-context")
async def regenerate_compressed_context(id: int, req: ChatRegenerateContext, db: Session = Depends(get_db)):
    """Relance la compression avec une instruction optionnelle personnalisée."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")

    cfg = get_ollama_config(db)
    if not cfg["enabled"] or not cfg["url"] or not cfg["model"]:
        raise HTTPException(status_code=400, detail="Ollama URL ou Modèle non configuré.")

    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()

    session.last_compressed_message_id = None
    session.bubble_after_id = None
    session.compression_stack = None
    db.commit()

    new_context = start_compression(db, session, messages, cfg, custom_instruction=req.instruction)
    if new_context is None:
        raise HTTPException(status_code=500, detail="La compression a échoué. Vérifiez votre configuration Ollama.")

    return {"compressed_context": new_context}


@router.delete("/messages/{id}")
async def delete_message(id: int, db: Session = Depends(get_db)):
    message = db.query(ChatMessage).filter(ChatMessage.id == id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message non trouvé")

    session_id = message.session_id

    subsequent = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.timestamp > message.timestamp,
    ).all()
    for m in subsequent:
        db.delete(m)

    db.delete(message)

    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if session and session.last_compressed_message_id and message.id <= session.last_compressed_message_id:
        session.compressed_context = None
        session.last_compressed_message_id = None
        session.bubble_after_id = None
        session.compression_stack = None

    db.commit()
    return {"ok": True}


@router.post("/sessions/{id}/system-message")
async def add_system_message(id: int, req: ChatSendMessage, db: Session = Depends(get_db)):
    """Insère un message système ou assistant sans déclencher de génération IA."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")

    if req.update_last_assistant:
        last_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.desc()).first()
        if last_msg and last_msg.role == "assistant":
            last_msg.content = req.content
            db.commit()
            return {"ok": True}

    msg = ChatMessage(session_id=id, role=req.role or "assistant", content=req.content)
    db.add(msg)
    db.commit()
    return {"ok": True}


# ─── Actions & Streaming SSE ───────────────────────────────────────────────

class ChatApplyActionRequest(BaseModel):
    action: str
    params: dict


@router.post("/apply-action")
async def apply_chat_action(req: ChatApplyActionRequest, db: Session = Depends(get_db)):
    """Exécute une action financière interactive validée par l'utilisateur."""
    return execute_chat_action(db, req.action, req.params)


@router.post("/sessions/{id}/message")
async def send_message(id: int, req: ChatSendMessage, request: Request = None, db: Session = Depends(get_db)):
    """Envoie un message utilisateur et diffuse la réponse IA en flux SSE."""
    return StreamingResponse(
        generate_chat_stream(id, req, request, db),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no"},
    )


@router.post("/sessions/{id}/regenerate")
async def regenerate_response(id: int, request: Request = None, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")

    last_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.desc()).first()
    if last_msg and last_msg.role == "assistant":
        db.delete(last_msg)
        db.commit()

    last_user_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id, ChatMessage.role == "user").order_by(ChatMessage.timestamp.desc()).first()
    if not last_user_msg:
        raise HTTPException(status_code=400, detail="Aucun message utilisateur à régénérer")

    req = ChatSendMessage(content=last_user_msg.content)
    db.delete(last_user_msg)
    db.commit()

    return await send_message(id, req, request=request, db=db)


@router.put("/messages/{id}")
async def edit_message(id: int, req: ChatMessageUpdate, request: Request = None, db: Session = Depends(get_db)):
    message = db.query(ChatMessage).filter(ChatMessage.id == id).first()
    if not message or message.role != "user":
        raise HTTPException(status_code=400, detail="Seuls les messages utilisateur peuvent être édités")

    session_id = message.session_id

    subsequent = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.timestamp > message.timestamp,
    ).all()
    for m in subsequent:
        db.delete(m)

    db.delete(message)
    db.commit()

    send_req = ChatSendMessage(content=req.content)
    return await send_message(session_id, send_req, request=request, db=db)


# ─── Auto-catégorisation ───────────────────────────────────────────────────

class AutoCatRequest(BaseModel):
    description: str
    amount: float = None


@router.post("/autocategorize")
async def autocategorize(req: AutoCatRequest, db: Session = Depends(get_db)):
    """Suggère une catégorie pour une opération via Ollama."""
    return await autocategorize_transaction(db, req.description, req.amount)


# ─── Faits Financiers (AIFacts) ─────────────────────────────────────────────

@router.get("/facts", response_model=List[AIFactOut])
def get_ai_facts(user_name: Optional[str] = None, db: Session = Depends(get_db)):
    try:
        user_id = None
        if user_name:
            user = db.query(OrgUser).filter(OrgUser.name == user_name).first()
            if user:
                user_id = user.id

        query = db.query(AIFact)
        if user_id:
            query = query.filter((AIFact.user_id == user_id) | (AIFact.user_id.is_(None)))
        else:
            query = query.filter(AIFact.user_id.is_(None))

        facts = query.all()

        res = []
        for f in facts:
            u_name = None
            if f.user_id:
                u = db.query(OrgUser).filter(OrgUser.id == f.user_id).first()
                if u:
                    u_name = u.name

            res.append(AIFactOut(
                id=f.id,
                fact_key=f.fact_key,
                fact_value=f.fact_value,
                session_id=f.session_id,
                user_id=f.user_id,
                user_name=u_name,
            ))
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/facts")
def update_or_create_ai_fact(req: AIFactCreate, db: Session = Depends(get_db)):
    try:
        user_id = None
        if req.user_name:
            user = db.query(OrgUser).filter(OrgUser.name == req.user_name).first()
            if user:
                user_id = user.id

        query = db.query(AIFact).filter(AIFact.fact_key == req.fact_key)
        if user_id:
            query = query.filter(AIFact.user_id == user_id)
        else:
            query = query.filter(AIFact.user_id.is_(None))

        if req.private_to_session and req.session_id:
            query = query.filter(AIFact.session_id == req.session_id)
        else:
            query = query.filter(AIFact.session_id.is_(None))

        existing = query.first()

        if existing:
            existing.fact_value = req.fact_value
        else:
            new_fact = AIFact(
                fact_key=req.fact_key,
                fact_value=req.fact_value,
                session_id=req.session_id if req.private_to_session else None,
                user_id=user_id,
            )
            db.add(new_fact)

        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/facts/{fact_id}")
def delete_ai_fact(fact_id: int, db: Session = Depends(get_db)):
    try:
        fact = db.query(AIFact).filter(AIFact.id == fact_id).first()
        if not fact:
            raise HTTPException(status_code=404, detail="Fait non trouvé")

        db.delete(fact)
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
