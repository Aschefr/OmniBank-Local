import json
import logging
from datetime import date, datetime
from sqlalchemy import Date, DateTime, desc
from app.models import (
    ActionHistory, Transaction, Account, Category, Budget,
    BudgetCategory, BudgetAllocation, RecurrenceTemplate, OrgUser,
    GlobalConfig, AIFact, BankLabelMapping, AutopilotDecisionLog
)

logger = logging.getLogger(__name__)

MODEL_MAPPING = {
    "transaction": Transaction,
    "account": Account,
    "category": Category,
    "budget": Budget,
    "budget_allocation": BudgetAllocation,
    "recurrence_template": RecurrenceTemplate,
    "org_user": OrgUser,
    "ai_fact": AIFact,
    "bank_label_mapping": BankLabelMapping,
    "autopilot_decision": AutopilotDecisionLog,
}


def check_undo_safety(db, action: ActionHistory) -> dict:
    """Vérifie si l'annulation d'une action est sûre vis-à-vis des dépendances.
    Retourne {"safe": bool, "reason": str|None, "conflicts": list}.
    """
    if action.is_undone:
        return {"safe": False, "reason": "already_undone", "conflicts": []}

    conflicts = []

    # --- Undo CREATE = suppression de l'entité : vérifier les dépendances ---
    if action.action_type == "CREATE":
        entity_id = action.entity_id

        if action.entity_type == "account":
            # Transactions liées à ce compte
            tx_count = db.query(Transaction).filter(
                (Transaction.from_account_id == entity_id) |
                (Transaction.to_account_id == entity_id)
            ).count()
            if tx_count > 0:
                conflicts.append(f"account_has_transactions:{tx_count}")

            # Récurrences liées à ce compte
            rec_count = db.query(RecurrenceTemplate).filter(
                (RecurrenceTemplate.from_account_id == entity_id) |
                (RecurrenceTemplate.to_account_id == entity_id)
            ).count()
            if rec_count > 0:
                conflicts.append(f"account_has_recurrences:{rec_count}")

        elif action.entity_type == "budget":
            # BudgetAllocation liées (argent alloué à cette tirelire/enveloppe)
            alloc_count = db.query(BudgetAllocation).filter(
                BudgetAllocation.budget_id == entity_id
            ).count()
            if alloc_count > 0:
                conflicts.append(f"budget_has_allocations:{alloc_count}")

            # Transactions assignées à ce budget
            tx_count = db.query(Transaction).filter(
                Transaction.budget_id == entity_id
            ).count()
            if tx_count > 0:
                conflicts.append(f"budget_has_transactions:{tx_count}")

        elif action.entity_type == "category":
            # Extraire le nom de la catégorie depuis le snapshot
            try:
                state = json.loads(action.new_state) if action.new_state else {}
                cat_name = state.get("name", "")
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"[History] Impossible de décoder le snapshot catégorie pour l'action {action.id}: {e}")
                cat_name = ""

            if cat_name:
                # Transactions utilisant cette catégorie
                tx_count = db.query(Transaction).filter(
                    Transaction.category == cat_name
                ).count()
                if tx_count > 0:
                    conflicts.append(f"category_has_transactions:{tx_count}")

                # BudgetCategory liées
                bc_count = db.query(BudgetCategory).filter(
                    BudgetCategory.category_name == cat_name
                ).count()
                if bc_count > 0:
                    conflicts.append(f"category_has_budgets:{bc_count}")

        elif action.entity_type == "recurrence_template":
            # Transactions réconciliées liées (non-supprimables)
            rec_tx = db.query(Transaction).filter(
                Transaction.recurrence_id == entity_id,
                Transaction.reconciliation_date != None
            ).count()
            if rec_tx > 0:
                conflicts.append(f"recurrence_has_reconciled:{rec_tx}")

    # --- Undo UPDATE / CLOSE / REOPEN : vérifier si une modification plus récente existe ---
    elif action.action_type in ("UPDATE", "CLOSE", "REOPEN"):
        newer_update = db.query(ActionHistory).filter(
            ActionHistory.entity_type == action.entity_type,
            ActionHistory.entity_id == action.entity_id,
            ActionHistory.action_type.in_(["UPDATE", "CLOSE", "REOPEN"]),
            ActionHistory.is_undone == False,
            ActionHistory.id > action.id
        ).first()

        if newer_update:
            conflicts.append(f"update_state_conflict:{newer_update.id}")

        # Nouvelle série créée par cette modification : l'annuler la supprime, sauf si elle a servi entre-temps
        new_series_id = _new_series_template_id(action)
        if new_series_id:
            rec_tx = db.query(Transaction).filter(
                Transaction.recurrence_id == new_series_id,
                Transaction.reconciliation_date != None,
                Transaction.id != action.entity_id
            ).count()
            if rec_tx > 0:
                conflicts.append(f"recurrence_has_reconciled:{rec_tx}")
            newer_tpl_action = db.query(ActionHistory).filter(
                ActionHistory.entity_type == "recurrence_template",
                ActionHistory.entity_id == new_series_id,
                ActionHistory.is_undone == False,
                ActionHistory.id > action.id
            ).first()
            if newer_tpl_action:
                conflicts.append(f"update_state_conflict:{newer_tpl_action.id}")
            marker_id = _new_series_snapshot(action, "_new_series_marker").get("id")
            newer_marker_action = db.query(ActionHistory).filter(
                ActionHistory.entity_type == "transaction",
                ActionHistory.entity_id == marker_id,
                ActionHistory.is_undone == False,
                ActionHistory.id > action.id
            ).first() if marker_id else None
            if newer_marker_action:
                conflicts.append(f"update_state_conflict:{newer_marker_action.id}")

    # --- Undo DELETE = re-création : vérifier conflit de clé primaire ---
    elif action.action_type == "DELETE":
        model_class = MODEL_MAPPING.get(action.entity_type)
        if model_class:
            existing = db.query(model_class).filter(
                model_class.id == action.entity_id
            ).first()
            if existing:
                conflicts.append(f"pk_conflict:{action.entity_id}")

    safe = len(conflicts) == 0
    reason = conflicts[0].split(":")[0] if conflicts else None
    return {"safe": safe, "reason": reason, "conflicts": conflicts}

