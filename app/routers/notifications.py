from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import get_db, SessionLocal
from app.models import Notification, GlobalConfig
from datetime import datetime, date
import json
import httpx
import logging
import threading

# Graceful shutdown support for background AI report generation
_shutdown_event = threading.Event()
_active_report_thread = None

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

@router.get("")
def list_notifications(db: Session = Depends(get_db)):
    """List all notifications sorted by newest first."""
    return db.query(Notification).order_by(Notification.created_at.desc()).all()

@router.put("/{notification_id}/read")
def mark_notification_as_read(notification_id: int, db: Session = Depends(get_db)):
    """Mark a specific notification as read."""
    notif = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification non trouvée")
    notif.is_read = True
    db.commit()
    return {"ok": True}

@router.put("/read-all")
def mark_all_notifications_as_read(db: Session = Depends(get_db)):
    """Mark all notifications as read."""
    db.query(Notification).filter(Notification.is_read == False).update({"is_read": True})
    db.commit()
    return {"ok": True}

@router.delete("/{notification_id}")
def delete_notification(notification_id: int, db: Session = Depends(get_db)):
    """Delete a specific notification."""
    notif = db.query(Notification).filter(Notification.id == notification_id).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification non trouvée")
    db.delete(notif)
    db.commit()
    return {"ok": True}

@router.post("/")
def create_notification(data: dict, db: Session = Depends(get_db)):
    """Create a notification (used by frontend when user leaves during AI generation)."""
    notif = Notification(
        type=data.get("type", "system"),
        title=data.get("title", "Notification"),
        content=data.get("content", ""),
        link_data=data.get("link_data"),
        is_read=False
    )
    db.add(notif)
    db.commit()
    return {"ok": True, "id": notif.id}


def get_config_val(db: Session, key: str, default: str) -> str:
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    return cfg.value if cfg else default

