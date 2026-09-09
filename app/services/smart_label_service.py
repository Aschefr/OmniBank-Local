"""
OmniBank-Local — Smart Label Engine (Moteur de correspondance et d'auto-apprentissage).
Gère la normalisation des libellés bancaires bruts, la résolution intelligente par règles/fuzzy-match,
et l'apprentissage automatique des correspondances lors des validations utilisateur.
"""

import difflib
import json
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import BankLabelMapping, Transaction

logger = logging.getLogger(__name__)

# Marchands caméléons par nature (généralistes multi-catégories)
# Pour ces enseignes, le nom est nettoyé mais aucune catégorie fixe n'est imposée par défaut
_MULTI_CATEGORY_MERCHANTS = {
    'AMAZON', 'PAYPAL', 'CARREFOUR', 'LECLERC', 'AUCHAN', 'MONOPRIX',
    'FNAC', 'LIDL', 'INTERMARCHE', 'ALDI', 'CORA', 'SYSTEME U', 'SUPER U', 'HYPER U',
    'CASINO', 'TABAC', 'RELAY', 'TOTAL', 'ESSO', 'BP', 'SHELL', 'ENI', 'ALIEXPRESS'
}


def is_multi_category_merchant(pattern: str) -> bool:
    """Détecte si un motif normalisé correspond à une enseigne généraliste multi-catégories."""
    if not pattern:
        return False
    pat = pattern.upper().strip()
    if pat in _MULTI_CATEGORY_MERCHANTS:
        return True
    tokens = pat.split()
    if tokens and tokens[0] in _MULTI_CATEGORY_MERCHANTS:
        return True
    return False

# Mots-clés et préfixes bancaires techniques à nettoyer
_BANK_NOISE_REGEX = re.compile(
    r'\b('
    r'CB|CARTE|CARTE\s+BANCAIRE|PRLV|PRELEVEMENT|SEPA|VIR|VIREMENT|INST|INSTANTANE|'
    r'FACTURE|FACT|ECH|ECHEANCE|RETRAIT|DAB|GAB|COTIS|COTISATION|COMMISSION|FRAIS|'
    r'MENSUEL|MENSUELLE|TRIMESTRIEL|TRIMESTRIELLE|ANNUEL|ANNUELLE|'
    r'TIP|CHEQUE|CHQ|AVOIR|REMBOURSEMENT|RMB|PAIEMENT|ACHAT|OPERATION|OPR|'
    r'EMETTEUR|REF|ID|CPT|COMPTE'
    r')\b',
    re.IGNORECASE
)

# Motifs de dates (ex: 12/03, 12/03/24, 12-03-2024, 120324)
_DATE_REGEX = re.compile(r'\b\d{2}[/\-.]\d{2}([/\-.]\d{2,4})?\b')

# Motifs de numéros masqués ou séquences de chiffres longues (ex: *1234, X1234, 123456789)
_NUMBER_NOISE_REGEX = re.compile(r'(\*+|X+|\b)\d{4,}\b|\b\d{2,}\b', re.IGNORECASE)

# Préfixes de passerelles de paiement (ex: PAYPAL *, SUMUP *, STRIPE *, LYDIA *, KLARNA *)
_GATEWAY_PREFIX_REGEX = re.compile(
    r'\b(PAYPAL|SUMUP|STRIPE|LYDIA|KLARNA|AMZN\s*MKTP|AMAZON\s*PAY)\s*(\*|\-|\:|\/|\.)\s*',
    re.IGNORECASE
)


# Nettoyage des caractères de ponctuation résiduels
_PUNCT_REGEX = re.compile(r'[^A-Z0-9\sÀ-ÖØ-öø-ÿ]')

# Mots-clés géographiques ou formes juridiques génériques non distinctifs
_GENERIC_TOKENS = {
    'PARIS', 'FRANCE', 'COM', 'SAS', 'SARL', 'ONLINE', 'DIRECT', 'PAY',
    'STORE', 'SHOP', 'SERVICE', 'SERVICES', 'FR', 'EU', 'SA', 'WEB'
}


def normalize_raw_label(raw: str) -> str:
    """
    Nettoie et normalise un libellé bancaire brut pour en extraire l'essence (marchand/organisme).
    Exemples :
      "CB CARREFOUR 74210 2489" -> "CARREFOUR"
      "PRLV SEPA SAS SPB 948201" -> "SAS SPB"
      "FULLI - mobilis" -> "FULLI MOBILIS"
      "VIR SEPA MR DUPONT JEAN 01/02" -> "MR DUPONT JEAN"
      "CB PAYPAL *STEAM GAMES 1234" -> "STEAM GAMES"
    """
    if not raw:
        return ""

    text = str(raw).strip()

    # 1. Supprimer les motifs de dates
    text = _DATE_REGEX.sub(' ', text)

    # 2. Supprimer les mots-clés bancaires
    text = _BANK_NOISE_REGEX.sub(' ', text)

    # 3. Supprimer les séquences de chiffres / codes postaux / identifiants
    text = _NUMBER_NOISE_REGEX.sub(' ', text)

    # 4. Extraire le sous-marchand réel si précédé d'une passerelle de paiement
    gateway_stripped = _GATEWAY_PREFIX_REGEX.sub(' ', text).strip()
    if len(gateway_stripped) >= 3:
        text = gateway_stripped

    # 5. Supprimer les caractères spéciaux superflus (tirets, ponctuation -> espace)
    text = _PUNCT_REGEX.sub(' ', text.upper())

    # 6. Normaliser les espaces
    tokens = [t.strip() for t in text.split() if len(t.strip()) > 0]
    cleaned = " ".join(tokens)

    # Fallback si le nettoyage a tout effacé (ex: label court uniquement numérique)
    if not cleaned:
        cleaned = re.sub(r'\s+', ' ', str(raw).strip().upper())

    return cleaned


