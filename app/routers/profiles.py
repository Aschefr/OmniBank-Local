"""
app/routers/profiles.py — Router API pour la gestion des Profils Maîtres.
"""
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List

from app.profile_manager import (
    load_profiles_data,
    get_active_profile,
    set_active_profile,
    create_profile,
    update_profile,
    delete_profile,
    set_pin,
    verify_pin,
    clear_pin
)
from app.database import get_engine, dispose_engine, get_db
from app.init_data import init_db

router = APIRouter(prefix="/api/profiles", tags=["profiles"])


class ProfileCreateRequest(BaseModel):
    name: str
    color: Optional[str] = "#6366f1"
    icon: Optional[str] = "👤"
    currency: Optional[str] = "EUR"
    pay_cycle_day: Optional[int] = 28
    date_format: Optional[str] = "DD/MM/YYYY"
    pin: Optional[str] = None
    auto_activate: Optional[bool] = True


class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    currency: Optional[str] = None
    pay_cycle_day: Optional[int] = None
    date_format: Optional[str] = None


class ProfileActivateRequest(BaseModel):
    pin: Optional[str] = None


class ProfilePinRequest(BaseModel):
    pin: str
    current_pin: Optional[str] = None


class ProfilePinClearRequest(BaseModel):
    current_pin: Optional[str] = None


def _sanitize_profile(profile: dict) -> dict:
    """Retire les informations sensibles (hash/salt) et ajoute 'has_pin'."""
    clean = dict(profile)
    clean["has_pin"] = bool(clean.get("pin_hash"))
    clean.pop("pin_hash", None)
    clean.pop("pin_salt", None)
    return clean


from app.profile_manager import (
    load_profiles_data,
    get_active_profile,
    set_active_profile,
    create_profile,
    update_profile,
    delete_profile,
    set_pin,
    verify_pin,
    clear_pin,
    sync_profile_metadata_from_db
)

@router.get("/")
def list_profiles(db: Session = Depends(get_db)):
    """Liste tous les profils avec indication du profil actif."""
    sync_profile_metadata_from_db(db)
    data = load_profiles_data()
    active_id = data.get("active_profile_id", "default")
    sanitized_profiles = [_sanitize_profile(p) for p in data.get("profiles", [])]
    return {
        "active_profile_id": active_id,
        "profiles": sanitized_profiles
    }


@router.get("/active")
def get_active(db: Session = Depends(get_db)):
    """Retourne les informations du profil actuellement actif."""
    active = sync_profile_metadata_from_db(db)
    return _sanitize_profile(active)


@router.post("/")
def api_create_profile(req: ProfileCreateRequest):
    """Crée un nouveau profil maître, configure son PIN optionnel et bascule dessus."""
    if not req.name or not req.name.strip():
        raise HTTPException(status_code=400, detail="Le nom du profil est requis.")
    try:
        new_prof = create_profile(
            name=req.name,
            color=req.color,
            icon=req.icon or "👤",
            currency=req.currency or "EUR",
            pay_cycle_day=req.pay_cycle_day or 28,
            date_format=req.date_format or "DD/MM/YYYY"
        )
        if req.pin and req.pin.strip():
            set_pin(new_prof["id"], req.pin.strip())
            new_prof["pin_hash"] = "configured"
        
        reload_req = False
        if req.auto_activate:
            set_active_profile(new_prof["id"])
            reload_req = True

        res = _sanitize_profile(new_prof)
        res["reload_required"] = reload_req
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Échec de création du profil: {str(e)}")


