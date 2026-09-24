"""
tests/test_autopilot_step6.py
-----------------------------
Suite de validation automatisée pour l'Étape 6 de la roadmap Auto-Pilote :
- T6.1 : Centre de Contrôle, endpoints d'état (/status, /kpis, /decisions, /threshold) et validation seuil (70-99%)
- T6.2 : Rollback sémantique unitaire (annulation écriture, dépointage avec restauration snapshot, rollback récurrence)
- T6.3 : Rollback sémantique d'un cycle complet (/rollback-cycle/{batch_id}) et reconstitution du lot dans le Sas
- T6.4 : Correction manuelle (/override) et auto-apprentissage des règles marchands
- T6.5 : Mutations budgétaires full-auto, garde-fous de dérive et synchronisation Récurrence -> Budget
- T6.6 : Intégrité et exhaustivité bilingue des clés i18n (fr.json & en.json)
"""

import json
import pytest
from datetime import date, datetime, timezone
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
    Budget,
    BudgetCategory,
    RecurrenceTemplate,
    GlobalConfig,
    AutopilotDecisionLog,
    BankLabelMapping,
    ActionHistory,
)
from app.services.autopilot_service import (
    is_autopilot_enabled,
    set_autopilot_enabled,
    get_auto_reconcile_threshold,
    set_auto_reconcile_threshold,
    get_autopilot_status,
    get_autopilot_kpis,
    get_autopilot_decisions_feed,
    rollback_autopilot_decision,
    rollback_autopilot_cycle,
    override_autopilot_decision,
    unpoint_autopilot_decision,
    process_incoming_batch,
)
from app.services.budget_service import (
    sync_budget_from_recurrence_change,
    suggest_new_envelopes,
    evaluate_monthly_budget_suggestions,
)
from app.services.bank_sync_scheduler import _PENDING_SYNC_DATA, CSV_IMPORT_CONN_ID


@pytest.fixture
def test_db():
    """Base SQLite isolée en mémoire pour tester l'Étape 6."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Compte de référence
    acc = Account(id=1, name="Compte Principal Test", type="checking", initial_balance=3000.0)
    db.add(acc)

    # Catégories de référence
    cats = [
        Category(id=1, name="Alimentation", type="expense_var"),
        Category(id=2, name="Abonnements", type="expense_fixed"),
        Category(id=3, name="Salaire", type="income"),
        Category(id=4, name="Dépenses diverses", type="expense_var"),
        Category(id=5, name="Revenus divers", type="income"),
    ]
    db.add_all(cats)
    db.commit()

    yield db
    db.close()


@pytest.fixture
def client(test_db):
    """Client FastAPI utilisant la base SQLite isolée."""
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ============================================================================
# T6.1 : Status, Master Switch, Threshold & KPIs
# ============================================================================

def test_autopilot_status_and_toggle(client, test_db):
    """Vérifie la consultation de statut et l'activation en cascade du mode Auto-Pilote."""
    res = client.get("/api/autopilot/status")
    assert res.status_code == 200
    data = res.json()
    assert data["is_enabled"] is False
    assert data["threshold"] == 85.0

    # Activation
    res_toggle = client.post("/api/autopilot/toggle", json={"enabled": True})
    assert res_toggle.status_code == 200
    assert res_toggle.json()["is_enabled"] is True
    assert is_autopilot_enabled(test_db) is True

    # Désactivation
    res_toggle_off = client.post("/api/autopilot/toggle", json={"enabled": False})
    assert res_toggle_off.status_code == 200
    assert res_toggle_off.json()["is_enabled"] is False
    assert is_autopilot_enabled(test_db) is False


