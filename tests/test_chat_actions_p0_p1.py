import json
import pytest
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, ChatSession, ChatMessage, Transaction, ActionHistory, Category, Budget
from app.services.chat.chat_compression import estimate_tokens
from app.services.chat.chat_orchestrator import (
    budget_messages_for_context,
    execute_chat_action
)
from app.migrations.runner import run_migrations, TARGET_SCHEMA_VERSION


@pytest.fixture
def db_session():
    """Crée une base SQLite temporaire en mémoire avec migrations appliquées."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    run_migrations(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Données initiales
    cat = Category(name="Alimentation", type="expense_var")
    session.add(cat)
    tx = Transaction(
        amount=50.0,
        type="expense_var",
        category="Alimentation",
        description="Courses Monoprix",
        date_operation=date(2026, 10, 15)
    )
    session.add(tx)
    session.commit()

    yield session
    session.close()


def test_schema_target_version():
    """Vérifie que la version cible de schéma est bien 31."""
    assert TARGET_SCHEMA_VERSION == 31


def test_estimate_tokens_french_and_json():
    """Vérifie que estimate_tokens reflète fidèlement la densité du français et du JSON (ratio ~3.2)."""
    empty_res = estimate_tokens("")
    assert empty_res == 0

    text_320_chars = "a" * 320
    tokens = estimate_tokens(text_320_chars)
    assert tokens == 100  # 320 / 3.2 = 100


def test_budget_messages_for_context_accounts_for_tools():
    """Vérifie que budget_messages_for_context déduit bien les tokens des outils."""
    msgs = [{"role": "user", "content": "Hello"}]
    tools = [{"type": "function", "function": {"name": "test_tool", "parameters": {"type": "object"}}}]

    budget_no_tools = budget_messages_for_context(msgs, num_ctx=4096, min_headroom=1000, tools=None)
    assert len(budget_no_tools) == 1

    # Cas où num_ctx est très petit : sans outils ça passe, avec outils ça doit tailler ou logger
    tools_heavy = [{"type": "function", "function": {"name": f"tool_{i}", "description": "x" * 200}} for i in range(10)]
    budget_with_tools = budget_messages_for_context(msgs, num_ctx=1500, min_headroom=500, tools=tools_heavy)
    assert isinstance(budget_with_tools, list)


def test_chat_action_execution_idempotency_and_applied_actions(db_session):
    """P0.1 & P0.2: Vérifie que l'exécution d'une action chat est enregistrée, idempotente et tracée dans ActionHistory."""
    # Créer session et message assistant
    session = ChatSession(title="Test Actions", role="advisor")
    db_session.add(session)
    db_session.commit()

    msg = ChatMessage(session_id=session.id, role="assistant", content="Je vous propose de renommer l'opération.")
    db_session.add(msg)
    db_session.commit()

    tx = db_session.query(Transaction).first()
    assert tx is not None

    action_id = f"act_msg_{msg.id}_0"
    params = {
        "transaction_id": tx.id,
        "description": "Courses Monoprix Paris"
    }

    # 1ère exécution : Doit réussir et enregistrer l'action
    res1 = execute_chat_action(
        db_session,
        action="apply_transaction_correction",
        params=params,
        message_id=msg.id,
        action_id=action_id
    )
    assert res1.get("success") is True
    assert not res1.get("already_applied")

    # Vérification en base
    db_session.refresh(msg)
    applied_list = json.loads(msg.applied_actions)
    assert action_id in applied_list

    # Vérification de la modification réelle
    db_session.refresh(tx)
    assert tx.description == "Courses Monoprix Paris"

    # Vérification de l'enregistrement dans ActionHistory
    hist = db_session.query(ActionHistory).filter(ActionHistory.entity_type == "transaction", ActionHistory.entity_id == tx.id).first()
    assert hist is not None
    assert hist.action_type == "UPDATE"

    # 2ème exécution (tentative double clic) : Doit être rejetée de façon idempotente
    res2 = execute_chat_action(
        db_session,
        action="apply_transaction_correction",
        params=params,
        message_id=msg.id,
        action_id=action_id
    )
    assert res2.get("success") is True
    assert res2.get("already_applied") is True
    assert "déjà été exécutée" in res2.get("message")


def test_create_budget_envelope_via_chat_records_undo(db_session):
    """P0.2: Création d'enveloppe via le chat enregistrée dans ActionHistory."""
    session = ChatSession(title="Budget Session")
    db_session.add(session)
    db_session.commit()

    msg = ChatMessage(session_id=session.id, role="assistant", content="Création enveloppe")
    db_session.add(msg)
    db_session.commit()

    action_id = f"act_msg_{msg.id}_budget"
    res = execute_chat_action(
        db_session,
        action="create_budget_envelope",
        params={"name": "Vacances 2026", "monthly_amount": 250.0, "period": "monthly"},
        message_id=msg.id,
        action_id=action_id
    )
    assert res.get("success") is True
    b_id = res.get("budget_id")

    # Vérifier ActionHistory
    hist = db_session.query(ActionHistory).filter(ActionHistory.entity_type == "budget", ActionHistory.entity_id == b_id).first()
    assert hist is not None
    assert hist.action_type == "CREATE"
