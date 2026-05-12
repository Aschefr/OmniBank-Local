"""
maintenance.py — Routes de maintenance OmniBank.
Fournit des endpoints pour diagnostiquer et corriger les incohérences de données.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import get_db

router = APIRouter(prefix="/api/maintenance", tags=["Maintenance"])


def _find_mismatch_rows(db: Session):
    """Return transactions with type=expense_var but having recurrence."""
    result = db.execute(text("""
        SELECT id, description, amount, type, date_operation, category, recurrence_id, is_monthly
        FROM transactions
        WHERE type = 'expense_var'
          AND (is_monthly = 1 OR recurrence_id IS NOT NULL)
        ORDER BY date_operation DESC
    """))
    return [dict(r._mapping) for r in result]


def _find_affected_categories(db: Session, tx_ids: list[int]) -> list[str]:
    if not tx_ids:
        return []
    placeholders = ','.join(str(i) for i in tx_ids)
    result = db.execute(text(f"""
        SELECT DISTINCT category FROM transactions
        WHERE id IN ({placeholders})
          AND category IS NOT NULL AND category != ''
    """))
    return [r[0] for r in result]


def _cat_has_other_expense_var(db: Session, cat_name: str, exclude_ids: list[int]) -> bool:
    placeholders = ','.join(str(i) for i in exclude_ids) if exclude_ids else '0'
    result = db.execute(text(f"""
        SELECT COUNT(*) FROM transactions
        WHERE type = 'expense_var'
          AND category = :cat
          AND id NOT IN ({placeholders})
    """), {'cat': cat_name})
    return result.scalar() > 0


@router.get("/fix_type_mismatch/preview")
def preview_fix(db: Session = Depends(get_db)):
    """
    Retourne la liste des transactions mal typées (expense_var avec récurrence)
    ainsi que les catégories concernées et si elles sont partagées avec d'autres
    transactions expense_var légitimes.
    """
    rows = _find_mismatch_rows(db)
    tx_ids = [r['id'] for r in rows]
    affected_cats = _find_affected_categories(db, tx_ids)

    cat_info = []
    for cat in affected_cats:
        shared = _cat_has_other_expense_var(db, cat, tx_ids)
        cat_info.append({
            "name": cat,
            "shared": shared,  # True = also used in legit expense_var ops → user choice needed
            "default_action": "keep" if shared else "move"
        })

    return {
        "count": len(rows),
        "sample": rows[:10],
        "affected_categories": cat_info
    }


@router.post("/fix_type_mismatch/apply")
def apply_fix(
    db: Session = Depends(get_db),
    cat_moves: str = Query(default="", description="Comma-separated category names to MOVE to expense_fixed")
):
    """
    Applique la correction:
    - Met à jour toutes les transactions expense_var avec récurrence → expense_fixed
    - Pour les catégories listées dans cat_moves : les déplace vers expense_fixed
    - Pour les autres catégories affectées non listées : les laisse en expense_var
    """
    rows = _find_mismatch_rows(db)
    tx_ids = [r['id'] for r in rows]

    if not tx_ids:
        return {"tx_fixed": 0, "cat_fixed": 0, "message": "Aucune correction nécessaire."}

    # Fix transactions
    placeholders = ','.join(str(i) for i in tx_ids)
    db.execute(text(f"""
        UPDATE transactions SET type = 'expense_fixed'
        WHERE id IN ({placeholders})
    """))
    tx_fixed = len(tx_ids)

    # Fix categories
    to_move = [c.strip() for c in cat_moves.split(',') if c.strip()] if cat_moves else []
    cat_fixed = 0
    affected_cats = _find_affected_categories(db, tx_ids)
    for cat in affected_cats:
        shared = _cat_has_other_expense_var(db, cat, tx_ids)
        if not shared or cat in to_move:
            result = db.execute(text("""
                UPDATE categories SET type = 'expense_fixed'
                WHERE name = :name AND type = 'expense_var'
            """), {'name': cat})
            if result.rowcount > 0:
                cat_fixed += 1

    db.commit()
    return {
        "tx_fixed": tx_fixed,
        "cat_fixed": cat_fixed,
        "message": f"Migration terminée : {tx_fixed} transactions, {cat_fixed} catégories."
    }
