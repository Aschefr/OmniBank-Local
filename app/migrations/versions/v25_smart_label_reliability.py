"""
Migration v25: Fiabilité Smart Label (règles manuelles, multi-catégories et comptages).
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 25
DESCRIPTION = "Règles manuelles, multi-catégories et distribution de catégories Smart Label"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "bank_label_mappings", "is_manual", "BOOLEAN DEFAULT 0")
    safe_add_column(conn, "bank_label_mappings", "is_multi_category", "BOOLEAN DEFAULT 0")
    safe_add_column(conn, "bank_label_mappings", "category_counts", "TEXT")
