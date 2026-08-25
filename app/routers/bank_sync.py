"""
OmniBank-Local — API Router pour la Synchronisation Bancaire (Woob).
Fournit les endpoints REST et les flux SSE pour la gestion des connexions,
le test interactif, le mapping de comptes et la synchronisation sécurisée.
"""

import asyncio
import json
import logging
import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BankConnection
from app.schemas.bank_sync_schemas import (
    BankBackendInfo,
    BankConnectionCreate,
    BankConnectionOut,
    BankConnectionUpdate,
    RemoteAccountOut,
    SyncConnectionRequest,
    TestConnectionRequest,
    TwoFAResponseRequest,
    VaultStatusOut,
    VaultUnlockRequest,
)
from app.services.bank_sync_service import (
    BankSyncService,
    clean_error_message,
    deliver_2fa_response,
    get_all_bank_backends,
    register_2fa_session,
    unregister_2fa_session,
)
from app.profile_manager import get_active_profile
from app.services.credential_vault import CredentialVault, VaultSessionManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bank-sync", tags=["bank-sync"])


@router.get("/backends", response_model=List[BankBackendInfo])
def get_backends(force_refresh: bool = False):
    """Retourne la liste complète des backends bancaires disponibles (96+) et leurs champs de configuration."""
    return get_all_bank_backends(force_refresh=force_refresh)


@router.get("/connections", response_model=List[BankConnectionOut])
def list_connections(db: Session = Depends(get_db)):
    """Liste toutes les connexions bancaires configurées (sans jamais exposer d'identifiant en clair)."""
    connections = db.query(BankConnection).order_by(BankConnection.id.desc()).all()
    active_pid = get_active_profile().get("id", "default")
    is_unlocked = VaultSessionManager.is_unlocked(profile_id=active_pid)
    results = []
    for conn in connections:
        has_creds = CredentialVault.has_credentials(db, conn.id)
        out = BankConnectionOut.model_validate(conn)
        out.has_credentials = has_creds
        # Si le coffre est actuellement déverrouillé, masquer l'erreur obsolète liée au mot de passe maître
        if is_unlocked and out.last_error and "mot de passe" in out.last_error.lower():
            out.last_error = None
            if out.last_sync_status in ("auto_error", "error"):
                out.last_sync_status = "idle"
        elif out.last_sync_status in ("auto_error", "error") and not out.last_error:
            out.last_error = "Erreur lors de la synchronisation bancaire."
        results.append(out)
    return results


@router.post("/connections", response_model=BankConnectionOut)
def create_connection(data: BankConnectionCreate, db: Session = Depends(get_db)):
    """Crée une nouvelle connexion bancaire et chiffre immédiatement ses identifiants dans le coffre."""
    active_pid = get_active_profile().get("id", "default")
    master_pw = data.master_password
    if not master_pw and data.vault_token:
        master_pw = VaultSessionManager.get_password(data.vault_token, profile_id=active_pid)
    if not master_pw:
        master_pw = VaultSessionManager.get_password(profile_id=active_pid)
    
    if not master_pw:
        raise HTTPException(
            status_code=400,
            detail="Mot de passe maître requis pour chiffrer les identifiants de connexion."
        )

    # Si des connexions avec identifiants existent déjà, valider la cohérence du mot de passe maître unique
    existing_conns = db.query(BankConnection).all()
    for ex_conn in existing_conns:
        if CredentialVault.has_credentials(db, ex_conn.id):
            test_creds = CredentialVault.retrieve_credentials(db, ex_conn.id, master_pw)
            if test_creds is None:
                raise HTTPException(
                    status_code=400,
                    detail="Le mot de passe maître saisi ne correspond pas à celui de votre coffre-fort existant. Veuillez utiliser le même mot de passe maître pour tous vos comptes."
                )
            break

    # Extraire website si présent dans credentials (ex: pour le Crédit Agricole)
    website = data.credentials.get("website")

    conn = BankConnection(
        backend=data.backend,
        label=data.label.strip(),
        website=website,
        is_active=True,
        last_sync_status=None,
    )
    db.add(conn)
    db.flush()

    # Stocker les identifiants chiffrés avec le mot de passe maître
    CredentialVault.store_credentials(db, conn.id, data.credentials, master_pw)
    db.commit()
    db.refresh(conn)

    out = BankConnectionOut.model_validate(conn)
    out.has_credentials = True
    return out


