"""
tests/test_autopilot_step5_badges_lifecycle.py — Validation du cycle de vie des badges de suggestion,
de la réactivité des actions unitaire/groupée et de la disparition des badges après décision (Phase 3).
"""

import json
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Budget,
    BudgetCategory,
    AutopilotDecisionLog,
    GlobalConfig,
)
from app.services.budget_service import (
    get_all_pending_budget_suggestions,
    apply_budget_suggestion,
    dismiss_budget_suggestion,
)
from app.services import stats_cache


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()
    stats_cache.invalidate()

    db.add_all([
        GlobalConfig(key="enable_budget_creation_suggestions", value="true"),
        GlobalConfig(key="enable_budget_recalibration_suggestions", value="true"),
    ])
    db.commit()

    yield db
    db.close()


def test_badge_criteria_cleared_on_recalibration_approval(test_db):
    """Vérifie que l'approbation d'un recalibrage retire immédiatement la suggestion des éléments en attente."""
    # 1. Créer un budget existant
    b = Budget(name="Restaurants", monthly_amount=150.0, period="monthly", is_closed=False)
    test_db.add(b)
    test_db.commit()

    # 2. Créer une suggestion de recalibrage associée
    snap = {
        "budget_id": b.id,
        "current_amount": 150.0,
        "suggested_amount": 180.0,
        "type": "recalibration",
    }
    decision = AutopilotDecisionLog(
        batch_id="b1",
        decision_type="budget_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        entity_id=b.id,
        raw_snapshot=json.dumps(snap),
        confidence_score=90.0,
    )
    test_db.add(decision)
    test_db.commit()

    # Vérifier que la suggestion est détectée pour ce budget (critère badge actif)
    pending = get_all_pending_budget_suggestions(test_db)
    matching = [s for s in pending if s.get("budget_id") == b.id or s.get("entity_id") == b.id]
    assert len(matching) == 1

    # 3. Approuver la suggestion
    res = apply_budget_suggestion(test_db, decision.id)
    assert res["ok"] is True

    # 4. Vérifier que la suggestion n'est plus en attente -> le badge disparaît
    refreshed_pending = get_all_pending_budget_suggestions(test_db)
    matching_after = [s for s in refreshed_pending if s.get("budget_id") == b.id or s.get("entity_id") == b.id]
    assert len(matching_after) == 0

    # 5. Vérifier que le budget a bien pris le nouveau montant
    test_db.refresh(b)
    assert b.monthly_amount == 180.0


def test_badge_criteria_cleared_on_dismiss(test_db):
    """Vérifie que le rejet d'une suggestion retire immédiatement l'élément de la liste active (badge effacé)."""
    b = Budget(name="Loisirs", monthly_amount=80.0, period="monthly", is_closed=False)
    test_db.add(b)
    test_db.commit()

    snap = {
        "budget_id": b.id,
        "current_amount": 80.0,
        "suggested_amount": 60.0,
        "type": "recalibration",
    }
    decision = AutopilotDecisionLog(
        batch_id="b2",
        decision_type="budget_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        entity_id=b.id,
        raw_snapshot=json.dumps(snap),
        confidence_score=85.0,
    )
    test_db.add(decision)
    test_db.commit()

    # Rejeter
    res = dismiss_budget_suggestion(test_db, decision.id)
    assert res["ok"] is True

    # Vérification : plus aucune suggestion active pour ce budget
    pending = get_all_pending_budget_suggestions(test_db)
    matching = [s for s in pending if s.get("budget_id") == b.id]
    assert len(matching) == 0
