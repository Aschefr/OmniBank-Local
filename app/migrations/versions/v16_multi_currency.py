"""
Migration v16: Support multi-devises, table des taux et conversion hors-ligne.
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 16
DESCRIPTION = "Support multi-devises et taux de change hors-ligne"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "accounts", "currency", "TEXT DEFAULT 'EUR'")
    safe_add_column(conn, "transactions", "original_amount", "FLOAT")
    safe_add_column(conn, "transactions", "original_currency", "TEXT")

    conn.execute(text("""
        CREATE TABLE IF NOT EXISTS exchange_rates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_currency TEXT NOT NULL,
            to_currency TEXT NOT NULL,
            rate REAL NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """))

    # Initialisation de la devise de référence si absente
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('base_currency', 'EUR')"))

    # Seed des taux de change par défaut si la table est vide
    rate_count = conn.execute(text("SELECT COUNT(*) FROM exchange_rates")).scalar() or 0
    if rate_count == 0:
        default_rates = [
            ("USD", "EUR", 0.92), ("EUR", "USD", 1.087),
            ("GBP", "EUR", 1.17), ("EUR", "GBP", 0.855),
            ("CHF", "EUR", 1.05), ("EUR", "CHF", 0.952),
            ("CAD", "EUR", 0.68), ("EUR", "CAD", 1.47),
            ("JPY", "EUR", 0.006), ("EUR", "JPY", 166.67),
        ]
        for f, t, r in default_rates:
            conn.execute(
                text("INSERT INTO exchange_rates (from_currency, to_currency, rate) VALUES (:f, :t, :r)"),
                {"f": f, "t": t, "r": r}
            )
