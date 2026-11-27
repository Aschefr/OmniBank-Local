"""
Paiements par passerelle (PayPal, SumUp…) : le libellé « PayPal Europe S.a.r.l. et Cie S.C.A » ne désigne aucun
marchand. Ni une règle ni l'historique du libellé ne le nomment ; un paiement déjà nommé par l'utilisateur, au même
montant et vers le même jour du mois, le nomme, à vérifier sous le seuil de confiance. Données inventées.
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, BankConnection, BankLabelMapping, Category, GlobalConfig, Transaction
from app.services import stats_cache
from app.services.autopilot_service import process_incoming_batch
from app.services.bank_sync.pending_store import clear_all_pending_sync
from app.services.smart_label import learn_label_mapping, resolve_smart_labels_batch
from app.services.smart_label.gateway import gateway_of_label, name_gateway_lines, suggest_gateway_name

PAYPAL = "PayPal Europe S.a.r.l. et Cie S.C.A"
BASE = date.today() - timedelta(days=60)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add_all([
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="auto_commit_incoming_transactions", value="true"),
        GlobalConfig(key="auto_reconcile_threshold", value="85.0"),
        Category(name="Musique", type="expense_var"),
        Category(name="Loisir", type="expense_var"),
        Category(name="Dépenses diverses", type="expense_var"),
        BankConnection(id=1, backend="cragr", label="Banque inventée", is_active=True),
        Account(id=1, name="Compte Courant", initial_balance=1000.0),
        # Ancienne règle apprise sur le libellé PayPal : elle nommait tous les paiements PayPal « Vidéo en ligne »
        BankLabelMapping(raw_pattern="PAYPAL EUROPE S A R L ET CIE S C A", clean_description="Vidéo en ligne",
                         category="Loisir", is_manual=True, match_count=3),
    ])
    for name, amount, day, cat in (("Synthé virtuel - Plugin", 39.99, BASE.replace(day=22), "Musique"),
                                   ("Vidéo en ligne", 2.79, BASE.replace(day=25), "Loisir")):
        session.add(Transaction(date_operation=day, description=name, raw_description=PAYPAL, amount=amount,
                                type="expense_var", category=cat, from_account_id=1, reconciliation_date=day,
                                csv_id=f"woob_t_{name[:5]}"))
    session.commit()
    clear_all_pending_sync(session)
    yield session
    clear_all_pending_sync(session)
    session.close()


def test_gateway_only_labels():
    assert gateway_of_label(PAYPAL) == "PAYPAL"
    assert gateway_of_label("PayPal (Europe) S.a r.l. et Cie,") == "PAYPAL"
    assert gateway_of_label("X1234 PAYPAL EUROPE") == "PAYPAL"
    assert gateway_of_label("PAYPAL *NETFLIX") is None
    assert gateway_of_label("SUMUP *BOULANGERIE DUPONT") is None
    assert gateway_of_label("Free Telecom") is None


def test_rule_on_gateway_label_no_longer_names(db):
    res = resolve_smart_labels_batch(db, [PAYPAL], tx_types={PAYPAL: "expense_var"}, amounts={PAYPAL: 39.99},
                                     auto_fallback_category=True)[PAYPAL]
    assert res["description"] != "Vidéo en ligne"
    assert res["source"] == "fallback" and res["smart_is_fallback"]


def test_same_amount_same_day_names_confidently(db):
    res = suggest_gateway_name(db, PAYPAL, -39.99, date.today().replace(day=23))
    assert res["description"] == "Synthé virtuel - Plugin" and res["category"] == "Musique"
    assert res["confidence"] >= 0.85


def test_same_amount_other_day_is_only_a_suggestion(db):
    res = suggest_gateway_name(db, PAYPAL, -39.99, date.today().replace(day=8))
    assert res["description"] == "Synthé virtuel - Plugin"
    assert res["confidence"] < 0.85


def test_close_amount_close_day_still_suggests(db):
    res = suggest_gateway_name(db, PAYPAL, -2.85, date.today().replace(day=26))
    assert res["description"] == "Vidéo en ligne" and res["confidence"] < 0.85


def test_unknown_amount_stays_unnamed(db):
    assert suggest_gateway_name(db, PAYPAL, -15.00, date.today().replace(day=22)) is None


def test_two_merchants_same_amount_is_ambiguous(db):
    day = BASE.replace(day=21)
    db.add(Transaction(date_operation=day, description="Cadeau anniversaire", raw_description=PAYPAL, amount=39.99,
                       type="expense_var", category="Loisir", from_account_id=1, reconciliation_date=day,
                       csv_id="woob_t_cadeau"))
    db.commit()
    res = suggest_gateway_name(db, PAYPAL, -39.99, date.today().replace(day=22))
    assert res["confidence"] < 0.85


def test_name_given_by_hand_in_review_queue_is_kept(db):
    line = {"raw_description": PAYPAL, "description": "Livre de cuisine", "raw_amount": -39.99,
            "date_operation": date.today().replace(day=22).isoformat(), "smart_source": "fallback"}
    name_gateway_lines(db, [{"transactions": [line]}])
    assert line["description"] == "Livre de cuisine"


def test_learning_skips_gateway_label_but_not_named_gateway(db):
    assert learn_label_mapping(db, PAYPAL, "Autre chose", "Loisir") is None
    assert learn_label_mapping(db, "PAYPAL *STREAMINGCO", "Streaming", "Loisir") is not None


def _statement(day, amount, csv):
    return {"accounts": [{"account_id": 1, "account_name": "Compte Courant", "transactions": [{
        "date_operation": day.isoformat(), "description": PAYPAL, "raw_description": PAYPAL, "amount": abs(amount),
        "raw_amount": amount, "csv_id": csv, "is_coming": False, "is_reconciled": False}]}]}


def test_statement_names_and_commits_a_confident_match(db):
    day = date.today() - timedelta(days=1)
    db.query(Transaction).filter(Transaction.description == "Synthé virtuel - Plugin").update(
        {"date_operation": day - timedelta(days=31), "reconciliation_date": day - timedelta(days=31)})
    db.commit()
    process_incoming_batch(db, conn_id=1, preview_data=_statement(day, -39.99, "woob_t_new1"))
    tx = db.query(Transaction).filter(Transaction.csv_id == "woob_t_new1").one()
    assert tx.description == "Synthé virtuel - Plugin" and tx.category == "Musique"
    assert not tx.needs_review


def test_statement_sends_a_weak_match_to_review(db):
    day = date.today() - timedelta(days=1)
    db.query(Transaction).filter(Transaction.description == "Synthé virtuel - Plugin").update(
        {"date_operation": day - timedelta(days=40), "reconciliation_date": day - timedelta(days=40)})
    db.commit()
    process_incoming_batch(db, conn_id=1, preview_data=_statement(day, -39.99, "woob_t_new2"))
    tx = db.query(Transaction).filter(Transaction.csv_id == "woob_t_new2").one()
    assert tx.description == "Synthé virtuel - Plugin"
    assert tx.needs_review


# ── Ce que l'interface affiche ──────────────────────────────────────

def _decision_snapshot(db, csv):
    import json
    from app.models import AutopilotDecisionLog
    tx = db.query(Transaction).filter(Transaction.csv_id == csv).one()
    log = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.entity_id == tx.id).order_by(
        AutopilotDecisionLog.id.desc()).first()
    return json.loads(log.raw_snapshot)


def test_journal_reason_and_detail_for_a_recognised_payment(db):
    day = date.today() - timedelta(days=1)
    db.query(Transaction).filter(Transaction.description == "Synthé virtuel - Plugin").update(
        {"date_operation": day - timedelta(days=40), "reconciliation_date": day - timedelta(days=40)})
    db.commit()
    process_incoming_batch(db, conn_id=1, preview_data=_statement(day, -39.99, "woob_t_new3"))
    snap = _decision_snapshot(db, "woob_t_new3")
    assert snap["decision_reason"] == "gateway_match"
    g = snap["bank_tx"]["smart_gateway_detail"]
    assert g["ref_description"] == "Synthé virtuel - Plugin" and g["same_amount"] and g["day_gap"] > 3


def test_journal_reason_for_an_unknown_payment(db):
    day = date.today() - timedelta(days=1)
    process_incoming_batch(db, conn_id=1, preview_data=_statement(day, -15.00, "woob_t_new4"))
    snap = _decision_snapshot(db, "woob_t_new4")
    assert snap["decision_reason"] == "gateway_unknown"
    assert snap["bank_tx"]["smart_is_gateway"]


def test_api_flags_gateway_label_and_inactive_rule(db):
    from fastapi.testclient import TestClient
    from app.database import get_db
    from app.main import app

    def override():
        yield db
    app.dependency_overrides[get_db] = override
    try:
        with TestClient(app) as c:
            sim = c.post("/api/smart-labels/simulate", json={"raw_label": PAYPAL, "use_ai_fallback": False}).json()
            assert sim["is_gateway"] is True
            other = c.post("/api/smart-labels/simulate", json={"raw_label": "PAYPAL *STREAMINGCO", "use_ai_fallback": False}).json()
            assert other["is_gateway"] is False
            rules = {m["raw_pattern"]: m for m in c.get("/api/smart-labels/mappings").json()}
            assert rules["PAYPAL EUROPE S A R L ET CIE S C A"]["is_gateway_inactive"] is True
    finally:
        app.dependency_overrides.clear()
