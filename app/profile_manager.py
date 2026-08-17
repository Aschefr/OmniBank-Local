"""
app/profile_manager.py — Gestionnaire central de profils maîtres.
Gère profiles.json, la création/suppression de profils, le switch et les codes PIN.
"""
import os
import json
import uuid
import secrets
import hashlib
import shutil
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime

from app.database import DATA_DIR

logger = logging.getLogger(__name__)

PROFILES_FILE = os.path.join(DATA_DIR, "profiles.json")
PROFILES_DIR = os.path.join(DATA_DIR, "profiles")

DEFAULT_PROFILE = {
    "id": "default",
    "name": "Mon Profil",
    "color": "#6366f1",
    "icon": "👤",
    "currency": "EUR",
    "pay_cycle_day": 28,
    "date_format": "DD/MM/YYYY",
    "created_at": datetime.now().isoformat(),
    "db_path": "omnibank.db",
    "uploads_dir": "uploads",
    "pin_hash": None,
    "pin_salt": None,
}


def ensure_profiles_initialized() -> dict:
    """Initialise profiles.json s'il n'existe pas déjà (migration transparente)."""
    os.makedirs(PROFILES_DIR, exist_ok=True)
    if not os.path.isfile(PROFILES_FILE):
        logger.info("[ProfileManager] Initialisation initiale de profiles.json avec le profil par défaut.")
        data = {
            "active_profile_id": "default",
            "profiles": [dict(DEFAULT_PROFILE)]
        }
        _save_profiles_data(data)
        return data
    data = load_profiles_data()
    # Garantir que les dossiers de chaque profil existent
    for p in data.get("profiles", []):
        if p.get("id") != "default":
            p_dir = os.path.join(PROFILES_DIR, p["id"])
            os.makedirs(os.path.join(p_dir, "uploads"), exist_ok=True)
    return data