# Tokens et mots parasites rejetés pour les propositions de nom de l'IA (garde-fou anti-déchets)
_BANNED_AI_NAME_TOKENS = {
    "unknown", "inconnu", "achat", "paiement", "cb", "prlv", "virement", "vir",
    "transaction", "operation", "autre", "none", "null", "n/a", "sans nom",
    "depense", "facture", "prelevement", "carte", "carte bancaire"
}


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

_INCOME_LABEL_REGEX = re.compile(
    r'\b(VIR(EMENT)?\s+(INST(ANTANE)?)?\s+(DE|RECU)|REMISE\s+CHQ|SALAIRE|CAF|CPAM|AVOIR|REMBOURSEMENT)\b',
    re.IGNORECASE
)


def is_probable_income_label(raw_label: str) -> bool:
    """Détecte par heuristique regex si un libellé bancaire brut correspond vraisemblablement à une recette."""
    if not raw_label:
        return False
    return bool(_INCOME_LABEL_REGEX.search(str(raw_label)))


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



def validate_ai_suggested_name(
    suggested_name: Optional[str],
    raw_label: str,
    clean_label: str,
    user_habits: Optional[List[str]] = None
) -> Optional[str]:
    """
    Garde-fou anti-déchets pour les noms d'opérations proposés par l'IA.
    Vérifie 4 verrous stricts :
    1. Forme : non-vide, 2 <= longueur <= 60, sans balisage markdown ni ponctuations anormales.
    2. Mots parasites / hallucinations génériques (ex: 'Inconnu', 'Achat', 'Paiement').
    3. Ancrage (Grounding) obligatoire :
       - Soit le nom correspond (ou ressemble à >= 80%) à une habitude enregistrée de l'utilisateur.
       - Soit le nom conserve la racine/token distinctif du commerçant présent dans le libellé brut/nettoyé.
    4. En cas de doute ou de rejet, retourne None (ce qui déclenche le repli sur le nom nettoyé par regex).
    """
    if not suggested_name:
        return None

    name = str(suggested_name).strip().strip('"\'`*')
    # 1. Verrou de forme
    if len(name) < 2 or len(name) > 60:
        return None

    # Rejet des artefacts de syntaxe ou balisage
    if any(ch in name for ch in ('{', '}', '[', ']', '<', '>', '\\')):
        return None

    name_lower = name.lower()

    # 2. Filtrage des mots parasites
    if name_lower in _BANNED_AI_NAME_TOKENS:
        return None

    # Rejet des phrases conversationnelles de LLM
    if any(prefix in name_lower for prefix in ("voici", "nom :", "marchand :", "je pense", "here is", "name:", "merchant:")):
        return None

    # 3. Verrou d'ancrage (Grounding)
    clean_lower = clean_label.lower() if clean_label else ""
    raw_lower = raw_label.lower() if raw_label else ""

    # a) Ancré dans les habitudes de l'utilisateur ?
    if user_habits:
        for habit in user_habits:
            if not habit:
                continue
            h_lower = habit.strip().lower()
            if name_lower == h_lower:
                return name
            if len(h_lower) >= 4 and (name_lower in h_lower or h_lower in name_lower):
                return name
            if difflib.SequenceMatcher(None, name_lower, h_lower).ratio() >= 0.80:
                return name

    # b) Ancré dans le commerçant réel (clean_label ou raw_label) ?
    # Vérifie si au moins un token signifiant (>= 3 lettres non générique) du nom suggéré se trouve dans raw ou clean
    suggested_tokens = {t for t in re.split(r'\s+', name_lower) if len(t) >= 3 and t not in _GENERIC_TOKENS}
    reference_text = f"{clean_lower} {raw_lower}"

    for t in suggested_tokens:
        if t in reference_text:
            return name

    # Aucun ancrage valide -> déchet ou hallucination potentielle
    logger.info(f"[SmartLabel] Nom suggéré par IA '{name}' rejeté par manque d'ancrage pour '{clean_label}' -> Repli sur libellé nettoyé")
    return None


