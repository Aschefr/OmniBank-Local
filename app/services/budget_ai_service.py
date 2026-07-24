from typing import Optional, List, Dict, Any
from datetime import date
import json
import logging
import re
import time
import unicodedata
from difflib import SequenceMatcher
from collections import defaultdict
import statistics
from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session
from sqlalchemy import or_
from fastapi import HTTPException

from app.models import Budget, BudgetCategory, Transaction, Category, RecurrenceTemplate
from app.routers.chat import get_ollama_config, call_ollama_sync
from app.services.finance_engine import predict_next_paycheck

logger = logging.getLogger(__name__)

AI_TASK_STATUS: Dict[str, Any] = {
    "state": "IDLE",
    "step_key": "ai_status_preparing",
    "elapsed_seconds": 0,
    "max_seconds": 300,
    "result": None,
    "error": None,
    "start_time": None,
}

def get_ai_suggest_status() -> Dict[str, Any]:
    if AI_TASK_STATUS["state"] in ["PREPARING", "SENDING", "THINKING", "PARSING"] and AI_TASK_STATUS.get("start_time"):
        AI_TASK_STATUS["elapsed_seconds"] = int(time.time() - AI_TASK_STATUS["start_time"])
    return AI_TASK_STATUS

def cancel_ai_suggest() -> Dict[str, Any]:
    global AI_TASK_STATUS
    AI_TASK_STATUS.update({
        "state": "IDLE",
        "step_key": "ai_status_idle",
        "elapsed_seconds": 0,
        "start_time": None,
        "error": None,
    })
    return {"status": "cancelled"}

