"""
Migration v26: Ajout de la colonne comment sur la table transactions pour la traçabilité des ajustements.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 26
DESCRIPTION = "Ajout de la colonne comment sur les transactions"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "transactions", "comment", "TEXT")
