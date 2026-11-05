"""OmniBank API Server - Entry point for PyInstaller bundling."""
import multiprocessing
import sys
import os

# Top-level imports so PyInstaller can detect them
import uvicorn
import uvicorn.config
import uvicorn.main
import uvicorn.server


if __name__ == "__main__":
    multiprocessing.freeze_support()

    # When frozen, set working directory to the exe's location
    # so that relative imports and paths resolve correctly
    if getattr(sys, 'frozen', False):
        os.chdir(os.path.dirname(sys.executable))
        # Tauri lit la sortie en UTF-8 et ignore toute autre ligne : sans cela, les messages accentués disparaissent
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    from app.main import app
    uvicorn.run(app, host="127.0.0.1", port=8434, log_level="info")
