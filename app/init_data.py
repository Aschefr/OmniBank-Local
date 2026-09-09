"""
Point d'entrée d'initialisation de la base SQLite OmniBank et amorçage des données.
Délègue l'exécution incrémentale du schéma au module modulaire app.migrations.
"""
import os
import logging
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import engine, Base, SessionLocal
import app.models  # Register all models for create_all
from app.models import Transaction, Account, GlobalConfig, Category
from app.migrations import run_migrations, TARGET_SCHEMA_VERSION

logger = logging.getLogger(__name__)


def init_db(target_engine=None):
    """
    Initialise la base de données SQLite :
    1. Fast-path si la base est déjà au schéma cible (évite l'introspection lors des switches de profil).
    2. Création des tables SQLAlchemy via Base.metadata.create_all().
    3. Exécution séquentielle des migrations incrémentales (v02 à v25) via app.migrations.
    """
    from app.database import get_engine
    eng = target_engine or get_engine()

    # Fast-path : si la base est déjà initialisée et au schéma cible (v25),
    # éviter l'introspection complète de toutes les tables SQLAlchemy lors de chaque switch de profil
    try:
        with eng.connect() as conn:
            row = conn.execute(text("SELECT value FROM global_config WHERE key = 'schema_version'")).fetchone()
            if row and row[0] and str(row[0]).isdigit() and int(row[0]) >= TARGET_SCHEMA_VERSION:
                return
    except Exception:
        pass

    Base.metadata.create_all(bind=eng)

    # Exécution ordonnée des index de base et des migrations incrémentales
    run_migrations(eng)


def wipe_db(db: Session):
    """Delete all data to start fresh."""
    db.query(Transaction).delete()
    db.query(Account).delete()
    db.query(GlobalConfig).delete()
    db.commit()


def load_initial_balances(db: Session, data_dir: str = "."):
    """Load initial balances if the accounts table is empty."""
    import pandas as pd
    if db.query(Account).first():
        return  # Already initialized
        
    comptes_file = os.path.join(data_dir, "Comptes soldes initials.csv")
    livrets_file = os.path.join(data_dir, "Livrets soldes initials.csv")
    
    accounts_to_add = []
    
    if os.path.exists(comptes_file):
        df_comptes = pd.read_csv(comptes_file, sep=";", encoding="latin-1")
        for _, row in df_comptes.iterrows():
            name = row.iloc[0]
            balance_str = str(row.iloc[1]).replace(",", ".")
            balance = float(balance_str)
            accounts_to_add.append(Account(name=name, type="Compte courant", initial_balance=balance))
            
    if os.path.exists(livrets_file):
        df_livrets = pd.read_csv(livrets_file, sep=";", encoding="latin-1")
        for _, row in df_livrets.iterrows():
            name = row.iloc[0]
            balance_str = str(row.iloc[1]).replace(",", ".")
            balance = float(balance_str)
            accounts_to_add.append(Account(name=name, type="Livret", initial_balance=balance))
            
    if accounts_to_add:
        db.add_all(accounts_to_add)
        db.commit()


if __name__ == "__main__":
    init_db()
    db = SessionLocal()
    load_initial_balances(db)
    db.close()
    print("Database initialized.")
