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
    from app.models import Transaction
    rows = db.query(Transaction.category).filter(
        Transaction.id.in_(tx_ids),
        Transaction.category.isnot(None),
        Transaction.category != ''
    ).distinct().all()
    return [r[0] for r in rows]


def _cat_has_other_expense_var(db: Session, cat_name: str, exclude_ids: list[int]) -> bool:
    from app.models import Transaction
    query = db.query(Transaction).filter(
        Transaction.type == 'expense_var',
        Transaction.category == cat_name
    )
    if exclude_ids:
        query = query.filter(~Transaction.id.in_(exclude_ids))
    return query.count() > 0


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

    # Fix transactions via parameterized ORM update
    from app.models import Transaction
    db.query(Transaction).filter(Transaction.id.in_(tx_ids)).update(
        {Transaction.type: 'expense_fixed'},
        synchronize_session=False
    )
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
          AND (is_skipped = 0 OR is_skipped IS NULL)
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
          AND (t.is_skipped = 0 OR t.is_skipped IS NULL)
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


@router.get("/convert_zeroed_to_skipped/preview")
def preview_convert_zeroed_to_skipped(db: Session = Depends(get_db)):
    """
    Finds templates whose generation is currently blocked by zeroed transactions,
    and where converting them to 'skipped' would unblock generation with a valid amount.
    
    A template is shown only if:
    1. It is active (not closed)
    2. Its latest confirmed (non-skipped) transaction has amount == 0.0
    3. It has at least one confirmed transaction with amount > 0 in its history
       (so there's a valid fallback amount to resume generation with)
    
    Only the consecutive 0€ tail transactions are shown (the ones blocking generation).
    """
    # Fetch all confirmed transactions for active templates, sorted by template and date DESC
    rows = db.execute(text("""
        SELECT t.id, t.description, t.amount, t.date_operation, t.category, t.type,
               t.recurrence_id, rt.description AS tpl_description, t.is_skipped
        FROM transactions t
        JOIN recurrence_templates rt ON t.recurrence_id = rt.id
        WHERE t.recurrence_id IS NOT NULL
          AND t.reconciliation_date IS NOT NULL
          AND (rt.is_closed = 0 OR rt.is_closed IS NULL)
        ORDER BY t.recurrence_id, t.date_operation DESC
    """)).fetchall()

    # Group transactions by template ID
    by_template = {}
    for r in rows:
        tpl_id = r[6]
        if tpl_id not in by_template:
            by_template[tpl_id] = []
        by_template[tpl_id].append(r)

    grouped = {}
    for tpl_id, txs in by_template.items():
        # Filter to non-skipped transactions for analysis
        non_skipped = [tx for tx in txs if not tx[8]]
        if not non_skipped:
            continue
            
        # Check: is the latest confirmed non-skipped tx zeroed?
        if non_skipped[0][2] != 0.0:
            continue  # Not blocked, skip this template
            
        # Check: does any confirmed tx have a non-zero amount? (fallback exists?)
        has_nonzero = any(tx[2] != 0.0 for tx in txs)
        if not has_nonzero:
            continue  # No fallback amount, wizard won't help
        
        # Collect only the consecutive 0€ tail (the blocking transactions)
        blocking_txs = []
        for tx in non_skipped:
            if tx[2] == 0.0:
                blocking_txs.append(tx)
            else:
                break  # Stop at the first non-zero transaction
        
        if not blocking_txs:
            continue
        
        # Skip templates with too many consecutive zeros (4+):
        # these are clearly terminated subscriptions, not temporary pauses
        MAX_CONSECUTIVE_ZEROS = 3
        if len(blocking_txs) > MAX_CONSECUTIVE_ZEROS:
            continue
            
        # Find the fallback amount for display context
        fallback_tx = next((tx for tx in non_skipped if tx[2] != 0.0), None)
        
        grouped[tpl_id] = {
            'template_id': tpl_id,
            'template_description': txs[0][7],
            'fallback_amount': fallback_tx[2] if fallback_tx else None,
            'transactions': [{
                'id': tx[0],
                'description': tx[1],
                'amount': tx[2],
                'date_operation': str(tx[3]),
                'category': tx[4],
                'type': tx[5]
            } for tx in blocking_txs]
        }

    total_count = sum(len(g['transactions']) for g in grouped.values())

    return {
        'count': total_count,
        'groups': list(grouped.values())
    }


