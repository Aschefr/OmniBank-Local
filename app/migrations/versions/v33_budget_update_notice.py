"""
Migration v33: message unique sur la page Budgets pour les profils qui avaient déjà des enveloppes.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import table_exists

VERSION = 33
DESCRIPTION = "Message d'information sur la nouvelle page Budgets pour les profils existants"


def upgrade(conn: Connection) -> None:
    if not table_exists(conn, "budgets") or not table_exists(conn, "global_config"):
        return
    if conn.execute(text("SELECT 1 FROM budgets LIMIT 1")).fetchone() is None:
        return
    conn.execute(text("DELETE FROM global_config WHERE key = 'budget_update_notice'"))
    conn.execute(text("INSERT INTO global_config (key, value) VALUES ('budget_update_notice', 'true')"))
