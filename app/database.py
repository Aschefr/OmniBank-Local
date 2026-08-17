import os
import sys
import logging
from typing import Dict
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def get_data_dir() -> str:
    """Resolve the user data directory.
    - Explicit override via OMNIBANK_DATA_DIR (e.g. for isolated test suites)
    - In production (PyInstaller):
        1. Check %PROGRAMDATA%/OmniBank/.shared_path → custom shared path
        2. Check %PROGRAMDATA%/OmniBank/.shared → %PROGRAMDATA%/OmniBank/
        3. Default: %APPDATA%/OmniBank/
    - In development: ./data/
    """
    if os.environ.get('OMNIBANK_DATA_DIR'):
        base = os.path.abspath(os.environ['OMNIBANK_DATA_DIR'])
        os.makedirs(base, exist_ok=True)
        return base

    if getattr(sys, 'frozen', False):
        programdata_dir = os.path.join(os.environ.get('PROGRAMDATA', ''), 'OmniBank')
        custom_path_file = os.path.join(programdata_dir, '.shared_path')
        shared_marker = os.path.join(programdata_dir, '.shared')

        try:
            if os.path.isfile(custom_path_file):
                with open(custom_path_file, 'r', encoding='utf-8') as f:
                    custom = f.read().strip()
                if custom and os.path.isdir(custom):
                    base = custom
                    logger.info(f"[SharedMode] Using CUSTOM shared dir: {base}")
                else:
                    base = os.path.join(os.environ.get('APPDATA', '.'), 'OmniBank')
                    logger.warning(f"[SharedMode] Custom path invalid ({custom}), falling back to APPDATA")
            elif os.path.isfile(shared_marker):
                base = programdata_dir
                logger.info(f"[SharedMode] Using PROGRAMDATA shared dir: {base}")
            else:
                base = os.path.join(os.environ.get('APPDATA', '.'), 'OmniBank')
                logger.info(f"[SharedMode] Using local APPDATA dir: {base}")
        except PermissionError as e:
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
Base = declarative_base()

_engines: Dict[str, Engine] = {}
_session_factories: Dict[str, sessionmaker] = {}


IS_DOCKER = os.path.exists('/.dockerenv') or os.environ.get('IS_DOCKER') == 'true'


def _configure_sqlite_pragmas(target_engine: Engine):
    """Applique la configuration PRAGMA SQLite optimale sur l'engine."""
    @event.listens_for(target_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        old_isolation = getattr(dbapi_connection, "isolation_level", None)
        try:
            dbapi_connection.isolation_level = None  # Autocommit mode to prevent PRAGMAs from opening an uncommitted transaction
        except Exception:
            pass

        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA busy_timeout=30000")
        except Exception:
            pass

        if IS_DOCKER:
            # Sur les volumes Docker montés sur hôte Windows, journal_mode MEMORY évite les 'disk I/O error' lors de la création des tables et index
            try:
                cursor.execute("PRAGMA journal_mode=MEMORY")
            except Exception:
                pass
        else:
            try:
                cursor.execute("PRAGMA journal_mode=WAL")
            except Exception as e:
                logger.warning(f"[DB] PRAGMA journal_mode=WAL failed, falling back: {e}")
                try:
                    cursor.execute("PRAGMA journal_mode=MEMORY")
                except Exception:
                    pass

        try:
            cursor.execute("PRAGMA synchronous=NORMAL")
        except Exception:
            pass

        try:
            cursor.execute("PRAGMA cache_size=-20000")
        except Exception:
            pass

        if not IS_DOCKER:
            try:
                cursor.execute("PRAGMA mmap_size=268435456")
            except Exception:
                pass

        try:
            cursor.execute("PRAGMA temp_store=MEMORY")
        except Exception:
            pass

        cursor.close()
        try:
            dbapi_connection.isolation_level = old_isolation
        except Exception:
            pass


def get_engine(profile_id: str = None) -> Engine:
    """Retourne l'engine SQLAlchemy pour un profil (ou le profil actif si None)."""
    if profile_id is None:
        from app.profile_manager import get_active_profile
        profile_id = get_active_profile()["id"]

    if profile_id not in _engines:
        from app.profile_manager import get_profile_db_path
        db_path = get_profile_db_path(profile_id)
        os.makedirs(os.path.dirname(db_path), exist_ok=True)

        url = f"sqlite:///{db_path}"
        eng = create_engine(
            url, connect_args={"check_same_thread": False, "timeout": 30}
        )
        _configure_sqlite_pragmas(eng)
        _engines[profile_id] = eng
        _session_factories[profile_id] = sessionmaker(autocommit=False, autoflush=False, bind=eng)

    return _engines[profile_id]


def dispose_engine(profile_id: str):
    """Ferme et vide les connexions d'un engine de profil."""
    if profile_id in _engines:
        try:
            _engines[profile_id].dispose()
        except Exception as e:
            logger.warning(f"[DB] Erreur lors de la fermeture de l'engine {profile_id}: {e}")
        _engines.pop(profile_id, None)
        _session_factories.pop(profile_id, None)


def SessionLocal() -> Session:
    """Crée une nouvelle Session SQLAlchemy liée au profil actif."""
    from app.profile_manager import get_active_profile
    pid = get_active_profile()["id"]
    get_engine(pid)  # s'assure que le factory existe
    factory = _session_factories[pid]
    return factory()


def get_db():
    """Dépendance FastAPI pour obtenir une session DB du profil actif."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_current_db_path() -> str:
    """Chemin absolu vers le fichier .db du profil actif."""
    from app.profile_manager import get_profile_db_path
    return get_profile_db_path()


def get_current_uploads_dir() -> str:
    """Chemin absolu vers le dossier d'uploads du profil actif."""
    from app.profile_manager import get_profile_uploads_dir
    return get_profile_uploads_dir()


def __getattr__(name: str):
    """Accès dynamique aux propriétés globales 'engine' et 'DB_PATH' pour rétrocompatibilité."""
    if name == "engine":
        return get_engine()
    elif name == "DB_PATH":
        return get_current_db_path()
    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")
