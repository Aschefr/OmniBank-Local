"""
Cockpit : le réel comparé à la prévision de la période en cours.

La prévision est enregistrée une fois, à sa première demande dans la période, puis n'est plus recalculée : une prévision
refaite chaque jour intégrerait les opérations passées et rejoindrait toujours le réel.
Mode personnel : cycle de paie, jour par jour. Mode organisation : exercice civil, mois par mois.
"""
import json
import logging
import math
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Account, ForecastSnapshot, GlobalConfig, RecurrenceTemplate, Transaction
from app.services.budget_service import budget_period, is_org_mode
from app.services.finance_engine import calculate_balances, predict_next_paycheck
from app.services.simulator_engine import RECENT_HISTORY_MONTHS, _add_months, _recurrence_amount_for_month, run_simulation

logger = logging.getLogger(__name__)

# Dernier passage de la tâche de fond par profil : une fois par heure suffit, une période commence un jour donné
_LAST_BACKGROUND_RUN = {}

DAYS_PER_MONTH = 30.44
# En deçà de cet écart, ce n'est pas un écart : un plein ou un paiement décalé d'un jour
MIN_TOLERANCE = 20.0


def _scope_ids(db: Session, account_id: Optional[int]) -> set:
    if account_id is not None:
        return {account_id}
    return {a.id for a in db.query(Account.id).filter(Account.is_closed == False, Account.type != "Prêt / Emprunt").all()}


def _balance_on(db: Session, ids: set, day: date) -> float:
    balances = calculate_balances(db, end_date=day)
    return round(sum(balances.get(i, 0.0) for i in ids), 2)


def _dated_operations(db: Session, after: date, until: date) -> list:
    return db.query(Transaction).filter(
        Transaction.date_operation > after,
        Transaction.date_operation <= until,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending"),
    ).all()


def _signed_flow(amount: float, from_id: Optional[int], to_id: Optional[int], ids: set) -> float:
    """Même règle que le solde affiché : « Depuis » retire, « Vers » ajoute. Un virement interne au périmètre s'annule."""
    flow = 0.0
    if from_id in ids:
        flow -= amount
    if to_id in ids:
        flow += amount
    return flow


