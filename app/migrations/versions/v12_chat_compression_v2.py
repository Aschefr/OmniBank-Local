"""
Migration v12: Compression de contexte LLM v2 et reprise sur incident.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 12
DESCRIPTION = "Compression de contexte LLM v2 et reprise sur incident"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "chat_sessions", "last_compressed_message_id", "INTEGER")
    safe_add_column(conn, "chat_sessions", "compressing", "BOOLEAN DEFAULT 0")
    safe_add_column(conn, "chat_sessions", "buffered_message", "TEXT")
    safe_add_column(conn, "chat_sessions", "compression_started_at", "TIMESTAMP")

    # Déblocage de toute session restée bloquée lors d'un crash antérieur
    conn.execute(text("""
        UPDATE chat_sessions SET compressing = 0
        WHERE compressing = 1
        AND compression_started_at < datetime('now', '-5 minutes')
    """))
