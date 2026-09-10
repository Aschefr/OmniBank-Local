"""
OmniBank-Local — Smart Label : Gestion des catégories de repli et persistance SQLite.
Fournit la détection des catégories fourre-tout et la création différée sécurisée en base.
"""

import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_FALLBACK_EXPENSE_SYNONYMS = {
    "dépenses diverses", "depenses diverses", "autres dépenses", "autres depenses",
    "dépenses imprévues", "depenses imprevues", "achats divers", "frais divers",
    "dépense diverse", "depense diverse"
}

_FALLBACK_INCOME_SYNONYMS = {
    "revenus divers", "autres revenus", "recettes diverses", "autres recettes",
    "virements reçus", "virements recus", "remboursements", "remboursements reçus",
    "rentrées diverses", "rentrees diverses"
}

DEFAULT_FALLBACK_EXPENSE_CATEGORY = "Dépenses diverses"
DEFAULT_FALLBACK_INCOME_CATEGORY = "Revenus divers"


def is_fallback_category(category_name: Optional[str]) -> bool:
    """Indique si un nom de catégorie correspond à une catégorie fourre-tout."""
    if not category_name:
        return False
    lower = str(category_name).strip().lower()
    return lower in _FALLBACK_EXPENSE_SYNONYMS or lower in _FALLBACK_INCOME_SYNONYMS


def resolve_fallback_category(db: Session, tx_type: str = "expense_var") -> str:
    """
    Détermine la catégorie filet de sécurité appropriée selon le type d'opération.
    Recherche en priorité si l'utilisateur possède déjà une catégorie synonyme active dans sa base.
    À défaut, renvoie le nom standard canonique ('Dépenses diverses' ou 'Revenus divers').
    Ne crée aucune ligne dans SQLite (création différée au commit).
    """
    from app.models import Category

    is_income = (tx_type == "income")
    synonyms = _FALLBACK_INCOME_SYNONYMS if is_income else _FALLBACK_EXPENSE_SYNONYMS
    default_name = DEFAULT_FALLBACK_INCOME_CATEGORY if is_income else DEFAULT_FALLBACK_EXPENSE_CATEGORY

    try:
        existing_cats = db.query(Category.name).filter(
            (Category.is_closed == False) | (Category.is_closed == None)
        ).all()
        for (cat_name,) in existing_cats:
            if cat_name and cat_name.strip().lower() in synonyms:
                return cat_name.strip()
    except Exception as e:
        logger.debug(f"[SmartLabel] Erreur recherche catégorie fallback: {e}")

    return default_name


def ensure_category_exists(db: Session, category_name: Optional[str], tx_type: str = "expense_var") -> Optional[Any]:
    """
    Garantit l'existence d'une catégorie en base SQLite lors du commit effectif.
    Crée la catégorie si elle n'existe pas encore.
    """
    if not category_name or not category_name.strip():
        return None
    from app.models import Category
    name_clean = category_name.strip()
    cat = db.query(Category).filter(Category.name == name_clean).first()
    if not cat:
        valid_type = tx_type if tx_type in ("expense_fixed", "expense_var", "income", "transfer", "neutral") else "expense_var"
        cat = Category(
            name=name_clean,
            type=valid_type,
            is_closed=False
        )
        db.add(cat)
        try:
            db.flush()
            logger.info(f"[SmartLabel] Nouvelle catégorie créée en base : '{name_clean}' (type: {valid_type})")
        except Exception as e:
            logger.debug(f"[SmartLabel] Flush catégorie '{name_clean}': {e}")
    return cat
