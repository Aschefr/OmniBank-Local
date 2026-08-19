from datetime import timedelta, date
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
        except Exception:
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
            except Exception:
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
                parsed = float(str(val).replace('€','').replace(' ','').replace('\u202f','').replace('\xa0','').replace(',','.').strip())
                import math
                if math.isnan(parsed) or math.isinf(parsed):
                    return 0.0
                return parsed
            except Exception:
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

def check_reconciliation(db, tx_date, tx_amount, matched_ids=None, account_id=None):
    """
    Checks if a transaction with the exact amount exists in the database.
    First looks for an already-reconciled transaction with a close reconciliation date (+/- 4 days).
    Then looks for an unreconciled planned transaction with a close operation date (+/- 15 days).
    Handles internal transfers across accounts (from_account_id / to_account_id).
    """
    import pandas as pd
    from datetime import timedelta
    if pd.isna(tx_date) or pd.isna(tx_amount):
        return None
        
    abs_amount = abs(float(tx_amount))
    epsilon = 0.01
    
    from sqlalchemy import or_, and_, func
    start_recon = tx_date - timedelta(days=4)
    end_recon = tx_date + timedelta(days=4)
    start_op_limit = tx_date - timedelta(days=10)
    end_op_limit = tx_date + timedelta(days=10)
    
    # Clause de filtre par compte si fourni
    acc_filter = None
    if account_id:
        acc_filter = or_(
            Transaction.from_account_id == account_id,
            Transaction.to_account_id == account_id
        )

    # 1. Recherche d'un doublon déjà rapproché / existant
    recon_query = db.query(Transaction).filter(
        Transaction.reconciliation_date != None,
        Transaction.amount >= abs_amount - epsilon,
        Transaction.amount <= abs_amount + epsilon,
        or_(
            (Transaction.reconciliation_date >= start_recon) & (Transaction.reconciliation_date <= end_recon),
            (Transaction.date_operation >= start_op_limit) & (Transaction.date_operation <= end_op_limit)
        )
    )
    if acc_filter is not None:
        recon_query = recon_query.filter(acc_filter)

    # Pour les virements internes (type == 'transfer' ou from & to renseignés),
    # autoriser la détection même si l'ID a déjà été vu dans le lot
    if matched_ids:
        recon_query_filtered = recon_query.filter(
            or_(
                Transaction.id.notin_(matched_ids),
                Transaction.type == "transfer",
                and_(Transaction.from_account_id.isnot(None), Transaction.to_account_id.isnot(None))
            )
        )
    else:
        recon_query_filtered = recon_query
        
    tx_date_str = tx_date.strftime("%Y-%m-%d")
    recon_query_filtered = recon_query_filtered.order_by(
        func.abs(func.julianday(Transaction.date_operation) - func.julianday(tx_date_str))
    )
    
    recon_match = recon_query_filtered.first()
    if recon_match:
        return {
            "id": recon_match.id, 
            "description": recon_match.description,
            "already_reconciled": True
        }
        
    # 2. Recherche d'une prédiction non pointée / transaction planifiée
    start_op = tx_date - timedelta(days=15)
    end_op = tx_date + timedelta(days=15)
    
    op_query = db.query(Transaction).filter(
        Transaction.reconciliation_date == None,
        Transaction.date_operation >= start_op,
        Transaction.date_operation <= end_op,
        Transaction.amount >= abs_amount - epsilon,
        Transaction.amount <= abs_amount + epsilon
    )
    if acc_filter is not None:
        op_query = op_query.filter(acc_filter)

    # 2.A : D'abord chercher parmi les transactions non encore appariées
    available_op_query = op_query
    if matched_ids:
        available_op_query = op_query.filter(Transaction.id.notin_(matched_ids))
        
    available_op_query = available_op_query.order_by(
        func.abs(func.julianday(Transaction.date_operation) - func.julianday(tx_date_str))
    )
    op_match = available_op_query.first()
    if op_match:
        return {
            "id": op_match.id,
            "description": op_match.description,
            "already_reconciled": False
        }

    # 2.B : Si aucun match libre, vérifier si c'est le pendant miroir d'un virement interne
    # déjà apparié dans ce même lot (dans matched_ids)
    if matched_ids:
        mirror_query = op_query.filter(
            Transaction.id.in_(matched_ids),
            or_(
                Transaction.type == "transfer",
                and_(Transaction.from_account_id.isnot(None), Transaction.to_account_id.isnot(None))
            )
        ).order_by(
            func.abs(func.julianday(Transaction.date_operation) - func.julianday(tx_date_str))
        )
        mirror_match = mirror_query.first()
        if mirror_match:
            return {
                "id": mirror_match.id,
                "description": mirror_match.description,
                "already_reconciled": True,
                "is_mirror_transfer": True
            }
        
    return None

