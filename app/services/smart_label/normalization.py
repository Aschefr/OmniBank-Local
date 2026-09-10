"""
OmniBank-Local — Smart Label : Normalisation et nettoyage des libellés bancaires.
Fournit le nettoyage regex, la suppression du bruit technique, la tokenisation
et la détection des commerçants multi-catégories / libellés de revenus.
"""

import re
from typing import Set

# Marchands caméléons par nature (généralistes multi-catégories)
# Pour ces enseignes, le nom est nettoyé mais aucune catégorie fixe n'est imposée par défaut
_MULTI_CATEGORY_MERCHANTS = {
    'AMAZON', 'PAYPAL', 'CARREFOUR', 'LECLERC', 'AUCHAN', 'MONOPRIX',
    'FNAC', 'LIDL', 'INTERMARCHE', 'ALDI', 'CORA', 'SYSTEME U', 'SUPER U', 'HYPER U',
    'CASINO', 'TABAC', 'RELAY', 'TOTAL', 'ESSO', 'BP', 'SHELL', 'ENI', 'ALIEXPRESS'
}


def is_multi_category_merchant(pattern: str) -> bool:
    """Détecte si un motif normalisé correspond à une enseigne généraliste multi-catégories."""
    if not pattern:
        return False
    pat = pattern.upper().strip()
    if pat in _MULTI_CATEGORY_MERCHANTS:
        return True
    tokens = pat.split()
    if tokens and tokens[0] in _MULTI_CATEGORY_MERCHANTS:
        return True
    return False


# Mots-clés et préfixes bancaires techniques à nettoyer
_BANK_NOISE_REGEX = re.compile(
    r'\b('
    r'CB|CARTE|CARTE\s+BANCAIRE|PRLV|PRELEVEMENT|SEPA|VIR|VIREMENT|INST|INSTANTANE|'
    r'FACTURE|FACT|ECH|ECHEANCE|RETRAIT|DAB|GAB|COTIS|COTISATION|COMMISSION|FRAIS|'
    r'MENSUEL|MENSUELLE|TRIMESTRIEL|TRIMESTRIELLE|ANNUEL|ANNUELLE|'
    r'TIP|CHEQUE|CHQ|AVOIR|REMBOURSEMENT|RMB|PAIEMENT|ACHAT|OPERATION|OPR|'
    r'EMETTEUR|REF|ID|CPT|COMPTE'
    r')\b',
    re.IGNORECASE
)

# Motifs de dates (ex: 12/03, 12/03/24, 12-03-2024, 120324)
_DATE_REGEX = re.compile(r'\b\d{2}[/\-.]\d{2}([/\-.]\d{2,4})?\b')

# Motifs de numéros masqués ou séquences de chiffres longues (ex: *1234, X1234, 123456789)
_NUMBER_NOISE_REGEX = re.compile(r'(\*+|X+|\b)\d{4,}\b|\b\d{2,}\b', re.IGNORECASE)

# Préfixes de passerelles de paiement (ex: PAYPAL *, SUMUP *, STRIPE *, LYDIA *, KLARNA *)
_GATEWAY_PREFIX_REGEX = re.compile(
    r'\b(PAYPAL|SUMUP|STRIPE|LYDIA|KLARNA|AMZN\s*MKTP|AMAZON\s*PAY)\s*(\*|\-|\:|\/|\.)\s*',
    re.IGNORECASE
)

# Nettoyage des caractères de ponctuation résiduels
_PUNCT_REGEX = re.compile(r'[^A-Z0-9\sÀ-ÖØ-öø-ÿ]')

# Mots-clés géographiques ou formes juridiques génériques non distinctifs
_GENERIC_TOKENS = {
    'PARIS', 'FRANCE', 'COM', 'SAS', 'SARL', 'ONLINE', 'DIRECT', 'PAY',
    'STORE', 'SHOP', 'SERVICE', 'SERVICES', 'FR', 'EU', 'SA', 'WEB'
}


def normalize_raw_label(raw: str) -> str:
    """
    Nettoie et normalise un libellé bancaire brut pour en extraire l'essence (marchand/organisme).
    Exemples :
      "CB CARREFOUR 74210 2489" -> "CARREFOUR"
      "PRLV SEPA SAS SPB 948201" -> "SAS SPB"
      "FULLI - mobilis" -> "FULLI MOBILIS"
      "VIR SEPA MR DUPONT JEAN 01/02" -> "MR DUPONT JEAN"
      "CB PAYPAL *STEAM GAMES 1234" -> "STEAM GAMES"
    """
    if not raw:
        return ""

    text = str(raw).strip()

    # 1. Supprimer les motifs de dates
    text = _DATE_REGEX.sub(' ', text)

    # 2. Supprimer les mots-clés bancaires
    text = _BANK_NOISE_REGEX.sub(' ', text)

    # 3. Supprimer les séquences de chiffres / codes postaux / identifiants
    text = _NUMBER_NOISE_REGEX.sub(' ', text)

    # 4. Extraire le sous-marchand réel si précédé d'une passerelle de paiement
    gateway_stripped = _GATEWAY_PREFIX_REGEX.sub(' ', text).strip()
    if len(gateway_stripped) >= 3:
        text = gateway_stripped

    # 5. Supprimer les caractères spéciaux superflus (tirets, ponctuation -> espace)
    text = _PUNCT_REGEX.sub(' ', text.upper())

    # 6. Normaliser les espaces
    tokens = [t.strip() for t in text.split() if len(t.strip()) > 0]
    cleaned = " ".join(tokens)

    # Fallback si le nettoyage a tout effacé (ex: label court uniquement numérique)
    if not cleaned:
        cleaned = re.sub(r'\s+', ' ', str(raw).strip().upper())

    return cleaned


_INCOME_LABEL_REGEX = re.compile(
    r'\b(VIR(EMENT)?\s+(INST(ANTANE)?)?(\s+WERO)?\s+(DE|RECU)|WERO\s+(DE|RECU)|REMISE\s+CHQ|SALAIRE|CAF|CPAM|AVOIR|REMBOURSEMENT)\b',
    re.IGNORECASE
)


def is_probable_income_label(raw_label: str) -> bool:
    """Détecte par heuristique regex si un libellé bancaire brut correspond vraisemblablement à une recette."""
    if not raw_label:
        return False
    return bool(_INCOME_LABEL_REGEX.search(str(raw_label)))


def _tokenize(text: str) -> Set[str]:
    """Extrait les tokens signifiants (alphanumériques)."""
    return {t for t in re.split(r'\s+', text.upper()) if t and t.isalnum()}
