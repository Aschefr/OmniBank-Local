"""
Migration v27: Ajout de base_annual_amount sur budgets et initialisation des clés GlobalConfig
pour l'Étape 5 du Mode Auto-Pilote (découverte et recalibrage d'enveloppes budgétaires).
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 27
DESCRIPTION = "Budget base_annual_amount et clés GlobalConfig Auto-Pilote budgets"


def upgrade(conn: Connection) -> None:
    # 1. Nouvelle colonne sur budgets
    safe_add_column(conn, "budgets", "base_annual_amount", "FLOAT")

    # 2. Backfill : initialiser base_annual_amount pour les budgets existants
    conn.execute(text("""
        UPDATE budgets
        SET base_annual_amount = CASE
            WHEN period = 'yearly' THEN monthly_amount
            ELSE monthly_amount * 12
        END
        WHERE base_annual_amount IS NULL AND monthly_amount IS NOT NULL
    """))

    # 3. Clés GlobalConfig pour l'Étape 5
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('budget_minimum_threshold', '30.0')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('last_budget_recalibration_period', '')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_create_budget_envelopes', 'false')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_apply_budget_suggestions', 'false')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('enable_budget_creation_suggestions', 'true')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('enable_budget_recalibration_suggestions', 'true')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('budget_suggestion_engine', 'deterministic')"))