@router.post("/convert_zeroed_to_skipped/apply")
def apply_convert_zeroed_to_skipped(
    tx_ids: List[int],
    db: Session = Depends(get_db)
):
    """
    Converts specified transaction IDs with amount = 0.0 to be is_skipped = 1.
    Also restores the original amount from the recurrence template (non-destructive approach).
    """
    if not tx_ids:
        return {"converted": 0}
        
    converted = 0
    for tx_id in tx_ids:
        result = db.execute(text("""
            UPDATE transactions
            SET is_skipped = 1,
                amount = COALESCE(
                    (SELECT rt.amount FROM recurrence_templates rt 
                     WHERE rt.id = transactions.recurrence_id),
                    0.0
                )
            WHERE id = :id
              AND recurrence_id IS NOT NULL
              AND reconciliation_date IS NOT NULL
              AND amount = 0.0
              AND (is_skipped = 0 OR is_skipped IS NULL)
        """), {'id': tx_id})
        converted += result.rowcount
    db.commit()
    return {"converted": converted}


@router.post("/close_template/{tpl_id}")
def close_template_from_wizard(tpl_id: int, db: Session = Depends(get_db)):
    """
    Close a recurrence template directly from the wizard.
    Sets is_closed = True so it's excluded from generation and future wizard runs.
    """
    from app.models import RecurrenceTemplate
    tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
    if not tpl:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Template not found")
    tpl.is_closed = True
    db.commit()
    return {"ok": True, "template_id": tpl_id}


# ---------------------------------------------------------------------------
# Misplaced categories audit & reclassification
# ---------------------------------------------------------------------------

from pydantic import BaseModel


class CategoryFixItem(BaseModel):
    category: str
    new_type: str


class MisplacedCategoriesApplyRequest(BaseModel):
    fixes: List[CategoryFixItem]
    sync_all_tx_types: bool = True


def _audit_misplaced_categories(db: Session):
    """
    Audite l'ensemble des catégories et détecte les anomalies par rapport aux flux réels.
    """
    from app.models import Category, Transaction, RecurrenceTemplate

    cats = db.query(Category).all()
    anomalies = []
    total_tx_mismatches = 0

    for c in cats:
        txs = db.query(Transaction).filter(Transaction.category == c.name).all()
        templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.category == c.name).all()

        total_txs = len(txs)
        if total_txs == 0 and not templates:
            continue

        # Directions basées sur from_account_id et to_account_id
        bidi_txs = sum(1 for t in txs if t.from_account_id is not None and t.to_account_id is not None)
        expense_txs = sum(1 for t in txs if t.from_account_id is not None and t.to_account_id is None)
        income_txs = sum(1 for t in txs if t.from_account_id is None and t.to_account_id is not None)

        bidi_tmpl = sum(1 for t in templates if t.from_account_id is not None and t.to_account_id is not None)

        # Un virement bi-directionnel doit être typed 'transfer', les autres doivent correspondre au type de la catégorie
        cat_tx_mismatches = sum(
            1 for t in txs
            if (t.type != "transfer" if (t.from_account_id is not None and t.to_account_id is not None) else t.type != c.type)
        )
        total_tx_mismatches += cat_tx_mismatches

        reasons = []
        suggested_type = None

        # 1. Virements internes mal classés
        if c.type != 'transfer' and (bidi_txs > 0 or bidi_tmpl > 0):
            if total_txs > 0 and bidi_txs >= total_txs * 0.5:
                reasons.append(f"{bidi_txs} sur {total_txs} opérations sont des virements internes entre comptes.")
                suggested_type = 'transfer'
            elif total_txs == 0 and bidi_tmpl > 0:
                reasons.append("Les modèles de récurrence associés sont des virements internes entre comptes.")
                suggested_type = 'transfer'

        # 2. Catégorie transfer mais opérations non-virements
        elif c.type == 'transfer':
            if total_txs > 0 and bidi_txs == 0:
                if expense_txs > 0 and income_txs == 0:
                    reasons.append(f"Toutes les opérations ({expense_txs}) sont des dépenses classiques (compte unique débité).")
                    suggested_type = 'expense_fixed' if templates else 'expense_var'
                elif income_txs > 0 and expense_txs == 0:
                    reasons.append(f"Toutes les opérations ({income_txs}) sont des recettes (compte unique crédité).")
                    suggested_type = 'income'

        # 3. Inversion Recettes / Dépenses
        elif c.type in ('expense_var', 'expense_fixed') and suggested_type is None:
            if total_txs > 0 and income_txs == total_txs and bidi_txs == 0:
                reasons.append(f"Toutes les opérations ({income_txs}) sont des entrées d'argent (recettes).")
                suggested_type = 'income'
        elif c.type == 'income' and suggested_type is None:
            if total_txs > 0 and expense_txs == total_txs and bidi_txs == 0:
                reasons.append(f"Toutes les opérations ({expense_txs}) sont des sorties d'argent (dépenses).")
                suggested_type = 'expense_fixed' if templates else 'expense_var'

        # 4. Incohérence Charges fixes vs Dépenses variables
        if suggested_type is None and c.type in ('expense_fixed', 'expense_var'):
            tx_types = {}
            for t in txs:
                tx_types[t.type] = tx_types.get(t.type, 0) + 1

            if c.type == 'expense_fixed' and tx_types.get('expense_var', 0) == total_txs and total_txs > 0 and len(templates) == 0:
                reasons.append(f"Aucune récurrence n'est définie et toutes les opérations ({total_txs}) sont des dépenses variables ponctuelles.")
                suggested_type = 'expense_var'
            elif c.type == 'expense_var' and tx_types.get('expense_fixed', 0) == total_txs and total_txs > 0 and len(templates) > 0:
                reasons.append(f"Cette catégorie possède des récurrences et toutes ses opérations ({total_txs}) sont des charges fixes.")
                suggested_type = 'expense_fixed'

        if reasons and suggested_type and suggested_type != c.type:
            sample = [
                {
                    "date": t.date_operation.strftime("%Y-%m-%d") if t.date_operation else "-",
                    "description": t.description or "-",
                    "amount": t.amount or 0.0,
                    "type": t.type
                }
                for t in txs[:5]
            ]
            anomalies.append({
                "name": c.name,
                "current_type": c.type,
                "suggested_type": suggested_type,
                "reason": " ".join(reasons),
                "total_txs": total_txs,
                "bidi_txs": bidi_txs,
                "templates_count": len(templates),
                "tx_mismatches_count": cat_tx_mismatches,
                "sample": sample
            })

    return anomalies, total_tx_mismatches


