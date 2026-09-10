"""
OmniBank-Local — Smart Label Engine (Sous-package modulaire).
Gère la normalisation des libellés bancaires, le matching textuel et scoring,
l'auto-apprentissage, les garde-fous IA et la résolution par lot en cascade.
"""

from .normalization import (
    _BANK_NOISE_REGEX,
    _DATE_REGEX,
    _GATEWAY_PREFIX_REGEX,
    _GENERIC_TOKENS,
    _INCOME_LABEL_REGEX,
    _MULTI_CATEGORY_MERCHANTS,
    _NUMBER_NOISE_REGEX,
    _PUNCT_REGEX,
    _tokenize,
    is_multi_category_merchant,
    is_probable_income_label,
    normalize_raw_label,
)

from .matcher import (
    _compute_match_score,
    _compute_match_score_precomputed,
)

from .categories import (
    DEFAULT_FALLBACK_EXPENSE_CATEGORY,
    DEFAULT_FALLBACK_INCOME_CATEGORY,
    _FALLBACK_EXPENSE_SYNONYMS,
    _FALLBACK_INCOME_SYNONYMS,
    ensure_category_exists,
    is_fallback_category,
    resolve_fallback_category,
)

from .ai_guard import (
    _BANNED_AI_NAME_TOKENS,
    validate_ai_suggested_name,
)

from .learning import (
    get_user_habit_descriptions,
    learn_label_mapping,
)

from .resolver import (
    resolve_smart_label,
    resolve_smart_labels_batch,
)

__all__ = [
    # Normalisation
    "normalize_raw_label",
    "is_multi_category_merchant",
    "is_probable_income_label",
    "_tokenize",
    "_MULTI_CATEGORY_MERCHANTS",
    "_BANK_NOISE_REGEX",
    "_DATE_REGEX",
    "_NUMBER_NOISE_REGEX",
    "_GATEWAY_PREFIX_REGEX",
    "_PUNCT_REGEX",
    "_GENERIC_TOKENS",
    "_INCOME_LABEL_REGEX",

    # Matcher
    "_compute_match_score",
    "_compute_match_score_precomputed",

    # Catégories
    "DEFAULT_FALLBACK_EXPENSE_CATEGORY",
    "DEFAULT_FALLBACK_INCOME_CATEGORY",
    "_FALLBACK_EXPENSE_SYNONYMS",
    "_FALLBACK_INCOME_SYNONYMS",
    "is_fallback_category",
    "resolve_fallback_category",
    "ensure_category_exists",

    # IA Guard
    "_BANNED_AI_NAME_TOKENS",
    "validate_ai_suggested_name",

    # Apprentissage
    "get_user_habit_descriptions",
    "learn_label_mapping",

    # Résolution
    "resolve_smart_label",
    "resolve_smart_labels_batch",
]
