"""
app/services/backup_crypto.py — Chiffrement des profils protégés par PIN dans les sauvegardes globales.

Chaque profil protégé possède une paire de clés X25519 :
- la clé publique (en clair) permet à n'importe qui de CHIFFRER le profil dans une sauvegarde,
  sans connaître le PIN (sauvegarde possible même profil verrouillé) ;
- la clé privée n'est stockée que chiffrée (« emballée ») :
    * slot "pin"      : par le PIN — reste uniquement sur le serveur (un PIN court serait
                        cassable hors-ligne s'il voyageait dans l'archive) ;
    * slot "recovery" : par le code de récupération — inclus dans les archives, il permet
                        de restaurer sur une autre machine.

Format d'un profil chiffré (fichier .omnienc) :
    MAGIC | len(header) (4 octets BE) | header JSON | ciphertext AES-256-GCM
"""
import base64
import json
import os
import struct
import uuid
from datetime import datetime
from typing import Optional

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

MAGIC = b"OMNIENC1"
_KDF_ITERATIONS = 200_000
_HKDF_INFO = b"omnibank-backup-v1"


class DecryptionError(Exception):
    pass


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.b64decode(text.encode("ascii"))


def normalize_secret(secret: str, kind: str) -> str:
    """Les codes de récupération sont insensibles à la casse et aux séparateurs."""
    if kind == "recovery":
        return "".join(c for c in (secret or "").upper() if c.isalnum())
    return (secret or "").strip()


def _derive_wrap_key(secret: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=_KDF_ITERATIONS)
    return kdf.derive(secret.encode("utf-8"))


def _wrap(private_raw: bytes, secret: str) -> dict:
    salt, nonce = os.urandom(16), os.urandom(12)
    ct = AESGCM(_derive_wrap_key(secret, salt)).encrypt(nonce, private_raw, None)
    return {"salt": _b64(salt), "nonce": _b64(nonce), "ct": _b64(ct)}


def _unwrap(slot: dict, secret: str) -> Optional[bytes]:
    try:
        key = _derive_wrap_key(secret, _unb64(slot["salt"]))
        return AESGCM(key).decrypt(_unb64(slot["nonce"]), _unb64(slot["ct"]), None)
    except Exception:
        return None


def _private_raw(private_key: X25519PrivateKey) -> bytes:
    return private_key.private_bytes(
        serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption()
    )


def _public_raw(public_key: X25519PublicKey) -> bytes:
    return public_key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


# ── Gestion des clés d'un profil ─────────────────────────────────────

def new_key_entry(pin: str, recovery_code: Optional[str]) -> dict:
    private_key = X25519PrivateKey.generate()
    raw = _private_raw(private_key)
    entry = {
        "id": uuid.uuid4().hex,
        "public_key": _b64(_public_raw(private_key.public_key())),
        "created_at": datetime.now().isoformat(),
        "pin": _wrap(raw, normalize_secret(pin, "pin")),
        "recovery": None,
    }
    if recovery_code:
        entry["recovery"] = _wrap(raw, normalize_secret(recovery_code, "recovery"))
    return entry


def unwrap_entry(entry: dict, secret: str) -> Optional[bytes]:
    """Retourne la clé privée brute si le secret (PIN ou code de récupération) l'ouvre."""
    for kind in ("pin", "recovery"):
        slot = entry.get(kind)
        if slot:
            raw = _unwrap(slot, normalize_secret(secret, kind))
            if raw:
                return raw
    return None


def rewrap_entry(entry: dict, private_raw: bytes, pin: Optional[str] = None, recovery_code: Optional[str] = None):
    """Ré-emballe la clé privée avec un nouveau PIN et/ou un nouveau code de récupération."""
    if pin is not None:
        entry["pin"] = _wrap(private_raw, normalize_secret(pin, "pin"))
    if recovery_code is not None:
        entry["recovery"] = _wrap(private_raw, normalize_secret(recovery_code, "recovery"))


def entry_for_archive(entry: dict) -> dict:
    """Copie sans le slot PIN (cassable hors-ligne) pour inclusion dans une archive."""
    clean = dict(entry)
    clean["pin"] = None
    return clean


# ── Chiffrement / déchiffrement d'un profil ──────────────────────────

def encrypt_for(entry: dict, plaintext: bytes, profile_id: str) -> bytes:
    recipient = X25519PublicKey.from_public_bytes(_unb64(entry["public_key"]))
    ephemeral = X25519PrivateKey.generate()
    shared = ephemeral.exchange(recipient)
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_HKDF_INFO).derive(shared)
    nonce = os.urandom(12)
    header = {
        "version": 1,
        "profile_id": profile_id,
        "key_id": entry["id"],
        "ephemeral_public_key": _b64(_public_raw(ephemeral.public_key())),
        "nonce": _b64(nonce),
    }
    header_bytes = json.dumps(header).encode("utf-8")
    ct = AESGCM(key).encrypt(nonce, plaintext, header_bytes)
    return MAGIC + struct.pack(">I", len(header_bytes)) + header_bytes + ct


def read_header(blob: bytes) -> dict:
    if not blob.startswith(MAGIC):
        raise DecryptionError("Fichier chiffré invalide.")
    (length,) = struct.unpack(">I", blob[len(MAGIC):len(MAGIC) + 4])
    start = len(MAGIC) + 4
    return json.loads(blob[start:start + length].decode("utf-8"))


def decrypt_with(blob: bytes, private_raw: bytes) -> bytes:
    header = read_header(blob)
    (length,) = struct.unpack(">I", blob[len(MAGIC):len(MAGIC) + 4])
    start = len(MAGIC) + 4
    header_bytes = blob[start:start + length]
    private_key = X25519PrivateKey.from_private_bytes(private_raw)
    shared = private_key.exchange(X25519PublicKey.from_public_bytes(_unb64(header["ephemeral_public_key"])))
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=_HKDF_INFO).derive(shared)
    try:
        return AESGCM(key).decrypt(_unb64(header["nonce"]), blob[start + length:], header_bytes)
    except Exception as e:
        raise DecryptionError("Déchiffrement impossible.") from e
