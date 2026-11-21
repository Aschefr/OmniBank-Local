"""
Plusieurs prévisions d'un même créancier dont les montants changent ensemble (les assurances d'une banque, sous un
seul libellé, augmentées de quelques pour cent) : chaque ligne prend la prévision au montant le plus proche.
La prévision suggérée pour une ligne à vérifier suit la même logique.
"""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, GlobalConfig, RecurrenceTemplate, Transaction
from app.services import stats_cache
from app.services.autopilot_service import find_candidate_forecasts_for_tx
from app.services.reconciliation_engine import (
    check_reconciliation, reserve_deviant_matches, reserve_exact_amount_matches,
)

OLD_LABEL = "0123456 MUTUELLE DU NORD"
NEW_LABEL = "0765432 MUTUELLE DU NORD"
BANK_DAY = date(2026, 11, 23)
# nom, montant prévu, jour du mois
CONTRACTS = [
    ("Assurance - Habitation", 48.00, 22),
    ("Assurance - Acc. de la vie", 22.50, 22),
    ("Assurance - Prot. juridique", 8.00, 22),
    ("Assurance - Auto", 68.00, 25),
]


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add_all([
        Account(id=1, name="Courant", type="Compte courant", initial_balance=1000.0),
        GlobalConfig(key="auto_link_deviant_recurrences", value="true"),
    ])
    session.commit()
    yield session
    session.close()


@pytest.fixture
def forecasts(db):
    """Chaque contrat : un débit d'octobre pointé sous l'ancien libellé, et la prévision de novembre."""
    out = {}
    for name, amount, day in CONTRACTS:
        tpl = RecurrenceTemplate(description=name, amount=amount, type="expense_fixed", category="Assurance",
                                 frequency="Monthly", day_of_month=day, from_account_id=1)
        db.add(tpl)
        db.flush()
        db.add(Transaction(description=name, amount=amount, type="expense_fixed", category="Assurance",
                           date_operation=date(2026, 10, day), from_account_id=1, recurrence_id=tpl.id,
                           reconciliation_date=date(2026, 10, day), raw_description=OLD_LABEL,
                           csv_id=f"woob_bank_0001_oct{tpl.id}"))
        forecast = Transaction(description=name, amount=amount, type="expense_fixed", category="Assurance",
                               date_operation=date(2026, 11, day), from_account_id=1, recurrence_id=tpl.id)
        db.add(forecast)
        db.flush()
        out[amount] = forecast
    db.commit()
    return out


def _statement(db, amounts):
    lines = [{"date_operation": BANK_DAY.isoformat(), "raw_amount": -a, "raw_description": NEW_LABEL,
              "csv_id": f"woob_coming_bank_0001_{i}"} for i, a in enumerate(amounts)]
    results, matched = [None] * len(lines), set()
    reserve_exact_amount_matches(db, lines, results, matched, 1, is_coming=True)
    reserve_deviant_matches(db, lines, results, matched, 1, is_coming=True)
    return results


def test_each_insurance_takes_the_forecast_with_the_closest_amount(db, forecasts):
    # Hausse de 3 à 6 % sur chaque contrat, lignes dans l'ordre où la banque les donne
    results = _statement(db, [70.90, 8.40, 50.70, 23.10])
    linked = [db.get(Transaction, r["id"]).amount if r else None for r in results]
    assert linked == [68.00, 8.00, 48.00, 22.50]
    assert all(r["auto_committed"] for r in results)


def test_closest_amount_wins_for_a_single_line(db, forecasts):
    rec = check_reconciliation(db, BANK_DAY, -70.90, account_id=1, is_coming=True, bank_label=NEW_LABEL,
                               csv_id="woob_coming_bank_0001_x")
    assert db.get(Transaction, rec["id"]).amount == 68.00


def test_two_lines_aiming_at_the_same_forecast_leave_it_to_the_closest(db, forecasts):
    # 50.70 et 60.00 visent toutes deux l'Auto (68) ou l'Habitation (48) : 50.70 garde l'Habitation
    results = _statement(db, [60.00, 50.70])
    assert db.get(Transaction, results[1]["id"]).amount == 48.00
    assert db.get(Transaction, results[0]["id"]).amount == 68.00


def _review_line(db, amount):
    tx = Transaction(description="Assurance Mutuelle", amount=amount, type="expense_fixed", category="Assurance",
                     date_operation=BANK_DAY, from_account_id=1, raw_description=NEW_LABEL, needs_review=True,
                     csv_id="woob_coming_bank_0001_review")
    db.add(tx)
    db.commit()
    return tx


def test_suggestion_prefers_a_forecast_already_debited_under_this_bank_label(db, forecasts):
    # Frais de tenue de compte de la même banque, jamais débités sous ce libellé, plus proches en euros
    db.add(Transaction(description="Cotisation Compte Mutuelle du Nord", amount=16.00, type="expense_fixed",
                       category="Frais de compte", date_operation=date(2026, 11, 4), from_account_id=1))
    db.commit()
    for amount in (48.00, 22.50, 68.00):
        forecasts[amount].reconciliation_date = BANK_DAY  # déjà pris par leurs lignes
    db.commit()
    candidates = find_candidate_forecasts_for_tx(db, _review_line(db, 23.10))
    assert candidates[0]["description"] == "Assurance - Prot. juridique"


def test_suggestion_skips_skipped_forecasts_and_forecasts_held_by_another_bank_line(db, forecasts):
    forecasts[22.50].is_skipped = True
    forecasts[48.00].csv_id = "woob_coming_bank_0001_other"
    db.commit()
    names = [c["description"] for c in find_candidate_forecasts_for_tx(db, _review_line(db, 23.10))]
    assert "Assurance - Acc. de la vie" not in names
    assert "Assurance - Habitation" not in names
