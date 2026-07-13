from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

import httpx
import json
import codecs
from datetime import date

from app.database import get_db
from app.models import GlobalConfig, Transaction, Account, Category, RecurrenceTemplate, Budget, ChatSession, ChatMessage
from app.services.finance_engine import calculate_balances, get_net_worth
from app.schemas.api_schemas import ChatSessionCreate, ChatSessionUpdate, ChatContextUpdate, ChatSendMessage, ChatMessageUpdate


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
            "date": tx.date_operation.isoformat() if tx.date_operation else None, 
            "description": tx.description, 
            "amount": tx.amount, 
            "type": tx.type, 
            "category": tx.category,
            "status": "Rapproché" if tx.reconciliation_date else "Non Rapproché"
        }
        for tx in recent_txs
    ]}

def search_transactions_tool(db: Session, description_query: str = None, category: str = None, type: str = None, start_date: str = None, end_date: str = None, min_amount: float = None, max_amount: float = None, limit: int = 50) -> dict:
    try:
        if min_amount is not None:
            min_amount = float(min_amount)
        if max_amount is not None:
            max_amount = float(max_amount)
        if limit is not None:
            limit = int(limit)
    except (ValueError, TypeError):
        return {"error": "Invalid min_amount, max_amount or limit. Expected numeric values."}
        
    query = db.query(Transaction)
    if description_query:
        query = query.filter(Transaction.description.ilike(f"%{description_query}%"))
    if category:
        query = query.filter(Transaction.category == category)
    if type:
        query = query.filter(Transaction.type == type)
    if start_date:
        try:
            query = query.filter(Transaction.date_operation >= date.fromisoformat(start_date))
        except (ValueError, TypeError):
            pass
    if end_date:
        try:
            query = query.filter(Transaction.date_operation <= date.fromisoformat(end_date))
        except (ValueError, TypeError):
            pass
    if min_amount is not None:
        query = query.filter(Transaction.amount >= min_amount)
    if max_amount is not None:
        query = query.filter(Transaction.amount <= max_amount)
    
    txs = query.order_by(Transaction.date_operation.desc()).limit(limit).all()
    return {"transactions": [
        {
            "id": tx.id,
            "date": tx.date_operation.isoformat() if tx.date_operation else None,
            "description": tx.description,
            "amount": tx.amount,
            "type": tx.type,
            "category": tx.category,
            "status": "Rapproché" if tx.reconciliation_date else "Non Rapproché"
        }
        for tx in txs
    ]}

def get_spending_analytics_tool(db: Session, start_date: str, end_date: str) -> dict:
    try:
        d_start = date.fromisoformat(start_date)
        d_end = date.fromisoformat(end_date)
    except (ValueError, TypeError):
        return {"error": "Invalid or missing date format. Expected YYYY-MM-DD strings."}
    
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= d_start,
        Transaction.date_operation <= d_end
    ).all()
    
    by_type = {}
    by_category = {}
    total_income = 0.0
    total_expense = 0.0
    
    for tx in txs:
        tx_type = tx.type or "neutral"
        category = tx.category or "Sans catégorie"
        
        if tx_type not in by_type:
            by_type[tx_type] = {"total_amount": 0.0, "count": 0}
        by_type[tx_type]["total_amount"] += tx.amount
        by_type[tx_type]["count"] += 1
        
        if category not in by_category:
            by_category[category] = {"total_amount": 0.0, "count": 0, "type": tx_type}
        by_category[category]["total_amount"] += tx.amount
        by_category[category]["count"] += 1
        
        if tx_type == "income":
            total_income += tx.amount
        elif tx_type in ("expense_var", "expense_fixed"):
            total_expense += tx.amount
            
    total_income = round(total_income, 2)
    total_expense = round(total_expense, 2)
    net_savings = round(total_income - total_expense, 2)
    
    for t in by_type:
        by_type[t]["total_amount"] = round(by_type[t]["total_amount"], 2)
    for c in by_category:
        by_category[c]["total_amount"] = round(by_category[c]["total_amount"], 2)
        
    return {
        "period": {"start": start_date, "end": end_date},
        "totals": {
            "total_income": total_income,
            "total_expense": total_expense,
            "net_savings": net_savings
        },
        "by_type": by_type,
        "by_category": by_category
    }

