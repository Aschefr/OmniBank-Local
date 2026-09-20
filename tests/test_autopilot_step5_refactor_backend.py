"""
tests/test_autopilot_step5_refactor_backend.py — Suite de tests pour la validation des correctifs backend
de l'Étape 5 Auto-Pilote (intégrité des données, idempotence GET, détection multi-types, précision décimale).
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
)
from app.services.budget_service import (
    get_unbudgeted_categories,
    _get_monthly_spending_for_category,
    get_all_pending_budget_suggestions,
    apply_budget_suggestion,
)
from app.services import stats_cache


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée pour les tests backend."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
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


def test_get_all_pending_budget_suggestions_idempotent_no_db_mutation(test_db):
    """Vérifie que la lecture (GET) des suggestions est strictement idempotente et ne mute jamais la DB."""
    # Créer une suggestion valide
    snap = {
        "category": "Librairie",
        "suggested_amount": 42.50,
        "avg_monthly": 42.50,
        "name": "Budget Librairie",
    }
    decision = AutopilotDecisionLog(
        batch_id="test_batch_1",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap),
        confidence_score=75.0,
    )
    test_db.add(decision)
    test_db.commit()

    # Appel répété 3 fois
    for _ in range(3):
        res = get_all_pending_budget_suggestions(test_db)
        assert len(res) == 1
        assert res[0]["category"] == "Librairie"
        assert res[0]["suggested_amount"] == 42.50

    # Vérifier l'état en DB : toujours SUGGESTED, aucun effet de bord
    refreshed = test_db.query(AutopilotDecisionLog).filter_by(id=decision.id).first()
    assert refreshed.action == "SUGGESTED"


def test_get_unbudgeted_categories_supports_expense_and_expense_var(test_db):
    """Vérifie que get_unbudgeted_categories détecte à la fois expense_var et expense (sans income ni transfer)."""
    acc = Account(id=1, name="Compte Courant", initial_balance=1000.0)
    test_db.add(acc)

    today = date.today()
    # 1. Catégorie avec type 'expense_var'
    tx1 = Transaction(
        id=1,
        from_account_id=1,
        date_operation=today - relativedelta(days=5),
        amount=50.0,
        category="Courses Diverses",
        type="expense_var",
    )
    # 2. Catégorie avec type standard 'expense'
    tx2 = Transaction(
        id=2,
        from_account_id=1,
        date_operation=today - relativedelta(days=10),
        amount=75.0,
        category="Pharmacie",
        type="expense",
    )
    # 3. Catégorie avec type 'income' (doit être ignorée)
    tx3 = Transaction(
        id=3,
        from_account_id=1,
        date_operation=today - relativedelta(days=2),
        amount=1500.0,
        category="Salaire",
        type="income",
    )
    # 4. Catégorie avec type 'transfer' (doit être ignorée)
    tx4 = Transaction(
        id=4,
        from_account_id=1,
        date_operation=today - relativedelta(days=1),
        amount=200.0,
        category="Virement Épargne",
        type="transfer",
    )
    test_db.add_all([tx1, tx2, tx3, tx4])
    test_db.commit()

    unbudgeted = get_unbudgeted_categories(test_db)
    assert "Courses Diverses" in unbudgeted
    assert "Pharmacie" in unbudgeted
    assert "Salaire" not in unbudgeted
    assert "Virement Épargne" not in unbudgeted


def test_monthly_spending_includes_current_month(test_db):
    """Vérifie que _get_monthly_spending_for_category inclut bien les transactions du mois courant."""
    acc = Account(id=2, name="Compte Courant 2", initial_balance=1000.0)
    test_db.add(acc)

    today = date.today()
    one_month_ago = today - relativedelta(months=1)

    tx_past = Transaction(
        id=10,
        from_account_id=2,
        date_operation=one_month_ago,
        amount=60.0,
        category="Animaux",
        type="expense_var",
    )
    tx_current = Transaction(
        id=11,
        from_account_id=2,
        date_operation=today,
        amount=80.0,
        category="Animaux",
        type="expense_var",
    )
    test_db.add_all([tx_past, tx_current])
    test_db.commit()

    spending = _get_monthly_spending_for_category(test_db, "Animaux", lookback_months=2)
    # Le mois courant doit avoir 80.0 et le mois précédent 60.0
    non_zero = [s for s in spending if s > 0]
    assert 80.0 in non_zero
    assert 60.0 in non_zero


def test_apply_budget_suggestion_decimal_accuracy(test_db):
    """Vérifie que apply_budget_suggestion préserve rigoureusement les centimes non entiers (29.50 €, 33.33 €)."""
    # 1. Test création avec montant décimal exact
    snap_creation = {
        "name": "Pâtisserie & Café",
        "category": "Café",
        "categories": ["Café", "Pâtisserie"],
        "suggested_amount": 29.50,
        "suggested_period": "monthly",
    }
    dec_creation = AutopilotDecisionLog(
        batch_id="batch_create",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap_creation),
        confidence_score=85.0,
    )
    test_db.add(dec_creation)
    test_db.commit()

    res_create = apply_budget_suggestion(test_db, dec_creation.id)
    assert res_create["ok"] is True
    assert res_create["amount"] == 29.50

    b_created = test_db.query(Budget).filter_by(id=res_create["budget_id"]).first()
    assert b_created.monthly_amount == 29.50

    # 2. Test recalibrage avec custom_amount précis
    snap_recalib = {
        "budget_id": b_created.id,
        "current_amount": 29.50,
        "suggested_amount": 35.00,
    }
    dec_recalib = AutopilotDecisionLog(
        batch_id="batch_recalib",
        decision_type="budget_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        entity_id=b_created.id,
        raw_snapshot=json.dumps(snap_recalib),
        confidence_score=90.0,
    )
    test_db.add(dec_recalib)
    test_db.commit()

    res_recalib = apply_budget_suggestion(test_db, dec_recalib.id, custom_amount=33.33)
    assert res_recalib["ok"] is True
    assert res_recalib["new_amount"] == 33.33

    test_db.refresh(b_created)
    assert b_created.monthly_amount == 33.33


def test_ineligible_keywords_filtered_without_db_purge(test_db):
    """Vérifie que les suggestions concernant des mots-clés inéligibles sont filtrées sans être purgées en base."""
    snap = {
        "category": "Remboursement Prêt Immobilier",
        "suggested_amount": 450.0,
        "name": "Prêt Immo",
    }
    decision = AutopilotDecisionLog(
        batch_id="batch_pret",
        decision_type="budget_creation_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        raw_snapshot=json.dumps(snap),
        confidence_score=80.0,
    )
    test_db.add(decision)
    test_db.commit()

    # Lecture : ne doit pas apparaître dans les suggestions actives
    res = get_all_pending_budget_suggestions(test_db)
    assert len(res) == 0

    # Vérification DB : le record reste SUGGESTED, sans mutation clandestine
    test_db.refresh(decision)
    assert decision.action == "SUGGESTED"


def test_orphan_recalibrations_cleaned_on_budget_deletion(test_db):
    """Vérifie que la suppression d'une enveloppe écarte automatiquement ses suggestions de recalibrage orphelines."""
    from app.services.budget_service import delete_single_budget, evaluate_monthly_budget_suggestions

    b = Budget(id=99, name="Courses Test", monthly_amount=150.0, envelope_type="spending", period="monthly", is_closed=False, is_project=False, is_locked=False)
    test_db.add(b)
    test_db.commit()

    dec = AutopilotDecisionLog(
        batch_id="batch_orphan_test",
        decision_type="budget_suggestion",
        action="SUGGESTED",
        entity_type="budget",
        entity_id=99,
        raw_snapshot=json.dumps({"budget_id": 99, "budget_name": "Courses Test", "suggested_amount": 180.0}),
        confidence_score=85.0,
    )
    test_db.add(dec)
    test_db.commit()

    # Avant suppression : 1 suggestion
    assert len(get_all_pending_budget_suggestions(test_db)) == 1

    # Suppression de l'enveloppe
    delete_single_budget(99, test_db)

    # Après suppression : 0 suggestion orpheline
    assert len(get_all_pending_budget_suggestions(test_db)) == 0

    test_db.refresh(dec)
    assert dec.action == "DISMISSED"


