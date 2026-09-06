"""
app/services/stats_utils.py
---------------------------
Utilitaires statistiques purs (100% hors-ligne, sans dépendance externe).
Utilisés pour l'analyse des dépenses, l'écrêtage des valeurs aberrantes (Winsorizing)
et la projection budgétaire Auto-Pilot.
"""
import statistics
from typing import List, Tuple


def winsorize_values(
    values: List[float],
    sensitivity: int = 3
) -> Tuple[List[float], List[float], float]:
    """
    Applique un écrêtage de type Winsorizing sur une liste de montants afin d'isoler
    les dépenses exceptionnelles / aberrantes et de calculer un montant récurrent représentatif.

    Args:
        values: Liste de montants (positifs ou négatifs, typiquement abs(amount)).
        sensitivity: Niveau de sensibilité aux outliers (1 à 5).
                     1: Très sensible (écrêtage agressif, facteur 1.5)
                     2: Sensible (facteur 2.0)
                     3: Standard (facteur 2.5, seuil min 200€)
                     4: Modéré (facteur 3.5, seuil min 500€)
                     5: Désactivé (aucun écrêtage)

    Returns:
        Tuple (regular_amounts, outlier_amounts, outlier_excess):
            - regular_amounts: Liste de montants écrêtés (au seuil calculé si dépassé).
            - outlier_amounts: Liste des montants originaux identifiés comme outliers.
            - outlier_excess: Somme totale de l'excédent (surplus au-delà du seuil).
    """
    if not values:
        return [], [], 0.0

    sensitivity_map = {
        1: (1.5, 100.0),
        2: (2.0, 150.0),
        3: (2.5, 200.0),
        4: (3.5, 500.0),
        5: (999.0, 999999.0)
    }
    mult_factor, min_thresh = sensitivity_map.get(sensitivity, (2.5, 200.0))

    if sensitivity >= 5 or len(values) < 3:
        return list(values), [], 0.0

    valid_vals = [float(v) for v in values]
    med = statistics.median(valid_vals)
    if med <= 0:
        return list(values), [], 0.0

    threshold = max(mult_factor * med, min_thresh)

    regular_amounts = []
    outlier_amounts = []
    outlier_excess = 0.0

    for amt in valid_vals:
        if amt > threshold:
            regular_amounts.append(round(threshold, 2))
            outlier_amounts.append(round(amt, 2))
            outlier_excess += (amt - threshold)
        else:
            regular_amounts.append(round(amt, 2))

    return regular_amounts, outlier_amounts, round(outlier_excess, 2)
