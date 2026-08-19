from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
import httpx
import json
import codecs
from datetime import date

from app.database import get_db
from app.models import GlobalConfig, Category, Transaction, Account
from app.routers.csv_parser import check_import_alerts, extract_account_block

router = APIRouter(prefix="/api/ai", tags=["ai"])

SYSTEM_PROMPTS = {
    "sys_prompt_categorizer": (
        "You are an expert expense classifier. You will be given a list of available categories and a transaction description. "
        "Your task is to select the most appropriate category from the list.\n"
        "Return ONLY a JSON object with the key \"category\" containing the exact name of the selected category. "
        "If no category fits well, return \"category\": null.\n"
        "DO NOT return any text or explanation before or after the JSON."
    ),
    "sys_prompt_categorizer_batch": (
        "You are an expert banking assistant. You must categorize a list of transactions based on the provided category list.\n"
        "Return ONLY a JSON object where the transaction descriptions are the keys and the selected category names are the values. "
        "If no category fits a transaction, use null as the value.\n"
        "DO NOT return any text or explanation before or after the JSON."
    ),
    "sys_prompt_csv_extractor": (
        "You are an expert data parser. You will receive raw text extracted from a bank statement (CSV or copied/pasted table).\n"
        "IGNORE all metadata, headers, summary balance lines, or useless text.\n"
        "Extract ONLY the actual transactions and return them in a strict JSON format. Under no circumstances should you invent data. "
        "If no transactions are found, return [].\n"
        "The JSON must be a list of objects with the exact keys:\n"
        "- \"date\": string in YYYY-MM-DD format\n"
        "- \"description\": clean transaction description string\n"
        "- \"amount\": float number representing the transaction amount (negative for expenses, positive for income)\n"
        "DO NOT return any text or explanation before or after the JSON."
    )
}

def load_sys_prompt(key: str) -> str:
    return SYSTEM_PROMPTS.get(key, '')

async def call_ollama(db: Session, prompt: str, sys_prompt: str, format_json: bool = True):
    url_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_url").first()
    model_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_model").first()
    ctx_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_context").first()
    
    if not url_conf or not url_conf.value or not model_conf or not model_conf.value:
        raise HTTPException(status_code=400, detail="Ollama non configuré.")
        
    url = url_conf.value.rstrip("/")
    model = model_conf.value
    
    options = {"temperature": 0.1} # low temp for strict parsing
    if ctx_conf and ctx_conf.value:
        try: options["num_ctx"] = int(ctx_conf.value)
        except Exception: pass

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": prompt}
        ],
        "stream": False,
        "options": options
    }
    if format_json:
        payload["format"] = "json"
        
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{url}/api/chat", json=payload, timeout=300.0)
        if resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Erreur Ollama: {resp.text}")
        
        return resp.json().get("message", {}).get("content", "")


@router.post("/categorize")
async def categorize_transaction(data: dict, db: Session = Depends(get_db)):
    description = data.get("description", "")
    if not description: return {"category": None}
    
    cats = db.query(Category).all()
    cat_names = [c.name for c in cats]
    
    sys_prompt = load_sys_prompt('sys_prompt_categorizer')
    prompt = f"Catégories disponibles: {json.dumps(cat_names, ensure_ascii=False)}\nTransaction: {description}"
    
    try:
        res = await call_ollama(db, prompt, sys_prompt, format_json=True)
        res_json = json.loads(res)
        return {"category": res_json.get("category")}
    except Exception as e:
        return {"category": None, "error": str(e)}

@router.post("/categorize_batch")
async def categorize_batch(data: dict, db: Session = Depends(get_db)):
    descriptions = data.get("descriptions", [])
    if not descriptions: return {"categories": {}}
    
    cats = db.query(Category).all()
    cat_names = [c.name for c in cats]
    
    sys_prompt = load_sys_prompt('sys_prompt_categorizer_batch')
    if not sys_prompt:
        sys_prompt = "Tu es un assistant bancaire. Tu dois catégoriser chaque transaction parmi les catégories fournies. Renvoie uniquement un objet JSON avec les descriptions en clé et la catégorie en valeur. Si aucune ne correspond bien, renvoie null pour cette ligne."
        
    prompt = f"Catégories: {json.dumps(cat_names, ensure_ascii=False)}\nTransactions:\n"
    for d in descriptions:
        prompt += f"- {d}\n"
        
    try:
        res = await call_ollama(db, prompt, sys_prompt, format_json=True)
        res_json = json.loads(res)
        return {"categories": res_json}
    except Exception as e:
        return {"categories": {}, "error": str(e)}

