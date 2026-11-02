"""Préférences d'affichage des enveloppes : enveloppes épinglées et totaux sans les charges prévues
(barre latérale), propres au profil."""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, Budget, BudgetCategory, GlobalConfig, Transaction
from app.routers import stats
from app.services import budget_service as bs
from app.services import stats_cache

TODAY = date.today()


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    s.add(Account(id=1, name="Courant"))
    s.commit()
    monkeypatch.setattr(stats_cache, "get", lambda *a, **k: None)
    monkeypatch.setattr(stats_cache, "set", lambda *a, **k: None)
    yield s
    s.close()


def _envelope(db, name, cat, amount, fixed=False):
    b = Budget(name=name, monthly_amount=amount, period="monthly", envelope_type="spending")
    db.add(b)
    db.flush()
    db.add(BudgetCategory(budget_id=b.id, category_name=cat))
    # Une charge fixe : dépense rattachée à une récurrence
    db.add(Transaction(date_operation=TODAY, description=cat, amount=-40.0, type="expense_fixed" if fixed else "expense_var",
                       category=cat, from_account_id=1, recurrence_id=7 if fixed else None))
    db.commit()
    return b


def _set(db, **conf):
    for k, v in conf.items():
        db.add(GlobalConfig(key=k, value=v))
    db.commit()


def test_defaults_pin_nothing_show_totals_and_exclude_fixed(db):
    assert bs.budget_display_prefs(db) == {"pinned_ids": [], "sidebar_totals": True, "totals_exclude_fixed": True}


def test_malformed_pinned_list_is_ignored(db):
    _set(db, budget_pinned_ids="oops")
    assert bs.budget_display_prefs(db)["pinned_ids"] == []


def test_sidebar_totals_leave_out_fixed_charges_and_list_pinned_envelopes(db):
    food = _envelope(db, "Courses", "Alimentation", 300.0)
    rent = _envelope(db, "Loyer", "Logement", 800.0, fixed=True)
    _set(db, budget_pinned_ids=f"[{rent.id}, {food.id}]")

    data = stats.get_dashboard_stats(db=db)
    monthly = data["budget_summary"]["monthly"]
    assert monthly["target"] == 300.0 and monthly["reconciled_expenses"] == 40.0
    assert data["budget_display"]["fixed_excluded"] == {"monthly": 1}
    # Ordre d'épinglage conservé, charges prévues comprises
    assert [b["name"] for b in data["budget_pinned"]] == ["Loyer", "Courses"]


def test_totals_can_include_fixed_charges(db):
    _envelope(db, "Courses", "Alimentation", 300.0)
    _envelope(db, "Loyer", "Logement", 800.0, fixed=True)
    _set(db, budget_totals_exclude_fixed="false", budget_sidebar_totals="false")

    data = stats.get_dashboard_stats(db=db)
    assert data["budget_summary"]["monthly"]["target"] == 1100.0
    assert data["budget_display"] == {**data["budget_display"], "show_totals": False, "fixed_excluded": {}}
