"""
tests/test_autopilot_decision_link_and_override.py
--------------------------------------------------
Test suite pour l'enrichissement de l'override de décision Auto-Pilote
et la liaison manuelle d'une décision à une prévision existante.
"""

import pytest
from datetime import date
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
    BankLabelMapping,
    AutopilotDecisionLog,
    ActionHistory,
)
from app.services.autopilot_service import (
    override_autopilot_decision,
    link_decision_to_forecast,
)
from app.services.history_service import undo_action


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

    # Seed comptes & catégories
    acc1 = Account(id=1, name="CA Centre-Est", currency="EUR", is_closed=False, type="Compte courant")
    acc2 = Account(id=2, name="Livret A", currency="EUR", is_closed=False, type="Épargne")
    cat1 = Category(id=1, name="Frais de compte", type="expense_var")
    cat2 = Category(id=2, name="Abonnement loisir", type="expense_var")
    db.add_all([acc1, acc2, cat1, cat2])
    db.commit()

    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(test_db):
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_override_decision_with_accounts_and_dates(test_db, client):
    """Vérifie que l'override permet de corriger les comptes Depuis/Vers et les dates."""
    tx = Transaction(
        id=10,
        description="Paiement Inconnu",
        amount=25.0,
        type="expense_var",
        category="Autre",
        from_account_id=1,
        date_operation=date(2026, 10, 15),
        raw_description="CB PAIEMENT INCONNU",
        csv_id="test_csv_10"
    )
    test_db.add(tx)
    test_db.flush()

    dlog = AutopilotDecisionLog(
        id=100,
        batch_id="batch_test_1",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx.id,
        account_id=1,
        confidence_score=85.0
    )
    test_db.add(dlog)
    test_db.commit()

    # Appel endpoint override avec nouveaux comptes et dates
    res = client.post("/api/autopilot/decisions/100/override", json={
        "new_description": "Abonnement Musique",
        "new_category": "Abonnement loisir",
        "new_amount": 29.99,
        "new_from_account_id": 2,
        "new_date_operation": "2026-10-16",
        "new_reconciliation_date": "2026-10-17",
        "learn_rule": True
    })

    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True

    # Vérification en base
    updated_tx = test_db.query(Transaction).filter(Transaction.id == 10).first()
    assert updated_tx.description == "Abonnement Musique"
    assert updated_tx.category == "Abonnement loisir"
    assert updated_tx.amount == 29.99
    assert updated_tx.from_account_id == 2
    assert updated_tx.date_operation == date(2026, 10, 16)
    assert updated_tx.reconciliation_date == date(2026, 10, 17)

    # Règle apprise
    mapping = test_db.query(BankLabelMapping).filter(BankLabelMapping.clean_description == "Abonnement Musique").first()
    assert mapping is not None
    assert mapping.category == "Abonnement loisir"


