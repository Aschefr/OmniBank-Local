import os
import pandas as pd
from sqlalchemy.orm import Session
from app.database import engine, Base, SessionLocal
from app.models import Account, Transaction, GlobalConfig

def init_db():
    Base.metadata.create_all(bind=engine)

    # --- Idempotent migration: French type strings → universal technical keys ---
    TYPE_MIGRATION = {
        "Dépenses fixes": "expense_fixed",
        "Dépenses variables": "expense_var",
        "Recettes": "income",
        "Transfert": "transfer",
        "Neutre": "neutral",
    }
    from sqlalchemy import text
    with engine.connect() as conn:
        for old_val, new_val in TYPE_MIGRATION.items():
            conn.execute(text("UPDATE transactions SET type = :new WHERE type = :old"), {"new": new_val, "old": old_val})
            conn.execute(text("UPDATE categories SET type = :new WHERE type = :old"), {"new": new_val, "old": old_val})
            conn.execute(text("UPDATE recurrence_templates SET type = :new WHERE type = :old"), {"new": new_val, "old": old_val})
            
        try:
            conn.execute(text("ALTER TABLE categories ADD COLUMN is_closed BOOLEAN DEFAULT 0"))
        except Exception:
            pass # Column likely already exists
            
        try:
            conn.execute(text("ALTER TABLE recurrence_templates ADD COLUMN max_occurrences INTEGER"))
        except Exception:
            pass

        try:
            conn.execute(text("ALTER TABLE recurrence_templates ADD COLUMN is_closed BOOLEAN DEFAULT 0"))
        except Exception:
            pass

        try:
            conn.execute(text("ALTER TABLE accounts ADD COLUMN color TEXT"))
        except Exception:
            pass  # Column likely already exists

        # Phase 9: Multi-user audit columns
        try:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN created_by TEXT"))
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN modified_by TEXT"))
        except Exception:
            pass

        # Audit timestamps (org mode)
        try:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN created_at TEXT"))
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN modified_at TEXT"))
        except Exception:
            pass

        # Phase 11: Custom period budget envelopes
        try:
            conn.execute(text("ALTER TABLE budgets ADD COLUMN start_date DATE"))
        except Exception:
            pass
        try:
            conn.execute(text("ALTER TABLE budgets ADD COLUMN end_date DATE"))
        except Exception:
            pass

        # Improvement_04: Account-scoped budgets (org mode)
        try:
            conn.execute(text("ALTER TABLE budgets ADD COLUMN account_ids TEXT"))
        except Exception:
            pass

            
        conn.commit()

def wipe_db(db: Session):
    """Delete all data to start fresh."""
    db.query(Transaction).delete()
    db.query(Account).delete()
    db.query(GlobalConfig).delete()
    db.commit()

def load_initial_balances(db: Session, data_dir: str = "."):
    """Load initial balances if the accounts table is empty."""
    if db.query(Account).first():
        return # Already initialized
        
    comptes_file = os.path.join(data_dir, "Comptes soldes initials.csv")
    livrets_file = os.path.join(data_dir, "Livrets soldes initials.csv")
    
    accounts_to_add = []
    
    if os.path.exists(comptes_file):
        df_comptes = pd.read_csv(comptes_file, sep=";", encoding="latin-1")
        # Skip header if it is weird, or just use the columns
        for _, row in df_comptes.iterrows():
            name = row.iloc[0]
            balance_str = str(row.iloc[1]).replace(",", ".")
            balance = float(balance_str)
            accounts_to_add.append(Account(name=name, type="Compte courant", initial_balance=balance))
            
    if os.path.exists(livrets_file):
        df_livrets = pd.read_csv(livrets_file, sep=";", encoding="latin-1")
        for _, row in df_livrets.iterrows():
            name = row.iloc[0]
            balance_str = str(row.iloc[1]).replace(",", ".")
            balance = float(balance_str)
            accounts_to_add.append(Account(name=name, type="Livret", initial_balance=balance))
            
    if accounts_to_add:
        db.add_all(accounts_to_add)
        db.commit()

if __name__ == "__main__":
    init_db()
    db = SessionLocal()
    # Assuming script run from project root
    load_initial_balances(db)
    db.close()
    print("Database initialized.")
