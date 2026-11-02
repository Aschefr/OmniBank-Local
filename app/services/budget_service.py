from typing import Optional, List, Union
from datetime import date, datetime, timedelta, timezone
import json
import logging
import math
import uuid
from sqlalchemy.orm import Session
from sqlalchemy import func, extract, or_
from fastapi import HTTPException
from app.models import Budget, BudgetCategory, BudgetAllocation, Transaction, Account, GlobalConfig, AutopilotDecisionLog
from app.services.history_service import record_action, snapshot_entity
from app.services.stats_utils import winsorize_values

logger = logging.getLogger(__name__)

def _accumulate_tx(txs, match_fn=None):
    """Accumule income/expenses totaux et rapprochés pour un itérable de TX.

    Args:
        txs: itérable de transactions (peut être un générateur filtré par date).
        match_fn: fonction optionnelle (tx) -> bool pour filtrer par compte.
            Si None, toutes les TX sont acceptées.
    Returns:
        tuple (expenses, income, reconciled_expenses, reconciled_income)
    """
    expenses = income = reconciled_expenses = reconciled_income = 0.0
    for tx in txs:
        if match_fn is not None and not match_fn(tx):
            continue
        if tx.type == "income":
            income += abs(tx.amount)
            if tx.reconciliation_date:
                reconciled_income += abs(tx.amount)
        else:
            expenses += abs(tx.amount)
            if tx.reconciliation_date:
                reconciled_expenses += abs(tx.amount)
    return expenses, income, reconciled_expenses, reconciled_income


def safe_parse_budget_date(s: str, field_name: str) -> Optional[date]:
    """Parse une date YYYY-MM-DD pour les budgets — HTTPException 400 si invalide."""
    from app.utils.date_utils import require_date
    if not s:
        return None
    return require_date(s.strip(), field_name)

def parse_account_ids(raw: str) -> list:
    """Parse JSON string of account IDs from DB column."""
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []

def serialize_account_ids(ids: list) -> str:
    """Serialize account IDs list to JSON string for DB storage."""
    if not ids:
        return None
    return json.dumps(ids)

def _envelope_window(period: Optional[str], start: Optional[date], end: Optional[date]) -> tuple:
    """Période couverte par une enveloppe : bornée pour une période personnalisée, sinon permanente."""
    if period == "custom" and start and end:
        return start, end
    return date.min, date.max


def _tracks_by_category(envelope_type: Optional[str], is_project: bool) -> bool:
    """Les enveloppes de dépenses classiques suivent les opérations de leurs catégories ; projets et
    tirelires suivent les opérations qui leur sont rattachées à la main (budget_id)."""
    return (envelope_type or "spending") == "spending" and not is_project


def category_conflicts(db: Session, categories, period: Optional[str], start: Optional[date], end: Optional[date],
                       account_ids, exclude_id: Optional[int] = None) -> List[tuple]:
    """(catégorie, enveloppe) déjà suivies par une autre enveloppe active dont la période et les comptes
    recoupent ceux-ci : la même dépense y serait comptée deux fois."""
    if not categories:
        return []
    s1, e1 = _envelope_window(period, start, end)
    acc1 = set(account_ids or [])
    rows = (
        db.query(BudgetCategory.category_name, Budget)
        .join(Budget, Budget.id == BudgetCategory.budget_id)
        .filter(BudgetCategory.category_name.in_(list(categories)), Budget.is_closed == False)
        .all()
    )
    conflicts = []
    for cat, other in rows:
        if other.id == exclude_id or not _tracks_by_category(other.envelope_type, other.is_project):
            continue
        s2, e2 = _envelope_window(other.period, other.start_date, other.end_date)
        if s1 > e2 or s2 > e1:
            continue
        acc2 = set(parse_account_ids(other.account_ids))
        if acc1 and acc2 and not (acc1 & acc2):
            continue
        conflicts.append((cat, other.name))
    return conflicts


def envelope_validation_error(db: Session, *, categories, envelope_type: Optional[str], is_project: bool,
                              period: Optional[str], start: Optional[date] = None, end: Optional[date] = None,
                              account_ids=None, exclude_id: Optional[int] = None) -> Optional[str]:
    """Message d'erreur si l'enveloppe fausserait le suivi, sinon None."""
    if not _tracks_by_category(envelope_type, is_project):
        return None
    if not categories:
        return ("Choisissez au moins une catégorie : une enveloppe de dépenses suit les opérations de ses catégories "
                "(pour y rattacher des opérations à la main, créez un projet).")
    conflicts = category_conflicts(db, categories, period, start, end, account_ids, exclude_id)
    if conflicts:
        details = ", ".join(f"« {c} » (enveloppe « {n} »)" for c, n in conflicts)
        return (f"Déjà suivie par une autre enveloppe sur une période qui se recoupe : {details}. "
                "Une dépense ne doit compter que dans une seule enveloppe.")
    return None


def free_categories(db: Session, categories, period: Optional[str] = "monthly", start: Optional[date] = None,
                    end: Optional[date] = None, account_ids=None, exclude_id: Optional[int] = None) -> List[str]:
    """Catégories qui ne sont suivies par aucune autre enveloppe sur la même période (suggestions automatiques)."""
    taken = {c for c, _ in category_conflicts(db, categories, period, start, end, account_ids, exclude_id)}
    return [c for c in categories or [] if c not in taken]


# ── Période, rythme et état des enveloppes ─────────────────────────────────────

NEAR_LIMIT_PERCENT = 90.0       # alerte d'approche
AHEAD_OF_PACE_POINTS = 20.0     # « en avance sur le rythme » : % consommé dépasse le % de période écoulé de 20 points
FIXED_SHARE_THRESHOLD = 0.8     # enveloppe de charges fixes : 80 % de ses dépenses récentes sont fixes ou récurrentes
FIXED_LOOKBACK_DAYS = 90


def budget_display_prefs(db: Session) -> dict:
    """Préférences d'affichage des enveloppes (barre latérale et page Budgets), propres au profil."""
    conf = {c.key: c.value for c in db.query(GlobalConfig).filter(GlobalConfig.key.in_(
        ["budget_pinned_ids", "budget_sidebar_totals", "budget_totals_exclude_fixed"])).all()}
    try:
        pinned = [int(x) for x in json.loads(conf.get("budget_pinned_ids") or "[]")]
    except (ValueError, TypeError):
        pinned = []
    return {
        "pinned_ids": pinned,
        "sidebar_totals": conf.get("budget_sidebar_totals", "true") != "false",
        "totals_exclude_fixed": conf.get("budget_totals_exclude_fixed", "true") != "false",
    }


def is_org_mode(db: Session) -> bool:
    row = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
    return bool(row and str(row.value).strip().lower() == "true")


def budget_period(db: Session, offset: int = 0, today: Optional[date] = None) -> dict:
    """Période des enveloppes mensuelles. Mode personnel : cycle de paie (du jour de paie à la veille de la
    suivante), comme le Cockpit et le reste à vivre. Mode organisation, ou sans historique de paie : mois
    calendaire. offset = 0 pour la période en cours, -1 pour la précédente…"""
    from dateutil.relativedelta import relativedelta
    today = today or date.today()
    if not is_org_mode(db):
        try:
            from app.services.finance_engine import predict_next_paycheck
            info = predict_next_paycheck(db) or {}
            starts = sorted({date.fromisoformat(h["date"][:10]) for h in info.get("history") or []
                             if h.get("date") and date.fromisoformat(h["date"][:10]) <= today})
            next_pay = info.get("date")
            idx = len(starts) - 1 + offset
            if starts and 0 <= idx < len(starts):
                start = starts[idx]
                following = starts[idx + 1] if idx + 1 < len(starts) else next_pay
                # Garde-fou : une prédiction aberrante ne doit pas produire un cycle de deux mois
                if not following or following <= start or following > start + relativedelta(months=1, days=10):
                    following = start + relativedelta(months=1)
                return _period_dict("cycle", start, following - timedelta(days=1), offset, today)
        except Exception as e:
            logger.debug(f"[Budgets] Cycle de paie indisponible, mois calendaire utilisé : {e}")
    first = date(today.year, today.month, 1) + relativedelta(months=offset)
    return _period_dict("month", first, first + relativedelta(months=1) - timedelta(days=1), offset, today)


def _period_dict(kind: str, start: date, end: date, offset: int, today: date) -> dict:
    total = (end - start).days + 1
    elapsed = min(max((today - start).days + 1, 0), total)
    return {"kind": kind, "start": start.isoformat(), "end": end.isoformat(), "offset": offset,
            "days_total": total, "days_elapsed": elapsed, "days_left": total - elapsed}


def _recurring_share(db: Session, categories, today: date) -> dict:
    """Par catégorie : (dépenses rattachées à une récurrence, dépenses totales) sur les 90 derniers jours."""
    share = {}
    if not categories:
        return share
    rows = db.query(Transaction.category, Transaction.recurrence_id, Transaction.amount).filter(
        Transaction.category.in_(list(categories)),
        Transaction.type.in_(["expense_fixed", "expense_var"]),
        Transaction.date_operation >= today - timedelta(days=FIXED_LOOKBACK_DAYS),
        Transaction.date_operation <= today,
    ).all()
    for cat, rec_id, amount in rows:
        fixed, total = share.get(cat, (0.0, 0.0))
        amt = abs(amount or 0.0)
        share[cat] = (fixed + (amt if rec_id else 0.0), total + amt)
    return share


def recurring_charge_categories(db: Session, categories, today: Optional[date] = None) -> set:
    """Catégories de charges prévues : l'essentiel de leurs dépenses récentes vient de récurrences ou, sans
    dépense récente, elles sont de type fixe. Les récurrences les suivent déjà : pas besoin d'enveloppe."""
    from app.models import Category
    categories = [c for c in categories or [] if c]
    if not categories:
        return set()
    share = _recurring_share(db, categories, today or date.today())
    cat_types = dict(db.query(Category.name, Category.type).filter(Category.name.in_(categories)).all())
    result = set()
    for c in categories:
        fixed, total = share.get(c, (0.0, 0.0))
        if total > 0:
            if fixed / total >= FIXED_SHARE_THRESHOLD:
                result.add(c)
        elif cat_types.get(c) == "expense_fixed":
            result.add(c)
    return result


def tracked_categories(db: Session) -> set:
    """Catégories déjà suivies par une enveloppe de dépenses ouverte : une enveloppe mensuelle ou annuelle ne
    peut pas les reprendre (même règle que la création d'enveloppe)."""
    rows = (
        db.query(BudgetCategory.category_name, Budget.envelope_type, Budget.is_project)
        .join(Budget, Budget.id == BudgetCategory.budget_id)
        .filter(Budget.is_closed == False)
        .all()
    )
    return {cat for cat, env_type, is_project in rows if _tracks_by_category(env_type, is_project)}


def envelopes_open_to_new_categories(db: Session) -> List[dict]:
    """Enveloppes mensuelles ou annuelles de dépenses libres ouvertes, qui peuvent accueillir une nouvelle
    catégorie au lieu d'en créer une en double (suggestions d'enveloppes). Les enveloppes de charges prévues
    n'en font pas partie : une dépense libre n'a rien à y faire."""
    budgets = [
        b for b in db.query(Budget)
        .filter(Budget.is_closed == False, Budget.period.in_(["monthly", "yearly"]))
        .order_by(Budget.name)
        .all()
        if _tracks_by_category(b.envelope_type, b.is_project)
    ]
    cats_by_budget = {
        b.id: [bc.category_name for bc in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all()]
        for b in budgets
    }
    fixed_ids = _fixed_envelope_ids(db, budgets, cats_by_budget, date.today())
    result = []
    for b in budgets:
        if b.id in fixed_ids:
            continue
        cats = cats_by_budget[b.id]
        result.append({
            "id": b.id, "name": b.name, "period": b.period, "categories": cats,
            "amount": b.monthly_amount or 0.0, "account_ids": parse_account_ids(b.account_ids),
        })
    return result


def _fixed_envelope_ids(db: Session, budgets: List[Budget], cats_by_budget: dict, today: date) -> set:
    """Enveloppes de charges fixes : l'essentiel de leurs dépenses récentes vient de récurrences (prêts,
    assurances, énergie…). Sans opération récurrente récente : toutes leurs catégories sont de type fixe."""
    from app.models import Category
    all_cats = {c for b in budgets for c in cats_by_budget.get(b.id, [])}
    if not all_cats:
        return set()
    share = _recurring_share(db, all_cats, today)
    cat_types = dict(db.query(Category.name, Category.type).filter(Category.name.in_(list(all_cats))).all())
    fixed_ids = set()
    for b in budgets:
        cats = cats_by_budget.get(b.id, [])
        if not cats or not _tracks_by_category(b.envelope_type, b.is_project):
            continue
        fixed = sum(share.get(c, (0.0, 0.0))[0] for c in cats)
        total = sum(share.get(c, (0.0, 0.0))[1] for c in cats)
        if fixed > 0:
            if fixed / total >= FIXED_SHARE_THRESHOLD:
                fixed_ids.add(b.id)
        elif all(cat_types.get(c) == "expense_fixed" for c in cats):
            fixed_ids.add(b.id)
    return fixed_ids


def envelope_health(limit: float, spent_now: float, window: Optional[tuple], today: date, is_fixed: bool) -> dict:
    """État d'une enveloppe : over (dépassée), near (≥ 90 %), ahead (consommée plus vite que la période ne
    s'écoule) ou ok. Charges fixes : seul un vrai dépassement compte (elles atteignent 100 % par nature)."""
    pct = (spent_now / limit * 100) if limit and limit > 0 else 0.0
    expected = None
    if window and not is_fixed:
        start, end = window
        total = (end - start).days + 1
        elapsed = min(max((today - start).days + 1, 0), total)
        expected = elapsed / total * 100 if total > 0 else None
    if limit and limit > 0 and spent_now > limit + 0.5:
        status = "over"
    elif is_fixed:
        status = "ok"
    elif pct >= NEAR_LIMIT_PERCENT:
        status = "near"
    elif expected is not None and expected >= 15 and pct >= 30 and pct - expected >= AHEAD_OF_PACE_POINTS:
        status = "ahead"
    else:
        status = "ok"
    return {"percent_to_date": round(pct, 1), "expected_percent": round(expected, 1) if expected is not None else None,
            "status": status}


def budget_to_dict(b: Budget, db: Session) -> dict:
    cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all()
    return {
        "id": b.id,
        "name": b.name,
        "monthly_amount": b.monthly_amount,
        "period": b.period,
        "is_project": b.is_project,
        "is_closed": b.is_closed,
        "categories": [c.category_name for c in cats],
        "start_date": b.start_date.isoformat() if b.start_date else None,
        "end_date": b.end_date.isoformat() if b.end_date else None,
        "account_ids": parse_account_ids(b.account_ids),
        "envelope_type": b.envelope_type or "spending",
        "is_locked": bool(b.is_locked) if b.is_locked is not None else False,
        "base_annual_amount": b.base_annual_amount,
    }

