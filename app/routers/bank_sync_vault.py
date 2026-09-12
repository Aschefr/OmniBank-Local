"""
OmniBank-Local — API Router pour le Coffre-fort Bancaire & Paramètres Auto-Sync.
Gère le déverrouillage sécurisé en mémoire (PBKDF2/Fernet), le statut de session,
le verrouillage, la réinitialisation du coffre et la configuration de la synchronisation automatique.
"""

import logging
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BankConnection, GlobalConfig, Notification
from app.profile_manager import get_active_profile
from app.schemas.bank_sync_schemas import VaultStatusOut, VaultUnlockRequest
from app.services.credential_vault import CredentialVault, VaultSessionManager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/bank-sync", tags=["bank-sync"])


@router.post("/vault/unlock", response_model=Dict[str, Any])
def unlock_vault(req: VaultUnlockRequest, db: Session = Depends(get_db)):
    """
    Déverrouille le coffre-fort en mémoire pour X jours pour le profil actif.
    Valide le mot de passe maître sur les connexions existantes.
    """
    active_pid = get_active_profile().get("id", "default")
    connections = db.query(BankConnection).filter(BankConnection.is_active == True).all()

    # Si des connexions existent, tester obligatoirement le mot de passe sur la première qui a des identifiants
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

    from app.services.bank_sync_scheduler import _get_config_value, trigger_manual_auto_sync

    db.query(Notification).filter(
        Notification.type == "bank_sync_error",
        (Notification.content.like("%mot de passe%") | Notification.content.like("%coffre%"))
    ).update({"is_read": True, "is_archived": True}, synchronize_session=False)
    db.commit()

    # Déclenchement réactif au déverrouillage si configuré (avec respect du cooldown anti-spam)
    reactive_sync = None
    sync_on_unlock = _get_config_value(db, "bank_sync_on_vault_unlock", "true").lower() == "true"
    if getattr(req, "skip_reactive_sync", False) or not sync_on_unlock:
        reactive_sync = {"ok": True, "skipped_passive_mode": True}
    elif connections:
        reactive_sync = trigger_manual_auto_sync(
            master_password=req.master_password,
            vault_token=token,
            profile_id=active_pid,
            force=False,
            db=db,
            trigger_source="vault_unlock"
        )

    return {
        "ok": True,
        "vault_token": token,
        "reactive_sync": reactive_sync,
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
    from app.services.bank_sync_scheduler import _get_config_value, get_auto_sync_cooldown_status
    active_pid = get_active_profile().get("id", "default")
    enabled = _get_config_value(db, "bank_auto_sync_enabled", "false").lower() == "true"
    interval = int(_get_config_value(db, "bank_auto_sync_interval_hours", "24") or 24)
    sync_on_unlock = _get_config_value(db, "bank_sync_on_vault_unlock", "true").lower() == "true"
    cooldown_info = get_auto_sync_cooldown_status(db, active_pid)
    return {
        "enabled": enabled,
        "interval_hours": interval,
        "sync_on_vault_unlock": sync_on_unlock,
        "vault_unlocked": VaultSessionManager.is_unlocked(profile_id=active_pid),
        **cooldown_info
    }


@router.post("/settings/auto-sync")
def update_auto_sync_settings(data: Dict[str, Any], db: Session = Depends(get_db)):
    """Met à jour les paramètres de synchronisation automatique."""
    from app.services.bank_sync_scheduler import _set_config_value
    if "enabled" in data:
        _set_config_value(db, "bank_auto_sync_enabled", "true" if data["enabled"] else "false")
    if "interval_hours" in data:
        _set_config_value(db, "bank_auto_sync_interval_hours", str(int(data["interval_hours"])))
    if "sync_on_vault_unlock" in data:
        _set_config_value(db, "bank_sync_on_vault_unlock", "true" if data["sync_on_vault_unlock"] else "false")
    return {"ok": True}


@router.post("/trigger-auto-sync")
def run_manual_auto_sync(data: Optional[Dict[str, Any]] = None, db: Session = Depends(get_db)):
    """Déclenche un relevé automatique en arrière-plan."""
    from app.services.bank_sync_scheduler import trigger_manual_auto_sync
    active_pid = get_active_profile().get("id", "default")
    master_password = data.get("master_password") if data else None
    vault_token = data.get("vault_token") if data else None
    force = bool(data.get("force", False)) if data else False
    trigger_source = data.get("trigger_source", "manual") if data else "manual"
    res = trigger_manual_auto_sync(
        master_password=master_password,
        vault_token=vault_token,
        profile_id=active_pid,
        force=force,
        db=db,
        trigger_source=trigger_source
    )
    if not res.get("ok"):
        status_code = 401 if "verrouill" in res.get("detail", "").lower() else 400
        raise HTTPException(
            status_code=status_code,
            detail=res.get("detail", "Coffre verrouillé")
        )
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
