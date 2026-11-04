"""Simulateur : une projection sur un compte précis ne porte que sur les flux de ce compte.

Données synthétiques. Chaque test reproduit un écart mesuré entre la projection et ce que ce compte
reçoit ou paie réellement (livret qui subit les enveloppes du profil, charges du mois en cours oubliées…).
"""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account, Budget, BudgetCategory, Category, GlobalConfig, RecurrenceTemplate, Scenario, ScenarioEvent, Transaction,
)
from app.services.simulator_engine import _add_months, run_simulation

COURANT, LIVRET, VIDE = 1, 2, 3
SALAIRE = 2000.0
VIREMENT = 250.0

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _month_start(offset=0):
    return _add_months(date.today().replace(day=1), offset)


def _tx(db, offset, amount, type_, from_acc=None, to_acc=None, reconciled=True, day=10, **kw):
    when = _month_start(offset).replace(day=day)
    tx = Transaction(
        date_saisie=when, date_operation=when, description=kw.pop("description", type_), amount=amount, type=type_,
        from_account_id=from_acc, to_account_id=to_acc, reconciliation_date=when if reconciled else None, **kw
    )
    db.add(tx)
    return tx


def _salary_history(db, months=6, amount=SALAIRE, to_acc=COURANT):
    for offset in range(-months, 0):
        _tx(db, offset, amount, "income", to_acc=to_acc, is_salary=True, category="Salaire", day=15)


def _expense_history(db, months=6, amount=100.0, acc=COURANT):
    for offset in range(-months, 0):
        _tx(db, offset, amount, "expense_var", from_acc=acc, category="Courses", day=5)


def _monthly_transfer(db):
    db.add(RecurrenceTemplate(
        description="Epargne", amount=VIREMENT, type="transfer", frequency="Monthly", day_of_month=14,
        from_account_id=COURANT, to_account_id=LIVRET,
    ))


def _envelopes(db):
    """Une enveloppe de chaque période, pour un total brut de 11 300 €."""
    db.add_all([
        Budget(name="Mensuelle", monthly_amount=300.0, period="monthly", envelope_type="spending"),
        Budget(name="Annuelle", monthly_amount=1200.0, period="yearly", envelope_type="spending"),
        Budget(name="Sans terme", monthly_amount=8000.0, period="indefinite", envelope_type="spending"),
        Budget(name="Tirelire", monthly_amount=1800.0, period="indefinite", envelope_type="savings"),
    ])


@pytest.fixture
def db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    session.add_all([
        Account(id=COURANT, name="Courant", type="Compte courant", initial_balance=1000.0),
        Account(id=LIVRET, name="Epargne", type="Livret", initial_balance=5000.0),
        Account(id=VIDE, name="Sans operation", type="Compte courant", initial_balance=300.0),
    ])
    session.add(GlobalConfig(key="pay_category", value="Salaire"))
    session.add(Category(name="Salaire", type="income"))
    session.commit()
    yield session
    session.close()
    Base.metadata.drop_all(bind=engine)


def _run(db, account_id=None, horizon=12, weight=1.0, **kw):
    return run_simulation(db=db, horizon_months=horizon, account_id=account_id, conservative_weight=weight, **kw)


# ── Dépenses variables d'un compte sans historique ───────────────────────────────────────────────

def test_savings_account_does_not_inherit_profile_envelopes(db):
    _salary_history(db)
    _expense_history(db)
    _envelopes(db)
    _monthly_transfer(db)
    db.commit()

    res = _run(db, LIVRET)

    assert res["avg_variable_expense"] == 0.0
    assert res["simulated_final_balance"] == pytest.approx(5000.0 + 12 * VIREMENT)
    assert res["first_overdraft_date"] is None
    assert not res["is_overdraft_risk"]
    assert res["break_even_monthly_saving"] == 0.0


def test_account_without_any_flow_stays_flat(db):
    _salary_history(db)
    _expense_history(db)
    _envelopes(db)
    db.commit()

    res = _run(db, VIDE)

    assert res["simulated_final_balance"] == pytest.approx(300.0)
    assert res["avg_simulated_net"] == pytest.approx(0.0)


def test_whole_treasury_cold_start_uses_monthly_equivalents(db):
    """Sans historique, le global part des enveloppes, ramenées au mois : pas les montants bruts."""
    _salary_history(db)
    _envelopes(db)
    db.add(Budget(name="Fenetre", monthly_amount=600.0, period="custom", envelope_type="spending",
                  start_date=_month_start(0), end_date=_month_start(3) - timedelta(days=1)))
    db.commit()

    res = _run(db)

    # 300 mensuels + 1200/12 annuels + 600/3 sur fenêtre ; l'enveloppe sans terme et la tirelire n'ont pas de rythme.
    assert res["avg_variable_expense"] == pytest.approx(300.0 + 100.0 + 200.0)


def test_whole_treasury_cold_start_ignores_fixed_charge_envelopes(db):
    """Les charges fixes sont déjà projetées par les récurrences : les compter deux fois fausserait le socle."""
    _salary_history(db)
    db.add(Category(name="Loyer", type="expense_fixed"))
    db.add(Category(name="Courses", type="expense_var"))
    fixed = Budget(name="Logement", monthly_amount=700.0, period="monthly", envelope_type="spending")
    free = Budget(name="Vie courante", monthly_amount=300.0, period="monthly", envelope_type="spending")
    db.add_all([fixed, free])
    db.flush()
    db.add(BudgetCategory(budget_id=fixed.id, category_name="Loyer"))
    db.add(BudgetCategory(budget_id=free.id, category_name="Courses"))
    db.commit()

    assert _run(db)["avg_variable_expense"] == pytest.approx(300.0)


def test_single_account_profile_gives_same_result_as_whole_treasury(db):
    db.query(Account).filter(Account.id != COURANT).delete()
    _salary_history(db)
    _envelopes(db)
    db.commit()

    whole, target = _run(db), _run(db, COURANT)

    assert target["avg_variable_expense"] == whole["avg_variable_expense"] > 0
    assert target["simulated_final_balance"] == whole["simulated_final_balance"]


# ── Mois en cours ────────────────────────────────────────────────────────────────────────────────

def test_month_zero_counts_unreconciled_fixed_charges_and_transfers(db):
    _salary_history(db)
    _expense_history(db)
    rec = RecurrenceTemplate(description="Loyer", amount=700.0, type="expense_fixed", frequency="Monthly",
                             from_account_id=COURANT)
    transfer = RecurrenceTemplate(description="Epargne", amount=VIREMENT, type="transfer", frequency="Monthly",
                                  from_account_id=COURANT, to_account_id=LIVRET)
    db.add_all([rec, transfer])
    db.flush()
    _tx(db, 0, 700.0, "expense_fixed", from_acc=COURANT, reconciled=False, recurrence_id=rec.id)
    _tx(db, 0, VIREMENT, "transfer", from_acc=COURANT, to_acc=LIVRET, reconciled=False, recurrence_id=transfer.id)
    db.commit()

    current = _run(db, COURANT)["monthly_data"][0]
    whole = _run(db)["monthly_data"][0]

    assert current["baseline_fixed"] == pytest.approx(700.0 + VIREMENT)
    assert whole["baseline_fixed"] == pytest.approx(700.0)


