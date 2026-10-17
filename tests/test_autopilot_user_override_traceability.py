"""
tests/test_autopilot_user_override_traceability.py

Teste la traçabilité UX et l'audit trail lors de la modification manuelle d'une décision Auto-Pilote
("Modifier et apprendre" ou revue manuelle).
Vérifie :
1. La détection dynamique et persistée de `user_override` dans get_autopilot_decisions_feed.
2. La conservation des valeurs initiales (catégorie, libellé, montant, raison).
3. Le marquage approprié et la cohérence avec les badges et classes CSS.
"""
import json
from datetime import date
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import AutopilotDecisionLog, Transaction, Account
from app.services.autopilot_service import (
    get_autopilot_decisions_feed,
    override_autopilot_decision,
)


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_autopilot_user_override_feed_detection(test_db):
    acc = Account(name="Compte Test Override", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    tx = Transaction(
        from_account_id=acc.id,
        date_saisie=date(2026, 10, 17),
        date_operation=date(2026, 10, 17),
        amount=14.99,
        type="expense_fixed",
        description="Offre Essentiel Modifiee",
        category="Frais de compte",
        raw_description="VIR SOSH TELECOM",
    )
    test_db.add(tx)
    test_db.commit()

    initial_snap = {
        "bank_tx": {
            "amount": -14.99,
            "description": "Offre Essentiel Initial",
            "category": "Telecoms",
            "raw_amount": -14.99,
        },
        "decision_reason": "ai_existing",
        "category": "Telecoms",
        "description": "Offre Essentiel Initial",
    }

    decision = AutopilotDecisionLog(
        batch_id="batch_test_override",
        decision_type="categorization",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx.id,
        confidence_score=92.0,
        raw_snapshot=json.dumps(initial_snap),
        is_undone=False,
    )
    test_db.add(decision)
    test_db.commit()

    feed = get_autopilot_decisions_feed(test_db, limit=10)
    items = feed.get("items", [])
    matching = [it for it in items if it["id"] == decision.id]
    assert len(matching) == 1
    item = matching[0]

    uo = item.get("user_override")
    assert uo is not None
    assert uo["is_overridden"] is True
    assert uo["category_changed"] is True
    assert uo["original_category"] == "Telecoms"
    assert uo["current_category"] == "Frais de compte"
    assert uo["description_changed"] is True
    assert uo["original_description"] == "Offre Essentiel Initial"
    assert uo["current_description"] == "Offre Essentiel Modifiee"
    assert uo["original_reason"] == "ai_existing"


def test_autopilot_override_endpoint_service(test_db):
    acc = Account(name="Compte Test Override 2", initial_balance=500.0)
    test_db.add(acc)
    test_db.commit()

    tx = Transaction(
        from_account_id=acc.id,
        date_saisie=date(2026, 10, 17),
        date_operation=date(2026, 10, 17),
        amount=42.00,
        type="expense_fixed",
        description="Transaction Initiale",
        raw_description="CB RESTO TEST",
        category="Alimentation",
    )
    test_db.add(tx)
    test_db.commit()

    initial_snap = {
        "bank_tx": {
            "amount": -42.00,
            "description": "Transaction Initiale",
            "category": "Alimentation",
        },
        "decision_reason": "ai_existing",
    }
    decision = AutopilotDecisionLog(
        batch_id="batch_test_override_2",
        decision_type="categorization",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx.id,
        confidence_score=88.0,
        raw_snapshot=json.dumps(initial_snap),
        is_undone=False,
    )
    test_db.add(decision)
    test_db.commit()

    res = override_autopilot_decision(
        db=test_db,
        decision_id=decision.id,
        new_category="Loisirs & Sorties",
        learn_rule=True,
        new_description="Transaction Corrigee",
        new_amount=45.00,
    )
    assert res["success"] is True
    assert res["learned_rule"] is True

    test_db.refresh(decision)
    snap = json.loads(decision.raw_snapshot)
    uo = snap.get("user_override")
    assert uo is not None
    assert uo["category_changed"] is True
    assert uo["original_category"] == "Alimentation"
    assert uo["new_category"] == "Loisirs & Sorties"
    assert uo["description_changed"] is True
    assert uo["amount_changed"] is True


def test_autopilot_reconciliation_is_not_falsely_flagged_as_user_override(test_db):
    """
    Vérifie qu'un rapprochement automatique où le libellé bancaire brut
    (ex: '00001902852 ECHEANCE' ou 'FULLI - mobilis') est rapproché avec une prévision
    (ex: 'Maison Vezeronce 20 Ans' ou 'Fulli - Peages') n'est PAS faussement considéré
    comme une modification utilisateur.
    """
    acc = Account(name="Compte Test Reconcile", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    tx = Transaction(
        from_account_id=acc.id,
        date_saisie=date(2026, 10, 15),
        date_operation=date(2026, 10, 15),
        amount=110.37,
        type="expense_var",
        description="Maison Vezeronce 20 Ans",
        raw_description="00001902852 ECHEANCE",
        category="Prêt 20 ans",
    )
    test_db.add(tx)
    test_db.commit()

    reconcile_snap = {
        "bank_tx": {
            "date_operation": "2026-10-15",
            "description": "00001902852 ECHEANCE",
            "raw_description": "00001902852 ECHEANCE",
            "amount": 110.37,
            "raw_amount": -110.37,
            "matched_db_id": tx.id,
            "db_description": "Maison Vezeronce 20 Ans",
            "category": "Prêt 20 ans",
        },
        "forecast_description": "Maison Vezeronce 20 Ans",
        "decision_reason": "linked_forecast",
        "after": {
            "id": tx.id,
            "description": "Maison Vezeronce 20 Ans",
            "category": "Prêt 20 ans",
            "amount": 110.37,
        }
    }

    decision = AutopilotDecisionLog(
        batch_id="batch_reconcile_test",
        decision_type="reconciliation",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx.id,
        confidence_score=100.0,
        raw_snapshot=json.dumps(reconcile_snap),
        is_undone=False,
    )
    test_db.add(decision)
    test_db.commit()

    feed = get_autopilot_decisions_feed(test_db, limit=10)
    matching = [it for it in feed.get("items", []) if it["id"] == decision.id]
    assert len(matching) == 1
    item = matching[0]

    # DOIT être None car c'est un rapprochement Auto-Pilote naturel, pas une modification utilisateur !
    assert item.get("user_override") is None
