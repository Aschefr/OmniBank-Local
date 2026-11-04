"""Cockpit : le réel comparé à une prévision enregistrée une fois pour la période. Données synthétiques."""
import json
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Budget, ForecastSnapshot, GlobalConfig, RecurrenceTemplate, Transaction
from app.services import forecast_tracking
from app.services.forecast_tracking import _forecast_at, _tolerance, get_forecast_tracking, record_period_forecasts
from app.services.simulator_engine import _add_months

COURANT, LIVRET = 1, 2
SALAIRE = 2000.0

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    session.add_all([
        Account(id=COURANT, name="Courant", type="Compte courant", initial_balance=1000.0),
        Account(id=LIVRET, name="Epargne", type="Livret", initial_balance=5000.0),
    ])
    session.commit()
    yield session
    session.close()


def _tx(db, when, amount, type_, from_acc=None, to_acc=None, **kw):
    db.add(Transaction(date_saisie=when, date_operation=when, description=kw.pop("description", type_), amount=amount, type=type_,
                       from_account_id=from_acc, to_account_id=to_acc, reconciliation_date=when, **kw))


def _month(offset, day=10):
    return _add_months(date.today().replace(day=1), offset).replace(day=day)


def _life(db, months=6):
    for offset in range(-months, 0):
        _tx(db, _month(offset, 15), SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire")
        _tx(db, _month(offset, 5), 300.0, "expense_var", from_acc=COURANT, category="Courses")
    db.commit()


def _point(result, day):
    return next(p for p in result["points"] if p["date"] == day.isoformat())


def test_empty_profile_has_no_card(db):
    assert get_forecast_tracking(db) == {"available": False}
    assert db.query(ForecastSnapshot).count() == 0


def test_first_day_records_the_forecast_and_starts_from_the_real_balance(db):
    _life(db)

    res = get_forecast_tracking(db)

    assert res["available"] is True
    assert res["is_first_day"] is True
    assert res["created_on"] == date.today().isoformat()
    assert res["gap"] == 0.0
    assert res["status"] == "on_track"
    assert res["points"][0]["balance"] == res["real_today"]


def test_forecast_is_frozen_when_things_change_later(db):
    _life(db)
    first = get_forecast_tracking(db)["points"]

    db.add(RecurrenceTemplate(description="Nouveau loyer", amount=900.0, type="expense_fixed", frequency="Monthly", day_of_month=28, from_account_id=COURANT, category="Loyer"))
    _tx(db, date.today(), 500.0, "expense_var", from_acc=COURANT, category="Garage")
    db.commit()

    again = get_forecast_tracking(db)

    assert again["points"] == first
    assert db.query(ForecastSnapshot).count() == 1


def test_gap_outside_the_tolerance_is_reported_with_its_direction(db):
    _life(db)
    get_forecast_tracking(db)

    _tx(db, date.today(), 500.0, "expense_var", from_acc=COURANT, category="Garage")
    db.commit()
    below = get_forecast_tracking(db)
    assert below["gap"] == pytest.approx(-500.0)
    assert below["status"] == "below"

    _tx(db, date.today(), 1200.0, "income", to_acc=COURANT, category="Vente")
    db.commit()
    above = get_forecast_tracking(db)
    assert above["gap"] == pytest.approx(700.0)
    assert above["status"] == "above"


def test_small_gap_stays_on_track(db):
    _life(db)
    get_forecast_tracking(db)

    _tx(db, date.today(), 15.0, "expense_var", from_acc=COURANT, category="Cafe")
    db.commit()

    res = get_forecast_tracking(db)

    assert res["gap"] == pytest.approx(-15.0)
    assert res["status"] == "on_track"


def test_real_counts_operations_entered_even_if_not_reconciled(db):
    _life(db)
    get_forecast_tracking(db)
    today = date.today()
    db.add(Transaction(date_saisie=today, date_operation=today, description="Saisie", amount=100.0, type="expense_var", from_account_id=COURANT, category="Courses"))
    db.commit()

    assert get_forecast_tracking(db)["gap"] == pytest.approx(-100.0)


def test_real_ignores_future_dated_and_skipped_operations(db):
    _life(db)
    get_forecast_tracking(db)
    _tx(db, date.today() + timedelta(days=3), 400.0, "expense_var", from_acc=COURANT, category="Plus tard")
    _tx(db, date.today(), 400.0, "expense_var", from_acc=COURANT, category="Ignoree", is_skipped=True)
    db.commit()

    assert get_forecast_tracking(db)["gap"] == 0.0


def test_new_period_records_a_new_forecast(db):
    _life(db)
    get_forecast_tracking(db)

    get_forecast_tracking(db, today=date.today() + timedelta(days=45))

    assert db.query(ForecastSnapshot).count() == 2


def test_each_account_has_its_own_forecast(db):
    _life(db)

    whole = get_forecast_tracking(db)
    livret = get_forecast_tracking(db, account_id=LIVRET)

    assert db.query(ForecastSnapshot).count() == 2
    assert whole["real_today"] == pytest.approx(livret["real_today"] + get_forecast_tracking(db, account_id=COURANT)["real_today"])
    assert livret["points"][-1]["balance"] == pytest.approx(5000.0)


def test_internal_transfer_does_not_move_the_whole_treasury(db):
    _life(db)
    get_forecast_tracking(db)
    _tx(db, date.today(), 700.0, "transfer", from_acc=COURANT, to_acc=LIVRET)
    db.commit()

    assert get_forecast_tracking(db)["gap"] == 0.0
    assert get_forecast_tracking(db, account_id=LIVRET)["real_today"] == pytest.approx(5700.0)


# ── Plan jour par jour ───────────────────────────────────────

def test_future_recurrence_lands_on_its_day_once(db):
    today = date.today()
    _life(db)
    due = today + timedelta(days=3)
    db.add(RecurrenceTemplate(id=9, description="Assurance", amount=50.0, type="expense_fixed", frequency="Monthly", day_of_month=due.day, from_account_id=COURANT, category="Assurance"))
    db.commit()

    res = get_forecast_tracking(db)
    period_end = date.fromisoformat(res["period_end"])
    if due > period_end or due.month != today.month:
        pytest.skip("échéance hors de la période selon la date du jour")

    before = _point(res, due - timedelta(days=1))["balance"]
    after = _point(res, due)["balance"]
    usual = _point(res, due - timedelta(days=1))["balance"] - _point(res, today)["balance"]
    per_day = usual / max(1, (due - timedelta(days=1) - today).days)
    assert after - before == pytest.approx(per_day - 50.0, abs=0.02)


def test_entered_recurrence_is_not_counted_twice(db):
    today = date.today()
    _life(db)
    due = today + timedelta(days=2)
    db.add(RecurrenceTemplate(id=9, description="Assurance", amount=50.0, type="expense_fixed", frequency="Monthly", day_of_month=due.day, from_account_id=COURANT, category="Assurance"))
    _tx(db, due, 50.0, "expense_fixed", from_acc=COURANT, category="Assurance", recurrence_id=9)
    db.commit()

    res = get_forecast_tracking(db)
    if due > date.fromisoformat(res["period_end"]) or due.month != today.month:
        pytest.skip("échéance hors de la période selon la date du jour")

    steps = [b["balance"] - a["balance"] for a, b in zip(res["points"], res["points"][1:])]
    usual = max(steps)
    assert sum(1 for s in steps if s < usual - 1) == 1
    assert min(steps) == pytest.approx(usual - 50.0, abs=0.02)


def test_points_cover_the_period_day_by_day(db):
    _life(db)

    res = get_forecast_tracking(db)
    days = [date.fromisoformat(p["date"]) for p in res["points"]]

    assert days[0] == date.today()
    assert days[-1] == date.fromisoformat(res["period_end"])
    assert all((b - a).days == 1 for a, b in zip(days, days[1:]))
    assert res["kind"] in ("cycle", "month")


def test_tolerance_grows_with_time(db):
    assert _tolerance(0.0, 1.0) == 20.0
    assert _tolerance(100.0, 0.25) == pytest.approx(50.0)
    assert _tolerance(100.0, 1.0) == pytest.approx(100.0)


def test_forecast_at_interpolates_between_month_ends():
    points = [
        {"date": "2026-11-01", "balance": 1000.0, "tolerance": 0.0},
        {"date": "2026-11-11", "balance": 2000.0, "tolerance": 100.0},
    ]

    assert _forecast_at(points, date(2026, 11, 6)) == (1500.0, 50.0)
    assert _forecast_at(points, date(2026, 11, 11)) == (2000.0, 100.0)
    assert _forecast_at(points, date(2026, 12, 1)) == (2000.0, 100.0)


# ── Historique court ─────────────────────────────────────────

def test_recurrences_without_history_still_give_a_forecast(db):
    today = date.today()
    db.add(RecurrenceTemplate(description="Loyer", amount=700.0, type="expense_fixed", frequency="Monthly", day_of_month=28, from_account_id=COURANT, category="Loyer"))
    db.commit()

    res = get_forecast_tracking(db)

    assert res["available"] is True
    assert res["points"][0]["date"] == today.isoformat()


def test_recent_history_is_flagged(db):
    db.add(Budget(name="Courses", monthly_amount=450.0, period="monthly", envelope_type="spending"))
    _tx(db, _month(-1, 15), SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire")
    _tx(db, _month(-1, 5), 60.0, "expense_var", from_acc=COURANT, category="Courses")
    db.commit()

    res = get_forecast_tracking(db)

    assert res["recent_history"] is True
    assert res["points"][-1]["balance"] < res["points"][0]["balance"] + SALAIRE


# ── Organisation : l'exercice, mois par mois ─────────────────

def _organisation(db):
    db.add(GlobalConfig(key="enable_org_mode", value="true"))
    for offset in range(-24, 0):
        _tx(db, _month(offset, 5), 1000.0, "expense_var", from_acc=COURANT, category="Sorties")
    for offset in (-3, -15):
        _tx(db, _month(offset, 12), 12000.0, "income", to_acc=COURANT, category="Dotation")
    db.commit()


def test_organisation_tracks_the_calendar_exercise_by_month(db):
    _organisation(db)
    today = date.today()

    res = get_forecast_tracking(db)

    assert res["kind"] == "exercise"
    assert res["period_start"] == date(today.year, 1, 1).isoformat()
    assert res["period_end"] == date(today.year, 12, 31).isoformat()
    assert res["points"][0]["date"] == today.isoformat()
    assert all(p["date"][8:] in ("28", "29", "30", "31") for p in res["points"][1:])


def test_organisation_keeps_one_forecast_for_the_whole_exercise(db):
    _organisation(db)
    today = date.today()
    first = get_forecast_tracking(db)["points"]
    later = today + timedelta(days=1) if today.month == (today + timedelta(days=1)).month or today.month != 12 else today

    if later.year == today.year:
        assert get_forecast_tracking(db, today=later)["points"] == first
    assert db.query(ForecastSnapshot).count() == 1


def test_stored_points_are_json(db):
    _life(db)
    get_forecast_tracking(db)

    assert isinstance(json.loads(db.query(ForecastSnapshot).first().points), list)


def test_migration_creates_the_table_and_can_run_twice():
    from app.migrations.runner import TARGET_SCHEMA_VERSION
    from app.migrations.versions import ALL_MIGRATIONS
    from app.migrations.versions.v34_forecast_snapshots import upgrade
    from sqlalchemy import inspect

    assert ALL_MIGRATIONS[-1].version == TARGET_SCHEMA_VERSION == 34
    fresh = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with fresh.begin() as conn:
        upgrade(conn)
        upgrade(conn)
    assert "forecast_snapshots" in inspect(fresh).get_table_names()


# ── Le réel depuis le début de la période ───────────────────

def test_real_starts_at_the_beginning_of_the_period_and_forecast_at_its_recording(db):
    _life(db)

    res = get_forecast_tracking(db)

    assert res["real"][0]["date"] == res["period_start"]
    assert res["real"][-1]["date"] == date.today().isoformat()
    assert res["points"][0]["date"] == res["created_on"] == date.today().isoformat()


def test_real_shows_what_happened_before_the_forecast_was_recorded(db):
    _life(db)
    period_start = date.fromisoformat(get_forecast_tracking(db)["period_start"])
    if period_start >= date.today():
        pytest.skip("la période commence aujourd'hui")
    db.query(ForecastSnapshot).delete()
    _tx(db, date.today(), 250.0, "expense_var", from_acc=COURANT, category="Garage")
    db.commit()

    res = get_forecast_tracking(db)

    assert res["real"][-1]["balance"] == pytest.approx(res["real"][-2]["balance"] - 250.0)
    assert res["gap"] == 0.0


def test_organisation_real_covers_the_exercise_month_by_month(db):
    _organisation(db)
    today = date.today()

    res = get_forecast_tracking(db)

    assert res["real"][0]["date"] == date(today.year, 1, 1).isoformat()
    assert res["real"][-1]["date"] == today.isoformat()
    assert len(res["real"]) <= today.month + 2


# ── La paie attendue le jour de la paie ─────────────────────

def _pay_expected_today(monkeypatch):
    monkeypatch.setattr(forecast_tracking, "predict_next_paycheck", lambda db: {"date": date.today()})


def test_pay_expected_today_is_counted_from_tomorrow(db, monkeypatch):
    _life(db)
    _pay_expected_today(monkeypatch)
    res = get_forecast_tracking(db)
    if len(res["points"]) < 2:
        pytest.skip("la période se termine aujourd'hui")

    assert res["points"][1]["balance"] - res["points"][0]["balance"] > 0.5 * SALAIRE


def test_pay_already_received_today_is_not_counted_twice(db, monkeypatch):
    _life(db)
    _tx(db, date.today(), SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire")
    db.commit()
    _pay_expected_today(monkeypatch)
    res = get_forecast_tracking(db)
    if len(res["points"]) < 2:
        pytest.skip("la période se termine aujourd'hui")

    assert res["points"][1]["balance"] - res["points"][0]["balance"] < 0.5 * SALAIRE


# ── Tâche de fond ───────────────────────────────────────────

@pytest.fixture
def fresh_background():
    forecast_tracking._LAST_BACKGROUND_RUN.clear()
    yield
    forecast_tracking._LAST_BACKGROUND_RUN.clear()


def test_background_records_the_treasury_and_every_open_account(db, fresh_background):
    _life(db)

    assert record_period_forecasts(db, "p") == 3
    assert {s.scope for s in db.query(ForecastSnapshot).all()} == {"all", f"account:{COURANT}", f"account:{LIVRET}"}


def test_background_runs_once_per_hour_and_never_changes_a_forecast(db, fresh_background):
    _life(db)
    now = datetime.now().replace(minute=5)
    record_period_forecasts(db, "p", now=now)
    first = {s.scope: s.points for s in db.query(ForecastSnapshot).all()}
    _tx(db, date.today(), 500.0, "expense_var", from_acc=COURANT, category="Garage")
    db.commit()

    assert record_period_forecasts(db, "p", now=now.replace(minute=30)) == 0
    assert record_period_forecasts(db, "p", now=now + timedelta(hours=1)) == 0
    assert {s.scope: s.points for s in db.query(ForecastSnapshot).all()} == first


def test_background_and_cockpit_share_the_same_forecast(db, fresh_background):
    _life(db)
    record_period_forecasts(db, "p")
    count = db.query(ForecastSnapshot).count()

    get_forecast_tracking(db)
    get_forecast_tracking(db, account_id=COURANT)

    assert db.query(ForecastSnapshot).count() == count


def test_background_skips_an_empty_profile_and_a_disabled_simulator(db, fresh_background):
    assert record_period_forecasts(db, "vide") == 0

    _life(db)
    db.add(GlobalConfig(key="enable_simulator", value="false"))
    db.commit()

    assert record_period_forecasts(db, "desactive") == 0
    assert db.query(ForecastSnapshot).count() == 0


# ── Le rythme de dépenses ───────────────────────────────────

def test_pace_gives_the_usual_net_spending_per_day(db):
    _life(db, months=6)

    pace = get_forecast_tracking(db)["pace"]

    if pace is None:
        pytest.skip("la période se termine aujourd'hui")
    assert pace["kind"] == "cycle"
    assert pace["usual_per_day"] == pytest.approx(300.0 / 30.44, abs=0.02)
    assert pace["days_left"] >= 1


def test_pace_counts_regular_income_against_spending(db):
    _life(db, months=6)
    for offset in range(-6, 0):
        _tx(db, _month(offset, 20), 100.0, "income", to_acc=COURANT, category="Ventes")
    db.commit()

    pace = get_forecast_tracking(db)["pace"]

    if pace is None:
        pytest.skip("la période se termine aujourd'hui")
    assert pace["usual_per_day"] == pytest.approx(200.0 / 30.44, abs=0.5)


def test_pace_follows_the_situation_while_the_forecast_stays_frozen(db):
    _life(db, months=6)
    first = get_forecast_tracking(db)
    if first["pace"] is None:
        pytest.skip("la période se termine aujourd'hui")
    for offset in range(-6, 0):
        _tx(db, _month(offset, 6), 300.0, "expense_var", from_acc=COURANT, category="Courses")
    db.commit()

    again = get_forecast_tracking(db)

    assert again["points"] == first["points"]
    assert again["pace"]["usual_per_day"] > first["pace"]["usual_per_day"]


def test_no_pace_on_a_recent_history(db):
    db.add(Budget(name="Courses", monthly_amount=450.0, period="monthly", envelope_type="spending"))
    _tx(db, _month(-1, 15), SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire")
    _tx(db, _month(-1, 5), 60.0, "expense_var", from_acc=COURANT, category="Courses")
    db.commit()

    assert get_forecast_tracking(db)["pace"] is None


def test_organisation_pace_gives_what_can_still_be_committed(db):
    _organisation(db)
    today = date.today()
    if today.month == 12 and today.day == 31:
        pytest.skip("l'exercice se termine aujourd'hui")

    res = get_forecast_tracking(db)
    pace = res["pace"]

    assert pace["kind"] == "exercise"
    assert pace["expected_spending"] > 0
    assert pace["engageable"] == pytest.approx(res["points"][-1]["balance"] + pace["expected_spending"], abs=0.05)


def test_young_organisation_has_no_pace(db):
    db.add(GlobalConfig(key="enable_org_mode", value="true"))
    _tx(db, _month(-1, 5), 100.0, "expense_var", from_acc=COURANT, category="Sorties")
    db.commit()

    assert get_forecast_tracking(db)["pace"] is None
