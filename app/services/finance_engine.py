from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import Account, Transaction, GlobalConfig, ExchangeRate

def get_base_currency(db: Session) -> str:
    conf = db.query(GlobalConfig).filter(GlobalConfig.key == "base_currency").first()
    return conf.value.upper() if conf and conf.value else "EUR"

DEFAULT_EXCHANGE_RATES = {
    ("USD", "EUR"): 0.92,
    ("EUR", "USD"): 1.087,
    ("GBP", "EUR"): 1.17,
    ("EUR", "GBP"): 0.855,
    ("CHF", "EUR"): 1.05,
    ("EUR", "CHF"): 0.952,
    ("CAD", "EUR"): 0.68,
    ("EUR", "CAD"): 1.47,
    ("AUD", "EUR"): 0.60,
    ("EUR", "AUD"): 1.66,
    ("JPY", "EUR"): 0.006,
    ("EUR", "JPY"): 166.67,
}

def convert_currency(db: Session, amount: float, from_curr: str, to_curr: str) -> float:
    if not amount or not from_curr or not to_curr or from_curr.upper() == to_curr.upper():
        return amount
    from_curr = from_curr.upper().strip()
    to_curr = to_curr.upper().strip()
    
    # Direct rate
    rate_obj = db.query(ExchangeRate).filter(ExchangeRate.from_currency == from_curr, ExchangeRate.to_currency == to_curr).first()
    if rate_obj and rate_obj.rate:
        return amount * rate_obj.rate
        
    # Reverse rate
    rev_obj = db.query(ExchangeRate).filter(ExchangeRate.from_currency == to_curr, ExchangeRate.to_currency == from_curr).first()
    if rev_obj and rev_obj.rate:
        return amount / rev_obj.rate

    # Default fallback rate
    if (from_curr, to_curr) in DEFAULT_EXCHANGE_RATES:
        return amount * DEFAULT_EXCHANGE_RATES[(from_curr, to_curr)]
    if (to_curr, from_curr) in DEFAULT_EXCHANGE_RATES:
        return amount / DEFAULT_EXCHANGE_RATES[(to_curr, from_curr)]
        
    return amount

