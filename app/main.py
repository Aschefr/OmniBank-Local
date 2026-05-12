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
init_db()

app = FastAPI(title="OmniBank Local")

# Mount static files from bundled resources
static_dir = resource_path("static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Mount user uploads from DATA_DIR (persisted in %APPDATA%)
uploads_dir = os.path.join(DATA_DIR, "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

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
app.include_router(csv_manager.router)
app.include_router(ai_helpers.router)
app.include_router(budgets.router)
app.include_router(setup.router)
app.include_router(maintenance.router)
app.include_router(org_users.router)
app.include_router(license.router)
app.include_router(shared_mode.router)


@app.get("/")
def serve_spa():
    return FileResponse(os.path.join(resource_path("static"), "index.html"))


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


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    file_location = os.path.join(uploads_dir, file.filename)
    with open(file_location, "wb+") as file_object:
        file_object.write(file.file.read())
    return {"path": f"data/uploads/{file.filename}"}


if __name__ == "__main__":
    multiprocessing.freeze_support()
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8434, log_level="info")
