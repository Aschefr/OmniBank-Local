"""
migrations/migrate_autopilot.py
-------------------------------
Migration SQLite : Initialisation des fondations techniques pour le mode Auto-Pilot (Étape 0).

- Ajout de la table `autopilot_decision_log` et de ses index.
- Ajout de la colonne `is_locked` (défaut False) dans la table `budgets`.
- Initialisation des clés de configuration Auto-Pilot dans `global_config`.
- Mise à jour de `schema_version` vers '24'.
- Application automatique sur la base par défaut et tous les profils configurés.

Usage:
    python migrations/migrate_autopilot.py
"""
import sqlite3
import os
import sys
import logging

# Permettre l'import depuis la racine du projet
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.database import DATA_DIR
from app.profile_manager import load_profiles_data, get_profile_db_path

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def migrate_single_db(db_path: str, profile_name: str = "Inconnu"):
    if not os.path.exists(db_path):
        logger.warning(f"[SKIP] Base introuvable pour profil '{profile_name}': {db_path}")
        return

    logger.info(f"\n=== Migration Auto-Pilot pour profil '{profile_name}' ({db_path}) ===")
    con = sqlite3.connect(db_path)
    con.execute("PRAGMA foreign_keys = OFF")
    con.execute("PRAGMA journal_mode = WAL")
    cur = con.cursor()

    try:
        # 1. Table autopilot_decision_log
        cur.execute("""
            CREATE TABLE IF NOT EXISTS autopilot_decision_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id TEXT NOT NULL,
                decision_type TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER,
                conn_id INTEGER,
                account_id INTEGER,
                raw_snapshot TEXT,
                confidence_score FLOAT,
                is_undone BOOLEAN DEFAULT 0,
                undone_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_autopilot_decision_log_batch_id ON autopilot_decision_log (batch_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_autopilot_decision_log_entity ON autopilot_decision_log (entity_type, entity_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_autopilot_decision_log_created_at ON autopilot_decision_log (created_at)")
        logger.info("  [OK] Table 'autopilot_decision_log' et index vérifiés/créés.")

        # 2. Colonne is_locked dans budgets
        cur.execute("PRAGMA table_info(budgets)")
        columns = [c[1] for c in cur.fetchall()]
        if "is_locked" not in columns:
            cur.execute("ALTER TABLE budgets ADD COLUMN is_locked BOOLEAN DEFAULT 0")
            logger.info("  [OK] Colonne 'is_locked' ajoutée à la table 'budgets'.")
        else:
            logger.info("  [SKIP] Colonne 'is_locked' déjà présente dans 'budgets'.")

        # 3. Table global_config et clés de configuration
        cur.execute("""
            CREATE TABLE IF NOT EXISTS global_config (
                key VARCHAR(64) PRIMARY KEY,
                value TEXT
            )
        """)

        default_configs = [
            ("auto_pilot_enabled", "false"),
            ("bank_sync_on_vault_unlock", "true"),
            ("last_auto_sync_attempt", "")
        ]

        for k, v in default_configs:
            cur.execute("SELECT value FROM global_config WHERE key = ?", (k,))
            if cur.fetchone() is None:
                cur.execute("INSERT INTO global_config (key, value) VALUES (?, ?)", (k, v))
                logger.info(f"  [OK] Config '{k}' initialisée à '{v}'.")
            else:
                logger.info(f"  [SKIP] Config '{k}' déjà existante.")

        # 4. Schéma version 24
        cur.execute("SELECT value FROM global_config WHERE key = 'schema_version'")
        sv_row = cur.fetchone()
        current_version = int(sv_row[0]) if sv_row and sv_row[0].isdigit() else 0
        if current_version < 24:
            cur.execute("""
                INSERT INTO global_config (key, value) VALUES ('schema_version', '24')
                ON CONFLICT(key) DO UPDATE SET value = '24'
            """)
            logger.info(f"  [OK] Version de schéma mise à jour : v{current_version} -> v24.")
        else:
            logger.info(f"  [SKIP] Version de schéma déjà >= 24 (actuelle: v{current_version}).")

        con.commit()
        logger.info("  -> Migration terminée avec succès pour cette base.")

    except Exception as e:
        con.rollback()
        logger.error(f"  [ERREUR] Échec de la migration sur {db_path}: {e}")
        raise
    finally:
        con.close()


def run_all():
    print("==========================================================")
    print("   OMNIBANK - MIGRATION AUTO-PILOT (ÉTAPE 0 / SCHÉMA V24) ")
    print("==========================================================")

    # Récupérer tous les profils enregistrés
    data = load_profiles_data()
    profiles = data.get("profiles", [])

    db_paths_seen = set()

    for p in profiles:
        p_id = p.get("id")
        p_name = p.get("name", p_id)
        db_path = get_profile_db_path(p_id)
        if db_path not in db_paths_seen:
            db_paths_seen.add(db_path)
            migrate_single_db(db_path, p_name)

    # Vérifier aussi la base par défaut standard dans DATA_DIR si non couverte
    default_db = os.path.normpath(os.path.join(DATA_DIR, "omnibank.db"))
    if default_db not in db_paths_seen and os.path.exists(default_db):
        migrate_single_db(default_db, "Default Base (Root)")

    print("\n[SUCCÈS] Toutes les bases de données OmniBank ont été migrées vers le schéma v24.")


if __name__ == "__main__":
    run_all()
