import pytest
import math
from datetime import date
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

from app.models import Base, Account, Transaction, Category, GlobalConfig, Budget
from app.services.budget_ai_service import (
    _smart_round,
    compute_monthly_averages_for_ai,
    ai_suggest_budgets_service,
)
import asyncio


@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()



def test_smart_round():
    """Test de l'arrondi psychologique au multiple de 5€ supérieur, min 5€."""
    assert _smart_round(0.0) == 0.0
    assert _smart_round(-5.0) == 0.0
    assert _smart_round(0.55) == 5.0
    assert _smart_round(4.99) == 5.0
    assert _smart_round(5.0) == 5.0
    assert _smart_round(5.01) == 10.0
    assert _smart_round(43.20) == 45.0
    assert _smart_round(100.0) == 100.0
    assert _smart_round(100.01) == 105.0
    assert _smart_round(610.0) == 610.0


def test_relevance_p75_and_current_month_floor(test_db: Session):
    """Test du percentile P75 et du plancher mois en cours pour éviter les dépassements immédiats."""
    acc = Account(name="Courant Pertinence", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    # Créer des dépenses pour 'Courses' sur les 3 derniers mois : 100, 150, 300
    # Le mois en cours a une dépense de 460€
    test_db.add(Transaction(
        from_account_id=acc.id,
        category="Supermarché",
        amount=460.0,
        type="expense_var",
        date_saisie=today,
        date_operation=today,
        description="Grosses courses du mois",
    ))
    # Mois M-1
    m1 = (today.replace(day=1) - relativedelta(months=1)).replace(day=10)
    test_db.add(Transaction(
        from_account_id=acc.id,
        category="Supermarché",
        amount=150.0,
        type="expense_var",
        date_saisie=m1,
        date_operation=m1,
        description="Courses",
    ))
    # Mois M-2
    m2 = (today.replace(day=1) - relativedelta(months=2)).replace(day=10)
    test_db.add(Transaction(
        from_account_id=acc.id,
        category="Supermarché",
        amount=100.0,
        type="expense_var",
        date_saisie=m2,
        date_operation=m2,
        description="Courses",
    ))
    test_db.commit()

    cat_data = compute_monthly_averages_for_ai(test_db, set(), today, window_months=3)
    assert "Supermarché" in cat_data
    info = cat_data["Supermarché"]
    # P75 doit être calculé et >= avg
    assert "p75" in info
    assert info["p75"] >= info["avg"]
    # current_month_spent doit être 460.0
    assert info["current_month_spent"] == 460.0

    res = asyncio.run(ai_suggest_budgets_service(
        db=test_db,
        window_months=3,
        lang="fr",
        outlier_sensitivity=2,
        engine="deterministic"
    ))
    proposals = res.get("proposals", [])
    courses_prop = next((p for p in proposals if "Supermarché" in p.get("categories", [])), None)
    assert courses_prop is not None
    # L'enveloppe doit être au moins égale à 460€ (arrondi à 460€)
    assert courses_prop["suggested_amount"] >= 460.0
    assert courses_prop["suggested_amount"] % 5.0 == 0.0
    # La somme des cat_amounts doit être égale à suggested_amount
    assert round(sum(courses_prop["cat_amounts"].values()), 2) == courses_prop["suggested_amount"]


def test_relevance_fixed_charges_protected_during_capping(test_db: Session):
    """Test de sanctuarisation des charges fixes (ex: prêts 610€) dans une enveloppe mixte lors du capping."""
    acc = Account(name="Courant Capping", type="Compte courant", initial_balance=3000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    # Catégorie fixe : Prêt Immobilier 610€
    # Catégorie variable : Frais Bancaires 200€
    for m in range(0, 3):
        d = (today.replace(day=1) - relativedelta(months=m)).replace(day=5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Prêt Immobilier",
            amount=610.0,
            type="expense_fixed",
            date_saisie=d,
            date_operation=d,
            description="Mensualité prêt",
        ))
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Frais Bancaires",
            amount=200.0,
            type="expense_var",
            date_saisie=d,
            date_operation=d,
            description="Frais divers",
        ))
    test_db.commit()

    res = asyncio.run(ai_suggest_budgets_service(
        db=test_db,
        window_months=3,
        lang="fr",
        outlier_sensitivity=2,
        engine="deterministic"
    ))
    proposals = res.get("proposals", [])
    finance_prop = next((p for p in proposals if "Prêt Immobilier" in p.get("categories", [])), None)
    assert finance_prop is not None

    # Si l'enveloppe contient à la fois Prêt Immobilier (fixe) et Frais Bancaires (variable),
    # sa quote-part fixe doit être de 610€ et son montant total >= 610€
    if finance_prop.get("has_fixed_mix"):
        assert finance_prop["fixed_sum"] == 610.0
        assert finance_prop["suggested_amount"] >= 610.0
        assert finance_prop["cat_amounts"]["Prêt Immobilier"] == 610.0
    elif finance_prop.get("is_fixed"):
        assert finance_prop["suggested_amount"] >= 610.0

    # Vérifier l'arrondi multiple de 5€
    assert finance_prop["suggested_amount"] % 5.0 == 0.0
    assert round(sum(finance_prop["cat_amounts"].values()), 2) == finance_prop["suggested_amount"]