@router.get("/misplaced_categories/preview")
def preview_misplaced_categories(db: Session = Depends(get_db)):
    """
    Retourne la liste des catégories mal placées (type en contradiction avec les flux réels)
    ainsi que les opérations désynchronisées.
    """
    anomalies, total_tx_mismatches = _audit_misplaced_categories(db)
    return {
        "count": len(anomalies),
        "categories": anomalies,
        "total_tx_mismatches": total_tx_mismatches
    }


@router.post("/misplaced_categories/apply")
def apply_misplaced_categories(
    req: MisplacedCategoriesApplyRequest,
    db: Session = Depends(get_db)
):
    """
    Applique le reclassement des catégories choisies :
    - Met à jour Category.type
    - Aligne toutes les transactions de la catégorie
    - Force type='transfer' pour les transactions bi-directionnelles
    - Aligne les RecurrenceTemplate de la catégorie
    - Si sync_all_tx_types=True, aligne également toute transaction dont le type diffère de sa catégorie
    - Invalide stats_cache
    """
    from app.models import Category, Transaction, RecurrenceTemplate
    from app.routers.stats import stats_cache

    cats_fixed = 0
    txs_fixed = 0
    tmpls_fixed = 0

    for fix in req.fixes:
        cat_name = fix.category
        new_type = fix.new_type

        # 1. Update category
        cat = db.query(Category).filter(Category.name == cat_name).first()
        if cat and cat.type != new_type:
            cat.type = new_type
            cats_fixed += 1

        # 2. Update transactions for this category
        txs = db.query(Transaction).filter(Transaction.category == cat_name).all()
        for tx in txs:
            if tx.from_account_id is not None and tx.to_account_id is not None:
                if tx.type != "transfer":
                    tx.type = "transfer"
                    txs_fixed += 1
            elif tx.type != new_type:
                tx.type = new_type
                txs_fixed += 1

        # 3. Update recurrence templates
        tmpls = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.category == cat_name).all()
        for tm in tmpls:
            if tm.from_account_id is not None and tm.to_account_id is not None:
                if tm.type != "transfer":
                    tm.type = "transfer"
                    tmpls_fixed += 1
            elif tm.type != new_type:
                tm.type = new_type
                tmpls_fixed += 1

    # Sync remaining transactions whose type differs from their category
    if req.sync_all_tx_types:
        all_cats = {c.name: c.type for c in db.query(Category).all()}
        for tx in db.query(Transaction).all():
            if not tx.category or tx.category not in all_cats:
                continue
            cat_type = all_cats[tx.category]
            target_type = "transfer" if (tx.from_account_id and tx.to_account_id) else cat_type
            if tx.type != target_type:
                tx.type = target_type
                txs_fixed += 1

    db.commit()
    stats_cache.invalidate()

    return {
        "categories_fixed": cats_fixed,
        "transactions_fixed": txs_fixed,
        "templates_fixed": tmpls_fixed,
        "message": f"Reclassement terminé : {cats_fixed} catégorie(s), {txs_fixed} opération(s), {tmpls_fixed} modèle(s) mis à jour."
    }


