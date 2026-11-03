"""Le relevé en arrière-plan n'attend plus l'IA : elle complète les libellés ensuite, sans écraser une modification."""
import json
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, AutopilotDecisionLog, Category, GlobalConfig, Transaction
from app.services.autopilot_service import process_incoming_batch
from app.services.bank_sync import label_refine
from app.services.bank_sync import pending_store
from app.services.smart_label_service import resolve_smart_labels_batch

PID = "test_refine"
RAW = "PAIEMENT CB ZORGLUB MARKET 123"


@pytest.fixture
def db(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    s.add(Account(id=1, name="Courant", type="checking", initial_balance=1000.0))
    s.add_all([
        Category(name="Courses", type="expense_var"),
        Category(name="Divers", type="expense_var"),
        Category(name="Autres recettes", type="income"),
        GlobalConfig(key="enable_ai", value="true"),
        GlobalConfig(key="ollama_url", value="http://x"),
        GlobalConfig(key="ollama_model", value="m"),
    ])
    s.commit()
    pending_store._PENDING_SYNC_DATA.pop(PID, None)
    pending_store._LAST_STATEMENT_SNAPSHOTS.pop(PID, None)
    # Aucune tâche de fond pendant les tests : la détection de récurrences et les enveloppes ne sont pas en jeu ici
    monkeypatch.setattr("app.services.recurrence_detector.process_recurrence_promotions", lambda *a, **k: {"promoted_templates": 0})
    monkeypatch.setattr("app.services.recurrence_detector.process_auto_skipping", lambda *a, **k: {})
    monkeypatch.setattr("app.services.budget_service.suggest_new_envelopes", lambda *a, **k: [])
    yield s
    s.close()
    pending_store._PENDING_SYNC_DATA.pop(PID, None)
    pending_store._LAST_STATEMENT_SNAPSHOTS.pop(PID, None)


def _autopilot(db, on=True):
    db.add(GlobalConfig(key="auto_pilot_enabled", value="true" if on else "false"))
    db.commit()


def _ai(monkeypatch, category="Courses", name="Zorglub Supermarché", calls=None, is_new=False):
    def fake(descriptions, categories, cfg, user_habits=None, suggest_names=False):
        if calls is not None:
            calls.append(list(descriptions))
        return {d: {"category": category, "name": name, "category_is_new": is_new} for d in descriptions}
    monkeypatch.setattr("app.services.chat.ollama_client.call_ollama_batch", fake)


def _preview(db, labels=(RAW,), amount=-42.5):
    """Ce que produit fetch_preview_transactions(defer_ai=True) : règles et historique seuls, opérations marquées."""
    txs = []
    tx_types = {raw: "expense_var" if amount < 0 else "income" for raw in labels}
    resolutions = resolve_smart_labels_batch(db, list(labels), use_ai_fallback=False, tx_types=tx_types, auto_fallback_category=True)
    for i, raw in enumerate(labels):
        res = resolutions[raw]
        tx = {
            "csv_id": f"csv-{i}", "date_operation": date.today().isoformat(), "description": raw, "raw_description": raw,
            "amount": abs(amount), "raw_amount": amount, "is_reconciled": False, "category": None, "matched_db_id": None,
        }
        tag = label_refine.deferred_tag(res)
        if tag:
            tx["smart_ai_deferred"] = tag
        tx.update({"description": res["description"], "category": res["category"], "smart_suggested": True,
                   "smart_source": res.get("source"), "smart_is_fallback": res.get("smart_is_fallback", False),
                   "smart_confidence": res.get("confidence", 0.0)})
        txs.append(tx)
    return {"connection_id": 7, "ai_deferred": True, "accounts": [{"account_id": 1, "account_name": "Courant", "transactions": txs}]}


def _ingest(db, preview):
    return process_incoming_batch(db, 7, preview, profile_id=PID)


def test_statement_never_calls_the_ai_and_the_refinement_completes_it(db, monkeypatch):
    _autopilot(db)
    calls = []
    _ai(monkeypatch, calls=calls)

    res = _ingest(db, _preview(db))

    # Pendant le relevé : aucun appel, l'opération est là, en catégorie de repli, à vérifier
    assert calls == []
    tx = db.query(Transaction).one()
    assert tx.needs_review is True and tx.category != "Courses"
    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.decision_type == "new_entry").one()
    assert decision.action == "AUTO_COMMIT_PENDING_REVIEW"

    # Après : l'IA complète
    assert label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": res["batch_id"]}], PID) == 1
    db.expire_all()
    tx = db.query(Transaction).one()
    assert (tx.description, tx.category, tx.needs_review) == ("Zorglub Supermarché", "Courses", False)
    assert tx.confidence_score == 85.0 and tx.created_by == "Automatisme (Écriture)"
    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.decision_type == "new_entry").one()
    assert decision.action == "AUTO_COMMIT"
    assert len(calls) == 1
    assert db.query(GlobalConfig).filter(GlobalConfig.key == label_refine.REFINED_AT_KEY).first() is not None


