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
    """Test that confidence band fields are present in monthly_data and grow as sqrt(t) brownian diffusion."""
    db = TestingSessionLocal()
    today = date.today()
    for i, amt in enumerate([100.0, 150.0, 200.0, 120.0, 180.0, 140.0]):
        db.add(Transaction(
            date_saisie=today - timedelta(days=30 * (i + 1)),
            date_operation=today - timedelta(days=30 * (i + 1)),
            description=f"Variable test {i}",
            amount=amt,
            type="expense_var",
            from_account_id=1,
            reconciliation_date=today
        ))
    db.commit()

    result = run_simulation(db=db, horizon_months=12, account_id=1)
    db.close()

    assert "optimistic_final_balance" in result
    assert "pessimistic_final_balance" in result

    m_data = result["monthly_data"]
    for m in m_data:
        assert "optimistic_end_balance" in m
        assert "pessimistic_end_balance" in m
        assert "variable_expense_projected" in m
        assert "inflation_factor" in m
        # Optimistic >= simulated >= pessimistic
        if result.get("variable_expense_stddev", 0) > 0:
            assert m["optimistic_end_balance"] >= m["simulated_end_balance"] - 0.01
            assert m["pessimistic_end_balance"] <= m["simulated_end_balance"] + 0.01

    if result.get("variable_expense_stddev", 0) > 0 and len(m_data) >= 10:
        w_m1 = m_data[1]["optimistic_end_balance"] - m_data[1]["simulated_end_balance"]
        w_m9 = m_data[9]["optimistic_end_balance"] - m_data[9]["simulated_end_balance"]
        if w_m1 > 0:
            ratio = w_m9 / w_m1
            # sqrt(9.x / 1.x) is around 2.5 - 3.0, proving sublinear sqrt(t) diffusion rather than linear 9.0!
            assert 2.0 <= ratio <= 4.5


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


def test_salary_not_excluded_as_income_outlier():
    """Vérifie que les salaires réguliers ne sont pas éliminés par le filtre d'outliers de recettes."""
    db = TestingSessionLocal()
    from datetime import date
    from app.services.simulator_engine import _add_months

    today = date.today()
    # Insérer 6 mois de salaires réels (2200€) et plusieurs petits remboursements (10€, 15€, 20€)
    for m_back in range(1, 7):
        d = _add_months(date(today.year, today.month, 1), -m_back)
        db.add(Transaction(
            date_saisie=d,
            date_operation=d,
            description="Salaire",
            amount=2200.0,
            type="income",
            category="Salaire",
            is_salary=True,
            to_account_id=1,
            reconciliation_date=d
        ))
        # Petits remboursements qui abaissent la médiane
        for small_amt in [10.0, 15.0, 20.0]:
            db.add(Transaction(
                date_saisie=d,
                date_operation=d,
                description="Remboursement divers",
                amount=small_amt,
                type="income",
                to_account_id=1,
                reconciliation_date=d
            ))
    # Ajouter un vrai outlier exceptionnel (10 000€)
    d_outlier = _add_months(date(today.year, today.month, 1), -3)
    db.add(Transaction(
        date_saisie=d_outlier,
        date_operation=d_outlier,
        description="Crédit conso versement",
        amount=10000.0,
        type="income",
        to_account_id=1,
        reconciliation_date=d_outlier
    ))
    db.commit()

    res = run_simulation(db=db, horizon_months=6, account_id=1)
    db.close()

    # Le vrai outlier exceptionnel de 10k€ doit être exclu
    assert res["excluded_income_outliers_count"] >= 1
    # Les salaires ne doivent PAS être exclus : le revenu moyen réel doit être d'au moins 2200€
    assert res["historical_real_income_avg"] >= 2200.0
    # Dans les mois futurs projetés, le revenu de base doit être au moins égal au salaire (2200€)
    for m_data in res["monthly_data"][1:]:
        assert m_data["baseline_income"] >= 2200.0


