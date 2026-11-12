"""Une récurrence existante ne prend une opération que si elle vient du même marchand : le montant seul ne suffit pas.
Avant, un passage chez le médecin à 10 € était rattaché à l'« Offre Essentiel » à 10 € et classé en charge fixe."""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, GlobalConfig, RecurrenceTemplate, Transaction
from app.services import stats_cache
from app.services.autopilot_service import process_incoming_batch, set_autopilot_enabled
from app.services.recurrence_detector import process_recurrence_promotions

TODAY = date.today()


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    try:
        yield session
    finally:
        stats_cache.invalidate()
        session.close()


def _account(db):
    acc = Account(name="Compte courant", type="Compte courant", initial_balance=1000.0)
    db.add(acc)
    db.add(GlobalConfig(key="auto_promote_recurrences", value="true"))
    db.commit()
    return acc


def _bank_line(db, acc, days_ago, amount, raw, name, tx_type="expense_var", recurrence_id=None, n=[0]):
    n[0] += 1
    d = TODAY - timedelta(days=days_ago)
    tx = Transaction(date_saisie=d, date_operation=d, description=name, raw_description=raw, amount=amount,
                     type=tx_type, from_account_id=acc.id, reconciliation_date=d, csv_id=f"woob_sm_{n[0]}",
                     recurrence_id=recurrence_id)
    db.add(tx)
    db.commit()
    return tx


def _template(db, acc, name, amount):
    tpl = RecurrenceTemplate(description=name, amount=amount, type="expense_fixed", category="Frais bancaires",
                             frequency="Monthly", day_of_month=16, from_account_id=acc.id, is_closed=False)
    db.add(tpl)
    db.commit()
    return tpl


def test_a_doctor_is_not_taken_by_the_bank_fee_of_the_same_amount(db):
    acc = _account(db)
    fee = _template(db, acc, "Offre Essentiel", 10.0)
    _bank_line(db, acc, 30, 10.0, "Offre Essentiel", "Offre Essentiel", "expense_fixed", fee.id)
    doctor = _bank_line(db, acc, 10, 10.0, "X1234 DR MARTIN LYON", "Dr Martin")
    tax = _bank_line(db, acc, 20, 10.0, "DIRECTION GENERALE DES FINANCES", "Impôts (DGFiP)")
    process_recurrence_promotions(db, acc.id)
    for tx in (doctor, tax):
        db.refresh(tx)
        assert tx.recurrence_id is None and tx.type == "expense_var"


def test_a_template_without_bank_line_is_matched_on_its_name(db):
    acc = _account(db)
    _template(db, acc, "Free Telecom", 49.99)
    plugin = _bank_line(db, acc, 15, 49.99, "PayPal Europe S.a.r.l. et Cie S.", "Plugin audio")
    transfer = _bank_line(db, acc, 14, 49.99, "Wero vers LUCAS B", "Wero vers Lucas")
    process_recurrence_promotions(db, acc.id)
    for tx in (plugin, transfer):
        db.refresh(tx)
        assert tx.recurrence_id is None and tx.type == "expense_var"


def test_the_same_merchant_still_joins_its_template(db):
    acc = _account(db)
    fee = _template(db, acc, "Frais de tenue de compte", 10.0)  # nom choisi par l'utilisateur, autre que la banque
    _bank_line(db, acc, 60, 10.0, "Offre Essentiel", "Frais de tenue de compte", "expense_fixed", fee.id)
    again = _bank_line(db, acc, 30, 10.0, "Offre Essentiel", "Offre Essentiel")
    process_recurrence_promotions(db, acc.id)
    db.refresh(again)
    assert again.recurrence_id == fee.id and again.type == "expense_fixed"


def _line(acc, days_ago, amount, label, n, coming=False):
    d = TODAY - timedelta(days=days_ago)
    return {"date": d.isoformat(), "amount": abs(amount), "raw_amount": amount, "description": label,
            "raw_description": label, "csv_id": f"woob_{'coming_' if coming else ''}sm_{n}", "account_id": acc.id,
            "account_name": acc.name, "is_reconciled": False, "already_reconciled": False, "matched_db_id": None,
            **({"is_coming": True} if coming else {})}


def test_a_bank_announced_debit_from_another_merchant_is_not_the_next_instalment(db):
    set_autopilot_enabled(db, True, preset="full")
    acc = Account(name="Compte courant", type="Compte courant", initial_balance=0)
    db.add(acc)
    db.commit()
    preview = {"connection_id": 1, "accounts": [{"account_id": acc.id, "account_name": acc.name, "transactions": [
        _line(acc, 29, -46.79, "ORANGE SA-ORANGE", 1),
        _line(acc, -2, -46.79, "SURAVENIR", 2, coming=True),   # même montant, autre marchand
    ]}]}
    process_incoming_batch(db, conn_id=1, preview_data=preview)
    tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.amount == 46.79).one()
    announced = db.query(Transaction).filter(Transaction.csv_id == "woob_coming_sm_2").one()
    assert announced.recurrence_id != tpl.id
