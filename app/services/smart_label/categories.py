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
                # Protection catégories composites (ex: "Rembours. Acmex", "Assurance Auto", "Abonnement Sport") :
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


# Sans IA, ces mots-clés donnent une catégorie à créer quand aucune catégorie existante ne correspond : un profil neuf
# n'a que les fourre-tout, et tout y finissait. L'ordre compte (« UEP*DAC SUPER U » est du carburant avant d'être des
# courses). Mots seuls = mot entier du libellé nettoyé ; plusieurs mots = suite de mots entiers.
STARTER_CATEGORIES: List[Tuple[str, str, Tuple[str, ...]]] = [
    ("Salaire", "income", ("salaire", "salaires", "paie", "remuneration")),
    ("Remboursements", "income", ("remboursement", "remboursements", "rembt", "avoir", "refund")),
    ("Intérêts", "income", ("interets", "interet", "remuneration livret")),
    ("Aides et allocations", "income", ("caf", "cpam", "ameli", "france travail", "pole emploi", "allocation", "allocations")),
    ("Carburant", "expense", ("carburant", "carburants", "essence", "gazole", "diesel", "dac", "esso", "avia", "station service",
                              "totalenergies relais", "total relais")),
    ("Péages et parking", "expense", ("peage", "peages", "autoroute", "autoroutes", "aprr", "sanef", "fulli", "ulys",
                                       "bip go", "parking", "stationnement", "indigo")),
    ("Courses", "expense", ("alim", "carrefour", "leclerc", "auchan", "intermarche", "super u", "hyper u", "systeme u",
                            "lidl", "aldi", "monoprix", "franprix", "netto", "picard", "grand frais", "biocoop",
                            "supermarche", "hypermarche", "epicerie", "boulangerie", "boulang", "boulange", "boucherie",
                            "primeur")),
    ("Restaurants", "expense", ("restaurant", "resto", "brasserie", "bistrot", "pizzeria", "sushi", "kebab", "mcdonalds",
                                "mcdonald", "burger king", "kfc", "uber eats", "deliveroo")),
    ("Transports", "expense", ("sncf", "ouigo", "ratp", "tcl", "navigo", "blablacar", "uber", "bolt", "lime")),
    ("Santé", "expense", ("pharmacie", "pharma", "docteur", "medecin", "dr", "dentiste", "hopital", "clinique",
                          "laboratoire", "optique", "opticien", "kine", "osteopathe")),
    ("Assurances", "expense", ("assurance", "assurances", "assu", "assur", "mutuelle", "prevoyance", "maif", "macif",
                               "matmut", "axa", "allianz", "pacifica", "groupama", "gmf", "mma", "cnp", "spb",
                               "suravenir")),
    ("Impôts", "expense", ("impot", "impots", "dgfip", "finances publiques", "direction generale des finances",
                                    "tresor public", "taxe")),
    ("Télécoms et internet", "expense", ("orange", "sosh", "sfr", "bouygues", "free telecom", "free mobile", "freebox",
                                         "b you")),
    ("Énergie", "expense", ("edf", "engie", "octopus", "ekwateur", "totalenergies", "veolia", "saur", "suez")),
    ("Prêts et crédits", "expense", ("echeance", "pret", "emprunt", "credit conso", "crcam")),
    ("Frais bancaires", "expense", ("cotisation", "commission", "commissions", "agios", "frais tenue", "offre essentiel")),
    ("Abonnements", "expense", ("netflix", "spotify", "deezer", "disney", "canal", "prime video", "youtube", "google one",
                                "icloud", "apple com", "adobe", "microsoft", "openai", "chatgpt", "anthropic", "patreon",
                                "floatplane", "google play")),
    ("Shopping", "expense", ("amazon", "fnac", "darty", "cdiscount", "decathlon", "ikea", "leroy merlin", "castorama",
                             "zara", "kiabi", "boulanger")),
    ("Loisirs", "expense", ("cinema", "pathe", "ugc", "steam", "playstation", "nintendo", "concert", "billetterie")),
]


