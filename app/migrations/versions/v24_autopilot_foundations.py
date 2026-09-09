"""
Migration v24: Journal de décisions Auto-Pilot, verrouillage budgétaire et config.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 24
DESCRIPTION = "Fondations de l'Auto-Pilot bancaire et verrou budgétaire"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "budgets", "is_locked", "BOOLEAN DEFAULT 0")

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS autopilot_decision_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id TEXT NOT NULL,
            decision_type TEXT NOT NULL,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            conn_id INTEGER,
            account_id INTEGER,
            raw_snapshot TEXT,
            confidence_score FLOAT,
            is_undone BOOLEAN DEFAULT 0,
            undone_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_autopilot_decision_log_batch_id ON autopilot_decision_log (batch_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_autopilot_decision_log_entity ON autopilot_decision_log (entity_type, entity_id)"))
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_autopilot_decision_log_created_at ON autopilot_decision_log (created_at)"))

    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_pilot_enabled', 'false')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('bank_sync_on_vault_unlock', 'true')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('last_auto_sync_attempt', '')"))
