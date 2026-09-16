"""
tests/test_autopilot_step5_budgets.py — Suite de validation automatisée pour l'Étape 5 de la roadmap Auto-Pilote.

Périmètre de test :
- T5.1 (Anti-thrashing) : Zéro suggestion ou modification d'enveloppe en cours de mois lors d'une évaluation ordinaire.
- T5.2 (Mode Suggestion déterministe) : Calcul exact (0.80 x 100) + (0.20 x 150) = 110,00 €, décision SUGGESTED, Budget intact à 100 €.
- T5.3 (Filtre Winsorizing anti-anomalie) : Dépense aberrante de 600 € écrêtée, suggestion bornée à +10% (110 €).
- T5.4 (Borne cumulée annuelle ±25%) : Suggestion plafonnée à ±25% du budget de référence annuel avec alerte drift_limit_reached.
- T5.5 (Protection enveloppe cadenassée) : Enveloppe is_locked = True ignorée par le moteur.
- T5.6 (Validation 1-clic & Snapshot) : Approbation applique le montant, logge dans ActionHistory et passe à AUTO_COMMIT.
- T5.7 (Création déterministe hors-IA) : Catégorie orpheline → suggestion émise sans création directe de Budget.
- T5.8 (Rejet explicite persistant DISMISSED) : Suggestion rejetée marquée DISMISSED et non reproposée.
- T5.9 (Cadence Cold-Start réactive) : En phase Cold-Start (< 3 enveloppes), l'ingestion d'un lot déclenche immédiatement la suggestion d'enveloppe.
"""

import json
import pytest
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account,
    Transaction,
    Category,
    Budget,
    BudgetCategory,
    AutopilotDecisionLog,
    GlobalConfig,
    ActionHistory,
)
from app.services.budget_service import (
    compute_budget_ema_suggestion,
    calculate_envelope_historical_spending,
    evaluate_monthly_budget_suggestions,
    suggest_new_envelopes_deterministic,
    get_unbudgeted_categories,
    get_all_pending_budget_suggestions,
    apply_budget_suggestion,
    dismiss_budget_suggestion,
)
from app.services.autopilot_service import process_incoming_batch
from app.services import stats_cache


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée pour les tests de l'Étape 5."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    stats_cache.invalidate()

    # Initialisation minimale de configuration
    db.add_all([
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="budget_minimum_threshold", value="30.0"),
        GlobalConfig(key="last_budget_recalibration_period", value=""),
        GlobalConfig(key="auto_create_budget_envelopes", value="false"),
        GlobalConfig(key="auto_apply_budget_suggestions", value="false"),
    ])
    db.commit()

    yield db

    db.close()


def test_t5_1_anti_thrashing(test_db):
    """T5.1 : Anti-thrashing — Aucune suggestion émise si déjà exécuté pour la période courante."""
    today = date.today()
    current_period = f"{today.year}-{today.month:02d}"

    # Marquer la période courante comme déjà traitée
    cfg = test_db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_recalibration_period").first()
    cfg.value = current_period
    test_db.commit()

    # Créer un budget éligible
    b = Budget(
        name="Alimentation",
        monthly_amount=200.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False,
        base_annual_amount=2400.0,
    )
    test_db.add(b)
    test_db.commit()
    test_db.add(BudgetCategory(budget_id=b.id, category_name="Supermarché"))
    test_db.commit()

    # Sans force=True, doit retourner une liste vide (anti-thrashing)
    suggestions = evaluate_monthly_budget_suggestions(test_db, force=False)
    assert suggestions == []


def test_t5_2_deterministic_ema_calculation(test_db):
    """T5.2 : Calcul exact EMA — (0.80 x 100) + (0.20 x 150) = 110,00 €, Budget intact en base."""
    # Test unitaire direct de la fonction mathématique
    res = compute_budget_ema_suggestion(
        current_budget=100.0,
        avg_spending=150.0,
        base_annual_amount=1200.0,
        observed_months=3,
        min_threshold=30.0,
        alpha=0.20,
    )
    # Formule brute : (0.80 * 100) + (0.20 * 150) = 80 + 30 = 110.0
    # Plafond mensuel +10% : 100 * 1.10 = 110.0
    assert res["suggested_amount"] == 110.0
    assert res["delta_pct"] == 10.0
    assert res["drift_limit_reached"] is False

    # Test via evaluate_monthly_budget_suggestions
    acc = Account(name="Courant", type="Compte courant", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    b = Budget(
        name="Loisirs",
        monthly_amount=100.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False,
        base_annual_amount=1200.0,
    )
    test_db.add(b)
    test_db.commit()
    test_db.add(BudgetCategory(budget_id=b.id, category_name="Cinema"))
    test_db.commit()

    # Insérer 3 mois de dépenses à 150 € chacun
    today = date.today()
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-10)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Cinema",
            amount=150.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Soirée Cinéma",
        ))
    test_db.commit()

    suggestions = evaluate_monthly_budget_suggestions(test_db, force=True)
    assert len(suggestions) == 1
    assert suggestions[0]["suggested_amount"] == 110.0
    assert suggestions[0]["type"] == "recalibration"

    # Vérifier que le montant du budget en base n'a PAS été altéré (Mode Suggestion exclusif)
    reloaded_b = test_db.query(Budget).filter(Budget.id == b.id).first()
    assert reloaded_b.monthly_amount == 100.0


