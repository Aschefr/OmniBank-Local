from pydantic import BaseModel, field_validator, ConfigDict
from typing import Optional, List
from datetime import date, datetime


def _validate_date_range(v: Optional[date]) -> Optional[date]:
    """Rejette les dates absurdes (avant 1900 ou après 2200)."""
    if v is None:
        return v
    if v.year < 1900 or v.year > 2200:
        raise ValueError(f"Date invalide : {v} — l'année doit être comprise entre 1900 et 2200.")
    return v

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
    created_by: Optional[str] = None
    modified_by: Optional[str] = None
    created_at: Optional[str] = None
    modified_at: Optional[str] = None
    is_salary: Optional[bool] = None
    is_skipped: Optional[bool] = False
    original_amount: Optional[float] = None
    original_currency: Optional[str] = None
    cross_profile_link_id: Optional[str] = None
    cross_profile_id: Optional[str] = None
    cross_profile_label: Optional[str] = None
    cross_profile_status: Optional[str] = None

    @field_validator('date_saisie', 'date_operation', 'reconciliation_date', mode='after')
    @classmethod
    def validate_dates(cls, v: Optional[date]) -> Optional[date]:
        return _validate_date_range(v)

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
    is_salary: Optional[bool] = None
    is_skipped: Optional[bool] = None
    original_amount: Optional[float] = None
    original_currency: Optional[str] = None
    cross_profile_link_id: Optional[str] = None
    cross_profile_id: Optional[str] = None
    cross_profile_label: Optional[str] = None
    cross_profile_status: Optional[str] = None
    attachments: Optional[str] = None
    check_slip_number: Optional[str] = None
    from_account_id: Optional[int] = None
    to_account_id: Optional[int] = None
    recurrence_id: Optional[int] = None
    budget_id: Optional[int] = None  # Assign/unassign to project budget
    modified_by: Optional[str] = None
    modified_at: Optional[str] = None

    @field_validator('date_operation', 'reconciliation_date', mode='after')
    @classmethod
    def validate_dates(cls, v: Optional[date]) -> Optional[date]:
        return _validate_date_range(v)

class CrossProfileTransferRequest(BaseModel):
    target_profile_id: str
    target_account_id: int
    source_account_id: int
    amount: float
    date_operation: date
    description: str = "Virement inter-profil"
    category: Optional[str] = None
    created_by: Optional[str] = None

class CrossProfileValidationRequest(BaseModel):
    action: str  # "accept" or "reject"


class TransactionOut(TransactionBase):
    id: int
    csv_id: Optional[str] = None
    action_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)

class CategoryBase(BaseModel):
    name: str
    type: str
    is_closed: bool = False

class CategoryOut(CategoryBase):
    id: int
    action_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)

class RecurrenceTemplateBase(BaseModel):
    description: str
    amount: float
    type: str
    category: Optional[str] = None
    frequency: str
    day_of_month: Optional[int] = None
    month_of_year: Optional[int] = None
    max_occurrences: Optional[int] = None
    is_closed: bool = False
    from_account_id: Optional[int] = None
    to_account_id: Optional[int] = None

class WizardTemplateUpdate(BaseModel):
    id: int
    renew: bool
    amount: Optional[float] = None
    day_of_month: Optional[int] = None
    category: Optional[str] = None
    frequency: Optional[str] = None

class RecurrenceTemplateCreate(RecurrenceTemplateBase):
    pass

class WizardGenerateRequest(BaseModel):
    target_year: int
    updates: List[WizardTemplateUpdate]
    new_templates: List[RecurrenceTemplateCreate]
    generate_instances: bool = True

class PropagateRequest(BaseModel):
    transaction_id: int
    new_amount: float
    new_date: date

class RecurrenceCloseRequest(BaseModel):
    closure_date: Optional[date] = None

class RecurrenceTemplateOut(RecurrenceTemplateBase):
    id: int
    action_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)

class AccountBase(BaseModel):
    name: str
    type: str
    initial_balance: float
    is_closed: bool = False
    color: Optional[str] = None
    currency: Optional[str] = "EUR"

class AccountOut(AccountBase):
    id: int
    action_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)

class ConfigItem(BaseModel):
    key: str
    value: str

class ChatSessionCreate(BaseModel):
    title: Optional[str] = None
    role: str = "advisor"

