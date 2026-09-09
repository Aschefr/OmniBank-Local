"""
Migration v17: Liens et statuts de virements inter-profils.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 17
DESCRIPTION = "Liens et statuts de virements inter-profils"


def upgrade(conn: Connection) -> None:
    for col in [
        "cross_profile_link_id",
        "cross_profile_id",
        "cross_profile_label",
        "cross_profile_status"
    ]:
        safe_add_column(conn, "transactions", col, "TEXT")

    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transactions_cross_link ON transactions (cross_profile_link_id)"))
