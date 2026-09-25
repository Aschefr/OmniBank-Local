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
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models import (
    GlobalConfig,
    Transaction,
    AutopilotDecisionLog,
    Account,
    Budget,
    BudgetCategory,
    RecurrenceTemplate,
    BankConnection,
    Category,
)
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
    # Étape 5.5 : Automatismes Opérations & Catégories
    "auto_reconcile_transactions",
    "auto_commit_incoming_transactions",
    "auto_close_empty_import_sas",
    "auto_create_missing_categories",
    "auto_learn_merchant_rules",
    "auto_assign_chameleon_fallback",
    "bank_auto_sync_enabled",
    "auto_reconcile_threshold",
)


def get_auto_reconcile_threshold(db: Session) -> float:
    """Retourne le seuil de certitude pour l'auto-rapprochement et l'auto-commit (70.0 - 99.0, défaut 85.0)."""
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_reconcile_threshold").first()
    if cfg and cfg.value:
        try:
            val = float(cfg.value)
            return max(70.0, min(99.0, val))
        except (ValueError, TypeError):
            pass
    return 85.0


def set_auto_reconcile_threshold(db: Session, threshold: float, apply_to_existing: bool = False) -> tuple[float, int]:
    """Met à jour le seuil de tolérance (borné entre 70.0 et 99.0) et applique optionnellement aux opérations existantes."""
    val = round(max(70.0, min(99.0, float(threshold))), 1)
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_reconcile_threshold").first()
    if not cfg:
        db.add(GlobalConfig(key="auto_reconcile_threshold", value=str(val)))
    else:
        cfg.value = str(val)

    applied_count = 0
    if apply_to_existing:
        from app.models import Transaction
        txs = db.query(Transaction).filter(Transaction.confidence_score.isnot(None)).all()
        for t in txs:
            score = t.confidence_score or 0.0
            old_needs_review = t.needs_review
            new_needs_review = (score < val)
            if old_needs_review != new_needs_review:
                t.needs_review = new_needs_review
                applied_count += 1

    db.commit()
    return val, applied_count


def _get_cfg_bool(db: Session, key: str, default: bool = False) -> bool:
    """Helper pour lire un booléen depuis GlobalConfig."""
    try:
        cfg = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        if not cfg or not cfg.value:
            return default
        return cfg.value.strip().lower() in ("true", "1", "yes", "on")
    except Exception:
        return default


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

        # Activation en cascade des briques de suggestions essentielles et des automatismes
        cascade_keys = (
            "enable_budget_creation_suggestions",
            "enable_budget_recalibration_suggestions",
            "auto_reconcile_transactions",
            "auto_commit_incoming_transactions",
            "auto_close_empty_import_sas",
            "auto_create_missing_categories",
            "auto_learn_merchant_rules",
            "auto_assign_chameleon_fallback",
        )
        for sub_key in cascade_keys:
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


