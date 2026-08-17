# tests/test_diagnostics.py
"""
Unit and integration tests for the privacy-preserving diagnostic service and router.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.diagnostic_service import (
    sanitize_text,
    record_backend_exception,
    get_diagnostic_report,
    clear_diagnostic_buffers,
    LOG_BUFFER,
    EXCEPTION_BUFFER
)

client = TestClient(app)


def test_sanitize_text_paths():
    """Verify that user home directory paths are sanitized to ~/app/."""
    win_path = r"Error reading file at C:\Users\Adminlocal\OmniBank\bank.db"
    assert sanitize_text(win_path) == "Error reading file at ~/app/OmniBank/bank.db"

    win_slash = "File not found: D:/Users/Aschefr/AppData/Local/OmniBank"
    assert sanitize_text(win_slash) == "File not found: ~/app/AppData/Local/OmniBank"

    unix_path = "Failed to open /home/ubuntu/config.json"
    assert sanitize_text(unix_path) == "Failed to open ~/app/config.json"


def test_sanitize_text_private_data():
    """Verify that emails, IPs, IBANs, and passwords are fully masked."""
    raw_text = "User contact: alice.finance@gmail.com on host 192.168.1.100 with IBAN FR7630006000011234567890189 and password=MySecretPass123"
    sanitized = sanitize_text(raw_text)

    assert "[EMAIL]" in sanitized
    assert "alice.finance@gmail.com" not in sanitized

    assert "[IP]" in sanitized
    assert "192.168.1.100" not in sanitized

    assert "[IBAN_ANONYMIZED]" in sanitized
    assert "FR7630006000011234567890189" not in sanitized

    assert "password=***" in sanitized
    assert "MySecretPass123" not in sanitized


def test_record_backend_exception():
    """Verify that backend exceptions are captured into memory buffer and sanitized."""
    clear_diagnostic_buffers()
    try:
        raise ValueError(r"Invalid directory C:\Users\Adminlocal\secret_data")
    except Exception as exc:
        record_backend_exception(exc, context="Testing exception recording")

    assert len(EXCEPTION_BUFFER) == 1
    recorded = EXCEPTION_BUFFER[0]
    assert recorded["type"] == "ValueError"
    assert "C:\\Users\\Adminlocal" not in recorded["message"]
    assert "~/app/" in recorded["message"]
    assert recorded["context"] == "Testing exception recording"


def test_diagnostic_report_api():
    """Verify the /api/diagnostics/report endpoint."""
    response = client.get("/api/diagnostics/report")
    assert response.status_code == 200
    data = response.json()

    assert "system_info" in data
    assert "recent_logs" in data
    assert "recent_exceptions" in data
    assert "generated_at" in data

    sys_info = data["system_info"]
    assert "app_version" in sys_info
    assert "os_name" in sys_info
    assert "python_version" in sys_info
    assert "sqlite_version" in sys_info
    assert "features" in sys_info


def test_clear_diagnostics_api():
    """Verify the /api/diagnostics/clear endpoint."""
    # Add a mock exception
    try:
        raise RuntimeError("Sample test error")
    except Exception as e:
        record_backend_exception(e)

    assert len(EXCEPTION_BUFFER) >= 1

    # Clear buffers via API
    res = client.post("/api/diagnostics/clear")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    assert len(LOG_BUFFER) == 0
    assert len(EXCEPTION_BUFFER) == 0
