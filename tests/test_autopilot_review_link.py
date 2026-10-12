"""
tests/test_autopilot_review_link.py
----------------------------------
Test suite for Auto-Pilot Review Queue:
- Candidate forecast detection (same account, date window, amount window)
- 1-click manual forecast linking (/api/autopilot/review/{tx_id}/link)
- Auto-merging during review update (/api/autopilot/review/{tx_id}/update)
- Auto-merging during review validation (/api/autopilot/review/{tx_id}/validate)
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
)
from app.services.autopilot_service import (
    find_candidate_forecasts_for_tx,
    link_review_transaction,
    get_review_queue,
)


@pytest.fixture
def review_test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    # Seed account & category
    acc = Account(id=1, name="Compte Principal", currency="EUR", is_closed=False, type="Compte courant")
    cat = Category(id=1, name="Abonnement loisir", type="expense_var")
    db.add_all([acc, cat])
    db.commit()

    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client(review_test_db):
    def override_get_db():
        try:
            yield review_test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_find_candidate_forecasts_and_linking(review_test_db, client):
    # 1. Existing planned forecast in DB (e.g. Floatplane 2.74€ on 2026-09-24)
    forecast = Transaction(
        id=3350,
        from_account_id=1,
        date_operation=date(2026, 9, 24),
        description="Floatplane",
        category="Abonnement loisir",
        amount=2.74,
        type="expense_var",
        reconciliation_date=None,
    )
    review_test_db.add(forecast)

    # 2. Auto-pilot review item ingested from bank (PayPal 2.73€ on 2026-09-24)
    review_tx = Transaction(
        id=3362,
        from_account_id=1,
        date_operation=date(2026, 9, 24),
        description="PayPal Europe S.a.r.l. et Cie S.C.A",
        raw_description="PayPal Europe S.a.r.l. et Cie S.C.A",
        category="Abonnement loisir",
        amount=2.73,
        type="expense_var",
        reconciliation_date=None,
        needs_review=True,
        confidence_score=75.0,
        csv_id="woob_coming_paypal_123",
    )
    review_test_db.add(review_tx)
    review_test_db.commit()

    # 3. Test find_candidate_forecasts_for_tx
    candidates = find_candidate_forecasts_for_tx(review_test_db, review_tx)
    assert len(candidates) == 1
    assert candidates[0]["id"] == 3350
    assert candidates[0]["description"] == "Floatplane"

    # 4. Test review queue endpoint returns candidate
    res = client.get("/api/autopilot/review-queue")
    assert res.status_code == 200
    queue = res.json()
    assert len(queue) == 1
    assert queue[0]["id"] == 3362
    assert len(queue[0]["candidate_forecasts"]) == 1
    assert queue[0]["candidate_forecasts"][0]["id"] == 3350

    # 5. Link review transaction to forecast
    res_link = client.post("/api/autopilot/review/3362/link", json={
        "target_forecast_id": 3350,
        "learn_rule": True,
    })
    assert res_link.status_code == 200

    # Verify forecast updated
    review_test_db.expire_all()
    updated_fc = review_test_db.query(Transaction).filter_by(id=3350).first()
    assert updated_fc is not None
    assert updated_fc.amount == 2.73
    # Coming transactions remain unpointed until final bank debit
    assert updated_fc.reconciliation_date is None
    assert updated_fc.csv_id == "woob_coming_paypal_123"
    assert updated_fc.raw_description == "PayPal Europe S.a.r.l. et Cie S.C.A"
    assert "2.74 € → 2.73 €" in (updated_fc.comment or "")

    # Verify duplicate review tx deleted
    dup_tx = review_test_db.query(Transaction).filter_by(id=3362).first()
    assert dup_tx is None

    # Verify merchant rule learned
    mapping = review_test_db.query(BankLabelMapping).filter(
        BankLabelMapping.raw_pattern.ilike("%PAYPAL%")
    ).first()
    assert mapping is not None
    assert mapping.clean_description == "Floatplane"
    assert mapping.category == "Abonnement loisir"


def test_update_review_auto_merge_on_rename(review_test_db, client):
    # Forecast exists: "Netflix" 15.99€
    forecast = Transaction(
        id=4001,
        from_account_id=1,
        date_operation=date(2026, 9, 20),
        description="Netflix",
        category="Abonnement loisir",
        amount=15.99,
        type="expense_var",
        reconciliation_date=None,
    )
    # Review tx ingested: "NETFLIX.COM PAYMENT" 17.99€
    review_tx = Transaction(
        id=4002,
        from_account_id=1,
        date_operation=date(2026, 9, 21),
        description="NETFLIX.COM PAYMENT",
        raw_description="NETFLIX.COM PAYMENT",
        category="Autre",
        amount=17.99,
        type="expense_var",
        reconciliation_date=None,
        needs_review=True,
        csv_id="woob_netflix_999",
    )
    review_test_db.add_all([forecast, review_tx])
    review_test_db.commit()

    # User renames in review to "Netflix"
    res = client.post("/api/autopilot/review/4002/update", json={
        "description": "Netflix",
        "category": "Abonnement loisir",
        "learn_rule": True,
    })
    assert res.status_code == 200

    review_test_db.expire_all()
    # Forecast 4001 should have been merged
    merged = review_test_db.query(Transaction).filter_by(id=4001).first()
    assert merged is not None
    assert merged.amount == 17.99
    assert merged.reconciliation_date is not None
    assert merged.csv_id == "woob_netflix_999"

    # Review tx 4002 deleted
    assert review_test_db.query(Transaction).filter_by(id=4002).first() is None


def test_false_positive_rejected_unrelated_forecast(review_test_db):
    """
    Vérifie qu'un péage (38.90 €) ne propose JAMAIS une assurance habitation (47.94 €)
    malgré un écart de montant de 18.8% (< 20%), car il n'y a aucune affinité textuelle.
    """
    forecast_assurance = Transaction(
        id=5001,
        from_account_id=1,
        date_operation=date(2026, 10, 15),
        description="CA Assurance - Habitation",
        category="Assurance",
        amount=47.94,
        type="expense_fixed",
        reconciliation_date=None,
    )
    tx_peage = Transaction(
        id=5002,
        from_account_id=1,
        date_operation=date(2026, 10, 15),
        description="Fulli - Peages",
        raw_description="FULLI - mobilis",
        category="Péage tickets",
        amount=38.90,
        type="expense_var",
        reconciliation_date=None,
        needs_review=True,
    )
    review_test_db.add_all([forecast_assurance, tx_peage])
    review_test_db.commit()

    candidates = find_candidate_forecasts_for_tx(review_test_db, tx_peage)
    assert len(candidates) == 0, f"Faux positif détecté : {candidates}"


def test_text_match_with_variable_amount(review_test_db):
    """
    Vérifie qu'une facture variable avec affinité textuelle (ex: EDF 65 € vs 72.50 €)
    est correctement suggérée comme prévision candidate.
    """
    forecast_edf = Transaction(
        id=6001,
        from_account_id=1,
        date_operation=date(2026, 10, 10),
        description="EDF Electricité",
        category="Énergie",
        amount=65.00,
        type="expense_var",
        reconciliation_date=None,
    )
    tx_edf = Transaction(
        id=6002,
        from_account_id=1,
        date_operation=date(2026, 10, 12),
        description="EDF",
        raw_description="PRLV SEPA EDF CLIENT 12345",
        category="Énergie",
        amount=72.50,
        type="expense_var",
        reconciliation_date=None,
        needs_review=True,
    )
    review_test_db.add_all([forecast_edf, tx_edf])
    review_test_db.commit()

    candidates = find_candidate_forecasts_for_tx(review_test_db, tx_edf)
    assert len(candidates) == 1
    assert candidates[0]["id"] == 6001
    assert candidates[0]["description"] == "EDF Electricité"


def test_opaque_exact_amount_matches(review_test_db):
    """
    Vérifie qu'un paiement opaque (PayPal 0.99 €) correspond bien à la prévision exacte (Apple - iCloud 0.99 €).
    """
    forecast_icloud = Transaction(
        id=7001,
        from_account_id=1,
        date_operation=date(2026, 10, 12),
        description="Apple - iCloud Maman",
        category="Pour un proche",
        amount=0.99,
        type="expense_var",
        reconciliation_date=None,
    )
    tx_paypal = Transaction(
        id=7002,
        from_account_id=1,
        date_operation=date(2026, 10, 12),
        description="Apple",
        raw_description="PayPal Europe S.a.r.l. et Cie S.",
        category="Abonnement loisir",
        amount=0.99,
        type="expense_var",
        reconciliation_date=None,
        needs_review=True,
    )
    review_test_db.add_all([forecast_icloud, tx_paypal])
    review_test_db.commit()

    candidates = find_candidate_forecasts_for_tx(review_test_db, tx_paypal)
    assert len(candidates) == 1
    assert candidates[0]["id"] == 7001
    assert candidates[0]["description"] == "Apple - iCloud Maman"


def test_link_review_preserves_recurrence_forecast(review_test_db, client):
    """
    Vérifie que lorsqu'une opération en revue est une prévision récurrente (recurrence_id != None)
    et qu'on la lie à une autre prévision, elle n'est PAS supprimée de la base de données
    mais conservée comme prévision non pointée (ses métadonnées bancaires sont remises à zéro).
    """
    from app.models import RecurrenceTemplate

    # Création du modèle récurrent pour simuler la récurrence
    tpl_apple = RecurrenceTemplate(
        id=15,
        description="Apple",
        amount=0.99,
        category="Abonnement loisir",
        type="expense_fixed",
        frequency="monthly",
        day_of_month=12,
        from_account_id=1,
    )
    tpl_maman = RecurrenceTemplate(
        id=25,
        description="Apple - iCloud Maman",
        amount=0.99,
        category="Pour un proche",
        type="expense_fixed",
        frequency="monthly",
        day_of_month=9,
        from_account_id=1,
    )
    review_test_db.add_all([tpl_apple, tpl_maman])
    review_test_db.commit()

    # 1. Prévision récurrente 1 (Apple, recurrence_id=15) initialement associée par erreur en revue
    review_fc = Transaction(
        id=8001,
        from_account_id=1,
        date_operation=date(2026, 10, 12),
        description="Apple",
        raw_description="PayPal Europe S.a.r.l. et Cie S.",
        category="Abonnement loisir",
        amount=0.99,
        type="expense_fixed",
        reconciliation_date=date(2026, 10, 12),
        recurrence_id=15,
        needs_review=True,
        confidence_score=75.0,
        csv_id="woob_paypal_booked_123",
    )
    # 2. Prévision récurrente 2 (Apple - iCloud Maman, recurrence_id=25)
    target_fc = Transaction(
        id=8002,
        from_account_id=1,
        date_operation=date(2026, 10, 9),
        description="Apple - iCloud Maman",
        raw_description=None,
        category="Pour un proche",
        amount=0.99,
        type="expense_fixed",
        reconciliation_date=None,
        recurrence_id=25,
        needs_review=False,
    )
    review_test_db.add_all([review_fc, target_fc])
    review_test_db.commit()

    # L'utilisateur lie 8001 vers 8002
    res = client.post("/api/autopilot/review/8001/link", json={
        "target_forecast_id": 8002,
        "learn_rule": False,
    })
    assert res.status_code == 200

    review_test_db.expire_all()
    # 8002 a bien reçu les données bancaires
    fc2 = review_test_db.query(Transaction).filter_by(id=8002).first()
    assert fc2 is not None
    assert fc2.csv_id == "woob_paypal_booked_123"
    assert fc2.raw_description == "PayPal Europe S.a.r.l. et Cie S."
    assert fc2.reconciliation_date == date(2026, 10, 12)
    assert fc2.needs_review is False

    # 8001 ne doit PAS être supprimée ! Elle doit rester disponible comme prévision récurrente
    fc1 = review_test_db.query(Transaction).filter_by(id=8001).first()
    assert fc1 is not None, "La prévision récurrente 8001 a été détruite au lieu d'être conservée !"
    assert fc1.recurrence_id == 15
    assert fc1.csv_id is None
    assert fc1.raw_description is None
    assert fc1.reconciliation_date is None
    assert fc1.needs_review is False
    assert fc1.confidence_score is None


