"""Phase 10 – License validation for Organisation Mode."""
import hmac
import hashlib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import GlobalConfig

router = APIRouter(prefix="/api/license", tags=["license"])

# ── HMAC secret (loaded from gitignored module) ─────────────────────
from app._license_secret import SECRET as _SECRET


def _generate_key(email: str) -> str:
    """Generate a short license key from an email using HMAC-SHA256."""
    normalized = email.strip().lower()
    digest = hmac.new(_SECRET, normalized.encode("utf-8"), hashlib.sha256).digest()
    # Take first 9 bytes → 72 bits → base32 = 15 chars, split into 3 groups of 5
    short = base64.b32encode(digest[:9]).decode("ascii").rstrip("=")[:15]
    return f"OMNI-{short[:5]}-{short[5:10]}-{short[10:15]}"


def verify_key(email: str, key: str) -> bool:
    """Verify a license key matches the email."""
    expected = _generate_key(email)
    return hmac.compare_digest(expected.upper(), key.strip().upper())


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
    if key_row and email_row and verify_key(email_row.value, key_row.value):
        return {"active": True, "email": email_row.value}
    return {"active": False, "email": None}


@router.post("/activate")
def activate_license(req: LicenseActivateRequest, db: Session = Depends(get_db)):
    """Validate and store a license key."""
    if not req.email or not req.key:
        raise HTTPException(status_code=400, detail="Email et clé requis")

    if not verify_key(req.email, req.key):
        raise HTTPException(status_code=403, detail="Clé de licence invalide")

    # Store in GlobalConfig (persistent across updates)
    for k, v in [("license_key", req.key.strip().upper()), ("license_email", req.email.strip().lower())]:
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