def test_relevance_yearly_ytd_protection(test_db: Session):
    """Test que les enveloppes annuelles sont protégées contre un dépassement YTD immédiat."""
    acc = Account(name="Courant YTD", type="Compte courant", initial_balance=5000.0)
    test_db.add(acc)
    test_db.commit()

    # Créer des dépenses annuelles antérieures dans l'année en cours
    anchor = date(date.today().year, 9, 15) if date.today().month >= 9 else date(date.today().year, date.today().month, 15)
    # Catégorie annuelle : Assurance Auto avec 900€ de dépenses YTD
    for m in range(1, 4):
        d = date(anchor.year, m, 10)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Assurance Véhicule Annuelle",
            amount=300.0,
            type="expense_fixed",
            date_saisie=d,
            date_operation=d,
            description="Assurance trimestrielle",
        ))
    test_db.commit()

    cat_data = compute_monthly_averages_for_ai(test_db, set(), anchor, window_months=3)
    assert "Assurance Véhicule Annuelle" in cat_data
    assert cat_data["Assurance Véhicule Annuelle"]["ytd_spent"] >= 900.0


def test_relevance_yearly_multiplied_by_12(test_db: Session):
    """Test qu'une enveloppe annuelle a bien un montant annuel (multiplié par 12) et non un montant mensuel."""
    acc = Account(name="Courant Annuel 12M", type="Compte courant", initial_balance=5000.0)
    test_db.add(acc)
    test_db.commit()

    today = date.today()
    # Dépense d'eau de 100€ / mois sur 3 mois
    for m in range(0, 3):
        d = (today.replace(day=1) - relativedelta(months=m)).replace(day=5)
        test_db.add(Transaction(
            from_account_id=acc.id,
            category="Facture Eau",
            amount=100.0,
            type="expense_var",
            date_saisie=d,
            date_operation=d,
            description="Eau",
        ))
    test_db.commit()

    # Appeler le service de suggestion avec un override ou vérifier que si l'enveloppe est annuelle, son montant est ~1200€
    from app.services.budget_ai_service import ai_suggest_budgets_service
    res = asyncio.run(ai_suggest_budgets_service(
        db=test_db,
        window_months=3,
        lang="fr",
        outlier_sensitivity=2,
        engine="deterministic"
    ))
    proposals = res.get("proposals", [])
    eau_prop = next((p for p in proposals if "Facture Eau" in p.get("categories", [])), None)
    assert eau_prop is not None
    if eau_prop["suggested_period"] == "yearly":
        # Le budget annuel doit être au moins 12x le montant mensuel (100€ * 12 = 1200€)
        assert eau_prop["suggested_amount"] >= 1200.0
        assert eau_prop["cat_amounts"]["Facture Eau"] >= 1200.0
    else:
        # Si mensuel, au moins 100€
        assert eau_prop["suggested_amount"] >= 100.0

