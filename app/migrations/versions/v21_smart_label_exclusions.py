"""
Migration v21: Règle d'exclusion/ignorance sur le Smart Label Engine.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 21
DESCRIPTION = "Indicateur d'exclusion sur les règles Smart Label"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "bank_label_mappings", "is_ignored", "BOOLEAN DEFAULT 0")
