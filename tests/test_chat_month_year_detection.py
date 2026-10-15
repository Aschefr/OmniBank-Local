"""
Unit tests verifying detect_mentioned_month_year robustness against monetary amounts.
Ensures that financial amounts in the 2000s (e.g. 2036 €, 2000 €) are never misidentified as calendar years.
"""
import pytest
from app.services.chat.chat_orchestrator import detect_mentioned_month_year


def test_monetary_amount_collision_protection():
    # Response mentioning 2036 € spent and October
    text = (
        "• Dépenses IA : Ce poste est également en tension, avec un dépassement de 36 € "
        "(2036 € dépensés contre 2000 € alloués).\n"
        "• salaire de 2520,00 € prévu le 29 octobre."
    )
    y, m = detect_mentioned_month_year(text, default_year=2026, default_month=10)
    assert y == 2026, f"Expected default year 2026, got {y} (amount 2036 € was incorrectly parsed as year)"
    assert m == 10


def test_amount_with_various_currency_formats():
    # 2025 euros, 2030€, 2024 EUR
    text_eur = "Vous avez dépensé 2025 euros ce mois de mars."
    y, m = detect_mentioned_month_year(text_eur, default_year=2026, default_month=10)
    assert y == 2026
    assert m == 3

    text_sym = "Plafond de 2030€ sur le budget."
    y, m = detect_mentioned_month_year(text_sym, default_year=2026, default_month=10)
    assert y == 2026


def test_explicit_calendar_year_detection():
    # Explicit month + year
    text1 = "Quel est mon budget en mars 2025 ?"
    y1, m1 = detect_mentioned_month_year(text1, default_year=2026, default_month=10)
    assert y1 == 2025
    assert m1 == 3

    # Explicit year marker (en 2024, pour 2025)
    text2 = "Donne-moi le bilan pour 2024."
    y2, m2 = detect_mentioned_month_year(text2, default_year=2026, default_month=10)
    assert y2 == 2024
    assert m2 == 10

    # Combined format MM/YYYY
    text3 = "Situation sur 11/2025"
    y3, m3 = detect_mentioned_month_year(text3, default_year=2026, default_month=10)
    assert y3 == 2025
    assert m3 == 11


def test_relative_temporal_keywords():
    y, m = detect_mentioned_month_year("Regarde pour le mois prochain", default_year=2026, default_month=10)
    assert y == 2026
    assert m == 11

    y_prev, m_prev = detect_mentioned_month_year("Comparaison avec le mois dernier", default_year=2026, default_month=10)
    assert y_prev == 2026
    assert m_prev == 9