def _new_series_snapshot(action: ActionHistory, key: str) -> dict:
    """Ce que « Créer une nouvelle série » a créé : la série (`_new_series_template`) ou l'occurrence ignorée laissée
    dans l'ancienne (`_new_series_marker`). Vide si l'action n'en a pas créé."""
    if action.entity_type != "transaction" or action.action_type != "UPDATE" or not action.new_state:
        return {}
    try:
        return (json.loads(action.new_state) or {}).get(key) or {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _new_series_template_id(action: ActionHistory):
    """Identifiant de la série créée par « Créer une nouvelle série », si cette action en a créé une."""
    return _new_series_snapshot(action, "_new_series_template").get("id")


def default_serializer(obj):
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")

def snapshot_entity(entity, db=None) -> dict:
    if not entity:
        return None
    result = {}
    for col in entity.__table__.columns:
        val = getattr(entity, col.name)
        if isinstance(val, (date, datetime)):
            result[col.name] = val.isoformat()
        else:
            result[col.name] = val

    # Custom embeds
    if isinstance(entity, Budget) and db:
        cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id == entity.id).all()
        result["_categories"] = [c.category_name for c in cats]

    return result

def restore_state(entity, state_dict, db=None):
    for col in entity.__table__.columns:
        if col.name in state_dict:
            val = state_dict[col.name]
            if val is not None:
                if isinstance(col.type, Date):
                    val = date.fromisoformat(val)
                elif isinstance(col.type, DateTime):
                    val = datetime.fromisoformat(val)
            setattr(entity, col.name, val)

    # Custom restores
    if isinstance(entity, Budget) and db and "_categories" in state_dict:
        db.query(BudgetCategory).filter(BudgetCategory.budget_id == entity.id).delete()
        for cat_name in state_dict["_categories"]:
            db.add(BudgetCategory(budget_id=entity.id, category_name=cat_name))