# Mots-clés sans ambiguïté, appliqués avant l'IA : l'IA ne connaît pas ces codes de libellés (« UEP*DAC SUPER U » est la
# pompe à carburant du magasin, que les trois modèles testés classaient en courses). Chaque entrée : nom par défaut,
# déclencheurs, mots qui reconnaissent une catégorie existante de l'utilisateur (« Essence », « Péage tickets »).
STRONG_CATEGORIES: List[Tuple[str, Tuple[str, ...], Tuple[str, ...]]] = [
    ("Carburant", ("dac", "carburant", "carburants", "gazole", "station service"),
     ("carburant", "essence", "gazole")),
    ("Péages et parking", ("peage", "peages", "autoroute", "autoroutes", "aprr", "sanef", "fulli", "ulys", "bip go"),
     ("peage", "autoroute")),
    ("Retraits", ("retrait dab", "retrait especes", "dab"), ("retrait", "especes")),
    ("Impôts", ("dgfip", "finances publiques", "direction generale des finances", "tresor public"),
     ("impot", "taxe", "fiscal")),
]


def strong_category_for(db: Session, text: str, tx_type: Optional[str] = None) -> Optional[Tuple[str, bool]]:
    """Catégorie certaine d'après un mot-clé sans ambiguïté : (nom, à_créer) ou None. Réutilise la catégorie de
    dépense existante de l'utilisateur quand il en a une équivalente (la plus courte), sinon le nom par défaut."""
    if tx_type == "income":
        return None
    raw_clean = _clean_token_str(text)
    if not raw_clean:
        return None
    tokens = set(raw_clean.split())
    padded = f" {raw_clean} "
    for name, triggers, user_words in STRONG_CATEGORIES:
        if not any((" " in kw and f" {kw} " in padded) or kw in tokens for kw in triggers):
            continue
        from app.models import Category
        cats = db.query(Category.name, Category.type).filter(
            (Category.is_closed == False) | (Category.is_closed == None)).all()
        same = [n for n, t in cats if n and t != "income" and any(w in _clean_token_str(n) for w in user_words)]
        if same:
            return min(same, key=len), False
        return name, True
    return None


# Virement entre personnes : « Wero vers JEAN D », « WEB M. NOM », « VIR SEPA … », « DE M. NOM ». Après les autres
# mots-clés (« VIR SEPA EDF » reste de l'énergie) ; le sens donne la catégorie.
_P2P_FIRST_TOKENS = {"wero", "paylib", "lydia", "vir", "virement", "web"}
P2P_EXPENSE_CATEGORY = "Virements envoyés"
P2P_INCOME_CATEGORY = "Virements reçus"


def person_transfer_category(text: str, tx_type: Optional[str] = None) -> Optional[str]:
    raw_clean = _clean_token_str(text)
    tokens = raw_clean.split()
    if not tokens:
        return None
    is_p2p = tokens[0] in _P2P_FIRST_TOKENS or raw_clean.startswith(("de m ", "de mme ", "de mlle ", "de mr "))
    if not is_p2p:
        return None
    if tx_type is None:  # sens inconnu : « VIR INST WERO de X », « VIR … RECU » sont des virements reçus
        tx_type = "income" if ({"de", "recu"} & set(tokens)) else "expense_var"
    return P2P_INCOME_CATEGORY if tx_type == "income" else P2P_EXPENSE_CATEGORY


# Dépenses fixes (Mon Profil les range ainsi) : la catégorie dit si l'opération est une charge fixe
_FIXED_CATEGORY_WORDS = ("assurance", "mutuelle", "pret", "credit", "emprunt", "telecom", "internet", "energie",
                         "electricite", "abonnement", "impot", "taxe", "loyer", "frais bancaires", "frais de compte")


