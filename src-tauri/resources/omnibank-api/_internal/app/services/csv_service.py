from datetime import datetime
from sqlalchemy.orm import Session
from app.models import Account, Transaction

def detect_encoding(file_path: str) -> str:
    import chardet
    with open(file_path, "rb") as f:
        raw_data = f.read()
        result = chardet.detect(raw_data)
        return result['encoding'] or 'utf-8'

def clean_amount(val) -> float:
    import pandas as pd
    if pd.isna(val) or val == "":
        return 0.0
    if isinstance(val, str):
        # Remove spaces, non-breaking spaces, euro signs, replace comma with dot
        val = val.replace(" ", "").replace("\xa0", "").replace("€", "").replace("?", "").replace("", "")
        val = val.replace(",", ".")
    try:
        return float(val)
    except ValueError:
        return 0.0

def parse_date(val):
    import pandas as pd
    if pd.isna(val) or val == "":
        return None
    try:
        # DD/MM/YYYY
        return datetime.strptime(str(val).strip(), "%d/%m/%Y").date()
    except ValueError:
        return None

def parse_bool(val):
    import pandas as pd
    if pd.isna(val):
        return False
    val_str = str(val).strip().upper()
    return val_str == "VRAI"

def import_csv(db: Session, file_path: str, mode: str = "fusion"):
    import pandas as pd
    import chardet
    """
    Import transactions from CSV.
    Modes: 
    - fusion: Ignore existing IDs.
    - overwrite: Delete all existing transactions before import.
    """
    if mode == "overwrite":
        db.query(Transaction).delete()
        db.commit()

    encoding = detect_encoding(file_path)
    # The file might have inconsistent delimiters or extra columns
    df = pd.read_csv(file_path, sep=";", encoding=encoding, keep_default_na=False)
    
    # Get accounts map
    accounts = {a.name: a for a in db.query(Account).all()}
    
    # Track existing IDs for fusion
    existing_ids = set([t.csv_id for t in db.query(Transaction).filter(Transaction.csv_id.isnot(None)).all()])
    
    transactions_to_add = []
    
    for _, row in df.iterrows():
        # Handle the structure of the benchmark CSV
        # Date de saisie;Date opération;Description;Montant;Type;Catégorie;Date de rapprochement;Répétition mensuelle;Répétition annuelle;Depuis;Vers;ID
        
        # Skip empty rows (e.g., if description is missing)
        description = str(row.get("Description", "")).strip()
        if not description:
            continue
            
        csv_id = str(row.get("ID", "")).strip()
        if not csv_id:
            # If no ID, skip for now. Real data will have IDs. Or generate one?
            # The benchmark data has IDs except maybe some padding rows
            continue
            
        if mode == "fusion" and csv_id in existing_ids:
            continue
            
        # Parse fields
        date_saisie = parse_date(row.get("Date de saisie"))
        date_operation = parse_date(row.get("Date opération") or row.get("Date opration") or row.get("Date op\ufffdration"))
        amount = clean_amount(row.get("Montant"))
        t_type = str(row.get("Type", "")).strip()
        category = str(row.get("Catégorie") or row.get("Catgorie") or row.get("Cat\ufffdgorie", "")).strip()
        reconciliation_date = parse_date(row.get("Date de rapprochement"))
        is_monthly = parse_bool(row.get("Répétition mensuelle") or row.get("Rptition mensuelle"))
        is_yearly = parse_bool(row.get("Répétition annuelle") or row.get("Rptition annuelle"))
        
        depuis = str(row.get("Depuis", "")).strip()
        vers = str(row.get("Vers", "")).strip()
        
        from_account_id = accounts[depuis].id if depuis in accounts else None
        to_account_id = accounts[vers].id if vers in accounts else None
        
        if not from_account_id and not to_account_id:
            # No impact, skip or log warning? We keep it if it's in the CSV for completeness?
            pass
            
        # Transaction amount is absolute, direction given by accounts
        transaction = Transaction(
            csv_id=csv_id,
            date_saisie=date_saisie,
            date_operation=date_operation,
            description=description,
            amount=abs(amount),
            type=t_type,
            category=category,
            reconciliation_date=reconciliation_date,
            is_monthly=is_monthly,
            is_yearly=is_yearly,
            from_account_id=from_account_id,
            to_account_id=to_account_id
        )
        transactions_to_add.append(transaction)
        existing_ids.add(csv_id)
        
    if transactions_to_add:
        db.add_all(transactions_to_add)
        db.commit()
    
    return len(transactions_to_add)
