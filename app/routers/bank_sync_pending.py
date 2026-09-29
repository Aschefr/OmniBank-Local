"""
OmniBank-Local — API Router pour le Sas d'Attente de Synchronisation (Pending Review).
Gère la consultation des opérations en attente avec enrichissement Smart Label,
les actions rapides de pointage (1-clic / tout pointer), la validation de fantômes (ghosts),
les exclusions/restaurations persistantes et la liaison manuelle.
"""

import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Transaction
from app.profile_manager import get_active_profile
from app.services.bank_sync_service import BankSyncService, re_evaluate_preview_data
from app.services.bank_sync_scheduler import (
    _PENDING_SYNC_DATA,
    clear_all_pending_sync,
    dismiss_pending_transaction,
    get_all_pending_sync,
    get_last_statement_snapshot,
    remove_committed_from_pending,
    remove_dismissed_transaction,
    save_last_statement_snapshot,
    save_pending_sync_data,
)
from app.services.history_service import record_action, snapshot_entity
from app.services.reconciliation_engine import check_reconciliation
from app.services.smart_label_service import resolve_smart_labels_batch
from app.services import stats_cache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bank-sync", tags=["bank-sync"])


@router.get("/last-statement")
def get_last_statement_endpoint(conn_id: Optional[int] = None, db: Session = Depends(get_db)):
    """Retourne le dernier relevé bancaire synchronisé pour consultation (avec les statuts d'audit de l'Auto-Pilote)."""
    active_pid = get_active_profile().get("id", "default")
    snapshot = get_last_statement_snapshot(db, conn_id=conn_id, profile_id=active_pid)
    if not snapshot:
        return {"accounts": [], "updated_at": None, "conn_id": conn_id}

    snapshot_modified = False
    # Enrichissement dynamique, validation et réparation du sens de flux (crédit vs débit)
    for acc in snapshot.get("accounts", []):
        acc_id = acc.get("account_id")
        for tx in acc.get("transactions", []):
            raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else tx.get("amount", 0.0))
            is_credit = (raw_amt > 0)

            # Vérifier si l'appariement existant a un sens inversé (ex: crédit bancaire apparié par erreur à une dépense en base)
            db_id = tx.get("audit_matched_id") or tx.get("matched_db_id")
            if db_id and acc_id:
                db_tx = db.query(Transaction).filter(Transaction.id == db_id).first()
                if db_tx:
                    db_is_credit = (db_tx.to_account_id == acc_id or db_tx.type == "income")
                    if is_credit != db_is_credit:
                        # Inversion détectée : recalculer le rapprochement conforme
                        tx_date_str = tx.get("date_operation")
                        tx_d = None
                        if tx_date_str:
                            try:
                                tx_d = date.fromisoformat(str(tx_date_str)[:10])
                            except Exception:
                                pass
                        if tx_d:
                            corrected_rec = check_reconciliation(
                                db,
                                tx_d,
                                raw_amt,
                                account_id=acc_id,
                                is_coming=bool(tx.get("is_coming")),
                                bank_label=tx.get("raw_description") or tx.get("description"),
                                csv_id=tx.get("csv_id")
                            )
                            if corrected_rec and corrected_rec.get("id"):
                                new_id = corrected_rec["id"]
                                tx["matched_db_id"] = new_id
                                tx["db_description"] = corrected_rec.get("description")
                                tx["category"] = corrected_rec.get("category")
                                tx["db_category"] = corrected_rec.get("category")
                                if "audit_matched_id" in tx:
                                    tx["audit_matched_id"] = new_id
                                if "audit_matched_desc" in tx:
                                    tx["audit_matched_desc"] = corrected_rec.get("description")
                                if "audit_category" in tx:
                                    tx["audit_category"] = corrected_rec.get("category")
                                snapshot_modified = True

            # Si la catégorie est encore manquante, la charger depuis la transaction en base
            if not tx.get("category") or tx.get("category") == "--":
                curr_id = tx.get("audit_matched_id") or tx.get("audit_created_id") or tx.get("matched_db_id")
                if curr_id:
                    db_t = db.query(Transaction).filter(Transaction.id == curr_id).first()
                    if db_t and db_t.category:
                        tx["category"] = db_t.category
                        tx["db_category"] = db_t.category
                        snapshot_modified = True
                elif tx.get("csv_id"):
                    db_t = db.query(Transaction).filter(Transaction.csv_id == tx["csv_id"]).first()
                    if db_t and db_t.category:
                        tx["category"] = db_t.category
                        tx["db_category"] = db_t.category
                        if not tx.get("matched_db_id"):
                            tx["matched_db_id"] = db_t.id
                        snapshot_modified = True

    if snapshot_modified:
        target_conn = snapshot.get("conn_id") or conn_id
        if target_conn is not None:
            save_last_statement_snapshot(db, target_conn, snapshot, profile_id=active_pid)

    return snapshot


