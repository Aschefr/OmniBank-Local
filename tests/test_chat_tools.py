import pytest
from datetime import date, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Account, Transaction, Budget, BudgetCategory, BudgetAllocation, RecurrenceTemplate, GlobalConfig
from app.services.chat.chat_tools import (
    forecast_balances_history_tool,
    detect_anomalies_and_subscriptions_tool,
    get_budgets_status_tool,
    audit_transactions_integrity_tool,
    simulate_financial_scenario_tool,
)

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    
    # 1. Base Config
    db.add(GlobalConfig(key="base_currency", value="EUR"))
    db.add(GlobalConfig(key="base_pay_day", value="28"))
    
    # 2. Main Account & Savings Account
    acc_main = Account(id=1, name="CA Centre-Est", initial_balance=3000.0, is_closed=False, type="Courant")
    acc_savings = Account(id=2, name="Livret A", initial_balance=5000.0, is_closed=False, type="Épargne")
    db.add_all([acc_main, acc_savings])
    db.flush()
    
    db.add(GlobalConfig(key="main_account_id", value="1"))
    
    # 3. Paycheck override for testing
    today = date.today()
    next_month_pay = date(today.year, today.month, 28)
    if next_month_pay <= today:
        m = today.month + 1 if today.month < 12 else 1
        y = today.year if today.month < 12 else today.year + 1
        next_month_pay = date(y, m, 28)
        
    db.add(GlobalConfig(key="override_paycheck_date", value=next_month_pay.isoformat()))
    db.add(GlobalConfig(key="override_paycheck_amount", value="2500.0"))
    db.add(GlobalConfig(key="override_paycheck_period", value=f"{next_month_pay.year:04d}-{next_month_pay.month:02d}"))
    
    # 4. Recurrence templates
    tpl_rent = RecurrenceTemplate(id=1, description="Loyer", amount=800.0, type="expense_fixed", frequency="Monthly", day_of_month=5, from_account_id=1, is_closed=False)
    tpl_sub = RecurrenceTemplate(id=2, description="Netflix", amount=15.99, type="expense_fixed", frequency="Monthly", day_of_month=12, from_account_id=1, is_closed=False)
    db.add_all([tpl_rent, tpl_sub])
    
    # 5. Some past transactions for spending history
    for i in range(1, 4):
        past_date = today - timedelta(days=i * 28)
        db.add(Transaction(
            description="Salaire Entreprise",
            amount=2500.0,
            date_operation=past_date,
            reconciliation_date=past_date,
            type="income",
            to_account_id=1,
            category="Salaire",
            is_salary=True
        ))
        db.add(Transaction(
            description="Courses Alimentation",
            amount=80.0,
            date_operation=past_date + timedelta(days=2),
            reconciliation_date=past_date + timedelta(days=2),
            type="expense_var",
            from_account_id=1,
            category="Alimentation"
        ))
        db.add(Transaction(
            description="Abonnement Spotify",
            amount=10.99 if i > 1 else 12.99, # Simulates a price hike on recent charge!
            date_operation=past_date + timedelta(days=10),
            reconciliation_date=past_date + timedelta(days=10),
            type="expense_fixed",
            from_account_id=1,
            category="Abonnements"
        ))
        
    # 6. Budget envelope
    b_food = Budget(id=1, name="Alimentation", monthly_amount=300.0, envelope_type="spending", period="monthly", is_closed=False)
    db.add(b_food)
    db.flush()
    db.add(BudgetCategory(budget_id=1, category_name="Alimentation"))
    
    # 7. Unreconciled old transaction for auditor test (>35 days ago)
    old_unrec = Transaction(
        description="Paiement Oublié Resto",
        amount=45.0,
        date_operation=today - timedelta(days=40),
        reconciliation_date=None,
        type="expense_var",
        from_account_id=1,
        category="Restaurants"
    )
    db.add(old_unrec)
    
    db.commit()
    yield db
    db.close()
    Base.metadata.drop_all(bind=engine)

