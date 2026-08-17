# app/services/diagnostic_service.py
"""
Diagnostic and privacy-preserving error reporting service for OmniBank Local.
Maintains an in-memory ring buffer of logs and exceptions, gathers anonymous
system/environment metadata, and strictly sanitizes all output for public GitHub issues.
"""

import os
import sys
import platform
import sqlite3
import logging
import re
import traceback
from datetime import datetime, timezone
from collections import deque
from typing import Dict, Any, List

# In-memory circular buffer for backend logs (keeps last 50 entries in RAM)
LOG_BUFFER: deque = deque(maxlen=50)
EXCEPTION_BUFFER: deque = deque(maxlen=20)


class DiagnosticLogHandler(logging.Handler):
    """Logging handler that captures WARNING, ERROR, and critical logs into memory."""
    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            entry = {
                "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
                "level": record.levelname,
                "logger": record.name,
                "message": msg
            }
            LOG_BUFFER.append(entry)
        except Exception:
            pass


def sanitize_text(text: str) -> str:
    """
    Sanitizes sensitive information from text:
    - Replaces user home directories (e.g. C:\\Users\\Name or /home/name) with ~/app/
    - Masks potential emails with [EMAIL]
    - Masks potential IPv4/IPv6 with [IP]
    - Masks IBANs with [IBAN_ANONYMIZED]
    - Masks passwords/tokens with ***
    - Masks potential numeric currency amounts with [AMOUNT]
    """
    if not text or not isinstance(text, str):
        return ""

    sanitized = text

    # 1. Mask User Home Directory paths
    # Windows: C:\Users\Username\... -> ~/app/...
    sanitized = re.sub(r'[A-Za-z]:\\Users\\[^\\]+\\', r'~/app/', sanitized, flags=re.IGNORECASE)
    # Windows forward slash variant: C:/Users/Username/... -> ~/app/...
    sanitized = re.sub(r'[A-Za-z]:/Users/[^/]+/', r'~/app/', sanitized, flags=re.IGNORECASE)
    # Unix / Linux / macOS: /home/username/... or /Users/username/... -> ~/app/...
    sanitized = re.sub(r'/(?:home|Users)/[^/]+/', r'~/app/', sanitized)
    # Normalize backslashes inside ~/app/ paths
    sanitized = re.sub(r'(~/app/[^\s\n\'"<>()]+)', lambda m: m.group(1).replace('\\', '/'), sanitized)

    # 2. Mask Emails
    sanitized = re.sub(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', r'[EMAIL]', sanitized)

    # 3. Mask IP addresses (IPv4)
    sanitized = re.sub(r'\b(?:\d{1,3}\.){3}\d{1,3}\b', r'[IP]', sanitized)

    # 4. Mask IBANs
    sanitized = re.sub(r'\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b', r'[IBAN_ANONYMIZED]', sanitized)

    # 5. Mask Passwords / Keys / Tokens in query strings or JSON
    sanitized = re.sub(r'(?i)(password|master_password|secret|token|api_key|auth)=[^&\s]+', r'\1=***', sanitized)
    sanitized = re.sub(r'(?i)"(password|master_password|secret|token|api_key|auth)"\s*:\s*"[^"]+"', r'"\1": "***"', sanitized)

    return sanitized


def record_backend_exception(exc: Exception, context: str = ""):
    """Stores an uncaught exception in the in-memory buffer."""
    try:
        tb_str = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
        entry = {
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            "type": exc.__class__.__name__,
            "message": sanitize_text(str(exc)),
            "context": sanitize_text(context),
            "traceback": sanitize_text(tb_str)
        }
        EXCEPTION_BUFFER.append(entry)
    except Exception:
        pass


def get_system_diagnostics(db_session=None) -> Dict[str, Any]:
    """Collects anonymous, non-sensitive system and environment metrics."""
    from app.database import DATA_DIR

    # Application version
    app_version = "1.0.84"
    try:
        import json
        pkg_path = os.path.join(os.path.abspath('.'), 'package.json')
        if os.path.exists(pkg_path):
            with open(pkg_path, 'r', encoding='utf-8') as f:
                app_version = json.load(f).get('version', app_version)
    except Exception:
        pass

    # Execution Mode Detection
    exec_mode = "Local Python (Uvicorn)"
    if os.path.exists('/.dockerenv'):
        exec_mode = "Docker Container"
    elif getattr(sys, 'frozen', False):
        exec_mode = "Desktop Native (Tauri Bundle)"

    # Woob Bank Backend Availability
    woob_available = False
    woob_version = "None"
    try:
        import woob
        woob_available = True
        woob_version = getattr(woob, '__version__', 'Installed')
    except ImportError:
        pass

    # Database Metrics
    db_size_mb = 0.0
    account_count = 0
    tx_count_range = "0"
    is_org_mode = False
    is_ai_enabled = False
    is_bank_sync_enabled = False

    try:
        db_path = os.path.join(DATA_DIR, "bank.db")
        if os.path.exists(db_path):
            db_size_mb = round(os.path.getsize(db_path) / (1024 * 1024), 2)
    except Exception:
        pass

    if db_session:
        try:
            from app.models import Account, Transaction, GlobalConfig
            account_count = db_session.query(Account).count()
            tx_count = db_session.query(Transaction).count()
            if tx_count < 100:
                tx_count_range = "< 100"
            elif tx_count < 1000:
                tx_count_range = "100 - 1,000"
            elif tx_count < 10000:
                tx_count_range = "1,000 - 10,000"
            else:
                tx_count_range = "> 10,000"

            org_cfg = db_session.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
            if org_cfg and org_cfg.value == "true":
                is_org_mode = True

            ai_cfg = db_session.query(GlobalConfig).filter(GlobalConfig.key == "enable_ai").first()
            if ai_cfg and ai_cfg.value == "true":
                is_ai_enabled = True

            from app.models import BankConnection
            conn_count = db_session.query(BankConnection).count()
            if conn_count > 0:
                is_bank_sync_enabled = True
        except Exception:
            pass

    return {
        "app_version": app_version,
        "execution_mode": exec_mode,
        "os_name": platform.system(),
        "os_release": platform.release(),
        "os_version": platform.version(),
        "architecture": platform.machine(),
        "python_version": platform.python_version(),
        "sqlite_version": sqlite3.sqlite_version,
        "database_size_mb": db_size_mb,
        "account_count": account_count,
        "transaction_volume": tx_count_range,
        "features": {
            "ai_ollama": is_ai_enabled,
            "bank_sync_woob": is_bank_sync_enabled,
            "woob_installed": woob_available,
            "woob_version": woob_version,
            "org_mode": is_org_mode
        }
    }


def get_diagnostic_report(db_session=None) -> Dict[str, Any]:
    """Produces the complete sanitized diagnostic report payload."""
    system_info = get_system_diagnostics(db_session)
    
    # Sanitize logs before returning
    sanitized_logs: List[Dict[str, Any]] = []
    for log in list(LOG_BUFFER):
        sanitized_logs.append({
            "timestamp": log.get("timestamp"),
            "level": log.get("level"),
            "logger": log.get("logger"),
            "message": sanitize_text(log.get("message", ""))
        })

    # Sanitize exceptions before returning
    sanitized_exceptions: List[Dict[str, Any]] = []
    for exc in list(EXCEPTION_BUFFER):
        sanitized_exceptions.append({
            "timestamp": exc.get("timestamp"),
            "type": exc.get("type"),
            "message": sanitize_text(exc.get("message", "")),
            "context": sanitize_text(exc.get("context", "")),
            "traceback": sanitize_text(exc.get("traceback", ""))
        })

    return {
        "system_info": system_info,
        "recent_logs": sanitized_logs,
        "recent_exceptions": sanitized_exceptions,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    }


def clear_diagnostic_buffers():
    """Clears in-memory log and exception buffers."""
    LOG_BUFFER.clear()
    EXCEPTION_BUFFER.clear()
