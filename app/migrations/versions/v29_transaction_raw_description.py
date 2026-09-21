"""
Migration v29: Ajout de la colonne raw_description et de son index sur la table transactions.
Permet la conservation immuable du libellé bancaire d'origine pour le matching d'historique Smart Label.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 29
DESCRIPTION = "Ajout de la colonne raw_description et index sur transactions"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "transactions", "raw_description", "TEXT")
    try:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transactions_raw_desc ON transactions(raw_description)"))
    except Exception:
        pass
