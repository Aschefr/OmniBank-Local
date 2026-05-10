import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base


def get_data_dir():
    """Resolve the user data directory.
    - In production (PyInstaller): %APPDATA%/OmniBank/
    - In development: ./data/
    """
    if getattr(sys, 'frozen', False):
        # Running as PyInstaller bundle — store data in APPDATA
        base = os.path.join(os.environ.get('APPDATA', '.'), 'OmniBank')
    else:
        base = os.path.join(os.path.abspath('.'), 'data')
    os.makedirs(base, exist_ok=True)
    return base


DATA_DIR = get_data_dir()
DB_PATH = os.path.join(DATA_DIR, 'omnibank.db')
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{DB_PATH}")

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# ⚠️ ATTENTION — MIGRATION DE SCHÉMA :
# Base.metadata.create_all() crée les tables manquantes mais NE MODIFIE PAS
# les tables existantes. Si vous ajoutez une colonne à un modèle existant,
# les utilisateurs en mise à jour ne la recevront pas automatiquement.
# → Voir BUILD_GUIDE.md section #20 pour la procédure de migration.


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