def test_month_zero_counts_unreconciled_operations_from_previous_months(db):
    """Une opération non rapprochée d'un mois passé n'est pas dans le solde de départ : elle reste à venir."""
    _salary_history(db)
    _expense_history(db)
    _tx(db, -1, 40.0, "expense_fixed", from_acc=COURANT, reconciled=False)
    _tx(db, -1, 60.0, "expense_var", from_acc=COURANT, reconciled=False)
    db.commit()

    without_old = run_simulation(db=db, horizon_months=2, account_id=COURANT, conservative_weight=1.0)
    month_zero = without_old["monthly_data"][0]

    assert month_zero["baseline_fixed"] == pytest.approx(40.0)
    assert month_zero["baseline_variable"] == pytest.approx(60.0 + month_zero["variable_expense_projected"])


def test_old_unreconciled_salary_does_not_hide_this_month_paycheck(db):
    _salary_history(db)
    _expense_history(db)
    _tx(db, -1, SALAIRE, "income", to_acc=COURANT, reconciled=False, is_salary=False, description="Virement recu")
    db.commit()

    month_zero = _run(db, COURANT)["monthly_data"][0]

    assert month_zero["baseline_income"] == pytest.approx(SALAIRE + SALAIRE)


def test_month_zero_does_not_count_a_recurring_transfer_twice(db):
    _salary_history(db)
    _monthly_transfer(db)
    db.commit()

    assert _run(db, LIVRET)["monthly_data"][0]["baseline_income"] == pytest.approx(VIREMENT)


def test_month_zero_without_salary_does_not_double_recurring_income(db):
    """Sans paie détectée sur le profil, la recette récurrente du mois n'est comptée qu'une fois."""
    db.add(RecurrenceTemplate(description="Loyer percu", amount=400.0, type="income", frequency="Monthly",
                              to_account_id=COURANT))
    db.commit()

    assert _run(db, COURANT)["monthly_data"][0]["baseline_income"] == pytest.approx(400.0)


# ── Récurrences et virements ─────────────────────────────────────────────────────────────────────

def test_recurring_salary_on_another_account_keeps_savings_inflows(db):
    _salary_history(db)
    db.add(RecurrenceTemplate(description="Salaire", amount=SALAIRE, type="income", frequency="Monthly",
                              to_account_id=COURANT))
    _monthly_transfer(db)
    db.commit()

    months = _run(db, LIVRET)["monthly_data"]

    assert [m["baseline_income"] for m in months] == [pytest.approx(VIREMENT)] * 12


def test_recurring_salary_keeps_other_recurring_income_of_the_account(db):
    _salary_history(db)
    db.add(RecurrenceTemplate(description="Salaire", amount=SALAIRE, type="income", frequency="Monthly",
                              to_account_id=COURANT))
    db.add(RecurrenceTemplate(description="Loyer percu", amount=400.0, type="income", frequency="Monthly",
                              to_account_id=COURANT))
    db.commit()

    assert _run(db, COURANT)["monthly_data"][1]["baseline_income"] == pytest.approx(SALAIRE + 400.0)


@pytest.mark.parametrize("weight", [1.0, 0.2, 0.0])
def test_planned_transfers_count_at_any_prudence(db, weight):
    _salary_history(db)
    _expense_history(db)
    _monthly_transfer(db)
    db.add(RecurrenceTemplate(description="Assurance", amount=80.0, type="expense_fixed", frequency="Monthly",
                              from_account_id=COURANT))
    for offset in range(-6, 0):
        _tx(db, offset, 80.0, "expense_fixed", from_acc=COURANT, category="Assurance", day=3)
    db.commit()

    current = _run(db, COURANT, weight=weight)["monthly_data"][1]
    savings = _run(db, LIVRET, weight=weight)["monthly_data"][1]

    assert current["baseline_fixed"] == pytest.approx(80.0 + VIREMENT)
    assert savings["baseline_income"] == pytest.approx(VIREMENT)