@router.put("/{profile_id}")
def api_update_profile(profile_id: str, req: ProfileUpdateRequest, db: Session = Depends(get_db)):
    """Modifie les paramètres d' un profil."""
    active_profile = get_active_profile()
    if active_profile["id"] != profile_id:
        raise HTTPException(status_code=403, detail="Seul le profil actuellement actif peut être modifié.")

    try:
        updated = update_profile(
            profile_id=profile_id,
            name=req.name,
            color=req.color,
            icon=req.icon,
            currency=req.currency,
            pay_cycle_day=req.pay_cycle_day,
            date_format=req.date_format
        )

        # Synchronize base_pay_day in active DB session if pay_cycle_day is updated
        if req.pay_cycle_day is not None and req.pay_cycle_day > 0:
            from app.models import GlobalConfig
            conf_day = db.query(GlobalConfig).filter(GlobalConfig.key == "base_pay_day").first()
            if conf_day:
                conf_day.value = str(req.pay_cycle_day)
            else:
                db.add(GlobalConfig(key="base_pay_day", value=str(req.pay_cycle_day)))
            db.commit()

        return _sanitize_profile(updated)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{profile_id}")
def api_delete_profile(profile_id: str):
    """Supprime un profil et son jeu de données."""
    active_profile = get_active_profile()
    if active_profile["id"] != profile_id:
        raise HTTPException(status_code=403, detail="Seul le profil actuellement actif peut être supprimé. Veuillez d'abord basculer sur ce profil.")

    if profile_id == "default":
        raise HTTPException(status_code=400, detail="Impossible de supprimer le profil par défaut.")

    try:
        fallback_id = delete_profile(profile_id)
        return {
            "ok": True,
            "message": "Profil supprimé avec succès.",
            "active_profile_id": fallback_id,
            "reload_required": True
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{profile_id}/activate")
def api_activate_profile(profile_id: str, req: Optional[ProfileActivateRequest] = None):
    """Bascule vers le profil spécifié."""
    data = load_profiles_data()
    target = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Profil introuvable.")

    # Vérification du PIN si le profil est protégé
    if target.get("pin_hash"):
        provided_pin = req.pin if req else None
        if not provided_pin or not verify_pin(profile_id, provided_pin):
            raise HTTPException(status_code=401, detail="Code PIN incorrect.")

    active_profile = get_active_profile()
    if active_profile["id"] != profile_id:
        # Fermer la connexion active précédente
        dispose_engine(active_profile["id"])
        set_active_profile(profile_id)

        # Assurer l'initialisation de la DB du profil cible
        target_engine = get_engine(profile_id)
        init_db(target_engine=target_engine)

    return {"ok": True, "active_profile_id": profile_id, "reload_required": True}


@router.post("/{profile_id}/pin")
def api_set_pin(profile_id: str, req: ProfilePinRequest):
    """Définit ou modifie le code PIN d'un profil."""
    active_profile = get_active_profile()
    if active_profile["id"] != profile_id:
        raise HTTPException(status_code=403, detail="Seul le profil actuellement actif peut modifier son code PIN.")

    data = load_profiles_data()
    target = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Profil introuvable.")

    # Si un PIN existait, vérifier l'ancien PIN
    if target.get("pin_hash"):
        if not req.current_pin or not verify_pin(profile_id, req.current_pin):
            raise HTTPException(status_code=401, detail="Code PIN actuel incorrect.")

    try:
        set_pin(profile_id, req.pin)
        return {"ok": True, "message": "Code PIN enregistré avec succès."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{profile_id}/pin")
def api_clear_pin(profile_id: str, req: Optional[ProfilePinClearRequest] = None):
    """Supprime la protection par code PIN d'un profil."""
    active_profile = get_active_profile()
    if active_profile["id"] != profile_id:
        raise HTTPException(status_code=403, detail="Seul le profil actuellement actif peut modifier son code PIN.")

    data = load_profiles_data()
    target = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Profil introuvable.")

    if target.get("pin_hash"):
        current_pin = req.current_pin if req else None
        if not current_pin or not verify_pin(profile_id, current_pin):
            raise HTTPException(status_code=401, detail="Code PIN actuel incorrect.")

    clear_pin(profile_id)
    return {"ok": True, "message": "Code PIN supprimé."}