def get_budgets_status_tool(db: Session, year: int = None, month: int = None) -> dict:
    from app.routers.budgets import get_budget_status
    today = date.today()
    try:
        y = int(year) if year is not None else today.year
        m = int(month) if month is not None else today.month
    except (ValueError, TypeError):
        return {"error": "Invalid year or month format. Expected integers."}
    
    status_data = get_budget_status(year=y, month=m, db=db)
    
    envelopes = []
    for b in status_data.get("budgets", []):
        envelopes.append({
            "id": b.get("id"),
            "name": b.get("name"),
            "type": b.get("envelope_type", "spending"),
            "period": b.get("period", "monthly"),
            "limit": b.get("budget_amount", 0.0),
            "spent": b.get("expenses", 0.0),
            "remaining": b.get("balance", 0.0),
            "percent": b.get("percent", 0.0)
        })
    return {"year": y, "month": m, "budgets": envelopes}

def get_recurrence_templates_tool(db: Session) -> dict:
    templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
    return {"templates": [
        {
            "id": t.id,
            "description": t.description,
            "amount": t.amount,
            "type": t.type,
            "category": t.category,
            "frequency": t.frequency,
            "day_of_month": t.day_of_month
        }
        for t in templates
    ]}

def get_net_worth_history_tool(db: Session, months: int = 12) -> dict:
    try:
        months = int(months) if months is not None else 12
    except (ValueError, TypeError):
        return {"error": "Invalid months format. Expected integer."}
    from app.routers.stats import get_trends
    trends = get_trends("total", db)
    if "error" in trends:
        return trends
    
    history = trends.get("history", [])
    monthly_points = {}
    for pt in history:
        date_str = pt["date"]
        month_key = date_str[:7]
        monthly_points[month_key] = pt
        
    sorted_months = sorted(monthly_points.keys())
    result_points = [monthly_points[m] for m in sorted_months[-months:]]
    return {
        "current_balance": trends.get("current_balance"),
        "net_worth_history": result_points
    }

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_net_worth",
            "description": "Get the total net worth of the user (all accounts and savings combined). Returns reconciled balance (cleared in bank) and projected balance (including future/planned transactions).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_account_balances",
            "description": "Get the balances of all bank accounts and savings envelopes separately. Returns reconciled and projected balances.",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_transactions",
            "description": "Search user transactions with various filters. Returns a list of transactions matching the criteria.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description_query": {
                        "type": "string",
                        "description": "Optional keyword search on transaction description."
                    },
                    "category": {
                        "type": "string",
                        "description": "Optional category name."
                    },
                    "type": {
                        "type": "string",
                        "description": "Optional transaction type: expense_var, expense_fixed, income, transfer, neutral."
                    },
                    "start_date": {
                        "type": "string",
                        "description": "Optional start date in YYYY-MM-DD format."
                    },
                    "end_date": {
                        "type": "string",
                        "description": "Optional end date in YYYY-MM-DD format."
                    },
                    "min_amount": {
                        "type": "number",
                        "description": "Optional minimum amount."
                    },
                    "max_amount": {
                        "type": "number",
                        "description": "Optional maximum amount."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of transactions to return (default 50)."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_spending_analytics",
            "description": "Get aggregated spending and income statistics for a specific period, grouped by category and transaction type.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {
                        "type": "string",
                        "description": "Start date of the analysis period (YYYY-MM-DD)."
                    },
                    "end_date": {
                        "type": "string",
                        "description": "End date of the analysis period (YYYY-MM-DD)."
                    }
                },
                "required": ["start_date", "end_date"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_budgets_status",
            "description": "Get status of all budget envelopes and savings for a specific year and month.",
            "parameters": {
                "type": "object",
                "properties": {
                    "year": {
                        "type": "integer",
                        "description": "Optional year. Defaults to current year."
                    },
                    "month": {
                        "type": "integer",
                        "description": "Optional month (1-12). Defaults to current month."
                    }
                }
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_recurrence_templates",
            "description": "Get the list of all active recurrence templates (regular bills, salaries, transfers).",
            "parameters": {"type": "object", "properties": {}}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_net_worth_history",
            "description": "Get the historical net worth trend data points grouped by month.",
            "parameters": {
                "type": "object",
                "properties": {
                    "months": {
                        "type": "integer",
                        "description": "Number of past months to retrieve (default 12)."
                    }
                }
            }
        }
    }
]