# ---------------------------------------------------------------------------
# Abandoned Recurrences Detection & Purge
# ---------------------------------------------------------------------------

class AbandonedRecurrencesApplyRequest(BaseModel):
    template_ids: List[int]
    purge_unreconciled: bool = True
    unlink_mismatched: bool = True


def _find_abandoned_recurrences(db: Session):
    """
    Détecte les modèles de récurrence non clôturés qui sont de facto abandonnés :
    - Inactivité prolongée dépassant le seuil de fréquence (Monthly > 75j, Yearly > 450j...)
    - Fin de vie avec plusieurs échéances consécutives à 0,00 € (zero_tail >= 2)
    - Longue rupture d'activité (> 2x seuil) avec opération ultérieure suspecte/non conforme
    - Jamais confirmés depuis leur création passée
    """
    from datetime import datetime, date
    from app.models import RecurrenceTemplate, Transaction

    FREQS = {
        'Daily': 15,
        'Weekly': 45,
        'Bi-weekly': 45,
        'Monthly': 75,
        'Quarterly': 150,
        'Semi-Annually': 270,
        'Biannual': 270,
        'Yearly': 450
    }

    today = date.today()
    templates = db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed.is_(None))
    ).all()

    abandoned = []

    for tpl in templates:
        threshold = FREQS.get(tpl.frequency, 75)

        # Confirmed transactions, ignoring unconfirmed SAS review attempts
        confirmed = db.query(Transaction).filter(
            Transaction.recurrence_id == tpl.id,
            Transaction.reconciliation_date.isnot(None),
            (Transaction.needs_review == False) | (Transaction.needs_review.is_(None))
        ).order_by(Transaction.date_operation.desc()).all()

        # Unreconciled / future phantom transactions
        unreconciled_q = db.query(Transaction).filter(
            Transaction.recurrence_id == tpl.id,
            Transaction.reconciliation_date.is_(None)
        ).order_by(Transaction.date_operation.asc())
        unpointed_count = unreconciled_q.count()
        unpointed_sample = [
            {
                "id": t.id,
                "date_operation": str(t.date_operation),
                "description": t.description,
                "amount": t.amount
            }
            for t in unreconciled_q.limit(5).all()
        ]

        is_abandoned = False
        reasons = []
        last_confirmed_date = None
        zero_tail = 0

        if not confirmed:
            # Check if any transaction exists
            first_tx = db.query(Transaction).filter(
                Transaction.recurrence_id == tpl.id
            ).order_by(Transaction.date_operation.asc()).first()
            if first_tx and first_tx.date_operation:
                days_old = (today - first_tx.date_operation).days
                if days_old > threshold:
                    is_abandoned = True
                    reasons.append(f"Aucune transaction confirmée depuis sa création il y a {days_old} jours")
        else:
            last_tx = confirmed[0]
            last_date = last_tx.date_operation
            last_confirmed_date = str(last_date)
            days_since_last = (today - last_date).days

            # Count consecutive zeros from the latest confirmed
            for tx in confirmed:
                if tx.amount == 0.0:
                    zero_tail += 1
                else:
                    break

            non_zeros = [tx for tx in confirmed if tx.amount != 0.0]
            last_real_date = non_zeros[0].date_operation if non_zeros else None
            days_since_real = (today - last_real_date).days if last_real_date else 999

            if days_since_last > threshold:
                is_abandoned = True
                reasons.append(f"Inactif depuis {days_since_last} jours (dernière opération confirmée le {last_date}, seuil : {threshold}j)")
            elif zero_tail >= 2:
                is_abandoned = True
                reasons.append(f"{zero_tail} échéances consécutives à 0,00 € (dernière activité réelle il y a {days_since_real} jours)")
            elif len(confirmed) >= 2:
                d_recent = confirmed[0].date_operation
                d_prev = confirmed[1].date_operation
                gap = abs((d_recent - d_prev).days)
                if gap > max(150, threshold * 2):
                    tpl_desc = tpl.description or ""
                    tx_desc = confirmed[0].description or ""
                    desc_match = tpl_desc.lower() in tx_desc.lower() or tx_desc.lower() in tpl_desc.lower()
                    if not desc_match or days_since_real > 180:
                        is_abandoned = True
                        reasons.append(f"Rupture d'activité de {gap} jours puis opération suspecte (\"{tx_desc}\") non conforme au modèle")

        if is_abandoned:
            # Collect suspicious confirmed operations (mismatched description)
            suspicious_ops = []
            for tx in confirmed:
                tpl_desc = (tpl.description or "").strip().lower()
                tx_desc = (tx.description or "").strip().lower()
                if tpl_desc and tx_desc and (tpl_desc not in tx_desc and tx_desc not in tpl_desc):
                    suspicious_ops.append({
                        "id": tx.id,
                        "date_operation": str(tx.date_operation),
                        "description": tx.description,
                        "amount": tx.amount,
                        "reconciled": True,
                        "is_suspicious": True,
                        "action_label": "Opération réelle (préservée en compte, liaison retirée)"
                    })

            # Recent real confirmed operations (sample of up to 5 for reassurance)
            recent_confirmed_sample = [
                {
                    "id": tx.id,
                    "date_operation": str(tx.date_operation),
                    "description": tx.description,
                    "amount": tx.amount,
                    "reconciled": True,
                    "is_suspicious": any(s["id"] == tx.id for s in suspicious_ops),
                    "action_label": "Opération réelle confirmée (préservée en compte)"
                }
                for tx in confirmed[:5]
            ]

            # All unreconciled / phantom operations that will be purged
            all_phantom_ops = [
                {
                    "id": t.id,
                    "date_operation": str(t.date_operation),
                    "description": t.description,
                    "amount": t.amount,
                    "reconciled": False,
                    "action_label": "Opération prévisionnelle non pointée (sera purgée)"
                }
                for t in unreconciled_q.all()
            ]

            abandoned.append({
                "id": tpl.id,
                "description": tpl.description,
                "frequency": tpl.frequency,
                "amount": tpl.amount,
                "category": tpl.category,
                "type": tpl.type,
                "reason": " ; ".join(reasons),
                "last_confirmed_date": last_confirmed_date,
                "zero_tail_count": zero_tail,
                "unpointed_count": unpointed_count,
                "unpointed_sample": unpointed_sample,
                "suspicious_ops": suspicious_ops,
                "recent_confirmed_sample": recent_confirmed_sample,
                "phantom_ops": all_phantom_ops
            })

    return abandoned


