"""
OmniBank-Local — Coffre-fort chiffré pour identifiants bancaires.
Architecture de sécurité :
- Dérivation de clé PBKDF2-HMAC-SHA256 (480 000 itérations)
- Chiffrement AES-128-CBC / Fernet avec signature HMAC-SHA256
- Sel unique généré par connexion
- Aucun identifiant en clair n'est écrit sur le disque
"""

import os
import json
import base64
import logging
import threading
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.models import GlobalConfig

logger = logging.getLogger(__name__)

PBKDF2_ITERATIONS = 480_000


def _derive_fernet_key(master_password: str, salt: bytes) -> bytes:
    """Dérive une clé Fernet 256 bits à partir du mot de passe maître et d'un sel."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
    )
    key = kdf.derive(master_password.encode("utf-8"))
    return base64.urlsafe_b64encode(key)


class CredentialVault:
    @staticmethod
    def store_credentials(
        db: Session,
        connection_id: int,
        credentials: Dict[str, Any],
        master_password: str
    ) -> bool:
        """
        Chiffre et stocke les paramètres d'authentification pour une connexion bancaire donnée.
        """
        salt = os.urandom(16)
        salt_b64 = base64.b64encode(salt).decode("ascii")

        fernet_key = _derive_fernet_key(master_password, salt)
        fernet = Fernet(fernet_key)

        raw_json = json.dumps(credentials).encode("utf-8")
        encrypted_payload = fernet.encrypt(raw_json).decode("ascii")

        # Clé dans global_config
        salt_key = f"bank_vault_{connection_id}_salt"
        payload_key = f"bank_vault_{connection_id}_data"

        # Sauvegarde en base
        for k, v in [(salt_key, salt_b64), (payload_key, encrypted_payload)]:
            cfg = db.query(GlobalConfig).filter(GlobalConfig.key == k).first()
            if cfg:
                cfg.value = v
            else:
                db.add(GlobalConfig(key=k, value=v))

        db.commit()
        logger.info(f"[Vault] Identifiants chiffrés enregistrés pour la connexion {connection_id}")
        return True

    @staticmethod
    def retrieve_credentials(
        db: Session,
        connection_id: int,
        master_password: str
    ) -> Optional[Dict[str, Any]]:
        """
        Déchiffre et retourne le dictionnaire d'identifiants.
        Retourne None si le mot de passe est erroné ou si les données sont inexistantes.
        """
        salt_key = f"bank_vault_{connection_id}_salt"
        payload_key = f"bank_vault_{connection_id}_data"

        salt_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == salt_key).first()
        payload_cfg = db.query(GlobalConfig).filter(GlobalConfig.key == payload_key).first()

        if not salt_cfg or not payload_cfg:
            logger.warning(f"[Vault] Aucune donnée chiffrée trouvée pour la connexion {connection_id}")
            return None

        try:
            salt = base64.b64decode(salt_cfg.value.encode("ascii"))
            fernet_key = _derive_fernet_key(master_password, salt)
            fernet = Fernet(fernet_key)

            decrypted_json = fernet.decrypt(payload_cfg.value.encode("ascii"))
            return json.loads(decrypted_json.decode("utf-8"))
        except InvalidToken:
            logger.warning(f"[Vault] Échec de déchiffrement pour la connexion {connection_id} (mot de passe invalide)")
            return None
        except Exception as e:
            logger.error(f"[Vault] Erreur inattendue lors de la lecture du coffre {connection_id}: {e}")
            return None

    @staticmethod
    def delete_credentials(db: Session, connection_id: int) -> bool:
        """Supprime définitivement les clés et données chiffrées d'une connexion."""
        salt_key = f"bank_vault_{connection_id}_salt"
        payload_key = f"bank_vault_{connection_id}_data"

        db.query(GlobalConfig).filter(GlobalConfig.key.in_([salt_key, payload_key])).delete(synchronize_session=False)
        db.commit()
        logger.info(f"[Vault] Identifiants supprimés pour la connexion {connection_id}")
        return True

    @staticmethod
    def has_credentials(db: Session, connection_id: int) -> bool:
        """Vérifie si des identifiants chiffrés existent pour cette connexion."""
        payload_key = f"bank_vault_{connection_id}_data"
        return db.query(GlobalConfig).filter(GlobalConfig.key == payload_key).first() is not None


