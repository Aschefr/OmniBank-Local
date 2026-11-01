"""Suivi des enveloppes : période (cycle de paie / mois), dépensé à date, charges fixes, recalibrage
« signaler seulement » et alertes 90 % / 100 %."""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import AutopilotDecisionLog, Base, Budget, BudgetCategory, GlobalConfig, Notification, Transaction
from app.services import budget_service as bs
from app.services import finance_engine

TODAY = date.today()


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    # Paie le 30 de chaque mois : cycle en cours depuis la dernière paie passée
    last_pay = TODAY - timedelta(days=5)
    pays = [last_pay - timedelta(days=30 * k) for k in range(4)]
    monkeypatch.setattr(finance_engine, "predict_next_paycheck", lambda db: {
        "date": last_pay + timedelta(days=30), "amount": 2500.0,
        "history": [{"date": p.isoformat()} for p in pays]})
    yield s
    s.close()


def _envelope(db, name, cats, amount=100.0, period="monthly", **kw):
    b = Budget(name=name, monthly_amount=amount, period=period, envelope_type="spending", **kw)
    db.add(b)
    db.flush()
    for c in cats:
        db.add(BudgetCategory(budget_id=b.id, category_name=c))
    db.commit()
    return b


def _spend(db, cat, amount, when, recurrence_id=None, typ="expense_var"):
    db.add(Transaction(date_operation=when, description=cat, amount=-amount, type=typ, category=cat,
                       from_account_id=1, recurrence_id=recurrence_id))
    db.commit()


def _status(db, name):
    data = bs.get_budget_status_data(db=db, period_filter="all", cycle_offset=0)
    return next(b for b in data["budgets"] if b["name"] == name), data["period"]


def test_personal_monthly_envelopes_follow_the_pay_cycle(db):
    p = bs.budget_period(db, 0)
    assert p["kind"] == "cycle" and p["start"] == (TODAY - timedelta(days=5)).isoformat()
    assert p["days_elapsed"] == 6
    assert bs.budget_period(db, -1)["end"] == (TODAY - timedelta(days=6)).isoformat()


def test_organisation_mode_has_no_pay_cycle(db):
    db.add(GlobalConfig(key="enable_org_mode", value="true"))
    db.commit()
    p = bs.budget_period(db, 0)
    assert p["kind"] == "month" and p["start"] == TODAY.replace(day=1).isoformat()


def test_spent_to_date_and_planned_are_separated(db):
    _envelope(db, "Courses", ["Courses"], amount=200.0)
    _spend(db, "Courses", 50.0, TODAY - timedelta(days=1))
    _spend(db, "Courses", 30.0, TODAY + timedelta(days=2))  # opération prévue
    _spend(db, "Courses", 40.0, TODAY - timedelta(days=10))  # cycle précédent
    env, period = _status(db, "Courses")
    assert period["kind"] == "cycle"
    assert env["spent_to_date"] == 50.0 and env["planned"] == 30.0 and env["percent_to_date"] == 25.0


@pytest.mark.parametrize("spent, expected", [(95.0, "near"), (120.0, "over"), (45.0, "ahead"), (10.0, "ok")])
def test_envelope_status_thresholds(db, spent, expected):
    _envelope(db, "Loisirs", ["Loisirs"])
    _spend(db, "Loisirs", spent, TODAY)
    assert _status(db, "Loisirs")[0]["status"] == expected


def test_fixed_charges_envelope_only_alerts_on_real_overrun(db):
    _envelope(db, "Assurances", ["Assurance"], amount=80.0)
    _spend(db, "Assurance", 80.0, TODAY - timedelta(days=2), recurrence_id=7, typ="expense_fixed")
    env, _ = _status(db, "Assurances")
    assert env["is_fixed_charges"] is True and env["status"] == "ok" and env["expected_percent"] is None


def _three_periods(db, cat, amounts):
    for k, amount in zip((3, 2, 1), amounts):
        p = bs.budget_period(db, -k)
        _spend(db, cat, amount, date.fromisoformat(p["start"]) + timedelta(days=3))


def test_recalibration_suggests_only_after_three_overrun_periods_and_never_applies(db):
    db.add(GlobalConfig(key="auto_apply_budget_suggestions", value="true"))
    b = _envelope(db, "Restaurants", ["Restaurant"], amount=100.0)
    _three_periods(db, "Restaurant", [140.0, 151.0, 162.0])
    s = bs.evaluate_monthly_budget_suggestions(db, force=True)
    assert len(s) == 1 and s[0]["direction"] == "up" and s[0]["suggested_amount"] == 155.0
    assert db.get(Budget, b.id).monthly_amount == 100.0  # jamais appliqué seul


def test_recalibration_ignores_mixed_or_idle_periods(db):
    _envelope(db, "Mixte", ["Mixte"], amount=100.0)
    _three_periods(db, "Mixte", [140.0, 80.0, 150.0])
    _envelope(db, "Saisonnière", ["Cadeaux"], amount=100.0)  # aucune dépense : pas de baisse proposée
    _envelope(db, "Sous-utilisée", ["Cinéma"], amount=200.0)
    _three_periods(db, "Cinéma", [20.0, 35.0, 30.0])
    s = bs.evaluate_monthly_budget_suggestions(db, force=True)
    assert [(x["budget_name"], x["direction"], x["suggested_amount"]) for x in s] == [("Sous-utilisée", "down", 30.0)]


def test_new_period_expires_previous_pending_suggestions(db):
    db.add(AutopilotDecisionLog(batch_id="old", decision_type="budget_suggestion", action="SUGGESTED",
                                entity_type="budget", entity_id=99, conn_id=-1, raw_snapshot="{}"))
    db.commit()
    bs.evaluate_monthly_budget_suggestions(db, force=True)
    assert db.query(AutopilotDecisionLog).filter_by(batch_id="old").one().action == "EXPIRED"


def test_alerts_baseline_then_notify_once_per_threshold(db):
    _envelope(db, "Courses", ["Courses"], amount=100.0)
    _envelope(db, "Déjà dépassée", ["Bar"], amount=10.0)
    _spend(db, "Bar", 30.0, TODAY)
    # Premier passage : point de départ, aucune notification (même pour l'enveloppe déjà dépassée)
    assert bs.check_envelope_alerts(db, force=True) == []
    assert db.query(Notification).count() == 0

    _spend(db, "Courses", 92.0, TODAY)
    created = bs.check_envelope_alerts(db, force=True)
    assert [(c["threshold"]) for c in created] == [90]
    assert bs.check_envelope_alerts(db, force=True) == []  # pas deux fois

    _spend(db, "Courses", 20.0, TODAY)
    created = bs.check_envelope_alerts(db, force=True)
    assert [(c["threshold"]) for c in created] == [100]
    notif = db.query(Notification).filter(Notification.type == "budget_alert").order_by(Notification.id.desc()).first()
    assert "dépassée" in notif.title and "+12,00 €" in notif.content


def test_alerts_skip_ended_dated_envelopes(db):
    db.add(GlobalConfig(key="budget_alerts_sent", value="[]"))  # point de départ déjà posé
    db.commit()
    _envelope(db, "Événement passé", ["Billetterie"], amount=100.0, period="custom",
              start_date=TODAY - timedelta(days=60), end_date=TODAY - timedelta(days=30))
    _spend(db, "Billetterie", 150.0, TODAY - timedelta(days=40))
    assert bs.check_envelope_alerts(db, force=True) == []
