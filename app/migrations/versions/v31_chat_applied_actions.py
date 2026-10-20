"""
Migration v31: Suivi et persistance des actions interactives appliquées sur les messages du chat.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 31
DESCRIPTION = "Actions interactives appliquées sur les messages du chat"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "chat_messages", "applied_actions", "TEXT")