def set_autopilot_subtoggle(db: Session, key: str, enabled: bool) -> bool:
    """Active ou désactive une brique élémentaire d'autonomie dans GlobalConfig."""
    if key not in AUTOPILOT_MANAGED_KEYS and key != "bank_auto_sync_enabled":
        raise ValueError(f"Clé d'automatisme inconnue : {key}")

    val_str = "true" if enabled else "false"
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    if not cfg:
        cfg = GlobalConfig(key=key, value=val_str)
        db.add(cfg)
    else:
        cfg.value = val_str

    # Si un snapshot des préférences existe, le maintenir à jour
    snap_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "autopilot_subtoggles_pre_activation_snapshot").first()
    if snap_cfg and snap_cfg.value:
        try:
            snap = json.loads(snap_cfg.value)
            snap[key] = val_str
            snap_cfg.value = json.dumps(snap)
        except Exception:
            pass

    db.commit()
    logger.info(f"[AutoPilot] Brique élémentaire '{key}' mise à jour : {val_str}")
    return enabled


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

    ap_enabled = is_autopilot_enabled(db)
    cfg_auto_reconcile = ap_enabled or _get_cfg_bool(db, "auto_reconcile_transactions", False)
    cfg_auto_commit = ap_enabled or _get_cfg_bool(db, "auto_commit_incoming_transactions", False)
    cfg_auto_close_sas = ap_enabled or _get_cfg_bool(db, "auto_close_empty_import_sas", False)
    cfg_auto_create_cats = ap_enabled or _get_cfg_bool(db, "auto_create_missing_categories", False)
    cfg_auto_learn = ap_enabled or _get_cfg_bool(db, "auto_learn_merchant_rules", False)
    cfg_chameleon_fallback = ap_enabled or _get_cfg_bool(db, "auto_assign_chameleon_fallback", False)

    # 1. Si aucun automatisme n'est actif : délégation directe au Sas d'attente (comportement historique)
    if not (ap_enabled or cfg_auto_reconcile or cfg_auto_commit or cfg_auto_learn):
        save_pending_sync_data(db, conn_id, preview_data, profile_id=pid)
        total_txs = sum(len(a.get("transactions", [])) for a in preview_data.get("accounts", []))
        return {
            "batch_id": None,
            "status": "delegated_to_sas",
            "auto_reconciled": 0,
            "auto_committed": 0,
            "pending": total_txs,
            "total": total_txs,
            "categories_created": 0,
            "rules_learned": 0,
            "auto_close_sas": False
        }

    batch_id = str(uuid.uuid4())
    logger.info(f"[AutoPilot] Début du cycle d'ingestion autonome (lot {batch_id}, connexion={conn_id}, profil={pid})")
    threshold = get_auto_reconcile_threshold(db)

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
                            tx["smart_is_multi_category"] = res.get("is_multi_category", res.get("smart_is_multi_category", False))
                            tx["smart_is_fallback"] = res.get("is_fallback", res.get("smart_is_fallback", False))
                            tx["smart_is_new_category"] = res.get("is_new_category", res.get("smart_is_new_category", False))
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
                    tx["smart_confidence"] = max(float(tx.get("smart_confidence") or 0.0), threshold / 100.0)
    except Exception as sl_err:
        logger.warning(f"[AutoPilot] Avertissement lors de la résolution smart labels du lot: {sl_err}")

    # 2.B Évaluation du rapprochement pour les transactions non encore annotées
    try:
        from app.services.reconciliation_engine import check_reconciliation
        for acc in preview_data.get("accounts", []):
            acc_id = acc.get("account_id")
            for tx in acc.get("transactions", []):
                if not tx.get("is_reconciled") and tx.get("matched_db_id") is None:
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
                        is_coming=bool(tx.get("is_coming", False)),
                        bank_label=lbl,
                        csv_id=c_id
                    )
                    if rec_info and rec_info.get("id"):
                        is_already = bool(rec_info.get("already_reconciled", False))
                        score = float(rec_info.get("match_score", 0) or 0)
                        collision = bool(rec_info.get("collision_detected", False))
                        logger.info(
                            f"[AutoPilot] Évaluation rapprochement pour '{lbl}' ({raw_amt:.2f}€, {op_d}) : "
                            f"match_id={rec_info['id']}, score={score:.1f}, seuil={threshold}, "
                            f"already_reconciled={is_already}, collision={collision}"
                        )

                        # Si l'opération en face est déjà pointée dans le passé :
                        # une charge récurrente du mois précédent (écart > 2j pour coming ou > 7j pour confirmed, ou score < threshold)
                        # ne doit pas être prise pour un doublon bloquant
                        is_past_cycle = False
                        if is_already:
                            matched_tx = db.query(Transaction).filter(Transaction.id == rec_info["id"]).first()
                            if matched_tx and matched_tx.date_operation:
                                delta_days = abs((op_d - matched_tx.date_operation).days)
                                max_allowed = 2 if tx.get("is_coming") else 7
                                if delta_days > max_allowed or score < threshold:
                                    is_past_cycle = True
                                    logger.info(
                                        f"[AutoPilot] → Ignoré (cycle passé) : delta_jours={delta_days} > {max_allowed}, score={score:.1f} < seuil={threshold}"
                                    )

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
    needs_review_count = 0
    categories_created_count = 0
    rules_learned_count = 0
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
                csv_id = tx.get("csv_id")

                # Critère 0 : Opération bancaire déjà enregistrée en base (historique pointé ou opération à venir déjà traitée/liée)
                if is_rec and already_rec:
                    continue
                if csv_id and csv_id in existing_csv_ids:
                    continue

                # Critère 1 : Auto-rapprochement (Haute certitude directe ou Rapprochement avec revue post-action)
                is_eligible_reconciliation = (
                    cfg_auto_reconcile
                    and is_rec
                    and not already_rec
                    and matched_id is not None
                    and match_score >= 60.0
                    and not collision_detected
                )

                if is_rec and not is_eligible_reconciliation:
                    lbl = tx.get("raw_description") or tx.get("description") or "?"
                    reasons = []
                    if not cfg_auto_reconcile: reasons.append("auto_reconcile désactivé")
                    if already_rec: reasons.append("already_reconciled")
                    if matched_id is None: reasons.append("pas de matched_db_id")
                    if match_score < 60.0: reasons.append(f"score={match_score:.1f} < 60")
                    if collision_detected: reasons.append("collision détectée")
                    logger.info(f"[AutoPilot] ⏭ Non éligible auto-rapprochement pour '{lbl}' : {', '.join(reasons)}")

                if is_eligible_reconciliation:
                    existing = db.query(Transaction).filter(Transaction.id == matched_id).first()
                    if existing and existing.reconciliation_date is None:
                        before_snap = snapshot_entity(existing)
                        is_confident = (match_score >= threshold)
                        rec_needs_review = not is_confident
                        if rec_needs_review:
                            needs_review_count += 1
                            existing.needs_review = True
                            existing.confidence_score = match_score

                        # Appliquer le pointage uniquement si l'opération est confirmée (débitée)
                        # Pour une opération à venir (is_coming), la transaction reste prévisionnelle (reconciliation_date=None)
                        # mais est liée au csv_id bancaire pour être pointée dès réception du débit officiel.
                        if not is_coming:
                            existing.reconciliation_date = date.today()

                        if tx.get("is_amount_deviant"):
                            raw_val = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                            existing.amount = abs(raw_val)
                            orig_amt = tx.get("original_forecast_amount")
                            if not existing.comment and orig_amt is not None:
                                existing.comment = f"Auto-ajusté : {orig_amt:.2f} € → {existing.amount:.2f} €"

                        if tx.get("csv_id"):
                            existing.csv_id = tx["csv_id"]
                            existing_csv_ids.add(tx["csv_id"])
                        if tx.get("category") and not existing.category:
                            existing.category = tx["category"]
                        if tx.get("raw_description") or tx.get("description"):
                            existing.raw_description = tx.get("raw_description") or tx.get("description")
                        if not existing.description and tx.get("description"):
                            existing.description = tx["description"]

                        # Historisation Undo/Redo
                        creator_user = "Automatisme (Liaison à venir)" if is_coming else ("Automatisme (Rapprochement)" if is_confident else "Automatisme (Rapprochement à vérifier)")
                        record_action(
                            db,
                            "transaction",
                            existing.id,
                            "UPDATE",
                            before_snap,
                            snapshot_entity(existing),
                            user_name=creator_user
                        )

                        # Journalisation de la décision Auto-Pilote
                        snap_payload = {
                            "bank_tx": {
                                k: v for k, v in tx.items()
                                if not k.startswith("_") and not isinstance(v, (datetime, date))
                            },
                            "matched_db_id": existing.id,
                            "forecast_description": existing.description,
                            "is_amount_deviant": tx.get("is_amount_deviant", False),
                            "is_coming": is_coming,
                            "needs_review": rec_needs_review,
                            "original_amount": tx.get("original_forecast_amount"),
                            "actual_amount": existing.amount,
                            "before": before_snap,
                            "after": snapshot_entity(existing)
                        }

                        if is_coming:
                            dec_action = "LINKED_COMING" if is_confident else "LINKED_COMING_PENDING_REVIEW"
                        elif tx.get("is_amount_deviant"):
                            dec_action = "AUTO_RECONCILED_DEVIANT" if is_confident else "AUTO_RECONCILED_DEVIANT_PENDING_REVIEW"
                        else:
                            dec_action = "AUTO_COMMIT" if is_confident else "AUTO_COMMIT_PENDING_REVIEW"

                        decision = AutopilotDecisionLog(
                            batch_id=batch_id,
                            decision_type="reconciliation",
                            action=dec_action,
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

                # Critère 2 : Auto-commit des nouvelles dépenses et recettes courantes
                csv_id = tx.get("csv_id")
                is_duplicate = bool(csv_id and csv_id in existing_csv_ids)
                category = tx.get("category")
                is_multi_cat = bool(tx.get("smart_is_multi_category", False))
                is_provisional = bool(tx.get("smart_is_provisional", False))
                is_ignored = tx.get("smart_source") == "ignored" or tx.get("is_ignored", False)
                is_fallback = bool(tx.get("smart_is_fallback", False))
                is_new_cat = bool(tx.get("smart_is_new_category", False)) or (bool(category) and category not in valid_categories)
                confidence = float(tx.get("smart_confidence") or tx.get("confidence") or 0.0)

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

                chameleon_blocked = is_multi_cat and not cfg_chameleon_fallback and not tx.get("smart_is_manual")
                
                # Éligibilité Full-Auto : Toute nouvelle opération bancaire (confirmée ou à venir non rapprochée)
                is_eligible_new_entry = (
                    cfg_auto_commit
                    and not is_rec
                    and matched_id is None
                    and bool(acc_id)
                    and not is_duplicate
                )

                if is_eligible_new_entry:
                    raw_amt = float(tx.get("raw_amount") if tx.get("raw_amount") is not None else (tx.get("amount") or 0.0))
                    amt = abs(float(tx.get("amount", 0.0) or raw_amt))
                    t_type = "expense_var" if raw_amt < 0 else "income"
                    from_acc = acc_id if raw_amt < 0 else None
                    to_acc = acc_id if raw_amt >= 0 else None

                    # Évaluation du niveau de confiance / besoin de revue utilisateur
                    is_reliable = (
                        not chameleon_blocked
                        and not is_ignored
                        and has_valid_category
                        and confidence >= (threshold / 100.0)
                    )
                    needs_review = not is_reliable
                    if needs_review:
                        needs_review_count += 1

                    # S'assurer de la présence et de la cohérence de type de la catégorie en base SQLite
                    from app.services.smart_label_service import ensure_category_exists, resolve_fallback_category
                    if not category or not has_valid_category:
                        category = resolve_fallback_category(db, t_type)
                        is_fallback = True

                    if category:
                        existing_cat = db.query(Category).filter(Category.name == category.strip()).first()
                        # Garde-fou strict : une recette ne peut recevoir une catégorie de dépense, et inversement
                        if existing_cat and not is_fallback:
                            if t_type == "income" and existing_cat.type != "income":
                                logger.warning(f"[AutoPilot] Incohérence type catégorie '{category}' ({existing_cat.type}) pour recette. Repli automatique sur filet de sécurité.")
                                category = resolve_fallback_category(db, "income")
                                is_fallback = True
                                existing_cat = db.query(Category).filter(Category.name == category.strip()).first()
                            elif t_type != "income" and existing_cat.type == "income":
                                logger.warning(f"[AutoPilot] Incohérence type catégorie '{category}' (income) pour dépense. Repli automatique sur filet de sécurité.")
                                category = resolve_fallback_category(db, "expense_var")
                                is_fallback = True
                                existing_cat = db.query(Category).filter(Category.name == category.strip()).first()

                        if is_new_cat and not cfg_auto_create_cats:
                            # Repli forcé sur le filet de sécurité existant sans créer de catégorie
                            category = resolve_fallback_category(db, t_type)
                        else:
                            cat_obj = ensure_category_exists(db, category, t_type)
                            if not existing_cat and cat_obj:
                                categories_created_count += 1
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

                    raw_lbl = tx.get("raw_description") or tx.get("raw_label") or tx.get("description")
                    conf_score = round(confidence * 100, 1) if confidence <= 1.0 else confidence

                    # Pointage : aujourd'hui si opération confirmée, None si opération à venir
                    recon_date_val = None if is_coming else date.today()
                    creator_label = (
                        ("Automatisme (À venir)" if is_reliable else "Automatisme (À venir / À vérifier)")
                        if is_coming
                        else ("Automatisme (Écriture)" if is_reliable else "Automatisme (À vérifier)")
                    )

                    new_tx = Transaction(
                        csv_id=csv_id,
                        date_saisie=date.today(),
                        date_operation=op_date,
                        description=tx.get("description") or "Opération bancaire",
                        raw_description=raw_lbl,
                        amount=amt,
                        type=t_type,
                        category=category,
                        reconciliation_date=recon_date_val,
                        from_account_id=from_acc,
                        to_account_id=to_acc,
                        attachments=tx.get("attachments"),
                        check_slip_number=tx.get("check_slip_number"),
                        created_by=creator_label,
                        needs_review=needs_review,
                        confidence_score=conf_score
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
                        user_name="Automatisme (Rapprochement)" if not is_coming else "Automatisme (À venir)"
                    )

                    # Journalisation de la décision Auto-Pilote
                    snap_payload = {
                        "bank_tx": {
                            k: v for k, v in tx.items()
                            if not k.startswith("_") and not isinstance(v, (datetime, date))
                        },
                        "created_tx_id": new_tx.id,
                        "decision_reason": decision_reason,
                        "needs_review": needs_review,
                        "is_coming": is_coming,
                        "confidence_score": conf_score,
                        "before": None,
                        "after": snapshot_entity(new_tx)
                    }

                    if is_coming:
                        dec_act = "AUTO_COMMIT_COMING" if is_reliable else "AUTO_COMMIT_COMING_PENDING_REVIEW"
                    else:
                        dec_act = "AUTO_COMMIT" if is_reliable else "AUTO_COMMIT_PENDING_REVIEW"

                    decision = AutopilotDecisionLog(
                        batch_id=batch_id,
                        decision_type="new_entry",
                        action=dec_act,
                        entity_type="transaction",
                        entity_id=new_tx.id,
                        conn_id=conn_id if conn_id != CSV_IMPORT_CONN_ID else None,
                        account_id=acc_id,
                        raw_snapshot=json.dumps(snap_payload, default=str),
                        confidence_score=conf_score,
                        is_undone=False
                    )
                    db.add(decision)
                    auto_committed_count += 1

                    # Auto-apprentissage transparent pour conforter la règle uniquement si fiable
                    if cfg_auto_learn and is_reliable:
                        raw_lbl = tx.get("raw_description") or tx.get("raw_label") or tx.get("description")
                        if raw_lbl and new_tx.description:
                            try:
                                from app.services.smart_label_service import learn_label_mapping
                                learned_rule = learn_label_mapping(
                                    db,
                                    raw_label=raw_lbl,
                                    clean_description=new_tx.description,
                                    category=new_tx.category,
                                    is_manual=False
                                )
                                if learned_rule:
                                    rules_learned_count += 1
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
            "needs_review": needs_review_count,
            "pending": pending_count,
            "total": total_count,
            "categories_created": categories_created_count,
            "rules_learned": rules_learned_count,
            "promoted_recurrences": promoted_recurrences,
            "auto_close_sas": bool(cfg_auto_close_sas and pending_count == 0)
        }

    except Exception as e:
        db.rollback()
        logger.error(f"[AutoPilot] Échec critique lors du traitement du lot {batch_id}: {e}", exc_info=True)
        try:
            save_pending_sync_data(db, conn_id, preview_data, profile_id=pid)
        except Exception:
            pass
        raise e