def _planned_recurrences(db: Session, ids: set, today: date, end: date) -> dict:
    """Récurrences attendues d'ici la fin de période et pas encore saisies. Une échéance déjà passée arrive au plus tôt demain."""
    flows = {}
    tomorrow = today + timedelta(days=1)
    recurrences = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
    month = date(today.year, today.month, 1)
    while month <= end:
        last_day = date(month.year, month.month, monthrange(month.year, month.month)[1])
        entered = {
            row[0] for row in db.query(Transaction.recurrence_id).filter(
                Transaction.date_operation >= month,
                Transaction.date_operation <= last_day,
                Transaction.recurrence_id.isnot(None),
            ).all()
        }
        for rec in recurrences:
            if rec.id in entered:
                continue
            amount = _recurrence_amount_for_month(rec, month.month)
            if amount is None:
                continue
            if rec.max_occurrences and db.query(Transaction).filter(
                Transaction.recurrence_id == rec.id,
                (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
            ).count() >= rec.max_occurrences:
                continue
            flow = _signed_flow(amount, rec.from_account_id, rec.to_account_id, ids)
            if not flow:
                continue
            due = max(date(month.year, month.month, min(rec.day_of_month or 1, last_day.day)), tomorrow)
            if due <= min(end, last_day):
                flows[due] = flows.get(due, 0.0) + flow
        month = _add_months(month, 1)
    return flows


def _expected_pay(db: Session, ids: set, run: dict, today: date, end: date, operations: list) -> tuple:
    """(date, montant) de la paie attendue dans la période si rien ne la porte encore."""
    salary = float(run.get("predicted_salary") or 0.0)
    if salary <= 0:
        return None, 0.0
    try:
        pay_date = (predict_next_paycheck(db) or {}).get("date")
    except Exception as exc:
        logger.debug(f"[Suivi] Date de paie indisponible : {exc}")
        return None, 0.0
    if not pay_date or not (today <= pay_date <= end):
        return None, 0.0
    threshold = 0.6 * salary
    # Attendue aujourd'hui : elle est peut-être déjà arrivée, sinon elle compte au plus tôt demain
    received_today = _dated_operations(db, today - timedelta(days=1), today)
    if any(t.type == "income" and t.to_account_id in ids and abs(t.amount) >= threshold for t in [*operations, *received_today]):
        return None, 0.0
    pay_date = max(pay_date, today + timedelta(days=1))
    if pay_date > end:
        return None, 0.0
    if any(r.type == "income" and r.to_account_id in ids and abs(r.amount or 0.0) >= threshold
           for r in db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()):
        return None, 0.0
    return pay_date, salary


def _tolerance(stddev: float, months_elapsed: float) -> float:
    return round(max(MIN_TOLERANCE, stddev * math.sqrt(max(0.0, months_elapsed))), 2)


def _recommended_run(db: Session, account_id: Optional[int], horizon: int) -> dict:
    return run_simulation(db=db, horizon_months=horizon, account_id=account_id, income_mode="auto", projection_profile="recommended")


def _daily_plan(db: Session, account_id: Optional[int], ids: set, today: date, end: date) -> tuple:
    """Du jour à la fin de période : les opérations et récurrences à leur date, le reste réparti sur chaque jour."""
    run = _recommended_run(db, account_id, 2)
    operations = _dated_operations(db, today, end)
    by_day = _planned_recurrences(db, ids, today, end)
    for t in operations:
        flow = _signed_flow(t.amount, t.from_account_id, t.to_account_id, ids)
        if flow:
            by_day[t.date_operation] = by_day.get(t.date_operation, 0.0) + flow
    pay_date, pay_amount = _expected_pay(db, ids, run, today, end, operations)
    if pay_date:
        by_day[pay_date] = by_day.get(pay_date, 0.0) + pay_amount

    # Les dépenses variables récurrentes sont déjà à leur date : elles ne comptent pas une seconde fois dans la moyenne
    usual_spending = max(0.0, float(run.get("avg_variable_expense") or 0.0) - float(run.get("recurring_variable_monthly") or 0.0))
    per_day = (float(run.get("other_income_avg") or 0.0) - float(run.get("unplanned_fixed_avg") or 0.0) - usual_spending) / DAYS_PER_MONTH
    stddev = float(run.get("variable_expense_stddev") or 0.0)

    balance = _balance_on(db, ids, today)
    points = [{"date": today.isoformat(), "balance": balance, "tolerance": _tolerance(stddev, 0.0)}]
    day, elapsed = today, 0
    while day < end:
        day += timedelta(days=1)
        elapsed += 1
        balance += per_day + by_day.get(day, 0.0)
        points.append({"date": day.isoformat(), "balance": round(balance, 2), "tolerance": _tolerance(stddev, elapsed / DAYS_PER_MONTH)})
    return points, bool(run.get("recent_history"))


def _monthly_plan(db: Session, account_id: Optional[int], ids: set, today: date, end: date) -> tuple:
    """Du jour à la fin de l'exercice : le solde de fin de chaque mois selon le mode conseillé."""
    months = (end.year - today.year) * 12 + end.month - today.month + 1
    run = _recommended_run(db, account_id, months)
    stddev = float(run.get("variable_expense_stddev") or 0.0)
    points = [{"date": today.isoformat(), "balance": _balance_on(db, ids, today), "tolerance": _tolerance(stddev, 0.0)}]
    for index, month in enumerate(run.get("monthly_data") or []):
        year_num, month_num = int(month["month"][:4]), int(month["month"][5:7])
        last_day = date(year_num, month_num, monthrange(year_num, month_num)[1])
        if last_day > today:
            points.append({"date": last_day.isoformat(), "balance": round(month["baseline_end_balance"], 2), "tolerance": _tolerance(stddev, index + 1)})
    return points, False


def _current_period(db: Session, today: date) -> dict:
    if is_org_mode(db):
        return {"kind": "exercise", "start": date(today.year, 1, 1), "end": date(today.year, 12, 31)}
    period = budget_period(db, 0, today)
    return {"kind": period["kind"], "start": date.fromisoformat(period["start"]), "end": date.fromisoformat(period["end"])}


def _frozen_forecast(db: Session, account_id: Optional[int], ids: set, period: dict, today: date) -> ForecastSnapshot:
    """La prévision de la période : celle déjà enregistrée, sinon celle d'aujourd'hui, qui ne bougera plus."""
    scope = f"account:{account_id}" if account_id is not None else "all"
    query = db.query(ForecastSnapshot).filter(ForecastSnapshot.scope == scope, ForecastSnapshot.period_start == period["start"])
    snapshot = query.first()
    if snapshot:
        return snapshot
    planner = _monthly_plan if period["kind"] == "exercise" else _daily_plan
    points, recent = planner(db, account_id, ids, today, max(period["end"], today))
    snapshot = ForecastSnapshot(
        scope=scope, period_kind=period["kind"], period_start=period["start"], period_end=period["end"],
        created_on=today, points=json.dumps(points), recent_history=recent,
    )
    db.add(snapshot)
    try:
        db.commit()
    except IntegrityError:
        # Deux demandes simultanées : la première enregistrée fait foi
        db.rollback()
        snapshot = query.first()
    return snapshot


def _real_series(db: Session, ids: set, kind: str, start: date, today: date) -> list:
    """Le solde depuis le début de la période : c'est un fait, il n'a pas besoin d'une prévision déjà enregistrée."""
    if today < start:
        return []
    balance = _balance_on(db, ids, start)
    series = [{"date": start.isoformat(), "balance": balance}]
    if today == start:
        return series
    flows = {}
    for t in _dated_operations(db, start, today):
        flow = _signed_flow(t.amount, t.from_account_id, t.to_account_id, ids)
        if flow:
            flows[t.date_operation] = flows.get(t.date_operation, 0.0) + flow
    day = start
    while day < today:
        day += timedelta(days=1)
        balance += flows.get(day, 0.0)
        is_month_end = day.day == monthrange(day.year, day.month)[1]
        if kind != "exercise" or is_month_end or day == today:
            series.append({"date": day.isoformat(), "balance": round(balance, 2)})
    return series


def _forecast_at(points: list, today: date) -> tuple:
    """Prévision et tolérance à une date, par interpolation entre deux points."""
    previous = points[0]
    for point in points:
        point_date = date.fromisoformat(point["date"])
        if point_date == today:
            return point["balance"], point["tolerance"]
        if point_date > today:
            start = date.fromisoformat(previous["date"])
            share = (today - start).days / max(1, (point_date - start).days)
            return (
                round(previous["balance"] + (point["balance"] - previous["balance"]) * share, 2),
                round(previous["tolerance"] + (point["tolerance"] - previous["tolerance"]) * share, 2),
            )
        previous = point
    return previous["balance"], previous["tolerance"]


def record_period_forecasts(db: Session, profile_id: str, now: Optional[datetime] = None) -> int:
    """Tâche de fond : enregistre la prévision dès le début de la période, sans attendre l'ouverture du Cockpit.
    Pour toute la trésorerie et pour chaque compte, puisque le Cockpit peut afficher l'un ou l'autre."""
    now = now or datetime.now()
    slot = (now.date(), now.hour)
    if _LAST_BACKGROUND_RUN.get(profile_id) == slot:
        return 0
    _LAST_BACKGROUND_RUN[profile_id] = slot

    today = now.date()
    disabled = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_simulator", GlobalConfig.value == "false").first()
    has_activity = db.query(Transaction.id).first() is not None or db.query(RecurrenceTemplate.id).first() is not None
    if disabled or not has_activity:
        return 0

    period = _current_period(db, today)
    open_accounts = [a.id for a in db.query(Account.id).filter(Account.is_closed == False).all()]
    created = 0
    for account_id in [None, *open_accounts]:
        scope = f"account:{account_id}" if account_id is not None else "all"
        if db.query(ForecastSnapshot.id).filter(ForecastSnapshot.scope == scope, ForecastSnapshot.period_start == period["start"]).first():
            continue
        ids = _scope_ids(db, account_id)
        if ids:
            _frozen_forecast(db, account_id, ids, period, today)
            created += 1
    return created


def _spending_pace(db: Session, account_id: Optional[int], kind: str, end: date, today: date) -> Optional[dict]:
    """Le rythme de dépenses d'aujourd'hui, recalculé à chaque demande : contrairement à la prévision, il doit suivre la
    situation. Rien tant que l'historique est trop court pour parler de rythme."""
    if end <= today:
        return None
    if kind == "exercise":
        months = (end.year - today.year) * 12 + end.month - today.month + 1
        run = _recommended_run(db, account_id, months)
        if int(run.get("variable_expense_history_months") or 0) < RECENT_HISTORY_MONTHS:
            return None
        monthly = run.get("monthly_data") or []
        if not monthly:
            return None
        expected = sum(float(m.get("baseline_variable") or 0.0) for m in monthly)
        return {
            "kind": "exercise",
            "expected_spending": round(expected, 2),
            "engageable": round(float(monthly[-1]["baseline_end_balance"]) + expected, 2),
        }
    run = _recommended_run(db, account_id, 2)
    if run.get("recent_history"):
        return None
    usual_spending = max(0.0, float(run.get("avg_variable_expense") or 0.0) - float(run.get("recurring_variable_monthly") or 0.0))
    net_per_month = usual_spending + float(run.get("unplanned_fixed_avg") or 0.0) - float(run.get("other_income_avg") or 0.0)
    return {"kind": "cycle", "usual_per_day": round(net_per_month / DAYS_PER_MONTH, 2), "days_left": (end - today).days}


def get_forecast_tracking(db: Session, account_id: Optional[int] = None, today: Optional[date] = None) -> dict:
    today = today or date.today()
    ids = _scope_ids(db, account_id)
    has_activity = db.query(Transaction.id).first() is not None or db.query(RecurrenceTemplate.id).first() is not None
    if not ids or not has_activity:
        return {"available": False}

    period = _current_period(db, today)
    snapshot = _frozen_forecast(db, account_id, ids, period, today)
    points = json.loads(snapshot.points)
    real = _real_series(db, ids, snapshot.period_kind, snapshot.period_start, today)
    forecast_today, tolerance = _forecast_at(points, today)
    real_today = real[-1]["balance"] if real else forecast_today
    gap = round(real_today - forecast_today, 2)
    status = "on_track" if abs(gap) <= tolerance else ("above" if gap > 0 else "below")
    return {
        "available": True,
        "kind": snapshot.period_kind,
        "period_start": snapshot.period_start.isoformat(),
        "period_end": snapshot.period_end.isoformat(),
        "created_on": snapshot.created_on.isoformat(),
        "is_first_day": today <= snapshot.created_on,
        "recent_history": bool(snapshot.recent_history),
        "points": points,
        "real": real,
        "real_today": real_today,
        "forecast_today": forecast_today,
        "gap": gap,
        "tolerance": tolerance,
        "status": status,
        "pace": _spending_pace(db, account_id, snapshot.period_kind, snapshot.period_end, today),
    }
