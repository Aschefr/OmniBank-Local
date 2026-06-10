from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
import httpx
import json
import codecs
from datetime import date

from app.database import get_db
from app.models import GlobalConfig, Transaction, Account, Category
from app.services.finance_engine import calculate_balances, get_net_worth
from app.schemas.api_schemas import ChatMessage

router = APIRouter(prefix="/api/chat", tags=["chat"])


# ─── Shared Ollama helpers (importable by other routers) ──────────────────────

def get_ollama_config(db: Session) -> dict:
    """Return Ollama config dict with keys: enabled, url, model, temperature, num_ctx."""
    def _val(key):
        row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        return row.value if row else None

    enabled = _val("enable_ai") in ("true", "True", "1")
    return {
        "enabled": enabled,
        "url": _val("ollama_url"),
        "model": _val("ollama_model"),
        "temperature": float(_val("ollama_temperature") or 0.3),
        "num_ctx": int(_val("ollama_context") or 4096),
    }


def call_ollama_sync(prompt: str, cfg: dict, extra_options: dict = None) -> str:
    """Blocking (sync) call to Ollama — use from non-async endpoints only.
    extra_options: additional Ollama options (e.g. num_predict) merged on top of defaults."""
    import httpx as _httpx
    url = (cfg.get("url") or "").rstrip("/")
    model = cfg.get("model") or ""
    if not url or not model:
        raise ValueError("Ollama URL ou modèle non configuré.")
    options = {"temperature": cfg.get("temperature", 0.3), "num_ctx": cfg.get("num_ctx", 4096)}
    if extra_options:
        options.update(extra_options)
    resp = _httpx.post(
        f"{url}/api/chat",
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
            "options": options,
        },
        timeout=120.0,
    )
    resp.raise_for_status()
    return resp.json().get("message", {}).get("content", "")

def get_net_worth_tool(db: Session) -> dict:
    return {
        "reconciled_net_worth_euros": get_net_worth(db, only_reconciled=True),
        "projected_net_worth_euros_today": get_net_worth(db, end_date=date.today(), only_reconciled=False)
    }

def get_balances_tool(db: Session) -> dict:
    accounts = {a.id: a.name for a in db.query(Account).all()}
    
    rec_b = calculate_balances(db, only_reconciled=True)
    proj_b = calculate_balances(db, end_date=date.today(), only_reconciled=False)
    
    return {
        "reconciled_balances": {accounts.get(k, f"Compte {k}"): v for k, v in rec_b.items()},
        "projected_balances_today": {accounts.get(k, f"Compte {k}"): v for k, v in proj_b.items()}
    }

def get_recent_transactions_tool(db: Session, limit: int = 15) -> dict:
    recent_txs = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).limit(limit).all()
    
    return {"transactions": [
        {
            "id": tx.id,
            "date": tx.date_operation.isoformat(), 
            "description": tx.description, 
            "amount": tx.amount, 
            "type": tx.type, 
            "category": tx.category,
            "status": "Rapproché (Exécuté)" if tx.reconciliation_date else "Non Rapproché (Futur/Prévu)"
        }
        for tx in recent_txs
    ]}


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_net_worth",
            "description": "Obtenir la valeur nette totale de l'utilisateur (Total des comptes + livrets). Retourne le montant 'reconciled' (actuel validé) et 'projected_today' (incluant les opérations non rapprochées jusqu'à aujourd'hui).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_account_balances",
            "description": "Obtenir le solde de tous les comptes bancaires et livrets séparément. Retourne 'reconciled_balances' (soldes actuels validés en banque) et 'projected_balances_today' (soldes virtuels incluant les dépenses non rapprochées jusqu'à la date d'aujourd'hui, excluant les mois futurs).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_recent_transactions",
            "description": "Obtenir les dernières transactions effectuées par l'utilisateur. Chaque transaction contient un statut 'Rapproché' (déjà passé en banque) ou 'Non Rapproché' (dépense future prévue).",
            "parameters": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer", 
                        "description": "Le nombre de transactions à récupérer (par défaut 15, max 50)."
                    }
                }
            }
        }
    }
]

def load_system_prompt(role: str = 'advisor', categories: list = None) -> str:
    prompt_key = f"sys_prompt_{role}"
    try:
        with codecs.open('static/i18n/fr.json', 'r', encoding='utf-8-sig') as f:
            translations = json.load(f)
            prompt = translations.get(prompt_key, 'Tu es un assistant financier.')
            prompt = prompt.replace("Voici les donn\u00e9es financi\u00e8res actuelles de l'utilisateur (en format JSON) :\n{FINANCE_DATA}\n", '')
            prompt = prompt.replace('Voici les donn\u00e9es financi\u00e8res actuelles:\n{FINANCE_DATA}', '')
            
            # Inject existing categories so AI picks from them first
            cat_list = ", ".join(f'"{c}"' for c in (categories or []))
            prompt += f"""\n\nIMPORTANT: Si tu remarques une anomalie sur une transaction (erreur de cat\u00e9gorie, date incoh\u00e9rente, etc.) et que tu as son \"id\", tu PEUX proposer une correction \u00e0 l'utilisateur. 
Pour cela, ajoute imm\u00e9diatement apr\u00e8s ton explication ce bloc JSON sur une seule ligne, sans indentation :
{{\"id\": 123, \"updates\": {{\"category\": \"Nouvelle Cat\u00e9gorie\"}}}}
Remplace 123 par le vrai ID de la transaction, et sp\u00e9cifie dans \"updates\" les champs \u00e0 modifier.
CAT\u00c9GORIES EXISTANTES (\u00e0 privil\u00e9gier imp\u00e9rativement) : {cat_list}
Si aucune ne convient, propose un nouveau nom court et pr\u00e9cis. Ne propose qu'une seule action JSON \u00e0 la fois."""
            return prompt
    except Exception:
        return "Tu es un assistant financier d'OmniBank."

