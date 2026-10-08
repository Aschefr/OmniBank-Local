"""
tests/test_autopilot_feed_deduplication.py
Validation du flux de décisions Auto-Pilote (Chantier 1 / LOT-01) :
1. Distinction des actions LINKED_COMING vs AUTO_COMMIT.
2. Déduplication intelligente par entité avec deduplicate_entities=True.
3. Intégration de l'endpoint FastAPI /api/autopilot/decisions.
"""

from datetime import datetime, date, timezone, timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models import (
    Account,
    Transaction,
    Category,
    AutopilotDecisionLog,
    GlobalConfig,
)
from app.services.autopilot_service import get_autopilot_decisions_feed


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()

    account = Account(name="Compte Courant", initial_balance=1000.0)
    db.add(account)
    db.commit()

    yield db
    db.close()


def test_deduplicate_entities_feed(db_session):
    """
    Vérifie que pour une même transaction recevant d'abord LINKED_COMING puis AUTO_COMMIT :
    - Sans déduplication : les 2 logs sont retournés.
    - Avec déduplication : seul le log le plus récent (AUTO_COMMIT) est retourné.
    """
    account = db_session.query(Account).first()
    
    # Transaction 1 : Free Fibre (reçoit d'abord LINKED_COMING, puis AUTO_COMMIT)
    tx1 = Transaction(
        from_account_id=account.id,
        date_saisie=date(2026, 10, 1),
        date_operation=date(2026, 10, 5),
        description="Free Fibre",
        amount=49.99,
        type="expense_fixed",
        reconciliation_date=date(2026, 10, 5),
    )
    # Transaction 2 : EDF (seul LINKED_COMING)
    tx2 = Transaction(
        from_account_id=account.id,
        date_saisie=date(2026, 10, 2),
        date_operation=date(2026, 10, 15),
        description="EDF Electricite",
        amount=85.00,
        type="expense_fixed",
        reconciliation_date=None,
    )
    db_session.add_all([tx1, tx2])
    db_session.commit()

    t_base = datetime(2026, 10, 5, 8, 0, 0, tzinfo=timezone.utc)

    # 1. Décision LINKED_COMING pour tx1 (à 08:00)
    d1_coming = AutopilotDecisionLog(
        batch_id="batch_01",
        decision_type="reconciliation",
        action="LINKED_COMING",
        entity_type="transaction",
        entity_id=tx1.id,
        account_id=account.id,
        confidence_score=95.0,
        created_at=t_base,
    )
    # 2. Décision LINKED_COMING pour tx2 (à 08:05)
    d2_coming = AutopilotDecisionLog(
        batch_id="batch_01",
        decision_type="reconciliation",
        action="LINKED_COMING",
        entity_type="transaction",
        entity_id=tx2.id,
        account_id=account.id,
        confidence_score=90.0,
        created_at=t_base + timedelta(minutes=5),
    )
    # 3. Décision AUTO_COMMIT définitive pour tx1 (à 14:00)
    d1_commit = AutopilotDecisionLog(
        batch_id="batch_02",
        decision_type="reconciliation",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx1.id,
        account_id=account.id,
        confidence_score=100.0,
        created_at=t_base + timedelta(hours=6),
    )

    db_session.add_all([d1_coming, d2_coming, d1_commit])
    db_session.commit()

    # Sans déduplication -> 3 décisions retournées
    feed_raw = get_autopilot_decisions_feed(db_session, limit=10, deduplicate_entities=False)
    assert feed_raw["total"] == 3
    assert len(feed_raw["items"]) == 3
    actions_raw = [item["action"] for item in feed_raw["items"]]
    assert actions_raw == ["AUTO_COMMIT", "LINKED_COMING", "LINKED_COMING"]

    # Avec déduplication -> 2 décisions uniques retournées (tx1 en AUTO_COMMIT et tx2 en LINKED_COMING)
    feed_dedup = get_autopilot_decisions_feed(db_session, limit=10, deduplicate_entities=True)
    assert len(feed_dedup["items"]) == 2
    
    # Premier élément : tx1 (le plus récent, AUTO_COMMIT)
    assert feed_dedup["items"][0]["entity_id"] == tx1.id
    assert feed_dedup["items"][0]["action"] == "AUTO_COMMIT"
    
    # Second élément : tx2 (LINKED_COMING)
    assert feed_dedup["items"][1]["entity_id"] == tx2.id
    assert feed_dedup["items"][1]["action"] == "LINKED_COMING"


def test_api_decisions_deduplicate_param(db_session):
    """Vérifie l'endpoint FastAPI /api/autopilot/decisions?deduplicate_entities=true."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)

    account = db_session.query(Account).first()
    tx = Transaction(
        from_account_id=account.id,
        date_saisie=date(2026, 10, 1),
        date_operation=date(2026, 10, 5),
        description="Abonnement Netflix",
        amount=13.49,
        type="expense_fixed",
    )
    db_session.add(tx)
    db_session.commit()

    d_old = AutopilotDecisionLog(
        batch_id="b1",
        decision_type="reconciliation",
        action="LINKED_COMING",
        entity_type="transaction",
        entity_id=tx.id,
        account_id=account.id,
        created_at=datetime(2026, 10, 5, 8, 0, 0, tzinfo=timezone.utc),
    )
    d_new = AutopilotDecisionLog(
        batch_id="b2",
        decision_type="reconciliation",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx.id,
        account_id=account.id,
        created_at=datetime(2026, 10, 5, 12, 0, 0, tzinfo=timezone.utc),
    )
    db_session.add_all([d_old, d_new])
    db_session.commit()

    resp_raw = client.get("/api/autopilot/decisions?deduplicate_entities=false")
    assert resp_raw.status_code == 200
    assert len(resp_raw.json()["items"]) == 2

    resp_dedup = client.get("/api/autopilot/decisions?deduplicate_entities=true")
    assert resp_dedup.status_code == 200
    items = resp_dedup.json()["items"]
    assert len(items) == 1
    assert items[0]["action"] == "AUTO_COMMIT"

    # Test filtre action=LINKED_COMING
    resp_action_coming = client.get("/api/autopilot/decisions?action=LINKED_COMING")
    assert resp_action_coming.status_code == 200
    assert len(resp_action_coming.json()["items"]) == 1
    assert resp_action_coming.json()["items"][0]["action"] == "LINKED_COMING"

    # Test filtre action=AUTO_COMMIT
    resp_action_commit = client.get("/api/autopilot/decisions?action=AUTO_COMMIT")
    assert resp_action_commit.status_code == 200
    assert len(resp_action_commit.json()["items"]) == 1
    assert resp_action_commit.json()["items"][0]["action"] == "AUTO_COMMIT"

    app.dependency_overrides.clear()
