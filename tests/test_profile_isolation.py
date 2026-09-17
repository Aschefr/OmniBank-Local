"""
OmniBank-Local — Tests de Non-Régression et d'Étanchéité Inter-Profils.
Vérifie le cloisonnement strict de la mémoire Python, des threads de fond et des sessions.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from datetime import date

from app.database import Base
from app.models import Account, Category, Transaction, GlobalConfig, Notification
from app.services import budget_ai_service
from app.services.chat import chat_orchestrator
from app.services.chat.tools import write_tools


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée pour les tests d'étanchéité."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    yield db
    db.close()


def test_budget_ai_status_profile_isolation():
    """Vérifie que les statuts et résultats de propositions IA restent strictement isolés par profile_id."""
    pid_a = "test_prof_alpha"
    pid_b = "test_prof_beta"

    # État initial IDLE pour les deux
    st_a = budget_ai_service.get_ai_suggest_status(profile_id=pid_a)
    st_b = budget_ai_service.get_ai_suggest_status(profile_id=pid_b)
    assert st_a["state"] == "IDLE"
    assert st_b["state"] == "IDLE"

    # Mise à jour du profil A en SUCCESS avec des propositions factices
    fake_proposals = {"proposals": [{"name": "Alimentation", "amount": 350.0}]}
    budget_ai_service._update_ai_status(
        profile_id=pid_a,
        state="SUCCESS",
        step_key="ai_status_success",
        result=fake_proposals
    )

    # Profil A doit avoir SUCCESS et son résultat
    res_a = budget_ai_service.get_ai_suggest_status(profile_id=pid_a)
    assert res_a["state"] == "SUCCESS"
    assert res_a["result"] == fake_proposals

    # Profil B doit rester strictement IDLE et sans résultat (zéro fuite)
    res_b = budget_ai_service.get_ai_suggest_status(profile_id=pid_b)
    assert res_b["state"] == "IDLE"
    assert res_b["result"] is None

    # Annulation sur profil A ne doit pas impacter profil B
    budget_ai_service.cancel_ai_suggest(profile_id=pid_a)
    assert budget_ai_service.get_ai_suggest_status(profile_id=pid_a)["state"] == "IDLE"
    assert budget_ai_service.get_ai_suggest_status(profile_id=pid_b)["state"] == "IDLE"


def test_chat_generating_sessions_profile_isolation():
    """Vérifie que l'état 'en cours de génération' pour un même session_id ne fuit pas d'un profil à l'autre."""
    pid_a = "prof_a"
    pid_b = "prof_b"
    common_session_id = 42

    # Au départ, aucune session n'est en cours
    assert not chat_orchestrator.is_session_generating(common_session_id, profile_id=pid_a)
    assert not chat_orchestrator.is_session_generating(common_session_id, profile_id=pid_b)

    # Profil A démarre la génération sur session 42
    key_a = (pid_a, common_session_id)
    chat_orchestrator._generating_sessions.add(key_a)

    try:
        # Profil A voit sa session 42 comme générant
        assert chat_orchestrator.is_session_generating(common_session_id, profile_id=pid_a) is True

        # Profil B ne doit PAS voir sa session 42 comme générant
        assert chat_orchestrator.is_session_generating(common_session_id, profile_id=pid_b) is False
    finally:
        chat_orchestrator._generating_sessions.discard(key_a)


def test_chat_notify_on_complete_profile_isolation(test_db):
    """Vérifie que register_notify_on_complete stocke la clé scopée au profil."""
    pid_a = "prof_x"
    pid_b = "prof_y"
    sid = 7

    key_a = (pid_a, sid)
    chat_orchestrator._generating_sessions.add(key_a)

    try:
        # Enregistrement de notification pour profil A
        chat_orchestrator.register_notify_on_complete(sid, test_db, profile_id=pid_a)
        assert key_a in chat_orchestrator._notify_on_complete

        # La clé pour profil B ne doit pas exister
        key_b = (pid_b, sid)
        assert key_b not in chat_orchestrator._notify_on_complete
    finally:
        chat_orchestrator._generating_sessions.discard(key_a)
        chat_orchestrator._notify_on_complete.discard(key_a)


def test_csv_export_tool_writes_to_profile_uploads(test_db):
    """Vérifie que l'outil d'export CSV génère un lien scopé /uploads/exports/ et non /static/."""
    # Créer un compte et une catégorie de test
    acc = Account(name="Compte Courant Test", type="checking", initial_balance=1000.0)
    test_db.add(acc)
    test_db.flush()

    cat = Category(name="Courses", type="expense_var")
    test_db.add(cat)
    test_db.flush()

    # Créer une transaction de test
    tx = Transaction(
        from_account_id=acc.id,
        date_operation=date(2026, 3, 15),
        description="Courses Marché Test",
        amount=-45.50,
        type="expense_var",
        category=cat.name
    )
    test_db.add(tx)
    test_db.commit()

    res = write_tools.generate_csv_export_link_tool(test_db, category=cat.name)
    assert "download_url" in res
    assert res["download_url"].startswith("/uploads/exports/export_")
    assert res["matching_records_count"] == 1
    assert not res["download_url"].startswith("/static/")
