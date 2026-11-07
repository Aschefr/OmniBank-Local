"""Une correction ajuste les opérations encore à vérifier ; une prévision déjà vue à la banque ne se propose pas sur le
seul montant à une opération sans rapport."""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Category, GlobalConfig, RecurrenceTemplate, Transaction
from app.services import stats_cache
from app.services.autopilot_service import find_candidate_forecasts_for_tx, update_review_transaction


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    s.add(GlobalConfig(key="enable_ai", value="false"))
    s.add(Account(id=1, name="Compte courant", type="Compte courant", initial_balance=0))
    s.add_all([Category(name="Shopping", type="expense_var"), Category(name="Dépenses diverses", type="expense_var"),
               Category(name="Courses", type="expense_var")])
    s.commit()
    stats_cache.invalidate()
    yield s
    s.close()


def _review(db, raw, category, desc=None, days=3, amount=20.0):
    d = date.today() - timedelta(days=days)
    tx = Transaction(description=desc or raw.title(), raw_description=raw, amount=amount, type="expense_var",
                     category=category, date_operation=d, reconciliation_date=d, from_account_id=1,
                     needs_review=True, confidence_score=80.0, csv_id=f"woob_{raw}_{days}")
    db.add(tx)
    db.commit()
    return tx


def test_a_correction_adjusts_similar_items_still_to_check(db):
    corrected = _review(db, "AMAZON EU SARL, SUCCURSALE FRANC", "Shopping", days=1)
    other = _review(db, "AMAZON PAYMENTS EUROPE S C A", "Shopping", days=4)
    untouched = _review(db, "X1234 UEP*ALIM SUPER U VIL", "Courses", desc="Super U", days=5)

    res = update_review_transaction(db, corrected.id, description="Achat sur Amazon", category="Amazon", learn_rule=True)

    db.refresh(other)
    db.refresh(untouched)
    assert res["propagated"] == 1
    assert other.category == "Amazon" and other.needs_review is True   # meilleure suggestion, toujours à vérifier
    assert untouched.category == "Courses"


def test_same_bank_label_takes_the_corrected_name_too(db):
    first = _review(db, "PRLV SEPA ACME FITNESS", "Dépenses diverses", days=2)
    second = _review(db, "PRLV SEPA ACME FITNESS", "Dépenses diverses", days=32)

    update_review_transaction(db, first.id, description="Salle de sport", category="Sport", learn_rule=True)

    db.refresh(second)
    assert (second.category, second.description) == ("Sport", "Salle de sport")
    assert second.needs_review is True


def test_one_paypal_purchase_does_not_decide_the_others(db):
    first = _review(db, "PayPal Europe S.a.r.l. et Cie S.", "Dépenses diverses", days=2, amount=0.99)
    second = _review(db, "PayPal Europe S.a.r.l. et Cie S.", "Dépenses diverses", days=5, amount=49.99)

    res = update_review_transaction(db, first.id, description="Apple", category="Abonnement loisir", learn_rule=True)

    db.refresh(second)
    assert res["propagated"] == 0 and second.category == "Dépenses diverses"


def test_a_forecast_seen_at_the_bank_is_not_offered_on_amount_alone(db):
    tpl = RecurrenceTemplate(description="Offre Essentiel", amount=10.0, type="expense_fixed", category="Frais bancaires",
                             frequency="Monthly", day_of_month=16, from_account_id=1)
    db.add(tpl)
    db.flush()
    past = date.today() - timedelta(days=20)
    db.add(Transaction(description="Offre Essentiel", raw_description="Offre Essentiel", amount=10.0, type="expense_fixed",
                       category="Frais bancaires", date_operation=past, reconciliation_date=past, from_account_id=1,
                       recurrence_id=tpl.id, csv_id="woob_offre"))
    db.add(Transaction(description="Offre Essentiel", amount=10.0, type="expense_fixed", category="Frais bancaires",
                       date_operation=date.today() + timedelta(days=5), from_account_id=1, recurrence_id=tpl.id))
    planned = Transaction(description="Loyer", amount=650.0, type="expense_fixed", category="Logement",
                          date_operation=date.today() + timedelta(days=2), from_account_id=1)
    db.add(planned)
    db.commit()

    doctor = _review(db, "X1234 DR MARTIN MEDECIN", "Santé", amount=10.0, days=1)
    rent = _review(db, "PRLV SEPA SCI DES LILAS", "Dépenses diverses", amount=650.0, days=1)

    assert find_candidate_forecasts_for_tx(db, doctor) == []
    # Une prévision saisie à la main, sans libellé bancaire connu, se propose toujours au même montant
    assert [c["description"] for c in find_candidate_forecasts_for_tx(db, rent)] == ["Loyer"]


def test_amazon_rows_with_the_same_label_follow_a_merchant_named_category(db):
    first = _review(db, "AMAZON PAYMENTS EUROPE S C A", "Shopping", days=2, amount=36.88)
    second = _review(db, "AMAZON PAYMENTS EUROPE S C A", "Shopping", days=3, amount=34.89)

    res = update_review_transaction(db, first.id, description="Achat sur Amazon", category="Amazon", learn_rule=True)

    db.refresh(second)
    assert res["propagated"] == 1
    assert (second.category, second.description, second.needs_review) == ("Amazon", "Achat sur Amazon", True)
