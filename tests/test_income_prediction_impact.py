"""
Tests unitaires pour l'intégration de l'impact bénéfique des recettes prévues
sur le Reste à vivre (RTL) et le Risque de découvert (get_overdraft_warning).
"""
import os
import sys
import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.database import get_db
from app.models import Account, Transaction, GlobalConfig
from app.services import stats_cache
from app.services.finance_engine import get_overdraft_warning, calculate_rest_to_live
from tests.generate_test_db import build_test_db

TEST_DB_PATH = "data/omnibank_test_income_impact.db"

engine = create_engine(
    f"sqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
    poolclass=NullPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    app.dependency_overrides[get_db] = override_get_db
    from app.database import _engines, _session_factories
    _engines['default'] = engine
    _session_factories['default'] = TestingSessionLocal
    build_test_db(engine)
    stats_cache.invalidate()
    yield
    stats_cache.invalidate()
    engine.dispose()
    app.dependency_overrides.pop(get_db, None)

client = TestClient(app)


def test_overdraft_covered_by_planned_income():
    """
    Vérifie qu'un risque de découvert sans recettes est marqué comme 'covered_by_income = True'
    lorsque des recettes prévues sur la période couvrent le découvert.
    """
    db = TestingSessionLocal()
    try:
        # Créer un compte avec solde initial 100€
        acc = Account(name="Test Compte Découvert", type="Compte courant", initial_balance=100.0)
        db.add(acc)
        db.commit()
        db.refresh(acc)

        today = date.today()

        # Dépense non rapprochée de 150€ à J+5 -> solde sans recettes = -50€ (découvert)
        exp = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=5),
            description="Loyer partiel",
            amount=150.0,
            type="expense_fixed",
            from_account_id=acc.id,
            to_account_id=None,
            reconciliation_date=None
        )
        # Recette non rapprochée de 200€ à J+3 -> couvre le découvert (solde final = +150€, mini = +100€ ou +300€)
        inc = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=3),
            description="Remboursement attendu",
            amount=200.0,
            type="income",
            from_account_id=None,
            to_account_id=acc.id,
            reconciliation_date=None
        )
        db.add_all([exp, inc])
        db.commit()

        warning = get_overdraft_warning(db, account_id=acc.id)
        assert warning is not None
        assert warning["projected_balance"] == -50.0
        assert warning["covered_by_income"] is True
        assert warning["planned_income_total"] == 200.0
        assert warning["planned_income_before_risk"] == 200.0
        assert warning["projected_balance_with_income"] >= 0.0
    finally:
        db.close()


def test_overdraft_partially_reduced_by_planned_income():
    """
    Vérifie qu'un risque de découvert est marqué comme non couvert mais avec solde projeté atténué
    lorsque les recettes réduisent le déficit sans l'annuler complètement.
    """
    db = TestingSessionLocal()
    try:
        acc = Account(name="Test Compte Découvert Partiel", type="Compte courant", initial_balance=50.0)
        db.add(acc)
        db.commit()
        db.refresh(acc)

        today = date.today()

        # Dépense non rapprochée de 200€ à J+5 -> solde sans recettes = -150€
        exp = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=5),
            description="Grosse dépense",
            amount=200.0,
            type="expense_fixed",
            from_account_id=acc.id,
            to_account_id=None,
            reconciliation_date=None
        )
        # Recette non rapprochée de 50€ à J+2 -> solde mini avec recettes = -100€ (découvert réduit)
        inc = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=2),
            description="Acompte",
            amount=50.0,
            type="income",
            from_account_id=None,
            to_account_id=acc.id,
            reconciliation_date=None
        )
        db.add_all([exp, inc])
        db.commit()

        warning = get_overdraft_warning(db, account_id=acc.id)
        assert warning is not None
        assert warning["projected_balance"] == -150.0
        assert warning["covered_by_income"] is False
        assert warning["planned_income_total"] == 50.0
        assert warning["projected_balance_with_income"] == -100.0
        assert warning["with_income_risk_amount"] == -100.0
    finally:
        db.close()


def test_dashboard_stats_endpoint_includes_planned_income():
    """
    Vérifie que l'endpoint /api/stats/dashboard renvoie bien unreconciled_income et rest_to_live_with_income.
    """
    res = client.get("/api/stats/dashboard")
    assert res.status_code == 200
    data = res.json()
    assert "rest_to_live" in data
    assert "rest_to_live_with_income" in data
    assert "unreconciled_income" in data
    assert "main_account_id" in data
    assert data["rest_to_live_with_income"] == round(data["rest_to_live"] + data["unreconciled_income"], 2)