def get_all_budgets(db: Session) -> List[dict]:
    budgets = db.query(Budget).order_by(Budget.name).all()
    if not budgets:
        return []
    
    budget_ids = [b.id for b in budgets]
    all_cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_(budget_ids)).all()
    cats_by_budget = {}
    for c in all_cats:
        cats_by_budget.setdefault(c.budget_id, []).append(c.category_name)
        
    return [
        {
            "id": b.id,
            "name": b.name,
            "monthly_amount": b.monthly_amount,
            "period": b.period,
            "is_project": b.is_project,
            "is_closed": b.is_closed,
            "categories": cats_by_budget.get(b.id, []),
            "start_date": b.start_date.isoformat() if b.start_date else None,
            "end_date": b.end_date.isoformat() if b.end_date else None,
            "account_ids": parse_account_ids(b.account_ids),
            "envelope_type": b.envelope_type or "spending",
            "is_locked": bool(b.is_locked) if b.is_locked is not None else False,
            "base_annual_amount": b.base_annual_amount,
        }
        for b in budgets
    ]

def create_new_budget(data, db: Session) -> dict:
    _start = safe_parse_budget_date(data.start_date, "start_date") if data.start_date else None
    _end = safe_parse_budget_date(data.end_date, "end_date") if data.end_date else None
    period = data.period
    if data.envelope_type == "savings":
        period = "indefinite"
    error = envelope_validation_error(
        db, categories=data.categories, envelope_type=data.envelope_type, is_project=data.is_project,
        period=period, start=_start, end=_end, account_ids=data.account_ids,
    )
    if error:
        raise HTTPException(status_code=409 if data.categories else 400, detail=error)
    b = Budget(
        name=data.name,
        monthly_amount=data.monthly_amount,
        period=period,
        is_project=data.is_project,
        is_closed=False,
        start_date=_start,
        end_date=_end,
        account_ids=serialize_account_ids(data.account_ids),
        envelope_type=data.envelope_type or "spending",
        is_locked=bool(getattr(data, "is_locked", False) or False),
        base_annual_amount=getattr(data, "base_annual_amount", None) or (data.monthly_amount * 12 if period != "yearly" else data.monthly_amount),
    )
    db.add(b)
    db.flush()

    for cat_name in (data.categories or []):
        db.add(BudgetCategory(budget_id=b.id, category_name=cat_name))
    db.flush()
    action_id = record_action(db, "budget", b.id, "CREATE", None, snapshot_entity(b, db))
    db.commit()
    db.refresh(b)

    res = budget_to_dict(b, db)
    res["action_id"] = action_id
    return res

def update_existing_budget(budget_id: int, data, db: Session) -> dict:
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")

    old_snapshot = snapshot_entity(b, db)
    dump_data = data.model_dump(exclude_unset=True) if hasattr(data, "model_dump") else data.dict(exclude_unset=True)
    for k, v in dump_data.items():
        if k == "categories":
            continue
        if k in ("start_date", "end_date"):
            setattr(b, k, safe_parse_budget_date(v, k) if v else None)
            continue
        if k == "account_ids":
            setattr(b, k, serialize_account_ids(v))
            continue
        setattr(b, k, v)

    final_cats = data.categories if data.categories is not None else [
        c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).all()
    ]
    error = None if b.is_closed else envelope_validation_error(
        db, categories=final_cats, envelope_type=b.envelope_type, is_project=b.is_project, period=b.period,
        start=b.start_date, end=b.end_date, account_ids=parse_account_ids(b.account_ids), exclude_id=b.id,
    )
    if error:
        db.rollback()
        raise HTTPException(status_code=409 if final_cats else 400, detail=error)

    if data.categories is not None:
        db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).delete()
        for cat_name in data.categories:
            db.add(BudgetCategory(budget_id=budget_id, category_name=cat_name))

    db.flush()
    action_id = record_action(db, "budget", b.id, "UPDATE", old_snapshot, snapshot_entity(b, db))
    db.commit()
    db.refresh(b)
    res = budget_to_dict(b, db)
    res["action_id"] = action_id
    return res

def delete_single_budget(budget_id: int, db: Session) -> dict:
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")
    old_snapshot = snapshot_entity(b, db)
    db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).delete()
    db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == budget_id).delete()
    # Clôturer automatiquement toute suggestion de recalibrage en attente visant ce budget
    db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.decision_type == "budget_suggestion",
        AutopilotDecisionLog.action == "SUGGESTED",
        AutopilotDecisionLog.entity_id == budget_id,
    ).update({"action": "DISMISSED"}, synchronize_session=False)
    db.delete(b)
    action_id = record_action(db, "budget", budget_id, "DELETE", old_snapshot, None)
    db.commit()
    return {"ok": True, "action_id": action_id}

def bulk_delete_budgets_by_type(target_type: str, db: Session) -> dict:
    query = db.query(Budget).filter(Budget.is_closed == False)
    if target_type == "monthly":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None), (Budget.period == "monthly") | (Budget.period == None))
    elif target_type == "yearly":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None), Budget.period == "yearly")
    elif target_type == "spending":
        query = query.filter(Budget.is_project == False, (Budget.envelope_type == "spending") | (Budget.envelope_type == None))
    elif target_type == "project":
        query = query.filter(Budget.is_project == True)
    elif target_type == "savings":
        query = query.filter(Budget.envelope_type == "savings")
    elif target_type == "all":
        pass
    else:
        raise HTTPException(status_code=400, detail="Type d'enveloppe invalide.")

    budgets_to_delete = query.all()
    deleted_count = len(budgets_to_delete)
    if not budgets_to_delete:
        return {"ok": True, "deleted_count": 0}

    budget_ids = [b.id for b in budgets_to_delete]
    db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_(budget_ids)).delete(synchronize_session=False)
    db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(budget_ids)).delete(synchronize_session=False)
    # Clôturer automatiquement toute suggestion de recalibrage en attente visant ces budgets
    db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.decision_type == "budget_suggestion",
        AutopilotDecisionLog.action == "SUGGESTED",
        AutopilotDecisionLog.entity_id.in_(budget_ids),
    ).update({"action": "DISMISSED"}, synchronize_session=False)
    for b in budgets_to_delete:
        old_snapshot = snapshot_entity(b, db)
        record_action(db, "budget", b.id, "DELETE", old_snapshot, None)
        db.delete(b)

    db.commit()
    return {"ok": True, "deleted_count": deleted_count}

def get_budget_status_data(year: int = None, month: int = None, date_start: str = None, date_end: str = None, period_filter: str = None, db: Session = None, cycle_offset: Optional[int] = None):
    """Consommation des enveloppes. cycle_offset (sans dates explicites) : les enveloppes mensuelles suivent
    budget_period (cycle de paie en mode personnel, mois calendaire en mode organisation)."""
    today = date.today()
    y = year or today.year
    m = month or today.month

    custom_start = None
    custom_end = None
    period_info = None
    if cycle_offset is not None and not (date_start and date_end):
        period_info = budget_period(db, cycle_offset, today)
        date_start, date_end = period_info["start"], period_info["end"]
        y, m = int(period_info["start"][:4]), int(period_info["start"][5:7])
    if date_start and date_end:
        try:
            custom_start = safe_parse_budget_date(date_start, "date_start")
            custom_end = safe_parse_budget_date(date_end, "date_end")
            if custom_start and custom_end and custom_start > custom_end:
                custom_start, custom_end = custom_end, custom_start
        except HTTPException:
            pass

    q = db.query(Budget).filter(Budget.is_closed == False)
    if period_filter and period_filter != "all":
        if period_filter == "custom":
            q = q.filter(Budget.period == "custom")
        elif period_filter == "indefinite":
            q = q.filter(Budget.period == "indefinite")
        elif period_filter == "yearly":
            q = q.filter(Budget.period == "yearly")
        elif period_filter == "monthly":
            q = q.filter(Budget.period.in_(["monthly", None]))
    budgets = q.all()
    if not budgets:
        res = {"year": y, "month": m, "budgets": [], "period": period_info}
        if period_filter == "all":
            res["statusByType"] = {
                "monthly": {"year": y, "month": m, "budgets": []},
                "yearly": {"year": y, "month": m, "budgets": []},
                "indefinite": {"year": y, "month": m, "budgets": []},
                "custom": {"year": y, "month": m, "budgets": []},
            }
        return res

    budget_ids = [b.id for b in budgets]

    all_cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_(budget_ids)).all()
    cats_by_budget = {}
    for c in all_cats:
        cats_by_budget.setdefault(c.budget_id, []).append(c.category_name)

    savings_budget_ids = [b.id for b in budgets if (b.envelope_type or "spending") == "savings"]
    allocs_by_budget = {}
    if savings_budget_ids:
        all_allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(savings_budget_ids)).all()
        for a in all_allocs:
            allocs_by_budget.setdefault(a.budget_id, []).append(a)

    budget_id_linked_ids = [b.id for b in budgets
                           if (b.envelope_type or "spending") == "savings" or b.is_project]
    txs_by_budget_id = {}
    if budget_id_linked_ids:
        linked_txs = db.query(
            Transaction.budget_id,
            Transaction.from_account_id,
            Transaction.to_account_id,
            Transaction.type,
            Transaction.amount,
            Transaction.reconciliation_date
        ).filter(Transaction.budget_id.in_(budget_id_linked_ids)).all()
        for tx in linked_txs:
            txs_by_budget_id.setdefault(tx.budget_id, []).append(tx)

    spending_budgets = [b for b in budgets
                       if (b.envelope_type or "spending") != "savings" and not b.is_project]
    all_category_txs = []
    txs_by_cat = {}
    if spending_budgets:
        tx_query = db.query(
            Transaction.from_account_id,
            Transaction.to_account_id,
            Transaction.type,
            Transaction.category,
            Transaction.reconciliation_date,
            Transaction.date_operation,
            func.sum(func.abs(Transaction.amount)).label("amount")
        ).filter(
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        
        has_indefinite = any(b.period == "indefinite" for b in spending_budgets)
        if not has_indefinite:
            dates = []
            if any(b.period in ("monthly", None) for b in spending_budgets):
                if custom_start:
                    dates.append(custom_start)
                else:
                    dates.append(date(y, m, 1))
            if any(b.period == "yearly" for b in spending_budgets):
                dates.append(date(y, 1, 1))
            for b in spending_budgets:
                if b.period == "custom" and b.start_date:
                    dates.append(b.start_date)
            if dates:
                min_date = min(dates)
                tx_query = tx_query.filter(Transaction.date_operation >= min_date)
                
        tx_query = tx_query.group_by(
            Transaction.from_account_id,
            Transaction.to_account_id,
            Transaction.type,
            Transaction.category,
            Transaction.reconciliation_date,
            Transaction.date_operation
        )
        all_category_txs = tx_query.all()
        for tx in all_category_txs:
            cat_key = tx.category or "Sans catégorie"
            txs_by_cat.setdefault(cat_key, []).append(tx)

    fixed_ids = _fixed_envelope_ids(db, spending_budgets, cats_by_budget, today) if not is_org_mode(db) else set()
    month_window = (custom_start, custom_end) if custom_start and custom_end else (
        date(y, m, 1), (date(y, m, 1) + timedelta(days=32)).replace(day=1) - timedelta(days=1))

    result = []

    for b in budgets:
        cats = cats_by_budget.get(b.id, [])
        acc_ids = parse_account_ids(b.account_ids)
        acc_ids_set = set(acc_ids) if acc_ids else None

        def _match_account(tx, _ids=acc_ids_set):
            if not _ids:
                return True
            return (tx.from_account_id in _ids or tx.to_account_id in _ids)

        expenses = 0.0
        income = 0.0
        reconciled_expenses = 0.0
        reconciled_income = 0.0

        if (b.envelope_type or "spending") == "savings":
            expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                txs_by_budget_id.get(b.id, []), _match_account
            )

            allocs = allocs_by_budget.get(b.id, [])
            alloc_deposits = sum(a.amount for a in allocs if a.amount > 0)
            alloc_withdrawals = sum(abs(a.amount) for a in allocs if a.amount < 0)

            funded = round(income + alloc_deposits, 2)
            withdrawn = round(expenses + alloc_withdrawals, 2)
            balance = round(funded - withdrawn, 2)
            budget_amount = b.monthly_amount
            pct = round((balance / budget_amount * 100) if budget_amount > 0 else 0, 1)

            result.append({
                "id": b.id,
                "name": b.name,
                "categories": cats,
                "is_project": b.is_project,
                "is_closed": b.is_closed,
                "is_locked": bool(b.is_locked) if b.is_locked is not None else False,
                "envelope_type": "savings",
                "budget_amount": budget_amount,
                "funded": funded,
                "withdrawn": withdrawn,
                "balance": balance,
                "percent": min(pct, 999),
                "remaining": round(budget_amount - balance, 2),
                "expenses": withdrawn,
                "reconciled_expenses": round(reconciled_expenses + alloc_withdrawals, 2),
                "income": funded,
                "spent": max(withdrawn - funded, 0),
                "reconciled_spent": 0,
                "net": round(withdrawn - funded, 2),
                "period": b.period,
                "start_date": b.start_date.isoformat() if b.start_date else None,
                "end_date": b.end_date.isoformat() if b.end_date else None,
                "account_ids": acc_ids,
            })
            continue

        window = None  # période de l'enveloppe, pour le repère de rythme
        if b.is_project:
            period_txs = None
            expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(
                txs_by_budget_id.get(b.id, []), _match_account
            )
        else:
            # Fast category-indexed tx lookup (sans catégorie : rien à suivre, et non toutes les dépenses)
            target_txs = []
            for c in cats:
                target_txs.extend(txs_by_cat.get(c, []))

            if b.period == "indefinite":
                period_txs = target_txs
            elif b.period == "custom" and b.start_date and b.end_date:
                period_txs = [tx for tx in target_txs if b.start_date <= tx.date_operation <= b.end_date]
            elif b.period == "yearly":
                period_txs = [tx for tx in target_txs if tx.date_operation.year == y]
                window = (date(y, 1, 1), date(y, 12, 31))
            else:
                window = month_window
                period_txs = [tx for tx in target_txs if window[0] <= tx.date_operation <= window[1]]
            expenses, income, reconciled_expenses, reconciled_income = _accumulate_tx(period_txs, _match_account)

        expenses = round(expenses, 2)
        income = round(income, 2)
        spent = round(expenses - income, 2)
        
        reconciled_expenses = round(reconciled_expenses, 2)
        reconciled_income = round(reconciled_income, 2)
        reconciled_spent = round(reconciled_expenses - reconciled_income, 2)

        budget_amount = b.monthly_amount
        pct = round((max(spent, 0) / budget_amount * 100) if budget_amount > 0 else 0, 1)
        reconciled_pct = round((max(reconciled_spent, 0) / budget_amount * 100) if budget_amount > 0 else 0, 1)

        # Dépensé à ce jour (opérations datées jusqu'à aujourd'hui) et prévu d'ici la fin de la période
        if period_txs is not None:
            e_now, i_now, _, _ = _accumulate_tx((tx for tx in period_txs if tx.date_operation <= today), _match_account)
            spent_to_date = round(max(e_now - i_now, 0), 2)
        else:
            spent_to_date = max(spent, 0)
        is_fixed = b.id in fixed_ids
        health = envelope_health(budget_amount, spent_to_date, window, today, is_fixed)

        result.append({
            "id": b.id,
            "name": b.name,
            "categories": cats,
            "is_project": b.is_project,
            "is_closed": b.is_closed,
            "is_locked": bool(b.is_locked) if b.is_locked is not None else False,
            "envelope_type": b.envelope_type or "spending",
            "budget_amount": budget_amount,
            "expenses": expenses,
            "reconciled_expenses": reconciled_expenses,
            "income": income,
            "spent": max(spent, 0),
            "reconciled_spent": max(reconciled_spent, 0),
            "net": spent,
            "remaining": round(budget_amount - spent, 2),
            "percent": pct,
            "reconciled_percent": reconciled_pct,
            "spent_to_date": spent_to_date,
            "planned": round(max(max(spent, 0) - spent_to_date, 0), 2),
            "percent_to_date": health["percent_to_date"],
            "expected_percent": health["expected_percent"],
            "status": health["status"],
            "is_fixed_charges": is_fixed,
            "period": b.period,
            "start_date": b.start_date.isoformat() if b.start_date else None,
            "end_date": b.end_date.isoformat() if b.end_date else None,
            "account_ids": acc_ids,
        })

    all_acc_ids = set()
    for r in result:
        all_acc_ids.update(r.get("account_ids") or [])
    acc_name_map = {}
    if all_acc_ids:
        for a in db.query(Account).filter(Account.id.in_(list(all_acc_ids))).all():
            acc_name_map[a.id] = a.name
    for r in result:
        r["account_names"] = [acc_name_map.get(aid, f"#{aid}") for aid in (r.get("account_ids") or [])]

    response_data = {"year": y, "month": m, "budgets": result, "period": period_info}
    if period_filter == "all":
        response_data["statusByType"] = {
            "monthly": {"year": y, "month": m, "budgets": [r for r in result if r.get("period") in ("monthly", None)]},
            "yearly": {"year": y, "month": m, "budgets": [r for r in result if r.get("period") == "yearly"]},
            "indefinite": {"year": y, "month": m, "budgets": [r for r in result if r.get("period") == "indefinite"]},
            "custom": {"year": y, "month": m, "budgets": [r for r in result if r.get("period") == "custom"]},
        }
    return response_data

