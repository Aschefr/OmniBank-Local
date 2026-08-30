from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

import httpx
import json
import codecs
from datetime import date

from app.database import get_db
from app.models import GlobalConfig, Transaction, Account, Category, RecurrenceTemplate, Budget, ChatSession, ChatMessage
from app.services.finance_engine import calculate_balances, get_net_worth
from app.schemas.api_schemas import ChatSessionCreate, ChatSessionUpdate, ChatContextUpdate, ChatRegenerateContext, ChatSendMessage, ChatMessageUpdate, AIFactCreate, AIFactUpdate, AIFactOut

import logging

router = APIRouter(prefix="/api/chat", tags=["chat"])
logger = logging.getLogger(__name__)

# In-memory tracker: which sessions currently have an AI generation in progress
_generating_sessions = set()
# Sessions that should create a notification when generation completes (user left the page)
_notify_on_complete = set()


# ─── Re-exports depuis les sous-modules spécialisés pour rétrocompatibilité ─────
from app.services.chat.ollama_client import (
    get_ollama_config, call_ollama_sync, call_ollama_async
)
from app.services.chat.chat_tools import (
    TOOLS,
    get_net_worth_tool,
    get_balances_tool,
    get_recent_transactions_tool,
    search_transactions_tool,
    get_spending_analytics_tool,
    get_budgets_status_tool,
    get_monthly_overview_tool,
    get_recurrence_templates_tool,
    get_net_worth_history_tool,
    get_envelopes_impact_tool,
    suggest_transaction_category_tool,
    forecast_balances_history_tool,
    detect_anomalies_and_subscriptions_tool,
    apply_transaction_correction_tool,
    create_budget_envelope_tool,
    update_budget_envelope_tool,
    delete_budget_envelope_tool,
    allocate_savings_funds_tool,
    create_recurrence_template_tool,
    update_recurrence_template_tool,
    delete_recurrence_template_tool,
    create_category_tool,
    delete_category_tool,
    delete_transaction_tool,
    set_predicted_paycheck_tool,
    get_saving_recommendations_tool,
    search_similar_past_spends_tool,
    generate_csv_export_link_tool,
    simulate_loan_amortization_tool,
    get_financial_summary_tool,
    get_spending_trends_tool,
    get_dashboard_synthesis_tool,
    store_financial_fact_tool,
    forget_financial_fact_tool,
)
from app.services.chat.chat_prompt import load_system_prompt
from app.services.chat.chat_compression import (
    estimate_tokens, start_compression, generate_session_title
)

@router.get("/sessions")
async def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(ChatSession).order_by(ChatSession.created_at.desc()).all()
    return [{
        "id": s.id,
        "title": s.title,
        "role": s.role,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "has_compressed_context": bool(s.compressed_context)
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
        "has_compressed_context": False
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
async def is_session_generating(id: int):
    """Check if an AI response is currently being generated for this session."""
    return {"generating": id in _generating_sessions}

@router.post("/sessions/{id}/notify-on-complete")
async def notify_on_complete(id: int, db: Session = Depends(get_db)):
    """Register that a notification should be created when generation completes for this session."""
    if id in _generating_sessions:
        # Still generating — register for later notification in the finally block
        _notify_on_complete.add(id)
    else:
        # Generation already finished — create notification immediately
        from app.models import Notification
        logger.info(f"[Chat] Generation already complete for session {id} — creating notification now")
        notif = Notification(
            type="system",
            title="Réponse IA disponible 💬",
            content="Votre conseiller IA a terminé sa réponse. Retrouvez-la dans votre conversation.",
            link_data=json.dumps({"session_id": id}),
            is_read=False
        )
        db.add(notif)
        db.commit()
    return {"ok": True}

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
    used = estimate_tokens(sys_prompt) + tools_tokens + 500  # 500 tokens for system prompt wrapper format
    if session.compressed_context:
        used += estimate_tokens(session.compressed_context)
    # Filter messages to only count those after last_compressed_message_id
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
            "timestamp": m.timestamp.isoformat() if m.timestamp else None
        } for m in messages],
        "token_usage": {
            "used": used,
            "limit": cfg["num_ctx"]
        }
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
    """Remove the compressed context summary. The conversation reverts to raw mode
    (natural LLM sliding window). Next time 90% is reached, compression triggers again."""
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
    """Return current compression state. Used by frontend polling during active compression."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    return {
        "compressing": bool(session.compressing),
        "compressed_context": session.compressed_context,
        "last_compressed_message_id": session.last_compressed_message_id,
        "bubble_after_id": session.bubble_after_id,
        "compression_stack": session.compression_stack
    }

@router.post("/sessions/{id}/regenerate-compressed-context")
async def regenerate_compressed_context(id: int, req: ChatRegenerateContext, db: Session = Depends(get_db)):
    """Re-run the compression with an optional custom instruction, replacing the existing summary."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    
    cfg = get_ollama_config(db)
    if not cfg["enabled"] or not cfg["url"] or not cfg["model"]:
        raise HTTPException(status_code=400, detail="Ollama URL ou Modèle non configuré.")
    
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
    
    # Reset compression point and stack so we compress the full conversation
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

    # Cascade delete: all subsequent messages in the session
    subsequent = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.timestamp > message.timestamp
    ).all()
    for m in subsequent:
        db.delete(m)

    # Delete the message itself
    db.delete(message)

    # If the deleted message is before or at the compression boundary,
    # clear the compressed context (the summary references deleted content)
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
    """Insert a message into a session without triggering AI generation.
    Used for feedback messages (e.g. after applying an AI action)."""
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