@router.post("/")
async def chat_with_ai(message: ChatMessage, db: Session = Depends(get_db)):
    ollama_url_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_url").first()
    ollama_model_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_model").first()
    ollama_temp_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_temperature").first()
    ollama_ctx_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_context").first()
    
    if not ollama_url_conf or not ollama_url_conf.value or not ollama_model_conf or not ollama_model_conf.value:
        raise HTTPException(status_code=400, detail="Ollama URL ou Modèle non configuré.")
        
    url = ollama_url_conf.value.rstrip("/")
    model = ollama_model_conf.value
    
    options = {}
    if ollama_temp_conf and ollama_temp_conf.value:
        try: options["temperature"] = float(ollama_temp_conf.value)
        except: pass
    if ollama_ctx_conf and ollama_ctx_conf.value:
        try: options["num_ctx"] = int(ollama_ctx_conf.value)
        except: pass
    
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    sys_prompt = load_system_prompt(message.role, categories)
    
    # Filter out empty messages that might be in history
    clean_history = [m for m in message.history if m.get("content")]
    messages = [{"role": "system", "content": sys_prompt}] + clean_history
    messages.append({"role": "user", "content": message.content})
    
    async def generate():
        try:
            async with httpx.AsyncClient() as client:
                # FIRST STEP: Call Ollama with tools (No streaming)
                payload = {
                    "model": model,
                    "messages": messages,
                    "tools": TOOLS,
                    "stream": False,
                    "options": options
                }
                
                resp = await client.post(f"{url}/api/chat", json=payload, timeout=120.0)
                if resp.status_code != 200:
                    yield f"data: {json.dumps({'error': 'Ollama error: ' + str(resp.status_code)})}\n\n"
                    return
                    
                resp_data = resp.json()
                assistant_msg = resp_data.get("message", {})
                
                # Check for tool calls
                if assistant_msg.get("tool_calls"):
                    # Execute tools
                    messages.append(assistant_msg) # Add assistant's tool call request
                    
                    for tool_call in assistant_msg["tool_calls"]:
                        fn_name = tool_call["function"]["name"]
                        fn_args = tool_call["function"].get("arguments", {})
                        
                        tool_result = {}
                        if fn_name == "get_net_worth":
                            tool_result = get_net_worth_tool(db)
                        elif fn_name == "get_account_balances":
                            tool_result = get_balances_tool(db)
                        elif fn_name == "get_recent_transactions":
                            limit = fn_args.get("limit", 15)
                            tool_result = get_recent_transactions_tool(db, limit)
                            
                        # Append tool result
                        messages.append({
                            "role": "tool",
                            "name": fn_name,
                            "content": json.dumps(tool_result, ensure_ascii=False)
                        })
                        
                    # SECOND STEP: Stream the final answer with tool context
                    payload_stream = {
                        "model": model,
                        "messages": messages,
                        "stream": True,
                        "options": options
                    }
                    
                    async with client.stream("POST", f"{url}/api/chat", json=payload_stream, timeout=120.0) as stream_resp:
                        if stream_resp.status_code != 200:
                            yield f"data: {json.dumps({'error': 'Ollama error: ' + str(stream_resp.status_code)})}\n\n"
                            return
                        async for chunk in stream_resp.aiter_bytes():
                            if chunk:
                                try:
                                    json_chunk = json.loads(chunk)
                                    content = json_chunk.get("message", {}).get("content", "")
                                    if content:
                                        yield f"data: {json.dumps({'content': content})}\n\n"
                                except json.JSONDecodeError:
                                    pass
                else:
                    # No tool calls, just return the response
                    content = assistant_msg.get("content", "")
                    if content:
                        yield f"data: {json.dumps({'content': content})}\n\n"
                            
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})


class AutoCatRequest(BaseModel):
    description: str
    amount: float = None

@router.post("/autocategorize")
async def autocategorize(req: AutoCatRequest, db: Session = Depends(get_db)):
    """Ask Ollama to suggest a category for a transaction, preferring existing ones."""
    ollama_url_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_url").first()
    ollama_model_conf = db.query(GlobalConfig).filter(GlobalConfig.key == "ollama_model").first()

    if not ollama_url_conf or not ollama_url_conf.value or not ollama_model_conf or not ollama_model_conf.value:
        raise HTTPException(status_code=400, detail="Ollama non configuré.")

    url = ollama_url_conf.value.rstrip("/")
    model = ollama_model_conf.value
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    cat_list = ", ".join(f'"{c}"' for c in categories)

    amount_str = f" de {req.amount} €" if req.amount else ""
    prompt = f"""Tu es un assistant de catégorisation financière.
CATÉGORIES EXISTANTES : {cat_list}

Transaction : "{req.description}"{amount_str}

Réponds UNIQUEMENT avec le nom de la catégorie la plus appropriée, en privilégiant une catégorie existante.
Si aucune ne convient vraiment, propose un nom court (2-3 mots max).
Réponds avec SEULEMENT le nom, sans ponctuation, sans explication."""

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(f"{url}/api/chat", json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {"temperature": 0.1, "num_ctx": 512}
            })
            resp.raise_for_status()
            data = resp.json()
            suggested = data.get("message", {}).get("content", "").strip().strip('"').strip("'")
            return {"category": suggested, "existing_categories": categories}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