def compute_monthly_averages_for_ai(db: Session, already_used_cats: set, anchor_date: date, window_months: int = 3) -> dict:
    window_start = anchor_date - relativedelta(months=window_months)
    end_of_current_month = date(anchor_date.year, anchor_date.month, 1) + relativedelta(months=1, days=-1)

    non_expense_or_closed_cats = set(
        c[0] for c in db.query(Category.name).filter(
            or_(
                Category.is_closed == True,
                Category.type.in_(["income", "neutral", "transfer", "Recettes", "Transfert", "Neutre"])
            )
        ).all() if c[0]
    )

    txs = db.query(Transaction).filter(
        Transaction.date_operation >= window_start,
        Transaction.date_operation <= end_of_current_month,
        Transaction.type.in_(["expense", "expense_fixed", "expense_var", "Dépenses fixes", "Dépenses variables"])
    ).all()

    cat_monthly: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cat_type: dict[str, str] = {}
    cat_descriptions: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    cat_amounts_list: dict[str, list[float]] = defaultdict(list)

    for tx in txs:
        if tx.type in ["income", "transfer", "neutral", "Recettes", "Transfert", "Neutre"] or (tx.from_account_id and tx.to_account_id):
            continue

        cat = tx.category or "Sans catégorie"
        if cat in already_used_cats or cat in non_expense_or_closed_cats:
            continue

        month_key = tx.date_operation.strftime("%Y-%m")
        amt = abs(tx.amount)
        cat_monthly[cat][month_key] += amt
        cat_amounts_list[cat].append(amt)
        cat_type[cat] = tx.type

        desc = (tx.description or "").strip()
        if desc:
            cat_descriptions[cat][desc] += 1

    recurrence_templates = db.query(RecurrenceTemplate).all()
    yearly_recurrence_cats = set()
    yearly_recurrence_sums = defaultdict(float)

    for t in recurrence_templates:
        freq_lower = (t.frequency or "").lower()
        if freq_lower in ("yearly", "semi-annually", "bi-annually", "annuel", "bi-annuel") or t.month_of_year is not None:
            if t.category:
                yearly_recurrence_cats.add(t.category)
                yearly_recurrence_sums[t.category] += abs(t.amount or 0.0)

    db_expense_cats = set(
        c[0] for c in db.query(Category.name).filter(
            Category.is_closed == False,
            or_(
                Category.type.is_(None),
                Category.type.in_(["expense", "expense_fixed", "expense_var", "Dépenses fixes", "Dépenses variables"])
            ),
            ~Category.type.in_(["income", "neutral", "transfer", "Recettes", "Transfert", "Neutre"])
        ).all() if c[0]
    )
    tx_expense_cats = set(
        c[0] for c in db.query(Transaction.category).filter(
            Transaction.type.in_(["expense", "expense_fixed", "expense_var", "Dépenses fixes", "Dépenses variables"])
        ).distinct().all() if c[0]
    )
    all_all_cats = (db_expense_cats | tx_expense_cats) - already_used_cats - non_expense_or_closed_cats

    if not cat_monthly and not all_all_cats:
        return {}

    all_cat_totals = [sum(m.values()) / max(len(m), 1) for m in cat_monthly.values()]
    median_cat_avg = statistics.median(all_cat_totals) if all_cat_totals else 100.0

    result = {}
    for cat, monthly_sums in cat_monthly.items():
        raw_amounts = cat_amounts_list.get(cat, [])
        cat_median = statistics.median(raw_amounts) if raw_amounts else 0.0

        regular_amounts = []
        outlier_amounts = []
        for amt in raw_amounts:
            if cat_median > 0 and amt > max(2.5 * cat_median, 200.0) and len(raw_amounts) >= 3:
                outlier_amounts.append(amt)
            else:
                regular_amounts.append(amt)

        recurring_total = sum(regular_amounts) if regular_amounts else sum(raw_amounts)
        total = sum(monthly_sums.values())
        active_months_cnt = len(monthly_sums)

        avg = round(recurring_total / max(window_months, 1), 2)
        desc_counts = cat_descriptions.get(cat, {})
        top_descs = [d for d, _ in sorted(desc_counts.items(), key=lambda x: -x[1])[:5]]
        
        monthly_values = list(monthly_sums.values())
        is_fixed = (cat_type.get(cat) == "expense_fixed")
        fixed_amount = round(total / max(active_months_cnt, 1), 2)

        if is_fixed and monthly_values:
            sorted_months = sorted(monthly_sums.keys(), reverse=True)
            most_recent_month = sorted_months[0]
            fixed_amount = round(monthly_sums[most_recent_month], 2)
        elif len(raw_amounts) >= 2:
            if len(set(raw_amounts)) == 1:
                is_fixed = True
                fixed_amount = round(raw_amounts[0], 2)

        is_exceptional = bool(outlier_amounts) or ((avg > (2.0 * median_cat_avg)) and (active_months_cnt <= 2) and (cat_type.get(cat) == "expense_var"))

        if cat in yearly_recurrence_cats:
            suggested_period = "yearly"
            rec_total = yearly_recurrence_sums.get(cat, 0.0)
            total_year_val = round(rec_total if rec_total > 0 else total, 2)
        else:
            if is_exceptional:
                suggested_period = "yearly"
            elif is_fixed and active_months_cnt == 1 and window_months >= 6:
                suggested_period = "yearly"
            else:
                suggested_period = "monthly"
            total_year_val = round(total, 2)

        current_month_key = anchor_date.strftime("%Y-%m")
        current_month_spent = round(monthly_sums.get(current_month_key, 0.0), 2)

        if suggested_period == "yearly":
            recent_3m_avg = round(total_year_val / 12.0, 2)
        else:
            recent_calendar_months = []
            cursor = date(anchor_date.year, anchor_date.month, 1)
            for _ in range(min(3, window_months)):
                recent_calendar_months.append(cursor.strftime("%Y-%m"))
                cursor = cursor - relativedelta(months=1)
            sum_recent = sum(monthly_sums.get(k, 0.0) for k in recent_calendar_months)
            recent_3m_avg = round(sum_recent / max(len(recent_calendar_months), 1), 2)

        result[cat] = {
            "avg": fixed_amount if is_fixed else avg,
            "current_month_spent": current_month_spent,
            "recent_3m_avg": recent_3m_avg,
            "total_year": total_year_val,
            "active_months_cnt": active_months_cnt,
            "suggested_period": suggested_period,
            "type": cat_type.get(cat, "expense_var"),
            "top_descs": top_descs,
            "is_fixed": is_fixed,
            "fixed_amount": fixed_amount,
            "is_exceptional": is_exceptional,
        }

    for cat in all_all_cats:
        if cat not in result:
            result[cat] = {
                "avg": 0.0,
                "current_month_spent": 0.0,
                "recent_3m_avg": 0.0,
                "total_year": 0.0,
                "active_months_cnt": 0,
                "suggested_period": "monthly",
                "type": "expense_var",
                "top_descs": [],
                "is_fixed": False,
                "fixed_amount": 0.0,
                "is_exceptional": False,
            }

    return result

