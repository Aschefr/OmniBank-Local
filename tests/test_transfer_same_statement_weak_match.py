"""
Virement interne dont les deux côtés arrivent dans le même relevé, quand l'un d'eux ne trouve en base qu'une
correspondance faible : un revenu prévu du même montant quelques jours plus tard, sans rapport. Avant, cette
correspondance (score < 60) laissait la sortie du livret en attente : elle n'était jamais créée, donc jamais réunie
à l'entrée du compte courant, qui restait un revenu et décalait le solde du livret. Données inventées.
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, BankConnection, Category, GlobalConfig, Transaction
from app.services import stats_cache
from app.services.autopilot_service import process_incoming_batch
from app.services.bank_sync.pending_store import clear_all_pending_sync

DAY = date.today() - timedelta(days=1)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add_all([
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="auto_reconcile_transactions", value="true"),
        GlobalConfig(key="auto_commit_incoming_transactions", value="true"),
        GlobalConfig(key="auto_reconcile_threshold", value="85.0"),
        Category(name="Virement interne", type="transfer"),
        Category(name="Aide famille", type="income"),
        Category(name="Banque", type="income"),
        BankConnection(id=1, backend="cragr", label="Banque inventée", is_active=True),
        Account(id=1, name="Compte Courant", initial_balance=100.0),
        Account(id=2, name="Livret A", initial_balance=5000.0),
    ])
    session.commit()
    clear_all_pending_sync(session)
    yield session
    clear_all_pending_sync(session)
    session.close()


def _line(desc, amount, csv_id, day=DAY):
    return {"date_operation": day.isoformat(), "description": desc, "raw_description": desc,
            "amount": abs(amount), "raw_amount": amount, "csv_id": csv_id, "is_coming": False, "is_reconciled": False}


def _statement(courant_lines, livret_lines):
    return {"accounts": [
        {"account_id": 1, "account_name": "Compte Courant", "transactions": courant_lines},
        {"account_id": 2, "account_name": "Livret A", "transactions": livret_lines},
    ]}


def test_both_sides_in_statement_become_one_transfer_despite_weak_forecast(db):
    forecast = Transaction(date_operation=DAY + timedelta(days=9), description="Aide de Camille", amount=150.0,
                           type="income", category="Aide famille", to_account_id=1)
    db.add(forecast)
    db.commit()

    process_incoming_batch(db, conn_id=1, preview_data=_statement(
        [_line("Pour eviter le decouvert M.", 150.0, "woob_test_courant_150")],
        [_line("WEB M. DUPONT JEAN Pour evit", -150.0, "woob_test_livret_150")],
    ))

    rows = db.query(Transaction).filter(Transaction.id != forecast.id).all()
    assert len(rows) == 1, [(r.description, r.type, r.amount) for r in rows]
    tr = rows[0]
    assert tr.type == "transfer"
    assert (tr.from_account_id, tr.to_account_id) == (2, 1)
    assert tr.amount == 150.0
    assert tr.reconciliation_date is not None
    # Le revenu prévu sans rapport n'est pas touché
    db.refresh(forecast)
    assert forecast.reconciliation_date is None and forecast.type == "income" and forecast.to_account_id == 1


def test_planned_transfer_confirmed_by_the_bank_is_kept(db):
    """Un virement prévu que la banque confirme reste rapproché : pas de second virement en double."""
    planned = Transaction(date_operation=DAY, description="Economie", amount=250.0, type="transfer",
                          category="Virement interne", from_account_id=1, to_account_id=2)
    db.add(planned)
    db.commit()

    process_incoming_batch(db, conn_id=1, preview_data=_statement(
        [_line("VIR WEB VERS LIVRET A Economie", -250.0, "woob_test_courant_250")],
        [_line("VIR WEB DE COMPTE COURANT Economie", 250.0, "woob_test_livret_250")],
    ))

    rows = db.query(Transaction).all()
    assert len(rows) == 1, [(r.description, r.type, r.amount) for r in rows]
    assert rows[0].id == planned.id
    assert rows[0].reconciliation_date is not None


def test_late_side_turns_income_into_transfer_with_transfer_category(db):
    """L'entrée est déjà enregistrée en revenu « Banque » ; la sortie du livret arrive au relevé suivant :
    l'opération devient un virement, rangé dans une catégorie de virement, pas dans « Banque »."""
    income = Transaction(date_operation=DAY, description="Pour Eviter Le Decouvert M", amount=150.0, type="income",
                         category="Banque", to_account_id=1, reconciliation_date=DAY, csv_id="woob_test_courant_150")
    db.add(income)
    db.commit()

    process_incoming_batch(db, conn_id=1, preview_data=_statement(
        [], [_line("WEB M. DUPONT JEAN Pour evit", -150.0, "woob_test_livret_150")]))

    rows = db.query(Transaction).all()
    assert len(rows) == 1
    db.refresh(income)
    assert income.type == "transfer"
    assert (income.from_account_id, income.to_account_id) == (2, 1)
    assert income.category == "Virement interne"


def test_late_side_keeps_a_custom_transfer_category(db):
    db.add(Category(name="Transfert", type="transfer"))
    out = Transaction(date_operation=DAY, description="Economie", amount=80.0, type="transfer",
                      category="Transfert", from_account_id=1, reconciliation_date=DAY, csv_id="woob_test_courant_80")
    db.add(out)
    db.commit()

    process_incoming_batch(db, conn_id=1, preview_data=_statement(
        [], [_line("VIR DE COMPTE COURANT Economie", 80.0, "woob_test_livret_80")]))

    db.refresh(out)
    assert (out.from_account_id, out.to_account_id) == (1, 2)
    assert out.category == "Transfert"