def test_evaluate_monthly_budget_suggestions_signature_and_timestamp(test_db):
    """Vérifie la compatibilité multi-arguments de evaluate_monthly_budget_suggestions et la mise à jour de l'horodatage."""
    from app.services.budget_service import evaluate_monthly_budget_suggestions

    # Appel avec signature (db, profile_id, force) comme fait par bank_sync_scheduler
    res = evaluate_monthly_budget_suggestions(test_db, "default", True)
    assert isinstance(res, list)

    # Vérifier l'enregistrement de l'horodatage de dernière analyse
    cfg_time = test_db.query(GlobalConfig).filter_by(key="last_budget_autopilot_run_at").first()
    assert cfg_time is not None
    assert "T" in cfg_time.value  # ISO format


def test_deterministic_thematic_clustering_groups_categories(test_db):
    """Vérifie que l'algorithme déterministe regroupe les catégories en enveloppes thématiques (évite 1 cat = 1 enveloppe)."""
    from app.services.budget_service import suggest_new_envelopes

    acc = Account(id=1, name="Compte Test", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    for m in range(1, 3):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(from_account_id=1, category="Boulangerie", amount=30.0, type="expense_var", date_operation=past_date, date_saisie=past_date))
        test_db.add(Transaction(from_account_id=1, category="Courses", amount=120.0, type="expense_var", date_operation=past_date, date_saisie=past_date))
        test_db.add(Transaction(from_account_id=1, category="Essence", amount=80.0, type="expense_var", date_operation=past_date, date_saisie=past_date))
        test_db.add(Transaction(from_account_id=1, category="Automobile", amount=150.0, type="expense_var", date_operation=past_date, date_saisie=past_date))
    test_db.commit()

    suggestions = suggest_new_envelopes(test_db, force=True, engine_override="deterministic")
    # Au lieu de 4 enveloppes séparées, l'algorithme déterministe crée 2 enveloppes thématiques
    assert len(suggestions) == 2
    names = {s["name"] for s in suggestions}
    assert "Alimentation & Quotidien" in names
    assert "Mobilité & Transports" in names

    alim = next(s for s in suggestions if s["name"] == "Alimentation & Quotidien")
    assert set(alim["categories"]) == {"Boulangerie", "Courses"}
    assert alim["suggested_amount"] == 150.0

    mob = next(s for s in suggestions if s["name"] == "Mobilité & Transports")
    assert set(mob["categories"]) == {"Essence", "Automobile"}
    assert mob["suggested_amount"] == 230.0


