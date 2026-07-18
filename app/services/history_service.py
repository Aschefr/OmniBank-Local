import json
from datetime import date, datetime
from sqlalchemy import Date, DateTime
from app.models import (
    ActionHistory, Transaction, Account, Category, Budget,
    BudgetCategory, BudgetAllocation, RecurrenceTemplate, OrgUser,
    GlobalConfig
)

MODEL_MAPPING = {
    "transaction": Transaction,
    "account": Account,
    "category": Category,
    "budget": Budget,
    "budget_allocation": BudgetAllocation,
    "recurrence_template": RecurrenceTemplate,
    "org_user": OrgUser
}

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
            warning = "recurrence_delete_warning"
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
        new_entity = model_class()
        restore_state(new_entity, new_state, db)
        new_entity.id = action.entity_id
        db.add(new_entity)

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
            db.delete(entity)
        else:
            return False, "Entity to delete not found"

    action.is_undone = False
    db.flush()
    return True, warning

