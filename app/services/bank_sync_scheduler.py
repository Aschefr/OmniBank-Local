"""
OmniBank-Local — Planificateur d'arrière-plan pour la Synchronisation Bancaire.
Gère les relevés automatiques programmés (quand le coffre est déverrouillé en mémoire),
la détection proactive des rapprochements, l'alimentation du sas d'attente (Pending Sync)
et l'émission de notifications in-app.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import BankConnection, GlobalConfig, Notification, Transaction
from app.services.bank_sync_service import BankSyncService
from app.services.credential_vault import CredentialVault, VaultSessionManager
from app.services.history_service import record_action, snapshot_entity
from app.services import stats_cache

logger = logging.getLogger(__name__)

# Cache en mémoire des opérations détectées en attente
# Structure: { conn_id: { "updated_at": float, "accounts": [...], "matches_count": int, "new_count": int } }
_PENDING_SYNC_DATA: Dict[int, Dict[str, Any]] = {}
_SCHEDULER_RUNNING = False


def _get_config_value(db: Session, key: str, default: str = "") -> str:
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    return cfg.value if cfg else default


def _set_config_value(db: Session, key: str, value: str):
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    if cfg:
        cfg.value = value
    else:
        db.add(GlobalConfig(key=key, value=value))
    db.commit()


def get_all_pending_sync(db: Session) -> Dict[str, Any]:
    """
    Retourne la liste globale des opérations en attente (rapprochements détectés + nouvelles opérations).
    Ré-évalue dynamiquement les rapprochements contre la base de données actuelle pour garantir
    l'exactitude (ex: détection des virements internes miroirs, opérations pointées manuellement).
    """
    global _PENDING_SYNC_DATA
    from app.routers.csv_parser import check_reconciliation
    from datetime import date
    total_matches = 0
    total_new = 0
    accounts_list = []
    matches_by_tx_id = {}  # db_tx_id -> matched pending item
    matched_ids_global = set()

    # Récupérer aussi depuis global_config au démarrage si le cache RAM est vide
    if not _PENDING_SYNC_DATA:
        raw = _get_config_value(db, "bank_pending_sync_cache", "")
        if raw:
            try:
                cached = json.loads(raw)
                for k, v in cached.items():
                    _PENDING_SYNC_DATA[int(k)] = v
            except Exception:
                pass

    for conn_id, data in _PENDING_SYNC_DATA.items():
        conn = db.query(BankConnection).filter(BankConnection.id == conn_id).first()
        conn_label = conn.label if conn else f"Banque #{conn_id}"

        for acc in data.get("accounts", []):
            acc_copy = dict(acc)
            acc_copy["connection_id"] = conn_id
            acc_copy["connection_label"] = conn_label
            local_acc_id = acc.get("account_id")

            re_evaluated_txs = []
            for tx in acc.get("transactions", []):
                tx_copy = dict(tx)
                tx_date_str = tx.get("date_operation")
                raw_amount = tx.get("raw_amount")
                if tx_date_str and raw_amount is not None and local_acc_id:
                    try:
                        tx_date = date.fromisoformat(tx_date_str)
                        rec_info = check_reconciliation(
                            db,
                            tx_date,
                            raw_amount,
                            matched_ids=matched_ids_global,
                            account_id=local_acc_id
                        )
                        if rec_info:
                            tx_copy["is_reconciled"] = True
                            tx_copy["already_reconciled"] = rec_info.get("already_reconciled", False)
                            tx_copy["is_mirror_transfer"] = rec_info.get("is_mirror_transfer", False)
                            tx_copy["matched_db_id"] = rec_info.get("id")
                            tx_copy["db_description"] = rec_info.get("description")
                            if rec_info.get("id"):
                                matched_ids_global.add(rec_info.get("id"))
                        else:
                            tx_copy["is_reconciled"] = False
                            tx_copy["already_reconciled"] = False
                            tx_copy["is_mirror_transfer"] = False
                            tx_copy["matched_db_id"] = None
                            tx_copy["db_description"] = None
                    except Exception as err:
                        logger.warning(f"[BankScheduler] Erreur re-matching pending tx: {err}")

                re_evaluated_txs.append(tx_copy)
                if tx_copy.get("is_reconciled") and not tx_copy.get("already_reconciled") and tx_copy.get("matched_db_id"):
                    total_matches += 1
                    matches_by_tx_id[tx_copy["matched_db_id"]] = {
                        **tx_copy,
                        "connection_id": conn_id,
                        "connection_label": conn_label
                    }
                elif not tx_copy.get("is_reconciled"):
                    total_new += 1

            acc_copy["transactions"] = re_evaluated_txs
            accounts_list.append(acc_copy)

    return {
        "total_matches": total_matches,
        "total_new": total_new,
        "accounts": accounts_list,
        "matches_by_tx_id": matches_by_tx_id,
        "vault_unlocked": VaultSessionManager.get_status().get("is_unlocked", False)
    }


def save_pending_sync_data(db: Session, conn_id: int, preview_data: Dict[str, Any]):
    """Enregistre le résultat de preview dans le sas d'attente (RAM + GlobalConfig)."""
    global _PENDING_SYNC_DATA
    _PENDING_SYNC_DATA[conn_id] = {
        "updated_at": time.time(),
        "accounts": preview_data.get("accounts", [])
    }
    try:
        serializable = {str(k): v for k, v in _PENDING_SYNC_DATA.items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable))
    except Exception as e:
        logger.warning(f"[BankScheduler] Erreur de sauvegarde du cache pending: {e}")


