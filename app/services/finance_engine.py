from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models import Account, Transaction, GlobalConfig

def calculate_balances(db: Session, end_date: date = None, only_reconciled: bool = False):
    """
    Calculate the balance of each account.
    If end_date is provided, only include transactions with date_operation <= end_date.
    If only_reconciled is True, only include transactions that have a reconciliation_date.
    Returns a dict: {account_id: balance}
    """
    accounts = db.query(Account).all()
    balances = {a.id: a.initial_balance for a in accounts}
    
    query = db.query(Transaction)
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
    closed_accounts = db.query(Account).filter(Account.is_closed == True).all()
    closed_ids = set(a.id for a in closed_accounts)
    total = sum(v for k, v in balances.items() if k not in closed_ids)
    return round(total, 2)

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
    
    # All unreconciled expenses before next pay date
    future_tx = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation < next_pay_date,
        Transaction.from_account_id == account.id,
        Transaction.to_account_id == None # Expense
    ).all()
    
    future_transfers = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation < next_pay_date,
        Transaction.from_account_id == account.id,
        Transaction.to_account_id != None # Transfer out
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
        # Manual allocations
        allocs = db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == sb.id).all()
        alloc_balance = sum(a.amount for a in allocs)  # positive = deposit, negative = withdrawal
        # Transactions assigned via budget_id
        txs = db.query(Transaction).filter(Transaction.budget_id == sb.id).all()
        tx_income = sum(abs(t.amount) for t in txs if t.type == "income")
        tx_expenses = sum(abs(t.amount) for t in txs if t.type != "income")
        savings_total += (tx_income - tx_expenses) + alloc_balance

    return round(current_balance - expenses_sum - max(savings_total, 0), 2)

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
    
    # Get all unreconciled expenses sorted by date
    future_expenses = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.from_account_id == account.id
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
    
    # 1. Get Base Pay Day from config
    conf_day = db.query(GlobalConfig).filter(GlobalConfig.key == "base_pay_day").first()
    try:
        base_pay_day = int(conf_day.value) if conf_day and conf_day.value else 28
    except ValueError:
        base_pay_day = 28
    
    # 3. Analyze last 12 months history
    historical_amounts = []
    historical_days = []
    history_records = []
    
    for i in range(1, 13):
        # Go back i months
        m = today.month - i
        y = today.year
        if m <= 0:
            m += 12
            y -= 1
            
        # Define window: base_pay_day +/- 5 days
        try:
            target_date = date(y, m, base_pay_day)
        except ValueError:
            # Handle Feb 29 etc.
            last_day = calendar.monthrange(y, m)[1]
            target_date = date(y, m, min(base_pay_day, last_day))
            
        window_start = target_date - timedelta(days=5)
        window_end = target_date + timedelta(days=5)
        
        # Find largest Recettes in this window
        largest_income = db.query(Transaction).filter(
            Transaction.type == "income",
            Transaction.date_operation >= window_start,
            Transaction.date_operation <= window_end
        ).order_by(Transaction.amount.desc()).first()
        
        if largest_income:
            historical_amounts.append(largest_income.amount)
            historical_days.append(largest_income.date_operation.day)
            history_records.append({
                "date": largest_income.date_operation.isoformat(),
                "amount": largest_income.amount,
                "description": largest_income.description
            })
            
    # 2. Check for Manual Overrides (if the user manually corrected this month's prediction)
    # We do this after collecting history so the modal can still show history even if overridden
    override_date_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_date").first()
    override_amount_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "override_paycheck_amount").first()
    
    if override_date_conf and override_date_conf.value:
        try:
            o_date = date.fromisoformat(override_date_conf.value)
            if o_date >= today:
                o_amount = float(override_amount_conf.value) if override_amount_conf and override_amount_conf.value else 0.0
                return {"date": o_date, "amount": o_amount, "is_override": True, "history": history_records}
        except:
            pass
            
    # 4. Compute Predictions
    predicted_amount = 0.0
    if historical_amounts:
        predicted_amount = round(statistics.mean(historical_amounts), 2)
        
    predicted_day = base_pay_day
    if historical_days:
        try:
            predicted_day = statistics.mode(historical_days)
        except statistics.StatisticsError:
            # If no unique mode, use the average or the last one
            predicted_day = round(statistics.mean(historical_days))
            
    # Calculate exact next date
    if today.day >= predicted_day:
        # Next month
        m = today.month + 1
        y = today.year
        if m > 12:
            m = 1
            y += 1
    else:
        # This month
        m = today.month
        y = today.year
        
    try:
        next_pay_date = date(y, m, predicted_day)
    except ValueError:
        last_day = calendar.monthrange(y, m)[1]
        next_pay_date = date(y, m, last_day)
        
    return {"date": next_pay_date, "amount": predicted_amount, "is_override": False, "history": history_records}
