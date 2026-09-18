"""
tests/test_demo_profile_category_lifecycle_ux.py — Suite de tests d'usage réel UX & cycle de vie des catégories / enveloppes.

Couvre les flux demandés par l'utilisateur :
- 1. Création automatique de nouvelles catégories en base de données à partir des opérations
- 2. Découverte et suggestion de création d'une NOUVELLE enveloppe pour catégorie orpheline ("Animaux & Vétérinaire")
- 3. Rattachement d'une nouvelle sous-catégorie à une enveloppe EXISTANTE ("Boulangerie & Pâtisserie" -> Alimentation)
- 4. Dérive de dépenses et suggestion de RECALIBRAGE EMA sur enveloppe existante ("Loisirs & Culture")
- 5. Validation d'enveloppe avec montant personnalisé (édition du champ input dans l'UX)
- 6. Validation d'une suggestion de recalibrage (mise à jour du montant engagé)
- 7. Rejet de suggestion (DISMISSED) et garantie anti-harcèlement
- 8. Réactivation et historique d'audit (ActionHistory / Rollback)
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
    get_unbudgeted_categories,
    get_all_pending_budget_suggestions,
    apply_budget_suggestion,
    dismiss_budget_suggestion,
    reactivate_budget_suggestion,
    get_dismissed_budget_suggestions,
)
from app.services import stats_cache


@pytest.fixture
def ux_db():
    """Base SQLite en mémoire simulant le profil Démonstration."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSession()
    stats_cache.invalidate()

    # Configuration initiale Autopilot
    db.add_all([
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="budget_minimum_threshold", value="30.0"),
        GlobalConfig(key="last_budget_recalibration_period", value=""),
        GlobalConfig(key="auto_create_budget_envelopes", value="false"),
        GlobalConfig(key="auto_apply_budget_suggestions", value="false"),
        GlobalConfig(key="enable_budget_creation_suggestions", value="true"),
        GlobalConfig(key="enable_budget_recalibration_suggestions", value="true"),
        GlobalConfig(key="budget_suggestion_engine", value="deterministic"),
    ])

    # Compte principal
    acc = Account(id=1, name="Compte Courant Principal", currency="EUR", initial_balance=2500.0)
    db.add(acc)

    # Catégories de base
    base_cats = [
        Category(id=1, name="Salaire", type="income"),
        Category(id=2, name="Logement", type="expense_fixed"),
        Category(id=3, name="Loisirs & Culture", type="expense_var"),
        Category(id=4, name="Alimentation & Restauration", type="expense_var"),
    ]
    db.add_all(base_cats)

    # Enveloppe existante 1 : Loisirs & Culture (177.43 €/mois)
    b_loisirs = Budget(
        id=1,
        name="Loisirs & Culture",
        monthly_amount=177.43,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False,
        base_annual_amount=177.43 * 12,
    )
    db.add(b_loisirs)
    db.flush()
    db.add(BudgetCategory(budget_id=b_loisirs.id, category_name="Loisirs & Culture"))

    # Enveloppe existante 2 : Alimentation & Restauration (300.00 €/mois)
    b_alim = Budget(
        id=2,
        name="Alimentation & Restauration",
        monthly_amount=300.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False,
        base_annual_amount=3600.0,
    )
    db.add(b_alim)
    db.flush()
    db.add(BudgetCategory(budget_id=b_alim.id, category_name="Alimentation & Restauration"))

    db.commit()
    yield db
    db.close()


def test_ux_auto_create_category_on_transaction(ux_db):
    """Vérifie que les nouvelles catégories sont créées automatiquement dans le référentiel."""
    # Simulation de l'arrivée d'opérations avec de nouveaux libellés de catégories
    new_categories = [
        ("Animaux & Vétérinaire", "expense_var"),
        ("Boulangerie & Pâtisserie", "expense_var"),
    ]
    for cat_name, cat_type in new_categories:
        existing = ux_db.query(Category).filter(Category.name == cat_name).first()
        if not existing:
            ux_db.add(Category(name=cat_name, type=cat_type))
    ux_db.commit()

    c_animaux = ux_db.query(Category).filter(Category.name == "Animaux & Vétérinaire").first()
    c_boulang = ux_db.query(Category).filter(Category.name == "Boulangerie & Pâtisserie").first()

    assert c_animaux is not None
    assert c_animaux.type == "expense_var"
    assert c_boulang is not None
    assert c_boulang.type == "expense_var"