def record_action(db, entity_type: str, entity_id: int, action_type: str, previous_state: dict, new_state: dict, user_name: str = None) -> int:
    prev_str = json.dumps(previous_state, default=default_serializer) if previous_state else None
    new_str = json.dumps(new_state, default=default_serializer) if new_state else None

    history_entry = ActionHistory(
        entity_type=entity_type,
        entity_id=entity_id,
        action_type=action_type,
        previous_state=prev_str,
        new_state=new_str,
        user_name=user_name
    )
    db.add(history_entry)
    db.flush()
    return history_entry.id

def delete_budgets(db, budgets) -> list:
    """Supprime des enveloppes et renvoie de quoi les restaurer entièrement : catégories, dépôts et retraits,
    suggestions de recalibrage en attente (écartées avec elles)."""
    snapshots = []
    for b in budgets:
        snap = snapshot_entity(b, db)
        snap["_allocations"] = [snapshot_entity(a) for a in db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == b.id).all()]
        pending = db.query(AutopilotDecisionLog).filter(
            AutopilotDecisionLog.decision_type == "budget_suggestion",
            AutopilotDecisionLog.action == "SUGGESTED",
            AutopilotDecisionLog.entity_id == b.id,
        ).all()
        snap["_dismissed_suggestions"] = [d.id for d in pending]
        for d in pending:
            d.action = "DISMISSED"
        db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).delete(synchronize_session=False)
        db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == b.id).delete(synchronize_session=False)
        db.delete(b)
        snapshots.append(snap)
    db.flush()
    return snapshots


def _restore_allocations(db, budget_id: int, allocations) -> None:
    for snap in allocations or []:
        alloc = BudgetAllocation()
        restore_state(alloc, snap)
        alloc.budget_id = budget_id
        if db.query(BudgetAllocation).filter(BudgetAllocation.id == alloc.id).first():
            alloc.id = None
        db.add(alloc)


def restore_deleted_budget(db, snap: dict) -> int:
    """Recrée une enveloppe supprimée par delete_budgets ; renvoie son id (un autre si le sien a été repris)."""
    entity = Budget()
    restore_state(entity, {k: v for k, v in snap.items() if not k.startswith("_")})
    if db.query(Budget).filter(Budget.id == entity.id).first():
        entity.id = None
    db.add(entity)
    db.flush()
    for name in snap.get("_categories") or []:
        db.add(BudgetCategory(budget_id=entity.id, category_name=name))
    _restore_allocations(db, entity.id, snap.get("_allocations"))
    ids = snap.get("_dismissed_suggestions") or []
    if ids:
        db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.id.in_(ids)).update({"action": "SUGGESTED"}, synchronize_session=False)
    return entity.id


def _restore_global_configs(db, state: dict, is_undo: bool):
    """Restore GlobalConfig rows from a composite snapshot (paycheck_override)."""
    if not state:
        return
    for key, val in state.items():
        if key == "amount":
            continue
        row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        if val is None:
            if row:
                db.delete(row)
        else:
            if not row:
                row = GlobalConfig(key=key, value=val)
                db.add(row)
            else:
                row.value = val

