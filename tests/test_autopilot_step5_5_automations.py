"""
tests/test_autopilot_step5_5_automations.py
-------------------------------------------
Suite de validation automatisée pour l'Étape 5.5 de la roadmap Auto-Pilote :
- T5.5.1 : Valeurs par défaut ("false" pour les 6 clés) et migration schéma v28
- T5.5.2 : Modularité du rapprochement (auto_reconcile_transactions = True vs False)
- T5.5.3 : Validation automatique des écritures (auto_commit_incoming_transactions) & garde-fou commerçants polyvalents
- T5.5.4 : Création autonome des catégories (auto_create_missing_categories = True vs fallback)
- T5.5.5 : Auto-apprentissage des règles marchands (auto_learn_merchant_rules = True vs False)
- T5.5.6 : Snapshot / Restauration lors de l'activation / désactivation globale de l'Auto-Pilote
- Endpoints API : /api/transactions/autopilot/history et /api/smart-labels/autopilot/history
"""

import json
import pytest
from datetime import date, datetime
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
    GlobalConfig,
    AutopilotDecisionLog,
    BankLabelMapping,
    ActionHistory,
)
from app.routers.config import CONFIG_DEFAULTS
from app.migrations.runner import TARGET_SCHEMA_VERSION
from app.services.autopilot_service import (
    process_incoming_batch,
    is_autopilot_enabled,
    set_autopilot_enabled,
    get_operations_automations_history,
    get_smart_labels_automations_history,
    AUTOPILOT_MANAGED_KEYS,
)
from app.services.bank_sync_scheduler import _PENDING_SYNC_DATA


@pytest.fixture
def test_db():
    """Base SQLite isolée en mémoire pour tester l'Étape 5.5."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Compte courant de référence
    acc = Account(id=1, name="Compte Courant Test", type="checking", initial_balance=2500.0)
    db.add(acc)

    # Catégories de base
    db.add(Category(name="Alimentation", type="expense"))
    db.add(Category(name="Dépenses diverses", type="expense"))
    db.add(Category(name="Revenus divers", type="income"))
    db.add(Category(name="Transports", type="expense"))

    # Initialiser les clés par défaut
    for k, v in CONFIG_DEFAULTS.items():
        db.add(GlobalConfig(key=k, value=v))
    db.commit()

    # Réinitialiser le sas mémoire
    _PENDING_SYNC_DATA.clear()

    yield db

    db.close()


def test_t5_5_1_defaults_and_schema_version(test_db):
    """T5.5.1 : Vérifie que les 6 nouveaux toggles sont tous à 'false' par défaut et que le schéma est en v28."""
    assert TARGET_SCHEMA_VERSION == 28

    expected_keys = [
        "auto_reconcile_transactions",
        "auto_commit_incoming_transactions",
        "auto_close_empty_import_sas",
        "auto_create_missing_categories",
        "auto_learn_merchant_rules",
        "auto_assign_chameleon_fallback",
    ]

    for key in expected_keys:
        assert key in CONFIG_DEFAULTS, f"Clé manquante dans CONFIG_DEFAULTS: {key}"
        assert CONFIG_DEFAULTS[key] == "false", f"La clé {key} doit avoir la valeur par défaut 'false'"
        cfg = test_db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        assert cfg is not None, f"Clé absente de la DB: {key}"
        assert cfg.value == "false", f"Valeur en base non conforme pour {key}: {cfg.value}"

    # Vérifier l'inclusion dans AUTOPILOT_MANAGED_KEYS
    for key in expected_keys:
        assert key in AUTOPILOT_MANAGED_KEYS, f"{key} doit être géré par l'Auto-Pilote"


def test_t5_5_2_reconciliation_modularity(test_db):
    """T5.5.2 : Teste l'activation indépendante du rapprochement automatique."""
    # Transaction prévue en base
    t_date = date.today()
    db_tx = Transaction(
        from_account_id=1,
        date_saisie=t_date,
        date_operation=t_date,
        amount=45.0,
        description="Courses Monoprix",
        category="Alimentation",
        type="expense_var",
        reconciliation_date=None,
    )
    test_db.add(db_tx)
    test_db.commit()
    test_db.refresh(db_tx)

    raw_batch = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_monoprix_1",
                        "date": t_date.strftime("%Y-%m-%d"),
                        "raw_amount": -45.0,
                        "amount": 45.0,
                        "description": "MONOPRIX PARIS 15",
                        "raw_description": "CB MONOPRIX PARIS 15",
                        "category": "Alimentation",
                        "is_reconciled": True,
                        "matched_db_id": db_tx.id,
                        "match_score": 95.0,
                        "smart_suggested": True,
                    }
                ],
            }
        ]
    }

    # Cas A : auto_reconcile_transactions = "false" et auto_pilot_enabled = "false"
    # Rien ne doit être auto-rapproché en base
    res_a = process_incoming_batch(test_db, "conn_1", raw_batch, profile_id="p1")
    assert res_a["auto_reconciled"] == 0
    test_db.refresh(db_tx)
    assert db_tx.reconciliation_date is None, "La transaction ne doit pas être rapprochée quand le toggle est inactif"

    # Cas B : auto_reconcile_transactions = "true", auto_pilot_enabled = "false"
    cfg = test_db.query(GlobalConfig).filter(GlobalConfig.key == "auto_reconcile_transactions").first()
    cfg.value = "true"
    test_db.commit()

    res_b = process_incoming_batch(test_db, "conn_1", raw_batch, profile_id="p1")
    assert res_b["auto_reconciled"] == 1
    assert res_b["status"] == "completed"
    test_db.refresh(db_tx)
    assert db_tx.reconciliation_date is not None, "La transaction doit être rapprochée automatiquement"