class VaultSessionManager:
    """
    Gestionnaire de session de déverrouillage temporaire du coffre-fort (In-Memory RAM).
    Garde le mot de passe maître en mémoire avec un délai d'expiration (TTL) et scopé par profile_id.
    Zéro écriture de mot de passe maître en clair sur disque.
    """
    _sessions: Dict[str, Dict[str, Any]] = {}
    _lock = threading.Lock()

    @classmethod
    def _resolve_profile_id(cls, profile_id: Optional[str] = None) -> str:
        if profile_id:
            return profile_id
        try:
            from app.profile_manager import get_active_profile
            return get_active_profile().get("id", "default")
        except Exception:
            return "default"

    @classmethod
    def create_session(cls, master_password: str, duration_days: int = 7, profile_id: Optional[str] = None) -> str:
        """Crée un jeton de session en mémoire vive valable duration_days jours pour un profil donné."""
        import secrets
        import time

        pid = cls._resolve_profile_id(profile_id)
        token = secrets.token_urlsafe(32)
        ttl_seconds = max(1, duration_days) * 86400
        expires_at = time.time() + ttl_seconds

        with cls._lock:
            # Purger toute session antérieure pour ce même profil
            to_purge = [t for t, s in cls._sessions.items() if s.get("profile_id") == pid]
            for t in to_purge:
                cls._sessions.pop(t, None)

            cls._sessions[token] = {
                "master_password": master_password,
                "expires_at": expires_at,
                "created_at": time.time(),
                "duration_days": duration_days,
                "profile_id": pid
            }
        logger.info(f"[VaultSession] Session créée pour le profil '{pid}' (valable {duration_days} jours)")
        return token

    @classmethod
    def get_password(cls, token: Optional[str] = None, profile_id: Optional[str] = None) -> Optional[str]:
        """Retourne le mot de passe maître en mémoire si la session est valide et correspond au profil."""
        import time
        now = time.time()
        pid = cls._resolve_profile_id(profile_id)

        with cls._lock:
            if token:
                session = cls._sessions.get(token)
                if not session:
                    return None
                if session["expires_at"] <= now:
                    cls._sessions.pop(token, None)
                    logger.info(f"[VaultSession] Session expirée supprimée de la mémoire (profil {session.get('profile_id')})")
                    return None
                if session.get("profile_id") != pid:
                    logger.warning(f"[VaultSession] Jeton non valide pour le profil actif '{pid}' (appartient à '{session.get('profile_id')}')")
                    return None
                return session["master_password"]

            # Si aucun token fourni : chercher une session active pour ce profil uniquement
            for t, s in list(cls._sessions.items()):
                if s["expires_at"] > now:
                    if s.get("profile_id") == pid:
                        return s["master_password"]
                else:
                    cls._sessions.pop(t, None)
            return None

    @classmethod
    def get_status(cls, token: Optional[str] = None, profile_id: Optional[str] = None) -> Dict[str, Any]:
        """Retourne l'état actuel de déverrouillage de la session pour le profil."""
        import time
        now = time.time()
        pid = cls._resolve_profile_id(profile_id)

        with cls._lock:
            target = None
            if token and token in cls._sessions:
                s = cls._sessions[token]
                if s["expires_at"] > now and s.get("profile_id") == pid:
                    target = s
                elif s["expires_at"] <= now:
                    cls._sessions.pop(token, None)
            elif not token:
                for t, s in list(cls._sessions.items()):
                    if s["expires_at"] > now:
                        if s.get("profile_id") == pid:
                            target = s
                            break
                    else:
                        cls._sessions.pop(t, None)

            if not target or target["expires_at"] <= now:
                return {"is_unlocked": False, "remaining_seconds": 0, "remaining_days": 0}

            remaining_sec = max(0, int(target["expires_at"] - now))
            import math
            remaining_days = max(1, math.ceil(remaining_sec / 86400))
            return {
                "is_unlocked": True,
                "remaining_seconds": remaining_sec,
                "remaining_days": remaining_days,
                "expires_at": target["expires_at"],
                "profile_id": target.get("profile_id")
            }

    @classmethod
    def is_unlocked(cls, token: Optional[str] = None, profile_id: Optional[str] = None) -> bool:
        """Retourne True si une session valide non expirée est active pour le profil."""
        return cls.get_password(token, profile_id) is not None

    @classmethod
    def lock_session(cls, token: Optional[str] = None, profile_id: Optional[str] = None):
        """Purger la session du profil spécifié (ou actif) de la mémoire."""
        pid = cls._resolve_profile_id(profile_id)
        with cls._lock:
            if token:
                cls._sessions.pop(token, None)
            else:
                to_remove = [t for t, s in cls._sessions.items() if s.get("profile_id") == pid]
                for t in to_remove:
                    cls._sessions.pop(t, None)
        logger.info(f"[VaultSession] Session coffre-fort verrouillée et purgée pour le profil '{pid}'")