@router.put("/connections/{conn_id}", response_model=BankConnectionOut)
def update_connection(conn_id: int, data: BankConnectionUpdate, db: Session = Depends(get_db)):
    """Met à jour le libellé ou le mapping de comptes d'une connexion."""
    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion bancaire introuvable")

    if data.label is not None:
        conn.label = data.label.strip()
    if data.account_mapping is not None:
        conn.account_mapping = json.dumps(data.account_mapping)
    if data.is_active is not None:
        conn.is_active = data.is_active

    db.commit()
    db.refresh(conn)
    out = BankConnectionOut.model_validate(conn)
    out.has_credentials = CredentialVault.has_credentials(db, conn.id)
    return out


@router.delete("/connections/{conn_id}")
def delete_connection(conn_id: int, db: Session = Depends(get_db)):
    """Supprime une connexion bancaire et efface définitivement ses clés chiffrées du coffre et son sas d'attente."""
    from app.services.bank_sync_scheduler import clear_pending_sync_for_connection

    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion bancaire introuvable")

    # Purge sécurisée du coffre et du sas d'attente
    CredentialVault.delete_credentials(db, conn.id)
    clear_pending_sync_for_connection(db, conn.id)

    db.delete(conn)
    db.commit()
    return {"ok": True, "message": "Connexion, identifiants et sas d'attente supprimés."}


@router.post("/vault/unlock", response_model=Dict[str, Any])
def unlock_vault(req: VaultUnlockRequest, db: Session = Depends(get_db)):
    """
    Déverrouille le coffre-fort en mémoire pour X jours pour le profil actif.
    Valide le mot de passe maître sur les connexions existantes.
    """
    active_pid = get_active_profile().get("id", "default")
    connections = db.query(BankConnection).filter(BankConnection.is_active == True).all()
    # Si des connexions existent, tester le mot de passe sur la première qui a des identifiants
    for conn in connections:
        if CredentialVault.has_credentials(db, conn.id):
            creds = CredentialVault.retrieve_credentials(db, conn.id, req.master_password)
            if creds is None:
                raise HTTPException(status_code=401, detail="Mot de passe maître incorrect")
            break

    token = VaultSessionManager.create_session(req.master_password, req.remember_days or 7, profile_id=active_pid)
    status = VaultSessionManager.get_status(token, profile_id=active_pid)

    # Quand le déverrouillage réussit, purger en base les erreurs obsolètes liées au mot de passe/coffre
    for conn in connections:
        if conn.last_error and ("mot de passe" in conn.last_error.lower() or "coffre" in conn.last_error.lower()):
            conn.last_error = None
            if conn.last_sync_status in ("auto_error", "error"):
                conn.last_sync_status = "idle"
    db.commit()

    return {
        "ok": True,
        "vault_token": token,
        **status
    }


@router.get("/vault/status", response_model=VaultStatusOut)
def get_vault_status(token: Optional[str] = Query(None)):
    """Retourne l'état actuel de déverrouillage du coffre-fort pour le profil actif."""
    active_pid = get_active_profile().get("id", "default")
    status = VaultSessionManager.get_status(token, profile_id=active_pid)
    return VaultStatusOut(**status)


@router.post("/vault/lock")
def lock_vault(token: Optional[str] = Query(None)):
    """Verrouille immédiatement le coffre-fort du profil actif (purge de la mémoire vive)."""
    active_pid = get_active_profile().get("id", "default")
    VaultSessionManager.lock_session(token, profile_id=active_pid)
    return {"ok": True, "message": "Coffre-fort verrouillé avec succès."}


@router.post("/vault/reset")
def reset_vault(db: Session = Depends(get_db)):
    """
    Réinitialise complètement le coffre-fort pour le profil actif.
    Purge la session en mémoire vive, supprime toutes les connexions bancaires et leurs clés chiffrées associées.
    """
    from app.services.bank_sync_scheduler import clear_pending_sync_for_connection
    from app.models import GlobalConfig
    active_pid = get_active_profile().get("id", "default")
    
    # 1. Verrouiller et purger la session en mémoire vive
    VaultSessionManager.lock_session(profile_id=active_pid)
    
    # 2. Supprimer toutes les connexions bancaires et leurs sas d'attente
    connections = db.query(BankConnection).all()
    deleted_count = len(connections)
    for conn in connections:
        CredentialVault.delete_credentials(db, conn.id)
        clear_pending_sync_for_connection(db, conn.id)
        db.delete(conn)

    # 3. Purger les clés globales résiduelles du coffre
    db.query(GlobalConfig).filter(GlobalConfig.key.like("bank_vault_%")).delete(synchronize_session=False)
    db.commit()

    logger.info(f"[Vault] Coffre-fort réinitialisé pour le profil '{active_pid}' ({deleted_count} connexions supprimées)")
    return {
        "ok": True,
        "message": "Coffre-fort réinitialisé avec succès.",
        "deleted_connections": deleted_count
    }


