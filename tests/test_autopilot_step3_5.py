"""
tests/test_autopilot_step3_5.py
--------------------------------
Pack de Test 3.5 pour l'Auto-Pilote OmniBank Local :
- T3.5.1 : Dépense inconnue sans IA -> Catégorie fourre-tout 'Dépenses diverses' (mémoire, table Category intacte).
- T3.5.2 : Recette inconnue sans IA -> Catégorie fourre-tout 'Revenus divers' (type income).
- T3.5.3 : Marchand caméléon sans règle manuelle ('AMAZON PAYMENTS') -> 'Amazon' + 'Dépenses diverses' + multi_cat.
- T3.5.4 : Nouvelle catégorie IA valide acceptée ('Jardinage' pour Truffaut) -> category_is_new = True.
- T3.5.5 : Déchet / hallucination IA rejeté par validate_ai_suggested_category -> repli sur catégorie fourre-tout.
- T3.5.6 : Garde-fou anti-prolifération -> Maximum 2 nouvelles catégories par lot, le reste en repli.
- T3.5.7 : Proximité lexicale >= 80% (Alimentations vs Alimentation) -> Fusion sur catégorie existante, pas de doublon.
- T3.5.8 : Auto-commit Auto-Pilote sur lot mixte sans supervision -> pending = 0, toutes insérées en Transaction.
- T3.5.9 : Validation manuelle Sas -> ensure_category_exists persiste les catégories en base avec le bon type.
- T3.5.10 : Protection de l'apprentissage -> learn_label_mapping n'enregistre pas de règle auto sur catégorie fourre-tout.
"""
import json
from datetime import date
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account,
    ActionHistory,
    AutopilotDecisionLog,
    BankLabelMapping,
    Category,
    GlobalConfig,
    Transaction,
)
from app.services.autopilot_service import process_incoming_batch
from app.services.bank_sync_scheduler import _PENDING_SYNC_DATA
from app.services.bank_sync_service import BankSyncService
from app.services.chat.ollama_client import (
    _parse_and_validate_batch_response,
    validate_ai_suggested_category,
)
from app.services.smart_label_service import (
    ensure_category_exists,
    is_fallback_category,
    learn_label_mapping,
    normalize_raw_label,
    resolve_fallback_category,
    resolve_smart_labels_batch,
)


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée pour les tests Step 3.5."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Compte de référence
    acc = Account(id=1, name="Compte Courant", type="checking", initial_balance=2500.0)
    db.add(acc)

    # Initialisation des configs par défaut (Auto-Pilote actif)
    db.add(GlobalConfig(key="auto_pilot_enabled", value="true"))
    db.add(GlobalConfig(key="ollama_enabled", value="false"))
    db.commit()

    _PENDING_SYNC_DATA.clear()
    try:
        yield db
    finally:
        db.close()
        _PENDING_SYNC_DATA.clear()


# =====================================================================
# T3.5.1 : Dépense inconnue sans IA -> 'Dépenses diverses' en mémoire
# =====================================================================
def test_t3_5_1_unknown_expense_fallback_category(test_db):
    raw_labels = ["CB FLEURISTE DU COIN 75011"]
    tx_types = {"CB FLEURISTE DU COIN 75011": "expense"}

    results = resolve_smart_labels_batch(
        test_db,
        raw_labels,
        tx_types=tx_types,
        use_ai_fallback=False,
        auto_fallback_category=True,
    )

    resolved = results["CB FLEURISTE DU COIN 75011"]
    assert resolved["description"] == "Fleuriste Du Coin"
    assert resolved["category"] == "Dépenses diverses"
    assert resolved["source"] == "fallback"
    assert resolved["smart_is_fallback"] is True
    assert resolved["smart_is_new_category"] is False

    # Vérification que la table Category est intacte (aucune insertion en DB)
    cat_in_db = (
        test_db.query(Category)
        .filter(Category.name == "Dépenses diverses")
        .first()
    )
    assert cat_in_db is None


