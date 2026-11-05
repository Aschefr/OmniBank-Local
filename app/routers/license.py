"""Phase 10 – License validation for Organisation Mode."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.database import get_db
from app.models import GlobalConfig
from app.services.license_service import CONTRACT_VERSION, license_status, read_license

router = APIRouter(prefix="/api/license", tags=["license"])

# ── Schemas ──────────────────────────────────────────────────────────
class LicenseActivateRequest(BaseModel):
    email: str
    key: str
    contract_version: str = ""


# ── Endpoints ────────────────────────────────────────────────────────
@router.get("/status")
def get_license_status(db: Session = Depends(get_db)):
    """Return current license status."""
    return license_status(db)


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

    if not read_license(req.email, req.key):
        raise HTTPException(status_code=403, detail="Clé de licence invalide")

    if req.contract_version != CONTRACT_VERSION:
        raise HTTPException(status_code=400, detail="Le contrat de licence doit être accepté pour activer la clé.")

    # Store in GlobalConfig (persistent across updates).
    # NOTE: We do NOT uppercase the key as Ed25519 base64 is case-sensitive!
    for k, v in [
        ("license_key", req.key.strip()),
        ("license_email", req.email.strip().lower()),
        ("license_contract_version", CONTRACT_VERSION),
        ("license_contract_accepted_at", datetime.now(timezone.utc).isoformat(timespec="seconds")),
    ]:
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
    for k in ["license_key", "license_email", "license_contract_version", "license_contract_accepted_at"]:
        row = db.query(GlobalConfig).filter(GlobalConfig.key == k).first()
        if row:
            db.delete(row)
    # Also disable org mode
    org = db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first()
    if org:
        org.value = "false"
    db.commit()
    return {"active": False}