def calculate_balances(db: Session, end_date: date = None, only_reconciled: bool = False):
    """
    Calculate the balance of each account.
    If end_date is provided, only include transactions with date_operation <= end_date.
    If only_reconciled is True, only include transactions that have a reconciliation_date.
    Returns a dict: {account_id: balance}
    """
    accounts = db.query(Account).all()
    balances = {a.id: a.initial_balance for a in accounts}
    
    query = db.query(Transaction.amount, Transaction.from_account_id, Transaction.to_account_id)
    query = query.filter((Transaction.is_skipped == False) | (Transaction.is_skipped == None))
    query = query.filter((Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending"))
    if end_date:
        query = query.filter(Transaction.date_operation <= end_date)
    if only_reconciled:
        query = query.filter(Transaction.reconciliation_date != None)
        
    transactions = query.all()
    
    for t in transactions:
        amount = t.amount
        
        # Rule: Depuis -> negative impact
        if t.from_account_id and t.from_account_id in balances:
            balances[t.from_account_id] -= amount
            
        # Rule: Vers -> positive impact
        if t.to_account_id and t.to_account_id in balances:
            balances[t.to_account_id] += amount
            
    # Return formatted to 2 decimals to avoid float precision issues
    return {k: round(v, 2) for k, v in balances.items()}

def get_net_worth(db: Session, end_date: date = None, only_reconciled: bool = False):
    balances = calculate_balances(db, end_date, only_reconciled)
    accounts = db.query(Account).all()
    base_curr = get_base_currency(db)
    acc_map = {a.id: a for a in accounts}
    
    total = 0.0
    for acc_id, balance in balances.items():
        acc = acc_map.get(acc_id)
        if acc and not acc.is_closed:
            acc_currency = getattr(acc, "currency", None) or base_curr
            converted_bal = convert_currency(db, balance, acc_currency, base_curr)
            total += converted_bal
            
    return round(total, 2)

def get_liquid_net_worth(db: Session, end_date: date = None, only_reconciled: bool = False):
    balances = calculate_balances(db, end_date, only_reconciled)
    accounts = db.query(Account).all()
    base_curr = get_base_currency(db)
    acc_map = {a.id: a for a in accounts}
    
    liquid_total = 0.0
    loan_total = 0.0
    for acc_id, balance in balances.items():
        acc = acc_map.get(acc_id)
        if acc and not acc.is_closed:
            is_loan = bool(acc.type and any(k in acc.type.lower() for k in ['prêt', 'pret', 'emprunt', 'loan', 'crédit', 'credit']))
            acc_currency = getattr(acc, "currency", None) or base_curr
            converted_bal = convert_currency(db, balance, acc_currency, base_curr)
            if is_loan:
                loan_total += abs(converted_bal)
            else:
                liquid_total += converted_bal
            
    return round(liquid_total, 2), round(loan_total, 2)


def get_main_account(db: Session):
    """
    Returns the main checking account.
    Priority: 1) GlobalConfig key 'main_account_id', 2) auto-detect (account with most transactions).
    """
    conf = db.query(GlobalConfig).filter(GlobalConfig.key == "main_account_id").first()
    if conf and conf.value:
        try:
            acc = db.query(Account).filter(Account.id == int(conf.value)).first()
            if acc:
                return acc
        except:
            pass
    # Auto-detect: account with most outgoing transactions
    from sqlalchemy import func as sqlfunc
    result = db.query(
        Transaction.from_account_id,
        sqlfunc.count(Transaction.id).label('cnt')
    ).filter(Transaction.from_account_id != None).group_by(Transaction.from_account_id).order_by(sqlfunc.count(Transaction.id).desc()).first()
    if result:
        return db.query(Account).filter(Account.id == result.from_account_id).first()
    return db.query(Account).first()

def calculate_rest_to_live(db: Session, current_date: date, next_pay_date: date):
    """
    Reste à vivre = solde rapproché du compte principal - dépenses futures avant prochaine paie.
    """
    account = get_main_account(db)
    if not account:
        return 0.0
        
    # Current balance (reconciled only)
    balances_now = calculate_balances(db, only_reconciled=True)
    current_balance = balances_now.get(account.id, 0.0)
    
    # All unreconciled expenses before next pay date (exclude skipped and pending cross-profile)
    future_tx = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation < next_pay_date,
        Transaction.from_account_id == account.id,
        Transaction.to_account_id == None, # Expense
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).all()
    
    future_transfers = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation < next_pay_date,
        Transaction.from_account_id == account.id,
        Transaction.to_account_id != None, # Transfer out
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).all()
    
    expenses_sum = sum(t.amount for t in future_tx) + sum(t.amount for t in future_transfers)

    # Subtract active piggy bank (tirelire) balances — reserved funds
    from app.models import Budget, BudgetAllocation
    savings_budgets = db.query(Budget).filter(
        Budget.envelope_type == "savings",
        Budget.is_closed == False
    ).all()
    savings_total = 0.0
    for sb in savings_budgets:
        # Manual allocations on this main account
        allocs = db.query(BudgetAllocation).filter(
            BudgetAllocation.budget_id == sb.id,
            (BudgetAllocation.account_id == account.id) | (BudgetAllocation.account_id == None)
        ).all()
        alloc_balance = sum(a.amount for a in allocs)  # positive = deposit, negative = withdrawal
        # Transactions assigned via budget_id on this main account
        txs = db.query(Transaction).filter(
            Transaction.budget_id == sb.id,
            (Transaction.from_account_id == account.id) | (Transaction.to_account_id == account.id),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()
        tx_income = sum(abs(t.amount) for t in txs if t.type == "income")
        tx_expenses = sum(abs(t.amount) for t in txs if t.type != "income")
        savings_total += (tx_income - tx_expenses) + alloc_balance

    return round(current_balance - expenses_sum - max(savings_total, 0), 2)

def get_accounts_available_balances(db: Session):
    """
    Calculates the real and available (virtual) balance for all accounts.
    Available balance = Real balance (reconciled only) - active savings allocated to that account.
    """
    from app.models import Budget, BudgetAllocation
    main_account = get_main_account(db)
    main_acc_id = main_account.id if main_account else None
    
    # 1. Real balances (reconciled)
    real_balances = calculate_balances(db, only_reconciled=True)
    
    # 2. Query all active savings budgets
    savings_budgets = db.query(Budget).filter(
        Budget.envelope_type == "savings",
        Budget.is_closed == False
    ).all()
    
    # 3. Sum savings allocations per account
    savings_by_account = {}
    savings_ids = [sb.id for sb in savings_budgets]
    
    if savings_ids:
        # Bulk load allocations
        allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id.in_(savings_ids)).all()
        for a in allocs:
            acc_id = a.account_id if a.account_id is not None else main_acc_id
            if acc_id:
                savings_by_account[acc_id] = savings_by_account.get(acc_id, 0.0) + a.amount
                
        # Bulk load transactions linked to savings budgets
        txs = db.query(Transaction).filter(
            Transaction.budget_id.in_(savings_ids),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        ).all()
        for tx in txs:
            # Income (deposits) on account
            if tx.type == "income" and tx.to_account_id:
                savings_by_account[tx.to_account_id] = savings_by_account.get(tx.to_account_id, 0.0) + abs(tx.amount)
            # Expense (withdrawals) from account
            elif tx.type != "income" and tx.from_account_id:
                savings_by_account[tx.from_account_id] = savings_by_account.get(tx.from_account_id, 0.0) - abs(tx.amount)
                
    # 4. Compile results
    accounts = db.query(Account).filter(Account.is_closed == False).all()
    results = {}
    for acc in accounts:
        real_bal = real_balances.get(acc.id, 0.0)
        sav_bal = savings_by_account.get(acc.id, 0.0)
        # Ensure savings balance isn't negative
        sav_bal = max(sav_bal, 0.0)
        avail_bal = round(real_bal - sav_bal, 2)
        results[acc.id] = {
            "account_id": acc.id,
            "name": acc.name,
            "type": acc.type,
            "color": acc.color,
            "real_balance": real_bal,
            "savings_allocated": round(sav_bal, 2),
            "available_balance": avail_bal
        }
    return results

