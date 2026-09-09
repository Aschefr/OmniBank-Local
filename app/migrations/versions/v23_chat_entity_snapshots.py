"""
Migration v23: Instantanés d'entités pour les badges historiques du chat.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 23
DESCRIPTION = "Instantanés d'entités sur les messages du chat"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "chat_messages", "entity_snapshots", "TEXT")