def clear_pending_sync_for_conn(db: Session, conn_id: int):
    """Purger les opérations en attente pour une connexion."""
    global _PENDING_SYNC_DATA
    _PENDING_SYNC_DATA.pop(conn_id, None)
    try:
        serializable = {str(k): v for k, v in _PENDING_SYNC_DATA.items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable))
    except Exception:
        pass


def execute_auto_sync_for_connection(db: Session, conn: BankConnection, master_password: str) -> Optional[Dict[str, Any]]:
    """Exécute un relevé silencieux en tâche de fond pour une connexion donnée."""
    logger.info(f"[BankScheduler] Lancement du relevé auto silencieux pour '{conn.label}' (id={conn.id})")
    try:
        preview = BankSyncService.fetch_preview_transactions(
            db=db,
            connection=conn,
            master_password=master_password,
            since_days=30
        )
        save_pending_sync_data(db, conn.id, preview)

        # Calculer le nombre de correspondances et nouvelles lignes
        matches = 0
        new_txs = 0
        for acc in preview.get("accounts", []):
            for tx in acc.get("transactions", []):
                if tx.get("is_reconciled") and not tx.get("already_reconciled") and tx.get("matched_db_id"):
                    matches += 1
                elif not tx.get("is_reconciled"):
                    new_txs += 1

        # Créer une notification in-app pour informer l'utilisateur du résultat
        if matches > 0 or new_txs > 0:
            notif_msg = []
            if matches > 0:
                notif_msg.append(f"{matches} opération(s) prête(s) à pointer")
            if new_txs > 0:
                notif_msg.append(f"{new_txs} nouvelle(s) opération(s)")

            full_content = f"Relevé pour {conn.label} terminé : " + ", ".join(notif_msg) + "."
            notif = Notification(
                type="bank_sync",
                title=f"🏦 Synchronisation {conn.label}",
                content=full_content,
                link_data=json.dumps({"view": "accounts", "action": "open_pending", "conn_id": conn.id}),
                is_read=False,
                created_at=datetime.now(timezone.utc)
            )
            db.add(notif)
        else:
            notif = Notification(
                type="bank_sync",
                title=f"🏦 Relevé {conn.label} : À jour",
                content=f"Relevé terminé pour {conn.label} : aucun nouveau mouvement bancaire détecté.",
                link_data=json.dumps({"view": "accounts", "action": "bank_sync", "conn_id": conn.id}),
                is_read=False,
                created_at=datetime.now(timezone.utc)
            )
            db.add(notif)

        conn.last_sync_at = datetime.now(timezone.utc)
        conn.last_sync_status = "auto_checked"
        conn.last_sync_count = matches + new_txs
        conn.last_error = None
        db.commit()
        logger.info(f"[BankScheduler] Relevé terminé pour '{conn.label}' : {matches} rapprochements, {new_txs} nouvelles")
        return preview
    except Exception as e:
        err_msg = str(e)
        logger.warning(f"[BankScheduler] Échec du relevé auto pour '{conn.label}' : {err_msg}")
        conn.last_sync_status = "auto_error"
        conn.last_error = err_msg

        # Créer une notification in-app d'erreur
        try:
            notif = Notification(
                type="bank_sync_error",
                title=f"⚠️ Échec relevé {conn.label}",
                content=f"Erreur lors du relevé bancaire de {conn.label} : {err_msg}",
                link_data=json.dumps({"view": "accounts", "action": "bank_sync", "conn_id": conn.id}),
                is_read=False,
                created_at=datetime.now(timezone.utc)
            )
            db.add(notif)
        except Exception as notif_err:
            logger.warning(f"[BankScheduler] Erreur création notification d'échec : {notif_err}")

        db.commit()
        return None