def load_profiles_data() -> dict:
    """Lit profiles.json (avec fallback si fichier corrompu)."""
    if not os.path.isfile(PROFILES_FILE):
        return ensure_profiles_initialized()
    try:
        with open(PROFILES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if "active_profile_id" not in data or "profiles" not in data:
                raise ValueError("Format invalide de profiles.json")
            
            # Ensure defaults for existing profiles
            modified = False
            for p in data.get("profiles", []):
                if "icon" not in p: p["icon"] = "👤"; modified = True
                if "currency" not in p: p["currency"] = "EUR"; modified = True
                if "pay_cycle_day" not in p: p["pay_cycle_day"] = 28; modified = True
                if "date_format" not in p: p["date_format"] = "DD/MM/YYYY"; modified = True

            if modified:
                _save_profiles_data(data)

            return data
    except Exception as e:
        logger.error(f"[ProfileManager] Erreur de lecture de profiles.json: {e}. Restauration du profil par défaut.")
        data = {
            "active_profile_id": "default",
            "profiles": [dict(DEFAULT_PROFILE)]
        }
        _save_profiles_data(data)
        return data


def sync_profile_metadata_from_db(db_session=None) -> dict:
    """
    Synchronise les métadonnées du profil actif (pay_cycle_day, currency, date_format)
    depuis la table GlobalConfig de la base SQLite active (ex: après restauration de backup).
    """
    active = get_active_profile()
    if not active:
        return active

    from app.models import GlobalConfig
    from app.database import get_db

    should_close = False
    if db_session is None:
        try:
            db_gen = get_db()
            db_session = next(db_gen)
            should_close = True
        except Exception:
            return active

    try:
        updated_fields = {}
        conf_day = db_session.query(GlobalConfig).filter(GlobalConfig.key == "base_pay_day").first()
        if conf_day and conf_day.value:
            try:
                p_day = int(conf_day.value)
                if p_day > 0 and active.get("pay_cycle_day") != p_day:
                    updated_fields["pay_cycle_day"] = p_day
            except Exception:
                pass

        conf_curr = db_session.query(GlobalConfig).filter(GlobalConfig.key == "base_currency").first()
        if conf_curr and conf_curr.value:
            curr = conf_curr.value.upper().strip()
            if curr and active.get("currency") != curr:
                updated_fields["currency"] = curr

        conf_fmt = db_session.query(GlobalConfig).filter(GlobalConfig.key == "date_format").first()
        if conf_fmt and conf_fmt.value:
            fmt = conf_fmt.value.strip()
            if fmt and active.get("date_format") != fmt:
                updated_fields["date_format"] = fmt

        if updated_fields:
            return update_profile(active["id"], **updated_fields)
    except Exception as e:
        logger.warning(f"[ProfileManager] Failed to sync profile metadata from DB: {e}")
    finally:
        if should_close and db_session:
            db_session.close()

    return active


def _save_profiles_data(data: dict):
    """Écrit profiles.json de manière atomique."""
    import time
    tmp_path = f"{PROFILES_FILE}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    for attempt in range(5):
        try:
            os.replace(tmp_path, PROFILES_FILE)
            return
        except (PermissionError, OSError):
            if attempt == 4:
                with open(PROFILES_FILE, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                try:
                    if os.path.exists(tmp_path):
                        os.remove(tmp_path)
                except Exception:
                    pass
                return
            time.sleep(0.05)


def get_active_profile() -> dict:
    """Retourne le profil actuellement actif."""
    data = load_profiles_data()
    active_id = data.get("active_profile_id", "default")
    for p in data.get("profiles", []):
        if p["id"] == active_id:
            return p
    # Fallback sur le premier profil ou default
    if data.get("profiles"):
        return data["profiles"][0]
    return dict(DEFAULT_PROFILE)


def set_active_profile(profile_id: str) -> dict:
    """Définit le profil actif par son ID."""
    data = load_profiles_data()
    found = None
    for p in data.get("profiles", []):
        if p["id"] == profile_id:
            found = p
            break
    if not found:
        raise ValueError(f"Profil introuvable: {profile_id}")
    
    data["active_profile_id"] = profile_id
    _save_profiles_data(data)
    logger.info(f"[ProfileManager] Profil actif modifié: {found['name']} ({profile_id})")
    return found


def create_profile(
    name: str,
    color: str = "#6366f1",
    icon: str = "👤",
    currency: str = "EUR",
    pay_cycle_day: int = 28,
    date_format: str = "DD/MM/YYYY"
) -> dict:
    """Crée un nouveau profil avec son propre dossier de données."""
    data = load_profiles_data()
    profile_id = f"p_{uuid.uuid4().hex[:8]}"
    
    profile_rel_dir = os.path.join("profiles", profile_id)
    profile_abs_dir = os.path.join(DATA_DIR, profile_rel_dir)
    uploads_abs_dir = os.path.join(profile_abs_dir, "uploads")
    os.makedirs(uploads_abs_dir, exist_ok=True)

    db_rel_path = os.path.join(profile_rel_dir, "omnibank.db").replace("\\", "/")
    uploads_rel_path = os.path.join(profile_rel_dir, "uploads").replace("\\", "/")

    new_profile = {
        "id": profile_id,
        "name": name.strip(),
        "color": color or "#6366f1",
        "icon": icon or "👤",
        "currency": currency or "EUR",
        "pay_cycle_day": int(pay_cycle_day) if pay_cycle_day else 28,
        "date_format": date_format or "DD/MM/YYYY",
        "created_at": datetime.now().isoformat(),
        "db_path": db_rel_path,
        "uploads_dir": uploads_rel_path,
        "pin_hash": None,
        "pin_salt": None,
    }

    data["profiles"].append(new_profile)
    _save_profiles_data(data)

    # Initialisation de la DB SQLite du nouveau profil
    from app.database import get_engine
    from app.init_data import init_db
    new_engine = get_engine(profile_id)
    init_db(target_engine=new_engine)

    logger.info(f"[ProfileManager] Nouveau profil créé: {name} ({profile_id})")
    return new_profile


def update_profile(
    profile_id: str,
    name: Optional[str] = None,
    color: Optional[str] = None,
    icon: Optional[str] = None,
    currency: Optional[str] = None,
    pay_cycle_day: Optional[int] = None,
    date_format: Optional[str] = None
) -> dict:
    """Modifie les paramètres d'un profil."""
    data = load_profiles_data()
    target = None
    for p in data["profiles"]:
        if p["id"] == profile_id:
            target = p
            break
    if not target:
        raise ValueError(f"Profil introuvable: {profile_id}")

    if name is not None and name.strip():
        target["name"] = name.strip()
    if color is not None and color.strip():
        target["color"] = color.strip()
    if icon is not None and icon.strip():
        target["icon"] = icon.strip()
    if currency is not None and currency.strip():
        target["currency"] = currency.strip()
    if pay_cycle_day is not None and int(pay_cycle_day) > 0:
        target["pay_cycle_day"] = int(pay_cycle_day)
    if date_format is not None and date_format.strip():
        target["date_format"] = date_format.strip()

    _save_profiles_data(data)
    logger.info(f"[ProfileManager] Profil mis à jour: {target['name']} ({profile_id})")
    return target


def delete_profile(profile_id: str) -> str:
    """Supprime un profil et toutes ses données physiques (DB et uploads). Retourne l'ID du profil actif réaffecté."""
    if profile_id == "default":
        raise ValueError("Impossible de supprimer le profil par défaut.")

    data = load_profiles_data()
    target_idx = None
    target_profile = None
    for idx, p in enumerate(data["profiles"]):
        if p["id"] == profile_id:
            target_idx = idx
            target_profile = p
            break

    if target_idx is None or not target_profile:
        raise ValueError(f"Profil introuvable: {profile_id}")

    # Si on supprime le profil actif, réaffecter sur le profil par défaut ou un autre profil existant
    is_active = (data.get("active_profile_id") == profile_id)
    fallback_id = "default"
    if is_active:
        remaining = [p for p in data["profiles"] if p["id"] != profile_id]
        if remaining:
            fallback_id = remaining[0]["id"]
        data["active_profile_id"] = fallback_id

    # Fermer l'engine du profil supprimé s'il était en cache
    from app.database import dispose_engine, get_engine
    from app.init_data import init_db
    dispose_engine(profile_id)

    # Supprimer physiquement le dossier du profil
    profile_dir = os.path.join(DATA_DIR, "profiles", profile_id)
    if os.path.isdir(profile_dir):
        try:
            shutil.rmtree(profile_dir)
            logger.info(f"[ProfileManager] Dossier physique supprimé: {profile_dir}")
        except Exception as e:
            logger.error(f"[ProfileManager] Erreur lors de la suppression du dossier {profile_dir}: {e}")

    data["profiles"].pop(target_idx)
    _save_profiles_data(data)
    logger.info(f"[ProfileManager] Profil {profile_id} supprimé de profiles.json. Profil actif réaffecté: {fallback_id}")

    if is_active:
        # Initialiser la DB du profil réaffecté
        new_engine = get_engine(fallback_id)
        init_db(target_engine=new_engine)

    return fallback_id


def get_profile_db_path(profile_id: Optional[str] = None) -> str:
    """Retourne le chemin absolu du fichier SQLite pour un profil."""
    if not profile_id:
        active = get_active_profile()
        rel_path = active.get("db_path", "omnibank.db")
    else:
        data = load_profiles_data()
        found = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
        rel_path = found.get("db_path", "omnibank.db") if found else "omnibank.db"

    return os.path.normpath(os.path.join(DATA_DIR, rel_path))


def get_profile_uploads_dir(profile_id: Optional[str] = None) -> str:
    """Retourne le chemin absolu du dossier d'uploads pour un profil."""
    if not profile_id:
        active = get_active_profile()
        rel_path = active.get("uploads_dir", "uploads")
    else:
        data = load_profiles_data()
        found = next((p for p in data.get("profiles", []) if p["id"] == profile_id), None)
        rel_path = found.get("uploads_dir", "uploads") if found else "uploads"

    full_path = os.path.normpath(os.path.join(DATA_DIR, rel_path))
    os.makedirs(full_path, exist_ok=True)
    return full_path


def _hash_pin(pin: str, salt_hex: str) -> str:
    """Génère un hash PBKDF2 HMAC SHA-256 pour un PIN."""
    salt = bytes.fromhex(salt_hex)
    return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, 100000).hex()


def set_pin(profile_id: str, pin: str):
    """Définit ou modifie le code PIN d'un profil."""
    if not pin or len(pin) < 4:
        raise ValueError("Le code PIN doit comporter au moins 4 caractères.")

    data = load_profiles_data()
    target = next((p for p in data["profiles"] if p["id"] == profile_id), None)
    if not target:
        raise ValueError(f"Profil introuvable: {profile_id}")

    salt_hex = secrets.token_hex(16)
    pin_hash = _hash_pin(pin, salt_hex)

    target["pin_salt"] = salt_hex
    target["pin_hash"] = pin_hash
    _save_profiles_data(data)
    logger.info(f"[ProfileManager] Code PIN mis à jour pour le profil {profile_id}.")


def verify_pin(profile_id: str, pin: str) -> bool:
    """Vérifie si le code PIN fourni est correct pour le profil."""
    data = load_profiles_data()
    target = next((p for p in data["profiles"] if p["id"] == profile_id), None)
    if not target:
        return False

    if not target.get("pin_hash") or not target.get("pin_salt"):
        return True  # Pas de PIN configuré

    input_hash = _hash_pin(pin, target["pin_salt"])
    return secrets.compare_digest(input_hash, target["pin_hash"])


def clear_pin(profile_id: str):
    """Supprime la protection PIN d'un profil."""
    data = load_profiles_data()
    target = next((p for p in data["profiles"] if p["id"] == profile_id), None)
    if not target:
        raise ValueError(f"Profil introuvable: {profile_id}")

    target["pin_hash"] = None
    target["pin_salt"] = None
    _save_profiles_data(data)
    logger.info(f"[ProfileManager] Code PIN réinitialisé pour le profil {profile_id}.")