def get_user_habit_descriptions(db: Session, limit: int = 35) -> List[str]:
    """
    Extrait les descriptions les plus représentatives des habitudes de l'utilisateur
    (combinaison des règles BankLabelMapping et des transactions fréquentes).
    Fournit un contexte few-shot à l'IA pour reproduire le style de nommage de l'utilisateur.
    """
    habits: List[str] = []
    seen: Set[str] = set()

    # 1. Règles utilisateur existantes
    try:
        rules = db.query(BankLabelMapping.clean_description).filter(
            BankLabelMapping.clean_description.isnot(None),
            BankLabelMapping.is_ignored == False
        ).order_by(BankLabelMapping.match_count.desc()).limit(limit).all()
        for (r_desc,) in rules:
            if r_desc and r_desc.strip():
                clean = r_desc.strip()
                if clean.lower() not in seen:
                    seen.add(clean.lower())
                    habits.append(clean)
    except Exception as e:
        logger.debug(f"[SmartLabel] Erreur récupération règles habitudes : {e}")

    # 2. Transactions fréquentes de l'historique
    try:
        remaining = limit - len(habits)
        if remaining > 0:
            top_txs = db.query(
                Transaction.description,
                func.count(Transaction.id).label('cnt')
            ).filter(
                Transaction.description.isnot(None)
            ).group_by(
                Transaction.description
            ).order_by(
                func.count(Transaction.id).desc()
            ).limit(remaining * 2).all()

            for (desc, _) in top_txs:
                if desc and desc.strip():
                    clean = desc.strip()
                    if clean.lower() not in seen and len(clean) >= 3:
                        seen.add(clean.lower())
                        habits.append(clean)
                        if len(habits) >= limit:
                            break
    except Exception as e:
        logger.debug(f"[SmartLabel] Erreur récupération transactions habitudes : {e}")

    return habits


def _tokenize(text: str) -> Set[str]:
    """Extrait les tokens signifiants (alphanumériques)."""
    return {t for t in re.split(r'\s+', text.upper()) if t and t.isalnum()}


def _compute_match_score_precomputed(
    pat_clean: str,
    pat_tokens: Set[str],
    sig_pat: Set[str],
    cand_clean: str,
    cand_tokens: Set[str],
    sig_cand: Set[str]
) -> float:
    """Version optimisée avec tokens et chaînes nettoyées pré-calculées."""
    if not pat_clean or not cand_clean:
        return 0.0

    # Match parfait
    if pat_clean == cand_clean:
        return 1.0

    # Inclusion stricte
    if pat_clean in cand_clean or cand_clean in pat_clean:
        min_len = min(len(pat_clean), len(cand_clean))
        max_len = max(len(pat_clean), len(cand_clean))
        return 0.85 + 0.15 * (min_len / max_len)

    if not pat_tokens or not cand_tokens:
        return 0.0

    # Correspondances de tokens : exacts ou abréviations préfixes (>= 3 lettres)
    matched_pat = set()
    matched_cand = set()
    for pt in pat_tokens:
        for ct in cand_tokens:
            if pt == ct:
                matched_pat.add(pt)
                matched_cand.add(ct)
            elif len(pt) >= 3 and ct.startswith(pt):
                matched_pat.add(pt)
                matched_cand.add(ct)
            elif len(ct) >= 3 and pt.startswith(ct):
                matched_pat.add(pt)
                matched_cand.add(ct)

    ratio = difflib.SequenceMatcher(None, pat_clean, cand_clean).ratio()

    # Si tous les tokens du motif sont couverts (exactement ou par préfixe/abréviation)
    if matched_pat and len(matched_pat) == len(pat_tokens):
        jaccard = len(matched_pat) / max(len(pat_tokens.union(cand_tokens)), 1)
        return min(1.0, 0.75 + 0.15 * jaccard + 0.10 * ratio)

    # Tokens signifiants (hors stop-words génériques)
    common_sig = sig_pat.intersection(sig_cand)
    strong_matches = [t for t in common_sig if len(t) >= 4]

    # Filtre rapide : si aucun token en commun et longueurs très divergentes, le ratio ne peut atteindre 0.75
    intersection = pat_tokens.intersection(cand_tokens)
    if not intersection and not matched_pat and not strong_matches and abs(len(pat_clean) - len(cand_clean)) > 4:
        return 0.0

    if strong_matches:
        jaccard = len(common_sig) / max(len(sig_pat.union(sig_cand)), 1)
        coverage_pat = len(common_sig) / max(len(sig_pat), 1)
        coverage_cand = len(common_sig) / max(len(sig_cand), 1)
        mut_coverage = min(coverage_pat, coverage_cand)

        # Pour matcher, il faut que le mot commun représente une part significative des deux côtés
        if mut_coverage >= 0.33 or jaccard >= 0.25:
            return min(1.0, 0.70 + 0.20 * jaccard + 0.10 * ratio)

    if intersection:
        jaccard = len(intersection) / len(pat_tokens.union(cand_tokens))
        coverage = len(intersection) / len(pat_tokens)
        if coverage >= 0.5 and jaccard >= 0.30:
            return 0.72 + 0.28 * jaccard

    if ratio >= 0.75:
        return ratio

    return 0.0


def _compute_match_score(pattern: str, candidate: str) -> float:
    """
    Calcule un score de similarité robuste combinant token overlap marchand et distance Levenshtein/difflib.
    Retourne une valeur entre 0.0 et 1.0.
    """
    if not pattern or not candidate:
        return 0.0

    pat_clean = normalize_raw_label(pattern)
    cand_clean = normalize_raw_label(candidate)

    if not pat_clean or not cand_clean:
        return 0.0

    pat_tokens = _tokenize(pat_clean)
    cand_tokens = _tokenize(cand_clean)
    sig_pat = pat_tokens - _GENERIC_TOKENS
    sig_cand = cand_tokens - _GENERIC_TOKENS

    return _compute_match_score_precomputed(pat_clean, pat_tokens, sig_pat, cand_clean, cand_tokens, sig_cand)