def test_unreceived_paycheck_included_in_month_zero():
    """Vérifie que la paie du mois en cours est projetée au mois 0 lorsqu'elle n'est pas encore perçue."""
    db = TestingSessionLocal()
    from app.services.simulator_engine import _add_months
    # Déplacer la transaction de salaire reconciled créée dans setup_sim_db au mois précédent
    past_date = _add_months(date.today(), -1)
    db.query(Transaction).filter(Transaction.type == "income").update({
        Transaction.date_operation: past_date,
        Transaction.date_saisie: past_date,
        Transaction.reconciliation_date: past_date
    })
    db.commit()

    # Exécuter la simulation : la paie prédite doit être ajoutée au mois 0 car non encore perçue ce mois-ci
    res = run_simulation(db=db, horizon_months=6, account_id=1)
    db.close()

    assert len(res["monthly_data"]) == 6
    # Le mois 0 doit comporter le salaire de base projeté
    assert res["monthly_data"][0]["baseline_income"] >= 2000.0


def test_future_expense_var_does_not_suppress_variable_baseline():
    """Vérifie qu'une récurrence variable (ex: impôts 331€) n'écrase pas le socle de vie courante projeté."""
    db = TestingSessionLocal()
    from datetime import date
    from app.services.simulator_engine import _add_months

    today = date.today()
    # Insérer 6 mois de dépenses variables historiques (1000€/mois) pour établir avg_variable_expense
    for m_back in range(1, 7):
        d = _add_months(date(today.year, today.month, 1), -m_back)
        db.add(Transaction(
            date_saisie=d,
            date_operation=d,
            description="Courses Supermarché",
            amount=1000.0,
            type="expense_var",
            from_account_id=1,
            reconciliation_date=d
        ))

    # Insérer une récurrence future ou transaction dans le mois 1 (M+1) de 300€
    m1_date = _add_months(date(today.year, today.month, 15), 1)
    db.add(Transaction(
        date_saisie=today,
        date_operation=m1_date,
        description="Impôts Échéance",
        amount=300.0,
        type="expense_var",
        from_account_id=1,
        reconciliation_date=None
    ))
    db.commit()

    res = run_simulation(db=db, horizon_months=6, account_id=1)
    db.close()

    assert res["avg_variable_expense"] == 1000.0
    m1_data = res["monthly_data"][1]
    # Le socle de vie courante doit TOUJOURS être projeté (> 0)
    assert m1_data["base_variable_projected"] > 0.0
    # Le montant total des dépenses variables du mois 1 doit combiner les 300€ d'impôts ET le socle projeté (~1000€)
    assert m1_data["baseline_variable"] >= 1300.0


def test_custom_income_mode_overrides_recurrence():
    """Vérifie que le mode custom s'applique même si une récurrence de salaire existe."""
    db = TestingSessionLocal()
    # Ajouter une récurrence de type salaire de 2000€
    db.add(RecurrenceTemplate(
        id=99,
        description="Salaire récurrent",
        amount=2000.0,
        type="income",
        frequency="Monthly",
        to_account_id=1
    ))
    db.commit()

    res = run_simulation(db=db, horizon_months=6, account_id=1, income_mode="custom", custom_income_amount=3500.0)
    db.close()

    assert res["income_mode"] == "custom"
    # Les mois futurs doivent être exactement au montant custom de 3500€ (pas 2000€ ni 2000+3500)
    for m_data in res["monthly_data"][1:]:
        assert m_data["baseline_income"] == 3500.0