def test_unreconciled_income_dated_in_past_counted_before_next_pay():
    """
    Vérifie qu'une recette non encore rapprochée dont la date d'opération est passée
    (ex: hier) mais avant la prochaine paie est bien comptabilisée dans unreconciled_income.
    """
    db = TestingSessionLocal()
    try:
        acc = Account(name="Test Past Unreconciled Income Acc", type="Compte courant", initial_balance=500.0)
        db.add(acc)
        db.commit()
        db.refresh(acc)

        today = date.today()

        # Recette non rapprochée datée d'hier
        inc = Transaction(
            date_saisie=today,
            date_operation=today - timedelta(days=1),
            description="Recette d'hier non rapprochée",
            amount=150.0,
            type="income",
            from_account_id=None,
            to_account_id=acc.id,
            reconciliation_date=None
        )
        db.add(inc)
        db.commit()

        # Configure main_account_id and explicit next paycheck in future so test is invariant to execution calendar day
        from app.models import GlobalConfig
        main_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "main_account_id").first()
        if not main_cfg:
            main_cfg = GlobalConfig(key="main_account_id", value=str(acc.id))
            db.add(main_cfg)
        else:
            main_cfg.value = str(acc.id)

        pay_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_date").first()
        if not pay_cfg:
            db.add(GlobalConfig(key="override_paycheck_date", value=(today + timedelta(days=5)).isoformat()))
        else:
            pay_cfg.value = (today + timedelta(days=5)).isoformat()
        db.commit()
        stats_cache.invalidate()

        res = client.get("/api/stats/dashboard")
        assert res.status_code == 200
        data = res.json()
        assert data["main_account_id"] == acc.id
        assert data["unreconciled_income"] >= 150.0
    finally:
        db.close()


def test_overdraft_after_paycheck_not_alarmist():
    """
    Vérifie qu'une dépense située APRÈS la prochaine paie prévue :
    1. Prend en compte le salaire prévisionnel dans le calcul du solde projeté.
    2. Porte le marqueur is_after_next_paycheck = True et covered_by_income = True.
    3. N'est pas considérée comme un risque de découvert dans detect_anomalies_and_subscriptions_tool.
    """
    from app.services.chat.tools.analysis_tools import detect_anomalies_and_subscriptions_tool
    from app.services.chat.tools.read_tools import get_financial_summary_tool
    from app.services.chat.chat_briefing import generate_financial_briefing

    db = TestingSessionLocal()
    try:
        today = date.today()
        acc = Account(name="Test Compte Courant Paie", type="Compte courant", initial_balance=200.0)
        db.add(acc)
        db.commit()
        db.refresh(acc)

        # Configurer comme compte principal
        main_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "main_account_id").first()
        if not main_cfg:
            main_cfg = GlobalConfig(key="main_account_id", value=str(acc.id))
            db.add(main_cfg)
        else:
            main_cfg.value = str(acc.id)

        # Configurer une paie à J+5 de 2500 €
        pay_date = today + timedelta(days=5)
        pay_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_date").first()
        if not pay_cfg:
            db.add(GlobalConfig(key="override_paycheck_date", value=pay_date.isoformat()))
        else:
            pay_cfg.value = pay_date.isoformat()

        pay_period_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_period").first()
        period_str = f"{today.year:04d}-{today.month:02d}"
        if not pay_period_cfg:
            db.add(GlobalConfig(key="override_paycheck_period", value=period_str))
        else:
            pay_period_cfg.value = period_str

        pay_amt_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
        if not pay_amt_cfg:
            db.add(GlobalConfig(key="override_paycheck_amount", value="2500.0"))
        else:
            pay_amt_cfg.value = "2500.0"

        # Dépense non rapprochée de 300 € à J+8 (après la paie) -> solde sans recettes = -100 €, mais avec paie = +2400 €
        post_pay_expense = Transaction(
            date_saisie=today,
            date_operation=today + timedelta(days=8),
            description="Pret Remboursement J+8",
            amount=300.0,
            type="expense_fixed",
            from_account_id=acc.id,
            to_account_id=None,
            reconciliation_date=None
        )
        db.add(post_pay_expense)
        db.commit()
        stats_cache.invalidate()

        # 1. Vérification dans finance_engine
        warning = get_overdraft_warning(db, account_id=acc.id)
        assert warning is not None
        assert warning["is_after_next_paycheck"] is True
        assert warning["covered_by_income"] is True
        assert warning["planned_income_total"] >= 2500.0
        assert warning["projected_balance_with_income"] > 0

        # 2. Vérification dans detect_anomalies_and_subscriptions_tool
        anomalies = detect_anomalies_and_subscriptions_tool(db)
        od_info = anomalies.get("overdraft_warning")
        assert od_info is not None
        assert od_info["will_overdraft"] is False
        assert od_info["scheduled_after_next_paycheck"] is True

        # 3. Vérification dans get_financial_summary_tool
        summary = get_financial_summary_tool(db)
        assert summary["recommended_bridge_transfer"] is None

        # 4. Vérification dans generate_financial_briefing
        briefing = generate_financial_briefing(db, role="advisor")
        assert "Overdraft Risk Alert" not in briefing
        assert "Recommended Bridge Transfer" not in briefing
        assert "No projected overdraft before next paycheck" in briefing
    finally:
        db.close()


