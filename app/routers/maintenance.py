"""
maintenance.py — Routes de maintenance OmniBank.
Fournit des endpoints pour diagnostiquer et corriger les incohérences de données.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List
from app.database import get_db

router = APIRouter(prefix="/api/maintenance", tags=["Maintenance"])


def _find_mismatch_rows(db: Session):
    """Return transactions with type=expense_var but having recurrence."""
    result = db.execute(text("""
        SELECT t.id, t.description, t.amount, t.type, t.date_operation, t.category, t.recurrence_id, t.is_monthly
        FROM transactions t
        LEFT JOIN recurrence_templates rt ON t.recurrence_id = rt.id
        WHERE t.type = 'expense_var'
          AND (t.is_monthly = 1 OR t.recurrence_id IS NOT NULL)
          AND (rt.id IS NULL OR rt.type = 'expense_fixed')
        ORDER BY t.date_operation DESC
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


# ---------------------------------------------------------------------------
# Orphan recurrence cleanup — detect & remove recurrence-generated
# transactions that belong to years where the template was never confirmed
# (i.e. no reconciled transaction exists for that template in that year).
# ---------------------------------------------------------------------------

def _find_orphan_recurrence_transactions(db: Session):
    """
    Returns unreconciled transactions linked to a recurrence template
    that are orphans or duplicates:
    1. Belongs to a closed template.
    2. Belongs to a past year where the template has zero reconciled transactions.
    2.5. Template abandoned: confirmed in the past but not in current_year nor previous_year.
    2.6. Template zeroed-out: the last N confirmed transactions (N>=3) all have amount=0,
         signalling the user effectively cancelled this recurring charge even though the
         template was never closed. Unreconciled future instances are orphans.
    3. Monthly duplicate: already reconciled in the same (year, month), or two unreconciled
       in the same (year, month).
    3b. Yearly duplicate: already reconciled in the same year, or two unreconciled in the
        same year (for Yearly-frequency templates).
    """
    from datetime import date
    today = date.today()
    current_year = today.year

    # Step 1: find confirmed (reconciled) transactions — include amount for zero-out heuristic
    result_confirmed = db.execute(text("""
        SELECT recurrence_id,
               CAST(strftime('%Y', date_operation) AS INTEGER) AS yr,
               CAST(strftime('%m', date_operation) AS INTEGER) AS mo,
               amount,
               date_operation
        FROM transactions
        WHERE recurrence_id IS NOT NULL
          AND reconciliation_date IS NOT NULL
        ORDER BY recurrence_id, date_operation ASC
    """))

    confirmed_months = set()
    confirmed_years = set()
    # Per-template: ordered list of (yr, amount) for zero-out detection
    confirmed_history = {}  # rec_id -> [(yr, mo, amount)]
    confirmed_years_per_template = {}  # rec_id -> {yr}

    for row in result_confirmed:
        rec_id, yr, mo, amt, _ = row[0], row[1], row[2], row[3], row[4]
        confirmed_months.add((rec_id, yr, mo))
        confirmed_years.add((rec_id, yr))
        confirmed_history.setdefault(rec_id, []).append((yr, mo, amt))
        confirmed_years_per_template.setdefault(rec_id, set()).add(yr)

    # Build per-template zero-out flag:
    # A template is "zeroed out" if its LAST 3+ confirmed transactions all have amount == 0.
    zeroed_out_templates = set()
    for rec_id, history in confirmed_history.items():
        if len(history) >= 3:
            last_n = history[-3:]
            if all(amt == 0 for (_, _, amt) in last_n):
                zeroed_out_templates.add(rec_id)

    # Step 2: load recurrence templates
    result_templates = db.execute(text("""
        SELECT id, description, is_closed, frequency, day_of_month, amount
        FROM recurrence_templates
    """))
    templates_map = {}
    for row in result_templates:
        templates_map[row[0]] = {
            "description": row[1],
            "is_closed": bool(row[2]),
            "frequency": row[3],
            "day_of_month": row[4],
            "amount": row[5]
        }

    # Step 3: find all unreconciled transactions linked to a recurrence
    result_candidates = db.execute(text("""
        SELECT t.id, t.description, t.amount, t.date_operation, t.type, t.category,
               t.recurrence_id, rt.description AS tpl_description, rt.is_closed
        FROM transactions t
        JOIN recurrence_templates rt ON t.recurrence_id = rt.id
        WHERE t.recurrence_id IS NOT NULL
          AND t.reconciliation_date IS NULL
        ORDER BY t.recurrence_id, t.date_operation ASC
    """))

    orphans = []
    seen_month_periods = {}  # (rec_id, yr, mo) -> tx_dict  (Monthly dedup)
    seen_year_periods = {}   # (rec_id, yr) -> tx_dict       (Yearly dedup)

    for row in result_candidates:
        row_dict = dict(row._mapping)
        tx_date_str = str(row_dict['date_operation'])
        tx_year = int(tx_date_str[:4])
        tx_month = int(tx_date_str[5:7])
        rec_id = row_dict['recurrence_id']
        row_dict['year'] = tx_year

        if rec_id not in templates_map:
            orphans.append(row_dict)
            continue

        tpl = templates_map[rec_id]

        # Rule 1. Closed templates: all unreconciled transactions are orphans
        if tpl["is_closed"]:
            orphans.append(row_dict)
            continue

        # Rule 2. Past years: if no reconciled transaction exists for this template in that year
        if tx_year < current_year:
            if (rec_id, tx_year) not in confirmed_years:
                orphans.append(row_dict)
                continue

        # Rule 2.5. Abandoned templates: has history but nothing confirmed in current_year or prev_year
        template_confirmed_years = confirmed_years_per_template.get(rec_id, set())
        if template_confirmed_years:
            if current_year not in template_confirmed_years and (current_year - 1) not in template_confirmed_years:
                orphans.append(row_dict)
                continue

        # Rule 2.6. Zeroed-out templates: last 3+ confirmed entries all at €0 → abandoned in disguise
        if rec_id in zeroed_out_templates:
            # Only flag as orphan if this unreconciled tx has a non-zero amount (it was re-generated
            # from the original template amount, not from the user's real activity)
            if row_dict['amount'] != 0:
                orphans.append(row_dict)
                continue

        # Rule 3. Monthly duplicate check
        if tpl["frequency"] == "Monthly":
            # Already reconciled in this month → duplicate
            if (rec_id, tx_year, tx_month) in confirmed_months:
                orphans.append(row_dict)
                continue

            key = (rec_id, tx_year, tx_month)
            if key in seen_month_periods:
                first_tx = seen_month_periods[key]
                tx_date_day = int(tx_date_str.split('-')[2][:2])
                first_tx_date_str = str(first_tx['date_operation'])
                first_tx_day = int(first_tx_date_str.split('-')[2][:2])

                # Keep the one whose day matches the template's day_of_month
                if tpl["day_of_month"] and tx_date_day == tpl["day_of_month"] and first_tx_day != tpl["day_of_month"]:
                    orphans.append(first_tx)
                    seen_month_periods[key] = row_dict
                else:
                    orphans.append(row_dict)
            else:
                seen_month_periods[key] = row_dict

        # Rule 3b. Yearly duplicate check
        elif tpl["frequency"] == "Yearly":
            # Already reconciled in this year → duplicate
            if (rec_id, tx_year) in confirmed_years:
                orphans.append(row_dict)
                continue

            key = (rec_id, tx_year)
            if key in seen_year_periods:
                # Two unreconciled in same year → keep the first, flag the second
                orphans.append(row_dict)
            else:
                seen_year_periods[key] = row_dict

    return orphans



