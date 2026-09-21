"""
Migration v28: Initialisation des clés GlobalConfig pour l'Étape 5.5
(Automatismes des Opérations & Ingestion Bancaire, et Cycle de Vie des Catégories).
Toutes les clés sont initialisées par défaut à 'false' (choix prudent et souverain de l'utilisateur).
"""
from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 28
DESCRIPTION = "Clés GlobalConfig pour l'Étape 5.5 (Automatismes Opérations & Catégories)"


def upgrade(conn: Connection) -> None:
    # Volet A : Automatismes des Opérations & Ingestion Bancaire
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_reconcile_transactions', 'false')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_commit_incoming_transactions', 'false')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_close_empty_import_sas', 'false')"))

    # Volet B : Automatismes Smart Labels & Cycle de Vie des Catégories
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_create_missing_categories', 'false')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_learn_merchant_rules', 'false')"))
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_assign_chameleon_fallback', 'false')"))
