from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
import httpx
import json
import codecs
from datetime import date

from app.database import get_db
from app.models import GlobalConfig, Category, Transaction

router = APIRouter(prefix="/api/ai", tags=["ai"])

def load_sys_prompt(key: str) -> str:
    try:
        with codecs.open('static/i18n/fr.json', 'r', encoding='utf-8-sig') as f:
            translations = json.load(f)
            return translations.get(key, '')
    except Exception:
        return ''

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
        except: pass

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
async def import_csv_ai(file: UploadFile = File(...), db: Session = Depends(get_db)):
    import logging
    logger = logging.getLogger(__name__)

    content = await file.read()
    if file.filename.endswith('.xlsx'):
        import pandas as pd
        from io import BytesIO
        df = pd.read_excel(BytesIO(content), dtype=str)
        text = df.to_csv(sep=';', index=False)

        # Extract balance from raw xlsx data (metadata rows before the real header)
        raw_data = [df.columns.tolist()] + df.values.tolist()
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
                        except:
                            pass
                    if file_balance is not None:
                        break
            if file_balance is not None:
                break
    else:
        try:
            text = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            text = content.decode('latin-1')

        file_balance = None
        
    # Limite le texte pour ne pas exploser le contexte par defaut
    text_sample = text[:25000] 
    
    # Extract file balance from CSV text (only if not already found from xlsx)
    if file_balance is None:
        for line in text_sample.split('\n')[:30]:
            if 'solde' in line.lower():
                parts = line.split(';') if ';' in line else line.split(',')
                for part in parts:
                    clean = part.replace('€', '').replace('\u202f', '').replace(' ', '').replace(',', '.').strip()
                    if clean.lower() != 'nan':
                        try:
                            amt = float(clean)
                            import math
                            if amt != 0 and not math.isnan(amt):
                                file_balance = amt
                                break
                        except:
                            pass
                if file_balance is not None:
                    break
    
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
            except:
                tx['is_reconciled'] = False
                tx['already_reconciled'] = False
                tx['matched_db_id'] = None
                tx['db_description'] = None
            results.append(tx)
            
        return {"transactions": results, "file_balance": file_balance}
    except Exception as e:
        logger.error("[AI Import] Échec de l'analyse IA : %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

