"""
Moteur d'exécution des migrations incrémentales du schéma SQLite d'OmniBank.
Gère l'atomicité, la traçabilité des montées de version et les opérations DDL sécurisées.
"""
import logging
from dataclasses import dataclass
from typing import Callable, List
from sqlalchemy import text
from sqlalchemy.engine import Engine, Connection

logger = logging.getLogger(__name__)

TARGET_SCHEMA_VERSION = 25


@dataclass
class Migration:
    version: int
    description: str
    upgrade: Callable[[Connection], None]


def get_current_schema_version(conn: Connection) -> int:
    """Récupère la version actuelle du schéma depuis global_config. Retourne 0 si absente."""
    try:
        row = conn.execute(text("SELECT value FROM global_config WHERE key = 'schema_version'")).fetchone()
        if row and row[0] and str(row[0]).isdigit():
            return int(row[0])
    except Exception:
        pass
    return 0


def set_schema_version(conn: Connection, version: int) -> None:
    """Enregistre la nouvelle version du schéma dans global_config."""
    conn.execute(
        text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', :val)"),
        {"val": str(version)}
    )


def column_exists(conn: Connection, table_name: str, column_name: str) -> bool:
    """Vérifie si une colonne existe dans une table via PRAGMA table_info."""
    try:
        rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
        return any(row[1].lower() == column_name.lower() for row in rows)
    except Exception:
        return False


def safe_add_column(conn: Connection, table_name: str, column_name: str, column_type: str) -> bool:
    """Ajoute une colonne à une table uniquement si elle n'existe pas déjà."""
    if not column_exists(conn, table_name, column_name):
        conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"))
        return True
    return False


def table_exists(conn: Connection, table_name: str) -> bool:
    """Vérifie si une table existe dans sqlite_master."""
    try:
        row = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
            {"t": table_name}
        ).fetchone()
        return row is not None
    except Exception:
        return False


def ensure_base_indexes(conn: Connection) -> None:
    """Crée de façon idempotente les index de performance de base sur transactions."""
    indexes = [
        "CREATE INDEX IF NOT EXISTS ix_transactions_budget_id ON transactions (budget_id)",
        "CREATE INDEX IF NOT EXISTS ix_transactions_category_date ON transactions (category, date_operation)",
        "CREATE INDEX IF NOT EXISTS ix_transactions_date_op ON transactions (date_operation)",
        "CREATE INDEX IF NOT EXISTS ix_transactions_recon_date ON transactions (reconciliation_date, date_operation)",
        "CREATE INDEX IF NOT EXISTS ix_transactions_from_to_date ON transactions (from_account_id, to_account_id, date_operation)",
    ]
    for idx_sql in indexes:
        try:
            conn.execute(text(idx_sql))
        except Exception as e:
            logger.debug(f"[Migration] Création index ignorée ou existant: {e}")


def run_migrations(target_engine: Engine) -> int:
    """
    Exécute de manière séquentielle toutes les migrations en attente sur l'engine cible.
    Chaque migration réussie est validée par commit avec mise à jour du schema_version.
    """
    with target_engine.connect() as conn:
        ensure_base_indexes(conn)
        conn.commit()

        current_version = get_current_schema_version(conn)
        if current_version >= TARGET_SCHEMA_VERSION:
            return current_version

        logger.info(f"[Migration] Version actuelle de la base : v{current_version} (Cible : v{TARGET_SCHEMA_VERSION})")

        from app.migrations.versions import ALL_MIGRATIONS
        for mig in ALL_MIGRATIONS:
            if mig.version > current_version:
                logger.info(f"[Migration] Application v{mig.version:02d}: {mig.description}...")
                mig.upgrade(conn)
                set_schema_version(conn, mig.version)
                conn.commit()
                current_version = mig.version

        logger.info(f"[Migration] Base de données mise à jour au schéma v{current_version} avec succès.")
        return current_version
