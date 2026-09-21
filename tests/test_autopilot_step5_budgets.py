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
    suggest_new_envelopes,
    suggest_new_envelopes_deterministic,
    get_unbudgeted_categories,
    get_all_pending_budget_suggestions,
    apply_budget_suggestion,
    dismiss_budget_suggestion,
    apply_all_budget_suggestions,
    dismiss_all_budget_suggestions,
    get_dismissed_budget_suggestions,
    reactivate_budget_suggestion,
    clear_dismissed_budget_suggestions,
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
        GlobalConfig(key="enable_budget_creation_suggestions", value="true"),
        GlobalConfig(key="enable_budget_recalibration_suggestions", value="true"),
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
    # Montant suggéré réaliste (25.00 €) basé sur la moyenne observée
    assert suggestions[0]["suggested_amount"] == 25.0

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


def test_t5_10_one_off_isolated_expense_ignored(test_db):
    """T5.10 : Achat ponctuel exceptionnel isolé (< 2 mois sans récurrence) — Totalement ignoré."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=25000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    # Un seul achat ponctuel de 17 999 € il y a 1 mois
    past_date = today.replace(day=1) - relativedelta(months=1, days=-10)
    test_db.add(Transaction(
        from_account_id=acc.id,
        category="Achat exceptionnel",
        amount=17999.0,
        type="expense_var",
        date_saisie=past_date,
        date_operation=past_date,
        description="Achat exceptionnel à gros montant",
    ))
    test_db.commit()

    # L'achat ponctuel sur 1 seul mois ne doit JAMAIS donner lieu à une suggestion d'enveloppe
    suggestions = suggest_new_envelopes_deterministic(test_db, force=True)
    assert len(suggestions) == 0


def test_t5_11_bulk_approve_and_dismiss(test_db):
    """T5.11 : Actions groupées — Validation et rejet par lot atomiques."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=5000.0)
    test_db.add(acc)
    test_db.commit()

    # Créer manuellement 2 suggestions en attente
    d1 = AutopilotDecisionLog(
        batch_id="batch-bulk-1",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps({"category": "Presse", "suggested_amount": 15.0}),
    )
    d2 = AutopilotDecisionLog(
        batch_id="batch-bulk-2",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps({"category": "Cinéma", "suggested_amount": 22.0}),
    )
    test_db.add_all([d1, d2])
    test_db.commit()

    # Test approve-all sur d1 uniquement
    res = apply_all_budget_suggestions(test_db, decision_ids=[d1.id])
    assert res["ok"] is True
    assert res["count"] == 1
    test_db.refresh(d1)
    assert d1.action == "AUTO_COMMIT"

    # Test dismiss-all sur d2
    res_dismiss = dismiss_all_budget_suggestions(test_db, decision_ids=[d2.id])
    assert res_dismiss["ok"] is True
    assert res_dismiss["count"] == 1
    test_db.refresh(d2)
    assert d2.action == "DISMISSED"


def test_t5_12_toggle_disable_creation_suggestions(test_db):
    """T5.12 : Interrupteur d'automatisation — Désactiver les suggestions de création d'enveloppes."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Pharmacie",
            amount=35.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Pharmacie du Centre",
        ))
    test_db.commit()

    # Désactiver l'option dans GlobalConfig
    cfg = test_db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_creation_suggestions").first()
    cfg.value = "false"
    test_db.commit()

    # La détection déterministe ne doit rien émettre
    suggs = suggest_new_envelopes_deterministic(test_db, force=True)
    assert suggs == []

    # Même si une suggestion préexistait en base, get_all_pending_budget_suggestions ne doit pas la remonter
    d = AutopilotDecisionLog(
        batch_id="batch-test",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps({"category": "Pharmacie", "suggested_amount": 35.0, "observed_months": 3}),
    )
    test_db.add(d)
    test_db.commit()

    pending = get_all_pending_budget_suggestions(test_db)
    creation_items = [item for item in pending if item.get("type") == "creation"]
    assert creation_items == []


def test_t5_13_toggle_disable_recalibration_suggestions(test_db):
    """T5.13 : Interrupteur d'automatisation — Désactiver les suggestions de recalibrage mensuel."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    b = Budget(
        name="Alimentation",
        monthly_amount=100.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False,
        base_annual_amount=1200.0,
    )
    test_db.add(b)
    test_db.commit()
    test_db.add(BudgetCategory(budget_id=b.id, category_name="Courses"))
    test_db.commit()

    today = date.today()
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Courses",
            amount=150.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Supermarché",
        ))
    test_db.commit()

    # Désactiver l'option dans GlobalConfig
    cfg = test_db.query(GlobalConfig).filter(GlobalConfig.key == "enable_budget_recalibration_suggestions").first()
    cfg.value = "false"
    test_db.commit()

    # L'évaluation mensuelle ne doit rien émettre
    recalibs = evaluate_monthly_budget_suggestions(test_db, force=True)
    assert recalibs == []

    # Même si une suggestion préexistait en base, get_all_pending_budget_suggestions ne doit pas la remonter
    d = AutopilotDecisionLog(
        batch_id="batch-recalib",
        decision_type="budget_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        entity_id=b.id,
        raw_snapshot=json.dumps({"budget_id": b.id, "suggested_amount": 110.0}),
    )
    test_db.add(d)
    test_db.commit()

    pending = get_all_pending_budget_suggestions(test_db)
    recalib_items = [item for item in pending if item.get("type") == "recalibration"]
    assert recalib_items == []