def load_system_prompt(role: str = 'advisor', categories: list = None, lang: str = 'fr') -> str:
    if role == 'simulator':
        prompt = """You are the Project Simulation Engine for OmniBank.
Your goal is to help the user simulate financial projects (purchasing a house, planning a trip, taking a loan) and compute their impact on the user's net worth and budgets.
CRITICAL: Do NOT ask the user for permission to consult their budgets, accounts, or recurrences, and do NOT tell the user that you need to consult them. Instead, IMMEDIATELY call the appropriate tools (like `get_budgets_status`, `get_account_balances`, or `get_recurrence_templates`) in your very first step to retrieve the necessary data.
Present your answers using clear markdown tables and LaTeX formatting for calculations."""
    elif role == 'alerts':
        prompt = """You are the Alert Analyst for OmniBank.
Your goal is to proactively identify anomalies, overspending, unnecessary subscription costs, or overdraft risks in the user's accounts.
Use the database tools to check recent transactions and active budget levels. Be direct and highlight potential issues in a concise markdown format."""
    elif role == 'optimizer':
        prompt = """You are the Subscription and Expenses Optimizer for OmniBank.
Your goal is to analyze the user's recurring transactions, bills, and recent transactions to identify optimization opportunities, excessive subscription costs, or potential duplicates."""
    elif role == 'budget_planner':
        prompt = """You are the Budget Planner for OmniBank.
Your goal is to analyze the user's spending habits over the last 12 months, compare them to their current budget envelopes, and recommend realistic budget envelope allocations."""
    elif role == 'forecaster':
        prompt = """You are the Cash Flow Forecaster for OmniBank.
Your goal is to project the user's account balances over the next 3 months, taking into account their planned recurring transactions and historical average spending."""
    elif role == 'auditor':
        prompt = """You are the Transaction Auditor for OmniBank.
Your goal is to scan the user's transaction history for data entry inconsistencies, categorization errors, suspicious duplicates, or delayed/forgotten reconciliations."""
    else: # advisor
        prompt = """You are the Premium Personal Financial Advisor for OmniBank.
Your goal is to help the user understand their financial situation, track their expenses, manage budgets, and make smart saving decisions.
CRITICAL: Do NOT ask the user for permission to consult their budgets, accounts, or recurrences, and do NOT tell the user that you need to consult them. Instead, IMMEDIATELY call the appropriate tools in your very first step to retrieve the necessary data.
Always use the tools provided to query the database first before answering. Do not guess, make up numbers, or apologize if you don't know without checking.
- Call `get_account_balances` to check bank account/savings balances.
- Call `get_spending_analytics` to calculate total income/expense or spending per category over a date range. Do not read raw transactions to sum them up yourself.
- Call `search_transactions` to find specific transactions (by keyword, category, date).
- Call `get_budgets_status` to see budget progress (envelope limits, spent amounts, remaining balances).
- Call `get_recurrence_templates` to inspect regular bills.
- Call `get_net_worth_history` to analyze wealth growth.
Always be concise, professional, and helpful."""

    today_str = date.today().isoformat()
    prompt += f"\n\nCURRENT DATE REFERENCE: Today is {today_str}."
    prompt += """

RECONCILIATION & FUTURE TRANSACTIONS RULE:
- In normal mode, the user manages their budget and expenses between regular pay dates.
- It is perfectly normal and expected for transactions with a future date (where `date_operation` is in the future relative to the CURRENT DATE REFERENCE above) to be in the "Unreconciled" (Non Rapproché) state, as they represent scheduled/planned operations that have not occurred yet.
- Do NOT flag future or scheduled transactions as anomalies, forgotten reconciliations, or errors.
- Only consider a transaction as a potentially forgotten or delayed reconciliation if its date is in the PAST (older than today) and it is still unreconciled."""

    cat_list = ", ".join(f'"{c}"' for c in (categories or []))
    prompt += f"""

IMPORTANT: If you notice an anomaly on a transaction (wrong category, inconsistent date, etc.) and you have its "id", you CAN propose a correction.
To do this, append this single-line JSON block immediately at the end of your explanation on its own line:
{{"id": 123, "updates": {{"category": "New Category"}}}}
Replace 123 with the real transaction ID, and specify in "updates" the fields to modify.
EXISTING CATEGORIES (prefer these): {cat_list}
If none fits, propose a short and precise new category name. Only propose one JSON action at a time."""

    if lang == 'fr':
        prompt += "\n\nIMPORTANT: You must write your response in French."
    else:
        prompt += "\n\nIMPORTANT: You must write your response in English."

    return prompt