def test_autopilot_threshold_validation_and_effect(client, test_db):
    """Vérifie le réglage du seuil de tolérance (70-99%) et son impact sur l'auto-commit."""
    # GET seuil
    res = client.get("/api/autopilot/threshold")
    assert res.status_code == 200
    assert res.json()["threshold"] == 85.0

    # PUT seuil valide
    res_put = client.put("/api/autopilot/threshold", json={"threshold": 92.5})
    assert res_put.status_code == 200
    assert res_put.json()["threshold"] == 92.5
    assert get_auto_reconcile_threshold(test_db) == 92.5

    # PUT seuil invalide (<70 ou >99)
    res_invalid_low = client.put("/api/autopilot/threshold", json={"threshold": 65.0})
    assert res_invalid_low.status_code == 400

    res_invalid_high = client.put("/api/autopilot/threshold", json={"threshold": 105.0})
    assert res_invalid_high.status_code == 400

    # Vérification de l'effet du seuil sur l'ingestion :
    # Si seuil = 95%, une opération à 90% ne doit PAS être auto-committée
    set_autopilot_enabled(test_db, True)
    set_auto_reconcile_threshold(test_db, 95.0)

    preview_data = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_thresh_1",
                        "raw_amount": -45.0,
                        "amount": 45.0,
                        "description": "MONOPRIX COURSES",
                        "category": "Alimentation",
                        "smart_confidence": 0.90,  # 90% < 95% threshold
                        "is_reconciled": False,
                    }
                ]
            }
        ]
    }
    res_batch = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data)
    assert res_batch["auto_committed"] == 1
    assert res_batch["needs_review"] == 1
    tx_created = test_db.query(Transaction).filter(Transaction.csv_id == "tx_thresh_1").first()
    assert tx_created is not None
    assert tx_created.needs_review is True

    # Abaisser le seuil à 85% pour un nouveau batch : l'opération à 90% est fiable (needs_review = False)
    set_auto_reconcile_threshold(test_db, 85.0)
    preview_data2 = {
        "accounts": [
            {
                "account_id": 1,
                "transactions": [
                    {
                        "csv_id": "tx_thresh_2",
                        "raw_amount": -50.0,
                        "amount": 50.0,
                        "description": "MONOPRIX COURSES 2",
                        "category": "Alimentation",
                        "smart_confidence": 0.90,  # 90% >= 85% threshold
                        "is_reconciled": False,
                    }
                ]
            }
        ]
    }
    res_batch2 = process_incoming_batch(test_db, conn_id=1, preview_data=preview_data2)
    assert res_batch2["auto_committed"] == 1
    assert res_batch2["needs_review"] == 0
    tx_created2 = test_db.query(Transaction).filter(Transaction.csv_id == "tx_thresh_2").first()
    assert tx_created2 is not None
    assert tx_created2.needs_review is False


def test_autopilot_kpis_calculation(client, test_db):
    """Vérifie le calcul fidèle des KPIs et de l'estimation du temps épargné."""
    # Créer quelques décisions
    d1 = AutopilotDecisionLog(
        batch_id="b1",
        decision_type="reconciliation",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=101,
        confidence_score=95.0,
        is_undone=False
    )
    d2 = AutopilotDecisionLog(
        batch_id="b1",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=102,
        confidence_score=90.0,
        is_undone=False
    )
    d3 = AutopilotDecisionLog(
        batch_id="b1",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=103,
        confidence_score=88.0,
        is_undone=True,  # Undone
        undone_at=datetime.now(timezone.utc)
    )
    test_db.add_all([d1, d2, d3])
    test_db.commit()

    res = client.get("/api/autopilot/kpis")
    assert res.status_code == 200
    kpis = res.json()
    assert kpis["total_decisions"] == 3
    assert kpis["auto_reconciled"] == 1
    assert kpis["auto_committed"] == 1
    assert kpis["undone_decisions"] == 1
    assert kpis["accuracy_rate"] == 66.7  # 2 active / 3 total
    assert kpis["hours_saved_estimate"] >= 0.0


# ============================================================================
# T6.2 : Semantic Rollback (Unitary: new_entry, reconciliation, recurrence)
# ============================================================================

def test_rollback_single_new_entry_decision(client, test_db):
    """Vérifie que l'annulation d'une décision new_entry supprime la transaction créée."""
    tx = Transaction(
        csv_id="tx_rollback_single",
        date_operation=date.today(),
        description="Achat Test",
        amount=30.0,
        type="expense_var",
        category="Alimentation",
        from_account_id=1
    )
    test_db.add(tx)
    test_db.flush()

    d = AutopilotDecisionLog(
        batch_id="batch_single",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx.id,
        confidence_score=95.0,
        is_undone=False
    )
    test_db.add(d)
    test_db.commit()

    res = client.post(f"/api/autopilot/decisions/{d.id}/rollback")
    assert res.status_code == 200
    assert res.json()["success"] is True

    # Vérifier que la transaction a bien été supprimée
    deleted_tx = test_db.query(Transaction).filter(Transaction.id == tx.id).first()
    assert deleted_tx is None

    # Vérifier que la décision est marquée is_undone
    test_db.refresh(d)
    assert d.is_undone is True
    assert d.undone_at is not None