def is_fixed_category_name(name: Optional[str]) -> bool:
    clean = _clean_token_str(name or "")
    return any(w in clean for w in _FIXED_CATEGORY_WORDS)


# Familles où un mot-clé suffit (pas de revue) : un opérateur télécom, un fournisseur d'énergie, un assureur nommé,
# une échéance de prêt ou un virement à une personne ne se trompent pas de catégorie. Les autres (courses, santé,
# shopping…) restent à vérifier : enseignes qui vendent de tout, mots courts (« dr »). Exceptions au mot près.
RELIABLE_STARTER_FAMILIES = {"Télécoms et internet", "Énergie", "Prêts et crédits", "Assurances", "Frais bancaires",
                             "Abonnements", P2P_EXPENSE_CATEGORY, P2P_INCOME_CATEGORY}
# cotisation d'association ; CRCAM = prêt le plus souvent ; TotalEnergies vend aussi du carburant
_UNRELIABLE_STARTER_KEYWORDS = {"cotisation", "crcam", "totalenergies"}

# Prélèvement de la banque elle-même précédé d'un numéro de contrat (« 0123456 CREDIT AGRICOLE CENTRE E ») : cotisation
# d'assurance (Pacifica). Les échéances de prêt portent « ECHEANCE », les frais leur propre libellé.
_BANK_CONTRACT_DEBIT = re.compile(r"^\d{5,} (credit agricole|ca)\b")


def starter_match(text: str, tx_type: Optional[str] = None) -> Optional[Tuple[str, str, bool]]:
    """Catégorie de départ par mots-clés : (nom, 'income'|'expense', fiable) ou None. N'écrit rien en base."""
    raw_clean = _clean_token_str(text)
    if not raw_clean:
        return None
    if tx_type != "income" and _BANK_CONTRACT_DEBIT.match(raw_clean):
        return "Assurances", "expense", False
    tokens = set(raw_clean.split())
    padded = f" {raw_clean} "
    for name, flow, keywords in STARTER_CATEGORIES:
        if tx_type == "income" and flow != "income":
            continue
        if tx_type in ("expense_var", "expense_fixed") and flow != "expense":
            continue
        for kw in keywords:
            if (" " in kw and f" {kw} " in padded) or kw in tokens:
                return name, flow, name in RELIABLE_STARTER_FAMILIES and kw not in _UNRELIABLE_STARTER_KEYWORDS
    p2p = person_transfer_category(text, tx_type)
    if p2p:
        return p2p, "income" if p2p == P2P_INCOME_CATEGORY else "expense", True
    return None


def starter_category_for(text: str, tx_type: Optional[str] = None) -> Optional[Tuple[str, str]]:
    """Catégorie de départ suggérée par mots-clés : (nom, 'income'|'expense') ou None. N'écrit rien en base."""
    found = starter_match(text, tx_type)
    return found[:2] if found else None


_INCOME_CATEGORY_WORDS = ("salaire", "remboursement", "aide", "allocation", "virement", "revenu", "interet",
                          "dividende", "loyer", "pension", "retraite", "prime", "recette", "remuneration", "vente",
                          "cadeau", "gain", "indemnite", "bourse", "honoraire", "facturation")


def looks_like_income_category(name: Optional[str]) -> bool:
    """Une catégorie de revenu dit d'où vient l'argent (salaire, remboursement…), pas ce que vend celui qui paie :
    l'IA rangeait un salaire dans « Matériaux », le métier de l'employeur."""
    clean = _clean_token_str(name or "")
    return any(w in clean for w in _INCOME_CATEGORY_WORDS)


def count_real_categories(db: Session) -> int:
    """Catégories actives hors fourre-tout : en dessous de quelques-unes, le profil démarre."""
    from app.models import Category
    names = db.query(Category.name).filter((Category.is_closed == False) | (Category.is_closed == None)).all()
    return sum(1 for (n,) in names if n and not is_fallback_category(n))


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
