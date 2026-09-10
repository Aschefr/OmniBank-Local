"""
OmniBank-Local — Smart Label : Pipeline de résolution unitaire et par lot.
Orchestre les 4 étages de résolution :
1. Base de règles déterministes (BankLabelMapping)
2. Historique des transactions réelles (Fuzzy matching avec détection d'ambiguïté)
3. Fallback IA locale Ollama groupé par lot (Batch Prompting)
4. Filet de sécurité déterministe (Catégories fourre-tout)
"""

import logging
from collections import Counter
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import BankLabelMapping, Category, Transaction
from .ai_guard import validate_ai_suggested_name
from .categories import resolve_fallback_category
from .learning import get_user_habit_descriptions
from .matcher import _compute_match_score, _compute_match_score_precomputed
from .normalization import (
    _GENERIC_TOKENS,
    _tokenize,
    is_multi_category_merchant,
    is_probable_income_label,
    normalize_raw_label,
)

logger = logging.getLogger(__name__)


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
                from app.services.chat.ollama_client import call_ollama_batch, get_ollama_config
                cfg = get_ollama_config(db)
                if cfg and cfg.get("enabled"):
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
