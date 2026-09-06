from datetime import timedelta, date
import hashlib
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
        
        non_empty = cleaned[cleaned != '']
        if len(non_empty) == 0: continue

        def is_float(x):
            try:
                float(x)
                return True
            except Exception:
                return False
                
        col_lower = str(col).strip().lower()
        is_named_amount = any(k in col_lower for k in ['montant', 'debit', 'débit', 'credit', 'crédit', 'solde'])

        if (non_empty.apply(is_float).sum() >= len(non_empty) * 0.8) or (is_named_amount and non_empty.apply(is_float).sum() >= 1):
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
                
        df['_merged_amount'] = 0.0
        for col in amount_cols:
            series = df[col].apply(parse_amt).fillna(0.0)
            col_l = str(col).lower()
            if 'debit' in col_l or 'débit' in col_l:
                series = -series.abs()
            elif 'credit' in col_l or 'crédit' in col_l:
                series = series.abs()
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

from app.services.reconciliation_engine import check_reconciliation


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
    
    # Get the latest RECONCILED or PAST transaction date in DB for this account
    # Ignore future planned recurrences (which can extend into 2027+)
    today = date.today()
    db_tx_query = db.query(Transaction).filter(
        (Transaction.from_account_id == account_id) | (Transaction.to_account_id == account_id),
        (Transaction.reconciliation_date != None) | (Transaction.date_operation <= today)
    ).order_by(Transaction.date_operation.desc())
    
    latest_db_tx = db_tx_query.first()
    
    if latest_db_tx:
        latest_db_date = latest_db_tx.date_operation
        alerts["latest_db_date"] = latest_db_date.strftime("%Y-%m-%d")
        
        # Case A: The latest transaction in the file is older than the latest past/reconciled transaction in DB
        # AND the file is noticeably older than today (> 7 days).
        if latest_import_date < latest_db_date and (today - latest_import_date).days > 7:
            alerts["is_old_file"] = True
            
        # Case B: Potential gap. If the oldest transaction in the file is more recent than the latest in the DB
        # by more than 3 days.
        if oldest_import_date > latest_db_date + timedelta(days=3):
            alerts["has_gap"] = True
            
    # Check if the latest import date is significantly older than today
    if (today - latest_import_date).days > 30:
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
            val = str(non_empty[0]).lower().strip()
            if val.startswith('compte') or any(k in val for k in ['compte de dépôt', 'compte de depot', 'compte courant', 'livret', 'ldd', 'compte n°', 'compte nu', 'carte n°', 'carte nu', 'compte :', 'compte:', 'onglet', 'relevé']):
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