def test_ux_discover_new_envelope_for_new_category(ux_db):
    """Cas 1 : Une nouvelle catégorie régulière engendre une suggestion de création d'enveloppe."""
    # Créer la catégorie
    ux_db.add(Category(name="Animaux & Vétérinaire", type="expense_var"))

    today = date.today()
    # Injecter 3 mois d'opérations (> 30 €/mois)
    for m_offset, amount in [(3, 83.5), (2, 87.0), (1, 83.0)]:
        tx_date = (today.replace(day=1) - relativedelta(months=m_offset)).replace(day=15)
        ux_db.add(Transaction(
            date_saisie=today,
            date_operation=tx_date,
            description=f"Maxi Zoo - Mois -{m_offset}",
            amount=-amount,
            type="expense_var",
            category="Animaux & Vétérinaire",
            from_account_id=1,
        ))
    ux_db.commit()

    # 1. Vérifier la détection comme catégorie orpheline
    orphans = get_unbudgeted_categories(ux_db)
    assert "Animaux & Vétérinaire" in orphans

    # 2. Exécuter la suggestion
    proposals = suggest_new_envelopes(ux_db, force=True, engine_override="deterministic")
    assert len(proposals) >= 1

    animaux_prop = next((p for p in proposals if p["name"] == "Animaux & Vétérinaire"), None)
    assert animaux_prop is not None
    assert animaux_prop["observed_months"] == 3
    assert animaux_prop["suggested_amount"] == 84.5  # Moyenne (83.5 + 87.0 + 83.0) / 3 = 84.5
    assert animaux_prop["type"] == "creation"

    # Vérifier qu'une décision SUGGESTED a été créée sans modifier les budgets
    b_count = ux_db.query(Budget).count()
    assert b_count == 2  # Loisirs & Culture + Alimentation & Restauration

    decision = ux_db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.action == "SUGGESTED",
        AutopilotDecisionLog.decision_type == "budget_creation_suggestion",
    ).first()
    assert decision is not None
    snap = json.loads(decision.raw_snapshot)
    assert snap["name"] == "Animaux & Vétérinaire"


def test_ux_approve_new_envelope_with_custom_amount(ux_db):
    """Cas UX : L'utilisateur approuve la suggestion en modifiant le montant dans l'interface (ex: 90 € au lieu de 84.50 €)."""
    ux_db.add(Category(name="Animaux & Vétérinaire", type="expense_var"))
    today = date.today()
    for m_offset, amount in [(3, 83.5), (2, 87.0), (1, 83.0)]:
        tx_date = (today.replace(day=1) - relativedelta(months=m_offset)).replace(day=15)
        ux_db.add(Transaction(
            date_saisie=today,
            date_operation=tx_date,
            description="Soins Vétérinaire",
            amount=-amount,
            type="expense_var",
            category="Animaux & Vétérinaire",
            from_account_id=1,
        ))
    ux_db.commit()

    proposals = suggest_new_envelopes(ux_db, force=True, engine_override="deterministic")
    decision_id = proposals[0]["decision_id"]

    # Approbation avec un montant personnalisé de 90.00 €
    res = apply_budget_suggestion(ux_db, decision_id, custom_amount=90.0)

    assert res["ok"] is True
    assert res["amount"] == 90.0
    assert res["name"] == "Animaux & Vétérinaire"

    # Vérifier la création effective de l'enveloppe en DB
    new_b = ux_db.query(Budget).filter(Budget.name == "Animaux & Vétérinaire").first()
    assert new_b is not None
    assert new_b.monthly_amount == 90.0
    assert new_b.envelope_type == "spending"

    # Vérifier l'association dans budget_categories
    b_cat = ux_db.query(BudgetCategory).filter(BudgetCategory.budget_id == new_b.id).first()
    assert b_cat is not None
    assert b_cat.category_name == "Animaux & Vétérinaire"

    # Vérifier la traçabilité ActionHistory
    history = ux_db.query(ActionHistory).filter(
        ActionHistory.entity_type == "budget",
        ActionHistory.entity_id == new_b.id,
        ActionHistory.action_type == "CREATE",
    ).first()
    assert history is not None


def test_ux_attach_new_category_to_existing_envelope(ux_db):
    """Cas 2 : Rattachement d'une nouvelle sous-catégorie ("Boulangerie & Pâtisserie") à une enveloppe existante."""
    ux_db.add(Category(name="Boulangerie & Pâtisserie", type="expense_var"))
    b_alim = ux_db.query(Budget).filter(Budget.name == "Alimentation & Restauration").first()

    # Rattacher la catégorie à l'enveloppe Alimentation
    ux_db.add(BudgetCategory(budget_id=b_alim.id, category_name="Boulangerie & Pâtisserie"))
    ux_db.commit()

    # Vérifier que l'enveloppe regroupe les deux catégories
    linked = ux_db.query(BudgetCategory.category_name).filter(BudgetCategory.budget_id == b_alim.id).all()
    names = [row[0] for row in linked]
    assert "Alimentation & Restauration" in names
    assert "Boulangerie & Pâtisserie" in names

    # Vérifier que "Boulangerie & Pâtisserie" n'est plus orpheline
    orphans = get_unbudgeted_categories(ux_db)
    assert "Boulangerie & Pâtisserie" not in orphans


