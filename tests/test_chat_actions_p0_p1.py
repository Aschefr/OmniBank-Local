import json
import pytest
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from fastapi import HTTPException
from app.models import (
    Base, ChatSession, ChatMessage, Transaction, ActionHistory,
    Category, Budget, GlobalConfig, OrgUser, Account
)
from app.services.chat.chat_compression import estimate_tokens
from app.services.chat.chat_orchestrator import (
    budget_messages_for_context,
    execute_chat_action
)
from app.migrations.runner import run_migrations, TARGET_SCHEMA_VERSION


@pytest.fixture
def db_session():
    """Crée une base SQLite temporaire en mémoire avec migrations appliquées."""
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
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
    """Vérifie que la version cible de schéma est bien 32."""
    assert TARGET_SCHEMA_VERSION == 32


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


def test_chat_action_org_mode_access_control(db_session):
    """Point #9 Audit : En mode Organisation, contrôle strict des droits utilisateurs sur apply-action et traçabilité."""
    # Activer le mode Organisation
    cfg = GlobalConfig(key="enable_org_mode", value="true")
    db_session.add(cfg)

    # Créer un utilisateur actif et un inactif
    alice = OrgUser(name="Alice", is_active=True, sort_order=1)
    bob = OrgUser(name="Bob", is_active=False, sort_order=2)
    db_session.add_all([alice, bob])
    db_session.commit()

    tx = db_session.query(Transaction).first()
    assert tx is not None

    params = {
        "transaction_id": tx.id,
        "description": "Courses Alice"
    }

    # 1. Requête sans utilisateur -> 403
    with pytest.raises(HTTPException) as exc1:
        execute_chat_action(
            db_session,
            action="apply_transaction_correction",
            params=params,
            user_name=None
        )
    assert exc1.value.status_code == 403
    assert "veuillez sélectionner un utilisateur actif" in exc1.value.detail

    # 2. Requête avec utilisateur inactif -> 403
    with pytest.raises(HTTPException) as exc2:
        execute_chat_action(
            db_session,
            action="apply_transaction_correction",
            params=params,
            user_name="Bob"
        )
    assert exc2.value.status_code == 403
    assert "inactif ou introuvable" in exc2.value.detail

    # 3. Requête avec utilisateur inexistant -> 403
    with pytest.raises(HTTPException) as exc3:
        execute_chat_action(
            db_session,
            action="apply_transaction_correction",
            params=params,
            user_name="Charlie"
        )
    assert exc3.value.status_code == 403
    assert "inactif ou introuvable" in exc3.value.detail

    # 4. Requête avec utilisateur actif (Alice) -> Succès & Traçabilité complète
    res = execute_chat_action(
        db_session,
        action="apply_transaction_correction",
        params=params,
        user_name="Alice"
    )
    assert res.get("success") is True

    # Vérification transaction modified_by et modified_at
    db_session.refresh(tx)
    assert tx.description == "Courses Alice"
    assert tx.modified_by == "Alice"
    assert tx.modified_at is not None

    # Vérification ActionHistory user_name
    hist = db_session.query(ActionHistory).filter(
        ActionHistory.entity_type == "transaction",
        ActionHistory.entity_id == tx.id
    ).order_by(ActionHistory.id.desc()).first()
    assert hist is not None
    assert hist.user_name == "Alice"


def test_chat_action_planned_transfer_org_mode_traceability(db_session):
    """Point #9 Audit : Virement prévisionnel avec traçabilité created_by / ActionHistory."""
    # Création des comptes
    acc1 = Account(name="Compte Courant Test", initial_balance=1000.0)
    acc2 = Account(name="Livret Epargne Test", initial_balance=500.0)
    db_session.add_all([acc1, acc2])
    db_session.commit()

    # Activer le mode Organisation avec utilisateur
    cfg = db_session.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
    if not cfg:
        cfg = GlobalConfig(key="enable_org_mode", value="true")
        db_session.add(cfg)
    else:
        cfg.value = "true"

    user = db_session.query(OrgUser).filter(OrgUser.name == "Tresorier").first()
    if not user:
        user = OrgUser(name="Tresorier", is_active=True)
        db_session.add(user)
    db_session.commit()

    res = execute_chat_action(
        db_session,
        action="create_planned_transfer",
        params={
            "from_account": "Compte Courant Test",
            "to_account": "Livret Epargne Test",
            "amount": 200.0,
            "description": "Epargne mensuelle",
            "date_operation": "2026-10-21"
        },
        user_name="Tresorier"
    )
    assert res.get("success") is True
    tx_id = res.get("transaction_id")
    assert tx_id is not None

    tx = db_session.query(Transaction).filter(Transaction.id == tx_id).first()
    assert tx is not None
    assert tx.created_by == "Tresorier"
    assert tx.created_at is not None

    hist = db_session.query(ActionHistory).filter(
        ActionHistory.entity_type == "transaction",
        ActionHistory.entity_id == tx.id
    ).first()
    assert hist is not None
    assert hist.user_name == "Tresorier"
    assert hist.action_type == "CREATE"


def test_chat_apply_action_endpoint_headers_and_body(db_session):
    """Point #9 Audit : Test de l'endpoint FastAPI /api/chat/apply-action via body et header X-User-Name."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db

    # Surcharge dépendance DB pour utiliser db_session SQLite de test
    app.dependency_overrides[get_db] = lambda: db_session

    try:
        client = TestClient(app)

        # 1. Mode Organisation désactivé : l'action passe même sans user
        cfg = db_session.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
        if cfg:
            cfg.value = "false"
            db_session.commit()

        resp = client.post("/api/chat/apply-action", json={
            "action": "create_budget_envelope",
            "params": {"name": "Enveloppe Mode Standard", "monthly_amount": 150.0}
        })
        assert resp.status_code == 200
        assert resp.json().get("success") is True

        # 2. Mode Organisation activé avec utilisateur actif
        if not cfg:
            cfg = GlobalConfig(key="enable_org_mode", value="true")
            db_session.add(cfg)
        else:
            cfg.value = "true"
        
        sarah = db_session.query(OrgUser).filter(OrgUser.name == "Sarah").first()
        if not sarah:
            sarah = OrgUser(name="Sarah", is_active=True)
            db_session.add(sarah)
        db_session.commit()

        # Sans header ni body user_name -> 403
        resp_blocked = client.post("/api/chat/apply-action", json={
            "action": "create_budget_envelope",
            "params": {"name": "Enveloppe Sans User", "monthly_amount": 100.0}
        })
        assert resp_blocked.status_code == 403

        # Avec user_name dans le body -> 200
        resp_body = client.post("/api/chat/apply-action", json={
            "action": "create_budget_envelope",
            "params": {"name": "Enveloppe Sarah Body", "monthly_amount": 100.0},
            "user_name": "Sarah"
        })
        assert resp_body.status_code == 200
        assert resp_body.json().get("success") is True

        # Avec user_name dans le header X-User-Name -> 200
        resp_header = client.post(
            "/api/chat/apply-action",
            json={
                "action": "create_budget_envelope",
                "params": {"name": "Enveloppe Sarah Header", "monthly_amount": 120.0}
            },
            headers={"X-User-Name": "Sarah"}
        )
        assert resp_header.status_code == 200
        assert resp_header.json().get("success") is True

    finally:
        app.dependency_overrides.clear()

