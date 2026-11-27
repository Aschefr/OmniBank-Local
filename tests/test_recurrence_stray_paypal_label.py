"""
Un achat payé par PayPal, rattaché par erreur à une récurrence de même montant puis renommé, ne doit pas faire de
« PayPal » le créancier de cette récurrence : sinon chaque paiement PayPal du même montant reprend sa prévision
suivante (un achat de 49,99 € rattaché à l'abonnement internet prélevé chaque mois). Une récurrence réellement payée
par PayPal garde son rattachement. Données inventées.
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, RecurrenceTemplate, Transaction
from app.services.bank_sync.import_engine import re_evaluate_preview_data
from app.services.reconciliation_engine import check_reconciliation

PAYPAL = "PayPal Europe S.a.r.l. et Cie S.C.A"
TODAY = date.today()


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    session.add(Account(id=1, name="Compte Courant", initial_balance=1000.0))
    session.commit()
    yield session
    session.close()


def _recurrence(db, rid, name, amount, category):
    db.add(RecurrenceTemplate(id=rid, description=name, amount=amount, type="expense_fixed", category=category,
                              frequency="Monthly", day_of_month=5, from_account_id=1))


def _row(db, rid, name, amount, day, raw=None, csv=None, reconciled=True, category="Box"):
    tx = Transaction(date_operation=day, description=name, raw_description=raw, amount=amount, type="expense_fixed",
                     category=category, from_account_id=1, recurrence_id=rid, csv_id=csv,
                     reconciliation_date=day if reconciled else None)
    db.add(tx)
    return tx


@pytest.fixture
def internet(db):
    _recurrence(db, 7, "Box Internet", 39.99, "Box")
    _row(db, 7, "Box Internet", 39.99, TODAY - timedelta(days=55), "PRLV SEPA OPERATEUR BOX", "woob_t_1_a1")
    _row(db, 7, "Box Internet", 39.99, TODAY - timedelta(days=25), "PRLV SEPA OPERATEUR BOX", "woob_t_1_a2")
    # Achat rattaché par erreur à la récurrence, puis renommé par l'utilisateur
    _row(db, 7, "Synthé virtuel - Plugin", 39.99, TODAY - timedelta(days=40), PAYPAL, "woob_t_1_a3", category="Musique")
    forecast = _row(db, 7, "Box Internet", 39.99, TODAY + timedelta(days=5), reconciled=False)
    db.commit()
    return forecast


def test_paypal_purchase_does_not_take_internet_forecast(db, internet):
    res = check_reconciliation(db, TODAY, -39.99, matched_ids=set(), account_id=1, is_coming=True,
                               bank_label=PAYPAL, csv_id="woob_coming_t_1_new")
    assert res is None or res.get("id") != internet.id, res


def test_internet_debit_still_takes_its_forecast(db, internet):
    res = check_reconciliation(db, TODAY + timedelta(days=5), -41.99, matched_ids=set(), account_id=1,
                               is_coming=False, bank_label="PRLV SEPA OPERATEUR BOX", csv_id="woob_t_1_new")
    assert res and res.get("id") == internet.id, res


def test_subscription_paid_by_paypal_keeps_its_link(db):
    _recurrence(db, 9, "Vidéo en ligne", 2.79, "Loisir")
    for k, amt in enumerate((2.73, 2.79)):
        _row(db, 9, "Vidéo en ligne", amt, TODAY - timedelta(days=60 - 30 * k), PAYPAL, f"woob_t_1_v{k}", category="Loisir")
    forecast = _row(db, 9, "Vidéo en ligne", 2.79, TODAY, reconciled=False, category="Loisir")
    db.commit()
    res = check_reconciliation(db, TODAY, -2.85, matched_ids=set(), account_id=1, is_coming=False,
                               bank_label=PAYPAL, csv_id="woob_t_1_v9")
    assert res and res.get("id") == forecast.id, res


def test_replay_drops_category_of_a_lost_match(db):
    # Ligne gardée d'un relevé où elle était rapprochée d'une prévision « Box » qui n'existe plus
    preview = {"accounts": [{"account_id": 1, "account_name": "Compte Courant", "transactions": [{
        "date_operation": TODAY.isoformat(), "description": PAYPAL, "raw_description": PAYPAL, "amount": 39.99,
        "raw_amount": -39.99, "csv_id": "woob_t_1_lost", "is_coming": False, "is_reconciled": True,
        "matched_db_id": 999, "category": "Box", "db_category": "Box", "type": "expense_fixed", "db_type": "expense_fixed",
    }]}]}
    out = re_evaluate_preview_data(db, preview)
    line = out["accounts"][0]["transactions"][0]
    assert not line["is_reconciled"]
    assert line.get("category") != "Box"
    assert line.get("type") != "expense_fixed"
