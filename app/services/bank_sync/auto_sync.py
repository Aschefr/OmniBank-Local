"""
OmniBank-Local — Moteur d'Exécution et d'Orchestration des Relevés Bancaires Automatiques (Auto Sync).
Gère l'exécution silencieuse en tâche de fond (thread-safe, anti-collision),
le cooldown anti-spam persistant (3h), la détection 2FA et l'émission
de notifications in-app enrichies.
"""

import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from sqlalchemy.orm import Session

from app.models import BankConnection, Notification
from app.services.bank_sync_service import BankSyncService
from app.services.credential_vault import VaultSessionManager
from app.services.bank_sync.pending_store import (
    _PENDING_SYNC_DATA,
    _get_config_value,
    _resolve_profile_id,
    _set_config_value,
    save_pending_sync_data,
)

logger = logging.getLogger(__name__)

TRIGGER_SOURCE_LABELS = {
    "vault_unlock": "au déverrouillage du coffre",
    "scheduled": "planification automatique",
    "manual": "action manuelle",
    "test": "test automatisé"
}

AUTO_SYNC_COOLDOWN_SECONDS = 3 * 3600  # 3 heures de cooldown anti-spam

_ACTIVE_BACKGROUND_THREADS: Dict[str, threading.Thread] = {}


def get_auto_sync_cooldown_status(db: Session, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Retourne l'état du cooldown anti-spam persistant pour un profil donné."""
    pid = _resolve_profile_id(profile_id)
    last_attempt_str = _get_config_value(db, "last_auto_sync_attempt", "")
    if not last_attempt_str:
        return {
            "cooldown_active": False,
            "last_attempt_iso": None,
            "elapsed_seconds": None,
            "remaining_seconds": 0
        }
    try:
        last_attempt = datetime.fromisoformat(last_attempt_str)
        if last_attempt.tzinfo is None:
            last_attempt = last_attempt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        elapsed = int((now - last_attempt).total_seconds())
        remaining = max(0, AUTO_SYNC_COOLDOWN_SECONDS - elapsed)
        return {
            "cooldown_active": remaining > 0,
            "last_attempt_iso": last_attempt_str,
            "elapsed_seconds": elapsed,
            "remaining_seconds": remaining
        }
    except Exception as e:
        logger.warning(f"[BankAutoSync] Erreur parsing last_auto_sync_attempt ('{last_attempt_str}'): {e}")
        return {
            "cooldown_active": False,
            "last_attempt_iso": None,
            "elapsed_seconds": None,
            "remaining_seconds": 0
        }


def is_background_sync_running(profile_id: Optional[str] = None) -> bool:
    """Retourne True si un relevé en arrière-plan est actuellement en cours d'exécution."""
    pid = _resolve_profile_id(profile_id)
    t = _ACTIVE_BACKGROUND_THREADS.get(pid)
    return bool(t and t.is_alive())


def execute_auto_sync_for_connection(
    db: Session,
    conn: BankConnection,
    master_password: str,
    profile_id: Optional[str] = None,
    trigger_source: str = "scheduled"
) -> Optional[Dict[str, Any]]:
    """Exécute un relevé silencieux en tâche de fond pour une connexion donnée."""
    pid = _resolve_profile_id(profile_id)
    trigger_desc = TRIGGER_SOURCE_LABELS.get(trigger_source, trigger_source)
    logger.info(f"[BankAutoSync] Lancement du relevé auto ({trigger_desc}) pour '{conn.label}' (id={conn.id}, profil={pid})")
    try:
        preview = BankSyncService.fetch_preview_transactions(
            db=db,
            connection=conn,
            master_password=master_password,
            since_days=30
        )
        from app.services.autopilot_service import process_incoming_batch, is_autopilot_enabled

        autopilot_active = is_autopilot_enabled(db)
        auto_res = {}
        if autopilot_active:
            auto_res = process_incoming_batch(db, conn.id, preview, profile_id=pid)
        else:
            save_pending_sync_data(db, conn.id, preview, profile_id=pid)

        # Calculer le nombre de correspondances (confirmées / en attente) et nouvelles lignes
        matches = 0
        coming_matches = 0
        new_txs = 0
        auto_reconciled = auto_res.get("auto_reconciled", 0) if autopilot_active else 0

        pending_entry = _PENDING_SYNC_DATA.get(pid, {}).get(conn.id, {}) if autopilot_active else preview
        for acc in pending_entry.get("accounts", []):
            for tx in acc.get("transactions", []):
                if tx.get("is_reconciled") and not tx.get("already_reconciled") and tx.get("matched_db_id"):
                    if tx.get("is_coming"):
                        coming_matches += 1
                    else:
                        matches += 1
                elif tx.get("is_coming") and not tx.get("is_reconciled") and not tx.get("is_dismissed") and not tx.get("is_auto_dismissed") and not tx.get("_excluded"):
                    coming_matches += 1
                elif not tx.get("is_reconciled") and not tx.get("is_dismissed") and not tx.get("is_auto_dismissed") and not tx.get("_excluded"):
                    new_txs += 1

        # Créer une notification in-app pour informer l'utilisateur du résultat
        if auto_reconciled > 0 or matches > 0 or coming_matches > 0 or new_txs > 0:
            notif_msg = []
            if auto_reconciled == 1:
                notif_msg.append("🤖 1 opération rapprochée automatiquement")
            elif auto_reconciled > 1:
                notif_msg.append(f"🤖 {auto_reconciled} opérations rapprochées automatiquement")
            if matches == 1:
                notif_msg.append("1 opération à rapprocher")
            elif matches > 1:
                notif_msg.append(f"{matches} opérations à rapprocher")
            if coming_matches == 1:
                notif_msg.append("1 opération en attente")
            elif coming_matches > 1:
                notif_msg.append(f"{coming_matches} opérations en attente")
            if new_txs == 1:
                notif_msg.append("1 nouvelle opération")
            elif new_txs > 1:
                notif_msg.append(f"{new_txs} nouvelles opérations")

            full_content = f"{conn.label} : " + ", ".join(notif_msg) + "."
            notif = Notification(
                type="bank_sync",
                title=f"🏦 Synchronisation {conn.label}",
                content=full_content,
                link_data=json.dumps({
                    "view": "accounts",
                    "action": "open_pending",
                    "conn_id": conn.id,
                    "conn_label": conn.label,
                    "matches": matches,
                    "coming": coming_matches,
                    "new_txs": new_txs
                }),
                is_read=False,
                created_at=datetime.now(timezone.utc)
            )
            db.add(notif)
        else:
            notif = Notification(
                type="bank_sync",
                title=f"🏦 Relevé {conn.label} : À jour",
                content=f"Relevé terminé pour {conn.label} : vos comptes sont à jour (aucun nouveau mouvement).",
                link_data=json.dumps({
                    "view": "accounts",
                    "action": "bank_sync",
                    "conn_id": conn.id,
                    "conn_label": conn.label,
                    "matches": 0,
                    "new_txs": 0
                }),
                is_read=False,
                created_at=datetime.now(timezone.utc)
            )
            db.add(notif)

        conn.last_sync_at = datetime.now(timezone.utc)
        conn.last_sync_status = "auto_checked"
        conn.last_sync_count = matches + new_txs
        conn.last_error = None
        # Archiver automatiquement les notifications d'erreur précédentes pour cette connexion
        db.query(Notification).filter(
            Notification.type == "bank_sync_error",
            Notification.link_data.like(f'%"conn_id": {conn.id}%')
        ).update({"is_read": True, "is_archived": True}, synchronize_session=False)
        db.commit()
        logger.info(f"[BankAutoSync] Relevé terminé pour '{conn.label}' : {matches} rapprochements, {new_txs} nouvelles (profil={pid})")
        return preview
    except Exception as e:
        from app.services.bank_sync_service import clean_error_message

        raw_err = str(e)
        err_msg = clean_error_message(e)
        err_lower = raw_err.lower()
        exc_type = type(e).__name__
        is_2fa = (
            exc_type in ("NeedInteractiveFor2FA", "AppValidation")
            or "2fa" in err_lower
            or "authentification interactive" in err_lower
            or "authentification mobile" in err_lower
            or "validation mobile" in err_lower
            or "sca" in err_lower
            or "needinteractive" in err_lower
            or "appvalidation" in err_lower
        )

        if is_2fa:
            logger.info(f"[BankAutoSync] Authentification 2FA requise par la banque pour '{conn.label}' (profil={pid})")
            conn.last_sync_status = "2fa_required"
            conn.last_error = "Authentification 2FA requise par votre banque (validation sur smartphone)."
            conn.last_sync_at = datetime.now(timezone.utc)

            trigger_desc = TRIGGER_SOURCE_LABELS.get(trigger_source, trigger_source)
            notif_content = (
                f"Votre banque ({conn.label}) requiert une validation 2FA sur votre smartphone "
                f"pour synchroniser vos comptes (déclenché par : {trigger_desc})."
            )
            link_dict = {
                "view": "accounts",
                "action": "bank_sync_2fa",
                "conn_id": conn.id,
                "conn_label": conn.label,
                "trigger_source": trigger_source
            }

            # Notification informative 2FA avec dédoublonnage intelligent
            try:
                existing_2fa = db.query(Notification).filter(
                    Notification.type == "bank_sync_2fa",
                    Notification.is_read == False,
                    Notification.is_archived == False,
                    Notification.link_data.like(f'%"conn_id": {conn.id}%')
                ).first()

                if existing_2fa:
                    existing_2fa.content = notif_content
                    existing_2fa.created_at = datetime.now(timezone.utc)
                    existing_2fa.link_data = json.dumps(link_dict)
                else:
                    notif = Notification(
                        type="bank_sync_2fa",
                        title=f"🔐 Validation 2FA requise : {conn.label}",
                        content=notif_content,
                        link_data=json.dumps(link_dict),
                        is_read=False,
                        created_at=datetime.now(timezone.utc)
                    )
                    db.add(notif)
            except Exception as notif_err:
                logger.warning(f"[BankAutoSync] Erreur création notification 2FA : {notif_err}")
        else:
            from app.services.diagnostic_service import record_backend_exception

            logger.warning(f"[BankAutoSync] Échec du relevé auto pour '{conn.label}' (profil={pid}) : {raw_err}")
            record_backend_exception(e, context=f"BankScheduler relevé auto '{conn.label}' ({conn.backend})")

            conn.last_sync_status = "auto_error"
            conn.last_error = err_msg
            conn.last_sync_at = datetime.now(timezone.utc)

            trigger_desc = TRIGGER_SOURCE_LABELS.get(trigger_source, trigger_source)
            notif_content = f"Erreur lors du relevé bancaire de {conn.label} (déclenché par : {trigger_desc}) : {err_msg}"
            is_vault_err = any(k in err_lower for k in ("mot de passe", "password", "coffre", "vault", "identifiant", "verrouill"))
            link_dict = {
                "view": "accounts",
                "action": "unlock_vault" if is_vault_err else "bank_sync_error",
                "conn_id": conn.id,
                "conn_label": conn.label,
                "error": err_msg,
                "trigger_source": trigger_source
            }

            # Créer ou mettre à jour la notification in-app d'erreur (dédoublonnage intelligent)
            try:
                existing_err = db.query(Notification).filter(
                    Notification.type == "bank_sync_error",
                    Notification.is_read == False,
                    Notification.is_archived == False,
                    Notification.link_data.like(f'%"conn_id": {conn.id}%')
                ).first()

                if existing_err:
                    existing_err.content = notif_content
                    existing_err.created_at = datetime.now(timezone.utc)
                    existing_err.link_data = json.dumps(link_dict)
                else:
                    notif = Notification(
                        type="bank_sync_error",
                        title=f"⚠️ Échec relevé {conn.label}",
                        content=notif_content,
                        link_data=json.dumps(link_dict),
                        is_read=False,
                        created_at=datetime.now(timezone.utc)
                    )
                    db.add(notif)
            except Exception as notif_err:
                logger.warning(f"[BankAutoSync] Erreur création notification d'échec : {notif_err}")

        db.commit()
        return None


def trigger_manual_auto_sync(
    master_password: Optional[str] = None,
    vault_token: Optional[str] = None,
    profile_id: Optional[str] = None,
    force: bool = False,
    db: Optional[Session] = None,
    trigger_source: str = "manual"
) -> Dict[str, Any]:
    """
    Déclenche un relevé automatique en arrière-plan pour toutes les connexions actives d'un profil.
    Si force=False, respecte le cooldown anti-spam persistant de 3h (GlobalConfig.last_auto_sync_attempt).
    """
    pid = _resolve_profile_id(profile_id)

    pw = master_password or (VaultSessionManager.get_password(vault_token, profile_id=pid) if vault_token else None) or VaultSessionManager.get_password(profile_id=pid)
    if not pw:
        return {
            "ok": False,
            "detail": "Coffre-fort verrouillé. Veuillez d'abord déverrouiller le coffre pour lancer le relevé."
        }

    from app.database import get_engine
    from sqlalchemy.orm import sessionmaker
    engine = get_engine(pid)
    SessionProf = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    # 1. Vérification du cooldown persistant (si non forcé)
    if not force:
        db_check = db or SessionProf()
        try:
            cooldown = get_auto_sync_cooldown_status(db_check, pid)
            if cooldown.get("cooldown_active"):
                remaining = cooldown.get("remaining_seconds", 0)
                rem_min = remaining // 60
                logger.info(f"[BankAutoSync] Relevé réactif ignoré par cooldown anti-spam (reste {rem_min} min, profil={pid})")
                return {
                    "ok": True,
                    "cooldown_active": True,
                    "remaining_seconds": remaining,
                    "elapsed_seconds": cooldown.get("elapsed_seconds"),
                    "message": f"Relevé récent effectué il y a moins de 3h. Prochain relevé auto disponible dans {rem_min} min."
                }
        finally:
            if not db:
                db_check.close()

    # 2. Verrou anti-concurrence : empêcher deux threads de relevé simultanés sur le même profil
    active_t = _ACTIVE_BACKGROUND_THREADS.get(pid)
    if active_t and active_t.is_alive():
        logger.info(f"[BankAutoSync] Relevé déjà en cours d'exécution pour le profil '{pid}', nouvel appel concurrent ignoré.")
        return {
            "ok": True,
            "already_running": True,
            "cooldown_active": False,
            "message": "Un relevé automatique est déjà en cours d'exécution pour ce profil."
        }

    # Mettre à jour immédiatement last_auto_sync_attempt pour bloquer tout appel concurrent
    now_iso = datetime.now(timezone.utc).isoformat()
    db_init = db or SessionProf()
    try:
        _set_config_value(db_init, "last_auto_sync_attempt", now_iso)
    finally:
        if not db:
            db_init.close()

    # 3. Isolation tests : en environnement pytest, neutraliser le thread réel pour éviter toute pollution
    if os.environ.get("PYTEST_CURRENT_TEST") and not os.environ.get("OMNIBANK_ENABLE_TEST_BACKGROUND_SYNC"):
        logger.info(f"[BankAutoSync] Environnement pytest actif : relevé d'arrière-plan neutralisé pour éviter la pollution.")
        return {
            "ok": True,
            "test_mode": True,
            "cooldown_active": False,
            "message": "Mode test actif : thread d'arrière-plan neutralisé."
        }

    def _worker():
        import time
        worker_db = SessionProf()
        try:
            active_conns = worker_db.query(BankConnection).filter(
                BankConnection.is_active == True
            ).all()
            logger.info(f"[BankAutoSync] Relevé en arrière-plan démarré pour {len(active_conns)} connexion(s) (profil={pid}, force={force}, source={trigger_source})")
            for conn in active_conns:
                execute_auto_sync_for_connection(worker_db, conn, pw, profile_id=pid, trigger_source=trigger_source)
                time.sleep(2)
        except Exception as e:
            logger.error(f"[BankAutoSync] Erreur lors du relevé d'arrière-plan (profil={pid}): {e}")
        finally:
            worker_db.close()

    t = threading.Thread(target=_worker, daemon=True)
    _ACTIVE_BACKGROUND_THREADS[pid] = t
    t.start()

    return {
        "ok": True,
        "cooldown_active": False,
        "message": "Relevé automatique en arrière-plan démarré avec succès."
    }
