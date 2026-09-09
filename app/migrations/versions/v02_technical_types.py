"""
Migration v02: Normalisation des types techniques et colonnes prêts/audit.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 2
DESCRIPTION = "Normalisation des types techniques et colonnes prêts/audit"


def upgrade(conn: Connection) -> None:
    # 1. Normalisation idempotente des libellés de types français vers clés techniques
    type_migration = {
        "Dépenses fixes": "expense_fixed",
        "Dépenses variables": "expense_var",
        "Recettes": "income",
        "Transfert": "transfer",
        "Neutre": "neutral",
    }
    for old_val, new_val in type_migration.items():
        conn.execute(text("UPDATE transactions SET type = :new WHERE type = :old"), {"new": new_val, "old": old_val})
        conn.execute(text("UPDATE categories SET type = :new WHERE type = :old"), {"new": new_val, "old": old_val})
        conn.execute(text("UPDATE recurrence_templates SET type = :new WHERE type = :old"), {"new": new_val, "old": old_val})

    # 2. Catégories & récurrences
    safe_add_column(conn, "categories", "is_closed", "BOOLEAN DEFAULT 0")
    safe_add_column(conn, "recurrence_templates", "max_occurrences", "INTEGER")
    safe_add_column(conn, "recurrence_templates", "is_closed", "BOOLEAN DEFAULT 0")

    # 3. Comptes (emprunts & couleurs)
    safe_add_column(conn, "accounts", "color", "TEXT")
    safe_add_column(conn, "accounts", "interest_rate", "FLOAT")
    safe_add_column(conn, "accounts", "borrowed_amount", "FLOAT")
    safe_add_column(conn, "accounts", "monthly_payment", "FLOAT")
    safe_add_column(conn, "accounts", "loan_end_date", "DATE")
    safe_add_column(conn, "accounts", "loan_insurance", "FLOAT")

    # 4. Transactions (audit multi-utilisateurs & horodatages)
    safe_add_column(conn, "transactions", "created_by", "TEXT")
    safe_add_column(conn, "transactions", "modified_by", "TEXT")
    safe_add_column(conn, "transactions", "created_at", "TEXT")
    safe_add_column(conn, "transactions", "modified_at", "TEXT")

    # 5. Budgets (périodes personnalisées & filtres de comptes)
    safe_add_column(conn, "budgets", "start_date", "DATE")
    safe_add_column(conn, "budgets", "end_date", "DATE")
    safe_add_column(conn, "budgets", "account_ids", "TEXT")
