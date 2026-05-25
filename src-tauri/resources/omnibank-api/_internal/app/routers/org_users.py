"""
org_users.py — Phase 9: Gestion des utilisateurs en mode Organisation.
CRUD sans mot de passe — identification par simple sélection.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.database import get_db
from app.models import OrgUser
from app.schemas.api_schemas import OrgUserCreate, OrgUserUpdate, OrgUserOut

router = APIRouter(prefix="/api/org_users", tags=["OrgUsers"])


@router.get("/", response_model=list[OrgUserOut])
def list_users(db: Session = Depends(get_db)):
    """Liste tous les utilisateurs, triés par sort_order puis id."""
    return db.query(OrgUser).order_by(OrgUser.sort_order, OrgUser.id).all()


@router.post("/", response_model=OrgUserOut)
def create_user(user: OrgUserCreate, db: Session = Depends(get_db)):
    """Créer un utilisateur. Le nom doit être unique."""
    existing = db.query(OrgUser).filter(OrgUser.name == user.name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"L'utilisateur '{user.name}' existe déjà.")
    db_user = OrgUser(name=user.name, is_active=user.is_active, sort_order=user.sort_order)
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user


@router.put("/{user_id}", response_model=OrgUserOut)
def update_user(user_id: int, data: OrgUserUpdate, db: Session = Depends(get_db)):
    """Modifier un utilisateur (renommer, activer/désactiver, réordonner)."""
    db_user = db.query(OrgUser).filter(OrgUser.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    if data.name is not None:
        # Check uniqueness
        dup = db.query(OrgUser).filter(OrgUser.name == data.name, OrgUser.id != user_id).first()
        if dup:
            raise HTTPException(status_code=400, detail=f"Le nom '{data.name}' est déjà utilisé.")
        db_user.name = data.name
    if data.is_active is not None:
        db_user.is_active = data.is_active
    if data.sort_order is not None:
        db_user.sort_order = data.sort_order
    db.commit()
    db.refresh(db_user)
    return db_user


@router.delete("/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    """
    Désactiver un utilisateur au lieu de le supprimer.
    On ne supprime jamais — seulement désactivation.
    """
    db_user = db.query(OrgUser).filter(OrgUser.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    # Deactivate instead of delete
    db_user.is_active = False
    db.commit()
    return {"status": "deactivated", "id": user_id, "name": db_user.name}


@router.post("/ensure_default", response_model=OrgUserOut)
def ensure_default_user(db: Session = Depends(get_db)):
    """
    Crée l'utilisateur par défaut 'Trésorier' si aucun n'existe.
    Retourne le premier utilisateur actif.
    """
    existing = db.query(OrgUser).filter(OrgUser.is_active == True).first()
    if existing:
        return existing
    default_user = OrgUser(name="Trésorier", is_active=True, sort_order=0)
    db.add(default_user)
    db.commit()
    db.refresh(default_user)
    return default_user
