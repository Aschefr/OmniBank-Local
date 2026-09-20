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


AUTOPILOT_MANAGED_KEYS = (
    "enable_budget_creation_suggestions",
    "enable_budget_recalibration_suggestions",
    "auto_create_budget_envelopes",
    "auto_apply_budget_suggestions",
    "auto_link_deviant_recurrences",
    "auto_propagate_recurrence_hikes",
    "auto_skip_unreconciled_recurrences",
    "auto_close_unreconciled_recurrences",
)


def set_autopilot_enabled(db: Session, enabled: bool) -> None:
    """Active ou désactive le mode Auto-Pilote dans global_config.
    Quand le commutateur maître est activé (0 -> 1) :
      - Mémorise un snapshot des réglages manuels fins dans 'autopilot_subtoggles_pre_activation_snapshot'.
      - Active en cascade les modules autonomes essentiels.
    Quand le commutateur maître est désactivé (1 -> 0) :
      - Restaure fidèlement le snapshot des réglages manuels préalables.
    """
    val_str = "true" if enabled else "false"
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_pilot_enabled").first()
    was_enabled = bool(cfg and cfg.value and cfg.value.strip().lower() in ("true", "1", "yes", "on"))

    if not cfg:
        cfg = GlobalConfig(key="auto_pilot_enabled", value=val_str)
        db.add(cfg)
    else:
        cfg.value = val_str

    if enabled and not was_enabled:
        # 0 -> 1 : Sauvegarder l'état actuel des réglages personnalisés
        snap = {}
        for sub_key in AUTOPILOT_MANAGED_KEYS:
            row = db.query(GlobalConfig).filter(GlobalConfig.key == sub_key).first()
            if row and row.value is not None:
                snap[sub_key] = row.value
        
        snap_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "autopilot_subtoggles_pre_activation_snapshot").first()
        if not snap_cfg:
            snap_cfg = GlobalConfig(key="autopilot_subtoggles_pre_activation_snapshot", value=json.dumps(snap))
            db.add(snap_cfg)
        else:
            snap_cfg.value = json.dumps(snap)

        # Activation en cascade des briques de suggestions essentielles
        for sub_key in ("enable_budget_creation_suggestions", "enable_budget_recalibration_suggestions"):
            sc = db.query(GlobalConfig).filter(GlobalConfig.key == sub_key).first()
            if not sc:
                db.add(GlobalConfig(key=sub_key, value="true"))
            else:
                sc.value = "true"

    elif not enabled and was_enabled:
        # 1 -> 0 : Restaurer le snapshot préalable
        snap_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "autopilot_subtoggles_pre_activation_snapshot").first()
        if snap_cfg and snap_cfg.value:
            try:
                saved_state = json.loads(snap_cfg.value)
                for sub_key, saved_val in saved_state.items():
                    sc = db.query(GlobalConfig).filter(GlobalConfig.key == sub_key).first()
                    if sc:
                        sc.value = saved_val
                    else:
                        db.add(GlobalConfig(key=sub_key, value=saved_val))
            except Exception as e:
                logger.warning(f"[AutoPilot] Échec restauration snapshot préférences: {e}")

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

    # 2. Enrichissement Smart Labels si non déjà appliqué
    try:
        unresolved_labels = []
        tx_types_map = {}
        for acc in preview_data.get("accounts", []):
            for tx in acc.get("transactions", []):
                if not tx.get("is_reconciled") and not tx.get("smart_suggested"):
                    raw = tx.get("raw_description") or tx.get("description") or ""
                    if raw:
                        unresolved_labels.append(raw)
                        raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                        tx_types_map[raw] = "expense_var" if raw_amt < 0 else "income"

        use_ai = False
        try:
            from app.services.chat.ollama_client import get_ollama_config
            cfg = get_ollama_config(db)
            use_ai = bool(cfg and cfg.get("enabled"))
        except Exception:
            pass

        if unresolved_labels:
            from app.services.smart_label_service import resolve_smart_labels_batch
            resolutions = resolve_smart_labels_batch(
                db,
                unresolved_labels,
                use_ai_fallback=use_ai,
                tx_types=tx_types_map,
                auto_fallback_category=True
            )
            for acc in preview_data.get("accounts", []):
                for tx in acc.get("transactions", []):
                    if not tx.get("is_reconciled") and not tx.get("smart_suggested"):
                        raw = tx.get("raw_description") or tx.get("description") or ""
                        if raw in resolutions:
                            res = resolutions[raw]
                            if res.get("description"):
                                tx["description"] = res["description"]
                            if res.get("category"):
                                tx["category"] = res["category"]
                            tx["smart_suggested"] = True
                            tx["smart_source"] = res.get("source")
                            tx["smart_is_manual"] = res.get("is_manual", False)
                            tx["smart_is_provisional"] = res.get("is_provisional", False)
                            tx["smart_is_multi_category"] = res.get("is_multi_category", False)
                            tx["smart_is_fallback"] = res.get("smart_is_fallback", False)
                            tx["smart_is_new_category"] = res.get("smart_is_new_category", False)
                            tx["smart_confidence"] = res.get("confidence", 0.0)

        # Filet de sécurité supplémentaire : s'assurer qu'aucune opération non rapprochée ne reste sans catégorie
        from app.services.smart_label_service import resolve_fallback_category
        for acc in preview_data.get("accounts", []):
            for tx in acc.get("transactions", []):
                if not tx.get("is_reconciled") and not tx.get("category"):
                    if tx.get("smart_is_manual") and tx.get("smart_is_multi_category"):
                        continue
                    raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                    t_type = "expense_var" if raw_amt < 0 else "income"
                    tx["category"] = resolve_fallback_category(db, t_type)
                    tx["smart_is_fallback"] = True
                    tx["smart_suggested"] = True
                    if not tx.get("smart_source"):
                        tx["smart_source"] = "fallback"
                    tx["smart_confidence"] = max(float(tx.get("smart_confidence") or 0.0), 0.85)
    except Exception as sl_err:
        logger.warning(f"[AutoPilot] Avertissement lors de la résolution smart labels du lot: {sl_err}")

    # 2.B Évaluation du rapprochement pour les transactions non encore annotées
    try:
        from app.services.reconciliation_engine import check_reconciliation
        for acc in preview_data.get("accounts", []):
            acc_id = acc.get("account_id")
            for tx in acc.get("transactions", []):
                if not tx.get("is_reconciled") and tx.get("matched_db_id") is None and not tx.get("is_coming"):
                    raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                    op_d_str = tx.get("date_operation") or tx.get("date")
                    op_d = date.today()
                    if op_d_str:
                        s = str(op_d_str).strip()[:10]
                        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
                            try:
                                op_d = datetime.strptime(s, fmt).date()
                                break
                            except ValueError:
                                pass
                    lbl = tx.get("raw_description") or tx.get("description") or ""
                    c_id = tx.get("csv_id")
                    rec_info = check_reconciliation(
                        db,
                        tx_date=op_d,
                        tx_amount=raw_amt,
                        account_id=acc_id,
                        bank_label=lbl,
                        csv_id=c_id
                    )
                    if rec_info and rec_info.get("id"):
                        is_already = bool(rec_info.get("already_reconciled", False))
                        score = float(rec_info.get("match_score", 0) or 0)

                        # Si l'opération en face est déjà pointée dans le passé :
                        # une charge récurrente du mois précédent (écart >= 20 jours ou score < 85)
                        # ne doit pas être prise pour un doublon bloquant
                        is_past_cycle = False
                        if is_already:
                            matched_tx = db.query(Transaction).filter(Transaction.id == rec_info["id"]).first()
                            if matched_tx and matched_tx.date_operation:
                                delta_days = abs((op_d - matched_tx.date_operation).days)
                                if delta_days >= 20 or score < 85:
                                    is_past_cycle = True

                        if not is_past_cycle:
                            tx["is_reconciled"] = True
                            tx["already_reconciled"] = is_already
                            tx["matched_db_id"] = rec_info["id"]
                            tx["match_score"] = score
                            tx["collision_detected"] = rec_info.get("collision_detected", False)
                            tx["is_amount_deviant"] = rec_info.get("is_amount_deviant", False)
                            tx["original_forecast_amount"] = rec_info.get("original_forecast_amount")
    except Exception as rec_eval_err:
        logger.debug(f"[AutoPilot] Évaluation réconciliation non appliquée: {rec_eval_err}")

    # 3. Indexer les csv_id existants en base et les catégories valides
    from app.models import Category
    existing_csv_ids = set(
        row[0] for row in db.query(Transaction.csv_id).filter(Transaction.csv_id.isnot(None)).all()
    )
    valid_categories = {c.name for c in db.query(Category.name).all() if c.name}

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

                # Critère 1 : Auto-rapprochement haute certitude (Score >= 85, sans collision, non venant)
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
                        if tx.get("is_amount_deviant"):
                            raw_val = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                            existing.amount = abs(raw_val)
                            orig_amt = tx.get("original_forecast_amount")
                            if not existing.comment and orig_amt is not None:
                                existing.comment = f"Auto-ajusté : {orig_amt:.2f} € → {existing.amount:.2f} €"

                        if tx.get("csv_id"):
                            existing.csv_id = tx["csv_id"]
                        if tx.get("category"):
                            existing.category = tx["category"]
                        if tx.get("description"):
                            existing.description = tx["description"]

                        # Historisation Undo/Redo
                        record_action(
                            db,
                            "transaction",
                            existing.id,
                            "UPDATE",
                            before_snap,
                            snapshot_entity(existing),
                            user_name="Automatisme (Rapprochement)"
                        )

                        # Journalisation de la décision Auto-Pilote
                        snap_payload = {
                            "bank_tx": {
                                k: v for k, v in tx.items()
                                if not k.startswith("_") and not isinstance(v, (datetime, date))
                            },
                            "matched_db_id": existing.id,
                            "is_amount_deviant": tx.get("is_amount_deviant", False),
                            "original_amount": tx.get("original_forecast_amount"),
                            "actual_amount": existing.amount,
                            "before": before_snap,
                            "after": snapshot_entity(existing)
                        }

                        decision = AutopilotDecisionLog(
                            batch_id=batch_id,
                            decision_type="reconciliation",
                            action="AUTO_RECONCILED_DEVIANT" if tx.get("is_amount_deviant") else "AUTO_COMMIT",
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
                        continue

                # Critère 2 : Auto-commit des nouvelles dépenses et recettes courantes (Jalons 3.8 & 3.5)
                # Non rapprochée, non venant, compte cible identifié, non doublon csv_id,
                # catégorie valide présente (existante, fallback ou IA validée), non ignorée, et confiance >= 85%
                csv_id = tx.get("csv_id")
                is_duplicate = bool(csv_id and csv_id in existing_csv_ids)
                category = tx.get("category")
                is_multi_cat = bool(tx.get("smart_is_multi_category", False))
                is_provisional = bool(tx.get("smart_is_provisional", False))
                is_ignored = tx.get("smart_source") == "ignored" or tx.get("is_ignored", False)
                is_fallback = bool(tx.get("smart_is_fallback", False))
                is_new_cat = bool(tx.get("smart_is_new_category", False))
                confidence = float(tx.get("smart_confidence") or 0.0)

                has_valid_category = bool(category and (category in valid_categories or is_fallback or is_new_cat))

                # Déterminer la raison de la décision pour le Decision Feed
                decision_reason = "rule"
                if is_fallback:
                    decision_reason = "chameleon_default" if is_multi_cat else "fallback_catchall"
                elif is_new_cat:
                    decision_reason = "chameleon_ai" if is_multi_cat else "ai_new_category"
                elif tx.get("smart_source") == "ai":
                    decision_reason = "chameleon_ai" if is_multi_cat else "ai_existing"
                elif tx.get("smart_source") == "history":
                    decision_reason = "history"
                elif is_provisional:
                    decision_reason = "provisional_auto_commit"
                elif is_multi_cat:
                    decision_reason = "chameleon_default"

                is_eligible_new_entry = (
                    not is_rec
                    and matched_id is None
                    and not is_coming
                    and bool(acc_id)
                    and not is_duplicate
                    and has_valid_category
                    and not is_ignored
                    and confidence >= 0.85
                )

                if is_eligible_new_entry:
                    raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                    amt = abs(float(tx.get("amount", 0.0) or raw_amt))
                    t_type = "expense_var" if raw_amt < 0 else "income"
                    from_acc = acc_id if raw_amt < 0 else None
                    to_acc = acc_id if raw_amt >= 0 else None

                    # S'assurer de la présence de la catégorie en base SQLite
                    from app.services.smart_label_service import ensure_category_exists
                    if category:
                        ensure_category_exists(db, category, t_type)
                        valid_categories.add(category)

                    op_date_str = tx.get("date_operation") or tx.get("date")
                    op_date = date.today()
                    if op_date_str:
                        s = str(op_date_str).strip()[:10]
                        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d", "%d-%m-%Y"):
                            try:
                                op_date = datetime.strptime(s, fmt).date()
                                break
                            except ValueError:
                                pass

                    new_tx = Transaction(
                        csv_id=csv_id,
                        date_saisie=date.today(),
                        date_operation=op_date,
                        description=tx.get("description") or "Opération bancaire",
                        amount=amt,
                        type=t_type,
                        category=category,
                        reconciliation_date=date.today(),
                        from_account_id=from_acc,
                        to_account_id=to_acc,
                        attachments=tx.get("attachments"),
                        check_slip_number=tx.get("check_slip_number"),
                        created_by="Automatisme (Écriture)"
                    )
                    db.add(new_tx)
                    db.flush()
                    if csv_id:
                        existing_csv_ids.add(csv_id)

                    # Historisation Undo/Redo
                    record_action(
                        db,
                        "transaction",
                        new_tx.id,
                        "CREATE",
                        None,
                        snapshot_entity(new_tx),
                        user_name="Automatisme (Rapprochement)"
                    )

                    # Journalisation de la décision Auto-Pilote
                    snap_payload = {
                        "bank_tx": {
                            k: v for k, v in tx.items()
                            if not k.startswith("_") and not isinstance(v, (datetime, date))
                        },
                        "created_tx_id": new_tx.id,
                        "decision_reason": decision_reason,
                        "before": None,
                        "after": snapshot_entity(new_tx)
                    }


                    decision = AutopilotDecisionLog(
                        batch_id=batch_id,
                        decision_type="new_entry",
                        action="AUTO_COMMIT",
                        entity_type="transaction",
                        entity_id=new_tx.id,
                        conn_id=conn_id if conn_id != CSV_IMPORT_CONN_ID else None,
                        account_id=acc_id,
                        raw_snapshot=json.dumps(snap_payload, default=str),
                        confidence_score=round(confidence * 100, 1) if confidence <= 1.0 else confidence,
                        is_undone=False
                    )
                    db.add(decision)
                    auto_committed_count += 1

                    # Auto-apprentissage transparent pour conforter la règle
                    raw_lbl = tx.get("raw_description") or tx.get("raw_label") or tx.get("description")
                    if raw_lbl and new_tx.description:
                        try:
                            from app.services.smart_label_service import learn_label_mapping
                            learn_label_mapping(
                                db,
                                raw_label=raw_lbl,
                                clean_description=new_tx.description,
                                category=new_tx.category,
                                is_manual=False
                            )
                        except Exception as ex_learn:
                            logger.debug(f"[AutoPilot] Ignoré échec apprentissage: {ex_learn}")

                    continue

                # Critère 3 : Opération en zone d'arbitrage ou à venir -> maintien dans le Sas
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

        # 4. Étape 4 & 4.5 Auto-Pilote : Détection périodique des récurrences, promotions & cycle de vie
        promoted_recurrences = 0
        try:
            from app.services.recurrence_detector import process_recurrence_promotions, process_auto_skipping
            for acc in preview_data.get("accounts", []):
                acc_id = acc.get("account_id")
                if acc_id:
                    res_promo = process_recurrence_promotions(db, acc_id, profile_id=pid, batch_id=batch_id)
                    promoted_recurrences += res_promo.get("promoted_templates", 0)
                    process_auto_skipping(db, acc_id, bank_balance=acc.get("bank_balance"), profile_id=pid, batch_id=batch_id)
        except Exception as promo_err:
            logger.warning(f"[AutoPilot] Avertissement lors de la détection/promotion des récurrences: {promo_err}")

        # 5. Étape 5 Auto-Pilote : Détection et suggestions/création d'enveloppes budgétaires
        try:
            from app.services.budget_service import suggest_new_envelopes
            suggest_new_envelopes(db, profile_id_or_force=pid, force=True)
        except Exception as budget_err:
            logger.warning(f"[AutoPilot] Avertissement lors de la suggestion budgets: {budget_err}")

        logger.info(
            f"[AutoPilot] Lot {batch_id} validé avec succès : "
            f"{auto_reconciled_count} auto-rapprochées, {auto_committed_count} créées, {pending_count} en attente, {promoted_recurrences} récurrences promues (total {total_count})."
        )

        return {
            "batch_id": batch_id,
            "status": "completed",
            "auto_reconciled": auto_reconciled_count,
            "auto_committed": auto_committed_count,
            "pending": pending_count,
            "total": total_count,
            "promoted_recurrences": promoted_recurrences
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
