from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import extract
from pydantic import BaseModel
from datetime import date
from typing import Optional, List
import json

from app.database import get_db
from app.models import Budget, BudgetCategory, Transaction, GlobalConfig, Account

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class BudgetCreate(BaseModel):
    name: str
    monthly_amount: float
    period: Optional[str] = "monthly"
    is_project: Optional[bool] = False
    categories: Optional[List[str]] = []
    start_date: Optional[str] = None  # YYYY-MM-DD for custom period
    end_date: Optional[str] = None
    account_ids: Optional[List[int]] = None  # Improvement_04: scope to specific accounts (org mode)

class BudgetUpdate(BaseModel):
    name: Optional[str] = None
    monthly_amount: Optional[float] = None
    period: Optional[str] = None
    is_project: Optional[bool] = None
    is_closed: Optional[bool] = None
    categories: Optional[List[str]] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    account_ids: Optional[List[int]] = None  # Improvement_04


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _parse_account_ids(raw: str) -> list:
    """Parse JSON string of account IDs from DB column."""
    if not raw:
        return []
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return []


def _serialize_account_ids(ids: list) -> str:
    """Serialize account IDs list to JSON string for DB storage."""
    if not ids:
        return None
    return json.dumps(ids)


def _budget_to_dict(b: Budget, db: Session) -> dict:
    cats = db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all()
    return {
        "id": b.id,
        "name": b.name,
        "monthly_amount": b.monthly_amount,
        "period": b.period,
        "is_project": b.is_project,
        "is_closed": b.is_closed,
        "categories": [c.category_name for c in cats],
        "start_date": b.start_date.isoformat() if b.start_date else None,
        "end_date": b.end_date.isoformat() if b.end_date else None,
        "account_ids": _parse_account_ids(b.account_ids),
    }


# ─── CRUD endpoints ───────────────────────────────────────────────────────────

@router.get("/")
def get_budgets(db: Session = Depends(get_db)):
    budgets = db.query(Budget).order_by(Budget.name).all()
    return [_budget_to_dict(b, db) for b in budgets]


@router.post("/")
def create_budget(data: BudgetCreate, db: Session = Depends(get_db)):
    _start = date.fromisoformat(data.start_date) if data.start_date else None
    _end = date.fromisoformat(data.end_date) if data.end_date else None
    b = Budget(
        name=data.name,
        monthly_amount=data.monthly_amount,
        period=data.period,
        is_project=data.is_project,
        is_closed=False,
        start_date=_start,
        end_date=_end,
        account_ids=_serialize_account_ids(data.account_ids),
    )
    db.add(b)
    db.commit()
    db.refresh(b)

    for cat_name in (data.categories or []):
        db.add(BudgetCategory(budget_id=b.id, category_name=cat_name))
    db.commit()

    return _budget_to_dict(b, db)


@router.put("/{budget_id}")
def update_budget(budget_id: int, data: BudgetUpdate, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")

    for k, v in data.dict(exclude_unset=True).items():
        if k == "categories":
            continue  # handled below
        if k in ("start_date", "end_date"):
            setattr(b, k, date.fromisoformat(v) if v else None)
            continue
        if k == "account_ids":
            setattr(b, k, _serialize_account_ids(v))
            continue
        setattr(b, k, v)

    if data.categories is not None:
        db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).delete()
        for cat_name in data.categories:
            db.add(BudgetCategory(budget_id=budget_id, category_name=cat_name))

    db.commit()
    db.refresh(b)
    return _budget_to_dict(b, db)


@router.delete("/{budget_id}")
def delete_budget(budget_id: int, db: Session = Depends(get_db)):
    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")
    db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).delete()
    db.delete(b)
    db.commit()
    return {"ok": True}


# ─── Status endpoint ──────────────────────────────────────────────────────────

