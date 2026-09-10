"""
OmniBank-Local — Chat Orchestrator Service.
Gère l'orchestration du streaming SSE, l'exécution des actions IA, le cycle de vie
des sessions de discussion et l'auto-catégorisation via Ollama.
"""

import asyncio
import json
import logging
import re
import threading
from datetime import date, datetime, timezone
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

import httpx
from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Category, ChatMessage, ChatSession, GlobalConfig, Notification
from app.schemas.api_schemas import ChatSendMessage
from app.services.chat.chat_compression import (
    estimate_tokens,
    generate_session_title,
    start_compression,
)
from app.services.chat.chat_prompt import load_system_prompt
from app.services.chat.chat_snapshot import build_entity_snapshots
from app.services.chat.chat_tools import (
    TOOLS,
    allocate_savings_funds_tool,
    apply_transaction_correction_tool,
    audit_transactions_integrity_tool,
    create_budget_envelope_tool,
    create_category_tool,
    create_recurrence_template_tool,
    delete_budget_envelope_tool,
    delete_category_tool,
    delete_recurrence_template_tool,
    delete_transaction_tool,
    detect_anomalies_and_subscriptions_tool,
    forecast_balances_history_tool,
    forget_financial_fact_tool,
    generate_csv_export_link_tool,
    get_balances_tool,
    get_budgets_status_tool,
    get_dashboard_synthesis_tool,
    get_envelopes_impact_tool,
    get_financial_summary_tool,
    get_monthly_overview_tool,
    get_net_worth_history_tool,
    get_net_worth_tool,
    get_recurrence_templates_tool,
    get_saving_recommendations_tool,
    get_spending_analytics_tool,
    get_spending_trends_tool,
    search_similar_past_spends_tool,
    search_transactions_tool,
    set_predicted_paycheck_tool,
    simulate_financial_scenario_tool,
    simulate_loan_amortization_tool,
    store_financial_fact_tool,
    suggest_transaction_category_tool,
    update_budget_envelope_tool,
    update_recurrence_template_tool,
)
from app.services.chat.ollama_client import get_ollama_config

logger = logging.getLogger(__name__)

# Ensembles en mémoire pour le suivi des générations en cours et notifications
_generating_sessions = set()
_notify_on_complete = set()


def is_session_generating(session_id: int) -> bool:
    """Indique si une génération IA est actuellement en cours pour cette session."""
    return session_id in _generating_sessions


def register_notify_on_complete(session_id: int, db: Session) -> dict:
    """Enregistre qu'une notification doit être créée lorsque la réponse IA est prête."""
    if session_id in _generating_sessions:
        _notify_on_complete.add(session_id)
    else:
        logger.info(f"[Chat] Génération déjà terminée pour la session {session_id} — notification immédiate")
        notif = Notification(
            type="system",
            title="Réponse IA disponible 💬",
            content="Votre conseiller IA a terminé sa réponse. Retrouvez-la dans votre conversation.",
            link_data=json.dumps({"session_id": session_id}),
            is_read=False,
        )
        db.add(notif)
        db.commit()
    return {"ok": True}


def detect_mentioned_month_year(text: str, default_year: int, default_month: int) -> Tuple[int, int]:
    """Détecte les mentions de mois/années dans une question utilisateur ou une réponse."""
    if not text:
        return default_year, default_month
    text_lower = text.lower()
    months_map = {
        "janvier": 1, "january": 1, "janv": 1,
        "février": 2, "fevrier": 2, "february": 2, "fevr": 2, "févr": 2,
        "mars": 3, "march": 3,
        "avril": 4, "april": 4, "avr": 4,
        "mai": 5, "may": 5,
        "juin": 6, "june": 6,
        "juillet": 7, "july": 7, "juil": 7,
        "août": 8, "aout": 8, "august": 8,
        "septembre": 9, "september": 9, "sept": 9,
        "octobre": 10, "october": 10, "oct": 10,
        "novembre": 11, "november": 11, "nov": 11,
        "décembre": 12, "decembre": 12, "december": 12, "dec": 12, "déc": 12,
    }
    detected_month = None
    for name, m_num in months_map.items():
        if re.search(r'\b' + name + r'\b', text_lower):
            detected_month = m_num
            break

    year_match = re.search(r'\b(202[0-9]|203[0-9])\b', text_lower)
    detected_year = int(year_match.group(1)) if year_match else default_year

    if detected_month:
        return detected_year, detected_month
    return default_year, default_month


