from pydantic import BaseModel
from typing import Optional, List
from datetime import date

class TransactionBase(BaseModel):
    date_saisie: date
    date_operation: date
    description: str
    amount: float
    type: str
    category: Optional[str] = None
    reconciliation_date: Optional[date] = None
    is_monthly: bool = False
    is_yearly: bool = False
    is_bimonthly: bool = False
    recurrence_day_1: Optional[int] = None
    recurrence_day_2: Optional[int] = None
    attachments: Optional[str] = None
    check_slip_number: Optional[str] = None
    from_account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    recurrence_id: Optional[int] = None
    budget_id: Optional[int] = None  # For project-type budget assignment

class TransactionCreate(TransactionBase):
    pass

class TransactionUpdate(BaseModel):
    date_operation: Optional[date] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    type: Optional[str] = None
    category: Optional[str] = None
    reconciliation_date: Optional[date] = None
    is_bimonthly: Optional[bool] = None
    recurrence_day_1: Optional[int] = None
    recurrence_day_2: Optional[int] = None
    attachments: Optional[str] = None
    check_slip_number: Optional[str] = None
    from_account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    recurrence_id: Optional[int] = None
    budget_id: Optional[int] = None  # Assign/unassign to project budget

class TransactionOut(TransactionBase):
    id: int
    csv_id: Optional[str] = None

    class Config:
        orm_mode = True

class CategoryBase(BaseModel):
    name: str
    type: str
    is_closed: bool = False

class CategoryOut(CategoryBase):
    id: int

    class Config:
        orm_mode = True

class RecurrenceTemplateBase(BaseModel):
    description: str
    amount: float
    type: str
    category: Optional[str] = None
    frequency: str
    day_of_month: Optional[int] = None
    month_of_year: Optional[int] = None
    from_account_id: Optional[int] = None
    to_account_id: Optional[int] = None

class RecurrenceTemplateCreate(RecurrenceTemplateBase):
    pass

class PropagateRequest(BaseModel):
    transaction_id: int
    new_amount: float
    new_date: date

class RecurrenceTemplateOut(RecurrenceTemplateBase):
    id: int

    class Config:
        orm_mode = True

class AccountBase(BaseModel):
    name: str
    type: str
    initial_balance: float
    is_closed: bool = False

class AccountOut(AccountBase):
    id: int

    class Config:
        orm_mode = True
        from_attributes = True

class ConfigItem(BaseModel):
    key: str
    value: str

class ChatMessage(BaseModel):
    content: str
    history: List[dict] = []
    role: Optional[str] = "advisor"
