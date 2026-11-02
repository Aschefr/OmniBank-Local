"""Suggestions d'enveloppes : seules les dépenses libres sont proposées (les charges prévues sont suivies par
les récurrences) et une catégorie qui a sa place dans une enveloppe existante y est ajoutée au lieu de créer
un doublon."""
import asyncio
import json
from datetime import date

import pytest
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, Budget, BudgetCategory, Category, Transaction
from app.services import budget_ai_service as ai
from app.services import budget_service as bs

TODAY = date.today()
MONTHS = [TODAY.replace(day=1) - relativedelta(months=k) for k in range(3)]


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    s.add(Account(id=1, name="Courant"))
    s.commit()
    monkeypatch.setattr(ai, "predict_next_paycheck", lambda db: {"amount": 3000.0})
    yield s
    s.close()


def _spend(db, cat, amount, recurrence_id=None):
    for m in MONTHS:
        when = min(m.replace(day=5), TODAY)
        db.add(Transaction(date_operation=when, date_saisie=when, description=f"{cat} {when}", amount=amount,
                           type="expense_var", category=cat, from_account_id=1, recurrence_id=recurrence_id))
    db.commit()


def _envelope(db, name, cats, amount=300.0, period="monthly", **kw):
    b = Budget(name=name, monthly_amount=amount, period=period, envelope_type=kw.pop("envelope_type", "spending"), **kw)
    db.add(b)
    db.flush()
    for c in cats:
        db.add(BudgetCategory(budget_id=b.id, category_name=c))
    db.commit()
    return b


def _suggest(db, engine="deterministic"):
    return asyncio.run(ai.ai_suggest_budgets_service(window_months=3, lang="fr", db=db, engine=engine, profile_id="t"))


def test_recurring_charges_are_recognised(db):
    _spend(db, "Loyer", 800.0, recurrence_id=1)
    _spend(db, "Boulangerie", 40.0)
    db.add(Category(name="Assurance auto", type="expense_fixed"))
    db.commit()
    assert bs.recurring_charge_categories(db, ["Loyer", "Boulangerie", "Assurance auto"]) == {"Loyer", "Assurance auto"}


def test_tracked_categories_ignore_projects_savings_and_closed(db):
    _envelope(db, "Courses", ["Alimentation"])
    _envelope(db, "Voyage", ["Avion"], is_project=True)
    _envelope(db, "Tirelire", ["Épargne"], envelope_type="savings")
    _envelope(db, "Ancienne", ["Vieux"], is_closed=True)
    assert bs.tracked_categories(db) == {"Alimentation"}


def test_additions_are_read_even_from_a_truncated_answer():
    full = json.dumps({"additions": [{"envelope": "Courses", "categories": ["Boulangerie"]}], "envelopes": []})
    assert ai.extract_json_additions(full) == [{"envelope": "Courses", "categories": ["Boulangerie"]}]
    truncated = 'Voici : {"additions": [{"envelope": "Courses", "categories": ["Boulangerie", "Primeur"]}], "envelopes": [{"name": "Loi'
    assert ai.extract_json_additions(truncated) == [{"envelope": "Courses", "categories": ["Boulangerie", "Primeur"]}]


def test_prompt_lists_existing_envelopes_only_when_there_are_some():
    lines = ['- "Boulangerie" | monthly | about 40 €/month']
    with_targets = ai.build_grouping_prompt(lines, [{"name": "Courses", "period": "monthly", "categories": ["Alimentation"]}], "fr")
    assert '"Courses" (monthly): Alimentation' in with_targets and "Add it to an existing envelope" in with_targets
    without = ai.build_grouping_prompt(lines, [], "fr")
    assert "EXISTING ENVELOPES" not in without and '"additions"' in without


def test_deterministic_suggestions_skip_planned_charges_and_join_existing_envelopes(db):
    alim = _envelope(db, "Alimentation Quotidienne", ["Courses"], amount=300.0)
    _spend(db, "Courses", 250.0)
    _spend(db, "Loyer", 800.0, recurrence_id=1)
    _spend(db, "Boulangerie", 40.0)
    _spend(db, "Cinéma", 30.0)

    res = _suggest(db)
    all_cats = [c for p in res["proposals"] for c in p["categories"]]
    assert "Loyer" not in all_cats and [c["name"] for c in res["fixed_categories"]] == ["Loyer"]
    addition = next(p for p in res["proposals"] if "Boulangerie" in p["categories"])
    assert addition["target_budget_id"] == alim.id and addition["current_amount"] == 300.0
    assert all(not p.get("target_budget_id") for p in res["proposals"] if "Cinéma" in p["categories"])


def test_ai_additions_and_reused_names_never_create_a_duplicate(db, monkeypatch):
    alim = _envelope(db, "Alimentation Quotidienne", ["Courses"], amount=300.0)
    _spend(db, "Boulangerie", 40.0)
    _spend(db, "Primeur", 25.0)
    _spend(db, "Cinéma", 30.0)
    _spend(db, "Concerts", 20.0)
    answer = json.dumps({
        "additions": [{"envelope": "Alimentation Quotidienne", "categories": ["Boulangerie"]}],
        "envelopes": [
            # Le modèle reprend le nom d'une enveloppe existante : traité comme un ajout
            {"name": "alimentation quotidienne", "categories": ["Primeur"], "reason": "x"},
            {"name": "Sorties", "categories": ["Cinéma", "Concerts"], "reason": "Loisirs du week-end."},
        ],
    })

    async def fake_call(prompt, cfg, extra_options=None):
        assert '"Alimentation Quotidienne" (monthly): Courses' in prompt
        return answer

    monkeypatch.setattr(ai, "get_ollama_config", lambda db: {"enabled": True, "url": "http://x", "model": "m"})
    monkeypatch.setattr(ai, "call_ollama_async", fake_call)

    res = _suggest(db, engine="ai")
    by_name = {p["name"]: p for p in res["proposals"]}
    assert set(by_name) == {"Alimentation Quotidienne", "Sorties"}
    assert by_name["Alimentation Quotidienne"]["target_budget_id"] == alim.id
    assert sorted(by_name["Alimentation Quotidienne"]["categories"]) == ["Boulangerie", "Primeur"]
    assert sorted(by_name["Sorties"]["categories"]) == ["Cinéma", "Concerts"] and not by_name["Sorties"].get("target_budget_id")