def extract_json_envelopes(cleaned_raw: str) -> list[dict]:
    parsed_objs = []
    try:
        data_json = json.loads(cleaned_raw)
        if isinstance(data_json, list):
            for item in data_json:
                if isinstance(item, dict):
                    if "name" in item or "title" in item or "enveloppe" in item:
                        parsed_objs.append(item)
                    elif len(item) == 1:
                        k, v = next(iter(item.items()))
                        if isinstance(v, list):
                            parsed_objs.append({"name": k, "categories": v})
        elif isinstance(data_json, dict):
            for key in ["envelopes", "proposals", "enveloppes", "budgets", "categories", "suggestions", "items", "data", "result", "enveloppes_budgetaires", "propositions"]:
                if key in data_json and isinstance(data_json[key], list):
                    for item in data_json[key]:
                        if isinstance(item, dict):
                            if "name" in item or "title" in item or "enveloppe" in item:
                                parsed_objs.append(item)
                            elif len(item) == 1:
                                k, v = next(iter(item.items()))
                                if isinstance(v, list):
                                    parsed_objs.append({"name": k, "categories": v})
                    break

            if not parsed_objs:
                for k, v in data_json.items():
                    if isinstance(v, list) and len(v) > 0:
                        if isinstance(v[0], str):
                            parsed_objs.append({"name": k, "categories": v})
                        elif isinstance(v[0], dict):
                            parsed_objs.extend(v)
    except Exception as err:
        logger.warning(f"[AI Budget] Échec json.loads: {err}")

    if not parsed_objs:
        array_match = re.search(r'\[.*\]', cleaned_raw, re.DOTALL)
        if array_match:
            try:
                data = json.loads(array_match.group(0))
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict):
                            if "name" in item or "title" in item or "enveloppe" in item:
                                parsed_objs.append(item)
            except Exception:
                pass

    if not parsed_objs:
        matches = re.findall(r'\{[^{}]*\}', cleaned_raw, re.DOTALL)
        for m in matches:
            try:
                item = json.loads(m)
                if isinstance(item, dict):
                    if "name" in item or "title" in item or "enveloppe" in item:
                        parsed_objs.append(item)
            except Exception:
                pass

    return parsed_objs