def check_import_alerts(db, account_id: int, parsed_txs: list):
    """
    Analyzes the parsed transactions against the existing database transactions
    for the specified account_id to generate helpful warning alerts.
    """
    if not account_id or not parsed_txs:
        return {}
        
    from datetime import datetime, date, timedelta
    
    # Extract transaction dates from the import
    import_dates = []
    all_reconciled = True
    
    for tx in parsed_txs:
        is_rec = tx.get('is_reconciled', False)
        already_rec = tx.get('already_reconciled', False)
        if not (is_rec and already_rec):
            all_reconciled = False
            
        dt_val = tx.get('date_operation') or tx.get('date')
        if dt_val:
            try:
                if isinstance(dt_val, str):
                    parsed_dt = datetime.strptime(dt_val[:10], "%Y-%m-%d").date()
                elif isinstance(dt_val, (date, datetime)):
                    parsed_dt = dt_val.date() if isinstance(dt_val, datetime) else dt_val
                else:
                    parsed_dt = None
                if parsed_dt:
                    import_dates.append(parsed_dt)
            except Exception:
                pass

    alerts = {
        "all_duplicate": all_reconciled,
        "is_old_file": False,
        "has_gap": False,
        "latest_import_date": None,
        "latest_db_date": None,
        "oldest_import_date": None,
        "is_old_compared_to_today": False
    }
    
    if not import_dates:
        return alerts
        
    latest_import_date = max(import_dates)
    oldest_import_date = min(import_dates)
    alerts["latest_import_date"] = latest_import_date.strftime("%Y-%m-%d")
    alerts["oldest_import_date"] = oldest_import_date.strftime("%Y-%m-%d")
    
    # Get the latest transaction date in DB for this account
    db_tx_query = db.query(Transaction).filter(
        (Transaction.from_account_id == account_id) | (Transaction.to_account_id == account_id)
    ).order_by(Transaction.date_operation.desc())
    
    latest_db_tx = db_tx_query.first()
    
    if latest_db_tx:
        latest_db_date = latest_db_tx.date_operation
        alerts["latest_db_date"] = latest_db_date.strftime("%Y-%m-%d")
        
        # Case A: The latest transaction in the file is older than the latest transaction in the DB.
        if latest_import_date < latest_db_date:
            alerts["is_old_file"] = True
            
        # Case B: Potential gap. If the oldest transaction in the file is more recent than the latest in the DB
        # by more than 3 days.
        if oldest_import_date > latest_db_date + timedelta(days=3):
            alerts["has_gap"] = True
            
    # Check if the latest import date is significantly older than today
    today = date.today()
    if (today - latest_import_date).days > 7:
        alerts["is_old_compared_to_today"] = True
        
    return alerts


