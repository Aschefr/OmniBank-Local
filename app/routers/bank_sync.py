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
    deliver_2fa_response,
    get_all_bank_backends,
    register_2fa_session,
    unregister_2fa_session,
)
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
    results = []
    for conn in connections:
        has_creds = CredentialVault.has_credentials(db, conn.id)
        out = BankConnectionOut.model_validate(conn)
        out.has_credentials = has_creds
        results.append(out)
    return results


@router.post("/connections", response_model=BankConnectionOut)
def create_connection(data: BankConnectionCreate, db: Session = Depends(get_db)):
    """Crée une nouvelle connexion bancaire et chiffre immédiatement ses identifiants dans le coffre."""
    # Si des connexions avec identifiants existent déjà, valider la cohérence du mot de passe maître unique
    existing_conns = db.query(BankConnection).all()
    for ex_conn in existing_conns:
        if CredentialVault.has_credentials(db, ex_conn.id):
            test_creds = CredentialVault.retrieve_credentials(db, ex_conn.id, data.master_password)
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
    CredentialVault.store_credentials(db, conn.id, data.credentials, data.master_password)
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
    """Supprime une connexion bancaire et efface définitivement ses clés chiffrées du coffre."""
    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion bancaire introuvable")

    # Purge sécurisée du coffre
    CredentialVault.delete_credentials(db, conn.id)

    db.delete(conn)
    db.commit()
    return {"ok": True, "message": "Connexion et identifiants supprimés."}


@router.post("/vault/unlock", response_model=Dict[str, Any])
def unlock_vault(req: VaultUnlockRequest, db: Session = Depends(get_db)):
    """
    Déverrouille le coffre-fort en mémoire pour X jours.
    Valide le mot de passe maître sur les connexions existantes.
    """
    connections = db.query(BankConnection).filter(BankConnection.is_active == True).all()
    # Si des connexions existent, tester le mot de passe sur la première qui a des identifiants
    for conn in connections:
        if CredentialVault.has_credentials(db, conn.id):
            creds = CredentialVault.retrieve_credentials(db, conn.id, req.master_password)
            if creds is None:
                raise HTTPException(status_code=401, detail="Mot de passe maître incorrect")
            break

    token = VaultSessionManager.create_session(req.master_password, req.remember_days or 7)
    status = VaultSessionManager.get_status(token)
    return {
        "ok": True,
        "vault_token": token,
        **status
    }


@router.get("/vault/status", response_model=VaultStatusOut)
def get_vault_status(token: Optional[str] = Query(None)):
    """Retourne l'état actuel de déverrouillage du coffre-fort."""
    status = VaultSessionManager.get_status(token)
    return VaultStatusOut(**status)


@router.post("/vault/lock")
def lock_vault(token: Optional[str] = Query(None)):
    """Verrouille immédiatement le coffre-fort (purge de la mémoire vive)."""
    VaultSessionManager.lock_session(token)
    return {"ok": True, "message": "Coffre-fort verrouillé avec succès."}


@router.get("/settings/auto-sync")
def get_auto_sync_settings(db: Session = Depends(get_db)):
    """Retourne la configuration du relevé bancaire automatique."""
    from app.services.bank_sync_scheduler import _get_config_value
    enabled = _get_config_value(db, "bank_auto_sync_enabled", "false").lower() == "true"
    interval = int(_get_config_value(db, "bank_auto_sync_interval_hours", "24") or 24)
    return {
        "enabled": enabled,
        "interval_hours": interval,
        "vault_unlocked": VaultSessionManager.get_status().get("is_unlocked", False)
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
    master_password = data.get("master_password") if data else None
    vault_token = data.get("vault_token") if data else None
    res = trigger_manual_auto_sync(master_password=master_password, vault_token=vault_token)
    if not res.get("ok"):
        raise HTTPException(status_code=401, detail=res.get("detail", "Coffre verrouillé"))
    return res



@router.get("/pending")
def get_pending_sync_summary(db: Session = Depends(get_db)):
    """Retourne toutes les opérations en attente (rapprochements détectés + nouvelles opérations)."""
    from app.services.bank_sync_scheduler import get_all_pending_sync
    return get_all_pending_sync(db)


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

    # Nettoyer des pending
    for conn_id, pdata in list(_PENDING_SYNC_DATA.items()):
        for acc in pdata.get("accounts", []):
            acc["transactions"] = [t for t in acc.get("transactions", []) if t.get("matched_db_id") != tx_id]

    return {"ok": True, "reconciled_id": tx.id, "reconciliation_date": tx.reconciliation_date.isoformat()}


@router.post("/reconcile-all-pending")
def reconcile_all_matched_pending(db: Session = Depends(get_db)):
    """Pointe en lot toutes les opérations en attente qui correspondent aux relevés bancaires."""
    from datetime import date
    from app.models import Transaction
    from app.services.history_service import record_action, snapshot_entity
    from app.services import stats_cache
    from app.services.bank_sync_scheduler import get_all_pending_sync, _PENDING_SYNC_DATA

    pending = get_all_pending_sync(db)
    matches = pending.get("matches_by_tx_id", {})
    reconciled_count = 0

    for tx_id_str, match_info in matches.items():
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

    # Vider les correspondances traitées du cache
    _PENDING_SYNC_DATA.clear()

    return {"ok": True, "reconciled_count": reconciled_count}


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
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/connections/{conn_id}/test", response_model=List[RemoteAccountOut])
def test_existing_connection(conn_id: int, req: SyncConnectionRequest, db: Session = Depends(get_db)):
    """Teste une connexion existante en déchiffrant les identifiants avec le mot de passe maître."""
    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion introuvable")

    pw = req.master_password or VaultSessionManager.get_password(req.vault_token)
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
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/connections/{conn_id}/preview")
def fetch_preview(conn_id: int, req: SyncConnectionRequest, db: Session = Depends(get_db)):
    """Récupère les opérations de la banque et prépare le tableau de prévisualisation (à ajouter / à rapprocher / ignorées)."""
    conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
    if not conn:
        raise HTTPException(status_code=404, detail="Connexion bancaire introuvable")

    pw = req.master_password or VaultSessionManager.get_password(req.vault_token)
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
        logger.warning(f"[BankSync] Échec du preview pour connexion {conn_id} : {e}")
        raise HTTPException(status_code=400, detail=str(e))


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
        from app.services.bank_sync_scheduler import clear_pending_sync_for_conn
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
    master_password: Optional[str] = Query(None),
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

    pw = master_password or VaultSessionManager.get_password(vault_token)
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
            logger.error(f"[BankSync] Erreur durant le flux de sync {conn_id} : {e}")
            if worker_conn:
                worker_conn.last_sync_status = "error"
                worker_conn.last_error = str(e)
                worker_db.commit()
            sse_callback("error", {"message": str(e)})
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

