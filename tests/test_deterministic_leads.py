"""Voie sans IA : noms lisibles, salaire reconnu d'après la paie déclarée, dépense fixe ou variable."""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Category, GlobalConfig
from app.services.bank_sync.declared_pay import expense_type_for, salary_category_for
from app.services.smart_label.normalization import display_name_from_label, normalize_raw_label


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


@pytest.mark.parametrize("raw,name", [
    ("X1234 UEP*ALIM SUPER U LYO", "Super U"),
    ("ORANGE SA-ORANGE", "Orange"),
    ("GC RE OCTOPUS ENERGY", "Octopus Energy"),
    ("PayPal Europe S.a.r.l. et Cie S.", "Paypal Europe"),
    ("AMAZON EU SARL, SUCCURSALE FRANC", "Amazon Eu"),
    ("ACME REINFORCEMENTS ACME REI", "Acme Reinforcements"),
    ("X1234 GOOGLE*GOOGLE ONE DU", "Google One"),
    ("Wero vers JEAN D", "Wero Vers Jean D"),
    ("MOREAU CLAIRE AB12CD34EF56GH78", "Moreau Claire"),
])
def test_display_name_without_ai(raw, name):
    assert display_name_from_label(raw) == name


def test_display_name_leaves_the_rule_key_alone():
    # normalize_raw_label sert de clé aux règles apprises : inchangée
    assert normalize_raw_label("ORANGE SA-ORANGE") == "ORANGE SA ORANGE"


def test_salary_is_recognised_from_the_declared_pay(db):
    db.add_all([GlobalConfig(key="base_pay_amount", value="2400.00"), GlobalConfig(key="base_pay_day", value="28")])
    db.commit()
    assert salary_category_for(db, 2487.68, date(2026, 10, 30)) == "Salaire"
    assert salary_category_for(db, 2487.68, date(2026, 11, 2)) == "Salaire"   # paie du 28 octobre, arrivée en retard
    assert salary_category_for(db, 150.0, date(2026, 10, 29)) is None          # trop loin du montant
    assert salary_category_for(db, 2400.0, date(2026, 10, 12)) is None         # trop loin du jour de paie
    db.add(Category(name="Salaire net", type="income"))
    db.commit()
    assert salary_category_for(db, 2400.0, date(2026, 10, 28)) == "Salaire net"


def test_no_declared_pay_no_salary_guess(db):
    assert salary_category_for(db, 2400.0, date(2026, 10, 28)) is None


def test_fixed_or_variable_expense(db):
    assert expense_type_for(db, "Assurances", "ASSU. MAIF HABITATION") == "expense_fixed"   # catégorie nouvelle
    assert expense_type_for(db, "Courses", "CB SUPER U") == "expense_var"
    assert expense_type_for(db, "Dépenses diverses", "PRLV SEPA INCONNU") == "expense_fixed"  # prélèvement
    db.add(Category(name="Assurance auto", type="expense_var"))  # choix de l'utilisateur respecté
    db.commit()
    assert expense_type_for(db, "Assurance auto", "CB AXA") == "expense_var"
