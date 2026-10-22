"""
tests/test_chat_role_tools.py — Validation du filtrage des outils par rôle et allègement du prompt (Point #5 de l'audit).
"""
import json
import pytest
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Category, GlobalConfig, Account, Transaction
from app.services.chat.tools import TOOLS, TOOL_MAP, ROLE_TOOL_NAMES, get_tools_for_role
from app.services.chat.chat_prompt import load_system_prompt
from app.services.chat.chat_briefing import generate_financial_briefing
from app.services.chat.chat_compression import estimate_tokens


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    db.add(GlobalConfig(key="base_currency", value="EUR"))
    db.add(GlobalConfig(key="base_pay_day", value="28"))
    acc = Account(id=1, name="Compte Courant", initial_balance=2500.0, is_closed=False, type="Courant")
    db.add(acc)
    db.add(Category(name="Alimentation"))
    db.add(Category(name="Loisirs"))
    db.add(Category(name="Transport"))
    db.commit()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


def test_tools_deduplication():
    """Vérifie que la liste globale TOOLS ne contient aucun doublon de nom."""
    names = [t["function"]["name"] for t in TOOLS]
    assert len(names) == len(set(names)), f"Des doublons existent dans TOOLS: {names}"
    assert len(TOOLS) == 40
    assert "store_financial_fact" in TOOL_MAP
    assert "forget_financial_fact" in TOOL_MAP
    assert "trigger_bank_sync" in TOOL_MAP
    assert "create_planned_transfer" in TOOL_MAP
    assert "get_upcoming_expenses" in TOOL_MAP


def test_get_tools_for_role_known_and_fallback():
    """Vérifie que get_tools_for_role retourne les sous-ensembles corrects et gère le fallback."""
    # Unknown role or None falls back to all tools
    fb_tools = get_tools_for_role(None)
    assert len(fb_tools) == 40

    unknown_tools = get_tools_for_role("unknown_role_xyz")
    assert len(unknown_tools) == 40

    # Advisor has all tools
    adv_tools = get_tools_for_role("advisor")
    assert len(adv_tools) == 40

    # Simulator role has only simulation and analytical read tools
    sim_tools = get_tools_for_role("simulator")
    assert len(sim_tools) == 13
    sim_names = {t["function"]["name"] for t in sim_tools}
    assert "simulate_financial_scenario" in sim_names
    assert "simulate_loan_amortization" in sim_names
    assert "get_envelopes_impact" in sim_names
    # Simulator must NOT have write/mutation tools like apply_transaction_correction or delete_recurrence_template
    assert "apply_transaction_correction" not in sim_names
    assert "delete_recurrence_template" not in sim_names
    assert "create_category" not in sim_names

    # Forecaster role
    fc_tools = get_tools_for_role("forecaster")
    assert len(fc_tools) == 12
    fc_names = {t["function"]["name"] for t in fc_tools}
    assert "forecast_balances_history" in fc_names
    assert "get_upcoming_expenses" in fc_names
    assert "set_predicted_paycheck" in fc_names
    assert "create_planned_transfer" in fc_names
    assert "audit_transactions_integrity" not in fc_names

    # Auditor role
    aud_tools = get_tools_for_role("auditor")
    assert len(aud_tools) == 14
    aud_names = {t["function"]["name"] for t in aud_tools}
    assert "audit_transactions_integrity" in aud_names
    assert "get_upcoming_expenses" in aud_names
    assert "apply_transaction_correction" in aud_names
    assert "delete_transaction" in aud_names
    assert "simulate_financial_scenario" not in aud_names

    # Alerts role
    alt_tools = get_tools_for_role("alerts")
    assert len(alt_tools) == 13
    alt_names = {t["function"]["name"] for t in alt_tools}
    assert "detect_anomalies_and_subscriptions" in alt_names
    assert "get_upcoming_expenses" in alt_names
    assert "audit_transactions_integrity" in alt_names

    # Optimizer role
    opt_tools = get_tools_for_role("optimizer")
    assert len(opt_tools) == 16
    opt_names = {t["function"]["name"] for t in opt_tools}
    assert "close_recurrence_template" in opt_names
    assert "get_upcoming_expenses" in opt_names
    assert "update_recurrence_template" in opt_names

    # Budget planner role
    bp_tools = get_tools_for_role("budget_planner")
    assert len(bp_tools) == 16
    bp_names = {t["function"]["name"] for t in bp_tools}
    assert "create_budget_envelope" in bp_names
    assert "get_upcoming_expenses" in bp_names
    assert "update_budget_envelope" in bp_names


def test_token_reduction_per_role():
    """Vérifie que l'empreinte token des outils pour les rôles spécialisés est réduite de plus de 50% vs TOOLS."""
    global_tools_tok = estimate_tokens(json.dumps(TOOLS))
    assert global_tools_tok > 6000

    for role in ["simulator", "alerts", "optimizer", "budget_planner", "forecaster", "auditor"]:
        role_tools = get_tools_for_role(role)
        role_tok = estimate_tokens(json.dumps(role_tools))
        # Each specialized role must consume less than 3,000 tokens of tool schemas
        assert role_tok < 3000, f"Role {role} tool tokens {role_tok} exceeds 3000"
        reduction = (global_tools_tok - role_tok) / global_tools_tok
        assert reduction >= 0.50, f"Role {role} reduction {reduction:.1%} is less than 50%"


def test_prompt_category_pruning(db_session):
    """Vérifie que la liste des catégories n'est injectée que pour les rôles qui en ont besoin."""
    cats = ["Alimentation", "Loisirs", "Transport"]

    # Simulator does not need category list
    sim_prompt = load_system_prompt("simulator", cats, "fr", db=db_session)
    assert "EXISTING CATEGORIES" not in sim_prompt
    assert "WRITE ACTIONS RULE" not in sim_prompt

    # Forecaster does not need category list
    fc_prompt = load_system_prompt("forecaster", cats, "fr", db=db_session)
    assert "EXISTING CATEGORIES" not in fc_prompt

    # Auditor and Advisor MUST have category list for correction
    aud_prompt = load_system_prompt("auditor", cats, "fr", db=db_session)
    assert "EXISTING CATEGORIES" in aud_prompt
    assert '"Alimentation"' in aud_prompt

    adv_prompt = load_system_prompt("advisor", cats, "fr", db=db_session)
    assert "EXISTING CATEGORIES" in adv_prompt
    assert "WRITE ACTIONS RULE" in adv_prompt


def test_briefing_facts_behavior(db_session):
    """Vérifie que les ai_facts n'apparaissent dans le briefing que s'ils existent en DB."""
    briefing = generate_financial_briefing(db_session, role="simulator")
    assert "Known Financial Facts & Memory (ai_facts)" not in briefing

    from app.models import AIFact
    db_session.add(AIFact(fact_key="test_fact", fact_value="test_value"))
    db_session.commit()
    briefing_with_fact = generate_financial_briefing(db_session, role="simulator")
    assert "Known Financial Facts & Memory (ai_facts)" in briefing_with_fact
    assert "test_value" in briefing_with_fact