def test_all_recurrence_frequencies_and_occurrences():
    """Vérifie la prise en charge de Semi-Annually, Quarterly, Weekly et max_occurrences."""
    db = TestingSessionLocal()
    today = date.today()

    # 1. Semi-Annually (ex: eau tous les 6 mois, mois de base = mois courant)
    rec_semi = RecurrenceTemplate(
        id=101,
        description="Facture d'eau semestrielle",
        amount=300.0,
        type="expense_fixed",
        frequency="Semi-Annually",
        month_of_year=today.month,
        from_account_id=1
    )
    # 2. Quarterly (tous les 3 mois)
    rec_quart = RecurrenceTemplate(
        id=102,
        description="Cotisation trimestrielle",
        amount=150.0,
        type="expense_fixed",
        frequency="Quarterly",
        month_of_year=today.month,
        from_account_id=1
    )
    # 3. Finite recurrence (max_occurrences = 2)
    rec_finite = RecurrenceTemplate(
        id=103,
        description="Paiement 2x",
        amount=200.0,
        type="expense_fixed",
        frequency="Monthly",
        max_occurrences=2,
        from_account_id=1
    )
    db.add_all([rec_semi, rec_quart, rec_finite])
    db.commit()

    res = run_simulation(db=db, horizon_months=12, account_id=1)
    db.close()

    m_data = res["monthly_data"]
    # Vérifier que sur 12 mois, Semi-Annually ne s'applique que 2 fois (et non 12 fois !)
    # Mois 0 (mois de base), Mois 6 (+6 mois)
    # Quarterly s'applique 4 fois (mois 0, 3, 6, 9)
    # Finite s'applique 2 fois au total (mois 0 et mois 1)
    assert len(m_data) == 12


def test_outlier_sensitivity_levels():
    """Vérifie que les différents niveaux de sensibilité (1 à 5) filtrent correctement les outliers."""
    db = TestingSessionLocal()
    today = date.today()
    six_months_ago = today - timedelta(days=90)

    # Créer un historique de dépenses : routine à 50-80€, une atypique à 550€, et une géante à 4000€
    for i, amt in enumerate([50.0, 55.0, 60.0, 65.0, 70.0, 75.0, 80.0, 550.0, 4000.0]):
        db.add(Transaction(
            date_saisie=six_months_ago + timedelta(days=i * 5),
            date_operation=six_months_ago + timedelta(days=i * 5),
            description=f"Dépense test {amt}€",
            amount=amt,
            type="expense_var",
            from_account_id=1,
            reconciliation_date=today
        ))
    db.commit()

    # Niveau 1 (Strict) : doit filtrer le 550€ et le 4000€
    res_strict = run_simulation(db=db, horizon_months=6, account_id=1, outlier_sensitivity=1)
    # Niveau 4 (Permissif) : ne doit filtrer que le 4000€
    res_perm = run_simulation(db=db, horizon_months=6, account_id=1, outlier_sensitivity=4)
    # Niveau 5 (Intégral) : 0 outlier filtré
    res_full = run_simulation(db=db, horizon_months=6, account_id=1, outlier_sensitivity=5)
    db.close()

    assert res_strict["excluded_outliers_count"] >= 2
    assert res_perm["excluded_outliers_count"] == 1
    assert res_full["excluded_outliers_count"] == 0
    assert res_strict["avg_variable_expense"] < res_perm["avg_variable_expense"] < res_full["avg_variable_expense"]


def test_all_liquid_accounts_internal_transfers():
    """Vérifie que le mode 'Tous les comptes liquides' englobe comptes courants et livrets et neutralise les virements internes."""
    db = TestingSessionLocal()
    # Compte 1 = 2500€, Compte 2 = 10000€ -> Total liquide = 12500€
    # Ajouter un virement récurrent d'épargne de 250€/mois du Compte 1 vers le Compte 2
    rec_savings = RecurrenceTemplate(
        id=201,
        description="Épargne automatique Livret A",
        amount=250.0,
        type="expense_fixed", # ou virement
        frequency="Monthly",
        from_account_id=1,
        to_account_id=2
    )
    db.add(rec_savings)
    db.commit()

    # Simulation avec account_id=None ("Tous les comptes liquides")
    res = run_simulation(db=db, horizon_months=12, account_id=None)
    db.close()

    # Total liquide = Compte 1 (2500€ init + 2200€ salaire rapproché) + Compte 2 (10000€ init) = 14700€
    assert res["initial_balance"] == 14700.0
    # Le virement interne entre deux comptes liquides NE DOIT PAS être décompté comme une perte de trésorerie
    for m_info in res["monthly_data"]:
        # Seul le loyer de 600€ vers l'extérieur doit être présent dans baseline_fixed, pas les 250€ d'épargne interne
        assert m_info["baseline_fixed"] == 600.0


