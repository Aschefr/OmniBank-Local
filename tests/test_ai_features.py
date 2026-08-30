import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import AIFact, OrgUser, ChatSession
from app.routers.chat import store_financial_fact_tool, forget_financial_fact_tool, load_system_prompt

# Setup in-memory SQLite DB for testing with StaticPool to share connection
@pytest.fixture
def db_session():
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

def test_ai_facts_scoping(db_session):
    db = db_session
    
    # 1. Create a dummy user and chat session
    user = OrgUser(name="Alice")
    db.add(user)
    session = ChatSession(id=1, role="advisor")
    db.add(session)
    db.commit()
    
    # 2. Store facts
    # Global fact (no user, no session)
    store_financial_fact_tool(db, key="global_key", value="global_value")
    
    # Session fact (isolated to session 1)
    store_financial_fact_tool(db, key="session_key", value="session_value", private_to_session=True, session_id=1)
    
    # User fact (isolated to user Alice)
    store_financial_fact_tool(db, key="user_key", value="user_value", user_name="Alice")
    
    # 3. Check fact loading scenarios via load_system_prompt
    # Case A: Global client (no user, no session)
    prompt_A = load_system_prompt(db=db)
    assert "global_key" in prompt_A
    assert "session_key" not in prompt_A
    assert "user_key" not in prompt_A
    
    # Case B: Client in session 1 (no user name)
    prompt_B = load_system_prompt(db=db, session_id=1)
    assert "global_key" in prompt_B
    assert "session_key" in prompt_B
    assert "user_key" not in prompt_B
    
    # Case C: User Alice (no session)
    prompt_C = load_system_prompt(db=db, user_name="Alice")
    assert "global_key" in prompt_C
    assert "session_key" not in prompt_C
    assert "user_key" in prompt_C
    
    # Case D: User Alice in session 1
    prompt_D = load_system_prompt(db=db, session_id=1, user_name="Alice")
    assert "global_key" in prompt_D
    assert "session_key" in prompt_D
    assert "user_key" in prompt_D

def test_forget_financial_fact(db_session):
    db = db_session
    
    # Store a fact
    store_financial_fact_tool(db, key="some_key", value="some_val")
    prompt_before = load_system_prompt(db=db)
    assert "some_key" in prompt_before
    
    # Forget the fact
    forget_financial_fact_tool(db, key="some_key")
    prompt_after = load_system_prompt(db=db)
    assert "some_key" not in prompt_after

def test_ai_facts_api(db_session):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db

    # Override get_db dependency
    def override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_db

    client = TestClient(app)

    # 1. Create a fact via API
    resp_post = client.post("/api/chat/facts", json={
        "fact_key": "rent_euros",
        "fact_value": "1200",
        "private_to_session": False
    })
    if resp_post.status_code != 200:
        with open("api_error.txt", "w") as f:
            f.write(resp_post.text)
        raise Exception(f"API Error 500: {resp_post.text}")
    assert resp_post.status_code == 200

    # 2. Retrieve facts via API
    resp_get = client.get("/api/chat/facts")
    assert resp_get.status_code == 200
    data = resp_get.json()
    assert len(data) == 1
    assert data[0]["fact_key"] == "rent_euros"
    assert data[0]["fact_value"] == "1200"
    fact_id = data[0]["id"]

    # 3. Delete the fact via API
    resp_del = client.delete(f"/api/chat/facts/{fact_id}")
    assert resp_del.status_code == 200

    # 4. Verify list is empty
    resp_get_after = client.get("/api/chat/facts")
    assert len(resp_get_after.json()) == 0

    # Cleanup overrides
    app.dependency_overrides.clear()