def extract_all_sections_parsed(
    raw_data: list,
    db,
    db_accounts: list = None,
    explicit_account_id: int = None
) -> list:
    """
    Parses an entire bank export file (CSV/Excel/TSV) by discovering all account sections,
    extracting transactions, balances, reconciling against the DB, and mapping to OmniBank accounts.
    Returns a list of accounts ready for the pending sync sas and cockpit.
    """
    import pandas as pd
    import uuid
    import math
    from app.models import Account, Transaction

    if db_accounts is None and db is not None:
        db_accounts = db.query(Account).filter(Account.is_closed == False).all()
    elif db_accounts is None:
        db_accounts = []

    # 1. Identify all section boundaries
    sections = []
    current_title = None
    current_title_idx = -1

    for i, row in enumerate(raw_data):
        non_empty = [x for x in row if pd.notna(x) and str(x).strip() != '']
        if len(non_empty) == 1:
            val = str(non_empty[0]).lower().strip()
            if val.startswith('compte') or any(k in val for k in ['compte de dépôt', 'compte de depot', 'compte courant', 'livret', 'ldd', 'compte n°', 'compte nu', 'carte n°', 'carte nu', 'compte :', 'compte:', 'onglet', 'relevé']):
                current_title = str(non_empty[0]).strip()
                current_title_idx = i

        valid_cols = sum(1 for x in row if pd.notna(x) and not str(x).startswith('Unnamed:') and str(x).strip() != '')
        if valid_cols >= 3 and any(str(x).strip().lower() in ['date', 'date operation', "date d'opération"] for x in row):
            sections.append({
                "title": current_title or f"Section {len(sections)+1}",
                "title_idx": current_title_idx,
                "header_idx": i
            })
            current_title = None
            current_title_idx = -1

    # If no multi-sections detected, treat entire raw_data as single section
    if not sections:
        sections = [{
            "title": "Relevé",
            "title_idx": -1,
            "header_idx": -1
        }]

    # Compute start_idx and end_idx for each section
    section_blocks = []
    if len(sections) == 1 and sections[0]["title_idx"] == -1 and sections[0]["header_idx"] == -1:
        section_blocks.append({
            "title": "Relevé",
            "rows": raw_data
        })
    else:
        for idx, sec in enumerate(sections):
            start_idx = sec["title_idx"] if sec["title_idx"] != -1 else sec["header_idx"]
            if idx + 1 < len(sections):
                next_sec = sections[idx + 1]
                end_idx = next_sec["title_idx"] if next_sec["title_idx"] != -1 else next_sec["header_idx"]
            else:
                end_idx = len(raw_data)
            section_blocks.append({
                "title": sec["title"],
                "rows": raw_data[start_idx:end_idx]
            })

    unique_batch_id = uuid.uuid4().hex[:6]
    accounts_out = []
    used_account_ids = set()
    matched_ids_global = set()
    tx_sig_counts = {}

    for sec_i, block in enumerate(section_blocks):
        sec_rows = block["rows"]
        sec_title = block["title"]
        if not sec_rows:
            continue

        # Find header index in sec_rows
        header_idx = -1
        for i, row in enumerate(sec_rows):
            valid_cols = sum(1 for x in row if pd.notna(x) and not str(x).startswith('Unnamed:') and str(x).strip() != '')
            if valid_cols >= 3:
                header_idx = i
                break

        # Extract balance (Solde) from rows before header
        file_balance = None
        import re
        for row in sec_rows[:max(0, header_idx)]:
            for cell in row:
                cell_str = str(cell).strip()
                if 'solde' in cell_str.lower():
                    # Check regex in cell_str itself (e.g. "Solde au 24/08/2026 : 1 250,50 €")
                    matches = re.findall(r'[-+]?\d[\d\s\u202f\xa0]*[,\.]\d{2}', cell_str)
                    if matches:
                        try:
                            clean_m = matches[-1].replace('\u202f', '').replace('\xa0', '').replace(' ', '').replace(',', '.')
                            pot_amt = float(clean_m)
                            if not math.isnan(pot_amt):
                                file_balance = pot_amt
                                break
                        except Exception:
                            pass
                    if file_balance is None:
                        for val in row:
                            try:
                                val_str = str(val).replace('€', '').replace('\u202f', '').replace('\xa0', '').replace(' ', '').replace(',', '.').strip()
                                if val_str.lower() != 'nan':
                                    pot_amt = float(val_str)
                                    if pot_amt != 0 and not math.isnan(pot_amt):
                                        file_balance = pot_amt
                                        break
                            except Exception:
                                pass
                if file_balance is not None:
                    break
            if file_balance is not None:
                break

        is_data_row = False
        if header_idx >= 0:
            for col in sec_rows[header_idx]:
                try:
                    pd.to_datetime(str(col), format='%d/%m/%Y', errors='raise')
                    is_data_row = True
                    break
                except Exception:
                    pass

        if is_data_row:
            header_cols = [f"Col{i}" for i in range(len(sec_rows[header_idx]))]
            raw_data_slice = sec_rows[header_idx:]
        elif header_idx >= 0:
            header_cols = [str(c).strip() for c in sec_rows[header_idx]]
            raw_data_slice = sec_rows[header_idx + 1:]
        else:
            continue

        num_cols = len(header_cols)
        norm_rows = []
        for r in raw_data_slice:
            if not any(str(c).strip() for c in r):
                continue
            if len(r) < num_cols:
                r = list(r) + [''] * (num_cols - len(r))
            elif len(r) > num_cols:
                r = list(r[:num_cols])
            norm_rows.append(r)

        if not norm_rows:
            continue

        df = pd.DataFrame(norm_rows, columns=header_cols)

        date_col, amount_col, desc_col = heuristic_parse(df)
        if not date_col or not amount_col:
            continue

        parsed_date = pd.to_datetime(df[date_col], format='ISO8601', errors='coerce')
        if parsed_date.notna().sum() < len(df) * 0.8:
            parsed_date = pd.to_datetime(df[date_col], dayfirst=True, errors='coerce')
        df['_parsed_date'] = parsed_date

        def _clean_amount_val(x):
            try:
                v = float(str(x).replace('€','').replace(' ','').replace('\u202f','').replace('\xa0','').replace(',','.').strip())
                if math.isnan(v) or math.isinf(v):
                    return 0.0
                return v
            except Exception:
                return 0.0

        df['_parsed_amount'] = df[amount_col].apply(_clean_amount_val)

        # Match best account for this section
        target_account = None
        if explicit_account_id and len(section_blocks) == 1:
            target_account = next((a for a in db_accounts if a.id == explicit_account_id), None)

        # 1. Vérification du mapping persistant mémorisé dans GlobalConfig
        if not target_account and db is not None:
            from app.models import GlobalConfig
            import json
            try:
                conf = db.query(GlobalConfig).filter(GlobalConfig.key == "file_account_mapping").first()
                if conf and conf.value:
                    mapping = json.loads(conf.value)
                    clean_sec = sec_title.strip().lower()
                    mapped_id = mapping.get(clean_sec)
                    if not mapped_id:
                        for map_k, map_v in mapping.items():
                            if map_k in clean_sec or clean_sec in map_k:
                                mapped_id = map_v
                                break
                    if mapped_id:
                        found_acc = next((a for a in db_accounts if a.id == int(mapped_id)), None)
                        if found_acc:
                            target_account = found_acc
                            used_account_ids.add(found_acc.id)
            except Exception:
                pass

        if not target_account and db_accounts:
            best_acc = None
            best_score = -1
            title_lower = sec_title.lower()
            for acc in db_accounts:
                if acc.id in used_account_ids and len(db_accounts) >= len(section_blocks):
                    continue
                score = 0
                acc_name_lower = acc.name.lower()
                acc_type_lower = (acc.type or "").lower()
                name_words = [w for w in acc_name_lower.split() if len(w) > 2]

                if acc_name_lower in title_lower:
                    score += 60
                for w in name_words:
                    if w in title_lower:
                        score += 20
                if 'livret a' in title_lower and 'livret a' in acc_name_lower:
                    score += 90
                elif 'ldd' in title_lower and 'ldd' in acc_name_lower:
                    score += 90
                elif any(k in title_lower for k in ['dépôt', 'depot', 'courant']):
                    if acc_type_lower == 'compte courant' or any(k in acc_name_lower for k in ['courant', 'centre-est', 'ile-de-france', 'bnp', 'sg']):
                        score += 50

                if score > best_score:
                    best_score = score
                    best_acc = acc

            if best_acc and (best_score >= 20 or len(db_accounts) == 1):
                target_account = best_acc
                used_account_ids.add(best_acc.id)

        target_acc_id = target_account.id if target_account else (explicit_account_id if len(section_blocks) == 1 else None)
        target_acc_name = target_account.name if target_account else sec_title

        # Build transactions
        tx_results = []
        for row_idx, row in df.iterrows():
            amt = row['_parsed_amount']
            if pd.isna(row['_parsed_date']) and amt == 0.0:
                continue

            desc = str(row[desc_col]).strip() if desc_col and pd.notna(row[desc_col]) else "Opération importée"
            parsed_date_val = row['_parsed_date']
            date_str = parsed_date_val.strftime("%Y-%m-%d") if not pd.isna(parsed_date_val) else None

            match_info = None
            if not pd.isna(parsed_date_val) and db is not None:
                match_info = check_reconciliation(
                    db,
                    parsed_date_val,
                    amt,
                    matched_ids=matched_ids_global,
                    account_id=target_acc_id,
                    bank_label=desc
                )
                if match_info and match_info.get("id"):
                    matched_ids_global.add(match_info["id"])

            attachments = None
            if 'Documents joints' in df.columns and not pd.isna(row['Documents joints']):
                v = str(row['Documents joints']).strip()
                if v and v != 'nan': attachments = v
            elif 'Fichier' in df.columns and not pd.isna(row['Fichier']):
                v = str(row['Fichier']).strip()
                if v and v != 'nan': attachments = v

            check_slip_number = None
            if 'Bordereau de chèque' in df.columns and not pd.isna(row['Bordereau de chèque']):
                v = str(row['Bordereau de chèque']).strip()
                if v and v != 'nan': check_slip_number = v
            elif 'Chèque' in df.columns and not pd.isna(row['Chèque']):
                v = str(row['Chèque']).strip()
                if v and v != 'nan': check_slip_number = v

            # Empreinte déterministe idempotente (SHA-256 + index ordinal intra-lot)
            amt_val = float(amt) if amt is not None else 0.0
            tx_sig_raw = f"{date_str}_{abs(amt_val):.2f}_{desc.strip().lower()}"
            tx_sha = hashlib.sha256(tx_sig_raw.encode('utf-8')).hexdigest()[:12]
            tx_sig_counts[tx_sha] = tx_sig_counts.get(tx_sha, 0) + 1
            occ_idx = tx_sig_counts[tx_sha] - 1
            deterministic_csv_id = f"csv_{tx_sha}_{occ_idx}"

            tx_results.append({
                "csv_id": deterministic_csv_id,
                "date_operation": date_str,
                "description": desc,
                "raw_description": desc,
                "db_description": match_info["description"] if match_info else None,
                "amount": abs(amt),
                "raw_amount": amt,
                "is_reconciled": match_info is not None,
                "already_reconciled": match_info["already_reconciled"] if match_info else False,
                "is_mirror_transfer": match_info.get("is_mirror_transfer", False) if match_info else False,
                "is_orphan_transfer_link": match_info.get("is_orphan_transfer_link", False) if match_info else False,
                "orphan_account_id": match_info.get("orphan_account_id") if match_info else None,
                "orphan_account_name": match_info.get("orphan_account_name") if match_info else None,
                "matched_db_id": match_info["id"] if match_info else None,
                "match_score": match_info.get("match_score", 0) if match_info else 0,
                "category": None,
                "is_coming": False,
                "attachments": attachments,
                "check_slip_number": check_slip_number,
                "smart_suggested": False
            })

        alerts = check_import_alerts(db, target_acc_id, tx_results) if (db and target_acc_id) else {}

        accounts_out.append({
            "account_id": target_acc_id,
            "account_name": target_acc_name,
            "section_title": sec_title,
            "bank_balance": file_balance,
            "local_reconciled_balance": None,
            "alerts": alerts,
            "transactions": tx_results
        })

    return accounts_out



