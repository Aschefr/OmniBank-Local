import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, ChatSession, ChatMessage, Notification, Account
from app.services.chat import chat_critic
from app.services.chat.chat_critic import should_critique, run_background_critic


@pytest.fixture
def critic_db_session(monkeypatch):
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    # The critic opens a session on the conversation's profile: point it at the test database
    monkeypatch.setattr("app.services.chat.chat_critic._open_profile_session", lambda pid: TestingSessionLocal())

    db = TestingSessionLocal()
    # Create test accounts
    acc1 = Account(name="Compte Courant", type="Compte courant", initial_balance=500.0)
    acc2 = Account(name="Livret A", type="Livret", initial_balance=3000.0)
    db.add_all([acc1, acc2])
    db.commit()

    yield db
    db.close()


def test_should_critique_filters():
    assert should_critique("Bonjour, comment allez-vous ?", "user") is False
    assert should_critique("Bonjour !", "assistant") is False
    long_non_fin = "Voici une longue phrase sans aucun terme financier qui ne nécessite pas d'audit ou de critic car il s'agit d'une discussion générale sur le fonctionnement de l'application ou d'une salutation."
    assert should_critique(long_non_fin, "assistant") is False

    long_financial = (
        "Pour faire face à cette dépense imprévue, je vous conseille de réaliser un virement de précaution "
        "depuis votre Livret A vers votre Compte Courant pour un montant de 300 €. "
        "Voici le plan d'action préconisé pour reconstituer ensuite votre épargne."
    )
    assert should_critique(long_financial, "assistant") is True


def test_run_background_critic_fast_audit(critic_db_session):
    db = critic_db_session
    session = ChatSession(role="advisor", title="Test Critic")
    db.add(session)
    db.commit()

    # Message assistant qui promet un virement mais sans bloc action ```action
    promised_text = (
        "Voici la recommandation pour votre trésorerie :\n"
        "J'ai préparé l'enregistrement du virement prévisionnel de 350 € (Livret A -> Compte Courant). "
        "Veuillez l'examiner et le valider ci-dessous."
    )
    msg = ChatMessage(session_id=session.id, role="assistant", content=promised_text)
    db.add(msg)
    db.commit()

    # Exécution du critic
    run_background_critic(profile_id=1, session_id=session.id, message_id=msg.id)

    # Recharger le message
    db.expire_all()
    reloaded_msg = db.query(ChatMessage).filter(ChatMessage.id == msg.id).first()
    variants = reloaded_msg.get_variants_list()

    assert len(variants) == 2
    assert variants[0]["origin"] == "initial"
    assert variants[1]["origin"] == "auto_correction"
    assert "```action" in variants[1]["content"]

    # Vérifier qu'une notification chat_variant a été créée
    notif = db.query(Notification).filter(Notification.type == "chat_variant").first()
    assert notif is not None
    assert "optimisée" in notif.title.lower()

    # Vérifier l'idempotence : ré-exécuter ne doit pas ajouter une 3ème variante
    run_background_critic(profile_id=1, session_id=session.id, message_id=msg.id)
    db.expire_all()
    reloaded_msg = db.query(ChatMessage).filter(ChatMessage.id == msg.id).first()
    assert len(reloaded_msg.get_variants_list()) == 2


def test_critic_opens_the_conversation_profile_not_the_active_one(monkeypatch):
    """Profile switched while the critic runs: it must read and write the conversation's profile."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    asked = []
    monkeypatch.setattr(chat_critic, "get_engine", lambda pid: asked.append(pid) or engine)
    monkeypatch.setattr(chat_critic, "SessionLocal", lambda: pytest.fail("active-profile session used"))
    db = chat_critic._open_profile_session("profil-b")
    db.close()
    assert asked == ["profil-b"]


def test_critic_never_calls_the_model(critic_db_session, monkeypatch):
    """No promised action missing: nothing is rewritten and no variant is added."""
    db = critic_db_session
    session = ChatSession(role="advisor", title="Test Critic")
    db.add(session)
    db.commit()
    text = ("Votre stratégie : je vous recommande un virement de précaution depuis votre Livret A, "
            "à effectuer vous-même sur l'application de votre banque. Votre solde reste positif ce mois-ci.")
    msg = ChatMessage(session_id=session.id, role="assistant", content=text)
    db.add(msg)
    db.commit()
    import app.services.chat.ollama_client as oc
    monkeypatch.setattr(oc, "call_ollama_sync", lambda *a, **k: pytest.fail("model called by critic"))
    run_background_critic(profile_id="p1", session_id=session.id, message_id=msg.id)
    db.expire_all()
    assert len(db.get(ChatMessage, msg.id).get_variants_list()) <= 1