@router.get("/pending")
def get_pending_sync_summary(db: Session = Depends(get_db)):
    """Retourne toutes les opérations en attente (rapprochements détectés + nouvelles opérations enrichies par Smart Label)."""
    active_pid = get_active_profile().get("id", "default")
    cached_result = stats_cache.get(active_pid, "bank_pending_sync_summary")
    if cached_result is not None:
        return cached_result

    pending = get_all_pending_sync(db, profile_id=active_pid)
    if not pending or "accounts" not in pending:
        stats_cache.set(active_pid, "bank_pending_sync_summary", pending)
        return pending

    # Collecter tous les libellés bruts des transactions non rapprochées et leurs types
    raw_labels = []
    tx_types_map = {}
    for acc in pending.get("accounts", []):
        for tx in acc.get("transactions", []):
            if not tx.get("is_reconciled"):
                raw_desc = tx.get("raw_description") or tx.get("description") or ""
                if raw_desc:
                    raw_labels.append(raw_desc)
                    raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                    tx_types_map[raw_desc] = "expense_var" if raw_amt < 0 else "income"

    if raw_labels:
        # Résolution déterministe ultra-rapide (règles, historique, repli) sans appel bloquant IA au boot
        smart_resolutions = resolve_smart_labels_batch(
            db,
            raw_labels,
            use_ai_fallback=False,
            tx_types=tx_types_map,
            auto_fallback_category=True
        )
        for acc in pending.get("accounts", []):
            for tx in acc.get("transactions", []):
                if not tx.get("is_reconciled"):
                    raw_desc = tx.get("raw_description") or tx.get("description") or ""
                    tx["raw_description"] = raw_desc
                    if raw_desc in smart_resolutions:
                        res = smart_resolutions[raw_desc]
                        if res.get("source") in ("rule", "history", "multi_category", "ai", "fallback"):
                            # Si l'opération a déjà été enrichie par l'IA ou règle manuelle, ne JAMAIS la rétrograder en fallback
                            if tx.get("smart_source") in ("ai", "rule", "history") or tx.get("smart_is_manual"):
                                continue
                            if res.get("source") == "fallback":
                                if tx.get("category"):
                                    continue
                                if tx.get("smart_source") and tx.get("smart_source") != "none":
                                    continue
                            if not tx.get("description") or tx.get("description") == raw_desc:
                                tx["description"] = res["description"]
                            if not tx.get("category") and res.get("category"):
                                tx["category"] = res["category"]
                            if not tx.get("smart_source") or tx.get("smart_source") == "none":
                                tx["smart_suggested"] = True
                                tx["smart_source"] = res.get("source")
                                tx["smart_is_manual"] = res.get("is_manual", False)
                                tx["smart_is_provisional"] = res.get("is_provisional", False)
                                tx["smart_is_multi_category"] = res.get("is_multi_category", False)
                                tx["smart_is_fallback"] = res.get("smart_is_fallback", False)
                                tx["smart_is_new_category"] = res.get("smart_is_new_category", False)
                                tx["smart_confidence"] = res.get("confidence", 0.0)

    stats_cache.set(active_pid, "bank_pending_sync_summary", pending)
    return pending