@router.get("/settings/auto-sync")
def get_auto_sync_settings(db: Session = Depends(get_db)):
    """Retourne la configuration du relevé bancaire automatique."""
    from app.services.bank_sync_scheduler import _get_config_value
    active_pid = get_active_profile().get("id", "default")
    enabled = _get_config_value(db, "bank_auto_sync_enabled", "false").lower() == "true"
    interval = int(_get_config_value(db, "bank_auto_sync_interval_hours", "24") or 24)
    return {
        "enabled": enabled,
        "interval_hours": interval,
        "vault_unlocked": VaultSessionManager.get_status(profile_id=active_pid).get("is_unlocked", False)
    }


@router.post("/settings/auto-sync")
def update_auto_sync_settings(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Met à jour les paramètres de synchronisation automatique."""
    from app.services.bank_sync_scheduler import _set_config_value
    if "enabled" in data:
        _set_config_value(db, "bank_auto_sync_enabled", "true" if data["enabled"] else "false")
    if "interval_hours" in data:
        _set_config_value(db, "bank_auto_sync_interval_hours", str(int(data["interval_hours"])))
    return {"ok": True}


@router.post("/trigger-auto-sync")
def run_manual_auto_sync(data: Optional[Dict[str, Any]] = None):
    """Déclenche immédiatement un relevé automatique en arrière-plan."""
    from app.services.bank_sync_scheduler import trigger_manual_auto_sync
    active_pid = get_active_profile().get("id", "default")
    master_password = data.get("master_password") if data else None
    vault_token = data.get("vault_token") if data else None
    res = trigger_manual_auto_sync(master_password=master_password, vault_token=vault_token, profile_id=active_pid)
    if not res.get("ok"):
        raise HTTPException(status_code=401, detail=res.get("detail", "Coffre verrouillé"))
    return res


@router.get("/status")
def get_bank_sync_status(profile_id: Optional[str] = None):
    """Retourne le statut d'exécution réel du relevé en arrière-plan."""
    from app.services.bank_sync_scheduler import is_background_sync_running
    active_pid = profile_id or get_active_profile().get("id", "default")
    is_running = is_background_sync_running(active_pid)
    return {
        "is_running": is_running,
        "running_tasks": [active_pid] if is_running else []
    }


@router.get("/pending")
def get_pending_sync_summary(db: Session = Depends(get_db)):
    """Retourne toutes les opérations en attente (rapprochements détectés + nouvelles opérations enrichies par Smart Label)."""
    from app.services.bank_sync_scheduler import get_all_pending_sync
    from app.services.smart_label_service import resolve_smart_labels_batch

    pending = get_all_pending_sync(db)
    if not pending or "accounts" not in pending:
        return pending

    # Collecter tous les libellés bruts des transactions non rapprochées
    raw_labels = []
    for acc in pending.get("accounts", []):
        for tx in acc.get("transactions", []):
            if not tx.get("is_reconciled"):
                raw_desc = tx.get("raw_description") or tx.get("description") or ""
                if raw_desc:
                    raw_labels.append(raw_desc)

    if raw_labels:
        smart_resolutions = resolve_smart_labels_batch(db, raw_labels)
        for acc in pending.get("accounts", []):
            for tx in acc.get("transactions", []):
                if not tx.get("is_reconciled"):
                    raw_desc = tx.get("raw_description") or tx.get("description") or ""
                    tx["raw_description"] = raw_desc
                    if raw_desc in smart_resolutions:
                        res = smart_resolutions[raw_desc]
                        if res.get("source") in ("rule", "history"):
                            tx["description"] = res["description"]
                            tx["smart_suggested"] = True
                            tx["smart_source"] = res["source"]
                            if not tx.get("category") and res.get("category"):
                                tx["category"] = res["category"]

    return pending


@router.post("/re-evaluate-preview")
def re_evaluate_preview_endpoint(data: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Re-calcule dynamiquement en direct le statut de rapprochement d'un aperçu bancaire
    par rapport à l'état actuel de la base SQLite.
    """
    from app.services.bank_sync_service import re_evaluate_preview_data
    return re_evaluate_preview_data(db, data)


@router.post("/reconcile-fast/{tx_id}")
def reconcile_single_matched_transaction(tx_id: int, db: Session = Depends(get_db)):
    """Pointe immédiatement en 1 clic une opération détectée en ligne."""
    from datetime import date
    from app.models import Transaction
    from app.services.history_service import record_action, snapshot_entity
    from app.services import stats_cache
    from app.services.bank_sync_scheduler import _PENDING_SYNC_DATA

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
    from datetime import date
    from app.models import Transaction
    from app.services.history_service import record_action, snapshot_entity
    from app.services import stats_cache
    from app.services.bank_sync_scheduler import get_all_pending_sync

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
def commit_single_ghost_transaction(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Valide et enregistre en base une ligne fantôme individuelle (1-clic ou modale FormView)."""
    from app.services.bank_sync_scheduler import remove_committed_from_pending
    conn_id = data.get("connection_id", 0)
    tx_data = data.get("transaction", {})
    if not tx_data:
        raise HTTPException(status_code=400, detail="Données de transaction requises")

    csv_id = tx_data.get("csv_id")
    res = BankSyncService.commit_reviewed_transactions(
        db=db,
        connection_id=conn_id,
        transactions_data=[tx_data]
    )

    if csv_id:
        remove_committed_from_pending(db, [csv_id])

    return {"ok": True, "result": res}


@router.post("/commit-all-ghosts")
def commit_all_ghost_transactions(db: Session = Depends(get_db)):
    """Valide et enregistre en lot toutes les nouvelles opérations fantômes non encore rapprochées."""
    from app.services.bank_sync_scheduler import get_all_pending_sync, remove_committed_from_pending
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
            if not tx.get("is_reconciled"):
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
                transactions_data=unreconciled_txs
            )
            committed_total += res.get("imported", 0)
            all_created_ids.extend(res.get("created_ids", []))

    if csv_ids_to_purge:
        remove_committed_from_pending(db, csv_ids_to_purge)

    return {"ok": True, "committed_count": committed_total, "created_ids": all_created_ids}


@router.post("/dismiss-ghost/{csv_id}")
def dismiss_single_ghost(csv_id: str, db: Session = Depends(get_db)):
    """Ignore et retire du sas d'attente une ligne fantôme."""
    from app.services.bank_sync_scheduler import dismiss_pending_transaction
    success = dismiss_pending_transaction(db, csv_id)
    return {"ok": True, "dismissed": success}


@router.post("/purge-pending")
def purge_all_pending(db: Session = Depends(get_db)):
    """Purge l'intégralité du sas d'opérations en attente (cache de synchronisation)."""
    from app.services.bank_sync_scheduler import clear_all_pending_sync
    clear_all_pending_sync(db)
    return {"ok": True}


@router.post("/link-ghost")
def link_ghost_to_transaction(data: Dict[str, Any], db: Session = Depends(get_db)):
    """
    Lie une opération fantôme (ghost) à une opération existante en base de données.
    Met à jour les champs de l'opération ciblée, la pointe et retire le fantôme du sas d'attente.
    """
    from datetime import date, datetime
    from app.models import Transaction
    from app.services.history_service import record_action, snapshot_entity
    from app.services import stats_cache
    from app.services.bank_sync_scheduler import remove_committed_from_pending

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

    # Date de pointage (par défaut aujourd'hui)
    recon_date_val = None
    if data.get("reconciliation_date"):
        try:
            recon_date_val = datetime.strptime(str(data["reconciliation_date"])[:10], "%Y-%m-%d").date()
        except Exception:
            recon_date_val = date.today()
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



@router.post("/test-credentials", response_model=List[RemoteAccountOut])
def test_credentials(data: TestConnectionRequest):
    """Teste des identifiants bruts et retourne la liste des comptes distants détectés."""
    try:
        accounts = BankSyncService.test_connection_and_list_accounts(
            backend_name=data.backend,
            credentials=data.credentials,
        )
        return accounts
    except Exception as e:
        logger.warning(f"[BankSync] Échec du test d'identifiants ({data.backend}) : {e}")
        raise HTTPException(status_code=400, detail=clean_error_message(e))


@router.post("/connections/{conn_id}/test", response_model=List[RemoteAccountOut])
def test_existing_connection(conn_id: int, req: SyncConnectionRequest, db: Session = Depends(get_db)):
    """Teste une connexion existante en déchiffrant les identifiants avec le mot de passe maître."""
    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion introuvable")

    active_pid = get_active_profile().get("id", "default")
    pw = req.master_password or VaultSessionManager.get_password(req.vault_token, profile_id=active_pid)
    if not pw:
        raise HTTPException(status_code=401, detail="Mot de passe maître requis ou coffre verrouillé")

    creds = CredentialVault.retrieve_credentials(db, conn.id, pw)
    if not creds:
        raise HTTPException(status_code=401, detail="Mot de passe maître incorrect ou identifiants introuvables")

    try:
        accounts = BankSyncService.test_connection_and_list_accounts(
            backend_name=conn.backend,
            credentials=creds,
        )
        return accounts
    except Exception as e:
        logger.warning(f"[BankSync] Échec du test pour la connexion {conn_id} : {e}")
        raise HTTPException(status_code=400, detail=clean_error_message(e))


@router.get("/connections/{conn_id}/test-stream")
async def test_connection_stream(
    conn_id: int,
    vault_token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Flux SSE pour le test et la découverte des comptes bancaires distants avec support interactif 2FA/SCA.
    """
    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion bancaire introuvable")

    active_pid = get_active_profile().get("id", "default")
    pw = VaultSessionManager.get_password(vault_token, profile_id=active_pid)
    if not pw:
        raise HTTPException(status_code=401, detail="Mot de passe maître requis ou coffre verrouillé")

    creds = CredentialVault.retrieve_credentials(db, conn.id, pw)
    if not creds:
        raise HTTPException(status_code=401, detail="Mot de passe maître incorrect ou identifiants introuvables")

    session_id = f"test_{conn_id}_{uuid.uuid4().hex[:8]}"
    event_queue: asyncio.Queue = asyncio.Queue()
    main_loop = asyncio.get_running_loop()
    register_2fa_session(session_id)

    def sse_callback(event_type: str, payload: Dict[str, Any]):
        data_str = json.dumps({"session_id": session_id, **payload})
        msg = f"event: {event_type}\ndata: {data_str}\n\n"
        main_loop.call_soon_threadsafe(event_queue.put_nowait, msg)

    def test_worker():
        try:
            sse_callback("progress", {"step": "auth", "message": f"Connexion sécurisée à {conn.label or conn.backend}..."})
            accounts = BankSyncService.test_connection_and_list_accounts(
                backend_name=conn.backend,
                credentials=creds,
                session_id=session_id,
                event_callback=sse_callback
            )
            sse_callback("accounts", {"accounts": [a.model_dump() for a in accounts]})
        except Exception as e:
            logger.warning(f"[BankSync] Échec du flux de test {conn_id} : {e}")
            sse_callback("error", {"message": clean_error_message(e)})
        finally:
            unregister_2fa_session(session_id)
            main_loop.call_soon_threadsafe(event_queue.put_nowait, None)

    import threading
    worker_thread = threading.Thread(target=test_worker, daemon=True)
    worker_thread.start()

    async def event_generator():
        try:
            while True:
                msg = await event_queue.get()
                if msg is None:
                    break
                yield msg
        except asyncio.CancelledError:
            unregister_2fa_session(session_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/connections/{conn_id}/preview")
def fetch_preview(conn_id: int, req: SyncConnectionRequest, db: Session = Depends(get_db)):
    """Récupère les opérations de la banque et prépare le tableau de prévisualisation (à ajouter / à rapprocher / ignorées)."""
    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion bancaire introuvable")

    active_pid = get_active_profile().get("id", "default")
    pw = req.master_password or VaultSessionManager.get_password(req.vault_token, profile_id=active_pid)
    if not pw:
        raise HTTPException(status_code=401, detail="Mot de passe maître requis ou coffre verrouillé")

    try:
        preview = BankSyncService.fetch_preview_transactions(
            db=db,
            connection=conn,
            master_password=pw,
            since_days=req.since_days or 90
        )
        from app.services.bank_sync_scheduler import save_pending_sync_data
        save_pending_sync_data(db, conn.id, preview)
        return preview
    except Exception as e:
        err_msg = clean_error_message(e)
        logger.warning(f"[BankSync] Échec du preview pour connexion {conn_id} ({type(e).__name__}) : {err_msg}", exc_info=True)
        raise HTTPException(status_code=400, detail=err_msg)


@router.post("/connections/{conn_id}/commit")
def commit_reviewed_sync(conn_id: int, data: Dict[str, Any], db: Session = Depends(get_db)):
    """Valide et enregistre en base les transactions revues par l'utilisateur."""
    txs = data.get("transactions", [])
    try:
        res = BankSyncService.commit_reviewed_transactions(
            db=db,
            connection_id=conn_id,
            transactions_data=txs
        )
        from app.services.bank_sync_scheduler import remove_committed_from_pending, clear_pending_sync_for_conn
        committed_csv_ids = [t.get("csv_id") for t in txs if t.get("csv_id")]
        if committed_csv_ids:
            remove_committed_from_pending(db, committed_csv_ids)
        else:
            clear_pending_sync_for_conn(db, conn_id)
        return res
    except Exception as e:
        logger.error(f"[BankSync] Erreur lors du commit des transactions {conn_id} : {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/2fa/respond")
def handle_2fa_response(req: TwoFAResponseRequest):
    """Reçoit la réponse utilisateur au challenge 2FA (code OTP ou validation mobile)."""
    success = deliver_2fa_response(req.session_id, {
        "response_type": req.response_type,
        "value": req.value
    })
    if not success:
        raise HTTPException(status_code=404, detail="Session 2FA introuvable ou expirée")
    return {"ok": True}


@router.get("/connections/{conn_id}/sync-stream")
async def sync_connection_stream(
    conn_id: int,
    vault_token: Optional[str] = Query(None),
    since_days: int = Query(90),
    db: Session = Depends(get_db)
):
    """
    Flux SSE (Server-Sent Events) pour la synchronisation en temps réel :
    émet les étapes de progression et les demandes de validation 2FA.
    """
    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion bancaire introuvable")

    active_pid = get_active_profile().get("id", "default")
    pw = VaultSessionManager.get_password(vault_token, profile_id=active_pid)
    if not pw:
        raise HTTPException(status_code=401, detail="Mot de passe maître requis ou coffre verrouillé")

    session_id = f"sync_{conn_id}_{uuid.uuid4().hex[:8]}"
    event_queue: asyncio.Queue = asyncio.Queue()
    main_loop = asyncio.get_running_loop()
    register_2fa_session(session_id)

    def sse_callback(event_type: str, payload: Dict[str, Any]):
        data_str = json.dumps({"session_id": session_id, **payload})
        msg = f"event: {event_type}\ndata: {data_str}\n\n"
        # Envoi thread-safe dans la queue asyncio depuis le thread worker
        main_loop.call_soon_threadsafe(event_queue.put_nowait, msg)

    # Lancement du worker de sync dans un thread séparé
    def sync_worker():
        from app.database import SessionLocal
        worker_db = SessionLocal()
        worker_conn = None
        try:
            worker_conn = worker_db.query(BankConnection).filter(BankConnection.id == conn_id).first()
            BankSyncService.sync_connection(
                db=worker_db,
                connection=worker_conn,
                master_password=pw,
                since_days=since_days,
                event_callback=sse_callback,
                session_id=session_id
            )
        except Exception as e:
            err_msg = clean_error_message(e)
            logger.error(f"[BankSync] Erreur durant le flux de sync {conn_id} ({type(e).__name__}) : {err_msg}", exc_info=True)
            if worker_conn:
                worker_conn.last_sync_status = "error"
                worker_conn.last_error = err_msg
                worker_db.commit()
            sse_callback("error", {"message": err_msg})
        finally:
            worker_db.close()
            unregister_2fa_session(session_id)
            main_loop.call_soon_threadsafe(event_queue.put_nowait, None)  # Sentinel pour fermer le flux

    import threading
    worker_thread = threading.Thread(target=sync_worker, daemon=True)
    worker_thread.start()

    async def event_generator():
        try:
            while True:
                msg = await event_queue.get()
                if msg is None:
                    break
                yield msg
        except asyncio.CancelledError:
            unregister_2fa_session(session_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

