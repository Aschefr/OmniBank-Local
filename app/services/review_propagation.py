"""Une correction de l'utilisateur ajuste les suggestions des opérations encore à vérifier.

Après avoir corrigé une opération (règle mémorisée), les autres opérations à vérifier gardaient leur ancienne
suggestion : corriger « AMAZON EU SARL » en « Amazon » laissait « AMAZON PAYMENTS EUROPE » en Shopping. On les
réévalue avec la règle apprise, sans IA, mais on ne suit que ce qui mène à la catégorie que l'utilisateur vient de
choisir : réévaluer le reste déplacerait aussi des opérations qu'il n'a pas touchées (deux « Super U » de rayons
différents). Les opérations ajustées restent à vérifier : c'est une meilleure suggestion, pas une validation.
"""
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Transaction
from app.services.history_service import record_action, snapshot_entity
from app.services.smart_label.normalization import is_multi_category_merchant, normalize_raw_label

logger = logging.getLogger(__name__)

# Sources du résolveur qui viennent de ce que l'utilisateur a appris ou créé (règle, nom de catégorie, historique)
_LEARNED_SOURCES = ("rule", "category_match", "history")
_SAME_LABEL_CONFIDENCE = 95.0


def _flow(tx: Transaction) -> str:
    return "income" if tx.type == "income" else ("transfer" if tx.type == "transfer" else "expense")


def _category_names_merchant(category: Optional[str], label_key: str) -> bool:
    """« Amazon » pour « AMAZON PAYMENTS EUROPE » : la catégorie porte le nom de l'enseigne du libellé."""
    from app.services.smart_label.categories import _clean_token_str
    words = set(_clean_token_str(category or "").split())
    first = _clean_token_str(label_key).split()[:1]
    return bool(first) and first[0] in words


def propagate_correction(db: Session, source: Transaction) -> int:
    """Ajuste les opérations à vérifier d'après la correction de `source`. Renvoie le nombre d'opérations ajustées."""
    if not source or not source.category:
        return 0
    pending = db.query(Transaction).filter(Transaction.needs_review == True, Transaction.id != source.id).all()  # noqa: E712
    pending = [t for t in pending if t.raw_description and _flow(t) == _flow(source)]
    if not pending:
        return 0

    from app.services.smart_label.resolver import resolve_smart_labels_batch

    source_key = normalize_raw_label(source.raw_description or "")
    # PayPal, Amazon… : chaque achat a sa propre catégorie, sauf si l'utilisateur a choisi une catégorie au nom de
    # l'enseigne elle-même (« Amazon ») : elle vaut alors pour toutes ses opérations
    merchant_wide = _category_names_merchant(source.category, source_key)
    if is_multi_category_merchant(source_key) and not merchant_wide:
        return 0
    labels = sorted({t.raw_description for t in pending})
    types = {t.raw_description: ("income" if t.type == "income" else "expense_var") for t in pending}
    results = resolve_smart_labels_batch(db, labels, use_ai_fallback=False, auto_fallback_category=False, tx_types=types)

    adjusted = 0
    for tx in pending:
        same_label = bool(source_key) and normalize_raw_label(tx.raw_description) == source_key
        res = results.get(tx.raw_description) or {}
        follows = res.get("category") == source.category and res.get("source") in _LEARNED_SOURCES
        if not (same_label or follows):
            continue
        new_description: Optional[str] = source.description if same_label else tx.description
        if tx.category == source.category and tx.description == new_description:
            continue
        before = snapshot_entity(tx)
        tx.category = source.category
        tx.description = new_description
        conf = _SAME_LABEL_CONFIDENCE if same_label else round(float(res.get("confidence") or 0) * 100, 1)
        tx.confidence_score = max(float(tx.confidence_score or 0), conf)
        record_action(db, "transaction", tx.id, "UPDATE", before, snapshot_entity(tx),
                      user_name="Auto-Pilote (Suggestion ajustée)")
        adjusted += 1
    if adjusted:
        logger.info(f"[AutoPilot] Correction de '{source.description}' : {adjusted} opération(s) à vérifier ajustée(s)")
    return adjusted
