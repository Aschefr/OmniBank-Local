"""
OmniBank-Local — Planificateur d'arrière-plan pour la Synchronisation Bancaire.
Façade de rétrocompatibilité et orchestrateur de la boucle planifiée asyncio.
Les composants modulaires sont situés dans app.services.bank_sync.* :
  - app.services.bank_sync.pending_store : Sas d'attente, cache RAM & GlobalConfig
  - app.services.bank_sync.auto_sync : Relevé automatique, relevés nécessaires & threads
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
    due_connections,
    execute_auto_sync_for_connection,
    get_auto_sync_cooldown_status,
    is_background_sync_running,
    trigger_manual_auto_sync,
)

logger = logging.getLogger(__name__)

_SCHEDULER_RUNNING = False


async def _run_scheduled_statement(db, pid: str) -> None:
    """Relevé planifié, par le même chemin que le bouton : un seul relevé à la fois par profil, donc
    jamais deux connexions simultanées à la même banque. Il part seulement s'il est nécessaire."""
    if _get_config_value(db, "bank_auto_sync_enabled", "false") != "true":
        return
    if not VaultSessionManager.get_password(profile_id=pid):
        logger.debug(f"[BankScheduler] Coffre verrouillé pour le profil '{pid}' : sync auto en attente")
        return
    trigger_manual_auto_sync(profile_id=pid, force=False, trigger_source="scheduled")
    # Un profil après l'autre, comme l'analyse qui suit : elle doit voir les opérations relevées
    while is_background_sync_running(pid):
        await asyncio.sleep(2)


async def _run_profile_cycle(pid: str) -> None:
    from app.database import get_engine
    from sqlalchemy.orm import sessionmaker

    SessionProf = sessionmaker(autocommit=False, autoflush=False, bind=get_engine(pid))
    db = SessionProf()
    try:
        await _run_scheduled_statement(db, pid)
        # Indépendante du relevé : attendre un relevé ne doit jamais retarder l'analyse budgétaire
        try:
            from app.services.budget_service import run_background_analysis
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, run_background_analysis, db, pid)
        except Exception as b_eval_err:
            logger.debug(f"[BankScheduler] Suggestion budgétaire non exécutée pour profil '{pid}': {b_eval_err}")
        try:
            from app.services.forecast_tracking import record_period_forecasts
            await asyncio.get_running_loop().run_in_executor(None, record_period_forecasts, db, pid)
        except Exception as forecast_err:
            db.rollback()
            logger.warning(f"[BankScheduler] Prévision de la période non enregistrée pour le profil '{pid}': {forecast_err}")
    finally:
        db.close()


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

            for prof in load_profiles_data().get("profiles", []):
                pid = prof["id"]
                try:
                    await _run_profile_cycle(pid)
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