def estimate_tokens(text: str) -> int:
    return len(text) // 4

def run_context_compaction(db: Session, session: ChatSession, messages: List[ChatMessage], cfg: dict):
    if len(messages) <= 4:
        return
    
    to_compress = messages[:-4]
    
    formatted_history = []
    for msg in to_compress:
        role_prefix = "U" if msg.role == "user" else "A"
        formatted_history.append(f"{role_prefix}: {msg.content}")
    history_text = "\n".join(formatted_history)
    
    if session.compressed_context:
        history_text = f"Previously compacted memory:\n{session.compressed_context}\n\nNew messages to compact:\n{history_text}"
        
    prompt = history_text + """

=== INSTRUCTIONS (CRITICAL — READ CAREFULLY) ===
You are a text compactor. Rewrite the text ABOVE using minimum characters.

RULES:
1. Output ONLY the compacted text. No commentary, no intro.
2. Keep the SAME language as the input (French→French, English→English).
3. Use U: for user, A: for assistant.
4. Remove ALL greetings, politeness, filler, reformulations, repetitions.
5. Convert verbose explanations to telegraphic notes.
6. KEEP ALL technical details.
7. KEEP conversation flow (who said what, in order).
8. Target: ~50% of original size.

NOW COMPACT THE TEXT ABOVE. Output ONLY the compacted result:"""

    try:
        compacted = call_ollama_sync(prompt, cfg)
        if compacted:
            session.compressed_context = compacted.strip()
            for msg in to_compress:
                db.delete(msg)
            db.commit()
    except Exception as e:
        print(f"Error during context compaction: {e}")

def generate_session_title(db: Session, session_id: int, user_message: str, cfg: dict):
    prompt = f"""Conversation first message: "{user_message}"

=== INSTRUCTIONS ===
Generate a concise 3-5 word title for this conversation based on the user's first message. 
Output ONLY the title, no quotation marks, no commentary, no intro, nothing else.
Write the title in the same language as the message.

NOW GENERATE THE TITLE:"""
    try:
        title = call_ollama_sync(prompt, cfg)
        if title:
            session = db.query(ChatSession).filter(ChatSession.id == session_id).first()
            if session:
                session.title = title.strip().strip('"').strip("'")
                db.commit()
    except Exception as e:
        print(f"Error generating session title: {e}")

@router.get("/sessions")
async def list_sessions(db: Session = Depends(get_db)):
    sessions = db.query(ChatSession).order_by(ChatSession.created_at.desc()).all()
    return [{
        "id": s.id,
        "title": s.title,
        "role": s.role,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "has_compressed_context": bool(s.compressed_context)
    } for s in sessions]

