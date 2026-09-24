"""
Migration v30: Ajout des colonnes needs_review et confidence_score sur la table transactions.
Permet le mode d'ingestion Full-Auto avec drapeau de revue manuelle et score de confiance.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 30
DESCRIPTION = "Ajout des colonnes needs_review et confidence_score sur transactions"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "transactions", "needs_review", "BOOLEAN DEFAULT 0")
    safe_add_column(conn, "transactions", "confidence_score", "REAL")
    try:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transactions_needs_review ON transactions(needs_review)"))
    except Exception:
        pass