def test_a_change_made_meanwhile_is_kept(db, monkeypatch):
    _autopilot(db)
    _ai(monkeypatch)
    res = _ingest(db, _preview(db))
    tx = db.query(Transaction).one()
    tx.category = "Divers"
    tx.description = "Mon libellé"
    db.commit()

    assert label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": res["batch_id"]}], PID) == 0
    db.expire_all()
    assert db.query(Transaction).one().description == "Mon libellé"


def test_a_change_made_while_the_ai_answers_is_kept(db, monkeypatch):
    _autopilot(db)
    res = _ingest(db, _preview(db))

    def fake(descriptions, categories, cfg, user_habits=None, suggest_names=False):
        tx = db.query(Transaction).one()
        tx.description = "Pendant l'attente"
        db.commit()
        return {d: {"category": "Courses", "name": "Zorglub Supermarché"} for d in descriptions}
    monkeypatch.setattr("app.services.chat.ollama_client.call_ollama_batch", fake)

    assert label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": res["batch_id"]}], PID) == 0
    db.expire_all()
    assert db.query(Transaction).one().description == "Pendant l'attente"


def test_ai_failure_leaves_the_operation_to_review(db, monkeypatch):
    _autopilot(db)
    res = _ingest(db, _preview(db))
    before = db.query(Transaction).one().category

    def boom(*a, **k):
        raise RuntimeError("Ollama indisponible")
    monkeypatch.setattr("app.services.chat.ollama_client.call_ollama_batch", boom)

    assert label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": res["batch_id"]}], PID) == 0
    db.expire_all()
    tx = db.query(Transaction).one()
    assert tx.needs_review is True and tx.category == before


def test_without_autopilot_the_waiting_room_is_completed(db, monkeypatch):
    calls = []
    _ai(monkeypatch, calls=calls)

    res = _ingest(db, _preview(db))
    assert res["status"] == "delegated_to_sas" and calls == [] and db.query(Transaction).count() == 0

    assert label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": None}], PID) == 1
    tx = pending_store._PENDING_SYNC_DATA[PID][7]["accounts"][0]["transactions"][0]
    assert (tx["description"], tx["category"], tx["smart_source"], tx["smart_is_fallback"]) == ("Zorglub Supermarché", "Courses", "ai", False)
    assert "smart_ai_deferred" not in tx
    statement = pending_store.get_last_statement_snapshot(db, 7, profile_id=PID)
    assert statement["accounts"][0]["transactions"][0]["category"] == "Courses"


def test_waiting_room_edit_is_kept(db, monkeypatch):
    _ai(monkeypatch)
    _ingest(db, _preview(db))
    tx = pending_store._PENDING_SYNC_DATA[PID][7]["accounts"][0]["transactions"][0]
    tx["category"] = "Divers"

    assert label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": None}], PID) == 0
    assert pending_store._PENDING_SYNC_DATA[PID][7]["accounts"][0]["transactions"][0]["category"] == "Divers"


def test_suspected_duplicate_stays_to_review(db, monkeypatch):
    _autopilot(db)
    _ai(monkeypatch)
    res = _ingest(db, _preview(db))
    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.decision_type == "new_entry").one()
    snap = json.loads(decision.raw_snapshot)
    snap["suspected_duplicate_forecast_id"] = 99
    decision.raw_snapshot = json.dumps(snap)
    decision.action = "AUTO_COMMIT_SUSPECTED_DUPLICATE_PENDING_REVIEW"
    db.commit()

    assert label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": res["batch_id"]}], PID) == 1
    db.expire_all()

    tx = db.query(Transaction).one()
    assert tx.category == "Courses" and tx.needs_review is True
    assert db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.decision_type == "new_entry").one().action == "AUTO_COMMIT_SUSPECTED_DUPLICATE_PENDING_REVIEW"