def execute_chat_action(db: Session, action: str, params: dict) -> dict:
    """
    Exécute de manière transactionnelle une action interactive validée par l'utilisateur.
    """
    if action == "create_budget_envelope":
        res = create_budget_envelope_tool(
            db,
            name=params.get("name"),
            monthly_amount=params.get("monthly_amount"),
            period=params.get("period", "monthly"),
            categories=params.get("categories"),
            is_project=params.get("is_project", False),
            force_write=True,
        )
    elif action == "update_budget_envelope":
        res = update_budget_envelope_tool(
            db,
            budget_id=params.get("budget_id"),
            name=params.get("name"),
            monthly_amount=params.get("monthly_amount"),
            period=params.get("period"),
            categories=params.get("categories"),
            is_closed=params.get("is_closed"),
            force_write=True,
        )
    elif action == "delete_budget_envelope":
        res = delete_budget_envelope_tool(db, budget_id=params.get("budget_id"), force_write=True)
    elif action == "allocate_savings_funds":
        res = allocate_savings_funds_tool(
            db,
            budget_id=params.get("budget_id"),
            amount=params.get("amount"),
            note=params.get("note"),
            force_write=True,
        )
    elif action == "create_recurrence_template":
        res = create_recurrence_template_tool(
            db,
            amount=params.get("amount"),
            description=params.get("description"),
            frequency=params.get("frequency"),
            category=params.get("category"),
            type=params.get("type"),
            day_of_month=params.get("day_of_month"),
            force_write=True,
        )
    elif action == "update_recurrence_template":
        res = update_recurrence_template_tool(
            db,
            template_id=params.get("template_id"),
            amount=params.get("amount"),
            description=params.get("description"),
            frequency=params.get("frequency"),
            category=params.get("category"),
            type=params.get("type"),
            day_of_month=params.get("day_of_month"),
            is_active=params.get("is_active"),
            force_write=True,
        )
    elif action == "delete_recurrence_template":
        res = delete_recurrence_template_tool(db, template_id=params.get("template_id"), force_write=True)
    elif action == "create_category":
        res = create_category_tool(db, name=params.get("name"), type=params.get("type"), force_write=True)
    elif action == "delete_category":
        res = delete_category_tool(db, name=params.get("name"), force_write=True)
    elif action == "set_predicted_paycheck":
        res = set_predicted_paycheck_tool(
            db,
            amount=params.get("amount"),
            day_of_month=params.get("day_of_month"),
            date_override=params.get("date_override"),
            force_write=True,
        )
    elif action == "delete_transaction":
        res = delete_transaction_tool(db, transaction_id=params.get("transaction_id"), force_write=True)
    elif action == "apply_transaction_correction":
        t_id = params.get("transaction_id") or params.get("id")
        updates = params.get("updates", {}) if isinstance(params.get("updates"), dict) else {}
        cat = params.get("category") or updates.get("category")
        if cat and isinstance(cat, str):
            cat = cat.strip()
        desc = params.get("description") or updates.get("description")
        if desc and isinstance(desc, str):
            desc = desc.strip()
        amt = params.get("amount") if params.get("amount") is not None else updates.get("amount")
        ttype = params.get("type") or updates.get("type")
        res = apply_transaction_correction_tool(
            db,
            transaction_id=t_id,
            category=cat,
            description=desc,
            amount=amt,
            type=ttype,
            force_write=True,
        )
    else:
        raise HTTPException(status_code=400, detail=f"Action '{action}' non reconnue")

    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Erreur lors de l'exécution"))

    return res


