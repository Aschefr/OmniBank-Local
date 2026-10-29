"""
app/routers/profiles.py — Router API pour la gestion des Profils Maîtres.
"""
from fastapi import APIRouter, HTTPException, Depends, Request, Response
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import logging

logger = logging.getLogger(__name__)

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
from app.profile_manager import regenerate_recovery_code, verify_recovery_code
from app.database import get_engine, dispose_engine, get_db
from app.init_data import init_db
from app.services import stats_cache, pin_session

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


class ProfilePinRecoverRequest(BaseModel):
    recovery_code: str
    new_pin: Optional[str] = None  # Absent : la protection PIN est supprimée


class ProfileRecoveryCodeRequest(BaseModel):
    current_pin: str


def _sanitize_profile(profile: dict) -> dict:
    """Retire les informations sensibles (hash/salt) et ajoute 'has_pin'."""
    clean = dict(profile)
    clean["has_pin"] = bool(clean.get("pin_hash"))
    clean["has_recovery_code"] = bool(clean.get("recovery_hash"))
    for key in ("pin_hash", "pin_salt", "recovery_hash", "recovery_salt"):
        clean.pop(key, None)
    return clean


def _issue_session(response: Response, profile_id: str) -> str:
    """Crée une session déverrouillée et la pose aussi en cookie (images, téléchargements)."""
    token = pin_session.create_session(profile_id)
    response.set_cookie(
        pin_session.SESSION_COOKIE, token,
        httponly=True, samesite="strict", path="/",
        max_age=pin_session.SESSION_IDLE_SECONDS,
    )
    return token


def _check_attempts_allowed(profile_id: str):
    wait = pin_session.retry_after_seconds(profile_id)
    if wait:
        raise HTTPException(
            status_code=429,
            detail=f"Trop d'essais incorrects. Réessayez dans {wait} secondes.",
            headers={"Retry-After": str(wait)},
        )


def _verify_pin_or_fail(profile_id: str, pin: Optional[str], detail: str):
    """Vérifie un PIN avec limite d'essais (anti brute-force)."""
    _check_attempts_allowed(profile_id)
    if not pin or not verify_pin(profile_id, pin):
        pin_session.record_failure(profile_id)
        raise HTTPException(status_code=401, detail=detail)
    pin_session.clear_failures(profile_id)


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
def api_create_profile(req: ProfileCreateRequest, response: Response):
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

        # Seed GlobalConfig in new profile's DB
        try:
            from app.database import get_engine
            from sqlalchemy.orm import sessionmaker
            from app.models import GlobalConfig
            new_engine = get_engine(new_prof["id"])
            SessionNew = sessionmaker(bind=new_engine)
            new_db = SessionNew()
            try:
                curr_val = (req.currency or "EUR").strip().upper()
                pay_day_val = str(req.pay_cycle_day or 28)
                fmt_val = req.date_format or "DD/MM/YYYY"
                for k, v in [("base_currency", curr_val), ("base_pay_day", pay_day_val), ("date_format", fmt_val)]:
                    conf = new_db.query(GlobalConfig).filter(GlobalConfig.key == k).first()
                    if conf:
                        conf.value = v
                    else:
                        new_db.add(GlobalConfig(key=k, value=v))
                new_db.commit()
            finally:
                new_db.close()
        except Exception as e:
            logger.warning(f"[Profiles] Could not seed GlobalConfig for new profile {new_prof['id']}: {e}")

        recovery_code = None
        if req.pin and req.pin.strip():
            recovery_code = set_pin(new_prof["id"], req.pin.strip())
            new_prof["pin_hash"] = "configured"
            new_prof["recovery_hash"] = "configured"

        reload_req = False
        session_token = None
        if req.auto_activate:
            set_active_profile(new_prof["id"])
            reload_req = True
            if recovery_code:
                session_token = _issue_session(response, new_prof["id"])

        res = _sanitize_profile(new_prof)
        res["reload_required"] = reload_req
        res["recovery_code"] = recovery_code
        res["session_token"] = session_token
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

        # Synchronize metadata in active DB session (base_pay_day, base_currency, date_format)
        from app.models import GlobalConfig
        if req.pay_cycle_day is not None and req.pay_cycle_day > 0:
            conf_day = db.query(GlobalConfig).filter(GlobalConfig.key == "base_pay_day").first()
            if conf_day:
                conf_day.value = str(req.pay_cycle_day)
            else:
                db.add(GlobalConfig(key="base_pay_day", value=str(req.pay_cycle_day)))

        if req.currency is not None and req.currency.strip():
            curr_val = req.currency.strip().upper()
            conf_curr = db.query(GlobalConfig).filter(GlobalConfig.key == "base_currency").first()
            if conf_curr:
                conf_curr.value = curr_val
            else:
                db.add(GlobalConfig(key="base_currency", value=curr_val))

        if req.date_format is not None and req.date_format.strip():
            fmt_val = req.date_format.strip()
            conf_fmt = db.query(GlobalConfig).filter(GlobalConfig.key == "date_format").first()
            if conf_fmt:
                conf_fmt.value = fmt_val
            else:
                db.add(GlobalConfig(key="date_format", value=fmt_val))

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
        stats_cache.invalidate()
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
def api_activate_profile(profile_id: str, response: Response, req: Optional[ProfileActivateRequest] = None):
    """Bascule vers le profil spécifié (ou déverrouille le profil actif s'il est protégé)."""
    data = load_profiles_data()
    target = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Profil introuvable.")

    # Vérification du PIN si le profil est protégé
    session_token = None
    if target.get("pin_hash"):
        _verify_pin_or_fail(profile_id, req.pin if req else None, "Code PIN incorrect.")
        session_token = _issue_session(response, profile_id)

    _switch_active_profile(profile_id)
    return {"ok": True, "active_profile_id": profile_id, "reload_required": True, "session_token": session_token}