def generate_ai_report_task(db_session_factory, force: bool = False):
    """Background task to compile financial data, call Ollama and create a Notification if needed.
    Checks _shutdown_event before each critical I/O to abort gracefully if the app is closing."""
    if _shutdown_event.is_set():
        logger.info("Shutdown requested before report task started. Aborting.")
        return
    db = db_session_factory()
    try:
        # Check if enabled
        enabled = get_config_val(db, "ai_reports_enabled", "false").lower() == "true"
        if not enabled and not force:
            logger.info("AI report is disabled in config. Skipping generation.")
            return

        # Check frequency logic if not forced
        if not force:
            frequency = get_config_val(db, "ai_reports_frequency", "weekly")
            last_report = db.query(Notification).filter(Notification.type == "ai_report").order_by(Notification.created_at.desc()).first()
            if last_report:
                last_dt = last_report.created_at
                now_dt = datetime.now(timezone.utc)
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                diff_seconds = (now_dt - last_dt).total_seconds()
                min_seconds = 24 * 3600 # Daily by default
                if frequency == "weekly":
                    min_seconds = 7 * 24 * 3600
                elif frequency == "monthly":
                    min_seconds = 30 * 24 * 3600
                
                if diff_seconds < min_seconds:
                    logger.info(f"AI report already generated recently ({diff_seconds}s ago vs min {min_seconds}s). Skipping.")
                    return

        # Gather financial data
        from app.routers.chat import get_financial_summary_tool, forecast_balances_history_tool, detect_anomalies_and_subscriptions_tool
        
        # Get Ollama configuration directly from DB
        ollama_url = get_config_val(db, "ollama_url", "http://127.0.0.1:11434")
        ollama_model = get_config_val(db, "ollama_model", "")
        
        summary = get_financial_summary_tool(db)
        forecast = forecast_balances_history_tool(db, 30)
        anomalies = detect_anomalies_and_subscriptions_tool(db)
        
        # Format a summary context
        rtl = summary.get("current_rest_to_live_euros", 0.0)
        paycheck_date = summary.get("next_predicted_paycheck", {}).get("date", "N/A")
        paycheck_amount = summary.get("next_predicted_paycheck", {}).get("amount", 0.0)
        
        # Extract forecast end balance (correct keys from forecast_balances_history_tool)
        forecast_end_balance = 0.0
        forecast_history = forecast.get("history", [])
        if forecast_history:
            forecast_end_balance = forecast_history[-1].get("projected_balance_euros", 0.0)
        daily_avg_spend = forecast.get("daily_average_variable_spend_euros", 0.0)
            
        anomaly_count = len(anomalies.get("detected_subscriptions", [])) + len(anomalies.get("potential_duplicate_charges", []))
        
        # Build list of known recurrence templates enriched with last reconciled amount
        from app.models import Transaction, RecurrenceTemplate
        known_recurrences = []
        templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
        for t in templates:
            # Find the last reconciled transaction linked to this template
            last_reconciled = db.query(Transaction).filter(
                Transaction.recurrence_id == t.id,
                Transaction.reconciliation_date.isnot(None)
            ).order_by(Transaction.date_operation.desc()).first()
            
            known_recurrences.append({
                "description": t.description,
                "template_amount": t.amount,
                "last_reconciled_amount": last_reconciled.amount if last_reconciled else t.amount,
                "type": t.type,
                "frequency": t.frequency,
                "day_of_month": t.day_of_month
            })
        
        context_data = {
            "current_reste_a_vivre": rtl,
            "current_reste_a_vivre_note": "This is the REAL available budget until the next paycheck: reconciled balance minus unreconciled pending expenses minus savings reservations. This is the most conservative and reliable short-term metric.",
            "next_predicted_paycheck_date": paycheck_date,
            "next_predicted_paycheck_amount": paycheck_amount,
            "projected_balance_30_days": forecast_end_balance,
            "daily_average_variable_spend": daily_avg_spend,
            "pending_unreconciled_expenses": forecast.get("pending_unreconciled_expenses_euros", 0.0),
            "savings_reserved": forecast.get("savings_reserved_euros", 0.0),
            "savings_safety_buffer_euros": forecast.get("savings_safety_buffer_euros", 0.0),
            "savings_safety_note": forecast.get("savings_safety_note", ""),
            "real_overdraft_threshold_euros": forecast.get("real_overdraft_threshold_euros", 0.0),
            "effective_starting_balance": forecast.get("effective_starting_balance_euros", 0.0),
            "forecast_includes_recurring_income": True,
            "forecast_projected_income_events": forecast.get("projected_income_events", []),
            "forecast_income_note": forecast.get("income_note", ""),
            "excluded_outliers": forecast.get("excluded_outliers", []),
            "outlier_note": forecast.get("outlier_note", ""),
            "detected_anomalies_or_subscriptions_count": anomaly_count,
            "detected_subscriptions_details": anomalies.get("detected_subscriptions", []),
            "potential_duplicate_charges": anomalies.get("potential_duplicate_charges", []),
            "active_recurrence_templates": known_recurrences
        }
        
        # Query Ollama
        enable_ai = get_config_val(db, "enable_ai", "false") == "true"
        if not enable_ai or not ollama_url or not ollama_model:
            logger.warning("Ollama not configured or AI disabled. Cannot generate AI financial report.")
            return
            
        url = ollama_url.rstrip("/")
        model = ollama_model
        
        system_prompt = """You are the Proactive Financial Analyst for OmniBank.
Your goal is to write a personal financial health status report for the user based on the provided JSON data.
You must return a JSON object with the following schema:
{
  "summary": "Short 2-sentence summary (French, starting with 🟢, 🟡, or 🔴 depending on status). No markdown tables.",
  "detailed_analysis": "Detailed financial breakdown (French, structured, with bullet points or paragraphs, explaining the projection, budget status, and recommendations in detail. Clean markdown formatting allowed.)"
}

=== CRITICAL RULES (READ CAREFULLY) ===

RULE 1 — INCOME AND FORECAST:
- The 'projected_balance_30_days' field ALREADY includes recurring income (salary, etc.) from the user's recurrence templates AND the predicted paychecks listed in 'forecast_projected_income_events'.
- The predicted paycheck dates and amounts show when and how much the user is expected to receive.
- Do NOT claim the projection ignores income or salaries. Do NOT suggest the user is at risk of running out of money if the projected balance is positive and the paychecks are factored in.
- Base your analysis on the ACTUAL projected balance number, not on assumptions.

RULE 2 — RECURRENCE TEMPLATES vs DETECTED SUBSCRIPTIONS:
- 'active_recurrence_templates' are the user's EXPLICITLY CONFIGURED recurring transactions (salary, rent, loans, insurance, subscriptions, etc.). These are EXPECTED and NORMAL.
- Each template has TWO amount fields: 'template_amount' (the amount set when the recurrence was first created — this may be outdated) and 'last_reconciled_amount' (the amount from the most recent bank-reconciled transaction for this recurrence — THIS is the current, real-world amount).
- ALWAYS use 'last_reconciled_amount' as the reference for what is "normal" for a recurrence, NOT 'template_amount'. Amounts naturally evolve over time (rate changes, insurance adjustments, loan amortization, tax revisions, consumption-based billing, etc.).
- 'detected_subscriptions_details' are automatically detected from transaction history based on pattern matching.
- If a detected subscription matches a recurrence template BY DESCRIPTION (even partially), it is a KNOWN, EXPECTED charge. Do NOT flag it as an anomaly.
- If a detected subscription's amount is close to the 'last_reconciled_amount' of a matching template, this is entirely normal. Do NOT flag it.
- Do NOT recommend the user to "contact the provider" or "verify the billing" for known recurring charges.

RULE 3 — DUPLICATES:
- 'potential_duplicate_charges' are flagged when two transactions share the same date, description, and amount.
- If a potential duplicate matches a known recurrence template, it is very likely a normal monthly charge, NOT a duplicate. Do NOT flag it.
- Only flag a duplicate if it genuinely appears to be an accidental double payment with no corresponding template.

RULE 4 — TONE AND RECOMMENDATIONS:
- Be constructive and measured. Do NOT create panic about normal financial situations.
- Only recommend drastic action ("reduce all spending", "find additional income") if the projected balance is genuinely negative.
- Focus recommendations on actionable, specific insights rather than generic financial advice.

RULE 5 — EXCEPTIONAL EXPENSES (OUTLIERS):
- If the data contains 'excluded_outliers' with one or more entries, these are exceptional one-time purchases (e.g. vehicle, major appliance, furniture) that were statistically detected and EXCLUDED from the daily average variable spending projection.
- Mention them factually in the detailed analysis (e.g. "Un achat exceptionnel de véhicule de X € a été détecté et correctement exclu de la projection de dépenses courantes").
- Do NOT project these outlier amounts as recurring daily expenses. They are already deducted once from the current balance but are NOT repeated in the forward projection.
- If outliers are present, the projected balance is MORE RELIABLE because it reflects normal spending patterns, not distorted by one-off large purchases.
- If the 'outlier_note' field is non-empty, reference it in your analysis.
- Do NOT recommend the user to "reduce spending" or flag financial danger when the deficit in the current balance is explained by a known outlier purchase that the user clearly could afford (balance was positive before the purchase).

RULE 6 — RESTE À VIVRE, SAVINGS BUFFER, AND OVERDRAFT RISK (CRITICAL):
- 'current_reste_a_vivre' is the REAL available budget until the next paycheck. It already accounts for unreconciled pending expenses and savings reservations. It is the MOST RELIABLE short-term metric.
- 'projected_balance_30_days' is a simulation. While useful for trends, it may differ from the RTL.
- You MUST ALWAYS mention the 'current_reste_a_vivre' prominently in your analysis. It tells the user how much they can actually spend until their next paycheck.
- If 'current_reste_a_vivre' is low (< 200€) but 'projected_balance_30_days' is high, do NOT present the situation as comfortable. The RTL is more accurate for short-term assessment.
- Calculate the daily budget available: current_reste_a_vivre / days_until_next_paycheck. Present this as "budget quotidien disponible" so the user knows their spending ceiling.
- The 'pending_unreconciled_expenses' field shows expenses already entered but not yet debited from the bank. These are REAL upcoming outflows.

SAVINGS AS SAFETY BUFFER (TIRELIRES):
- The 'savings_reserved' field shows funds earmarked for savings goals (tirelire). These are excluded from the RTL to encourage spending discipline.
- HOWEVER, tirelires are VIRTUAL envelopes on the SAME bank account — the money is physically present and accessible.
- If 'savings_safety_buffer_euros' > 0, mention that the user has this amount as a safety net that can be tapped in case of emergency to avoid a real bank overdraft.
- A real bank overdraft only occurs when the TOTAL account balance (including savings) goes negative, i.e., when spending exceeds RTL + savings buffer.
- If RTL is low but savings buffer is substantial, the tone should be cautious (🟡) but NOT alarmist (🔴), because the user has a financial cushion available.
- Example phrasing: "Votre reste à vivre est de X€ (Y€/jour), mais vos Z€ en tirelires constituent un filet de sécurité en cas de besoin."

Strict guidelines for the status emoji in 'summary':
- 🟢 (Green) if projected balance is positive, rest to live is comfortable (> 200€), and no real anomalies.
- 🟡 (Warning) if rest to live is low (< 200€) but savings buffer provides adequate safety net, or there are minor genuine anomalies.
- 🔴 (Critical) ONLY if BOTH rest to live AND savings buffer combined would not prevent a real overdraft, projected balance is deeply negative, or severe genuine duplicate charges are confirmed.

Return ONLY the raw JSON object, no introduction, no markdown blocks like ```json, just the JSON string."""

        user_content = f"Here is the user's current financial situation:\n{json.dumps(context_data, indent=2)}"
        
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content}
            ],
            "stream": False,
            "options": {
                "temperature": 0.4,
                "num_ctx": int(get_config_val(db, "ollama_context", "4096"))
            }
        }
        
        # Check shutdown before starting the potentially long Ollama HTTP call
        if _shutdown_event.is_set():
            logger.info("Shutdown requested before Ollama call. Aborting report generation.")
            return

        resp = httpx.post(f"{url}/api/chat", json=payload, timeout=httpx.Timeout(300.0, connect=10.0))
        if resp.status_code == 200:
            result = resp.json()
            report_text = result.get("message", {}).get("content", "").strip()
            if report_text:
                summary_text = ""
                detailed_text = ""
                # Robust cleaning: Ollama may wrap JSON in various codeblock
                # styles (```json, ``` json, ```, with or without language tag,
                # possibly prefixed or suffixed by chat preamble).
                import re
                cleaned_json = report_text.strip()

                # Remove leading/trailing markdown codeblock markers robustly
                # Handles: ```json\n...\n```, ```\n...\n```, etc.
                codeblock_match = re.search(
                    r'```(?:json)?\s*\n(.*?)\n\s*```',
                    cleaned_json,
                    re.DOTALL
                )
                if codeblock_match:
                    cleaned_json = codeblock_match.group(1).strip()
                else:
                    # Fallback: strip leading ``` line and trailing ``` line
                    if cleaned_json.startswith("```"):
                        cleaned_json = cleaned_json.split("\n", 1)[-1]
                    if cleaned_json.endswith("```"):
                        cleaned_json = cleaned_json.rsplit("\n", 1)[0]
                    cleaned_json = cleaned_json.strip()

                # Last resort: extract first { ... } block from the text
                if not cleaned_json.startswith("{"):
                    brace_match = re.search(r'\{.*\}', cleaned_json, re.DOTALL)
                    if brace_match:
                        cleaned_json = brace_match.group(0).strip()

                try:
                    data = json.loads(cleaned_json)
                    summary_text = data.get("summary", "").strip()
                    detailed_text = data.get("detailed_analysis", "").strip()
                except Exception as json_err:
                    # Fallback if Ollama returned non-JSON text
                    logger.warning(f"Ollama did not return valid JSON for report task: {json_err}. Raw start: {report_text[:200]}")
                    summary_text = report_text
                    detailed_text = report_text

                # Resolve title from status emoji
                title = "Bilan Financier Hebdomadaire"
                if "🔴" in summary_text:
                    title = "Alerte Financière Critique 🔴"
                elif "🟡" in summary_text:
                    title = "Avertissement Budgétaire 🟡"
                elif "🟢" in summary_text:
                    title = "Bilan de Santé Financière 🟢"
                
                new_notif = Notification(
                    type="ai_report",
                    title=title,
                    content=summary_text,
                    detailed_content=detailed_text,
                    is_read=False
                )
                # Check shutdown before committing to avoid interrupted DB write
                if _shutdown_event.is_set():
                    logger.info("Shutdown requested before DB commit. Discarding report.")
                    return
                db.add(new_notif)
                db.commit()
                logger.info(f"AI Report successfully created: {title}")
        else:
            logger.error(f"Failed to query Ollama. Status: {resp.status_code}")
            err_notif = Notification(
                type="system",
                title="Erreur de Bilan IA ❌",
                content=f"Ollama a retourné un code statut {resp.status_code} lors de la génération.",
                is_read=False
            )
            db.add(err_notif)
            db.commit()
            
    except Exception as e:
        if _shutdown_event.is_set():
            logger.info("Exception during shutdown — suppressed gracefully.")
            return
        logger.error(f"Error in generate_ai_report_task: {e}", exc_info=True)
        # Create a user-facing system notification for visibility
        try:
            db_err = SessionLocal()
            err_notif = Notification(
                type="system",
                title="Échec Génération Bilan IA ❌",
                content=f"Une erreur s'est produite : {str(e)}",
                is_read=False
            )
            db_err.add(err_notif)
            db_err.commit()
            db_err.close()
        except Exception as db_err_exc:
            logger.error(f"Could not write error notification to database: {db_err_exc}")
    finally:
        db.close()

@router.post("/generate-ai-report")
def trigger_ai_report_generation(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Trigger the asynchronous generation of an AI financial report."""
    from app.database import SessionLocal
    background_tasks.add_task(generate_ai_report_task, SessionLocal, force=True)
    return {"message": "Génération du bilan IA lancée en arrière-plan."}
