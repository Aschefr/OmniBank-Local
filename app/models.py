from sqlalchemy import Column, Integer, String, Float, Boolean, Date, ForeignKey
from app.database import Base

class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    type = Column(String) # "Compte courant", "Livret", etc.
    initial_balance = Column(Float, default=0.0)
    is_closed = Column(Boolean, default=False)
    color = Column(String, nullable=True)  # Hex color for badge display (e.g. "#3366ff")

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    csv_id = Column(String, unique=True, index=True, nullable=True) # Used for deduplication on import
    
    date_saisie = Column(Date)
    date_operation = Column(Date)
    description = Column(String)
    
    amount = Column(Float) # Always positive/absolute value
    
    type = Column(String) # "expense_fixed", "expense_var", "income", "transfer", "neutral"
    category = Column(String, nullable=True)
    
    reconciliation_date = Column(Date, nullable=True) # null if not reconciled
    
    is_monthly = Column(Boolean, default=False)
    is_yearly = Column(Boolean, default=False)
    is_bimonthly = Column(Boolean, default=False)
    
    recurrence_day_1 = Column(Integer, nullable=True)
    recurrence_day_2 = Column(Integer, nullable=True)
    
    attachments = Column(String, nullable=True) # JSON or comma-separated paths
    check_slip_number = Column(String, nullable=True)
    
    from_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    to_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    
    recurrence_id = Column(Integer, ForeignKey("recurrence_templates.id"), nullable=True)
    
    # Budget project assignment (optional — for project-type envelopes)
    budget_id = Column(Integer, ForeignKey("budgets.id"), nullable=True)

    # Manual override for paycheck detection (True = is paycheck, False = not paycheck, None = default/heuristic)
    is_salary = Column(Boolean, nullable=True, default=None)

    # Phase 9: Multi-user audit (org mode)
    created_by = Column(String, nullable=True)     # Org user name who created
    modified_by = Column(String, nullable=True)     # Last org user who modified
    created_at = Column(String, nullable=True)      # ISO timestamp of creation
    modified_at = Column(String, nullable=True)      # ISO timestamp of last modification

class GlobalConfig(Base):
    __tablename__ = "global_config"
    
    key = Column(String, primary_key=True)
    value = Column(String)

class Category(Base):
    __tablename__ = "categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    type = Column(String) # For grouping: expense_fixed, expense_var, income, neutral
    is_closed = Column(Boolean, default=False)

class RecurrenceTemplate(Base):
    __tablename__ = "recurrence_templates"

    id = Column(Integer, primary_key=True, index=True)
    description = Column(String)
    amount = Column(Float)
    type = Column(String)
    category = Column(String, nullable=True)
    frequency = Column(String) # "Monthly", "Yearly", etc.
    day_of_month = Column(Integer, nullable=True)
    month_of_year = Column(Integer, nullable=True) # for yearly
    max_occurrences = Column(Integer, nullable=True)
    is_closed = Column(Boolean, default=False)
    
    from_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)
    to_account_id = Column(Integer, ForeignKey("accounts.id"), nullable=True)

class Budget(Base):
    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)                    # Free label (ex: "Vacances St Malo")
    monthly_amount = Column(Float, nullable=False)
    period = Column(String, default="monthly")               # monthly / yearly / indefinite / custom
    is_project = Column(Boolean, default=False)              # True = tracked via budget_id on transactions
    is_closed = Column(Boolean, default=False)               # Manual closure by user
    start_date = Column(Date, nullable=True)                 # For custom period envelopes
    end_date = Column(Date, nullable=True)                   # For custom period envelopes
    account_ids = Column(String, nullable=True)              # JSON list of account IDs (org mode), null = global
    envelope_type = Column(String, default="spending")        # "spending" (classic) or "savings" (piggy bank / tirelire)

class BudgetCategory(Base):
    """Many-to-many: each row links a budget to one category name."""
    __tablename__ = "budget_categories"

    id = Column(Integer, primary_key=True, index=True)
    budget_id = Column(Integer, ForeignKey("budgets.id"), nullable=False)
    category_name = Column(String, nullable=False)

class BudgetAllocation(Base):
    """Manual fund allocations for savings-type envelopes (piggy banks)."""
    __tablename__ = "budget_allocations"

    id = Column(Integer, primary_key=True, index=True)
    budget_id = Column(Integer, ForeignKey("budgets.id"), nullable=False)
    amount = Column(Float, nullable=False)         # Positive = deposit, Negative = withdrawal
    date = Column(Date, nullable=False)
    note = Column(String, nullable=True)            # Ex: "Mise de côté mars"
    created_at = Column(String, nullable=True)      # ISO timestamp

class OrgUser(Base):
    """Phase 9: Organisation mode users (passwordless)."""
    __tablename__ = "org_users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)


