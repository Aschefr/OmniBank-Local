"""Improvement 03 – Shared mode management for multi-session Windows."""
import os
import sys
import shutil
import subprocess

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/config", tags=["config"])


def _programdata_dir() -> str:
    return os.path.join(os.environ.get('PROGRAMDATA', ''), 'OmniBank')


def _appdata_dir() -> str:
    return os.path.join(os.environ.get('APPDATA', '.'), 'OmniBank')


def _current_data_dir() -> str:
    """Return the data dir the running server is actually using."""
    from app.database import DATA_DIR
    return DATA_DIR


def _get_shared_status() -> dict:
    """Detect current shared mode status from markers."""
    pd = _programdata_dir()
    custom_path_file = os.path.join(pd, '.shared_path')
    shared_marker = os.path.join(pd, '.shared')

    if os.path.isfile(custom_path_file):
        try:
            with open(custom_path_file, 'r', encoding='utf-8') as f:
                custom = f.read().strip()
            return {"active": True, "mode": "custom", "path": custom}
        except Exception:
            pass
    if os.path.isfile(shared_marker):
        return {"active": True, "mode": "programdata", "path": pd}

    return {"active": False, "mode": "local", "path": _appdata_dir()}


class SharedModeRequest(BaseModel):
    mode: str  # 'programdata' or 'custom'
    custom_path: Optional[str] = None


@router.get("/shared-mode")
def get_shared_mode():
    """Return current shared mode status."""
    status = _get_shared_status()
    status["current_data_dir"] = _current_data_dir()
    status["is_production"] = getattr(sys, 'frozen', False)
    return status


@router.post("/shared-mode")
def enable_shared_mode(req: SharedModeRequest):
    """Enable shared mode: copy DB to target and create markers."""
    source_dir = _current_data_dir()
    source_db = os.path.join(source_dir, 'omnibank.db')
    pd = _programdata_dir()

    if req.mode == 'custom':
        if not req.custom_path:
            raise HTTPException(status_code=400, detail="custom_path requis pour le mode personnalisé")
        target_dir = req.custom_path.strip()
    else:
        target_dir = pd

    # Create target directory
    os.makedirs(target_dir, exist_ok=True)
    # Also ensure ProgramData/OmniBank exists for marker files
    os.makedirs(pd, exist_ok=True)

    # Copy DB if it exists and target is different
    target_db = os.path.join(target_dir, 'omnibank.db')
    if os.path.isfile(source_db) and os.path.normpath(source_dir) != os.path.normpath(target_dir):
        shutil.copy2(source_db, target_db)

    # Copy uploads folder if it exists
    source_uploads = os.path.join(source_dir, 'uploads')
    target_uploads = os.path.join(target_dir, 'uploads')
    if os.path.isdir(source_uploads) and os.path.normpath(source_dir) != os.path.normpath(target_dir):
        if os.path.exists(target_uploads):
            shutil.rmtree(target_uploads)
        shutil.copytree(source_uploads, target_uploads)

    # Clean up old markers
    custom_path_file = os.path.join(pd, '.shared_path')
    shared_marker = os.path.join(pd, '.shared')
    for f in [custom_path_file, shared_marker]:
        if os.path.isfile(f):
            os.remove(f)

    # Create appropriate marker
    if req.mode == 'custom':
        with open(custom_path_file, 'w', encoding='utf-8') as f:
            f.write(target_dir)
    else:
        with open(shared_marker, 'w', encoding='utf-8') as f:
            f.write('shared')

    # Try to set permissions (icacls) — best effort
    _try_set_permissions(target_dir)

    return {
        "ok": True,
        "mode": req.mode,
        "path": target_dir,
        "restart_required": True
    }


@router.delete("/shared-mode")
def disable_shared_mode():
    """Disable shared mode: remove markers. Data stays in shared folder."""
    pd = _programdata_dir()
    for name in ['.shared', '.shared_path']:
        f = os.path.join(pd, name)
        if os.path.isfile(f):
            os.remove(f)

    return {
        "ok": True,
        "mode": "local",
        "path": _appdata_dir(),
        "restart_required": True
    }


def _try_set_permissions(target_dir: str):
    """Try to grant all users read/write access via icacls. Best effort.
    Uses SID *S-1-5-32-545 (Builtin\\Users) to avoid locale issues on French Windows.
    """
    try:
        if sys.platform == 'win32':
            # Well-known SID for BUILTIN\Users (works on all Windows languages)
            sid = '*S-1-5-32-545'
            # Grant on directory with inheritance (OI=Object Inherit, CI=Container Inherit)
            subprocess.run(
                ['icacls', target_dir, '/grant', f'{sid}:(OI)(CI)F', '/T'],
                capture_output=True, timeout=10,
                creationflags=0x08000000  # CREATE_NO_WINDOW
            )
            # Also explicitly grant on DB files (WAL, SHM may not inherit immediately)
            for fname in ['omnibank.db', 'omnibank.db-wal', 'omnibank.db-shm']:
                fpath = os.path.join(target_dir, fname)
                if os.path.isfile(fpath):
                    subprocess.run(
                        ['icacls', fpath, '/grant', f'{sid}:F'],
                        capture_output=True, timeout=5,
                        creationflags=0x08000000
                    )
    except Exception:
        pass  # Non-fatal — user may need to adjust manually

