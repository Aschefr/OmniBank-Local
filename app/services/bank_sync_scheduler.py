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


CSV_IMPORT_CONN_ID = -1
CSV_IMPORT_CONN_LABEL = "📄 Relevé importé"


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
    from app.routers.csv_parser import check_reconciliation
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
                    prof_data[int(k)] = v
            except Exception:
                pass

    if not valid_conns and CSV_IMPORT_CONN_ID not in prof_data:
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
            "vault_unlocked": VaultSessionManager.get_status(profile_id=pid).get("is_unlocked", False)
        }

    # Purger immédiatement les conn_id orphelines qui n'existent plus (en épargnant CSV_IMPORT_CONN_ID)
    orphan_ids = [cid for cid in list(prof_data.keys()) if cid not in valid_conn_map and cid != CSV_IMPORT_CONN_ID]
    if orphan_ids:
        for oid in orphan_ids:
            prof_data.pop(oid, None)
        _set_config_value(db, "bank_pending_sync_cache", json.dumps(prof_data) if prof_data else "")

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
        "vault_unlocked": VaultSessionManager.get_status(profile_id=pid).get("is_unlocked", False)
    }


def save_pending_sync_data(db: Session, conn_id: int, preview_data: Dict[str, Any], profile_id: Optional[str] = None):
    """
    Enregistre le résultat de preview dans le sas d'attente (RAM + GlobalConfig) pour le profil.
    Remplace systématiquement les données antérieures pour les comptes concernés,
    quelle que soit leur provenance (connexion en ligne ou import de relevé).
    """
    global _PENDING_SYNC_DATA
    pid = _resolve_profile_id(profile_id)
    if pid not in _PENDING_SYNC_DATA:
        _PENDING_SYNC_DATA[pid] = {}

    new_accounts = preview_data.get("accounts", []) or []
    current_time = time.time()

    # 1. Purger/retirer ces comptes de toutes les AUTRES connexions existantes dans le sas
    for other_cid in list(_PENDING_SYNC_DATA[pid].keys()):
        if other_cid == conn_id:
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
            if other_cid == CSV_IMPORT_CONN_ID and len(filtered_other_accs) == 0:
                _PENDING_SYNC_DATA[pid].pop(other_cid, None)

    # 2. Mettre à jour la connexion cible
    if conn_id == CSV_IMPORT_CONN_ID:
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
        _PENDING_SYNC_DATA[pid][conn_id] = {
            "updated_at": current_time,
            "accounts": new_accounts
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
                elif not tx.get("is_reconciled") and not tx.get("is_dismissed") and not tx.get("is_auto_dismissed") and not tx.get("_excluded"):
                    new_txs += 1

        # Créer une notification in-app pour informer l'utilisateur du résultat
        if matches > 0 or new_txs > 0:
            notif_msg = []
            if matches == 1:
                notif_msg.append("1 opération prête à pointer")
            elif matches > 1:
                notif_msg.append(f"{matches} opérations prêtes à pointer")
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
            err_lower = err_msg.lower()
            is_vault_err = any(k in err_lower for k in ("mot de passe", "password", "coffre", "vault", "identifiant", "verrouill"))
            notif = Notification(
                type="bank_sync_error",
                title=f"⚠️ Échec relevé {conn.label}",
                content=f"Erreur lors du relevé bancaire de {conn.label} : {err_msg}",
                link_data=json.dumps({
                    "view": "accounts",
                    "action": "unlock_vault" if is_vault_err else "bank_sync_error",
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


_ACTIVE_BACKGROUND_SYNCS: set = set()


def is_background_sync_running(profile_id: Optional[str] = None) -> bool:
    """Retourne True si un relevé en arrière-plan est actuellement en cours d'exécution."""
    pid = _resolve_profile_id(profile_id)
    return pid in _ACTIVE_BACKGROUND_SYNCS


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

    _ACTIVE_BACKGROUND_SYNCS.add(pid)

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
            _ACTIVE_BACKGROUND_SYNCS.discard(pid)
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