def _switch_active_profile(profile_id: str):
    active_profile = get_active_profile()
    if active_profile["id"] != profile_id:
        # Verrouiller immédiatement la session du coffre-fort du profil quitté pour garantir l'étanchéité
        try:
            from app.services.credential_vault import VaultSessionManager
            VaultSessionManager.lock_session(profile_id=active_profile["id"])
        except Exception as e:
            logger.warning(f"[Profiles] Erreur verrouillage session coffre pour {active_profile['id']}: {e}")

        # Fermer la connexion active précédente
        dispose_engine(active_profile["id"])
        set_active_profile(profile_id)

        # Invalider l'intégralité du cache stats & pending pour étanchéité multi-profils
        stats_cache.invalidate()

        # Assurer l'initialisation de la DB du profil cible
        target_engine = get_engine(profile_id)
        init_db(target_engine=target_engine)


@router.post("/lock")
def api_lock_session(request: Request, response: Response):
    """Verrouille la session courante : le PIN sera redemandé."""
    pin_session.revoke(pin_session.get_request_token(request))
    response.delete_cookie(pin_session.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.post("/{profile_id}/pin/recover")
def api_recover_pin(profile_id: str, req: ProfilePinRecoverRequest, response: Response):
    """PIN oublié : réinitialise (ou supprime) le PIN grâce au code de récupération, puis active le profil."""
    data = load_profiles_data()
    target = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Profil introuvable.")
    if not target.get("pin_hash"):
        raise HTTPException(status_code=400, detail="Ce profil n'est pas protégé par un code PIN.")

    _check_attempts_allowed(profile_id)
    if not verify_recovery_code(profile_id, req.recovery_code):
        pin_session.record_failure(profile_id)
        raise HTTPException(status_code=401, detail="Code de récupération incorrect.")
    pin_session.clear_failures(profile_id)

    new_pin = (req.new_pin or "").strip()
    try:
        if new_pin:
            recovery_code = set_pin(profile_id, new_pin)
        else:
            clear_pin(profile_id)
            recovery_code = None
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    pin_session.revoke_profile(profile_id)
    session_token = _issue_session(response, profile_id) if new_pin else None
    _switch_active_profile(profile_id)
    logger.info(f"[Profiles] PIN réinitialisé via code de récupération pour {profile_id}.")
    return {
        "ok": True,
        "active_profile_id": profile_id,
        "reload_required": True,
        "session_token": session_token,
        "recovery_code": recovery_code,
    }


@router.post("/{profile_id}/pin/recovery-code")
def api_regenerate_recovery_code(profile_id: str, req: ProfileRecoveryCodeRequest):
    """Génère un nouveau code de récupération (l'ancien devient invalide)."""
    active_profile = get_active_profile()
    if active_profile["id"] != profile_id:
        raise HTTPException(status_code=403, detail="Seul le profil actuellement actif peut modifier son code PIN.")
    if not active_profile.get("pin_hash"):
        raise HTTPException(status_code=400, detail="Ce profil n'est pas protégé par un code PIN.")
    _verify_pin_or_fail(profile_id, req.current_pin, "Code PIN actuel incorrect.")
    return {"ok": True, "recovery_code": regenerate_recovery_code(profile_id)}


@router.post("/{profile_id}/pin")
def api_set_pin(profile_id: str, req: ProfilePinRequest, response: Response):
    """Définit ou modifie le code PIN d'un profil."""
    active_profile = get_active_profile()
    if active_profile["id"] != profile_id:
        raise HTTPException(status_code=403, detail="Seul le profil actuellement actif peut modifier son code PIN.")

    data = load_profiles_data()
    target = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Profil introuvable.")

    # Si un PIN existait, vérifier l'ancien PIN
    had_pin = bool(target.get("pin_hash"))
    if had_pin:
        _verify_pin_or_fail(profile_id, req.current_pin, "Code PIN actuel incorrect.")

    try:
        recovery_code = set_pin(profile_id, req.pin)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Les autres appareils devront saisir le nouveau PIN ; cet appareil reste déverrouillé.
    pin_session.revoke_profile(profile_id)
    session_token = _issue_session(response, profile_id)
    return {
        "ok": True,
        "message": "Code PIN enregistré avec succès.",
        "recovery_code": recovery_code,
        "session_token": session_token,
    }


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
        _verify_pin_or_fail(profile_id, req.current_pin if req else None, "Code PIN actuel incorrect.")

    clear_pin(profile_id)
    pin_session.revoke_profile(profile_id)
    return {"ok": True, "message": "Code PIN supprimé."}
