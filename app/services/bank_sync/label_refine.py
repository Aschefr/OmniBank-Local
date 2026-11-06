"""Complète par l'IA les libellés qu'un relevé a laissés sans catégorie connue.

Le modèle peut mettre plus d'une minute à répondre (chargement compris) : le relevé en arrière-plan ne l'attend
plus. Les opérations arrivent d'abord avec les règles et l'historique, puis cette tâche séparée les complète.
Elle ne touche jamais à une opération que l'utilisateur a modifiée entre-temps. Si l'IA échoue ou si le serveur
redémarre, les opérations restent à vérifier avec leur catégorie de repli : rien n'est perdu."""
import json
import logging
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import AutopilotDecisionLog, GlobalConfig, Transaction
from app.services import stats_cache
from app.services.bank_sync.pending_store import (
    _PENDING_SYNC_DATA,
    get_last_statement_snapshot,
    save_last_statement_snapshot,
    save_pending_sync_data,
)
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

REFINED_AT_KEY = "bank_labels_refined_at"
_DEFERRED_SOURCES = ("fallback", "ambiguous", "multi_category")
_REVIEW_ACTIONS = ("AUTO_COMMIT_PENDING_REVIEW", "AUTO_COMMIT_COMING_PENDING_REVIEW", "AUTO_COMMIT_SUSPECTED_DUPLICATE_PENDING_REVIEW")
_REFINED_DECISION_ACTION = {
    "AUTO_COMMIT_PENDING_REVIEW": "AUTO_COMMIT",
    "AUTO_COMMIT_COMING_PENDING_REVIEW": "AUTO_COMMIT_COMING",
}
_REFINED_CREATOR = {
    "AUTO_COMMIT_PENDING_REVIEW": "Automatisme (Écriture)",
    "AUTO_COMMIT_COMING_PENDING_REVIEW": "Automatisme (À venir)",
}

_jobs: Dict[str, List[Dict[str, Any]]] = {}
_threads: Dict[str, threading.Thread] = {}
_last_count: Dict[str, int] = {}
_lock = threading.Lock()


