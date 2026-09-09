"""
Migration v18: Simulateur de budget et scénarios prévisionnels What-If.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 18
DESCRIPTION = "Simulateur de budget et scénarios prévisionnels What-If"


def upgrade(conn: Connection) -> None:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS scenarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            color TEXT DEFAULT '#8b5cf6',
            is_active BOOLEAN DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS scenario_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id INTEGER NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            event_type TEXT NOT NULL,
            amount REAL NOT NULL DEFAULT 0.0,
            account_id INTEGER REFERENCES accounts(id),
            category TEXT,
            start_date DATE NOT NULL,
            end_date DATE,
            duration_months INTEGER,
            is_active BOOLEAN DEFAULT 1,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_scenario_events_scenario_id ON scenario_events (scenario_id)"))
