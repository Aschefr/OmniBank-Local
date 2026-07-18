from sqlalchemy import Column, Integer, String, Float, Boolean, Date, ForeignKey, DateTime, Text
from sqlalchemy.orm import relationship
from datetime import datetime
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

    # Skipped recurring occurrence flag (True = skipped/paused, False/None = regular)
    is_skipped = Column(Boolean, default=False, nullable=True)

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

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, default="Nouvelle conversation")
    role = Column(String, default="advisor")
    compressed_context = Column(Text, nullable=True)
    # Compression v2: track compression state without deleting messages
    last_compressed_message_id = Column(Integer, nullable=True)  # ID of last message included in compression
    bubble_after_id = Column(Integer, nullable=True)              # ID of the last compressed message (bubble placed after this)
    compressing = Column(Boolean, default=False)                  # True while compression is running
    buffered_message = Column(Text, nullable=True)               # User message held while compression runs
    compression_started_at = Column(DateTime, nullable=True)     # Timestamp for crash-recovery detection
    compression_stack = Column(Text, nullable=True)              # JSON array of prior {context, after_id} entries
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan")

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String)  # "user" or "assistant"
    content = Column(Text)
    timestamp = Column(DateTime, default=datetime.utcnow)

    session = relationship("ChatSession", back_populates="messages")


class Notification(Base):
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    type = Column(String)  # 'system' or 'ai_report'
    title = Column(String)
    content = Column(Text)
    detailed_content = Column(Text, nullable=True)
    link_data = Column(Text, nullable=True)  # JSON field containing click action metadata (e.g. {"session_id": 123})
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ActionHistory(Base):
    __tablename__ = "action_history"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow)
    entity_type = Column(String, nullable=False)   # "transaction", "account", "category", "budget", "budget_allocation", "recurrence_template", "org_user"
    entity_id = Column(Integer, nullable=False)
    action_type = Column(String, nullable=False)    # "CREATE", "UPDATE", "DELETE"
    previous_state = Column(Text, nullable=True)    # JSON snapshot before action
    new_state = Column(Text, nullable=True)         # JSON snapshot after action
    is_undone = Column(Boolean, default=False)
    user_name = Column(String, nullable=True)       # Org user name if active





