import os
from sqlalchemy.orm import Session
from app.database import engine, Base, SessionLocal
import app.models  # Register all models for create_all

def init_db(target_engine=None):
    from app.database import get_engine
    eng = target_engine or get_engine()
    Base.metadata.create_all(bind=eng)

    from sqlalchemy import text
    with eng.connect() as conn:
        try:
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transactions_budget_id ON transactions (budget_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_transactions_category_date ON transactions (category, date_operation)"))
            conn.commit()
        except Exception:
            pass
        # Check current schema version to avoid repeating slow migrations on every startup
        schema_version = 0
        try:
            row = conn.execute(text("SELECT value FROM global_config WHERE key = 'schema_version'")).fetchone()
            if row:
                schema_version = int(row[0])
        except Exception:
            pass

        if schema_version < 2:
            # --- Idempotent migration: French type strings → universal technical keys ---
            TYPE_MIGRATION = {
                "Dépenses fixes": "expense_fixed",
                "Dépenses variables": "expense_var",
                "Recettes": "income",
                "Transfert": "transfer",
                "Neutre": "neutral",
            }
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

            # Record schema version as done
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '2')"))
            except Exception:
                pass
                
            conn.commit()

        if schema_version < 3:
            # Schema v3: Tirelire (savings piggy bank envelopes)
            try:
                conn.execute(text("ALTER TABLE budgets ADD COLUMN envelope_type TEXT DEFAULT 'spending'"))
            except Exception:
                pass  # Column likely already exists

            # Create budget_allocations table for manual fund deposits/withdrawals
            try:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS budget_allocations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        budget_id INTEGER NOT NULL REFERENCES budgets(id),
                        amount REAL NOT NULL,
                        date DATE NOT NULL,
                        note TEXT,
                        created_at TEXT
                    )
                """))
            except Exception:
                pass

            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '3')"))
            except Exception:
                pass

            conn.commit()

        if schema_version < 4:
            # Schema v4: Salary manual flag override
            try:
                conn.execute(text("ALTER TABLE transactions ADD COLUMN is_salary BOOLEAN DEFAULT NULL"))
            except Exception:
                pass

            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '4')"))
            except Exception:
                pass

            conn.commit()

        if schema_version < 5:
            # Schema v5: Reclassify 'neutral' categories as 'transfer'
            # Previously, transfer-related categories like "Compte vers compte"
            # were typed as 'neutral', making them invisible when creating transfers.
            try:
                conn.execute(text("UPDATE categories SET type = 'transfer' WHERE type = 'neutral'"))
            except Exception:
                pass

            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '5')"))
            except Exception:
                pass

            conn.commit()

        if schema_version < 6:
            # Schema v6: Chat sessions and message history
            try:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS chat_sessions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT DEFAULT 'Nouvelle conversation',
                        role TEXT DEFAULT 'advisor',
                        compressed_context TEXT,
                        last_compressed_message_id INTEGER,
                        bubble_after_id INTEGER,
                        compressing BOOLEAN DEFAULT 0,
                        buffered_message TEXT,
                        compression_started_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS chat_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                        role TEXT NOT NULL,
                        content TEXT NOT NULL,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            except Exception:
                pass

            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '6')"))
            except Exception:
                pass

            conn.commit()

        if schema_version < 7:
            # Schema v7: Skipped/paused recurrence occurrences
            try:
                conn.execute(text("ALTER TABLE transactions ADD COLUMN is_skipped BOOLEAN DEFAULT 0"))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '7')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 8:
            # Schema v8: Proactive periodic AI financial reports notifications
            try:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS notifications (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        type TEXT NOT NULL,
                        title TEXT NOT NULL,
                        content TEXT NOT NULL,
                        detailed_content TEXT,
                        is_read BOOLEAN DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '8')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 9:
            # Schema v9: Add detailed_content column to notifications table if created under schema v8
            try:
                conn.execute(text("ALTER TABLE notifications ADD COLUMN detailed_content TEXT"))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '9')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 10:
            # Schema v10: Add link_data column to notifications table
            try:
                conn.execute(text("ALTER TABLE notifications ADD COLUMN link_data TEXT"))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '10')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 11:
            # Schema v11: Add action_history table
            try:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS action_history (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        entity_type TEXT NOT NULL,
                        entity_id INTEGER NOT NULL,
                        action_type TEXT NOT NULL,
                        previous_state TEXT,
                        new_state TEXT,
                        is_undone BOOLEAN DEFAULT 0,
                        user_name TEXT
                    )
                """))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '11')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 12:
            # Schema v12: Compression v2 — track compression state without deleting messages
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN last_compressed_message_id INTEGER"))
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN compressing BOOLEAN DEFAULT 0"))
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN buffered_message TEXT"))
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN compression_started_at TIMESTAMP"))
            except Exception:
                pass
            # Crash-recovery: reset any sessions stuck in compressing=True from previous runs
            try:
                conn.execute(text("""
                    UPDATE chat_sessions SET compressing = 0
                    WHERE compressing = 1
                    AND compression_started_at < datetime('now', '-5 minutes')
                """))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '12')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 13:
            # Schema v13: bubble_after_id for correct context bubble placement after F5
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN bubble_after_id INTEGER"))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '13')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 14:
            # Schema v14: compression_stack for multi-bubble support
            try:
                conn.execute(text("ALTER TABLE chat_sessions ADD COLUMN compression_stack TEXT"))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '14')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 15:
            # Schema v15: Add account_id to budget_allocations for savings tracking
            try:
                conn.execute(text("ALTER TABLE budget_allocations ADD COLUMN account_id INTEGER REFERENCES accounts(id)"))
            except Exception:
                pass
            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '15')"))
            except Exception:
                pass
            conn.commit()

        if schema_version < 16:
            # Schema v16: Multi-currency support
            try:
                conn.execute(text("ALTER TABLE accounts ADD COLUMN currency TEXT DEFAULT 'EUR'"))
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE transactions ADD COLUMN original_amount FLOAT"))
            except Exception:
                pass
            try:
                conn.execute(text("ALTER TABLE transactions ADD COLUMN original_currency TEXT"))
            except Exception:
                pass
            try:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS exchange_rates (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        from_currency TEXT NOT NULL,
                        to_currency TEXT NOT NULL,
                        rate REAL NOT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            except Exception:
                pass

            # Seed default base_currency in global_config if missing
            try:
                conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('base_currency', 'EUR')"))
            except Exception:
                pass

            # Seed default offline exchange rates if table is empty
            try:
                rate_count = conn.execute(text("SELECT COUNT(*) FROM exchange_rates")).scalar()
                if rate_count == 0:
                    default_rates = [
                        ("USD", "EUR", 0.92), ("EUR", "USD", 1.087),
                        ("GBP", "EUR", 1.17), ("EUR", "GBP", 0.855),
                        ("CHF", "EUR", 1.05), ("EUR", "CHF", 0.952),
                        ("CAD", "EUR", 0.68), ("EUR", "CAD", 1.47),
                        ("JPY", "EUR", 0.006), ("EUR", "JPY", 166.67),
                    ]
                    for f, t, r in default_rates:
                        conn.execute(text("INSERT INTO exchange_rates (from_currency, to_currency, rate) VALUES (:f, :t, :r)"), {"f": f, "t": t, "r": r})
            except Exception:
                pass

            try:
                conn.execute(text("INSERT OR REPLACE INTO global_config (key, value) VALUES ('schema_version', '16')"))
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
    import pandas as pd
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