def resolve_smart_label(
    db: Session,
    raw_label: str,
    use_ai_fallback: bool = False,
    auto_fallback_category: bool = False
) -> Dict[str, Any]:
    """
    Résout un libellé bancaire brut via le pipeline :
    1. Règle dans BankLabelMapping (manuelle sanctuarisée 100%, multi-catégories nom seul, ou auto confirmée/provisoire)
    2. Détection marchand caméléon natif (nom propre sans catégorie figée)
    3. Fuzzy match sur l'historique des transactions réelles avec détection d'ambiguïté (>= 75% confiance)
    4. Étage 3 (Optionnel) : Fallback IA local Ollama groupé par lot
    5. Sans correspondance (fallback brut)
    """
    if not raw_label or not str(raw_label).strip():
        return {
            "description": "",
            "category": None,
            "source": "none",
            "confidence": 0.0,
            "mapping_id": None,
            "is_manual": False,
            "is_multi_category": False
        }

    raw_str = str(raw_label).strip()
    pattern = normalize_raw_label(raw_str)

    # ---------------------------------------------------------
    # NIVEAU 1 : Base de règles (BankLabelMapping)
    # ---------------------------------------------------------
    # 1.1 Match exact sur raw_pattern
    exact_rule = db.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern == pattern).first()
    if exact_rule:
        if exact_rule.is_ignored:
            return {
                "description": raw_str,
                "category": None,
                "source": "ignored",
                "confidence": 0.0,
                "mapping_id": exact_rule.id,
                "is_manual": bool(exact_rule.is_manual),
                "is_multi_category": False
            }

        # Marchand multi-catégories configuré explicitement ou marchand caméléon sans catégorie manuelle
        if exact_rule.is_multi_category or (not exact_rule.is_manual and is_multi_category_merchant(pattern) and not exact_rule.category):
            return {
                "description": exact_rule.clean_description or pattern.title(),
                "category": None,
                "source": "multi_category",
                "confidence": 1.0,
                "mapping_id": exact_rule.id,
                "is_manual": bool(exact_rule.is_manual),
                "is_multi_category": True
            }

        # Règle manuelle sanctuarisée
        if exact_rule.is_manual:
            return {
                "description": exact_rule.clean_description or raw_str,
                "category": exact_rule.category,
                "source": "rule",
                "confidence": 1.0,
                "mapping_id": exact_rule.id,
                "is_manual": True,
                "is_multi_category": False
            }

        # Règle auto-apprise : apprentissage progressif (seuil N >= 2)
        match_count = exact_rule.match_count or 1
        is_provisional = match_count < 2
        confidence = 0.60 if is_provisional else 1.0
        return {
            "description": exact_rule.clean_description or raw_str,
            "category": exact_rule.category,
            "source": "rule",
            "confidence": confidence,
            "mapping_id": exact_rule.id,
            "is_manual": False,
            "is_provisional": is_provisional,
            "is_multi_category": False
        }

    # 1.2 Match partiel sur l'ensemble des règles
    all_rules = db.query(BankLabelMapping).all()
    best_rule = None
    best_rule_score = 0.0

    for rule in all_rules:
        score = _compute_match_score(pattern, rule.raw_pattern)
        if score > best_rule_score:
            best_rule_score = score
            best_rule = rule

    if best_rule and best_rule_score >= 0.75:
        if best_rule.is_ignored:
            return {
                "description": raw_str,
                "category": None,
                "source": "ignored",
                "confidence": 0.0,
                "mapping_id": best_rule.id,
                "is_manual": bool(best_rule.is_manual),
                "is_multi_category": False
            }

        if best_rule.is_multi_category or (not best_rule.is_manual and is_multi_category_merchant(pattern) and not best_rule.category):
            return {
                "description": best_rule.clean_description or pattern.title(),
                "category": None,
                "source": "multi_category",
                "confidence": round(best_rule_score, 2),
                "mapping_id": best_rule.id,
                "is_manual": bool(best_rule.is_manual),
                "is_multi_category": True
            }

        if best_rule.is_manual:
            return {
                "description": best_rule.clean_description or raw_str,
                "category": best_rule.category,
                "source": "rule",
                "confidence": round(best_rule_score, 2),
                "mapping_id": best_rule.id,
                "is_manual": True,
                "is_multi_category": False
            }

        match_count = best_rule.match_count or 1
        is_provisional = match_count < 2
        confidence = min(0.60, round(best_rule_score, 2)) if is_provisional else round(best_rule_score, 2)
        return {
            "description": best_rule.clean_description or raw_str,
            "category": best_rule.category,
            "source": "rule",
            "confidence": confidence,
            "mapping_id": best_rule.id,
            "is_manual": False,
            "is_provisional": is_provisional,
            "is_multi_category": False
        }

    # ---------------------------------------------------------
    # NIVEAU 1.5 : Marchand caméléon natif sans règle enregistrée
    # ---------------------------------------------------------
    if is_multi_category_merchant(pattern):
        return {
            "description": pattern.title(),
            "category": None,
            "source": "multi_category",
            "confidence": 1.0,
            "mapping_id": None,
            "is_manual": False,
            "is_multi_category": True
        }

    # ---------------------------------------------------------
    # NIVEAU 2 : Fuzzy Matching sur l'historique des transactions (dépenses variables / recettes uniquement)
    # ---------------------------------------------------------
    from app.models import Category
    cat_type_map = {c.name: c.type for c in db.query(Category).all() if c.name}

    # Récupérer les couples description + catégorie récents distincts
    subquery = db.query(
        Transaction.description,
        Transaction.category,
        func.max(Transaction.date_operation).label('max_date')
    ).filter(
        Transaction.description.isnot(None),
        Transaction.description != ''
    ).group_by(Transaction.description, Transaction.category).subquery()

    all_recent_txs = db.query(Transaction).join(
        subquery,
        (Transaction.description == subquery.c.description) &
        (Transaction.date_operation == subquery.c.max_date)
    ).order_by(Transaction.date_operation.desc()).all()

    # Ne conserver que les transactions variables ou revenus (jamais de dépenses fixes récurrentes pour du ponctuel)
    recent_txs = [
        tx for tx in all_recent_txs
        if not tx.category or cat_type_map.get(tx.category) not in ('expense_fixed', 'transfer')
    ]

    candidate_matches: List[Tuple[Transaction, float]] = []

    for tx in recent_txs:
        score = _compute_match_score(pattern, tx.description)
        if score >= 0.75:
            candidate_matches.append((tx, score))

    if candidate_matches:
        candidate_matches.sort(key=lambda x: x[1], reverse=True)
        best_tx, best_tx_score = candidate_matches[0]

        # Détection d'ambiguïté si multiples catégories distinctes sont associées à ce motif
        categories_with_matches = [tx.category for tx, _ in candidate_matches if tx.category]
        if len(set(categories_with_matches)) >= 2:
            cat_counts = Counter(categories_with_matches)
            top_cat_count = cat_counts.most_common(1)[0][1]
            total_cats = len(categories_with_matches)
            # S'il n'y a pas de catégorie dominante (>= 75% de consensus), considérer comme ambigu
            if (top_cat_count / total_cats) < 0.75:
                logger.info(f"[SmartLabel] Ambiguïté détectée pour '{pattern}' ({dict(cat_counts)}) -> Pas de prédiction forcée")
                return {
                    "description": raw_str,
                    "category": None,
                    "source": "ambiguous",
                    "confidence": 0.0,
                    "mapping_id": None,
                    "is_manual": False,
                    "is_multi_category": False
                }

        return {
            "description": best_tx.description,
            "category": best_tx.category,
            "source": "history",
            "confidence": min(1.0, round(best_tx_score, 2)),
            "mapping_id": None,
            "is_manual": False,
            "is_multi_category": False
        }

    # ---------------------------------------------------------
    # NIVEAU 3 : Aucun match mathématique -> Étage 3 IA ou fallback brut
    # ---------------------------------------------------------
    if use_ai_fallback or auto_fallback_category:
        batch_res = resolve_smart_labels_batch(
            db,
            [raw_str],
            use_ai_fallback=use_ai_fallback,
            auto_fallback_category=auto_fallback_category
        )
        if raw_str in batch_res:
            return batch_res[raw_str]

    return {
        "description": raw_str,
        "category": None,
        "source": "none",
        "confidence": 0.0,
        "mapping_id": None,
        "is_manual": False,
        "is_multi_category": False
    }


