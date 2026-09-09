"""
Package de gestion des migrations incrémentales de la base SQLite OmniBank.
"""
from app.migrations.runner import (
    run_migrations,
    TARGET_SCHEMA_VERSION,
    get_current_schema_version,
    Migration
)

__all__ = [
    "run_migrations",
    "TARGET_SCHEMA_VERSION",
    "get_current_schema_version",
    "Migration"
]