def ai_suggest_budgets_service(window_months: int, lang: Optional[str], db: Session) -> dict:
    global AI_TASK_STATUS
    AI_TASK_STATUS.update({
        "state": "PREPARING",
        "step_key": "ai_status_preparing",
        "elapsed_seconds": 0,
        "max_seconds": 300,
        "result": None,
        "error": None,
        "start_time": time.time(),
    })

    window_months = window_months if window_months in (3, 6, 12) else 3

    cfg = get_ollama_config(db)
    if not cfg.get("enabled"):
        AI_TASK_STATUS["state"] = "ERROR"
        AI_TASK_STATUS["error"] = "IA non activée dans les paramètres."
        raise HTTPException(status_code=400, detail="IA non activée dans les paramètres.")

    paycheck_info = predict_next_paycheck(db)
    regular_salary = paycheck_info.get("amount", 0.0) if paycheck_info else 0.0

    existing_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    already_used_cats = set()
    already_engaged_monthly = 0.0

    for b in existing_budgets:
        if (b.envelope_type or "spending") != "savings":
            if b.period == "yearly":
                already_engaged_monthly += (b.monthly_amount / 12.0)
            else:
                already_engaged_monthly += b.monthly_amount
        for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all():
            already_used_cats.add(c.category_name)

    available_monthly_budget = max(0.0, regular_salary - already_engaged_monthly)

    latest_past_tx = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).first()
    anchor_date = latest_past_tx.date_operation if latest_past_tx else date.today()

    cat_data = compute_monthly_averages_for_ai(db, already_used_cats, anchor_date, window_months=window_months)

    active_cats = [c for c, info in cat_data.items() if info.get("avg", 0) > 0 or info.get("total_year", 0) > 0]
    effective_window = window_months
    if len(active_cats) == 0 and window_months < 12:
        for try_w in (6, 12):
            if try_w > window_months:
                try_data = compute_monthly_averages_for_ai(db, already_used_cats, anchor_date, window_months=try_w)
                try_active = [c for c, info in try_data.items() if info.get("avg", 0) > 0 or info.get("total_year", 0) > 0]
                if len(try_active) > 0 or try_w == 12:
                    cat_data = try_data
                    effective_window = try_w
                    window_months = try_w
                    logger.info(f"[AI Budget] Auto-extended analysis window to {effective_window} months")
                    break

    if not cat_data:
        raise HTTPException(status_code=400, detail="Toutes vos dépenses sont déjà couvertes par vos enveloppes actuelles.")

    nb_cats = len(cat_data)
    cat_lines = []
    for cat, info in sorted(cat_data.items(), key=lambda x: -x[1]["avg"]):
        period_str = "ANNUAL" if info.get("suggested_period") == "yearly" else "MONTHLY"
        fix_str = "FIXED" if info["is_fixed"] else "VARIABLE"
        desc_str = f" | Examples: {', '.join(info['top_descs'][:3])}" if info["top_descs"] else ""
        cat_lines.append(f'- Category: "{cat}" | Recurrence: {period_str} | Type: {fix_str}{desc_str}')
    formatted_cats = "\n".join(cat_lines)

    target_lang = "English" if lang == "en" else "French"

    prompt = f"""You are an expert personal financial advisor. Analyze these {nb_cats} real financial spending categories:

{formatted_cats}

TASK: Group these categories into 10 to 14 precise, targeted thematic budget envelopes.

RULES:
1. Create between 10 and 14 specific envelopes. Do not create huge mixed groups.
2. Separate loans/mortgages from insurance, telecom from cloud services, and vehicle maintenance from toll fees.
3. In the "categories" list for each envelope, include ONLY the exact category names from the input list.
4. EVERY input category MUST be assigned to an envelope.
5. Respect the Recurrence (ANNUAL vs MONTHLY) specified for each category. NEVER mix ANNUAL categories and MONTHLY categories together in the same envelope. Create separate envelopes for ANNUAL expenses.
6. Budget envelopes are strictly for EXPENSE categories. Never group or suggest income, salary, or transfer categories.

LANGUAGE REQUIREMENT:
Write all envelope names and reason justifications in {target_lang}.

Response format (JSON object with key "envelopes"):
{{
  "envelopes": [
    {{"name": "Envelope Name in {target_lang}", "categories": ["ExactCatName1", "ExactCatName2"], "reason": "Justification in {target_lang}"}},
    ...
  ]
}}"""

    AI_TASK_STATUS["state"] = "SENDING"
    AI_TASK_STATUS["step_key"] = "ai_status_sending"

    raw = ""
    last_error_msg = ""
    try:
        raw = call_ollama_sync(prompt, cfg, extra_options={"format": "json"})
    except HTTPException as e:
        last_error_msg = e.detail
        logger.warning(f"[AI Budget] Premier essai Ollama json échoué: {e.detail}")
    except Exception as e:
        last_error_msg = str(e)
        logger.warning(f"[AI Budget] Premier essai Ollama json échoué: {e}")

    if not raw or not raw.strip():
        try:
            logger.info("[AI Budget] Tentative 2 avec appel Ollama standard...")
            raw = call_ollama_sync(prompt, cfg)
        except HTTPException as e2:
            last_error_msg = e2.detail
            logger.warning(f"[AI Budget] Tentative 2 Ollama échouée: {e2.detail}")
        except Exception as e2:
            last_error_msg = str(e2)
            logger.warning(f"[AI Budget] Tentative 2 Ollama échouée: {e2}")

    if not raw or not raw.strip():
        err_detail = f"Impossible de communiquer avec le modèle IA Ollama : {last_error_msg}".strip()
        AI_TASK_STATUS["state"] = "ERROR"
        AI_TASK_STATUS["error"] = err_detail
        raise HTTPException(status_code=502, detail=err_detail)

    AI_TASK_STATUS["state"] = "PARSING"
    AI_TASK_STATUS["step_key"] = "ai_status_parsing"

    cleaned_raw = re.sub(r'```(?:json)?', '', raw or "").strip()
    parsed_objs = extract_json_envelopes(cleaned_raw) if cleaned_raw else []

    def _normalize_cat_key(s: str) -> str:
        if not s:
            return ""
        s = unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('utf-8')
        s = re.sub(r'[^a-z0-9]', ' ', s.lower())
        words = [re.sub(r's$', '', w) for w in s.split() if w]
        return ''.join(words)

    cat_name_lookup = {_normalize_cat_key(real_name): real_name for real_name in cat_data.keys()}

    def _resolve_cat_name(llm_name):
        if not llm_name or not isinstance(llm_name, str):
            return None
        clean_llm_raw = re.sub(r'\[.*?\]|\(.*?\)', '', llm_name).strip()

        if clean_llm_raw in cat_data:
            return clean_llm_raw
        if llm_name in cat_data:
            return llm_name
            
        clean_llm = _normalize_cat_key(clean_llm_raw)
        if not clean_llm:
            return None

        if clean_llm in cat_name_lookup:
            return cat_name_lookup[clean_llm]

        candidates = []
        for clean_key, real_name in cat_name_lookup.items():
            if clean_key == clean_llm:
                return real_name
            if clean_key in clean_llm or clean_llm in clean_key:
                candidates.append((len(clean_key), real_name))
            else:
                ratio = SequenceMatcher(None, clean_key, clean_llm).ratio()
                if ratio >= 0.65:
                    candidates.append((ratio * 10, real_name))

        if candidates:
            candidates.sort(key=lambda x: -x[0])
            return candidates[0][1]

        return None

    proposals = []
    used_in_proposals = set()

    def _build_proposal(name, sub_cats, reason_override=None, period_override=None):
        is_all_fixed = all(cat_data[c]["is_fixed"] or cat_data[c]["type"] == "expense_fixed" for c in sub_cats)
        all_exceptional = all(cat_data[c]["is_exceptional"] for c in sub_cats)
        
        yearly_count = sum(1 for c in sub_cats if cat_data[c].get("suggested_period") == "yearly")
        monthly_count = len(sub_cats) - yearly_count
        suggested_period = period_override or ("yearly" if yearly_count > monthly_count else "monthly")

        cat_amounts = {}
        for c in sub_cats:
            c_period = cat_data[c].get("suggested_period", "monthly")
            c_is_fixed = cat_data[c]["is_fixed"]
            c_fixed_val = cat_data[c]["fixed_amount"]
            c_avg_val = cat_data[c]["avg"]
            c_tot_yr = cat_data[c]["total_year"]

            if suggested_period == "yearly":
                val = c_tot_yr if c_period == "yearly" else round((c_fixed_val if c_is_fixed else c_avg_val) * 12.0, 2)
            else:
                val = (c_fixed_val if c_is_fixed else c_avg_val) if c_period == "monthly" else round(c_tot_yr / 12.0, 2)
            
            cat_amounts[c] = val

        base_amount = round(sum(cat_amounts.values()), 2)

        top_merchants = []
        for c in sub_cats:
            top_merchants.extend(cat_data[c]["top_descs"])
        unique_merchants = list(dict.fromkeys(top_merchants))[:4]
        merchant_str = f" ({', '.join(unique_merchants)})" if unique_merchants else ""

        if is_all_fixed:
            if lang == "en":
                cats_str = ", ".join(sub_cats)
                merchant_str = f" with sample transactions: {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Contractual fixed expense ({cats_str}){merchant_str}."
            else:
                cats_str = ", ".join(sub_cats)
                merchant_str = f" avec exemples d'opérations : {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Charge fixe contractuelle ({cats_str}){merchant_str}."
        elif all_exceptional:
            if lang == "en":
                cats_str = ", ".join(sub_cats)
                merchant_str = f" with sample transactions: {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"One-off/project expense detected ({cats_str}){merchant_str}."
            else:
                cats_str = ", ".join(sub_cats)
                merchant_str = f" avec exemples d'opérations : {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Dépense ponctuelle/projet détectée ({cats_str}){merchant_str}."
        else:
            if lang == "en":
                cats_str = ", ".join(sub_cats)
                merchant_str = f" with sample transactions: {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Based on the last {window_months} months ({cats_str}){merchant_str}."
            else:
                cats_str = ", ".join(sub_cats)
                merchant_str = f" avec exemples d'opérations : {', '.join(unique_merchants)}" if unique_merchants else ""
                justification = f"Basé sur les {window_months} derniers mois ({cats_str}){merchant_str}."

        cat_details = {
            c: {
                "amount": cat_amounts[c],
                "top_descs": cat_data[c]["top_descs"],
                "is_fixed": cat_data[c]["is_fixed"],
                "current_month_spent": cat_data[c].get("current_month_spent", 0.0),
                "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0),
            }
            for c in sub_cats
        }

        if suggested_period == "yearly":
            historical_actual_amount = round(sum(cat_data[c]["total_year"] for c in sub_cats), 2)
        else:
            historical_actual_amount = round(sum(cat_data[c]["avg"] for c in sub_cats), 2)

        current_month_spent = round(sum(cat_data[c].get("current_month_spent", 0.0) for c in sub_cats), 2)
        recent_3m_avg = round(sum(cat_data[c].get("recent_3m_avg", 0.0) for c in sub_cats), 2)

        return {
            "name": name,
            "categories": sub_cats,
            "cat_amounts": cat_amounts,
            "cat_details": cat_details,
            "suggested_amount": base_amount,
            "historical_actual_amount": historical_actual_amount,
            "current_month_spent": current_month_spent,
            "recent_3m_avg": recent_3m_avg,
            "suggested_period": suggested_period,
            "is_fixed": is_all_fixed,
            "has_fixed_mix": False,
            "fixed_sum": base_amount if is_all_fixed else 0.0,
            "is_exceptional": all_exceptional,
            "justification": reason_override or justification,
        }

    for obj in parsed_objs:
        if isinstance(obj, dict):
            name = obj.get("name") or obj.get("title") or obj.get("enveloppe") or obj.get("label") or obj.get("nom")
            reason = obj.get("reason") or obj.get("justification") or obj.get("description") or obj.get("motif")
            cats = obj.get("categories") or obj.get("cats") or obj.get("category_list") or obj.get("items") or obj.get("liste") or []
            
            if isinstance(cats, str):
                try:
                    cats = json.loads(cats)
                except Exception:
                    cats = [c.strip().strip('"').strip("'") for c in cats.split(',') if c.strip()]
            
            if not name or not cats or not isinstance(cats, list):
                continue

            resolved_cats = []
            for c in cats:
                real = _resolve_cat_name(c)
                if real and real not in used_in_proposals:
                    resolved_cats.append(real)
            clean_cats = resolved_cats

            if clean_cats:
                clean_name = re.sub(r'\s*\((?:Mensuel|Mensuels|Annuel|Annuels|Monthly|Yearly)\)', '', name, flags=re.IGNORECASE).strip()

                monthly_cats = [c for c in clean_cats if cat_data[c].get("suggested_period", "monthly") == "monthly"]
                yearly_cats = [c for c in clean_cats if cat_data[c].get("suggested_period") == "yearly"]

                if monthly_cats and yearly_cats:
                    used_in_proposals.update(clean_cats)
                    proposals.append(_build_proposal(f"{clean_name}", monthly_cats, reason, period_override="monthly"))
                    proposals.append(_build_proposal(f"{clean_name} (Annuels)", yearly_cats, reason, period_override="yearly"))
                else:
                    used_in_proposals.update(clean_cats)
                    proposals.append(_build_proposal(clean_name, clean_cats, reason))

    orphan_cats = [c for c in cat_data.keys() if c not in used_in_proposals]
    unclassified_categories = []
    for c in orphan_cats:
        unclassified_categories.append({
            "name": c,
            "avg": cat_data[c]["avg"],
            "current_month_spent": cat_data[c].get("current_month_spent", 0.0),
            "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0),
            "total_year": cat_data[c].get("total_year", 0.0),
            "suggested_period": cat_data[c].get("suggested_period", "monthly"),
            "top_descs": cat_data[c].get("top_descs", []),
        })

    is_fallback = False
    if not proposals and cat_data:
        is_fallback = True
        logger.warning("[AI Budget] Le LLM n'a renvoyé aucune enveloppe valide. Création automatique des propositions de secours...")
        # Regrouper par type de dépense (Dépenses fixes, variables, exceptionnelles)
        fixed_cats = [c for c in cat_data if cat_data[c]["is_fixed"] or cat_data[c]["type"] == "expense_fixed"]
        var_cats = [c for c in cat_data if c not in fixed_cats]

        if fixed_cats:
            used_in_proposals.update(fixed_cats)
            proposals.append(_build_proposal("Charges Fixes", fixed_cats, "Charges fixes contractuelles regroupées automatiquement."))
        if var_cats:
            used_in_proposals.update(var_cats)
            proposals.append(_build_proposal("Vie Courante & Varia", var_cats, "Dépenses courantes regroupées automatiquement."))

        orphan_cats = [c for c in cat_data.keys() if c not in used_in_proposals]
        unclassified_categories = []

    if not proposals:
        err_detail = "L'IA n'a pas pu générer de propositions d'enveloppes valides. Vérifiez le modèle Ollama configuré."
        AI_TASK_STATUS["state"] = "ERROR"
        AI_TASK_STATUS["error"] = err_detail
        raise HTTPException(status_code=500, detail=err_detail)

    total_new_fixed_monthly = sum(
        (p["suggested_amount"] / 12.0 if p["suggested_period"] == "yearly" else p["suggested_amount"])
        for p in proposals if p["is_fixed"]
    )
    total_new_var_monthly = sum(
        (p["suggested_amount"] / 12.0 if p["suggested_period"] == "yearly" else p["suggested_amount"])
        for p in proposals if not p["is_fixed"] and not p["is_exceptional"]
    )

    remaining_for_variables = max(0.0, available_monthly_budget - total_new_fixed_monthly)

    is_capped = False
    if total_new_var_monthly > remaining_for_variables and total_new_var_monthly > 0:
        is_capped = True
        raw_ratio = remaining_for_variables / total_new_var_monthly
        effective_ratio = max(0.25, raw_ratio)
        for p in proposals:
            if not p["is_fixed"] and not p["is_exceptional"]:
                p["suggested_amount"] = round(p["suggested_amount"] * effective_ratio, 2)
                for cat in p["cat_amounts"]:
                    p["cat_amounts"][cat] = round(p["cat_amounts"][cat] * effective_ratio, 2)
                adjusted_suffix = " (Adjusted to available salary)" if lang == "en" else " (Ajusté au salaire disponible)"
                p["justification"] += adjusted_suffix

    result_payload = {
        "proposals": proposals,
        "unclassified_categories": unclassified_categories,
        "cat_averages": {c: cat_data[c]["avg"] for c in cat_data},
        "regular_salary": regular_salary,
        "already_engaged_monthly": round(already_engaged_monthly, 2),
        "available_monthly_budget": round(available_monthly_budget, 2),
        "is_capped": is_capped,
        "is_fallback": is_fallback,
        "window_months": effective_window,
        "requested_window_months": window_months,
        "effective_window_months": effective_window,
    }
    AI_TASK_STATUS["state"] = "SUCCESS"
    AI_TASK_STATUS["step_key"] = "ai_status_success"
    AI_TASK_STATUS["result"] = result_payload
    return result_payload