@router.get("/abandoned_recurrences/preview")
def preview_abandoned_recurrences(db: Session = Depends(get_db)):
    """
    Retourne la liste des modèles de récurrence abandonnés détectés
    avec le détail des opérations fantômes à purger.
    """
    candidates = _find_abandoned_recurrences(db)
    total_phantom_txs = sum(c["unpointed_count"] for c in candidates)
    return {
        "count": len(candidates),
        "total_phantom_txs": total_phantom_txs,
        "templates": candidates
    }


@router.post("/abandoned_recurrences/apply")
def apply_abandoned_recurrences(
    req: AbandonedRecurrencesApplyRequest,
    db: Session = Depends(get_db)
):
    """
    Clôture les modèles de récurrence abandonnés sélectionnés,
    purge leurs transactions prévisionnelles non pointées et détache
    les transactions confirmées incompatibles (mismatched description).
    """
    from app.models import RecurrenceTemplate, Transaction
    from app.routers.stats import stats_cache

    if not req.template_ids:
        return {"closed_templates": 0, "purged_transactions": 0, "unlinked_transactions": 0, "message": "Aucun modèle sélectionné."}

    closed_count = 0
    purged_count = 0
    unlinked_count = 0

    for tpl_id in req.template_ids:
        tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
        if not tpl:
            continue

        tpl.is_closed = True
        closed_count += 1

        if req.purge_unreconciled:
            # Delete unreconciled / phantom transactions
            result = db.execute(text("""
                DELETE FROM transactions
                WHERE recurrence_id = :tpl_id
                  AND reconciliation_date IS NULL
            """), {"tpl_id": tpl_id})
            purged_count += result.rowcount

        if req.unlink_mismatched:
            # Unlink confirmed or staged review transactions where description has zero overlap with template
            confirmed_txs = db.query(Transaction).filter(
                Transaction.recurrence_id == tpl_id,
                Transaction.reconciliation_date.isnot(None)
            ).all()
            for tx in confirmed_txs:
                tpl_desc = (tpl.description or "").strip().lower()
                tx_desc = (tx.description or "").strip().lower()
                raw_desc = (tx.raw_description or "").strip().lower()
                is_mismatch = (tpl_desc and tx_desc and tpl_desc not in tx_desc and tx_desc not in tpl_desc) or \
                              (tpl_desc and raw_desc and tpl_desc not in raw_desc and raw_desc not in tpl_desc)
                if is_mismatch or tx.needs_review:
                    tx.recurrence_id = None
                    if tx.needs_review and tx.raw_description:
                        # Restore clean bank description instead of ghost template label
                        tx.description = tx.raw_description.title()
                        if tx.type == "neutral" and tpl.to_account_id is not None:
                            tx.type = "expense_var"
                            tx.to_account_id = None
                    unlinked_count += 1

    db.commit()
    stats_cache.invalidate()

    return {
        "closed_templates": closed_count,
        "purged_transactions": purged_count,
        "unlinked_transactions": unlinked_count,
        "message": f"Succès : {closed_count} modèle(s) clôturé(s), {purged_count} opération(s) fantômes purgée(s)."
    }


