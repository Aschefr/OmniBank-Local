"""
Improvement_05 — Backups automatiques silencieux.

Scheduler asyncio natif qui génère périodiquement une archive ZIP
(DB SQLite + dossier uploads/) dans {DATA_DIR}/backups/.
Compatible Docker, Tauri et dev local.
"""

import asyncio
import glob
import json
import logging
import os
import re
import zipfile
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from app.database import DATA_DIR, SessionLocal, get_engine, get_current_db_path, get_current_uploads_dir
from app.models import GlobalConfig
from app.profile_manager import load_profiles_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backup/auto", tags=["auto_backup"])

# ── Paths ────────────────────────────────────────────────────────────
BACKUPS_DIR = os.path.join(DATA_DIR, "backups")
STATUS_FILE = os.path.join(BACKUPS_DIR, "backup_status.json")

os.makedirs(BACKUPS_DIR, exist_ok=True)


# ── Helpers ──────────────────────────────────────────────────────────

def _get_config_value(key: str, default: str) -> str:
    """Lecture d'une clé GlobalConfig (session éphémère)."""
    db = SessionLocal()
    try:
        row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        return row.value if row else default
    finally:
        db.close()


def _frequency_to_seconds(freq: str) -> int:
    """Convertit une fréquence textuelle en secondes."""
    mapping = {
        "daily": 86400,      # 24 h
        "weekly": 604800,    # 7 j
        "monthly": 2592000,  # 30 j
    }
    return mapping.get(freq, 86400)


