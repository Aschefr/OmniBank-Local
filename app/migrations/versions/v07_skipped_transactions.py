"""
Migration v07: Indicateur d'occurrence sautée sur les transactions récurrentes.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 7
DESCRIPTION = "Indicateur d'occurrence sautée sur les transactions"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "transactions", "is_skipped", "BOOLEAN DEFAULT 0")
