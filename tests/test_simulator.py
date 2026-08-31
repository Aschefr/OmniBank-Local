import pytest
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import Account, Transaction, RecurrenceTemplate, Scenario, ScenarioEvent
from app.services.simulator_engine import run_simulation, get_simulator_presets

# Setup isolated in-memory DB for simulator tests
sim_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=sim_engine)


@pytest.fixture(autouse=True)
def setup_sim_db():
    Base.metadata.create_all(bind=sim_engine)
    db = TestingSessionLocal()
    # Clear any previous test data in simulator tables
    db.query(ScenarioEvent).delete()
    db.query(Scenario).delete()
    db.query(Transaction).delete()
    db.query(RecurrenceTemplate).delete()
    db.query(Account).delete()

    # Create test accounts
    acc_main = Account(id=1, name="Compte Courant Test", type="Compte courant", initial_balance=2500.0)
    acc_sav = Account(id=2, name="Livret A Test", type="Livret", initial_balance=10000.0)
    db.add_all([acc_main, acc_sav])

    # Create Category and GlobalConfig
    from app.models import Category, GlobalConfig
    db.query(Category).delete()
    db.query(GlobalConfig).delete()
    db.add(Category(name="Salaire", type="income"))
    db.add(GlobalConfig(key="pay_category", value="Salaire"))

    # Create test recurrence template (loyer -600€)
    rec = RecurrenceTemplate(
        id=1,
        description="Loyer mensuel",
        amount=600.0,
        type="expense_fixed",
        frequency="Monthly",
        from_account_id=1
    )
    db.add(rec)

    # Create reconciled salary transaction (+2200€)
    tx = Transaction(
        date_saisie=date.today(),
        date_operation=date.today(),
        description="Salaire reçu",
        amount=2200.0,
        type="income",
        category="Salaire",
        is_salary=True,
        to_account_id=1,
        reconciliation_date=date.today()
    )
    db.add(tx)
    db.commit()
    db.close()

    def override_get_db():
        db_session = TestingSessionLocal()
        try:
            yield db_session
        finally:
            db_session.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)



def test_simulator_presets():
    client = TestClient(app)
    resp = client.get("/api/simulator/presets")
    assert resp.status_code == 200
    presets = resp.json()
    assert len(presets) >= 4
    preset_ids = [p["id"] for p in presets]
    assert "vehicle_project" in preset_ids
    assert "renovation_project" in preset_ids
    assert "sabbatical_project" in preset_ids
    assert "real_estate_project" in preset_ids


