import os
import sys
from datetime import date

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import (
    Account, Transaction, Category, RecurrenceTemplate,
    Budget, BudgetCategory, GlobalConfig
)

def build_test_db(engine_or_path="data/omnibank_test.db"):
    if isinstance(engine_or_path, str):
        # Delete if exists
        if os.path.exists(engine_or_path):
            try:
                os.remove(engine_or_path)
            except Exception:
                pass
        os.makedirs(os.path.dirname(engine_or_path), exist_ok=True)
        from sqlalchemy.pool import NullPool
        engine = create_engine(f"sqlite:///{engine_or_path}", connect_args={"timeout": 30}, poolclass=NullPool)
        Base.metadata.create_all(bind=engine)
    else:
        engine = engine_or_path
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)

    Session = sessionmaker(bind=engine)
    session = Session()

    # 1. Accounts
    cc = Account(id=1, name="Compte Courant", type="Compte courant", initial_balance=1500.0, color="#3366ff")
    livret = Account(id=2, name="Livret A", type="Livret", initial_balance=5000.0, color="#2ecc71")
    session.add_all([cc, livret])

    # 2. Categories
    # "Loyer" is variable, to test automatic conversion to fixed when recurrence is created
    cat_loyer = Category(id=1, name="Loyer", type="expense_var")
    cat_abonnement = Category(id=2, name="Abonnement", type="expense_var")
    cat_salaire = Category(id=3, name="Salaire", type="income")
    cat_alimentaire = Category(id=4, name="Alimentaire", type="expense_var")
    session.add_all([cat_loyer, cat_abonnement, cat_salaire, cat_alimentaire])

    # 3. Global Config
    session.add_all([
        GlobalConfig(key="schema_version", value="3"),
        GlobalConfig(key="base_pay_day", value="28"),
        GlobalConfig(key="site_lang", value="fr"),
        GlobalConfig(key="ia_enabled", value="false") # Default disabled to test toggle
    ])

    # 4. Recurrence templates
    # Template for Loyer
    tpl_loyer = RecurrenceTemplate(
        id=1,
        description="Loyer mensuel",
        amount=600.0,
        type="expense_fixed",
        category="Loyer",
        frequency="Monthly",
        day_of_month=5,
        from_account_id=1
    )
    # Template for Netflix - already generated with slightly different descriptions
    tpl_netflix = RecurrenceTemplate(
        id=2,
        description="Abonnement Netflix",
        amount=15.0,
        type="expense_fixed",
        category="Abonnement",
        frequency="Monthly",
        day_of_month=10,
        from_account_id=1
    )
    session.add_all([tpl_loyer, tpl_netflix])

    # 5. Transactions
    # Past income to establish paycheck cycles
    tx_pay_march = Transaction(
        id=1,
        date_saisie=date(2026, 3, 28),
        date_operation=date(2026, 3, 28),
        description="Salaire Mars",
        amount=2500.0,
        type="income",
        category="Salaire",
        reconciliation_date=date(2026, 3, 28),
        to_account_id=1
    )
    tx_pay_april = Transaction(
        id=2,
        date_saisie=date(2026, 4, 28),
        date_operation=date(2026, 4, 28),
        description="Salaire Avril",
        amount=2500.0,
        type="income",
        category="Salaire",
        reconciliation_date=date(2026, 4, 28),
        to_account_id=1
    )
    # Netflix transactions
    tx_netflix_march = Transaction(
        id=3,
        date_saisie=date(2026, 3, 10),
        date_operation=date(2026, 3, 10),
        description="Netflix.com Mars",
        amount=15.0,
        type="expense_fixed",
        category="Abonnement",
        reconciliation_date=date(2026, 3, 10),
        from_account_id=1,
        recurrence_id=2
    )
    tx_netflix_april = Transaction(
        id=4,
        date_saisie=date(2026, 4, 10),
        date_operation=date(2026, 4, 10),
        description="Netflix.com Avril",
        amount=15.0,
        type="expense_fixed",
        category="Abonnement",
        reconciliation_date=date(2026, 4, 10),
        from_account_id=1,
        recurrence_id=2
    )
    # Past Loyer transaction so the template has an anchor
    tx_loyer_april = Transaction(
        id=5,
        date_saisie=date(2026, 4, 5),
        date_operation=date(2026, 4, 5),
        description="Loyer Avril",
        amount=600.0,
        type="expense_fixed",
        category="Loyer",
        reconciliation_date=date(2026, 4, 5),
        from_account_id=1,
        recurrence_id=1
    )
    session.add_all([tx_pay_march, tx_pay_april, tx_netflix_march, tx_netflix_april, tx_loyer_april])

    # 6. Budgets
    b_alimentation = Budget(
        id=1,
        name="Alimentation",
        monthly_amount=300.0,
        period="monthly",
        is_project=False,
        is_closed=False
    )
    session.add(b_alimentation)
    session.flush()

    bc = BudgetCategory(
        budget_id=b_alimentation.id,
        category_name="Alimentaire"
    )
    session.add(bc)

    session.commit()
    session.close()
    print("Custom test database tables populated successfully.")

if __name__ == "__main__":
    build_test_db()
