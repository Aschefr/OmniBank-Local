"""
app/services/chat/tools/simulation_tools.py — Outils de simulation financière (prêt, scénario What-If).
"""
import json
import logging
import calendar
import statistics as _stats
from datetime import date, timedelta
from typing import List, Optional
from collections import defaultdict
from sqlalchemy.orm import Session

from app.models import (
    Transaction, Account, Category, RecurrenceTemplate,
    Budget, BudgetAllocation, AIFact, OrgUser, ActionHistory, GlobalConfig
)
from app.services.finance_engine import (
    calculate_balances, get_net_worth, calculate_rest_to_live,
    predict_next_paycheck, get_main_account
)
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

def simulate_loan_amortization_tool(db: Session, principal: float, rate_percent: float, years: int) -> dict:
    principal = float(principal)
    rate_percent = float(rate_percent)
    years = int(years)
    
    monthly_rate = (rate_percent / 100.0) / 12.0
    months = years * 12
    
    if monthly_rate == 0:
        monthly_payment = principal / months
    else:
        monthly_payment = principal * (monthly_rate * (1 + monthly_rate) ** months) / (((1 + monthly_rate) ** months) - 1)
        
    total_paid = monthly_payment * months
    total_interest = total_paid - principal
    
    # Impact on left to live
    from app.services.finance_engine import calculate_rest_to_live, predict_next_paycheck
    from datetime import date
    today = date.today()
    paycheck = predict_next_paycheck(db)
    next_pay_date = paycheck["date"]
    current_rtl = calculate_rest_to_live(db, today, next_pay_date)
    new_rtl = round(current_rtl - monthly_payment, 2)
    
    return {
        "principal_euros": principal,
        "annual_rate_percent": rate_percent,
        "duration_years": years,
        "monthly_payment_euros": round(monthly_payment, 2),
        "total_interest_euros": round(total_interest, 2),
        "total_paid_euros": round(total_paid, 2),
        "current_rest_to_live_euros": current_rtl,
        "projected_rest_to_live_euros": new_rtl
    }

def simulate_financial_scenario_tool(db: Session, horizon_months: int = 12, project_name: str = None, one_off_amount: float = 0.0, recurring_monthly_amount: float = 0.0, recurring_duration_months: int = 12) -> dict:
    from app.services.simulator_engine import run_simulation
    from datetime import date, timedelta
    from app.models import Transaction
    
    try:
        horizon_months = max(3, min(int(horizon_months), 36))
    except Exception:
        horizon_months = 12
        
    one_off = float(one_off_amount or 0.0)
    rec_monthly = float(recurring_monthly_amount or 0.0)
    rec_dur = max(1, min(int(recurring_duration_months or horizon_months), horizon_months))
    p_name = project_name or "Projet Simulé"
    
    custom_events = []
    if one_off > 0:
        custom_events.append({
            "label": f"{p_name} (Apport/Achat unique)",
            "event_type": "one_off_expense",
            "amount": one_off,
            "duration_months": 1
        })
    if rec_monthly > 0:
        custom_events.append({
            "label": f"{p_name} (Mensualité/Charge)",
            "event_type": "recurring_expense",
            "amount": rec_monthly,
            "duration_months": rec_dur
        })
        
    sim_result = run_simulation(
        db,
        horizon_months=horizon_months,
        custom_events=custom_events if custom_events else None
    )
    
    today = date.today()
    six_months_ago = today - timedelta(days=180)
    txs_inc = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.date_operation <= today,
        Transaction.type == "income",
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).all()
    avg_income = (sum(t.amount for t in txs_inc) / 6.0) if txs_inc else 0.0
    max_debt_capacity_33pct = round(avg_income * 0.33, 2)
    
    baseline_end = sim_result.get("baseline_trajectory", [{}])[-1].get("end_balance", 0.0) if sim_result.get("baseline_trajectory") else 0.0
    simulated_end = sim_result.get("simulated_trajectory", [{}])[-1].get("end_balance", 0.0) if sim_result.get("simulated_trajectory") else 0.0
    
    return {
        "project_name": p_name,
        "simulation_horizon_months": horizon_months,
        "project_cost_summary": {
            "initial_one_off_euros": one_off,
            "monthly_commitment_euros": rec_monthly,
            "monthly_duration_months": rec_dur,
            "total_project_cost_euros": round(one_off + (rec_monthly * rec_dur), 2)
        },
        "user_borrowing_capacity": {
            "monthly_average_income_euros": round(avg_income, 2),
            "max_recommended_monthly_debt_33pct_euros": max_debt_capacity_33pct,
            "is_within_recommended_debt_capacity": rec_monthly <= max_debt_capacity_33pct if avg_income > 0 else True
        },
        "trajectory_comparison": {
            "baseline_balance_end_horizon_euros": baseline_end,
            "simulated_balance_end_horizon_euros": simulated_end,
            "net_worth_impact_euros": round(simulated_end - baseline_end, 2),
            "min_simulated_balance_euros": sim_result.get("kpis", {}).get("min_simulated_balance", 0.0),
            "first_overdraft_month": sim_result.get("kpis", {}).get("first_overdraft_month")
        },
        "is_financially_viable": sim_result.get("kpis", {}).get("min_simulated_balance", 0.0) >= 0.0
    }