def test_t5_14_engine_deterministic_selection(test_db):
    """T5.14 : Sélection du moteur déterministe — Suggestions créées avec engine='deterministic'."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Boulangerie",
            amount=45.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Pain & Croissants",
        ))
    test_db.commit()

    cfg = test_db.query(GlobalConfig).filter(GlobalConfig.key == "budget_suggestion_engine").first()
    if not cfg:
        cfg = GlobalConfig(key="budget_suggestion_engine", value="deterministic")
        test_db.add(cfg)
    else:
        cfg.value = "deterministic"
    test_db.commit()

    suggestions = suggest_new_envelopes(test_db, force=True, engine_override="deterministic")
    assert len(suggestions) == 1
    s = suggestions[0]
    assert s["name"] == "Boulangerie"
    assert s["engine"] == "deterministic"
    assert s["categories"] == ["Boulangerie"]
    assert s["suggested_amount"] == 45.0


def test_t5_15_engine_ai_fallback_to_deterministic(test_db):
    """T5.15 : Repli transparent zéro-crash — Si le moteur IA est choisi mais qu'Ollama est inaccessible, repli automatique."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Jardinage",
            amount=60.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Plantes & Terreau",
        ))
    test_db.commit()

    # Configurer l'IA activée mais avec URL invalide / non joignable
    test_db.add_all([
        GlobalConfig(key="enable_ai", value="true"),
        GlobalConfig(key="ollama_url", value="http://127.0.0.1:9999"),
        GlobalConfig(key="ollama_model", value="non_existent_model"),
        GlobalConfig(key="budget_suggestion_engine", value="ai"),
    ])
    test_db.commit()

    # L'appel ne doit lever AUCUNE exception HTTP 502 ou 500
    suggestions = suggest_new_envelopes(test_db, force=True, engine_override="ai")
    assert len(suggestions) == 1
    s = suggestions[0]
    assert s["name"] == "Jardinage"
    assert s["engine"] == "deterministic_fallback"
    assert s["suggested_amount"] == 60.0


def test_t5_16_apply_multi_category_suggestion(test_db):
    """T5.16 : Validation d'une suggestion multi-catégories — Attache toutes les catégories au Budget."""
    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    # Créer une décision suggérée multi-catégories
    snap = {
        "name": "Artisans & Commerces",
        "category": "Artisans & Commerces",
        "categories": ["Boulangerie", "Boucherie"],
        "suggested_amount": 120.0,
        "avg_monthly": 120.0,
        "observed_months": 3,
        "engine": "ai",
        "justification": "Regroupement sémantique IA (2 catégories)",
    }
    d = AutopilotDecisionLog(
        batch_id="batch-multi-cat",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap),
    )
    test_db.add(d)
    test_db.commit()

    # Appliquer la suggestion
    res = apply_budget_suggestion(test_db, d.id)
    assert res["ok"] is True
    assert res["type"] == "creation"
    assert res["name"] == "Artisans & Commerces"

    # Vérifier en base la création de l'enveloppe et des catégories rattachées
    budget = test_db.query(Budget).filter(Budget.name == "Artisans & Commerces").first()
    assert budget is not None
    assert budget.monthly_amount == 120.0
    assert budget.base_annual_amount == 1440.0

    b_cats = test_db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget.id).all()
    cat_names = sorted([bc.category_name for bc in b_cats])
    assert cat_names == ["Boucherie", "Boulangerie"]

    # Vérifier l'historique d'action pour le support Undo
    act = test_db.query(ActionHistory).filter(ActionHistory.id == res["action_id"]).first()
    assert act is not None
    after_data = json.loads(act.new_state)
    assert sorted(after_data.get("_categories", [])) == ["Boucherie", "Boulangerie"]


