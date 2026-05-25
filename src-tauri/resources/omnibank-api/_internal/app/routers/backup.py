from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.background import BackgroundTasks
from starlette.background import BackgroundTask
from sqlalchemy.orm import Session
import os
import zipfile
import tempfile
import shutil
from datetime import datetime

from app.database import get_db, engine, DATA_DIR, DB_PATH

router = APIRouter(prefix="/api/backup", tags=["backup"])

@router.get("/download")
async def download_backup(db: Session = Depends(get_db)):
    # Create a temporary file to hold the zip archive
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp_file.name
    tmp_file.close()
    
    db_path = DB_PATH
    attachments_dir = os.path.join(DATA_DIR, "uploads")
    
    try:
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            if os.path.exists(db_path):
                zipf.write(db_path, arcname="omnibank.db")
                
            if os.path.exists(attachments_dir):
                for root, dirs, files in os.walk(attachments_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.join("uploads", os.path.relpath(file_path, start=attachments_dir))
                        zipf.write(file_path, arcname=arcname)
                        
        filename = f"omnibank_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        
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
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Le fichier doit être une archive ZIP.")
    
    tmp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    tmp_path = tmp_file.name
    tmp_file.close()
    
    try:
        # Save uploaded file
        with open(tmp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Verify it's a valid zip
        if not zipfile.is_zipfile(tmp_path):
            raise HTTPException(status_code=400, detail="Archive ZIP invalide.")
            
        # Close all active database connections to release locks
        engine.dispose()
        
        # Extract everything into data folder
        with zipfile.ZipFile(tmp_path, 'r') as zip_ref:
            if "omnibank.db" not in zip_ref.namelist():
                raise HTTPException(status_code=400, detail="Le backup ne contient pas omnibank.db.")
            zip_ref.extractall(DATA_DIR)
            
        return {"ok": True, "message": "Backup restauré avec succès."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de restauration: {str(e)}")
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except:
                pass
