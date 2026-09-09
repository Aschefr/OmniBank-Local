"""
Migration v06: Tables des sessions et messages du chat assistant IA.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 6
DESCRIPTION = "Tables du chat assistant IA (sessions & messages)"


def upgrade(conn: Connection) -> None:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT DEFAULT 'Nouvelle conversation',
            role TEXT DEFAULT 'advisor',
            compressed_context TEXT,
            last_compressed_message_id INTEGER,
            bubble_after_id INTEGER,
            compressing BOOLEAN DEFAULT 0,
            buffered_message TEXT,
            compression_started_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