@pytest.mark.parametrize("weight", [1.0, 0.0])
def test_accounts_add_up_to_whole_treasury(db, weight):
    _salary_history(db)
    _expense_history(db)
    _monthly_transfer(db)
    db.commit()

    whole = _run(db, weight=weight)["simulated_final_balance"]
    parts = sum(_run(db, acc, weight=weight)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert parts == pytest.approx(whole)


# ── Recettes ponctuelles ─────────────────────────────────────────────────────────────────────────

def test_yearly_interest_is_not_repeated_every_month(db):
    _salary_history(db)
    _tx(db, -13, 500.0, "transfer", from_acc=COURANT, to_acc=LIVRET)
    _tx(db, -3, 120.0, "income", to_acc=LIVRET, category="Interets")
    db.commit()

    res = _run(db, LIVRET, weight=0.0)
    interest_month = _month_start(-3).month
    by_month = {int(m["month"][5:]): m["baseline_income"] for m in res["monthly_data"]}

    assert res["historical_real_income_avg"] == pytest.approx(120.0 / 12)
    assert by_month[interest_month] == pytest.approx(120.0)
    assert sum(by_month.values()) == pytest.approx(120.0)


def test_recent_account_income_stays_averaged(db):
    """Moins d'un an d'historique : un mois sans donnée n'est pas un mois sans recette."""
    _salary_history(db, months=2)
    db.commit()

    res = _run(db, COURANT, weight=0.0)

    assert res["historical_real_income_avg"] == pytest.approx(SALAIRE)
    assert all(m["baseline_income"] == pytest.approx(SALAIRE) for m in res["monthly_data"][1:])


# ── Événements ───────────────────────────────────────────────────────────────────────────────────

def _scenario_with_event(db, account_id):
    scenario = Scenario(name="Test", is_active=True)
    db.add(scenario)
    db.flush()
    db.add(ScenarioEvent(scenario_id=scenario.id, label="Achat", event_type="one_off_expense", amount=1000.0,
                         account_id=account_id, start_date=_month_start(1), duration_months=1, is_active=True))
    db.commit()
    return scenario.id


def test_event_only_applies_to_its_own_account(db):
    scenario_id = _scenario_with_event(db, COURANT)

    other = _run(db, LIVRET, scenario_id=scenario_id)
    own = _run(db, COURANT, scenario_id=scenario_id)
    whole = _run(db, scenario_id=scenario_id)

    assert other["total_difference"] == 0.0
    assert other["events_count"] == 0
    assert own["total_difference"] == pytest.approx(-1000.0)
    assert whole["total_difference"] == pytest.approx(-1000.0)


def test_event_without_account_applies_to_the_projected_account(db):
    scenario_id = _scenario_with_event(db, None)

    assert _run(db, LIVRET, scenario_id=scenario_id)["total_difference"] == pytest.approx(-1000.0)


# ── Salaire affiché ──────────────────────────────────────────────────────────────────────────────

def test_salary_is_only_reported_on_the_account_receiving_it(db):
    _salary_history(db)
    db.commit()

    assert _run(db, COURANT)["predicted_salary"] == pytest.approx(SALAIRE)
    assert _run(db)["predicted_salary"] == pytest.approx(SALAIRE)
    assert _run(db, LIVRET)["predicted_salary"] == 0.0


# ── Mode organisation ────────────────────────────────────────────────────────────────────────────

def _organisation_with_yearly_grant(db, amount=50000.0):
    db.add(GlobalConfig(key="enable_org_mode", value="true"))
    _tx(db, -3, amount, "income", to_acc=COURANT, is_salary=True, category="Salaire", description="Dotation")
    db.commit()


def test_organisation_yearly_grant_is_a_yearly_income(db):
    _organisation_with_yearly_grant(db)

    res = _run(db, COURANT, weight=0.0)
    grant_month = _month_start(-3).month
    by_month = {int(m["month"][5:]): m["baseline_income"] for m in res["monthly_data"]}

    assert by_month[grant_month] == pytest.approx(50000.0)
    assert sum(by_month.values()) == pytest.approx(50000.0)
    assert res["simulated_final_balance"] == pytest.approx(1000.0 + 50000.0 + 50000.0)


def test_organisation_grant_is_not_reported_as_a_monthly_salary(db):
    _organisation_with_yearly_grant(db)

    assert _run(db, COURANT)["predicted_salary"] == 0.0


def test_organisation_grant_only_reaches_the_receiving_account(db):
    _organisation_with_yearly_grant(db)

    assert _run(db, LIVRET)["simulated_final_balance"] == pytest.approx(5000.0)


def test_personal_mode_salary_stays_monthly(db):
    _tx(db, -3, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire")
    db.commit()

    months = _run(db, COURANT)["monthly_data"]

    assert all(m["baseline_income"] == pytest.approx(SALAIRE) for m in months)


# ── Moyennes sur les mois écoulés ────────────────────────────────────────────────────────────────

def test_variable_average_divides_by_elapsed_months(db):
    """Un mois sans dépense compte dans la moyenne : ce n'est pas un mois sans donnée."""
    _salary_history(db)
    for offset in (-6, -5, -4):
        _tx(db, offset, 300.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    db.commit()

    res = _run(db, COURANT)

    assert res["variable_expense_history_months"] == 6
    assert res["avg_variable_expense"] == pytest.approx(150.0)


def test_variable_average_of_a_young_treasury_uses_its_own_months(db):
    for offset in (-2, -1):
        _tx(db, offset, 300.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    db.commit()

    res = _run(db, COURANT)

    assert res["variable_expense_history_months"] == 2
    assert res["avg_variable_expense"] == pytest.approx(300.0)


def test_rare_fixed_charge_is_not_repeated_every_month(db):
    _salary_history(db, months=13)
    _tx(db, -4, 1200.0, "expense_fixed", from_acc=COURANT, category="Taxe")
    db.commit()

    res = _run(db, COURANT, weight=0.0)
    charge_month = _month_start(-4).month
    by_month = {int(m["month"][5:]): m["baseline_fixed"] for m in res["monthly_data"]}

    assert res["historical_real_fixed_avg"] == pytest.approx(100.0)
    assert by_month[charge_month] == pytest.approx(1200.0)
    assert sum(by_month.values()) == pytest.approx(1200.0)


def test_personal_every_month_spending_keeps_the_same_average(db):
    _salary_history(db)
    _expense_history(db, amount=250.0)
    db.commit()

    assert _run(db, COURANT)["avg_variable_expense"] == pytest.approx(250.0)


# ── Grosses dépenses en mode organisation ────────────────────────────────────────────────────────

def _organisation(db):
    db.add(GlobalConfig(key="enable_org_mode", value="true"))


def _org_small_expenses(db, months=12, amount=100.0, acc=COURANT):
    for offset in range(-months, 0):
        _tx(db, offset, amount, "expense_var", from_acc=acc, category="Billetterie", day=5)


def test_organisation_counts_a_yearly_large_expense(db):
    _organisation(db)
    _org_small_expenses(db, months=30)
    _tx(db, -8, 30000.0, "expense_var", from_acc=COURANT, category="Cheques vacances")
    _tx(db, -20, 28000.0, "expense_var", from_acc=COURANT, category="Cheques vacances")
    db.commit()

    res = _run(db, COURANT)

    assert res["excluded_outliers_count"] == 0
    assert res["avg_variable_expense"] == pytest.approx((12 * 100.0 + 30000.0) / 12)


def test_organisation_keeps_a_large_expense_without_two_years_of_history(db):
    """Sur la première année, rien ne dit qu'une grosse dépense ne reviendra pas."""
    _organisation(db)
    _org_small_expenses(db, months=12)
    _tx(db, -8, 30000.0, "expense_var", from_acc=COURANT, category="Cheques vacances")
    db.commit()

    assert _run(db, COURANT)["avg_variable_expense"] == pytest.approx((12 * 100.0 + 30000.0) / 12)


def test_organisation_sets_aside_an_isolated_exceptional_expense(db):
    _organisation(db)
    _org_small_expenses(db, months=30)
    _tx(db, -8, 50000.0, "expense_var", from_acc=COURANT, category="Travaux du local")
    db.commit()

    res = _run(db, COURANT)

    assert res["excluded_outliers_count"] == 1
    assert res["excluded_outliers_total"] == pytest.approx(50000.0)
    assert res["avg_variable_expense"] == pytest.approx(100.0)


def test_organisation_keeps_a_modest_one_off_expense(db):
    _organisation(db)
    _org_small_expenses(db, months=30, amount=1000.0)
    _tx(db, -8, 900.0, "expense_var", from_acc=COURANT, category="Ordinateur")
    db.commit()

    res = _run(db, COURANT)

    assert res["excluded_outliers_count"] == 0
    assert res["avg_variable_expense"] == pytest.approx((12 * 1000.0 + 900.0) / 12)


def test_personal_mode_still_sets_aside_large_expenses(db):
    _salary_history(db)
    for offset in range(-6, 0):
        for _ in range(3):
            _tx(db, offset, 100.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    _tx(db, -2, 9000.0, "expense_var", from_acc=COURANT, category="Voiture")
    _tx(db, -14, 8000.0, "expense_var", from_acc=COURANT, category="Voiture")
    db.commit()

    res = _run(db, COURANT)

    assert res["excluded_outliers_count"] == 1
    assert res["avg_variable_expense"] == pytest.approx(300.0)


def test_organisation_income_does_not_depend_on_the_pay_day(db):
    """Une dotation arrive à la date de l'employeur : elle ne doit pas passer pour une paie pour être projetée."""
    _organisation(db)
    _org_small_expenses(db, months=12)
    _tx(db, -3, 60000.0, "income", to_acc=COURANT, category="Dotation", day=12)
    db.commit()

    months = _run(db, COURANT, weight=0.0)["monthly_data"]

    assert sum(m["baseline_income"] for m in months) == pytest.approx(60000.0)


def test_organisation_sets_aside_an_isolated_exceptional_income(db):
    _organisation(db)
    _org_small_expenses(db, months=30)
    _tx(db, -3, 60000.0, "income", to_acc=COURANT, category="Dotation", day=12)
    _tx(db, -15, 58000.0, "income", to_acc=COURANT, category="Dotation", day=12)
    _tx(db, -5, 20000.0, "income", to_acc=COURANT, category="Don exceptionnel", day=12)
    db.commit()

    res = _run(db, COURANT, weight=0.0)

    assert res["excluded_income_outliers_count"] == 1
    assert sum(m["baseline_income"] for m in res["monthly_data"]) == pytest.approx(60000.0)


# ── Curseur de prudence en mode organisation ─────────────────

def _org_two_years(db, last_grant=60000.0, previous_grant=50000.0, last_exp=1000.0, previous_exp=1000.0):
    _organisation(db)
    _tx(db, -3, last_grant, "income", to_acc=COURANT, category="Dotation", day=12)
    _tx(db, -15, previous_grant, "income", to_acc=COURANT, category="Dotation", day=12)
    for offset in range(-12, 0):
        _tx(db, offset, last_exp, "expense_var", from_acc=COURANT, category="Sorties", day=5)
    for offset in range(-24, -12):
        _tx(db, offset, previous_exp, "expense_var", from_acc=COURANT, category="Sorties", day=5)
    db.commit()


def _yearly_income(res):
    return sum(m["baseline_income"] for m in res["monthly_data"])


def test_organisation_prudence_keeps_the_lowest_grant_of_two_years(db):
    _org_two_years(db)

    assert _yearly_income(_run(db, COURANT, weight=0.0)) == pytest.approx(60000.0)
    assert _yearly_income(_run(db, COURANT, weight=1.0)) == pytest.approx(50000.0)
    assert _yearly_income(_run(db, COURANT, weight=0.5)) == pytest.approx(55000.0)


def test_organisation_prudence_drops_income_that_did_not_come_back(db):
    _org_two_years(db, previous_grant=60000.0)
    _tx(db, -2, 5000.0, "income", to_acc=COURANT, category="Partenariat", day=12)
    db.commit()

    assert _yearly_income(_run(db, COURANT, weight=0.0, outlier_sensitivity=5)) == pytest.approx(65000.0)
    # La référence perd la part de la recette qui n'est pas revenue
    assert _yearly_income(_run(db, COURANT, weight=1.0, outlier_sensitivity=5)) == pytest.approx(65000.0 * 60000.0 / 65000.0)


def test_organisation_prudence_uses_the_most_expensive_year(db):
    _org_two_years(db, previous_exp=1500.0)

    real = _run(db, COURANT, weight=0.0)["monthly_data"][1]["baseline_expense"]
    prudent = _run(db, COURANT, weight=1.0)["monthly_data"][1]["baseline_expense"]

    assert real == pytest.approx(1000.0)
    assert prudent == pytest.approx(1500.0)


def test_organisation_prudence_does_not_erase_fixed_charges(db):
    _organisation(db)
    _tx(db, -3, 50000.0, "income", to_acc=COURANT, category="Dotation", day=12)
    for offset in range(-12, 0):
        _tx(db, offset, 800.0, "expense_fixed", from_acc=COURANT, category="Loyer", day=5)
    db.commit()

    assert _run(db, COURANT, weight=1.0)["monthly_data"][1]["baseline_expense"] >= 800.0


def test_organisation_prudence_applies_a_margin_without_a_year_to_compare(db):
    _organisation(db)
    _org_small_expenses(db, months=6)
    _tx(db, -3, 60000.0, "income", to_acc=COURANT, category="Dotation", day=12)
    db.commit()

    assert _yearly_income(_run(db, COURANT, weight=0.0)) == pytest.approx(60000.0)
    assert _yearly_income(_run(db, COURANT, weight=1.0)) == pytest.approx(54000.0)


@pytest.mark.parametrize("weight", [0.0, 0.5, 1.0])
def test_organisation_prudence_keeps_accounts_summing_to_the_global(db, weight):
    _org_two_years(db, previous_exp=1200.0)
    _tx(db, -4, 3000.0, "income", to_acc=LIVRET, category="Interets", day=12)
    _tx(db, -16, 2000.0, "income", to_acc=LIVRET, category="Interets", day=12)
    db.commit()

    whole = _run(db, weight=weight)["simulated_final_balance"]
    parts = sum(_run(db, acc, weight=weight)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert parts == pytest.approx(whole)


# ── Mode conseillé : seuls les achats hors norme sortent de la moyenne ──

def _regular_spending_with_big_purchases(db):
    _salary_history(db, months=6)
    for offset in range(-6, 0):
        for day in (3, 8, 13, 18, 23):
            _tx(db, offset, 30.0, "expense_var", from_acc=COURANT, category="Courses", day=day)
    _tx(db, -2, 500.0, "expense_var", from_acc=COURANT, category="Garage", day=20)
    _tx(db, -3, 18000.0, "expense_var", from_acc=COURANT, category="Voiture", day=20)
    db.commit()


def test_default_sensitivity_only_removes_exceptional_purchases(db):
    _regular_spending_with_big_purchases(db)

    res = run_simulation(db=db, horizon_months=12, account_id=COURANT, conservative_weight=1.0)

    assert res["outlier_sensitivity"] == 4
    assert res["excluded_outliers_count"] == 1
    assert res["excluded_outliers_total"] == pytest.approx(18000.0)
    assert res["avg_variable_expense"] == pytest.approx((30.0 * 5 * 6 + 500.0) / 6, abs=0.01)


def test_user_can_still_filter_harder_or_keep_everything(db):
    _regular_spending_with_big_purchases(db)

    assert _run(db, COURANT, outlier_sensitivity=2)["excluded_outliers_total"] == pytest.approx(18500.0)
    assert _run(db, COURANT, outlier_sensitivity=5)["excluded_outliers_total"] == 0.0


def test_planned_expense_is_never_exceptional(db):
    db.add(RecurrenceTemplate(id=7, description="Impot", amount=2000.0, type="expense_var", frequency="Monthly", day_of_month=2, from_account_id=COURANT))
    _salary_history(db, months=6)
    for offset in range(-6, 0):
        for day in (3, 8, 13, 18, 23):
            _tx(db, offset, 30.0, "expense_var", from_acc=COURANT, category="Courses", day=day)
        _tx(db, offset, 2000.0, "expense_var", from_acc=COURANT, category="Impots", day=2, recurrence_id=7)
    db.commit()

    assert _run(db, COURANT, outlier_sensitivity=1)["excluded_outliers_count"] == 0


# ── Revenu désactivé ou personnalisé : le mois en cours ──────

def _pay_not_received_yet(db):
    _salary_history(db)
    db.commit()


def test_no_income_mode_does_not_count_the_expected_pay_this_month(db):
    _pay_not_received_yet(db)

    assert _run(db, COURANT, income_mode="none")["monthly_data"][0]["baseline_income"] == 0.0


def test_custom_income_replaces_the_expected_pay_this_month(db):
    _pay_not_received_yet(db)

    month = _run(db, COURANT, income_mode="custom", custom_income_amount=3000.0)["monthly_data"][0]

    assert month["baseline_income"] == pytest.approx(3000.0)


def test_custom_income_is_not_added_when_the_pay_already_arrived(db):
    _salary_history(db)
    today = date.today()
    db.add(Transaction(date_saisie=today, date_operation=today, description="Paie", amount=SALAIRE, type="income",
                       to_account_id=COURANT, is_salary=True, category="Salaire", reconciliation_date=today))
    db.commit()

    month = _run(db, COURANT, income_mode="custom", custom_income_amount=3000.0)["monthly_data"][0]

    assert month["baseline_income"] == 0.0


# ── Historique récent ────────────────────────────────────────

def _young_profile(db):
    db.add(Budget(name="Courses", monthly_amount=500.0, period="monthly", envelope_type="spending"))
    _tx(db, -2, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=15)
    _tx(db, -1, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=15)
    _tx(db, -2, 50.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    db.commit()


def test_recent_history_completes_expenses_with_envelopes(db):
    _young_profile(db)

    res = _run(db)

    assert res["recent_history"] is True
    assert res["avg_variable_expense"] == pytest.approx(500.0)


def test_recent_history_keeps_accounts_summing_to_the_global(db):
    _young_profile(db)

    whole = _run(db)["simulated_final_balance"]
    parts = sum(_run(db, acc)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert _run(db, LIVRET)["avg_variable_expense"] == 0.0
    assert parts == pytest.approx(whole)


def test_recent_history_keeps_observed_spending_above_envelopes(db):
    _young_profile(db)
    _tx(db, -1, 1950.0, "expense_var", from_acc=COURANT, category="Travaux", day=6)
    db.commit()

    res = _run(db, outlier_sensitivity=5)

    assert res["avg_variable_expense"] == pytest.approx(1000.0)


def test_expense_recurrence_entered_as_negative_is_still_an_expense(db):
    _salary_history(db)
    db.add(RecurrenceTemplate(description="Loyer", amount=-800.0, type="expense_fixed", frequency="Monthly", day_of_month=2, from_account_id=COURANT))
    db.commit()

    assert _run(db, COURANT)["monthly_data"][1]["baseline_expense"] == pytest.approx(800.0)


def test_long_history_ignores_envelopes(db):
    _salary_history(db, months=8)
    _expense_history(db, months=8, amount=100.0)
    db.add(Budget(name="Courses", monthly_amount=900.0, period="monthly", envelope_type="spending"))
    db.commit()

    res = _run(db)

    assert res["recent_history"] is False
    assert res["avg_variable_expense"] == pytest.approx(100.0)


def test_organisation_month_zero_ignores_income_already_received(db):
    _organisation(db)
    _org_small_expenses(db, months=13)
    _tx(db, -12, 60000.0, "income", to_acc=COURANT, category="Dotation", day=2)
    _tx(db, 0, 60000.0, "income", to_acc=COURANT, category="Dotation", day=1)
    db.commit()

    assert _run(db, COURANT)["monthly_data"][0]["baseline_income"] == pytest.approx(0.0)


def test_organisation_repeats_the_yearly_transfer_between_accounts(db):
    _organisation(db)
    _org_small_expenses(db, months=12)
    _tx(db, -5, 8000.0, "transfer", from_acc=COURANT, to_acc=VIDE)
    db.commit()

    transfer_month = _month_start(-5).month
    sender = {int(m["month"][5:]): m["baseline_fixed"] for m in _run(db, COURANT)["monthly_data"]}
    receiver = {int(m["month"][5:]): m["baseline_income"] for m in _run(db, VIDE)["monthly_data"]}

    assert sender[transfer_month] == pytest.approx(8000.0)
    assert receiver[transfer_month] == pytest.approx(8000.0)
    assert _run(db)["monthly_data"][1]["baseline_fixed"] == 0.0


@pytest.mark.parametrize("weight", [1.0, 0.0])
def test_organisation_accounts_add_up_to_whole_treasury(db, weight):
    _organisation(db)
    _org_small_expenses(db, months=30, amount=200.0)
    for offset in (-3, -7, -11, -25):
        _tx(db, offset, 500.0, "expense_var", from_acc=VIDE, category="Materiel")
    _tx(db, -8, 30000.0, "expense_var", from_acc=COURANT, category="Cheques vacances")
    _tx(db, -20, 30000.0, "expense_var", from_acc=COURANT, category="Cheques vacances")
    _tx(db, -3, 60000.0, "income", to_acc=COURANT, category="Dotation", day=12)
    _tx(db, -2, 90.0, "income", to_acc=LIVRET, category="Interets", day=12)
    _tx(db, -5, 8000.0, "transfer", from_acc=COURANT, to_acc=VIDE)
    db.commit()

    whole = _run(db, weight=weight)["simulated_final_balance"]
    parts = sum(_run(db, acc, weight=weight)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert parts == pytest.approx(whole)


def test_personal_accounts_add_up_when_a_large_expense_is_set_aside(db):
    _salary_history(db)
    for offset in range(-6, 0):
        for _ in range(3):
            _tx(db, offset, 100.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
        _tx(db, offset, 40.0, "expense_var", from_acc=VIDE, category="Essence", day=6)
    _tx(db, -2, 900.0, "expense_var", from_acc=VIDE, category="Voiture")
    db.commit()

    whole = _run(db)
    parts = [_run(db, acc) for acc in (COURANT, LIVRET, VIDE)]

    assert sum(p["avg_variable_expense"] for p in parts) == pytest.approx(whole["avg_variable_expense"])
    assert sum(p["simulated_final_balance"] for p in parts) == pytest.approx(whole["simulated_final_balance"])


# ── Revenu personnalisé ou désactivé ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("mode", ["none", "custom"])
def test_planned_transfers_survive_income_modes(db, mode):
    _salary_history(db)
    _monthly_transfer(db)
    db.commit()

    months = _run(db, LIVRET, income_mode=mode, custom_income_amount=3000.0)["monthly_data"]

    assert months[1]["baseline_income"] == pytest.approx(VIREMENT)


def test_custom_income_goes_to_the_account_receiving_income(db):
    _salary_history(db)
    db.commit()

    custom = dict(income_mode="custom", custom_income_amount=3000.0)
    assert _run(db, COURANT, **custom)["monthly_data"][1]["baseline_income"] == pytest.approx(3000.0)
    assert _run(db, **custom)["monthly_data"][1]["baseline_income"] == pytest.approx(3000.0)
    assert _run(db, LIVRET, **custom)["monthly_data"][1]["baseline_income"] == 0.0


def test_custom_income_without_detected_salary_goes_to_the_main_account(db):
    _expense_history(db)
    db.commit()

    custom = dict(income_mode="custom", custom_income_amount=3000.0)
    assert _run(db, COURANT, **custom)["monthly_data"][1]["baseline_income"] == pytest.approx(3000.0)
    assert _run(db, **custom)["monthly_data"][1]["baseline_income"] == pytest.approx(3000.0)


# ── Dépenses variables récurrentes déjà saisies ──────────────────────────────────────────────────

def _recurring_variable(db, amount=300.0, rest=700.0):
    rec = RecurrenceTemplate(description="Echeance", amount=amount, type="expense_var", frequency="Monthly",
                             from_account_id=COURANT)
    db.add(rec)
    db.flush()
    for offset in range(-6, 0):
        _tx(db, offset, rest, "expense_var", from_acc=COURANT, category="Courses", day=5)
        _tx(db, offset, amount, "expense_var", from_acc=COURANT, category="Echeance", day=6, recurrence_id=rec.id)
    return rec


def test_planned_recurring_variable_expense_is_not_counted_twice(db):
    _salary_history(db)
    rec = _recurring_variable(db)
    _tx(db, 1, 300.0, "expense_var", from_acc=COURANT, reconciled=False, recurrence_id=rec.id, day=20)
    db.commit()

    month = _run(db, COURANT)["monthly_data"][1]

    assert month["baseline_variable"] == pytest.approx(1000.0)
    assert month["base_variable_projected"] == pytest.approx(700.0)


def test_theoretical_recurring_variable_expense_is_not_counted_twice(db):
    _salary_history(db)
    _recurring_variable(db)
    db.commit()

    month = _run(db, COURANT)["monthly_data"][1]

    assert month["baseline_expense"] == pytest.approx(1000.0)


# ── Mode conseillé : une prévision qui ressemble à l'historique ──

def _rec(db, account_id=None, horizon=12, **kw):
    return run_simulation(db=db, horizon_months=horizon, account_id=account_id, projection_profile="recommended", income_mode="auto", **kw)


def _steady_life(db, months=24):
    for offset in range(-months, 0):
        _tx(db, offset, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=15)
        _tx(db, offset, 500.0, "expense_var", from_acc=COURANT, category="Courses", day=5)


def test_recommended_counts_regular_income_from_history(db):
    _steady_life(db)
    for offset in (-2, -5, -8, -11):
        _tx(db, offset, 300.0, "income", to_acc=COURANT, category="Remboursement", day=20)
    db.commit()

    res = _rec(db, COURANT)

    assert res["other_income_avg"] == pytest.approx(100.0)
    assert res["monthly_data"][2]["baseline_income"] == pytest.approx(SALAIRE + 100.0)
    assert res["projection_profile"] == "recommended"


def test_recommended_ignores_a_one_off_loan_or_win(db):
    _steady_life(db)
    _tx(db, -3, 8000.0, "income", to_acc=COURANT, category="Emprunt", day=20)
    _tx(db, -4, 1500.0, "income", to_acc=COURANT, category="Gains", day=20)
    db.commit()

    assert _rec(db, COURANT)["other_income_avg"] == 0.0


def test_recommended_counts_a_yearly_bonus_seen_the_year_before(db):
    _steady_life(db)
    _tx(db, -2, 1800.0, "income", to_acc=COURANT, category="Prime", day=20)
    _tx(db, -14, 1800.0, "income", to_acc=COURANT, category="Prime", day=20)
    db.commit()

    assert _rec(db, COURANT)["other_income_avg"] == pytest.approx(150.0)


def test_recommended_does_not_count_planned_income_twice(db):
    _steady_life(db)
    db.add(RecurrenceTemplate(description="Aide", amount=150.0, type="income", frequency="Monthly", day_of_month=3, to_account_id=COURANT, category="Aide"))
    for offset in range(-12, 0):
        _tx(db, offset, 150.0, "income", to_acc=COURANT, category="Aide", day=3)
    db.commit()

    res = _rec(db, COURANT)

    assert res["other_income_avg"] == 0.0
    assert res["monthly_data"][2]["baseline_income"] == pytest.approx(SALAIRE + 150.0)


def test_recommended_includes_fixed_charges_without_a_recurrence(db):
    _steady_life(db)
    for offset in range(-6, 0):
        _tx(db, offset, 90.0, "expense_fixed", from_acc=COURANT, category="Mutuelle", day=8)
    db.commit()

    res = _rec(db, COURANT)

    assert res["unplanned_fixed_avg"] == pytest.approx(90.0)
    assert res["monthly_data"][2]["baseline_expense"] == pytest.approx(590.0)


def test_recommended_does_not_count_a_planned_charge_twice(db):
    _steady_life(db)
    db.add(RecurrenceTemplate(description="Mutuelle", amount=90.0, type="expense_fixed", frequency="Monthly", day_of_month=8, from_account_id=COURANT, category="Mutuelle"))
    for offset in range(-6, 0):
        _tx(db, offset, 90.0, "expense_fixed", from_acc=COURANT, category="Mutuelle", day=8)
    db.commit()

    res = _rec(db, COURANT)

    assert res["unplanned_fixed_avg"] == 0.0
    assert res["monthly_data"][2]["baseline_expense"] == pytest.approx(590.0)


def test_recommended_reads_everyday_spending_over_eighteen_months(db):
    for offset in range(-18, -6):
        _tx(db, offset, 900.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    for offset in range(-6, 0):
        _tx(db, offset, 300.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    db.commit()

    assert _rec(db, COURANT)["avg_variable_expense"] == pytest.approx(700.0)


def test_recommended_is_above_the_stress_test_when_history_shows_more_income(db):
    _steady_life(db)
    for offset in range(-12, 0):
        _tx(db, offset, 200.0, "income", to_acc=COURANT, category="Ventes", day=20)
    db.commit()

    recommended = _rec(db, COURANT)["simulated_final_balance"]
    stress = _run(db, COURANT, weight=1.0)["simulated_final_balance"]

    assert recommended > stress


@pytest.mark.parametrize("org", [False, True])
def test_recommended_keeps_accounts_summing_to_the_global(db, org):
    if org:
        _organisation(db)
    _steady_life(db)
    for offset in (-2, -6, -14):
        _tx(db, offset, 300.0, "income", to_acc=LIVRET, category="Interets", day=20)
        _tx(db, offset, 200.0, "income", to_acc=COURANT, category="Interets", day=20)
    for offset in range(-6, 0):
        _tx(db, offset, 60.0, "expense_fixed", from_acc=LIVRET, category="Frais", day=8)
    db.commit()

    whole = _rec(db)["simulated_final_balance"]
    parts = sum(_rec(db, acc)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert parts == pytest.approx(whole, abs=0.05)


def test_recommended_organisation_follows_the_last_year(db):
    _org_two_years(db)

    res = _rec(db, COURANT)

    # Pas de stress-test : la dotation de la dernière année, à son mois
    assert sum(m["baseline_income"] for m in res["monthly_data"]) == pytest.approx(60000.0)
    assert res["monthly_data"][1]["baseline_expense"] == pytest.approx(1000.0)


# ── Mode conseillé : historique court ou vide ────────────────

def test_recommended_empty_profile_stays_flat(db):
    res = _rec(db)

    assert res["simulated_final_balance"] == pytest.approx(res["initial_balance"])
    assert res["other_income_avg"] == 0.0


def test_recommended_recurrences_only(db):
    db.add_all([
        RecurrenceTemplate(description="Paie", amount=SALAIRE, type="income", frequency="Monthly", day_of_month=28, to_account_id=COURANT, category="Salaire"),
        RecurrenceTemplate(description="Loyer", amount=700.0, type="expense_fixed", frequency="Monthly", day_of_month=2, from_account_id=COURANT, category="Loyer"),
    ])
    db.commit()

    month = _rec(db, COURANT)["monthly_data"][2]

    assert month["baseline_income"] == pytest.approx(SALAIRE)
    assert month["baseline_expense"] == pytest.approx(700.0)


def test_recommended_envelopes_only(db):
    db.add(Budget(name="Courses", monthly_amount=400.0, period="monthly", envelope_type="spending"))
    db.commit()

    assert _rec(db)["avg_variable_expense"] == pytest.approx(400.0)


def test_recommended_current_month_only_uses_what_is_already_spent(db):
    today = date.today()
    db.add(Transaction(date_saisie=today, date_operation=today, description="Courses", amount=250.0, type="expense_var",
                       from_account_id=COURANT, category="Courses", reconciliation_date=today))
    db.commit()

    assert _rec(db)["avg_variable_expense"] == pytest.approx(250.0)


def test_recommended_one_month_of_history(db):
    _tx(db, -1, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=15)
    _tx(db, -1, 400.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    db.commit()

    res = _rec(db, COURANT)

    assert res["recent_history"] is True
    assert res["avg_variable_expense"] == pytest.approx(400.0)
    assert res["monthly_data"][2]["baseline_income"] == pytest.approx(SALAIRE)
    assert res["other_income_avg"] == 0.0


def test_short_history_does_not_turn_a_second_pay_into_a_bonus(db):
    _tx(db, -1, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=2)
    _tx(db, -1, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=28)
    db.commit()

    assert _rec(db, COURANT)["other_income_avg"] == 0.0


def test_big_purchase_among_few_operations_is_not_the_usual_spending(db):
    _tx(db, -1, 6000.0, "expense_var", from_acc=COURANT, category="Voiture", day=5)
    _tx(db, -1, 40.0, "expense_var", from_acc=COURANT, category="Courses", day=6)
    _tx(db, -1, 60.0, "expense_var", from_acc=COURANT, category="Courses", day=7)
    db.commit()

    res = _rec(db, COURANT)

    assert res["excluded_outliers_total"] == pytest.approx(6000.0)
    assert res["avg_variable_expense"] == pytest.approx(100.0)


def test_recent_recommended_keeps_accounts_summing_to_the_global(db):
    db.add(Budget(name="Courses", monthly_amount=500.0, period="monthly", envelope_type="spending"))
    _tx(db, -2, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=15)
    _tx(db, -1, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=15)
    _tx(db, -2, 50.0, "expense_var", from_acc=LIVRET, category="Courses", day=5)
    db.commit()

    whole = _rec(db)["simulated_final_balance"]
    parts = sum(_rec(db, acc)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert parts == pytest.approx(whole, abs=0.05)


def test_young_organisation_regular_income_comes_back_every_month(db):
    _organisation(db)
    for offset in range(-3, 0):
        _tx(db, offset, 1000.0, "income", to_acc=COURANT, category="Cotisations", day=12)
        _tx(db, offset, 900.0, "expense_var", from_acc=COURANT, category="Sorties", day=5)
    db.commit()

    months = _rec(db, COURANT)["monthly_data"]

    assert all(m["baseline_income"] == pytest.approx(1000.0) for m in months[1:])


def test_young_organisation_single_grant_does_not_spread(db):
    _organisation(db)
    _tx(db, -3, 50000.0, "income", to_acc=COURANT, category="Dotation", day=12)
    db.commit()

    assert sum(m["baseline_income"] for m in _rec(db, COURANT)["monthly_data"]) == pytest.approx(50000.0)


# ── Curseur de scénario du mode conseillé ────────────────────

def _two_years_of_life(db):
    for offset in range(-24, 0):
        _tx(db, offset, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=15)
    for offset in range(-12, 0):
        _tx(db, offset, 500.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    for offset in range(-24, -12):
        _tx(db, offset, 300.0, "expense_var", from_acc=COURANT, category="Courses", day=5)
    for offset in (-2, -5, -8, -11):
        _tx(db, offset, 300.0, "income", to_acc=COURANT, category="Ventes", day=20)
    for offset in (-14, -16, -18, -20, -22, -23):
        _tx(db, offset, 300.0, "income", to_acc=COURANT, category="Ventes", day=20)
    db.commit()


def test_scenario_at_zero_is_the_recommended_forecast(db):
    _two_years_of_life(db)

    assert _rec(db, COURANT, scenario_level=0.0)["simulated_final_balance"] == pytest.approx(_rec(db, COURANT)["simulated_final_balance"])


def test_hard_blow_removes_extra_income_and_raises_spending_and_inflation(db):
    _two_years_of_life(db)

    base = _rec(db, COURANT)
    res = _rec(db, COURANT, scenario_level=1.0)

    assert base["other_income_avg"] == pytest.approx(100.0)
    assert res["other_income_avg"] == 0.0
    assert res["scenario"]["expense_factor"] == pytest.approx(1.20)
    assert res["scenario"]["expense_month"] == pytest.approx(base["avg_variable_expense"] * 1.20, abs=0.01)
    assert res["scenario"]["inflation_rate"] == pytest.approx(0.02)
    assert res["simulated_final_balance"] < base["simulated_final_balance"]
    # Le salaire reste : le coup dur n'est pas une perte d'emploi
    assert res["monthly_data"][2]["baseline_income"] == pytest.approx(SALAIRE)


def test_hard_blow_is_proportional(db):
    _two_years_of_life(db)

    half = _rec(db, COURANT, scenario_level=0.5)

    assert half["other_income_avg"] == pytest.approx(50.0)
    assert half["scenario"]["expense_factor"] == pytest.approx(1.10)
    assert half["scenario"]["inflation_rate"] == pytest.approx(0.01)


def test_favorable_year_uses_the_best_of_the_last_two_years(db):
    _two_years_of_life(db)

    base = _rec(db, COURANT)
    res = _rec(db, COURANT, scenario_level=-1.0)

    assert res["scenario"]["favorable_available"] is True
    # 6 ventes l'année d'avant contre 4 : 150 €/mois au lieu de 100
    assert res["other_income_avg"] == pytest.approx(150.0)
    # L'année la moins chère : 300 €/mois
    assert res["scenario"]["expense_month"] == pytest.approx(300.0, abs=0.01)
    assert res["simulated_final_balance"] > base["simulated_final_balance"]


def test_favorable_year_cannot_be_invented_without_two_years(db):
    _steady_life(db, months=8)
    db.commit()

    base = _rec(db, COURANT)
    res = _rec(db, COURANT, scenario_level=-1.0)

    assert res["scenario"]["favorable_available"] is False
    assert res["scenario"]["level"] == 0.0
    assert res["simulated_final_balance"] == pytest.approx(base["simulated_final_balance"])


def test_scenario_on_an_empty_profile_stays_flat(db):
    for level in (-1.0, 1.0):
        res = _rec(db, scenario_level=level)
        assert res["simulated_final_balance"] == pytest.approx(res["initial_balance"])


def test_hard_blow_works_on_a_recent_profile(db):
    _young_profile(db)

    base = _rec(db)
    res = _rec(db, scenario_level=1.0)

    assert res["scenario"]["expense_month"] == pytest.approx(600.0)
    assert res["simulated_final_balance"] < base["simulated_final_balance"]


@pytest.mark.parametrize("level", [-1.0, -0.5, 0.5, 1.0])
@pytest.mark.parametrize("org", [False, True])
def test_scenario_keeps_accounts_summing_to_the_global(db, level, org):
    if org:
        _organisation(db)
    _two_years_of_life(db)
    for offset in (-3, -15):
        _tx(db, offset, 400.0, "income", to_acc=LIVRET, category="Interets", day=20)
    for offset in (-6, -7, -18):
        _tx(db, offset, 90.0, "expense_var", from_acc=LIVRET, category="Frais", day=8)
    db.commit()

    whole = _rec(db, scenario_level=level)["simulated_final_balance"]
    parts = sum(_rec(db, acc, scenario_level=level)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert parts == pytest.approx(whole, abs=0.05)


def test_organisation_hard_blow_uses_the_gap_between_the_two_years(db):
    _org_two_years(db, last_exp=1200.0, previous_exp=1000.0)

    base = _rec(db, COURANT)
    res = _rec(db, COURANT, scenario_level=1.0)

    assert sum(m["baseline_income"] for m in res["monthly_data"]) == pytest.approx(50000.0)
    assert res["scenario"]["expense_factor"] == pytest.approx(1.20)
    assert res["scenario"]["uncertain_income_year"] == 0.0
    assert base["scenario"]["uncertain_income_year"] == pytest.approx(10000.0)


def test_organisation_favorable_year(db):
    _org_two_years(db, last_grant=50000.0, previous_grant=60000.0, last_exp=1200.0, previous_exp=1000.0)

    res = _rec(db, COURANT, scenario_level=-1.0)

    assert sum(m["baseline_income"] for m in res["monthly_data"]) == pytest.approx(60000.0)
    assert res["scenario"]["expense_month"] == pytest.approx(1000.0, abs=0.01)


def test_young_organisation_hard_blow_uses_the_margin(db):
    _organisation(db)
    _tx(db, -3, 60000.0, "income", to_acc=COURANT, category="Dotation", day=12)
    _org_small_expenses(db, months=6)
    db.commit()

    res = _rec(db, COURANT, scenario_level=1.0)

    assert res["scenario"]["favorable_available"] is False
    assert sum(m["baseline_income"] for m in res["monthly_data"]) == pytest.approx(54000.0)
    assert res["scenario"]["expense_factor"] == pytest.approx(1.10)


def test_average_income_mode_in_recommended_uses_the_average(db):
    _steady_life(db)
    for offset in range(-12, 0):
        _tx(db, offset, 200.0, "income", to_acc=COURANT, category="Ventes", day=20)
    db.commit()

    month = _rec_mode(db, "average")["monthly_data"][2]

    assert month["baseline_income"] == pytest.approx(SALAIRE + 200.0)


def _rec_mode(db, mode):
    return run_simulation(db=db, horizon_months=12, account_id=COURANT, projection_profile="recommended", income_mode=mode)


def test_scenario_is_ignored_outside_recommended(db):
    _two_years_of_life(db)

    plain = _run(db, COURANT, weight=0.5)["simulated_final_balance"]

    assert _run(db, COURANT, weight=0.5, scenario_level=1.0)["simulated_final_balance"] == pytest.approx(plain)


def test_favorable_year_does_not_count_an_old_salary_as_extra_income(db):
    # Seuls les derniers salaires portent le repère : les plus anciens restent des salaires
    for offset in range(-24, -12):
        _tx(db, offset, SALAIRE, "income", to_acc=COURANT, category="Salaire", day=15)
    for offset in range(-12, 0):
        _tx(db, offset, SALAIRE, "income", to_acc=COURANT, is_salary=True, category="Salaire", day=15)
    for offset in (-2, -5, -14, -17):
        _tx(db, offset, 120.0, "income", to_acc=COURANT, category="Ventes", day=20)
    db.commit()

    assert _rec(db, COURANT, scenario_level=-1.0)["other_income_avg"] == pytest.approx(20.0)


def test_inflation_keeps_accounts_summing_to_the_global(db):
    _steady_life(db)
    db.add(RecurrenceTemplate(description="Credit auto", amount=300.0, type="expense_fixed", frequency="Monthly", day_of_month=3, from_account_id=COURANT, category="Credit"))
    db.commit()

    whole = _rec(db, inflation_rate=0.05)["simulated_final_balance"]
    parts = sum(_rec(db, acc, inflation_rate=0.05)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert parts == pytest.approx(whole, abs=0.05)


def test_inflation_does_not_grow_savings_transfers(db):
    _steady_life(db)
    _monthly_transfer(db)
    db.commit()

    whole = _rec(db, inflation_rate=0.05)["simulated_final_balance"]
    parts = sum(_rec(db, acc, inflation_rate=0.05)["simulated_final_balance"] for acc in (COURANT, LIVRET, VIDE))

    assert parts == pytest.approx(whole, abs=0.05)