async def generate_chat_stream(
    session_id: int,
    req: ChatSendMessage,
    request: Optional[Request],
    db: Session,
) -> AsyncGenerator[str, None]:
    """
    Générateur de flux SSE pour l'orchestration complète d'une réponse de conseiller IA :
    1. Vérification configuration Ollama & récupération des messages
    2. Compression automatique si le budget token dépasse 85%
    3. Boucle agentique multi-tours d'appel d'outils (jusqu'à 4 itérations)
    4. Synthèse des actions interactives, snapshots financiers et sauvegarde finale
    """
    session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")

    cfg = get_ollama_config(db)
    if not cfg["enabled"] or not cfg["url"] or not cfg["model"]:
        raise HTTPException(status_code=400, detail="Ollama URL ou Modèle non configuré.")

    url = cfg["url"].rstrip("/")
    model = cfg["model"]

    # Enregistrer le message utilisateur
    user_msg = ChatMessage(session_id=session_id, role="user", content=req.content)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)

    messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.timestamp.asc()).all()
    is_first_exchange = (len(messages) == 1)

    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    sys_prompt = load_system_prompt(session.role, categories, req.lang, db=db, session_id=session.id, user_name=req.user_name)
    options = {"temperature": cfg["temperature"], "num_ctx": cfg["num_ctx"]}

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

    needs_compression = (total_tokens > int(cfg["num_ctx"] * 0.85))

    def build_ollama_payload(current_session, current_messages):
        sys_content = sys_prompt
        if current_session.compression_stack:
            try:
                stack = json.loads(current_session.compression_stack)
                for entry in stack:
                    sys_content += f"\n\n[COMPRESSED HISTORY]\n{entry['context']}"
            except Exception:
                pass
        if current_session.compressed_context:
            sys_content += f"\n\n[CONTEXT SUMMARY — earlier conversation]\n{current_session.compressed_context}"
        payload_msgs = [{"role": "system", "content": sys_content}]
        if current_session.last_compressed_message_id:
            filtered = [m for m in current_messages if m.id > current_session.last_compressed_message_id]
        else:
            filtered = current_messages
        for m in filtered:
            payload_msgs.append({"role": m.role, "content": m.content})
        return payload_msgs

    ollama_msgs = build_ollama_payload(session, messages)

    final_text = ""
    _response_saved = False
    _done_sent = False
    _client_disconnected = False
    _tools_meta = ""
    _generating_sessions.add(session_id)

    try:
        if needs_compression:
            session.compressing = True
            session.compression_started_at = datetime.now(timezone.utc)
            db.commit()
            yield f"data: {json.dumps({'compressing': True})}\n\n"

            new_context = start_compression(db, session, messages, cfg, lang=req.lang, trigger_msg_id=user_msg.id)
            db.refresh(session)

            updated_messages = db.query(ChatMessage).filter(
                ChatMessage.session_id == session_id
            ).order_by(ChatMessage.timestamp.asc()).all()
            ollama_msgs = build_ollama_payload(session, updated_messages)

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
                "get_dashboard_synthesis": "Consultation de la synthèse mensuelle du tableau de bord...",
                "audit_transactions_integrity": "Audit de l'intégrité des opérations et des récurrences...",
                "simulate_financial_scenario": "Simulation financière avancée (What-If)...",
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
                "get_dashboard_synthesis": "Consulting monthly dashboard synthesis...",
                "audit_transactions_integrity": "Auditing transaction data integrity...",
                "simulate_financial_scenario": "Running financial What-If simulation...",
            }
            tool_desc_map = tool_desc_map_en if req.lang == "en" else tool_desc_map_fr

            async def _stream_ollama(payload_data):
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

                yield {"_result": collected_text, "_tool_calls": collected_tool_calls}

            _WRITE_TOOLS = {
                "create_budget_envelope", "update_budget_envelope", "delete_budget_envelope",
                "allocate_savings_funds", "create_recurrence_template", "update_recurrence_template",
                "delete_recurrence_template", "create_category", "delete_category", "set_predicted_paycheck",
                "delete_transaction", "apply_transaction_correction"
            }
            _CACHEABLE_READ_TOOLS = {
                "get_financial_summary", "get_net_worth", "get_account_balances",
                "search_transactions", "get_spending_analytics", "get_budgets_status",
                "get_monthly_overview", "get_recurrence_templates", "get_net_worth_history",
                "get_saving_recommendations", "search_similar_past_spends",
                "detect_anomalies_and_subscriptions", "get_spending_trends",
                "get_dashboard_synthesis", "audit_transactions_integrity",
                "simulate_financial_scenario"
            }
            MAX_TOOL_ITERATIONS = 4
            all_tool_names = []
            detected_write_actions = []
            loop_read_cache = {}
            iteration = 0
            target_period_override = {"year": None, "month": None}

            while iteration < MAX_TOOL_ITERATIONS:
                payload = {
                    "model": model,
                    "messages": ollama_msgs,
                    "tools": TOOLS,
                    "stream": True,
                    "options": options,
                    "keep_alive": "30m",
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
                            except Exception:
                                pass
                        if request and await request.is_disconnected():
                            _client_disconnected = True
                            return
                        yield chunk

                if not detected_tool_calls:
                    final_text = phase_text
                    break

                if phase_text.strip() or iteration > 0:
                    final_text = ""
                    yield f"data: {json.dumps({'clear_text': True, 'iteration': iteration + 1})}\n\n"

                ollama_msgs.append({"role": "assistant", "tool_calls": detected_tool_calls, "content": phase_text})

                for tool_call in detected_tool_calls:
                    if request and await request.is_disconnected():
                        _client_disconnected = True
                        return

                    fn_name = tool_call["function"]["name"]
                    fn_args = tool_call["function"].get("arguments", {})
                    if isinstance(fn_args, str):
                        try:
                            fn_args = json.loads(fn_args)
                        except Exception:
                            fn_args = {}

                    if isinstance(fn_args, dict):
                        if fn_args.get("year"):
                            try:
                                target_period_override["year"] = int(fn_args["year"])
                            except Exception:
                                pass
                        if fn_args.get("month"):
                            try:
                                target_period_override["month"] = int(fn_args["month"])
                            except Exception:
                                pass

                    if fn_name in _WRITE_TOOLS:
                        if request and await request.is_disconnected():
                            _client_disconnected = True
                            return
                        detected_write_actions.append({"action": fn_name, "params": fn_args})

                    desc_status = tool_desc_map.get(fn_name, f"Exécution de {fn_name}...")
                    if iteration > 0:
                        desc_status = f"🔄 Tour {iteration + 1} — {desc_status}"
                    yield f"data: {json.dumps({'status': desc_status})}\n\n"
                    await asyncio.sleep(0.8)

                    tool_result = None
                    if fn_name in _CACHEABLE_READ_TOOLS:
                        cache_key = f"{fn_name}:{json.dumps(fn_args, sort_keys=True)}"
                        if cache_key in loop_read_cache:
                            tool_result = loop_read_cache[cache_key]
                            logger.info(f"[Chat Cache] Outil '{fn_name}' servi depuis le cache de boucle")

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
                        elif fn_name == "audit_transactions_integrity":
                            tool_result = audit_transactions_integrity_tool(db)
                        elif fn_name == "simulate_financial_scenario":
                            tool_result = simulate_financial_scenario_tool(db, fn_args.get("horizon_months", 12), fn_args.get("project_name"), fn_args.get("one_off_amount", 0.0), fn_args.get("recurring_monthly_amount", 0.0), fn_args.get("recurring_duration_months", 12))
                        elif fn_name == "store_financial_fact":
                            tool_result = store_financial_fact_tool(db, fn_args.get("key"), fn_args.get("value"), fn_args.get("private_to_session", False), session_id=session.id, user_name=req.user_name)
                            yield f"data: {json.dumps({'fact_update': {'action': 'store', 'key': fn_args.get('key')}})}\n\n"
                        elif fn_name == "forget_financial_fact":
                            tool_result = forget_financial_fact_tool(db, fn_args.get("key"), fn_args.get("private_to_session", False), session_id=session.id, user_name=req.user_name)
                            yield f"data: {json.dumps({'fact_update': {'action': 'forget', 'key': fn_args.get('key')}})}\n\n"
                        else:
                            tool_result = {"error": f"Tool '{fn_name}' is not supported or defined."}

                        if isinstance(tool_result, dict) and "target_period" in tool_result:
                            tp = tool_result["target_period"]
                            if tp.get("year") and tp.get("month"):
                                target_period_override["year"] = tp["year"]
                                target_period_override["month"] = tp["month"]

                        if fn_name in _CACHEABLE_READ_TOOLS:
                            cache_key = f"{fn_name}:{json.dumps(fn_args, sort_keys=True)}"
                            loop_read_cache[cache_key] = tool_result

                    all_tool_names.append(fn_name)
                    ollama_msgs.append({
                        "role": "tool",
                        "name": fn_name,
                        "content": json.dumps(tool_result, ensure_ascii=False),
                    })

                iteration += 1

            if all_tool_names:
                _tools_meta = f"<!-- TOOLS_USED: {','.join(all_tool_names)} -->\n"

            if detected_write_actions:
                action_str = ""
                for action in detected_write_actions:
                    action_str += f"\n\n```action\n{json.dumps(action, ensure_ascii=False)}\n```"
                if action_str:
                    final_text += action_str
                    yield f"data: {json.dumps({'content': action_str})}\n\n"

            if not final_text:
                yield f"data: {json.dumps({'error': 'Le modèle n a pas fourni de réponse. Vérifiez votre configuration Ollama.'})}\n\n"

        # Sauvegarde de la réponse finale
        if final_text:
            now_dt = date.today()
            snap_y = target_period_override["year"]
            snap_m = target_period_override["month"]
            if not snap_y or not snap_m:
                det_y, det_m = detect_mentioned_month_year(f"{req.content} {final_text}", now_dt.year, now_dt.month)
                snap_y = det_y
                snap_m = det_m
            snapshots = build_entity_snapshots(final_text, db, snap_y, snap_m)
            snapshots_json = json.dumps(snapshots, ensure_ascii=False) if snapshots else None
            if snapshots:
                yield f"data: {json.dumps({'entity_snapshots': snapshots})}\n\n"
            bot_msg = ChatMessage(session_id=session_id, role="assistant", content=_tools_meta + final_text, entity_snapshots=snapshots_json)
            db.add(bot_msg)
            db.commit()
            _response_saved = True

        final_messages = db.query(ChatMessage).filter(ChatMessage.session_id == session_id).order_by(ChatMessage.timestamp.asc()).all()
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
            logger.info(f"[Chat] Lancement de la génération de titre en arrière-plan pour la session {session_id}")
            threading.Thread(
                target=generate_session_title,
                args=(SessionLocal, session_id, req.content, cfg),
                daemon=True,
            ).start()

        yield "data: [DONE]\n\n"
        _done_sent = True

    except GeneratorExit:
        _client_disconnected = True
        raise
    except Exception as e:
        logger.error(f"[Chat] Erreur inattendue dans le flux SSE : {e}", exc_info=True)
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

    finally:
        if final_text and not _response_saved and not _client_disconnected:
            try:
                now_dt = date.today()
                snap_y = target_period_override["year"]
                snap_m = target_period_override["month"]
                if not snap_y or not snap_m:
                    det_y, det_m = detect_mentioned_month_year(f"{req.content} {final_text}", now_dt.year, now_dt.month)
                    snap_y = det_y
                    snap_m = det_m
                snapshots = build_entity_snapshots(final_text, db, snap_y, snap_m)
                snapshots_json = json.dumps(snapshots, ensure_ascii=False) if snapshots else None
                bot_msg = ChatMessage(session_id=session_id, role="assistant", content=_tools_meta + final_text, entity_snapshots=snapshots_json)
                db.add(bot_msg)
                db.commit()
                _response_saved = True
                logger.info(f"[Chat] Réponse partielle sauvegardée pour la session {session_id}")
            except Exception as save_err:
                logger.error(f"[Chat] Échec de sauvegarde de la réponse partielle : {save_err}")

        if session_id in _notify_on_complete:
            _notify_on_complete.discard(session_id)
            if _response_saved:
                try:
                    logger.info(f"[Chat] Génération achevée pour la session {session_id} — création de notification")
                    notif = Notification(
                        type="system",
                        title="Réponse IA disponible 💬",
                        content="Votre conseiller IA a terminé sa réponse. Retrouvez-la dans votre conversation.",
                        link_data=json.dumps({"session_id": session_id}),
                        is_read=False,
                    )
                    db.add(notif)
                    db.commit()
                except Exception as notif_err:
                    logger.error(f"[Chat] Échec de création de la notification de complétion : {notif_err}")

        _generating_sessions.discard(session_id)


async def autocategorize_transaction(db: Session, description: str, amount: Optional[float] = None) -> dict:
    """Demande à Ollama de suggérer une catégorie pour une transaction en privilégiant les existantes."""
    ollama_url_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_url").first()
    ollama_model_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_model").first()

    if not ollama_url_conf or not ollama_url_conf.value or not ollama_model_conf or not ollama_model_conf.value:
        raise HTTPException(status_code=400, detail="Ollama non configuré.")

    url = ollama_url_conf.value.rstrip("/")
    model = ollama_model_conf.value
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    cat_list = ", ".join(f'"{c}"' for c in categories)

    amount_str = f" de {amount} €" if amount else ""
    prompt = f"""Tu es un assistant de catégorisation financière.
CATÉGORIES EXISTANTES : {cat_list}

Transaction : "{description}"{amount_str}

Réponds UNIQUEMENT avec le nom de la catégorie la plus appropriée, en privilégiant une catégorie existante.
Si aucune ne convient vraiment, propose un nom court (2-3 mots max).
Réponds avec SEULEMENT le nom, sans ponctuation, sans explication."""

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            resp = await client.post(f"{url}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.1, "num_ctx": 512},
            })
            resp.raise_for_status()
            data = resp.json()
            suggested = data.get("message", {}).get("content", "").strip().strip('"').strip("'")
            return {"category": suggested, "existing_categories": categories}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
