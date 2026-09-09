"""
app/utils/date_utils.py — Utilitaires centralisés de parsing de dates.
Remplace les implémentations dupliquées dans stats.py et budget_service.py.
"""
from datetime import date
from typing import Optional
from fastapi import HTTPException


def safe_parse_date(s: str, fallback: Optional[date] = None) -> Optional[date]:
    """Parse une date YYYY-MM-DD en toute sécurité.
    Si la chaîne est invalide ou absurde, retourne `fallback`.
    """
    if not s:
        return fallback
    try:
        d = date.fromisoformat(s.strip())
        if d.year < 1900 or d.year > 2200:
            return fallback
        return d
    except (ValueError, AttributeError):
        return fallback


def require_date(s: str, param_name: str) -> date:
    """Parse une date et lève HTTPException 400 si invalide."""
    d = safe_parse_date(s)
    if d is None:
        raise HTTPException(
            status_code=400,
            detail=f"Paramètre '{param_name}' invalide : '{s}'. Format attendu : YYYY-MM-DD (ex: 2025-01-15)."
        )
    return d