def test_link_decision_to_existing_forecast(test_db, client):
    """
    Test du cas réel de l'utilisateur :
    - Prévision existante : 'Cotisation Compte CA Centre-Est' (16.00 €, non pointée)
    - Écriture créée par Auto-Pilote : 'Offre Essentiel' (10.00 €)
    - Liaison de la décision à la prévision avec ajustement du montant
    """
    # 1. Prévision en base
    tx_forecast = Transaction(
        id=201,
        description="Cotisation Compte CA Centre-Est",
        amount=16.0,
        type="expense_fixed",
        category="Frais de compte",
        from_account_id=1,
        date_operation=date(2026, 10, 4),
        reconciliation_date=None,
        needs_review=False
    )

    # 2. Écriture créée par l'Auto-Pilote (doublon bancaire)
    tx_bank_created = Transaction(
        id=202,
        description="Offre Essentiel",
        amount=10.0,
        type="expense_var",
        category="Frais de compte",
        from_account_id=1,
        date_operation=date(2026, 10, 16),
        reconciliation_date=date(2026, 10, 17),
        raw_description="OFFRE ESSENTIEL CA CENTRE EST",
        csv_id="ca_woob_12345"
    )
    test_db.add_all([tx_forecast, tx_bank_created])
    test_db.flush()

    # 3. Décision Auto-Pilote associée à l'écriture créée
    dlog = AutopilotDecisionLog(
        id=300,
        batch_id="batch_lot_9d68d953",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx_bank_created.id,
        account_id=1,
        confidence_score=85.0
    )
    test_db.add(dlog)
    test_db.commit()

    # 4. Exécution de la liaison via l'API
    res = client.post("/api/autopilot/decisions/300/link", json={
        "target_forecast_id": 201,
        "adjust_amount": True,
        "learn_rule": True,
        "amount": 10.0
    })

    assert res.status_code == 200
    res_data = res.json()
    assert res_data["success"] is True

    # 5. Vérifications :
    # a) L'écriture prévisionnelle 201 doit être conservée, mise à jour à 10.00 €, rapprochée et enrichie
    refreshed_forecast = test_db.query(Transaction).filter(Transaction.id == 201).first()
    assert refreshed_forecast is not None
    assert refreshed_forecast.amount == 10.0
    assert refreshed_forecast.reconciliation_date is not None
    assert refreshed_forecast.csv_id == "ca_woob_12345"
    assert refreshed_forecast.raw_description == "OFFRE ESSENTIEL CA CENTRE EST"
    assert "Auto-ajusté" in (refreshed_forecast.comment or "")

    # b) L'écriture temporaire 202 doit avoir été supprimée
    deleted_source = test_db.query(Transaction).filter(Transaction.id == 202).first()
    assert deleted_source is None

    # c) La décision d'audit 300 doit pointer vers 201 en tant que réconciliation tout en préservant le score d'origine
    refreshed_dlog = test_db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == 300).first()
    assert refreshed_dlog.entity_id == 201
    assert refreshed_dlog.decision_type == "reconciliation"
    assert refreshed_dlog.action == "LINKED_MANUAL"
    assert refreshed_dlog.confidence_score == 85.0
    assert "manual_linked_forecast" in refreshed_dlog.raw_snapshot

    # d) La règle d'apprentissage doit avoir été enregistrée
    learned = test_db.query(BankLabelMapping).filter(
        BankLabelMapping.raw_pattern.like("%OFFRE ESSENTIEL%")
    ).first()
    assert learned is not None
    assert learned.clean_description == "Cotisation Compte CA Centre-Est"
    assert learned.category == "Frais de compte"

    # e) Le flux de décision doit restituer l'écriture d'origine, son montant négatif et son score IA 85%
    feed_res = client.get("/api/autopilot/decisions")
    assert feed_res.status_code == 200
    feed_items = feed_res.json()["items"]
    d_item = next(it for it in feed_items if it["id"] == 300)
    assert d_item["label"] == "Offre Essentiel"
    assert d_item["amount"] == -10.0
    assert d_item["confidence_score"] == 85.0
    assert d_item["user_override"]["is_overridden"] is True
    assert d_item["details"]["linked_to_forecast_description"] == "Cotisation Compte CA Centre-Est"

    # f) Déliement via l'API unlink-forecast : restauration complète de l'état initial
    unlink_res = client.post("/api/autopilot/decisions/300/unlink-forecast")
    assert unlink_res.status_code == 200
    unlink_data = unlink_res.json()
    assert unlink_data["success"] is True

    # Prévision 201 rétablie à 16.0 € et dépointée
    f_restored = test_db.query(Transaction).filter(Transaction.id == 201).first()
    assert f_restored is not None
    assert f_restored.amount == 16.0
    assert f_restored.reconciliation_date is None
    assert f_restored.csv_id is None

    # Source 202 rétablie à 10.0 €
    s_restored = test_db.query(Transaction).filter(Transaction.id == 202).first()
    assert s_restored is not None
    assert s_restored.description == "Offre Essentiel"
    assert s_restored.amount == 10.0
    assert s_restored.csv_id == "ca_woob_12345"

    # Décision 300 rétablie pointant vers 202 avec score 85%
    d_restored = test_db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == 300).first()
    assert d_restored.entity_id == 202
    assert d_restored.decision_type == "new_entry"
    assert d_restored.confidence_score == 85.0
    assert "manual_linked_forecast" not in (d_restored.raw_snapshot or "")


def test_get_transaction_autopilot_decision(test_db, client):
    """Vérifie l'endpoint GET /api/autopilot/transaction-decision/{tx_id} pour l'auto-détection frontend."""
    # 1. Transaction avec décision
    tx = Transaction(
        id=501,
        description="Paiement Station",
        amount=55.0,
        type="expense_var",
        category="Carburant",
        from_account_id=1,
        date_operation=date(2026, 10, 10),
        raw_description="TOTAL ENERGIES",
        csv_id="woob_tot_501"
    )
    test_db.add(tx)
    test_db.flush()

    dlog = AutopilotDecisionLog(
        id=550,
        batch_id="batch_tot_501",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=tx.id,
        account_id=1,
        confidence_score=92.0
    )
    test_db.add(dlog)
    test_db.commit()

    res = client.get("/api/autopilot/transaction-decision/501")
    assert res.status_code == 200
    data = res.json()
    assert data["has_decision"] is True
    assert data["decision_id"] == 550
    assert data["confidence_score"] == 92.0

    # 2. Transaction standard créée manuellement sans Auto-Pilote
    tx_manual = Transaction(
        id=502,
        description="Cadeau Anniversaire",
        amount=40.0,
        type="expense_var",
        category="Cadeaux",
        from_account_id=1,
        date_operation=date(2026, 10, 11),
        needs_review=False
    )
    test_db.add(tx_manual)
    test_db.commit()

    res_man = client.get("/api/autopilot/transaction-decision/502")
    assert res_man.status_code == 200
    assert res_man.json()["has_decision"] is False