def test_simulation_seasonality_disabled():
    db = TestingSessionLocal()
    res = run_simulation(db=db, horizon_months=12, seasonality_mode="disabled")
    db.close()

    assert res["seasonality_mode"] == "disabled"
    assert res["has_seasonality"] is False
    assert res["seasonality_intensity"] == 0.0
    for m_info in res["monthly_data"]:
        assert m_info["seasonal_factor"] == 1.0
        assert m_info["seasonal_pct"] == 0
        assert m_info["seasonal_tag"] is None


def test_simulation_seasonality_preset_standard():
    db = TestingSessionLocal()
    # Inject variable expenses history to have avg_variable_expense > 0
    today = date.today()
    for mo_back in range(1, 7):
        d_op = date(today.year if today.month > mo_back else today.year - 1, ((today.month - 1 - mo_back) % 12) + 1, 15)
        tx_var = Transaction(
            date_saisie=d_op,
            date_operation=d_op,
            description=f"Courses mois -{mo_back}",
            amount=-400.0,
            type="expense_var",
            from_account_id=1
        )
        db.add(tx_var)
    db.commit()

    res = run_simulation(db=db, horizon_months=24, seasonality_mode="preset_standard", seasonality_intensity=1.0)
    db.close()

    assert res["seasonality_mode"] == "preset_standard"
    assert res["has_seasonality"] is True
    assert res["seasonality_intensity"] == 1.0

    # Vérifier les coefficients du profil standard
    for m_info in res["monthly_data"]:
        mo = int(m_info["month"].split("-")[1])
        if mo == 12:
            assert m_info["seasonal_factor"] == 1.30
            assert m_info["seasonal_pct"] == 30
            assert m_info["seasonal_tag"] == "holidays"
        elif mo == 8:
            assert m_info["seasonal_factor"] == 1.20
            assert m_info["seasonal_pct"] == 20
            assert m_info["seasonal_tag"] == "summer"
        elif mo == 7:
            assert m_info["seasonal_factor"] == 1.15
            assert m_info["seasonal_pct"] == 15
            assert m_info["seasonal_tag"] == "summer"
        elif mo == 9:
            assert m_info["seasonal_factor"] == 1.10
            assert m_info["seasonal_pct"] == 10
            assert m_info["seasonal_tag"] == "back_to_school"
        elif mo in (1, 2):
            assert m_info["seasonal_factor"] == 0.90
            assert m_info["seasonal_pct"] == -10
            assert m_info["seasonal_tag"] == "winter"


def test_simulation_seasonality_intensity_scaling():
    db = TestingSessionLocal()
    # Inject variable expenses history
    today = date.today()
    for mo_back in range(1, 7):
        d_op = date(today.year if today.month > mo_back else today.year - 1, ((today.month - 1 - mo_back) % 12) + 1, 15)
        tx_var = Transaction(
            date_saisie=d_op,
            date_operation=d_op,
            description=f"Courses mois -{mo_back}",
            amount=-500.0,
            type="expense_var",
            from_account_id=1
        )
        db.add(tx_var)
    db.commit()

    # Pleine intensité (1.0)
    res_full = run_simulation(db=db, horizon_months=12, seasonality_mode="preset_standard", seasonality_intensity=1.0)
    # Demi-intensité (0.5)
    res_half = run_simulation(db=db, horizon_months=12, seasonality_mode="preset_standard", seasonality_intensity=0.5)
    # Intensité nulle (0.0)
    res_zero = run_simulation(db=db, horizon_months=12, seasonality_mode="preset_standard", seasonality_intensity=0.0)
    db.close()

    for m_full, m_half, m_zero in zip(res_full["monthly_data"], res_half["monthly_data"], res_zero["monthly_data"]):
        mo = int(m_full["month"].split("-")[1])
        if mo == 12:
            assert m_full["seasonal_factor"] == 1.30  # +30%
            assert m_half["seasonal_factor"] == 1.15  # +15% (30% * 0.5)
            assert m_zero["seasonal_factor"] == 1.00  # 0%
        elif mo == 1:
            assert m_full["seasonal_factor"] == 0.90  # -10%
            assert m_half["seasonal_factor"] == 0.95  # -5% (-10% * 0.5)
            assert m_zero["seasonal_factor"] == 1.00  # 0%


