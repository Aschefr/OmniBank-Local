"""
Migration v09: Colonne de contenu détaillé sur les notifications.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 9
DESCRIPTION = "Contenu détaillé sur les notifications"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "notifications", "detailed_content", "TEXT")
