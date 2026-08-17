"""
Tests unitaires pour la gestion des taux d'intérêt sur livrets et crédits/emprunts.
"""
import pytest
from app.services.loan_engine import compute_amortization_monthly, compute_savings_estimated_interest


def test_compute_savings_estimated_interest():
    # Livret A à 3.00% avec 10 000 € pour l'année entière (12 mois)
    res = compute_savings_estimated_interest(10000.0, 3.0, 12)
    assert res["estimated_interest"] == 300.0
    assert res["balance"] == 10000.0
    assert res["rate_pct"] == 3.0

    # Prorata 6 mois
    res_half = compute_savings_estimated_interest(10000.0, 3.0, 6)
    assert res_half["estimated_interest"] == 150.0


def test_compute_amortization_monthly():
    # Emprunt avec CRD = 100 000 €, Taux = 1.20%, Mensualité = 500 €
    # Intérêts mois = 100 000 * 0.012 / 12 = 100.00 €
    # Capital amorti = 500 - 100 = 400.00 €
    res = compute_amortization_monthly(
        crd=-100000.0,
        annual_rate_pct=1.20,
        monthly_payment=500.0,
        insurance=20.0
    )
    assert res["interest_month"] == 100.0
    assert res["capital_month"] == 400.0
    assert res["insurance_month"] == 20.0
    assert res["total_monthly"] == 520.0