def get_autopilot_status(db: Session, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Retourne l'état complet du mode Auto-Pilote, de ses sous-options, du seuil, et des timings d'exécution."""
    from app.services.bank_sync_scheduler import is_background_sync_running
    from app.services.bank_sync.auto_sync import get_auto_sync_cooldown_status
    from app.services.credential_vault import VaultSessionManager
    from datetime import timedelta

    pid = _resolve_profile_id(profile_id)
    enabled = is_autopilot_enabled(db)
    threshold = get_auto_reconcile_threshold(db)

    subtoggles = {}
    for k in AUTOPILOT_MANAGED_KEYS:
        if k == "auto_reconcile_threshold":
            continue
        cfg = db.query(GlobalConfig).filter(GlobalConfig.key == k).first()
        subtoggles[k] = bool(cfg and cfg.value and cfg.value.strip().lower() in ("true", "1", "yes", "on"))

    cfg_last_run = db.query(GlobalConfig).filter(GlobalConfig.key == "last_budget_autopilot_run_at").first()
    last_run_str = cfg_last_run.value if cfg_last_run else None

    cfg_last_visit = db.query(GlobalConfig).filter(GlobalConfig.key == "autopilot_last_visit_at").first()
    last_visit_str = cfg_last_visit.value if cfg_last_visit else None

    unseen_query = db.query(AutopilotDecisionLog)
    if last_visit_str:
        try:
            visit_dt = datetime.fromisoformat(last_visit_str)
            unseen_query = unseen_query.filter(AutopilotDecisionLog.created_at > visit_dt)
        except Exception:
            pass
    unseen_count = unseen_query.filter(AutopilotDecisionLog.is_undone == False).count()

    seen_ids_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "autopilot_seen_review_tx_ids").first()
    seen_ids = set()
    if seen_ids_cfg and seen_ids_cfg.value:
        try:
            seen_ids = set(json.loads(seen_ids_cfg.value))
        except Exception:
            pass

    current_review_txs = db.query(Transaction.id).filter(Transaction.needs_review == True).all()
    current_review_ids = {t[0] for t in current_review_txs}
    unseen_review_ids = current_review_ids - seen_ids
    unseen_review_count = len(unseen_review_ids)
    review_queue_count = len(current_review_ids)

    is_syncing = is_background_sync_running(profile_id=pid)

    # 1. Dernière exécution automatique constatée (décision loguée, synchro ou budget)
    latest_decision = db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.is_undone == False
    ).order_by(AutopilotDecisionLog.created_at.desc()).first()

    exec_timestamps = []
    if latest_decision and latest_decision.created_at:
        dt_dec = latest_decision.created_at
        if dt_dec.tzinfo is None:
            dt_dec = dt_dec.replace(tzinfo=timezone.utc)
        exec_timestamps.append(dt_dec)

    cfg_last_sync_att = db.query(GlobalConfig).filter(GlobalConfig.key == "last_auto_sync_attempt").first()
    if cfg_last_sync_att and cfg_last_sync_att.value:
        try:
            dt_sync = datetime.fromisoformat(cfg_last_sync_att.value)
            if dt_sync.tzinfo is None:
                dt_sync = dt_sync.replace(tzinfo=timezone.utc)
            exec_timestamps.append(dt_sync)
        except Exception:
            pass

    for conn in db.query(BankConnection).all():
        if conn.last_sync_at:
            dt_conn = conn.last_sync_at
            if dt_conn.tzinfo is None:
                dt_conn = dt_conn.replace(tzinfo=timezone.utc)
            exec_timestamps.append(dt_conn)

    if last_run_str:
        try:
            dt_bud = datetime.fromisoformat(last_run_str)
            if dt_bud.tzinfo is None:
                dt_bud = dt_bud.replace(tzinfo=timezone.utc)
            exec_timestamps.append(dt_bud)
        except Exception:
            pass

    last_execution_str = max(exec_timestamps).isoformat() if exec_timestamps else (last_run_str or None)

    # 2. Prochaine exécution automatique planifiée (relevé bancaire programmé ou tâche périodique)
    cfg_auto_sync = db.query(GlobalConfig).filter(GlobalConfig.key == "bank_auto_sync_enabled").first()
    auto_sync_enabled_val = bool(cfg_auto_sync and cfg_auto_sync.value and cfg_auto_sync.value.strip().lower() in ("true", "1", "yes", "on"))

    vault_unlocked = bool(VaultSessionManager.get_password(profile_id=pid))

    next_execution_at = None
    next_execution_type = "on_demand"
    next_execution_countdown_seconds = None

    if auto_sync_enabled_val:
        cooldown = get_auto_sync_cooldown_status(db, pid)
        cfg_interval = db.query(GlobalConfig).filter(GlobalConfig.key == "bank_auto_sync_interval_hours").first()
        try:
            interval_hours = int(cfg_interval.value) if cfg_interval and cfg_interval.value else 24
        except Exception:
            interval_hours = 24

        active_conns = db.query(BankConnection).filter(BankConnection.is_active == True).all()
        valid_conns = [c for c in active_conns if c.account_mapping and c.account_mapping.strip() not in ("", "{}", "null")]

        if valid_conns:
            now_utc = datetime.now(timezone.utc)
            target_times = []
            for c in valid_conns:
                if not c.last_sync_at:
                    t = now_utc
                else:
                    ls = c.last_sync_at
                    if ls.tzinfo is None:
                        ls = ls.replace(tzinfo=timezone.utc)
                    t = ls + timedelta(hours=interval_hours)

                if cooldown.get("cooldown_active") and cooldown.get("remaining_seconds", 0) > 0:
                    t = max(t, now_utc + timedelta(seconds=cooldown["remaining_seconds"]))
                target_times.append(t)

            if target_times:
                earliest_target = min(target_times)
                rem_sec = max(0, int((earliest_target - now_utc).total_seconds()))
                next_execution_at = earliest_target.isoformat()
                next_execution_countdown_seconds = rem_sec
                next_execution_type = "bank_sync"

    return {
        "is_enabled": enabled,
        "threshold": threshold,
        "managed_subtoggles": subtoggles,
        "last_run_at": last_run_str,
        "last_visit_at": last_visit_str,
        "unseen_decisions_count": unseen_count,
        "review_queue_count": review_queue_count,
        "unseen_review_count": unseen_review_count,
        "is_syncing": is_syncing,
        "last_execution_at": last_execution_str,
        "next_execution_at": next_execution_at,
        "next_execution_type": next_execution_type,
        "next_execution_countdown_seconds": next_execution_countdown_seconds,
        "bank_auto_sync_enabled": auto_sync_enabled_val,
        "vault_unlocked": vault_unlocked,
    }


def get_autopilot_kpis(db: Session, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Calcule les indicateurs clés de performance (KPIs) de l'Auto-Pilote."""
    total_decisions = db.query(AutopilotDecisionLog).count()
    undone_decisions = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.is_undone == True).count()

    active_decisions = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.is_undone == False)

    auto_reconciled = active_decisions.filter(AutopilotDecisionLog.decision_type == "reconciliation").count()
    auto_committed = active_decisions.filter(AutopilotDecisionLog.decision_type == "new_entry").count()
    promoted_recurrences = active_decisions.filter(AutopilotDecisionLog.decision_type.in_(["recurrence_promotion", "recurrence_hike"])).count()
    budget_mutations = active_decisions.filter(AutopilotDecisionLog.decision_type.in_(["budget_suggestion", "budget_creation_suggestion"])).count()

    accuracy_rate = 100.0
    if total_decisions > 0:
        accuracy_rate = round(((total_decisions - undone_decisions) / total_decisions) * 100, 1)

    # Estimation réaliste du temps épargné (en heures)
    # Rapprochement: 1.5 min, Écriture: 1.0 min, Récurrence: 3.0 min, Budget: 2.5 min
    minutes_saved = (
        auto_reconciled * 1.5 +
        auto_committed * 1.0 +
        promoted_recurrences * 3.0 +
        budget_mutations * 2.5
    )
    hours_saved = round(minutes_saved / 60.0, 1)

    return {
        "total_decisions": total_decisions,
        "auto_reconciled": auto_reconciled,
        "auto_committed": auto_committed,
        "promoted_recurrences": promoted_recurrences,
        "budget_mutations": budget_mutations,
        "undone_decisions": undone_decisions,
        "accuracy_rate": accuracy_rate,
        "hours_saved_estimate": hours_saved
    }


