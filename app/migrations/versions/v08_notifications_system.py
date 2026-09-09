"""
Migration v08: Table du centre de notifications financières.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 8
DESCRIPTION = "Table du centre de notifications financières"


def upgrade(conn: Connection) -> None:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            detailed_content TEXT,
            is_read BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