def get_overdraft_warning(db: Session, account_id: int = None, current_date: date = None):
    """
    Calculate if and when the account will drop below 0 if NO future income is received.
    If account_id is None, uses the main account.
    """
    if account_id is None:
        account = get_main_account(db)
    else:
        account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        return None
        
    balances_now = calculate_balances(db, only_reconciled=True)
    simulated_balance = balances_now.get(account.id, 0.0)
    
    # Get all unreconciled expenses sorted by date (exclude skipped and pending cross-profile)
    future_expenses = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.from_account_id == account.id,
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).order_by(Transaction.date_operation.asc()).all()

    
    for t in future_expenses:
        simulated_balance -= t.amount
        if simulated_balance < 0:
            return {
                "date": t.date_operation,
                "transaction_description": t.description,
                "transaction_amount": t.amount,
                "projected_balance": round(simulated_balance, 2),
                "transaction_id": t.id
            }
            
    return None

def predict_next_paycheck(db: Session):
    """
    Intelligently predict the next pay date and amount.
    Reads base_pay_day from GlobalConfig.
    Checks recent months for large Recettes around that date to refine prediction.
    Also handles user overrides for the current cycle.
    """
    from app.models import GlobalConfig
    from datetime import date, timedelta
    import calendar
    import statistics
    
    today = date.today()
    
    # 1. Get Base Pay Day from active profile or config
    try:
        from app.profile_manager import get_active_profile
        active_prof = get_active_profile()
    except Exception:
        active_prof = None

    if active_prof and active_prof.get("pay_cycle_day"):
        base_pay_day = int(active_prof["pay_cycle_day"])
    else:
        conf_day = db.query(GlobalConfig).filter(GlobalConfig.key == "base_pay_day").first()
        try:
            base_pay_day = int(conf_day.value) if conf_day and conf_day.value else 28
        except ValueError:
            base_pay_day = 28

    conf_cat = db.query(GlobalConfig).filter(GlobalConfig.key == "pay_category").first()
    pay_category = conf_cat.value if conf_cat and conf_cat.value else None

    conf_pct = db.query(GlobalConfig).filter(GlobalConfig.key == "pay_threshold_percent").first()
    try:
        pay_threshold_percent = float(conf_pct.value) if conf_pct and conf_pct.value else 30.0
    except ValueError:
        pay_threshold_percent = 30.0
    
    # 3. Analyze last 12 months history
    historical_amounts = []
    historical_days = []
    history_records = []
    
    current_month_received = False
    
    # Check if manually validated
    val_period = db.query(GlobalConfig).filter(GlobalConfig.key == "last_validated_pay_period").first()
    current_period_str = f"{today.year:04d}-{today.month:02d}"
    if val_period and val_period.value == current_period_str:
        current_month_received = True
        
    override_date_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_date").first()
    override_amount_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
    override_period_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_period").first()

    # PERF: Bulk-load all reconciled income transactions for the past ~14 months
    # instead of querying 13 times individually in the loop below.
    lookback_date = date(today.year if today.month > 1 else today.year - 1,
                         today.month - 1 if today.month > 1 else 12, 1)
    # Go back 14 months to cover the full window
    for _ in range(13):
        if lookback_date.month == 1:
            lookback_date = lookback_date.replace(year=lookback_date.year - 1, month=12)
        else:
            lookback_date = lookback_date.replace(month=lookback_date.month - 1)
    all_incomes = db.query(
        Transaction.id,
        Transaction.amount,
        Transaction.date_operation,
        Transaction.description,
        Transaction.category,
        Transaction.is_salary
    ).filter(
        Transaction.type == "income",
        Transaction.date_operation >= lookback_date,
        Transaction.reconciliation_date.isnot(None)
    ).all()
    
    # Iterate from OLDEST month (12 months ago) to CURRENT month (i=0).
    # This ensures the historical average is established from real paycheck
    # data before we evaluate the current month — preventing low-amount
    # incomes from passing a fallback threshold.
    for i in range(12, -1, -1):
        # Go back i months
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
            
        period_str = f"{y:04d}-{m:02d}"
            
        # Define window: base_pay_day +/- 5 days
        try:
            target_date = date(y, m, base_pay_day)
        except ValueError:
            # Handle Feb 29 etc.
            last_day = calendar.monthrange(y, m)[1]
            target_date = date(y, m, min(base_pay_day, last_day))
            
        window_start = target_date - timedelta(days=5)
        window_end = target_date + timedelta(days=5)
        
        # 1. Search for real reconciled paycheck in the database first
        hist_avg = statistics.mean(historical_amounts) if historical_amounts else 1000.0
        threshold_value = hist_avg * (pay_threshold_percent / 100.0)

        best_income = None
        for tx in all_incomes:
            # Filter out transactions explicitly marked as not salary
            if tx.is_salary is False:
                continue
            
            # Window boundary check (bypassed if explicitly marked as salary for this calendar month)
            is_in_period = (tx.date_operation.year == y and tx.date_operation.month == m)
            is_in_window = (window_start <= tx.date_operation <= window_end)
            if not (is_in_window or (tx.is_salary is True and is_in_period)):
                continue
            
            # Check if marked explicitly as salary, or matches category filter, or exceeds threshold
            is_valid_salary = False
            if tx.is_salary is True:
                is_valid_salary = True
            else:
                has_matching_category = (pay_category and tx.category == pay_category)
                if has_matching_category:
                    is_valid_salary = True
                elif tx.amount >= threshold_value:
                    is_valid_salary = True

            if is_valid_salary:
                if best_income is None or tx.amount > best_income.amount:
                    best_income = tx
                    
        # 2. Check if there is an override for THIS specific period
        has_override_for_period = False
        if override_period_conf and override_period_conf.value == period_str:
            if override_date_conf and override_date_conf.value:
                has_override_for_period = True

        # 3. Apply priority logic
        if best_income:
            # Real database transaction takes priority
            if i == 0:
                current_month_received = True
            historical_amounts.append(best_income.amount)
            historical_days.append(best_income.date_operation.day)
            history_records.append({
                "id": best_income.id,
                "date": best_income.date_operation.isoformat(),
                "amount": best_income.amount,
                "description": best_income.description,
                "logical_period": period_str
            })
        elif has_override_for_period:
            # Override applies if no real transaction is reconciled yet
            o_date_str = override_date_conf.value
            if i == 0:
                # Only mark current month paycheck as received if the override date is today or in the past
                try:
                    o_date = date.fromisoformat(o_date_str)
                    if o_date <= today:
                        current_month_received = True
                except:
                    current_month_received = True
            o_amount = float(override_amount_conf.value) if override_amount_conf and override_amount_conf.value else 0.0
            historical_amounts.append(o_amount)
            
            try:
                historical_days.append(date.fromisoformat(o_date_str).day)
            except:
                historical_days.append(base_pay_day)
                
            history_records.append({
                "date": o_date_str,
                "amount": o_amount,
                "description": "",
                "is_override": True,
                "logical_period": period_str
            })
        elif val_period and val_period.value == period_str:
            # The period was validated but no paycheck was found, and no override exists.
            if i == 0:
                current_month_received = True
            historical_amounts.append(0.0)
            historical_days.append(base_pay_day)
            history_records.append({
                "date": target_date.isoformat(),
                "amount": 0.0,
                "description": "Période forcée",
                "is_override": True,
                "logical_period": period_str
            })
        else:
            # No paycheck found, no override, not validated. Append a placeholder.
            history_records.append({
                "date": target_date.isoformat(),
                "amount": None,
                "description": "Aucune paie détectée",
                "is_placeholder": True,
                "logical_period": period_str
            })

    # Reverse so the most recent entry is first (expected by UI pay history modal)
    history_records.reverse()
            
    # 4. Compute Predictions (move up to establish logical period)
    predicted_amount = 0.0
    if historical_amounts:
        predicted_amount = round(statistics.mean(historical_amounts), 2)
        
    predicted_day = base_pay_day
    if historical_days:
        s_days = sorted(historical_days)
        predicted_day = s_days[len(s_days)//2]
        
    # Calculate exact logical period using a loop to support forcing multiple months forward
    logical_y = today.year
    logical_m = today.month
    
    while True:
        current_period_str = f"{logical_y:04d}-{logical_m:02d}"
        is_val = bool(val_period and val_period.value >= current_period_str)
        
        if is_val:
            logical_m += 1
            if logical_m > 12:
                logical_m = 1
                logical_y += 1
            continue
        elif logical_y == today.year and logical_m == today.month and current_month_received:
            logical_m += 1
            if logical_m > 12:
                logical_m = 1
                logical_y += 1
            continue
        else:
            break
            
    logical_period_str = f"{logical_y:04d}-{logical_m:02d}"
    
    # 2. Check for Manual Overrides (if the user manually corrected this month's prediction)
    # We do this after collecting history so the modal can still show history even if overridden
    override_date_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_date").first()
    override_amount_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
    override_period_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_period").first()
    
    if override_date_conf and override_date_conf.value:
        try:
            o_date = date.fromisoformat(override_date_conf.value)
            is_valid_override = False
            if override_period_conf and override_period_conf.value:
                if override_period_conf.value == logical_period_str:
                    is_valid_override = True
            else:
                if o_date >= today - timedelta(days=15):
                    non_override_dates = [date.fromisoformat(h["date"]) for h in history_records if not h.get("is_override")]
                    if not non_override_dates or o_date > max(non_override_dates):
                        is_valid_override = True
                    
            if is_valid_override:
                o_amount = float(override_amount_conf.value) if override_amount_conf and override_amount_conf.value else 0.0
                # Add override as first entry in history for traceability if not already added
                already_added = any(h.get("logical_period") == logical_period_str for h in history_records)
                if not already_added:
                    history_records.insert(0, {
                        "date": o_date.isoformat(),
                        "amount": o_amount,
                        "description": "",
                        "is_override": True,
                        "logical_period": logical_period_str
                    })
                # Check if period is also validated (for widget state)
                is_period_validated = bool(val_period and val_period.value >= logical_period_str)
                val_date = db.query(GlobalConfig).filter(GlobalConfig.key == "last_validated_pay_date").first()
                validated_date = val_date.value if val_date else None
                return {
                    "date": o_date,
                    "amount": o_amount,
                    "is_override": True,
                    "is_period_validated": is_period_validated,
                    "validated_pay_date": validated_date,
                    "history": history_records,
                    "logical_period": logical_period_str
                }
        except:
            pass
            
    try:
        next_pay_date = date(logical_y, logical_m, predicted_day)
    except ValueError:
        last_day = calendar.monthrange(logical_y, logical_m)[1]
        next_pay_date = date(logical_y, logical_m, last_day)
        
    # Check if manually validated for return metadata
    val_period = db.query(GlobalConfig).filter(GlobalConfig.key == "last_validated_pay_period").first()
    current_period_str = f"{today.year:04d}-{today.month:02d}"
    is_period_validated = bool(val_period and val_period.value >= current_period_str)
    
    val_date = db.query(GlobalConfig).filter(GlobalConfig.key == "last_validated_pay_date").first()
    validated_date = val_date.value if val_date else None

    return {
        "date": next_pay_date,
        "amount": predicted_amount,
        "is_override": False,
        "is_period_validated": is_period_validated,
        "validated_pay_date": validated_date,
        "history": history_records,
        "logical_period": logical_period_str
    }