def resolve_smart_labels_batch(
    db: Session,
    raw_labels: List[str],
    use_ai_fallback: bool = False,
    include_user_habits: bool = True,
    tx_types: Optional[Dict[str, str]] = None,
    auto_fallback_category: bool = False
) -> Dict[str, Dict[str, Any]]:
    """
    Résolution groupée ultra-performante pour un lot de libellés bancaires.
    Pré-charge les règles et l'historique en mémoire pour un traitement O(N).
    Si use_ai_fallback=True et Ollama est actif, transmet les libellés inconnus en 1 seule requête groupée.
    Si auto_fallback_category=True, applique le filet de sécurité déterministe ('Dépenses diverses' / 'Revenus divers')
    pour toute opération restant sans catégorie.
    """
    if not raw_labels:
        return {}

    from app.models import Category
    cat_type_map = {c.name: c.type for c in db.query(Category).all() if c.name}

    # Pré-charger toutes les règles existantes
    all_rules = db.query(BankLabelMapping).all()
    rule_by_pattern = {r.raw_pattern: r for r in all_rules}

    # Pré-charger l'historique des descriptions et catégories distinctes
    subquery = db.query(
        Transaction.description,
        Transaction.category,
        func.max(Transaction.date_operation).label('max_date')
    ).filter(
        Transaction.description.isnot(None),
        Transaction.description != ''
    ).group_by(Transaction.description, Transaction.category).subquery()

    all_recent_txs = db.query(Transaction).join(
        subquery,
        (Transaction.description == subquery.c.description) &
        (Transaction.date_operation == subquery.c.max_date)
    ).order_by(Transaction.date_operation.desc()).all()

    # Filtrer pour n'inclure que les transactions variables / recettes
    recent_txs = [
        tx for tx in all_recent_txs
        if not tx.category or cat_type_map.get(tx.category) not in ('expense_fixed', 'transfer')
    ]

    # Pré-calculer les tokens et chaînes nettoyées des règles (une seule fois pour tout le lot)
    rule_data = []
    for r in all_rules:
        r_clean = normalize_raw_label(r.raw_pattern)
        r_tokens = _tokenize(r_clean)
        r_sig = r_tokens - _GENERIC_TOKENS
        rule_data.append((r, r_clean, r_tokens, r_sig))

    # Pré-calculer les tokens et chaînes nettoyées des transactions candidates (une seule fois pour tout le lot)
    cand_data = []
    for tx in recent_txs:
        c_clean = normalize_raw_label(tx.description)
        c_tokens = _tokenize(c_clean)
        c_sig = c_tokens - _GENERIC_TOKENS
        cand_data.append((tx, c_clean, c_tokens, c_sig))

    results: Dict[str, Dict[str, Any]] = {}

    for raw in raw_labels:
        if not raw or not str(raw).strip():
            continue
        raw_str = str(raw).strip()
        pattern = normalize_raw_label(raw_str)
        p_tokens = _tokenize(pattern)
        p_sig = p_tokens - _GENERIC_TOKENS

        # 1. Match exact règle
        if pattern in rule_by_pattern:
            r = rule_by_pattern[pattern]
            if r.is_ignored:
                results[raw_str] = {
                    "description": raw_str,
                    "category": None,
                    "source": "ignored",
                    "confidence": 0.0,
                    "mapping_id": r.id,
                    "is_manual": bool(r.is_manual),
                    "is_multi_category": False
                }
            elif r.is_multi_category or (not r.is_manual and is_multi_category_merchant(pattern) and not r.category):
                results[raw_str] = {
                    "description": r.clean_description or pattern.title(),
                    "category": None,
                    "source": "multi_category",
                    "confidence": 1.0,
                    "mapping_id": r.id,
                    "is_manual": bool(r.is_manual),
                    "is_multi_category": True
                }
            elif r.is_manual:
                results[raw_str] = {
                    "description": r.clean_description or raw_str,
                    "category": r.category,
                    "source": "rule",
                    "confidence": 1.0,
                    "mapping_id": r.id,
                    "is_manual": True,
                    "is_multi_category": False
                }
            else:
                match_count = r.match_count or 1
                is_provisional = match_count < 2
                confidence = 0.60 if is_provisional else 1.0
                results[raw_str] = {
                    "description": r.clean_description or raw_str,
                    "category": r.category,
                    "source": "rule",
                    "confidence": confidence,
                    "mapping_id": r.id,
                    "is_manual": False,
                    "is_provisional": is_provisional,
                    "is_multi_category": False
                }
            continue

        # 2. Match partiel règles
        best_rule = None
        best_rule_score = 0.0
        for r, r_clean, r_tokens, r_sig in rule_data:
            score = _compute_match_score_precomputed(pattern, p_tokens, p_sig, r_clean, r_tokens, r_sig)
            if score > best_rule_score:
                best_rule_score = score
                best_rule = r

        if best_rule and best_rule_score >= 0.75:
            if best_rule.is_ignored:
                results[raw_str] = {
                    "description": raw_str,
                    "category": None,
                    "source": "ignored",
                    "confidence": 0.0,
                    "mapping_id": best_rule.id,
                    "is_manual": bool(best_rule.is_manual),
                    "is_multi_category": False
                }
            elif best_rule.is_multi_category or (not best_rule.is_manual and is_multi_category_merchant(pattern) and not best_rule.category):
                results[raw_str] = {
                    "description": best_rule.clean_description or pattern.title(),
                    "category": None,
                    "source": "multi_category",
                    "confidence": round(best_rule_score, 2),
                    "mapping_id": best_rule.id,
                    "is_manual": bool(best_rule.is_manual),
                    "is_multi_category": True
                }
            elif best_rule.is_manual:
                results[raw_str] = {
                    "description": best_rule.clean_description or raw_str,
                    "category": best_rule.category,
                    "source": "rule",
                    "confidence": round(best_rule_score, 2),
                    "mapping_id": best_rule.id,
                    "is_manual": True,
                    "is_multi_category": False
                }
            else:
                match_count = best_rule.match_count or 1
                is_provisional = match_count < 2
                confidence = min(0.60, round(best_rule_score, 2)) if is_provisional else round(best_rule_score, 2)
                results[raw_str] = {
                    "description": best_rule.clean_description or raw_str,
                    "category": best_rule.category,
                    "source": "rule",
                    "confidence": confidence,
                    "mapping_id": best_rule.id,
                    "is_manual": False,
                    "is_provisional": is_provisional,
                    "is_multi_category": False
                }
            continue

        # 2.5 Marchand caméléon natif sans règle
        if is_multi_category_merchant(pattern):
            results[raw_str] = {
                "description": pattern.title(),
                "category": None,
                "source": "multi_category",
                "confidence": 1.0,
                "mapping_id": None,
                "is_manual": False,
                "is_multi_category": True
            }
            continue

        # 3. Match historique (uniquement variables / recettes)
        candidate_matches = []
        for tx, c_clean, c_tokens, c_sig in cand_data:
            score = _compute_match_score_precomputed(pattern, p_tokens, p_sig, c_clean, c_tokens, c_sig)
            if score >= 0.75:
                candidate_matches.append((tx, score))

        if candidate_matches:
            candidate_matches.sort(key=lambda x: x[1], reverse=True)
            best_tx, best_score = candidate_matches[0]

            # Détection d'ambiguïté
            categories_with_matches = [tx.category for tx, _ in candidate_matches if tx.category]
            if len(set(categories_with_matches)) >= 2:
                cat_counts = Counter(categories_with_matches)
                top_cat_count = cat_counts.most_common(1)[0][1]
                total_cats = len(categories_with_matches)
                if (top_cat_count / total_cats) < 0.75:
                    results[raw_str] = {
                        "description": raw_str,
                        "category": None,
                        "source": "ambiguous",
                        "confidence": 0.0,
                        "mapping_id": None
                    }
                    continue

            results[raw_str] = {
                "description": best_tx.description,
                "category": best_tx.category,
                "source": "history",
                "confidence": min(1.0, round(best_score, 2)),
                "mapping_id": None
            }
            continue

        # 4. Aucun match
        results[raw_str] = {
            "description": raw_str,
            "category": None,
            "source": "none",
            "confidence": 0.0,
            "mapping_id": None
        }

    # ---------------------------------------------------------
    # ÉTAGE 3 : Fallback IA local Ollama Groupé par Lot (Batch Prompting)
    # ---------------------------------------------------------
    if use_ai_fallback:
        unresolved_by_clean: Dict[str, List[str]] = {}
        for raw, res in results.items():
            if (
                res.get("category") is None
                and res.get("source") in ("none", "ambiguous", "multi_category")
                and not res.get("is_manual")
                and res.get("source") != "ignored"
            ):
                clean_desc = normalize_raw_label(raw).title()
                if not clean_desc or len(clean_desc) < 2:
                    clean_desc = raw.strip()
                unresolved_by_clean.setdefault(clean_desc, []).append(raw)

        if unresolved_by_clean:
            try:
                from app.services.chat.ollama_client import get_ollama_config, call_ollama_batch
                cfg = get_ollama_config(db)
                if cfg and cfg.get("enabled"):
                    from app.models import Category
                    active_cats = [
                        c.name for c in db.query(Category.name).filter(
                            (Category.is_closed == False) | (Category.is_closed == None)
                        ).all()
                        if c and c.name
                    ]
                    if active_cats:
                        user_habits = get_user_habit_descriptions(db, limit=35) if include_user_habits else None
                        clean_descs = list(unresolved_by_clean.keys())
                        ai_results = call_ollama_batch(
                            descriptions=clean_descs,
                            categories=active_cats,
                            cfg=cfg,
                            user_habits=user_habits,
                            suggest_names=True
                        )
                        for clean_d, ai_data in ai_results.items():
                            candidate_cat = None
                            candidate_name = None
                            cat_is_new = False
                            if isinstance(ai_data, dict):
                                candidate_cat = ai_data.get("category")
                                candidate_name = ai_data.get("name")
                                cat_is_new = bool(ai_data.get("category_is_new", False))
                            elif ai_data:
                                candidate_cat = ai_data

                            for raw in unresolved_by_clean.get(clean_d, []):
                                # 1. Évaluation du nom proposé par l'IA via le garde-fou anti-déchets
                                if candidate_name:
                                    validated_name = validate_ai_suggested_name(
                                        candidate_name,
                                        raw_label=raw,
                                        clean_label=clean_d,
                                        user_habits=user_habits
                                    )
                                    if validated_name:
                                        results[raw]["description"] = validated_name
                                    elif results[raw]["description"] == raw:
                                        results[raw]["description"] = clean_d
                                elif results[raw]["description"] == raw:
                                    results[raw]["description"] = clean_d

                                # 2. Affectation de la catégorie validée
                                if candidate_cat:
                                    results[raw]["category"] = candidate_cat
                                    results[raw]["source"] = "ai"
                                    results[raw]["confidence"] = 0.85
                                    if cat_is_new:
                                        results[raw]["smart_is_new_category"] = True
            except Exception as e:
                logger.warning(f"[SmartLabel] Échec silencieux du fallback IA par lot : {e}")

    # ---------------------------------------------------------
    # ÉTAGE 4 : Filet de sécurité déterministe (Catégories Fourre-tout)
    # ---------------------------------------------------------
    if auto_fallback_category:
        for raw, res in results.items():
            if res.get("source") == "ignored":
                continue
            # Respect strict des règles manuelles où l'utilisateur a explicitement désactivé la catégorie
            if res.get("is_manual") and res.get("is_multi_category") and res.get("category") is None:
                continue
            if res.get("category") is None:
                inferred_type = "expense_var"
                if tx_types and raw in tx_types:
                    inferred_type = tx_types[raw]
                elif is_probable_income_label(raw):
                    inferred_type = "income"

                fallback_cat = resolve_fallback_category(db, inferred_type)
                res["category"] = fallback_cat
                res["smart_is_fallback"] = True
                res["smart_suggested"] = True
                if res.get("source") == "none":
                    res["source"] = "fallback"
                    res["confidence"] = 0.85
                    res["description"] = normalize_raw_label(raw).title()
                elif res.get("source") in ("multi_category", "ambiguous"):
                    res["confidence"] = 0.85

    for res in results.values():
        res.setdefault("smart_is_fallback", False)
        res.setdefault("smart_is_new_category", False)

    return results