def get_budget_transactions_data(budget_id: int, year: int = None, month: int = None, db: Session = None,
                                 date_start: str = None, date_end: str = None):
    """Opérations d'une enveloppe sur sa période ; date_start/date_end (cycle de paie) remplacent le mois
    calendaire pour les enveloppes mensuelles."""
    today = date.today()
    y = year or today.year
    m = month or today.month
    period_start = safe_parse_budget_date(date_start, "date_start") if date_start else None
    period_end = safe_parse_budget_date(date_end, "date_end") if date_end else None

    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")

    cats = [c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).all()]
    acc_ids = parse_account_ids(b.account_ids)

    def _apply_account_filter(q):
        if not acc_ids:
            return q
        return q.filter(or_(
            Transaction.from_account_id.in_(acc_ids),
            Transaction.to_account_id.in_(acc_ids)
        ))

    if (b.envelope_type or "spending") == "savings" or b.is_project:
        q = db.query(Transaction).filter(Transaction.budget_id == budget_id)
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif not cats:
        txs = []
    elif b.period == "indefinite":
        q = db.query(Transaction).filter(
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif b.period == "custom" and b.start_date and b.end_date:
        q = db.query(Transaction).filter(
            Transaction.date_operation >= b.start_date,
            Transaction.date_operation <= b.end_date,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif b.period == "yearly":
        q = db.query(Transaction).filter(
            extract('year', Transaction.date_operation) == y,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    else:
        if period_start and period_end:
            q = db.query(Transaction).filter(
                Transaction.date_operation >= period_start,
                Transaction.date_operation <= period_end,
                Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
            )
        else:
            q = db.query(Transaction).filter(
                extract('year', Transaction.date_operation) == y,
                extract('month', Transaction.date_operation) == m,
                Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
            )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()

    return [{
        "id": tx.id,
        "date": tx.date_operation.isoformat(),
        "description": tx.description,
        "amount": tx.amount,
        "type": tx.type,
        "category": tx.category,
        "is_income": tx.type == "income",
        "is_reconciled": tx.reconciliation_date is not None,
    } for tx in txs]

def get_allocations_data(budget_id: int, db: Session):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")
    allocs = db.query(BudgetAllocation).filter(
        BudgetAllocation.budget_id == budget_id
    ).order_by(BudgetAllocation.date.desc()).all()
    return [
        {
            "id": a.id,
            "budget_id": a.budget_id,
            "amount": a.amount,
            "date": a.date.isoformat() if a.date else None,
            "note": a.note,
            "account_id": a.account_id,
            "created_at": a.created_at,
        }
        for a in allocs
    ]

def create_allocation_data(budget_id: int, data, db: Session):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")
        
    if data.amount < 0:
        from app.services.finance_engine import get_main_account
        main_account = get_main_account(db)
        main_acc_id = main_account.id if main_account else None
        target_acc_id = data.account_id if data.account_id is not None else main_acc_id
        
        allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == budget_id).all()
        current_hosted = 0.0
        for a in allocs:
            a_acc_id = a.account_id if a.account_id is not None else main_acc_id
            if a_acc_id == target_acc_id:
                current_hosted += a.amount
                
        withdrawal_amount = abs(data.amount)
        if withdrawal_amount > round(current_hosted, 2) + 0.001:
            acc_obj = db.query(Account).filter(Account.id == target_acc_id).first() if target_acc_id else None
            acc_name = acc_obj.name if acc_obj else "Compte principal"
            raise HTTPException(
                status_code=400,
                detail=f"Retrait impossible : le compte '{acc_name}' ne contient que {round(current_hosted, 2):,.2f} € d'épargne dans cette tirelire.".replace(",", " ").replace(".", ",")
            )

    alloc = BudgetAllocation(
        budget_id=budget_id,
        amount=data.amount,
        date=safe_parse_budget_date(data.date, "date") if data.date else date.today(),
        note=data.note,
        account_id=data.account_id,
        created_at=datetime.now().isoformat(),
    )
    db.add(alloc)
    db.flush()
    action_id = record_action(db, "budget_allocation", alloc.id, "CREATE", None, snapshot_entity(alloc))
    db.commit()
    db.refresh(alloc)
    return {
        "id": alloc.id,
        "budget_id": alloc.budget_id,
        "amount": alloc.amount,
        "date": alloc.date.isoformat() if alloc.date else None,
        "note": alloc.note,
        "account_id": alloc.account_id,
        "created_at": alloc.created_at,
        "action_id": action_id,
    }

def delete_allocation_data(budget_id: int, alloc_id: int, db: Session):
    alloc = db.query(BudgetAllocation).filter(
        BudgetAllocation.id == alloc_id,
        BudgetAllocation.budget_id == budget_id
    ).first()
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation non trouvée.")
    old_snapshot = snapshot_entity(alloc)
    db.delete(alloc)
    action_id = record_action(db, "budget_allocation", alloc_id, "DELETE", old_snapshot, None)
    db.commit()
    return {"ok": True, "action_id": action_id}

def compute_savings_overflow_data(db: Session):
    try:
        from app.services.finance_engine import calculate_rest_to_live, predict_next_paycheck
        today = date.today()
        pay_info = predict_next_paycheck(db)
        next_pay_date = pay_info.get("date") if isinstance(pay_info, dict) else None
        rest_to_live = calculate_rest_to_live(db, today, next_pay_date)
        if rest_to_live < 0:
            savings_budgets = db.query(Budget).filter(Budget.is_closed == False, Budget.envelope_type == "savings").all()
            if not savings_budgets:
                return None
            savings_ids = [b.id for b in savings_budgets]
            allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(savings_ids)).all()
            txs = db.query(Transaction.budget_id, Transaction.type, Transaction.amount).filter(Transaction.budget_id.in_(savings_ids)).all()
            
            alloc_by_b = {}
            for a in allocs:
                alloc_by_b.setdefault(a.budget_id, []).append(a)
            tx_by_b = {}
            for t in txs:
                tx_by_b.setdefault(t.budget_id, []).append(t)
                
            total_savings_balance = 0.0
            for b in savings_budgets:
                income = sum(abs(t.amount) for t in tx_by_b.get(b.id, []) if t.type == "income")
                expenses = sum(abs(t.amount) for t in tx_by_b.get(b.id, []) if t.type != "income")
                b_allocs = alloc_by_b.get(b.id, [])
                alloc_deposits = sum(a.amount for a in b_allocs if a.amount > 0)
                alloc_withdrawals = sum(abs(a.amount) for a in b_allocs if a.amount < 0)
                funded = income + alloc_deposits
                withdrawn = expenses + alloc_withdrawals
                balance = funded - withdrawn
                total_savings_balance += balance
                
            overflow_amount = abs(rest_to_live)
            return {
                "overflow_amount": round(overflow_amount, 2),
                "total_savings": round(max(total_savings_balance, 0), 2),
                "fully_consumed": overflow_amount >= max(total_savings_balance, 0)
            }
    except Exception as e:
        logger.warning(f"[budget] Error computing savings overflow: {e}")
    return None

def get_budget_capacity_data(db: Session):
    from app.services.finance_engine import get_accounts_available_balances
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    one_year_ago = today - timedelta(days=365)
    
    start_of_year = date(today.year, 1, 1)
    remaining_months = 12 - today.month

    org_mode_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
    is_org_mode = (org_mode_conf and org_mode_conf.value == "true")
    
    income_txs = db.query(Transaction.amount, Transaction.date_operation).filter(
        Transaction.type == "income",
        Transaction.date_operation >= one_year_ago,
        Transaction.date_operation <= today
    ).all()

    ytd_income = sum(tx.amount for tx in income_txs if tx.date_operation >= start_of_year)
    six_month_income = sum(tx.amount for tx in income_txs if tx.date_operation >= six_months_ago)
    
    avg_monthly_income = 0.0
    paycheck_data = None
    if not is_org_mode:
        from app.services.finance_engine import predict_next_paycheck
        paycheck_data = predict_next_paycheck(db)
        if paycheck_data and paycheck_data.get("amount", 0.0) > 0:
            avg_monthly_income = round(paycheck_data["amount"], 2)
            
    if avg_monthly_income == 0.0:
        avg_monthly_income = round(six_month_income / 6.0, 2)
        
    avg_yearly_income = round(ytd_income + (remaining_months * avg_monthly_income), 2)
    
    expense_txs = db.query(Transaction.amount, Transaction.date_operation).filter(
        Transaction.type.in_(["expense_fixed", "expense_var"]),
        Transaction.date_operation >= one_year_ago,
        Transaction.date_operation <= today
    ).all()
    
    ytd_expenses = sum(abs(tx.amount) for tx in expense_txs if tx.date_operation >= start_of_year)
    six_month_expenses = sum(abs(tx.amount) for tx in expense_txs if tx.date_operation >= six_months_ago)
    
    avg_monthly_expenses = round(six_month_expenses / 6.0, 2)
    avg_yearly_expenses = round(ytd_expenses + (remaining_months * avg_monthly_expenses), 2)
    
    active_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    explicit_monthly_budgeted = sum(b.monthly_amount for b in active_budgets if b.period in ("monthly", None) and (b.envelope_type or "spending") != "savings")
    explicit_yearly_budgeted = sum(b.monthly_amount for b in active_budgets if b.period == "yearly" and (b.envelope_type or "spending") != "savings")
    
    is_monthly_fallback = False
    if explicit_monthly_budgeted > 0:
        effective_monthly_budgeted = explicit_monthly_budgeted
    else:
        effective_monthly_budgeted = avg_monthly_expenses
        is_monthly_fallback = True

    is_yearly_fallback = False
    if explicit_yearly_budgeted > 0:
        effective_yearly_budgeted = (explicit_monthly_budgeted * 12) + explicit_yearly_budgeted
    else:
        effective_yearly_budgeted = avg_yearly_expenses
        is_yearly_fallback = True

    monthly_details_fr = ""
    monthly_details_en = ""
    yearly_details_fr = ""
    yearly_details_en = ""

    if is_org_mode or avg_monthly_income == round(six_month_income / 6.0, 2):
        fallback_avg_income = round(six_month_income / 6.0, 2)
        if fallback_avg_income > 0:
            avg_monthly_income = fallback_avg_income
            avg_yearly_income = round(ytd_income + (remaining_months * avg_monthly_income), 2)
        monthly_details_fr = "Basé sur la moyenne glissante des recettes des 6 derniers mois (aligné sur l'analyse des dépenses)."
        monthly_details_en = "Based on the 6-month rolling average of receipts (aligned with spending analysis)."
        yearly_details_fr = f"Recettes réelles de l'année en cours (YTD : {round(ytd_income, 2):,.2f} €) + recettes moyennes pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_details_en = f"Actual YTD receipts ({round(ytd_income, 2):,.2f} €) + average receipts for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €)."
    elif not is_org_mode and avg_monthly_income > 0 and paycheck_data and paycheck_data.get("amount", 0.0) > 0:
        monthly_details_fr = "Basé sur votre salaire mensuel prédit / configuré."
        monthly_details_en = "Based on your predicted / configured monthly salary."
        
        yearly_details_fr = f"Recettes réelles de l'année en cours (YTD : {round(ytd_income, 2):,.2f} €) + salaires prévus pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_details_en = f"Actual YTD receipts ({round(ytd_income, 2):,.2f} €) + projected salary for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €)."
    else:
        monthly_details_fr = "Basé sur la moyenne glissante des recettes des 6 derniers mois."
        monthly_details_en = "Based on the 6-month rolling average of receipts."
        
        yearly_details_fr = f"Recettes réelles de l'année en cours (YTD : {round(ytd_income, 2):,.2f} €) + recettes moyennes pour les {remaining_months} mois restants ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €).".replace(",", " ").replace(".", ",")
        yearly_details_en = f"Actual YTD receipts ({round(ytd_income, 2):,.2f} €) + average receipts for remaining {remaining_months} months ({remaining_months} × {round(avg_monthly_income, 2):,.2f} €)."

    if is_monthly_fallback:
        monthly_budgeted_details_fr = "Aucune enveloppe configurée. Estimation basée sur la moyenne de vos dépenses réelles des 6 derniers mois."
        monthly_budgeted_details_en = "No configured envelope. Estimated based on your average real spending over the last 6 months."
    else:
        monthly_budgeted_details_fr = "Montant total réservé par vos enveloppes mensuelles actives."
        monthly_budgeted_details_en = "Total amount reserved by your active monthly envelopes."

    if is_yearly_fallback:
        yearly_budgeted_details_fr = "Aucune enveloppe configurée. Estimation basée sur vos dépenses YTD + la moyenne projetée sur l'année."
        yearly_budgeted_details_en = "No configured envelope. Estimated based on YTD spending + projected yearly average."
    else:
        yearly_budgeted_details_fr = "Montant total réservé par vos enveloppes pour l'année complète (Enveloppes annuelles + 12 × Enveloppes mensuelles)."
        yearly_budgeted_details_en = "Total amount reserved by your envelopes for the full year (Yearly envelopes + 12 × Monthly envelopes)."

    account_balances = get_accounts_available_balances(db)
    
    return {
        "monthly": {
            "budgeted": round(effective_monthly_budgeted, 2),
            "average_income": avg_monthly_income,
            "engagement_ratio": round((effective_monthly_budgeted / avg_monthly_income * 100) if avg_monthly_income > 0 else 0, 1),
            "is_fallback": is_monthly_fallback,
            "details_fr": monthly_details_fr,
            "details_en": monthly_details_en,
            "budgeted_details_fr": monthly_budgeted_details_fr,
            "budgeted_details_en": monthly_budgeted_details_en,
        },
        "yearly": {
            "budgeted": round(effective_yearly_budgeted, 2),
            "average_income": avg_yearly_income,
            "engagement_ratio": round((effective_yearly_budgeted / avg_yearly_income * 100) if avg_yearly_income > 0 else 0, 1),
            "is_fallback": is_yearly_fallback,
            "details_fr": yearly_details_fr,
            "details_en": yearly_details_en,
            "budgeted_details_fr": yearly_budgeted_details_fr,
            "budgeted_details_en": yearly_budgeted_details_en,
        },
        "accounts": list(account_balances.values()),
        "savings_overflow": compute_savings_overflow_data(db)
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Étape 5 — Découverte Déterministe d'Enveloppes & Recalibrage Budgétaire
# Mode Preview/Suggestion exclusif : aucune mutation directe sans approbation
# ═══════════════════════════════════════════════════════════════════════════════

import uuid
from app.models import AutopilotDecisionLog, Notification, RecurrenceTemplate


def get_unbudgeted_categories(db: Session, lookback_months: int = 3) -> List[str]:
    """Retourne les catégories de dépenses variables actives (3 derniers mois) non encore associées à un budget.
    Exclut formellement :
    - Les revenus, transferts et virements internes
    - Les charges fixes / emprunts / prêts (gérés par les récurrences et le Reste à Vivre)
    - Les catégories inactives sans transaction dans les 3 derniers mois
    """
    from app.models import Category
    today = date.today()
    start_date = today.replace(day=1) - timedelta(days=lookback_months * 31)

    # Catégories déjà budgétées (budgets non fermés)
    budgeted_cats_q = (
        db.query(BudgetCategory.category_name)
        .join(Budget, Budget.id == BudgetCategory.budget_id)
        .filter(Budget.is_closed == False, Budget.envelope_type == "spending")
        .distinct()
    )
    budgeted_set = {row[0] for row in budgeted_cats_q.all()}

    # Catégories explicitement non-dépenses variables dans le référentiel
    non_spending_cats = db.query(Category.name).filter(
        Category.type.in_(["income", "transfer", "savings", "expense_fixed"])
    ).all()
    excluded_names = {c[0].strip().lower() for c in non_spending_cats if c[0]}

    transfer_and_loan_keywords = (
        "transfert", "compte vers compte", "virement interne", "virement",
        "épargne", "epargne", "virement compte à compte",
        "prêt", "pret", "emprunt", "crédit", "credit", "remboursement",
        "fixes", "fixe", "abonnement", "loyer", "assurance", "mutuelle"
    )

    # Catégories ayant des dépenses variables RÉELLES et RÉCENTES (3 derniers mois)
    active_cats_q = (
        db.query(Transaction.category)
        .filter(
            Transaction.category.isnot(None),
            Transaction.category != "",
            Transaction.type.in_(["expense_var", "expense"]),
            Transaction.date_operation >= start_date,
            Transaction.date_operation <= today,
            # Exclure formellement les écritures avec un compte source ET un compte cible (virements internes)
            ~(Transaction.from_account_id.isnot(None) & Transaction.to_account_id.isnot(None)),
        )
        .distinct()
    )
    active_set = {row[0] for row in active_cats_q.all()}

    orphan = [
        c for c in sorted(active_set - budgeted_set)
        if c.strip().lower() not in excluded_names
        and not any(kw in c.strip().lower() for kw in transfer_and_loan_keywords)
    ]
    logger.debug(f"[Budgets] Catégories variables orphelines récentes détectées : {len(orphan)} ({orphan[:5]}...)")
    return orphan


def _get_dismissed_categories(db: Session) -> set:
    """Retourne les catégories explicitement refusées (garantie anti-harcèlement)."""
    dismissed = (
        db.query(AutopilotDecisionLog.raw_snapshot)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_enrichment_suggestion"]),
            AutopilotDecisionLog.action == "DISMISSED",
            AutopilotDecisionLog.is_undone == False,
        )
        .all()
    )
    result = set()
    for row in dismissed:
        if row[0]:
            try:
                import json as _json
                snap = _json.loads(row[0])
                if "categories" in snap and isinstance(snap["categories"], list):
                    result.update(snap["categories"])
                elif "category" in snap:
                    result.add(snap["category"])
                if "new_category" in snap:
                    result.add(snap["new_category"])
            except Exception:
                pass
    return result


