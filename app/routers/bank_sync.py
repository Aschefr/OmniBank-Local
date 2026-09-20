"""
OmniBank-Local — API Router pour la Synchronisation Bancaire (Woob).
Fournit les endpoints REST et les flux SSE pour la gestion des connexions,
le test interactif, le mapping de comptes et la synchronisation sécurisée.
"""

import asyncio
from datetime import date, datetime, timezone
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
        raise HTTPException(status_code=401, detail="Coffre-fort verrouillé : veuillez déverrouiller votre coffre.")

    if not CredentialVault.has_credentials(db, conn.id):
        raise HTTPException(status_code=404, detail="Aucun identifiant configuré pour cette connexion bancaire.")

    creds = CredentialVault.retrieve_credentials(db, conn.id, pw)
    if not creds:
        raise HTTPException(status_code=401, detail="Mot de passe maître incorrect : impossible de déchiffrer les identifiants.")

    try:
        accounts = BankSyncService.test_connection_and_list_accounts(
            backend_name=conn.backend,
            credentials=creds,
        )
        conn.last_error = None
        conn.last_sync_at = datetime.now(timezone.utc)
        conn.last_sync_status = "success"
        from app.models import Notification
        db.query(Notification).filter(
            Notification.type.in_(["bank_sync_error", "bank_sync_2fa"]),
            Notification.link_data.like(f'%"conn_id": {conn.id}%')
        ).update({"is_read": True, "is_archived": True}, synchronize_session=False)
        db.commit()
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
        raise HTTPException(status_code=401, detail="Coffre-fort verrouillé : veuillez déverrouiller votre coffre.")

    if not CredentialVault.has_credentials(db, conn.id):
        raise HTTPException(status_code=404, detail="Aucun identifiant configuré pour cette connexion bancaire.")

    creds = CredentialVault.retrieve_credentials(db, conn.id, pw)
    if not creds:
        raise HTTPException(status_code=401, detail="Mot de passe maître incorrect : impossible de déchiffrer les identifiants.")

    session_id = f"test_{conn_id}_{uuid.uuid4().hex[:8]}"
    event_queue: asyncio.Queue = asyncio.Queue()
    main_loop = asyncio.get_running_loop()
    register_2fa_session(session_id)

    def sse_callback(event_type: str, payload: Dict[str, Any]):
        data_str = json.dumps({"session_id": session_id, **payload})
        msg = f"event: {event_type}\ndata: {data_str}\n\n"
        main_loop.call_soon_threadsafe(event_queue.put_nowait, msg)

    from app.profile_manager import get_active_profile
    active_pid = get_active_profile()["id"]

    def test_worker():
        try:
            sse_callback("progress", {"step": "auth", "message": f"Connexion sécurisée à {conn.label or conn.backend}..."})
            accounts = BankSyncService.test_connection_and_list_accounts(
                backend_name=conn.backend,
                credentials=creds,
                session_id=session_id,
                event_callback=sse_callback
            )
            from app.database import get_engine
            from sqlalchemy.orm import sessionmaker
            from app.models import Notification
            eng = get_engine(active_pid)
            SessionProf = sessionmaker(autocommit=False, autoflush=False, bind=eng)
            worker_db = SessionProf()
            try:
                worker_conn = worker_db.query(BankConnection).filter(BankConnection.id == conn_id).first()
                if worker_conn:
                    worker_conn.last_error = None
                    worker_conn.last_sync_at = datetime.now(timezone.utc)
                    worker_conn.last_sync_status = "success"
                    worker_db.query(Notification).filter(
                        Notification.type.in_(["bank_sync_error", "bank_sync_2fa"]),
                        Notification.link_data.like(f'%"conn_id": {conn_id}%')
                    ).update({"is_read": True, "is_archived": True}, synchronize_session=False)
                    worker_db.commit()
            except Exception as w_err:
                logger.debug(f"[BankSync] Erreur mise à jour statut test SSE: {w_err}")
            finally:
                worker_db.close()
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
        conn.last_error = None
        conn.last_sync_status = "success"
        conn.last_sync_at = datetime.now(timezone.utc)
        from app.models import Notification
        db.query(Notification).filter(
            Notification.type.in_(["bank_sync_error", "bank_sync_2fa"]),
            Notification.link_data.like(f'%"conn_id": {conn.id}%')
        ).update({"is_read": True, "is_archived": True}, synchronize_session=False)
        db.commit()

        from app.services.bank_sync_scheduler import save_pending_sync_data
        save_pending_sync_data(db, conn.id, preview)
        return preview
    except Exception as e:
        err_msg = clean_error_message(e)
        logger.warning(f"[BankSync] Échec du preview pour connexion {conn_id} ({type(e).__name__}) : {err_msg}", exc_info=True)
        raise HTTPException(status_code=400, detail=err_msg)


