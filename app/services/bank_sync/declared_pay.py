"""Deux décisions sans IA prises à l'inscription d'une opération bancaire, avec son montant et sa date :

- le salaire : un revenu proche du jour de paie et du montant net déclarés dans l'assistant de démarrage est rangé
  dans la catégorie de salaire, au lieu de « Revenus divers » (l'employeur ne dit rien aux mots-clés ni à l'IA) ;
- la dépense fixe ou variable : une catégorie existante garde son type ; une catégorie nouvelle qui désigne une
  charge fixe (assurance, prêt, télécoms, énergie, abonnement, impôts…), ou un prélèvement / une échéance, donne
  une dépense fixe. Tout passait en dépense variable, ce qui faussait enveloppes et Simulateur.
"""
from datetime import date, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Category, GlobalConfig
from app.services.smart_label.categories import _clean_token_str, is_fixed_category_name

SALARY_DAYS_AROUND = 7
SALARY_AMOUNT_TOLERANCE = 0.30
_DIRECT_DEBIT_PREFIXES = ("prlv", "prelevement", "echeance")


def _cfg(db: Session, key: str) -> Optional[str]:
    row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    return row.value if row and row.value else None


def _days_to_pay_day(op_date: date, pay_day: int) -> int:
    best = 99
    for months in (-1, 0, 1):
        y, m = op_date.year, op_date.month + months
        if m < 1:
            y, m = y - 1, 12
        elif m > 12:
            y, m = y + 1, 1
        last = (date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)).day
        best = min(best, abs((op_date - date(y, m, min(pay_day, last))).days))
    return best


def salary_category_for(db: Session, amount: float, op_date: date) -> Optional[str]:
    """Catégorie de salaire si ce revenu ressemble à la paie déclarée, sinon None."""
    try:
        declared = float(_cfg(db, "base_pay_amount") or 0)
        pay_day = int(_cfg(db, "base_pay_day") or 28)
    except ValueError:
        return None
    if declared <= 0 or not op_date:
        return None
    if abs(abs(amount) - declared) > declared * SALARY_AMOUNT_TOLERANCE:
        return None
    if _days_to_pay_day(op_date, pay_day) > SALARY_DAYS_AROUND:
        return None
    chosen = _cfg(db, "pay_category")
    income_cats = [n for (n,) in db.query(Category.name).filter(Category.type == "income",
                                                               (Category.is_closed == False) | (Category.is_closed == None)).all() if n]
    if chosen and chosen in income_cats:
        return chosen
    named = [n for n in income_cats if "salaire" in _clean_token_str(n)]
    return min(named, key=len) if named else "Salaire"


def expense_type_for(db: Session, category: Optional[str], raw_label: Optional[str]) -> str:
    """« expense_fixed » ou « expense_var » pour une dépense de cette catégorie."""
    if category:
        existing = db.query(Category.type).filter(Category.name == category).first()
        if existing and existing.type in ("expense_fixed", "expense_var"):
            return existing.type
        if not existing and is_fixed_category_name(category):
            return "expense_fixed"
    label = _clean_token_str(raw_label or "")
    if label.startswith(_DIRECT_DEBIT_PREFIXES) or " echeance" in f" {label}":
        return "expense_fixed"
    return "expense_var"