def ai_refine_budgets_service(window_months: int, lang: Optional[str], existing_proposals: list[dict], unclassified_categories: list[dict], db: Session) -> dict:
    if not unclassified_categories:
        return {"proposals": existing_proposals, "unclassified_categories": []}

    cfg = get_ollama_config(db)
    if not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="IA non activée dans les paramètres.")

    existing_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    already_used_cats = set()
    for b in existing_budgets:
        for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all():
            already_used_cats.add(c.category_name)

    latest_past_tx = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).first()
    anchor_date = latest_past_tx.date_operation if latest_past_tx else date.today()

    cat_data = compute_monthly_averages_for_ai(db, set(), anchor_date, window_months=window_months)

    unclassified_names = [item.get("name") if isinstance(item, dict) else item for item in unclassified_categories]
    unclassified_cats = [c for c in unclassified_names if c in cat_data]

    if not unclassified_cats:
        return {"proposals": existing_proposals, "unclassified_categories": []}

    existing_names = [p.get("name") for p in existing_proposals if p.get("name")]
    
    cat_lines = []
    for cat in unclassified_cats:
        info = cat_data[cat]
        period_str = "ANNUAL" if info.get("suggested_period") == "yearly" else "MONTHLY"
        desc_str = f" | Examples: {', '.join(info['top_descs'][:3])}" if info["top_descs"] else ""
        cat_lines.append(f'- Category: "{cat}" | Recurrence: {period_str}{desc_str}')
    formatted_cats = "\n".join(cat_lines)

    existing_env_str = ", ".join(f'"{n}"' for n in existing_names)
    target_lang = "English" if lang == "en" else "French"

    prompt = f"""You are an expert personal financial advisor. Here are {len(unclassified_cats)} unclassified financial categories:

{formatted_cats}

Current budget envelopes: [{existing_env_str}]

TASK: Assign EVERY unclassified category above to the most appropriate existing envelope OR create a new dedicated envelope for it.

LANGUAGE REQUIREMENT:
Write envelope names and reason justifications in {target_lang}.

Response format (JSON object with key "envelopes"):
{{
  "envelopes": [
    {{"name": "Existing or New Envelope Name in {target_lang}", "categories": ["ExactCatName1"], "reason": "Justification in {target_lang}"}},
    ...
  ]
}}"""

    raw = ""
    try:
        raw = call_ollama_sync(prompt, cfg, extra_options={"num_predict": 1500, "format": "json"})
    except Exception as e:
        logger.warning(f"[AI Refine] Essai 1 Ollama json échoué: {e}")

    if not raw or not raw.strip():
        try:
            raw = call_ollama_sync(prompt, cfg, extra_options={"num_predict": 1500})
        except Exception as e:
            logger.warning(f"[AI Refine] Essai 2 Ollama échoué: {e}")

    if not raw or not raw.strip():
        return {"proposals": existing_proposals, "unclassified_categories": unclassified_categories}

    cleaned_raw = re.sub(r'```(?:json)?', '', raw).strip()
    parsed_objs = extract_json_envelopes(cleaned_raw)

    updated_proposals = list(existing_proposals)
    placed_cats = set()

    for obj in parsed_objs:
        if isinstance(obj, dict):
            name = obj.get("name") or obj.get("title") or obj.get("enveloppe")
            cats = obj.get("categories") or obj.get("cats") or []
            if isinstance(cats, str):
                cats = [c.strip().strip('"').strip("'") for c in cats.split(',') if c.strip()]
            if not name or not cats or not isinstance(cats, list):
                continue

            valid_cats = [c for c in cats if c in cat_data and c not in placed_cats]
            if not valid_cats:
                continue

            matched_prop = None
            for p in updated_proposals:
                if (p.get("name") or "").strip().lower() == name.strip().lower():
                    matched_prop = p
                    break

            if matched_prop:
                if "categories" not in matched_prop or matched_prop["categories"] is None:
                    matched_prop["categories"] = []
                matched_prop["categories"].extend(valid_cats)
                sub_cats = list(dict.fromkeys(matched_prop["categories"]))
                matched_prop["categories"] = sub_cats

                if "cat_details" not in matched_prop or matched_prop["cat_details"] is None:
                    matched_prop["cat_details"] = {}
                if "cat_amounts" not in matched_prop or matched_prop["cat_amounts"] is None:
                    matched_prop["cat_amounts"] = {}

                for c in valid_cats:
                    c_period = cat_data[c].get("suggested_period", "monthly")
                    c_val = cat_data[c]["avg"] if c_period == "monthly" else round(cat_data[c]["total_year"] / 12.0, 2)
                    matched_prop["cat_amounts"][c] = c_val
                    matched_prop["cat_details"][c] = {
                        "amount": c_val,
                        "top_descs": cat_data[c].get("top_descs", []),
                        "is_fixed": cat_data[c].get("is_fixed", False),
                        "current_month_spent": cat_data[c].get("current_month_spent", 0.0),
                        "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0),
                    }
                matched_prop["suggested_amount"] = round(sum(matched_prop["cat_amounts"].values()), 2)
                matched_prop["current_month_spent"] = round(sum(cat_data[c].get("current_month_spent", 0.0) for c in sub_cats if c in cat_data), 2)
                matched_prop["recent_3m_avg"] = round(sum(cat_data[c].get("recent_3m_avg", 0.0) for c in sub_cats if c in cat_data), 2)
                matched_prop["historical_actual_amount"] = round(sum(cat_data[c].get("avg", 0.0) if matched_prop.get("suggested_period") != "yearly" else cat_data[c].get("total_year", 0.0) for c in sub_cats if c in cat_data), 2)
                if not matched_prop.get("justification"):
                    reason_val = obj.get("reason") or obj.get("justification")
                    matched_prop["justification"] = reason_val if reason_val else f"Affinage IA (+{', '.join(valid_cats)})."
            else:
                cat_amounts = {}
                for c in valid_cats:
                    c_period = cat_data[c].get("suggested_period", "monthly")
                    cat_amounts[c] = cat_data[c]["avg"] if c_period == "monthly" else round(cat_data[c]["total_year"] / 12.0, 2)
                base_amount = round(sum(cat_amounts.values()), 2)
                new_justif = obj.get("reason") or obj.get("justification") or f"Enveloppe d'affinage IA ({', '.join(valid_cats)})."
                updated_proposals.append({
                    "name": name,
                    "categories": valid_cats,
                    "cat_amounts": cat_amounts,
                    "cat_details": {c: {"amount": cat_amounts[c], "top_descs": cat_data[c].get("top_descs", []), "is_fixed": cat_data[c].get("is_fixed", False), "current_month_spent": cat_data[c].get("current_month_spent", 0.0), "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0)} for c in valid_cats},
                    "suggested_amount": base_amount,
                    "historical_actual_amount": base_amount,
                    "current_month_spent": round(sum(cat_data[c].get("current_month_spent", 0.0) for c in valid_cats), 2),
                    "recent_3m_avg": round(sum(cat_data[c].get("recent_3m_avg", 0.0) for c in valid_cats), 2),
                    "suggested_period": "monthly",
                    "is_fixed": False,
                    "has_fixed_mix": False,
                    "fixed_sum": 0.0,
                    "is_exceptional": False,
                    "justification": new_justif,
                })
            placed_cats.update(valid_cats)

    remaining_unclassified = [
        {
            "name": c,
            "avg": cat_data[c]["avg"],
            "current_month_spent": cat_data[c].get("current_month_spent", 0.0),
            "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0),
            "total_year": cat_data[c].get("total_year", 0.0),
            "suggested_period": cat_data[c].get("suggested_period", "monthly"),
            "top_descs": cat_data[c].get("top_descs", []),
        }
        for c in unclassified_cats if c not in placed_cats
    ]

    return {
        "proposals": updated_proposals,
        "unclassified_categories": remaining_unclassified,
    }
