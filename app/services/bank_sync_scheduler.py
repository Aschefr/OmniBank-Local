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
# Structure: { profile_id: { conn_id: { "updated_at": float, "accounts": [...], "matches_count": int, "new_count": int } } }
_PENDING_SYNC_DATA: Dict[str, Dict[int, Dict[str, Any]]] = {}
_SCHEDULER_RUNNING = False


def _resolve_profile_id(profile_id: Optional[str] = None) -> str:
    if profile_id:
        return profile_id
    try:
        from app.profile_manager import get_active_profile
        return get_active_profile().get("id", "default")
    except Exception:
        return "default"


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


def clear_pending_sync_for_connection(db: Session, conn_id: int, profile_id: Optional[str] = None):
    """Purge le sas d'opérations en attente pour une connexion spécifique d'un profil."""
    global _PENDING_SYNC_DATA
    pid = _resolve_profile_id(profile_id)
    if pid in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid].pop(conn_id, None)
        if _PENDING_SYNC_DATA[pid]:
            _set_config_value(db, "bank_pending_sync_cache", json.dumps(_PENDING_SYNC_DATA[pid]))
        else:
            _set_config_value(db, "bank_pending_sync_cache", "")
    logger.info(f"[BankSyncScheduler] Sas de synchronisation purgé pour la connexion #{conn_id} (profil={pid})")


def clear_all_pending_sync(db: Session, profile_id: Optional[str] = None):
    """Purge l'intégralité du sas d'opérations en attente d'un profil."""
    global _PENDING_SYNC_DATA
    pid = _resolve_profile_id(profile_id)
    if pid in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid].clear()
    _set_config_value(db, "bank_pending_sync_cache", "")
    logger.info(f"[BankSyncScheduler] Intégralité du sas de synchronisation purgé pour profil={pid}.")


def dismiss_pending_transaction(db: Session, csv_id: str, profile_id: Optional[str] = None) -> bool:
    """Retire une opération spécifique du sas d'attente à partir de son csv_id."""
    global _PENDING_SYNC_DATA
    pid = _resolve_profile_id(profile_id)
    found = False
    prof_data = _PENDING_SYNC_DATA.get(pid, {})
    for conn_id, data in list(prof_data.items()):
        for acc in data.get("accounts", []):
            initial_len = len(acc.get("transactions", []))
            acc["transactions"] = [tx for tx in acc.get("transactions", []) if tx.get("csv_id") != csv_id]
            if len(acc.get("transactions", [])) < initial_len:
                found = True
    if found:
        serializable = {str(k): v for k, v in prof_data.items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable) if prof_data else "")
        logger.info(f"[BankSyncScheduler] Opération en attente #{csv_id} ignorée et retirée du sas (profil={pid}).")
    return found


def remove_committed_from_pending(db: Session, csv_ids: List[str], profile_id: Optional[str] = None):
    """Purge une liste de transactions (par csv_id) du sas d'attente."""
    global _PENDING_SYNC_DATA
    if not csv_ids:
        return
    pid = _resolve_profile_id(profile_id)
    prof_data = _PENDING_SYNC_DATA.get(pid, {})
    csv_set = set(csv_ids)
    changed = False
    for conn_id, data in list(prof_data.items()):
        for acc in data.get("accounts", []):
            initial_len = len(acc.get("transactions", []))
            acc["transactions"] = [tx for tx in acc.get("transactions", []) if tx.get("csv_id") not in csv_set]
            if len(acc.get("transactions", [])) < initial_len:
                changed = True
    if changed:
        serializable = {str(k): v for k, v in prof_data.items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable) if prof_data else "")
        logger.info(f"[BankSyncScheduler] {len(csv_ids)} opération(s) purgée(s) du sas d'attente (profil={pid}).")