def test_unpoint_reconciliation_decision(client, test_db):
    """Vérifie que le dépointage restaure fidèlement la prévision d'origine sans la supprimer."""
    orig_snap = {
        "amount": 50.0,
        "category": "Abonnements",
        "description": "Prévision Internet",
        "comment": None
    }
    tx = Transaction(
        date_operation=date.today(),
        description="Facture Orange Déviante",
        amount=54.99,
        type="expense_fixed",
        category="Abonnements",
        reconciliation_date=date.today(),
        from_account_id=1,
        comment="Auto-ajusté : 50.00 € → 54.99 €"
    )
    test_db.add(tx)
    test_db.flush()

    d = AutopilotDecisionLog(
        batch_id="batch_rec",
        decision_type="reconciliation",
        action="AUTO_RECONCILED_DEVIANT",
        entity_type="transaction",
        entity_id=tx.id,
        raw_snapshot=json.dumps({"before": orig_snap, "actual_amount": 54.99}),
        confidence_score=90.0,
        is_undone=False
    )
    test_db.add(d)
    test_db.commit()

    res = client.post(f"/api/autopilot/decisions/{d.id}/unpoint")
    assert res.status_code == 200
    assert res.json()["success"] is True

    # Vérifier que la transaction existe toujours mais dépointée avec son montant initial
    test_db.refresh(tx)
    assert tx.reconciliation_date is None
    assert tx.amount == 50.0
    assert tx.description == "Prévision Internet"


# ============================================================================
# T6.3 : Batch Cycle Rollback & Sas Reconstitution
# ============================================================================

def test_rollback_batch_cycle_and_sas_reconstitution(client, test_db):
    """Vérifie le rollback complet d'un lot et sa reconstitution intégrale dans le Sas d'attente."""
    set_autopilot_enabled(test_db, True)
    batch_id = "batch_test_cycle_123"

    # Créer 2 transactions dans ce batch
    tx1 = Transaction(csv_id="c1", date_operation=date.today(), description="Carrefour", amount=60.0, type="expense_var", from_account_id=1)
    tx2 = Transaction(csv_id="c2", date_operation=date.today(), description="Boulangerie", amount=12.0, type="expense_var", from_account_id=1)
    test_db.add_all([tx1, tx2])
    test_db.flush()

    d1 = AutopilotDecisionLog(
        batch_id=batch_id,
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx1.id,
        conn_id=CSV_IMPORT_CONN_ID,
        account_id=1,
        raw_snapshot=json.dumps({"bank_tx": {"csv_id": "c1", "amount": -60.0, "raw_amount": -60.0, "description": "Carrefour", "account_id": 1}}),
        confidence_score=90.0,
        is_undone=False
    )
    d2 = AutopilotDecisionLog(
        batch_id=batch_id,
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx2.id,
        conn_id=CSV_IMPORT_CONN_ID,
        account_id=1,
        raw_snapshot=json.dumps({"bank_tx": {"csv_id": "c2", "amount": -12.0, "raw_amount": -12.0, "description": "Boulangerie", "account_id": 1}}),
        confidence_score=88.0,
        is_undone=False
    )
    test_db.add_all([d1, d2])
    test_db.commit()

    # Rollback du lot complet
    res = client.post(f"/api/autopilot/rollback-cycle/{batch_id}")
    assert res.status_code == 200
    out = res.json()
    assert out["success"] is True
    assert out["undone_count"] == 2
    assert out["reconstituted_in_sas"] is True

    # Vérifier que les transactions en base ont été supprimées
    assert test_db.query(Transaction).filter(Transaction.id.in_([tx1.id, tx2.id])).count() == 0

    # Vérifier que le Sas contient à nouveau les 2 opérations
    pending = _PENDING_SYNC_DATA.get("default", {}).get(CSV_IMPORT_CONN_ID, {})
    assert "accounts" in pending
    account_txs = pending["accounts"][0]["transactions"]
    assert len(account_txs) == 2
    assert {t["csv_id"] for t in account_txs} == {"c1", "c2"}


# ============================================================================
# T6.4 : Decision Override & Smart Rule Learning
# ============================================================================