class ChatApplyActionRequest(BaseModel):
    action: str
    params: dict


@router.post("/apply-action")
async def apply_chat_action(req: ChatApplyActionRequest, db: Session = Depends(get_db)):
    action = req.action
    params = req.params
    
    if action == "create_budget_envelope":
        res = create_budget_envelope_tool(db, name=params.get("name"), monthly_amount=params.get("monthly_amount"), period=params.get("period", "monthly"), categories=params.get("categories"), is_project=params.get("is_project", False), force_write=True)
    elif action == "update_budget_envelope":
        res = update_budget_envelope_tool(db, budget_id=params.get("budget_id"), name=params.get("name"), monthly_amount=params.get("monthly_amount"), period=params.get("period"), categories=params.get("categories"), is_closed=params.get("is_closed"), force_write=True)
    elif action == "delete_budget_envelope":
        res = delete_budget_envelope_tool(db, budget_id=params.get("budget_id"), force_write=True)
    elif action == "allocate_savings_funds":
        res = allocate_savings_funds_tool(db, budget_id=params.get("budget_id"), amount=params.get("amount"), note=params.get("note"), force_write=True)
    elif action == "create_recurrence_template":
        res = create_recurrence_template_tool(db, amount=params.get("amount"), description=params.get("description"), frequency=params.get("frequency"), category=params.get("category"), type=params.get("type"), day_of_month=params.get("day_of_month"), force_write=True)
    elif action == "update_recurrence_template":
        res = update_recurrence_template_tool(db, template_id=params.get("template_id"), amount=params.get("amount"), description=params.get("description"), frequency=params.get("frequency"), category=params.get("category"), type=params.get("type"), day_of_month=params.get("day_of_month"), is_active=params.get("is_active"), force_write=True)
    elif action == "delete_recurrence_template":
        res = delete_recurrence_template_tool(db, template_id=params.get("template_id"), force_write=True)
    elif action == "create_category":
        res = create_category_tool(db, name=params.get("name"), type=params.get("type"), force_write=True)
    elif action == "delete_category":
        res = delete_category_tool(db, name=params.get("name"), force_write=True)
    elif action == "set_predicted_paycheck":
        res = set_predicted_paycheck_tool(db, amount=params.get("amount"), day_of_month=params.get("day_of_month"), date_override=params.get("date_override"), force_write=True)
    elif action == "delete_transaction":
        res = delete_transaction_tool(db, transaction_id=params.get("transaction_id"), force_write=True)
    else:
        raise HTTPException(status_code=400, detail=f"Action '{action}' non reconnue")
        
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Erreur lors de l'exécution"))
        
    return res