def _get_monthly_spending_for_category(db: Session, category: str, lookback_months: int = 3) -> List[float]:
    """Calcule les dépenses mensuelles par catégorie sur les N derniers mois."""
    from dateutil.relativedelta import relativedelta
    today = date.today()
    start_date = today.replace(day=1) - relativedelta(months=lookback_months)

    txs = (
        db.query(Transaction)
        .filter(
            Transaction.category == category,
            Transaction.type.notin_(["income", "transfer"]),
            ~(Transaction.from_account_id.isnot(None) & Transaction.to_account_id.isnot(None)),
            Transaction.date_operation >= start_date,
            Transaction.date_operation <= today,
        )
        .all()
    )

    # Grouper par mois
    monthly = {}
    for tx in txs:
        key = f"{tx.date_operation.year}-{tx.date_operation.month:02d}"
        monthly[key] = monthly.get(key, 0.0) + abs(tx.amount)

    # Remplir les mois vides avec 0 (inclut le mois courant)
    result = []
    cursor = start_date.replace(day=1)
    end_cursor = today.replace(day=1)
    while cursor <= end_cursor:
        key = f"{cursor.year}-{cursor.month:02d}"
        result.append(monthly.get(key, 0.0))
        cursor += relativedelta(months=1)

    return result


def _call_ollama_for_budget_grouping(cats: List[str], cat_stats: dict, ollama_cfg: dict,
                                     targets: Optional[List[dict]] = None, lang: str = "fr") -> tuple:
    """Demande à Ollama de placer les catégories orphelines : dans une enveloppe existante du même type de
    dépenses (ajout) ou dans une nouvelle enveloppe thématique. Retourne (nouvelles enveloppes, ajouts)."""
    from app.services.chat.ollama_client import call_ollama_sync
    from app.services.budget_ai_service import build_grouping_prompt, extract_json_additions, extract_json_envelopes

    targets = targets or []
    cat_lines = []
    for c in cats:
        hint = f" | e.g. {cat_stats[c]['context_hint']}" if cat_stats[c].get("context_hint") else ""
        cat_lines.append(f'- "{c}" | monthly | about {round(cat_stats[c]["avg_monthly"])} €/month{hint}')
    prompt = build_grouping_prompt(cat_lines, targets, lang)

    raw = call_ollama_sync(prompt, ollama_cfg, extra_options={"format": "json", "think": False})
    if not raw or not raw.strip():
        return [], []

    cat_lower_map = {c.strip().lower(): c for c in cats}
    assigned_cats = set()

    def _valid(names):
        out = []
        for rc in names or []:
            actual = cat_lower_map.get(str(rc).strip().lower())
            if actual and actual not in assigned_cats:
                out.append(actual)
                assigned_cats.add(actual)
        return out

    target_by_name = {t["name"].strip().lower(): t for t in targets}
    additions = []
    for add in extract_json_additions(raw):
        target = target_by_name.get(add["envelope"].strip().lower())
        valid = _valid(add["categories"]) if target else []
        if valid:
            additions.append({"target": target, "categories": valid})

    grouped_proposals = []
    for item in extract_json_envelopes(raw):
        env_name = (item.get("name") or "").strip()
        env_cats = item.get("categories") or []
        if isinstance(env_cats, str):
            env_cats = [x.strip() for x in env_cats.split(",") if x.strip()]
        target = target_by_name.get(env_name.lower())
        valid = _valid(env_cats)
        if not valid:
            continue
        if target:
            # Nom d'une enveloppe existante : c'est un ajout, pas un doublon
            additions.append({"target": target, "categories": valid})
            continue
        grouped_proposals.append({
            "name": env_name or valid[0],
            "categories": valid,
            "justification": item.get("reason") or item.get("justification") or f"Regroupement sémantique IA de {len(valid)} catégorie(s)",
        })

    # Compléter les catégories éventuellement oubliées par le LLM
    for c in cats:
        if c not in assigned_cats:
            grouped_proposals.append({
                "name": c,
                "categories": [c],
                "justification": "Catégorie non regroupée par l'IA",
            })

    return grouped_proposals, additions


DETERMINISTIC_BUDGET_THEMES = [
    {
        "name": "Alimentation & Quotidien",
        "keywords": [
            "course", "supermarch", "aliment", "boulanger", "boucher",
            "primeur", "marché", "marche", "épicerie", "epicerie",
            "nourriture", "hypermarch", "repas"
        ],
    },
    {
        "name": "Mobilité & Transports",
        "keywords": [
            "auto", "essence", "carburant", "péage", "peage", "parking",
            "garage", "entretien", "véhicule", "vehicule", "transport",
            "train", "sncf", "métro", "metro", "bus", "taxi", "uber", "covoiturage"
        ],
    },
    {
        "name": "Loisirs, Sorties & Culture",
        "keywords": [
            "restaurant", "resto", "fast food", "cinéma", "cinema", "spectacle",
            "concert", "théâtre", "theatre", "jeux", "loterie", "fdj", "steam",
            "gaming", "vacances", "voyage", "hôtel", "hotel", "camping",
            "musée", "musee", "bar", "café", "cafe", "loisir"
        ],
    },
    {
        "name": "Santé & Bien-être",
        "keywords": [
            "médecin", "medecin", "pharmacie", "santé", "sante", "docteur",
            "dentiste", "optique", "lunette", "coiffure", "coiffeur",
            "esthétique", "esthetique", "soin", "laboratoire", "médical"
        ],
    },
    {
        "name": "Mode & Habillement",
        "keywords": [
            "habillement", "vêtement", "vetement", "chaussure", "mode",
            "fringue", "prêt-à-porter", "pret-a-porter", "lingerie", "textile"
        ],
    },
    {
        "name": "Achats en ligne & E-Commerce",
        "keywords": [
            "amazon", "cdiscount", "aliexpress", "shopping", "commande",
            "colis", "fnac", "rakuten", "ebay", "vinted", "achat"
        ],
    },
    {
        "name": "Maison & Équipement",
        "keywords": [
            "bricolage", "jardin", "maison", "déco", "deco", "ameublement",
            "électronique", "electronique", "meuble", "quincaillerie",
            "leroy", "castorama", "ikea"
        ],
    },
    {
        "name": "Technologies & Numérique",
        "keywords": [
            "ia", "informatique", "logiciel", "hardware", "multimédia",
            "multimedia", "tech", "gadget", "cloud", "streaming"
        ],
    },
    {
        "name": "Divers & Dépenses courantes",
        "keywords": [
            "divers", "autre", "retrait", "courant", "imprévu", "imprevu"
        ],
    },
]


# Mots vides typiques des libellés bancaires français — filtrés lors de l'extraction contextuelle
BANKING_STOPWORDS = {
    "cb", "carte", "prlv", "sepa", "vir", "virement", "paiement",
    "facture", "sas", "sarl", "sa", "fr", "france", "paris",
    "ref", "mktp", "eu", "dab", "retrait", "achat", "avoir",
    "prelevement", "cotisation", "echeance", "remise", "lyon",
    "marseille", "bordeaux", "nantes", "lille", "toulouse",
    "prl", "eur", "com", "frais", "interets", "commission",
    "pour", "avec", "dans", "chez", "sans", "sur", "les", "des", "une", "par", "aux",
}

# Plateformes marchandes et étiquettes génériques — TOUJOURS considérées comme ambiguës
# car le nom seul ne définit pas la nature des biens achetés
AMBIGUOUS_PLATFORMS_AND_GENERIC_TERMS = {
    "amazon", "paypal", "cdiscount", "aliexpress", "ebay", "vinted",
    "fnac", "rakuten", "shein", "temu", "leboncoin", "shopping",
    "divers", "autre", "autres", "achat", "achats", "commande", "colis",
    "frais", "depenses", "dépenses", "courant", "imprévu", "imprevu", "ponctuel",
}


def _is_category_explicit(cat_name: str) -> bool:
    """Vérifie si le nom de la catégorie correspond à une nature de dépense claire et spécifique.
    
    Retourne False (ambiguë) si :
    - Le nom contient une plateforme marchande (Amazon, Paypal, Cdiscount, AliExpress, Vinted, etc.)
    - Le nom contient un terme générique (Divers, Autre, Achats, Shopping, Colis, Frais, etc.)
    - Le nom ne matche aucun mot-clé d'un thème spécifique dans DETERMINISTIC_BUDGET_THEMES.
    
    Retourne True (explicite) si le nom indique sans ambiguïté la nature de la dépense (ex: Boulangerie, Essence, Médecin).
    """
    cat_lower = cat_name.strip().lower()

    # 1. Garde-fou strict : marchands et termes génériques sont TOUJOURS ambigus
    if any(term in cat_lower for term in AMBIGUOUS_PLATFORMS_AND_GENERIC_TERMS):
        return False

    # 2. Vérifier si un thème SPÉCIFIQUE (hors thèmes fourre-tout / e-commerce) est matché
    for theme in DETERMINISTIC_BUDGET_THEMES:
        if theme["name"] in ("Achats en ligne & E-Commerce", "Divers & Dépenses courantes"):
            continue
        if any(kw in cat_lower for kw in theme["keywords"]):
            return True

    return False


def _extract_category_context_hints(db: Session, category: str, sample_size: int = 15) -> Optional[str]:
    """Extrait les termes les plus fréquents des descriptions de transactions récentes d'une catégorie ambiguë.
    
    Retourne None immédiatement si la catégorie est explicite (matche un mot-clé thématique spécifique).
    Retourne None si aucun token significatif n'est trouvé après nettoyage.
    
    Exemple de retour : "calfeutrage, clim, eclairage, led"
    """
    import re as _re
    from collections import Counter

    # Court-circuit : pas d'extraction pour les catégories déjà explicites
    if _is_category_explicit(category):
        return None

    # Récupérer les N dernières transactions de cette catégorie (hors virements et revenus)
    txs = (
        db.query(Transaction.description)
        .filter(
            Transaction.category == category,
            Transaction.type.notin_(["income", "transfer"]),
            Transaction.description.isnot(None),
        )
        .order_by(Transaction.date_operation.desc())
        .limit(sample_size)
        .all()
    )

    if not txs:
        return None

    # Exclure les tokens qui font déjà partie du nom de la catégorie (ex: 'amazon')
    cat_tokens = set(_re.sub(r"[^\w]+", " ", category.lower()).split())
    token_counter = Counter()

    for (desc,) in txs:
        if not desc:
            continue
        text = desc.lower()
        # Supprimer les dates (12/08, 12.08.2026, etc.)
        text = _re.sub(r"\d{2}[/.]\d{2}(?:[/.]\d{2,4})?", " ", text)
        # Supprimer les montants (42,50 €, 42.50€, etc.)
        text = _re.sub(r"\d+[.,]\d{2}\s*€?", " ", text)
        # Supprimer les codes hexadécimaux et numériques longs (REF8294, CB*1234, etc.)
        text = _re.sub(r"\b[a-f0-9]{5,}\b", " ", text)
        text = _re.sub(r"\b\d{4,}\b", " ", text)
        # Supprimer les caractères spéciaux et astérisques
        text = _re.sub(r"[*_/\\#@&|(){}[\]<>:;,.\-+='\"!?€$£]+", " ", text)
        # Tokeniser et filtrer
        tokens = text.split()
        for tok in tokens:
            tok = tok.strip()
            if len(tok) < 3:
                continue
            if tok in BANKING_STOPWORDS or tok in cat_tokens:
                continue
            # Ignorer les tokens purement numériques
            if tok.isdigit():
                continue
            token_counter[tok] += 1

    if not token_counter:
        return None

    # Retourner jusqu'à 4 termes les plus fréquents
    top_terms = [term for term, _ in token_counter.most_common(4)]
    return ", ".join(top_terms)