def _list_backup_files() -> list[dict]:
    """Liste les fichiers auto_backup_*.zip triés du plus récent au plus ancien."""
    # Inclut les anciens (auto_backup_YYYYMMDD_*) et nouveaux (auto_backup_all_profiles_*) fichiers
    files = glob.glob(os.path.join(BACKUPS_DIR, "auto_backup_*.zip"))
    result = []
    for f in sorted(files, reverse=True):
        try:
            stat = os.stat(f)
            result.append({
                "filename": os.path.basename(f),
                "size_bytes": stat.st_size,
                "created": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        except OSError:
            pass
    return result


def _write_status(filename: str, size_bytes: int, success: bool, error: str | None = None):
    """Écrit backup_status.json après chaque exécution."""
    status = {
        "last_date": datetime.now().isoformat(),
        "last_file": filename,
        "last_size_bytes": size_bytes,
        "success": success,
        "error": error,
    }
    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(status, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.error(f"[AutoBackup] Impossible d'écrire le statut : {e}")


def _read_status() -> dict | None:
    """Lit backup_status.json."""
    if not os.path.isfile(STATUS_FILE):
        return None
    try:
        with open(STATUS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _rotate_backups(max_count: int):
    """Supprime les backups les plus anciens au-delà de max_count."""
    files = sorted(glob.glob(os.path.join(BACKUPS_DIR, "auto_backup_*.zip")))  # plus ancien en premier
    while len(files) > max_count:
        oldest = files.pop(0)
        try:
            os.remove(oldest)
            logger.info(f"[AutoBackup] Rotation : supprimé {os.path.basename(oldest)}")
        except OSError as e:
            logger.warning(f"[AutoBackup] Impossible de supprimer {oldest} : {e}")


def run_backup_now() -> dict:
    """
    Exécute un backup immédiat (synchrone).
    Sauvegarde TOUS les profils (profiles.json + profil par défaut + profiles/).
    Retourne un dict avec le résultat.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"auto_backup_all_profiles_{timestamp}.zip"
    filepath = os.path.join(BACKUPS_DIR, filename)

    try:
        # Checkpoint WAL sur tous les profils actifs
        data = load_profiles_data()
        for p in data.get("profiles", []):
            try:
                eng = get_engine(p["id"])
                with eng.connect() as conn:
                    conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
            except Exception:
                pass

        with zipfile.ZipFile(filepath, "w", zipfile.ZIP_DEFLATED) as zipf:
            # 1. Fichier profiles.json
            profiles_json_path = os.path.join(DATA_DIR, "profiles.json")
            if os.path.exists(profiles_json_path):
                zipf.write(profiles_json_path, arcname="profiles.json")

            # 2. Profil par défaut (omnibank.db & uploads/)
            def_db = os.path.join(DATA_DIR, "omnibank.db")
            if os.path.exists(def_db):
                zipf.write(def_db, arcname="omnibank.db")

            def_uploads = os.path.join(DATA_DIR, "uploads")
            if os.path.isdir(def_uploads):
                for root, _dirs, files in os.walk(def_uploads):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.join(
                            "uploads",
                            os.path.relpath(file_path, start=def_uploads),
                        )
                        zipf.write(file_path, arcname=arcname)

            # 3. Répertoire profiles/ avec tous les profils supplémentaires
            prof_dir = os.path.join(DATA_DIR, "profiles")
            if os.path.isdir(prof_dir):
                for root, _dirs, files in os.walk(prof_dir):
                    for file in files:
                        if file.endswith(("-wal", "-shm")):
                            continue
                        file_path = os.path.join(root, file)
                        arcname = os.path.join(
                            "profiles",
                            os.path.relpath(file_path, start=prof_dir),
                        )
                        zipf.write(file_path, arcname=arcname)

        size = os.path.getsize(filepath)
        logger.info(f"[AutoBackup] Backup créé : {filename} ({size} octets)")

        # Rotation
        max_count = int(_get_config_value("auto_backup_max_count", "5"))
        _rotate_backups(max_count)

        _write_status(filename, size, success=True)
        return {"ok": True, "filename": filename, "size_bytes": size}

    except Exception as e:
        logger.error(f"[AutoBackup] Échec du backup : {e}")
        _write_status(filename, 0, success=False, error=str(e))
        # Nettoyage du fichier partiel
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except OSError:
                pass
        return {"ok": False, "error": str(e)}


# ── Scheduler (boucle asyncio) ───────────────────────────────────────

async def _scheduler_loop():
    """
    Boucle principale du scheduler.
    Vérifie toutes les 60 secondes si un backup est dû,
    en comparant la date du dernier backup au délai de la fréquence.
    """
    # Petit délai au démarrage pour laisser l'app s'initialiser
    await asyncio.sleep(10)
    logger.info("[AutoBackup] Scheduler démarré")

    while True:
        try:
            enabled = _get_config_value("auto_backup_enabled", "true")
            if enabled != "true":
                await asyncio.sleep(60)
                continue

            frequency = _get_config_value("auto_backup_frequency", "daily")
            interval = _frequency_to_seconds(frequency)

            # Vérifier la date du dernier backup
            status = _read_status()
            should_run = False

            if status is None:
                # Aucun backup encore → on en fait un
                should_run = True
            else:
                try:
                    last_date = datetime.fromisoformat(status["last_date"])
                    if datetime.now() - last_date >= timedelta(seconds=interval):
                        should_run = True
                except (KeyError, ValueError):
                    should_run = True

            if should_run:
                logger.info(f"[AutoBackup] Backup planifié en cours (fréquence : {frequency})")
                # Exécuter dans un thread pour ne pas bloquer l'event loop
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, run_backup_now)

        except Exception as e:
            logger.error(f"[AutoBackup] Erreur dans la boucle scheduler : {e}")

        await asyncio.sleep(60)


def start_scheduler():
    """Lance la boucle scheduler en tâche de fond asyncio."""
    asyncio.create_task(_scheduler_loop())


# ── Endpoints API ────────────────────────────────────────────────────

@router.get("/status")
def get_auto_backup_status():
    """Retourne le statut du dernier backup + liste des fichiers disponibles."""
    status = _read_status()
    files = _list_backup_files()

    # Si HOST_DATA_DIR est défini (Docker), on retourne le chemin réel côté hôte
    host_data_dir = os.environ.get("HOST_DATA_DIR")
    if host_data_dir:
        raw_path = host_data_dir.rstrip("/\\") + "/backups"
        # os.path.normpath ne fonctionne pas pour les chemins Windows dans un conteneur Linux
        # On détecte un chemin Windows (ex: D:\...) et on normalise les slashs
        if len(host_data_dir) >= 2 and host_data_dir[1] == ':':
            display_dir = raw_path.replace('/', '\\')
        else:
            display_dir = raw_path
    else:
        display_dir = os.path.abspath(BACKUPS_DIR)

    return {
        "status": status,
        "backups_dir": display_dir,
        "files": files,
    }


@router.get("/download/{filename}")
def download_auto_backup(filename: str):
    """Télécharge un backup auto spécifique."""
    # Validation stricte du nom de fichier (sécurité)
    if not re.match(r"^auto_backup_(all_profiles_)?\d{8}_\d{6}\.zip$", filename):
        raise HTTPException(status_code=400, detail="Nom de fichier invalide.")

    filepath = os.path.join(BACKUPS_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    return FileResponse(
        path=filepath,
        filename=filename,
        media_type="application/zip",
    )


@router.post("/trigger")
async def trigger_auto_backup():
    """Déclenche un backup immédiat."""
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, run_backup_now)
    if result.get("ok"):
        return {"ok": True, "filename": result["filename"], "size_bytes": result["size_bytes"]}
    raise HTTPException(status_code=500, detail=result.get("error", "Backup failed"))