@router.get("/orphan_recurrences/preview")
def preview_orphan_recurrences(db: Session = Depends(get_db)):
    """
    Returns unreconciled transactions that are likely orphans:
    they belong to a recurrence template that has no reconciled
    transactions in the same year.
    """
    orphans = _find_orphan_recurrence_transactions(db)

    # Group by template for readability
    grouped = {}
    for o in orphans:
        key = o['recurrence_id']
        if key not in grouped:
            grouped[key] = {
                'template_id': key,
                'template_description': o['tpl_description'],
                'is_closed': o['is_closed'],
                'transactions': []
            }
        grouped[key]['transactions'].append({
            'id': o['id'],
            'description': o['description'],
            'amount': o['amount'],
            'date_operation': str(o['date_operation']),
            'category': o['category'],
            'type': o['type'],
            'year': o['year']
        })

    return {
        'count': len(orphans),
        'groups': list(grouped.values())
    }


@router.post("/orphan_recurrences/cleanup")
def cleanup_orphan_recurrences(
    tx_ids: List[int],
    db: Session = Depends(get_db)
):
    """
    Deletes the specified transaction IDs, but ONLY if they are
    unreconciled and linked to a recurrence template.
    This is a safe guard: reconciled transactions cannot be deleted.
    """
    if not tx_ids:
        return {"deleted": 0}

    deleted = 0
    for tx_id in tx_ids:
        result = db.execute(text("""
            DELETE FROM transactions
            WHERE id = :id
              AND recurrence_id IS NOT NULL
              AND reconciliation_date IS NULL
        """), {'id': tx_id})
        deleted += result.rowcount

    db.commit()
    return {"deleted": deleted}