def test_t5_5_3_auto_commit_and_chameleon_guard(test_db):
    """T5.5.3 : Validation automatique des écritures et blocage sécuritaire des marchands polyvalents."""
    t_date = date.today().strftime("%Y-%m-%d")

    # Transaction normale (Boulangerie)
    batch_normal = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_boulangerie",
                        "date": t_date,
                        "raw_amount": -4.50,
                        "amount": 4.50,
                        "description": "BOULANGERIE DU COIN",
                        "category": "Alimentation",
                        "confidence": 0.95,
                        "smart_suggested": True,
                        "is_reconciled": False,
                        "matched_db_id": None,
                    }
                ],
            }
        ]
    }

    # Règle multi-catégorie pour Amazon
    test_db.add(BankLabelMapping(
        raw_pattern="AMAZON",
        clean_description="Amazon",
        is_multi_category=True,
        is_manual=True,
    ))
    test_db.commit()

    batch_chameleon = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_amazon",
                        "date": t_date,
                        "raw_amount": -29.90,
                        "amount": 29.90,
                        "description": "AMAZON EU SARL",
                        "category": "Dépenses diverses",
                        "confidence": 0.90,
                        "smart_is_multi_category": True,
                        "smart_suggested": True,
                        "is_reconciled": False,
                        "matched_db_id": None,
                    }
                ],
            }
        ]
    }

    # 1. auto_commit = "false" -> Aucun enregistrement direct
    res_1 = process_incoming_batch(test_db, "conn_norm", batch_normal, profile_id="p1")
    assert res_1["auto_committed"] == 0
    assert test_db.query(Transaction).filter(Transaction.description.like("%BOULANGERIE%")).first() is None

    # 2. auto_commit = "true", chameleon_fallback = "false"
    test_db.query(GlobalConfig).filter(GlobalConfig.key == "auto_commit_incoming_transactions").first().value = "true"
    test_db.commit()

    # Le marchand normal doit être validé directement
    res_2 = process_incoming_batch(test_db, "conn_norm", batch_normal, profile_id="p1")
    assert res_2["auto_committed"] == 1
    tx_created = test_db.query(Transaction).filter(Transaction.description.like("%BOULANGERIE%")).first()
    assert tx_created is not None
    assert tx_created.amount == 4.50

    # Le marchand polyvalent doit être bloqué dans le sas pour arbitrage humain !
    res_cham_1 = process_incoming_batch(test_db, "conn_cham", batch_chameleon, profile_id="p1")
    assert res_cham_1["auto_committed"] == 0
    assert res_cham_1["pending"] == 1
    assert test_db.query(Transaction).filter(Transaction.description.like("%AMAZON%")).first() is None

    # 3. Activation de auto_assign_chameleon_fallback = "true"
    test_db.query(GlobalConfig).filter(GlobalConfig.key == "auto_assign_chameleon_fallback").first().value = "true"
    test_db.commit()

    res_cham_2 = process_incoming_batch(test_db, "conn_cham", batch_chameleon, profile_id="p1")
    assert res_cham_2["auto_committed"] == 1
    tx_cham = test_db.query(Transaction).filter(Transaction.description.like("%AMAZON%")).first()
    assert tx_cham is not None


