"""
OmniBank-Local — Smart Label Service (Façade de rétrocompatibilité).
Ce fichier re-exporte l'ensemble des composants du moteur Smart Label
désormais modularisé dans `app/services/smart_label/`.
Tous les anciens chemins d'importation sont préservés à 100%.
"""

from app.services.smart_label import *  # noqa: F401,F403
from app.services.smart_label import __all__  # noqa: F401