def learn_label_mapping(
    db: Session,
    raw_label: str,
    clean_description: Optional[str] = None,
    category: Optional[str] = None,
    is_ignored: bool = False,
    is_manual: bool = True,
    is_multi_category: bool = False
) -> Optional[BankLabelMapping]:
    """
    Mémorise ou met à jour une correspondance dans la base de connaissances.
    Paramètres :
      - is_manual : True si l'action émane d'une saisie/édition explicite utilisateur (sanctuarisée).
                    False si issue de l'ingestion automatique (CSV ou synchro bancaire).
      - is_multi_category : True pour activer le mode Marchand Caméléon (nom propre sans catégorie figée).
    """
    if not raw_label:
        return None

    raw_str = str(raw_label).strip()
    clean_str = str(clean_description).strip() if clean_description else None

    # Si ce n'est pas une règle d'exclusion, une description propre est obligatoire
    if not is_ignored and not clean_str:
        return None

    pattern = normalize_raw_label(raw_str)
    if not pattern or len(pattern) < 2:
        pattern = raw_str.upper()

    now = datetime.now(timezone.utc)

    # Détection automatique de marchand caméléon natif si auto-appris
    if not is_manual and is_multi_category_merchant(pattern):
        is_multi_category = True
        category = None

    # Protection anti-pollution : ne pas apprendre de règle automatique avec une catégorie fourre-tout
    if not is_manual and is_fallback_category(category):
        category = None

    # Chercher si une règle existe déjà pour ce motif
    existing = db.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern == pattern).first()
    if existing:
        # 1. Règle d'exclusion manuelle protégée contre l'écrasement auto
        if existing.is_ignored and not is_ignored:
            logger.info(f"[SmartLabel] Règle d'exclusion protégée pour '{pattern}'")
            return existing

        # 2. Règle manuelle sanctuarisée protégée contre l'écrasement auto
        if existing.is_manual and not is_manual:
            existing.match_count = (existing.match_count or 0) + 1
            existing.last_used_at = now
            if category:
                try:
                    counts = json.loads(existing.category_counts) if existing.category_counts else {}
                except Exception:
                    counts = {}
                counts[category] = counts.get(category, 0) + 1
                existing.category_counts = json.dumps(counts)
            db.commit()
            logger.info(f"[SmartLabel] Règle manuelle sanctuarisée préservée pour '{pattern}'")
            return existing

        # Mise à jour de category_counts
        counts = {}
        if existing.category_counts:
            try:
                counts = json.loads(existing.category_counts)
            except Exception:
                counts = {}
        if category:
            counts[category] = counts.get(category, 0) + 1
        existing.category_counts = json.dumps(counts) if counts else None

        existing.is_ignored = is_ignored
        if is_manual:
            existing.is_manual = True
            existing.is_multi_category = is_multi_category
            existing.clean_description = clean_str
            existing.category = None if is_multi_category else category
        else:
            # Auto-apprentissage
            if is_multi_category:
                existing.is_multi_category = True
                existing.category = None
            elif len(counts) >= 2:
                # Détection de dispersion : si aucune catégorie dominante à >= 60%
                top_cat, top_count = max(counts.items(), key=lambda x: x[1])
                total_votes = sum(counts.values())
                if (top_count / total_votes) < 0.60:
                    existing.is_multi_category = True
                    existing.category = None
                    logger.info(f"[SmartLabel] Dispersion de catégories détectée pour '{pattern}' ({counts}) -> Bascule en multi-catégories")
                else:
                    existing.category = top_cat
            elif category:
                existing.category = category

            if clean_str:
                existing.clean_description = clean_str

        existing.match_count = (existing.match_count or 0) + 1
        existing.last_used_at = now
        db.commit()
        db.refresh(existing)
        status_txt = "Ignorée" if is_ignored else ("Multi-catégories" if existing.is_multi_category else f"'{existing.clean_description}' (Catégorie: {existing.category})")
        logger.info(f"[SmartLabel] Règle mise à jour : '{pattern}' -> {status_txt}")
        return existing
    else:
        # Protection anti-pollution : ne pas créer de règle automatique orpheline si pas de catégorie et pas caméléon et pas exclusion
        if not is_manual and not is_ignored and not is_multi_category and not category:
            logger.info(f"[SmartLabel] Opération sans catégorie ni marchand caméléon ignorée pour l'auto-apprentissage : '{pattern}'")
            return None

        # Création d'une nouvelle règle
        counts = {}
        if category:
            counts[category] = 1


        effective_cat = None if is_multi_category else category
        new_mapping = BankLabelMapping(
            raw_pattern=pattern,
            clean_description=clean_str if not is_ignored else None,
            category=effective_cat if not is_ignored else None,
            is_ignored=is_ignored,
            is_manual=is_manual,
            is_multi_category=is_multi_category,
            category_counts=json.dumps(counts) if counts else None,
            match_count=1,
            created_at=now,
            last_used_at=now
        )
        db.add(new_mapping)
        db.commit()
        db.refresh(new_mapping)
        status_txt = "Ignorée" if is_ignored else ("Multi-catégories" if is_multi_category else f"'{clean_str}' (Catégorie: {effective_cat})")
        logger.info(f"[SmartLabel] Nouvelle règle apprise : '{pattern}' -> {status_txt}")
        return new_mapping

