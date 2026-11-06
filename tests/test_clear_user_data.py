"""« Vider la base » : tout ce qui vient des données part, les réglages et les connexions bancaires restent,
et l'association des connexions aux comptes est effacée (SQLite réutilise les numéros des comptes supprimés)."""
import json
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account, ActionHistory, BankConnection, BankLabelMapping, GlobalConfig, Notification, Transaction,
)
from app.services.data_reset import clear_user_data


def _db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine)()


def test_clear_keeps_settings_and_bank_credentials_but_drops_data_and_links():
    db = _db()
    acc = Account(name="Compte de Dépôt", type="Compte courant", initial_balance=10)
    db.add(acc)
    db.flush()
    db.add_all([
        Transaction(description="CB TEST", amount=5, type="expense_var", date_operation=date(2026, 11, 1), from_account_id=acc.id),
        BankConnection(backend="cragr", label="Crédit Agricole", account_mapping=json.dumps({"0411": acc.id}),
                       last_sync_status="success", last_sync_count=12),
        BankLabelMapping(raw_pattern="TEST", clean_description="Test", category="Divers"),
        Notification(type="system", title="t", content="m"),
        ActionHistory(entity_type="account", entity_id=acc.id, action_type="CREATE"),
        GlobalConfig(key="main_account_id", value=str(acc.id)),
        GlobalConfig(key="ollama_model", value="bonsai-2:27b"),
        GlobalConfig(key="bank_vault_1_data", value="chiffré"),
    ])
    db.commit()

    clear_user_data(db)

    assert db.query(Account).count() == 0
    assert db.query(Transaction).count() == 0
    assert db.query(BankLabelMapping).count() == 0
    assert db.query(ActionHistory).count() == 0
    assert db.query(Notification).count() == 0
    keys = {c.key for c in db.query(GlobalConfig).all()}
    assert "main_account_id" not in keys
    assert {"ollama_model", "bank_vault_1_data"} <= keys
    conn = db.query(BankConnection).one()
    assert conn.label == "Crédit Agricole"
    assert not conn.account_mapping and conn.last_sync_status is None and conn.last_sync_count == 0

    # Le compte recréé reprend le numéro 1 : il ne doit hériter d'aucune association
    again = Account(name="Livret", type="Livret", initial_balance=0)
    db.add(again)
    db.commit()
    assert again.id == acc.id
    assert not db.query(BankConnection).one().account_mapping
