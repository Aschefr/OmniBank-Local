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

def check_reconciliation(db, tx_date, tx_amount, matched_ids=None, account_id=None, is_coming=False, bank_label=None, csv_id=None):
    """
    Checks if a matching transaction exists in the database using a composite score (0-100 pts):
      - Priority 0: Exact bank unique identifier / hash match (csv_id) : 100 pts
      - Exact amount (+/- 0.01 €) : 40 pts
      - Temporal proximity (asymmetric delta) : 0 to 35 pts
      - Text/merchant similarity (smart_label_service) : 0 to 25 pts
    Handles internal transfers across accounts and duplicate prevention.
    """
    if tx_date is None or tx_amount is None:
        return None
    try:
        abs_amount = abs(float(tx_amount))
    except (ValueError, TypeError):
        return None
        
    epsilon = 0.01
    
    from datetime import timedelta
    from sqlalchemy import or_, and_, func

    # Clause de filtre par compte si fourni
    acc_filter = None
    if account_id:
        acc_filter = or_(
            Transaction.from_account_id == account_id,
            Transaction.to_account_id == account_id
        )

    # ── PASSE 0 : Correspondance exacte et prioritaire par empreinte bancaire (csv_id) ──
    if csv_id:
        target_csv_ids = [csv_id]
        if csv_id.startswith("woob_") and not csv_id.startswith("woob_coming_"):
            target_csv_ids.append(csv_id.replace("woob_", "woob_coming_"))
        elif csv_id.startswith("woob_coming_"):
            target_csv_ids.append(csv_id.replace("woob_coming_", "woob_"))

        csv_query = db.query(Transaction).filter(
            Transaction.csv_id.in_(target_csv_ids),
            Transaction.amount >= abs_amount - epsilon,
            Transaction.amount <= abs_amount + epsilon
        )
        if acc_filter is not None:
            csv_query = csv_query.filter(acc_filter)
        if matched_ids:
            csv_query = csv_query.filter(
                or_(
                    Transaction.id.notin_(matched_ids),
                    Transaction.type == "transfer",
                    and_(Transaction.from_account_id.isnot(None), Transaction.to_account_id.isnot(None))
                )
            )
        exact_csv_match = csv_query.first()
        if exact_csv_match:
            return {
                "id": exact_csv_match.id,
                "description": exact_csv_match.description,
                "already_reconciled": bool(exact_csv_match.reconciliation_date),
                "match_score": 100
            }

    target_dt = tx_date.date() if hasattr(tx_date, "date") and callable(tx_date.date) else tx_date

    def _compute_temporal_score(candidate_dt, bank_dt):
        if not candidate_dt or not bank_dt:
            return 0
        delta = (candidate_dt - bank_dt).days
        # delta < 0 : DB date is before bank date (e.g. bought on 20th, debited on 22nd -> delta = -2)
        # delta > 0 : DB date is after bank date (e.g. planned for 24th, debited on 23rd -> delta = +1)
        abs_delta = abs(delta)
        if abs_delta == 0:
            return 35
        elif delta in (-1, -2):
            return 30
        elif delta in (1, 2):
            return 28
        elif delta in (-3, -4):
            return 20
        elif delta in (3, 4):
            return 15
        elif delta in (-5, -6, -7):
            return 10
        elif delta in (5, 6, 7):
            return 8
        elif 8 <= abs_delta <= 15:
            return 5
        elif 16 <= abs_delta <= 30:
            return 2
        else:
            return 0

    def _compute_text_score(candidate_desc, raw_bank_label):
        if not candidate_desc or not raw_bank_label:
            return 0
        try:
            from app.services.smart_label_service import _compute_match_score
            ratio = _compute_match_score(raw_bank_label, candidate_desc)
            return round(ratio * 25)
        except Exception:
            return 0

    def _evaluate_candidate(t):
        amt_score = 40
        t_dt = t.date_operation if hasattr(t.date_operation, "strftime") else (t.date_operation if t.date_operation else None)
        temp_score = _compute_temporal_score(t_dt, target_dt)
        text_score = _compute_text_score(t.description, bank_label)
        total = amt_score + temp_score + text_score
        return total

    def _best_scored_tx(candidates):
        if not candidates:
            return None, 0
        scored = []
        for c in candidates:
            s = _evaluate_candidate(c)
            if s >= 40:
                scored.append((s, c))
        if not scored:
            return None, 0
        # Trier par score décroissant, puis par proximité de date la plus faible
        scored.sort(
            key=lambda item: (
                item[0],
                -abs((item[1].date_operation - target_dt).days) if item[1].date_operation else -9999
            ),
            reverse=True
        )
        best_score, best_candidate = scored[0]
        return best_candidate, best_score

    # 1. Recherche d'un doublon déjà rapproché / existant
    def _find_already_reconciled():
        if is_coming:
            start_op_limit_c = tx_date - timedelta(days=15)
            end_op_limit_c = tx_date + timedelta(days=15)
            recon_query = db.query(Transaction).filter(
                Transaction.reconciliation_date != None,
                Transaction.amount >= abs_amount - epsilon,
                Transaction.amount <= abs_amount + epsilon,
                Transaction.date_operation >= start_op_limit_c,
                Transaction.date_operation <= end_op_limit_c
            )
        else:
            start_recon = tx_date - timedelta(days=30)
            end_recon = tx_date + timedelta(days=30)
            start_op_limit = tx_date - timedelta(days=30)
            end_op_limit = tx_date + timedelta(days=30)
            recon_query = db.query(Transaction).filter(
                Transaction.reconciliation_date != None,
                Transaction.amount >= abs_amount - epsilon,
                Transaction.amount <= abs_amount + epsilon,
                Transaction.date_operation >= start_op_limit,
                Transaction.date_operation <= end_op_limit,
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
            
        recon_match, recon_score = _best_scored_tx(recon_query_filtered.all())
        if recon_match:
            return {
                "id": recon_match.id, 
                "description": recon_match.description,
                "already_reconciled": True,
                "match_score": recon_score
            }
        return None

    # 2. Recherche d'une prédiction non pointée / transaction planifiée
    def _find_unreconciled_prediction():
        if is_coming:
            # Opération à venir : la prévision peut être planifiée aujourd'hui ou dans les jours suivants
            start_op = tx_date - timedelta(days=10)
            end_op = tx_date + timedelta(days=30)
        else:
            # Opération confirmée : débit passé, la prévision peut avoir été saisie en amont jusqu'à 30 jours (mais pas > 3j dans le futur)
            start_op = tx_date - timedelta(days=30)
            end_op = tx_date + timedelta(days=3)

        op_query = db.query(Transaction).filter(
            Transaction.reconciliation_date == None,
            Transaction.date_operation >= start_op,
            Transaction.date_operation <= end_op,
            Transaction.amount >= abs_amount - epsilon,
            Transaction.amount <= abs_amount + epsilon
        )
        if acc_filter is not None:
            op_query = op_query.filter(acc_filter)

        available_op_query = op_query
        if matched_ids:
            available_op_query = op_query.filter(Transaction.id.notin_(matched_ids))
            
        op_match, op_score = _best_scored_tx(available_op_query.all())
        if op_match:
            return {
                "id": op_match.id,
                "description": op_match.description,
                "already_reconciled": False,
                "match_score": op_score
            }
        return None

    # Recherche des candidats parmi les prédictions non pointées et les opérations déjà pointées
    unrec_match = _find_unreconciled_prediction()
    recon_match = _find_already_reconciled()

    if unrec_match and recon_match:
        # Si les deux existent, comparer leurs scores de confiance respectifs.
        # En cas d'égalité ou de score supérieur pour l'opération non pointée (ex: récurrence mensuelle
        # où la prévision du mois courant est bien plus proche que le doublon du mois passé), privilégier le pointage.
        if unrec_match.get("match_score", 0) >= recon_match.get("match_score", 0):
            return unrec_match
        else:
            return recon_match
    elif unrec_match:
        return unrec_match
    elif recon_match:
        return recon_match

    # 2.B : Si aucun match libre, vérifier si c'est le pendant miroir d'un virement interne
    # déjà apparié dans ce même lot (dans matched_ids)
    if matched_ids:
        start_mirror = tx_date - timedelta(days=15)
        end_mirror = tx_date + timedelta(days=15)
        base_mirror_query = db.query(Transaction).filter(
            Transaction.reconciliation_date == None,
            Transaction.date_operation >= start_mirror,
            Transaction.date_operation <= end_mirror,
            Transaction.amount >= abs_amount - epsilon,
            Transaction.amount <= abs_amount + epsilon
        )
        if acc_filter is not None:
            base_mirror_query = base_mirror_query.filter(acc_filter)

        mirror_query = base_mirror_query.filter(
            Transaction.id.in_(matched_ids),
            or_(
                Transaction.type == "transfer",
                and_(Transaction.from_account_id.isnot(None), Transaction.to_account_id.isnot(None))
            )
        )
        mirror_match, mirror_score = _best_scored_tx(mirror_query.all())
        if mirror_match:
            return {
                "id": mirror_match.id,
                "description": mirror_match.description,
                "already_reconciled": True,
                "is_mirror_transfer": True,
                "match_score": mirror_score
            }

    # 3. Recherche d'un virement orphelin inter-comptes (Auto-linking)
    # Si aucun match sur le compte courant, vérifier s'il existe une écriture isolée du même montant
    # sur un AUTRE compte actif qui correspond à l'autre patte du virement
    if account_id:
        from app.models import Account
        start_orphan = tx_date - timedelta(days=15)
        end_orphan = tx_date + timedelta(days=15)

        raw_num = float(tx_amount)
        if raw_num < 0:
            # Débit sur ce compte (ex: Boursorama -> CA) : on cherche un crédit isolé sur un autre compte
            orphan_q = db.query(Transaction).filter(
                Transaction.from_account_id == None,
                Transaction.to_account_id != None,
                Transaction.to_account_id != account_id,
                Transaction.date_operation >= start_orphan,
                Transaction.date_operation <= end_orphan,
                Transaction.amount >= abs_amount - epsilon,
                Transaction.amount <= abs_amount + epsilon
            )
        else:
            # Crédit sur ce compte (ex: CA reçu de Boursorama) : on cherche un débit isolé sur un autre compte
            orphan_q = db.query(Transaction).filter(
                Transaction.from_account_id != None,
                Transaction.from_account_id != account_id,
                Transaction.to_account_id == None,
                Transaction.date_operation >= start_orphan,
                Transaction.date_operation <= end_orphan,
                Transaction.amount >= abs_amount - epsilon,
                Transaction.amount <= abs_amount + epsilon
            )

        if matched_ids:
            orphan_q = orphan_q.filter(Transaction.id.notin_(matched_ids))

        orphan_match, orphan_score = _best_scored_tx(orphan_q.all())
        if orphan_match:
            other_acc_id = orphan_match.to_account_id if raw_num < 0 else orphan_match.from_account_id
            other_acc = db.query(Account).filter(Account.id == other_acc_id).first()
            other_acc_name = other_acc.name if other_acc else f"Compte #{other_acc_id}"

            return {
                "id": orphan_match.id,
                "description": orphan_match.description,
                "already_reconciled": False,
                "is_orphan_transfer_link": True,
                "orphan_account_id": other_acc_id,
                "orphan_account_name": other_acc_name,
                "match_score": orphan_score
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
            val = str(non_empty[0]).lower()
            if any(k in val for k in ['compte de dépôt', 'compte de depot', 'compte courant', 'livret', 'ldd', 'compte n°', 'compte nu', 'carte n°', 'carte nu']):
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

            tx_results.append({
                "csv_id": f"csv_import_{unique_batch_id}_{sec_i}_{row_idx}",
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