def test_t5_3_winsorizing_anomaly_filter(test_db):
    """T5.3 : Filtre Winsorizing — Dépense aberrante de 600 € écrêtée, suggestion bornée à +10%."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    b = Budget(
        name="Restaurants",
        monthly_amount=100.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False,
        base_annual_amount=1200.0,
    )
    test_db.add(b)
    test_db.commit()
    test_db.add(BudgetCategory(budget_id=b.id, category_name="Resto"))
    test_db.commit()

    today = date.today()
    # 2 mois normaux à 110 €, 1 mois aberrant à 600 €
    for m, amt in [(3, 110.0), (2, 110.0), (1, 600.0)]:
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Resto",
            amount=amt,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Resto",
        ))
    test_db.commit()

    suggestions = evaluate_monthly_budget_suggestions(test_db, force=True)
    assert len(suggestions) == 1
    # La borne mensuelle de +10% plafonne à 110.00 €
    assert suggestions[0]["suggested_amount"] <= 110.0


def test_t5_4_annual_drift_guard(test_db):
    """T5.4 : Double plafond de dérive — Plafonné à ±25% du budget de référence annuel avec alerte."""
    # Budget mensuel à 360 €, base_annual_amount = 3600 € (300 €/mois de référence).
    # Plafond annuel +25% = 300 * 1.25 = 375.00 €.
    # Si le calcul brut donnait 388 €, il doit être bridé à 375.00 € avec drift_limit_reached = True.
    res = compute_budget_ema_suggestion(
        current_budget=360.0,
        avg_spending=500.0,
        base_annual_amount=3600.0,
        observed_months=3,
        min_threshold=30.0,
        alpha=0.20,
    )
    assert res["suggested_amount"] == 375.0
    assert res["drift_limit_reached"] is True


def test_t5_5_locked_envelope_ignored(test_db):
    """T5.5 : Protection enveloppe cadenassée — is_locked = True ignorée par le moteur."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    b = Budget(
        name="Loyer",
        monthly_amount=800.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=True,  # Cadenassé !
        base_annual_amount=9600.0,
    )
    test_db.add(b)
    test_db.commit()
    test_db.add(BudgetCategory(budget_id=b.id, category_name="Loyer"))
    test_db.commit()

    today = date.today()
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-10)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Loyer",
            amount=950.0,
            type="expense_fixed",
            date_saisie=past_date,
            date_operation=past_date,
            description="Loyer mensuel",
        ))
    test_db.commit()

    suggestions = evaluate_monthly_budget_suggestions(test_db, force=True)
    assert suggestions == []


def test_t5_6_validation_1_click_and_snapshot(test_db):
    """T5.6 : Validation 1-clic & Snapshot — Approbation applique le montant, logge dans ActionHistory."""
    b = Budget(
        name="Transports",
        monthly_amount=50.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False,
        base_annual_amount=600.0,
    )
    test_db.add(b)
    test_db.commit()

    # Créer une décision de suggestion en attente
    snap_data = {
        "budget_id": b.id,
        "budget_name": b.name,
        "current_amount": 50.0,
        "suggested_amount": 65.0,
        "delta_pct": 30.0,
        "avg_spending": 65.0,
        "observed_months": 3,
    }
    decision = AutopilotDecisionLog(
        batch_id="batch-test-recalib",
        decision_type="budget_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        entity_id=b.id,
        raw_snapshot=json.dumps(snap_data),
        confidence_score=85.0,
    )
    test_db.add(decision)
    test_db.commit()

    # Approuver la suggestion
    res = apply_budget_suggestion(test_db, decision.id)
    assert res["ok"] is True
    assert res["new_amount"] == 65.0

    # Vérifier l'application en base
    test_db.refresh(b)
    assert b.monthly_amount == 65.0

    # Vérifier la transition d'état de la décision
    test_db.refresh(decision)
    assert decision.action == "AUTO_COMMIT"

    # Vérifier la traçabilité ActionHistory
    action = test_db.query(ActionHistory).filter(
        ActionHistory.entity_type == "budget",
        ActionHistory.entity_id == b.id,
        ActionHistory.action_type == "UPDATE"
    ).first()
    assert action is not None