def test_link_review_transaction_direct(test_db, client):
    """Vérifie la liaison directe par tx_id via POST /api/autopilot/review/{tx_id}/link (mode manuel)."""
    forecast = Transaction(
        id=601,
        description="Assurance Habitation",
        amount=28.50,
        type="expense_fixed",
        category="Assurances",
        from_account_id=1,
        date_operation=date(2026, 10, 5),
        reconciliation_date=None
    )
    bank_tx = Transaction(
        id=602,
        description="PRELEVEMENT MACIF",
        amount=28.50,
        type="expense_var",
        category="Assurances",
        from_account_id=1,
        date_operation=date(2026, 10, 6),
        raw_description="PRLV MACIF ASSURANCES",
        csv_id="macif_123"
    )
    test_db.add_all([forecast, bank_tx])
    test_db.commit()

    res = client.post("/api/autopilot/review/602/link", json={
        "target_forecast_id": 601,
        "adjust_amount": True,
        "learn_rule": True,
        "amount": 28.50
    })
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True

    # Vérification fusion
    f_after = test_db.query(Transaction).filter(Transaction.id == 601).first()
    assert f_after is not None
    assert f_after.csv_id == "macif_123"
    assert f_after.raw_description == "PRLV MACIF ASSURANCES"
    assert test_db.query(Transaction).filter(Transaction.id == 602).first() is None


def test_history_undo_synchronizes_autopilot_decision(test_db, client):
    """
    Vérifie que l'annulation depuis l'onglet Actions (ActionHistory.undo_action)
    d'une liaison ou fusion prévisionnelle rétablit AUTOMATIQUEMENT la décision AutopilotDecisionLog.
    """
    # 1. Prévision et écriture Auto-Pilote
    f = Transaction(
        id=701,
        description="Loyer Studio",
        amount=650.0,
        type="expense_fixed",
        category="Logement",
        from_account_id=1,
        date_operation=date(2026, 10, 1),
        reconciliation_date=None
    )
    src = Transaction(
        id=702,
        description="VIREMENT LOYER OCTOBRE",
        amount=650.0,
        type="expense_var",
        category="Logement",
        from_account_id=1,
        date_operation=date(2026, 10, 2),
        raw_description="VIR LOYER OCTOBRE",
        csv_id="loyer_csv_702"
    )
    test_db.add_all([f, src])
    test_db.flush()

    dlog = AutopilotDecisionLog(
        id=770,
        batch_id="batch_loyer_770",
        decision_type="new_entry",
        action="AUTO_COMMIT",
        entity_type="transaction",
        entity_id=702,
        account_id=1,
        confidence_score=90.0
    )
    test_db.add(dlog)
    test_db.commit()

    # 2. Liaison via endpoint
    link_res = client.post("/api/autopilot/decisions/770/link", json={
        "target_forecast_id": 701,
        "adjust_amount": True,
        "learn_rule": False
    })
    assert link_res.status_code == 200

    # 3. Récupérer les ActionHistory générées
    actions = test_db.query(ActionHistory).filter(
        ActionHistory.entity_type == "transaction",
        ActionHistory.entity_id.in_([701, 702]),
        ActionHistory.is_undone == False
    ).all()
    assert len(actions) >= 2

    # Prendre l'action de liaison sur la prévision (UPDATE 701)
    liaison_act = next(a for a in actions if a.entity_id == 701)

    # 4. Annuler l'action via history_service.undo_action
    success, warn = undo_action(test_db, liaison_act)
    assert success is True
    test_db.commit()

    # 5. Vérifier que la décision d'audit 770 a été resynchronisée vers 702
    d_after = test_db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == 770).first()
    assert d_after.entity_id == 702
    assert d_after.decision_type == "new_entry"
    assert d_after.action == "AUTO_COMMIT"
    assert d_after.confidence_score == 90.0

    # Vérifier que les deux transactions ont été restaurées
    assert test_db.query(Transaction).filter(Transaction.id == 701).first().reconciliation_date is None
    src_restored = test_db.query(Transaction).filter(Transaction.id == 702).first()
    assert src_restored is not None
    assert src_restored.description == "VIREMENT LOYER OCTOBRE"