def get_autopilot_decisions_feed(
    db: Session,
    limit: int = 50,
    offset: int = 0,
    decision_type: Optional[str] = None,
    batch_id: Optional[str] = None,
    show_undone: bool = True
) -> Dict[str, Any]:
    """Retourne le flux des décisions prises par l'Auto-Pilote avec pagination et filtres."""
    query = db.query(AutopilotDecisionLog)
    if decision_type:
        query = query.filter(AutopilotDecisionLog.decision_type == decision_type)
    if batch_id:
        query = query.filter(AutopilotDecisionLog.batch_id == batch_id)
    if not show_undone:
        query = query.filter(AutopilotDecisionLog.is_undone == False)

    total = query.count()
    decisions = query.order_by(AutopilotDecisionLog.created_at.desc()).offset(offset).limit(limit).all()

    acc_map = {acc.id: acc.name for acc in db.query(Account).all()}

    tx_ids = [d.entity_id for d in decisions if d.entity_type == "transaction" and d.entity_id]
    tx_map = {}
    if tx_ids:
        tx_records = db.query(Transaction).filter(Transaction.id.in_(tx_ids)).all()
        tx_map = {t.id: t for t in tx_records}

    items = []
    for d in decisions:
        snap = {}
        if d.raw_snapshot:
            try:
                snap = json.loads(d.raw_snapshot)
            except Exception:
                pass

        live_tx = tx_map.get(d.entity_id) if (d.entity_type == "transaction" and d.entity_id) else None

        bank_tx = snap.get("bank_tx") or {}
        raw_amt = bank_tx.get("raw_amount")
        if raw_amt is None:
            raw_amt = (
                (live_tx.amount if live_tx else None)
                or bank_tx.get("amount")
                or snap.get("actual_amount")
                or snap.get("suggested_amount")
                or snap.get("new_amount")
                or snap.get("additional_amount")
                or snap.get("amount_delta")
                or snap.get("amount")
                or 0.0
            )

        lbl = (
            (live_tx.description if live_tx else None)
            or snap.get("forecast_description")
            or (snap.get("after") or {}).get("description")
            or bank_tx.get("description")
            or snap.get("merchant")
            or snap.get("template_description")
            or snap.get("budget_name")
            or snap.get("name")
            or "Décision Auto-Pilote"
        )
        raw_lbl = bank_tx.get("raw_description") or bank_tx.get("raw_label") or (live_tx.raw_description if live_tx else None) or snap.get("raw_pattern")
        
        # Résolution enrichie de la catégorie
        cat = (
            (live_tx.category if live_tx else None)
            or (snap.get("after") or {}).get("category")
            or bank_tx.get("category")
            or snap.get("category")
            or snap.get("new_category")
            or (", ".join(snap.get("categories")[:3]) if isinstance(snap.get("categories"), list) and snap.get("categories") else None)
            or "—"
        )
        reason = (
            snap.get("decision_reason")
            or ("linked_forecast" if (live_tx and live_tx.raw_description and d.decision_type == "reconciliation") else None)
            or ("deviant_reconciled" if d.action == "AUTO_RECONCILED_DEVIANT" else None)
            or snap.get("capped_reason")
        )

        items.append({
            "id": d.id,
            "batch_id": d.batch_id,
            "decision_type": d.decision_type,
            "action": d.action,
            "entity_type": d.entity_type,
            "entity_id": d.entity_id,
            "conn_id": d.conn_id,
            "account_id": d.account_id,
            "account_name": acc_map.get(d.account_id),
            "label": lbl,
            "raw_label": raw_lbl,
            "amount": float(raw_amt),
            "category": cat,
            "confidence_score": d.confidence_score,
            "reason": reason,
            "is_undone": d.is_undone,
            "undone_at": d.undone_at,
            "created_at": d.created_at,
            "details": snap
        })

    return {
        "items": items,
        "total": total,
        "offset": offset,
        "limit": limit
    }


