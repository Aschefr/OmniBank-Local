"""
app/services/chat/chat_snapshot.py — Capture des snapshots d'entités financières
au moment de la génération d'une réponse IA.

Les données sont stockées dans ChatMessage.entity_snapshots (JSON) pour que les
badges interactifs affichent des chiffres historiquement fidèles lors de la relecture
d'une ancienne conversation.
"""
import json
import logging
import calendar
from datetime import date
from typing import Optional
from sqlalchemy.orm import Session

from app.models import Transaction, Account, Category, Budget, BudgetAllocation

logger = logging.getLogger(__name__)


def build_entity_snapshots(final_text: str, db: Session, year: int, month: int) -> dict:
    """
    Détecte les noms d'entités (budgets, comptes, catégories) mentionnés dans
    le texte de la réponse IA et capture leur état financier actuel.

    Args:
        final_text: Texte brut de la réponse de l'IA (après traitement Markdown).
        db: Session SQLAlchemy.
        year: Année courante (au moment de la génération).
        month: Mois courant (au moment de la génération).

    Returns:
        Dict sérialisable en JSON avec les snapshots, clé = "type:name".
        Exemple : {"budget:Facture Énergie": {...}, "account:Compte Courant": {...}}
    """
    if not final_text or not final_text.strip():
        return {}

    text_lower = final_text.lower()
    snapshots = {}

    try:
        # ── 1. Budgets ────────────────────────────────────────────────────────
        try:
            budgets = _get_all_budgets_with_status(db, year, month)
            for b in budgets:
                if b.get("name") and b["name"].lower() in text_lower:
                    key = f"budget:{b['name']}"
                    if key not in snapshots:
                        snap = _snapshot_budget(db, b, year, month)
                        if snap:
                            snapshots[key] = snap
        except Exception as e:
            logger.warning(f"[Snapshot] Erreur budgets: {e}")

        # ── 2. Comptes bancaires ──────────────────────────────────────────────
        try:
            accounts = db.query(Account).all()
            for acc in accounts:
                if acc.name and acc.name.lower() in text_lower:
                    key = f"account:{acc.name}"
                    if key not in snapshots:
                        snap = _snapshot_account(db, acc)
                        if snap:
                            snapshots[key] = snap
        except Exception as e:
            logger.warning(f"[Snapshot] Erreur comptes: {e}")

        # ── 3. Catégories ─────────────────────────────────────────────────────
        try:
            categories = db.query(Category).all()
            for cat in categories:
                if cat.name and len(cat.name) >= 3 and cat.name.lower() in text_lower:
                    key = f"category:{cat.name}"
                    if key not in snapshots:
                        snap = _snapshot_category(db, cat)
                        if snap:
                            snapshots[key] = snap
        except Exception as e:
            logger.warning(f"[Snapshot] Erreur catégories: {e}")

    except Exception as e:
        logger.error(f"[Snapshot] Erreur générale build_entity_snapshots: {e}")

    logger.debug(f"[Snapshot] {len(snapshots)} entités snapshotées pour {year}-{month:02d}")
    return snapshots


# ─── Helpers internes ────────────────────────────────────────────────────────

def _get_all_budgets_with_status(db: Session, year: int, month: int) -> list:
    """Charge tous les budgets avec leur statut dépenses/solde pour year/month."""
    from app.services.chat.chat_tools import get_budgets_status_tool
    result = get_budgets_status_tool(db, year, month)
    return result.get("budgets", [])


def _snapshot_budget(db: Session, budget_data: dict, year: int, month: int) -> Optional[dict]:
    """Capture le snapshot d'une enveloppe budgétaire."""
    try:
        budget_id = budget_data.get("id")
        budget_name = budget_data.get("name", "")
        spent = float(budget_data.get("spent", 0.0))
        limit_ = float(budget_data.get("limit", 0.0))
        remaining = float(budget_data.get("remaining", limit_ - spent))
        percent = float(budget_data.get("percent", (spent / limit_ * 100) if limit_ > 0 else 0.0))

        # 3 dernières transactions du mois pour ce budget
        recent_txs = []
        if budget_id:
            try:
                start_date = date(year, month, 1)
                end_date = date(year, month, calendar.monthrange(year, month)[1])
                txs = (
                    db.query(Transaction)
                    .filter(
                        Transaction.date_operation >= start_date,
                        Transaction.date_operation <= end_date,
                        Transaction.budget_id == budget_id,
                    )
                    .order_by(Transaction.date_operation.desc())
                    .limit(3)
                    .all()
                )
                for t in txs:
                    recent_txs.append({
                        "description": t.description or "",
                        "amount": float(t.amount),
                        "date": t.date_operation.isoformat() if t.date_operation else "",
                        "is_income": t.amount > 0,
                    })
            except Exception as e:
                logger.debug(f"[Snapshot] Transactions budget {budget_id}: {e}")

        return {
            "type": "budget",
            "id": budget_id,
            "name": budget_name,
            "snapshot_year": year,
            "snapshot_month": month,
            "spent": round(spent, 2),
            "limit": round(limit_, 2),
            "percent": round(percent, 1),
            "balance": round(remaining, 2),
            "recent_txs": recent_txs,
        }
    except Exception as e:
        logger.warning(f"[Snapshot] _snapshot_budget error: {e}")
        return None


def _snapshot_account(db: Session, account: Account) -> Optional[dict]:
    """Capture le snapshot d'un compte bancaire (soldes réconcilié et projeté)."""
    try:
        from app.services.finance_engine import calculate_balances
        rec_balances = calculate_balances(db, only_reconciled=True)
        proj_balances = calculate_balances(db, end_date=date.today(), only_reconciled=False)

        return {
            "type": "account",
            "id": account.id,
            "name": account.name,
            "account_type": account.type or "",
            "snapshot_date": date.today().isoformat(),
            "balance_reconciled": round(float(rec_balances.get(account.id, 0.0)), 2),
            "balance_projected": round(float(proj_balances.get(account.id, 0.0)), 2),
        }
    except Exception as e:
        logger.warning(f"[Snapshot] _snapshot_account error: {e}")
        return None


def _snapshot_category(db: Session, category: Category) -> Optional[dict]:
    """Capture les 4 dernières transactions d'une catégorie."""
    try:
        txs = (
            db.query(Transaction)
            .filter(
                Transaction.category == category.name,
                Transaction.date_operation <= date.today(),
            )
            .order_by(Transaction.date_operation.desc())
            .limit(4)
            .all()
        )
        recent_txs = [
            {
                "description": t.description or "",
                "amount": float(t.amount),
                "date": t.date_operation.isoformat() if t.date_operation else "",
                "is_income": t.amount > 0,
            }
            for t in txs
        ]
        return {
            "type": "category",
            "name": category.name,
            "snapshot_date": date.today().isoformat(),
            "recent_txs": recent_txs,
        }
    except Exception as e:
        logger.warning(f"[Snapshot] _snapshot_category error: {e}")
        return None