def _cluster_categories_deterministically(cat_stats: dict, engine_tag: str = "deterministic") -> list:
    """Regroupe intelligemment les catégories orphelines en enveloppes thématiques cohérentes.
    Garantit 100% hors-ligne un résultat structuré évitant le piège du '1 catégorie = 1 enveloppe'.
    """
    assigned = set()
    proposals = []

    for theme in DETERMINISTIC_BUDGET_THEMES:
        theme_name = theme["name"]
        keywords = theme["keywords"]
        matching = []
        for cat in cat_stats:
            if cat in assigned:
                continue
            cat_lower = cat.strip().lower()
            is_ambiguous = any(term in cat_lower for term in AMBIGUOUS_PLATFORMS_AND_GENERIC_TERMS)

            matched = False
            # Match par hints contextuels en priorité si disponible (pour orienter les catégories ambiguës)
            hint = cat_stats[cat].get("context_hint", "")
            if hint:
                hint_tokens = [t.strip() for t in hint.split(",")]
                matched = any(kw in ht for ht in hint_tokens for kw in keywords)

            # Match par nom de catégorie si pas de match hint (ou catégorie non ambiguë)
            if not matched and (not is_ambiguous or theme_name in ("Achats en ligne & E-Commerce", "Divers & Dépenses courantes")):
                matched = any(kw in cat_lower for kw in keywords)

            if matched:
                matching.append(cat)
                assigned.add(cat)

        if matching:
            total_amt = round(sum(cat_stats[c]["suggested_amount"] for c in matching), 2)
            max_obs = max(cat_stats[c]["observed_months"] for c in matching)
            envelope_name = theme_name if len(matching) > 1 else matching[0]
            justification = (
                f"Regroupement thématique déterministe ({len(matching)} catégories)"
                if len(matching) > 1
                else f"Moyenne constatée sur {max_obs} mois"
            )
            proposals.append({
                "name": envelope_name,
                "categories": matching,
                "suggested_amount": total_amt,
                "avg_monthly": total_amt,
                "observed_months": max_obs,
                "engine": engine_tag,
                "justification": justification,
            })

    # Catégories orphelines restantes non répertoriées dans la taxonomie standard
    remaining = [c for c in cat_stats if c not in assigned]
    for cat in remaining:
        st = cat_stats[cat]
        proposals.append({
            "name": cat,
            "categories": [cat],
            "suggested_amount": st["suggested_amount"],
            "avg_monthly": st["avg_monthly"],
            "observed_months": st["observed_months"],
            "monthly_values": st.get("monthly_values", []),
            "engine": engine_tag,
            "justification": f"Moyenne constatée sur {st['observed_months']} mois",
        })

    return proposals


def _detect_envelope_enrichments(db: Session, cat_stats: dict, chosen_engine: str = "deterministic") -> tuple:
    """Détecte si certaines catégories orphelines ont une affinité naturelle avec des enveloppes ouvertes existantes.
    
    Returns:
        (enrichment_proposals: list, remaining_cat_stats: dict)
    """
    open_budgets = (
        db.query(Budget)
        .filter(
            Budget.is_closed == False,
            Budget.is_project == False,
            Budget.envelope_type == "spending"
        )
        .all()
    )
    if not open_budgets:
        return [], cat_stats

    # Associer chaque budget ouvert à ses catégories actuelles et déterminer son thème
    budget_theme_map = {}
    for b in open_budgets:
        cats = [
            bc.category_name.strip().lower()
            for bc in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all()
        ]
        b_name_lower = b.name.strip().lower()
        matched_t = None
        for theme in DETERMINISTIC_BUDGET_THEMES:
            t_keywords = theme["keywords"]
            if any(kw in b_name_lower for kw in t_keywords) or any(any(kw in c for kw in t_keywords) for c in cats):
                matched_t = theme
                break
        budget_theme_map[b.id] = matched_t

    enrichments = []
    enriched_cats = set()

    for cat, stats in cat_stats.items():
        cat_lower = cat.strip().lower()
        
        # 1. Recherche par thème partagé (nom de catégorie)
        best_budget = None
        for b in open_budgets:
            theme = budget_theme_map.get(b.id)
            if theme and any(kw in cat_lower for kw in theme["keywords"]):
                best_budget = b
                break

        # 1b. Recherche par thème partagé via hints contextuels (catégories ambiguës)
        if not best_budget:
            hint = stats.get("context_hint", "")
            if hint:
                hint_tokens = [t.strip() for t in hint.split(",")]
                for b in open_budgets:
                    theme = budget_theme_map.get(b.id)
                    if theme and any(kw in ht for ht in hint_tokens for kw in theme["keywords"]):
                        best_budget = b
                        break

        # 2. Si pas de match thématique, recherche par inclusion de nom
        if not best_budget:
            for b in open_budgets:
                b_name_lower = b.name.strip().lower()
                if (cat_lower in b_name_lower or b_name_lower in cat_lower) and len(cat_lower) >= 4:
                    best_budget = b
                    break

        if best_budget:
            add_amt = stats["suggested_amount"]
            cur_amt = best_budget.monthly_amount
            new_tot = round(cur_amt + add_amt, 2)
            enrichments.append({
                "type": "enrichment",
                "target_budget_id": best_budget.id,
                "target_budget_name": best_budget.name,
                "name": best_budget.name,
                "category": cat,
                "new_category": cat,
                "categories": [cat],
                "additional_amount": add_amt,
                "current_amount": cur_amt,
                "suggested_amount": new_tot,
                "avg_monthly": add_amt,
                "observed_months": stats["observed_months"],
                "monthly_values": stats.get("monthly_values", []),
                "engine": "deterministic",
                "justification": f"Rattachement de '{cat}' à l'enveloppe existante '{best_budget.name}' (+{add_amt} €/mois)",
                "is_one_off": False,
            })
            enriched_cats.add(cat)

    remaining_stats = {c: s for c, s in cat_stats.items() if c not in enriched_cats}
    return enrichments, remaining_stats


def suggest_new_envelopes(
    db: Session,
    profile_id_or_force: Union[str, bool, None] = None,
    force: bool = False,
    engine_override: Optional[str] = None,
) -> List[dict]:
    """Volet A — Détection et suggestion de création d'enveloppes pour les catégories orphelines.
    
    Supporte deux moteurs configurables :
    1. Déterministe (défaut) : calcul Winsorisé 100% hors-ligne avec clustering thématique, zéro dépendance Ollama.
    2. Assisté par IA (Ollama) : regroupement sémantique multi-catégories avec fallback automatique transparent si Ollama est indisponible.
    """
    if isinstance(profile_id_or_force, bool):
        force = profile_id_or_force
        profile_id = None
    else:
        profile_id = profile_id_or_force

    cfg_enabled = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_creation_suggestions").first()
    if cfg_enabled and cfg_enabled.value and cfg_enabled.value.strip().lower() == "false":
        logger.debug("[Budgets] Suggestions de création désactivées par l'utilisateur.")
        return []

    # Horodatage du cycle d'analyse
    now_iso = datetime.now(timezone.utc).isoformat()
    cfg_last = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_autopilot_run_at").first()
    if cfg_last:
        cfg_last.value = now_iso
    else:
        db.add(GlobalConfig(key="last_budget_autopilot_run_at", value=now_iso))
    db.commit()

    orphan_cats = get_unbudgeted_categories(db)
    if not orphan_cats:
        logger.debug("[AutoPilot Budgets] Aucune catégorie orpheline détectée.")
        return []

    # Exclure les catégories déjà refusées
    dismissed = _get_dismissed_categories(db)

    # Exclure les catégories ayant déjà une suggestion SUGGESTED en cours
    already_suggested = set()
    pending = (
        db.query(AutopilotDecisionLog.raw_snapshot)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_enrichment_suggestion"]),
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.is_undone == False,
        )
        .all()
    )
    for row in pending:
        if row[0]:
            try:
                import json as _json
                snap = _json.loads(row[0])
                if "categories" in snap and isinstance(snap["categories"], list):
                    already_suggested.update(snap["categories"])
                elif "category" in snap:
                    already_suggested.add(snap["category"])
                if "new_category" in snap:
                    already_suggested.add(snap["new_category"])
            except Exception:
                pass

    eligible_cats = [c for c in orphan_cats if c not in dismissed and c not in already_suggested]
    # Les charges prévues sont suivies par les récurrences : pas d'enveloppe à proposer
    recurring = recurring_charge_categories(db, eligible_cats)
    eligible_cats = [c for c in eligible_cats if c not in recurring]
    if not eligible_cats:
        return []

    # Seuil plancher configurable
    min_threshold = 1.0
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_minimum_threshold").first()
    if cfg and cfg.value:
        try:
            min_threshold = float(cfg.value)
        except (ValueError, TypeError):
            pass

    # Vérifier si l'option d'auto-création est activée
    cfg_auto_create = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_create_budget_envelopes").first()
    if cfg_auto_create and cfg_auto_create.value is not None:
        is_auto_create = cfg_auto_create.value.strip().lower() in ("true", "1", "yes", "on")
    else:
        from app.services.autopilot_service import is_autopilot_enabled
        is_auto_create = is_autopilot_enabled(db)

    # Moteur sélectionné (déterministe par défaut)
    engine_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_suggestion_engine").first()
    chosen_engine = (engine_override or (engine_cfg.value if engine_cfg else None) or "deterministic").strip().lower()

    # Calculer les métriques d'historique de chaque catégorie éligible (avec filtre strict >= 2 mois)
    cat_stats = {}
    for cat in eligible_cats:
        monthly_vals = _get_monthly_spending_for_category(db, cat, lookback_months=3)
        non_zero = [v for v in monthly_vals if v > 0]
        if len(non_zero) < 2:
            continue
        cleaned, _, _ = winsorize_values(non_zero, sensitivity=3)
        avg = sum(cleaned) / len(cleaned) if cleaned else 0.0
        if avg > 0:
            cat_stats[cat] = {
                "monthly_values": [round(v, 2) for v in monthly_vals],
                "observed_months": len(non_zero),
                "avg_monthly": round(avg, 2),
                "suggested_amount": round(avg, 2),
            }

    # Enrichir les catégories ambiguës avec des hints contextuels extraits des transactions récentes
    for cat in cat_stats:
        hint = _extract_category_context_hints(db, cat)
        if hint:
            cat_stats[cat]["context_hint"] = hint
            logger.debug(f"[Budgets] Hint contextuel pour '{cat}' : {hint}")

    if not cat_stats:
        return []

    # 1. Détection d'enrichissement d'enveloppes existantes
    enrichment_proposals, remaining_cat_stats = _detect_envelope_enrichments(db, cat_stats, chosen_engine)

    # 2. Regroupement / clustering des catégories orphelines restantes
    proposals_data = []
    if remaining_cat_stats:
        if chosen_engine == "ai":
            from app.services.chat.ollama_client import get_ollama_config
            ollama_cfg = get_ollama_config(db)
            ai_success = False
            if ollama_cfg.get("enabled") and ollama_cfg.get("url") and ollama_cfg.get("model"):
                try:
                    targets = envelopes_open_to_new_categories(db)
                    ai_groups, ai_additions = _call_ollama_for_budget_grouping(
                        list(remaining_cat_stats.keys()), remaining_cat_stats, ollama_cfg, targets)
                    for add in ai_additions:
                        t = add["target"]
                        for cat in add["categories"]:
                            st = remaining_cat_stats[cat]
                            enrichment_proposals.append({
                                "type": "enrichment",
                                "target_budget_id": t["id"],
                                "target_budget_name": t["name"],
                                "name": t["name"],
                                "category": cat,
                                "new_category": cat,
                                "categories": [cat],
                                "additional_amount": st["suggested_amount"],
                                "current_amount": t["amount"],
                                "suggested_amount": round(t["amount"] + st["suggested_amount"] * (12 if t["period"] == "yearly" else 1), 2),
                                "avg_monthly": st["suggested_amount"],
                                "observed_months": st["observed_months"],
                                "monthly_values": st.get("monthly_values", []),
                                "engine": "ai",
                                "justification": f"Rattachement de '{cat}' à l'enveloppe existante '{t['name']}' (même type de dépenses)",
                                "is_one_off": False,
                            })
                    if ai_groups or ai_additions:
                        for grp in ai_groups:
                            grp_cats = [c for c in grp.get("categories", []) if c in remaining_cat_stats]
                            if not grp_cats:
                                continue
                            total_amt = round(sum(remaining_cat_stats[c]["suggested_amount"] for c in grp_cats), 2)
                            max_obs = max(remaining_cat_stats[c]["observed_months"] for c in grp_cats)
                            proposals_data.append({
                                "name": grp.get("name") or grp_cats[0],
                                "categories": grp_cats,
                                "suggested_amount": total_amt,
                                "avg_monthly": total_amt,
                                "observed_months": max_obs,
                                "engine": "ai",
                                "justification": grp.get("justification") or f"Regroupement sémantique IA ({len(grp_cats)} catégories)",
                            })
                        ai_success = True
                except Exception as e:
                    logger.warning(f"[AutoPilot Budgets] Échec appel IA Ollama ({e}). Repli automatique sur le moteur déterministe.")

            if not ai_success:
                proposals_data = _cluster_categories_deterministically(remaining_cat_stats, engine_tag="deterministic_fallback")
        else:
            proposals_data = _cluster_categories_deterministically(remaining_cat_stats, engine_tag="deterministic")

    batch_id = str(uuid.uuid4())
    suggestions = []
    import json as _json

    # A. Enregistrement des propositions d'enrichissement d'enveloppes
    for prop in enrichment_proposals:
        snapshot = _json.dumps({
            "name": prop["target_budget_name"],
            "target_budget_id": prop["target_budget_id"],
            "target_budget_name": prop["target_budget_name"],
            "new_category": prop["new_category"],
            "category": prop["new_category"],
            "categories": [prop["new_category"]],
            "additional_amount": prop["additional_amount"],
            "current_amount": prop["current_amount"],
            "suggested_amount": prop["suggested_amount"],
            "avg_monthly": prop["additional_amount"],
            "observed_months": prop["observed_months"],
            "monthly_values": prop.get("monthly_values", []),
            "engine": prop["engine"],
            "justification": prop.get("justification", ""),
            "is_one_off": False,
        })

        action_status = "SUGGESTED"
        target_budget_id = prop["target_budget_id"]

        if is_auto_create and prop["observed_months"] >= 2:
            from app.services.history_service import record_action, snapshot_entity
            b = db.query(Budget).filter(Budget.id == target_budget_id).first()
            if b and not b.is_closed and free_categories(
                    db, [prop["new_category"]], b.period, b.start_date, b.end_date,
                    parse_account_ids(b.account_ids), exclude_id=b.id):
                old_snap = snapshot_entity(b, db)
                existing_bc = db.query(BudgetCategory).filter(
                    BudgetCategory.budget_id == b.id,
                    BudgetCategory.category_name == prop["new_category"]
                ).first()
                if not existing_bc:
                    db.add(BudgetCategory(budget_id=b.id, category_name=prop["new_category"]))
                    db.flush()
                b.monthly_amount = prop["suggested_amount"]
                b.base_annual_amount = prop["suggested_amount"] * 12 if b.period != "yearly" else prop["suggested_amount"]
                db.flush()
                record_action(db, "budget", b.id, "UPDATE", old_snap, snapshot_entity(b, db))
                action_status = "AUTO_COMMIT"
                logger.info(f"[AutoPilot Budgets] Auto-enrichissement de l'enveloppe '{b.name}' avec '{prop['new_category']}' ({prop['suggested_amount']} €).")

        decision = AutopilotDecisionLog(
            batch_id=batch_id,
            decision_type="budget_enrichment_suggestion",
            action=action_status,
            entity_type="budget",
            entity_id=target_budget_id,
            conn_id=-1,
            account_id=None,
            raw_snapshot=snapshot,
            confidence_score=90.0 if prop["observed_months"] >= 2 else 65.0,
        )
        db.add(decision)
        db.flush()

        if action_status == "SUGGESTED":
            suggestions.append({
                "decision_id": decision.id,
                "type": "enrichment",
                "target_budget_id": target_budget_id,
                "name": prop["target_budget_name"],
                "target_budget_name": prop["target_budget_name"],
                "category": prop["new_category"],
                "new_category": prop["new_category"],
                "categories": [prop["new_category"]],
                "additional_amount": prop["additional_amount"],
                "current_amount": prop["current_amount"],
                "suggested_amount": prop["suggested_amount"],
                "avg_monthly": prop["additional_amount"],
                "observed_months": prop["observed_months"],
                "engine": prop["engine"],
                "justification": prop.get("justification", ""),
                "is_one_off": False,
            })

    # B. Enregistrement des propositions de création de nouvelles enveloppes
    for prop in proposals_data:
        cats = free_categories(db, prop["categories"])  # jamais deux enveloppes sur la même catégorie
        if not cats:
            continue
        main_cat = cats[0] if len(cats) == 1 else prop["name"]

        snapshot = _json.dumps({
            "name": prop["name"],
            "category": main_cat,
            "categories": cats,
            "suggested_amount": prop["suggested_amount"],
            "avg_monthly": prop["avg_monthly"],
            "observed_months": prop["observed_months"],
            "monthly_values": prop.get("monthly_values", []),
            "engine": prop["engine"],
            "justification": prop.get("justification", ""),
            "is_one_off": False,
        })

        action_status = "SUGGESTED"
        created_budget_id = None

        if is_auto_create and prop["observed_months"] >= 2:
            from app.services.history_service import record_action, snapshot_entity
            b = Budget(
                name=prop["name"],
                monthly_amount=prop["suggested_amount"],
                period="monthly",
                is_project=False,
                is_closed=False,
                envelope_type="spending",
                is_locked=False,
                base_annual_amount=prop["suggested_amount"] * 12,
            )
            db.add(b)
            db.flush()
            for c in cats:
                db.add(BudgetCategory(budget_id=b.id, category_name=c))
            db.flush()
            record_action(db, "budget", b.id, "CREATE", None, snapshot_entity(b, db))
            action_status = "AUTO_COMMIT"
            created_budget_id = b.id
            logger.info(f"[AutoPilot Budgets] Auto-création de l'enveloppe '{prop['name']}' ({prop['suggested_amount']} €).")

        decision = AutopilotDecisionLog(
            batch_id=batch_id,
            decision_type="budget_creation_suggestion",
            action=action_status,
            entity_type="budget",
            entity_id=created_budget_id,
            conn_id=-1,
            account_id=None,
            raw_snapshot=snapshot,
            confidence_score=85.0 if prop["observed_months"] >= 2 else 60.0,
        )
        db.add(decision)
        db.flush()

        if action_status == "SUGGESTED":
            suggestions.append({
                "decision_id": decision.id,
                "type": "creation",
                "name": prop["name"],
                "category": main_cat,
                "categories": cats,
                "suggested_amount": prop["suggested_amount"],
                "avg_monthly": prop["avg_monthly"],
                "observed_months": prop["observed_months"],
                "engine": prop["engine"],
                "justification": prop.get("justification", ""),
                "is_one_off": False,
            })

    # Mettre à jour l'horodatage de dernière analyse de l'auto-pilote
    now_iso = datetime.now(timezone.utc).isoformat()
    cfg_last = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_autopilot_run_at").first()
    if cfg_last:
        cfg_last.value = now_iso
    else:
        db.add(GlobalConfig(key="last_budget_autopilot_run_at", value=now_iso))

    if suggestions or is_auto_create:
        db.commit()
        logger.info(f"[AutoPilot Budgets] Cycle de découverte terminé ({chosen_engine}) : {len(suggestions)} suggestion(s) en attente.")
    else:
        db.commit()

    return suggestions


