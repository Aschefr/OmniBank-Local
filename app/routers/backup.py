from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session
import os
import zipfile
import tempfile
import shutil
from datetime import datetime
from typing import Optional
from urllib.parse import quote
import json

from app.database import get_db, get_engine, DATA_DIR, get_current_db_path, get_current_uploads_dir, dispose_engine
from app.profile_manager import get_active_profile, load_profiles_data, ensure_profiles_initialized
from app.services.backup_archive import build_global_archive, restore_global_archive, RestoreError

router = APIRouter(prefix="/api/backup", tags=["backup"])


@router.get("/download")
async def download_backup(db: Session = Depends(get_db)):
    """Sauvegarde scopée au profil actif (DB + uploads du profil)."""
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp_file.name
    tmp_file.close()

    db_path = get_current_db_path()
    attachments_dir = get_current_uploads_dir()
    engine = get_engine()

    try:
        try:
            with engine.connect() as conn:
                conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:
            pass

        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            if os.path.exists(db_path):
                zipf.write(db_path, arcname="omnibank.db")

            if os.path.exists(attachments_dir):
                for root, dirs, files in os.walk(attachments_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.join("uploads", os.path.relpath(file_path, start=attachments_dir))
                        zipf.write(file_path, arcname=arcname)

        active = get_active_profile()
        clean_name = "".join(c for c in active["name"] if c.isalnum() or c in (' ', '_', '-')).strip().replace(' ', '_')
        filename = f"omnibank_{clean_name}_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"

        return FileResponse(
            path=tmp_path,
            filename=filename,
            media_type='application/zip',
            background=BackgroundTask(os.remove, tmp_path)
        )
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise HTTPException(status_code=500, detail=f"Backup failed: {str(e)}")


@router.post("/upload")
async def upload_backup(file: UploadFile = File(...)):
    """Restaure une sauvegarde dans le profil actif courant."""
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Le fichier doit être une archive ZIP.")

    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp_file.name
    tmp_file.close()

    try:
        with open(tmp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        if not zipfile.is_zipfile(tmp_path):
            raise HTTPException(status_code=400, detail="Archive ZIP invalide.")

        active = get_active_profile()
        dispose_engine(active["id"])

        db_path = get_current_db_path()
        target_dir = os.path.dirname(db_path)
        os.makedirs(target_dir, exist_ok=True)

        with zipfile.ZipFile(tmp_path, 'r') as zip_ref:
            if "omnibank.db" not in zip_ref.namelist():
                raise HTTPException(status_code=400, detail="Le backup ne contient pas omnibank.db.")

            # Rejeter les archives globales (tous profils) pour éviter une restauration croisée
            if "profiles.json" in zip_ref.namelist():
                raise HTTPException(
                    status_code=400,
                    detail="Cette archive est une sauvegarde globale (tous profils). "
                           "Utilisez le bouton 'Restaurer tous les profils' à la place."
                )

            # Supprimer les fichiers WAL et SHM existants avant extraction
            for ext in ("-wal", "-shm"):
                f_path = f"{db_path}{ext}"
                if os.path.exists(f_path):
                    try:
                        os.remove(f_path)
                    except Exception:
                        pass

            # Validation anti-path-traversal (Zip Slip protection)
            abs_target_dir = os.path.realpath(target_dir)
            for member in zip_ref.namelist():
                member_path = os.path.realpath(os.path.join(target_dir, member))
                if not member_path.startswith(abs_target_dir + os.sep) and member_path != abs_target_dir:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Archive ZIP suspecte : chemin interdit détecté ({member})"
                    )

            # Extraire omnibank.db et uploads dans le dossier du profil
            for member in zip_ref.namelist():
                if member == "omnibank.db" or member.startswith("uploads/"):
                    zip_ref.extract(member, target_dir)

        from app.init_data import init_db
        from app.profile_manager import sync_profile_metadata_from_db
        from app.services import stats_cache
        from app.services.bank_sync.pending_store import _PENDING_SYNC_DATA
        init_db()
        sync_profile_metadata_from_db()
        stats_cache.invalidate()
        _PENDING_SYNC_DATA.pop(active["id"], None)

        return {"ok": True, "message": f"Backup restauré avec succès dans le profil '{active['name']}'."}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de restauration: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


@router.get("/download-all")
async def download_all_profiles_backup():
    """Sauvegarde globale complète : tous les profils, ceux protégés par PIN étant chiffrés."""
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp_file.name
    tmp_file.close()

    try:
        result = build_global_archive(tmp_path)
        filename = f"omnibank_GLOBAL_ALL_PROFILES_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        headers = {}
        if result["skipped"]:
            # Profils protégés sans clé (PIN antérieur à cette version, jamais déverrouillé depuis)
            headers["X-OmniBank-Skipped-Profiles"] = quote(", ".join(result["skipped"]))

        return FileResponse(
            path=tmp_path,
            filename=filename,
            media_type='application/zip',
            headers=headers,
            background=BackgroundTask(os.remove, tmp_path)
        )
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise HTTPException(status_code=500, detail=f"Échec de la sauvegarde globale: {str(e)}")


@router.post("/upload-all")
async def upload_all_profiles_backup(file: UploadFile = File(...), secrets: Optional[str] = Form(None)):
    """Restaure une sauvegarde globale.

    Sans `secrets`, répond 409 avec la liste des profils qui exigent un PIN / code de récupération
    (profils chiffrés dans l'archive ou protégés sur ce serveur). `secrets` (JSON) :
    {profile_id: {"secret": "...", "new_pin": "..."}} ; un profil absent est ignoré."""
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Le fichier doit être une archive ZIP.")

    provided = None
    if secrets is not None:
        try:
            provided = json.loads(secrets) if secrets.strip() else {}
        except ValueError:
            raise HTTPException(status_code=400, detail="Paramètre 'secrets' invalide.")

    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp_file.name
    tmp_file.close()

    try:
        with open(tmp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        if not zipfile.is_zipfile(tmp_path):
            raise HTTPException(status_code=400, detail="Archive ZIP invalide.")

        result = restore_global_archive(tmp_path, provided)

        from app.init_data import init_db
        from app.services import stats_cache
        from app.services.bank_sync.pending_store import _PENDING_SYNC_DATA
        init_db()
        stats_cache.invalidate()
        _PENDING_SYNC_DATA.clear()

        message = "Restauration globale effectuée avec succès. Rechargement nécessaire."
        if result["skipped"]:
            message += f" Profils non restaurés (données locales conservées) : {', '.join(result['skipped'])}."
        return {"ok": True, "message": message, "reload_required": True, **result}
    except RestoreError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail, headers=e.headers)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de restauration globale: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
