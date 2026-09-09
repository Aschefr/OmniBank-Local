"""
Migration v10: Données de lien interactif sur les notifications.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 10
DESCRIPTION = "Données de lien interactif sur les notifications"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "notifications", "link_data", "TEXT")