# Alias de compatibilité
suggest_new_envelopes_deterministic = suggest_new_envelopes


def calculate_envelope_historical_spending(
    db: Session, budget: Budget, lookback_months: int = 3, sensitivity: int = 3
) -> tuple:
    """Calcule les dépenses mensuelles des catégories associées à une enveloppe avec Winsorizing
    et extrait le détail précis par catégorie (breakdown).
    
    Returns:
        (avg_spending, observed_months, monthly_values, category_breakdown)
    """
    cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget.id).all()
    cat_names = [c.category_name for c in cats]
    if not cat_names:
        return 0.0, 0, [], []

    today = date.today()
    start_date = today.replace(day=1) - timedelta(days=lookback_months * 31)

    txs = (
        db.query(Transaction)
        .filter(
            Transaction.category.in_(cat_names),
            Transaction.type.notin_(["income", "transfer"]),
            ~(Transaction.from_account_id.isnot(None) & Transaction.to_account_id.isnot(None)),
            Transaction.date_operation >= start_date,
            Transaction.date_operation < today.replace(day=1),
        )
        .all()
    )

    # Breakdown détaillé par catégorie individuelle
    category_breakdown = []
    for cname in cat_names:
        c_txs = [tx for tx in txs if tx.category == cname]
        c_total = sum(abs(tx.amount) for tx in c_txs)
        c_avg = c_total / lookback_months if lookback_months > 0 else 0.0
        category_breakdown.append({
            "category": cname,
            "total_spending": round(c_total, 2),
            "avg_monthly": round(c_avg, 2),
        })
    category_breakdown.sort(key=lambda x: x["avg_monthly"], reverse=True)

    # Grouper par mois
    monthly = {}
    for tx in txs:
        key = f"{tx.date_operation.year}-{tx.date_operation.month:02d}"
        monthly[key] = monthly.get(key, 0.0) + abs(tx.amount)

    # Construire la série chronologique complète
    values = []
    cursor = start_date.replace(day=1)
    end_cursor = today.replace(day=1)
    while cursor < end_cursor:
        key = f"{cursor.year}-{cursor.month:02d}"
        values.append(monthly.get(key, 0.0))
        if cursor.month == 12:
            cursor = cursor.replace(year=cursor.year + 1, month=1)
        else:
            cursor = cursor.replace(month=cursor.month + 1)

    non_zero = [v for v in values if v > 0]
    if not non_zero:
        return 0.0, 0, values, category_breakdown

    cleaned, _, _ = winsorize_values(non_zero, sensitivity=sensitivity)
    avg = sum(cleaned) / len(cleaned) if cleaned else 0.0

    return round(avg, 2), len(non_zero), [round(v, 2) for v in values], category_breakdown


def compute_budget_ema_suggestion(
    current_budget: float,
    avg_spending: float,
    base_annual_amount: float,
    observed_months: int,
    min_threshold: float,
    alpha: float = 0.20,
) -> dict:
    """Calcule la suggestion EMA avec double plafond de dérive (±10%/mois, ±25%/an).
    
    Returns:
        dict avec suggested_amount, delta_pct, drift_limit_reached, raw_ema
    """
    if observed_months < 1 or current_budget <= 0:
        return {
            "suggested_amount": current_budget,
            "delta_pct": 0.0,
            "drift_limit_reached": False,
            "raw_ema": current_budget,
            "capped_reason": None,
        }

    # 1. Calcul brut EMA
    raw_ema = (1 - alpha) * current_budget + alpha * avg_spending

    # 2. Borne mensuelle ±10%
    max_monthly = current_budget * 1.10
    min_monthly = current_budget * 0.90
    capped = max(min(raw_ema, max_monthly), min_monthly)
    capped_reason = None
    if raw_ema > max_monthly:
        capped_reason = "monthly_cap_up"
    elif raw_ema < min_monthly:
        capped_reason = "monthly_cap_down"

    # 3. Borne annuelle ±25% vs base_annual_amount
    drift_limit_reached = False
    if base_annual_amount and base_annual_amount > 0:
        monthly_base = base_annual_amount / 12.0
        max_annual = monthly_base * 1.25
        min_annual = monthly_base * 0.75
        if capped > max_annual:
            capped = max_annual
            drift_limit_reached = True
            capped_reason = "annual_cap_up"
        elif capped < min_annual:
            capped = min_annual
            drift_limit_reached = True
            capped_reason = "annual_cap_down"

    # 4. Seuil plancher
    capped = max(capped, min_threshold)

    suggested = round(capped, 2)
    delta_pct = round(((suggested - current_budget) / current_budget) * 100, 1) if current_budget > 0 else 0.0

    return {
        "suggested_amount": suggested,
        "delta_pct": delta_pct,
        "drift_limit_reached": drift_limit_reached,
        "raw_ema": round(raw_ema, 2),
        "capped_reason": capped_reason,
    }


RECALIBRATION_PERIODS = 3
UNDER_USE_RATIO = 0.6


def _round_up_5(amount: float) -> float:
    return max(5.0, math.ceil(amount / 5.0) * 5.0)


def _envelope_spend_between(db: Session, budget: Budget, cats: List[str], start: date, end: date) -> tuple:
    """Dépense nette (dépenses - remboursements) d'une enveloppe entre deux dates, et détail par catégorie."""
    if not cats:
        return 0.0, {}
    acc_ids = set(parse_account_ids(budget.account_ids))
    rows = db.query(Transaction.category, Transaction.type, Transaction.amount,
                    Transaction.from_account_id, Transaction.to_account_id).filter(
        Transaction.category.in_(cats),
        Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        Transaction.date_operation >= start,
        Transaction.date_operation <= end,
    ).all()
    by_cat = {}
    for cat, typ, amount, from_id, to_id in rows:
        if acc_ids and from_id not in acc_ids and to_id not in acc_ids:
            continue
        signed = -abs(amount or 0.0) if typ == "income" else abs(amount or 0.0)
        by_cat[cat] = by_cat.get(cat, 0.0) + signed
    return max(sum(by_cat.values()), 0.0), by_cat


def evaluate_monthly_budget_suggestions(
    db: Session,
    profile_id_or_force: Union[str, bool, None] = None,
    force: bool = False,
) -> List[dict]:
    """Volet B — Recalibrage des enveloppes mensuelles : signaler, ne jamais appliquer seul.

    Un plafond est un objectif : il ne suit plus la dépense mois après mois. Une suggestion (arrondie à 5 €)
    n'est émise que si l'enveloppe a été dépassée, ou utilisée à moins de 60 %, sur chacune des 3 dernières
    périodes terminées (cycles de paie en mode personnel, mois en mode organisation). Les enveloppes de
    charges fixes (suivies par les récurrences) et les enveloppes verrouillées ne sont pas concernées.
    Exécuté une fois par période, sauf force=True.
    """
    import statistics
    import json as _json
    from app.models import Notification

    if isinstance(profile_id_or_force, bool):
        force = profile_id_or_force

    cfg_enabled = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_recalibration_suggestions").first()
    if cfg_enabled and cfg_enabled.value and cfg_enabled.value.strip().lower() == "false":
        logger.debug("[Budgets] Suggestions de recalibrage désactivées par l'utilisateur.")
        return []

    today = date.today()
    current = budget_period(db, 0, today)
    period_key = current["start"]
    if not force:
        cfg_period = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_recalibration_period").first()
        if cfg_period and cfg_period.value == period_key:
            logger.debug(f"[AutoPilot Budgets] Période {period_key} déjà évaluée. Anti-thrashing actif.")
            return []

    now_iso = datetime.now(timezone.utc).isoformat()
    _set_config(db, "last_budget_autopilot_run_at", now_iso)

    min_threshold = 1.0
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "budget_minimum_threshold").first()
    if cfg and cfg.value:
        try:
            min_threshold = float(cfg.value)
        except (ValueError, TypeError):
            pass

    # Nouvelle période : les suggestions non traitées de la précédente sont remplacées par celles-ci
    db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.decision_type == "budget_suggestion",
        AutopilotDecisionLog.action == "SUGGESTED",
        AutopilotDecisionLog.is_undone == False,
    ).update({"action": "EXPIRED"}, synchronize_session=False)

    budgets = (
        db.query(Budget)
        .filter(
            Budget.envelope_type == "spending",
            (Budget.period == "monthly") | (Budget.period.is_(None)),
            Budget.is_project == False,
            Budget.is_closed == False,
            Budget.is_locked == False,
        )
        .all()
    )
    cats_by_budget = {}
    for bc in db.query(BudgetCategory).filter(BudgetCategory.budget_id.in_([b.id for b in budgets])).all():
        cats_by_budget.setdefault(bc.budget_id, []).append(bc.category_name)
    fixed_ids = _fixed_envelope_ids(db, budgets, cats_by_budget, today) if not is_org_mode(db) else set()

    dismissed_ids = {
        row[0] for row in db.query(AutopilotDecisionLog.entity_id).filter(
            AutopilotDecisionLog.decision_type == "budget_suggestion",
            AutopilotDecisionLog.action == "DISMISSED",
            AutopilotDecisionLog.entity_type == "budget",
            AutopilotDecisionLog.is_undone == False,
            AutopilotDecisionLog.created_at >= datetime.fromisoformat(period_key),
        ).all() if row[0]
    }

    # Périodes terminées, de la plus ancienne à la plus récente
    periods = [budget_period(db, -k, today) for k in range(RECALIBRATION_PERIODS, 0, -1)]

    batch_id = str(uuid.uuid4())
    suggestions = []
    for b in budgets:
        cats = cats_by_budget.get(b.id, [])
        limit = float(b.monthly_amount or 0.0)
        if b.id in fixed_ids or b.id in dismissed_ids or not cats or limit <= 0:
            continue

        values, totals_by_cat = [], {}
        for p in periods:
            spent, by_cat = _envelope_spend_between(db, b, cats, date.fromisoformat(p["start"]), date.fromisoformat(p["end"]))
            values.append(round(spent, 2))
            for cat, amount in by_cat.items():
                totals_by_cat[cat] = totals_by_cat.get(cat, 0.0) + amount

        typical = statistics.median(values)
        if all(v > limit for v in values):
            direction = "up"
        elif max(values) > 0 and all(v < limit * UNDER_USE_RATIO for v in values):  # sans aucune dépense : enveloppe récente ou saisonnière
            direction = "down"
        else:
            continue
        suggested = _round_up_5(max(typical, min_threshold))
        if abs(suggested - limit) < max(5.0, limit * 0.05):
            continue
        delta_pct = round((suggested - limit) / limit * 100, 1)

        category_breakdown = sorted(
            ({"category": c, "total_spending": round(t, 2), "avg_monthly": round(t / len(periods), 2)}
             for c, t in totals_by_cat.items()),
            key=lambda x: x["avg_monthly"], reverse=True)
        snapshot = _json.dumps({
            "budget_id": b.id,
            "budget_name": b.name,
            "current_amount": limit,
            "suggested_amount": suggested,
            "delta_pct": delta_pct,
            "direction": direction,
            "avg_spending": round(typical, 2),
            "observed_months": len(periods),
            "monthly_values": values,
            "periods": [{"start": p["start"], "end": p["end"], "spent": v} for p, v in zip(periods, values)],
            "period_kind": current["kind"],
            "drift_limit_reached": False,
            "raw_ema": suggested,
            "base_annual_amount": b.base_annual_amount or limit * 12,
            "categories": cats,
            "category_breakdown": category_breakdown,
        })
        decision = AutopilotDecisionLog(
            batch_id=batch_id,
            decision_type="budget_suggestion",
            action="SUGGESTED",
            entity_type="budget",
            entity_id=b.id,
            conn_id=-1,
            account_id=None,
            raw_snapshot=snapshot,
            confidence_score=80.0,
        )
        db.add(decision)
        db.flush()
        suggestions.append({
            "decision_id": decision.id,
            "type": "recalibration",
            "budget_id": b.id,
            "budget_name": b.name,
            "current_amount": limit,
            "suggested_amount": suggested,
            "delta_pct": delta_pct,
            "direction": direction,
            "avg_spending": round(typical, 2),
            "observed_months": len(periods),
            "drift_limit_reached": False,
            "category_breakdown": category_breakdown,
        })

    _set_config(db, "last_budget_recalibration_period", period_key)
    if suggestions:
        over = sum(1 for s in suggestions if s["direction"] == "up")
        under = len(suggestions) - over
        parts = []
        if over:
            parts.append(f"{over} dépassée{'s' if over > 1 else ''}")
        if under:
            parts.append(f"{under} peu utilisée{'s' if under > 1 else ''}")
        db.add(Notification(
            type="autopilot_budget",
            title=f"📊 {len(suggestions)} enveloppe{'s' if len(suggestions) > 1 else ''} à revoir",
            content=f"Sur les {RECALIBRATION_PERIODS} dernières périodes : {' et '.join(parts)}. Plafonds proposés à valider.",
            detailed_content=None,
            link_data='{"view": "budgets"}',
        ))
        logger.info(f"[AutoPilot Budgets] {len(suggestions)} suggestion(s) de recalibrage pour la période du {period_key}.")
    db.commit()
    return suggestions


