import pandas as pd
from io import StringIO, BytesIO
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from fastapi.responses import StreamingResponse
import numpy as np

from app.database import get_db
from app.models import Transaction, Account, Category
from app.routers.csv_parser import heuristic_parse, check_reconciliation

router = APIRouter(prefix="/api/csv", tags=["csv"])

# Bidirectional type translation for CSV compatibility
TYPE_FR_TO_KEY = {
    "Dépenses fixes": "expense_fixed",
    "Dépenses variables": "expense_var",
    "Dépenses": "expense_var",
    "Dépense": "expense_var",
    "Recettes": "income",
    "Transfert": "transfer",
    "Neutre": "neutral",
}
TYPE_KEY_TO_FR = {v: k for k, v in TYPE_FR_TO_KEY.items()}

@router.post("/import")
async def import_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")

    content = await file.read()
    try:
        # Decode considering utf-8 with or without BOM, or latin-1 fallback
        try:
            decoded_content = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            decoded_content = content.decode('latin-1')

        # Read CSV with pandas
        df = pd.read_csv(StringIO(decoded_content), sep=';', dtype=str)
        
        # Strip all column names
        df.columns = df.columns.str.strip()
        
        required_cols = ['Date de saisie', 'Date opération', 'Description', 'Montant', 'Type', 'Catégorie']
        for col in required_cols:
            if col not in df.columns:
                raise HTTPException(status_code=400, detail=f"Missing required column: {col}")

        # Clean "Montant"
        def clean_amount(val):
            if pd.isna(val) or str(val).strip() == '':
                return 0.0
            val_str = str(val).replace('€', '').replace('\u202f', '').replace(' ', '').replace(',', '.').strip()
            try:
                return float(val_str)
            except ValueError:
                return 0.0
                
        df['Montant'] = df['Montant'].apply(clean_amount)
        
        # Parse Dates
        df['Date de saisie'] = pd.to_datetime(df['Date de saisie'], format='%d/%m/%Y', errors='coerce')
        df['Date opération'] = pd.to_datetime(df['Date opération'], format='%d/%m/%Y', errors='coerce')
        
        if 'Date de rapprochement' in df.columns:
            df['Date de rapprochement'] = pd.to_datetime(df['Date de rapprochement'], format='%d/%m/%Y', errors='coerce')

        from app.models import Category, RecurrenceTemplate
        # Get existing categories
        categories_db = {cat.name: cat for cat in db.query(Category).all()}

        # Get existing accounts
        accounts_db = {acc.name: acc for acc in db.query(Account).all()}
        
        # Get existing templates
        templates_db = {tpl.description: tpl for tpl in db.query(RecurrenceTemplate).all()}
        
        def get_or_create_account(acc_name):
            if pd.isna(acc_name) or str(acc_name).strip() == '':
                return None
            name = str(acc_name).strip()
            if name not in accounts_db:
                new_acc = Account(name=name, type="Auto-créé", initial_balance=0.0)
                db.add(new_acc)
                db.flush()
                db.refresh(new_acc)
                accounts_db[name] = new_acc
            return accounts_db[name].id
        
        imported_count = 0
        skipped_count = 0
        attachments_needed = set()
        
        for idx, row in df.iterrows():
            if pd.isna(row['Date de saisie']) or pd.isna(row['Date opération']):
                continue # Skip invalid rows
                
            csv_id_val = str(row['ID']).strip() if 'ID' in df.columns and not pd.isna(row['ID']) else None
            if csv_id_val == 'nan' or csv_id_val == '':
                csv_id_val = None
                
            if csv_id_val:
                # Check for existing
                existing = db.query(Transaction).filter(Transaction.csv_id == csv_id_val).first()
                if existing:
                    skipped_count += 1
                    continue
            
            from_acc_id = None
            to_acc_id = None
            
            if 'Depuis' in df.columns:
                from_acc_id = get_or_create_account(row['Depuis'])
            if 'Vers' in df.columns:
                to_acc_id = get_or_create_account(row['Vers'])
                
            is_monthly = False
            if 'Répétition mensuelle' in df.columns:
                val = str(row['Répétition mensuelle']).strip().upper()
                is_monthly = val == 'VRAI'
                
            is_yearly = False
            if 'Répétition annuelle' in df.columns:
                val = str(row['Répétition annuelle']).strip().upper()
                is_yearly = val == 'VRAI'
                
            is_bimonthly = False
            if 'Répétition bi-mensuelle' in df.columns:
                val = str(row['Répétition bi-mensuelle']).strip().upper()
                is_bimonthly = val == 'VRAI'
                
            recurrence_day_1 = None
            if 'Jour de récurrence 1' in df.columns and not pd.isna(row['Jour de récurrence 1']):
                try:
                    recurrence_day_1 = int(float(row['Jour de récurrence 1']))
                except ValueError:
                    pass
                    
            recurrence_day_2 = None
            if 'Jour de récurrence 2' in df.columns and not pd.isna(row['Jour de récurrence 2']):
                try:
                    recurrence_day_2 = int(float(row['Jour de récurrence 2']))
                except ValueError:
                    pass
                    
            attachments = None
            if 'Documents joints' in df.columns and not pd.isna(row['Documents joints']):
                val = str(row['Documents joints']).strip()
                if val and val != 'nan':
                    attachments = val
            elif 'Fichier' in df.columns and not pd.isna(row['Fichier']):
                val = str(row['Fichier']).strip()
                if val and val != 'nan':
                    attachments = val
                    
            if attachments:
                attachments_needed.add(attachments)
                    
            check_slip_number = None
            if 'Bordereau de chèque' in df.columns and not pd.isna(row['Bordereau de chèque']):
                val = str(row['Bordereau de chèque']).strip()
                if val and val != 'nan':
                    check_slip_number = val
            elif 'Chèque' in df.columns and not pd.isna(row['Chèque']):
                val = str(row['Chèque']).strip()
                if val and val != 'nan':
                    check_slip_number = val

            recon_date = row['Date de rapprochement'] if 'Date de rapprochement' in df.columns and not pd.isna(row['Date de rapprochement']) else None

            # Optional category handling
            cat_val = str(row['Catégorie']).strip() if not pd.isna(row['Catégorie']) else None
            if cat_val == 'nan' or cat_val == '':
                cat_val = None

            csv_type = str(row['Type']).strip() if 'Type' in df.columns and not pd.isna(row['Type']) else "neutral"
            csv_type = TYPE_FR_TO_KEY.get(csv_type, csv_type)  # Convert FR→key if needed

            # Base type dictated by Accounts (Depuis/Vers)
            tx_type = "neutral"
            if from_acc_id and to_acc_id:
                tx_type = "transfer"
            elif not from_acc_id and to_acc_id:
                tx_type = "income"
            elif from_acc_id and not to_acc_id:
                if is_monthly or is_yearly or is_bimonthly or csv_type == "expense_fixed":
                    tx_type = "expense_fixed"
                else:
                    tx_type = "expense_var"
            else:
                tx_type = csv_type

            # Create Category if missing
            if cat_val and cat_val not in categories_db:
                new_cat = Category(name=cat_val, type=tx_type)
                db.add(new_cat)
                db.flush()
                db.refresh(new_cat)
                categories_db[cat_val] = new_cat
                
            desc_val = str(row['Description']).strip() if not pd.isna(row['Description']) else ""

            # Handle Recurrence Templates
            rec_id = None
            if is_monthly or is_yearly or is_bimonthly:
                if is_monthly: freq = 'Monthly'
                elif is_yearly: freq = 'Yearly'
                else: freq = 'Bi-Monthly'
                
                if desc_val not in templates_db:
                    new_tpl = RecurrenceTemplate(
                        description=desc_val,
                        amount=abs(row['Montant']),
                        type=tx_type,
                        category=cat_val,
                        frequency=freq,
                        day_of_month=row['Date opération'].date().day,
                        from_account_id=from_acc_id,
                        to_account_id=to_acc_id
                    )
                    db.add(new_tpl)
                    db.flush()
                    db.refresh(new_tpl)
                    templates_db[desc_val] = new_tpl
                
                rec_id = templates_db[desc_val].id

            new_tx = Transaction(
                csv_id=csv_id_val,
                date_saisie=row['Date de saisie'].date(),
                date_operation=row['Date opération'].date(),
                description=desc_val,
                amount=abs(row['Montant']), # Always absolute value in this system
                type=tx_type,
                category=cat_val,
                reconciliation_date=recon_date.date() if recon_date else None,
                is_monthly=is_monthly,
                is_yearly=is_yearly,
                is_bimonthly=is_bimonthly,
                recurrence_day_1=recurrence_day_1,
                recurrence_day_2=recurrence_day_2,
                attachments=attachments,
                check_slip_number=check_slip_number,
                from_account_id=from_acc_id,
                to_account_id=to_acc_id,
                recurrence_id=rec_id
            )
            db.add(new_tx)
            imported_count += 1
        db.commit()
        
        # Auto-generate recurrence instances up to the end of the current year for the newly created templates
        from app.routers.recurrences import generate_recurrences
        try:
            generate_recurrences(db)
        except Exception as e:
            print("Auto-generation of recurrences failed:", str(e))
            
        return {"imported": imported_count, "skipped": skipped_count, "attachments_needed": list(attachments_needed)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/update_imported_attachments")
def update_imported_attachments(data: dict, db: Session = Depends(get_db)):
    mapping = data.get("mapping", {})
    if not mapping:
        return {"updated": 0}
        
    updated = 0
    txs = db.query(Transaction).filter(Transaction.attachments.in_(mapping.keys())).all()
    for tx in txs:
        if tx.attachments in mapping:
            tx.attachments = mapping[tx.attachments]
            updated += 1
            
    db.commit()
    return {"updated": updated}

@router.get("/export")
def export_csv(db: Session = Depends(get_db), cols: str = Query(None, description="Comma-separated list of columns to export")):
    txs = db.query(Transaction).order_by(Transaction.date_operation.asc()).all()
    accounts = {acc.id: acc.name for acc in db.query(Account).all()}
    
    data = []
    for tx in txs:
        row = {
            "Date de saisie": tx.date_saisie.strftime("%d/%m/%Y"),
            "Date opération": tx.date_operation.strftime("%d/%m/%Y"),
            "Description": tx.description,
            "Montant": f"{tx.amount:.2f}".replace('.', ','),
            "Type": TYPE_KEY_TO_FR.get(tx.type, tx.type),
            "Catégorie": tx.category or "",
            "Date de rapprochement": tx.reconciliation_date.strftime("%d/%m/%Y") if tx.reconciliation_date else "",
            "Répétition mensuelle": "VRAI" if tx.is_monthly else "FAUX",
            "Répétition annuelle": "VRAI" if tx.is_yearly else "FAUX",
            "Répétition bi-mensuelle": "VRAI" if tx.is_bimonthly else "FAUX",
            "Jour de récurrence 1": tx.recurrence_day_1 if tx.recurrence_day_1 else "",
            "Jour de récurrence 2": tx.recurrence_day_2 if tx.recurrence_day_2 else "",
            "Documents joints": tx.attachments or "",
            "Bordereau de chèque": tx.check_slip_number or "",
            "Depuis": accounts.get(tx.from_account_id, ""),
            "Vers": accounts.get(tx.to_account_id, ""),
            "ID": tx.csv_id or tx.id
        }
        data.append(row)
        
    df = pd.DataFrame(data)
    
    if cols:
        requested_cols = [c.strip() for c in cols.split(",")]
        # Only keep requested columns that actually exist
        valid_cols = [c for c in requested_cols if c in df.columns]
        if valid_cols:
            df = df[valid_cols]
    
    stream = BytesIO()
    df.to_csv(stream, sep=';', index=False, encoding='utf-8-sig')
    
    response = StreamingResponse(iter([stream.getvalue()]), media_type="text/csv; charset=utf-8")
    response.headers["Content-Disposition"] = "attachment; filename=export_omnibank.csv"
    return response

@router.post("/analyze_heuristic")
async def analyze_heuristic(file: UploadFile = File(...), db: Session = Depends(get_db)):
    content = await file.read()
    
    if file.filename.endswith('.xlsx'):
        df = pd.read_excel(BytesIO(content), dtype=str)
    else:
        try:
            decoded = content.decode('utf-8-sig')
        except:
            decoded = content.decode('latin-1')
        df = pd.read_csv(StringIO(decoded), sep=';', dtype=str)
        if len(df.columns) == 1:
            df = pd.read_csv(StringIO(decoded), sep=',', dtype=str)
            
    # Pre-process DF to find the real header (Skip metadata rows)
    raw_data = [df.columns.tolist()] + df.values.tolist()
    
    import json
    try:
        with open("debug_raw.json", "w", encoding="utf-8") as f:
            json.dump([[str(x) for x in row] for row in raw_data], f, indent=2)
    except Exception as e:
        print("Failed to write debug_raw:", e)
    
    header_idx = -1
    
    for i, row in enumerate(raw_data):
        valid_cols = sum(1 for x in row if pd.notna(x) and not str(x).startswith('Unnamed:') and str(x).strip() != '')
        if valid_cols >= 3:
            header_idx = i
            break
            
    # Extract balance (Solde) from rows before the header
    file_balance = None
    for row in raw_data[:max(0, header_idx)]:
        for i, cell in enumerate(row):
            cell_str = str(cell).lower()
            if 'solde' in cell_str:
                # Try to find a amount in the same row
                for val in row:
                    try:
                        val_str = str(val).replace('€', '').replace('\u202f', '').replace('\xa0', '').replace(' ', '').replace(',', '.').strip()
                        if val_str.lower() != 'nan':
                            potential_amt = float(val_str)
                            import math
                            if potential_amt != 0 and not math.isnan(potential_amt):
                                file_balance = potential_amt
                                break
                    except:
                        pass
                if file_balance is not None:
                    break
        if file_balance is not None:
            break

    is_data_row = False
    if header_idx >= 0:
        for col in raw_data[header_idx]:
            try:
                pd.to_datetime(str(col), format='%d/%m/%Y', errors='raise')
                is_data_row = True
                break
            except:
                pass

    if is_data_row:
        # The identified header is actually a data row
        cols = [f"Col{i}" for i in range(len(raw_data[header_idx]))]
        df = pd.DataFrame(raw_data[header_idx:], columns=cols)
    elif header_idx > 0:
        df = pd.DataFrame(raw_data[header_idx+1:], columns=raw_data[header_idx])
    else:
        df = pd.DataFrame(raw_data[1:], columns=raw_data[0])
            
    date_col, amount_col, desc_col = heuristic_parse(df)
    
    if not date_col or not amount_col:
        raise HTTPException(status_code=400, detail="Impossible de détecter automatiquement les colonnes de Date et de Montant.")
        
    results = []
    
    parsed_date = pd.to_datetime(df[date_col], format='ISO8601', errors='coerce')
    if parsed_date.notna().sum() < len(df) * 0.8:
        parsed_date = pd.to_datetime(df[date_col], dayfirst=True, errors='coerce')
        
    df['_parsed_date'] = parsed_date
    
    def clean_amt(x):
        try:
            return float(str(x).replace('€','').replace(' ','').replace('\u202f','').replace('\xa0','').replace(',','.').strip())
        except:
            return 0.0
            
    df['_parsed_amount'] = df[amount_col].apply(clean_amt)
    
    try:
        with open(r"C:\Users\Adminlocal\.gemini\antigravity\brain\d3091038-9bc2-4231-8468-b628ecf15491\scratch\debug_df.json", "w", encoding="utf-8") as f:
            df_str = df.astype(str)
            json.dump(df_str.to_dict('records'), f, indent=2)
    except: pass
    
    matched_ids = []
    for idx, row in df.iterrows():
        amt = row['_parsed_amount']
        if pd.isna(row['_parsed_date']) and amt == 0.0: 
            continue
            
        desc = str(row[desc_col]) if desc_col else "Opération importée"
        
        parsed_date_val = row['_parsed_date']
        date_str = parsed_date_val.strftime("%Y-%m-%d") if not pd.isna(parsed_date_val) else None
        
        match_info = check_reconciliation(db, parsed_date_val, amt, matched_ids) if not pd.isna(parsed_date_val) else None
        if match_info:
            matched_ids.append(match_info["id"])

        attachments = None
        if 'Documents joints' in df.columns and not pd.isna(row['Documents joints']):
            val = str(row['Documents joints']).strip()
            if val and val != 'nan':
                attachments = val
        elif 'Fichier' in df.columns and not pd.isna(row['Fichier']):
            val = str(row['Fichier']).strip()
            if val and val != 'nan':
                attachments = val

        check_slip_number = None
        if 'Bordereau de chèque' in df.columns and not pd.isna(row['Bordereau de chèque']):
            val = str(row['Bordereau de chèque']).strip()
            if val and val != 'nan':
                check_slip_number = val
        elif 'Chèque' in df.columns and not pd.isna(row['Chèque']):
            val = str(row['Chèque']).strip()
            if val and val != 'nan':
                check_slip_number = val
        
        results.append({
            "date_operation": date_str,
            "description": desc,
            "db_description": match_info["description"] if match_info else None,
            "amount": amt,
            "is_reconciled": match_info is not None,
            "already_reconciled": match_info["already_reconciled"] if match_info else False,
            "matched_db_id": match_info["id"] if match_info else None,
            "attachments": attachments,
            "check_slip_number": check_slip_number
        })
        
    return {"transactions": results, "file_balance": file_balance}

@router.post("/save_batch")
async def save_batch(data: dict, db: Session = Depends(get_db)):
    txs = data.get("transactions", [])
    account_id = data.get("account_id")
    csv_absolute_path = data.get("csv_absolute_path")
    
    if account_id:
        try:
            account_id = int(account_id)
        except:
            account_id = None
            
    imported = 0
    
    for tx in txs:
        if tx.get('is_reconciled') and tx.get('matched_db_id'):
            existing_tx = db.query(Transaction).filter(Transaction.id == tx['matched_db_id']).first()
            if existing_tx:
                existing_tx.reconciliation_date = pd.to_datetime(tx['date_operation']).date()
                if account_id:
                    if float(tx['amount']) < 0 and not existing_tx.from_account_id:
                        existing_tx.from_account_id = account_id
                    elif float(tx['amount']) >= 0 and not existing_tx.to_account_id:
                        existing_tx.to_account_id = account_id
                imported += 1
                continue

        from_acc = account_id if account_id and float(tx['amount']) < 0 else None
        to_acc = account_id if account_id and float(tx['amount']) >= 0 else None
        
        tx_type = "neutral"
        cat_name = tx.get('category')
        if cat_name:
            cat_obj = db.query(Category).filter(Category.name == cat_name).first()
            if cat_obj and cat_obj.type and cat_obj.type != "neutral":
                tx_type = cat_obj.type
                
        if tx_type == "neutral":
            if from_acc and to_acc:
                tx_type = "transfer"
            elif not from_acc and to_acc:
                tx_type = "income"
            elif from_acc and not to_acc:
                tx_type = "expense_var"

        # Handle automatic local copy if csv_absolute_path is provided
        final_attachment = tx.get('attachments')
        if final_attachment and csv_absolute_path:
            import os
            import uuid
            import shutil
            from app.routers.backup import DATA_DIR
            uploads_dir = os.path.join(DATA_DIR, "uploads")
            os.makedirs(uploads_dir, exist_ok=True)
            
            clean_att = final_attachment.replace('\\', '/')
            if '\\' in csv_absolute_path:
                dir_path = '\\'.join(csv_absolute_path.split('\\')[:-1])
                clean_att_win = final_attachment.replace('/', '\\')
                src_path = f"{dir_path}\\{clean_att_win}"
            else:
                src_path = os.path.join(os.path.dirname(csv_absolute_path), clean_att)
                
            if os.path.exists(src_path):
                filename = os.path.basename(src_path)
                unique_filename = f"{uuid.uuid4().hex[:8]}_{filename}"
                dst_path = os.path.join(uploads_dir, unique_filename)
                try:
                    shutil.copy2(src_path, dst_path)
                    final_attachment = f"uploads/{unique_filename}"
                except:
                    pass

        new_tx = Transaction(
            date_operation=pd.to_datetime(tx['date_operation']).date(),
            date_saisie=pd.to_datetime(tx['date_operation']).date(),
            description=tx['description'],
            amount=abs(float(tx['amount'])),
            type=tx_type,
            category=cat_name,
            reconciliation_date=pd.to_datetime(tx['date_operation']).date(),
            from_account_id=from_acc,
            to_account_id=to_acc,
            attachments=tx.get('attachments'),
            check_slip_number=tx.get('check_slip_number')
        )
        db.add(new_tx)
        imported += 1
        
    db.commit()
    return {"imported": imported}

@router.post("/check_attachments")
async def check_attachments(data: dict):
    csv_absolute_path = data.get("csv_absolute_path")
    attachments = data.get("attachments", [])
    
    if not csv_absolute_path or not attachments:
        return {"all_exist": False, "missing": attachments}
        
    import os
    missing = []
    # Only support Windows paths or Linux paths natively if the backend matches the OS.
    # We will just try os.path.join. If csv_absolute_path comes from Windows and we are in Docker, it might fail, which is correct.
    for att in attachments:
        # replace backslashes if needed, but os.path.join handles it mostly. To be safe:
        clean_att = att.replace('\\', '/')
        if '\\' in csv_absolute_path:
            # It's a Windows path
            dir_path = '\\'.join(csv_absolute_path.split('\\')[:-1])
            clean_att_win = att.replace('/', '\\')
            path = f"{dir_path}\\{clean_att_win}"
            if not os.path.exists(path):
                missing.append(att)
        else:
            path = os.path.join(os.path.dirname(csv_absolute_path), clean_att)
            if not os.path.exists(path):
                missing.append(att)
            
    return {"all_exist": len(missing) == 0, "missing": missing}

from typing import List
from fastapi import Form
import shutil
import uuid
from app.routers.backup import DATA_DIR

@router.post("/upload_attachments")
async def upload_attachments(files: List[UploadFile] = File(...), relative_paths: str = Form(...)):
    import json
    import os
    try:
        paths = json.loads(relative_paths)
    except:
        paths = []
        
    uploads_dir = os.path.join(DATA_DIR, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    
    saved_files = {}
    for i, file in enumerate(files):
        filename = file.filename
        rel_path = paths[i] if i < len(paths) else filename
        unique_filename = f"{uuid.uuid4().hex[:8]}_{os.path.basename(filename)}"
        dst_path = os.path.join(uploads_dir, unique_filename)
        
        with open(dst_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        saved_files[rel_path] = f"uploads/{unique_filename}"
        
    return {"saved": saved_files}
