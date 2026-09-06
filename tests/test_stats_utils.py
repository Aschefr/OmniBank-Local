"""
tests/test_stats_utils.py
-------------------------
Tests unitaires pour les utilitaires statistiques d'Auto-Pilot (Étape 0 / Jalon 0.7).
"""
import pytest
from app.services.stats_utils import winsorize_values


def test_winsorize_empty_or_short():
    # Liste vide
    reg, out, excess = winsorize_values([])
    assert reg == []
    assert out == []
    assert excess == 0.0

    # Moins de 3 éléments -> aucun écrêtage
    reg, out, excess = winsorize_values([50.0, 60.0])
    assert reg == [50.0, 60.0]
    assert out == []
    assert excess == 0.0


def test_winsorize_homogeneous():
    # Dépenses de courses normales : [45, 52, 48, 55, 50] -> médiane = 50
    # Seuil standard (sensibilité 3) : max(2.5 * 50, 200) = 200
    # Aucune valeur ne dépasse 200
    values = [45.0, 52.0, 48.0, 55.0, 50.0]
    reg, out, excess = winsorize_values(values, sensitivity=3)
    assert reg == values
    assert out == []
    assert excess == 0.0


def test_winsorize_with_outlier():
    # Dépenses normales [50, 50, 50] + une dépense exceptionnelle de 600€
    # médiane = 50 -> seuil = max(2.5 * 50, 200) = 200.0
    values = [50.0, 50.0, 50.0, 600.0]
    reg, out, excess = winsorize_values(values, sensitivity=3)

    assert 600.0 in out
    assert excess == 400.0  # 600 - 200 = 400
    assert 200.0 in reg  # Le 600 a été écrêté à 200.0


def test_winsorize_sensitivity_disabled():
    # Sensibilité 5 = désactivé
    values = [50.0, 50.0, 50.0, 1000.0]
    reg, out, excess = winsorize_values(values, sensitivity=5)
    assert reg == values
    assert out == []
    assert excess == 0.0


def test_winsorize_aggressive_sensitivity():
    # Sensibilité 1 : facteur 1.5, seuil min 100€
    # médiane = 80 -> max(1.5 * 80 = 120, 100) = 120.0
    values = [80.0, 80.0, 80.0, 150.0]
    reg, out, excess = winsorize_values(values, sensitivity=1)
    assert out == [150.0]
    assert excess == 30.0  # 150 - 120 = 30
    assert 120.0 in reg