# =====================================================================
# T3.5.2 : Recette inconnue sans IA -> 'Revenus divers' en mémoire
# =====================================================================
def test_t3_5_2_unknown_income_fallback_category(test_db):
    raw_labels = ["VIR INST MLLE MARINE PLAZA"]
    tx_types = {"VIR INST MLLE MARINE PLAZA": "income"}

    results = resolve_smart_labels_batch(
        test_db,
        raw_labels,
        tx_types=tx_types,
        use_ai_fallback=False,
        auto_fallback_category=True,
    )

    resolved = results["VIR INST MLLE MARINE PLAZA"]
    assert "Marine Plaza" in resolved["description"]
    assert resolved["category"] == "Revenus divers"
    assert resolved["source"] == "fallback"
    assert resolved["smart_is_fallback"] is True

    # Vérification que la table Category est intacte
    cat_in_db = (
        test_db.query(Category)
        .filter(Category.name == "Revenus divers")
        .first()
    )
    assert cat_in_db is None


# =====================================================================
# T3.5.3 : Marchand caméléon sans règle manuelle -> repli 'Dépenses diverses'
# =====================================================================
def test_t3_5_3_chameleon_fallback_category(test_db):
    raw_labels = ["AMAZON PAYMENTS LUXEMBOURG"]
    tx_types = {"AMAZON PAYMENTS LUXEMBOURG": "expense"}

    results = resolve_smart_labels_batch(
        test_db,
        raw_labels,
        tx_types=tx_types,
        use_ai_fallback=False,
        auto_fallback_category=True,
    )

    resolved = results["AMAZON PAYMENTS LUXEMBOURG"]
    assert "Amazon" in resolved["description"]
    assert resolved["category"] == "Dépenses diverses"
    assert resolved["is_multi_category"] is True
    assert resolved["source"] in ("multi_category", "fallback")
    assert resolved["smart_is_fallback"] is True


# =====================================================================
# T3.5.4 : Nouvelle catégorie IA valide acceptée ('Jardinage' pour Truffaut)
# =====================================================================
def test_t3_5_4_valid_ai_new_category():
    existing_categories = ["Alimentation", "Logement", "Transports"]
    clean_cat, is_new = validate_ai_suggested_category(
        "Jardinage", existing_categories
    )

    assert clean_cat == "Jardinage"
    assert is_new is True


# =====================================================================
# T3.5.5 : Déchet ou hallucination IA rejeté par validate_ai_suggested_category
# =====================================================================
def test_t3_5_5_ai_waste_rejected():
    existing_categories = ["Alimentation", "Logement"]

    # Prompt artifacts / bavardages / tokens interdits
    invalid_cases = [
        "Voici la catégorie : {Boutique}",
        "Catégorie: Dépense",
        "N/A",
        "Autre",
        "Inconnu",
        "Une très très longue catégorie qui dépasse largement quarante caractères et n'a aucun sens",
        "Dépenses diverses",  # interdit en création directe IA (mot banni)
        "",
        None,
    ]

    for raw_cat in invalid_cases:
        clean_cat, is_new = validate_ai_suggested_category(
            raw_cat, existing_categories
        )
        assert clean_cat is None, f"Devrait rejeter: {raw_cat}"
        assert is_new is False


