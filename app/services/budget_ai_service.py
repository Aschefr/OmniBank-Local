import math
from typing import Optional, List, Dict, Any
from datetime import date
import json
import logging
import re
import threading
import time
import unicodedata
from difflib import SequenceMatcher
from collections import defaultdict
import statistics
from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session
from sqlalchemy import or_
from fastapi import HTTPException

from app.models import Budget, BudgetCategory, Transaction, Category, RecurrenceTemplate, GlobalConfig
from app.services.chat.ollama_client import get_ollama_config, call_ollama_sync, call_ollama_async, strip_thinking
from app.services.finance_engine import predict_next_paycheck

import asyncio

logger = logging.getLogger(__name__)

def _smart_round(amount: float) -> float:
    """Arrondi psychologique au multiple de 5€ supérieur, min 5€."""
    if amount <= 0:
        return 0.0
    rounded = math.ceil(amount / 5.0) * 5.0
    return max(5.0, float(rounded))


# ── Thread-safety pour AI_TASK_STATUS par profil ────────────────────────────
_ai_status_lock = threading.Lock()
_ACTIVE_AI_TASKS: Dict[str, asyncio.Task] = {}
_AI_CANCEL_REQUESTED: Dict[str, bool] = {}

def _resolve_profile_id(profile_id: Optional[str] = None) -> str:
    if profile_id:
        return profile_id
    try:
        from app.profile_manager import get_active_profile
        return get_active_profile()["id"]
    except Exception:
        return "default"

def _get_default_status() -> Dict[str, Any]:
    return {
        "state": "IDLE",
        "step_key": "ai_status_preparing",
        "elapsed_seconds": 0,
        "max_seconds": 300,
        "result": None,
        "error": None,
        "start_time": None,
    }

_AI_TASK_STATUSES: Dict[str, Dict[str, Any]] = {}

def _update_ai_status(profile_id: Optional[str] = None, **kwargs) -> None:
    """Mise à jour thread-safe du statut de la tâche IA pour un profil donné."""
    pid = _resolve_profile_id(profile_id)
    with _ai_status_lock:
        if pid not in _AI_TASK_STATUSES:
            _AI_TASK_STATUSES[pid] = _get_default_status()
        _AI_TASK_STATUSES[pid].update(kwargs)

