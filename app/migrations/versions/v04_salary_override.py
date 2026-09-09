"""
Migration v04: Indicateur manuel de salaire sur les transactions.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 4
DESCRIPTION = "Indicateur manuel de salaire sur les transactions"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "transactions", "is_salary", "BOOLEAN DEFAULT NULL")
