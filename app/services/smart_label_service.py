"""
OmniBank-Local — Smart Label Engine (Moteur de correspondance et d'auto-apprentissage).
Gère la normalisation des libellés bancaires bruts, la résolution intelligente par règles/fuzzy-match,
et l'apprentissage automatique des correspondances lors des validations utilisateur.
"""

import difflib
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import BankLabelMapping, Transaction

logger = logging.getLogger(__name__)

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



def _tokenize(text: str) -> Set[str]:
    """Extrait les tokens signifiants (>= 2 caractères)."""
    return {t for t in re.split(r'\s+', text.upper()) if len(t) >= 2}


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

    # Match parfait
    if pat_clean == cand_clean:
        return 1.0

    # Inclusion stricte
    if pat_clean in cand_clean or cand_clean in pat_clean:
        min_len = min(len(pat_clean), len(cand_clean))
        max_len = max(len(pat_clean), len(cand_clean))
        return 0.85 + 0.15 * (min_len / max_len)

    # Token overlap
    pat_tokens = _tokenize(pat_clean)
    cand_tokens = _tokenize(cand_clean)

    if not pat_tokens or not cand_tokens:
        return 0.0

    # Tokens signifiants (hors stop-words génériques)
    sig_pat = pat_tokens - _GENERIC_TOKENS
    sig_cand = cand_tokens - _GENERIC_TOKENS

    common_sig = sig_pat.intersection(sig_cand)
    strong_matches = [t for t in common_sig if len(t) >= 4]

    ratio = difflib.SequenceMatcher(None, pat_clean, cand_clean).ratio()

    if strong_matches:
        jaccard = len(common_sig) / max(len(sig_pat.union(sig_cand)), 1)
        coverage_pat = len(common_sig) / max(len(sig_pat), 1)
        coverage_cand = len(common_sig) / max(len(sig_cand), 1)
        mut_coverage = min(coverage_pat, coverage_cand)

        # Pour matcher, il faut que le mot commun représente une part significative des deux côtés
        if mut_coverage >= 0.33 or jaccard >= 0.25:
            return min(1.0, 0.70 + 0.20 * jaccard + 0.10 * ratio)

    intersection = pat_tokens.intersection(cand_tokens)
    if intersection:
        jaccard = len(intersection) / len(pat_tokens.union(cand_tokens))
        coverage = len(intersection) / len(pat_tokens)
        if coverage >= 0.5 and jaccard >= 0.30:
            return 0.72 + 0.28 * jaccard

    if ratio >= 0.75:
        return ratio

    return 0.0


def resolve_smart_label(db: Session, raw_label: str) -> Dict[str, Any]:
    """
    Résout un libellé bancaire brut via le pipeline à 3 niveaux :
    1. Règle apprise dans BankLabelMapping (100% certitude, ou ignorée)
    2. Fuzzy match sur l'historique des transactions réelles avec détection d'ambiguïté (>= 75% confiance)
    3. Sans correspondance (fallback brut)
    """
    if not raw_label or not str(raw_label).strip():
        return {
            "description": "",
            "category": None,
            "source": "none",
            "confidence": 0.0,
            "mapping_id": None
        }

    raw_str = str(raw_label).strip()
    pattern = normalize_raw_label(raw_str)

    # ---------------------------------------------------------
    # NIVEAU 1 : Base de règles apprises (BankLabelMapping)
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
                "mapping_id": exact_rule.id
            }
        return {
            "description": exact_rule.clean_description or raw_str,
            "category": exact_rule.category,
            "source": "rule",
            "confidence": 1.0,
            "mapping_id": exact_rule.id
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
                "mapping_id": best_rule.id
            }
        return {
            "description": best_rule.clean_description or raw_str,
            "category": best_rule.category,
            "source": "rule",
            "confidence": round(best_rule_score, 2),
            "mapping_id": best_rule.id
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
                    "mapping_id": None
                }

        return {
            "description": best_tx.description,
            "category": best_tx.category,
            "source": "history",
            "confidence": min(1.0, round(best_tx_score, 2)),
            "mapping_id": None
        }

    # ---------------------------------------------------------
    # NIVEAU 3 : Aucun match mathématique
    # ---------------------------------------------------------
    return {
        "description": raw_str,
        "category": None,
        "source": "none",
        "confidence": 0.0,
        "mapping_id": None
    }


