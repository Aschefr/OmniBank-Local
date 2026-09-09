"""
Migration v13: Positionnement persistant de la bulle de synthèse chat.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 13
DESCRIPTION = "Positionnement persistant de la bulle de synthèse chat"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "chat_sessions", "bubble_after_id", "INTEGER")
