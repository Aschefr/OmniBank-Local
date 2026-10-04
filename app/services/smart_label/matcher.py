"""
OmniBank-Local — Smart Label : Algorithmes de matching textuel et scoring.
Combine token overlap marchand, détection de préfixes et distance Levenshtein/difflib.
"""

import difflib
from typing import Set

from .normalization import (
    _GENERIC_TOKENS,
    _tokenize,
    normalize_raw_label,
)


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

    # Inclusion stricte au niveau mot / token (mots entiers, pas de sous-chaîne arbitraire interne)
    # Ex: "NETFLIX" dans "NETFLIX COM", "CARREFOUR" dans "CARREFOUR MARKET"
    # Ne doit JAMAIS matcher un sous-acronyme bruité (ex: "CA" dans "VILACA" ou "OR" dans "DECATHLON")
    min_len = min(len(pat_clean), len(cand_clean))
    max_len = max(len(pat_clean), len(cand_clean))
    len_ratio = min_len / max_len

    if pat_tokens and cand_tokens:
        is_token_subset = pat_tokens.issubset(cand_tokens) or cand_tokens.issubset(pat_tokens)
        if is_token_subset and min_len >= 4:
            # Match de préfixe ou sous-ensemble de tokens :
            # Si le candidat correspond au préfixe du motif (ex: 'HEXCEL' dans 'HEXCEL REINFORCEMENTS HEXCEL REI')
            # ou si le ratio de longueur est suffisant
            is_prefix = (
                pat_clean.startswith(cand_clean + ' ')
                or cand_clean.startswith(pat_clean + ' ')
                or len_ratio >= 0.35
            )
            if is_prefix:
                common = pat_tokens.intersection(cand_tokens)
                if sig_pat.intersection(sig_cand) or not _GENERIC_TOKENS.issuperset(common):
                    base_score = 0.88 if (pat_clean.startswith(cand_clean + ' ') or cand_clean.startswith(pat_clean + ' ')) else 0.80
                    return min(1.0, base_score + (1.0 - base_score) * len_ratio)

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

    # Garde-fou d'identité marchande :
    # Si le ratio difflib est modéré (< 0.75) et que les tokens marchands de tête ne correspondent pas mutuellement,
    # c'est un faux positif de suffixe géographique (ex: deux commerces distincts dans la même ville "LA TOUR DU PIN")
    pat_sig_ordered = [t for t in pat_clean.split() if t in sig_pat]
    cand_sig_ordered = [t for t in cand_clean.split() if t in sig_cand]
    pat_prefix_in_cand = any(t in sig_cand for t in pat_sig_ordered[:2]) if pat_sig_ordered else False
    cand_prefix_in_pat = any(t in sig_pat for t in cand_sig_ordered[:2]) if cand_sig_ordered else False
    has_merchant_overlap = (pat_prefix_in_cand and cand_prefix_in_pat) or (
        len(strong_matches) >= 2 and sum(len(t) for t in strong_matches) >= 8
    )

    if not has_merchant_overlap and ratio < 0.75:
        return 0.0

    if strong_matches:
        jaccard = len(common_sig) / max(len(sig_pat.union(sig_cand)), 1)
        coverage_pat = len(common_sig) / max(len(sig_pat), 1)
        coverage_cand = len(common_sig) / max(len(sig_cand), 1)
        mut_coverage = min(coverage_pat, coverage_cand)

        # Pour matcher, il faut au moins 2 mots forts en commun (ex: 'CREDIT AGRICOLE', 'BANQUE POPULAIRE')
        # OU que le mot commun représente au moins 40% des tokens significatifs des deux côtés
        if (len(strong_matches) >= 2 and sum(len(t) for t in strong_matches) >= 8) or (mut_coverage >= 0.40 and jaccard >= 0.25):
            return min(1.0, 0.70 + 0.20 * jaccard + 0.10 * ratio)

    if intersection and not _GENERIC_TOKENS.issuperset(intersection):
        jaccard = len(intersection) / len(pat_tokens.union(cand_tokens))
        coverage_pat = len(intersection) / len(pat_tokens)
        coverage_cand = len(intersection) / len(cand_tokens)
        if coverage_pat >= 0.50 and coverage_cand >= 0.50 and jaccard >= 0.30:
            return min(1.0, 0.72 + 0.28 * jaccard)

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
