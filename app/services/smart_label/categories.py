"""
OmniBank-Local — Smart Label : Gestion des catégories de repli, matching sémantique direct et persistance SQLite.
Fournit la détection des catégories par mots-clés/noms actifs, la gestion des catégories fourre-tout et la création différée sécurisée en base.
"""

import logging
import re
import unicodedata
from typing import Any, List, Optional, Set, Tuple

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_FALLBACK_EXPENSE_SYNONYMS = {
    "dépenses diverses", "depenses diverses", "autres dépenses", "autres depenses",
    "dépenses imprévues", "depenses imprevues", "achats divers", "frais divers",
    "dépense diverse", "depense diverse"
}

_FALLBACK_INCOME_SYNONYMS = {
    "revenus divers", "autres revenus", "recettes diverses", "autres recettes",
    "rentrées diverses", "rentrees diverses", "revenu divers", "recette diverse"
}

DEFAULT_FALLBACK_EXPENSE_CATEGORY = "Dépenses diverses"
DEFAULT_FALLBACK_INCOME_CATEGORY = "Revenus divers"


def _clean_token_str(s: str) -> str:
    """Nettoie une chaîne pour comparaison insensible aux accents, casse et ponctuation."""
    if not s:
        return ""
    nfd = unicodedata.normalize('NFD', str(s))
    no_accents = ''.join(c for c in nfd if unicodedata.category(c) != 'Mn')
    cleaned = re.sub(r'[^a-zA-Z0-9\s]', ' ', no_accents.lower())
    return re.sub(r'\s+', ' ', cleaned).strip()


# Mots-clés sémantiques et racines courantes en français associées à des concepts budgétaires
_KEYWORD_SEMANTIC_MAPPINGS: List[Tuple[Set[str], Set[str], str]] = [
    # Remboursements / Avoirs / Retours
    (
        {"remboursement", "remboursements", "rembours", "avoir", "avoirs", "refund", "retour", "restitue", "restitution"},
        {"remboursement", "remboursements", "avoir", "avoirs", "rembours"},
        "income"
    ),
    # Salaires & Revenus d'activité
    (
        {"salaire", "salaires", "paie", "paye", "traitement", "remuneration", "bulletin", "employeur"},
        {"salaire", "salaires", "revenus", "revenu", "traitements", "activite"},
        "income"
    ),
    # Allocations / Prestations sociales
    (
        {"caf", "cpam", "ameli", "pole emploi", "france travail", "cnav", "retraite", "prestation", "allocation", "allocations"},
        {"allocations", "allocation", "aides", "prestations", "secu", "retraite", "sante"},
        "income"
    ),
    # Santé & Pharmacie
    (
        {"pharmacie", "docteur", "medecin", "dentiste", "hopital", "clinique", "laboratoire", "analyse", "optique", "kine", "osteopathe", "therapeute", "soins"},
        {"sante", "pharmacie", "medical", "medecin", "soins", "optique", "mutuelle"},
        "expense"
    ),
    # Carburant & Énergie transport
    (
        {"carburant", "essence", "diesel", "gazole", "superethanol", "station service", "sp95", "sp98", "e10", "e85"},
        {"carburant", "essence", "carburants", "vehicule", "transport", "transports", "auto"},
        "expense"
    ),
    # Péages & Stationnement
    (
        {"peage", "peages", "autoroute", "telepeage", "bip&go", "aprr", "vinci", "sanef", "area", "park", "parking", "stationnement"},
        {"peage", "peages", "parking", "transports", "transport", "vehicule", "auto"},
        "expense"
    ),
    # Alimentation & Courses
    (
        {"courses", "supermarche", "hypermarche", "boulangerie", "boucherie", "primeur", "epicerie", "marche"},
        {"alimentation", "courses", "supermarche", "epicerie", "nourriture", "vie quotidienne"},
        "expense"
    ),
    # Restaurants & Sorties
    (
        {"restaurant", "restaurants", "resto", "brasserie", "bistrot", "fast food", "mcdonalds", "burger", "pizzeria", "sushi", "ubereats", "deliveroo"},
        {"restaurant", "restaurants", "sorties", "resto", "restauration", "loisirs"},
        "expense"
    ),
    # Assurances
    (
        {"assurance", "assurances", "mutuelle", "pacifica", "macif", "maif", "allianz", "axa", "mma", "matmut", "direct assurance"},
        {"assurance", "assurances", "mutuelle", "assurances et prevoyance", "logement"},
        "expense"
    ),
    # Impôts & Taxes
    (
        {"impot", "impots", "tresor public", "dgefip", "taxe fonciere", "taxe habitation", "prelevement a la source"},
        {"impots", "impot", "taxes", "fiscalite", "impots et taxes"},
        "expense"
    ),
]