# =====================================================================
# T3.5.6 : Garde-fou anti-prolifération : max 2 nouvelles catégories par lot
# =====================================================================
def test_t3_5_6_anti_proliferation_max_two_new_categories():
    existing_categories = ["Alimentation", "Logement"]
    descriptions = ["Truffaut", "Veterinaire", "Opticien", "Coiffeur", "Pressing"]
    raw_payload = {
        d: {"name": d, "category": cat}
        for d, cat in [
            ("Truffaut", "Jardinage"),
            ("Veterinaire", "Animaux"),
            ("Opticien", "Santé & Optique"),
            ("Coiffeur", "Beauté & Soins"),
            ("Pressing", "Entretien Vêtements"),
        ]
    }
    raw_content = json.dumps(raw_payload)

    results = _parse_and_validate_batch_response(
        raw_content=raw_content,
        descriptions=descriptions,
        categories=existing_categories,
        suggest_names=True,
    )

    # Vérification des deux premières
    assert results["Truffaut"]["category"] == "Jardinage"
    assert results["Truffaut"]["category_is_new"] is True

    assert results["Veterinaire"]["category"] == "Animaux"
    assert results["Veterinaire"]["category_is_new"] is True

    # Les 3 suivantes doivent voir leur catégorie nouvelle neutralisée (None),
    # pour être reprises par le filet de sécurité déterministe
    assert results["Opticien"]["category"] is None
    assert results["Opticien"]["category_is_new"] is False

    assert results["Coiffeur"]["category"] is None
    assert results["Coiffeur"]["category_is_new"] is False

    assert results["Pressing"]["category"] is None
    assert results["Pressing"]["category_is_new"] is False


# =====================================================================
# T3.5.7 : Proximité lexicale >= 80% -> Fusion sur catégorie existante
# =====================================================================
def test_t3_5_7_lexical_proximity_merging():
    existing_categories = ["Alimentation", "Loisirs & Sorties", "Santé"]

    # 1. Pluriel / Singulier
    clean_cat, is_new = validate_ai_suggested_category(
        "Alimentations", existing_categories
    )
    assert clean_cat == "Alimentation"
    assert is_new is False

    # 2. Casse / accents légers
    clean_cat2, is_new2 = validate_ai_suggested_category(
        "alimentation", existing_categories
    )
    assert clean_cat2 == "Alimentation"
    assert is_new2 is False

    # 3. Proximité forte
    clean_cat3, is_new3 = validate_ai_suggested_category(
        "Loisir & Sortie", existing_categories
    )
    assert clean_cat3 == "Loisirs & Sorties"
    assert is_new3 is False