def _get_ai_status_snapshot(profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Retourne un snapshot thread-safe du statut courant pour un profil donné."""
    pid = _resolve_profile_id(profile_id)
    with _ai_status_lock:
        if pid not in _AI_TASK_STATUSES:
            _AI_TASK_STATUSES[pid] = _get_default_status()
        st = _AI_TASK_STATUSES[pid]
        if st["state"] in ["PREPARING", "SENDING", "THINKING", "PARSING"] and st.get("start_time"):
            elapsed = int(time.time() - st["start_time"])
            st["elapsed_seconds"] = elapsed
            if elapsed > st.get("max_seconds", 300):
                st["state"] = "ERROR"
                st["error"] = "Délai d'analyse dépassé."
        return dict(st)

def get_ai_suggest_status(profile_id: Optional[str] = None) -> Dict[str, Any]:
    return _get_ai_status_snapshot(profile_id)

def is_ai_suggest_cancelled(profile_id: Optional[str] = None) -> bool:
    pid = _resolve_profile_id(profile_id)
    with _ai_status_lock:
        return _AI_CANCEL_REQUESTED.get(pid, False)

def cancel_ai_suggest(profile_id: Optional[str] = None) -> Dict[str, Any]:
    pid = _resolve_profile_id(profile_id)
    with _ai_status_lock:
        _AI_CANCEL_REQUESTED[pid] = True
    _update_ai_status(
        profile_id=pid,
        state="IDLE",
        step_key="ai_status_idle",
        elapsed_seconds=0,
        start_time=None,
        error=None,
    )
    task = _ACTIVE_AI_TASKS.pop(pid, None)
    if task and not task.done():
        logger.info(f"[AI Budget] Annulation immédiate de la coroutine asyncio pour le profil {pid}")
        try:
            task.cancel()
        except Exception as e:
            logger.warning(f"[AI Budget] Erreur lors de l'annulation de la tâche : {e}")
    return {"status": "cancelled"}

def compute_monthly_averages_for_ai(db: Session, already_used_cats: set, anchor_date: date, window_months: int = 3, outlier_sensitivity: int = 2) -> dict:
    window_start = anchor_date - relativedelta(months=window_months)
    start_of_year = date(anchor_date.year, 1, 1)
    query_start = min(window_start, start_of_year)
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
        Transaction.date_operation >= query_start,
        Transaction.date_operation <= end_of_current_month,
        Transaction.type.in_(["expense", "expense_fixed", "expense_var", "Dépenses fixes", "Dépenses variables"])
    ).all()

    cat_monthly: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cat_type: dict[str, str] = {}
    cat_descriptions: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    cat_amounts_list: dict[str, list[float]] = defaultdict(list)
    cat_tx_list: dict[str, list[tuple[str, float, str]]] = defaultdict(list)
    cat_ytd: dict[str, float] = defaultdict(float)

    for tx in txs:
        if tx.type in ["income", "transfer", "neutral", "Recettes", "Transfert", "Neutre"] or (tx.from_account_id and tx.to_account_id):
            continue

        cat = tx.category or "Sans catégorie"
        if cat in already_used_cats or cat in non_expense_or_closed_cats:
            continue

        amt = abs(tx.amount)
        if tx.date_operation.year == anchor_date.year:
            cat_ytd[cat] += amt

        # Seules les transactions dans la fenêtre temporelle comptent pour la moyenne et les centiles
        if tx.date_operation >= window_start:
            month_key = tx.date_operation.strftime("%Y-%m")
            cat_monthly[cat][month_key] += amt
            cat_amounts_list[cat].append(amt)
            desc = (tx.description or "").strip()
            cat_tx_list[cat].append((month_key, amt, desc))
            cat_type[cat] = tx.type

            if desc:
                cat_descriptions[cat][desc] += 1
        elif cat not in cat_type:
            cat_type[cat] = tx.type

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
    all_all_cats = (db_expense_cats | tx_expense_cats | set(cat_ytd.keys())) - already_used_cats - non_expense_or_closed_cats

    if not cat_monthly and not all_all_cats:
        return {}

    all_cat_totals = [sum(m.values()) / max(len(m), 1) for m in cat_monthly.values()]
    median_cat_avg = statistics.median(all_cat_totals) if all_cat_totals else 100.0

    # Facteur et plancher dynamique d'écrêtage (Sensitivity 1 à 5)
    # 1: Strict (1.5x, min 30€)
    # 2: Prudent / Défaut (2.0x, min 60€)
    # 3: Équilibré (3.0x, min 120€)
    # 4: Permissif (4.5x, min 250€)
    # 5: Intégral (Pas d'écrêtage)
    sensitivity_map = {
        1: (1.5, 30.0),
        2: (2.0, 60.0),
        3: (3.0, 120.0),
        4: (4.5, 250.0),
        5: (999999.0, 999999999.0)
    }
    mult_factor, min_thresh = sensitivity_map.get(outlier_sensitivity, (2.0, 60.0))

    result = {}
    for cat, monthly_sums in cat_monthly.items():
        tx_list = cat_tx_list.get(cat, [])
        raw_amounts = [amt for _, amt, _ in tx_list]
        cat_median = statistics.median(raw_amounts) if raw_amounts else 0.0

        regular_amounts = []
        outlier_amounts = []
        outlier_excess = 0.0
        clipped_monthly: dict[str, float] = defaultdict(float)

        threshold = max(mult_factor * cat_median, min_thresh) if cat_median > 0 else min_thresh

        for m_key, amt, _ in tx_list:
            if cat_median > 0 and amt > threshold and outlier_sensitivity < 5:
                # Écrêtage (Winsorizing) : On conserve le plafond normal et on isole le surplus
                clipped_amt = threshold
                regular_amounts.append(threshold)
                outlier_amounts.append(amt)
                outlier_excess += (amt - threshold)
            else:
                clipped_amt = amt
                regular_amounts.append(amt)
            clipped_monthly[m_key] += clipped_amt

        recurring_total = sum(regular_amounts) if regular_amounts else sum(raw_amounts)
        total = sum(monthly_sums.values())
        active_months_cnt = len(monthly_sums)

        avg = round(recurring_total / max(window_months, 1), 2)
        desc_counts = cat_descriptions.get(cat, {})
        top_descs = [d for d, _ in sorted(desc_counts.items(), key=lambda x: -x[1])[:5]]
        
        # P75 calculé sur les sommes mensuelles écrêtées pour que l'écrêtage s'applique réellement
        monthly_values = list(clipped_monthly.values()) if clipped_monthly else [0.0]
        if len(monthly_values) >= 3:
            sorted_vals = sorted(monthly_values)
            idx_75 = int(len(sorted_vals) * 0.75)
            p75 = round(sorted_vals[min(idx_75, len(sorted_vals) - 1)], 2)
        else:
            p75 = round(max(monthly_values) if monthly_values else 0.0, 2)
        p75 = max(p75, avg)

        # Calcul de la projection mensuelle selon le niveau de sensibilité
        # 1 (Strict) : 100% avg (écrêtée)
        # 2 (Prudent) : 70% avg + 30% p75
        # 3 (Équilibré) : 40% avg + 60% p75
        # 4 (Permissif) : 15% avg + 85% p75
        # 5 (Intégral) : max(p75, recent_3m_avg) (sans écrêtage)
        if outlier_sensitivity == 1:
            sens_monthly_var = avg
        elif outlier_sensitivity == 2:
            sens_monthly_var = round(0.70 * avg + 0.30 * p75, 2)
        elif outlier_sensitivity == 3:
            sens_monthly_var = round(0.40 * avg + 0.60 * p75, 2)
        elif outlier_sensitivity == 4:
            sens_monthly_var = round(0.15 * avg + 0.85 * p75, 2)
        else:
            sens_monthly_var = max(avg, p75, recent_3m_avg if 'recent_3m_avg' in locals() else avg)

        is_fixed = (cat_type.get(cat) == "expense_fixed")
        fixed_amount = round(total / max(active_months_cnt, 1), 2)

        # Mapper les récurrences actives pour cette catégorie
        cat_rec_templates = [t for t in recurrence_templates if t.category == cat and getattr(t, 'is_active', True) != False]

        if is_fixed and monthly_values:
            sorted_months = sorted(monthly_sums.keys(), reverse=True)
            most_recent_month = sorted_months[0]
            fixed_amount = round(monthly_sums[most_recent_month], 2)
        elif cat_rec_templates:
            # Si un modèle de récurrence actif est configuré pour le futur, la catégorie est considérée fixe
            is_fixed = True
            rec_amt = sum(abs(t.amount or 0.0) for t in cat_rec_templates)
            fixed_amount = round(rec_amt, 2)
        elif len(raw_amounts) >= 2:
            if len(set(raw_amounts)) == 1:
                is_fixed = True
                fixed_amount = round(raw_amounts[0], 2)

        is_exceptional = bool(outlier_amounts) or ((avg > (2.0 * median_cat_avg)) and (active_months_cnt <= 2) and (cat_type.get(cat) == "expense_var"))

        if cat in yearly_recurrence_cats:
            suggested_period = "yearly"
        else:
            if is_exceptional:
                suggested_period = "yearly"
            elif is_fixed and active_months_cnt == 1 and window_months >= 6:
                suggested_period = "yearly"
            else:
                suggested_period = "monthly"

        # Calcul de la projection annuelle réelle (12 mois)
        monthly_base = fixed_amount if is_fixed else sens_monthly_var
        annual_projection = round(monthly_base * 12.0, 2)
        if cat in yearly_recurrence_cats and yearly_recurrence_sums.get(cat, 0.0) > 0:
            annual_projection = max(annual_projection, round(yearly_recurrence_sums[cat], 2))

        c_ytd_spent = cat_ytd.get(cat, 0.0)
        if outlier_sensitivity < 5 and outlier_excess > 0:
            c_ytd_spent = max(0.0, c_ytd_spent - outlier_excess)

        if c_ytd_spent > 0 and outlier_sensitivity >= 3:
            annual_projection = max(annual_projection, round(c_ytd_spent, 2))
            if anchor_date.month > 0:
                annual_projection = max(annual_projection, round(c_ytd_spent * 12.0 / anchor_date.month, 2))
        total_year_val = annual_projection

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
            sum_recent = sum(clipped_monthly.get(k, 0.0) for k in recent_calendar_months)
            recent_3m_avg = round(sum_recent / max(len(recent_calendar_months), 1), 2)

        final_avg = fixed_amount if is_fixed else avg
        if final_avg == 0.0 and cat in yearly_recurrence_sums:
            rec_sum = yearly_recurrence_sums[cat]
            final_avg = round(rec_sum / 12.0, 2)

        result[cat] = {
            "avg": final_avg,
            "sens_monthly_var": sens_monthly_var,
            "monthly_base": monthly_base,
            "current_month_spent": current_month_spent,
            "recent_3m_avg": recent_3m_avg if recent_3m_avg > 0 else final_avg,
            "total_year": total_year_val if total_year_val > 0 else (final_avg * 12.0),
            "ytd_spent": round(c_ytd_spent, 2),
            "p75": p75,
            "active_months_cnt": active_months_cnt,
            "suggested_period": suggested_period,
            "type": cat_type.get(cat, "expense_var"),
            "top_descs": top_descs,
            "is_fixed": is_fixed,
            "fixed_amount": fixed_amount,
            "is_exceptional": is_exceptional,
            "outlier_excess": round(outlier_excess, 2),
            "outlier_amounts": outlier_amounts,
        }

    all_recurrence_sums = defaultdict(float)
    all_recurrence_periods = {}
    for t in recurrence_templates:
        if t.category:
            amt = abs(t.amount or 0.0)
            freq = (t.frequency or "monthly").lower()
            if freq in ("yearly", "annuel", "bi-annuel", "semi-annually") or t.month_of_year is not None:
                all_recurrence_sums[t.category] += (amt / 12.0 if freq in ("yearly", "annuel") else amt / 6.0)
                all_recurrence_periods[t.category] = "yearly"
            else:
                all_recurrence_sums[t.category] += amt
                all_recurrence_periods[t.category] = "monthly"

    for cat in all_all_cats:
        if cat not in result:
            rec_monthly = round(all_recurrence_sums.get(cat, 0.0), 2)
            suggested_p = all_recurrence_periods.get(cat, "monthly")
            cat_ytd_val = round(cat_ytd.get(cat, 0.0), 2)
            if cat_ytd_val > 0 and suggested_p == "monthly":
                suggested_p = "yearly"
            result[cat] = {
                "avg": rec_monthly,
                "current_month_spent": 0.0,
                "recent_3m_avg": rec_monthly,
                "total_year": cat_ytd_val if cat_ytd_val > 0 else (rec_monthly * 12.0),
                "ytd_spent": cat_ytd_val,
                "p75": rec_monthly,
                "active_months_cnt": 0,
                "suggested_period": suggested_p,
                "type": cat_type.get(cat, "expense_var"),
                "top_descs": [],
                "is_fixed": (cat_type.get(cat) == "expense_fixed"),
                "fixed_amount": 0.0,
                "is_exceptional": False,
                "outlier_excess": 0.0,
                "outlier_amounts": [],
            }

    return result

def extract_json_envelopes(raw_text: str) -> list[dict]:
    """
    Extrait les propositions d'enveloppes d'une réponse LLM de manière ultra-résiliente.
    Prend en charge :
    - Les sorties JSON standard (format {"envelopes": [...]} ou [...])
    - La suppression transparente des balises et phases de réflexion (<think>...</think>, <thought>, <reasoning>)
    - La réparation automatique (auto-healing) de JSON tronqué en fin de flux par clôture chirurgicale
    - L'extraction par machine d'états hiérarchique des dictionnaires d'enveloppes complets résiduels
    """
    if not raw_text or not raw_text.strip():
        return []

    # 1. Nettoyage transparent des phases de réflexion des modèles de raisonnement
    cleaned = strip_thinking(raw_text)
    # Nettoyage des clôtures markdown ```json ... ```
    cleaned = re.sub(r'```(?:json)?', '', cleaned).strip()

    def _extract_from_data(data) -> list[dict]:
        objs = []
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    if "name" in item or "title" in item or "enveloppe" in item or "nom" in item:
                        objs.append(item)
                    elif len(item) == 1:
                        k, v = next(iter(item.items()))
                        if isinstance(v, list):
                            objs.append({"name": k, "categories": v})
        elif isinstance(data, dict):
            for key in ["envelopes", "proposals", "enveloppes", "budgets", "categories", "suggestions", "items", "data", "result", "enveloppes_budgetaires", "propositions"]:
                if key in data and isinstance(data[key], list):
                    for item in data[key]:
                        if isinstance(item, dict):
                            if "name" in item or "title" in item or "enveloppe" in item or "nom" in item:
                                objs.append(item)
                            elif len(item) == 1:
                                k, v = next(iter(item.items()))
                                if isinstance(v, list):
                                    objs.append({"name": k, "categories": v})
                    if objs:
                        break
            if not objs:
                for k, v in data.items():
                    if isinstance(v, list) and len(v) > 0:
                        if isinstance(v[0], str):
                            objs.append({"name": k, "categories": v})
                        elif isinstance(v[0], dict):
                            objs.extend(v)
        return objs

    # Étape 1 : Passage rapide (JSON valide complet)
    try:
        data_json = json.loads(cleaned)
        parsed_objs = _extract_from_data(data_json)
        if parsed_objs:
            return parsed_objs
    except Exception as err:
        logger.debug(f"[AI Budget] json.loads direct a échoué ({err}), passage au mode auto-healing...")

    # Étape 2 : Auto-healing par clôture chirurgicale du flux tronqué
    # Tente de refermer la structure JSON au dernier délimiteur '}' complet
    for closer in ["]}", "]", "}"]:
        last_brace = cleaned.rfind('}')
        attempts = 0
        while last_brace > 0 and attempts < 30:
            candidate = cleaned[:last_brace + 1] + closer
            try:
                data = json.loads(candidate)
                objs = _extract_from_data(data)
                if objs:
                    logger.info(f"[AI Budget Auto-Heal] JSON tronqué réparé avec succès : {len(objs)} enveloppes complètes récupérées.")
                    return objs
            except Exception:
                last_brace = cleaned.rfind('}', 0, last_brace)
                attempts += 1

    # Étape 3 : Machine d'états hiérarchique pour extraire les objets {...} complets
    parsed_objs = []
    seen_names = set()
    in_string = False
    escape = False
    depth = 0
    start_indices = {}

    for idx, ch in enumerate(cleaned):
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue

        if ch == '{':
            start_indices[depth] = idx
            depth += 1
        elif ch == '}':
            if depth > 0:
                depth -= 1
                if depth in start_indices:
                    chunk = cleaned[start_indices[depth]:idx + 1]
                    try:
                        item = json.loads(chunk)
                        if isinstance(item, dict):
                            if "name" in item or "title" in item or "enveloppe" in item or "nom" in item:
                                n = (item.get("name") or item.get("title") or item.get("nom") or "").strip().lower()
                                if n and n not in seen_names:
                                    seen_names.add(n)
                                    parsed_objs.append(item)
                            elif "envelopes" in item and isinstance(item["envelopes"], list):
                                for sub in item["envelopes"]:
                                    if isinstance(sub, dict) and ("name" in sub or "title" in sub or "nom" in sub):
                                        n = (sub.get("name") or sub.get("title") or sub.get("nom") or "").strip().lower()
                                        if n and n not in seen_names:
                                            seen_names.add(n)
                                            parsed_objs.append(sub)
                    except Exception:
                        pass

    if parsed_objs:
        logger.info(f"[AI Budget Auto-Heal] Extraction par machine d'états : {len(parsed_objs)} enveloppes complètes extraites.")

    return parsed_objs

async def ai_suggest_budgets_service(
    window_months: int,
    lang: Optional[str],
    db: Session,
    outlier_sensitivity: int = 2,
    profile_id: Optional[str] = None,
    engine: Optional[str] = None
) -> dict:
    pid = _resolve_profile_id(profile_id)
    with _ai_status_lock:
        _AI_CANCEL_REQUESTED[pid] = False

    curr_task = asyncio.current_task()
    if curr_task:
        _ACTIVE_AI_TASKS[pid] = curr_task

    cfg_engine = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_suggestion_engine").first()
    configured_engine = (cfg_engine.value if cfg_engine and cfg_engine.value else "deterministic").strip().lower()
    chosen_engine = (engine or configured_engine).strip().lower()
    is_deterministic_engine = (chosen_engine == "deterministic")

    if not is_deterministic_engine:
        _update_ai_status(
            profile_id=pid,
            state="PREPARING",
            step_key="ai_status_preparing",
            elapsed_seconds=0,
            max_seconds=300,
            result=None,
            error=None,
            start_time=time.time(),
        )
    try:
        res = await _ai_suggest_budgets_service_impl(
            window_months, lang, db, outlier_sensitivity, profile_id=pid, engine=chosen_engine
        )
        if is_ai_suggest_cancelled(pid):
            raise asyncio.CancelledError()

        if not is_deterministic_engine:
            _update_ai_status(profile_id=pid, state="SUCCESS", step_key="ai_status_success", result=res)
        return res
    except asyncio.CancelledError:
        logger.info(f"[AI Budget] Tâche IA annulée avec succès pour le profil {pid}")
        _update_ai_status(profile_id=pid, state="IDLE", step_key="ai_status_idle", error=None)
        raise HTTPException(status_code=499, detail="Analyse annulée par l'utilisateur.")
    except HTTPException as he:
        if not is_deterministic_engine and not is_ai_suggest_cancelled(pid):
            _update_ai_status(profile_id=pid, state="ERROR", error=he.detail if hasattr(he, "detail") else str(he))
        raise
    except Exception as e:
        if is_ai_suggest_cancelled(pid):
            _update_ai_status(profile_id=pid, state="IDLE", step_key="ai_status_idle", error=None)
            raise HTTPException(status_code=499, detail="Analyse annulée par l'utilisateur.")
        logger.error(f"[AI Budget] Erreur inattendue dans ai_suggest_budgets_service: {e}", exc_info=True)
        if not is_deterministic_engine:
            _update_ai_status(profile_id=pid, state="ERROR", error=str(e))
        raise HTTPException(status_code=500, detail=f"Erreur d'analyse : {str(e)}")
    finally:
        _ACTIVE_AI_TASKS.pop(pid, None)

async def _ai_suggest_budgets_service_impl(
    window_months: int,
    lang: Optional[str],
    db: Session,
    outlier_sensitivity: int = 2,
    profile_id: Optional[str] = None,
    engine: Optional[str] = None
) -> dict:
    pid = _resolve_profile_id(profile_id)
    window_months = window_months if window_months in (3, 6, 12) else 3

    cfg_engine = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_suggestion_engine").first()
    configured_engine = (cfg_engine.value if cfg_engine and cfg_engine.value else "deterministic").strip().lower()
    chosen_engine = (engine or configured_engine).strip().lower()
    is_deterministic_engine = (chosen_engine == "deterministic")

    cfg = get_ollama_config(db)
    if not is_deterministic_engine and not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="IA non activée dans les paramètres.")

    paycheck_info = predict_next_paycheck(db)
    regular_salary = paycheck_info.get("amount", 0.0) if paycheck_info else 0.0
    if regular_salary <= 0.0:
        from app.services.budget_service import get_budget_capacity_data
        cap_data = get_budget_capacity_data(db)
        regular_salary = (cap_data.get("monthly", {}).get("average_income", 0.0) if cap_data else 0.0) or 0.0

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

    cat_data = compute_monthly_averages_for_ai(db, already_used_cats, anchor_date, window_months=window_months, outlier_sensitivity=outlier_sensitivity)

    active_cats = [c for c, info in cat_data.items() if info.get("avg", 0) > 0 or info.get("total_year", 0) > 0]
    effective_window = window_months
    if len(active_cats) == 0 and window_months < 12:
        for try_w in (6, 12):
            if try_w > window_months:
                try_data = compute_monthly_averages_for_ai(db, already_used_cats, anchor_date, window_months=try_w, outlier_sensitivity=outlier_sensitivity)
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

TASK: Group these {nb_cats} categories into cohesive, thematic budget envelopes (aim for 4 to 8 high-quality envelopes, grouping 2 to 4 related categories together whenever logical, such as Food & Groceries, Transport & Fuel, Housing, Health & Wellness, Leisure & Entertainment, Tech).

RULES:
1. Create cohesive envelopes by grouping related categories together. Do not isolate each category into its own envelope unless it is truly unique.
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

    if not is_deterministic_engine:
        _update_ai_status(profile_id=pid, state="SENDING", step_key="ai_status_sending")

    raw = ""
    last_error_msg = ""
    is_fallback = False

    if is_deterministic_engine:
        logger.info("[AI Budget] Moteur déterministe sélectionné. Contournement d'Ollama et regroupement thématique déterministe immédiat.")
        is_fallback = True
    else:
        # Respecter scrupuleusement le paramètre de contexte configuré par l'utilisateur !
        cfg_ctx_raw = cfg.get("num_ctx")
        try:
            ollama_ctx = int(cfg_ctx_raw) if cfg_ctx_raw else 8192
            if ollama_ctx < 4096:
                ollama_ctx = 4096
        except (ValueError, TypeError):
            ollama_ctx = 8192

        # Définir un num_predict généreux (au moins 4096 tokens) pour garantir que le JSON ne sera jamais tronqué
        ollama_num_predict = min(8192, max(4096, ollama_ctx // 4))

        if is_ai_suggest_cancelled(pid):
            raise asyncio.CancelledError()

        # Tentative 1 : Appel Ollama standard (sans contrainte grammaticale rigide)
        # Permet aux modèles de raisonnement (thinking models) de dérouler leur réflexion naturellement
        # sans que le parser de grammaire Ollama ne supprime les tokens ou ne renvoie une chaîne vide.
        try:
            raw = await call_ollama_async(prompt, cfg, extra_options={
                "num_ctx": ollama_ctx,
                "num_predict": ollama_num_predict
            })
        except HTTPException as e:
            last_error_msg = e.detail
            logger.warning(f"[AI Budget] Premier essai Ollama standard échoué: {e.detail}")
        except Exception as e:
            last_error_msg = str(e)
            logger.warning(f"[AI Budget] Premier essai Ollama standard échoué: {e}")

        if is_ai_suggest_cancelled(pid):
            raise asyncio.CancelledError()

        # Si le premier essai n'a rien renvoyé ou si aucun JSON n'a pu en être extrait, tentative 2 avec format="json"
        parsed_test = extract_json_envelopes(raw or "") if (raw and raw.strip()) else []
        if not parsed_test:
            try:
                logger.info("[AI Budget] Tentative 2 avec format='json' strict...")
                raw = await call_ollama_async(prompt, cfg, extra_options={
                    "format": "json",
                    "num_ctx": ollama_ctx,
                    "num_predict": ollama_num_predict
                })
            except HTTPException as e2:
                last_error_msg = e2.detail
                logger.warning(f"[AI Budget] Tentative 2 Ollama format=json échouée: {e2.detail}")
            except Exception as e2:
                last_error_msg = str(e2)
                logger.warning(f"[AI Budget] Tentative 2 Ollama format=json échouée: {e2}")

        if is_ai_suggest_cancelled(pid):
            raise asyncio.CancelledError()

        if not raw or not raw.strip():
            logger.warning(f"[AI Budget] Communication Ollama impossible ({last_error_msg}). Bascule automatique sur les propositions déterministes de secours.")
            is_fallback = True

    if not is_deterministic_engine:
        _update_ai_status(profile_id=pid, state="PARSING", step_key="ai_status_parsing")

    parsed_objs = extract_json_envelopes(raw or "") if (raw and raw.strip()) else []

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
            c_var_val = cat_data[c].get("sens_monthly_var", cat_data[c]["avg"])
            c_monthly = c_fixed_val if c_is_fixed else c_var_val
            c_tot_yr = cat_data[c]["total_year"]

            # Assurer que le montant annuel est bien un budget 12 mois (>= 12x mensuel et >= YTD)
            c_ytd = cat_data[c].get("ytd_spent", 0.0)
            c_yearly = max(c_tot_yr, round(c_monthly * 12.0, 2))
            if outlier_sensitivity >= 3 and c_ytd > 0:
                c_yearly = max(c_yearly, c_ytd)
                if anchor_date.month > 0:
                    c_yearly = max(c_yearly, round(c_ytd * 12.0 / anchor_date.month, 2))

            if suggested_period == "yearly":
                val = c_yearly
            else:
                val = c_monthly
            
            cat_amounts[c] = val

        # Plancher "Mois en cours" pour les enveloppes mensuelles
        if suggested_period == "monthly":
            for c in sub_cats:
                c_current_spent = cat_data[c].get("current_month_spent", 0.0)
                if outlier_sensitivity >= 2:
                    if c_current_spent > cat_amounts[c]:
                        cat_amounts[c] = c_current_spent
                else:
                    if c_current_spent > cat_amounts[c] and c_current_spent <= cat_data[c].get("p75", cat_amounts[c]):
                        cat_amounts[c] = c_current_spent

        # Protection YTD proportionnelle au calendrier pour les enveloppes annuelles
        if suggested_period == "yearly" and outlier_sensitivity >= 3:
            current_month_num = anchor_date.month
            for c in sub_cats:
                c_ytd = cat_data[c].get("ytd_spent", 0.0)
                if current_month_num > 0 and c_ytd > 0:
                    annualized_c = round(c_ytd * 12.0 / current_month_num, 2)
                    target_c = max(cat_amounts[c], c_ytd, annualized_c)
                    cat_amounts[c] = target_c

        raw_sum = round(sum(cat_amounts.values()), 2)
        base_amount = _smart_round(raw_sum)

        # Ajuster proportionnellement cat_amounts pour correspondre exactement à base_amount
        if raw_sum > 0 and base_amount > raw_sum:
            ratio = base_amount / raw_sum
            for c in sub_cats:
                cat_amounts[c] = round(cat_amounts[c] * ratio, 2)
            diff = round(base_amount - sum(cat_amounts.values()), 2)
            if diff != 0 and sub_cats:
                largest_c = max(sub_cats, key=lambda c: cat_amounts[c])
                cat_amounts[largest_c] = round(cat_amounts[largest_c] + diff, 2)
        elif not sub_cats:
            base_amount = 0.0
        elif len(sub_cats) == 1:
            cat_amounts[sub_cats[0]] = base_amount

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

        historical_actual_amount = raw_sum
        current_month_spent = round(sum(cat_data[c].get("current_month_spent", 0.0) for c in sub_cats), 2)
        recent_3m_avg = round(sum(cat_data[c].get("recent_3m_avg", 0.0) for c in sub_cats), 2)

        fixed_cats_in_envelope = [c for c in sub_cats if cat_data[c].get("is_fixed") or cat_data[c].get("type") == "expense_fixed"]
        fixed_sum_val = round(sum(cat_amounts[c] for c in fixed_cats_in_envelope), 2)
        has_fixed_mix_val = bool(fixed_cats_in_envelope) and len(fixed_cats_in_envelope) < len(sub_cats)

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
            "has_fixed_mix": has_fixed_mix_val,
            "fixed_sum": base_amount if is_all_fixed else fixed_sum_val,
            "fixed_cats": fixed_cats_in_envelope,
            "is_exceptional": all_exceptional,
            "justification": reason_override or justification,
        }

    active_avgs = [d["avg"] for d in cat_data.values() if isinstance(d, dict) and d.get("avg", 0) > 0]
    median_cat_avg = statistics.median(active_avgs) if active_avgs else 100.0

    def _clean_for_match(s: str) -> str:
        if not s:
            return ""
        s = unicodedata.normalize('NFKD', s).encode('ASCII', 'ignore').decode('utf-8')
        return s.lower()

    def _matches_keyword(text_clean: str, kw: str) -> bool:
        if len(kw) <= 3:
            return bool(re.search(r'\b' + re.escape(kw) + r'\b', text_clean))
        return kw in text_clean

    def _is_exceptional_or_project(cat_name: str) -> bool:
        c_info = cat_data.get(cat_name, {})
        c_clean = _clean_for_match(cat_name)
        
        # 1. Mots-clés explicites de projets exceptionnels, travaux, rénovation, caution, apport
        if re.search(r'\b(exceptionnel|gros montant|projet|caution|apport|one[- ]?off|ponctuel|travaux|renovation|reno)\b', c_clean):
            return True
            
        # 2. Dépense hors-norme avec faible récurrence (<= 2 mois d'activité et moyenne > 2x médiane)
        if (c_info.get("active_months_cnt", 0) <= 2 
                and c_info.get("avg", 0.0) > (2.0 * median_cat_avg) 
                and not c_info.get("is_fixed") 
                and c_info.get("type") != "expense_fixed"):
            return True

        # 3. Dépense ponctuelle isolée sans récurrence ni régularité (1 seul mois actif, non fixe, montant > 150€)
        if (c_info.get("active_months_cnt", 0) <= 1 
                and not c_info.get("is_fixed") 
                and c_info.get("type") != "expense_fixed" 
                and c_info.get("avg", 0.0) > 150.0):
            staple_keywords = ["course", "alim", "super", "resto", "restaurant", "essence", "carburant", "sante", "pharm", "loyer", "edf", "eau", "assurance"]
            if not any(kw in c_clean for kw in staple_keywords):
                return True

        return False

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
                    if _is_exceptional_or_project(real):
                        # Projets exceptionnels laissés en manuel à l'utilisateur
                        continue
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

    def _cluster_categories_thematically(cats_to_group, is_orphan_fallback=False):
        # Exclure d'emblée les projets exceptionnels et dépenses ponctuelles pour les laisser en gestion manuelle
        remaining = [c for c in cats_to_group if c not in used_in_proposals and not _is_exceptional_or_project(c)]
        if not remaining:
            return

        clusters = [
            ("Housing & Home" if lang == "en" else "Logement & Maison",
             ["loyer", "bail", "electr", "energie", "edf", "engie", "gaz", "eau", "charges", "copro", "syndic", "brico", "bricolage", "bricole", "meuble", "deco", "ikea", "castorama", "leroy merlin", "habitat", "jardin"]),
            ("Food & Groceries" if lang == "en" else "Alimentation & Courses",
             ["course", "alim", "super", "resto", "restau", "restaurant", "boulang", "boulangerie", "repas", "nourriture", "drive", "carrefour", "leclerc", "auchan", "lidl", "monoprix", "intermarche", "casino", "picard", "biocoop", "cafe", "brasserie", "traiteur", "cantine"]),
            ("Transport & Vehicle" if lang == "en" else "Transport & Véhicule",
             ["transp", "carburant", "essence", "diesel", "station", "total", "peage", "parking", "train", "sncf", "ratp", "ter", "tgv", "uber", "taxi", "covoiturage", "blablacar", "auto", "garage", "moto", "velo", "cycl", "reparation auto", "controle technique", "routi"]),
            ("Health & Wellness" if lang == "en" else "Santé & Bien-être",
             ["sante", "medical", "pharm", "medecin", "docteur", "dentiste", "mutuelle", "optique", "lunettes", "kine", "osteo", "laboratoire", "analyse", "soin", "hopital", "clinique"]),
            ("Subscriptions & Telecom" if lang == "en" else "Abonnements & Multimédia",
             ["abonnement", "media", "netflix", "spotify", "deezer", "canal", "disney", "prime", "youtube", "internet", "telephon", "mobile", "fibre", "free", "orange", "sfr", "bouygues", "sosh", "red"]),
            ("Technology & Digital" if lang == "en" else "Technologie & Numérique",
             ["tech", "informatique", "ordinateur", "logiciel", "software", "saas", "cloud", "ia", "ai", "chatgpt", "steam", "gaming", "distrokid", "ovh", "ehd", "reseaux it", "electronique", "musique", "hardware", "apple", "google", "microsoft"]),
            ("Finance & Banking" if lang == "en" else "Finances & Crédits",
             ["emprunt", "credit", "pret", "remboursement", "virement", "transfert", "avance", "banque", "frais de compte", "frais bancaire", "cotisation compte", "cotisation carte", "agios", "courtier", "interet"]),
            ("Services & Administration" if lang == "en" else "Services & Administratif",
             ["poste", "envoi", "colis", "timbre", "chronopost", "mondial relay", "impot", "taxe", "fisc", "amende", "juridique", "notaire", "avocat", "cotisation", "association"]),
            ("Insurance" if lang == "en" else "Assurances & Prévoyance",
             ["assurance", "prevoyance", "sinistre", "axa", "macif", "allianz", "maif", "matmut", "mma", "gmf", "direct assurance"]),
            ("Leisure & Entertainment" if lang == "en" else "Loisirs & Sorties",
             ["loisir", "sport", "cinema", "theatre", "concert", "spectacle", "musee", "culture", "livre", "lecture", "vacance", "voyage", "hotel", "camping", "airsoft", "hobby", "club", "fitness", "piscine", "fdj"]),
            ("Shopping & Discretionary" if lang == "en" else "Achats & Shopping",
             ["shopping", "vetement", "habillement", "fringues", "mode", "chaussure", "accessoire", "beaute", "coiffure", "esthetique", "cadeau", "amazon", "fnac", "chinoiseries"])
        ]

        for cluster_name, keywords in clusters:
            matched = []
            for c in remaining:
                c_clean = _clean_for_match(c)
                if any(_matches_keyword(c_clean, kw) for kw in keywords):
                    matched.append(c)
            if matched:
                used_in_proposals.update(matched)
                remaining = [c for c in remaining if c not in matched]
                monthly_cats = [c for c in matched if cat_data[c].get("suggested_period", "monthly") == "monthly"]
                yearly_cats = [c for c in matched if cat_data[c].get("suggested_period") == "yearly"]
                justif = (f"Regroupement thématique ({len(matched)} catégories)." if lang != "en" else f"Thematic grouping ({len(matched)} categories).")
                if is_orphan_fallback:
                    justif = (f"Regroupement thématique complémentaire ({len(matched)} catégories)." if lang != "en" else f"Complementary thematic grouping ({len(matched)} categories).")

                if monthly_cats and yearly_cats:
                    proposals.append(_build_proposal(cluster_name, monthly_cats, justif, period_override="monthly"))
                    proposals.append(_build_proposal(f"{cluster_name} (Annuels)", yearly_cats, justif, period_override="yearly"))
                else:
                    period_ov = "yearly" if yearly_cats else "monthly"
                    proposals.append(_build_proposal(cluster_name, matched, justif, period_override=period_ov))

        # Restant fixe résiduel
        rem_fixed = [c for c in remaining if cat_data[c]["is_fixed"] or cat_data[c]["type"] == "expense_fixed"]
        if rem_fixed:
            used_in_proposals.update(rem_fixed)
            remaining = [c for c in remaining if c not in rem_fixed]
            name = "Fixed Charges & Contracts" if lang == "en" else "Charges Fixes & Contrats"
            justif = "Charges contractuelles résiduelles regroupées." if lang != "en" else "Residual fixed contractual charges grouped."
            proposals.append(_build_proposal(name, rem_fixed, justif))

        # Restant variable résiduel : séparer le mensuel et l'annuel pour préserver la précision budgétaire
        rem_monthly = [c for c in remaining if cat_data[c].get("suggested_period", "monthly") == "monthly"]
        rem_yearly = [c for c in remaining if cat_data[c].get("suggested_period") == "yearly"]

        if rem_monthly:
            used_in_proposals.update(rem_monthly)
            name = "Daily Life & Miscellaneous" if lang == "en" else "Vie Courante & Divers"
            justif = f"Dépenses courantes diverses ({len(rem_monthly)} catégories)." if lang != "en" else f"Miscellaneous living expenses ({len(rem_monthly)} categories)."
            proposals.append(_build_proposal(name, rem_monthly, justif, period_override="monthly"))

        if rem_yearly:
            used_in_proposals.update(rem_yearly)
            name = "Miscellaneous Annual Expenses" if lang == "en" else "Dépenses Annuelles Diverses"
            justif = f"Dépenses annuelles diverses ({len(rem_yearly)} catégories)." if lang != "en" else f"Miscellaneous annual expenses ({len(rem_yearly)} categories)."
            proposals.append(_build_proposal(name, rem_yearly, justif, period_override="yearly"))

    if not proposals and cat_data:
        is_fallback = True
        logger.info("[AI Budget] Génération des propositions thématiques déterministes...")
        _cluster_categories_thematically(cat_data.keys(), is_orphan_fallback=False)
    elif orphan_cats:
        logger.info(f"[AI Budget] Regroupement thématique complémentaire des {len(orphan_cats)} catégories orphelines...")
        _cluster_categories_thematically(orphan_cats, is_orphan_fallback=True)

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

    if not proposals:
        err_detail = "L'IA n'a pas pu générer de propositions d'enveloppes valides. Vérifiez le modèle Ollama configuré."
        _update_ai_status(profile_id=pid, state="ERROR", error=err_detail)
        raise HTTPException(status_code=500, detail=err_detail)

    total_new_fixed_monthly = 0.0
    total_new_var_monthly = 0.0

    for p in proposals:
        period_div = 12.0 if p["suggested_period"] == "yearly" else 1.0
        if p["is_fixed"]:
            total_new_fixed_monthly += (p["suggested_amount"] / period_div)
        elif p.get("has_fixed_mix"):
            fixed_part = p.get("fixed_sum", 0.0)
            var_part = max(0.0, p["suggested_amount"] - fixed_part)
            total_new_fixed_monthly += (fixed_part / period_div)
            if not p.get("is_exceptional"):
                total_new_var_monthly += (var_part / period_div)
        elif not p.get("is_exceptional"):
            total_new_var_monthly += (p["suggested_amount"] / period_div)

    remaining_for_variables = max(0.0, available_monthly_budget - total_new_fixed_monthly)

    is_capped = False
    if total_new_var_monthly > remaining_for_variables and total_new_var_monthly > 0:
        is_capped = True
        raw_ratio = remaining_for_variables / total_new_var_monthly
        effective_ratio = max(0.25, raw_ratio)
        for p in proposals:
            if not p["is_fixed"] and not p.get("is_exceptional"):
                fixed_cats = set(p.get("fixed_cats", []))
                if p.get("has_fixed_mix"):
                    fixed_part = p.get("fixed_sum", 0.0)
                    var_part = max(0.0, p["suggested_amount"] - fixed_part)
                    new_var = var_part * effective_ratio
                    p["suggested_amount"] = _smart_round(fixed_part + new_var)

                    var_cats = [c for c in p["cat_amounts"] if c not in fixed_cats]
                    var_sum = sum(p["cat_amounts"][c] for c in var_cats)
                    target_var = round(p["suggested_amount"] - fixed_part, 2)
                    if var_sum > 0 and target_var > 0:
                        for c in var_cats:
                            p["cat_amounts"][c] = round(p["cat_amounts"][c] * (target_var / var_sum), 2)
                        diff = round(target_var - sum(p["cat_amounts"][c] for c in var_cats), 2)
                        if diff != 0 and var_cats:
                            largest_var = max(var_cats, key=lambda c: p["cat_amounts"][c])
                            p["cat_amounts"][largest_var] = round(p["cat_amounts"][largest_var] + diff, 2)
                else:
                    p["suggested_amount"] = _smart_round(p["suggested_amount"] * effective_ratio)
                    var_sum = sum(p["cat_amounts"].values())
                    target_amt = p["suggested_amount"]
                    if var_sum > 0 and target_amt > 0:
                        for c in p["cat_amounts"]:
                            p["cat_amounts"][c] = round(p["cat_amounts"][c] * (target_amt / var_sum), 2)
                        diff = round(target_amt - sum(p["cat_amounts"].values()), 2)
                        if diff != 0 and p["cat_amounts"]:
                            largest_cat = max(p["cat_amounts"].keys(), key=lambda c: p["cat_amounts"][c])
                            p["cat_amounts"][largest_cat] = round(p["cat_amounts"][largest_cat] + diff, 2)

                if "cat_details" in p:
                    for cat in p["cat_amounts"]:
                        if cat in p["cat_details"]:
                            p["cat_details"][cat]["amount"] = p["cat_amounts"][cat]

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
        "outlier_sensitivity": outlier_sensitivity,
        "engine": "deterministic" if is_deterministic_engine else "ai",
    }
    return result_payload

async def ai_refine_budgets_service(window_months: int, lang: Optional[str], existing_proposals: list[dict], unclassified_categories: list[dict], db: Session, outlier_sensitivity: int = 2) -> dict:
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

    cat_data = compute_monthly_averages_for_ai(db, set(), anchor_date, window_months=window_months, outlier_sensitivity=outlier_sensitivity)

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
        raw = await call_ollama_async(prompt, cfg, extra_options={"num_predict": 1500, "format": "json"})
    except Exception as e:
        logger.warning(f"[AI Refine] Essai 1 Ollama json échoué: {e}")

    if not raw or not raw.strip():
        try:
            raw = await call_ollama_async(prompt, cfg, extra_options={"num_predict": 1500})
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

                prop_period = matched_prop.get("suggested_period") or matched_prop.get("period") or "monthly"
                for c in valid_cats:
                    c_period = cat_data[c].get("suggested_period", "monthly")
                    c_val = cat_data[c]["avg"] if c_period == "monthly" else round(cat_data[c]["total_year"] / 12.0, 2)
                    c_detail_amt = cat_data[c]["avg"] if prop_period != "yearly" else round(cat_data[c].get("total_year", c_val * 12.0), 2)
                    matched_prop["cat_amounts"][c] = c_val
                    matched_prop["cat_details"][c] = {
                        "amount": c_detail_amt,
                        "top_descs": cat_data[c].get("top_descs", []),
                        "is_fixed": cat_data[c].get("is_fixed", False),
                        "current_month_spent": cat_data[c].get("current_month_spent", 0.0),
                        "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0),
                    }
                matched_prop["suggested_amount"] = round(sum(matched_prop["cat_amounts"].values()), 2)
                matched_prop["current_month_spent"] = round(sum(cat_data[c].get("current_month_spent", 0.0) for c in sub_cats if c in cat_data), 2)
                matched_prop["recent_3m_avg"] = round(sum(cat_data[c].get("current_month_spent", 0.0) for c in sub_cats if c in cat_data), 2)
                matched_prop["historical_actual_amount"] = round(sum(matched_prop["cat_amounts"].values()), 2) if prop_period != "yearly" else round(sum(matched_prop["cat_amounts"].values()) * 12.0, 2)
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


def ai_recalculate_amounts_service(window_months: int, outlier_sensitivity: int, existing_proposals: list[dict], unclassified_categories: list[dict], db: Session) -> dict:
    latest_past_tx = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).first()
    anchor_date = latest_past_tx.date_operation if latest_past_tx else date.today()

    cat_data = compute_monthly_averages_for_ai(db, set(), anchor_date, window_months=window_months, outlier_sensitivity=outlier_sensitivity)

    updated_proposals = []
    for p in existing_proposals:
        cats = p.get("categories", [])
        is_yearly = (p.get("suggested_period") or p.get("period")) == "yearly"
        is_fixed = p.get("is_fixed", False)

        cat_amounts = {}
        for c in cats:
            if c in cat_data:
                c_is_fixed = cat_data[c]["is_fixed"]
                c_fixed_val = cat_data[c]["fixed_amount"]
                c_var_val = cat_data[c].get("sens_monthly_var", cat_data[c]["avg"])
                c_monthly = c_fixed_val if c_is_fixed else c_var_val
                c_tot_yr = cat_data[c]["total_year"]
                c_ytd = cat_data[c].get("ytd_spent", 0.0)
                c_yearly = max(c_tot_yr, round(c_monthly * 12.0, 2))
                if outlier_sensitivity >= 3 and c_ytd > 0:
                    c_yearly = max(c_yearly, c_ytd)
                    if anchor_date.month > 0:
                        c_yearly = max(c_yearly, round(c_ytd * 12.0 / anchor_date.month, 2))

                if is_yearly:
                    val = c_yearly
                else:
                    val = c_monthly
                cat_amounts[c] = val
            else:
                cat_amounts[c] = p.get("cat_amounts", {}).get(c, 0.0)

        # Plancher "Mois en cours" pour les enveloppes mensuelles
        if not is_yearly:
            for c in cats:
                if c in cat_data:
                    c_current_spent = cat_data[c].get("current_month_spent", 0.0)
                    if outlier_sensitivity >= 2:
                        if c_current_spent > cat_amounts[c]:
                            cat_amounts[c] = c_current_spent
                    else:
                        if c_current_spent > cat_amounts[c] and c_current_spent <= cat_data[c].get("p75", cat_amounts[c]):
                            cat_amounts[c] = c_current_spent

        raw_sum = round(sum(cat_amounts.values()), 2)
        base_amount = _smart_round(raw_sum)
        if raw_sum > 0 and base_amount > raw_sum:
            ratio = base_amount / raw_sum
            for c in cats:
                cat_amounts[c] = round(cat_amounts[c] * ratio, 2)
            diff = round(base_amount - sum(cat_amounts.values()), 2)
            if diff != 0 and cats:
                largest_c = max(cats, key=lambda c: cat_amounts[c])
                cat_amounts[largest_c] = round(cat_amounts[largest_c] + diff, 2)
        elif not cats:
            base_amount = 0.0
        elif len(cats) == 1:
            cat_amounts[cats[0]] = base_amount

        cat_details = {
            c: {
                "amount": cat_amounts[c],
                "top_descs": cat_data[c]["top_descs"] if c in cat_data else [],
                "is_fixed": cat_data[c]["is_fixed"] if c in cat_data else False,
                "current_month_spent": cat_data[c].get("current_month_spent", 0.0) if c in cat_data else 0.0,
                "recent_3m_avg": cat_data[c].get("recent_3m_avg", 0.0) if c in cat_data else 0.0,
            }
            for c in cats
        }

        updated_p = dict(p)
        updated_p["cat_amounts"] = cat_amounts
        updated_p["cat_details"] = cat_details
        updated_p["suggested_amount"] = base_amount
        updated_p["historical_actual_amount"] = raw_sum
        updated_p["original_amount"] = base_amount
        updated_p["current_month_spent"] = round(sum(cat_details[c].get("current_month_spent", 0.0) for c in cats), 2)
        updated_p["recent_3m_avg"] = round(sum(cat_details[c].get("recent_3m_avg", 0.0) for c in cats), 2)
        updated_proposals.append(updated_p)

    updated_unclassified = []
    for uItem in unclassified_categories:
        c_name = uItem.get("name") if isinstance(uItem, dict) else uItem
        if c_name in cat_data:
            updated_unclassified.append({
                "name": c_name,
                "avg": cat_data[c_name]["avg"],
                "current_month_spent": cat_data[c_name].get("current_month_spent", 0.0),
                "recent_3m_avg": cat_data[c_name].get("recent_3m_avg", 0.0),
                "total_year": cat_data[c_name].get("total_year", 0.0),
                "suggested_period": cat_data[c_name].get("suggested_period", "monthly"),
                "top_descs": cat_data[c_name].get("top_descs", []),
            })
        else:
            updated_unclassified.append(uItem)

    return {
        "proposals": updated_proposals,
        "unclassified_categories": updated_unclassified,
        "outlier_sensitivity": outlier_sensitivity,
    }

def __getattr__(name: str):
    if name == "AI_TASK_STATUS":
        return get_ai_suggest_status()
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
