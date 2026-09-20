"""
OmniBank-Local — Planificateur d'arrière-plan pour la Synchronisation Bancaire.
Gère les relevés automatiques programmés (quand le coffre est déverrouillé en mémoire),
la détection proactive des rapprochements, l'alimentation du sas d'attente (Pending Sync)
et l'émission de notifications in-app.
"""

import asyncio
import json
import logging
import threading
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


CSV_IMPORT_CONN_ID = -1
CSV_IMPORT_CONN_LABEL = "📄 Relevé importé"

TRIGGER_SOURCE_LABELS = {
    "vault_unlock": "au déverrouillage du coffre",
    "scheduled": "planification automatique",
    "manual": "action manuelle",
    "test": "test automatisé"
}


def _normalize_conn_id(cid: Any) -> int:
    """Normalise un identifiant de connexion (int, str 'csv_import', '-1') en entier strict."""
    try:
        return int(cid)
    except (ValueError, TypeError):
        if str(cid).strip().lower() in ("csv_import", "file"):
            return CSV_IMPORT_CONN_ID
        return -999


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
    cid = _normalize_conn_id(conn_id)
    if pid in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid].pop(cid, None)
        _PENDING_SYNC_DATA[pid].pop(str(cid), None)
        if _PENDING_SYNC_DATA[pid]:
            serializable = {str(k): v for k, v in _PENDING_SYNC_DATA[pid].items()}
            _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable))
        else:
            _set_config_value(db, "bank_pending_sync_cache", "")
    stats_cache.invalidate(pid)
    logger.info(f"[BankSyncScheduler] Sas de synchronisation purgé pour la connexion #{cid} (profil={pid})")


def clear_all_pending_sync(db: Session, profile_id: Optional[str] = None):
    """Purge l'intégralité du sas d'opérations en attente d'un profil."""
    global _PENDING_SYNC_DATA
    pid = _resolve_profile_id(profile_id)
    if pid in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid].clear()
    _set_config_value(db, "bank_pending_sync_cache", "")
    stats_cache.invalidate(pid)
    logger.info(f"[BankSyncScheduler] Intégralité du sas de synchronisation purgé pour profil={pid}.")


