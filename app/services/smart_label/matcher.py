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
        if is_token_subset and min_len >= 4 and len_ratio >= 0.35:
            common = pat_tokens.intersection(cand_tokens)
            if sig_pat.intersection(sig_cand) or not _GENERIC_TOKENS.issuperset(common):
                return min(1.0, 0.80 + 0.20 * len_ratio)

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
