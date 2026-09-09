"""
Migration v03: Enveloppes tirelires et table des allocations budgétaires.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 3
DESCRIPTION = "Enveloppes tirelires et allocations budgétaires"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "budgets", "envelope_type", "TEXT DEFAULT 'spending'")

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS budget_allocations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            budget_id INTEGER NOT NULL REFERENCES budgets(id),
            amount REAL NOT NULL,
            date DATE NOT NULL,
            note TEXT,
            created_at TEXT
        )
    """))