def deferred_tag(resolution: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Marque d'une opération à soumettre à l'IA : la même sélection que l'étage IA du résolveur."""
    if resolution.get("is_manual") or not resolution.get("smart_is_fallback"):
        return None
    if resolution.get("source") not in _DEFERRED_SOURCES:
        return None
    return {"description": resolution.get("description"), "category": resolution.get("category")}


def note_deferred_batch(profile_id: str, conn_id: int, batch_id: Optional[str]) -> None:
    with _lock:
        _jobs.setdefault(profile_id, []).append({"conn_id": conn_id, "batch_id": batch_id})


def is_refining(profile_id: str) -> bool:
    thread = _threads.get(profile_id)
    return bool(thread and thread.is_alive())


def last_refined_count(profile_id: str) -> int:
    return _last_count.get(profile_id, 0)


def start_label_refinement(profile_id: str) -> None:
    """Lance la tâche de fond si des opérations attendent l'IA. Une tâche déjà en cours reprend les nouvelles."""
    with _lock:
        if not _jobs.get(profile_id) or is_refining(profile_id):
            return
        thread = threading.Thread(target=_run, args=(profile_id,), daemon=True)
        _threads[profile_id] = thread
        _last_count[profile_id] = 0
    thread.start()


def _run(profile_id: str) -> None:
    from sqlalchemy.orm import sessionmaker
    from app.database import get_engine

    db = sessionmaker(autocommit=False, autoflush=False, bind=get_engine(profile_id))()
    try:
        while True:
            with _lock:
                jobs = _jobs.pop(profile_id, [])
            if not jobs:
                return
            _last_count[profile_id] = _last_count.get(profile_id, 0) + refine_labels(db, jobs, profile_id)
    except Exception as e:
        db.rollback()
        logger.warning(f"[BankSync] Analyse IA des libellés non terminée (profil={profile_id}) : {e}")
    finally:
        db.close()


def refine_labels(db: Session, jobs: List[Dict[str, Any]], profile_id: str) -> int:
    """Interroge l'IA puis applique ses réponses. Renvoie le nombre d'opérations complétées."""
    from app.services.smart_label_service import resolve_smart_labels_batch

    batch_ids = {j["batch_id"] for j in jobs if j.get("batch_id")}
    conn_ids = {j["conn_id"] for j in jobs}
    tx_types: Dict[str, str] = {}
    for bank_tx in _bank_txs(db, batch_ids, conn_ids, profile_id):
        raw = _raw_label(bank_tx)
        if raw:
            tx_types[raw] = "expense_var" if _raw_amount(bank_tx) < 0 else "income"
    if not tx_types:
        return 0

    resolutions = resolve_smart_labels_batch(
        db, list(tx_types), use_ai_fallback=True, tx_types=tx_types, auto_fallback_category=True,
    )
    answers = {raw: res for raw, res in resolutions.items() if res.get("source") == "ai" and res.get("category")}
    # L'IA a pu répondre après plus d'une minute : tout est relu pour respecter les modifications faites entre-temps
    db.rollback()
    db.expire_all()
    if not answers:
        logger.info(f"[BankSync] Analyse IA : aucune réponse exploitable pour {len(tx_types)} libellé(s) (profil={profile_id})")
        return 0

    refined = _refine_committed(db, batch_ids, answers)
    refined += _refine_pending(db, conn_ids, answers, profile_id)
    _refine_statements(db, conn_ids, answers, profile_id)
    if refined:
        _set_refined_at(db)
    db.commit()
    stats_cache.invalidate(profile_id)
    logger.info(f"[BankSync] Analyse IA : {refined} opération(s) complétée(s) sur {len(tx_types)} libellé(s) (profil={profile_id})")
    return refined


def _raw_label(bank_tx: Dict[str, Any]) -> str:
    return bank_tx.get("raw_description") or bank_tx.get("description") or ""


def _raw_amount(bank_tx: Dict[str, Any]) -> float:
    raw = bank_tx.get("raw_amount")
    return float(raw if raw is not None else (bank_tx.get("amount") or 0.0))


def _bank_txs(db: Session, batch_ids: set, conn_ids: set, profile_id: str):
    for _, snap in _review_decisions(db, batch_ids):
        yield snap.get("bank_tx") or {}
    for tx in _pending_txs(conn_ids, profile_id):
        yield tx


def _review_decisions(db: Session, batch_ids: set):
    if not batch_ids:
        return
    decisions = db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.batch_id.in_(batch_ids),
        AutopilotDecisionLog.decision_type == "new_entry",
        AutopilotDecisionLog.action.in_(_REVIEW_ACTIONS),
        AutopilotDecisionLog.is_undone == False,
    ).all()
    for decision in decisions:
        try:
            snap = json.loads(decision.raw_snapshot or "{}")
        except (ValueError, TypeError):
            continue
        if (snap.get("bank_tx") or {}).get("smart_ai_deferred"):
            yield decision, snap


def _pending_txs(conn_ids: set, profile_id: str):
    profile_pending = _PENDING_SYNC_DATA.get(profile_id, {})
    for conn_id in conn_ids:
        for acc in (profile_pending.get(conn_id) or {}).get("accounts", []):
            for tx in acc.get("transactions", []):
                if tx.get("smart_ai_deferred"):
                    yield tx