def test_new_category_needs_the_permission(db, monkeypatch):
    db.add(GlobalConfig(key="auto_commit_incoming_transactions", value="true"))
    db.commit()
    _ai(monkeypatch, category="Bricolage inédit", is_new=True)
    res = _ingest(db, _preview(db))
    fallback = db.query(Transaction).one().category

    label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": res["batch_id"]}], PID)
    db.expire_all()

    tx = db.query(Transaction).one()
    assert tx.category == fallback and tx.needs_review is True
    assert db.query(Category).filter_by(name="Bricolage inédit").first() is None


def test_new_category_is_created_when_allowed(db, monkeypatch):
    _autopilot(db)
    _ai(monkeypatch, category="Bricolage inédit", is_new=True)
    res = _ingest(db, _preview(db))

    label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": res["batch_id"]}], PID)
    db.expire_all()

    tx = db.query(Transaction).one()
    assert tx.category == "Bricolage inédit" and tx.needs_review is False
    assert db.query(Category).filter_by(name="Bricolage inédit").first() is not None


def test_a_fallback_waiting_for_review_does_not_teach_the_next_statement(db, monkeypatch):
    """Sans ce garde-fou, la catégorie de repli reviendrait comme « historique » à 100 % et serait validée seule."""
    _autopilot(db)
    _ingest(db, _preview(db))
    fallback = db.query(Transaction).one().category

    resolved = resolve_smart_labels_batch(db, [RAW], use_ai_fallback=False, tx_types={RAW: "expense_var"}, auto_fallback_category=True)[RAW]

    assert resolved["source"] != "history" and resolved["smart_is_fallback"] is True
    assert resolved["category"] == fallback


def test_validated_operation_still_teaches_the_next_statement(db):
    _autopilot(db)
    _ingest(db, _preview(db))
    tx = db.query(Transaction).one()
    tx.needs_review = False
    tx.category = "Courses"
    db.commit()

    resolved = resolve_smart_labels_batch(db, [RAW], use_ai_fallback=False, tx_types={RAW: "expense_var"}, auto_fallback_category=True)[RAW]

    assert resolved["source"] == "history" and resolved["category"] == "Courses"


def test_nothing_to_do_means_no_ai_call(db, monkeypatch):
    _autopilot(db)
    calls = []
    _ai(monkeypatch, calls=calls)
    assert label_refine.refine_labels(db, [{"conn_id": 7, "batch_id": "inconnu"}], PID) == 0
    assert calls == []


# ── Enchaînement du relevé en arrière-plan ──

def test_background_statement_defers_the_ai_and_queues_the_refinement(db, monkeypatch):
    from app.models import BankConnection
    from app.services.bank_sync import auto_sync
    from app.services.bank_sync.sync_service import BankSyncService

    _autopilot(db)
    conn = BankConnection(id=7, label="Banque", backend="woob", is_active=True)
    db.add(conn)
    db.commit()
    seen = {}

    def fake_fetch(**kwargs):
        seen.update(kwargs)
        return _preview(db)
    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", fake_fetch)
    noted = []
    monkeypatch.setattr(auto_sync, "note_deferred_batch", lambda pid, conn_id, batch_id: noted.append((pid, conn_id, batch_id)))

    auto_sync.execute_auto_sync_for_connection(db, conn, "pw", profile_id=PID, trigger_source="manual")

    assert seen["defer_ai"] is True
    assert noted and noted[0][:2] == (PID, 7) and noted[0][2]


def test_refinement_task_runs_queued_jobs_then_stops(db, monkeypatch):
    done = []

    def fake_refine(session, jobs, profile_id):
        done.append(jobs)
        return len(jobs)
    monkeypatch.setattr(label_refine, "refine_labels", fake_refine)
    monkeypatch.setattr("app.database.get_engine", lambda pid: db.get_bind())

    label_refine.start_label_refinement(PID)  # rien en attente : aucune tâche
    assert PID not in label_refine._threads or not label_refine.is_refining(PID)
    assert done == []

    label_refine.note_deferred_batch(PID, 7, "b1")
    label_refine.note_deferred_batch(PID, 8, "b2")
    label_refine.start_label_refinement(PID)
    label_refine._threads[PID].join(timeout=5)

    assert not label_refine.is_refining(PID)
    assert len(done) == 1 and len(done[0]) == 2
    assert label_refine.last_refined_count(PID) == 2
