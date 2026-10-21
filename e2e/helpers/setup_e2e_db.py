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
        # Vider explicitement toutes les tables métier pour garantir une base vierge même si uvicorn a verrouillé le fichier
        from app.models import (
            Transaction, BudgetAllocation, BudgetCategory, Budget,
            RecurrenceTemplate, Category, Account, OrgUser, ChatMessage,
            ChatSession, Notification, ActionHistory, AIFact, Scenario,
            ScenarioEvent, BankConnection, BankLabelMapping, AutopilotDecisionLog
        )
        for model in [
            Transaction, BudgetAllocation, BudgetCategory, Budget,
            RecurrenceTemplate, Category, Account, OrgUser, ChatMessage,
            ChatSession, Notification, ActionHistory, AIFact, Scenario,
            ScenarioEvent, BankConnection, BankLabelMapping, AutopilotDecisionLog
        ]:
            try:
                db.query(model).delete(synchronize_session=False)
            except Exception:
                pass
        db.commit()

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

        if mode == "chat_diff":
            from datetime import date
            # Comptes et catégories
            acc = Account(id=1, name="Compte Courant Test", type="Compte courant", initial_balance=1500.0)
            cat1 = Category(id=1, name="Alimentation", type="expense_var")
            cat2 = Category(id=2, name="Loisirs", type="expense_var")
            db.add_all([acc, cat1, cat2])
            db.commit()

            # Transaction initiale
            tx = Transaction(
                id=1,
                from_account_id=1,
                amount=54.20,
                type="expense_var",
                category="Alimentation",
                description="Courses Supermarché",
                date_operation=date(2026, 10, 15)
            )
            db.add(tx)

            # Session de chat avec message proposant une action de correction
            session = ChatSession(id=1, title="Audit Chat Diff E2E", role="advisor")
            db.add(session)
            db.commit()

            action_content = (
                "Voici l'ajustement que je vous recommande pour cette opération :\n\n"
                "```action\n"
                "{\n"
                '  "action": "apply_transaction_correction",\n'
                '  "params": {\n'
                '    "transaction_id": 1,\n'
                '    "category": "Loisirs",\n'
                '    "amount": 75.0\n'
                "  }\n"
                "}\n"
                "```"
            )
            msg = ChatMessage(id=1, session_id=1, role="assistant", content=action_content)
            db.add(msg)
            db.commit()
    finally:
        db.close()

    print(f"E2E Database initialized successfully in {E2E_DATA_DIR} (mode={mode})")

if __name__ == "__main__":
    mode_arg = sys.argv[1] if len(sys.argv) > 1 else "fresh"
    clean_and_prepare_e2e_db(mode_arg)
