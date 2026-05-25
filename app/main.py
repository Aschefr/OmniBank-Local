import sys
import os
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

app = FastAPI(title="OmniBank Local")

# Mount static files from bundled resources
static_dir = resource_path("static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Mount user uploads from DATA_DIR (persisted in %APPDATA%)
uploads_dir = os.path.join(DATA_DIR, "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")
# Backward compat: old attachments stored as "data/uploads/..." in DB
app.mount("/data/uploads", StaticFiles(directory=uploads_dir), name="uploads_compat")

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
    shared_mode
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


@app.on_event("startup")
async def startup_init():
    """Initialise la base de données et lance le scheduler de backup automatique."""
    init_db()
    from app.routers.auto_backup import start_scheduler
    start_scheduler()


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
    if _spa_html_cache:
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
    return HTMLResponse(content=_get_spa_html(), media_type="text/html")


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


# In-memory changelog cache to avoid repeated GitHub API calls
_changelog_cache = {}

@app.get("/api/changelog")
def get_changelog(version: str = None):
    """Fetch release notes from GitHub, with local fallback."""
    import json
    import urllib.request
    import urllib.error

    # Determine version
    if not version:
        try:
            pkg_path = resource_path("package.json")
            if not os.path.exists(pkg_path):
                pkg_path = os.path.join(os.path.abspath('.'), "package.json")
            with open(pkg_path, "r", encoding="utf-8") as f:
                version = json.load(f).get("version", "?")
        except Exception:
            version = "?"

    # Check cache
    if version in _changelog_cache:
        return _changelog_cache[version]

    # Try GitHub API
    tag = f"v{version}" if not version.startswith("v") else version
    gh_url = f"https://api.github.com/repos/Aschefr/OmniBank-Local/releases/tags/{tag}"
    try:
        req = urllib.request.Request(gh_url, headers={"Accept": "application/vnd.github.v3+json", "User-Agent": "OmniBank"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        result = {
            "version": version,
            "notes": data.get("body", ""),
            "pub_date": data.get("published_at", ""),
            "name": data.get("name", f"OmniBank v{version}")
        }
        _changelog_cache[version] = result
        return result
    except Exception as e:
        logger.warning(f"[changelog] GitHub API failed: {e}, using local fallback")

    # Fallback: latest.json
    try:
        latest_path = resource_path("latest.json")
        if not os.path.exists(latest_path):
            latest_path = os.path.join(os.path.abspath('.'), "latest.json")
        with open(latest_path, "r", encoding="utf-8") as f:
            latest = json.load(f)
        result = {
            "version": latest.get("version", version),
            "notes": latest.get("notes", ""),
            "pub_date": latest.get("pub_date", ""),
            "name": f"OmniBank v{latest.get('version', version)}"
        }
        _changelog_cache[version] = result
        return result
    except Exception:
        pass

    return {"version": version, "notes": "", "pub_date": "", "name": f"OmniBank v{version}"}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    file_location = os.path.join(uploads_dir, file.filename)
    with open(file_location, "wb+") as file_object:
        file_object.write(file.file.read())
    return {"path": f"/uploads/{file.filename}"}


if __name__ == "__main__":
    multiprocessing.freeze_support()
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8434, log_level="info")
