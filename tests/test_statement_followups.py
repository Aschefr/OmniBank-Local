"""Suites du premier relevé d'un profil neuf : virement interne dont les deux côtés sont dans le même relevé,
sens des catégories créées par l'IA, compteur « à vérifier » de la notification après le passage de l'IA."""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, AutopilotDecisionLog, Category, GlobalConfig, Notification, Transaction
from app.services import stats_cache
from app.services.autopilot_service import process_incoming_batch, set_autopilot_enabled
from app.services.bank_sync import label_refine
from app.services.smart_label import resolver


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    yield s
    s.close()


def _line(acc, day, raw_amount, label, n):
    return {"date_operation": (date.today() - timedelta(days=day)).isoformat(), "amount": abs(raw_amount),
            "raw_amount": raw_amount, "description": label, "raw_description": label, "csv_id": f"woob_test_{n}",
            "account_id": acc.id, "account_name": acc.name, "is_reconciled": False, "already_reconciled": False,
            "matched_db_id": None, "category": "Dépenses diverses" if raw_amount < 0 else "Revenus divers",
            "smart_suggested": True, "smart_is_fallback": True, "smart_confidence": 0.2}


def test_both_sides_of_an_internal_transfer_in_one_statement_become_one_transfer(db):
    set_autopilot_enabled(db, True, preset="full")
    cc = Account(name="Compte courant", type="Compte courant", initial_balance=0)
    livret = Account(name="Livret A", type="Livret", initial_balance=0)
    loan = Account(name="Prêt immo", type="Prêt / Emprunt", initial_balance=-1000)
    db.add_all([cc, livret, loan])
    db.commit()
    preview = {"connection_id": 1, "accounts": [
        {"account_id": cc.id, "account_name": cc.name, "transactions": [
            _line(cc, 10, -250.0, "WEB VERS LIVRET", 1),
            _line(cc, 5, -499.63, "00000012345 ECHEANCE", 2),
            _line(cc, 3, -42.0, "CB BOULANGERIE", 3)]},
        {"account_id": livret.id, "account_name": livret.name, "transactions": [_line(livret, 9, 250.0, "DE M. TITULAIRE", 4)]},
        {"account_id": loan.id, "account_name": loan.name, "transactions": [_line(loan, 5, 499.63, "REMBOURSEMENT PRET", 5)]},
    ]}

    process_incoming_batch(db, conn_id=1, preview_data=preview)

    transfers = db.query(Transaction).filter(Transaction.type == "transfer").all()
    assert len(transfers) == 1
    t = transfers[0]
    assert (t.from_account_id, t.to_account_id, t.amount) == (cc.id, livret.id, 250.0)
    assert t.category == "Virement interne" and t.needs_review is False
    assert db.query(Transaction).filter(Transaction.amount == 250.0).count() == 1
    # Une échéance vers un compte de prêt reste une dépense
    assert db.query(Transaction).filter(Transaction.amount == 499.63, Transaction.type == "expense_var").count() == 1


def test_an_income_never_gets_a_category_the_ai_just_created_for_expenses(db, monkeypatch):
    from app.services.chat import ollama_client
    db.add_all([Category(name="Dépenses diverses", type="expense_var"), Category(name="Revenus divers", type="income"),
                GlobalConfig(key="enable_ai", value="true"), GlobalConfig(key="ollama_url", value="http://ollama.test:11434"),
                GlobalConfig(key="ollama_model", value="m")])
    db.commit()

    def fake(descriptions, categories, cfg=None, user_habits=None, suggest_names=False, **kw):
        return {d: {"name": d, "category": "Frais Bancaires", "category_is_new": True} for d in descriptions}

    monkeypatch.setattr(ollama_client, "call_ollama_batch", fake)
    types = {"CB FRAIS CARTE": "expense_var", "ANTICIPATION DECOUVERT": "income"}
    res = resolver.resolve_smart_labels_batch(db, list(types), tx_types=types, use_ai_fallback=True, auto_fallback_category=True)
    assert res["CB FRAIS CARTE"]["category"] == "Frais Bancaires"
    assert res["ANTICIPATION DECOUVERT"]["category"] == "Revenus divers"


def test_statement_notification_counts_what_is_left_after_the_ai(db):
    acc = Account(name="Compte", type="Compte courant", initial_balance=0)
    db.add(acc)
    db.flush()
    txs = [Transaction(date_operation=date.today(), amount=10 + i, type="expense_var", from_account_id=acc.id,
                       description=f"Op {i}", category="Dépenses diverses", needs_review=(i == 0)) for i in range(3)]
    db.add_all(txs)
    db.flush()
    for t in txs:
        db.add(AutopilotDecisionLog(batch_id="b1", decision_type="new_entry", action="AUTO_COMMIT", entity_type="transaction",
                                    entity_id=t.id, is_undone=False))
    db.add(Notification(type="bank_sync", title="t", content="Banque : 🤖 3 opérations enregistrées automatiquement, 3 opérations à vérifier.",
                        link_data=json.dumps({"needs_review": 3, "batch_id": "b1"})))
    db.commit()

    label_refine._refresh_statement_notifications(db, {"b1"})
    n = db.query(Notification).one()
    assert n.content == "Banque : 🤖 3 opérations enregistrées automatiquement, 1 opération à vérifier."
    assert json.loads(n.link_data)["needs_review"] == 1


def test_review_queue_flags_what_the_ai_is_still_completing(db):
    from app.services.autopilot_service import get_review_queue
    acc = Account(name="Compte", type="Compte courant", initial_balance=0)
    db.add(acc)
    db.flush()
    waiting = Transaction(date_operation=date.today(), amount=12, type="expense_var", from_account_id=acc.id,
                          description="Cb Inconnu", category="Dépenses diverses", needs_review=True)
    other = Transaction(date_operation=date.today(), amount=8, type="expense_var", from_account_id=acc.id,
                        description="Wero", category="Dépenses diverses", needs_review=True)
    db.add_all([waiting, other])
    db.flush()
    db.add_all([
        AutopilotDecisionLog(batch_id="b2", decision_type="new_entry", action="AUTO_COMMIT_PENDING_REVIEW", entity_type="transaction",
                             entity_id=waiting.id, is_undone=False, raw_snapshot=json.dumps({"bank_tx": {"smart_ai_deferred": {"category": "Dépenses diverses"}}})),
        AutopilotDecisionLog(batch_id="b2", decision_type="new_entry", action="AUTO_COMMIT_PENDING_REVIEW", entity_type="transaction",
                             entity_id=other.id, is_undone=False, raw_snapshot=json.dumps({"bank_tx": {}})),
    ])
    db.commit()

    assert not any(i["ai_pending"] for i in get_review_queue(db, profile_id="pf"))  # aucune analyse IA en cours
    label_refine.note_deferred_batch("pf", 1, "b2")
    try:
        flags = {i["id"]: i["ai_pending"] for i in get_review_queue(db, profile_id="pf")}
        assert flags == {waiting.id: True, other.id: False}
    finally:
        label_refine._jobs.pop("pf", None)