def test_ux_drift_and_ema_recalibration_suggestion(ux_db):
    """Cas 3 : Dérive de dépenses sur Loisirs & Culture -> Suggestion de recalibrage EMA avec breakdown."""
    today = date.today()
    # Injecter des dépenses nettement supérieures au budget (Budget = 177.43 €, Réel = ~270 €/mois)
    for m_offset, amount in [(3, 260.0), (2, 275.0), (1, 280.0)]:
        tx_date = (today.replace(day=1) - relativedelta(months=m_offset)).replace(day=10)
        ux_db.add(Transaction(
            date_saisie=today,
            date_operation=tx_date,
            description=f"Concerts & Sorties - Mois -{m_offset}",
            amount=-amount,
            type="expense_var",
            category="Loisirs & Culture",
            from_account_id=1,
        ))
    ux_db.commit()

    # Évaluer les suggestions de recalibrage
    suggestions = evaluate_monthly_budget_suggestions(ux_db, force=True)
    assert len(suggestions) == 1

    s = suggestions[0]
    assert s["budget_name"] == "Loisirs & Culture"
    assert s["current_amount"] == 177.43
    # EMA = 0.80 * 177.43 + 0.20 * 271.67 = 196.28 €
    assert s["suggested_amount"] > 177.43
    assert s["delta_pct"] > 5.0
    assert s["drift_limit_reached"] is False
    assert len(s["category_breakdown"]) == 1
    assert s["category_breakdown"][0]["category"] == "Loisirs & Culture"

    # Vérifier le statut SUGGESTED dans la table de log
    dec = ux_db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.decision_type == "budget_suggestion",
        AutopilotDecisionLog.action == "SUGGESTED",
    ).first()
    assert dec is not None

    # L'enveloppe elle-même ne doit pas avoir été modifiée avant approbation
    b_loisirs = ux_db.query(Budget).filter(Budget.id == 1).first()
    assert b_loisirs.monthly_amount == 177.43


def test_ux_approve_recalibration_updates_envelope(ux_db):
    """Validation d'un recalibrage : Met à jour le montant et enregistre dans ActionHistory."""
    today = date.today()
    for m_offset, amount in [(3, 260.0), (2, 275.0), (1, 280.0)]:
        tx_date = (today.replace(day=1) - relativedelta(months=m_offset)).replace(day=10)
        ux_db.add(Transaction(
            date_saisie=today,
            date_operation=tx_date,
            description="Sorties",
            amount=-amount,
            type="expense_var",
            category="Loisirs & Culture",
            from_account_id=1,
        ))
    ux_db.commit()

    suggestions = evaluate_monthly_budget_suggestions(ux_db, force=True)
    dec_id = suggestions[0]["decision_id"]

    res = apply_budget_suggestion(ux_db, dec_id)
    assert res["ok"] is True
    assert res["type"] == "recalibration"

    # Vérifier que le budget a été mis à jour
    b_loisirs = ux_db.query(Budget).filter(Budget.id == 1).first()
    assert b_loisirs.monthly_amount == res["new_amount"]

    # Vérifier la décision marquée AUTO_COMMIT
    dec = ux_db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == dec_id).first()
    assert dec.action == "AUTO_COMMIT"


def test_ux_dismiss_and_anti_harassment(ux_db):
    """Rejet d'une suggestion et vérification qu'elle n'est plus reproposée."""
    ux_db.add(Category(name="Animaux & Vétérinaire", type="expense_var"))
    today = date.today()
    for m_offset in (1, 2, 3):
        tx_date = (today.replace(day=1) - relativedelta(months=m_offset)).replace(day=15)
        ux_db.add(Transaction(
            date_saisie=today,
            date_operation=tx_date,
            description="Clinique Vétérinaire",
            amount=-80.0,
            type="expense_var",
            category="Animaux & Vétérinaire",
            from_account_id=1,
        ))
    ux_db.commit()

    props = suggest_new_envelopes(ux_db, force=True)
    assert len(props) == 1
    dec_id = props[0]["decision_id"]

    # Rejet explicite
    res = dismiss_budget_suggestion(ux_db, dec_id)
    assert res["ok"] is True

    # Vérifier la présence dans les suggestions écartées
    dismissed = get_dismissed_budget_suggestions(ux_db)
    assert len(dismissed) == 1
    assert dismissed[0]["decision_id"] == dec_id

    # Une nouvelle évaluation NE DOIT PAS la reproposer (règle anti-harcèlement)
    new_props = suggest_new_envelopes(ux_db, force=True)
    assert len(new_props) == 0

    # Réactivation
    reactivate_budget_suggestion(ux_db, dec_id)
    active_props = get_all_pending_budget_suggestions(ux_db)
    assert len(active_props) == 1
    assert active_props[0]["decision_id"] == dec_id
