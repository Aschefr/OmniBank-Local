"""
Migration v14: Pile de compression multi-bulles du chat.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 14
DESCRIPTION = "Pile de compression multi-bulles du chat"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "chat_sessions", "compression_stack", "TEXT")