def test_financial_briefing_generation(db_session):
    from datetime import date
    from app.models import Account, Transaction, Budget
    from app.services.chat.chat_briefing import generate_financial_briefing
    from app.services.chat.chat_tools import (
        get_spending_trends_tool, get_dashboard_synthesis_tool, get_financial_summary_tool
    )
    
    db = db_session
    # 1. Test empty DB handling
    empty_briefing = generate_financial_briefing(db)
    assert "No accounts configured yet." in empty_briefing

    # 2. Add sample account and transactions
    acc = Account(name="Courant", type="checking", initial_balance=2000.0)
    db.add(acc)
    db.commit()

    # Add income and expenses
    t1 = Transaction(date_operation=date.today(), description="Salaire", amount=3000.0, type="income", to_account_id=acc.id, reconciliation_date=date.today())
    t2 = Transaction(date_operation=date.today(), description="Loyer", amount=800.0, type="expense_fixed", from_account_id=acc.id, reconciliation_date=date.today())
    t3 = Transaction(date_operation=date.today(), description="Courses", amount=150.0, type="expense_var", category="Alimentation", from_account_id=acc.id, reconciliation_date=date.today())
    db.add_all([t1, t2, t3])
    db.commit()

    # 3. Test briefing with data
    briefing = generate_financial_briefing(db, role="advisor")
    assert "LIVE USER FINANCIAL SITUATION & DOSSIER" in briefing
    assert "Reconciled Net Worth" in briefing
    assert "Reste à Vivre" in briefing

    # 4. Test role specific briefing
    briefing_sim = generate_financial_briefing(db, role="simulator")
    assert "Simulator Briefing" in briefing_sim

    briefing_plan = generate_financial_briefing(db, role="budget_planner")
    assert "Budget Planner Briefing" in briefing_plan

    # 5. Test spending trends tool
    trends = get_spending_trends_tool(db)
    assert "averages_3_months" in trends
    assert "averages_6_months" in trends
    assert "averages_12_months" in trends
    assert "notable_spending_changes" in trends
    assert trends["averages_3_months"]["monthly_income_euros"] > 0

    # 6. Test dashboard synthesis tool
    synthesis = get_dashboard_synthesis_tool(db)
    assert "period" in synthesis
    assert "monthly_totals" in synthesis
    assert "comparison_vs_previous_month" in synthesis
    assert synthesis["monthly_totals"]["total_income_euros"] == 3000.0
    assert synthesis["monthly_totals"]["total_expenses_euros"] == 950.0

    # 7. Test enriched financial summary tool
    summary = get_financial_summary_tool(db)
    assert "current_rest_to_live_euros" in summary
    assert "daily_budget_available_euros" in summary
    assert "days_until_next_paycheck" in summary
    assert "savings_safety_buffer_euros" in summary

def test_build_entity_snapshots(db_session):
    from datetime import date
    from app.models import Account, Transaction, Category, Budget, BudgetCategory
    from app.services.chat.chat_snapshot import build_entity_snapshots

    db = db_session
    acc = Account(name="Compte Courant", type="checking", initial_balance=1500.0)
    cat = Category(name="Alimentation", type="expense_var")
    bud = Budget(name="Alimentation", monthly_amount=400.0, envelope_type="spending")
    db.add_all([acc, cat, bud])
    db.commit()

    bcat = BudgetCategory(budget_id=bud.id, category_name="Alimentation")
    t = Transaction(date_operation=date(2026, 8, 10), description="Supermarché", amount=85.5, type="expense_var", category="Alimentation", budget_id=bud.id, from_account_id=acc.id)
    db.add_all([bcat, t])
    db.commit()

    # Test detection in AI text
    text = "Votre budget Alimentation est actuellement consommé et votre Compte Courant affiche un solde stable."
    snapshots = build_entity_snapshots(text, db, 2026, 8)

    assert "budget:Alimentation" in snapshots
    assert snapshots["budget:Alimentation"]["spent"] == 85.5
    assert snapshots["budget:Alimentation"]["limit"] == 400.0
    assert snapshots["budget:Alimentation"]["snapshot_year"] == 2026
    assert snapshots["budget:Alimentation"]["snapshot_month"] == 8
    assert len(snapshots["budget:Alimentation"]["recent_txs"]) == 1

    assert "account:Compte Courant" in snapshots
    assert snapshots["account:Compte Courant"]["type"] == "account"

    assert "category:Alimentation" in snapshots
    assert len(snapshots["category:Alimentation"]["recent_txs"]) == 1

def test_detect_anomalies_and_duplicates_accounting_awareness(db_session):
    from datetime import date
    from app.models import Account, Transaction
    from app.services.chat.chat_tools import detect_anomalies_and_subscriptions_tool

    db = db_session
    acc = Account(name="Compte Principal", type="checking", initial_balance=2000.0)
    db.add(acc)
    db.commit()

    # Case 1: Both reconciled (legitimate separate bank debits or double billing)
    t1 = Transaction(date_operation=date.today(), description="Google One", amount=21.99, type="expense_var", from_account_id=acc.id, reconciliation_date=date.today())
    t2 = Transaction(date_operation=date.today(), description="Google One", amount=21.99, type="expense_var", from_account_id=acc.id, reconciliation_date=date.today())
    
    # Case 2: One reconciled, one unreconciled phantom
    t3 = Transaction(date_operation=date.today(), description="Restaurant Le Bistro", amount=45.0, type="expense_var", from_account_id=acc.id, reconciliation_date=date.today())
    t4 = Transaction(date_operation=date.today(), description="Restaurant Le Bistro", amount=45.0, type="expense_var", from_account_id=acc.id, reconciliation_date=None)

    db.add_all([t1, t2, t3, t4])
    db.commit()

    res = detect_anomalies_and_subscriptions_tool(db)
    dups = res["potential_duplicate_charges"]
    # Only the genuine unreconciled duplicate must be reported (Google One is legitimately reconciled twice on bank statement)
    assert len(dups) == 1

    dup_bistro = dups[0]
    assert dup_bistro["description"] == "Restaurant Le Bistro"
    assert dup_bistro["target_unreconciled_id_to_delete"] == t4.id
    assert "Saisie manuelle" in dup_bistro["accounting_advice"]