def get_all_pending_sync(db: Session, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Retourne la liste globale des opérations en attente (rapprochements détectés + nouvelles opérations).
    Ré-évalue dynamiquement les rapprochements contre la base de données actuelle pour garantir
    l'exactitude (ex: détection des virements internes miroirs, opérations pointées manuellement).
    Purgera automatiquement toute donnée résiduelle si la connexion n'existe plus dans la base.
    """
    global _PENDING_SYNC_DATA
    from app.routers.csv_parser import check_reconciliation
    from datetime import date
    pid = _resolve_profile_id(profile_id)
    total_matches = 0
    total_new = 0
    accounts_list = []
    matches_by_tx_id = {}  # db_tx_id -> matched pending item
    matched_ids_global = set()

    # Vérifier l'existence de connexions valides
    valid_conns = db.query(BankConnection).all()
    valid_conn_map = {c.id: c.label for c in valid_conns}

    if pid not in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid] = {}

    prof_data = _PENDING_SYNC_DATA[pid]

    if not valid_conn_map:
        # Aucune connexion bancaire configurée -> Purge absolue
        prof_data.clear()
        _set_config_value(db, "bank_pending_sync_cache", "")
        return {
            "total_matches": 0,
            "total_new": 0,
            "accounts": [],
            "matches_by_tx_id": {},
            "vault_unlocked": VaultSessionManager.get_status(profile_id=pid).get("is_unlocked", False)
        }

    # Récupérer aussi depuis global_config au démarrage si le cache RAM de ce profil est vide
    if not prof_data:
        raw = _get_config_value(db, "bank_pending_sync_cache", "")
        if raw:
            try:
                cached = json.loads(raw)
                for k, v in cached.items():
                    prof_data[int(k)] = v
            except Exception:
                pass

    # Purger immédiatement les conn_id orphelines qui n'existent plus
    orphan_ids = [cid for cid in list(prof_data.keys()) if cid not in valid_conn_map]
    if orphan_ids:
        for oid in orphan_ids:
            prof_data.pop(oid, None)
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(prof_data) if prof_data else "")

    for conn_id, data in list(prof_data.items()):
        conn_label = valid_conn_map.get(conn_id, f"Banque #{conn_id}")

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
        "vault_unlocked": VaultSessionManager.get_status(profile_id=pid).get("is_unlocked", False)
    }


def save_pending_sync_data(db: Session, conn_id: int, preview_data: Dict[str, Any], profile_id: Optional[str] = None):
    """Enregistre le résultat de preview dans le sas d'attente (RAM + GlobalConfig) pour le profil."""
    global _PENDING_SYNC_DATA
    pid = _resolve_profile_id(profile_id)
    if pid not in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid] = {}

    _PENDING_SYNC_DATA[pid][conn_id] = {
        "updated_at": time.time(),
        "accounts": preview_data.get("accounts", [])
    }
    try:
        serializable = {str(k): v for k, v in _PENDING_SYNC_DATA[pid].items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable))
    except Exception as e:
        logger.warning(f"[BankScheduler] Erreur de sauvegarde du cache pending: {e}")


def clear_pending_sync_for_conn(db: Session, conn_id: int, profile_id: Optional[str] = None):
    """Purger les opérations en attente pour une connexion."""
    clear_pending_sync_for_connection(db, conn_id, profile_id)


