from datetime import timedelta
from app.models import Transaction

def heuristic_parse(df):
    """
    Attempts to find date, description, and amount columns in a generic DataFrame.
    """
    import pandas as pd
    date_col, amount_col, desc_col = None, None, None
    
    # 1. Find Date Column
    for col in df.columns:
        if date_col: break
        # Try to parse the first 10 non-null values as dates
        sample = df[col].dropna().head(10)
        if len(sample) == 0: continue
        
        try:
            # Try ISO8601 first (Excel converts to ISO strings)
            parsed = pd.to_datetime(sample, format='ISO8601', errors='coerce')
            if parsed.notna().sum() < len(sample) * 0.8:
                # Fallback to French dayfirst format
                parsed = pd.to_datetime(sample, dayfirst=True, errors='coerce')
                
            if parsed.notna().sum() >= len(sample) * 0.8: # 80% success
                date_col = col
        except:
            pass

    # 2. Find Amount Column(s)
    amount_cols = []
    for col in df.columns:
        if col == date_col: continue
        
        sample = df[col].dropna().head(10).astype(str)
        if len(sample) == 0: continue
        
        cleaned = sample.str.replace('€', '', regex=False) \
                        .str.replace('\u202f', '', regex=False) \
                        .str.replace('\xa0', '', regex=False) \
                        .str.replace(' ', '', regex=False) \
                        .str.replace(',', '.', regex=False) \
                        .str.strip()
        
        def is_float(x):
            try:
                float(x)
                return True
            except:
                return False
                
        if cleaned.apply(is_float).sum() >= len(sample) * 0.8:
            amount_cols.append(col)

    # If multiple amount cols (e.g. Debit / Credit), we merge them
    amount_col = None
    if len(amount_cols) == 1:
        amount_col = amount_cols[0]
    elif len(amount_cols) > 1:
        # Merge them into a single column
        def parse_amt(val):
            try:
                return float(str(val).replace('€','').replace(' ','').replace('\u202f','').replace('\xa0','').replace(',','.').strip())
            except:
                return 0.0
                
        # We assume if there are two columns, one is positive, one is negative, or they just need to be summed/coalesced
        # Usually it's Debit and Credit. We just take whichever is non-zero.
        # But wait, we need to preserve signs. Debit is usually positive in the CSV (as an absolute value) and Credit too.
        # Wait, if we just sum them, they might both be absolute.
        # Let's coalesce them: take the first valid non-zero, or just sum them. If one is named 'Débit' it should be negative.
        # Actually, simpler: in analyze_heuristic we already apply abs(), so we can just sum them here or take the max abs value.
        df['_merged_amount'] = 0.0
        for col in amount_cols:
            df['_merged_amount'] += df[col].apply(parse_amt).fillna(0.0)
        
        # We need to correctly handle signs if they are all absolute. 
        # Actually, if one column is 'Débit' or 'Debit', we should negate it!
        df['_merged_amount'] = 0.0
        for col in amount_cols:
            series = df[col].apply(parse_amt).fillna(0.0)
            if 'debit' in str(col).lower() or 'débit' in str(col).lower():
                series = -series
            df['_merged_amount'] += series
            
        amount_col = '_merged_amount'

    # 3. Find Description Column (Longest strings on average)
    max_len = 0
    desc_col = None
    for col in df.columns:
        if col == date_col or col in amount_cols or col == amount_col: continue
        
        sample = df[col].dropna().head(10).astype(str)
        if len(sample) == 0: continue
        
        avg_len = sample.str.len().mean()
        if avg_len > max_len:
            max_len = avg_len
            desc_col = col

    return date_col, amount_col, desc_col

def check_reconciliation(db, tx_date, tx_amount, matched_ids=None):
    """
    Checks if a transaction with the exact amount exists within +/- 15 days.
    Returns dict with matched DB transaction ID and description, or None.
    """
    import pandas as pd
    if pd.isna(tx_date) or pd.isna(tx_amount):
        return None
        
    start_date = tx_date - timedelta(days=10)
    end_date = tx_date + timedelta(days=10)
    
    # We compare absolute amounts since the new architecture stores absolute amounts
    abs_amount = abs(float(tx_amount))
    epsilon = 0.01
    
    query = db.query(Transaction).filter(
        Transaction.date_operation >= start_date,
        Transaction.date_operation <= end_date,
        Transaction.amount >= abs_amount - epsilon,
        Transaction.amount <= abs_amount + epsilon
    )
    
    if matched_ids:
        query = query.filter(Transaction.id.notin_(matched_ids))
    
    # Prefer unreconciled transactions first (reconciliation_date IS NULL),
    # then by closest date to the import date.
    # julianday() requires a string; convert pandas Timestamp to ISO string.
    from sqlalchemy import case, func, text, literal
    tx_date_str = tx_date.strftime("%Y-%m-%d")
    query = query.order_by(
        case((Transaction.reconciliation_date == None, 0), else_=1),
        func.abs(func.julianday(Transaction.date_operation) - func.julianday(tx_date_str))
    )
    match = query.first()
    
    if match:
        is_already_reconciled = match.reconciliation_date is not None
        if is_already_reconciled:
            # Only consider already-reconciled transactions as duplicates if they are within 7 days.
            # Otherwise, it's likely a distinct transaction (e.g., same amount next month)
            # and we should treat the incoming transaction as a NEW transaction.
            diff_days = abs((match.date_operation - tx_date.date()).days)
            if diff_days > 7:
                return None

        return {
            "id": match.id, 
            "description": match.description,
            "already_reconciled": is_already_reconciled
        }
    return None