@router.post("/connections/{conn_id}/commit")
def commit_reviewed_sync(conn_id: int, data: Dict[str, Any], request: Request, db: Session = Depends(get_db)):
    """Valide et enregistre en base les transactions revues par l'utilisateur."""
    txs = data.get("transactions", [])
    user_name = data.get("user_name") or request.headers.get("x-user-name")
    if user_name:
        from urllib.parse import unquote
        user_name = unquote(user_name)
    lang = data.get("lang") or request.headers.get("accept-language", "").split(",")[0][:2]
    try:
        res = BankSyncService.commit_reviewed_transactions(
            db=db,
            connection_id=conn_id,
            transactions_data=txs,
            user_name=user_name,
            lang=lang
        )
        if conn_id > 0:
            conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
            if conn:
                conn.last_error = None
                conn.last_sync_status = "success"
                conn.last_sync_at = datetime.now(timezone.utc)
                conn.last_sync_count = res.get("imported", 0) + res.get("reconciled", 0)
                from app.models import Notification
                db.query(Notification).filter(
                    Notification.type.in_(["bank_sync_error", "bank_sync_2fa"]),
                    Notification.link_data.like(f'%"conn_id": {conn_id}%')
                ).update({"is_read": True, "is_archived": True}, synchronize_session=False)
                db.commit()

        from app.services.bank_sync_scheduler import remove_committed_from_pending
        # Ne purger du sas que les opérations confirmées (les opérations en attente/à venir restent dans le sas)
        committed_csv_ids = [t.get("csv_id") for t in txs if t.get("csv_id") and not t.get("is_coming")]
        if committed_csv_ids:
            remove_committed_from_pending(db, committed_csv_ids)
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
        raise HTTPException(status_code=401, detail="Coffre-fort verrouillé : veuillez déverrouiller votre coffre.")

    session_id = f"sync_{conn_id}_{uuid.uuid4().hex[:8]}"
    event_queue: asyncio.Queue = asyncio.Queue()
    main_loop = asyncio.get_running_loop()
    register_2fa_session(session_id)

    def sse_callback(event_type: str, payload: Dict[str, Any]):
        data_str = json.dumps({"session_id": session_id, **payload})
        msg = f"event: {event_type}\ndata: {data_str}\n\n"
        # Envoi thread-safe dans la queue asyncio depuis le thread worker
        main_loop.call_soon_threadsafe(event_queue.put_nowait, msg)

    from app.profile_manager import get_active_profile
    active_pid = get_active_profile()["id"]

    # Lancement du worker de sync dans un thread séparé
    def sync_worker():
        from app.database import get_engine
        from sqlalchemy.orm import sessionmaker
        eng = get_engine(active_pid)
        SessionProf = sessionmaker(autocommit=False, autoflush=False, bind=eng)
        worker_db = SessionProf()
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
            if worker_conn:
                worker_conn.last_error = None
                worker_conn.last_sync_at = datetime.now(timezone.utc)
                worker_conn.last_sync_status = "success"
                from app.models import Notification
                worker_db.query(Notification).filter(
                    Notification.type.in_(["bank_sync_error", "bank_sync_2fa"]),
                    Notification.link_data.like(f'%"conn_id": {conn_id}%')
                ).update({"is_read": True, "is_archived": True}, synchronize_session=False)
                worker_db.commit()
        except Exception as e:
            err_msg = clean_error_message(e)
            logger.error(f"[BankSync] Erreur durant le flux de sync {conn_id} ({type(e).__name__}) : {err_msg}", exc_info=True)
            if worker_conn:
                worker_conn.last_sync_status = "error"
                worker_conn.last_error = err_msg
                try:
                    from app.models import Notification
                    existing_err = worker_db.query(Notification).filter(
                        Notification.type == "bank_sync_error",
                        Notification.is_read == False,
                        Notification.is_archived == False,
                        Notification.link_data.like(f'%"conn_id": {worker_conn.id}%')
                    ).first()

                    link_dict = {
                        "view": "accounts",
                        "action": "bank_sync_error",
                        "conn_id": worker_conn.id,
                        "conn_label": worker_conn.label,
                        "error": err_msg
                    }
                    notif_title = f"⚠️ Échec relevé {worker_conn.label}"
                    notif_content = f"Erreur lors du relevé bancaire de {worker_conn.label} : {err_msg}"

                    if existing_err:
                        existing_err.content = notif_content
                        existing_err.created_at = datetime.now(timezone.utc)
                        existing_err.link_data = json.dumps(link_dict)
                    else:
                        notif = Notification(
                            type="bank_sync_error",
                            title=notif_title,
                            content=notif_content,
                            link_data=json.dumps(link_dict),
                            is_read=False,
                            is_archived=False,
                            created_at=datetime.now(timezone.utc)
                        )
                        worker_db.add(notif)
                except Exception as notif_e:
                    logger.warning(f"[BankSync] Erreur création notification d'échec interactive : {notif_e}")
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

