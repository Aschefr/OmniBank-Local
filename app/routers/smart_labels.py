"""
OmniBank-Local — API Router pour le Smart Label Engine (Correspondance & Auto-Apprentissage).
Expose les endpoints de résolution en lot, d'apprentissage et de gestion des règles.
"""

import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BankLabelMapping
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


class MappingUpdateRequest(BaseModel):
    raw_pattern: Optional[str] = None
    clean_description: Optional[str] = None
    category: Optional[str] = None
    is_ignored: Optional[bool] = None


class MappingToggleRequest(BaseModel):
    clean_description: Optional[str] = None
    category: Optional[str] = None


class MappingOut(BaseModel):
    id: int
    raw_pattern: str
    clean_description: Optional[str] = None
    category: Optional[str] = None
    is_ignored: bool = False
    match_count: int
    last_used_at: Optional[str] = None
    created_at: Optional[str] = None

    model_config = {"from_attributes": True}


@router.post("/resolve-batch")
def resolve_batch(req: ResolveBatchRequest, db: Session = Depends(get_db)):
    """Résout un lot de libellés bancaires bruts via les 3 niveaux (règles, fuzzy historique, brut)."""
    results = resolve_smart_labels_batch(db, req.labels)
    return {"results": results}


@router.get("/mappings")
def list_mappings(db: Session = Depends(get_db)):
    """Liste l'ensemble des règles de correspondances apprises ordonnées par fréquence d'utilisation."""
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
            "match_count": m.match_count or 1,
            "last_used_at": m.last_used_at.isoformat() if m.last_used_at else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in mappings
    ]


@router.post("/mappings")
def create_or_update_mapping(req: MappingCreateRequest, db: Session = Depends(get_db)):
    """Crée ou met à jour manuellement une règle de correspondance ou d'exclusion."""
    pattern = normalize_raw_label(req.raw_pattern)
    if not pattern:
        raise HTTPException(status_code=400, detail="Le motif bancaire ne peut pas être vide")
    
    clean_desc = req.clean_description.strip() if req.clean_description else None
    if not req.is_ignored and not clean_desc:
        raise HTTPException(status_code=400, detail="La description propre ne peut pas être vide")

    category = req.category.strip() if req.category else None

    existing = db.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern == pattern).first()
    if existing:
        existing.is_ignored = bool(req.is_ignored)
        if clean_desc or not req.is_ignored:
            existing.clean_description = clean_desc
        if category or not req.is_ignored:
            existing.category = category
        db.commit()
        db.refresh(existing)
        return {"ok": True, "action": "updated", "id": existing.id}
    else:
        mapping = BankLabelMapping(
            raw_pattern=pattern,
            clean_description=clean_desc if not req.is_ignored else None,
            category=category if not req.is_ignored else None,
            is_ignored=bool(req.is_ignored),
            match_count=1
        )
        db.add(mapping)
        db.commit()
        db.refresh(mapping)
        return {"ok": True, "action": "created", "id": mapping.id}


@router.put("/mappings/{mapping_id}")
def update_mapping(mapping_id: int, req: MappingUpdateRequest, db: Session = Depends(get_db)):
    """Met à jour les propriétés d'une règle de correspondance existante."""
    mapping = db.query(BankLabelMapping).filter(BankLabelMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Règle non trouvée")

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

    db.commit()
    db.refresh(mapping)
    return {
        "ok": True,
        "id": mapping.id,
        "raw_pattern": mapping.raw_pattern,
        "clean_description": mapping.clean_description,
        "category": mapping.category,
        "is_ignored": bool(mapping.is_ignored),
        "match_count": mapping.match_count or 1
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
    return {
        "ok": True,
        "id": mapping.id,
        "raw_pattern": mapping.raw_pattern,
        "clean_description": mapping.clean_description,
        "category": mapping.category,
        "is_ignored": bool(mapping.is_ignored),
        "match_count": mapping.match_count or 1
    }


@router.delete("/mappings/{mapping_id}")
def delete_mapping(mapping_id: int, db: Session = Depends(get_db)):
    """Supprime une règle de correspondance de la base de connaissances."""
    mapping = db.query(BankLabelMapping).filter(BankLabelMapping.id == mapping_id).first()
    if not mapping:
        raise HTTPException(status_code=404, detail="Règle non trouvée")

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
        is_ignored=bool(req.is_ignored)
    )
    if not res:
        return {"ok": False, "detail": "Données insuffisantes"}
    return {"ok": True, "id": res.id, "pattern": res.raw_pattern}

