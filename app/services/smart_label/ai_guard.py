"""
OmniBank-Local — Smart Label : Garde-fou anti-déchets et validation IA locale.
Empêche les hallucinations ou noms génériques proposés par le modèle de langage local.
"""

import difflib
import logging
import re
from typing import List, Optional

from .normalization import _GENERIC_TOKENS

logger = logging.getLogger(__name__)

# Tokens et mots parasites rejetés pour les propositions de nom de l'IA (garde-fou anti-déchets)
_BANNED_AI_NAME_TOKENS = {
    "unknown", "inconnu", "achat", "paiement", "cb", "prlv", "virement", "vir",
    "transaction", "operation", "autre", "none", "null", "n/a", "sans nom",
    "depense", "facture", "prelevement", "carte", "carte bancaire",
    "wero", "paylib", "lydia"
}


def validate_ai_suggested_name(
    suggested_name: Optional[str],
    raw_label: str,
    clean_label: str,
    user_habits: Optional[List[str]] = None
) -> Optional[str]:
    """
    Garde-fou anti-déchets pour les noms d'opérations proposés par l'IA.
    Vérifie 4 verrous stricts :
    1. Forme : non-vide, 2 <= longueur <= 60, sans balisage markdown ni ponctuations anormales.
    2. Mots parasites / hallucinations génériques (ex: 'Inconnu', 'Achat', 'Paiement').
    3. Ancrage (Grounding) obligatoire :
       - Soit le nom correspond (ou ressemble à >= 80%) à une habitude enregistrée de l'utilisateur.
       - Soit le nom conserve la racine/token distinctif du commerçant présent dans le libellé brut/nettoyé.
    4. En cas de doute ou de rejet, retourne None (ce qui déclenche le repli sur le nom nettoyé par regex).
    """
    if not suggested_name:
        return None

    name = str(suggested_name).strip().strip('"\'`*')
    # 1. Verrou de forme
    if len(name) < 2 or len(name) > 60:
        return None

    # Rejet des artefacts de syntaxe ou balisage
    if any(ch in name for ch in ('{', '}', '[', ']', '<', '>', '\\')):
        return None

    name_lower = name.lower()

    # 2. Filtrage des mots parasites
    if name_lower in _BANNED_AI_NAME_TOKENS:
        return None

    # Rejet des phrases conversationnelles de LLM
    if any(prefix in name_lower for prefix in ("voici", "nom :", "marchand :", "je pense", "here is", "name:", "merchant:")):
        return None

    # 3. Verrou d'ancrage (Grounding)
    clean_lower = clean_label.lower() if clean_label else ""
    raw_lower = raw_label.lower() if raw_label else ""

    # a) Ancré dans les habitudes de l'utilisateur ?
    if user_habits:
        for habit in user_habits:
            if not habit:
                continue
            h_lower = habit.strip().lower()
            if name_lower == h_lower:
                return name
            if len(h_lower) >= 4 and (name_lower in h_lower or h_lower in name_lower):
                return name
            if difflib.SequenceMatcher(None, name_lower, h_lower).ratio() >= 0.80:
                return name

    # b) Ancré dans le commerçant réel (clean_label ou raw_label) ?
    # Vérifie si au moins un token signifiant (>= 3 lettres non générique) du nom suggéré se trouve dans raw ou clean
    suggested_tokens = {t for t in re.split(r'\s+', name_lower) if len(t) >= 3 and t not in _GENERIC_TOKENS}
    reference_text = f"{clean_lower} {raw_lower}"

    for t in suggested_tokens:
        if t in reference_text:
            return name

    # Aucun ancrage valide -> déchet ou hallucination potentielle
    logger.info(f"[SmartLabel] Nom suggéré par IA '{name}' rejeté par manque d'ancrage pour '{clean_label}' -> Repli sur libellé nettoyé")
    return None
