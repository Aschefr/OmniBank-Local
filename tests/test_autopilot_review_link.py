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