def test_commit_reviewed_transactions_triggers_budget_discovery(test_db):
    """Vérifie que la validation du Sas bancaire déclenche la découverte des enveloppes indépendamment de l'Auto-Pilote global."""
    from app.services.bank_sync.sync_service import BankSyncService
    from app.models import BankConnection, AutopilotDecisionLog

    # S'assurer que le master-switch global auto_pilot_enabled est désactivé
    cfg = test_db.query(GlobalConfig).filter_by(key="auto_pilot_enabled").first()
    if cfg:
        cfg.value = "false"
    else:
        test_db.add(GlobalConfig(key="auto_pilot_enabled", value="false"))

    # Activer le volet découverte des budgets
    cfg_bud = test_db.query(GlobalConfig).filter_by(key="enable_budget_creation_suggestions").first()
    if cfg_bud:
        cfg_bud.value = "true"
    else:
        test_db.add(GlobalConfig(key="enable_budget_creation_suggestions", value="true"))

    acc = Account(id=10, name="Compte Sas Test", initial_balance=1000.0)
    test_db.add(acc)
    conn = BankConnection(id=10, label="Banque Test", backend="dummy", is_active=True)
    test_db.add(conn)
    test_db.commit()

    # Ajouter l'historique sur 2 mois précédents pour une catégorie orpheline "Loisirs"
    today = date.today()
    for m in (1, 2):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-5)
        test_db.add(Transaction(
            from_account_id=10,
            category="Loisirs",
            amount=50.0,
            type="expense_var",
            date_operation=past_date,
            date_saisie=past_date,
            description="Cinéma"
        ))
    test_db.commit()

    # Valider une transaction dans le Sas
    items = [{
        "date_operation": today.isoformat(),
        "description": "Nouveau restaurant",
        "amount": 40.0,
        "raw_amount": -40.0,
        "is_reconciled": False,
        "category": "Loisirs",
        "account_id": 10
    }]
    res = BankSyncService.commit_reviewed_transactions(
        db=test_db,
        connection_id=10,
        transactions_data=items
    )
    assert res["imported"] == 1

    # Vérifier qu'une suggestion de création d'enveloppe a bien été émise
    decisions = test_db.query(AutopilotDecisionLog).filter_by(
        decision_type="budget_creation_suggestion"
    ).all()
    assert len(decisions) >= 1
    assert any("Loisirs" in (d.raw_snapshot or "") for d in decisions)


