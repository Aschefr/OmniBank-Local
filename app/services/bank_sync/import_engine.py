"""
OmniBank-Local — Moteur d'importation et de ré-évaluation dynamique du Sas de synchronisation.
Calcule le rapprochement en direct par rapport à la base SQLite, gère les exclusions,
les forçages et l'enrichissement par règles/Smart Label.
"""

import logging
from datetime import date, timedelta
from typing import Any, Dict

from sqlalchemy.orm import Session

from app.models import Transaction
from app.services.chat.ollama_client import get_ollama_config
from app.services.finance_engine import calculate_balances
from app.services.reconciliation_engine import check_reconciliation
from app.services.smart_label_service import resolve_smart_labels_batch

logger = logging.getLogger(__name__)


def re_evaluate_preview_data(db: Session, preview_data: Dict[str, Any], use_ai_fallback: bool = False) -> Dict[str, Any]:
    """
    Re-calcule dynamiquement en direct le statut de rapprochement (is_reconciled, already_reconciled,
    matched_db_id, solde pointé local, etc.) d'un aperçu bancaire par rapport à l'état actuel de la base SQLite.
    Permet à toute opération supprimée ou ajoutée en local de basculer instantanément dans l'aperçu mis en cache.
    Prend en compte les listes 'rejected_matches' et 'force_matches' pour préserver les décisions manuelles de l'utilisateur.
    """
    if not preview_data or "accounts" not in preview_data:
        return preview_data

    from app.services.bank_sync_scheduler import get_dismissed_transactions

    dismissed_tx_map = get_dismissed_transactions(db)

    # Extraction des overrides utilisateur
    rejected_by_csv = {}
    for rm in (preview_data.get("rejected_matches") or []):
        csv = rm.get("csv_id")
        db_id = rm.get("db_id")
        if csv and db_id:
            try:
                rejected_by_csv.setdefault(csv, set()).add(int(db_id))
            except (ValueError, TypeError):
                pass

    force_by_csv = {}
    for fm in (preview_data.get("force_matches") or []):
        csv = fm.get("csv_id")
        db_id = fm.get("db_id")
        if csv and db_id:
            try:
                force_by_csv[csv] = int(db_id)
            except (ValueError, TypeError):
                pass

    balances_reconciled = calculate_balances(db, only_reconciled=True)
    matched_ids_global = set()

    for acc in preview_data.get("accounts", []):
        local_acc_id = acc.get("account_id")
        if local_acc_id:
            acc["local_reconciled_balance"] = round(balances_reconciled.get(local_acc_id, 0.0), 2)

        bank_bal = acc.get("bank_balance")
        local_bal = acc.get("local_reconciled_balance")
        is_balance_conformed = False
        if bank_bal is not None and local_bal is not None:
            is_balance_conformed = abs(bank_bal - local_bal) < 0.005

        txs = acc.get("transactions", [])
        confirmed_txs = [tx for tx in txs if not tx.get("is_coming", False)]
        coming_txs = [tx for tx in txs if tx.get("is_coming", False)]

        def _evaluate_tx_list(tx_list, is_coming_flag):
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

                # Passe 0 : Forcer le match si spécifié manuellement par l'utilisateur
                if csv_id and csv_id in force_by_csv:
                    forced_db_id = force_by_csv[csv_id]
                    forced_tx = db.query(Transaction).filter(Transaction.id == forced_db_id).first()
                    if forced_tx:
                        tx_copy["is_reconciled"] = True
                        tx_copy["already_reconciled"] = bool(forced_tx.reconciliation_date)
                        tx_copy["is_mirror_transfer"] = False
                        tx_copy["is_orphan_transfer_link"] = False
                        tx_copy["orphan_account_id"] = None
                        tx_copy["orphan_account_name"] = None
                        tx_copy["matched_db_id"] = forced_db_id
                        tx_copy["db_description"] = forced_tx.description
                        matched_ids_global.add(forced_db_id)
                        if is_dismissed:
                            tx_copy["_excluded"] = True
                        result_list.append(tx_copy)
                        continue

                if tx_date_str and raw_amount is not None and local_acc_id:
                    try:
                        tx_date = date.fromisoformat(str(tx_date_str)[:10])
                        local_excluded = set(matched_ids_global)
                        if csv_id and csv_id in rejected_by_csv:
                            local_excluded |= rejected_by_csv[csv_id]

                        rec_info = check_reconciliation(
                            db,
                            tx_date,
                            float(raw_amount),
                            matched_ids=local_excluded,
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
                        logger.warning(f"[BankSync] Erreur re-matching preview tx: {err}")
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
            return result_list

        # Passe 1: Transactions confirmées (historique) en priorité
        re_evaluated_confirmed = _evaluate_tx_list(confirmed_txs, is_coming_flag=False)
        # Passe 2: Transactions à venir (en attente en ligne) ensuite
        re_evaluated_coming = _evaluate_tx_list(coming_txs, is_coming_flag=True)

        all_re_evaluated = re_evaluated_confirmed + re_evaluated_coming
        # Tri chronologique décroissant (plus récentes en premier)
        all_re_evaluated.sort(key=lambda x: str(x.get("date_operation") or ""), reverse=True)
        acc["transactions"] = all_re_evaluated

    # Résolution des libellés intelligents pour toutes les opérations qui ne sont plus rapprochées
    raw_labels = []
    tx_types_map = {}
    for acc in preview_data.get("accounts", []):
        for tx in acc.get("transactions", []):
            if not tx.get("is_reconciled"):
                raw_desc = tx.get("raw_description") or tx.get("description") or ""
                if raw_desc:
                    raw_labels.append(raw_desc)
                    raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                    tx_types_map[raw_desc] = "expense_var" if raw_amt < 0 else "income"

    if raw_labels:
        try:
            cfg = get_ollama_config(db)
            ai_active = bool(use_ai_fallback and cfg and cfg.get("enabled"))

            smart_resolutions = resolve_smart_labels_batch(
                db,
                raw_labels,
                use_ai_fallback=ai_active,
                tx_types=tx_types_map,
                auto_fallback_category=True
            )
            for acc in preview_data.get("accounts", []):
                for tx in acc.get("transactions", []):
                    if not tx.get("is_reconciled"):
                        raw_desc = tx.get("raw_description") or tx.get("description") or ""
                        tx["raw_description"] = raw_desc
                        if raw_desc in smart_resolutions:
                            res = smart_resolutions[raw_desc]
                            if res.get("source") in ("rule", "history", "multi_category", "ai", "fallback"):
                                # Si l'opération a déjà été enrichie par l'IA ou règle manuelle, ne JAMAIS la rétrograder en fallback
                                if tx.get("smart_source") in ("ai", "rule", "history") or tx.get("smart_is_manual"):
                                    continue
                                if res.get("source") == "fallback":
                                    if tx.get("category"):
                                        continue
                                    if tx.get("smart_source") and tx.get("smart_source") != "none":
                                        continue
                                if not tx.get("description") or tx.get("description") == raw_desc:
                                    tx["description"] = res["description"]
                                if not tx.get("category") and res.get("category"):
                                    tx["category"] = res["category"]
                                if not tx.get("smart_source") or tx.get("smart_source") == "none":
                                    tx["smart_suggested"] = True
                                    tx["smart_source"] = res.get("source")
                                    tx["smart_is_manual"] = res.get("is_manual", False)
                                    tx["smart_is_provisional"] = res.get("is_provisional", False)
                                    tx["smart_is_multi_category"] = res.get("is_multi_category", False)
                                    tx["smart_is_fallback"] = res.get("smart_is_fallback", False)
                                    tx["smart_is_new_category"] = res.get("smart_is_new_category", False)
                                    tx["smart_confidence"] = res.get("confidence", 0.0)
        except Exception as e:
            logger.debug(f"[BankSync] Smart labels batch resolution error: {e}")

    return preview_data
