"""
Un nom de ville présent dans les libellés de carte de tous les commerçants du village ne rapproche rien :
ni une règle (« X1234 LABO MORVANCE » n'est pas FreshMart), ni une prévision (« Maison Morvance 20 ans »).
Une prévision déjà rattachée à une autre ligne de la banque, au libellé sans rapport, n'est pas proposée non plus.
Valeurs inventées.
"""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, BankLabelMapping, Category, RecurrenceTemplate, Transaction
from app.services.autopilot_service import find_candidate_forecasts_for_tx
from app.services.reconciliation_engine import check_reconciliation
from app.services.smart_label.matcher import _compute_match_score
from app.services.smart_label.places import compute_place_words, shares_only_places
from app.services.smart_label.resolver import resolve_smart_label, resolve_smart_labels_batch

TOWN = frozenset({"MORVANCE"})


def test_town_shared_by_three_merchants_is_a_place():
    pairs = [
        ("X1234 FRESHMART MORVANCE", "FreshMart"),
        ("X1234 CAPI MODE MORVANCE", "Capi Mode"),
        ("X1234 BIGMARKET SUP MORVA", "BigMarket"),  # tronqué en fin de libellé
    ]
    assert "MORVANCE" in compute_place_words(pairs)


def test_town_kept_in_the_given_names_is_still_a_place():
    # Profil neuf : l'IA garde la ville dans le nom. La position la trahit : elle termine les libellés.
    pairs = [
        ("X1234 FRESHMART MORVANCE", "FreshMart Morvance"),
        ("X1234 CAPI MODE MORVANCE", "Capi Mode Morvance"),
        ("X1234 BIGMARKET SUP MORVA", "BigMarket"),
    ]
    places = compute_place_words(pairs)
    assert "MORVANCE" in places
    assert "FRESHMART" not in places and "BIGMARKET" not in places
    assert _compute_match_score("FRESHMART MORVANCE", "MORVANCE LABO MOR", places) == 0


def test_word_in_the_merchant_name_is_not_a_place():
    pairs = [
        ("X1234 BIGMARKET MORVANCE", "BigMarket"),
        ("X1234 BIGMARKET DRIVE", "BigMarket Drive"),
        ("PRLV BIGMARKET CARTE", "Carte BigMarket"),
    ]
    assert "BIGMARKET" not in compute_place_words(pairs)


def test_two_merchants_are_not_enough():
    pairs = [("X1234 FRESHMART MORVANCE", "FreshMart"), ("X1234 CAPI MODE MORVANCE", "Capi Mode")]
    assert compute_place_words(pairs) == frozenset()


def test_labels_sharing_only_the_town_do_not_match():
    assert shares_only_places("FRESHMART MORVANCE MORV", "LABO MORVANCE MOR", TOWN)
    assert _compute_match_score("FRESHMART MORVANCE MORV", "LABO MORVANCE MOR") > 0  # sans les lieux : le faux positif
    assert _compute_match_score("FRESHMART MORVANCE MORV", "LABO MORVANCE MOR", TOWN) == 0
    # Le même commerçant se reconnaît toujours
    assert _compute_match_score("FRESHMART MORVANCE MORV", "FRESHMART MORVANCE", TOWN) >= 0.75
    # Un libellé fait seulement de mots de lieu : rien pour en juger, score inchangé
    assert not shares_only_places("MORVANCE", "FRESHMART MORVANCE", TOWN)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    session.add_all([
        Account(id=1, name="Compte", currency="EUR", is_closed=False, type="Compte courant"),
        Category(name="Courses", type="expense_var"),
        Category(name="Habillement", type="expense_var"),
        Category(name="Prêt immobilier", type="expense_fixed"),
        RecurrenceTemplate(id=7, description="Maison Morvance 20 ans", amount=110.0, type="expense_fixed",
                           category="Prêt immobilier", day_of_month=15, from_account_id=1),
    ])
    history = [
        ("X1234 FRESHMART MORVANCE", "FreshMart", "Courses", 12.0, date(2026, 10, 2)),
        ("X1234 CAPI MODE MORVANCE", "Capi Mode", "Habillement", 23.0, date(2026, 10, 6)),
        ("X1234 BIGMARKET SUP MORVA", "BigMarket", "Courses", 31.0, date(2026, 10, 10)),
    ]
    for i, (raw, desc, cat, amt, d) in enumerate(history):
        session.add(Transaction(csv_id=f"woob_bank_{i}", raw_description=raw, description=desc, category=cat,
                                amount=amt, type="expense_var", from_account_id=1, date_operation=d,
                                reconciliation_date=d))
    session.add(BankLabelMapping(raw_pattern="FRESHMART MORVANCE MORV", clean_description="FreshMart",
                                 category="Courses", is_manual=True))
    # Échéance du prêt : déjà annoncée par la banque sous son propre libellé
    session.add(Transaction(id=500, csv_id="woob_coming_bank_loan", raw_description="0000123 ECHEANCE",
                            description="Maison Morvance 20 ans", category="Prêt immobilier", amount=110.0,
                            type="expense_fixed", from_account_id=1, date_operation=date(2026, 11, 15),
                            recurrence_id=7))
    session.commit()
    yield session
    session.close()


def test_rule_is_not_applied_on_the_town_alone(db):
    lab = "X1234 MORVANCE-LABO MOR"
    assert resolve_smart_label(db, lab, tx_type="expense_var").get("description") != "FreshMart"
    assert resolve_smart_labels_batch(db, [lab])[lab].get("description") != "FreshMart"
    assert resolve_smart_label(db, "X1234 FRESHMART MORVANCE MORV", tx_type="expense_var")["description"] == "FreshMart"


def test_loan_forecast_not_suggested_for_a_card_payment_in_town(db):
    lab = Transaction(id=900, csv_id="woob_coming_bank_lab", raw_description="X1234 MORVANCE-LABO MOR",
                      description="Laboratoire", category="Courses", amount=46.0, type="expense_var",
                      from_account_id=1, date_operation=date(2026, 11, 14), needs_review=True)
    db.add(lab)
    db.commit()
    assert find_candidate_forecasts_for_tx(db, lab) == []


def test_loan_forecast_not_auto_linked_to_a_card_payment_in_town(db):
    res = check_reconciliation(db, tx_date=date(2026, 11, 14), tx_amount=-46.0, account_id=1, is_coming=True,
                               bank_label="X1234 MORVANCE-LABO MOR", csv_id="woob_coming_bank_lab")
    assert not res or res.get("id") != 500


def test_forecast_tied_to_an_unrelated_bank_line_is_not_suggested(db):
    # Même sans nom de ville : la prévision porte déjà la ligne « 0000123 ECHEANCE »
    pay = Transaction(id=901, csv_id="woob_bank_pay", raw_description="X1234 MAISON DU PAIN", description="Maison du pain",
                      category="Courses", amount=95.0, type="expense_var", from_account_id=1,
                      date_operation=date(2026, 11, 14), needs_review=True)
    db.add(pay)
    db.commit()
    ids = [c["id"] for c in find_candidate_forecasts_for_tx(db, pay)]
    assert 500 not in ids