async def bank_sync_scheduler_loop():
    """
    Boucle principale du planificateur de synchronisation bancaire.
    Vérifie toutes les 60 secondes si des connexions doivent être interrogées.
    """
    global _SCHEDULER_RUNNING
    if _SCHEDULER_RUNNING:
        return
    _SCHEDULER_RUNNING = True
    logger.info("[BankScheduler] Service de synchronisation automatique démarré")

    # Attendre 15 secondes après le boot pour laisser le serveur s'initialiser
    await asyncio.sleep(15)

    while True:
        try:
            db = SessionLocal()
            try:
                # 1. Vérifier si l'auto-sync est activé globalement
                enabled_str = _get_config_value(db, "bank_auto_sync_enabled", "false")
                if enabled_str == "true":
                    interval_hours = int(_get_config_value(db, "bank_auto_sync_interval_hours", "24"))

                    # 2. Vérifier si le coffre est déverrouillé en mémoire
                    master_password = VaultSessionManager.get_password()
                    if master_password:
                        # Le coffre est déverrouillé, on peut inspecter les connexions
                        active_conns = db.query(BankConnection).filter(
                            BankConnection.is_active == True
                        ).all()

                        now = datetime.now(timezone.utc)
                        for conn in active_conns:
                            # Vérifier si le délai est dépassé
                            should_run = False
                            if not conn.last_sync_at:
                                should_run = True
                            else:
                                last_sync = conn.last_sync_at
                                if last_sync.tzinfo is None:
                                    last_sync = last_sync.replace(tzinfo=timezone.utc)
                                elapsed_hours = (now - last_sync).total_seconds() / 3600.0
                                if elapsed_hours >= interval_hours:
                                    should_run = True

                            if should_run:
                                loop = asyncio.get_running_loop()
                                await loop.run_in_executor(
                                    None,
                                    execute_auto_sync_for_connection,
                                    db,
                                    conn,
                                    master_password
                                )
                                # Petite pause entre les connexions pour ne pas saturer
                                await asyncio.sleep(5)
                    else:
                        logger.debug("[BankScheduler] Coffre verrouillé : synchronisation automatique en attente")
            finally:
                db.close()
        except asyncio.CancelledError:
            logger.info("[BankScheduler] Arrêt du scheduler demandé")
            break
        except Exception as e:
            logger.error(f"[BankScheduler] Erreur boucle scheduler : {e}")

        await asyncio.sleep(60)


def trigger_manual_auto_sync(master_password: Optional[str] = None, vault_token: Optional[str] = None) -> Dict[str, Any]:
    """
    Déclenche immédiatement un relevé automatique en arrière-plan pour toutes les connexions actives.
    """
    pw = master_password or (VaultSessionManager.get_password(vault_token) if vault_token else None) or VaultSessionManager.get_password()
    if not pw:
        return {
            "ok": False,
            "detail": "Coffre-fort verrouillé. Veuillez d'abord déverrouiller le coffre pour lancer le relevé."
        }

    def _worker():
        import time
        worker_db = SessionLocal()
        try:
            active_conns = worker_db.query(BankConnection).filter(
                BankConnection.is_active == True
            ).all()
            logger.info(f"[BankScheduler] Relevé manuel en arrière-plan démarré pour {len(active_conns)} connexion(s)")
            for conn in active_conns:
                execute_auto_sync_for_connection(worker_db, conn, pw)
                time.sleep(2)
        except Exception as e:
            logger.error(f"[BankScheduler] Erreur lors du relevé manuel d'arrière-plan: {e}")
        finally:
            worker_db.close()

    import threading
    t = threading.Thread(target=_worker, daemon=True)
    t.start()

    return {
        "ok": True,
        "message": "Relevé automatique en arrière-plan démarré avec succès."
    }


def start_bank_sync_scheduler():
    """Lance la boucle scheduler de synchronisation bancaire en tâche de fond asyncio."""
    asyncio.create_task(bank_sync_scheduler_loop())
