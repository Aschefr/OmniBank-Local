"""
OmniBank-Local — Planificateur d'arrière-plan pour la Synchronisation Bancaire.
Façade de rétrocompatibilité et orchestrateur de la boucle planifiée asyncio.
Les composants modulaires sont situés dans app.services.bank_sync.* :
  - app.services.bank_sync.pending_store : Sas d'attente, cache RAM & GlobalConfig
  - app.services.bank_sync.auto_sync : Relevé automatique, cooldown 3h & threads
"""

import asyncio
import logging
from datetime import datetime, timezone

from app.models import BankConnection
from app.services.credential_vault import VaultSessionManager

# 1. Imports et re-exports du sas d'attente (pending_store)
from app.services.bank_sync.pending_store import (
    _PENDING_SYNC_DATA,
    CSV_IMPORT_CONN_ID,
    CSV_IMPORT_CONN_LABEL,
    _get_config_value,
    _matches_account,
    _resolve_profile_id,
    _set_config_value,
    add_dismissed_transaction,
    clear_all_pending_sync,
    clear_pending_sync_for_conn,
    clear_pending_sync_for_connection,
    dismiss_pending_transaction,
    get_all_pending_sync,
    get_dismissed_transactions,
    remove_committed_from_pending,
    remove_dismissed_transaction,
    save_pending_sync_data,
    save_last_statement_snapshot,
    get_last_statement_snapshot,
)

# 2. Imports et re-exports de l'auto-sync et gestion des threads (auto_sync)
from app.services.bank_sync.auto_sync import (
    _ACTIVE_BACKGROUND_THREADS,
    AUTO_SYNC_COOLDOWN_SECONDS,
    TRIGGER_SOURCE_LABELS,
    execute_auto_sync_for_connection,
    get_auto_sync_cooldown_status,
    is_background_sync_running,
    trigger_manual_auto_sync,
)

logger = logging.getLogger(__name__)

_SCHEDULER_RUNNING = False


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
                            # Vérification du cooldown anti-spam persistant de 3h
                            cooldown = get_auto_sync_cooldown_status(db, pid)
                            if cooldown.get("cooldown_active"):
                                rem_min = cooldown.get("remaining_seconds", 0) // 60
                                logger.debug(f"[BankScheduler] Boucle auto ignorée pour profil '{pid}' : cooldown anti-spam actif ({rem_min} min restantes)")
                                continue

                            interval_hours = int(_get_config_value(db, "bank_auto_sync_interval_hours", "24") or 24)

                            # 2. Vérifier si le coffre de ce profil spécifique est déverrouillé en mémoire
                            master_password = VaultSessionManager.get_password(profile_id=pid)
                            if master_password:
                                active_conns = db.query(BankConnection).filter(
                                    BankConnection.is_active == True
                                ).all()

                                now = datetime.now(timezone.utc)
                                ran_any = False
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
                                        ran_any = True
                                        loop = asyncio.get_running_loop()
                                        await loop.run_in_executor(
                                            None,
                                            execute_auto_sync_for_connection,
                                            db,
                                            conn,
                                            master_password,
                                            pid,
                                            "scheduled"
                                        )
                                        await asyncio.sleep(5)

                                if ran_any:
                                    _set_config_value(db, "last_auto_sync_attempt", datetime.now(timezone.utc).isoformat())
                            else:
                                logger.debug(f"[BankScheduler] Coffre verrouillé pour le profil '{pid}' : sync auto en attente")

                        # 3. Étape 5 : Évaluation périodique/mensuelle des suggestions budgétaires (indépendante de la sync bancaire)
                        try:
                            from app.services.budget_service import evaluate_monthly_budget_suggestions, suggest_new_envelopes
                            loop = asyncio.get_running_loop()
                            await loop.run_in_executor(None, evaluate_monthly_budget_suggestions, db, pid, False)
                            await loop.run_in_executor(None, suggest_new_envelopes, db, pid, False)
                        except Exception as b_eval_err:
                            logger.debug(f"[BankScheduler] Suggestion budgétaire non exécutée pour profil '{pid}': {b_eval_err}")
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


def start_bank_sync_scheduler():
    """Lance la boucle scheduler de synchronisation bancaire en tâche de fond asyncio."""
    asyncio.create_task(bank_sync_scheduler_loop())


__all__ = [
    "_PENDING_SYNC_DATA",
    "_SCHEDULER_RUNNING",
    "CSV_IMPORT_CONN_ID",
    "CSV_IMPORT_CONN_LABEL",
    "TRIGGER_SOURCE_LABELS",
    "_resolve_profile_id",
    "_get_config_value",
    "_set_config_value",
    "clear_pending_sync_for_connection",
    "clear_all_pending_sync",
    "get_dismissed_transactions",
    "add_dismissed_transaction",
    "remove_dismissed_transaction",
    "dismiss_pending_transaction",
    "remove_committed_from_pending",
    "save_pending_sync_data",
    "save_last_statement_snapshot",
    "get_last_statement_snapshot",
    "get_all_pending_sync",
    "clear_pending_sync_for_conn",
    "execute_auto_sync_for_connection",
    "get_auto_sync_cooldown_status",
    "is_background_sync_running",
    "trigger_manual_auto_sync",
    "bank_sync_scheduler_loop",
    "start_bank_sync_scheduler",
]