class ChatSessionUpdate(BaseModel):
    title: Optional[str] = None
    role: Optional[str] = None

class ChatContextUpdate(BaseModel):
    compressed_context: str

class ChatRegenerateContext(BaseModel):
    instruction: Optional[str] = None  # Optional user instruction to orient the summary

class ChatSendMessage(BaseModel):
    content: str
    lang: str = "fr"
    role: Optional[str] = None
    update_last_assistant: Optional[bool] = False
    user_name: Optional[str] = None

class ChatMessageUpdate(BaseModel):
    content: str


# Phase 9: Org Users
class OrgUserBase(BaseModel):
    name: str
    is_active: bool = True
    sort_order: int = 0

class OrgUserCreate(OrgUserBase):
    pass

class OrgUserUpdate(BaseModel):
    name: Optional[str] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None

class OrgUserOut(OrgUserBase):
    id: int
    action_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


# Phase 3: AI Facts memory editor schemas
class AIFactBase(BaseModel):
    fact_key: str
    fact_value: str
    session_id: Optional[int] = None
    user_id: Optional[int] = None

class AIFactCreate(AIFactBase):
    private_to_session: Optional[bool] = False
    user_name: Optional[str] = None

class AIFactUpdate(BaseModel):
    fact_value: str

class AIFactOut(AIFactBase):
    id: int
    user_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class ExchangeRateBase(BaseModel):
    from_currency: str
    to_currency: str
    rate: float

class ExchangeRateCreate(ExchangeRateBase):
    pass

class ExchangeRateOut(ExchangeRateBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


# ─── Simulateur & Scénarios What-If (Lot 1.C) ──────────────────────────────────
class ScenarioEventBase(BaseModel):
    label: str
    event_type: str  # "one_off_expense", "one_off_income", "recurring_expense", "recurring_income", "percentage_adjustment"
    amount: float = 0.0
    account_id: Optional[int] = None
    category: Optional[str] = None
    start_date: date
    end_date: Optional[date] = None
    duration_months: Optional[int] = None
    is_active: bool = True
    notes: Optional[str] = None

    @field_validator('start_date', 'end_date', mode='after')
    @classmethod
    def validate_dates(cls, v: Optional[date]) -> Optional[date]:
        return _validate_date_range(v)

class ScenarioEventCreate(ScenarioEventBase):
    pass

class ScenarioEventUpdate(BaseModel):
    label: Optional[str] = None
    event_type: Optional[str] = None
    amount: Optional[float] = None
    account_id: Optional[int] = None
    category: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    duration_months: Optional[int] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None

    @field_validator('start_date', 'end_date', mode='after')
    @classmethod
    def validate_dates(cls, v: Optional[date]) -> Optional[date]:
        return _validate_date_range(v)

class ScenarioEventOut(ScenarioEventBase):
    id: int
    scenario_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ScenarioBase(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#8b5cf6"
    is_active: bool = True

class ScenarioCreate(ScenarioBase):
    events: Optional[List[ScenarioEventCreate]] = []

class ScenarioUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    is_active: Optional[bool] = None

class ScenarioOut(ScenarioBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    events: List[ScenarioEventOut] = []

    model_config = ConfigDict(from_attributes=True)



class SimulationRunRequest(BaseModel):
    scenario_id: Optional[int] = None
    horizon_months: int = 12  # 6, 12, 18, 24, 36
    account_id: Optional[int] = None  # None = main account / all liquid accounts
    custom_events: Optional[List[ScenarioEventBase]] = None  # For instant live simulation without saving
    income_mode: Optional[str] = "auto"  # 'auto', 'historical_n1', 'custom', 'none'
    custom_income_amount: Optional[float] = None  # in €/month when income_mode == 'custom'
    inflation_rate: Optional[float] = 0.0  # Annual inflation rate (e.g. 0.03 = 3%/year), 0 = disabled
    variable_expense_adjustment_pct: Optional[float] = 0.0  # Effort/adjustment on variable spending (-0.20 = -20%, +0.10 = +10%)
    projection_profile: Optional[str] = "realistic"  # 'realistic' (flux réels constatés) ou 'conservative' (stress-test strict)
    conservative_weight: Optional[float] = None  # Curseur continu de prudence : 0.0 (100% Réel) à 1.0 (100% Conservateur)