def test_t5_17_dismiss_and_history(test_db):
    """T5.17 : Écartement d'une suggestion et consultation de l'historique."""
    snap = {
        "name": "Bricolage",
        "category": "Bricolage",
        "suggested_amount": 75.0,
        "avg_monthly": 75.0,
        "observed_months": 3,
    }
    decision = AutopilotDecisionLog(
        batch_id="batch-history-test",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap),
    )
    test_db.add(decision)
    test_db.commit()

    # Écarter la suggestion
    res = dismiss_budget_suggestion(test_db, decision.id)
    assert res["ok"] is True
    assert res["action"] == "DISMISSED"

    # Vérifier la présence dans l'historique des suggestions écartées
    dismissed = get_dismissed_budget_suggestions(test_db)
    assert len(dismissed) >= 1
    found = next((d for d in dismissed if d["decision_id"] == decision.id), None)
    assert found is not None
    assert found["name"] == "Bricolage"
    assert found["suggested_amount"] == 75.0
    assert found["type"] == "creation"
    assert found["dismissed_period"] is not None


def test_t5_18_reactivate_suggestion(test_db):
    """T5.18 : Réactivation d'une suggestion précédemment écartée."""
    snap = {
        "name": "Sport & Loisirs",
        "category": "Sport & Loisirs",
        "suggested_amount": 90.0,
        "avg_monthly": 90.0,
        "observed_months": 2,
    }
    decision = AutopilotDecisionLog(
        batch_id="batch-reactivate-test",
        decision_type="budget_creation_suggestion",
        action="DISMISSED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap),
    )
    test_db.add(decision)
    test_db.commit()

    # Réactiver la suggestion
    res = reactivate_budget_suggestion(test_db, decision.id)
    assert res["ok"] is True
    assert res["action"] == "SUGGESTED"

    # La suggestion doit réapparaître dans les suggestions en attente
    pending = get_all_pending_budget_suggestions(test_db)
    found_pending = next((p for p in pending if p["decision_id"] == decision.id), None)
    assert found_pending is not None
    assert found_pending["name"] == "Sport & Loisirs"

    # Elle ne doit plus figurer dans les suggestions écartées
    dismissed = get_dismissed_budget_suggestions(test_db)
    found_dismissed = next((d for d in dismissed if d["decision_id"] == decision.id), None)
    assert found_dismissed is None


def test_t5_19_dismissed_scoped_to_current_month(test_db):
    """T5.19 : Un recalibrage écarté le mois précédent ne bloque plus le mois en cours."""
    from datetime import datetime, timezone

    b = Budget(
        name="Transport",
        monthly_amount=100.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False,
    )
    test_db.add(b)
    test_db.commit()

    # Simuler une suggestion écartée il y a 40 jours (mois passé)
    old_date = datetime.now(timezone.utc) - timedelta(days=40)
    snap = {
        "budget_id": b.id,
        "budget_name": "Transport",
        "current_amount": 100.0,
        "suggested_amount": 120.0,
    }
    old_decision = AutopilotDecisionLog(
        batch_id="batch-old-dismiss",
        decision_type="budget_suggestion",
        action="DISMISSED",
        entity_type="budget",
        entity_id=b.id,
        raw_snapshot=json.dumps(snap),
        created_at=old_date,
    )
    test_db.add(old_decision)
    test_db.commit()

    # Créer les dépenses récentes pour rendre Transport éligible au recalibrage
    today = date.today()
    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.flush()
    test_db.add(BudgetCategory(budget_id=b.id, category_name="Carburant"))
    for m in range(1, 4):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Carburant",
            amount=140.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Carburant",
        ))
    test_db.commit()

    # Évaluer le recalibrage : le rejet du mois passé ne doit PAS bloquer le nouveau cycle
    suggestions = evaluate_monthly_budget_suggestions(test_db, force=True)
    transport_sugg = next((s for s in suggestions if s.get("budget_id") == b.id), None)
    assert transport_sugg is not None
    assert transport_sugg["budget_name"] == "Transport"


def test_t5_20_clear_dismissed_history(test_db):
    """T5.20 : Vidage complet de l'historique des suggestions écartées."""
    # Créer 2 suggestions écartées
    d1 = AutopilotDecisionLog(
        batch_id="batch-clear-1",
        decision_type="budget_creation_suggestion",
        action="DISMISSED",
        entity_type="budget",
        raw_snapshot=json.dumps({"name": "Test Env 1"}),
    )
    d2 = AutopilotDecisionLog(
        batch_id="batch-clear-2",
        decision_type="budget_suggestion",
        action="DISMISSED",
        entity_type="budget",
        raw_snapshot=json.dumps({"budget_name": "Test Env 2"}),
    )
    test_db.add_all([d1, d2])
    test_db.commit()

    assert len(get_dismissed_budget_suggestions(test_db)) >= 2

    # Vider l'historique
    res = clear_dismissed_budget_suggestions(test_db)
    assert res["ok"] is True
    assert res["count"] >= 2

    # L'historique doit désormais être vide
    assert len(get_dismissed_budget_suggestions(test_db)) == 0


