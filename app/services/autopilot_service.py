"""
app/services/autopilot_service.py — Service d'orchestration unifié du mode Auto-Pilote.
Traite les flux d'ingestion bancaires (Woob et fichiers CSV/Excel/TSV),
applique l'auto-rapprochement haute certitude (score >= 85),
gère l'anti-collision sur montants homonymes, enregistre les décisions dans AutopilotDecisionLog,
et maintient la cohérence Undo/Redo via history_service.
"""
import json
import logging
import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models import GlobalConfig, Transaction, AutopilotDecisionLog
from app.services.history_service import record_action, snapshot_entity
from app.services import stats_cache
from app.services.bank_sync_scheduler import (
    save_pending_sync_data,
    clear_pending_sync_for_connection,
    CSV_IMPORT_CONN_ID,
    _resolve_profile_id
)

logger = logging.getLogger(__name__)


def is_autopilot_enabled(db: Session) -> bool:
    """Vérifie si le mode Auto-Pilote est actif dans global_config."""
    try:
        cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_pilot_enabled").first()
        if not cfg or not cfg.value:
            return False
        return cfg.value.strip().lower() in ("true", "1", "yes", "on")
    except Exception as e:
        logger.warning(f"[AutoPilot] Erreur de lecture du statut auto_pilot_enabled: {e}")
        return False


def set_autopilot_enabled(db: Session, enabled: bool) -> None:
    """Active ou désactive le mode Auto-Pilote dans global_config."""
    val_str = "true" if enabled else "false"
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_pilot_enabled").first()
    if not cfg:
        cfg = GlobalConfig(key="auto_pilot_enabled", value=val_str)
        db.add(cfg)
    else:
        cfg.value = val_str
    db.commit()
    logger.info(f"[AutoPilot] Mode Auto-Pilote configuré à : {val_str}")