# =====================================================================
# T3.5.8 : Auto-commit Auto-Pilote sur lot mixte sans supervision
# =====================================================================
def test_t3_5_8_autopilot_auto_commit_mixed_batch(test_db):
    """
    Lot comprenant :
    1. Amazon (marchand caméléon -> Dépenses diverses)
    2. Virement reçu inconnu (recette -> Revenus divers)
    3. Boulangerie inconnue (dépense -> Dépenses diverses)
    Auto-Pilote actif -> 100% des écritures auto-engagées, sas d'attente vide (pending = 0).
    """
    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "account_name": "Compte Courant",
                "transactions": [
                    {
                        "date_operation": "2026-10-05",
                        "description": "AMAZON PAYMENTS",
                        "raw_description": "AMAZON PAYMENTS",
                        "amount": 29.99,
                        "raw_amount": -29.99,
                        "is_reconciled": False,
                        "already_reconciled": False,
                        "csv_id": "tx_amazon_1",
                        "account_id": 1,
                        "is_coming": False,
                    },
                    {
                        "date_operation": "2026-10-06",
                        "description": "VIR INST MLLE MARINE PLAZA",
                        "raw_description": "VIR INST MLLE MARINE PLAZA",
                        "amount": 120.00,
                        "raw_amount": 120.00,
                        "is_reconciled": False,
                        "already_reconciled": False,
                        "csv_id": "tx_marine_2",
                        "account_id": 1,
                        "is_coming": False,
                    },
                    {
                        "date_operation": "2026-10-07",
                        "description": "CB BOULANGERIE ARTISANALE",
                        "raw_description": "CB BOULANGERIE ARTISANALE",
                        "amount": 4.50,
                        "raw_amount": -4.50,
                        "is_reconciled": False,
                        "already_reconciled": False,
                        "csv_id": "tx_boulangerie_3",
                        "account_id": 1,
                        "is_coming": False,
                    },
                ],
            }
        ]
    }

    res = process_incoming_batch(
        test_db, conn_id=1, preview_data=preview_data, profile_id="default"
    )

    assert res["status"] == "completed"
    assert res["auto_committed"] == 3
    assert res["pending"] == 0

    # Vérification en base de données
    txs = test_db.query(Transaction).all()
    assert len(txs) == 3

    descs = {t.description: t for t in txs}
    amazon_tx = [t for t in txs if "Amazon" in t.description][0]
    assert amazon_tx.category == "Dépenses diverses"
    assert amazon_tx.type == "expense_var"
    assert amazon_tx.reconciliation_date is not None

    marine_tx = [t for t in txs if "Marine Plaza" in t.description][0]
    assert marine_tx.category == "Revenus divers"
    assert marine_tx.type == "income"
    assert marine_tx.amount == 120.0

    boulange_tx = descs["Boulangerie Artisanale"]
    assert boulange_tx.category == "Dépenses diverses"
    assert boulange_tx.type == "expense_var"

    # Vérification de la création automatique des catégories dans la table Category
    cat_dep = (
        test_db.query(Category)
        .filter(Category.name == "Dépenses diverses")
        .first()
    )
    assert cat_dep is not None
    assert cat_dep.type == "expense_var"

    cat_rev = (
        test_db.query(Category).filter(Category.name == "Revenus divers").first()
    )
    assert cat_rev is not None
    assert cat_rev.type == "income"

    # Vérification des logs d'audit dans AutopilotDecisionLog
    logs = test_db.query(AutopilotDecisionLog).all()
    assert len(logs) == 3
    reasons = set()
    for l in logs:
        if l.raw_snapshot:
            snap = json.loads(l.raw_snapshot)
            if snap.get("decision_reason"):
                reasons.add(snap["decision_reason"])
    assert "chameleon_default" in reasons or "fallback_catchall" in reasons


# =====================================================================
# T3.5.9 : Validation manuelle Sas -> ensure_category_exists persiste
# =====================================================================
def test_t3_5_9_manual_sas_commit_ensures_category_exists(test_db):
    acc = test_db.query(Account).filter(Account.id == 1).first()

    items_to_commit = [
        {
            "csv_id": "test_manual_1",
            "account_id": 1,
            "date_operation": "2026-10-10",
            "description": "Magasin Botanique",
            "amount": 54.20,
            "raw_amount": -54.20,
            "category": "Jardin & Plantes",
            "type": "expense",
            "is_reconciled": False,
        },
        {
            "csv_id": "test_manual_2",
            "account_id": 1,
            "date_operation": "2026-10-11",
            "description": "Vente Brocante",
            "amount": 35.00,
            "raw_amount": 35.00,
            "category": "Revenus divers",
            "type": "income",
            "is_reconciled": False,
        },
    ]

    commit_res = BankSyncService.commit_reviewed_transactions(
        test_db, connection_id=-1, transactions_data=items_to_commit
    )

    assert commit_res["imported"] == 2

    # Vérifier que les catégories ont été créées en DB avec le bon type
    cat_jardin = (
        test_db.query(Category)
        .filter(Category.name == "Jardin & Plantes")
        .first()
    )
    assert cat_jardin is not None
    assert cat_jardin.type in ("expense", "expense_var")

    cat_rev = (
        test_db.query(Category).filter(Category.name == "Revenus divers").first()
    )
    assert cat_rev is not None
    assert cat_rev.type == "income"