@router.post("/sessions/{id}/message")
async def send_message(id: int, req: ChatSendMessage, request: Request = None, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    
    cfg = get_ollama_config(db)
    if not cfg["enabled"] or not cfg["url"] or not cfg["model"]:
        raise HTTPException(status_code=400, detail="Ollama URL ou Modèle non configuré.")
        
    url = cfg["url"].rstrip("/")
    model = cfg["model"]
    
    # Save user message to database
    user_msg = ChatMessage(session_id=id, role="user", content=req.content)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)
    
    # Get all messages
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
    
    # Check if first message to trigger title generation
    is_first_exchange = (len(messages) == 1)
    
    # Context Compression check
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    sys_prompt = load_system_prompt(session.role, categories, req.lang, db=db, session_id=session.id, user_name=req.user_name)
    
    options = {"temperature": cfg["temperature"], "num_ctx": cfg["num_ctx"]}
    
    # Estimate token budget — only count messages AFTER the last compression point
    tools_tokens = estimate_tokens(json.dumps(TOOLS))
    total_tokens = estimate_tokens(sys_prompt) + tools_tokens + 500
    if session.compressed_context:
        total_tokens += estimate_tokens(session.compressed_context)
    if session.last_compressed_message_id:
        messages_after_compression = [m for m in messages if m.id > session.last_compressed_message_id]
    else:
        messages_after_compression = messages
    for m in messages_after_compression:
        total_tokens += estimate_tokens(m.content)
    
    # Check if compression is needed at 90% threshold
    needs_compression = (total_tokens > int(cfg["num_ctx"] * 0.85))
    
    # Build Ollama payload — always use filtered messages (those after compression point)
    def build_ollama_payload(current_session, current_messages):
        """Build Ollama message list, filtering out messages already covered by compressed_context."""
        sys_content = sys_prompt
        # Include all historical compression contexts from the stack
        if current_session.compression_stack:
            import json as _json
            try:
                stack = _json.loads(current_session.compression_stack)
                for entry in stack:
                    sys_content += f"\n\n[COMPRESSED HISTORY]\n{entry['context']}"
            except Exception:
                pass
        if current_session.compressed_context:
            sys_content += f"\n\n[CONTEXT SUMMARY — earlier conversation]\n{current_session.compressed_context}"
        payload_msgs = [{"role": "system", "content": sys_content}]
        # Only include messages AFTER the compression point
        if current_session.last_compressed_message_id:
            filtered = [m for m in current_messages if m.id > current_session.last_compressed_message_id]
        else:
            filtered = current_messages
        for m in filtered:
            payload_msgs.append({"role": m.role, "content": m.content})
        return payload_msgs
    
    ollama_msgs = build_ollama_payload(session, messages)
    
    async def generate_response():
        nonlocal ollama_msgs  # Allow reassigning after compression
        final_text = ""
        _response_saved = False
        _done_sent = False
        _client_disconnected = False
        _tools_meta = ""
        _generating_sessions.add(id)
        try:
            # --- Compression step (synchronous, inside the SSE generator) ---
            if needs_compression:
                from datetime import datetime as _dt, timezone as _tz
                # Mark session as compressing
                session.compressing = True
                session.compression_started_at = _dt.now(_tz.utc)
                db.commit()
                # Notify frontend that compression is starting
                yield f"data: {json.dumps({'compressing': True})}\n\n"
                # Run compression synchronously (blocking) within the generator
                new_context = start_compression(db, session, messages, cfg, lang=req.lang, trigger_msg_id=user_msg.id)
                db.refresh(session)
                # Rebuild the Ollama payload with updated session state
                updated_messages = db.query(ChatMessage).filter(
                    ChatMessage.session_id == id
                ).order_by(ChatMessage.timestamp.asc()).all()
                ollama_msgs = build_ollama_payload(session, updated_messages)
                # Compute token_usage after compression (immediate feedback for the token counter)
                tools_tokens_post = estimate_tokens(json.dumps(TOOLS))
                used_post = estimate_tokens(sys_prompt) + tools_tokens_post + 500
                if session.compressed_context:
                    used_post += estimate_tokens(session.compressed_context)
                if session.last_compressed_message_id:
                    post_msgs = [m for m in updated_messages if m.id > session.last_compressed_message_id]
                else:
                    post_msgs = updated_messages
                for m in post_msgs:
                    used_post += estimate_tokens(m.content)
                # Notify frontend that compression is done
                yield f"data: {json.dumps({'compressing': False, 'compressed_context': new_context or '', 'last_compressed_message_id': session.last_compressed_message_id, 'bubble_after_id': session.bubble_after_id, 'compression_stack': session.compression_stack, 'token_usage': {'used': used_post, 'limit': cfg['num_ctx']}})}\n\n"

            async with httpx.AsyncClient() as client:
                tool_desc_map_fr = {
                    "get_financial_summary": "Analyse du reste à vivre et des prévisions de salaire...",
                    "get_net_worth": "Consultation du patrimoine net global...",
                    "get_account_balances": "Interrogation du solde des comptes...",
                    "search_transactions": "Recherche de transactions...",
                    "get_spending_analytics": "Calcul des statistiques de dépenses...",
                    "get_budgets_status": "Vérification de l'état des budgets...",
                    "get_recurrence_templates": "Examen des charges récurrentes...",
                    "get_net_worth_history": "Analyse de l'historique du patrimoine...",
                    "get_envelopes_impact": "Simulation de l'impact sur vos enveloppes budgétaires...",
                    "suggest_transaction_category": "Recherche d'une suggestion de catégorie...",
                    "forecast_balances_history": "Calcul des prévisions de solde...",
                    "detect_anomalies_and_subscriptions": "Recherche d'abonnements et de doublons...",
                    "apply_transaction_correction": "Application de la modification sur l'opération...",
                    "get_saving_recommendations": "Génération de vos préconisations d'épargne...",
                    "search_similar_past_spends": "Analyse comparative des dépenses passées...",
                    "generate_csv_export_link": "Génération du lien de téléchargement CSV...",
                    "simulate_loan_amortization": "Simulation d'amortissement de prêt...",
                    "create_budget_envelope": "Création de la nouvelle enveloppe de budget...",
                    "update_budget_envelope": "Mise à jour de l'enveloppe de budget...",
                    "delete_budget_envelope": "Suppression de l'enveloppe de budget...",
                    "allocate_savings_funds": "Enregistrement de l'alimentation/retrait de la tirelire...",
                    "create_recurrence_template": "Création du modèle de transaction récurrente...",
                    "update_recurrence_template": "Mise à jour du modèle de récurrence...",
                    "delete_recurrence_template": "Suppression du modèle de récurrence...",
                    "create_category": "Création de la nouvelle catégorie...",
                    "delete_category": "Suppression de la catégorie...",
                    "set_predicted_paycheck": "Mise à jour de la date/montant théorique de salaire...",
                    "get_monthly_overview": "Récupération de l'aperçu budgétaire mensuel...",
                    "get_spending_trends": "Analyse des tendances et moyennes historiques de dépenses...",
                    "get_dashboard_synthesis": "Consultation de la synthèse mensuelle du tableau de bord..."
                }
                tool_desc_map_en = {
                    "get_financial_summary": "Analyzing left-to-live and paycheck forecasts...",
                    "get_net_worth": "Consulting global net worth...",
                    "get_account_balances": "Checking account balances...",
                    "search_transactions": "Searching transactions...",
                    "get_spending_analytics": "Calculating spending statistics...",
                    "get_budgets_status": "Verifying budget envelopes...",
                    "get_recurrence_templates": "Checking recurring charges...",
                    "get_net_worth_history": "Analyzing net worth history...",
                    "get_envelopes_impact": "Simulating budget impact...",
                    "suggest_transaction_category": "Looking for category suggestion...",
                    "forecast_balances_history": "Calculating balance forecasts...",
                    "detect_anomalies_and_subscriptions": "Searching for subscriptions and duplicates...",
                    "apply_transaction_correction": "Applying transaction update...",
                    "get_saving_recommendations": "Generating savings recommendations...",
                    "search_similar_past_spends": "Comparing past spends...",
                    "generate_csv_export_link": "Generating CSV export link...",
                    "simulate_loan_amortization": "Simulating loan amortization...",
                    "create_budget_envelope": "Creating new budget envelope...",
                    "update_budget_envelope": "Updating budget envelope...",
                    "delete_budget_envelope": "Deleting budget envelope...",
                    "allocate_savings_funds": "Recording piggy bank deposit/withdrawal...",
                    "create_recurrence_template": "Creating recurring transaction template...",
                    "update_recurrence_template": "Updating recurrence template...",
                    "delete_recurrence_template": "Deleting recurrence template...",
                    "create_category": "Creating new category...",
                    "delete_category": "Deleting category...",
                    "set_predicted_paycheck": "Updating predicted paycheck day/amount...",
                    "get_monthly_overview": "Fetching monthly budget overview...",
                    "get_spending_trends": "Analyzing spending trends and multi-month averages...",
                    "get_dashboard_synthesis": "Consulting monthly dashboard synthesis..."
                }
                tool_desc_map = tool_desc_map_en if req.lang == "en" else tool_desc_map_fr

                # Helper: stream a request to Ollama, yield content chunks, return full text
                async def _stream_ollama(payload_data):
                    """Stream Ollama response, yielding SSE chunks. Returns (full_text, tool_calls_list)."""
                    collected_text = ""
                    collected_tool_calls = []
                    in_thinking = False

                    async with client.stream("POST", f"{url}/api/chat", json=payload_data, timeout=httpx.Timeout(300.0, connect=10.0)) as stream_resp:
                        if stream_resp.status_code != 200:
                            yield f"data: {json.dumps({'error': 'Ollama error: ' + str(stream_resp.status_code)})}\n\n"
                            return
                        async for line in stream_resp.aiter_lines():
                            if not line:
                                continue
                            try:
                                json_chunk = json.loads(line)
                            except json.JSONDecodeError:
                                continue

                            msg_obj = json_chunk.get("message", {})

                            # Intercept native tool_calls from stream
                            tc_list = msg_obj.get("tool_calls")
                            if tc_list:
                                collected_tool_calls.extend(tc_list)
                                continue

                            reasoning = msg_obj.get("reasoning_content", "")
                            content = msg_obj.get("content", "")

                            chunk_to_send = ""
                            if reasoning:
                                if not in_thinking:
                                    chunk_to_send += "<think>\n"
                                    in_thinking = True
                                chunk_to_send += reasoning
                            else:
                                if in_thinking:
                                    chunk_to_send += "\n</think>\n\n"
                                    in_thinking = False
                                chunk_to_send += content

                            if chunk_to_send:
                                collected_text += chunk_to_send
                                yield f"data: {json.dumps({'content': chunk_to_send})}\n\n"

                    if in_thinking:
                        collected_text += "\n</think>\n\n"
                        yield f"data: {json.dumps({'content': chr(10) + '</think>' + chr(10) + chr(10)})}\n\n"

                    # Attach results as a special final yield
                    yield {"_result": collected_text, "_tool_calls": collected_tool_calls}

                # ─── Multi-turn Tool Loop (max 4 iterations for agentic behavior) ───
                import asyncio as _asyncio
                _WRITE_TOOLS = {
                    "create_budget_envelope", "update_budget_envelope", "delete_budget_envelope",
                    "allocate_savings_funds", "create_recurrence_template", "update_recurrence_template",
                    "delete_recurrence_template", "create_category", "delete_category", "set_predicted_paycheck",
                    "delete_transaction"
                }
                _CACHEABLE_READ_TOOLS = {
                    "get_financial_summary", "get_net_worth", "get_account_balances",
                    "search_transactions", "get_spending_analytics", "get_budgets_status",
                    "get_monthly_overview", "get_recurrence_templates", "get_net_worth_history",
                    "get_saving_recommendations", "search_similar_past_spends",
                    "detect_anomalies_and_subscriptions", "get_spending_trends",
                    "get_dashboard_synthesis"
                }
                MAX_TOOL_ITERATIONS = 4
                all_tool_names = []
                detected_write_actions = []
                loop_read_cache = {}
                iteration = 0

                while iteration < MAX_TOOL_ITERATIONS:
                    payload = {
                        "model": model,
                        "messages": ollama_msgs,
                        "tools": TOOLS,
                        "stream": True,
                        "options": options,
                        "keep_alive": "30m"
                    }

                    phase_text = ""
                    detected_tool_calls = []
                    async for chunk in _stream_ollama(payload):
                        if isinstance(chunk, dict) and "_result" in chunk:
                            phase_text = chunk["_result"]
                            detected_tool_calls = chunk["_tool_calls"]
                        else:
                            if isinstance(chunk, str) and chunk.startswith('data: '):
                                try:
                                    d = json.loads(chunk[6:].strip())
                                    if d.get('content'):
                                        final_text += d['content']
                                except Exception: pass
                            if request and await request.is_disconnected():
                                _client_disconnected = True
                                return
                            yield chunk

                    if not detected_tool_calls:
                        # No tool calls — this is the final text response, stop the loop
                        final_text = phase_text
                        break

                    # Tool calls detected: clear any text streamed so far (it was just thinking)
                    # and signal the frontend to reset the bubble before the final response.
                    if phase_text.strip() or iteration > 0:
                        final_text = ""
                        yield f"data: {json.dumps({'clear_text': True, 'iteration': iteration + 1})}\n\n"

                    # Append assistant turn (with tool_calls) to Ollama message history
                    ollama_msgs.append({"role": "assistant", "tool_calls": detected_tool_calls, "content": phase_text})

                    for tool_call in detected_tool_calls:
                        if request and await request.is_disconnected():
                            _client_disconnected = True
                            return

                        fn_name = tool_call["function"]["name"]
                        fn_args = tool_call["function"].get("arguments", {})

                        # Check disconnect BEFORE executing write tools to prevent partial writes
                        if fn_name in _WRITE_TOOLS:
                            if request and await request.is_disconnected():
                                _client_disconnected = True
                                return
                            detected_write_actions.append({"action": fn_name, "params": fn_args})

                        desc_status = tool_desc_map.get(fn_name, f"Exécution de {fn_name}...")
                        if iteration > 0:
                            desc_status = f"🔄 Tour {iteration + 1} — {desc_status}"
                        yield f"data: {json.dumps({'status': desc_status})}\n\n"
                        await _asyncio.sleep(0.8)

                        tool_result = None
                        if fn_name in _CACHEABLE_READ_TOOLS:
                            cache_key = f"{fn_name}:{json.dumps(fn_args, sort_keys=True)}"
                            if cache_key in loop_read_cache:
                                tool_result = loop_read_cache[cache_key]
                                logger.info(f"[Chat Cache] Served tool '{fn_name}' from loop cache")

                        if tool_result is None:
                            if fn_name == "get_financial_summary":
                                tool_result = get_financial_summary_tool(db)
                            elif fn_name == "get_spending_trends":
                                tool_result = get_spending_trends_tool(db)
                            elif fn_name == "get_dashboard_synthesis":
                                tool_result = get_dashboard_synthesis_tool(db, fn_args.get("year"), fn_args.get("month"))
                            elif fn_name == "get_net_worth":
                                tool_result = get_net_worth_tool(db)
                            elif fn_name == "get_account_balances":
                                tool_result = get_balances_tool(db)
                            elif fn_name == "search_transactions":
                                tool_result = search_transactions_tool(db, fn_args.get("description_query"), fn_args.get("category"), fn_args.get("type"), fn_args.get("start_date"), fn_args.get("end_date"), fn_args.get("min_amount"), fn_args.get("max_amount"), fn_args.get("limit", 50))
                            elif fn_name == "get_spending_analytics":
                                tool_result = get_spending_analytics_tool(db, fn_args.get("start_date"), fn_args.get("end_date"))
                            elif fn_name == "get_budgets_status":
                                tool_result = get_budgets_status_tool(db, fn_args.get("year"), fn_args.get("month"))
                            elif fn_name == "get_monthly_overview":
                                tool_result = get_monthly_overview_tool(db, fn_args.get("year"), fn_args.get("month"))
                            elif fn_name == "get_recurrence_templates":
                                tool_result = get_recurrence_templates_tool(db)
                            elif fn_name == "get_net_worth_history":
                                tool_result = get_net_worth_history_tool(db, fn_args.get("months", 12))
                            elif fn_name == "get_envelopes_impact":
                                tool_result = get_envelopes_impact_tool(db, fn_args.get("amount"), fn_args.get("budget_id"))
                            elif fn_name == "suggest_transaction_category":
                                tool_result = suggest_transaction_category_tool(db, fn_args.get("description"))
                            elif fn_name == "forecast_balances_history":
                                tool_result = forecast_balances_history_tool(db, fn_args.get("days", 30))
                            elif fn_name == "detect_anomalies_and_subscriptions":
                                tool_result = detect_anomalies_and_subscriptions_tool(db)
                            elif fn_name == "apply_transaction_correction":
                                tool_result = apply_transaction_correction_tool(db, fn_args.get("transaction_id"), fn_args.get("category"), fn_args.get("description"), fn_args.get("amount"), fn_args.get("type"))
                            elif fn_name == "create_budget_envelope":
                                tool_result = create_budget_envelope_tool(db, fn_args.get("name"), fn_args.get("monthly_amount"), fn_args.get("period", "monthly"), fn_args.get("categories"), fn_args.get("is_project", False))
                            elif fn_name == "update_budget_envelope":
                                tool_result = update_budget_envelope_tool(db, fn_args.get("budget_id"), fn_args.get("name"), fn_args.get("monthly_amount"), fn_args.get("period"), fn_args.get("categories"), fn_args.get("is_closed"))
                            elif fn_name == "delete_budget_envelope":
                                tool_result = delete_budget_envelope_tool(db, fn_args.get("budget_id"))
                            elif fn_name == "allocate_savings_funds":
                                tool_result = allocate_savings_funds_tool(db, fn_args.get("budget_id"), fn_args.get("amount"), fn_args.get("note"))
                            elif fn_name == "create_recurrence_template":
                                tool_result = create_recurrence_template_tool(db, fn_args.get("amount"), fn_args.get("description"), fn_args.get("frequency"), fn_args.get("category"), fn_args.get("type"), fn_args.get("day_of_month"))
                            elif fn_name == "update_recurrence_template":
                                tool_result = update_recurrence_template_tool(db, fn_args.get("template_id"), fn_args.get("amount"), fn_args.get("description"), fn_args.get("frequency"), fn_args.get("category"), fn_args.get("type"), fn_args.get("day_of_month"), fn_args.get("is_active"))
                            elif fn_name == "delete_recurrence_template":
                                tool_result = delete_recurrence_template_tool(db, fn_args.get("template_id"))
                            elif fn_name == "create_category":
                                tool_result = create_category_tool(db, fn_args.get("name"), fn_args.get("type"))
                            elif fn_name == "delete_category":
                                tool_result = delete_category_tool(db, fn_args.get("name"))
                            elif fn_name == "set_predicted_paycheck":
                                tool_result = set_predicted_paycheck_tool(db, fn_args.get("amount"), fn_args.get("day_of_month"), fn_args.get("date_override"))
                            elif fn_name == "delete_transaction":
                                tool_result = delete_transaction_tool(db, fn_args.get("transaction_id"))
                            elif fn_name == "get_saving_recommendations":
                                tool_result = get_saving_recommendations_tool(db)
                            elif fn_name == "search_similar_past_spends":
                                tool_result = search_similar_past_spends_tool(db, fn_args.get("keyword"))
                            elif fn_name == "generate_csv_export_link":
                                tool_result = generate_csv_export_link_tool(db, fn_args.get("category"), fn_args.get("start_date"), fn_args.get("end_date"), fn_args.get("type"))
                            elif fn_name == "simulate_loan_amortization":
                                tool_result = simulate_loan_amortization_tool(db, fn_args.get("principal"), fn_args.get("rate_percent"), fn_args.get("years"))
                            elif fn_name == "store_financial_fact":
                                tool_result = store_financial_fact_tool(db, fn_args.get("key"), fn_args.get("value"), fn_args.get("private_to_session", False), session_id=session.id, user_name=req.user_name)
                                yield f"data: {json.dumps({'fact_update': {'action': 'store', 'key': fn_args.get('key')}})}\n\n"
                            elif fn_name == "forget_financial_fact":
                                tool_result = forget_financial_fact_tool(db, fn_args.get("key"), fn_args.get("private_to_session", False), session_id=session.id, user_name=req.user_name)
                                yield f"data: {json.dumps({'fact_update': {'action': 'forget', 'key': fn_args.get('key')}})}\n\n"
                            else:
                                tool_result = {"error": f"Tool '{fn_name}' is not supported or defined."}

                            # Cache the result if cacheable
                            if fn_name in _CACHEABLE_READ_TOOLS:
                                cache_key = f"{fn_name}:{json.dumps(fn_args, sort_keys=True)}"
                                loop_read_cache[cache_key] = tool_result

                        all_tool_names.append(fn_name)
                        ollama_msgs.append({
                            "role": "tool",
                            "name": fn_name,
                            "content": json.dumps(tool_result, ensure_ascii=False)
                        })

                    iteration += 1

                # Persist tool usage metadata (used by frontend for sidebar auto-refresh)
                if all_tool_names:
                    _tools_meta = f"<!-- TOOLS_USED: {','.join(all_tool_names)} -->\n"

                # If write actions were detected, inject validation block at the end
                if detected_write_actions:
                    action_str = ""
                    for action in detected_write_actions:
                        action_str += f"\n\n```action\n{json.dumps(action, ensure_ascii=False)}\n```"
                    if action_str:
                        final_text += action_str
                        yield f"data: {json.dumps({'content': action_str})}\n\n"

                if not final_text:
                    yield f"data: {json.dumps({'error': 'Le modèle na pas fourni de réponse. Vérifiez votre configuration Ollama.'})}\n\n"
            
            # Save assistant response to DB
            if final_text:
                bot_msg = ChatMessage(session_id=id, role="assistant", content=_tools_meta + final_text)
                db.add(bot_msg)
                db.commit()
                _response_saved = True
                
            # Calculate final token usage — filter by compression point
            final_messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
            tools_tokens_final = estimate_tokens(json.dumps(TOOLS))
            used_tokens = estimate_tokens(sys_prompt) + tools_tokens_final + 500
            if session.compressed_context:
                used_tokens += estimate_tokens(session.compressed_context)
            if session.last_compressed_message_id:
                final_msgs_filtered = [m for m in final_messages if m.id > session.last_compressed_message_id]
            else:
                final_msgs_filtered = final_messages
            for m in final_msgs_filtered:
                used_tokens += estimate_tokens(m.content)
                
            yield f"data: {json.dumps({'token_usage': {'used': used_tokens, 'limit': cfg['num_ctx']}})}\n\n"
            
            if is_first_exchange:
                from app.database import SessionLocal
                import threading
                print(f"[Chat] Launching title generation thread for session {id}")
                threading.Thread(
                    target=generate_session_title,
                    args=(SessionLocal, id, req.content, cfg),
                    daemon=True
                ).start()
            
            yield "data: [DONE]\n\n"
            # If we reach here, the client received everything — no notification needed
            _done_sent = True
                
        except GeneratorExit:
            _client_disconnected = True
            raise
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            
        finally:
            # Safety net: if Ollama failed mid-stream and response wasn't saved, save what we have
            if final_text and not _response_saved and not _client_disconnected:
                try:
                    bot_msg = ChatMessage(session_id=id, role="assistant", content=_tools_meta + final_text)
                    db.add(bot_msg)
                    db.commit()
                    _response_saved = True
                    logger.info(f"[Chat] Saved partial AI response for session {id}")
                except Exception as save_err:
                    logger.error(f"[Chat] Failed to persist AI response: {save_err}")
            
            # If user left the page during generation, create notification now that response is saved
            if id in _notify_on_complete:
                _notify_on_complete.discard(id)
                if _response_saved:
                    try:
                        from app.models import Notification
                        logger.info(f"[Chat] Generation complete for session {id} — creating notification")
                        notif = Notification(
                            type="system",
                            title="Réponse IA disponible 💬",
                            content="Votre conseiller IA a terminé sa réponse. Retrouvez-la dans votre conversation.",
                            link_data=json.dumps({"session_id": id}),
                            is_read=False
                        )
                        db.add(notif)
                        db.commit()
                    except Exception as notif_err:
                        logger.error(f"[Chat] Failed to create completion notification: {notif_err}")
            _generating_sessions.discard(id)
        
    return StreamingResponse(generate_response(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})

