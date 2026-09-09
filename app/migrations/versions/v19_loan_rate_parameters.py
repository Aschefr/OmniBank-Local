"""
Migration v19: Paramètres avancés des prêts et livrets rémunérés.
"""
from sqlalchemy.engine import Connection
from app.migrations.runner import safe_add_column

VERSION = 19
DESCRIPTION = "Paramètres de taux et d'assurance sur les comptes"


def upgrade(conn: Connection) -> None:
    safe_add_column(conn, "accounts", "interest_rate", "FLOAT")
    safe_add_column(conn, "accounts", "borrowed_amount", "FLOAT")
    safe_add_column(conn, "accounts", "monthly_payment", "FLOAT")
    safe_add_column(conn, "accounts", "loan_end_date", "DATE")
    safe_add_column(conn, "accounts", "loan_insurance", "FLOAT")