@router.get("/status")
def get_budget_status(year: int = None, month: int = None, date_start: str = None, date_end: str = None, period_filter: str = None, db: Session = Depends(get_db)):
    """Returns spending vs budget for each envelope.
    Supports day-granularity via date_start/date_end (YYYY-MM-DD) or month-level via year/month.
    period_filter: optional, one of 'monthly', 'yearly', 'indefinite', 'custom' to return only that type.
    """
    today = date.today()
    y = year or today.year
    m = month or today.month

    # Parse custom date range if provided (only used for monthly budgets)
    custom_start = None
    custom_end = None
    if date_start and date_end:
        try:
            custom_start = date.fromisoformat(date_start)
            custom_end = date.fromisoformat(date_end)
        except ValueError:
            pass

    q = db.query(Budget).filter(Budget.is_closed == False)
    if period_filter:
        if period_filter == "custom":
            q = q.filter(Budget.period == "custom")
        elif period_filter == "indefinite":
            q = q.filter(Budget.period == "indefinite")
        elif period_filter == "yearly":
            q = q.filter(Budget.period == "yearly")
        elif period_filter == "monthly":
            q = q.filter(Budget.period.in_(["monthly", None]))
    budgets = q.all()
    result = []

    for b in budgets:
        cats = [c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all()]
        acc_ids = _parse_account_ids(b.account_ids)  # Improvement_04

        expenses = 0.0
        income = 0.0
        reconciled_expenses = 0.0
        reconciled_income = 0.0

        def _match_account(tx):
            """Check if transaction involves any of the budget's scoped accounts."""
            if not acc_ids:
                return True  # No account filter = global
            return (tx.from_account_id in acc_ids or tx.to_account_id in acc_ids)

        if b.is_project:
            txs = db.query(Transaction).filter(Transaction.budget_id == b.id).all()
            for tx in txs:
                if not _match_account(tx):
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        elif b.period == "indefinite":
            txs_all = db.query(Transaction).filter(
                Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
            ).all()
            for tx in txs_all:
                if not _match_account(tx):
                    continue
                if cats and (tx.category or "Sans catégorie") not in cats:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        elif b.period == "custom" and b.start_date and b.end_date:
            txs_custom = db.query(Transaction).filter(
                Transaction.date_operation >= b.start_date,
                Transaction.date_operation <= b.end_date,
                Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
            ).all()
            for tx in txs_custom:
                if not _match_account(tx):
                    continue
                if cats and (tx.category or "Sans catégorie") not in cats:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        elif b.period == "yearly":
            # Yearly budgets: filter by full year only
            txs_yearly = db.query(Transaction).filter(
                extract('year', Transaction.date_operation) == y,
                Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
            ).all()
            for tx in txs_yearly:
                if not _match_account(tx):
                    continue
                if cats and (tx.category or "Sans catégorie") not in cats:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        elif custom_start and custom_end:
            # Day-granularity custom range (monthly budgets only)
            txs = db.query(Transaction).filter(
                Transaction.date_operation >= custom_start,
                Transaction.date_operation <= custom_end,
                Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
            ).all()
            for tx in txs:
                if not _match_account(tx):
                    continue
                if cats and (tx.category or "Sans catégorie") not in cats:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)
        else:
            # Monthly budgets: filter by year + month
            txs = db.query(Transaction).filter(
                extract('year', Transaction.date_operation) == y,
                extract('month', Transaction.date_operation) == m,
                Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
            ).all()
            for tx in txs:
                if not _match_account(tx):
                    continue
                if cats and (tx.category or "Sans catégorie") not in cats:
                    continue
                if tx.type == "income":
                    income += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_income += abs(tx.amount)
                else:
                    expenses += abs(tx.amount)
                    if tx.reconciliation_date:
                        reconciled_expenses += abs(tx.amount)


        expenses = round(expenses, 2)
        income = round(income, 2)
        spent = round(expenses - income, 2)  # net: can be negative if income > expenses
        
        reconciled_expenses = round(reconciled_expenses, 2)
        reconciled_income = round(reconciled_income, 2)
        reconciled_spent = round(reconciled_expenses - reconciled_income, 2)

        budget_amount = b.monthly_amount  # User enters exact cap, no auto-division
        pct = round((max(spent, 0) / budget_amount * 100) if budget_amount > 0 else 0, 1)
        reconciled_pct = round((max(reconciled_spent, 0) / budget_amount * 100) if budget_amount > 0 else 0, 1)

        result.append({
            "id": b.id,
            "name": b.name,
            "categories": cats,
            "is_project": b.is_project,
            "is_closed": b.is_closed,
            "budget_amount": budget_amount,
            "expenses": expenses,
            "reconciled_expenses": reconciled_expenses,
            "income": income,
            "spent": max(spent, 0),    # display: never negative
            "reconciled_spent": max(reconciled_spent, 0),
            "net": spent,              # raw net value
            "remaining": round(budget_amount - spent, 2),
            "percent": pct,
            "reconciled_percent": reconciled_pct,
            "period": b.period,
            "start_date": b.start_date.isoformat() if b.start_date else None,
            "end_date": b.end_date.isoformat() if b.end_date else None,
            "account_ids": acc_ids,
        })

    # Resolve account names for all budget results
    all_acc_ids = set()
    for r in result:
        all_acc_ids.update(r.get("account_ids") or [])
    acc_name_map = {}
    if all_acc_ids:
        for a in db.query(Account).filter(Account.id.in_(list(all_acc_ids))).all():
            acc_name_map[a.id] = a.name
    for r in result:
        r["account_names"] = [acc_name_map.get(aid, f"#{aid}") for aid in (r.get("account_ids") or [])]

    return {"year": y, "month": m, "budgets": result}


