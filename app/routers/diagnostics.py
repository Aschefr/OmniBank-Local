# app/routers/diagnostics.py
"""
Router for system diagnostics and privacy-preserving error report generation.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.diagnostic_service import get_diagnostic_report, clear_diagnostic_buffers

router = APIRouter(prefix="/api/diagnostics", tags=["diagnostics"])


@router.get("/report")
def get_report(db: Session = Depends(get_db)):
    """Returns the full sanitized diagnostic report."""
    return get_diagnostic_report(db_session=db)


@router.post("/clear")
def clear_report():
    """Clears the local in-memory log and exception buffers."""
    clear_diagnostic_buffers()
    return {"status": "ok", "message": "Diagnostic buffers cleared."}