def test_t5_7_unbudgeted_deterministic_creation(test_db):
    """T5.7 : Création déterministe hors-IA — Catégorie orpheline Pharmacie proposée sans création directe."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    # 3 dépenses de 25 € en Pharmacie sur les 3 derniers mois
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Pharmacie",
            amount=25.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Pharmacie du Centre",
        ))
    test_db.commit()

    # Vérifier que Pharmacie est bien orpheline
    unbudgeted = get_unbudgeted_categories(test_db)
    assert "Pharmacie" in unbudgeted

    # Lancer la suggestion
    initial_budget_count = test_db.query(Budget).count()
    suggestions = suggest_new_envelopes_deterministic(test_db, force=True)
    
    assert len(suggestions) == 1
    assert suggestions[0]["category"] == "Pharmacie"
    # Montant suggéré plafonné au seuil minimal (30.00 €) car 25 < 30
    assert suggestions[0]["suggested_amount"] == 30.0

    # Zéro création sauvage en base
    assert test_db.query(Budget).count() == initial_budget_count

    # Vérifier que get_all_pending_budget_suggestions la remonte
    pending = get_all_pending_budget_suggestions(test_db)
    assert len(pending) == 1
    assert pending[0]["type"] == "creation"
    assert pending[0]["category"] == "Pharmacie"


def test_t5_8_dismissed_anti_harassment(test_db):
    """T5.8 : Rejet persistant DISMISSED — Une suggestion rejetée n'est plus reproposée."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Vêtements",
            amount=80.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Achat Habits",
        ))
    test_db.commit()

    # Émettre la suggestion
    suggestions = suggest_new_envelopes_deterministic(test_db, force=True)
    assert len(suggestions) == 1
    decision_id = suggestions[0]["decision_id"]

    # Rejeter explicitement la suggestion
    dismiss_res = dismiss_budget_suggestion(test_db, decision_id)
    assert dismiss_res["ok"] is True
    assert dismiss_res["action"] == "DISMISSED"

    # Réévaluer les suggestions : "Vêtements" ne doit plus être reproposé
    new_suggestions = suggest_new_envelopes_deterministic(test_db, force=True)
    assert new_suggestions == []


def test_t5_9_cold_start_reactive_flow(test_db):
    """T5.9 : Cadence Cold-Start réactive — En Cold-Start, l'import déclenche immédiatement la suggestion."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    # Moins de 3 enveloppes actives en base (0 enveloppe -> Cold Start actif)
    assert test_db.query(Budget).filter(Budget.is_closed == False).count() < 3

    # Simuler des opérations passées pour qu'une moyenne mensuelle soit calculable
    today = date.today()
    past_date_1 = today.replace(day=1) - relativedelta(months=1, days=-5)
    past_date_2 = today.replace(day=1) - relativedelta(months=2, days=-5)
    test_db.add(Transaction(from_account_id=acc.id, category="Boulangerie", amount=40.0, type="expense_var", date_saisie=past_date_1, date_operation=past_date_1, description="Boulangerie"))
    test_db.add(Transaction(from_account_id=acc.id, category="Boulangerie", amount=50.0, type="expense_var", date_saisie=past_date_2, date_operation=past_date_2, description="Boulangerie"))
    test_db.commit()

    preview_data = {
        "accounts": [
            {
                "account_id": acc.id,
                "bank_balance": 1000.0,
                "transactions": [
                    {
                        "date_operation": today.strftime("%Y-%m-%d"),
                        "raw_amount": -45.0,
                        "description": "Boulangerie Tradition",
                        "category": "Boulangerie",
                        "is_reconciled": False,
                        "is_coming": False,
                    }
                ]
            }
        ]
    }

    # Ingestion du lot via process_incoming_batch
    res = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data)
    assert res["status"] == "completed"

    # Vérifier que la suggestion de création pour Boulangerie a été automatiquement émise
    pending = get_all_pending_budget_suggestions(test_db)
    boulangerie_sugg = [s for s in pending if s.get("category") == "Boulangerie"]
    assert len(boulangerie_sugg) == 1
    assert boulangerie_sugg[0]["type"] == "creation"
    assert boulangerie_sugg[0]["suggested_amount"] >= 30.0