ALERT_CHECK_INTERVAL_MINUTES = 10
_ALERTS_SENT_KEY = "budget_alerts_sent"


def _fmt_eur(amount: float) -> str:
    return f"{amount:,.2f}".replace(",", " ").replace(".", ",") + " €"


def _alert_period_key(env: dict, period_info: Optional[dict]) -> Optional[str]:
    """Clé de la période en cours d'une enveloppe (None si l'enveloppe n'est pas en cours aujourd'hui)."""
    today_iso = date.today().isoformat()
    period = env.get("period")
    if period == "custom":
        start, end = env.get("start_date"), env.get("end_date")
        return start if start and end and start <= today_iso <= end else None
    if period == "yearly":
        return today_iso[:4]
    if period == "indefinite":
        return "all"
    return (period_info or {}).get("start") or today_iso[:7]


def check_envelope_alerts(db: Session, force: bool = False) -> List[dict]:
    """Notifie quand une enveloppe en cours atteint 90 % ou est dépassée (une fois par seuil et par période).
    Premier passage : l'état actuel sert de point de départ, sans notification (pas de rafale d'alertes
    sur des situations déjà connues)."""
    from app.models import Notification

    now = datetime.now(timezone.utc)
    if not force:
        row = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_alert_check_at").first()
        if row and row.value:
            try:
                if now - datetime.fromisoformat(row.value) < timedelta(minutes=ALERT_CHECK_INTERVAL_MINUTES):
                    return []
            except ValueError:
                pass
    _set_config(db, "last_budget_alert_check_at", now.isoformat())

    sent_row = db.query(GlobalConfig).filter(GlobalConfig.key == _ALERTS_SENT_KEY).first()
    baseline = sent_row is None
    try:
        sent = json.loads(sent_row.value) if sent_row and sent_row.value else []
    except ValueError:
        sent = []
    sent_set = set(sent)

    status = get_budget_status_data(db=db, period_filter="all", cycle_offset=0)
    period_info = status.get("period")
    created = []
    for env in status.get("budgets", []):
        if env.get("envelope_type") == "savings" or env.get("status") not in ("near", "over"):
            continue
        pkey = _alert_period_key(env, period_info)
        if not pkey:
            continue
        threshold = "100" if env["status"] == "over" else "90"
        key = f"{env['id']}:{pkey}:{threshold}"
        if key in sent_set or (threshold == "90" and f"{env['id']}:{pkey}:100" in sent_set):
            continue
        sent.append(key)
        sent_set.add(key)
        if baseline:
            continue
        limit, spent = env["budget_amount"], env.get("spent_to_date", env.get("spent", 0.0))
        if threshold == "100":
            title = f"🔴 {env['name']} : enveloppe dépassée"
            content = f"{_fmt_eur(spent)} dépensés pour {_fmt_eur(limit)} prévus (+{_fmt_eur(spent - limit)})."
        else:
            title = f"🟠 {env['name']} : {round(env.get('percent_to_date', 0))} % utilisés"
            content = f"{_fmt_eur(spent)} dépensés sur {_fmt_eur(limit)}, il reste {_fmt_eur(max(limit - spent, 0))}"
            if env.get("period") in ("monthly", None) and period_info and period_info.get("days_left"):
                days = period_info["days_left"]
                horizon = "la paie" if period_info.get("kind") == "cycle" else "la fin du mois"
                content += f" pour {days} jour{'s' if days > 1 else ''} jusqu'à {horizon}"
            content += "."
        db.add(Notification(type="budget_alert", title=title, content=content, detailed_content=None,
                            link_data=json.dumps({"view": "budgets", "budget_id": env["id"]})))
        created.append({"budget_id": env["id"], "threshold": int(threshold), "title": title})

    _set_config(db, _ALERTS_SENT_KEY, json.dumps(sent[-500:]))
    db.commit()
    if created:
        logger.info(f"[Budgets] {len(created)} alerte(s) d'enveloppe émise(s).")
    return created


def _set_config(db: Session, key: str, value: str):
    row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    if row:
        row.value = value
    else:
        db.add(GlobalConfig(key=key, value=value))


def get_all_pending_budget_suggestions(db: Session) -> List[dict]:
    """Retourne toutes les suggestions budgétaires en attente (créations + recalibrages + enrichissements).
    Purge automatiquement toute ancienne suggestion sur achat ponctuel isolé (< 2 mois sans récurrence).
    """
    import json as _json
    pending = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion", "budget_enrichment_suggestion"]),
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.is_undone == False,
        )
        .order_by(AutopilotDecisionLog.created_at.desc())
        .all()
    )

    cfg_creation = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_creation_suggestions").first()
    creation_enabled = not (cfg_creation and cfg_creation.value and cfg_creation.value.strip().lower() == "false")

    cfg_recalib = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_recalibration_suggestions").first()
    recalib_enabled = not (cfg_recalib and cfg_recalib.value and cfg_recalib.value.strip().lower() == "false")

    results = []
    for d in pending:
        if d.decision_type == "budget_creation_suggestion" and not creation_enabled:
            continue
        if d.decision_type == "budget_suggestion":
            if not recalib_enabled:
                continue
            # Sécurité anti-orphelins : vérifier si l'enveloppe cible existe toujours et n'est pas fermée
            snap_check = {}
            if d.raw_snapshot:
                try:
                    snap_check = _json.loads(d.raw_snapshot)
                except Exception:
                    pass
            target_id = d.entity_id or snap_check.get("budget_id")
            target_b = db.query(Budget.id).filter(Budget.id == target_id, Budget.is_closed == False).first() if target_id else None
            if not target_b:
                # L'enveloppe cible a été supprimée ou clôturée : écarter la suggestion
                d.action = "DISMISSED"
                continue

        snap = {}
        if d.raw_snapshot:
            try:
                snap = _json.loads(d.raw_snapshot)
            except Exception:
                pass

        if d.decision_type == "budget_enrichment_suggestion":
            if not creation_enabled:
                continue
            target_id = d.entity_id or snap.get("target_budget_id")
            target_b = db.query(Budget.id).filter(Budget.id == target_id, Budget.is_closed == False).first() if target_id else None
            if not target_b:
                d.action = "DISMISSED"
                continue
            new_cat = snap.get("new_category") or snap.get("category")
            if new_cat:
                already_attached = db.query(BudgetCategory.id).filter(
                    BudgetCategory.budget_id == target_id,
                    BudgetCategory.category_name == new_cat
                ).first()
                if already_attached:
                    d.action = "DISMISSED"
                    continue

        # Filtrage de sécurité : si une suggestion de création concerne un achat ponctuel isolé ou une charge non éligible (prêt, crédit, charge fixe)
        if d.decision_type == "budget_creation_suggestion":
            observed = snap.get("observed_months")
            is_one_off = snap.get("is_one_off", False)
            cat = (snap.get("category") or "").strip()
            cat_lower = cat.lower()
            ineligible_keywords = (
                "prêt", "pret", "emprunt", "crédit", "credit", "remboursement",
                "fixes", "fixe", "abonnement", "loyer", "assurance", "mutuelle"
            )
            is_ineligible = (
                (observed is not None and observed < 2)
                or is_one_off
                or any(kw in cat_lower for kw in ineligible_keywords)
            )
            if is_ineligible:
                continue

            # Si une enveloppe active existe déjà pour cette catégorie, la suggestion est ignorée (déjà traitée)
            cats = snap.get("categories", [cat] if cat else [])
            existing_budget = (
                db.query(Budget)
                .join(BudgetCategory, BudgetCategory.budget_id == Budget.id)
                .filter(
                    BudgetCategory.category_name.in_(cats),
                    Budget.is_closed == False
                )
                .first()
            )
            if existing_budget:
                continue

        entry_type = "creation" if d.decision_type == "budget_creation_suggestion" else ("enrichment" if d.decision_type == "budget_enrichment_suggestion" else "recalibration")
        entry = {
            "decision_id": d.id,
            "decision_type": d.decision_type,
            "type": entry_type,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "confidence_score": d.confidence_score,
            **snap,
        }
        results.append(entry)

    return results


def apply_all_budget_suggestions(db: Session, decision_ids: Optional[List[int]] = None) -> dict:
    """Approuve en masse toutes les suggestions budgétaires valides (ou les identifiants fournis)."""
    q = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion", "budget_enrichment_suggestion"]),
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.is_undone == False,
        )
    )
    if decision_ids:
        q = q.filter(AutopilotDecisionLog.id.in_(decision_ids))

    pending = q.all()
    results = []
    for d in pending:
        try:
            res = apply_budget_suggestion(db, d.id)
            results.append(res)
        except Exception as e:
            logger.warning(f"[Budgets] Échec approbation unitaire {d.id} dans le traitement groupé: {e}")

    return {
        "ok": True,
        "count": len(results),
        "items": results,
    }


def dismiss_all_budget_suggestions(db: Session, decision_ids: Optional[List[int]] = None) -> dict:
    """Rejette en masse toutes les suggestions budgétaires en attente (ou les identifiants fournis)."""
    q = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion", "budget_enrichment_suggestion"]),
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.is_undone == False,
        )
    )
    if decision_ids:
        q = q.filter(AutopilotDecisionLog.id.in_(decision_ids))

    pending = q.all()
    results = []
    for d in pending:
        try:
            res = dismiss_budget_suggestion(db, d.id)
            results.append(res)
        except Exception as e:
            logger.warning(f"[Budgets] Échec rejet unitaire {d.id} dans le traitement groupé: {e}")

    return {
        "ok": True,
        "count": len(results),
        "items": results,
    }