def test_t5_21_approve_suggestion_with_custom_amount(test_db):
    """T5.21 : Approbation d'une suggestion avec montant personnalisé (in-place)."""
    from fastapi.testclient import TestClient
    from app.main import app
    from app.services.budget_service import apply_budget_suggestion

    client = TestClient(app)

    # 1. Test création d'enveloppe avec montant personnalisé
    snap_create = {
        "name": "Loisirs Créatifs",
        "category": "Loisirs Créatifs",
        "suggested_amount": 45.0,
        "suggested_period": "monthly",
    }
    d1 = AutopilotDecisionLog(
        batch_id="batch-custom-create",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap_create),
    )
    test_db.add(d1)
    test_db.commit()

    # Approuver avec custom_amount = 60.0
    res_create = apply_budget_suggestion(test_db, d1.id, custom_amount=60.0)
    assert res_create["ok"] is True
    assert res_create["amount"] == 60.0
    assert res_create["custom_amount"] == 60.0

    b1 = test_db.query(Budget).filter(Budget.id == res_create["budget_id"]).first()
    assert b1 is not None
    assert b1.monthly_amount == 60.0
    assert b1.base_annual_amount == 720.0

    # 2. Test recalibrage d'enveloppe avec montant personnalisé
    b2 = Budget(
        name="Restaurant",
        monthly_amount=200.0,
        period="monthly",
        envelope_type="spending",
        base_annual_amount=2400.0,
    )
    test_db.add(b2)
    test_db.commit()

    snap_recalib = {
        "budget_id": b2.id,
        "budget_name": "Restaurant",
        "current_amount": 200.0,
        "suggested_amount": 230.0,
    }
    d2 = AutopilotDecisionLog(
        batch_id="batch-custom-recalib",
        decision_type="budget_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap_recalib),
    )
    test_db.add(d2)
    test_db.commit()

    # Approuver recalibrage avec custom_amount = 250.0
    res_recalib = apply_budget_suggestion(test_db, d2.id, custom_amount=250.0)
    assert res_recalib["ok"] is True
    assert res_recalib["new_amount"] == 250.0
    assert res_recalib["custom_amount"] == 250.0

    test_db.refresh(b2)
    assert b2.monthly_amount == 250.0


def test_t5_22_manual_suggest_engine_deterministic_fast_path(test_db):
    """T5.22 : Appel manuel POST /api/budgets/ai_suggest avec engine='deterministic' retourne immédiatement engine='deterministic'."""
    acc = Account(name="Courant Manuel", type="Compte courant", initial_balance=1500.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    for m in range(1, 3):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-3)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Pharmacie",
            amount=32.0,
            type="expense_var",
            date_saisie=past_date,
            date_operation=past_date,
            description="Médicaments",
        ))
    test_db.commit()

    import asyncio
    from app.services.budget_ai_service import ai_suggest_budgets_service, get_ai_suggest_status
    res = asyncio.run(ai_suggest_budgets_service(
        db=test_db,
        window_months=3,
        lang="fr",
        outlier_sensitivity=2,
        engine="deterministic"
    ))
    assert res is not None
    assert res.get("engine") == "deterministic"
    st = get_ai_suggest_status()
    assert st.get("state") == "IDLE"
    proposals = res.get("proposals", [])
    assert len(proposals) >= 1
    assert any("Pharmacie" in p.get("categories", []) for p in proposals)


def test_t5_23_automations_history_endpoint(test_db):
    """T5.23 : Vérifie que l'historique des actions automatiques budgétaires est bien retourné."""
    import json
    from app.models import AutopilotDecisionLog
    from app.services.budget_service import get_budget_automations_history

    # Insérer une décision AUTO_COMMIT
    snap = json.dumps({
        "name": "Technologie",
        "category": "Technologie",
        "categories": ["Technologie", "Logiciels"],
        "suggested_amount": 281.85,
        "engine": "deterministic",
        "justification": "Dépenses régulières",
    })
    dec = AutopilotDecisionLog(
        batch_id="test-batch-hist",
        decision_type="budget_creation_suggestion",
        action="AUTO_COMMIT",
        entity_type="budget",
        entity_id=999,
        conn_id=-1,
        raw_snapshot=snap,
        confidence_score=85.0,
    )
    test_db.add(dec)
    test_db.commit()

    history = get_budget_automations_history(test_db, limit=10)
    assert len(history) >= 1
    item = next((h for h in history if h["decision_id"] == dec.id), None)
    assert item is not None
    assert item["name"] == "Technologie"
    assert item["amount"] == 281.85
    assert item["is_autonomous"] is True
    assert item["engine"] == "deterministic"
    assert item["type"] == "creation"