def test_scenario_crud():
    client = TestClient(app)
    today_str = date.today().isoformat()

    # 1. Create Scenario with events
    payload = {
        "name": "Achat Voiture Neuve",
        "description": "Simulation crédit et apport",
        "color": "#3b82f6",
        "is_active": True,
        "events": [
            {
                "label": "Apport concession",
                "event_type": "one_off_expense",
                "amount": 4000.0,
                "start_date": today_str,
                "duration_months": 1
            },
            {
                "label": "Mensualité crédit",
                "event_type": "recurring_expense",
                "amount": 250.0,
                "start_date": today_str,
                "duration_months": 12
            }
        ]
    }
    create_resp = client.post("/api/simulator/scenarios", json=payload)
    assert create_resp.status_code == 201
    sc_data = create_resp.json()
    sc_id = sc_data["id"]
    assert sc_data["name"] == "Achat Voiture Neuve"
    assert len(sc_data["events"]) == 2

    # 2. Get Scenario
    get_resp = client.get(f"/api/simulator/scenarios/{sc_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Achat Voiture Neuve"

    # 3. Update Scenario
    update_resp = client.put(f"/api/simulator/scenarios/{sc_id}", json={"name": "Achat Voiture Occasion", "color": "#10b981"})
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Achat Voiture Occasion"
    assert update_resp.json()["color"] == "#10b981"

    # 4. Add Event to Scenario
    add_ev_resp = client.post(f"/api/simulator/scenarios/{sc_id}/events", json={
        "label": "Prime à la conversion",
        "event_type": "one_off_income",
        "amount": 1500.0,
        "start_date": today_str,
        "duration_months": 1
    })
    assert add_ev_resp.status_code == 201
    ev_id = add_ev_resp.json()["id"]

    # 5. Update Event
    up_ev_resp = client.put(f"/api/simulator/events/{ev_id}", json={"amount": 2000.0})
    assert up_ev_resp.status_code == 200
    assert up_ev_resp.json()["amount"] == 2000.0

    # 6. Duplicate Scenario
    dup_resp = client.post(f"/api/simulator/scenarios/{sc_id}/duplicate")
    assert dup_resp.status_code == 201
    dup_data = dup_resp.json()
    assert "(Copie)" in dup_data["name"]
    assert len(dup_data["events"]) == 3

    # 7. Delete Event
    del_ev_resp = client.delete(f"/api/simulator/events/{ev_id}")
    assert del_ev_resp.status_code == 200
    assert del_ev_resp.json()["ok"] is True

    # 8. Delete Scenario
    del_sc_resp = client.delete(f"/api/simulator/scenarios/{sc_id}")
    assert del_sc_resp.status_code == 200
    assert del_sc_resp.json()["ok"] is True

    # Verify not found
    assert client.get(f"/api/simulator/scenarios/{sc_id}").status_code == 404


def test_simulation_engine_baseline():
    db = TestingSessionLocal()
    # Baseline over 6 months with 2500 initial balance + 2200 salary - 600 monthly rent
    # Reconciled initial balance = 2500 + 2200 = 4700€
    # Monthly rent = -600€ projected
    result = run_simulation(db=db, horizon_months=6, account_id=1)
    db.close()

    assert result["horizon_months"] == 6
    assert result["initial_balance"] == 4700.0
    assert len(result["monthly_data"]) == 6
    # Each month should have 600€ baseline expenses from recurrence, plus predicted salary across future months
    assert result["monthly_data"][0]["baseline_expense"] == 600.0
    assert result["baseline_final_balance"] == round(4700.0 + (5 * 2200.0) - (6 * 600.0), 2)
    assert result["is_overdraft_risk"] is False


def test_simulation_engine_what_if_events():
    db = TestingSessionLocal()
    today_date = date.today()

    custom_events = [
        {
            "label": "Gros achat PC",
            "event_type": "one_off_expense",
            "amount": 2000.0,
            "start_date": today_date,
            "duration_months": 1,
            "is_active": True
        },
        {
            "label": "Prime annuelle",
            "event_type": "one_off_income",
            "amount": 1000.0,
            "start_date": today_date,
            "duration_months": 1,
            "is_active": True
        },
        {
            "label": "Abonnement sport",
            "event_type": "recurring_expense",
            "amount": 50.0,
            "start_date": today_date,
            "duration_months": 6,
            "is_active": True
        }
    ]

    result = run_simulation(db=db, horizon_months=6, account_id=1, custom_events=custom_events)
    db.close()

    assert result["events_count"] == 3
    # Month 1 impact = -2000 (PC) + 1000 (Prime) - 50 (Sport) = -1050€
    first_month = result["monthly_data"][0]
    assert first_month["simulated_events_impact"] == -1050.0
    # Total diff over 6 months = -2000 + 1000 - (6 * 50) = -1300€
    assert result["total_difference"] == -1300.0
    assert result["simulated_final_balance"] == round(result["baseline_final_balance"] - 1300.0, 2)


def test_simulation_overdraft_detection():
    db = TestingSessionLocal()
    today_date = date.today()

    # Initial balance is 4700€. A one-off expense of 6000€ should trigger overdraft in Month 1!
    custom_events = [
        {
            "label": "Dépense majeure imprévue",
            "event_type": "one_off_expense",
            "amount": 6000.0,
            "start_date": today_date,
            "duration_months": 1,
            "is_active": True
        }
    ]

    result = run_simulation(db=db, horizon_months=6, account_id=1, custom_events=custom_events)
    db.close()

    assert result["is_overdraft_risk"] is True
    assert result["first_overdraft_date"] == today_date.strftime("%Y-%m")
    assert result["min_simulated_balance"] < 0
    assert result["max_overdraft_amount"] > 0


def test_zero_db_pollution():
    db = TestingSessionLocal()
    tx_count_before = db.query(Transaction).count()
    acc_count_before = db.query(Account).count()
    rec_count_before = db.query(RecurrenceTemplate).count()

    client = TestClient(app)
    # Run multiple simulations via API
    client.post("/api/simulator/run", json={"horizon_months": 12, "account_id": 1})
    client.post("/api/simulator/run", json={
        "horizon_months": 24,
        "custom_events": [
            {
                "label": "Test Event",
                "event_type": "one_off_expense",
                "amount": 10000.0,
                "start_date": date.today().isoformat()
            }
        ]
    })

    tx_count_after = db.query(Transaction).count()
    acc_count_after = db.query(Account).count()
    rec_count_after = db.query(RecurrenceTemplate).count()
    db.close()

    assert tx_count_before == tx_count_after
    assert acc_count_before == acc_count_after
    assert rec_count_before == rec_count_after


def test_simulation_income_modes():
    db = TestingSessionLocal()
    client = TestClient(app)

    # 1. Mode NONE (aucun revenu de référence injecté)
    res_none = client.post("/api/simulator/run", json={
        "horizon_months": 6,
        "account_id": 1,
        "income_mode": "none"
    }).json()
    assert res_none["income_mode"] == "none"
    # Future months have 0 baseline income
    assert res_none["monthly_data"][1]["baseline_income"] == 0.0

    # 2. Mode CUSTOM (montant net personnalisé)
    res_custom = client.post("/api/simulator/run", json={
        "horizon_months": 6,
        "account_id": 1,
        "income_mode": "custom",
        "custom_income_amount": 3500.0
    }).json()
    assert res_custom["income_mode"] == "custom"
    assert res_custom["custom_income_amount"] == 3500.0
    # Future month gets 3500€
    assert res_custom["monthly_data"][1]["baseline_income"] == 3500.0

    # 3. Mode AUTO (moyenne automatique)
    res_auto = client.post("/api/simulator/run", json={
        "horizon_months": 6,
        "account_id": 1,
        "income_mode": "auto"
    }).json()
    assert res_auto["income_mode"] == "auto"

    # 4. Mode HISTORICAL_N1 (historique N-1)
    res_n1 = client.post("/api/simulator/run", json={
        "horizon_months": 6,
        "account_id": 1,
        "income_mode": "historical_n1"
    }).json()
    assert res_n1["income_mode"] == "historical_n1"

    db.close()


def test_simulation_confidence_bands():
    """Test that confidence band fields are present in monthly_data."""
    db = TestingSessionLocal()
    result = run_simulation(db=db, horizon_months=12, account_id=1)
    db.close()

    assert "optimistic_final_balance" in result
    assert "pessimistic_final_balance" in result

    for m in result["monthly_data"]:
        assert "optimistic_end_balance" in m
        assert "pessimistic_end_balance" in m
        assert "variable_expense_projected" in m
        assert "inflation_factor" in m
        # Optimistic >= simulated >= pessimistic (when stddev > 0)
        if result.get("variable_expense_stddev", 0) > 0:
            assert m["optimistic_end_balance"] >= m["simulated_end_balance"] - 0.01
            assert m["pessimistic_end_balance"] <= m["simulated_end_balance"] + 0.01


def test_simulation_inflation():
    """Test that inflation increases projected expenses over time."""
    db = TestingSessionLocal()
    result_no_infl = run_simulation(db=db, horizon_months=12, account_id=1, inflation_rate=0.0)
    result_with_infl = run_simulation(db=db, horizon_months=12, account_id=1, inflation_rate=0.05)
    db.close()

    assert result_with_infl["inflation_rate"] == 0.05

    # With inflation, the final balance should be lower (more expenses)
    assert result_with_infl["baseline_final_balance"] <= result_no_infl["baseline_final_balance"]

    # Inflation factor should increase over time
    factors = [m["inflation_factor"] for m in result_with_infl["monthly_data"]]
    assert factors[0] == 1.0  # First month: no inflation applied
    assert factors[-1] > 1.0  # Last month: inflation applied


def test_simulation_new_response_fields():
    """Test that the new transparency metadata fields are present."""
    db = TestingSessionLocal()
    result = run_simulation(db=db, horizon_months=6, account_id=1)
    db.close()

    assert "avg_variable_expense" in result
    assert "variable_expense_stddev" in result
    assert "variable_expense_history_months" in result
    assert "seasonal_history_months" in result
    assert "has_seasonality" in result
    assert "projection_sources" in result
    assert isinstance(result["projection_sources"], list)


def test_simulation_variable_expense_adjustment():
    """Test that variable_expense_adjustment_pct adjusts projected variable spending."""
    db = TestingSessionLocal()
    res_normal = run_simulation(db=db, horizon_months=12, account_id=1, variable_expense_adjustment_pct=0.0)
    res_reduced = run_simulation(db=db, horizon_months=12, account_id=1, variable_expense_adjustment_pct=-0.20)
    res_increased = run_simulation(db=db, horizon_months=12, account_id=1, variable_expense_adjustment_pct=0.20)
    db.close()

    assert res_reduced["variable_expense_adjustment_pct"] == -0.20
    assert res_increased["variable_expense_adjustment_pct"] == 0.20

    # With reduced variable expenses, final balance must be higher
    assert res_reduced["simulated_final_balance"] >= res_normal["simulated_final_balance"]
    # With increased variable expenses, final balance must be lower
    assert res_increased["simulated_final_balance"] <= res_normal["simulated_final_balance"]


def test_simulation_break_even_analysis():
    """Test break-even metrics in simulation response."""
    db = TestingSessionLocal()
    result = run_simulation(db=db, horizon_months=12, account_id=1)
    db.close()

    assert "break_even_monthly_saving" in result
    assert "break_even_var_reduction_pct" in result
    assert "is_fixed_expenses_deficit" in result
    assert "break_even_maintain_initial_saving" in result

    assert isinstance(result["break_even_monthly_saving"], (int, float))
    assert isinstance(result["break_even_var_reduction_pct"], (int, float))
    assert isinstance(result["is_fixed_expenses_deficit"], bool)


def test_simulation_projection_profiles():
    """Test realistic vs conservative projection profiles."""
    db = TestingSessionLocal()
    res_real = run_simulation(db=db, horizon_months=12, account_id=1, projection_profile="realistic")
    res_cons = run_simulation(db=db, horizon_months=12, account_id=1, projection_profile="conservative")
    db.close()

    assert res_real["projection_profile"] == "realistic"
    assert res_cons["projection_profile"] == "conservative"
    assert "historical_real_income_avg" in res_real
    assert "historical_real_fixed_avg" in res_real
    assert "historical_real_net_avg" in res_real


def test_simulation_continuous_prudence_slider():
    """Test continuous interpolation with conservative_weight."""
    db = TestingSessionLocal()
    res_0 = run_simulation(db=db, horizon_months=12, account_id=1, conservative_weight=0.0)
    res_50 = run_simulation(db=db, horizon_months=12, account_id=1, conservative_weight=0.5)
    res_100 = run_simulation(db=db, horizon_months=12, account_id=1, conservative_weight=1.0)
    db.close()

    assert res_0["conservative_weight"] == 0.0
    assert res_50["conservative_weight"] == 0.5
    assert res_100["conservative_weight"] == 1.0

    assert res_0["projection_profile"] == "realistic"
    assert res_50["projection_profile"] == "blend"
    assert res_100["projection_profile"] == "conservative"

    # Monotonicity check: final balance at 0% weight >= 50% weight >= 100% weight
    assert res_0["simulated_final_balance"] >= res_50["simulated_final_balance"]
    assert res_50["simulated_final_balance"] >= res_100["simulated_final_balance"]


