"""
Migration v20: Base de connaissances du Smart Label Engine.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 20
DESCRIPTION = "Table des règles d'apprentissage Smart Label"


def upgrade(conn: Connection) -> None:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS bank_label_mappings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            raw_pattern TEXT NOT NULL UNIQUE,
            clean_description TEXT,
            category TEXT,
            is_ignored BOOLEAN DEFAULT 0,
            match_count INTEGER DEFAULT 1,
            last_used_at DATETIME,
            created_at DATETIME
        )
    """))
    conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_bank_label_mappings_raw_pattern ON bank_label_mappings (raw_pattern)"))