def get_dismissed_transactions(db: Session, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Retourne le dictionnaire des opérations bancaires ignorées/persistées."""
    pid = _resolve_profile_id(profile_id)
    key = f"bank_dismissed_transactions_{pid}" if pid != "default" else "bank_dismissed_transactions"
    raw = _get_config_value(db, key, "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def add_dismissed_transaction(db: Session, csv_id: str, metadata: Optional[Dict[str, Any]] = None, profile_id: Optional[str] = None) -> bool:
    """Ajoute de façon persistante une opération aux opérations ignorées."""
    if not csv_id:
        return False
    pid = _resolve_profile_id(profile_id)
    key = f"bank_dismissed_transactions_{pid}" if pid != "default" else "bank_dismissed_transactions"
    dismissed = get_dismissed_transactions(db, profile_id)
    dismissed[csv_id] = {
        **(metadata or {}),
        "dismissed_at": datetime.now(timezone.utc).isoformat()
    }
    _set_config_value(db, key, json.dumps(dismissed))
    stats_cache.invalidate(pid)
    logger.info(f"[BankSyncScheduler] csv_id={csv_id} ajouté aux exclusions persistantes (profil={pid}).")
    return True


def remove_dismissed_transaction(db: Session, csv_id: str, profile_id: Optional[str] = None) -> bool:
    """Retire une opération de la liste des exclusions persistantes (restauration)."""
    if not csv_id:
        return False
    pid = _resolve_profile_id(profile_id)
    key = f"bank_dismissed_transactions_{pid}" if pid != "default" else "bank_dismissed_transactions"
    dismissed = get_dismissed_transactions(db, profile_id)
    removed = False
    if csv_id in dismissed:
        del dismissed[csv_id]
        _set_config_value(db, key, json.dumps(dismissed))
        logger.info(f"[BankSyncScheduler] csv_id={csv_id} retiré des exclusions persistantes / restauré (profil={pid}).")
        removed = True

    # Réactiver dans le cache mémoire si présent
    prof_data = _PENDING_SYNC_DATA.get(pid, {})
    for conn_id, data in list(prof_data.items()):
        for acc in data.get("accounts", []):
            for tx in acc.get("transactions", []):
                if tx.get("csv_id") == csv_id:
                    tx["is_dismissed"] = False
                    tx["is_auto_dismissed"] = False
                    tx["_excluded"] = False
                    removed = True
    if prof_data:
        serializable = {str(k): v for k, v in prof_data.items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable) if prof_data else "")

    stats_cache.invalidate(pid)
    return removed


def dismiss_pending_transaction(db: Session, csv_id: str, profile_id: Optional[str] = None) -> bool:
    """Marque une opération spécifique du sas comme ignorée de façon persistante."""
    global _PENDING_SYNC_DATA
    pid = _resolve_profile_id(profile_id)
    found = False
    meta = {}
    prof_data = _PENDING_SYNC_DATA.get(pid, {})
    for conn_id, data in list(prof_data.items()):
        for acc in data.get("accounts", []):
            for tx in acc.get("transactions", []):
                if tx.get("csv_id") == csv_id:
                    tx["is_dismissed"] = True
                    tx["_excluded"] = True
                    meta = {
                        "date_operation": tx.get("date_operation"),
                        "raw_amount": tx.get("raw_amount"),
                        "description": tx.get("description"),
                        "account_id": acc.get("account_id")
                    }
                    found = True

    # Enregistrer de façon persistante
    add_dismissed_transaction(db, csv_id, metadata=meta, profile_id=pid)

    if found:
        serializable = {str(k): v for k, v in prof_data.items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable) if prof_data else "")
        logger.info(f"[BankSyncScheduler] Opération en attente #{csv_id} marquée ignorée (profil={pid}).")
    return True


def remove_committed_from_pending(db: Session, csv_ids: List[str], profile_id: Optional[str] = None):
    """Purge une liste de transactions (par csv_id) du sas d'attente tout en conservant les comptes et leurs soldes."""
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
        stats_cache.invalidate(pid)
        logger.info(f"[BankSyncScheduler] {len(csv_ids)} opération(s) purgée(s) du sas d'attente (profil={pid}).")



def _matches_account(acc_a: Dict[str, Any], acc_b: Dict[str, Any]) -> bool:
    """Détermine si deux dictionnaires de comptes représentent le même compte OmniBank."""
    id_a = acc_a.get("account_id")
    id_b = acc_b.get("account_id")
    if id_a is not None and id_b is not None:
        try:
            return int(id_a) == int(id_b)
        except (ValueError, TypeError):
            pass
    name_a = (acc_a.get("account_name") or acc_a.get("name") or acc_a.get("section_title") or "").strip().lower()
    name_b = (acc_b.get("account_name") or acc_b.get("name") or acc_b.get("section_title") or "").strip().lower()
    return bool(name_a and name_b and name_a == name_b)


def get_all_pending_sync(db: Session, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Retourne la liste globale des opérations en attente (rapprochements détectés + nouvelles opérations).
    Ré-évalue dynamiquement les rapprochements contre la base de données actuelle pour garantir
    l'exactitude (ex: détection des virements internes miroirs, opérations pointées manuellement).
    Purgera automatiquement toute donnée résiduelle si la connexion n'existe plus dans la base.
    Garantit l'unicité stricte par compte en conservant systématiquement la version la plus récente.
    """
    global _PENDING_SYNC_DATA
    from app.services.reconciliation_engine import check_reconciliation
    from datetime import date, timedelta
    total_matches = 0
    total_confirmed_matches = 0
    total_coming_matches = 0
    total_new = 0
    total_discrepancies = 0
    accounts_list = []
    matches_by_tx_id = {}
    discrepancies_by_tx_id = {}  # db_tx_id -> state discrepancy pending item (reconciled locally, pending online)
    matched_ids_global = set()

    # Vérifier l'existence de connexions valides
    valid_conns = db.query(BankConnection).all()
    valid_conn_map = {c.id: c.label for c in valid_conns}
    valid_conn_map[CSV_IMPORT_CONN_ID] = CSV_IMPORT_CONN_LABEL
    pid = _resolve_profile_id(profile_id)
    dismissed_tx_map = get_dismissed_transactions(db, profile_id=pid)

    if pid not in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid] = {}

    prof_data = _PENDING_SYNC_DATA[pid]

    # Récupérer aussi depuis global_config au démarrage si le cache RAM de ce profil est vide
    if not prof_data:
        raw = _get_config_value(db, "bank_pending_sync_cache", "")
        if raw:
            try:
                cached = json.loads(raw)
                for k, v in cached.items():
                    prof_data[_normalize_conn_id(k)] = v
            except Exception:
                pass

    # Normaliser toutes les clés du cache en int pour éviter les désynchronisations str vs int
    for k in list(prof_data.keys()):
        norm_k = _normalize_conn_id(k)
        if norm_k != k:
            prof_data[norm_k] = prof_data.pop(k)

    has_csv = (CSV_IMPORT_CONN_ID in prof_data) and bool(prof_data[CSV_IMPORT_CONN_ID].get("accounts"))
    if not valid_conns and not has_csv:
        # Aucune connexion bancaire configurée et pas d'import fichier en cours -> Purge absolue
        prof_data.clear()
        _set_config_value(db, "bank_pending_sync_cache", "")
        return {
            "total_matches": 0,
            "total_confirmed_matches": 0,
            "total_coming_matches": 0,
            "total_new": 0,
            "total_discrepancies": 0,
            "accounts": [],
            "matches_by_tx_id": {},
            "discrepancies_by_tx_id": {},
            "vault_unlocked": VaultSessionManager.is_unlocked(profile_id=pid)
        }

    # Purger immédiatement les conn_id orphelines qui n'existent plus (en épargnant CSV_IMPORT_CONN_ID)
    orphan_ids = [cid for cid in list(prof_data.keys()) if _normalize_conn_id(cid) not in valid_conn_map and _normalize_conn_id(cid) != CSV_IMPORT_CONN_ID]
    if orphan_ids:
        for oid in orphan_ids:
            prof_data.pop(oid, None)
        serializable = {str(k): v for k, v in prof_data.items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable) if prof_data else "")

    from app.services.finance_engine import calculate_balances
    balances_reconciled = calculate_balances(db, only_reconciled=True)

    # Trier les connexions par updated_at décroissant pour privilégier les données les plus récentes
    sorted_conn_items = sorted(
        prof_data.items(),
        key=lambda item: item[1].get("updated_at", 0) if isinstance(item[1], dict) else 0,
        reverse=True
    )

    seen_account_keys = set()
    unique_accounts_to_process = []
    has_pruned_duplicates = False

    for conn_id, data in sorted_conn_items:
        conn_label = valid_conn_map.get(conn_id, f"Banque #{conn_id}")
        kept_accs_for_conn = []

        for acc in data.get("accounts", []):
            acc_id = acc.get("account_id")
            acc_name = (acc.get("account_name") or acc.get("name") or acc.get("section_title") or "").strip().lower()
            acc_key = f"id_{acc_id}" if acc_id is not None else f"name_{acc_name}"

            if acc_key in seen_account_keys:
                # Doublon détecté provenant d'une source antérieure : on ignore l'ancienne entrée
                has_pruned_duplicates = True
                continue
            seen_account_keys.add(acc_key)
            kept_accs_for_conn.append(acc)
            unique_accounts_to_process.append((conn_id, conn_label, acc))

        data["accounts"] = kept_accs_for_conn

    if has_pruned_duplicates:
        # Nettoyer les connexions CSV vides après élimination des doublons
        if CSV_IMPORT_CONN_ID in prof_data and not prof_data[CSV_IMPORT_CONN_ID].get("accounts"):
            prof_data.pop(CSV_IMPORT_CONN_ID, None)
        serializable = {str(k): v for k, v in prof_data.items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable) if prof_data else "")

    for conn_id, conn_label, acc in unique_accounts_to_process:
        acc_copy = dict(acc)
        acc_copy["connection_id"] = conn_id
        acc_copy["connection_label"] = conn_label
        acc_copy["bank_balance"] = acc.get("bank_balance")
        local_acc_id = acc.get("account_id")
        if local_acc_id:
            acc_copy["local_reconciled_balance"] = round(balances_reconciled.get(local_acc_id, 0.0), 2)
        else:
            acc_copy["local_reconciled_balance"] = None

        # Vérifier si les soldes sont conformes au centime près
        is_balance_conformed = False
        if acc_copy.get("bank_balance") is not None and acc_copy.get("local_reconciled_balance") is not None:
            is_balance_conformed = abs(acc_copy["bank_balance"] - acc_copy["local_reconciled_balance"]) < 0.005

        txs = acc.get("transactions", [])
        confirmed_txs = [tx for tx in txs if not tx.get("is_coming", False)]
        coming_txs = [tx for tx in txs if tx.get("is_coming", False)]

        def _evaluate_scheduler_tx_list(tx_list, is_coming_flag):
            nonlocal total_matches, total_confirmed_matches, total_coming_matches, total_discrepancies, total_new
            result_list = []
            for tx in tx_list:
                tx_copy = dict(tx)
                tx_copy["is_coming"] = is_coming_flag
                tx_copy["connection_id"] = conn_id
                tx_copy["connection_label"] = conn_label
                tx_date_str = tx.get("date_operation")
                raw_amount = tx.get("raw_amount")
                csv_id = tx.get("csv_id")

                is_dismissed = bool(csv_id and csv_id in dismissed_tx_map)
                tx_copy["is_dismissed"] = is_dismissed
                tx_copy["is_auto_dismissed"] = False

                if tx_date_str and raw_amount is not None and local_acc_id:
                    try:
                        tx_date = date.fromisoformat(str(tx_date_str)[:10])
                        rec_info = check_reconciliation(
                            db,
                            tx_date,
                            raw_amount,
                            matched_ids=matched_ids_global,
                            account_id=local_acc_id,
                            is_coming=is_coming_flag,
                            bank_label=tx.get("raw_description") or tx.get("description"),
                            csv_id=csv_id
                        )
                        if rec_info:
                            tx_copy["is_reconciled"] = True
                            tx_copy["already_reconciled"] = rec_info.get("already_reconciled", False)
                            tx_copy["is_mirror_transfer"] = rec_info.get("is_mirror_transfer", False)
                            tx_copy["is_orphan_transfer_link"] = rec_info.get("is_orphan_transfer_link", False)
                            tx_copy["orphan_account_id"] = rec_info.get("orphan_account_id")
                            tx_copy["orphan_account_name"] = rec_info.get("orphan_account_name")
                            tx_copy["matched_db_id"] = rec_info.get("id")
                            tx_copy["db_description"] = rec_info.get("description")
                            tx_copy["match_score"] = rec_info.get("match_score", 0)
                            if rec_info.get("id"):
                                matched_ids_global.add(rec_info.get("id"))
                        else:
                            tx_copy["is_reconciled"] = False
                            tx_copy["already_reconciled"] = False
                            tx_copy["is_mirror_transfer"] = False
                            tx_copy["is_orphan_transfer_link"] = False
                            tx_copy["orphan_account_id"] = None
                            tx_copy["orphan_account_name"] = None
                            tx_copy["matched_db_id"] = None
                            tx_copy["db_description"] = None
                            tx_copy["match_score"] = 0
                    except Exception as err:
                        tx_kind = "coming" if is_coming_flag else "pending"
                        logger.warning(f"[BankScheduler] Erreur re-matching {tx_kind} tx: {err}")
                        tx_copy["is_reconciled"] = False
                        tx_copy["already_reconciled"] = False
                        tx_copy["is_mirror_transfer"] = False
                        tx_copy["is_orphan_transfer_link"] = False
                        tx_copy["orphan_account_id"] = None
                        tx_copy["orphan_account_name"] = None
                        tx_copy["matched_db_id"] = None
                        tx_copy["db_description"] = None
                        tx_copy["match_score"] = 0

                # Auto-exclusion intelligente si solde conforme et ancienne opération non reconnue
                if not tx_copy.get("is_reconciled") and not is_coming_flag and not is_dismissed:
                    if is_balance_conformed and tx_date_str:
                        try:
                            tx_dt = date.fromisoformat(str(tx_date_str)[:10])
                            if tx_dt < date.today() - timedelta(days=15):
                                tx_copy["is_auto_dismissed"] = True
                                tx_copy["_excluded"] = True
                        except Exception:
                            pass

                if is_dismissed:
                    tx_copy["_excluded"] = True

                result_list.append(tx_copy)
                if tx_copy.get("is_reconciled") and not tx_copy.get("already_reconciled") and tx_copy.get("matched_db_id"):
                    total_matches += 1
                    if tx_copy.get("is_coming"):
                        total_coming_matches += 1
                    else:
                        total_confirmed_matches += 1
                    matches_by_tx_id[tx_copy["matched_db_id"]] = {
                        **tx_copy,
                        "connection_id": conn_id,
                        "connection_label": conn_label
                    }
                elif tx_copy.get("is_coming") and tx_copy.get("is_reconciled") and tx_copy.get("already_reconciled") and tx_copy.get("matched_db_id"):
                    total_discrepancies += 1
                    discrepancies_by_tx_id[tx_copy["matched_db_id"]] = {
                        **tx_copy,
                        "connection_id": conn_id,
                        "connection_label": conn_label
                    }
                elif not tx_copy.get("is_reconciled"):
                    if not tx_copy.get("is_dismissed") and not tx_copy.get("is_auto_dismissed") and not tx_copy.get("_excluded"):
                        total_new += 1

            return result_list

        # Passe 1: Transactions confirmées en premier
        re_evaluated_confirmed = _evaluate_scheduler_tx_list(confirmed_txs, is_coming_flag=False)
        # Passe 2: Transactions à venir en attente ensuite
        re_evaluated_coming = _evaluate_scheduler_tx_list(coming_txs, is_coming_flag=True)

        re_evaluated_txs = re_evaluated_confirmed + re_evaluated_coming
        re_evaluated_txs.sort(key=lambda x: str(x.get("date_operation") or ""), reverse=True)
        acc_copy["transactions"] = re_evaluated_txs
        accounts_list.append(acc_copy)

    return {
        "total_matches": total_matches,
        "total_confirmed_matches": total_confirmed_matches,
        "total_coming_matches": total_coming_matches,
        "total_new": total_new,
        "total_discrepancies": total_discrepancies,
        "accounts": accounts_list,
        "matches_by_tx_id": matches_by_tx_id,
        "discrepancies_by_tx_id": discrepancies_by_tx_id,
        "_ai_analyzed": any(isinstance(v, dict) and v.get("_ai_analyzed") for v in prof_data.values()),
        "vault_unlocked": VaultSessionManager.is_unlocked(profile_id=pid)
    }


def save_pending_sync_data(db: Session, conn_id: int, preview_data: Dict[str, Any], profile_id: Optional[str] = None):
    """
    Enregistre le résultat de preview dans le sas d'attente (RAM + GlobalConfig) pour le profil.
    Remplace systématiquement les données antérieures pour les comptes concernés,
    quelle que soit leur provenance (connexion en ligne ou import de relevé).
    """
    global _PENDING_SYNC_DATA
    pid = _resolve_profile_id(profile_id)
    cid = _normalize_conn_id(conn_id)
    if pid not in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid] = {}

    # Nettoyer d'éventuelles clés str qui traîneraient
    _PENDING_SYNC_DATA[pid].pop(str(cid), None)

    new_accounts = preview_data.get("accounts", []) or []
    current_time = time.time()

    # 1. Purger/retirer ces comptes de toutes les AUTRES connexions existantes dans le sas
    for other_cid in list(_PENDING_SYNC_DATA[pid].keys()):
        if _normalize_conn_id(other_cid) == cid:
            continue
        other_conn_entry = _PENDING_SYNC_DATA[pid].get(other_cid)
        if not other_conn_entry:
            continue
        existing_other_accs = other_conn_entry.get("accounts", [])
        filtered_other_accs = [
            o_acc for o_acc in existing_other_accs
            if not any(_matches_account(o_acc, n_acc) for n_acc in new_accounts)
        ]
        if len(filtered_other_accs) != len(existing_other_accs):
            other_conn_entry["accounts"] = filtered_other_accs
            # Si plus aucun compte dans un import CSV, on supprime la connexion du sas
            if _normalize_conn_id(other_cid) == CSV_IMPORT_CONN_ID and len(filtered_other_accs) == 0:
                _PENDING_SYNC_DATA[pid].pop(other_cid, None)

    # 2. Mettre à jour la connexion cible
    if cid == CSV_IMPORT_CONN_ID:
        # Pour les imports fichiers successifs (ex: fichier A pour compte 1 puis fichier B pour compte 2),
        # fusionner avec les comptes existants du sas fichier en remplaçant ceux qui correspondent.
        existing_csv_accs = _PENDING_SYNC_DATA[pid].get(CSV_IMPORT_CONN_ID, {}).get("accounts", [])
        merged_csv_accs = [
            e_acc for e_acc in existing_csv_accs
            if not any(_matches_account(e_acc, n_acc) for n_acc in new_accounts)
        ]
        merged_csv_accs.extend(new_accounts)
        _PENDING_SYNC_DATA[pid][CSV_IMPORT_CONN_ID] = {
            "updated_at": current_time,
            "accounts": merged_csv_accs
        }
    else:
        # Pour une connexion bancaire en ligne, remplacer intégralement ses comptes par le nouveau relevé
        _PENDING_SYNC_DATA[pid][cid] = {
            "updated_at": current_time,
            "accounts": new_accounts,
            "_ai_analyzed": bool(preview_data.get("_ai_analyzed", False))
        }

    try:
        serializable = {str(k): v for k, v in _PENDING_SYNC_DATA[pid].items()}
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(serializable))
        stats_cache.invalidate(pid)
    except Exception as e:
        logger.warning(f"[BankScheduler] Erreur de sauvegarde du cache pending: {e}")


def clear_pending_sync_for_conn(db: Session, conn_id: int, profile_id: Optional[str] = None):
    """Purger les opérations en attente pour une connexion."""
    clear_pending_sync_for_connection(db, conn_id, profile_id)