# =====================================================================
# T3.5.10 : Protection de l'apprentissage sur les catégories fourre-tout
# =====================================================================
def test_t3_5_10_anti_pollution_learning_protection(test_db):
    """
    learn_label_mapping ne doit JAMAIS mémoriser de règle automatique
    associant un marchand à 'Dépenses diverses' ou 'Revenus divers'.
    """
    # 1. Apprentissage automatique (is_manual=False)
    rule_auto = learn_label_mapping(
        test_db,
        raw_label="CB FLEURISTE DU COIN",
        clean_description="Fleuriste Du Coin",
        category="Dépenses diverses",
        is_manual=False,
    )
    # L'apprentissage automatique sur catégorie fourre-tout est ignoré (retourne None)
    # ou enregistre avec category = None pour ne pas cimenter la fausse catégorie
    if rule_auto is not None:
        assert rule_auto.category is None or rule_auto.category == ""

    pat = normalize_raw_label("CB FLEURISTE DU COIN")
    rule_in_db = (
        test_db.query(BankLabelMapping)
        .filter(BankLabelMapping.raw_pattern == pat)
        .first()
    )
    if rule_in_db is not None:
        assert rule_in_db.category is None or rule_in_db.category == ""

    # 2. Apprentissage manuel explicite par l'utilisateur (is_manual=True)
    rule_manual = learn_label_mapping(
        test_db,
        raw_label="CB MARCHAND PARTICULIER",
        clean_description="Marchand Particulier",
        category="Dépenses diverses",
        is_manual=True,
    )
    assert rule_manual is not None
    assert rule_manual.category == "Dépenses diverses"
    assert rule_manual.is_manual is True


# =====================================================================
# T3.5.11 : Résolution pré-visualisation / revue manuelle avec IA et repli
# =====================================================================
def test_t3_5_11_re_evaluate_preview_with_ai_and_fallback(test_db):
    """
    Vérifie que re_evaluate_sync_preview résout automatiquement les opérations
    sans catégorie avec l'IA (si active) et le filet fourre-tout.
    """
    from app.services.bank_sync_service import re_evaluate_preview_data

    # Activer l'IA dans la base de test
    ai_cfg = test_db.query(GlobalConfig).filter(GlobalConfig.key == "enable_ai").first()
    if not ai_cfg:
        test_db.add(GlobalConfig(key="enable_ai", value="true"))
    else:
        ai_cfg.value = "true"
    test_db.add(Category(name="Achats en ligne", type="expense_var"))
    test_db.add(Category(name="Virements reçus", type="income"))
    test_db.commit()

    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_ai_test_1",
                        "raw_description": "AMAZON PAYMENTS EUROPE S C A AMA",
                        "description": "Amazon Payments",
                        "amount": 71.94,
                        "raw_amount": -71.94,
                        "is_reconciled": False,
                        "category": None
                    },
                    {
                        "csv_id": "tx_ai_test_2",
                        "raw_description": "VIR INST DE MLLE MARINE PLAZA",
                        "description": "Vir Inst Mlle Marine Plaza",
                        "amount": 137.50,
                        "raw_amount": 137.50,
                        "is_reconciled": False,
                        "category": None
                    }
                ]
            }
        ]
    }

    fake_ai_results = {
        "Amazon Payments Europe S C A Ama": {"name": "Amazon", "category": "Achats en ligne", "category_is_new": False},
        "De Mlle Marine Plaza": {"name": "Marine Plaza", "category": "Virements reçus", "category_is_new": False}
    }

    with patch("app.services.chat.ollama_client.call_ollama_batch", return_value=fake_ai_results):
        refreshed = re_evaluate_preview_data(test_db, preview_data, use_ai_fallback=True)

    txs = refreshed["accounts"][0]["transactions"]
    t1 = txs[0]
    t2 = txs[1]

    # Amazon doit être classé par l'IA
    assert t1["category"] == "Achats en ligne"
    assert t1["smart_suggested"] is True
    assert t1["smart_source"] == "ai"

    # Virement reçu classé par l'IA
    assert t2["category"] == "Virements reçus"
    assert t2["smart_suggested"] is True
    assert t2["smart_source"] == "ai"
