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
    r'TIP|CHEQUE|CHQ|PAIEMENT|ACHAT|OPERATION|OPR|'
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

# Mots-clés géographiques, formes juridiques et mots de liaison génériques non distinctifs
_GENERIC_TOKENS = {
    'PARIS', 'FRANCE', 'COM', 'SAS', 'SARL', 'ONLINE', 'DIRECT', 'PAY',
    'STORE', 'SHOP', 'SERVICE', 'SERVICES', 'FR', 'EU', 'SA', 'WEB',
    # Mots de liaison et articles grammaticaux français (bruit non distinctif marchand)
    'DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'D', 'L', 'UN', 'UNE', 'ET', 'EN', 'AU', 'AUX', 'POUR'
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


# Table d'expansion des acronymes bancaires et institutionnels courants
_BANK_ACRONYMS = {
    'CA': {'CREDIT', 'AGRICOLE'},
    'BP': {'BANQUE', 'POPULAIRE'},
    'BRED': {'BANQUE', 'POPULAIRE', 'BRED'},
    'CE': {'CAISSE', 'EPARGNE'},
    'SG': {'SOCIETE', 'GENERALE'},
    'SOGE': {'SOCIETE', 'GENERALE'},
    'CIC': {'CREDIT', 'INDUSTRIEL', 'COMMERCIAL'},
    'CM': {'CREDIT', 'MUTUEL'},
    'LCL': {'CREDIT', 'LYONNAIS'},
    'BNP': {'BNP', 'PARIBAS'},
    'CPAM': {'SECURITE', 'SOCIALE', 'CPAM', 'AMELI'},
    'CAF': {'ALLOCATIONS', 'FAMILIALES', 'CAF'},
}


def _tokenize(text: str, expand_acronyms: bool = True) -> Set[str]:
    """Extrait les tokens signifiants (alphanumériques) avec expansion des acronymes bancaires."""
    raw_tokens = {t for t in re.split(r'\s+', text.upper()) if t and t.isalnum()}
    if not expand_acronyms:
        return raw_tokens

    expanded = set(raw_tokens)
    for t in raw_tokens:
        if t in _BANK_ACRONYMS:
            expanded.update(_BANK_ACRONYMS[t])
    return expanded


# ── Nom affiché sans IA ──────────────────────────────────────────────────────────────────────────────
# normalize_raw_label sert aussi de clé aux règles apprises : on ne la change pas. display_name_from_label part de
# son résultat pour le nom montré à l'utilisateur quand l'IA ne le propose pas (mots-clés, fourre-tout).
_LEGAL_FORMS = re.compile(r'\b(S\s?A\s?R\s?L|S\s?C\s?A|SASU|SAS|SARL|EURL|SNC|SA|ET CIE|CIE)\b')
_AFTER_BRANCH = re.compile(r'\bSUCCURSALE\b.*$')
_PROCESSOR_CODES = {"UEP", "SUMUP", "ZETTLE", "IZ", "SQ", "STRIPE"}
_PROCESSOR_PAIRS = (("GC", "RE"),)  # GoCardless
_UEP_SUBCODES = {"ALIM", "DAC"}  # codes Système U : rayon alimentation, pompe à carburant
_CARD_PREFIX = re.compile(r'^X\d{4}\s')
_CARD_LABEL_WIDTH = 26  # largeur des libellés de carte du Crédit Agricole : au-delà, le dernier mot est tronqué
# Libellés qu'aucun nettoyage ne rend lisibles : nom fixe, cherché dans le libellé brut en majuscules
_FIXED_NAMES = [
    (re.compile(r'^\d*(\d{4}) ECHEANCE\b'), 'Échéance prêt …{}'),
    (re.compile(r'^\d{5,} CREDIT AGRICOLE\b'), 'Assurance Crédit Agricole'),  # cotisation Pacifica
    (re.compile(r'^CRCAM\b'), 'Prêt Crédit Agricole'),
    (re.compile(r'\b(?:DGFIP|DIRECTION GENERALE DES FINANCES|FINANCES PUBLIQUES|TRESOR PUBLIC)\b'), 'Impôts (DGFiP)'),
]


def display_name_from_label(raw: str) -> str:
    """« X1234 UEP*ALIM SUPER U LYO » → « Super U » ; « ORANGE SA-ORANGE » → « Orange » ;
    « AMAZON EU SARL, SUCCURSALE FRANC » → « Amazon Eu » ; « ACME REINFORCEMENTS ACME REI » → « Acme Reinforcements »."""
    base = normalize_raw_label(raw)
    if not base:
        return (raw or "").strip()
    raw_upper = re.sub(r'\s+', ' ', (raw or '').upper()).strip()
    for pattern, name in _FIXED_NAMES:
        m = pattern.search(raw_upper)
        if m:
            return name.format(*m.groups())
    text = _AFTER_BRANCH.sub(' ', base)
    had_legal_form = bool(_LEGAL_FORMS.search(text))
    text = _LEGAL_FORMS.sub(' ', text)
    tokens = text.split()
    while had_legal_form and len(tokens) > 1 and len(tokens[-1]) == 1:  # reste de « S.A.R.L. et Cie S. »
        tokens = tokens[:-1]
    if len(tokens) > 1 and tokens[0] in _PROCESSOR_CODES:
        had_uep = tokens[0] == "UEP"
        tokens = tokens[1:]
        if had_uep and len(tokens) > 1 and tokens[0] in _UEP_SUBCODES:
            tokens = tokens[1:]
    for a, b in _PROCESSOR_PAIRS:
        if len(tokens) > 2 and tokens[0] == a and tokens[1] == b:
            tokens = tokens[2:]
    # Libellé de carte à pleine largeur : le dernier mot court est une ville ou un mot tronqué
    raw_s = (raw or "").strip()
    if _CARD_PREFIX.match(raw_s) and len(raw_s) >= _CARD_LABEL_WIDTH and len(tokens) > 1 and len(tokens[-1]) <= 5:
        tokens = tokens[:-1]
    # Références de paiement (« AB12CD34EF56GH78 ») : lettres et chiffres mêlés, sans sens pour le lecteur
    tokens = [t for t in tokens if not (len(t) >= 6 and re.search(r'\d', t) and re.search(r'[A-Z]', t))] or tokens
    # Mots répétés, et fin tronquée d'un mot déjà présent (« ACME REI » après « REINFORCEMENTS »)
    kept = []
    for t in tokens:
        if any(t == k or (len(t) < len(k) and k.startswith(t)) for k in kept):
            continue
        kept.append(t)
    name = " ".join(kept).strip()
    if not name:
        return base.title()
    # « Wero vers Jean D » : « vers » reste en minuscules
    return re.sub(r"(?<=\s)Vers(?=\s)", "vers", name.title())