@router.post("/sessions/{id}/regenerate")
async def regenerate_response(id: int, request: Request = None, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
        
    # Find last assistant message and delete it
    last_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.desc()).first()
    if last_msg and last_msg.role == "assistant":
        db.delete(last_msg)
        db.commit()
        
    # Get the last user message to feed to the send_message endpoint
    last_user_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id, ChatMessage.role == "user").order_by(ChatMessage.timestamp.desc()).first()
    if not last_user_msg:
        raise HTTPException(status_code=400, detail="Aucun message utilisateur à régénérer")
        
    # Call standard message logic by simulating a new send
    req = ChatSendMessage(content=last_user_msg.content)
    # Delete the user message from DB before re-sending so send_message doesn't duplicate it
    db.delete(last_user_msg)
    db.commit()
    
    return await send_message(id, req, request=request, db=db)

@router.put("/messages/{id}")
async def edit_message(id: int, req: ChatMessageUpdate, request: Request = None, db: Session = Depends(get_db)):
    message = db.query(ChatMessage).filter(ChatMessage.id == id).first()
    if not message or message.role != "user":
        raise HTTPException(status_code=400, detail="Seuls les messages utilisateur peuvent être édités")
        
    session_id = message.session_id
    
    # Delete all subsequent messages in the session
    subsequent = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.timestamp > message.timestamp
    ).all()
    for m in subsequent:
        db.delete(m)
        
    # Delete the edited message itself so send_message doesn't duplicate
    db.delete(message)
    db.commit()
    
    # Send the new edited content
    send_req = ChatSendMessage(content=req.content)
    return await send_message(session_id, send_req, request=request, db=db)

