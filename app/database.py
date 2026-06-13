import os
import sys
import logging
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger(__name__)


def get_data_dir():
    """Resolve the user data directory.
    - In production (PyInstaller):
        1. Check %PROGRAMDATA%/OmniBank/.shared_path → custom shared path
        2. Check %PROGRAMDATA%/OmniBank/.shared → %PROGRAMDATA%/OmniBank/
        3. Default: %APPDATA%/OmniBank/
    - In development: ./data/
    """
    if getattr(sys, 'frozen', False):
        programdata_dir = os.path.join(os.environ.get('PROGRAMDATA', ''), 'OmniBank')
        custom_path_file = os.path.join(programdata_dir, '.shared_path')
        shared_marker = os.path.join(programdata_dir, '.shared')

        try:
            if os.path.isfile(custom_path_file):
                # Custom shared folder chosen by user
                with open(custom_path_file, 'r', encoding='utf-8') as f:
                    custom = f.read().strip()
                if custom and os.path.isdir(custom):
                    base = custom
                    logger.info(f"[SharedMode] Using CUSTOM shared dir: {base}")
                else:
                    base = os.path.join(os.environ.get('APPDATA', '.'), 'OmniBank')
                    logger.warning(f"[SharedMode] Custom path invalid ({custom}), falling back to APPDATA")
            elif os.path.isfile(shared_marker):
                # Default shared mode → ProgramData
                base = programdata_dir
                logger.info(f"[SharedMode] Using PROGRAMDATA shared dir: {base}")
            else:
                # Standard per-user mode
                base = os.path.join(os.environ.get('APPDATA', '.'), 'OmniBank')
                logger.info(f"[SharedMode] Using local APPDATA dir: {base}")
        except PermissionError as e:
            # Cannot read ProgramData markers → fall back to local
            base = os.path.join(os.environ.get('APPDATA', '.'), 'OmniBank')
            logger.error(f"[SharedMode] Permission denied reading markers: {e}. Falling back to APPDATA.")
        except Exception as e:
            base = os.path.join(os.environ.get('APPDATA', '.'), 'OmniBank')
            logger.error(f"[SharedMode] Error detecting shared mode: {e}. Falling back to APPDATA.")
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

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    # PERF: Increase SQLite page cache to ~20 MB (default is ~2 MB).
    # Critical in Docker where each disk I/O is expensive due to volume mount overhead.
    cursor.execute("PRAGMA cache_size=-20000")
    # PERF: Enable memory-mapped I/O (256 MB). Allows SQLite to read the DB file
    # via mmap instead of read() syscalls, bypassing Docker overlay filesystem overhead.
    cursor.execute("PRAGMA mmap_size=268435456")
    # PERF: Keep temporary tables/indices in memory instead of writing to disk.
    cursor.execute("PRAGMA temp_store=MEMORY")
    cursor.close()

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