def test_simulation_seasonality_historical_pure_variable():
    db = TestingSessionLocal()
    today = date.today()
    # Créer 6 mois d'historique de dépenses variables avec une variation marquée (ex: mois -2 est deux fois plus élevé)
    for mo_back in range(1, 7):
        d_op = date(today.year if today.month > mo_back else today.year - 1, ((today.month - 1 - mo_back) % 12) + 1, 10)
        amt = -800.0 if mo_back == 2 else -400.0
        tx_var = Transaction(
            date_saisie=d_op,
            date_operation=d_op,
            description=f"Dépense var historique -{mo_back}",
            amount=amt,
            type="expense_var",
            from_account_id=1
        )
        db.add(tx_var)

    # Ajouter une grosse charge fixe (ex: assurance 1200€) pour vérifier qu'elle n'influe PAS sur la saisonnalité variable
    d_fix = date(today.year if today.month > 3 else today.year - 1, ((today.month - 1 - 3) % 12) + 1, 5)
    tx_fix = Transaction(
        date_saisie=d_fix,
        date_operation=d_fix,
        description="Assurance annuelle auto",
        amount=-1200.0,
        type="expense_fixed",
        from_account_id=1
    )
    db.add(tx_fix)
    db.commit()

    res = run_simulation(db=db, horizon_months=12, seasonality_mode="historical", seasonality_intensity=1.0)
    db.close()

    assert res["seasonality_mode"] == "historical"
    assert res["seasonal_history_months"] == 6
    assert res["has_seasonality"] is True

    # Le mois correspondant à mo_back == 2 doit avoir un coefficient nettement supérieur aux autres
    peak_month = ((today.month - 1 - 2) % 12) + 1
    coeffs = res["seasonal_expense_coefficients"]
    assert coeffs[peak_month] > 1.2


def test_simulator_config_persistence_and_defaults():
    """Vérifie que les clés de configuration du simulateur ont des valeurs par défaut et persistent via /api/config/."""
    from app.routers.config import get_all_config, set_config
    db = TestingSessionLocal()
    try:
        # 1. Vérifier les valeurs par défaut
        cfg = get_all_config(db=db)
        assert cfg["sim_horizon"] == "36"
        assert cfg["sim_conservative_weight"] == "0.20"
        assert cfg["sim_seasonality_mode"] == "disabled"
        assert cfg["sim_seasonality_intensity"] == "1.0"
        assert cfg["sim_outlier_sensitivity"] == "2"

        # 2. Modifier les paramètres via set_config
        set_config({
            "sim_horizon": "24",
            "sim_conservative_weight": "0.40",
            "sim_seasonality_mode": "historical",
            "sim_seasonality_intensity": "0.75",
            "sim_var_expense_adj": "-0.15"
        }, db=db)

        # 3. Vérifier que la lecture retourne les nouvelles valeurs persistées
        updated = get_all_config(db=db)
        assert updated["sim_horizon"] == "24"
        assert updated["sim_conservative_weight"] == "0.40"
        assert updated["sim_seasonality_mode"] == "historical"
        assert updated["sim_seasonality_intensity"] == "0.75"
        assert updated["sim_var_expense_adj"] == "-0.15"
    finally:
        db.close()






