"""
fix_type_mismatch.py — Corriger les opérations expense_var avec récurrence.

Transactions with type='expense_var' that have is_monthly=1 OR recurrence_id IS NOT NULL
should actually be type='expense_fixed'.

Usage:
    python scripts/fix_type_mismatch.py          # dry-run (default)
    python scripts/fix_type_mismatch.py --apply  # apply changes

Note: Categories shared between expense_var and expense_fixed operations are shown
      interactively — the user decides whether to MOVE or KEEP each.
"""
import sys, os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'omnibank.db')
# Fallback: try to get DATA_DIR from app config
try:
    from app.database import DATA_DIR
    DB_PATH = os.path.join(DATA_DIR, 'omnibank.db')
except Exception:
    pass

import sqlite3

def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def find_mismatch(conn):
    q = """
        SELECT id, description, amount, type, date_operation, category, recurrence_id, is_monthly
        FROM transactions
        WHERE type = 'expense_var'
          AND (is_monthly = 1 OR recurrence_id IS NOT NULL)
        ORDER BY date_operation DESC
    """
    return conn.execute(q).fetchall()

def find_affected_categories(conn, tx_ids):
    """Find categories used by mismatched transactions."""
    placeholders = ','.join('?' * len(tx_ids))
    q = f"""
        SELECT DISTINCT category
        FROM transactions
        WHERE id IN ({placeholders})
          AND category IS NOT NULL AND category != ''
    """
    return [r['category'] for r in conn.execute(q, tx_ids).fetchall()]

def cat_has_other_expense_var(conn, cat_name, exclude_ids):
    """Check if a category is also used in OTHER expense_var transactions (not mismatch)."""
    placeholders = ','.join('?' * len(exclude_ids))
    q = f"""
        SELECT COUNT(*) as cnt
        FROM transactions
        WHERE type = 'expense_var'
          AND category = ?
          AND id NOT IN ({placeholders})
    """
    row = conn.execute(q, [cat_name] + list(exclude_ids)).fetchone()
    return row['cnt'] > 0

def main():
    apply = '--apply' in sys.argv

    conn = connect()
    rows = find_mismatch(conn)

    print(f"\n{'='*60}")
    print(f"  OmniBank — Correction types incohérents")
    print(f"  Mode : {'APPLY' if apply else 'DRY-RUN'}")
    print(f"{'='*60}")
    print(f"\n{len(rows)} transaction(s) expense_var avec récurrence détectée(s):\n")

    if not rows:
        print("  Aucune correction necessaire. OK")
        conn.close()
        return

    for r in rows[:20]:
        print(f"  [{r['id']}] {r['date_operation']}  {r['description'][:40]:<40}  {r['amount']:>10.2f} €  cat={r['category'] or '—'}  rec_id={r['recurrence_id']}")
    if len(rows) > 20:
        print(f"  ... et {len(rows)-20} autres.")

    tx_ids = [r['id'] for r in rows]
    affected_cats = find_affected_categories(conn, tx_ids)

    print(f"\nCatégories concernées par ces opérations : {affected_cats}")

    cat_decisions = {}  # cat_name -> 'move' | 'keep'
    shared_cats = []
    for cat in affected_cats:
        if cat_has_other_expense_var(conn, cat, tx_ids):
            shared_cats.append(cat)
            print(f"\n  ⚠️  Catégorie '{cat}' est aussi utilisée dans d'AUTRES operations expense_var.")
            if apply:
                print(f"      Que faire ? (m=déplacer vers expense_fixed, k=garder en expense_var) [m/k]: ", end='')
                choice = input().strip().lower()
                cat_decisions[cat] = 'move' if choice == 'm' else 'keep'
            else:
                print(f"      (en mode --apply vous pourrez choisir de déplacer ou garder)")
                cat_decisions[cat] = 'ask'
        else:
            cat_decisions[cat] = 'move'

    if not apply:
        print(f"\n{'='*60}")
        print(f"  DRY-RUN terminé. Lancez avec --apply pour appliquer.")
        print(f"{'='*60}")
        conn.close()
        return

    # Apply
    print(f"\n  Correction en cours ...")
    cur = conn.cursor()

    # 1. Update transactions
    cur.execute("""
        UPDATE transactions
        SET type = 'expense_fixed'
        WHERE type = 'expense_var'
          AND (is_monthly = 1 OR recurrence_id IS NOT NULL)
    """)
    tx_fixed = cur.rowcount
    print(f"  → {tx_fixed} transaction(s) mises à jour (expense_var → expense_fixed)")

    # 2. Update categories as decided
    cat_fixed = 0
    for cat, decision in cat_decisions.items():
        if decision == 'move':
            cur.execute("UPDATE categories SET type = 'expense_fixed' WHERE name = ? AND type = 'expense_var'", (cat,))
            if cur.rowcount > 0:
                cat_fixed += 1
                print(f"  → Catégorie '{cat}' déplacée vers expense_fixed")
        else:
            print(f"  → Catégorie '{cat}' conservée en expense_var")

    conn.commit()
    conn.close()

    print(f"\n{'='*60}")
    print(f"  Migration terminée.")
    print(f"  {tx_fixed} transactions corrigées, {cat_fixed} catégories déplacées.")
    print(f"{'='*60}\n")

if __name__ == '__main__':
    main()