def test_forecast_balances_history_multicycle(db_session):
    """Vérifie que la projection à 90 jours projette bien les salaires des 3 mois et calcule un solde réaliste."""
    result = forecast_balances_history_tool(db_session, days=90)
    
    assert "error" not in result
    assert result["forecast_days"] == 90
    assert len(result["projected_income_events"]) >= 2 # Multiple paychecks projected across horizon
    assert "monthly_breakdown" in result
    assert len(result["monthly_breakdown"]) >= 3 # 3 monthly cycles
    
    # Vérifie que le solde n'a pas plongé dans un faux déficit de -4000 € grâce aux salaires projetés
    final_balance = result["history"][-1]["projected_balance_euros"]
    assert final_balance > 0, f"Le solde final ne doit pas être en déficit artificiel, obtenu : {final_balance} €"
    assert result["total_liquid_savings_cushion_euros"] >= 5000.0 # Patrimoine liquide total bien comptabilisé

def test_detect_anomalies_and_subscriptions(db_session):
    """Vérifie la détection d'abonnements, de hausses tarifaires et de risque de découvert."""
    result = detect_anomalies_and_subscriptions_tool(db_session)
    
    assert "detected_subscriptions" in result
    # Spotify doit être détecté comme abonnement
    subs_descs = [s["description"].lower() for s in result["detected_subscriptions"]]
    assert any("spotify" in s for s in subs_descs)
    
    # La hausse de Spotify (10.99 € -> 12.99 €) doit être détectée
    assert "price_increases_detected" in result
    price_hikes = [p["description"].lower() for p in result["price_increases_detected"]]
    assert any("spotify" in p for p in price_hikes)
    
    # Spotify n'est pas dans les templates officiels -> doit être dans unregistered_subscriptions
    unreg = [u["description"].lower() for u in result["unregistered_subscriptions"]]
    assert any("spotify" in u for u in unreg)

def test_get_budgets_status_historical_averages(db_session):
    """Vérifie que le statut des budgets remonte bien les moyennes réelles 3m et 6m."""
    result = get_budgets_status_tool(db_session)
    
    assert "budgets" in result
    b_food = next((b for b in result["budgets"] if b["name"] == "Alimentation"), None)
    assert b_food is not None
    assert "historical_monthly_avg_spent_3m" in b_food
    assert "historical_monthly_avg_spent_6m" in b_food
    assert b_food["historical_monthly_avg_spent_3m"] > 0

def test_audit_transactions_integrity(db_session):
    """Vérifie que l'auditeur détecte l'opération non rapprochée > 30j."""
    result = audit_transactions_integrity_tool(db_session)
    
    assert "summary" in result
    assert result["summary"]["unreconciled_past_count"] >= 1
    unrec_descs = [t["description"] for t in result["unreconciled_past_transactions"]]
    assert "Paiement Oublié Resto" in unrec_descs

def test_simulate_financial_scenario(db_session):
    """Vérifie que le simulateur calcule correctement l'impact d'un projet What-If."""
    result = simulate_financial_scenario_tool(
        db_session,
        horizon_months=12,
        project_name="Achat Vélo Électrique",
        one_off_amount=1500.0,
        recurring_monthly_amount=50.0,
        recurring_duration_months=12
    )
    
    assert result["project_name"] == "Achat Vélo Électrique"
    assert result["project_cost_summary"]["total_project_cost_euros"] == 2100.0
    assert "user_borrowing_capacity" in result
    assert result["user_borrowing_capacity"]["monthly_average_income_euros"] > 0
    assert "trajectory_comparison" in result
    assert "is_financially_viable" in result