@router.post("/sessions")
async def create_session(req: ChatSessionCreate, db: Session = Depends(get_db)):
    session = ChatSession(role=req.role)
    db.add(session)
    db.commit()
    db.refresh(session)
    return {
        "id": session.id,
        "title": session.title,
        "role": session.role,
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "has_compressed_context": False
    }

@router.put("/sessions/{id}")
async def update_session(id: int, req: ChatSessionUpdate, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    if req.title is not None:
        session.title = req.title
    if req.role is not None:
        session.role = req.role
    db.commit()
    return {"ok": True}

@router.delete("/sessions/{id}")
async def delete_session(id: int, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    db.delete(session)
    db.commit()
    return {"ok": True}

@router.get("/sessions/{id}/messages")
async def get_session_messages(id: int, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
    
    cfg = get_ollama_config(db)
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    sys_prompt = load_system_prompt(session.role, categories, 'fr')
    
    used = estimate_tokens(sys_prompt)
    if session.compressed_context:
        used += estimate_tokens(session.compressed_context)
    for m in messages:
        used += estimate_tokens(m.content)
        
    return {
        "compressed_context": session.compressed_context,
        "messages": [{
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "timestamp": m.timestamp.isoformat() if m.timestamp else None
        } for m in messages],
        "token_usage": {
            "used": used,
            "limit": cfg["num_ctx"]
        }
    }

@router.put("/sessions/{id}/context")
async def update_session_context(id: int, req: ChatContextUpdate, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    session.compressed_context = req.compressed_context
    db.commit()
    return {"ok": True}

@router.delete("/messages/{id}")
async def delete_message(id: int, db: Session = Depends(get_db)):
    message = db.query(ChatMessage).filter(ChatMessage.id == id).first()
    if not message:
        raise HTTPException(status_code=404, detail="Message non trouvé")
    db.delete(message)
    db.commit()
    return {"ok": True}

@router.post("/sessions/{id}/system-message")
async def add_system_message(id: int, req: ChatSendMessage, db: Session = Depends(get_db)):
    """Insert a message into a session without triggering AI generation.
    Used for feedback messages (e.g. after applying an AI action)."""
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    msg = ChatMessage(session_id=id, role=req.role if hasattr(req, 'role') else "assistant", content=req.content)
    db.add(msg)
    db.commit()
    return {"ok": True}

@router.post("/sessions/{id}/message")
async def send_message(id: int, req: ChatSendMessage, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
    
    cfg = get_ollama_config(db)
    if not cfg["enabled"] or not cfg["url"] or not cfg["model"]:
        raise HTTPException(status_code=400, detail="Ollama URL ou Modèle non configuré.")
        
    url = cfg["url"].rstrip("/")
    model = cfg["model"]
    
    # Save user message to database
    user_msg = ChatMessage(session_id=id, role="user", content=req.content)
    db.add(user_msg)
    db.commit()
    db.refresh(user_msg)
    
    # Get all messages
    messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
    
    # Check if first message to trigger title generation
    is_first_exchange = (len(messages) == 1)
    
    # Context Compaction check
    categories = [c.name for c in db.query(Category).order_by(Category.name).all()]
    sys_prompt = load_system_prompt(session.role, categories, req.lang)
    
    options = {"temperature": cfg["temperature"], "num_ctx": cfg["num_ctx"]}
    
    # Estimate token budget
    total_tokens = estimate_tokens(sys_prompt)
    if session.compressed_context:
        total_tokens += estimate_tokens(session.compressed_context)
    for m in messages:
        total_tokens += estimate_tokens(m.content)
        
    if total_tokens > int(cfg["num_ctx"] * 0.75):
        run_context_compaction(db, session, messages, cfg)
        # Reload messages after compaction
        messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
        
    # Construct Ollama prompt payload
    ollama_msgs = [{"role": "system", "content": sys_prompt}]
    if session.compressed_context:
        ollama_msgs.append({
            "role": "system", 
            "content": f"[SYSTEM NOTICE: The following is a compacted memory summary of the older messages in this conversation. Keep it in mind for context.]\n{session.compressed_context}"
        })
    for m in messages:
        ollama_msgs.append({"role": m.role, "content": m.content})
        
    async def generate_response():
        final_text = ""
        try:
            async with httpx.AsyncClient() as client:
                # 1. Call Ollama with tools (non-streaming first)
                payload = {
                    "model": model,
                    "messages": ollama_msgs,
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
                    ollama_msgs.append(assistant_msg)
                    
                    tool_desc_map = {
                        "get_net_worth": "Consultation du patrimoine net global...",
                        "get_account_balances": "Interrogation du solde des comptes...",
                        "search_transactions": "Recherche de transactions...",
                        "get_spending_analytics": "Calcul des statistiques de dépenses...",
                        "get_budgets_status": "Vérification de l'état des budgets...",
                        "get_recurrence_templates": "Examen des charges récurrentes...",
                        "get_net_worth_history": "Analyse de l'historique du patrimoine..."
                    }
                    
                    for tool_call in assistant_msg["tool_calls"]:
                        fn_name = tool_call["function"]["name"]
                        fn_args = tool_call["function"].get("arguments", {})
                        
                        desc_status = tool_desc_map.get(fn_name, f"Exécution de {fn_name}...")
                        yield f"data: {json.dumps({'status': desc_status})}\n\n"
                        import asyncio
                        await asyncio.sleep(1.0)
                        
                        tool_result = {}
                        if fn_name == "get_net_worth":
                            tool_result = get_net_worth_tool(db)
                        elif fn_name == "get_account_balances":
                            tool_result = get_balances_tool(db)
                        elif fn_name == "search_transactions":
                            desc = fn_args.get("description_query")
                            cat = fn_args.get("category")
                            tx_type = fn_args.get("type")
                            s_date = fn_args.get("start_date")
                            e_date = fn_args.get("end_date")
                            min_a = fn_args.get("min_amount")
                            max_a = fn_args.get("max_amount")
                            lim = fn_args.get("limit", 50)
                            tool_result = search_transactions_tool(db, desc, cat, tx_type, s_date, e_date, min_a, max_a, lim)
                        elif fn_name == "get_spending_analytics":
                            s_date = fn_args.get("start_date")
                            e_date = fn_args.get("end_date")
                            tool_result = get_spending_analytics_tool(db, s_date, e_date)
                        elif fn_name == "get_budgets_status":
                            yr = fn_args.get("year")
                            mn = fn_args.get("month")
                            tool_result = get_budgets_status_tool(db, yr, mn)
                        elif fn_name == "get_recurrence_templates":
                            tool_result = get_recurrence_templates_tool(db)
                        elif fn_name == "get_net_worth_history":
                            mnths = fn_args.get("months", 12)
                            tool_result = get_net_worth_history_tool(db, mnths)
                        else:
                            tool_result = {"error": f"Tool '{fn_name}' is not supported or defined."}
                            
                        ollama_msgs.append({
                            "role": "tool",
                            "name": fn_name,
                            "content": json.dumps(tool_result, ensure_ascii=False)
                        })
                        
                    # 2. Stream final response with context
                    payload_stream = {
                        "model": model,
                        "messages": ollama_msgs,
                        "stream": True,
                        "options": options
                    }
                    
                    async with client.stream("POST", f"{url}/api/chat", json=payload_stream, timeout=120.0) as stream_resp:
                        if stream_resp.status_code != 200:
                            yield f"data: {json.dumps({'error': 'Ollama error: ' + str(stream_resp.status_code)})}\n\n"
                            return
                        in_thinking = False
                        async for line in stream_resp.aiter_lines():
                            if line:
                                try:
                                    json_chunk = json.loads(line)
                                    msg_obj = json_chunk.get("message", {})
                                    reasoning = msg_obj.get("reasoning_content", "")
                                    content = msg_obj.get("content", "")
                                    
                                    chunk_to_send = ""
                                    if reasoning:
                                        if not in_thinking:
                                            chunk_to_send += "<think>\n"
                                            in_thinking = True
                                        chunk_to_send += reasoning
                                    else:
                                        if in_thinking:
                                            chunk_to_send += "\n</think>\n\n"
                                            in_thinking = False
                                        chunk_to_send += content
                                        
                                    if chunk_to_send:
                                        final_text += chunk_to_send
                                        yield f"data: {json.dumps({'content': chunk_to_send})}\n\n"
                                except json.JSONDecodeError:
                                    pass
                        if in_thinking:
                            final_text += "\n</think>\n\n"
                            think_end_payload = json.dumps({'content': '\n</think>\n\n'})
                            yield f"data: {think_end_payload}\n\n"
                else:
                    # No tool calls — we already have the complete response!
                    reasoning = assistant_msg.get("reasoning_content", "")
                    direct_content = assistant_msg.get("content", "")
                    
                    if reasoning:
                        direct_content = f"<think>\n{reasoning}\n</think>\n\n{direct_content}"
                        
                    if direct_content:
                        final_text = direct_content
                        yield f"data: {json.dumps({'content': direct_content})}\n\n"
                    else:
                        empty_err = "Le modèle n'a pas fourni de réponse. Vérifiez votre configuration Ollama."
                        yield f"data: {json.dumps({'error': empty_err})}\n\n"
            
            # Save assistant response to DB
            if final_text:
                bot_msg = ChatMessage(session_id=id, role="assistant", content=final_text)
                db.add(bot_msg)
                db.commit()
                
            # Calculate final token usage
            final_messages = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.asc()).all()
            used_tokens = estimate_tokens(sys_prompt)
            if session.compressed_context:
                used_tokens += estimate_tokens(session.compressed_context)
            for m in final_messages:
                used_tokens += estimate_tokens(m.content)
                
            yield f"data: {json.dumps({'token_usage': {'used': used_tokens, 'limit': cfg['num_ctx']}})}\n\n"
            
            if is_first_exchange:
                background_tasks.add_task(generate_session_title, db, id, req.content, cfg)
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            
        yield "data: [DONE]\n\n"
        
    return StreamingResponse(generate_response(), media_type="text/event-stream", headers={"X-Accel-Buffering": "no"})

@router.post("/sessions/{id}/regenerate")
async def regenerate_response(id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    session = db.query(ChatSession).filter(ChatSession.id == id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session non trouvée")
        
    # Find last assistant message and delete it
    last_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id).order_by(ChatMessage.timestamp.desc()).first()
    if last_msg and last_msg.role == "assistant":
        db.delete(last_msg)
        db.commit()
        
    # Get the last user message to feed to the send_message endpoint
    last_user_msg = db.query(ChatMessage).filter(ChatMessage.session_id == id, ChatMessage.role == "user").order_by(ChatMessage.timestamp.desc()).first()
    if not last_user_msg:
        raise HTTPException(status_code=400, detail="Aucun message utilisateur à régénérer")
        
    # Call standard message logic by simulating a new send
    req = ChatSendMessage(content=last_user_msg.content)
    # Delete the user message from DB before re-sending so send_message doesn't duplicate it
    db.delete(last_user_msg)
    db.commit()
    
    return await send_message(id, req, background_tasks, db)

@router.put("/messages/{id}")
async def edit_message(id: int, req: ChatMessageUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    message = db.query(ChatMessage).filter(ChatMessage.id == id).first()
    if not message or message.role != "user":
        raise HTTPException(status_code=400, detail="Seuls les messages utilisateur peuvent être édités")
        
    session_id = message.session_id
    
    # Delete all subsequent messages in the session
    subsequent = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id,
        ChatMessage.timestamp > message.timestamp
    ).all()
    for m in subsequent:
        db.delete(m)
        
    # Delete the edited message itself so send_message doesn't duplicate
    db.delete(message)
    db.commit()
    
    # Send the new edited content
    send_req = ChatSendMessage(content=req.content)
    return await send_message(session_id, send_req, background_tasks, db)

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