def resolve_smart_labels_batch(db: Session, raw_labels: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Résolution groupée ultra-performante pour un lot de libellés bancaires.
    Pré-charge les règles et l'historique en mémoire pour un traitement O(N).
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

    results: Dict[str, Dict[str, Any]] = {}

    for raw in raw_labels:
        if not raw or not str(raw).strip():
            continue
        raw_str = str(raw).strip()
        pattern = normalize_raw_label(raw_str)

        # 1. Match exact règle
        if pattern in rule_by_pattern:
            r = rule_by_pattern[pattern]
            if r.is_ignored:
                results[raw_str] = {
                    "description": raw_str,
                    "category": None,
                    "source": "ignored",
                    "confidence": 0.0,
                    "mapping_id": r.id
                }
            else:
                results[raw_str] = {
                    "description": r.clean_description or raw_str,
                    "category": r.category,
                    "source": "rule",
                    "confidence": 1.0,
                    "mapping_id": r.id
                }
            continue

        # 2. Match partiel règles
        best_rule = None
        best_rule_score = 0.0
        for r in all_rules:
            score = _compute_match_score(pattern, r.raw_pattern)
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
                    "mapping_id": best_rule.id
                }
            else:
                results[raw_str] = {
                    "description": best_rule.clean_description or raw_str,
                    "category": best_rule.category,
                    "source": "rule",
                    "confidence": round(best_rule_score, 2),
                    "mapping_id": best_rule.id
                }
            continue

        # 3. Match historique (uniquement variables / recettes)
        candidate_matches = []
        for tx in recent_txs:
            score = _compute_match_score(pattern, tx.description)
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

    return results


def learn_label_mapping(
    db: Session,
    raw_label: str,
    clean_description: Optional[str] = None,
    category: Optional[str] = None,
    is_ignored: bool = False
) -> Optional[BankLabelMapping]:
    """
    Mémorise ou met à jour une correspondance dans la base de connaissances.
    Appelé automatiquement lors de la validation ou correction d'une opération par l'utilisateur.
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

    # Chercher si une règle existe déjà pour ce motif
    existing = db.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern == pattern).first()
    if existing:
        # Si la règle existante a été explicitement marquée comme "ignorée",
        # et que l'appel provient d'un auto-apprentissage automatique sans flag is_ignored explicite,
        # on protège le choix manuel de l'utilisateur en ne l'écrasant pas.
        if existing.is_ignored and not is_ignored:
            logger.info(f"[SmartLabel] Règle d'exclusion protégée pour '{pattern}' (non écrasée par l'apprentissage auto)")
            return existing

        existing.is_ignored = is_ignored
        if is_ignored:
            existing.clean_description = clean_str
            existing.category = category
        else:
            existing.clean_description = clean_str
            if category:
                existing.category = category

        existing.match_count = (existing.match_count or 0) + 1
        existing.last_used_at = now
        db.commit()
        db.refresh(existing)
        status_txt = "Ignorée" if is_ignored else f"'{clean_str}' (Catégorie: {category})"
        logger.info(f"[SmartLabel] Règle mise à jour : '{pattern}' -> {status_txt}")
        return existing
    else:
        # Création d'une nouvelle règle
        new_mapping = BankLabelMapping(
            raw_pattern=pattern,
            clean_description=clean_str,
            category=category,
            is_ignored=is_ignored,
            match_count=1,
            created_at=now,
            last_used_at=now
        )
        db.add(new_mapping)
        db.commit()
        db.refresh(new_mapping)
        status_txt = "Ignorée" if is_ignored else f"'{clean_str}' (Catégorie: {category})"
        logger.info(f"[SmartLabel] Nouvelle règle apprise : '{pattern}' -> {status_txt}")
        return new_mapping