def test_t5_5_4_category_auto_creation_modularity(test_db):
    """T5.5.4 : Création autonome des catégories inconnues vs repli sur catégorie générique."""
    test_db.query(GlobalConfig).filter(GlobalConfig.key == "auto_commit_incoming_transactions").first().value = "true"
    test_db.commit()

    t_date = date.today().strftime("%Y-%m-%d")
    batch = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_fitness",
                        "date": t_date,
                        "raw_amount": -39.99,
                        "amount": 39.99,
                        "description": "BASIC FIT GYM",
                        "category": "Sport & Fitness Inconnu",
                        "confidence": 0.95,
                        "smart_suggested": True,
                        "smart_is_new_category": True,
                        "is_reconciled": False,
                        "matched_db_id": None,
                    }
                ],
            }
        ]
    }

    # Cas A : auto_create_missing_categories = "false"
    res_a = process_incoming_batch(test_db, "conn_gym_a", batch, profile_id="p1")
    assert res_a["categories_created"] == 0
    # La catégorie "Sport & Fitness Inconnu" ne doit pas exister dans la table Category
    cat_check_a = test_db.query(Category).filter(Category.name == "Sport & Fitness Inconnu").first()
    assert cat_check_a is None
    # L'opération créée a été repliée sur "Dépenses diverses"
    tx_a = test_db.query(Transaction).filter(Transaction.description.like("%BASIC FIT%")).first()
    assert tx_a is not None
    assert tx_a.category == "Dépenses diverses"
    test_db.delete(tx_a)
    test_db.commit()

    # Cas B : auto_create_missing_categories = "true"
    test_db.query(GlobalConfig).filter(GlobalConfig.key == "auto_create_missing_categories").first().value = "true"
    test_db.commit()

    res_b = process_incoming_batch(test_db, "conn_gym_b", batch, profile_id="p1")
    assert res_b["categories_created"] == 1
    # La catégorie doit maintenant exister dans la table Category
    cat_check_b = test_db.query(Category).filter(Category.name == "Sport & Fitness Inconnu").first()
    assert cat_check_b is not None
    assert cat_check_b.type == "expense_var"
    tx_b = test_db.query(Transaction).filter(Transaction.description.like("%BASIC FIT%")).first()
    assert tx_b is not None
    assert tx_b.category == "Sport & Fitness Inconnu"


def test_t5_5_5_merchant_rule_auto_learning(test_db):
    """T5.5.5 : Auto-apprentissage des règles marchands lors de l'intégration."""
    test_db.query(GlobalConfig).filter(GlobalConfig.key == "auto_commit_incoming_transactions").first().value = "true"
    test_db.commit()

    t_date = date.today().strftime("%Y-%m-%d")
    batch = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_sncf",
                        "date": t_date,
                        "raw_amount": -55.0,
                        "amount": 55.0,
                        "description": "SNCF CONNECT VOYAGES 75",
                        "clean_description": "SNCF Connect",
                        "category": "Transports",
                        "confidence": 0.95,
                        "smart_suggested": True,
                        "is_reconciled": False,
                        "matched_db_id": None,
                    }
                ],
            }
        ]
    }

    # Cas A : auto_learn_merchant_rules = "false"
    res_a = process_incoming_batch(test_db, "conn_sncf_a", batch, profile_id="p1")
    assert res_a["rules_learned"] == 0
    mapping_a = test_db.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern.like("%SNCF%")).first()
    assert mapping_a is None

    # Nettoyage
    test_db.query(Transaction).delete()
    test_db.commit()

    # Cas B : auto_learn_merchant_rules = "true"
    test_db.query(GlobalConfig).filter(GlobalConfig.key == "auto_learn_merchant_rules").first().value = "true"
    test_db.commit()

    res_b = process_incoming_batch(test_db, "conn_sncf_b", batch, profile_id="p1")
    assert res_b["rules_learned"] == 1
    mapping_b = test_db.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern.like("%SNCF%")).first()
    assert mapping_b is not None
    assert mapping_b.is_manual is False
    assert mapping_b.category == "Transports"


