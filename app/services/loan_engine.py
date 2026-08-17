"""
Moteur de calcul financier pour les livrets d'épargne (intérêts créditeurs)
et les crédits/emprunts (intérêts débiteurs et amortissement).
"""
from typing import Dict, List, Optional
from datetime import date


def compute_amortization_monthly(
    crd: float,
    annual_rate_pct: Optional[float],
    monthly_payment: Optional[float],
    insurance: Optional[float] = 0.0
) -> Dict[str, float]:
    """
    Calcule la décomposition mensuelle d'une mensualité d'emprunt :
    - Capital amorti (ce qui réduit la dette)
    - Intérêts du mois (coût financier)
    - Assurance du mois
    - Mensualité totale prélevée
    """
    crd_abs = abs(crd or 0.0)
    rate = annual_rate_pct or 0.0
    payment = monthly_payment or 0.0
    ins = insurance or 0.0

    if crd_abs <= 0.0 or payment <= 0.0:
        return {
            "crd": 0.0,
            "interest_month": 0.0,
            "capital_month": 0.0,
            "insurance_month": ins,
            "total_monthly": ins
        }

    # Intérêts du mois = CRD * (Taux / 12)
    monthly_interest = round(crd_abs * (rate / 100.0) / 12.0, 2)
    
    # Capital amorti = Mensualité hors assurance - Intérêts
    capital_amortized = round(max(0.0, payment - monthly_interest), 2)
    
    # Si le capital amorti dépasse le CRD restant
    if capital_amortized > crd_abs:
        capital_amortized = crd_abs

    total_monthly = round(payment + ins, 2)

    return {
        "crd": round(crd_abs, 2),
        "interest_month": monthly_interest,
        "capital_month": capital_amortized,
        "insurance_month": round(ins, 2),
        "total_monthly": total_monthly
    }


def compute_savings_estimated_interest(
    balance: float,
    annual_rate_pct: Optional[float],
    months_remaining: int = 12
) -> Dict[str, float]:
    """
    Estime les intérêts créditeurs d'un livret d'épargne pour l'année en cours.
    """
    bal = max(0.0, balance or 0.0)
    rate = max(0.0, annual_rate_pct or 0.0)
    months = max(1, min(12, months_remaining))

    estimated = round(bal * (rate / 100.0) * (months / 12.0), 2)

    return {
        "balance": round(bal, 2),
        "rate_pct": round(rate, 2),
        "months_remaining": months,
        "estimated_interest": estimated
    }
