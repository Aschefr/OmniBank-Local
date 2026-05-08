from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import extract
from pydantic import BaseModel
from datetime import date
from typing import Optional, List
import json

from app.database import get_db
from app.models import Budget, BudgetCategory, Transaction, GlobalConfig

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class BudgetCreate(BaseModel):
    name: str
    monthly_amount: float
    period: Optional[str] = "monthly"
    is_project: Optional[bool] = False
    categories: Optional[List[str]] = []

class BudgetUpdate(BaseModel):
    name: Optional[str] = None
    monthly_amount: Optional[float] = None
    period: Optional[str] = None
    is_project: Optional[bool] = None
    is_closed: Optional[bool] = None
    categories: Optional[List[str]] = None


# ─── Helpers ──────────────────────────────────────────────────────────────────

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
    }


# ─── CRUD endpoints ───────────────────────────────────────────────────────────

@router.get("/")
def get_budgets(db: Session = Depends(get_db)):
    budgets = db.query(Budget).order_by(Budget.name).all()
    return [_budget_to_dict(b, db) for b in budgets]


@router.post("/")
def create_budget(data: BudgetCreate, db: Session = Depends(get_db)):
    b = Budget(
        name=data.name,
        monthly_amount=data.monthly_amount,
        period=data.period,
        is_project=data.is_project,
        is_closed=False,
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
def get_budget_status(year: int = None, month: int = None, db: Session = Depends(get_db)):
    """Returns spending vs budget for each envelope."""
    today = date.today()
    y = year or today.year
    m = month or today.month

    budgets = db.query(Budget).filter(Budget.is_closed == False).all()
    result = []

    for b in budgets:
        cats = [c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id).all()]

        expenses = 0.0
        income = 0.0
        reconciled_expenses = 0.0
        reconciled_income = 0.0

        if b.is_project:
            txs = db.query(Transaction).filter(Transaction.budget_id == b.id).all()
            for tx in txs:
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
            txs = db.query(Transaction).filter(
                extract('year', Transaction.date_operation) == y,
                extract('month', Transaction.date_operation) == m,
                Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
            ).all()
            for tx in txs:
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

        budget_amount = (
            b.monthly_amount if b.period == "monthly"
            else round(b.monthly_amount / 12, 2) if b.period == "yearly"
            else b.monthly_amount
        )
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
        })

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

    if b.is_project:
        txs = db.query(Transaction).filter(Transaction.budget_id == budget_id)\
            .order_by(Transaction.date_operation.desc()).all()
    elif b.period == "indefinite":
        q = db.query(Transaction).filter(
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
        txs = q.order_by(Transaction.date_operation.desc()).all()
    else:
        q = db.query(Transaction).filter(
            extract('year', Transaction.date_operation) == y,
            extract('month', Transaction.date_operation) == m,
            Transaction.type.in_(["expense_fixed", "expense_var", "income"]),
        )
        if cats:
            q = q.filter(Transaction.category.in_(cats))
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

@router.post("/ai_suggest")
def ai_suggest_budgets(db: Session = Depends(get_db)):
    """
    Analyse the last 3 months of spending per category and asks Ollama
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

    from dateutil.relativedelta import relativedelta
    
    # Base the 6-month window on the latest available transaction date, not necessarily today's date
    latest_tx = db.query(Transaction).order_by(Transaction.date_operation.desc()).first()
    anchor_date = latest_tx.date_operation if latest_tx else date.today()
    
    six_months_ago = anchor_date - relativedelta(months=6)

    txs = db.query(Transaction).filter(
        Transaction.date_operation >= six_months_ago,
        Transaction.type.in_(["expense_fixed", "expense_var"]),
    ).all()

    monthly_totals: dict[str, list[float]] = {}
    category_descriptions: dict[str, dict[str, int]] = {}

    for tx in txs:
        cat = tx.category or "Sans catégorie"
        if cat in already_used_cats:
            continue
            
        # Collect descriptions over 6 months
        desc = (tx.description or "").strip()
        if desc:
            if cat not in category_descriptions:
                category_descriptions[cat] = {}
            category_descriptions[cat][desc] = category_descriptions[cat].get(desc, 0) + 1
            
        # Collect amounts over 6 months
        monthly_totals.setdefault(cat, []).append(tx.amount)

    if not monthly_totals:
        raise HTTPException(status_code=400, detail="Toutes vos dépenses sont déjà couvertes par vos enveloppes actuelles, ou aucune donnée suffisante.")

    # Build averages and attach top descriptions
    averages = {cat: round(sum(vals) / len(vals), 2) for cat, vals in monthly_totals.items()}
    avg_lines_arr = []
    for cat, amt in sorted(averages.items(), key=lambda x: -x[1]):
        desc_counts = category_descriptions.get(cat, {})
        top_descs = [d for d, c in sorted(desc_counts.items(), key=lambda x: -x[1])[:5]]
        desc_str = f" (Exemples d'achats : {', '.join(top_descs)})" if top_descs else ""
        avg_lines_arr.append(f"- {cat}: {amt:.2f}€/mois{desc_str}")
        
    avg_lines = "\n".join(avg_lines_arr)

    prompt = f"""Tu es un conseiller financier expert. Voici les dépenses moyennes mensuelles de l'utilisateur sur les 6 derniers mois, UNIQUEMENT pour les catégories qui ne sont PAS encore dans un budget :

{avg_lines}

Propose de NOUVELLES enveloppes budgétaires logiques (au maximum 3 ou 4) pour couvrir ces dépenses. Regroupe les catégories similaires si pertinent. Ne réutilise JAMAIS la même catégorie dans deux enveloppes différentes.
Pour chaque enveloppe, réponds UNIQUEMENT en JSON valide, un objet par ligne, avec ce format exact :
{{"name": "Nom de l'enveloppe", "categories": ["Cat1", "Cat2"], "suggested_amount": 250.00, "reason": "Explication courte"}}

Ne réponds rien d'autre que les lignes JSON. Pas de markdown, pas de texte autour."""

    raw = call_ollama_sync(prompt, cfg)

    proposals = []
    used_in_proposals = set()

    for line in raw.strip().splitlines():
        line = line.strip()
        if line.startswith("{"):
            try:
                obj = json.loads(line)
                if "name" in obj and "suggested_amount" in obj:
                    cats = obj.get("categories", [])
                    # Deduplicate: keep only categories not yet assigned in this batch
                    clean_cats = [c for c in cats if c not in used_in_proposals and c in averages]
                    
                    if clean_cats: # Only add proposal if it still has valid categories
                        used_in_proposals.update(clean_cats)
                        proposals.append({
                            "name": obj["name"],
                            "categories": clean_cats,
                            "suggested_amount": float(obj["suggested_amount"]),
                            "reason": obj.get("reason", ""),
                        })
            except Exception:
                pass

    if not proposals:
        raise HTTPException(status_code=500, detail="L'IA n'a pas pu générer de propositions valides.")

    return {"proposals": proposals}
