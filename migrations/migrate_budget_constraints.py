"""
migrate_budget_constraints.py
------------------------------
Migration SQLite : ajout des contraintes sur les tables budgets et budget_categories.

- Index unique sur budget_categories(budget_id, category_name)
- Nettoyage préalable des éventuels doublons
- Normalisation des envelope_type invalides/nuls → 'spending'
- CheckConstraint sur budgets.envelope_type via recréation de table

Usage:
    python migrations/migrate_budget_constraints.py
"""
import sqlite3
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'omnibank.db')


def run():
    if not os.path.exists(DB_PATH):
        print(f"[ERREUR] Base de données introuvable : {DB_PATH}")
        sys.exit(1)

    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA foreign_keys = OFF")
    con.execute("PRAGMA journal_mode = WAL")
    cur = con.cursor()

    print("=== Migration budget_constraints ===")

    # ── 1. Vérifier si l'index unique existe déjà ──────────────────────────────
    cur.execute("SELECT name FROM sqlite_master WHERE type='index' AND name='ix_budget_category_unique'")
    already_has_index = cur.fetchone() is not None

    if already_has_index:
        print("[SKIP] Index ix_budget_category_unique déjà présent.")
    else:
        # ── 2. Nettoyer les doublons dans budget_categories ────────────────────
        print("[ETAPE 1] Nettoyage des doublons dans budget_categories...")
        cur.execute("""
            DELETE FROM budget_categories
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM budget_categories
                GROUP BY budget_id, category_name
            )
        """)
        deleted = con.total_changes
        if deleted > 0:
            print(f"  {deleted} doublon(s) supprimé(s).")
        else:
            print("  Aucun doublon trouvé.")

        # ── 3. Créer l'index unique ────────────────────────────────────────────
        print("[ETAPE 2] Création de l'index unique sur budget_categories(budget_id, category_name)...")
        cur.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS ix_budget_category_unique
            ON budget_categories(budget_id, category_name)
        """)
        print("  Index créé.")

    # ── 4. Normaliser les envelope_type invalides/nuls ─────────────────────────
    print("[ETAPE 3] Normalisation des envelope_type invalides/nuls...")
    cur.execute("""
        UPDATE budgets
        SET envelope_type = 'spending'
        WHERE envelope_type IS NULL OR envelope_type NOT IN ('spending', 'savings')
    """)
    updated = con.total_changes
    if updated > 0:
        print(f"  {updated} ligne(s) normalisée(s).")
    else:
        print("  Aucune normalisation nécessaire.")

    # ── 5. Vérifier si la table budgets a déjà la contrainte CHECK ─────────────
    cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='budgets'")
    row = cur.fetchone()
    table_sql = row[0] if row else ""
    already_has_check = "ck_budget_envelope_type" in table_sql or "CHECK" in table_sql.upper()

    if already_has_check:
        print("[SKIP] CheckConstraint ck_budget_envelope_type déjà présent.")
    else:
        print("[ETAPE 4] Ajout du CheckConstraint sur budgets.envelope_type (recréation de table)...")

        # Lire les données existantes
        cur.execute("SELECT id, name, monthly_amount, period, is_project, is_closed, start_date, end_date, account_ids, envelope_type FROM budgets")
        rows = cur.fetchall()
        print(f"  {len(rows)} enveloppe(s) à migrer.")

        # Recréer la table avec la contrainte
        cur.executescript("""
            DROP TABLE IF EXISTS budgets_old_constraints;
            ALTER TABLE budgets RENAME TO budgets_old_constraints;

            CREATE TABLE budgets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                monthly_amount REAL NOT NULL,
                period TEXT DEFAULT 'monthly',
                is_project INTEGER DEFAULT 0,
                is_closed INTEGER DEFAULT 0,
                start_date TEXT,
                end_date TEXT,
                account_ids TEXT,
                envelope_type TEXT DEFAULT 'spending',
                CONSTRAINT ck_budget_envelope_type CHECK(envelope_type IN ('spending', 'savings'))
            );
        """)

        # Réinsérer les données
        cur.executemany("""
            INSERT INTO budgets (id, name, monthly_amount, period, is_project, is_closed,
                                 start_date, end_date, account_ids, envelope_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)

        # Recréer l'index sur budget_id (référencé par transactions et budget_categories)
        cur.execute("DROP TABLE IF EXISTS budgets_old_constraints")
        print(f"  {len(rows)} enveloppe(s) migrée(s) avec CheckConstraint.")

    con.execute("PRAGMA foreign_keys = ON")
    con.commit()
    con.close()
    print("\n[OK] Migration budget_constraints terminee.")


if __name__ == "__main__":
    run()
