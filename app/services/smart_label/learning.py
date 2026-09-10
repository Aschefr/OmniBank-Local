"""
OmniBank-Local — Smart Label : Moteur d'auto-apprentissage et gestion des habitudes.
Mémorise les choix utilisateur et déduit progressivement des règles avec détection de dispersion.
"""

import json
import logging
from datetime import datetime, timezone
from typing import List, Optional, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import BankLabelMapping, Transaction
from .categories import is_fallback_category
from .normalization import is_multi_category_merchant, normalize_raw_label

logger = logging.getLogger(__name__)


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
                except (json.JSONDecodeError, TypeError) as e:
                    logger.warning(f"[SmartLabel] JSON category_counts corrompu pour '{pattern}': {e}")
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
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning(f"[SmartLabel] JSON category_counts corrompu pour '{pattern}': {e}")
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
