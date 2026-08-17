"""
OmniBank-Local — Pydantic Schemas for Bank Sync API
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class BackendConfigField(BaseModel):
    id: str
    label: str
    type: str  # "text", "password", "select", "date"
    description: Optional[str] = None
    required: bool = True
    choices: Optional[Dict[str, str]] = None  # {value: label} for select fields
    default: Optional[str] = None


class BankBackendInfo(BaseModel):
    name: str
    description: str
    is_installed: bool = False
    fields: List[BackendConfigField] = []


class BankConnectionCreate(BaseModel):
    backend: str
    label: str
    master_password: Optional[str] = None
    vault_token: Optional[str] = None
    credentials: Dict[str, Any]  # Key/Value credentials matching backend fields


class BankConnectionUpdate(BaseModel):
    label: Optional[str] = None
    account_mapping: Optional[Dict[str, int]] = None
    is_active: Optional[bool] = None


class BankConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    backend: str
    label: str
    website: Optional[str] = None
    is_active: bool
    last_sync_at: Optional[datetime] = None
    last_sync_status: Optional[str] = None
    last_sync_count: Optional[int] = 0
    last_error: Optional[str] = None
    account_mapping: Optional[str] = None
    has_credentials: bool = False
    created_at: Optional[datetime] = None


class RemoteAccountOut(BaseModel):
    id: str
    label: str
    type: str
    balance: float
    currency: str = "EUR"
    iban: Optional[str] = None


class TestConnectionRequest(BaseModel):
    backend: str
    credentials: Dict[str, Any]


class SyncConnectionRequest(BaseModel):
    master_password: Optional[str] = None
    vault_token: Optional[str] = None
    since_days: Optional[int] = 90


class VaultUnlockRequest(BaseModel):
    master_password: str
    remember_days: Optional[int] = 7


class VaultStatusOut(BaseModel):
    is_unlocked: bool
    remaining_seconds: int = 0
    remaining_days: int = 0
    expires_at: Optional[float] = None


class TwoFAResponseRequest(BaseModel):
    session_id: str
    response_type: str  # "otp_code" | "app_validated" | "cancel"
    value: Optional[str] = None