def rollback_autopilot_decision(db: Session, decision_id: int, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Annule sémantiquement une décision spécifique enregistrée dans AutopilotDecisionLog."""
    pid = _resolve_profile_id(profile_id)
    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == decision_id).first()
    if not decision:
        raise ValueError(f"Décision #{decision_id} introuvable.")
    if decision.is_undone:
        return {"success": True, "message": "Décision déjà annulée."}

    snap = {}
    if decision.raw_snapshot:
        try:
            snap = json.loads(decision.raw_snapshot)
        except Exception:
            pass

    # 1. Traitement par type de décision
    if decision.decision_type == "new_entry":
        if decision.entity_id:
            tx = db.query(Transaction).filter(Transaction.id == decision.entity_id).first()
            if tx:
                before_s = snapshot_entity(tx)
                db.delete(tx)
                record_action(
                    db,
                    "transaction",
                    decision.entity_id,
                    "DELETE",
                    before_s,
                    None,
                    user_name="Rollback Auto-Pilote (Suppression Écriture)"
                )
    elif decision.decision_type == "reconciliation":
        if decision.entity_id:
            tx = db.query(Transaction).filter(Transaction.id == decision.entity_id).first()
            if tx:
                before_s = snapshot_entity(tx)
                tx.reconciliation_date = None
                orig_snap = snap.get("before") or {}
                if "amount" in orig_snap:
                    tx.amount = orig_snap["amount"]
                if "category" in orig_snap:
                    tx.category = orig_snap["category"]
                if "description" in orig_snap:
                    tx.description = orig_snap["description"]
                if "comment" in orig_snap:
                    tx.comment = orig_snap["comment"]
                record_action(
                    db,
                    "transaction",
                    tx.id,
                    "UPDATE",
                    before_s,
                    snapshot_entity(tx),
                    user_name="Rollback Auto-Pilote (Dépointage)"
                )
    elif decision.decision_type in ("recurrence_promotion", "recurrence_hike"):
        if decision.entity_id:
            tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == decision.entity_id).first()
            if tpl:
                if decision.decision_type == "recurrence_promotion":
                    db.query(Transaction).filter(Transaction.recurrence_id == tpl.id).update(
                        {"recurrence_id": None}, synchronize_session=False
                    )
                    db.delete(tpl)
                elif decision.decision_type == "recurrence_hike":
                    old_amt = snap.get("old_amount")
                    if old_amt is not None:
                        tpl.amount = float(old_amt)
                        from app.services.recurrence_detector import propagate_recurrence_update
                        propagate_recurrence_update(db, tpl.id)
    elif decision.decision_type in ("budget_suggestion", "budget_creation_suggestion"):
        if decision.entity_id:
            b = db.query(Budget).filter(Budget.id == decision.entity_id).first()
            if b:
                if decision.decision_type == "budget_creation_suggestion":
                    db.delete(b)
                else:
                    cur_amt = snap.get("current_amount")
                    if cur_amt is not None:
                        b.monthly_amount = float(cur_amt)

    decision.is_undone = True
    decision.undone_at = datetime.now(timezone.utc)
    db.commit()
    stats_cache.invalidate(pid)
    return {"success": True, "decision_id": decision_id, "message": "Décision annulée avec succès."}


def rollback_autopilot_cycle(db: Session, batch_id: str, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Rollback sémantique complet d'un lot d'ingestion.
    Annule toutes les décisions du lot et reconstitue le lot complet dans le Sas d'attente
    pour que l'utilisateur puisse arbitrer manuellement chaque opération.
    """
    pid = _resolve_profile_id(profile_id)
    decisions = (
        db.query(AutopilotDecisionLog)
        .filter(AutopilotDecisionLog.batch_id == batch_id, AutopilotDecisionLog.is_undone == False)
        .all()
    )
    if not decisions:
        return {
            "success": True,
            "batch_id": batch_id,
            "undone_count": 0,
            "reconstituted_in_sas": False,
            "message": "Aucune décision active à annuler pour ce cycle."
        }

    undone_count = 0
    grouped_txs = {}
    main_conn_id = None

    for d in decisions:
        snap = {}
        if d.raw_snapshot:
            try:
                snap = json.loads(d.raw_snapshot)
            except Exception:
                pass

        bank_tx = snap.get("bank_tx")
        acc_id = d.account_id or (bank_tx.get("account_id") if bank_tx else None)
        if d.conn_id is not None and main_conn_id is None:
            main_conn_id = d.conn_id

        if bank_tx and acc_id:
            if acc_id not in grouped_txs:
                grouped_txs[acc_id] = []
            grouped_txs[acc_id].append(bank_tx)

        # 1. Annulation sémantique individuelle
        if d.decision_type == "new_entry" and d.entity_id:
            tx = db.query(Transaction).filter(Transaction.id == d.entity_id).first()
            if tx:
                before_s = snapshot_entity(tx)
                db.delete(tx)
                record_action(
                    db, "transaction", d.entity_id, "DELETE", before_s, None,
                    user_name="Rollback Cycle Auto-Pilote"
                )
        elif d.decision_type == "reconciliation" and d.entity_id:
            tx = db.query(Transaction).filter(Transaction.id == d.entity_id).first()
            if tx:
                before_s = snapshot_entity(tx)
                tx.reconciliation_date = None
                orig_snap = snap.get("before") or {}
                if "amount" in orig_snap:
                    tx.amount = orig_snap["amount"]
                if "category" in orig_snap:
                    tx.category = orig_snap["category"]
                if "description" in orig_snap:
                    tx.description = orig_snap["description"]
                if "comment" in orig_snap:
                    tx.comment = orig_snap["comment"]
                record_action(
                    db, "transaction", tx.id, "UPDATE", before_s, snapshot_entity(tx),
                    user_name="Rollback Cycle Auto-Pilote (Dépointage)"
                )
        elif d.decision_type == "recurrence_promotion" and d.entity_id:
            tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == d.entity_id).first()
            if tpl:
                db.query(Transaction).filter(Transaction.recurrence_id == tpl.id).update(
                    {"recurrence_id": None}, synchronize_session=False
                )
                db.delete(tpl)

        d.is_undone = True
        d.undone_at = datetime.now(timezone.utc)
        undone_count += 1

    # Reconstitution du lot dans le Sas si des données de transactions bancaires ont été retrouvées
    reconstituted = False
    if grouped_txs:
        target_conn = main_conn_id if main_conn_id is not None else CSV_IMPORT_CONN_ID
        preview_data = {
            "batch_id": batch_id,
            "source": "rollback_reconstitution",
            "accounts": [
                {"account_id": aid, "transactions": txs_list}
                for aid, txs_list in grouped_txs.items()
            ]
        }
        save_pending_sync_data(db, target_conn, preview_data, profile_id=pid)
        reconstituted = True

    db.commit()
    stats_cache.invalidate(pid)

    return {
        "success": True,
        "batch_id": batch_id,
        "undone_count": undone_count,
        "reconstituted_in_sas": reconstituted,
        "message": f"Cycle {batch_id} annulé ({undone_count} décisions rétablies, Sas reconstitué: {'oui' if reconstituted else 'non'})."
    }