# ─── Budget transactions detail ───────────────────────────────────────────────

@router.get("/{budget_id}/transactions")
def get_budget_transactions(budget_id: int, year: int = None, month: int = None, db: Session = Depends(get_db)):
    """Return all transactions contributing to a budget envelope."""
    from datetime import date as _date
    today = _date.today()
    y = year or today.year
    m = month or today.month

    b = db.query(Budget).filter(Budget.id == budget_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Budget non trouvé.")

    cats = [c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == budget_id).all()]
    acc_ids = _parse_account_ids(b.account_ids)  # Improvement_04

    def _apply_account_filter(q):
        """Apply account scope filter to query if budget has account_ids."""
        if not acc_ids:
            return q
        from sqlalchemy import or_
        return q.filter(or_(
            Transaction.from_account_id.in_(acc_ids),
            Transaction.to_account_id.in_(acc_ids)
        ))

    if b.is_project:
        q = db.query(Transaction).filter(Transaction.budget_id == budget_id)
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif b.period == "indefinite":
        q = db.query(Transaction).filter(
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif b.period == "custom" and b.start_date and b.end_date:
        q = db.query(Transaction).filter(
            Transaction.date_operation >= b.start_date,
            Transaction.date_operation <= b.end_date,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    elif b.period == "yearly":
        # Yearly budgets: filter by full year only
        q = db.query(Transaction).filter(
            extract('year', Transaction.date_operation) == y,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()
    else:
        # Monthly budgets: filter by year + month
        q = db.query(Transaction).filter(
            extract('year', Transaction.date_operation) == y,
            extract('month', Transaction.date_operation) == m,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        q = _apply_account_filter(q)
        txs = q.order_by(Transaction.date_operation.desc()).all()

    return [{
        "id": tx.id,
        "date": tx.date_operation.isoformat(),
        "description": tx.description,
        "amount": tx.amount,
        "type": tx.type,
        "category": tx.category,
        "is_income": tx.type == "income",
        "is_reconciled": tx.reconciliation_date is not None,
    } for tx in txs]


# ─── AI Suggestion endpoint ───────────────────────────────────────────────────

def _compute_monthly_averages_for_ai(db: Session, already_used_cats: set, anchor_date: date) -> dict:
    """
    Compute TRUE monthly averages (total_per_cat / nb_months) for the LLM prompt.
    Uses a 12-month window ending at anchor_date.
    This is separate from the UI category averages used in the envelope modal badges.
    Returns {category_name: {"avg": float, "type": str, "top_descs": list[str]}}.
    """
    from dateutil.relativedelta import relativedelta
    from collections import defaultdict

    twelve_months_ago = anchor_date - relativedelta(months=12)

    # Query all transactions in the 12-month window
    txs = db.query(Transaction).filter(
        Transaction.date_operation >= twelve_months_ago,
        Transaction.date_operation <= anchor_date,
        Transaction.type.in_(["expense_fixed", "expense_var", "income", "neutral"]),
    ).all()

    # Monthly sums per category + type tracking + description collection
    cat_monthly: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    cat_type: dict[str, str] = {}
    cat_descriptions: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for tx in txs:
        cat = tx.category or "Sans catégorie"
        if cat in already_used_cats:
            continue

        month_key = tx.date_operation.strftime("%Y-%m")
        cat_monthly[cat][month_key] += abs(tx.amount)
        cat_type[cat] = tx.type  # Last seen type wins (categories have consistent types)

        desc = (tx.description or "").strip()
        if desc:
            cat_descriptions[cat][desc] += 1

    if not cat_monthly:
        return {}

    # Count how many distinct months had data in the window
    all_months = set()
    for monthly in cat_monthly.values():
        all_months.update(monthly.keys())
    nb_months = max(len(all_months), 1)

    result = {}
    for cat, monthly_sums in cat_monthly.items():
        total = sum(monthly_sums.values())
        avg = round(total / nb_months, 2)
        desc_counts = cat_descriptions.get(cat, {})
        top_descs = [d for d, _ in sorted(desc_counts.items(), key=lambda x: -x[1])[:5]]
        result[cat] = {
            "avg": avg,
            "type": cat_type.get(cat, "expense_var"),
            "top_descs": top_descs,
        }

    return result


@router.post("/ai_suggest")
def ai_suggest_budgets(db: Session = Depends(get_db)):
    """
    Analyse the last 6 months of spending per category and asks Ollama
    to suggest logical budget envelopes with amounts.
    Returns a list of proposals [{name, categories, suggested_amount}].
    """
    from app.routers.chat import get_ollama_config, call_ollama_sync

    cfg = get_ollama_config(db)
    if not cfg.get("enabled"):
        raise HTTPException(status_code=400, detail="IA non activée dans les paramètres.")

    # Get existing budgets to collect already assigned categories
    existing_budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    already_used_cats = set()
    for b in existing_budgets:
        for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all():
            already_used_cats.add(c.category_name)

    print(f"[AI-SUGGEST] already_used_cats ({len(already_used_cats)}): {sorted(already_used_cats)}")

    # Anchor on the latest PAST transaction (not future recurrences),
    # so the 12-month window covers actual historical spending.
    latest_past_tx = db.query(Transaction).filter(
        Transaction.date_operation <= date.today()
    ).order_by(Transaction.date_operation.desc()).first()
    anchor_date = latest_past_tx.date_operation if latest_past_tx else date.today()
    print(f"[AI-SUGGEST] Anchor date: {anchor_date}")

    # Debug: show ALL distinct categories in transactions within the window
    from dateutil.relativedelta import relativedelta as _rd
    _six = anchor_date - _rd(months=6)
    all_tx_cats = db.query(Transaction.category, Transaction.type).filter(
        Transaction.date_operation >= _six,
        Transaction.date_operation <= anchor_date,
    ).distinct().all()
    print(f"[AI-SUGGEST] ALL categories in transactions (6mo): {len(all_tx_cats)} found")

    # Compute true monthly averages for the LLM (separate from UI averages)
    cat_data = _compute_monthly_averages_for_ai(db, already_used_cats, anchor_date)

    if not cat_data:
        raise HTTPException(status_code=400, detail="Toutes vos dépenses sont déjà couvertes par vos enveloppes actuelles, ou aucune donnée suffisante.")

    # Group by transaction type for the prompt
    type_labels = {
        "expense_fixed": "Dépense fixe",
        "expense_var": "Dépense variable",
        "income": "Recette",
        "neutral": "Neutre",
    }
    type_groups: dict[str, list[str]] = {}
    for cat, info in sorted(cat_data.items(), key=lambda x: -x[1]["avg"]):
        t = info["type"]
        label = type_labels.get(t, t)
        if label not in type_groups:
            type_groups[label] = []
        desc_str = f" (Exemples : {', '.join(info['top_descs'])})" if info["top_descs"] else ""
        type_groups[label].append(f"  - {cat}: {info['avg']:.2f}€/mois{desc_str}")

    avg_lines_parts = []
    for group_label, lines in type_groups.items():
        avg_lines_parts.append(f"\n### {group_label}")
        avg_lines_parts.extend(lines)
    avg_lines = "\n".join(avg_lines_parts)

    nb_cats = len(cat_data)

    # Build explicit list of exact category names for the prompt
    exact_cat_names = ", ".join(f'"{c}"' for c in cat_data.keys())

    prompt = f"""Tu es un conseiller financier expert. Voici les dépenses moyennes mensuelles de l'utilisateur sur les 12 derniers mois, UNIQUEMENT pour les catégories qui ne sont PAS encore dans un budget. Elles sont regroupées par type de transaction :

{avg_lines}

IMPORTANT : Voici la liste EXACTE des {nb_cats} noms de catégories à utiliser (copie-les EXACTEMENT, sans modifier l'orthographe) :
{exact_cat_names}

Tu DOIS proposer suffisamment d'enveloppes pour que CHAQUE catégorie ci-dessus soit incluse dans exactement une enveloppe. Regroupe les catégories similaires si pertinent, mais ne laisse AUCUNE catégorie de côté. Ne réutilise JAMAIS la même catégorie dans deux enveloppes. Utilise UNIQUEMENT les noms exacts listés ci-dessus dans le champ "categories".
Pour chaque enveloppe, réponds UNIQUEMENT en JSON valide, un objet par ligne, avec ce format exact :
{{"name": "Nom de l'enveloppe", "categories": ["Cat1", "Cat2"], "suggested_amount": 250.00, "reason": "Explication courte"}}

Ne réponds rien d'autre que les lignes JSON. Pas de markdown, pas de texte autour."""

    # Request enough output tokens for all categories (num_predict),
    # without overriding the user's configured context window (num_ctx).
    print(f"[AI-SUGGEST] Envoi au LLM: {nb_cats} categories non couvertes")
    print(f"[AI-SUGGEST] Prompt ({len(prompt)} chars)")
    
    raw = call_ollama_sync(prompt, cfg, extra_options={"num_predict": 4096})

    print(f"[AI-SUGGEST] Reponse brute du LLM ({len(raw)} chars)")
    try:
        print(raw)
    except UnicodeEncodeError:
        print(raw.encode('ascii', 'replace').decode())

    # Strip markdown code fences that some models wrap around JSON
    import re
    raw = re.sub(r'```(?:json)?\s*', '', raw)

    proposals = []
    used_in_proposals = set()

    for line in raw.strip().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith("{"):
            try:
                obj = json.loads(line)
                if "name" in obj and "suggested_amount" in obj:
                    cats = obj.get("categories", [])
                    # Deduplicate: keep only categories not yet assigned in this batch
                    clean_cats = [c for c in cats if c not in used_in_proposals and c in cat_data]
                    
                    if clean_cats: # Only add proposal if it still has valid categories
                        used_in_proposals.update(clean_cats)
                        proposals.append({
                            "name": obj["name"],
                            "categories": clean_cats,
                            "suggested_amount": float(obj["suggested_amount"]),
                            "reason": obj.get("reason", ""),
                        })
                        print(f"[AI-SUGGEST] [OK] Enveloppe acceptee: {obj['name']} -> {clean_cats}")
                    else:
                        print(f"[AI-SUGGEST] [WARN] Enveloppe rejetee (cats invalides/doublons): {obj.get('name')} -> {cats}")
            except Exception as e:
                print(f"[AI-SUGGEST] [ERR] Ligne JSON invalide: {line[:100]}... -> {e}")

    # Log uncovered categories
    covered = used_in_proposals
    uncovered = set(cat_data.keys()) - covered
    if uncovered:
        print(f"[AI-SUGGEST] [WARN] {len(uncovered)} categories NON couvertes par le LLM: {uncovered}")

    if not proposals:
        raise HTTPException(status_code=500, detail="L'IA n'a pas pu générer de propositions valides.")

    print(f"[AI-SUGGEST] [OK] {len(proposals)} enveloppes proposees, {len(covered)}/{nb_cats} categories couvertes")
    return {"proposals": proposals}