def test_t5_5_6_autopilot_cascading_snapshot_and_restore(test_db):
    """T5.5.6 : L'activation globale active toutes les briques, et la désactivation restaure fidèlement les choix utilisateurs."""
    # 1. L'utilisateur configure des choix personnalisés
    custom_prefs = {
        "auto_reconcile_transactions": "true",
        "auto_commit_incoming_transactions": "false",
        "auto_close_empty_import_sas": "true",
        "auto_create_missing_categories": "false",
        "auto_learn_merchant_rules": "true",
        "auto_assign_chameleon_fallback": "false",
    }
    for k, v in custom_prefs.items():
        test_db.query(GlobalConfig).filter(GlobalConfig.key == k).first().value = v
    test_db.commit()

    # 2. Passage de l'Auto-Pilote à ON (0 -> 1)
    set_autopilot_enabled(test_db, True)
    assert is_autopilot_enabled(test_db) is True

    # Toutes les clés gérées doivent être passées à "true"
    for k in custom_prefs.keys():
        val = test_db.query(GlobalConfig).filter(GlobalConfig.key == k).first().value
        assert val == "true", f"La clé {k} doit être 'true' en mode Auto-Pilote"

    # Vérifier que le snapshot a bien mémorisé les préférences d'origine
    snap_cfg = test_db.query(GlobalConfig).filter(GlobalConfig.key == "autopilot_subtoggles_pre_activation_snapshot").first()
    assert snap_cfg is not None and snap_cfg.value
    snap = json.loads(snap_cfg.value)
    for k, v in custom_prefs.items():
        assert snap.get(k) == v, f"Snapshot altéré pour {k}: {snap.get(k)} != {v}"

    # 3. Passage de l'Auto-Pilote à OFF (1 -> 0)
    set_autopilot_enabled(test_db, False)
    assert is_autopilot_enabled(test_db) is False

    # Restauration exacte des préférences personnalisées
    for k, v in custom_prefs.items():
        val = test_db.query(GlobalConfig).filter(GlobalConfig.key == k).first().value
        assert val == v, f"Restauration échouée pour {k} : attendu '{v}', obtenu '{val}'"


def test_history_endpoints(test_db):
    """Vérifie le bon fonctionnement des endpoints d'historique des opérations et des règles apprises."""
    app.dependency_overrides[get_db] = lambda: test_db
    client = TestClient(app)

    # 1. Générer une décision dans AutopilotDecisionLog
    dlog = AutopilotDecisionLog(
        batch_id="batch_hist_1",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        confidence_score=95.0,
        raw_snapshot=json.dumps({
            "bank_tx": {
                "description": "PHARMACIE CENTRALE",
                "amount": -18.50,
                "category": "Santé"
            },
            "decision_reason": "high_confidence"
        }),
        is_undone=False,
    )
    test_db.add(dlog)

    # 2. Générer une règle apprise
    mapping = BankLabelMapping(
        raw_pattern="PHARMACIE CENTRALE",
        clean_description="Pharmacie Centrale",
        category="Santé",
        is_manual=False,
    )
    test_db.add(mapping)
    test_db.commit()

    # Tester l'endpoint transactions autopilot history
    res_op = client.get("/api/transactions/autopilot/history?limit=5")
    assert res_op.status_code == 200
    data_op = res_op.json()
    assert len(data_op) >= 1
    assert data_op[0]["label"] == "PHARMACIE CENTRALE"
    assert data_op[0]["amount"] == -18.50
    assert data_op[0]["action"] == "AUTO_COMMIT"

    # Tester l'endpoint smart labels autopilot history
    res_sl = client.get("/api/smart-labels/autopilot/history?limit=5")
    assert res_sl.status_code == 200
    data_sl = res_sl.json()
    assert len(data_sl) >= 1
    assert data_sl[0]["clean_label"] == "Pharmacie Centrale"
    assert data_sl[0]["category"] == "Santé"

    app.dependency_overrides.clear()
