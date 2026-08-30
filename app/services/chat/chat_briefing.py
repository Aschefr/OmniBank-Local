"""
app/services/chat/chat_briefing.py — Générateur de briefing financier en temps réel (Dossier Situation)
injecté dynamiquement dans le prompt système pour donner à l'IA une vision immédiate et chiffrée.
"""
from datetime import date, timedelta
import calendar
import logging
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import (
    Account, Transaction, Budget, BudgetAllocation,
    RecurrenceTemplate, Notification, GlobalConfig
)
from app.services.finance_engine import (
    calculate_balances, get_net_worth, calculate_rest_to_live,
    predict_next_paycheck, get_main_account, get_base_currency
)

logger = logging.getLogger(__name__)


def generate_financial_briefing(db: Session, role: str = 'advisor', user_name: str = None, session_id: int = None) -> str:
    """
    Génère un briefing financier synthétique et dense à partir des données réelles de la base SQLite.
    Ce briefing est injecté directement dans le system prompt pour ancrer l'IA dans la réalité de l'utilisateur.
    """
    if db is None:
        return ""

    try:
        today = date.today()
        base_curr = get_base_currency(db)
        
        # 1. Accounts & Net Worth
        accounts = db.query(Account).filter(Account.is_closed == False).all()
        if not accounts:
            return "No accounts configured yet."

        balances_reconciled = calculate_balances(db, only_reconciled=True)
        balances_projected = calculate_balances(db, end_date=today, only_reconciled=False)
        total_net_worth = get_net_worth(db, only_reconciled=True, precomputed_balances=balances_reconciled)

        main_acc = get_main_account(db)
        main_acc_name = main_acc.name if main_acc else "Compte Principal"
        main_acc_bal = balances_reconciled.get(main_acc.id, 0.0) if main_acc else 0.0

        # 2. Reste à Vivre & Paycheck
        paycheck = predict_next_paycheck(db)
        next_pay_date = paycheck.get("date")
        pay_amount = paycheck.get("amount", 0.0)
        rtl = calculate_rest_to_live(db, today, next_pay_date)
        
        days_until_paycheck = 30
        if isinstance(next_pay_date, date):
            days_until_paycheck = max(1, (next_pay_date - today).days)
        daily_budget = round(rtl / days_until_paycheck, 2) if rtl > 0 else 0.0

        # 3. Savings Reserved (Tirelires)
        savings_budgets = db.query(Budget).filter(
            Budget.envelope_type == "savings",
            Budget.is_closed == False
        ).all()
        savings_total = 0.0
        active_savings_goals = []
        for sb in savings_budgets:
            allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == sb.id).all()
            alloc_bal = sum(a.amount for a in allocs)
            txs = db.query(Transaction).filter(
                Transaction.budget_id == sb.id,
                (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
            ).all()
            tx_inc = sum(abs(t.amount) for t in txs if t.type == "income")
            tx_exp = sum(abs(t.amount) for t in txs if t.type != "income")
            cur_saved = round((tx_inc - tx_exp) + alloc_bal, 2)
            savings_total += max(cur_saved, 0.0)
            if cur_saved > 0 or (sb.monthly_amount and sb.monthly_amount > 0):
                pct = round((cur_saved / sb.monthly_amount * 100), 1) if sb.monthly_amount and sb.monthly_amount > 0 else 0.0
                active_savings_goals.append({
                    "name": sb.name,
                    "saved": cur_saved,
                    "target": sb.monthly_amount,
                    "pct": pct
                })

        # 4. Multi-month Historical Averages (3 months)
        three_months_ago = today - timedelta(days=90)
        txs_3m = db.query(Transaction).filter(
            Transaction.date_operation >= three_months_ago,
            Transaction.date_operation <= today,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()

        inc_3m = sum(t.amount for t in txs_3m if t.type == "income")
        exp_fixed_3m = sum(t.amount for t in txs_3m if t.type == "expense_fixed")
        exp_var_3m = sum(t.amount for t in txs_3m if t.type == "expense_var")
        total_exp_3m = exp_fixed_3m + exp_var_3m
        
        avg_monthly_income = round(inc_3m / 3.0, 2)
        avg_monthly_exp = round(total_exp_3m / 3.0, 2)
        avg_savings_rate = round(((avg_monthly_income - avg_monthly_exp) / avg_monthly_income * 100), 1) if avg_monthly_income > 0 else 0.0

        # 5. Current Month to Date Spent
        start_of_month = date(today.year, today.month, 1)
        cur_month_txs = db.query(Transaction).filter(
            Transaction.date_operation >= start_of_month,
            Transaction.date_operation <= today,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()
        cur_month_income = sum(t.amount for t in cur_month_txs if t.type == "income")
        cur_month_exp = sum(t.amount for t in cur_month_txs if t.type in ("expense_var", "expense_fixed"))

        # 6. Budget Envelopes Status Highlights (current month)
        from app.routers.budgets import get_budget_status
        b_status = get_budget_status(year=today.year, month=today.month, db=db)
        tight_envelopes = []
        for b in b_status.get("budgets", []):
            if b.get("envelope_type") != "savings":
                pct = b.get("percent", 0.0)
                if pct >= 80.0:
                    tight_envelopes.append(f"{b.get('name')}: {b.get('expenses', 0.0):.0f} / {b.get('budget_amount', 0.0):.0f} {base_curr} ({pct:.0f}%)")

        # 7. Last Proactive AI Health Report
        last_ai_notif = db.query(Notification).filter(
            Notification.type == "ai_report"
        ).order_by(Notification.created_at.desc()).first()
        last_report_summary = "None yet."
        if last_ai_notif:
            notif_date = last_ai_notif.created_at.strftime("%Y-%m-%d") if last_ai_notif.created_at else "recent"
            last_report_summary = f"[{notif_date}] {last_ai_notif.title} - {(last_ai_notif.content or '')[:160]}"

        # --- Build Universal Base Briefing ---
        lines = [
            "=== LIVE USER FINANCIAL SITUATION & DOSSIER (REAL-TIME DB SNAPSHOT) ===",
            f"• Current Date: {today.isoformat()}",
            f"• Base Currency: {base_curr}",
            f"• Reconciled Net Worth: {total_net_worth:.2f} {base_curr} across {len(accounts)} accounts.",
            f"• Main Account ({main_acc_name}): Reconciled {main_acc_bal:.2f} {base_curr} | Projected Today: {balances_projected.get(main_acc.id, 0.0):.2f} {base_curr}.",
            f"• Reste à Vivre (RTL): {rtl:.2f} {base_curr} available until next paycheck ({days_until_paycheck} days remaining).",
            f"• Daily Spending Ceiling: ~{daily_budget:.2f} {base_curr}/day.",
            f"• Next Scheduled Paycheck: {next_pay_date} ({pay_amount:.2f} {base_curr}).",
            f"• Savings Buffer (Tirelires): {savings_total:.2f} {base_curr} reserved (accessible on account in emergency).",
            f"• 3-Month Monthly Averages: Income {avg_monthly_income:.2f} {base_curr} | Expenses {avg_monthly_exp:.2f} {base_curr} | Savings Rate: {avg_savings_rate:.1f}%.",
            f"• Current Month to Date (Day {today.day}): Spent {cur_month_exp:.2f} {base_curr} | Received {cur_month_income:.2f} {base_curr}."
        ]

        if tight_envelopes:
            lines.append(f"• Envelopes Under Pressure (>=80% spent): {', '.join(tight_envelopes)}.")
        else:
            lines.append("• Budget Envelopes: All active envelopes currently within normal limits (<80%).")

        if active_savings_goals:
            goals_str = ", ".join(f"{g['name']} ({g['saved']:.0f}/{g['target']:.0f} {base_curr} - {g['pct']}%)" for g in active_savings_goals[:3])
            lines.append(f"• Active Savings Goals: {goals_str}.")

        lines.append(f"• Latest AI Financial Health Evaluation: {last_report_summary}")

        # --- Role-Specific Complements ---
        if role == 'simulator':
            disposable_monthly = max(0.0, avg_monthly_income - avg_monthly_exp)
            lines.append(f"[Simulator Briefing] Disposable monthly capacity: ~{disposable_monthly:.2f} {base_curr}/mo | Liquid safety cushion: {savings_total:.2f} {base_curr}.")
        elif role in ('alerts', 'optimizer'):
            active_templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
            rec_exp_total = sum(t.amount for t in active_templates if t.type in ("expense_fixed", "expense_var"))
            unrec_past_txs = db.query(Transaction).filter(
                Transaction.reconciliation_date == None,
                Transaction.date_operation < today
            ).count()
            lines.append(f"[Optimizer/Alerts Briefing] {len(active_templates)} active recurring templates ({rec_exp_total:.2f} {base_curr}/mo total commitments) | {unrec_past_txs} unreconciled past-due operations.")
        elif role == 'budget_planner':
            # Category breakdown over 6 months
            six_months_ago = today - timedelta(days=180)
            cat_txs = db.query(Transaction.category, func.sum(Transaction.amount)).filter(
                Transaction.date_operation >= six_months_ago,
                Transaction.date_operation <= today,
                Transaction.type.in_(("expense_var", "expense_fixed")),
                (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
            ).group_by(Transaction.category).order_by(func.sum(Transaction.amount).desc()).limit(5).all()
            if cat_txs:
                top_cats = ", ".join(f"{c[0] or 'Sans catégorie'}: ~{c[1]/6.0:.0f} {base_curr}/mo" for c in cat_txs)
                lines.append(f"[Budget Planner Briefing] Top 6-month historical spending categories: {top_cats}.")
        elif role == 'forecaster':
            from app.services.chat.chat_tools import forecast_balances_history_tool
            try:
                fc = forecast_balances_history_tool(db, days=30)
                fc_end = fc.get("history", [{}])[-1].get("projected_balance_euros", 0.0)
                daily_var = fc.get("daily_average_variable_spend_euros", 0.0)
                lines.append(f"[Forecaster Briefing] Projected balance in 30 days: {fc_end:.2f} {base_curr} | Estimated daily variable spend rate: {daily_var:.2f} {base_curr}/day.")
            except Exception:
                pass
        elif role == 'auditor':
            unrec_past = db.query(Transaction).filter(
                Transaction.reconciliation_date == None,
                Transaction.date_operation < today
            ).count()
            uncat_count = db.query(Transaction).filter(
                (Transaction.category == None) | (Transaction.category == "") | (Transaction.category == "Sans catégorie")
            ).count()
            lines.append(f"[Auditor Briefing] {unrec_past} past transactions awaiting reconciliation | {uncat_count} un-categorized transactions in database.")

        lines.append("=== END LIVE DOSSIER ===")
        return "\n".join(lines)

    except Exception as e:
        logger.error(f"[generate_financial_briefing] Error generating briefing: {e}", exc_info=True)
        return ""
