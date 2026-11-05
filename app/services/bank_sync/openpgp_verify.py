"""
OmniBank-Local — Vérification de signatures OpenPGP détachées, sans gpg.

Remplace gpgv pour un seul usage : contrôler les modules bancaires woob. Le format accepté est
volontairement étroit : une unique signature v4 de document binaire, clé RSA d'au moins 2048 bits,
SHA-256/384/512. Tout le reste est refusé. Le trousseau est une donnée de confiance (épinglé ou
validé par le précédent) : ses auto-signatures ne sont donc pas recontrôlées ici.
"""

import hashlib
import struct
import time
from dataclasses import dataclass
from typing import Dict, Iterator, Optional, Tuple

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed

_TAG_SIGNATURE = 2
_TAG_PUBLIC_KEY = 6
_TAG_PUBLIC_SUBKEY = 14

_ALGO_RSA = (1, 3)  # RSA général et RSA signature seule
_HASHES = {8: (hashlib.sha256, hashes.SHA256), 9: (hashlib.sha384, hashes.SHA384), 10: (hashlib.sha512, hashes.SHA512)}
_MIN_RSA_BITS = 2048

_SIGCLASS_BINARY = 0x00
_SIGCLASS_SELF = (0x10, 0x11, 0x12, 0x13, 0x18)
_SIGCLASS_REVOCATION = (0x20, 0x28)

_SUB_CREATED = 2
_SUB_SIG_EXPIRES = 3
_SUB_KEY_EXPIRES = 9
_SUB_ISSUER = 16
_SUB_ISSUER_FPR = 33
_SUB_UNDERSTOOD = (_SUB_CREATED, _SUB_SIG_EXPIRES, _SUB_ISSUER, _SUB_ISSUER_FPR)


class OpenPGPError(ValueError):
    """Donnée OpenPGP illisible ou hors du format accepté."""


@dataclass
class _Key:
    public_key: Optional[rsa.RSAPublicKey]
    created: int
    expires_after: int = 0
    self_sig_created: int = 0
    revoked: bool = False
    primary: Optional["_Key"] = None  # Clé principale d'une sous-clé : sa révocation et son expiration valent pour elle

    def refusal(self, now: float) -> Optional[str]:
        """Motif de refus de la clé à l'instant `now`, ou None si elle est valable."""
        for key, label in ((self, "clé de signature"), (self.primary, "clé principale")):
            if key is None:
                continue
            if key.revoked:
                return f"{label} révoquée"
            if key.expires_after and key.created + key.expires_after < now:
                return f"{label} expirée"
        return None


def _iter_packets(data: bytes) -> Iterator[Tuple[int, bytes]]:
    pos = 0
    while pos < len(data):
        ctb = data[pos]
        pos += 1
        if not ctb & 0x80:
            raise OpenPGPError("en-tête de paquet invalide")
        if ctb & 0x40:  # Nouveau format
            tag = ctb & 0x3F
            first = data[pos]
            if first < 192:
                length, pos = first, pos + 1
            elif first < 224:
                length, pos = ((first - 192) << 8) + data[pos + 1] + 192, pos + 2
            elif first == 255:
                length, pos = struct.unpack_from(">I", data, pos + 1)[0], pos + 5
            else:
                raise OpenPGPError("longueur partielle non acceptée")
        else:  # Ancien format
            tag = (ctb >> 2) & 0x0F
            size = {0: 1, 1: 2, 2: 4}.get(ctb & 3)
            if size is None:
                raise OpenPGPError("longueur indéterminée non acceptée")
            length, pos = int.from_bytes(data[pos:pos + size], "big"), pos + size
        if pos + length > len(data):
            raise OpenPGPError("paquet tronqué")
        yield tag, data[pos:pos + length]
        pos += length


def _read_mpi(body: bytes, pos: int) -> Tuple[int, int]:
    bits = struct.unpack_from(">H", body, pos)[0]
    size = (bits + 7) // 8
    end = pos + 2 + size
    if end > len(body):
        raise OpenPGPError("entier tronqué")
    return int.from_bytes(body[pos + 2:end], "big"), end


def _iter_subpackets(area: bytes) -> Iterator[Tuple[int, bool, bytes]]:
    pos = 0
    while pos < len(area):
        first = area[pos]
        if first < 192:
            length, pos = first, pos + 1
        elif first < 255:
            length, pos = ((first - 192) << 8) + area[pos + 1] + 192, pos + 2
        else:
            length, pos = struct.unpack_from(">I", area, pos + 1)[0], pos + 5
        if length < 1 or pos + length > len(area):
            raise OpenPGPError("sous-paquet tronqué")
        kind = area[pos]
        yield kind & 0x7F, bool(kind & 0x80), area[pos + 1:pos + length]
        pos += length


@dataclass
class _Signature:
    sigclass: int
    pub_algo: int
    hash_algo: int
    signed_part: bytes
    quick_check: bytes
    value: bytes
    hashed: bytes
    unhashed: bytes


