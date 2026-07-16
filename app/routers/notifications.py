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
                diff_seconds = (datetime.utcnow() - last_report.created_at).total_seconds()
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
            "next_predicted_paycheck_date": paycheck_date,
            "next_predicted_paycheck_amount": paycheck_amount,
            "projected_balance_30_days": forecast_end_balance,
            "daily_average_variable_spend": daily_avg_spend,
            "forecast_includes_recurring_income": True,
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
- The 'projected_balance_30_days' field ALREADY includes recurring income (salary, etc.) from the user's recurrence templates. The field 'forecast_includes_recurring_income' confirms this.
- The 'next_predicted_paycheck_date' and 'next_predicted_paycheck_amount' show the user's next expected salary.
- Do NOT claim the projection ignores income. Do NOT suggest the user is at risk of running out of money if the projected balance is positive and the paycheck is factored in.
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

Strict guidelines for the status emoji in 'summary':
- 🟢 (Green) if projected balance is positive, rest to live is comfortable (> 200€), and no real anomalies.
- 🟡 (Warning) if rest to live is low (< 200€) or there are minor genuine anomalies.
- 🔴 (Critical) ONLY if rest to live is negative, projected balance is negative, or severe genuine duplicate charges are confirmed.

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
                # Try to clean markdown codeblocks if Ollama added them anyway
                cleaned_json = report_text
                if cleaned_json.startswith("```"):
                    cleaned_json = cleaned_json.split("\n", 1)[1]
                if cleaned_json.endswith("```"):
                    cleaned_json = cleaned_json.rsplit("\n", 1)[0]
                cleaned_json = cleaned_json.strip()

                try:
                    data = json.loads(cleaned_json)
                    summary_text = data.get("summary", "").strip()
                    detailed_text = data.get("detailed_analysis", "").strip()
                except Exception:
                    # Fallback if Ollama returned non-JSON text
                    logger.warning("Ollama did not return valid JSON for report task, using raw text fallback")
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
