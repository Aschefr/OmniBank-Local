"""
Migration v22: Archivage et indexation temporelle des notifications.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 22
DESCRIPTION = "Archivage et indexation temporelle des notifications"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "notifications", "is_archived", "BOOLEAN DEFAULT 0")
    safe_add_column(conn, "notifications", "archived_at", "TIMESTAMP")
    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_archived_created ON notifications (is_archived, created_at)"))
