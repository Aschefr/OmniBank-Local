"""Une opération sans date de saisie ne doit pas faire échouer tout l'export CSV."""
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import get_engine
from app.main import app
from app.models import Transaction
from app.profile_manager import create_profile, delete_profile, set_active_profile


@pytest.fixture
def client():
    prof = create_profile(name="ExportEntryDateTest")
    set_active_profile(prof["id"])
    yield TestClient(app), prof["id"]
    set_active_profile("default")
    delete_profile(prof["id"])


def test_export_uses_operation_date_when_entry_date_is_missing(client):
    http, profile_id = client
    session = sessionmaker(bind=get_engine(profile_id))()
    session.add(Transaction(date_saisie=None, date_operation=date(2026, 3, 15), description="Sans saisie", amount=-5.0, type="expense"))
    session.commit()
    session.close()

    res = http.get("/api/csv/export")

    assert res.status_code == 200
    line = next(l for l in res.text.splitlines() if "Sans saisie" in l)
    # Une date vide ferait ignorer la ligne à la réimportation
    assert line.startswith("15/03/2026;15/03/2026;")


def test_new_transaction_gets_an_entry_date(client):
    http, _ = client
    res = http.post("/api/transactions/", json={"date_operation": "2026-03-15", "description": "Sans saisie", "amount": -5.0, "type": "expense"})

    assert res.status_code == 200
    assert res.json()["date_saisie"] == date.today().isoformat()
