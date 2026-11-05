"""
Licence du Mode Organisation : lecture et vérification des clés, hors ligne.

Trois formats sont reconnus :
- « OB2. » : signature Ed25519 d'un contenu (identifiant, organisation, e-mail, date). Format des nouvelles licences.
- signature Ed25519 de l'e-mail seul : premières licences signées, toujours acceptées.
- « OMNI- » : clés d'avant la signature. Seules celles listées ici restent valables, et une clé désactivée ne se réactive pas.

Le code est public : ce contrôle empêche le contournement facile, le contrat fait le reste.
"""
import base64
import hashlib
import json
from functools import lru_cache
from typing import Optional

from cryptography.hazmat.primitives.asymmetric import ed25519
from sqlalchemy.orm import Session

from app.models import GlobalConfig

# Clés publiques acceptées : en ajouter une permet de changer de clé de signature sans invalider les licences déjà vendues
PUBLIC_KEYS_B64 = ("rlAgxcf0MapA13+WZi5CpGg42HhjTth/O40yV5qTxgY=",)

# Préfixe signé avec le contenu : une signature faite pour autre chose ne peut pas passer pour une licence
LICENSE_V2_CONTEXT = b"omnibank-license-v2\n"
LICENSE_V2_PREFIX = "OB2."
LEGACY_PREFIX = "OMNI-"

# Version du contrat de licence (static/legal/LICENSE_ORGANISATION.md) à accepter à l'activation
CONTRACT_VERSION = "2.0"

# Licences révoquées (rétractation, revente) : la liste part avec les mises à jour, l'application reste hors ligne
REVOKED_LICENSE_IDS = frozenset()

# Empreintes SHA-256 de « e-mail\nclé » des anciennes clés encore valables : la clé elle-même n'est pas dans le dépôt
LEGACY_KEY_HASHES = frozenset({
    "20837738534ec9d88137166a491b582dd0c1c16ed7ba6615a43aaba9dd911033",
})


def legacy_key_hash(email: str, key: str) -> str:
    return hashlib.sha256(f"{email.strip().lower()}\n{key.strip()}".encode("utf-8")).hexdigest()


def _verify_signature(signature: bytes, message: bytes) -> bool:
    for encoded in PUBLIC_KEYS_B64:
        try:
            ed25519.Ed25519PublicKey.from_public_bytes(base64.b64decode(encoded)).verify(signature, message)
            return True
        except Exception:
            continue
    return False


def _urlsafe_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _read_v2_key(email: str, key: str) -> Optional[dict]:
    try:
        _, encoded_payload, encoded_signature = key.split(".")
        payload_bytes = _urlsafe_decode(encoded_payload)
        if not _verify_signature(_urlsafe_decode(encoded_signature), LICENSE_V2_CONTEXT + payload_bytes):
            return None
        payload = json.loads(payload_bytes)
    except (ValueError, TypeError):
        return None
    if str(payload.get("email", "")).strip().lower() != email or payload.get("id") in REVOKED_LICENSE_IDS:
        return None
    return {"kind": "v2", "email": email, "id": payload.get("id"), "org": payload.get("org"), "issued": payload.get("issued")}


@lru_cache(maxsize=64)
def read_license(email: str, key: str) -> Optional[dict]:
    """Ce que dit une clé pour cet e-mail, ou None si elle n'est pas valable."""
    email = (email or "").strip().lower()
    key = (key or "").strip()
    if not email or not key:
        return None
    if key.startswith(LICENSE_V2_PREFIX):
        return _read_v2_key(email, key)
    if key.startswith(LEGACY_PREFIX):
        return {"kind": "legacy", "email": email} if legacy_key_hash(email, key) in LEGACY_KEY_HASHES else None
    try:
        signature = base64.b64decode(key, validate=True)
    except ValueError:
        return None
    return {"kind": "signed", "email": email} if _verify_signature(signature, email.encode("utf-8")) else None


def _stored_license(db: Session) -> Optional[dict]:
    rows = dict(db.query(GlobalConfig.key, GlobalConfig.value).filter(GlobalConfig.key.in_(("license_key", "license_email"))).all())
    if not rows.get("license_key") or not rows.get("license_email"):
        return None
    return read_license(rows["license_email"], rows["license_key"])


def is_license_active(db: Session) -> bool:
    return _stored_license(db) is not None


def org_mode_requested(db: Session) -> bool:
    row = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
    return bool(row and str(row.value).strip().lower() == "true")


def license_status(db: Session) -> dict:
    info = _stored_license(db)
    if info:
        status = {"active": True, "email": info["email"]}
        accepted = db.query(GlobalConfig).filter(GlobalConfig.key == "license_contract_version").first()
        if accepted:
            status["contract_version"] = accepted.value
        if info["kind"] != "signed":
            status["kind"] = info["kind"]
        if info["kind"] == "v2":
            status.update({"id": info["id"], "org": info["org"]})
        return status
    status = {"active": False, "email": None}
    # Le mode est demandé sans licence valable : il reste coupé, les données ne bougent pas
    if org_mode_requested(db):
        status["org_mode_blocked"] = True
    return status