def match_category_from_text(
    db: Session,
    text: str,
    tx_type: Optional[str] = None
) -> Optional[Tuple[str, float, str]]:
    """
    Recherche si le libellé brut ou propre correspond directement à une catégorie active
    existante dans la base de données SQLite de l'utilisateur.

    Retourne un tuple (nom_categorie, score_confiance, source) ou None.
    Priorise :
    1. Correspondance exacte du nom d'une catégorie active dans le texte (ex: 'Remboursement' dans 'Remboursement Bouilloire Amazon').
    2. Correspondance sémantique via les mots-clés financiers (_KEYWORD_SEMANTIC_MAPPINGS).
    """
    if not text or not str(text).strip():
        return None

    from app.models import Category

    raw_clean = _clean_token_str(text)
    if not raw_clean:
        return None
    raw_tokens = set(raw_clean.split())

    try:
        categories = db.query(Category).filter(
            (Category.is_closed == False) | (Category.is_closed == None)
        ).all()
    except Exception as e:
        logger.debug(f"[SmartLabel] Erreur lecture catégories: {e}")
        return None

    if not categories:
        return None

    # Normaliser le type cible
    is_income_target = (tx_type == "income")
    is_expense_target = (tx_type in ("expense_var", "expense_fixed"))

    # 1. Correspondance directe par nom de catégorie
    direct_candidates: List[Tuple[str, float, int]] = []

    for cat in categories:
        if not cat.name or is_fallback_category(cat.name):
            continue

        cat_clean = _clean_token_str(cat.name)
        if not cat_clean:
            continue
        cat_tokens = set(cat_clean.split())

        # Vérifier la cohérence de direction si tx_type est spécifié
        is_income_cat = (cat.type == "income")
        if is_income_target and not is_income_cat:
            continue
        if is_expense_target and is_income_cat:
            continue

        # Match exact ou sous-chaîne de mot entier
        # Ex: "remboursement" dans "remboursement bouilloire amazon"
        if cat_clean in raw_clean:
            # Vérifier qu'il s'agit d'un mot entier ou d'une sous-chaîne délimitée
            pattern_regex = r'\b' + re.escape(cat_clean) + r'\b'
            if re.search(pattern_regex, raw_clean):
                score = 0.95
                direct_candidates.append((cat.name, score, len(cat_clean)))
        elif len(cat_tokens) > 1 and cat_tokens.issubset(raw_tokens):
            score = 0.92
            direct_candidates.append((cat.name, score, len(cat_clean)))
        else:
            # Vérifier si un token significatif de la catégorie (>= 5 lettres) est dans les tokens
            sig_cat_tokens = [t for t in cat_tokens if len(t) >= 5]
            if sig_cat_tokens and any(t in raw_tokens for t in sig_cat_tokens):
                # Protection catégories composites (ex: "Rembours. Hexcel", "Assurance Auto", "Abonnement Sport") :
                # Si la catégorie comporte plusieurs tokens et qu'un seul mot matche (ex: seulement le tiers sans l'action),
                # le score ne doit JAMAIS atteindre le seuil d'auto-commit (0.85). On plafonne à 0.45 pour demander revue.
                score = 0.45 if len(cat_tokens) > 1 else 0.80
                direct_candidates.append((cat.name, score, max(len(t) for t in sig_cat_tokens)))

    if direct_candidates:
        # Prendre la catégorie avec la correspondance la plus spécifique (longueur la plus élevée)
        direct_candidates.sort(key=lambda x: (x[1], x[2]), reverse=True)
        best_cat_name, best_score, _ = direct_candidates[0]
        return best_cat_name, best_score, "category_match"

    # 2. Correspondance sémantique par mots-clés
    for trigger_kws, target_cat_kws, flow_type in _KEYWORD_SEMANTIC_MAPPINGS:
        # Vérifier si un mot-clé déclencheur est présent dans le texte
        matched_trigger = False
        for kw in trigger_kws:
            if kw in raw_tokens or (len(kw) >= 5 and any(t.startswith(kw) for t in raw_tokens)):
                matched_trigger = True
                break

        if not matched_trigger:
            continue

        if is_income_target and flow_type != "income":
            continue
        if is_expense_target and flow_type != "expense":
            continue

        # Trouver une catégorie active de l'utilisateur qui correspond aux cibles
        for cat in categories:
            if not cat.name or is_fallback_category(cat.name):
                continue
            cat_clean = _clean_token_str(cat.name)
            is_income_cat = (cat.type == "income")
            if is_income_target and not is_income_cat:
                continue
            if is_expense_target and is_income_cat:
                continue

            for t_kw in target_cat_kws:
                if t_kw in cat_clean or (len(t_kw) >= 5 and cat_clean.startswith(t_kw)):
                    return cat.name, 0.88, "category_keyword"

    return None


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
