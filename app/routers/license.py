"""Phase 10 – License validation for Organisation Mode."""
import hmac
import hashlib
import base64

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import GlobalConfig

router = APIRouter(prefix="/api/license", tags=["license"])

# ── Ed25519 Public Key (Base64) ──────────────────────────────────────
from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.exceptions import InvalidSignature

PUBLIC_KEY_B64 = "rlAgxcf0MapA13+WZi5CpGg42HhjTth/O40yV5qTxgY="

def verify_key(email: str, key: str) -> bool:
    """Verify a license key matches the email using Ed25519 signature validation."""
    try:
        # Load raw public key from Base64
        pub_bytes = base64.b64decode(PUBLIC_KEY_B64)
        public_key = ed25519.Ed25519PublicKey.from_public_bytes(pub_bytes)
        
        # Decode the license key (signature) from Base64
        signature = base64.b64decode(key.strip())
        
        # Normalize email
        normalized = email.strip().lower().encode("utf-8")
        
        # Verify the signature
        public_key.verify(signature, normalized)
        return True
    except Exception:
        return False



# ── Schemas ──────────────────────────────────────────────────────────
class LicenseActivateRequest(BaseModel):
    email: str
    key: str


# ── Endpoints ────────────────────────────────────────────────────────
@router.get("/status")
def license_status(db: Session = Depends(get_db)):
    """Return current license status."""
    key_row = db.query(GlobalConfig).filter(GlobalConfig.key == "license_key").first()
    email_row = db.query(GlobalConfig).filter(GlobalConfig.key == "license_email").first()
    if key_row and email_row:
        # Passive migration: if the stored key is an old OMNI- key, we trust it as active
        if key_row.value.startswith("OMNI-"):
            return {"active": True, "email": email_row.value}
        # Otherwise, verify it via Ed25519
        if verify_key(email_row.value, key_row.value):
            return {"active": True, "email": email_row.value}
    return {"active": False, "email": None}


@router.post("/activate")
def activate_license(req: LicenseActivateRequest, db: Session = Depends(get_db)):
    """Validate and store a license key."""
    if not req.email or not req.key:
        raise HTTPException(status_code=400, detail="Email et clé requis")

    if req.key.strip().startswith("OMNI-"):
        raise HTTPException(
            status_code=400, 
            detail="Les anciennes clés (OMNI-) ne sont plus acceptées pour les nouvelles activations. Veuillez demander une nouvelle clé."
        )

    if not verify_key(req.email, req.key):
        raise HTTPException(status_code=403, detail="Clé de licence invalide")

    # Store in GlobalConfig (persistent across updates).
    # NOTE: We do NOT uppercase the key as Ed25519 base64 is case-sensitive!
    for k, v in [("license_key", req.key.strip()), ("license_email", req.email.strip().lower())]:
        row = db.query(GlobalConfig).filter(GlobalConfig.key == k).first()
        if row:
            row.value = v
        else:
            db.add(GlobalConfig(key=k, value=v))
    db.commit()
    return {"active": True, "email": req.email.strip().lower()}


@router.post("/deactivate")
def deactivate_license(db: Session = Depends(get_db)):
    """Remove stored license."""
    for k in ["license_key", "license_email"]:
        row = db.query(GlobalConfig).filter(GlobalConfig.key == k).first()
        if row:
            db.delete(row)
    # Also disable org mode
    org = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
    if org:
        org.value = "false"
    db.commit()
    return {"active": False}