def _refine_committed(db: Session, batch_ids: set, answers: Dict[str, Dict[str, Any]]) -> int:
    from app.services.autopilot_service import _get_cfg_bool, get_auto_reconcile_threshold, is_autopilot_enabled
    from app.services.smart_label_service import ensure_category_exists

    autopilot_on = is_autopilot_enabled(db)
    can_create_categories = autopilot_on or _get_cfg_bool(db, "auto_create_missing_categories", False)
    chameleon_allowed = autopilot_on or _get_cfg_bool(db, "auto_assign_chameleon_fallback", False)
    threshold = get_auto_reconcile_threshold(db)
    refined = 0
    for decision, snap in list(_review_decisions(db, batch_ids)):
        bank_tx = snap["bank_tx"]
        answer = answers.get(_raw_label(bank_tx))
        tx = db.query(Transaction).filter(Transaction.id == decision.entity_id).first()
        after = snap.get("after") or {}
        untouched = bool(tx and tx.needs_review and tx.description == after.get("description") and tx.category == after.get("category"))
        if not answer or not untouched:
            continue
        before = snapshot_entity(tx)
        tx.description = answer.get("description") or tx.description
        is_new_category = bool(answer.get("smart_is_new_category"))
        if not is_new_category or can_create_categories:
            tx.category = answer["category"]
            if is_new_category:
                ensure_category_exists(db, tx.category, tx.type)
        category_applied = tx.category == answer["category"]

        confidence = float(answer.get("confidence") or 0.0)
        score = round(confidence * 100, 1)
        blocked = bool(answer.get("is_multi_category")) and not chameleon_allowed and not answer.get("is_manual")
        from app.services.smart_label.categories import is_fallback_category
        reliable = (
            category_applied
            and not is_fallback_category(tx.category)  # fourre-tout : rien n'a été reconnu, reste à vérifier
            and not blocked
            and not snap.get("suspected_duplicate_forecast_id")
            and confidence >= threshold / 100.0
        )
        if reliable:
            tx.needs_review = False
            tx.confidence_score = score
            tx.created_by = _REFINED_CREATOR.get(decision.action, tx.created_by)
            decision.action = _REFINED_DECISION_ACTION.get(decision.action, decision.action)
            decision.confidence_score = score
        db.flush()
        record_action(db, "transaction", tx.id, "UPDATE", before, snapshot_entity(tx), user_name="Automatisme (IA)")

        bank_tx.pop("smart_ai_deferred", None)
        snap.update({
            "decision_reason": "ai_new_category" if is_new_category else "ai_existing",
            "needs_review": tx.needs_review,
            "confidence_score": tx.confidence_score,
            "after": snapshot_entity(tx),
        })
        decision.raw_snapshot = json.dumps(snap, default=str)
        refined += 1
    return refined


def _apply_to_pending_tx(tx: Dict[str, Any], answer: Dict[str, Any]) -> bool:
    tag = tx.get("smart_ai_deferred") or {}
    raw = _raw_label(tx)
    if tx.get("category") not in (tag.get("category"), None) or tx.get("description") not in (tag.get("description"), raw):
        return False
    tx.update({
        "description": answer.get("description") or tx.get("description"),
        "category": answer["category"],
        "smart_suggested": True,
        "smart_source": "ai",
        "smart_is_manual": False,
        "smart_is_provisional": answer.get("is_provisional", False),
        "smart_is_multi_category": answer.get("is_multi_category", False),
        "smart_is_fallback": False,
        "smart_is_new_category": answer.get("smart_is_new_category", False),
        "smart_confidence": answer.get("confidence", 0.0),
    })
    tx.pop("smart_ai_deferred", None)
    return True


def _refine_pending(db: Session, conn_ids: set, answers: Dict[str, Dict[str, Any]], profile_id: str) -> int:
    refined = 0
    profile_pending = _PENDING_SYNC_DATA.get(profile_id, {})
    for conn_id in conn_ids:
        entry = profile_pending.get(conn_id)
        changed = 0
        for acc in (entry or {}).get("accounts", []):
            for tx in acc.get("transactions", []):
                answer = answers.get(_raw_label(tx)) if tx.get("smart_ai_deferred") else None
                if answer and _apply_to_pending_tx(tx, answer):
                    changed += 1
        if changed:
            save_pending_sync_data(db, conn_id, entry, profile_id=profile_id)
            refined += changed
    return refined


def _refine_statements(db: Session, conn_ids: set, answers: Dict[str, Dict[str, Any]], profile_id: str) -> None:
    """Le relevé consultable montre les mêmes libellés et catégories que les opérations."""
    for conn_id in conn_ids:
        statement = get_last_statement_snapshot(db, conn_id, profile_id=profile_id)
        if not statement or statement.get("conn_id") != conn_id:
            continue
        changed = False
        for acc in statement.get("accounts", []):
            for tx in acc.get("transactions", []):
                answer = answers.get(_raw_label(tx)) if tx.get("smart_ai_deferred") else None
                if answer and _apply_to_pending_tx(tx, answer):
                    if "audit_category" in tx:
                        tx["audit_category"] = answer["category"]
                    changed = True
        if changed:
            save_last_statement_snapshot(db, conn_id, statement, profile_id=profile_id)


def _set_refined_at(db: Session) -> None:
    now = datetime.now(timezone.utc).isoformat()
    row = db.query(GlobalConfig).filter(GlobalConfig.key == REFINED_AT_KEY).first()
    if row:
        row.value = now
    else:
        db.add(GlobalConfig(key=REFINED_AT_KEY, value=now))