def override_autopilot_decision(
    db: Session,
    decision_id: int,
    new_category: Optional[str] = None,
    new_description: Optional[str] = None,
    new_amount: Optional[float] = None,
    learn_rule: bool = True,
    profile_id: Optional[str] = None
) -> Dict[str, Any]:
    """Modifie une décision prise par l'Auto-Pilote et apprend la règle pour consolider l'IA locale."""
    pid = _resolve_profile_id(profile_id)
    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id == decision_id).first()
    if not decision:
        raise ValueError(f"Décision #{decision_id} introuvable.")

    if decision.entity_type == "transaction" and decision.entity_id:
        tx = db.query(Transaction).filter(Transaction.id == decision.entity_id).first()
        if not tx:
            raise ValueError(f"Transaction #{decision.entity_id} introuvable.")

        before_snap = snapshot_entity(tx)
        if new_category:
            from app.services.smart_label_service import ensure_category_exists
            ensure_category_exists(db, new_category, tx.type or "expense_var")
            tx.category = new_category.strip()
        if new_description:
            tx.description = new_description.strip()
        if new_amount is not None:
            tx.amount = abs(float(new_amount))

        after_snap = snapshot_entity(tx)
        record_action(
            db,
            "transaction",
            tx.id,
            "UPDATE",
            before_snap,
            after_snap,
            user_name="Correction Utilisateur (Feed Auto-Pilote)"
        )

        learned_rule = None
        if learn_rule and tx.raw_description and (new_category or new_description):
            from app.services.smart_label_service import learn_label_mapping
            learned_rule = learn_label_mapping(
                db,
                raw_label=tx.raw_description,
                clean_description=tx.description,
                category=tx.category,
                is_manual=True
            )

        db.commit()
        stats_cache.invalidate(pid)
        return {
            "success": True,
            "decision_id": decision_id,
            "learned_rule": bool(learned_rule),
            "message": "Écriture mise à jour et règle apprise."
        }

    return {"success": False, "message": "Type d'entité non modifiable."}


def unpoint_autopilot_decision(db: Session, decision_id: int, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Dépointe spécifiquement une transaction auto-rapprochée et restaure son état d'origine."""
    return rollback_autopilot_decision(db, decision_id, profile_id=profile_id)


def mark_autopilot_visited(db: Session) -> str:
    """Met à jour l'horodatage de dernière consultation du Centre de Contrôle Auto-Pilote et acquitte les revues en attente."""
    now_iso = datetime.utcnow().isoformat()
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "autopilot_last_visit_at").first()
    if not cfg:
        db.add(GlobalConfig(key="autopilot_last_visit_at", value=now_iso))
    else:
        cfg.value = now_iso

    # Mémoriser les transactions actuellement en attente de revue comme "vues"
    current_review_txs = db.query(Transaction.id).filter(Transaction.needs_review == True).all()
    current_review_ids = [t[0] for t in current_review_txs]
    seen_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "autopilot_seen_review_tx_ids").first()
    if not seen_cfg:
        db.add(GlobalConfig(key="autopilot_seen_review_tx_ids", value=json.dumps(current_review_ids)))
    else:
        seen_cfg.value = json.dumps(current_review_ids)

    db.commit()
    return now_iso


def get_operations_automations_history(db: Session, limit: int = 5) -> List[Dict[str, Any]]:
    """Retourne l'historique des actions automatiques appliquées aux transactions (rapprochements et nouvelles écritures)."""
    decisions = (
        db.query(AutopilotDecisionLog)
        .filter(
            AutopilotDecisionLog.decision_type.in_(["reconciliation", "new_entry"]),
            AutopilotDecisionLog.action.in_(["AUTO_COMMIT", "AUTO_RECONCILED_DEVIANT"]),
            AutopilotDecisionLog.is_undone == False,
        )
        .order_by(AutopilotDecisionLog.created_at.desc())
        .limit(limit)
        .all()
    )
    results = []
    for d in decisions:
        snap = {}
        if d.raw_snapshot:
            try:
                snap = json.loads(d.raw_snapshot)
            except Exception:
                pass
        bank_tx = snap.get("bank_tx") or {}
        raw_amt = bank_tx.get("raw_amount")
        if raw_amt is None:
            raw_amt = bank_tx.get("amount") or 0.0
        results.append({
            "id": d.id,
            "decision_type": d.decision_type,
            "action": d.action,
            "label": bank_tx.get("description") or bank_tx.get("raw_description") or snap.get("after", {}).get("description") or "Opération bancaire",
            "amount": float(raw_amt),
            "category": bank_tx.get("category") or snap.get("after", {}).get("category") or "—",
            "confidence_score": d.confidence_score,
            "reason": snap.get("decision_reason") or ("deviant_reconciled" if d.action == "AUTO_RECONCILED_DEVIANT" else "high_confidence"),
            "created_at": d.created_at.isoformat() if d.created_at else None,
        })
    return results


