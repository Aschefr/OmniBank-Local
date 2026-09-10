"""
OmniBank-Local — Service de Synchronisation Bancaire Universelle (Woob).
Façade de rétrocompatibilité préservant l'API historique et les mocks de tests.
Les composants modulaires sont situés dans le package app.services.bank_sync.* :
  - app.services.bank_sync.twofa_manager
  - app.services.bank_sync.woob_adapter
  - app.services.bank_sync.import_engine
  - app.services.bank_sync.sync_service
"""

# 1. Objets de synchronisation et d'état 2FA
from app.services.bank_sync.twofa_manager import (
    _TWOFA_LOCK,
    _TWOFA_SESSIONS,
    deliver_2fa_response,
    is_2fa_session_cancelled,
    register_2fa_session,
    unregister_2fa_session,
)

# 2. Adaptateur Woob et hotfixes
from app.services.bank_sync.woob_adapter import (
    ACCOUNT_TYPE_LABELS,
    CRAGR_CAISSES_CHOICES,
    _apply_module_hotfixes,
    _clean_str,
    _format_account_type,
    _inspect_module_fields,
    clean_error_message,
    get_all_bank_backends,
    get_woob,
    get_woob_storage,
    init_known_bank_hotfixes,
)

# 3. Service principal d'orchestration
from app.services.bank_sync.sync_service import BankSyncService

# 4. Moteur d'importation et ré-évaluation dynamique
from app.services.bank_sync.import_engine import re_evaluate_preview_data

__all__ = [
    "BankSyncService",
    "re_evaluate_preview_data",
    "get_woob",
    "get_woob_storage",
    "_apply_module_hotfixes",
    "init_known_bank_hotfixes",
    "get_all_bank_backends",
    "_inspect_module_fields",
    "clean_error_message",
    "_clean_str",
    "_format_account_type",
    "CRAGR_CAISSES_CHOICES",
    "ACCOUNT_TYPE_LABELS",
    "register_2fa_session",
    "deliver_2fa_response",
    "is_2fa_session_cancelled",
    "unregister_2fa_session",
    "_TWOFA_SESSIONS",
    "_TWOFA_LOCK",
]
