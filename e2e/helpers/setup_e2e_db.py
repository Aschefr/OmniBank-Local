"""
e2e/helpers/setup_e2e_db.py
Script to initialize clean isolated SQLite test database for E2E tests
with all optional features enabled (except org_mode).
"""
import os
import sys
import shutil

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT_DIR)

E2E_DATA_DIR = os.path.join(ROOT_DIR, "data", "e2e_test_data")
os.environ["OMNIBANK_DATA_DIR"] = E2E_DATA_DIR

def clean_and_prepare_e2e_db(mode="fresh"):
    """
    mode: 'fresh' -> empty database ready for setup wizard / from-scratch tests
          'demo'  -> populated with demo_dataset_omnibank.csv
    """
    if os.path.exists(E2E_DATA_DIR):
        try:
            shutil.rmtree(E2E_DATA_DIR, ignore_errors=True)
        except Exception:
            pass
    os.makedirs(E2E_DATA_DIR, exist_ok=True)
    os.makedirs(os.path.join(E2E_DATA_DIR, "uploads"), exist_ok=True)

    from app.profile_manager import ensure_profiles_initialized
    from app.init_data import init_db
    from app.database import SessionLocal, get_engine
    from app.models import GlobalConfig

    ensure_profiles_initialized()
    init_db()

    db = SessionLocal()
    try:
        # Enable all optional features requested by user (org_mode remains false)
        configs = {
            "enable_overview": "true",
            "enable_simulator": "true",
            "enable_bimonthly": "true",
            "enable_attachments": "true",
            "enable_check_slips": "true",
            "enable_ai": "true",
            "enable_ai_reports": "true",
            "enable_org_mode": "false",
            "base_currency": "EUR",
            "recurrence_months": "12",
        }
        for k, v in configs.items():
            cfg = db.query(GlobalConfig).filter(GlobalConfig.key == k).first()
            if cfg:
                cfg.value = v
            else:
                db.add(GlobalConfig(key=k, value=v))
        db.commit()
    finally:
        db.close()

    print(f"E2E Database initialized successfully in {E2E_DATA_DIR} (mode={mode})")

if __name__ == "__main__":
    mode_arg = sys.argv[1] if len(sys.argv) > 1 else "fresh"
    clean_and_prepare_e2e_db(mode_arg)
