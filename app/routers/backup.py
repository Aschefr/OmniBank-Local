from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session
import os
import zipfile
import tempfile
import shutil
from datetime import datetime

from app.database import get_db, get_engine, DATA_DIR, get_current_db_path, get_current_uploads_dir, dispose_engine
from app.profile_manager import get_active_profile, load_profiles_data, ensure_profiles_initialized

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

            # Supprimer les fichiers WAL et SHM existants avant extraction
            for ext in ("-wal", "-shm"):
                f_path = f"{db_path}{ext}"
                if os.path.exists(f_path):
                    try:
                        os.remove(f_path)
                    except Exception:
                        pass

            # Extraire omnibank.db et uploads dans le dossier du profil
            for member in zip_ref.namelist():
                if member == "omnibank.db" or member.startswith("uploads/"):
                    zip_ref.extract(member, target_dir)

        from app.init_data import init_db
        from app.profile_manager import sync_profile_metadata_from_db
        init_db()
        sync_profile_metadata_from_db()

        return {"ok": True, "message": f"Backup restauré avec succès dans le profil '{active['name']}'."}
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
    """Sauvegarde globale complète : englobe profiles.json et tous les jeux de données."""
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp_file.name
    tmp_file.close()

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

        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
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
                for root, dirs, files in os.walk(def_uploads):
                    for f in files:
                        fp = os.path.join(root, f)
                        arc = os.path.join("uploads", os.path.relpath(fp, start=def_uploads))
                        zipf.write(fp, arcname=arc)

            # 3. Répertoire profiles/ avec tous les profils supplémentaires
            prof_dir = os.path.join(DATA_DIR, "profiles")
            if os.path.isdir(prof_dir):
                for root, dirs, files in os.walk(prof_dir):
                    for f in files:
                        if f.endswith(("-wal", "-shm")):
                            continue
                        fp = os.path.join(root, f)
                        arc = os.path.join("profiles", os.path.relpath(fp, start=prof_dir))
                        zipf.write(fp, arcname=arc)

        filename = f"omnibank_GLOBAL_ALL_PROFILES_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"

        return FileResponse(
            path=tmp_path,
            filename=filename,
            media_type='application/zip',
            background=BackgroundTask(os.remove, tmp_path)
        )
    except Exception as e:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise HTTPException(status_code=500, detail=f"Échec de la sauvegarde globale: {str(e)}")


@router.post("/upload-all")
async def upload_all_profiles_backup(file: UploadFile = File(...)):
    """Restaure une sauvegarde globale complète englobant tous les profils."""
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

        # Fermer toutes les connexions DB ouvertes
        data = load_profiles_data()
        for p in data.get("profiles", []):
            dispose_engine(p["id"])

        with zipfile.ZipFile(tmp_path, 'r') as zip_ref:
            zip_ref.extractall(DATA_DIR)

        ensure_profiles_initialized()
        from app.init_data import init_db
        init_db()

        return {"ok": True, "message": "Restauration globale effectuée avec succès. Rechargement nécessaire.", "reload_required": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de restauration globale: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
