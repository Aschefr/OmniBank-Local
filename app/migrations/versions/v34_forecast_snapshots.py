"""
Migration v34: prévision figée de la période, pour comparer le réel à la prévision sur le Cockpit
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 34
DESCRIPTION = "Prévision enregistrée au début de chaque période pour le suivi du Cockpit"


def upgrade(conn: Connection) -> None:
    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS forecast_snapshots (
            id INTEGER NOT NULL PRIMARY KEY,
            scope VARCHAR NOT NULL,
            period_kind VARCHAR NOT NULL,
            period_start DATE NOT NULL,
            period_end DATE NOT NULL,
            created_on DATE NOT NULL,
            points TEXT NOT NULL,
            recent_history BOOLEAN,
            CONSTRAINT uq_forecast_snapshot_scope_period UNIQUE (scope, period_start)
        )
    """))