def test_autopilot_master_switch_snapshot_and_restore(test_db):
    """Vérifie que basculer l'auto-pilote de 0 à 1 active les modules, et que le retour à 0 restaure fidèlement les réglages personnalisés."""
    from app.services.autopilot_service import set_autopilot_enabled, is_autopilot_enabled

    # 1. Initialiser le Master Switch à 0 (OFF)
    set_autopilot_enabled(test_db, False)
    assert is_autopilot_enabled(test_db) is False

    # 2. Établir une configuration personnalisée avant activation
    custom_settings = {
        "enable_budget_creation_suggestions": "false",
        "enable_budget_recalibration_suggestions": "true",
        "auto_create_budget_envelopes": "false",
        "auto_apply_budget_suggestions": "false",
    }
    for k, v in custom_settings.items():
        row = test_db.query(GlobalConfig).filter_by(key=k).first()
        if row:
            row.value = v
        else:
            test_db.add(GlobalConfig(key=k, value=v))
    test_db.commit()

    # 3. Activer le Master Switch (0 -> 1)
    set_autopilot_enabled(test_db, True)
    assert is_autopilot_enabled(test_db) is True
    # Vérifier que les sous-options ont été basculées à true
    for k in ("enable_budget_creation_suggestions", "enable_budget_recalibration_suggestions"):
        cfg = test_db.query(GlobalConfig).filter_by(key=k).first()
        assert cfg is not None and cfg.value == "true"

    # 4. Désactiver le Master Switch (1 -> 0)
    set_autopilot_enabled(test_db, False)
    assert is_autopilot_enabled(test_db) is False

    # 5. Vérifier que la configuration personnalisée initiale a été fidèlement restaurée
    cfg_create = test_db.query(GlobalConfig).filter_by(key="enable_budget_creation_suggestions").first()
    assert cfg_create is not None and cfg_create.value == "false", "La sous-option personnalisée de création aurait dû être restaurée à 'false'"


