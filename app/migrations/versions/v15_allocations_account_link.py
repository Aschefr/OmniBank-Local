"""
Migration v15: Liaison compte financier sur les allocations d'épargne.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 15
DESCRIPTION = "Liaison compte financier sur les allocations d'épargne"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "budget_allocations", "account_id", "INTEGER REFERENCES accounts(id)")
