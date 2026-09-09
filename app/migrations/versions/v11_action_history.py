"""
Migration v11: Table d'historique des actions (undo / redo).
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 11
DESCRIPTION = "Table d'historique des actions (undo / redo)"


def upgrade(conn: Connection) -> None:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS action_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            entity_type TEXT NOT NULL,
            entity_id INTEGER NOT NULL,
            action_type TEXT NOT NULL,
            previous_state TEXT,
            new_state TEXT,
            is_undone BOOLEAN DEFAULT 0,
            user_name TEXT
        )
    """))