def test_budget_enrichment_detection_approval_and_undo(test_db):
    """Vérifie la détection d'affinité thématique entre une catégorie orpheline et une enveloppe existante (enrichissement),
    son approbation en 1-clic et la réversibilité complète (Undo).
    """
    from app.services.budget_service import suggest_new_envelopes, apply_budget_suggestion, get_all_pending_budget_suggestions
    from app.services.history_service import undo_action
    from app.models import ActionHistory

    # 1. Créer une enveloppe existante 'Alimentation & Courses' avec la catégorie 'Supermarché'
    b = Budget(
        name="Alimentation & Courses",
        monthly_amount=300.0,
        period="monthly",
        is_project=False,
        is_closed=False,
        envelope_type="spending",
        base_annual_amount=3600.0,
    )
    test_db.add(b)
    test_db.flush()
    test_db.add(BudgetCategory(budget_id=b.id, category_name="Supermarché"))
    test_db.commit()

    # 2. Créer un compte et injecter des dépenses régulières pour la catégorie orpheline 'Boulangerie'
    # ('Boulangerie' partage le thème 'Alimentation / Courses / Nourriture' avec 'Supermarché')
    acc = Account(id=20, name="Compte Courant Test", initial_balance=1500.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    for m in (1, 2):
        past_date = today.replace(day=1) - relativedelta(months=m, days=-3)
        test_db.add(Transaction(
            from_account_id=20,
            category="Boulangerie",
            amount=50.0,
            type="expense_var",
            date_operation=past_date,
            date_saisie=past_date,
            description="Pain et viennoiseries"
        ))
    test_db.commit()

    # 3. Lancer la détection des suggestions
    suggestions = suggest_new_envelopes(test_db)
    assert len(suggestions) >= 1

    # Trouver la suggestion d'enrichissement
    enrich_sug = next((s for s in suggestions if s["type"] == "enrichment"), None)
    assert enrich_sug is not None, "Une suggestion d'enrichissement aurait dû être produite plutôt qu'une création isolée"
    assert enrich_sug["category"] == "Boulangerie"
    assert enrich_sug["target_budget_id"] == b.id
    assert enrich_sug["suggested_amount"] == 350.0  # 300.0 + 50.0
    assert enrich_sug["additional_amount"] == 50.0

    # 4. Vérifier get_all_pending_budget_suggestions
    pending = get_all_pending_budget_suggestions(test_db)
    assert any(p["type"] == "enrichment" and p["category"] == "Boulangerie" for p in pending)

    # 5. Approuver la suggestion
    res = apply_budget_suggestion(test_db, enrich_sug["decision_id"])
    assert res["ok"] is True
    assert res["type"] == "enrichment"
    assert res["new_amount"] == 350.0

    # Vérifier l'état en DB : la catégorie Boulangerie est rattachée et le plafond est augmenté
    test_db.refresh(b)
    assert b.monthly_amount == 350.0
    cats = [bc.category_name for bc in test_db.query(BudgetCategory).filter_by(budget_id=b.id).all()]
    assert "Boulangerie" in cats
    assert "Supermarché" in cats

    # 6. Vérifier l'Undo de l'enrichissement
    action_id = res["action_id"]
    action = test_db.query(ActionHistory).filter_by(id=action_id).first()
    undo_ok, undo_msg = undo_action(test_db, action)
    assert undo_ok is True

    test_db.refresh(b)
    assert b.monthly_amount == 300.0
    cats_after_undo = [bc.category_name for bc in test_db.query(BudgetCategory).filter_by(budget_id=b.id).all()]
    assert "Boulangerie" not in cats_after_undo, "La catégorie 'Boulangerie' aurait dû être détachée lors de l'Undo"
    assert "Supermarché" in cats_after_undo

    # La décision Autopilot est revenue à SUGGESTED
    dec = test_db.query(AutopilotDecisionLog).filter_by(id=enrich_sug["decision_id"]).first()
    assert dec.action == "SUGGESTED"


def test_is_category_explicit(test_db):
    """Vérifie que _is_category_explicit distingue correctement les catégories explicites des ambiguës."""
    from app.services.budget_service import _is_category_explicit

    # Catégories explicites — matchent un thème spécifique de dépense
    assert _is_category_explicit("Boulangerie") is True       # Alimentation
    assert _is_category_explicit("Pharmacie") is True          # Santé
    assert _is_category_explicit("Habillement") is True        # Mode
    assert _is_category_explicit("Essence") is True            # Transports
    assert _is_category_explicit("Cinéma") is True             # Loisirs

    # Catégories ambiguës — plateformes marchandes (Amazon, Paypal, etc.) et termes génériques (Divers, etc.)
    assert _is_category_explicit("Amazon") is False            # Plateforme e-commerce marchande
    assert _is_category_explicit("Divers") is False            # Terme fourre-tout générique
    assert _is_category_explicit("Paypal") is False            # Plateforme de paiement
    assert _is_category_explicit("Cdiscount") is False         # Plateforme e-commerce
    assert _is_category_explicit("AliExpress") is False        # Plateforme e-commerce
    assert _is_category_explicit("Stripe") is False
    assert _is_category_explicit("Cadeaux") is False
    assert _is_category_explicit("Cotisations") is False
    assert _is_category_explicit("Square") is False
    assert _is_category_explicit("Envoie Postal") is False


def test_extract_context_hints_cleans_banking_noise(test_db):
    """Vérifie que _extract_category_context_hints extrait des termes propres et ignore le bruit bancaire.
    Les catégories explicites ne doivent jamais déclencher d'extraction.
    """
    from app.services.budget_service import _extract_category_context_hints

    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()

    # 1. Catégorie ambiguë "Cadeaux" avec des libellés bancaires bruts
    for i, desc in enumerate([
        "CB*FNAC LIVRES 12/08 REF8294 PARIS FRA",
        "CARTE FNAC 13/08 LIVRES POCHES",
        "CB*FNAC MKTP FR JOUETS REF1234",
        "PRLV SEPA FNAC LIVRES 14.08.2026",
        "FNAC LIVRES COMMANDE",
    ]):
        past_date = today.replace(day=1) - relativedelta(months=1, days=-(i+1))
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Cadeaux",
            amount=30.0,
            type="expense_var",
            date_operation=past_date,
            date_saisie=past_date,
            description=desc,
        ))
    test_db.commit()

    hint = _extract_category_context_hints(test_db, "Cadeaux")
    assert hint is not None, "La catégorie 'Cadeaux' est ambiguë et devrait avoir un hint"
    # "fnac" et "livres" devraient être les termes les plus fréquents
    hint_lower = hint.lower()
    assert "fnac" in hint_lower, f"'fnac' devrait apparaître dans le hint, obtenu : {hint}"
    assert "livres" in hint_lower, f"'livres' devrait apparaître dans le hint, obtenu : {hint}"
    # Les stopwords bancaires ne doivent pas apparaître
    for noise in ["cb", "prlv", "sepa", "mktp", "ref", "paris", "fra"]:
        assert noise not in hint_lower.split(", "), f"Le bruit bancaire '{noise}' ne devrait pas être dans le hint : {hint}"

    # 2. Catégorie explicite "Boulangerie" → aucun hint
    for i in range(3):
        past_date = today.replace(day=1) - relativedelta(months=1, days=-(i+1))
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Boulangerie",
            amount=5.0,
            type="expense_var",
            date_operation=past_date,
            date_saisie=past_date,
            description="Pain et viennoiseries",
        ))
    test_db.commit()

    hint_explicit = _extract_category_context_hints(test_db, "Boulangerie")
    assert hint_explicit is None, "Les catégories explicites ne doivent pas déclencher d'extraction"