def get_smart_labels_automations_history(db: Session, limit: int = 5) -> List[Dict[str, Any]]:
    """Retourne les dernières règles de correspondances bancaires apprises automatiquement."""
    from app.models import BankLabelMapping
    learned_rules = (
        db.query(BankLabelMapping)
        .filter(BankLabelMapping.is_manual == False)
        .order_by(BankLabelMapping.id.desc())
        .limit(limit)
        .all()
    )
    results = []
    for r in learned_rules:
        results.append({
            "id": r.id,
            "type": "learned_rule",
            "raw_pattern": r.raw_pattern,
            "clean_label": r.clean_description,
            "category": r.category or "—",
            "is_multi_category": bool(r.is_multi_category),
            "is_provisional": False,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    return results


# Alias pour conformité avec les spécifications de la roadmap
process_incoming_transactions_batch = process_incoming_batch


def find_candidate_forecasts_for_tx(db: Session, tx: Transaction, limit: int = 3) -> List[Dict[str, Any]]:
    """Cherche les transactions prévisionnelles non pointées candidates au rapprochement."""
    from datetime import timedelta
    acc_id = tx.from_account_id or tx.to_account_id
    if not acc_id or not tx.date_operation:
        return []

    start_d = tx.date_operation - timedelta(days=10)
    end_d = tx.date_operation + timedelta(days=10)

    is_exp = (tx.type != "income")

    query = db.query(Transaction).filter(
        Transaction.id != tx.id,
        Transaction.needs_review == False,
        Transaction.reconciliation_date == None,
        Transaction.date_operation >= start_d,
        Transaction.date_operation <= end_d,
    )
    if is_exp:
        query = query.filter(Transaction.from_account_id == acc_id)
    else:
        query = query.filter(Transaction.to_account_id == acc_id)

    candidates = query.all()
    results = []
    amt = float(tx.amount or 0.0)
    raw_desc = (tx.raw_description or tx.description or "").lower().strip()
    clean_desc = (tx.description or "").lower().strip()

    for c in candidates:
        c_amt = float(c.amount or 0.0)
        amt_diff = abs(c_amt - amt)
        date_diff = abs((c.date_operation - tx.date_operation).days)
        c_desc = (c.description or "").lower().strip()

        # Critères de pertinence stricte pour éviter les faux positifs (ex: Thai 17€ vs Carrefour 34€) :
        # 1. Écart de montant faible (<= 20% ou <= 2.00 €)
        # 2. OU similarité textuelle évidente entre libellés
        # 3. OU prévision récurrente sur montant proche (<= 25%)
        max_amt = max(amt, c_amt)
        rel_diff = (amt_diff / max_amt) if max_amt > 0 else 0.0
        has_close_amount = (rel_diff <= 0.20 or amt_diff <= 2.00)

        # Similarité textuelle basique
        has_text_match = bool(
            c_desc and len(c_desc) >= 3 and (
                c_desc in raw_desc or c_desc in clean_desc or
                raw_desc in c_desc or clean_desc in c_desc
            )
        )

        is_valid_candidate = False
        if has_close_amount:
            is_valid_candidate = True
        elif has_text_match and rel_diff <= 0.50:
            is_valid_candidate = True
        elif c.recurrence_id is not None and rel_diff <= 0.25:
            is_valid_candidate = True

        if not is_valid_candidate:
            continue

        results.append({
            "id": c.id,
            "description": c.description,
            "amount": c_amt,
            "category": c.category,
            "date_operation": c.date_operation.isoformat() if c.date_operation else None,
            "recurrence_id": c.recurrence_id,
            "amt_diff": amt_diff,
            "date_diff": date_diff,
        })

    results.sort(key=lambda x: (x["amt_diff"], x["date_diff"]))
    return results[:limit]


def get_review_queue(db: Session, profile_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """Retourne la liste des transactions nécessitant une revue manuelle (needs_review == True)."""
    from app.models import Transaction, Account
    accounts = {a.id: a for a in db.query(Account).all()}

    txs = (
        db.query(Transaction)
        .filter(Transaction.needs_review == True)
        .order_by(Transaction.date_operation.desc(), Transaction.id.desc())
        .all()
    )
    results = []
    for t in txs:
        acc_id = t.from_account_id or t.to_account_id
        acc = accounts.get(acc_id)
        candidates = find_candidate_forecasts_for_tx(db, t, limit=3)
        results.append({
            "id": t.id,
            "date_operation": t.date_operation,
            "raw_description": t.raw_description or t.description,
            "description": t.description,
            "amount": t.amount,
            "type": t.type,
            "category": t.category,
            "account_id": acc_id,
            "account_name": acc.name if acc else None,
            "account_color": acc.color if acc else None,
            "confidence_score": t.confidence_score,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "candidate_forecasts": candidates
        })
    return results


def link_review_transaction(
    db: Session,
    tx_id: int,
    target_forecast_id: int,
    learn_rule: bool = True,
    description: Optional[str] = None,
    category: Optional[str] = None,
    amount: Optional[float] = None,
    profile_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fusionne et lie une transaction de revue avec une prévision comptable existante.
    Transfère les métadonnées bancaires sur la prévision, supprime la transaction de revue redondante,
    et mémorise la règle de correspondance.
    """
    from app.models import Transaction, AutopilotDecisionLog
    from app.services.history_service import record_action, snapshot_entity
    from app.services.smart_label_service import ensure_category_exists, learn_label_mapping

    pid = _resolve_profile_id(profile_id)

    tx_review = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx_review:
        raise ValueError(f"Transaction de revue #{tx_id} introuvable.")

    tx_forecast = db.query(Transaction).filter(Transaction.id == target_forecast_id).first()
    if not tx_forecast:
        raise ValueError(f"Transaction prévisionnelle #{target_forecast_id} introuvable.")

    before_snap_forecast = snapshot_entity(tx_forecast)
    before_snap_review = snapshot_entity(tx_review)

    bank_csv_id = tx_review.csv_id
    bank_raw_lbl = tx_review.raw_description or tx_review.description
    final_amount = amount if (amount is not None and amount > 0) else tx_review.amount
    final_desc = description.strip() if (description and description.strip()) else tx_forecast.description
    final_cat = category.strip() if (category and category.strip()) else tx_forecast.category

    # Libérer le csv_id sur la transaction de revue avant de l'assigner à la prévision
    tx_review.csv_id = None
    db.flush()

    if final_desc:
        tx_forecast.description = final_desc
    if final_cat:
        ensure_category_exists(db, final_cat, tx_forecast.type)
        tx_forecast.category = final_cat
    if final_amount is not None and final_amount > 0:
        orig_amt = tx_forecast.amount
        tx_forecast.amount = final_amount
        if orig_amt is not None and abs(orig_amt - final_amount) > 0.005:
            tx_forecast.comment = f"Auto-ajusté : {orig_amt:.2f} € → {final_amount:.2f} €"

    tx_forecast.raw_description = bank_raw_lbl
    if bank_csv_id:
        tx_forecast.csv_id = bank_csv_id
    tx_forecast.needs_review = False

    is_coming = bool(bank_csv_id and str(bank_csv_id).startswith("woob_coming_"))
    if not is_coming:
        tx_forecast.reconciliation_date = tx_review.reconciliation_date or tx_forecast.date_operation or date.today()

    # Supprimer la transaction temporaire de revue
    db.delete(tx_review)
    record_action(
        db,
        "transaction",
        tx_review.id,
        "DELETE",
        before_snap_review,
        None,
        user_name="Auto-Pilote (Fusion prévision)"
    )

    record_action(
        db,
        "transaction",
        tx_forecast.id,
        "UPDATE",
        before_snap_forecast,
        snapshot_entity(tx_forecast),
        user_name="Auto-Pilote (Liaison prévision)"
    )

    learned = False
    if learn_rule and bank_raw_lbl and tx_forecast.description and tx_forecast.category:
        try:
            learn_label_mapping(
                db,
                raw_label=bank_raw_lbl,
                clean_description=tx_forecast.description,
                category=tx_forecast.category,
                is_manual=True
            )
            learned = True
        except Exception as ex_l:
            logger.warning(f"[AutoPilot] Échec apprentissage lors de la liaison: {ex_l}")

    dlog = db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.entity_type == "transaction",
        AutopilotDecisionLog.entity_id == tx_review.id
    ).first()
    if dlog:
        dlog.entity_id = tx_forecast.id
        dlog.decision_type = "reconciliation"
        dlog.action = "LINKED_COMING" if tx_forecast.reconciliation_date is None else "AUTO_COMMIT"
        dlog.confidence_score = 100.0
        snap_payload = {
            "bank_tx": {
                "raw_description": bank_raw_lbl,
                "description": tx_forecast.description,
                "category": tx_forecast.category,
                "amount": tx_forecast.amount,
                "decision_reason": "linked_forecast"
            },
            "linked_to_forecast_id": tx_forecast.id,
            "forecast_description": tx_forecast.description,
            "decision_reason": "linked_forecast",
            "before": before_snap_forecast,
            "after": snapshot_entity(tx_forecast)
        }
        dlog.raw_snapshot = json.dumps(snap_payload, default=str)

    db.commit()
    stats_cache.invalidate(pid)

    return {
        "success": True,
        "id": tx_forecast.id,
        "merged_into_id": tx_forecast.id,
        "learned": learned,
        "message": f"Opération liée avec succès à la prévision '{tx_forecast.description}'."
    }


def validate_review_transaction(db: Session, tx_id: int, profile_id: Optional[str] = None) -> Dict[str, Any]:
    """Acquitte une transaction en attente de revue (needs_review = False)."""
    from app.models import Transaction, AutopilotDecisionLog
    from app.services.history_service import record_action, snapshot_entity

    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise ValueError(f"Transaction #{tx_id} introuvable.")

    # Si une prévision récurrente évidente existe sur la même date/montant, lier automatiquement
    cands = find_candidate_forecasts_for_tx(db, tx, limit=1)
    if cands and cands[0]["recurrence_id"] is not None and cands[0]["amt_diff"] <= 0.05:
        return link_review_transaction(
            db,
            tx_id=tx_id,
            target_forecast_id=cands[0]["id"],
            learn_rule=True,
            description=cands[0]["description"],
            category=cands[0]["category"],
            profile_id=profile_id
        )

    before_snap = snapshot_entity(tx)
    tx.needs_review = False
    db.flush()
    after_snap = snapshot_entity(tx)

    # Mettre à jour la décision Auto-Pilote associée si présente
    dlog = db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.entity_type == "transaction",
        AutopilotDecisionLog.entity_id == tx.id,
        AutopilotDecisionLog.action.in_(["AUTO_COMMIT_PENDING_REVIEW", "AUTO_COMMIT_COMING_PENDING_REVIEW"])
    ).first()
    if dlog:
        dlog.action = "AUTO_COMMIT" if dlog.action == "AUTO_COMMIT_PENDING_REVIEW" else "AUTO_COMMIT_COMING"

    record_action(
        db,
        "transaction",
        tx.id,
        "UPDATE",
        before_snap,
        after_snap,
        user_name="Auto-Pilote (Revue validée)"
    )
    db.commit()
    return {"success": True, "id": tx.id}


def update_review_transaction(
    db: Session,
    tx_id: int,
    description: Optional[str] = None,
    category: Optional[str] = None,
    amount: Optional[float] = None,
    target_forecast_id: Optional[int] = None,
    learn_rule: bool = True,
    profile_id: Optional[str] = None
) -> Dict[str, Any]:
    """Corrige une transaction en attente de revue et lève le drapeau needs_review."""
    if target_forecast_id:
        return link_review_transaction(
            db,
            tx_id=tx_id,
            target_forecast_id=target_forecast_id,
            learn_rule=learn_rule,
            description=description,
            category=category,
            amount=amount,
            profile_id=profile_id
        )

    from app.models import Transaction, AutopilotDecisionLog
    from app.services.history_service import record_action, snapshot_entity
    from app.services.smart_label_service import ensure_category_exists, learn_label_mapping

    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise ValueError(f"Transaction #{tx_id} introuvable.")

    # Détection automatique de fusion si le nouveau nom correspond à une prévision orpheline
    if description and description.strip():
        cands = find_candidate_forecasts_for_tx(db, tx, limit=1)
        if cands and cands[0]["description"].strip().lower() == description.strip().lower():
            return link_review_transaction(
                db,
                tx_id=tx_id,
                target_forecast_id=cands[0]["id"],
                learn_rule=learn_rule,
                description=description,
                category=category,
                amount=amount,
                profile_id=profile_id
            )

    before_snap = snapshot_entity(tx)

    if description is not None and description.strip():
        tx.description = description.strip()
    if amount is not None and amount > 0:
        tx.amount = amount
    if category is not None and category.strip():
        cleaned_cat = category.strip()
        ensure_category_exists(db, cleaned_cat, tx.type)
        tx.category = cleaned_cat

    tx.needs_review = False
    db.flush()
    after_snap = snapshot_entity(tx)

    # Apprentissage de la règle si demandé
    learned = False
    raw_lbl = tx.raw_description or tx.description
    if learn_rule and raw_lbl and tx.category:
        try:
            learn_label_mapping(
                db,
                raw_label=raw_lbl,
                clean_description=tx.description,
                category=tx.category,
                is_manual=True
            )
            learned = True
        except Exception as ex_l:
            logger.warning(f"[AutoPilot] Échec apprentissage lors de la revue: {ex_l}")

    dlog = db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.entity_type == "transaction",
        AutopilotDecisionLog.entity_id == tx.id,
        AutopilotDecisionLog.action.in_(["AUTO_COMMIT_PENDING_REVIEW", "AUTO_COMMIT_COMING_PENDING_REVIEW"])
    ).first()
    if dlog:
        dlog.action = "AUTO_COMMIT" if dlog.action == "AUTO_COMMIT_PENDING_REVIEW" else "AUTO_COMMIT_COMING"

    record_action(
        db,
        "transaction",
        tx.id,
        "UPDATE",
        before_snap,
        after_snap,
        user_name="Auto-Pilote (Revue modifiée)"
    )
    db.commit()
    return {"success": True, "id": tx.id, "learned": learned}


def preview_threshold_impact(db: Session, simulated_threshold: float) -> Dict[str, Any]:
    """Simule l'impact d'un changement de seuil sur les transactions ayant un score de confiance."""
    from app.models import Transaction
    current_threshold = get_auto_reconcile_threshold(db)

    txs = db.query(Transaction).filter(Transaction.confidence_score.isnot(None)).all()

    becoming_reliable = []
    becoming_review = []

    for t in txs:
        score = t.confidence_score or 0.0
        if t.needs_review and score >= simulated_threshold:
            becoming_reliable.append({
                "id": t.id,
                "description": t.description,
                "category": t.category,
                "amount": t.amount,
                "confidence_score": score
            })
        elif not t.needs_review and score < simulated_threshold:
            becoming_review.append({
                "id": t.id,
                "description": t.description,
                "category": t.category,
                "amount": t.amount,
                "confidence_score": score
            })

    return {
        "current_threshold": current_threshold,
        "simulated_threshold": simulated_threshold,
        "becoming_reliable_count": len(becoming_reliable),
        "becoming_review_count": len(becoming_review),
        "becoming_reliable_samples": becoming_reliable[:5],
        "becoming_review_samples": becoming_review[:5]
    }