# ---------------------------------------------------------------------------
# Global Maintenance Pre-Analysis & Health Overview
# ---------------------------------------------------------------------------

@router.get("/overview")
def get_maintenance_overview(db: Session = Depends(get_db)):
    """
    Pré-analyse globale ultra-rapide de l'intégrité de la base de données.
    Retourne l'état et le nombre de corrections suggérées pour chaque outil de nettoyage.
    """
    abandoned = _find_abandoned_recurrences(db)
    orphans = _find_orphan_recurrence_transactions(db)
    misplaced_cats, total_tx_mismatches = _audit_misplaced_categories(db)
    mismatches = _find_mismatch_rows(db)
    zeroed_data = preview_convert_zeroed_to_skipped(db)

    tools = {
        "abandoned_recurrences": {
            "id": "abandoned_recurrences",
            "count": len(abandoned),
            "label": "Récurrences abandonnées",
            "icon": "🛑",
            "description": "Modèles inactifs ou passés à 0 € générant des opérations fantômes dans le futur",
            "status": "warning" if len(abandoned) > 0 else "ok"
        },
        "orphan_recurrences": {
            "id": "orphan_recurrences",
            "count": len(orphans),
            "label": "Opérations orphelines de récurrence",
            "icon": "🧹",
            "description": "Opérations générées sur des années sans activité ou pour des modèles fermés",
            "status": "warning" if len(orphans) > 0 else "ok"
        },
        "misplaced_categories": {
            "id": "misplaced_categories",
            "count": len(misplaced_cats),
            "label": "Catégories mal classées",
            "icon": "🏷️",
            "description": "Catégories en contradiction avec les flux réels (virements, dépenses, recettes)",
            "status": "warning" if len(misplaced_cats) > 0 else "ok",
            "extra_mismatches": total_tx_mismatches
        },
        "fix_type_mismatch": {
            "id": "fix_type_mismatch",
            "count": len(mismatches),
            "label": "Types d'opérations incohérents",
            "icon": "🔧",
            "description": "Dépenses variables avec récurrence à requalifier en charges fixes",
            "status": "warning" if len(mismatches) > 0 else "ok"
        },
        "convert_zeroed_to_skipped": {
            "id": "convert_zeroed_to_skipped",
            "count": zeroed_data["count"],
            "label": "Récurrences suspendues à 0 €",
            "icon": "🔄",
            "description": "Abonnements temporairement suspendus bloquant la reprise de génération",
            "status": "warning" if zeroed_data["count"] > 0 else "ok"
        }
    }

    total_anomalies = sum(t["count"] for t in tools.values())

    return {
        "tools": tools,
        "total_anomalies": total_anomalies,
        "status": "warning" if total_anomalies > 0 else "ok"
    }

