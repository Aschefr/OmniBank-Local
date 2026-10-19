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

        # Categorize liquid savings and secondary accounts
        savings_accounts = []
        secondary_checking_accounts = []
        for acc in accounts:
            if main_acc and acc.id == main_acc.id:
                continue
            acc_type_lower = (acc.type or "").lower()
            acc_name_lower = (acc.name or "").lower()
            is_loan = any(k in acc_type_lower for k in ['prêt', 'pret', 'emprunt', 'loan', 'crédit', 'credit'])
            if is_loan:
                continue
            if any(k in acc_type_lower for k in ['livret', 'épargne', 'epargne', 'savings']) or any(k in acc_name_lower for k in ['livret', 'épargne', 'epargne', 'csl', 'ldd', 'lep', 'pel', 'cel']):
                savings_accounts.append(acc)
            else:
                secondary_checking_accounts.append(acc)

        liquid_savings_total = sum(max(balances_reconciled.get(a.id, 0.0), 0.0) for a in savings_accounts)
        savings_detail_str = ", ".join(f"{a.name}: {balances_reconciled.get(a.id, 0.0):.2f} {base_curr}" for a in savings_accounts) if savings_accounts else "None"
        sec_detail_str = ", ".join(f"{a.name}: {balances_reconciled.get(a.id, 0.0):.2f} {base_curr}" for a in secondary_checking_accounts) if secondary_checking_accounts else None

        # 2. Reste à Vivre & Paycheck
        paycheck = predict_next_paycheck(db)
        next_pay_date = paycheck.get("date")
        pay_amount = paycheck.get("amount", 0.0)
        rtl = calculate_rest_to_live(db, today, next_pay_date)
        
        days_until_paycheck = 30
        if isinstance(next_pay_date, date):
            days_until_paycheck = max(1, (next_pay_date - today).days)
        daily_budget = round(rtl / days_until_paycheck, 2) if rtl > 0 else 0.0

        # Overdraft warning
        from app.services.finance_engine import get_overdraft_warning
        od_warning = get_overdraft_warning(db)

        # Real overdraft check: only genuine unmitigated overdrafts before next paycheck
        has_real_overdraft = False
        is_covered_overdraft = False
        is_after_pay_overdraft = False
        if od_warning:
            is_after_pay_overdraft = bool(od_warning.get("is_after_next_paycheck") or (isinstance(next_pay_date, date) and od_warning["date"] > next_pay_date))
            is_covered_overdraft = bool(od_warning.get("covered_by_income"))
            if not is_after_pay_overdraft and not is_covered_overdraft:
                has_real_overdraft = True

        # Recommended Bridge Transfer calculation (Deficit + Vital Daily Living Buffer)
        # ONLY triggered if there is an actual checking account deficit before payday (negative RTL or unmitigated overdraft)
        rec_bridge_transfer = None
        cashflow_deficit = max(0.0, -rtl) if rtl < 0 else 0.0
        od_deficit = 0.0
        if has_real_overdraft:
            od_bal = od_warning.get("with_income_risk_amount", od_warning.get("projected_balance", 0.0))
            od_deficit = max(0.0, -od_bal)
            
        deficit_to_cover = max(cashflow_deficit, od_deficit)
        if deficit_to_cover > 0 and liquid_savings_total > 0:
            vital_daily_allowance = 15.0  # realistic floor for food and basic transit
            vital_buffer = round(vital_daily_allowance * days_until_paycheck, 2)
            total_transfer_needed = round(deficit_to_cover + vital_buffer, 0)
            rec_bridge_transfer_rounded = int(((total_transfer_needed + 9) // 10) * 10)
            rec_bridge_transfer = {
                "amount": rec_bridge_transfer_rounded,
                "deficit_covered": round(deficit_to_cover, 2),
                "vital_buffer": round(vital_buffer, 2),
                "vital_daily": vital_daily_allowance,
                "days": days_until_paycheck
            }

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
        all_active_envelopes = []
        for b in b_status.get("budgets", []):
            if b.get("envelope_type") != "savings":
                bid = b.get("id")
                bname = b.get("name")
                bamt = b.get("budget_amount", 0.0)
                all_active_envelopes.append(f'"{bname}" [ID #{bid}] ({bamt:.0f} {base_curr})')
                pct = b.get("percent", 0.0)
                if pct >= 80.0:
                    tight_envelopes.append(f'"{bname}" [ID #{bid}]: {b.get("expenses", 0.0):.0f} / {bamt:.0f} {base_curr} ({pct:.0f}%)')

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
            f"• Available Liquid Savings & Reserve (Épargne disponible): {liquid_savings_total:.2f} {base_curr} [{savings_detail_str}].",
        ]

        if sec_detail_str:
            lines.append(f"• Secondary Accounts: {sec_detail_str}.")

        lines.extend([
            f"• Reste à Vivre (RTL): {rtl:.2f} {base_curr} available on main account until next paycheck ({days_until_paycheck} days remaining).",
            f"• Next Scheduled Paycheck: {next_pay_date} ({pay_amount:.2f} {base_curr}).",
        ])

        if rtl > 0:
            lines.append(f"• Daily Spending Ceiling: ~{daily_budget:.2f} {base_curr}/day.")
        else:
            lines.append(f"• Daily Spending Ceiling on Checking Account: 0.00 {base_curr}/day (Checking account cash flow deficit until paycheck. Liquid savings must be used to bridge daily essentials).")

        if has_real_overdraft:
            od_neg = abs(od_warning.get("with_income_risk_amount", od_warning.get("projected_balance", 0.0)))
            lines.append(f"• Overdraft Risk Alert: Projected negative balance of -{od_neg:.2f} {base_curr} on {od_warning.get('date')} (trigger operation: '{od_warning.get('transaction_description', '')}').")
        elif is_after_pay_overdraft:
            lines.append(f"• Overdraft Status: No projected overdraft before next paycheck ({next_pay_date}). Note: Charge '{od_warning.get('transaction_description', '')}' occurs on {od_warning.get('date')} after next payday ({next_pay_date}); incoming paycheck of {pay_amount:.2f} {base_curr} funds the account beforehand, leaving a comfortable balance.")
        elif is_covered_overdraft:
            lines.append(f"• Overdraft Status: No unmitigated overdraft before next paycheck ({next_pay_date}). Temporary cash dip without receipts on {od_warning.get('date')} is fully absorbed by planned income (+{od_warning.get('planned_income_before_risk', 0.0):.2f} {base_curr}, projected net balance: +{od_warning.get('projected_balance_with_income', 0.0):.2f} {base_curr}).")
        else:
            lines.append(f"• Overdraft Status: No projected overdraft before next paycheck ({next_pay_date}).")

        if rec_bridge_transfer:
            lines.append(
                f"• Recommended Bridge Transfer (Virement de précaution): ~{rec_bridge_transfer['amount']} {base_curr} from liquid savings ({savings_detail_str}) to checking account ({main_acc_name}). "
                f"Breakdown: {rec_bridge_transfer['deficit_covered']:.2f} {base_curr} to cover checking account deficit/overdraft + ~{rec_bridge_transfer['vital_buffer']:.0f} {base_curr} vital living buffer (~{rec_bridge_transfer['vital_daily']:.0f} {base_curr}/day over {rec_bridge_transfer['days']} days until payday). "
                f"Reversible: Re-transfer to replenish savings once paycheck of {pay_amount:.2f} {base_curr} arrives on {next_pay_date}."
            )

        # Check for recent bridge transfers from savings to checking during the current pay period
        bridge_cutoff = today - timedelta(days=20)
        savings_account_ids = [a.id for a in savings_accounts]
        recent_bridge_tx = None
        if savings_account_ids:
            recent_bridge_tx = db.query(Transaction).filter(
                Transaction.type == "transfer",
                Transaction.from_account_id.in_(savings_account_ids),
                Transaction.date_operation >= bridge_cutoff,
                Transaction.date_operation <= today
            ).order_by(Transaction.date_operation.desc()).first()

        if recent_bridge_tx:
            from_acc_obj = db.query(Account).filter(Account.id == recent_bridge_tx.from_account_id).first()
            to_acc_obj = db.query(Account).filter(Account.id == recent_bridge_tx.to_account_id).first()
            from_acc_name = from_acc_obj.name if from_acc_obj else "Livret A"
            to_acc_name = to_acc_obj.name if to_acc_obj else "Compte courant"

            p_dt = None
            try:
                p_dt = date.fromisoformat(next_pay_date)
                day_after_pay = (p_dt + timedelta(days=1)).isoformat()
            except Exception:
                day_after_pay = next_pay_date

            # Check if there is already a scheduled return transfer
            # Specific return criteria: description references restitution/reconstitution, or matching amount near next payday
            candidate_returns = db.query(Transaction).filter(
                Transaction.type == "transfer",
                Transaction.from_account_id == recent_bridge_tx.to_account_id,
                Transaction.to_account_id == recent_bridge_tx.from_account_id,
                Transaction.date_operation >= today
            ).all()

            return_tx = None
            for cand in candidate_returns:
                desc_lower = (cand.description or "").lower()
                is_explicit = any(k in desc_lower for k in ["reconstitution", "restitution", "retour", "remboursement"])
                matches_amt = abs((cand.amount or 0.0) - recent_bridge_tx.amount) < 0.01
                if is_explicit or (matches_amt and p_dt and cand.date_operation <= p_dt + timedelta(days=5)):
                    return_tx = cand
                    break

            if not return_tx:
                lines.append(
                    f"• Pending Savings Restitution: A bridge transfer of {recent_bridge_tx.amount:.2f} {base_curr} was recorded from {from_acc_name} to {to_acc_name}. "
                    f"No return transfer has been scheduled yet! ACTION REQUIRED: Propose scheduling the return transfer ({to_acc_name} -> {from_acc_name}, {recent_bridge_tx.amount:.2f} {base_curr}) on {day_after_pay} (day after next paycheck) via `create_planned_transfer` to automatically replenish liquid savings."
                )
            else:
                lines.append(
                    f"• Scheduled Savings Restitution: Return transfer of {return_tx.amount:.2f} {base_curr} from {to_acc_name} back to {from_acc_name} is already scheduled on {return_tx.date_operation}."
                )

        lines.extend([
            f"• Savings Buffer in Budgets (Tirelires): {savings_total:.2f} {base_curr} reserved (accessible on account in emergency).",
            f"• 3-Month Monthly Averages: Income {avg_monthly_income:.2f} {base_curr} | Expenses {avg_monthly_exp:.2f} {base_curr} | Savings Rate: {avg_savings_rate:.1f}%.",
            f"• Current Month to Date (Day {today.day}): Spent {cur_month_exp:.2f} {base_curr} | Received {cur_month_income:.2f} {base_curr}."
        ])

        if tight_envelopes:
            lines.append(f"• Envelopes Under Pressure (>=80% spent): {', '.join(tight_envelopes)}.")
        if all_active_envelopes:
            lines.append(f"• All Active Budget Envelopes: {', '.join(all_active_envelopes)}.")
        else:
            lines.append("• Budget Envelopes: All active envelopes currently within normal limits (<80%).")

        if active_savings_goals:
            goals_str = ", ".join(f"{g['name']} ({g['saved']:.0f}/{g['target']:.0f} {base_curr} - {g['pct']}%)" for g in active_savings_goals[:3])
            lines.append(f"• Active Savings Goals: {goals_str}.")

        # Known Financial Facts & Memory (from ai_facts)
        from app.models import AIFact
        ai_facts_rows = db.query(AIFact).all()
        if ai_facts_rows:
            facts_list = [f"[{f.fact_key}]: {f.fact_value}" for f in ai_facts_rows if f.fact_value]
            if facts_list:
                lines.append(f"• Known Financial Facts & Memory (ai_facts): {'; '.join(facts_list)}.")

        lines.append(f"• Latest AI Financial Health Evaluation: {last_report_summary}")

        # --- Role-Specific Complements ---
        if role == 'simulator':
            disposable_monthly = max(0.0, avg_monthly_income - avg_monthly_exp)
            max_debt_cap = round(avg_monthly_income * 0.33, 2) if avg_monthly_income > 0 else 0.0
            lines.append(f"[Simulator Briefing] Disposable monthly capacity: ~{disposable_monthly:.2f} {base_curr}/mo | 33% Borrowing ceiling: ~{max_debt_cap:.2f} {base_curr}/mo | Liquid safety cushion: {savings_total:.2f} {base_curr}.")
        elif role == 'alerts':
            from app.services.chat.chat_tools import get_active_recurrence_templates
            if has_real_overdraft:
                od_str = f"⚠️ OVERDRAFT RISK DETECTED on {od_warning['date']} ({od_warning.get('with_income_risk_amount', od_warning.get('projected_balance'))} {base_curr})"
            elif is_after_pay_overdraft:
                od_str = f"✅ No overdraft before payday ({next_pay_date}). Charge on {od_warning['date']} is covered by incoming paycheck."
            elif is_covered_overdraft:
                od_str = f"⏳ Temporary cash dip on {od_warning['date']} covered by planned receipts (+{od_warning.get('planned_income_before_risk', 0.0):.2f} {base_curr})"
            else:
                od_str = "No immediate overdraft detected."
            active_templates = get_active_recurrence_templates(db)
            unrec_past_txs = db.query(Transaction).filter(
                Transaction.reconciliation_date == None,
                Transaction.date_operation < today
            ).count()
            lines.append(f"[Alerts Briefing] {od_str} | {len(active_templates)} active recurring templates | {unrec_past_txs} unreconciled past operations.")
        elif role == 'optimizer':
            from app.services.chat.chat_tools import get_active_recurrence_templates
            active_templates = get_active_recurrence_templates(db, template_types=("expense_fixed", "expense_var"))
            rec_exp_total = sum(t.amount for t in active_templates)
            lines.append(f"[Optimizer Briefing] {len(active_templates)} active recurring templates ({rec_exp_total:.2f} {base_curr}/mo total commitments). Check `detect_anomalies_and_subscriptions` for price increases.")
        elif role == 'budget_planner':
            six_months_ago = today - timedelta(days=180)
            cat_txs = db.query(Transaction.category, func.sum(Transaction.amount)).filter(
                Transaction.date_operation >= six_months_ago,
                Transaction.date_operation <= today,
                Transaction.type.in_(("expense_var", "expense_fixed")),
                (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
            ).group_by(Transaction.category).order_by(func.sum(Transaction.amount).desc()).limit(5).all()
            top_cats = ", ".join(f"{c[0] or 'Sans catégorie'}: ~{c[1]/6.0:.0f} {base_curr}/mo" for c in cat_txs) if cat_txs else "None"
            lines.append(f"[Budget Planner Briefing] Top 6-month historical spending categories: {top_cats}.")
        elif role == 'forecaster':
            from app.services.chat.chat_tools import forecast_balances_history_tool
            try:
                fc = forecast_balances_history_tool(db, days=90)
                fc_breakdown = fc.get("monthly_breakdown", [])
                daily_var = fc.get("daily_average_variable_spend_euros", 0.0)
                fc_end = fc_breakdown[-1].get("projected_end_balance_euros", 0.0) if fc_breakdown else 0.0
                liq_cushion = fc.get("total_liquid_savings_cushion_euros", 0.0)
                lines.append(f"[Forecaster Briefing] Projected balance in 90 days (3 cycles): {fc_end:.2f} {base_curr} | Liquid savings cushion: {liq_cushion:.2f} {base_curr} | Daily variable rate: {daily_var:.2f} {base_curr}/day.")
            except Exception as e:
                logger.warning(f"[Briefing] Forecaster calculation error: {e}")
        elif role == 'auditor':
            unrec_past = db.query(Transaction).filter(
                Transaction.reconciliation_date == None,
                Transaction.date_operation < today - timedelta(days=30)
            ).count()
            uncat_count = db.query(Transaction).filter(
                (Transaction.category == None) | (Transaction.category == "") | (Transaction.category == "Sans catégorie")
            ).count()
            lines.append(f"[Auditor Briefing] {unrec_past} transactions overdue >30 days awaiting reconciliation | {uncat_count} un-categorized transactions.")

        lines.append("=== END LIVE DOSSIER ===")
        return "\n".join(lines)

    except Exception as e:
        logger.error(f"[generate_financial_briefing] Error generating briefing: {e}", exc_info=True)
        return ""
