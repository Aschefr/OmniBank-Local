"""
Migration v32: Support des variantes de réponses et onglets multi-versions pour chat_messages.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 32
DESCRIPTION = "Support des variantes de réponses et onglets multi-versions pour chat_messages"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "chat_messages", "variants", "TEXT")
    safe_add_column(conn, "chat_messages", "active_variant_index", "INTEGER DEFAULT 0")
