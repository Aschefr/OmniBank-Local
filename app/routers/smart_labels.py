"""
OmniBank-Local — API Router pour le Smart Label Engine (Correspondance & Auto-Apprentissage).
Expose les endpoints de résolution en lot, d'apprentissage et de gestion des règles.
"""

import json
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BankLabelMapping
from app.services.history_service import record_action, snapshot_entity
from app.services.smart_label_service import (
    learn_label_mapping,
    normalize_raw_label,
    resolve_smart_label,
    resolve_smart_labels_batch,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/smart-labels", tags=["smart-labels"])


class ResolveBatchRequest(BaseModel):
    labels: List[str]
    use_ai_fallback: Optional[bool] = False
    auto_fallback_category: Optional[bool] = False
    tx_types: Optional[Dict[str, str]] = None


class LearnRequest(BaseModel):
    raw_label: str
    clean_description: Optional[str] = None
    category: Optional[str] = None
    is_ignored: Optional[bool] = False


class MappingCreateRequest(BaseModel):
    raw_pattern: str
    clean_description: Optional[str] = None
    category: Optional[str] = None
    is_ignored: Optional[bool] = False
    is_manual: Optional[bool] = True
    is_multi_category: Optional[bool] = False


class MappingUpdateRequest(BaseModel):
    raw_pattern: Optional[str] = None
    clean_description: Optional[str] = None
    category: Optional[str] = None
    is_ignored: Optional[bool] = None
    is_manual: Optional[bool] = None
    is_multi_category: Optional[bool] = None


class MappingToggleRequest(BaseModel):
    clean_description: Optional[str] = None
    category: Optional[str] = None


class MappingToggleMultiRequest(BaseModel):
    category: Optional[str] = None


class MappingOut(BaseModel):
    id: int
    raw_pattern: str
    clean_description: Optional[str] = None
    category: Optional[str] = None
    is_ignored: bool = False
    is_manual: bool = False
    is_multi_category: bool = False
    match_count: int
    last_used_at: Optional[str] = None
    created_at: Optional[str] = None

    model_config = {"from_attributes": True}


class SimulateRequest(BaseModel):
    raw_label: str
    use_ai_fallback: Optional[bool] = True
    auto_fallback_category: Optional[bool] = False


@router.post("/resolve-batch")
def resolve_batch(req: ResolveBatchRequest, db: Session = Depends(get_db)):
    """Résout un lot de libellés bancaires bruts via les 4 niveaux (règles, fuzzy historique, IA, fourre-tout)."""
    results = resolve_smart_labels_batch(
        db,
        req.labels,
        use_ai_fallback=bool(req.use_ai_fallback),
        tx_types=req.tx_types,
        auto_fallback_category=bool(req.auto_fallback_category)
    )
    return {"results": results}


@router.post("/simulate")
def simulate_smart_label(req: SimulateRequest, db: Session = Depends(get_db)):
    """
    Simule la résolution complète d'un libellé brut bancaire via le pipeline Smart Label
    (Règles déterministes -> Historique -> Fallback IA avec habitudes et garde-fous).
    Permet à l'utilisateur de tester en direct ou de déclencher à la demande une classification unitaire.
    """
    raw_label = (req.raw_label or "").strip()
    if not raw_label:
        raise HTTPException(status_code=400, detail="Le libellé brut ne peut pas être vide")

    res = resolve_smart_label(
        db,
        raw_label,
        use_ai_fallback=bool(req.use_ai_fallback),
        auto_fallback_category=bool(req.auto_fallback_category)
    )

    source = res.get("source", "none")
    category = res.get("category")
    description = res.get("description", raw_label)
    is_multi = bool(res.get("is_multi_category", False))
    is_man = bool(res.get("is_manual", False))
    confidence = float(res.get("confidence", 0.0))

    # Diagnostic pédagogique pour l'utilisateur
    if source == "rule":
        if is_man:
            explanation = "Correspondance trouvée dans vos règles manuelles sanctuarisées."
        else:
            explanation = "Correspondance trouvée dans vos règles apprises de libellés."
    elif source == "multi_category":
        explanation = "Enseigne multi-catégories détectée : libellé propre extrait, catégorie laissée libre."
    elif source == "history":
        explanation = "Correspondance sémantique déduite de votre historique de transactions réelles."
    elif source == "ai":
        explanation = "Nommé et classé par inférence de votre modèle d'IA locale selon vos habitudes."
    elif source == "ambiguous":
        explanation = "Historique dispersé entre plusieurs catégories sans consensus net (arbitrage requis)."
    elif source == "ignored":
        explanation = "Ce motif bancaire est marqué comme exclu/ignoré de la catégorisation."
    elif source == "fallback":
        explanation = "Catégorie assignée par le filet de sécurité déterministe (Dépenses diverses / Revenus divers)."
    else:
        explanation = "Aucune correspondance mathématique trouvée dans les règles ou l'historique."

    return {
        "raw_label": raw_label,
        "description": description,
        "category": category,
        "source": source,
        "confidence": confidence,
        "is_manual": is_man,
        "is_multi_category": is_multi,
        "explanation": explanation,
        "mapping_id": res.get("mapping_id"),
        "smart_is_new_category": bool(res.get("smart_is_new_category", False)),
        "smart_is_fallback": bool(res.get("smart_is_fallback", False))
    }


@router.get("/mappings")
def list_mappings(db: Session = Depends(get_db)):
    """Liste l'ensemble des règles de correspondances ordonnées par fréquence d'utilisation."""
    mappings = db.query(BankLabelMapping).order_by(
        BankLabelMapping.match_count.desc(),
        BankLabelMapping.last_used_at.desc()
    ).all()

    return [
        {
            "id": m.id,
            "raw_pattern": m.raw_pattern,
            "clean_description": m.clean_description,
            "category": m.category,
            "is_ignored": bool(m.is_ignored),
            "is_manual": bool(m.is_manual),
            "is_multi_category": bool(m.is_multi_category),
            "match_count": m.match_count or 1,
            "last_used_at": m.last_used_at.isoformat() if m.last_used_at else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in mappings
    ]


@router.post("/mappings")
def create_or_update_mapping(req: MappingCreateRequest, db: Session = Depends(get_db)):
    """Crée ou met à jour manuellement une règle de correspondance, de multi-catégorie ou d'exclusion."""
    pattern = normalize_raw_label(req.raw_pattern)
    if not pattern:
        raise HTTPException(status_code=400, detail="Le motif bancaire ne peut pas être vide")

    is_multi = bool(req.is_multi_category)
    is_ign = bool(req.is_ignored)

    clean_desc = req.clean_description.strip() if req.clean_description else None
    if not is_ign and not clean_desc:
        clean_desc = pattern.title()

    category = None if is_multi else (req.category.strip() if req.category else None)

    existing = db.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern == pattern).first()
    if existing:
        prev_state = snapshot_entity(existing, db)
        existing.is_ignored = is_ign
        existing.is_manual = True
        existing.is_multi_category = is_multi
        existing.clean_description = clean_desc
        existing.category = category
        db.commit()
        db.refresh(existing)
        new_state = snapshot_entity(existing, db)
        record_action(db, "bank_label_mapping", existing.id, "UPDATE", prev_state, new_state)
        db.commit()
        return {"ok": True, "action": "updated", "id": existing.id}
    else:
        mapping = BankLabelMapping(
            raw_pattern=pattern,
            clean_description=clean_desc if not is_ign else None,
            category=category if not is_ign else None,
            is_ignored=is_ign,
            is_manual=True,
            is_multi_category=is_multi,
            match_count=1
        )
        db.add(mapping)
        db.commit()
        db.refresh(mapping)
        new_state = snapshot_entity(mapping, db)
        record_action(db, "bank_label_mapping", mapping.id, "CREATE", None, new_state)
        db.commit()
        return {"ok": True, "action": "created", "id": mapping.id}


@router.put("/mappings/{mapping_id}")
def update_mapping(mapping_id: int, req: MappingUpdateRequest, db: Session = Depends(get_db)):
    """Met à jour les propriétés d'une règle de correspondance existante."""
    mapping = db.query(BankLabelMapping).filter(BankLabelMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Règle non trouvée")

    prev_state = snapshot_entity(mapping, db)

    if req.raw_pattern is not None:
        p = normalize_raw_label(req.raw_pattern)
        if not p:
            raise HTTPException(status_code=400, detail="Le motif bancaire ne peut pas être vide")
        mapping.raw_pattern = p

    if req.clean_description is not None:
        mapping.clean_description = req.clean_description.strip() if req.clean_description else None

    if req.category is not None:
        mapping.category = req.category.strip() if req.category else None

    if req.is_ignored is not None:
        mapping.is_ignored = bool(req.is_ignored)
        if not mapping.is_ignored and not mapping.clean_description:
            mapping.clean_description = mapping.raw_pattern.title()

    if req.is_manual is not None:
        mapping.is_manual = bool(req.is_manual)

    if req.is_multi_category is not None:
        mapping.is_multi_category = bool(req.is_multi_category)
        if mapping.is_multi_category:
            mapping.category = None

    db.commit()
    db.refresh(mapping)
    new_state = snapshot_entity(mapping, db)
    record_action(db, "bank_label_mapping", mapping.id, "UPDATE", prev_state, new_state)
    db.commit()

    return {
        "ok": True,
        "id": mapping.id,
        "raw_pattern": mapping.raw_pattern,
        "clean_description": mapping.clean_description,
        "category": mapping.category,
        "is_ignored": bool(mapping.is_ignored),
        "is_manual": bool(mapping.is_manual),
        "is_multi_category": bool(mapping.is_multi_category),
        "match_count": mapping.match_count or 1
    }


@router.post("/mappings/{mapping_id}/toggle-manual")
def toggle_manual(mapping_id: int, db: Session = Depends(get_db)):
    """Bascule le statut d'une règle entre Sanctuarisée (manuelle) et Auto-apprise."""
    mapping = db.query(BankLabelMapping).filter(BankLabelMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Règle non trouvée")

    prev_state = snapshot_entity(mapping, db)
    mapping.is_manual = not bool(mapping.is_manual)
    db.commit()
    db.refresh(mapping)
    new_state = snapshot_entity(mapping, db)
    record_action(db, "bank_label_mapping", mapping.id, "UPDATE", prev_state, new_state)
    db.commit()
    return {"ok": True, "id": mapping.id, "is_manual": mapping.is_manual}


@router.post("/mappings/{mapping_id}/promote-manual")
def promote_mapping_to_manual(mapping_id: int, db: Session = Depends(get_db)):
    """Alias pour basculer ou promouvoir en règle manuelle."""
    return toggle_manual(mapping_id, db)


@router.post("/mappings/{mapping_id}/toggle-multi")
def toggle_multi_category(
    mapping_id: int,
    req: Optional[MappingToggleMultiRequest] = None,
    db: Session = Depends(get_db)
):
    """Bascule le mode multi-catégories pour un marchand, avec restauration intelligente de catégorie."""
    mapping = db.query(BankLabelMapping).filter(BankLabelMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Règle non trouvée")

    prev_state = snapshot_entity(mapping, db)
    mapping.is_multi_category = not bool(mapping.is_multi_category)
    if mapping.is_multi_category:
        mapping.category = None
        if not mapping.clean_description:
            mapping.clean_description = mapping.raw_pattern.title()
    else:
        # Rétablir la catégorie
        if req and req.category:
            mapping.category = req.category.strip()
        elif mapping.category_counts:
            try:
                counts = json.loads(mapping.category_counts)
                if counts:
                    best_cat = max(counts.items(), key=lambda x: x[1])[0]
                    mapping.category = best_cat
            except Exception:
                pass

    mapping.is_manual = True
    db.commit()
    db.refresh(mapping)
    new_state = snapshot_entity(mapping, db)
    record_action(db, "bank_label_mapping", mapping.id, "UPDATE", prev_state, new_state)
    db.commit()
    return {
        "ok": True,
        "id": mapping.id,
        "is_multi_category": mapping.is_multi_category,
        "category": mapping.category,
        "is_manual": mapping.is_manual
    }


@router.post("/mappings/{mapping_id}/toggle")
def toggle_mapping_status(
    mapping_id: int,
    req: Optional[MappingToggleRequest] = None,
    db: Session = Depends(get_db)
):
    """Bascule rapidement une règle entre l'état Associé et Ignoré."""
    mapping = db.query(BankLabelMapping).filter(BankLabelMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Règle non trouvée")

    prev_state = snapshot_entity(mapping, db)
    mapping.is_ignored = not bool(mapping.is_ignored)
    if not mapping.is_ignored:
        if req and req.clean_description:
            mapping.clean_description = req.clean_description.strip()
        elif not mapping.clean_description:
            mapping.clean_description = mapping.raw_pattern.title()
        if req and req.category:
            mapping.category = req.category.strip()

    db.commit()
    db.refresh(mapping)
    new_state = snapshot_entity(mapping, db)
    record_action(db, "bank_label_mapping", mapping.id, "UPDATE", prev_state, new_state)
    db.commit()
    return {
        "ok": True,
        "id": mapping.id,
        "raw_pattern": mapping.raw_pattern,
        "clean_description": mapping.clean_description,
        "category": mapping.category,
        "is_ignored": bool(mapping.is_ignored),
        "is_manual": bool(mapping.is_manual),
        "is_multi_category": bool(mapping.is_multi_category),
        "match_count": mapping.match_count or 1
    }


@router.delete("/mappings/{mapping_id}")
def delete_mapping(mapping_id: int, db: Session = Depends(get_db)):
    """Supprime une règle de correspondance de la base de connaissances."""
    mapping = db.query(BankLabelMapping).filter(BankLabelMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Règle non trouvée")

    prev_state = snapshot_entity(mapping, db)
    record_action(db, "bank_label_mapping", mapping.id, "DELETE", prev_state, None)
    db.delete(mapping)
    db.commit()
    return {"ok": True}


@router.post("/learn")
def learn_single(req: LearnRequest, db: Session = Depends(get_db)):
    """Enregistre ou met à jour une règle apprise lors d'une validation ou correction utilisateur."""
    res = learn_label_mapping(
        db=db,
        raw_label=req.raw_label,
        clean_description=req.clean_description,
        category=req.category,
        is_ignored=bool(req.is_ignored),
        is_manual=True
    )
    if not res:
        return {"ok": False, "detail": "Données insuffisantes"}
    return {"ok": True, "id": res.id, "pattern": res.raw_pattern}

