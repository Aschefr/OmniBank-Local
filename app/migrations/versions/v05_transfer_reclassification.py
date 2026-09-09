"""
Migration v05: Reclassement des catégories neutres en transferts.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 5
DESCRIPTION = "Reclassement des catégories neutres en transferts"


def upgrade(conn: Connection) -> None:
    conn.execute(text("UPDATE categories SET type = 'transfer' WHERE type = 'neutral'"))