def _parse_signature(body: bytes) -> _Signature:
    if len(body) < 6 or body[0] != 4:
        raise OpenPGPError("seules les signatures v4 sont acceptées")
    hashed_len = struct.unpack_from(">H", body, 4)[0]
    hashed_end = 6 + hashed_len
    unhashed_len = struct.unpack_from(">H", body, hashed_end)[0]
    unhashed_end = hashed_end + 2 + unhashed_len
    if unhashed_end + 2 > len(body):
        raise OpenPGPError("signature tronquée")
    value, end = _read_mpi(body, unhashed_end + 2)
    if end != len(body):
        raise OpenPGPError("signature suivie de données inattendues")
    return _Signature(
        sigclass=body[1],
        pub_algo=body[2],
        hash_algo=body[3],
        signed_part=body[:hashed_end],
        quick_check=body[unhashed_end:unhashed_end + 2],
        value=value.to_bytes((value.bit_length() + 7) // 8, "big"),
        hashed=body[6:hashed_end],
        unhashed=body[hashed_end + 2:unhashed_end],
    )


def _load_keyring(keyring: bytes) -> Dict[bytes, _Key]:
    """Lit les clés RSA v4 du trousseau, indexées par identifiant (8 octets). Les autres sont ignorées."""
    keys: Dict[bytes, _Key] = {}
    current: Optional[_Key] = None
    primary: Optional[_Key] = None
    for tag, body in _iter_packets(keyring):
        if tag in (_TAG_PUBLIC_KEY, _TAG_PUBLIC_SUBKEY):
            current = None
            if tag == _TAG_PUBLIC_KEY:
                primary = None
            if len(body) < 6 or body[0] != 4:
                continue
            # Toute clé principale v4 est suivie, même inutilisable pour signer : ses sous-clés en dépendent.
            created = struct.unpack_from(">I", body, 1)[0]
            current = _Key(None, created, primary=primary if tag == _TAG_PUBLIC_SUBKEY else None)
            if tag == _TAG_PUBLIC_KEY:
                primary = current
            if body[5] not in _ALGO_RSA:
                continue
            n, pos = _read_mpi(body, 6)
            e, pos = _read_mpi(body, pos)
            if n.bit_length() < _MIN_RSA_BITS:
                continue
            current.public_key = rsa.RSAPublicNumbers(e, n).public_key()
            keys[hashlib.sha1(b"\x99" + struct.pack(">H", len(body)) + body).digest()[-8:]] = current
        elif tag == _TAG_SIGNATURE and current is not None and body[:1] == b"\x04" and len(body) >= 6:
            # Seul l'en-tête est lu : la valeur peut venir d'une clé non RSA (DSA, EdDSA) et n'est pas recontrôlée.
            sigclass = body[1]
            if sigclass in _SIGCLASS_REVOCATION:
                current.revoked = True
            elif sigclass in _SIGCLASS_SELF:
                hashed = body[6:6 + struct.unpack_from(">H", body, 4)[0]]
                sub = {kind: value for kind, _, value in _iter_subpackets(hashed)}
                created = int.from_bytes(sub.get(_SUB_CREATED, b""), "big")
                if created >= current.self_sig_created:
                    current.self_sig_created = created
                    current.expires_after = int.from_bytes(sub.get(_SUB_KEY_EXPIRES, b""), "big")
    return keys


def verify_detached(data: bytes, signature: bytes, keyring: bytes, now: Optional[float] = None) -> None:
    """Vérifie `signature` sur `data` avec une clé de `keyring`. Lève OpenPGPError si elle est refusée."""
    try:
        _verify(data, signature, keyring, time.time() if now is None else now)
    except OpenPGPError:
        raise
    except (IndexError, struct.error, ValueError) as e:
        raise OpenPGPError(f"donnée OpenPGP illisible : {e}") from e


def _verify(data: bytes, signature: bytes, keyring: bytes, now: float) -> None:
    packets = list(_iter_packets(signature))
    if len(packets) != 1 or packets[0][0] != _TAG_SIGNATURE:
        raise OpenPGPError("une seule signature détachée attendue")
    sig = _parse_signature(packets[0][1])
    if sig.sigclass != _SIGCLASS_BINARY:
        raise OpenPGPError("seules les signatures de document binaire sont acceptées")
    if sig.pub_algo not in _ALGO_RSA:
        raise OpenPGPError(f"algorithme de clé non accepté ({sig.pub_algo})")
    if sig.hash_algo not in _HASHES:
        raise OpenPGPError(f"algorithme de hachage non accepté ({sig.hash_algo})")

    hashed = list(_iter_subpackets(sig.hashed))
    for kind, critical, _ in hashed:
        if critical and kind not in _SUB_UNDERSTOOD:
            raise OpenPGPError(f"sous-paquet critique inconnu ({kind})")
    sub = {kind: value for kind, _, value in hashed}
    if len(sub.get(_SUB_CREATED, b"")) != 4:
        raise OpenPGPError("date de signature absente")
    created = int.from_bytes(sub[_SUB_CREATED], "big")

    sig_expires = int.from_bytes(sub.get(_SUB_SIG_EXPIRES, b""), "big")
    if sig_expires and created + sig_expires < now:
        raise OpenPGPError("signature expirée")

    # L'identifiant ne fait que choisir la clé : seule la vérification RSA ci-dessous fait foi.
    all_sub = {kind: value for kind, _, value in list(_iter_subpackets(sig.unhashed)) + hashed}
    key_id = all_sub[_SUB_ISSUER_FPR][-8:] if _SUB_ISSUER_FPR in all_sub else all_sub.get(_SUB_ISSUER)
    key = _load_keyring(keyring).get(key_id or b"")
    if key is None or key.public_key is None:
        raise OpenPGPError("clé de signature absente du trousseau")
    refusal = key.refusal(now)
    if refusal:
        raise OpenPGPError(refusal)

    hash_new, hash_algo = _HASHES[sig.hash_algo]
    digest = hash_new(data + sig.signed_part + b"\x04\xff" + struct.pack(">I", len(sig.signed_part))).digest()
    if digest[:2] != sig.quick_check:
        raise OpenPGPError("signature ne correspondant pas aux données")
    size = (key.public_key.key_size + 7) // 8
    if len(sig.value) > size:
        raise OpenPGPError("valeur de signature trop longue")
    try:
        key.public_key.verify(sig.value.rjust(size, b"\x00"), digest, padding.PKCS1v15(), Prehashed(hash_algo()))
    except InvalidSignature as e:
        raise OpenPGPError("signature invalide") from e
