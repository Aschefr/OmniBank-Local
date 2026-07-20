import json
from datetime import date, datetime
from sqlalchemy import Date, DateTime, desc
from app.models import (
    ActionHistory, Transaction, Account, Category, Budget,
    BudgetCategory, BudgetAllocation, RecurrenceTemplate, OrgUser,
    GlobalConfig, AIFact
)

MODEL_MAPPING = {
    "transaction": Transaction,
    "account": Account,
    "category": Category,
    "budget": Budget,
    "budget_allocation": BudgetAllocation,
    "recurrence_template": RecurrenceTemplate,
    "org_user": OrgUser,
    "ai_fact": AIFact
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
            # BudgetCategory liées
            cat_count = db.query(BudgetCategory).filter(
                BudgetCategory.budget_id == entity_id
            ).count()
            if cat_count > 0:
                conflicts.append(f"budget_has_categories:{cat_count}")

            # BudgetAllocation liées
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
            except Exception:
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

    # --- Undo UPDATE : vérifier si un UPDATE plus récent existe ---
    elif action.action_type == "UPDATE":
        newer_update = db.query(ActionHistory).filter(
            ActionHistory.entity_type == action.entity_type,
            ActionHistory.entity_id == action.entity_id,
            ActionHistory.action_type == "UPDATE",
            ActionHistory.is_undone == False,
            ActionHistory.id > action.id
        ).first()

        if newer_update:
            conflicts.append(f"update_state_conflict:{newer_update.id}")

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
                                except Exception:
                                    pass

                            if not has_older:
                                # Sibling creation action exists, is close, and this is the first transaction.
                                # Delete the template and all its unreconciled transactions.
                                sibling_entity = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == recurrence_id).first()
                                if sibling_entity:
                                    db.delete(sibling_entity)
                                db.query(Transaction).filter(
                                    Transaction.recurrence_id == recurrence_id,
                                    Transaction.reconciliation_date == None
                                ).delete()
                                sibling_action.is_undone = True
            elif action.entity_type == "recurrence_template":
                # Delete any generated unreconciled transactions for this template
                db.query(Transaction).filter(
                    Transaction.recurrence_id == action.entity_id,
                    Transaction.reconciliation_date == None
                ).delete()

            db.delete(entity)
        else:
            return False, "Entity to delete not found"

    elif action.action_type == "UPDATE":
        # Restore old state
        entity = db.query(model_class).filter(model_class.id == action.entity_id).first()
        if not entity:
            return False, "Entity to update not found"

        prev_state = json.loads(action.previous_state) if action.previous_state else {}
        restore_state(entity, prev_state, db)

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

    elif action.action_type == "UPDATE":
        # Restore new state
        entity = db.query(model_class).filter(model_class.id == action.entity_id).first()
        if not entity:
            return False, "Entity to update not found"

        new_state = json.loads(action.new_state) if action.new_state else {}
        restore_state(entity, new_state, db)

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
            db.delete(entity)
        else:
            return False, "Entity to delete not found"

    action.is_undone = False
    db.flush()
    return True, warning