class AutoCatRequest(BaseModel):
    description: str
    amount: float = None

@router.post("/autocategorize")
async def autocategorize(req: AutoCatRequest, db: Session = Depends(get_db)):
    """Ask Ollama to suggest a category for a transaction, preferring existing ones."""
    ollama_url_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_url").first()
    ollama_model_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_model").first()

    if not ollama_url_conf or not ollama_url_conf.value or not ollama_model_conf or not ollama_model_conf.value:
        raise HTTPException(status_code=400, detail="Ollama non configuré.")

    url = ollama_url_conf.value.rstrip("/")
    model = ollama_model_conf.value
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    cat_list = ", ".join(f'"{c}"' for c in categories)

    amount_str = f" de {req.amount} €" if req.amount else ""
    prompt = f"""Tu es un assistant de catégorisation financière.
CATÉGORIES EXISTANTES : {cat_list}

Transaction : "{req.description}"{amount_str}

Réponds UNIQUEMENT avec le nom de la catégorie la plus appropriée, en privilégiant une catégorie existante.
Si aucune ne convient vraiment, propose un nom court (2-3 mots max).
Réponds avec SEULEMENT le nom, sans ponctuation, sans explication."""

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            resp = await client.post(f"{url}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.1, "num_ctx": 512}
            })
            resp.raise_for_status()
            data = resp.json()
            suggested = data.get("message", {}).get("content", "").strip().strip('"').strip("'")
            return {"category": suggested, "existing_categories": categories}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── API endpoints for manual AIFacts management ─────────────────────────────

@router.get("/facts", response_model=List[AIFactOut])
def get_ai_facts(user_name: Optional[str] = None, db: Session = Depends(get_db)):
    from app.models import AIFact, OrgUser
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
        
        # Map user_name for outputs
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
                user_name=u_name
            ))
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/facts")
def update_or_create_ai_fact(req: AIFactCreate, db: Session = Depends(get_db)):
    from app.models import AIFact, OrgUser
    try:
        user_id = None
        if req.user_name:
            user = db.query(OrgUser).filter(OrgUser.name == req.user_name).first()
            if user:
                user_id = user.id

        # Query existing fact
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
                user_id=user_id
            )
            db.add(new_fact)
        
        db.commit()
        return {"ok": True}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/facts/{fact_id}")
def delete_ai_fact(fact_id: int, db: Session = Depends(get_db)):
    from app.models import AIFact
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