def undo_action(db, action: ActionHistory):
    """Reverts the changes recorded in action."""
    if action.is_undone:
        return False, "Action already undone"

    if action.entity_type == "paycheck_override":
        prev = json.loads(action.previous_state) if action.previous_state else {}
        _restore_global_configs(db, prev, is_undo=True)
        action.is_undone = True
        db.flush()
        return True, None

    if action.entity_type == "budget_bulk":
        prev = json.loads(action.previous_state) if action.previous_state else {}
        for snap in prev.get("budgets", []):
            snap["id"] = restore_deleted_budget(db, snap)
        action.previous_state = json.dumps(prev, default=default_serializer)
        action.is_undone = True
        db.flush()
        return True, None

    model_class = MODEL_MAPPING.get(action.entity_type)
    if not model_class:
        return False, f"Unknown entity type: {action.entity_type}"

    warning = None

    if action.action_type == "CREATE":
        # Delete the entity
        entity = db.query(model_class).filter(model_class.id == action.entity_id).first()
        if entity:
            if action.entity_type == "transaction":
                recurrence_id = getattr(entity, "recurrence_id", None)
                if recurrence_id:
                    # Look for sibling CREATE action of recurrence_template
                    from sqlalchemy import desc
                    sibling_action = db.query(ActionHistory).filter(
                        ActionHistory.entity_type == "recurrence_template",
                        ActionHistory.entity_id == recurrence_id,
                        ActionHistory.action_type == "CREATE",
                        ActionHistory.is_undone == False
                    ).order_by(desc(ActionHistory.timestamp)).first()
                    if sibling_action:
                        diff = abs((action.timestamp - sibling_action.timestamp).total_seconds())
                        if diff <= 10.0:
                            # Check if there is an older active creation action for a transaction of the same recurrence
                            has_older = False
                            older_tx_actions = db.query(ActionHistory).filter(
                                ActionHistory.entity_type == "transaction",
                                ActionHistory.action_type == "CREATE",
                                ActionHistory.is_undone == False,
                                ActionHistory.id < action.id
                            ).all()
                            for old_act in older_tx_actions:
                                try:
                                    st = json.loads(old_act.new_state) if old_act.new_state else {}
                                    if st.get("recurrence_id") == recurrence_id:
                                        has_older = True
                                        break
                                except (json.JSONDecodeError, TypeError) as e:
                                    logger.debug(f"[History] Action {old_act.id} new_state JSON invalide: {e}")

                            if not has_older:
                                # Sibling creation action exists, is close, and this is the first transaction.
                                # Delete the template and all its unreconciled transactions.
                                sibling_entity = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == recurrence_id).first()
                                if sibling_entity:
                                    db.delete(sibling_entity)
                                db.query(Transaction).filter(
                                    Transaction.recurrence_id == recurrence_id,
                                    Transaction.reconciliation_date == None,
                                    Transaction.id != entity.id
                                ).delete(synchronize_session=False)
                                sibling_action.is_undone = True
            elif action.entity_type == "recurrence_template":
                # Delete any generated unreconciled transactions for this template
                db.query(Transaction).filter(
                    Transaction.recurrence_id == action.entity_id,
                    Transaction.reconciliation_date == None
                ).delete(synchronize_session=False)
            elif action.entity_type == "budget":
                # Delete linked BudgetCategory rows
                db.query(BudgetCategory).filter(
                    BudgetCategory.budget_id == action.entity_id
                ).delete(synchronize_session=False)
                # Revert any linked Autopilot decision to SUGGESTED
                dec = db.query(AutopilotDecisionLog).filter(
                    AutopilotDecisionLog.entity_id == action.entity_id,
                    AutopilotDecisionLog.decision_type == "budget_creation_suggestion",
                ).first()
                if dec:
                    dec.action = "SUGGESTED"
                    dec.entity_id = None

            db.delete(entity)
        else:
            return False, "Entity to delete not found"

    elif action.action_type in ("UPDATE", "CLOSE", "REOPEN"):
        # Restore old state
        entity = db.query(model_class).filter(model_class.id == action.entity_id).first()
        if not entity:
            return False, "Entity to update not found"

        prev_state = json.loads(action.previous_state) if action.previous_state else {}
        restore_state(entity, prev_state, db)

        if action.entity_type == "budget":
            # Revert any linked Autopilot decision (recalibration or enrichment) to SUGGESTED
            dec = db.query(AutopilotDecisionLog).filter(
                AutopilotDecisionLog.entity_id == action.entity_id,
                AutopilotDecisionLog.decision_type.in_(["budget_suggestion", "budget_enrichment_suggestion"]),
                AutopilotDecisionLog.action == "AUTO_COMMIT",
            ).order_by(AutopilotDecisionLog.id.desc()).first()
            if dec:
                dec.action = "SUGGESTED"
                if dec.decision_type == "budget_enrichment_suggestion" and dec.raw_snapshot:
                    try:
                        snap_d = json.loads(dec.raw_snapshot)
                        added_cat = snap_d.get("new_category") or snap_d.get("category")
                        if added_cat:
                            bc_items = db.query(BudgetCategory).filter(
                                BudgetCategory.budget_id == action.entity_id,
                                BudgetCategory.category_name == added_cat
                            ).all()
                            for bc in bc_items:
                                db.delete(bc)
                    except Exception:
                        pass

        elif action.entity_type == "recurrence_template":
            db.flush()
            prev_closed = prev_state.get("is_closed")
            new_state_dict = json.loads(action.new_state) if action.new_state else {}
            new_closed = new_state_dict.get("is_closed")

            if action.action_type == "CLOSE" or (new_closed is True and prev_closed is False):
                # Undoing CLOSE / closure update -> template reopened -> regenerate future instances
                from app.routers.recurrences import generate_recurrences
                generate_recurrences(template_id=action.entity_id, db=db)
            elif action.action_type == "REOPEN" or (new_closed is False and prev_closed is True):
                # Undoing REOPEN / reopen update -> template closed -> purge future unreconciled transactions
                db.query(Transaction).filter(
                    Transaction.recurrence_id == action.entity_id,
                    Transaction.reconciliation_date == None,
                    Transaction.date_operation > date.today()
                ).delete()

        if action.entity_type == "transaction":
            if prev_state.get("_propagated_template"):
                tpl_data = prev_state["_propagated_template"]
                tpl_id = tpl_data.get("id")
                if tpl_id:
                    tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
                    if tpl:
                        restore_state(tpl, tpl_data, db)

            if prev_state.get("_propagated_txs"):
                tx_snaps = prev_state["_propagated_txs"]
                if isinstance(tx_snaps, dict):
                    tx_snaps = tx_snaps.values()
                for snap in tx_snaps:
                    ftx_id = snap.get("id")
                    if ftx_id:
                        ftx = db.query(Transaction).filter(Transaction.id == ftx_id).first()
                        if ftx:
                            restore_state(ftx, snap, db)

            # L'opération a retrouvé son ancienne série : la nouvelle disparaît avec ses prévisions
            new_series_id = _new_series_template_id(action)
            if new_series_id:
                db.flush()
                db.query(Transaction).filter(
                    Transaction.recurrence_id == new_series_id,
                    Transaction.reconciliation_date == None,
                    Transaction.id != entity.id
                ).delete(synchronize_session=False)
                new_tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == new_series_id).first()
                if new_tpl:
                    db.delete(new_tpl)
                # L'occurrence ignorée laissée dans l'ancienne série n'a plus lieu d'être
                marker_id = _new_series_snapshot(action, "_new_series_marker").get("id")
                if marker_id:
                    db.query(Transaction).filter(Transaction.id == marker_id).delete(synchronize_session=False)

        # Set warning for category rename
        if action.entity_type == "category" and "name" in prev_state:
            warning = "category_rename_warning"

    elif action.action_type == "DELETE":
        # Re-create the entity
        prev_state = json.loads(action.previous_state) if action.previous_state else {}
        new_entity = model_class()
        restore_state(new_entity, prev_state, db)
        new_entity.id = action.entity_id
        db.add(new_entity)
        if action.entity_type == "budget":
            db.flush()
            _restore_allocations(db, action.entity_id, prev_state.get("_allocations"))

        # Set warnings for cascading deletions
        if action.entity_type == "category":
            warning = "category_delete_warning"
        elif action.entity_type == "recurrence_template":
            # Automatically generate transactions for this restored template
            db.flush()
            from app.routers.recurrences import generate_recurrences
            generate_recurrences(template_id=action.entity_id, db=db)
            warning = None  # No warning needed since they are generated automatically
        elif action.entity_type == "account":
            warning = "account_delete_warning"

    action.is_undone = True
    db.flush()

    # Synchronisation spécifique pour les liaisons / fusions Auto-Pilote
    if action.entity_type == "transaction" and action.user_name in ("Auto-Pilote (Liaison prévision)", "Auto-Pilote (Fusion prévision)"):
        try:
            dlogs = db.query(AutopilotDecisionLog).filter(
                AutopilotDecisionLog.entity_type == "transaction"
            ).order_by(AutopilotDecisionLog.id.desc()).all()
            for dlog in dlogs:
                if not dlog.raw_snapshot:
                    continue
                try:
                    dsnap = json.loads(dlog.raw_snapshot)
                except Exception:
                    continue
                ml = dsnap.get("manual_linked_forecast")
                if ml and (ml.get("target_forecast_id") == action.entity_id or ml.get("original_source_id") == action.entity_id or dlog.entity_id == action.entity_id):
                    dlog.entity_id = ml.get("original_source_id", dlog.entity_id)
                    dlog.decision_type = ml.get("original_decision_type", "new_entry")
                    dlog.action = ml.get("original_action", "AUTO_COMMIT")
                    dlog.confidence_score = ml.get("original_confidence_score", dlog.confidence_score)
                    dsnap.pop("manual_linked_forecast", None)
                    dsnap.pop("linked_to_forecast_id", None)
                    dsnap.pop("linked_to_forecast_description", None)
                    dsnap.pop("forecast_description", None)
                    dlog.raw_snapshot = json.dumps(dsnap, default=str)
                    db.flush()
                    break

            # Annuler également l'action jumelle (Liaison <-> Fusion) si elle n'a pas encore été annulée
            sibling_act = db.query(ActionHistory).filter(
                ActionHistory.entity_type == "transaction",
                ActionHistory.user_name.in_(["Auto-Pilote (Liaison prévision)", "Auto-Pilote (Fusion prévision)"]),
                ActionHistory.id != action.id,
                ActionHistory.is_undone == False
            ).order_by(ActionHistory.id.desc()).first()
            if sibling_act and abs((action.timestamp - sibling_act.timestamp).total_seconds()) <= 15.0:
                undo_action(db, sibling_act)
        except Exception as e_ap_undo:
            logger.warning(f"[History] Erreur synchronisation Auto-Pilote lors du rollback: {e_ap_undo}")

    return True, warning