@router.post("/update-pending")
def update_pending_sync_endpoint(data: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Met à jour les données du sas (modifications manuelles de catégories, descriptions, enrichissements IA).
    """
    active_pid = get_active_profile().get("id", "default")
    conn_id = data.get("connection_id", 1)
    if not data or "accounts" not in data:
        raise HTTPException(status_code=400, detail="Données de sas requises")
    save_pending_sync_data(db, conn_id, data, profile_id=active_pid)
    stats_cache.invalidate(active_pid)
    return {"ok": True}


@router.post("/re-evaluate-preview")
def re_evaluate_preview_endpoint(data: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Re-calcule dynamiquement en direct le statut de rapprochement d'un aperçu bancaire
    par rapport à l'état actuel de la base SQLite.
    """
    return re_evaluate_preview_data(db, data)


@router.post("/reconcile-fast/{tx_id}")
def reconcile_single_matched_transaction(tx_id: int, db: Session = Depends(get_db)):
    """Pointe immédiatement en 1 clic une opération détectée en ligne."""
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction introuvable")

    before_snap = snapshot_entity(tx)
    tx.reconciliation_date = date.today()
    db.commit()
    db.refresh(tx)

    record_action(db, "transaction", tx.id, "UPDATE", before_snap, snapshot_entity(tx), user_name="Banque (1-Clic)")
    stats_cache.invalidate()

    return {"ok": True, "reconciled_id": tx.id, "reconciliation_date": tx.reconciliation_date.isoformat()}


@router.post("/reconcile-all-pending")
def reconcile_all_matched_pending(db: Session = Depends(get_db)):
    """Pointe en lot toutes les opérations en attente qui correspondent aux relevés bancaires."""
    pending = get_all_pending_sync(db)
    matches = pending.get("matches_by_tx_id", {})
    reconciled_count = 0

    for tx_id_str, match_info in matches.items():
        if match_info.get("is_coming"):
            # Ne pointer en lot que les opérations confirmées / imputées en banque
            continue
        try:
            tx_id = int(tx_id_str)
        except ValueError:
            continue
        tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
        if tx and not tx.reconciliation_date:
            before_snap = snapshot_entity(tx)
            tx.reconciliation_date = date.today()
            if match_info.get("category"):
                tx.category = match_info["category"]
            record_action(db, "transaction", tx.id, "UPDATE", before_snap, snapshot_entity(tx), user_name="Banque (Tout pointer)")
            reconciled_count += 1

    db.commit()
    stats_cache.invalidate()

    return {"ok": True, "reconciled_count": reconciled_count}


@router.post("/commit-ghost")
def commit_single_ghost_transaction(data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    """Valide et enregistre en base une ligne fantôme individuelle (1-clic ou modale FormView)."""
    conn_id = data.get("connection_id", 0)
    tx_data = data.get("transaction", {})
    if not tx_data:
        raise HTTPException(status_code=400, detail="Données de transaction requises")

    user_name = data.get("user_name") or tx_data.get("user_name") or tx_data.get("created_by") or request.headers.get("x-user-name")
    if user_name:
        from urllib.parse import unquote
        user_name = unquote(user_name)
    lang = data.get("lang") or request.headers.get("accept-language", "").split(",")[0][:2]

    csv_id = tx_data.get("csv_id")
    res = BankSyncService.commit_reviewed_transactions(
        db=db,
        connection_id=conn_id,
        transactions_data=[tx_data],
        user_name=user_name,
        lang=lang
    )

    if csv_id:
        remove_committed_from_pending(db, [csv_id])

    return {"ok": True, "result": res}


@router.post("/commit-all-ghosts")
def commit_all_ghost_transactions(request: Request, data: Optional[Dict[str, Any]] = None, db: Session = Depends(get_db)):
    """Valide et enregistre en lot toutes les nouvelles opérations fantômes non encore rapprochées."""
    data = data or {}
    user_name = data.get("user_name") or request.headers.get("x-user-name")
    if user_name:
        from urllib.parse import unquote
        user_name = unquote(user_name)
    lang = data.get("lang") or request.headers.get("accept-language", "").split(",")[0][:2]

    pending = get_all_pending_sync(db)
    committed_total = 0
    csv_ids_to_purge = []

    all_created_ids = []
    # Parcourir chaque compte et récupérer les transactions non rapprochées
    for acc in pending.get("accounts", []):
        conn_id = acc.get("connection_id", 0)
        account_id = acc.get("account_id")
        unreconciled_txs = []
        for tx in acc.get("transactions", []):
            if not tx.get("is_reconciled") and not tx.get("is_dismissed") and not tx.get("is_auto_dismissed") and not tx.get("_excluded"):
                tx_copy = dict(tx)
                if not tx_copy.get("account_id"):
                    tx_copy["account_id"] = account_id
                unreconciled_txs.append(tx_copy)
                if tx_copy.get("csv_id"):
                    csv_ids_to_purge.append(tx_copy["csv_id"])

        if unreconciled_txs:
            res = BankSyncService.commit_reviewed_transactions(
                db=db,
                connection_id=conn_id,
                transactions_data=unreconciled_txs,
                user_name=user_name,
                lang=lang
            )
            committed_total += res.get("imported", 0)
            all_created_ids.extend(res.get("created_ids", []))

    if csv_ids_to_purge:
        remove_committed_from_pending(db, csv_ids_to_purge)

    return {"ok": True, "committed_count": committed_total, "created_ids": all_created_ids}


@router.post("/dismiss-ghost/{csv_id}")
def dismiss_single_ghost(csv_id: str, db: Session = Depends(get_db)):
    """Ignore et retire du sas d'attente une ligne fantôme de façon persistante."""
    success = dismiss_pending_transaction(db, csv_id)
    return {"ok": True, "dismissed": success}


@router.post("/restore-ghost/{csv_id}")
def restore_single_ghost(csv_id: str, db: Session = Depends(get_db)):
    """Rétablit une opération précédemment ignorée pour la réintégrer dans la synchronisation."""
    success = remove_dismissed_transaction(db, csv_id)
    return {"ok": True, "restored": success}


@router.post("/purge-pending")
def purge_all_pending(db: Session = Depends(get_db)):
    """Purge l'intégralité du sas d'opérations en attente (cache de synchronisation)."""
    clear_all_pending_sync(db)
    return {"ok": True}


@router.post("/link-ghost")
def link_ghost_to_transaction(data: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Lie une opération fantôme (ghost) à une opération existante en base de données.
    Met à jour les champs de l'opération ciblée, la pointe et retire le fantôme du sas d'attente.
    """
    csv_id = data.get("csv_id")
    target_tx_id = data.get("target_tx_id")
    if not target_tx_id:
        raise HTTPException(status_code=400, detail="Identifiant de la transaction cible requis")

    tx = db.query(Transaction).filter(Transaction.id == int(target_tx_id)).first()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction cible introuvable")

    before_snap = snapshot_entity(tx)

    # Mise à jour des champs si spécifiés
    if "description" in data and data["description"] is not None:
        tx.description = str(data["description"]).strip()

    if "amount" in data and data["amount"] is not None:
        try:
            tx.amount = abs(float(data["amount"]))
        except (ValueError, TypeError):
            pass

    if "category" in data:
        tx.category = data["category"]

    # Date de pointage (par défaut aujourd'hui sauf si opération à venir ou date explicitement vide)
    is_coming = bool(data.get("is_coming", False))
    recon_date_val = None
    if data.get("reconciliation_date"):
        try:
            recon_date_val = datetime.strptime(str(data["reconciliation_date"])[:10], "%Y-%m-%d").date()
        except Exception:
            recon_date_val = None if is_coming else date.today()
    elif is_coming:
        recon_date_val = None
    else:
        recon_date_val = date.today()

    tx.reconciliation_date = recon_date_val

    # Si un csv_id est présent sur le ghost et que la transaction n'en a pas encore, l'assigner
    if csv_id and not tx.csv_id:
        existing_with_csv = db.query(Transaction).filter(Transaction.csv_id == csv_id).first()
        if not existing_with_csv:
            tx.csv_id = csv_id

    db.commit()
    db.refresh(tx)

    # Purge du sas d'attente
    if csv_id:
        remove_committed_from_pending(db, [csv_id])

    record_action(db, "transaction", tx.id, "UPDATE", before_snap, snapshot_entity(tx), user_name="Banque (Liaison manuelle)")
    stats_cache.invalidate()

    return {
        "ok": True,
        "updated_tx_id": tx.id,
        "reconciliation_date": tx.reconciliation_date.isoformat() if tx.reconciliation_date else None
    }