def execute_auto_sync_for_connection(db: Session, conn: BankConnection, master_password: str, profile_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Exécute un relevé silencieux en tâche de fond pour une connexion donnée."""
    pid = _resolve_profile_id(profile_id)
    logger.info(f"[BankScheduler] Lancement du relevé auto silencieux pour '{conn.label}' (id={conn.id}, profil={pid})")
    try:
        preview = BankSyncService.fetch_preview_transactions(
            db=db,
            connection=conn,
            master_password=master_password,
            since_days=30
        )
        save_pending_sync_data(db, conn.id, preview, profile_id=pid)

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
                link_data=json.dumps({
                    "view": "accounts",
                    "action": "open_pending",
                    "conn_id": conn.id,
                    "conn_label": conn.label,
                    "matches": matches,
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
                content=f"Relevé terminé pour {conn.label} : aucun nouveau mouvement bancaire détecté.",
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
        db.commit()
        logger.info(f"[BankScheduler] Relevé terminé pour '{conn.label}' : {matches} rapprochements, {new_txs} nouvelles (profil={pid})")
        return preview
    except Exception as e:
        err_msg = str(e)
        logger.warning(f"[BankScheduler] Échec du relevé auto pour '{conn.label}' (profil={pid}) : {err_msg}")
        conn.last_sync_status = "auto_error"
        conn.last_error = err_msg
        conn.last_sync_at = datetime.now(timezone.utc)

        # Créer une notification in-app d'erreur
        try:
            notif = Notification(
                type="bank_sync_error",
                title=f"⚠️ Échec relevé {conn.label}",
                content=f"Erreur lors du relevé bancaire de {conn.label} : {err_msg}",
                link_data=json.dumps({
                    "view": "accounts",
                    "action": "bank_sync",
                    "conn_id": conn.id,
                    "conn_label": conn.label,
                    "error": err_msg
                }),
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
    Vérifie toutes les 60 secondes l'ensemble des profils et interroge les connexions
    dont le coffre est déverrouillé en mémoire pour chaque profil respectif.
    """
    global _SCHEDULER_RUNNING
    if _SCHEDULER_RUNNING:
        return
    _SCHEDULER_RUNNING = True
    logger.info("[BankScheduler] Service de synchronisation automatique multi-profil démarré")

    # Attendre 15 secondes après le boot pour laisser le serveur s'initialiser
    await asyncio.sleep(15)

    while True:
        try:
            from app.profile_manager import load_profiles_data
            from app.database import get_engine
            from sqlalchemy.orm import sessionmaker

            p_data = load_profiles_data()
            profiles_list = p_data.get("profiles", [])

            for prof in profiles_list:
                pid = prof["id"]
                try:
                    engine = get_engine(pid)
                    SessionProf = sessionmaker(autocommit=False, autoflush=False, bind=engine)
                    db = SessionProf()
                    try:
                        # 1. Vérifier si l'auto-sync est activé pour ce profil
                        enabled_str = _get_config_value(db, "bank_auto_sync_enabled", "false")
                        if enabled_str == "true":
                            interval_hours = int(_get_config_value(db, "bank_auto_sync_interval_hours", "24") or 24)

                            # 2. Vérifier si le coffre de ce profil spécifique est déverrouillé en mémoire
                            master_password = VaultSessionManager.get_password(profile_id=pid)
                            if master_password:
                                active_conns = db.query(BankConnection).filter(
                                    BankConnection.is_active == True
                                ).all()

                                now = datetime.now(timezone.utc)
                                for conn in active_conns:
                                    # Ne pas exécuter si aucun compte n'est encore mappé
                                    if not conn.account_mapping or conn.account_mapping.strip() in ("", "{}", "null"):
                                        continue

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
                                            master_password,
                                            pid
                                        )
                                        await asyncio.sleep(5)
                            else:
                                logger.debug(f"[BankScheduler] Coffre verrouillé pour le profil '{pid}' : sync auto en attente")
                    finally:
                        db.close()
                except Exception as p_err:
                    logger.warning(f"[BankScheduler] Erreur inspection profil '{pid}': {p_err}")

        except asyncio.CancelledError:
            logger.info("[BankScheduler] Arrêt du scheduler demandé")
            break
        except Exception as e:
            logger.error(f"[BankScheduler] Erreur boucle scheduler : {e}")

        await asyncio.sleep(60)


def trigger_manual_auto_sync(
    master_password: Optional[str] = None,
    vault_token: Optional[str] = None,
    profile_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Déclenche immédiatement un relevé automatique en arrière-plan pour toutes les connexions actives d'un profil.
    """
    pid = _resolve_profile_id(profile_id)
    pw = master_password or (VaultSessionManager.get_password(vault_token, profile_id=pid) if vault_token else None) or VaultSessionManager.get_password(profile_id=pid)
    if not pw:
        return {
            "ok": False,
            "detail": "Coffre-fort verrouillé. Veuillez d'abord déverrouiller le coffre pour lancer le relevé."
        }

    def _worker():
        import time
        from app.database import get_engine
        from sqlalchemy.orm import sessionmaker
        engine = get_engine(pid)
        SessionProf = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        worker_db = SessionProf()
        try:
            active_conns = worker_db.query(BankConnection).filter(
                BankConnection.is_active == True
            ).all()
            logger.info(f"[BankScheduler] Relevé manuel en arrière-plan démarré pour {len(active_conns)} connexion(s) (profil={pid})")
            for conn in active_conns:
                execute_auto_sync_for_connection(worker_db, conn, pw, profile_id=pid)
                time.sleep(2)
        except Exception as e:
            logger.error(f"[BankScheduler] Erreur lors du relevé manuel d'arrière-plan (profil={pid}): {e}")
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