@router.post("/import_csv")
async def import_csv_ai(
    file: UploadFile = File(...),
    account_id: int = Form(None),
    section_title: str = Form(None),
    db: Session = Depends(get_db)
):
    import logging
    logger = logging.getLogger(__name__)

    content = await file.read()
    import pandas as pd
    from io import BytesIO, StringIO
    
    if file.filename.endswith('.xlsx'):
        df = pd.read_excel(BytesIO(content), dtype=str)
        raw_data = [df.columns.tolist()] + df.values.tolist()
    else:
        try:
            decoded = content.decode('utf-8-sig')
        except Exception:
            decoded = content.decode('latin-1')
        df = pd.read_csv(StringIO(decoded), sep=';', dtype=str)
        if len(df.columns) == 1:
            df = pd.read_csv(StringIO(decoded), sep=',', dtype=str)
        raw_data = [df.columns.tolist()] + df.values.tolist()
        
    # Extract only the block matching selected account (if multi-account export)
    if account_id or section_title:
        acc = db.query(Account).filter(Account.id == account_id).first()
        acc_name = acc.name if acc else ""
        acc_type = (acc.type or "") if acc else ""
        raw_data = extract_account_block(raw_data, acc_name, acc_type, explicit_section_title=section_title)
            
    header_idx = -1
    for i, row in enumerate(raw_data):
        valid_cols = sum(1 for x in row if pd.notna(x) and not str(x).startswith('Unnamed:') and str(x).strip() != '')
        if valid_cols >= 3:
            header_idx = i
            break

    file_balance = None
    for row in raw_data[:max(0, header_idx)]:
        for cell in row:
            cell_str = str(cell).lower()
            if 'solde' in cell_str:
                for val in row:
                    try:
                        val_str = str(val).replace('€', '').replace('\u202f', '').replace('\xa0', '').replace(' ', '').replace(',', '.').strip()
                        if val_str.lower() != 'nan':
                            potential_amt = float(val_str)
                            import math
                            if potential_amt != 0 and not math.isnan(potential_amt):
                                file_balance = potential_amt
                                break
                    except Exception:
                        pass
                if file_balance is not None:
                    break
        if file_balance is not None:
            break

    # Convert raw_data block back to CSV text
    import csv
    output = StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerows(raw_data)
    text = output.getvalue()
    text_sample = text[:25000]
    
    sys_prompt = load_sys_prompt('sys_prompt_csv_extractor')
    prompt = f"Texte brut:\n{text_sample}"
    
    try:
        res = await call_ollama(db, prompt, sys_prompt, format_json=True)
        # Guard: Ollama may return an empty response if the input is too large
        if not res or not res.strip():
            raise HTTPException(
                status_code=500,
                detail="L'IA a renvoyé une réponse vide. Le fichier est peut-être trop volumineux pour le contexte configuré. Essayez avec un fichier plus petit ou augmentez le contexte Ollama dans les paramètres."
            )
        # Parse JSON
        try:
            parsed_txs = json.loads(res)
        except json.JSONDecodeError as je:
            logger.error("[AI Import] Réponse Ollama non-JSON (%d chars) : %s", len(res), res[:500])
            raise HTTPException(
                status_code=500,
                detail=f"L'IA n'a pas renvoyé un JSON valide. Réessayez ou utilisez l'Analyse Directe."
            )
        if not isinstance(parsed_txs, list):
            # Try to wrap it if it returned a single dict
            if isinstance(parsed_txs, dict) and "transactions" in parsed_txs:
                parsed_txs = parsed_txs["transactions"]
            else:
                parsed_txs = [parsed_txs]
            
        from app.routers.csv_parser import check_reconciliation
        from datetime import datetime
        results = []
        matched_ids = []
        for tx in parsed_txs:
            try:
                amt = float(tx.get('amount', 0))
                tx_date_str = tx.get('date')
                if tx_date_str:
                    try:
                        tx_date = datetime.strptime(tx_date_str, "%Y-%m-%d").date()
                    except ValueError:
                        tx_date = None
                else:
                    tx_date = None
                    
                matched_info = check_reconciliation(db, tx_date, amt, matched_ids)
                if matched_info:
                    matched_ids.append(matched_info["id"])
                
                tx['is_reconciled'] = bool(matched_info)
                tx['already_reconciled'] = matched_info["already_reconciled"] if matched_info else False
                tx['matched_db_id'] = matched_info["id"] if matched_info else None
                tx['db_description'] = matched_info["description"] if matched_info else None
            except Exception:
                tx['is_reconciled'] = False
                tx['already_reconciled'] = False
                tx['matched_db_id'] = None
                tx['db_description'] = None
            results.append(tx)
            
        alerts = check_import_alerts(db, account_id, results) if account_id else {}
        return {"transactions": results, "file_balance": file_balance, "alerts": alerts}
    except Exception as e:
        logger.error("[AI Import] Échec de l'analyse IA : %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