def extract_account_block(raw_data: list, account_name: str, account_type: str, explicit_section_title: str = None) -> list:
    """
    If the spreadsheet contains multiple account sections (e.g. Crédit Agricole multi-account export),
    extract only the rows corresponding to the target account.
    """
    import pandas as pd
    if not account_name and not explicit_section_title:
        return raw_data
        
    # 1. Identify section headers
    sections = []
    current_title = None
    current_title_idx = -1
    
    for i, row in enumerate(raw_data):
        # Detect section title (usually a single cell or short text with keyword)
        non_empty = [x for x in row if pd.notna(x) and str(x).strip() != '']
        if len(non_empty) == 1:
            val = str(non_empty[0]).lower()
            if any(k in val for k in ['compte de dépôt', 'compte de depot', 'compte courant', 'livret', 'ldd', 'compte n°', 'compte nu', 'carte n°', 'carte nu']):
                current_title = non_empty[0]
                current_title_idx = i
        
        # Detect table header
        valid_cols = sum(1 for x in row if pd.notna(x) and not str(x).startswith('Unnamed:') and str(x).strip() != '')
        if valid_cols >= 3 and any(str(x).strip().lower() in ['date', 'date operation', 'date d\'opération'] for x in row):
            sections.append({
                "title": current_title or f"Section {len(sections)+1}",
                "title_idx": current_title_idx,
                "header_idx": i
            })
            current_title = None
            current_title_idx = -1

    if len(sections) <= 1:
        return raw_data

    best_section = None
    
    if explicit_section_title:
        for sec in sections:
            if sec["title"] == explicit_section_title:
                best_section = sec
                break

    if not best_section:
        # Fallback to Match the best section by similarity
        best_score = -1
        name_words = [w.lower() for w in account_name.split() if len(w) > 2]
        
        for sec in sections:
            title = sec["title"].lower()
            score = 0
            
            if account_name.lower() in title:
                score += 10
                
            for w in name_words:
                if w in title:
                    score += 3
                    
            if 'livret a' in title and 'livret a' in account_name.lower():
                score += 15
            elif 'ldd' in title and 'ldd' in account_name.lower():
                score += 15
            elif 'dépôt' in title or 'depot' in title or 'courant' in title:
                if account_type.lower() == 'compte courant' or 'centre-est' in account_name.lower() or 'ile-de-france' in account_name.lower():
                    score += 5
                    
            if score > best_score:
                best_score = score
                best_section = sec
            
    if best_section:
        start_idx = best_section["title_idx"] if best_section["title_idx"] != -1 else best_section["header_idx"]
        
        end_idx = len(raw_data)
        for sec in sections:
            sec_start = sec["title_idx"] if sec["title_idx"] != -1 else sec["header_idx"]
            if sec_start > start_idx:
                end_idx = min(end_idx, sec_start)
                
        return raw_data[start_idx:end_idx]
        
    return raw_data


def detect_multi_account_sections(raw_data: list, account_name: str, account_type: str) -> dict:
    """
    Scans the raw_data for multiple account sections, calculates match confidence score
    for each, and returns a dictionary summarizing the results.
    """
    import pandas as pd
    sections = []
    current_title = None
    current_title_idx = -1
    
    for i, row in enumerate(raw_data):
        non_empty = [x for x in row if pd.notna(x) and str(x).strip() != '']
        if len(non_empty) == 1:
            val = str(non_empty[0]).lower()
            if any(k in val for k in ['compte de dépôt', 'compte de depot', 'compte courant', 'livret', 'ldd', 'compte n°', 'compte nu', 'carte n°', 'carte nu']):
                current_title = non_empty[0]
                current_title_idx = i
                
        valid_cols = sum(1 for x in row if pd.notna(x) and not str(x).startswith('Unnamed:') and str(x).strip() != '')
        if valid_cols >= 3 and any(str(x).strip().lower() in ['date', 'date operation', 'date d\'opération'] for x in row):
            sections.append({
                "title": current_title or f"Section {len(sections)+1}",
                "title_idx": current_title_idx,
                "header_idx": i
            })
            current_title = None
            current_title_idx = -1
            
    if len(sections) <= 1:
        return {
            "sections": [],
            "recommended_section": None,
            "confidence": 100
        }
        
    # Calculate confidence score for each section (mapped to percentage 0-100)
    scored_sections = []
    name_words = [w.lower() for w in account_name.split() if len(w) > 2]
    
    for sec in sections:
        title = sec["title"]
        title_lower = title.lower()
        score = 0
        
        if account_name.lower() in title_lower:
            score += 60
            
        for w in name_words:
            if w in title_lower:
                score += 20
                
        if 'livret a' in title_lower and 'livret a' in account_name.lower():
            score += 90
        elif 'ldd' in title_lower and 'ldd' in account_name.lower():
            score += 90
        elif 'dépôt' in title_lower or 'depot' in title_lower or 'courant' in title_lower:
            if account_type.lower() == 'compte courant' or 'centre-est' in account_name.lower() or 'ile-de-france' in account_name.lower():
                score += 50
                
        confidence = min(score, 100)
        if confidence == 0:
            confidence = 10
            
        scored_sections.append({
            "title": title,
            "confidence": confidence
        })
        
    scored_sections.sort(key=lambda x: x["confidence"], reverse=True)
    recommended = scored_sections[0]["title"] if scored_sections else None
    top_confidence = scored_sections[0]["confidence"] if scored_sections else 100
    
    return {
        "sections": [s["title"] for s in scored_sections],
        "recommended_section": recommended,
        "confidence": top_confidence
    }