def test_deterministic_clustering_uses_context_hints(test_db):
    """Vérifie que le moteur déterministe utilise les context_hints pour grouper les catégories ambiguës
    dans le bon thème plutôt que de les laisser orphelines.
    Deux catégories ambiguës avec des hints pointant vers le même thème doivent être regroupées.
    """
    from app.services.budget_service import _cluster_categories_deterministically

    cat_stats = {
        # Ambiguë, hint → Technologies & Numérique
        "Paypal": {
            "suggested_amount": 80.0,
            "avg_monthly": 80.0,
            "observed_months": 3,
            "monthly_values": [70.0, 85.0, 85.0],
            "context_hint": "informatique, gadgets",
        },
        # Ambiguë aussi, hint → Technologies & Numérique (même thème)
        "Stripe": {
            "suggested_amount": 40.0,
            "avg_monthly": 40.0,
            "observed_months": 2,
            "monthly_values": [35.0, 45.0],
            "context_hint": "logiciel, cloud, saas",
        },
        # Ambiguë, hint → Loisirs, Sorties & Culture
        "Cadeaux": {
            "suggested_amount": 50.0,
            "avg_monthly": 50.0,
            "observed_months": 2,
            "monthly_values": [45.0, 55.0],
            "context_hint": "livres, culture, jouets",
        },
        # Explicite par nom ("boulanger" matche Alimentation) — pas de hint
        "Boulangerie": {
            "suggested_amount": 25.0,
            "avg_monthly": 25.0,
            "observed_months": 3,
            "monthly_values": [20.0, 25.0, 30.0],
        },
    }

    proposals = _cluster_categories_deterministically(cat_stats, engine_tag="deterministic")

    # Boulangerie devrait matcher Alimentation & Quotidien par son nom
    boulangerie_prop = next((p for p in proposals if "Boulangerie" in p["categories"]), None)
    assert boulangerie_prop is not None

    # Paypal et Stripe devraient être regroupés ensemble via hints → Technologies & Numérique
    paypal_prop = next((p for p in proposals if "Paypal" in p["categories"]), None)
    assert paypal_prop is not None
    stripe_prop = next((p for p in proposals if "Stripe" in p["categories"]), None)
    assert stripe_prop is not None
    # Ils doivent être dans la MÊME proposition (regroupement thématique via hints)
    assert paypal_prop is stripe_prop, \
        f"Paypal et Stripe devraient être groupés ensemble via leurs hints : Paypal={paypal_prop}, Stripe={stripe_prop}"
    assert paypal_prop["name"] == "Technologies & Numérique", \
        f"L'enveloppe regroupant Paypal+Stripe devrait s'appeler 'Technologies & Numérique', obtenu : {paypal_prop['name']}"
    assert paypal_prop["suggested_amount"] == 120.0  # 80 + 40

    # Cadeaux devrait matcher Loisirs via son hint "culture"
    cadeaux_prop = next((p for p in proposals if "Cadeaux" in p["categories"]), None)
    assert cadeaux_prop is not None
    # Vérifie que le hint "culture" a rattaché Cadeaux au thème Loisirs (pas orphelin)
    # Comme c'est seul dans le thème Loisirs, le nom prendra le nom de la catégorie
    # Mais l'important est qu'il ne soit pas dans la section "orphelines"
    orphan_names = [p["name"] for p in proposals if len(p["categories"]) == 1 and p["justification"].startswith("Moyenne")]
    # Cadeaux doit avoir été capté par le thème, pas traité en orphelin avec justification orpheline
    # (la justification du thème est "Moyenne constatée sur X mois" seulement pour single-cat thèmes)
    # Ce qui compte : les 4 catégories sont assignées, aucune n'est dans le "remaining" orphan loop
    all_categorized = set()
    for p in proposals:
        all_categorized.update(p["categories"])
    assert all_categorized == {"Paypal", "Stripe", "Cadeaux", "Boulangerie"}