def test_cascade_cold_start_total(db_session):
    """Vérifie le comportement en Cold Start Total (0 historique, 0 enveloppe) -> 35% du salaire."""
    from app.services.chat.chat_tools import calculate_daily_variable_spending_rate
    from app.models import Budget, Transaction
    
    # Supprimer temporairement les transactions et budgets pour simuler un profil vierge
    db_session.query(Transaction).delete()
    db_session.query(Budget).delete()
    db_session.commit()
    
    today = date.today()
    rate_info = calculate_daily_variable_spending_rate(db_session, account_id=1, today=today)
    
    assert rate_info["source_mode"] == "prudential_salary_ratio"
    # 2500 € salaire * 0.35 = 875 €/mois -> ~28.77 €/j
    assert rate_info["monthly_equivalent_euros"] == 875.0
    assert 28.0 <= rate_info["daily_rate_euros"] <= 29.0

def test_cascade_budget_envelopes_fallback(db_session):
    """Vérifie le repli sur les enveloppes budgétaires quand l'historique de transactions est vierge."""
    from app.services.chat.chat_tools import calculate_daily_variable_spending_rate
    from app.models import Budget, Transaction
    
    db_session.query(Transaction).delete()
    db_session.query(Budget).delete()
    
    # Ajouter 2 enveloppes de dépense
    db_session.add(Budget(id=10, name="Courses", monthly_amount=400.0, envelope_type="spending", is_closed=False))
    db_session.add(Budget(id=11, name="Loisirs", monthly_amount=200.0, envelope_type="spending", is_closed=False))
    db_session.commit()
    
    today = date.today()
    rate_info = calculate_daily_variable_spending_rate(db_session, account_id=1, today=today)
    
    assert rate_info["source_mode"] == "budget_envelopes"
    assert rate_info["monthly_equivalent_euros"] == 600.0
    assert 19.5 <= rate_info["daily_rate_euros"] <= 20.0

def test_saving_recommendations_cold_start(db_session):
    """Vérifie que les recommandations d'épargne fonctionnent en cascade pour un profil neuf."""
    from app.services.chat.chat_tools import get_saving_recommendations_tool
    from app.models import Transaction
    
    db_session.query(Transaction).delete()
    db_session.commit()
    
    res = get_saving_recommendations_tool(db_session)
    assert res["data_source_mode"] in ("projected_envelopes_and_templates", "projected_prudential_ratio")
    assert res["monthly_averages"]["income_euros"] == 2500.0
    assert "target_50_30_20_benchmarks" in res
    assert res["target_50_30_20_benchmarks"]["target_savings_20pct_euros"] == 500.0


def test_get_budgets_status_future_period(db_session):
    """Vérifie que get_budgets_status_tool détecte les périodes futures et projette les récurrences."""
    today = date.today()
    future_year = today.year + 1
    future_month = 9

    res = get_budgets_status_tool(db_session, year=future_year, month=future_month)
    assert "target_period" in res
    assert res["target_period"]["year"] == future_year
    assert res["target_period"]["month"] == future_month
    assert res["target_period"]["is_future"] is True
    assert res["target_period"]["is_past"] is False
    assert res["target_period"]["is_current"] is False

    # Check budget items
    assert len(res["budgets"]) > 0
    food_budget = next((b for b in res["budgets"] if b["name"] == "Alimentation"), None)
    assert food_budget is not None
    assert food_budget["is_future_period"] is True


def test_build_entity_snapshots_future_period(db_session):
    """Vérifie que build_entity_snapshots génère des snapshots correctement datés pour un mois futur."""
    from app.services.chat.chat_snapshot import build_entity_snapshots

    text_ai = "Votre budget Alimentation est bien dimensionné pour le mois prochain."
    today = date.today()
    future_year = today.year + 1
    future_month = 10

    snaps = build_entity_snapshots(text_ai, db_session, year=future_year, month=future_month)
    assert "budget:Alimentation" in snaps
    snap = snaps["budget:Alimentation"]
    assert snap["snapshot_year"] == future_year
    assert snap["snapshot_month"] == future_month
    assert snap["is_future"] is True