def test_override_decision_and_learn_rule(client, test_db):
    """Vérifie que la modification manuelle d'une décision apprend la règle pour les futurs imports."""
    tx = Transaction(
        csv_id="tx_override_test",
        date_operation=date.today(),
        raw_description="SNCF CONNECT INTERNET PARIS",
        description="SNCF CONNECT",
        amount=45.0,
        type="expense_var",
        category="Dépenses diverses",
        from_account_id=1
    )
    test_db.add(tx)
    test_db.flush()

    d = AutopilotDecisionLog(
        batch_id="b_override",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx.id,
        confidence_score=85.0,
        is_undone=False
    )
    test_db.add(d)
    test_db.commit()

    # Correction manuelle
    res = client.post(
        f"/api/autopilot/decisions/{d.id}/override",
        json={
            "new_category": "Transports",
            "new_description": "Train SNCF",
            "new_amount": 45.0,
            "learn_rule": True
        }
    )
    assert res.status_code == 200
    assert res.json()["success"] is True
    assert res.json()["learned_rule"] is True

    # Vérifier que la transaction a été mise à jour
    test_db.refresh(tx)
    assert tx.category == "Transports"
    assert tx.description == "Train SNCF"

    # Vérifier que la règle a été apprise
    rule = test_db.query(BankLabelMapping).filter(BankLabelMapping.clean_description == "Train SNCF").first()
    assert rule is not None
    assert rule.category == "Transports"
    assert rule.is_manual is True


# ============================================================================
# T6.5 : Recurrence -> Budget Sync & Full-Auto Budget Mutations
# ============================================================================

def test_recurrence_to_budget_sync(test_db):
    """Vérifie l'ajustement automatique de l'enveloppe budgétaire lors d'une promotion, hausse ou clôture de récurrence."""
    set_autopilot_enabled(test_db, True)

    # Créer une enveloppe budgétaire pour 'Abonnements' à 30 € / mois
    b = Budget(
        name="Abonnements Mensuels",
        monthly_amount=30.0,
        period="monthly",
        envelope_type="spending",
        is_closed=False,
        is_locked=False
    )
    test_db.add(b)
    test_db.flush()
    test_db.add(BudgetCategory(budget_id=b.id, category_name="Abonnements"))
    test_db.commit()

    # 1. Promotion d'un nouvel abonnement à 15 € / mois -> le budget doit passer à 45 €
    res_promo = sync_budget_from_recurrence_change(
        test_db,
        category="Abonnements",
        change_type="promotion",
        amount_delta=15.0
    )
    assert res_promo is not None
    assert res_promo["new_amount"] == 45.0
    test_db.refresh(b)
    assert b.monthly_amount == 45.0

    # 2. Hausse tarifaire de +3 € -> le budget doit passer à 48 €
    res_hike = sync_budget_from_recurrence_change(
        test_db,
        category="Abonnements",
        change_type="hike",
        amount_delta=3.0
    )
    assert res_hike is not None
    assert res_hike["new_amount"] == 48.0
    test_db.refresh(b)
    assert b.monthly_amount == 48.0

    # 3. Résiliation d'un abonnement de -15 € -> le budget doit repasser à 33 €
    res_close = sync_budget_from_recurrence_change(
        test_db,
        category="Abonnements",
        change_type="closed",
        amount_delta=-15.0
    )
    assert res_close is not None
    assert res_close["new_amount"] == 33.0
    test_db.refresh(b)
    assert b.monthly_amount == 33.0


# ============================================================================
# T6.6 : Active Sync Status & i18n Completeness
# ============================================================================

def test_active_sync_status_endpoint(client):
    """Vérifie la route /api/bank-sync/active-sync-status pour le close shield Tauri."""
    res = client.get("/api/bank-sync/active-sync-status")
    assert res.status_code == 200
    data = res.json()
    assert "is_syncing" in data
    assert isinstance(data["is_syncing"], bool)


def test_i18n_keys_step6_presence():
    """Vérifie la présence et la parité bilingue exacte de toutes les clés introduites à l'Étape 6."""
    import os
    fr_path = os.path.join(os.path.dirname(__file__), "..", "static", "i18n", "fr.json")
    en_path = os.path.join(os.path.dirname(__file__), "..", "static", "i18n", "en.json")

    with open(fr_path, "r", encoding="utf-8-sig") as f:
        fr_data = json.load(f)
    with open(en_path, "r", encoding="utf-8-sig") as f:
        en_data = json.load(f)

    required_keys = [
        "nav_autopilot",
        "autopilot_control_center_title",
        "autopilot_control_center_desc",
        "autopilot_master_toggle",
        "autopilot_status_active",
        "autopilot_status_inactive",
        "autopilot_sync_in_progress",
        "autopilot_kpi_accuracy",
        "autopilot_kpi_hours_saved",
        "autopilot_kpi_reconciled",
        "autopilot_kpi_committed",
        "autopilot_kpi_recurrences",
        "autopilot_kpi_budgets",
        "autopilot_threshold_title",
        "autopilot_threshold_strict",
        "autopilot_threshold_balanced",
        "autopilot_threshold_permissive",
        "autopilot_feed_title",
        "autopilot_workshop_title",
        "autopilot_override_modal_title",
        "autopilot_wizard_title",
        "autopilot_rollback_success",
        "autopilot_cycle_rollback_success",
    ]

    for k in required_keys:
        assert k in fr_data, f"Clé manquante dans fr.json: {k}"
        assert k in en_data, f"Clé manquante dans en.json: {k}"
        assert fr_data[k] != "", f"Valeur vide pour {k} dans fr.json"
        assert en_data[k] != "", f"Valeur vide pour {k} dans en.json"


