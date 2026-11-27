"""
Deux virements internes du même montant entre les mêmes comptes, à moins de 15 jours d'écart. Le second était pris
pour le pendant du premier, déjà pointé : ses deux lignes passaient pour des doublons et disparaissaient sans trace,
et les deux soldes s'écartaient de la banque. Données inventées.
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
from app.services.bank_sync.import_engine import re_evaluate_preview_data
from app.services.bank_sync.pending_store import clear_all_pending_sync

TODAY = date.today() - timedelta(days=1)
FIRST = TODAY - timedelta(days=11)
COURANT = "woob_cragr_00011122233"
LIVRET = "woob_cragr_00044455566"


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
        Category(name="Transfert", type="transfer"),
        BankConnection(id=1, backend="cragr", label="Banque inventée", is_active=True),
        Account(id=1, name="Compte Courant", initial_balance=1000.0),
        Account(id=2, name="Livret A", initial_balance=5000.0),
    ])
    # Premier virement, déjà pointé : il porte la ligne du compte courant ; celle du livret le retrouve comme pendant
    session.add(Transaction(id=50, date_operation=FIRST - timedelta(days=2), description="Epargne", amount=250.0,
                            type="transfer", category="Transfert", from_account_id=1, to_account_id=2,
                            reconciliation_date=FIRST, csv_id=f"{COURANT}_aaaaaaaaaaaa", raw_description="WEB DUPONT JEAN"))
    session.commit()
    clear_all_pending_sync(session)
    yield session
    clear_all_pending_sync(session)
    session.close()


def _line(desc, amount, csv_id, day):
    return {"date_operation": day.isoformat(), "description": desc, "raw_description": desc,
            "amount": abs(amount), "raw_amount": amount, "csv_id": csv_id, "is_coming": False, "is_reconciled": False}


def _run(db, courant_lines, livret_lines):
    preview = re_evaluate_preview_data(db, {"accounts": [
        {"account_id": 1, "account_name": "Compte Courant", "transactions": courant_lines},
        {"account_id": 2, "account_name": "Livret A", "transactions": livret_lines},
    ]})
    process_incoming_batch(db, conn_id=1, preview_data=preview)


def test_second_transfer_same_amount_is_kept_on_both_accounts(db):
    _run(db,
         [_line("WEB DUPONT JEAN", -250.0, f"{COURANT}_aaaaaaaaaaaa", FIRST),
          _line("WEB M. DUPONT JEAN Retour vac", -250.0, f"{COURANT}_bbbbbbbbbbbb", TODAY)],
         [_line("DE M. DUPONT JEAN", 250.0, f"{LIVRET}_cccccccccccc", FIRST),
          _line("Retour vacances M. DUPONT", 250.0, f"{LIVRET}_dddddddddddd", TODAY)])

    rows = db.query(Transaction).order_by(Transaction.id).all()
    assert len(rows) == 2, [(r.id, r.description, r.date_operation) for r in rows]
    new = rows[1]
    assert new.type == "transfer"
    assert (new.from_account_id, new.to_account_id) == (1, 2)
    assert new.date_operation == TODAY and new.reconciliation_date is not None


def test_late_mirror_of_one_transfer_still_recognised(db):
    # La ligne du livret arrive deux jours après celle du compte courant : c'est bien le même virement
    _run(db,
         [_line("WEB DUPONT JEAN", -250.0, f"{COURANT}_aaaaaaaaaaaa", FIRST)],
         [_line("DE M. DUPONT JEAN", 250.0, f"{LIVRET}_cccccccccccc", FIRST + timedelta(days=2))])

    assert db.query(Transaction).count() == 1
