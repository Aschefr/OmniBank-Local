"""
tests/test_autopilot_step5_ux_e2e_full.py — Suite de validation globale et E2E pour l'Étape 5 Auto-Pilote :
- Précision comptable décimale (2 décimales)
- Cycle de vie complet des suggestions (création, recalibrage, rejet, réactivation)
- Intégrité des fichiers d'internationalisation (BOM UTF-8 sur fr.json, cohérence des clés)
"""

import json
import pytest
from datetime import date
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account,
    Transaction,
    Budget,
    BudgetCategory,
    AutopilotDecisionLog,
    GlobalConfig,
)
from app.services.budget_service import (
    get_all_pending_budget_suggestions,
    apply_budget_suggestion,
    dismiss_budget_suggestion,
    reactivate_budget_suggestion,
    apply_all_budget_suggestions,
    dismiss_all_budget_suggestions,
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
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="budget_minimum_threshold", value="30.0"),
        GlobalConfig(key="enable_budget_creation_suggestions", value="true"),
        GlobalConfig(key="enable_budget_recalibration_suggestions", value="true"),
    ])
    db.commit()

    yield db
    db.close()


def test_i18n_bom_and_key_parity():
    """Vérifie que fr.json possède rigoureusement le BOM UTF-8 et que toutes les nouvelles clés existent en FR et EN."""
    with open("static/i18n/fr.json", "rb") as f:
        raw_fr = f.read()
    assert raw_fr.startswith(b"\xef\xbb\xbf"), "fr.json doit obligatoirement démarrer par le BOM UTF-8 (utf-8-sig)"

    with open("static/i18n/fr.json", "r", encoding="utf-8-sig") as f:
        fr_data = json.load(f)

    with open("static/i18n/en.json", "r", encoding="utf-8-sig") as f:
        en_data = json.load(f)

    required_keys = [
        "budget_auto_btn_dismiss_all_month",
        "budget_auto_confirm_dismiss_all",
        "budget_auto_strip_expand_tt",
        "budget_auto_strip_collapse_tt",
        "budget_auto_active_monitoring_title",
        "budget_auto_modal_history_title",
        "budget_auto_btn_history_dismissed",
        "budget_suggestions_modal_title",
    ]

    for k in required_keys:
        assert k in fr_data, f"Clé manquante dans fr.json: {k}"
        assert k in en_data, f"Clé manquante dans en.json: {k}"
        assert len(fr_data[k].strip()) > 0
        assert len(en_data[k].strip()) > 0


def test_full_lifecycle_and_decimal_precision(test_db):
    """Vérifie le cycle complet de suggestions avec précision comptable stricte à 2 décimales."""
    # 1. Créer 2 suggestions en attente
    snap1 = {
        "name": "Épicerie Vrac",
        "category": "Épicerie",
        "suggested_amount": 47.85,
        "suggested_period": "monthly",
    }
    dec1 = AutopilotDecisionLog(
        batch_id="batch_full_1",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap1),
        confidence_score=85.0,
    )

    b2 = Budget(name="Sport & Loisirs", monthly_amount=60.00, period="monthly", is_closed=False)
    test_db.add(b2)
    test_db.commit()

    snap2 = {
        "budget_id": b2.id,
        "current_amount": 60.00,
        "suggested_amount": 72.50,
        "type": "recalibration",
    }
    dec2 = AutopilotDecisionLog(
        batch_id="batch_full_2",
        decision_type="budget_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        entity_id=b2.id,
        raw_snapshot=json.dumps(snap2),
        confidence_score=90.0,
    )
    test_db.add_all([dec1, dec2])
    test_db.commit()

    # 2. Vérification de la liste en attente
    pending = get_all_pending_budget_suggestions(test_db)
    assert len(pending) == 2

    # 3. Application unitaire avec custom_amount à 2 décimales (52.25 €)
    res_app = apply_budget_suggestion(test_db, dec1.id, custom_amount=52.25)
    assert res_app["ok"] is True
    assert res_app["amount"] == 52.25

    created_b = test_db.query(Budget).filter_by(id=res_app["budget_id"]).first()
    assert created_b.monthly_amount == 52.25

    # 4. Rejet unitaire de la suggestion 2
    res_dis = dismiss_budget_suggestion(test_db, dec2.id)
    assert res_dis["ok"] is True
    assert res_dis["action"] == "DISMISSED"

    # Vérification : plus aucune suggestion active
    pending_after = get_all_pending_budget_suggestions(test_db)
    assert len(pending_after) == 0

    # 5. Réactivation de la suggestion 2
    res_react = reactivate_budget_suggestion(test_db, dec2.id)
    assert res_react["ok"] is True

    pending_react = get_all_pending_budget_suggestions(test_db)
    assert len(pending_react) == 1
    assert pending_react[0]["decision_id"] == dec2.id

    # 6. Approbation en masse
    res_bulk = apply_all_budget_suggestions(test_db)
    assert res_bulk["count"] == 1
    test_db.refresh(b2)
    assert b2.monthly_amount == 72.50