def apply_budget_suggestion(db: Session, decision_id: int, custom_amount: Optional[float] = None) -> dict:
    """Approuve une suggestion budgétaire : crée l'enveloppe, applique le recalibrage ou enrichit l'enveloppe."""
    import json as _json

    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == decision_id).first()
    if not decision:
        raise HTTPException(status_code=404, detail="Suggestion non trouvée.")
    if decision.action != "SUGGESTED":
        raise HTTPException(status_code=400, detail="Cette suggestion a déjà été traitée.")

    snap = {}
    if decision.raw_snapshot:
        try:
            snap = _json.loads(decision.raw_snapshot)
        except Exception:
            pass

    if decision.decision_type == "budget_creation_suggestion":
        # Création d'enveloppe
        envelope_name = snap.get("name") or snap.get("category", "Sans nom")
        amount = round(float(snap.get("suggested_amount", 30.0)), 2)
        if custom_amount is not None and float(custom_amount) > 0:
            amount = round(float(custom_amount), 2)
        period = snap.get("suggested_period", "monthly")
        base_annual = amount if period == "yearly" else amount * 12

        cats = snap.get("categories", [])
        if not cats and snap.get("category"):
            cats = [snap.get("category")]
        error = envelope_validation_error(db, categories=cats, envelope_type="spending", is_project=False, period=period)
        if error:
            raise HTTPException(status_code=409, detail=error)

        b = Budget(
            name=envelope_name,
            monthly_amount=amount,
            period=period,
            is_project=False,
            is_closed=False,
            envelope_type="spending",
            is_locked=False,
            base_annual_amount=base_annual,
        )
        db.add(b)
        db.flush()

        for c in cats:
            db.add(BudgetCategory(budget_id=b.id, category_name=c))
        db.flush()

        action_id = record_action(db, "budget", b.id, "CREATE", None, snapshot_entity(b, db))
        decision.action = "AUTO_COMMIT"
        decision.entity_id = b.id
        db.commit()

        logger.info(f"[AutoPilot Budgets] Enveloppe '{envelope_name}' créée avec succès ({amount} €).")
        return {
            "ok": True,
            "type": "creation",
            "budget_id": b.id,
            "name": envelope_name,
            "amount": amount,
            "custom_amount": custom_amount,
            "action_id": action_id,
        }

    elif decision.decision_type == "budget_enrichment_suggestion":
        # Enrichissement d'une enveloppe existante
        target_budget_id = snap.get("target_budget_id") or decision.entity_id
        if not target_budget_id:
            raise HTTPException(status_code=400, detail="ID de budget cible manquant.")

        b = db.query(Budget).filter(Budget.id == target_budget_id).first()
        if not b or b.is_closed:
            raise HTTPException(status_code=404, detail="Enveloppe cible non trouvée ou fermée.")

        new_cat = snap.get("new_category") or snap.get("category")
        if not new_cat:
            raise HTTPException(status_code=400, detail="Catégorie à rattacher manquante.")

        conflicts = category_conflicts(db, [new_cat], b.period, b.start_date, b.end_date,
                                       parse_account_ids(b.account_ids), exclude_id=b.id)
        if conflicts:
            raise HTTPException(status_code=409, detail=f"« {new_cat} » est déjà suivie par l'enveloppe « {conflicts[0][1]} » : "
                                                        "une dépense ne doit compter que dans une seule enveloppe.")

        # Capturer l'ancien snapshot avant d'attacher la nouvelle catégorie et de modifier le montant
        old_snapshot = snapshot_entity(b, db)

        # Vérifier si la catégorie n'est pas déjà rattachée
        existing_bc = db.query(BudgetCategory).filter(
            BudgetCategory.budget_id == b.id,
            BudgetCategory.category_name == new_cat
        ).first()
        if not existing_bc:
            db.add(BudgetCategory(budget_id=b.id, category_name=new_cat))
            db.flush()
        new_amount = round(float(snap.get("suggested_amount", b.monthly_amount)), 2)
        if custom_amount is not None and float(custom_amount) > 0:
            new_amount = round(float(custom_amount), 2)

        b.monthly_amount = new_amount
        b.base_annual_amount = new_amount if b.period == "yearly" else new_amount * 12
        db.flush()

        action_id = record_action(db, "budget", b.id, "UPDATE", old_snapshot, snapshot_entity(b, db))
        decision.action = "AUTO_COMMIT"
        db.commit()

        logger.info(f"[AutoPilot Budgets] Enveloppe '{b.name}' enrichie avec la catégorie '{new_cat}' (nouveau plafond: {new_amount} €).")
        return {
            "ok": True,
            "type": "enrichment",
            "budget_id": b.id,
            "name": b.name,
            "new_category": new_cat,
            "old_amount": snap.get("current_amount", b.monthly_amount),
            "new_amount": new_amount,
            "amount": new_amount,
            "custom_amount": custom_amount,
            "action_id": action_id,
        }

    elif decision.decision_type == "budget_suggestion":
        # Recalibrage
        budget_id = snap.get("budget_id") or decision.entity_id
        if not budget_id:
            raise HTTPException(status_code=400, detail="ID de budget manquant.")

        b = db.query(Budget).filter(Budget.id == budget_id).first()
        if not b:
            raise HTTPException(status_code=404, detail="Budget non trouvé.")

        old_snapshot = snapshot_entity(b, db)
        new_amount = round(float(snap.get("suggested_amount", b.monthly_amount)), 2)
        if custom_amount is not None and float(custom_amount) > 0:
            new_amount = round(float(custom_amount), 2)
        b.monthly_amount = new_amount
        b.base_annual_amount = new_amount if b.period == "yearly" else new_amount * 12
        db.flush()

        action_id = record_action(db, "budget", b.id, "UPDATE", old_snapshot, snapshot_entity(b, db))
        decision.action = "AUTO_COMMIT"
        db.commit()

        logger.info(f"[AutoPilot Budgets] Enveloppe '{b.name}' actualisée à {new_amount} €.")
        return {
            "ok": True,
            "type": "recalibration",
            "budget_id": b.id,
            "name": b.name,
            "old_amount": snap.get("current_amount"),
            "new_amount": new_amount,
            "custom_amount": custom_amount,
            "action_id": action_id,
        }

    raise HTTPException(status_code=400, detail="Type de suggestion inconnu.")


def dismiss_budget_suggestion(db: Session, decision_id: int) -> dict:
    """Rejette / écarte une suggestion budgétaire (garantie anti-harcèlement avec support de réactivation)."""
    import json as _json
    from datetime import datetime
    from app.services.history_service import record_action, snapshot_entity

    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == decision_id).first()
    if not decision:
        raise HTTPException(status_code=404, detail="Suggestion non trouvée.")
    if decision.action != "SUGGESTED":
        raise HTTPException(status_code=400, detail="Cette suggestion a déjà été traitée.")

    old_snapshot = snapshot_entity(decision, db)
    decision.action = "DISMISSED"

    if decision.raw_snapshot:
        try:
            snap = _json.loads(decision.raw_snapshot)
            now_utc = datetime.now(timezone.utc)
            snap["dismissed_at"] = now_utc.isoformat()
            snap["dismissed_period"] = now_utc.strftime("%Y-%m")
            decision.raw_snapshot = _json.dumps(snap)
        except Exception:
            pass

    db.flush()

    new_snapshot = snapshot_entity(decision, db)
    action_id = record_action(db, "autopilot_decision", decision.id, "UPDATE", old_snapshot, new_snapshot)
    db.commit()

    logger.info(f"[AutoPilot Budgets] Suggestion {decision_id} écartée (type={decision.decision_type}, action_id={action_id}).")
    return {"ok": True, "decision_id": decision_id, "action": "DISMISSED", "action_id": action_id}


def reactivate_budget_suggestion(db: Session, decision_id: int) -> dict:
    """Réactive une suggestion budgétaire précédemment écartée (DISMISSED -> SUGGESTED)."""
    import json as _json
    from app.services.history_service import record_action, snapshot_entity

    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == decision_id).first()
    if not decision:
        raise HTTPException(status_code=404, detail="Suggestion non trouvée.")
    if decision.action != "DISMISSED":
        raise HTTPException(status_code=400, detail="Seule une suggestion écartée peut être réactivée.")

    if decision.decision_type in ("budget_suggestion", "budget_enrichment_suggestion") and decision.entity_id:
        b = db.query(Budget).filter(Budget.id == decision.entity_id).first()
        if not b or b.is_closed:
            raise HTTPException(status_code=400, detail="L'enveloppe associée n'existe plus ou est clôturée.")

    old_snapshot = snapshot_entity(decision, db)
    decision.action = "SUGGESTED"

    if decision.raw_snapshot:
        try:
            snap = _json.loads(decision.raw_snapshot)
            snap.pop("dismissed_at", None)
            snap.pop("dismissed_period", None)
            decision.raw_snapshot = _json.dumps(snap)
        except Exception:
            pass

    db.flush()

    new_snapshot = snapshot_entity(decision, db)
    action_id = record_action(db, "autopilot_decision", decision.id, "UPDATE", old_snapshot, new_snapshot)
    db.commit()

    logger.info(f"[AutoPilot Budgets] Suggestion {decision_id} réactivée (statut SUGGESTED, action_id={action_id}).")
    return {"ok": True, "decision_id": decision_id, "action": "SUGGESTED", "action_id": action_id}


def get_dismissed_budget_suggestions(db: Session, limit: int = 50) -> List[dict]:
    """Retourne l'historique des suggestions budgétaires écartées (DISMISSED)."""
    import json as _json
    from app.models import AutopilotDecisionLog

    dismissed = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion", "budget_enrichment_suggestion"]),
            AutopilotDecisionLog.action == "DISMISSED",
            AutopilotDecisionLog.is_undone == False,
        )
        .order_by(AutopilotDecisionLog.created_at.desc())
        .limit(limit)
        .all()
    )

    results = []
    for d in dismissed:
        snap = {}
        if d.raw_snapshot:
            try:
                snap = _json.loads(d.raw_snapshot)
            except Exception:
                pass

        name = snap.get("name") or snap.get("target_budget_name") or snap.get("budget_name") or snap.get("category") or f"Enveloppe #{d.entity_id or d.id}"
        suggested_amount = snap.get("suggested_amount") or snap.get("amount") or 0.0
        current_amount = snap.get("current_amount")
        delta_pct = snap.get("delta_pct")

        entry_type = "creation" if d.decision_type == "budget_creation_suggestion" else ("enrichment" if d.decision_type == "budget_enrichment_suggestion" else "recalibration")

        results.append({
            "decision_id": d.id,
            "decision_type": d.decision_type,
            "type": entry_type,
            "name": name,
            "suggested_amount": suggested_amount,
            "current_amount": current_amount,
            "delta_pct": delta_pct,
            "confidence_score": d.confidence_score,
            "dismissed_at": snap.get("dismissed_at") or (d.created_at.isoformat() if d.created_at else None),
            "dismissed_period": snap.get("dismissed_period"),
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "categories": snap.get("categories", []),
            "category": snap.get("category") or snap.get("new_category"),
            "new_category": snap.get("new_category"),
            "avg_spending": snap.get("avg_spending") or snap.get("avg_monthly"),
            "justification": snap.get("justification", ""),
        })
    return results


def clear_dismissed_budget_suggestions(db: Session) -> dict:
    """Supprime l'historique des suggestions budgétaires écartées (DISMISSED)."""
    from app.models import AutopilotDecisionLog

    deleted_count = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion", "budget_enrichment_suggestion"]),
            AutopilotDecisionLog.action == "DISMISSED",
        )
        .delete(synchronize_session=False)
    )
    db.commit()
    logger.info(f"[AutoPilot Budgets] Historique des suggestions écartées purgé ({deleted_count} entrées supprimées).")
    return {"ok": True, "count": deleted_count}


def get_budget_automations_history(db: Session, limit: int = 50) -> List[dict]:
    """Retourne l'historique des actions automatiques budgétaires exécutées (AUTO_COMMIT ou APPLIED)."""
    import json as _json
    from app.models import AutopilotDecisionLog

    actions = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["budget_creation_suggestion", "budget_suggestion", "budget_enrichment_suggestion"]),
            AutopilotDecisionLog.action.in_(["AUTO_COMMIT", "APPLIED"]),
            AutopilotDecisionLog.is_undone == False,
        )
        .order_by(AutopilotDecisionLog.created_at.desc())
        .limit(limit)
        .all()
    )

    results = []
    for d in actions:
        snap = {}
        if d.raw_snapshot:
            try:
                snap = _json.loads(d.raw_snapshot)
            except Exception:
                pass

        name = snap.get("name") or snap.get("target_budget_name") or snap.get("budget_name") or snap.get("category") or f"Enveloppe #{d.entity_id or d.id}"
        amount = snap.get("suggested_amount") or snap.get("amount") or 0.0
        current_amount = snap.get("current_amount")
        delta_pct = snap.get("delta_pct")

        entry_type = "creation" if d.decision_type == "budget_creation_suggestion" else ("enrichment" if d.decision_type == "budget_enrichment_suggestion" else "recalibration")

        results.append({
            "decision_id": d.id,
            "decision_type": d.decision_type,
            "action": d.action,
            "type": entry_type,
            "is_autonomous": (d.action == "AUTO_COMMIT"),
            "name": name,
            "amount": amount,
            "current_amount": current_amount,
            "delta_pct": delta_pct,
            "categories": snap.get("categories", [snap.get("category")] if snap.get("category") else []),
            "engine": snap.get("engine") or "deterministic",
            "justification": snap.get("justification", ""),
            "confidence_score": d.confidence_score,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        })
    return results


_OCCURRENCES_PER_YEAR = {
    "weekly": 52, "bi-weekly": 26, "semi-monthly": 24, "monthly": 12, "bimonthly": 6, "bi-monthly": 6,
    "quarterly": 4, "semiannual": 2, "semi-annually": 2, "yearly": 1, "annually": 1,
}


def sync_budget_from_recurrence_change(
    db: Session,
    category: str,
    change_type: str,
    amount_delta: float,
    batch_id: Optional[str] = None,
    profile_id: Optional[str] = None,
    frequency: Optional[str] = "Monthly",
) -> Optional[dict]:
    """
    Synchronise de manière transparente et déterministe les enveloppes budgétaires
    lors d'un changement de statut ou montant d'une charge récurrente.
    - "promotion": charge récurrente détectée/créée -> ajuste ou crée l'enveloppe si option active
    - "hike": hausse tarifaire pérenne propagée -> augmente l'enveloppe existante du delta
    - "closed": abonnement résilié/échéance close -> réduit l'enveloppe du montant libéré
    """
    if not category or abs(amount_delta) < 0.01:
        return None

    from app.services.autopilot_service import is_autopilot_enabled
    from app.services.bank_sync_scheduler import _resolve_profile_id
    from app.services import stats_cache
    import uuid as _uuid

    pid = _resolve_profile_id(profile_id)
    cfg_auto_apply = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_apply_budget_suggestions").first()
    if cfg_auto_apply and cfg_auto_apply.value is not None:
        auto_apply = cfg_auto_apply.value.strip().lower() in ("true", "1", "yes", "on")
    else:
        from app.services.autopilot_service import is_autopilot_enabled
        auto_apply = is_autopilot_enabled(db)

    if not auto_apply:
        return None

    # Enveloppe mensuelle ou annuelle qui suit cette catégorie (une seule par période, voir category_conflicts).
    # Les enveloppes datées, projets et tirelires ne sont pas des plafonds récurrents : non concernées.
    budget = (
        db.query(Budget)
        .join(BudgetCategory, BudgetCategory.budget_id == Budget.id)
        .filter(
            BudgetCategory.category_name == category,
            Budget.is_closed == False,
            Budget.is_locked == False,
            Budget.is_project == False,
            Budget.envelope_type == "spending",
            (Budget.period.in_(["monthly", "yearly"])) | (Budget.period.is_(None)),
        )
        .first()
    )
    if not budget:
        return None

    # amount_delta est par occurrence : ramené à la période de l'enveloppe selon la fréquence de la récurrence
    per_year = _OCCURRENCES_PER_YEAR.get((frequency or "Monthly").strip().lower(), 12)
    amount_delta = amount_delta * per_year / (1 if budget.period == "yearly" else 12)

    old_amount = float(budget.monthly_amount or 0.0)
    new_amount = max(0.0, round(old_amount + amount_delta, 2))

    if round(old_amount, 2) == round(new_amount, 2):
        return None

    old_snap = snapshot_entity(budget, db)
    budget.monthly_amount = new_amount
    db.flush()
    record_action(db, "budget", budget.id, "UPDATE", old_snap, snapshot_entity(budget, db), user_name="Automatisme (Sync Récurrence-Budget)")

    bid = batch_id or str(_uuid.uuid4())
    snap_payload = {
        "budget_id": budget.id,
        "budget_name": budget.name,
        "category": category,
        "change_type": change_type,
        "amount_delta": amount_delta,
        "old_amount": old_amount,
        "new_amount": new_amount,
        "amount": new_amount,
        "decision_reason": "budget_recurrence_sync",
    }
    decision = AutopilotDecisionLog(
        batch_id=bid,
        decision_type="budget_recurrence_sync",
        action="AUTO_COMMIT",
        entity_type="budget",
        entity_id=budget.id,
        raw_snapshot=json.dumps(snap_payload, default=str),
        confidence_score=100.0,
        is_undone=False
    )
    db.add(decision)
    db.commit()
    stats_cache.invalidate(pid)
    logger.info(f"[AutoPilot Budgets] Synchronisation budget '{budget.name}' suite à '{change_type}' ({old_amount} € -> {new_amount} €)")
    return {"budget_id": budget.id, "old_amount": old_amount, "new_amount": new_amount}


