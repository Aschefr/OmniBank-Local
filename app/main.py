import sys
import os
import re as _re
import uuid as _uuid
import multiprocessing
from fastapi import FastAPI, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.database import engine, Base, DATA_DIR
from app.init_data import init_db
import app.models # Important: load models before create_all

import logging
logger = logging.getLogger(__name__)


def resource_path(relative_path):
    """Get absolute path to bundled resource (PyInstaller-aware)."""
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath('.'), relative_path)


# Create tables if they don't exist + run idempotent migrations
logger.info(f"[Startup] DATA_DIR = {DATA_DIR}")

from contextlib import asynccontextmanager
from starlette.middleware.gzip import GZipMiddleware
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Cycle de vie de l'application : initialisation au démarrage et nettoyage à l'arrêt."""
    # ── Startup ──
    from app.profile_manager import ensure_profiles_initialized
    ensure_profiles_initialized()
    init_db()
    from app.routers.auto_backup import start_scheduler
    start_scheduler()
    from app.services.bank_sync_scheduler import start_bank_sync_scheduler
    start_bank_sync_scheduler()
    
    # Start UDP local discovery beacon
    try:
        from app.services.discovery_service import start_discovery_listener
        start_discovery_listener()
    except Exception as e:
        logger.warning(f"[Discovery] Could not start UDP discovery service: {e}")
    
    # Automatically generate recurrences on startup
    from app.database import SessionLocal
    db = SessionLocal()
    try:
        from app.routers.recurrences import generate_recurrences
        generate_recurrences(db=db)
    except Exception as e:
        logger.error(f"Failed to generate recurrences on startup: {e}")
    finally:
        db.close()

    # Purge old actions on startup
    db = SessionLocal()
    try:
        from datetime import datetime, timedelta, timezone
        from app.models import GlobalConfig, ActionHistory
        retention_days = 90
        cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "history_retention_days").first()
        if cfg and cfg.value.isdigit():
            retention_days = int(cfg.value)
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        db.query(ActionHistory).filter(ActionHistory.timestamp < cutoff).delete()
        db.commit()
    except Exception as e:
        logger.error(f"Failed to purge old action history on startup: {e}")
    finally:
        db.close()
        
    # Check/Generate periodic AI financial report on startup in background
    try:
        from app.routers.notifications import generate_ai_report_task, _active_report_thread
        import app.routers.notifications as notif_module
        import threading
        t = threading.Thread(target=generate_ai_report_task, args=(SessionLocal, False), daemon=True)
        notif_module._active_report_thread = t
        t.start()
    except Exception as e:
        logger.error(f"Failed to launch startup AI report task check: {e}")

    yield

    # ── Shutdown ──
    """Signal background AI report thread to stop and wait for it to finish gracefully."""
    import app.routers.notifications as notif_module
    notif_module._shutdown_event.set()
    t = notif_module._active_report_thread
    if t and t.is_alive():
        logger.info("[Shutdown] Waiting for AI report thread to finish (max 10s)...")
        t.join(timeout=10)
        if t.is_alive():
            logger.warning("[Shutdown] AI report thread did not finish in time — proceeding with shutdown.")
        else:
            logger.info("[Shutdown] AI report thread finished cleanly.")


app = FastAPI(title="OmniBank Local", lifespan=lifespan)
# Restrict CORS to known origins (SEC-05)
_CORS_ORIGINS = [
    "http://127.0.0.1:8434",
    "http://localhost:8434",
    "tauri://localhost",
    "https://tauri.localhost",
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)

class NoCacheStaticFiles(StaticFiles):
    def file_response(self, *args, **kwargs) -> FileResponse:
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        return response

# Mount static files from bundled resources
static_dir = resource_path("static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", NoCacheStaticFiles(directory=static_dir), name="static")

# Dynamic user uploads serving per active profile
from app.database import get_current_uploads_dir
from fastapi import HTTPException
from fastapi.responses import FileResponse

@app.get("/uploads/{file_path:path}")
async def serve_upload(file_path: str):
    uploads_dir = get_current_uploads_dir()
    full_path = os.path.join(uploads_dir, file_path)
    # Protection path traversal (SEC-02)
    if not os.path.realpath(full_path).startswith(os.path.realpath(uploads_dir)):
        raise HTTPException(status_code=400, detail="Chemin d'accès invalide.")
    if not os.path.isfile(full_path):
        # Fallback pour rétrocompatibilité : dossier global uploads/
        fallback_dir = os.path.join(DATA_DIR, "uploads")
        fallback_path = os.path.join(fallback_dir, file_path)
        if not os.path.realpath(fallback_path).startswith(os.path.realpath(fallback_dir)):
            raise HTTPException(status_code=400, detail="Chemin d'accès invalide.")
        if os.path.isfile(fallback_path):
            return FileResponse(fallback_path)
        raise HTTPException(status_code=404, detail="Fichier introuvable.")
    return FileResponse(full_path)

@app.get("/data/uploads/{file_path:path}")
async def serve_upload_compat(file_path: str):
    return await serve_upload(file_path)

from app.services.diagnostic_service import DiagnosticLogHandler, record_backend_exception

# Attach memory log handler to root logger
root_logger = logging.getLogger()
diag_handler = DiagnosticLogHandler()
diag_handler.setLevel(logging.INFO)
diag_formatter = logging.Formatter("[%(levelname)s] [%(name)s] %(message)s")
diag_handler.setFormatter(diag_formatter)
root_logger.addHandler(diag_handler)

from app.routers import (
    transactions,
    categories,
    recurrences,
    stats,
    accounts,
    config,
    chat,
    csv_manager,
    ai_helpers,
    budgets,
    backup,
    auto_backup,
    setup,
    maintenance,
    org_users,
    license,
    shared_mode,
    notifications,
    history,
    profiles,
    cross_profile,
    simulator,
    bank_sync,
    diagnostics,
    smart_labels
)

app.include_router(transactions.router)
app.include_router(categories.router)
app.include_router(recurrences.router)
app.include_router(stats.router)
app.include_router(accounts.router)
app.include_router(config.router)
app.include_router(chat.router)
app.include_router(backup.router)
app.include_router(auto_backup.router)
app.include_router(csv_manager.router)
app.include_router(ai_helpers.router)
app.include_router(budgets.router)
app.include_router(setup.router)
app.include_router(maintenance.router)
app.include_router(org_users.router)
app.include_router(license.router)
app.include_router(shared_mode.router)
app.include_router(notifications.router)
app.include_router(history.router)
app.include_router(profiles.router)
app.include_router(cross_profile.router)
app.include_router(simulator.router)
app.include_router(bank_sync.router)
app.include_router(diagnostics.router)
app.include_router(smart_labels.router)

from starlette.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi import Request

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, (StarletteHTTPException, RequestValidationError)):
        raise exc
    logger.error(f"Uncaught exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    record_backend_exception(exc, context=f"{request.method} {request.url.path}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Erreur interne du serveur: {str(exc)}"}
    )




# ── Cache-busting: compute a short hash from all local static assets ──────────
import hashlib, re
_asset_hash = None

def _compute_asset_hash():
    """Compute a short hash from the contents of all local JS/CSS files."""
    global _asset_hash
    if _asset_hash:
        return _asset_hash
    h = hashlib.md5()
    for root, dirs, files in os.walk(static_dir):
        for fn in sorted(files):
            if fn.endswith(('.js', '.css')):
                fpath = os.path.join(root, fn)
                try:
                    h.update(open(fpath, 'rb').read())
                except Exception:
                    pass
    # Also mix in the version from package.json for extra safety
    try:
        import json as _json
        pkg = os.path.join(os.path.abspath('.'), "package.json")
        if not os.path.exists(pkg):
            pkg = resource_path("package.json")
        with open(pkg, "r") as f:
            h.update(_json.load(f).get("version", "0").encode())
    except Exception:
        pass
    _asset_hash = h.hexdigest()[:10]
    logger.info(f"[Cache-Bust] Asset hash: {_asset_hash}")
    return _asset_hash

_spa_html_cache = None

def _get_spa_html():
    """Read index.html and inject cache-busting query strings into local asset URLs."""
    global _spa_html_cache
    if _spa_html_cache and getattr(sys, 'frozen', False):
        return _spa_html_cache
    
    index_path = os.path.join(resource_path("static"), "index.html")
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()
    
    asset_hash = _compute_asset_hash()
    
    # Replace existing ?v=xxx or add ?v=hash to all local /static/ asset references
    # Matches: src="/static/..." or href="/static/..." with optional existing ?v=...
    def _replace_asset_url(match):
        prefix = match.group(1)  # src=" or href="
        path = match.group(2)    # /static/path/to/file.ext
        suffix = match.group(4)  # closing quote
        return f'{prefix}{path}?v={asset_hash}{suffix}'
    
    html = re.sub(
        r'((?:src|href)=["\'])(/static/[^"\'?]+)(\?[^"\']*)?(["\'])',
        _replace_asset_url,
        html
    )
    
    _spa_html_cache = html
    return html


@app.get("/")
def serve_spa():
    from fastapi.responses import HTMLResponse
    headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0"
    }
    return HTMLResponse(content=_get_spa_html(), media_type="text/html", headers=headers)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}


@app.get("/api/version")
def get_version():
    """Return the app version from package.json."""
    import json
    try:
        pkg_path = resource_path("package.json")
        if not os.path.exists(pkg_path):
            # Fallback: try parent dir in dev mode
            pkg_path = os.path.join(os.path.abspath('.'), "package.json")
        with open(pkg_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {"version": data.get("version", "?")}
    except Exception:
        return {"version": "?"}


# In-memory changelog cache to avoid repeated file reads
_changelog_cache = None

def parse_changelog():
    global _changelog_cache
    if _changelog_cache is not None:
        return _changelog_cache

    import re
    changelog_path = resource_path("CHANGELOG.md")
    if not os.path.exists(changelog_path):
        changelog_path = os.path.join(os.path.abspath('.'), "CHANGELOG.md")
    if not os.path.exists(changelog_path):
        changelog_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "CHANGELOG.md")

    if not os.path.exists(changelog_path):
        logger.warning(f"[changelog] CHANGELOG.md not found at any known path.")
        return []

    releases = []
    current_release = None
    release_pattern = re.compile(r'^##\s+\[?([0-9a-zA-Z\.\-]+)\]?(?:\s*-\s*([0-9\-]+))?')

    try:
        with open(changelog_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        for line in lines:
            match = release_pattern.match(line.strip())
            if match:
                if current_release:
                    releases.append(current_release)
                current_release = {
                    "version": match.group(1),
                    "date": match.group(2) or "",
                    "content": []
                }
            elif current_release is not None:
                current_release["content"].append(line)

        if current_release:
            releases.append(current_release)

        # Clean up contents
        for r in releases:
            r["notes"] = "".join(r["content"]).strip()
            del r["content"]

        _changelog_cache = releases
        return releases
    except Exception as e:
        logger.error(f"[changelog] Error parsing CHANGELOG.md: {e}")
        return []

@app.get("/api/changelog")
def get_changelog(version: str = None):
    """Return parsed release notes from local CHANGELOG.md with full history."""
    releases = parse_changelog()
    if not releases:
        return {"version": version or "?", "notes": "", "pub_date": "", "name": "OmniBank", "history": []}

    # Find requested version or fall back to latest
    target_release = None
    if version:
        for r in releases:
            if r["version"] == version:
                target_release = r
                break

    if not target_release:
        target_release = releases[0]

    return {
        "version": target_release["version"],
        "notes": target_release["notes"],
        "pub_date": target_release["date"],
        "name": f"OmniBank v{target_release['version']}",
        "history": releases
    }


def _safe_filename(raw_name: str) -> str:
    """Sanitise un nom de fichier uploadé : supprime les composants de chemin et caractères dangereux."""
    base = os.path.basename(raw_name) if raw_name else ""
    safe = _re.sub(r'[^\w\-.]', '_', base)
    if not safe or safe.startswith('.'):
        safe = f"upload_{_uuid.uuid4().hex[:8]}"
    return safe


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    target_dir = get_current_uploads_dir()
    os.makedirs(target_dir, exist_ok=True)
    safe_name = _safe_filename(file.filename)
    file_location = os.path.join(target_dir, safe_name)
    # Double vérification : le chemin résolu doit rester dans target_dir (SEC-02)
    if not os.path.realpath(file_location).startswith(os.path.realpath(target_dir)):
        raise HTTPException(status_code=400, detail="Nom de fichier invalide.")
    with open(file_location, "wb+") as file_object:
        file_object.write(file.file.read())
    return {"path": f"/uploads/{safe_name}"}


if __name__ == "__main__":
    multiprocessing.freeze_support()
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8434, log_level="info")

# Hot reload trigger for schema updates