def redo_action(db, action: ActionHistory):
    """Reapplies the changes of an undone action."""
    if not action.is_undone:
        return False, "Action is not undone"

    if action.entity_type == "paycheck_override":
        new_st = json.loads(action.new_state) if action.new_state else {}
        _restore_global_configs(db, new_st, is_undo=False)
        action.is_undone = False
        db.flush()
        return True, None

    if action.entity_type == "budget_bulk":
        prev = json.loads(action.previous_state) if action.previous_state else {}
        ids = [s.get("id") for s in prev.get("budgets", [])]
        delete_budgets(db, db.query(Budget).filter(Budget.id.in_(ids)).all())
        action.is_undone = False
        db.flush()
        return True, None

    model_class = MODEL_MAPPING.get(action.entity_type)
    if not model_class:
        return False, f"Unknown entity type: {action.entity_type}"

    warning = None

    if action.action_type == "CREATE":
        # Re-create the entity (since undo deleted it)
        new_state = json.loads(action.new_state) if action.new_state else {}

        # Handle grouped recurrence creation first if this is a transaction
        if action.entity_type == "transaction":
            recurrence_id = new_state.get("recurrence_id")
            if recurrence_id:
                from sqlalchemy import desc
                sibling_action = db.query(ActionHistory).filter(
                    ActionHistory.entity_type == "recurrence_template",
                    ActionHistory.entity_id == recurrence_id,
                    ActionHistory.action_type == "CREATE",
                    ActionHistory.is_undone == True
                ).order_by(desc(ActionHistory.timestamp)).first()
                if sibling_action:
                    diff = abs((action.timestamp - sibling_action.timestamp).total_seconds())
                    if diff <= 10.0:
                        sibling_state = json.loads(sibling_action.new_state) if sibling_action.new_state else {}
                        sibling_entity = RecurrenceTemplate()
                        restore_state(sibling_entity, sibling_state, db)
                        sibling_entity.id = recurrence_id
                        db.add(sibling_entity)
                        sibling_action.is_undone = False

        new_entity = model_class()
        restore_state(new_entity, new_state, db)
        new_entity.id = action.entity_id
        db.add(new_entity)

        # If we just redid a recurrence template creation or transaction with a grouped template,
        # regenerate future instances to ensure they are present.
        if action.entity_type == "transaction":
            recurrence_id = new_state.get("recurrence_id")
            if recurrence_id:
                db.flush()
                from app.routers.recurrences import generate_recurrences
                generate_recurrences(template_id=recurrence_id, db=db)
        elif action.entity_type == "recurrence_template":
            db.flush()
            from app.routers.recurrences import generate_recurrences
            generate_recurrences(template_id=action.entity_id, db=db)

    elif action.action_type in ("UPDATE", "CLOSE", "REOPEN"):
        # Restore new state
        entity = db.query(model_class).filter(model_class.id == action.entity_id).first()
        if not entity:
            return False, "Entity to update not found"

        new_state = json.loads(action.new_state) if action.new_state else {}
        new_series_snap = new_state.get("_new_series_template") if action.entity_type == "transaction" else None
        if new_series_snap and not db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == new_series_snap.get("id")).first():
            new_tpl = RecurrenceTemplate()
            restore_state(new_tpl, new_series_snap, db)
            db.add(new_tpl)
            db.flush()
        marker_snap = new_state.get("_new_series_marker") if action.entity_type == "transaction" else None
        if marker_snap and not db.query(Transaction).filter(Transaction.id == marker_snap.get("id")).first():
            marker = Transaction()
            restore_state(marker, marker_snap, db)
            db.add(marker)
            db.flush()
        restore_state(entity, new_state, db)

        if action.entity_type == "recurrence_template":
            db.flush()
            prev_state_dict = json.loads(action.previous_state) if action.previous_state else {}
            prev_closed = prev_state_dict.get("is_closed")
            new_closed = new_state.get("is_closed")

            if action.action_type == "CLOSE" or (new_closed is True and prev_closed is False):
                # Redoing CLOSE / closure update -> template closed -> purge future unreconciled transactions
                db.query(Transaction).filter(
                    Transaction.recurrence_id == action.entity_id,
                    Transaction.reconciliation_date == None,
                    Transaction.date_operation > date.today()
                ).delete()
            elif action.action_type == "REOPEN" or (new_closed is False and prev_closed is True):
                # Redoing REOPEN / reopen update -> template reopened -> regenerate future instances
                from app.routers.recurrences import generate_recurrences
                generate_recurrences(template_id=action.entity_id, db=db)

        elif action.entity_type == "transaction":
            if new_state.get("_propagated_template"):
                tpl_data = new_state["_propagated_template"]
                tpl_id = tpl_data.get("id")
                if tpl_id:
                    tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
                    if tpl:
                        restore_state(tpl, tpl_data, db)

            if new_state.get("_propagated_txs"):
                tx_snaps = new_state["_propagated_txs"]
                if isinstance(tx_snaps, dict):
                    tx_snaps = tx_snaps.values()
                for snap in tx_snaps:
                    ftx_id = snap.get("id")
                    if ftx_id:
                        ftx = db.query(Transaction).filter(Transaction.id == ftx_id).first()
                        if ftx:
                            restore_state(ftx, snap, db)

            if new_series_snap:
                db.flush()
                from app.routers.recurrences import generate_recurrences
                generate_recurrences(template_id=new_series_snap.get("id"), db=db)

    elif action.action_type == "DELETE":
        # Re-delete the entity (since undo re-created it)
        entity = db.query(model_class).filter(model_class.id == action.entity_id).first()
        if entity:
            if action.entity_type == "recurrence_template":
                # Delete unreconciled transactions generated by this template
                db.query(Transaction).filter(
                    Transaction.recurrence_id == action.entity_id,
                    Transaction.reconciliation_date == None
                ).delete()
            elif action.entity_type == "budget":
                db.query(BudgetCategory).filter(BudgetCategory.budget_id == action.entity_id).delete(synchronize_session=False)
                db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == action.entity_id).delete(synchronize_session=False)
            db.delete(entity)
        else:
            return False, "Entity to delete not found"

    action.is_undone = False
    db.flush()
    return True, warning