def process_incoming_batch(
    db: Session,
    conn_id: int,
    preview_data: Dict[str, Any],
    profile_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Point d'entrée d'orchestration unifié pour les flux d'ingestion (Woob & fichiers).
    - Si l'Auto-Pilote est désactivé : délégation intégrale au Sas existant (zéro régression).
    - Si l'Auto-Pilote est actif :
        * Auto-rapprochement haute certitude (score >= 85 sans collision et non venant).
        * Inscription dans AutopilotDecisionLog (pour traçabilité et rollback sémantique).
        * Appel de record_action pour cohérence avec le système global Undo/Redo.
        * Sauvegarde des opérations résiduelles (arbitrage suggéré, collision, etc.) dans le Sas.
        * Invalidation du cache de statistiques.
    """
    pid = _resolve_profile_id(profile_id)

    # 1. Si Auto-Pilote désactivé : délégation directe au Sas d'attente (comportement historique)
    if not is_autopilot_enabled(db):
        save_pending_sync_data(db, conn_id, preview_data, profile_id=pid)
        total_txs = sum(len(a.get("transactions", [])) for a in preview_data.get("accounts", []))
        return {
            "batch_id": None,
            "status": "delegated_to_sas",
            "auto_reconciled": 0,
            "auto_committed": 0,
            "pending": total_txs,
            "total": total_txs
        }

    batch_id = str(uuid.uuid4())
    logger.info(f"[AutoPilot] Début du cycle d'ingestion autonome (lot {batch_id}, connexion={conn_id}, profil={pid})")

    auto_reconciled_count = 0
    auto_committed_count = 0
    pending_count = 0
    total_count = 0

    residual_accounts = []

    try:
        for acc in preview_data.get("accounts", []):
            acc_id = acc.get("account_id")
            account_txs = acc.get("transactions", []) or []
            residual_txs = []

            for tx in account_txs:
                total_count += 1

                is_rec = bool(tx.get("is_reconciled", False))
                already_rec = bool(tx.get("already_reconciled", False))
                matched_id = tx.get("matched_db_id")
                match_score = float(tx.get("match_score", 0) or 0)
                collision_detected = bool(tx.get("collision_detected", False))
                is_coming = bool(tx.get("is_coming", False))

                # Critère d'auto-rapprochement haute certitude :
                # Score >= 85, non déjà rapproché, sans ambiguïté homonyme, et opération confirmée (non coming)
                is_eligible_reconciliation = (
                    is_rec
                    and not already_rec
                    and matched_id is not None
                    and match_score >= 85.0
                    and not collision_detected
                    and not is_coming
                )

                if is_eligible_reconciliation:
                    existing = db.query(Transaction).filter(Transaction.id == matched_id).first()
                    if existing and existing.reconciliation_date is None:
                        before_snap = snapshot_entity(existing)

                        # Appliquer le rapprochement en base
                        existing.reconciliation_date = date.today()
                        if tx.get("csv_id"):
                            existing.csv_id = tx["csv_id"]
                        if tx.get("category"):
                            existing.category = tx["category"]

                        # Historisation Undo/Redo
                        record_action(
                            db,
                            "transaction",
                            existing.id,
                            "UPDATE",
                            before_snap,
                            snapshot_entity(existing),
                            user_name="Auto-Pilote"
                        )

                        # Journalisation de la décision Auto-Pilote
                        snap_payload = {
                            "bank_tx": {
                                k: v for k, v in tx.items()
                                if not k.startswith("_") and not isinstance(v, (datetime, date))
                            },
                            "matched_db_id": existing.id,
                            "before": before_snap,
                            "after": snapshot_entity(existing)
                        }

                        decision = AutopilotDecisionLog(
                            batch_id=batch_id,
                            decision_type="reconciliation",
                            action="AUTO_COMMIT",
                            entity_type="transaction",
                            entity_id=existing.id,
                            conn_id=conn_id if conn_id != CSV_IMPORT_CONN_ID else None,
                            account_id=existing.to_account_id or existing.from_account_id or acc_id,
                            raw_snapshot=json.dumps(snap_payload, default=str),
                            confidence_score=match_score,
                            is_undone=False
                        )
                        db.add(decision)
                        auto_reconciled_count += 1
                        continue
                    else:
                        # Transaction cible introuvable ou déjà réconciliée -> maintien dans le Sas
                        residual_txs.append(tx)
                        pending_count += 1
                else:
                    # Rapprochement suggéré (60 <= score < 85), collision, ou nouvelle transaction non rapprochée
                    residual_txs.append(tx)
                    pending_count += 1

            residual_acc = dict(acc)
            residual_acc["transactions"] = residual_txs
            residual_accounts.append(residual_acc)

        # 3. Mise à jour du Sas pour les opérations résiduelles
        if pending_count > 0:
            residual_preview = dict(preview_data)
            residual_preview["accounts"] = residual_accounts
            save_pending_sync_data(db, conn_id, residual_preview, profile_id=pid)
        else:
            # 100% des opérations traitées avec succès, libération du sas
            clear_pending_sync_for_connection(db, conn_id, profile_id=pid)

        db.commit()
        stats_cache.invalidate(pid)
        logger.info(
            f"[AutoPilot] Lot {batch_id} validé avec succès : "
            f"{auto_reconciled_count} auto-rapprochées, {pending_count} en attente (total {total_count})."
        )

        return {
            "batch_id": batch_id,
            "status": "completed",
            "auto_reconciled": auto_reconciled_count,
            "auto_committed": auto_committed_count,
            "pending": pending_count,
            "total": total_count
        }

    except Exception as e:
        db.rollback()
        logger.error(f"[AutoPilot] Échec critique lors du traitement du lot {batch_id}: {e}", exc_info=True)
        # En cas d'erreur de traitement autonome, préserver l'intégrité en sauvant le lot complet dans le sas
        try:
            save_pending_sync_data(db, conn_id, preview_data, profile_id=pid)
        except Exception:
            pass
        raise e


# Alias pour conformité avec les spécifications de la roadmap
process_incoming_transactions_batch = process_incoming_batch