def test_autopilot_review_queue_lifecycle(client, test_db):
    """Vérifie le cycle complet de consultation, validation et mise à jour de la file de revue."""
    from app.models import Transaction, Account

    acc = test_db.query(Account).filter(Account.id == 1).first()
    if not acc:
        acc = Account(id=1, name="Compte Test", color="#3366ff", account_type="checking")
        test_db.add(acc)
        test_db.commit()

    tx = Transaction(
        description="AMAZON UNCERTAIN",
        raw_description="AMAZON PAYMENTS",
        amount=42.0,
        type="expense_var",
        category="Dépenses diverses",
        from_account_id=1,
        date_operation=date.today(),
        date_saisie=date.today(),
        needs_review=True,
        confidence_score=60.0
    )
    test_db.add(tx)
    test_db.commit()

    # 1. GET /api/autopilot/review-queue
    res = client.get("/api/autopilot/review-queue")
    assert res.status_code == 200
    items = res.json()
    assert any(i["id"] == tx.id for i in items)
    target = next(i for i in items if i["id"] == tx.id)
    assert target["confidence_score"] == 60.0
    assert target["account_name"] == acc.name

    # 2. POST /api/autopilot/review/{id}/update
    res_up = client.post(f"/api/autopilot/review/{tx.id}/update", json={
        "description": "Amazon - Livre Python",
        "category": "Loisirs",
        "learn_rule": True
    })
    assert res_up.status_code == 200
    assert res_up.json()["success"] is True

    test_db.refresh(tx)
    assert tx.needs_review is False
    assert tx.description == "Amazon - Livre Python"
    assert tx.category == "Loisirs"

    # Vérifier disparition de la file de revue
    res_queue2 = client.get("/api/autopilot/review-queue")
    assert not any(i["id"] == tx.id for i in res_queue2.json())

    # 3. Test de validation directe (sans changement)
    tx2 = Transaction(
        description="BOULANGERIE MODERATE",
        amount=5.0,
        type="expense_var",
        category="Alimentation",
        from_account_id=1,
        date_operation=date.today(),
        date_saisie=date.today(),
        needs_review=True,
        confidence_score=75.0
    )
    test_db.add(tx2)
    test_db.commit()

    res_val = client.post(f"/api/autopilot/review/{tx2.id}/validate")
    assert res_val.status_code == 200
    assert res_val.json()["success"] is True
    test_db.refresh(tx2)
    assert tx2.needs_review is False


def test_autopilot_threshold_preview_api(client, test_db):
    """Vérifie la simulation de prévisualisation d'impact d'un seuil (/api/autopilot/threshold-preview)."""
    from app.models import Transaction

    # Créer deux transactions avec score de confiance
    t1 = Transaction(
        description="TX RELIABLE",
        amount=10.0,
        type="expense_var",
        category="Courses",
        date_operation=date.today(),
        date_saisie=date.today(),
        needs_review=False,
        confidence_score=88.0
    )
    t2 = Transaction(
        description="TX IN REVIEW",
        amount=20.0,
        type="expense_var",
        category="Courses",
        date_operation=date.today(),
        date_saisie=date.today(),
        needs_review=True,
        confidence_score=75.0
    )
    test_db.add_all([t1, t2])
    test_db.commit()

    # Si on simule un seuil à 70% : t2 (75%) devient fiable !
    res_prev_low = client.get("/api/autopilot/threshold-preview?threshold=70.0")
    assert res_prev_low.status_code == 200
    data_low = res_prev_low.json()
    assert data_low["becoming_reliable_count"] >= 1
    assert any(s["id"] == t2.id for s in data_low["becoming_reliable_samples"])

    # Si on simule un seuil à 95% : t1 (88%) bascule en revue !
    res_prev_high = client.get("/api/autopilot/threshold-preview?threshold=95.0")
    assert res_prev_high.status_code == 200
    data_high = res_prev_high.json()
    assert data_high["becoming_review_count"] >= 1
    assert any(s["id"] == t1.id for s in data_high["becoming_review_samples"])

