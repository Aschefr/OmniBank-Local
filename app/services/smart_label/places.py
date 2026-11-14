"""
OmniBank-Local — Smart Label : mots non distinctifs (lieux).

Un libellé de carte porte le commerçant puis la ville : « X1234 FRESHMART MORVANCE », « X1234 CAPI MODE MORVANCE ».
Le nom de la ville revient chez tous les commerçants du village ; pris pour un nom de commerçant, il rapproche un
laboratoire d'un supermarché ou d'un prêt immobilier nommé d'après la maison. On le reconnaît dans les données de
l'utilisateur, sans liste de villes : un mot présent dans les libellés bancaires d'au moins trois commerçants différents,
dont aucun ne porte ce mot dans son nom, ne désigne pas un commerçant. Quand les noms donnés reprennent la ville
(« FreshMart Morvance »), sa position la trahit : elle termine les libellés de commerçants différents.
"""

from collections import defaultdict
from typing import Dict, FrozenSet, Iterable, Set, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from .normalization import _GENERIC_TOKENS, _tokenize, normalize_raw_label

_MIN_MERCHANTS = 3
_MIN_WORD_LEN = 4
_cache: Dict[int, Tuple[tuple, FrozenSet[str]]] = {}


def _words(text: str) -> Set[str]:
    return {t for t in _tokenize(normalize_raw_label(text or ""), expand_acronyms=False) if not t.isdigit()}


def compute_place_words(pairs: Iterable[Tuple[str, str]]) -> FrozenSet[str]:
    """Mots des libellés bancaires (raw, nom donné) partagés par au moins trois commerçants qui ne les portent pas dans
    leur nom. Un mot tronqué en fin de libellé (« MORVA ») compte pour le mot complet (« MORVANCE »)."""
    merchants_by_word: Dict[str, Set[str]] = defaultdict(set)
    for raw, name in pairs:
        name_words = _words(name)
        if not name_words:
            continue
        merchant = " ".join(sorted(name_words))
        for w in _words(raw) - _GENERIC_TOKENS:
            if len(w) < _MIN_WORD_LEN:
                continue
            if any(n.startswith(w) or w.startswith(n) for n in name_words if len(n) >= 3):
                continue
            merchants_by_word[w].add(merchant)

    places = set()
    for w in merchants_by_word:
        merchants = set(merchants_by_word[w])
        for other, seen in merchants_by_word.items():
            if other != w and w.startswith(other):
                merchants |= seen
        if len(merchants) >= _MIN_MERCHANTS:
            places.add(w)
    return frozenset(places | _last_word_places(raw for raw, _ in pairs))


def _last_word_places(raws: Iterable[str]) -> Set[str]:
    """Mots qui terminent les libellés d'au moins trois commerçants différents, reconnus à leur premier mot : la ville
    d'un libellé de carte, même quand les noms donnés la reprennent (« FreshMart Morvance »). Une enseigne vient en tête
    du libellé, pas à la fin."""
    heads: Dict[str, Set[str]] = defaultdict(set)
    for raw in set(raws):
        toks = [t for t in normalize_raw_label(raw or "").split()
                if t.isalnum() and not t.isdigit() and t not in _GENERIC_TOKENS]
        if len(toks) >= 2:
            heads[toks[-1]].add(toks[0])
    places = set()
    for w in heads:
        if len(w) < _MIN_WORD_LEN:
            continue
        merchants = set(heads[w])
        for other, seen in heads.items():
            if other != w and len(other) >= 3 and w.startswith(other):  # « MORVA » : la ville tronquée
                merchants |= seen
        merchants.discard(w)
        if len(merchants) >= _MIN_MERCHANTS:
            places.add(w)
    return places


def place_words(db: Session) -> FrozenSet[str]:
    """Mots de lieu du profil ouvert, recalculés quand les opérations ou les règles changent."""
    from app.models import BankLabelMapping, Transaction
    if db is None:
        return frozenset()
    try:
        fingerprint = (
            tuple(db.query(func.count(Transaction.id), func.max(Transaction.id)).filter(
                Transaction.raw_description.isnot(None)).one()),
            tuple(db.query(func.count(BankLabelMapping.id), func.max(BankLabelMapping.id)).one()),
        )
        key = id(db.get_bind())
        cached = _cache.get(key)
        if cached and cached[0] == fingerprint:
            return cached[1]
        pairs = db.query(Transaction.raw_description, Transaction.description).filter(
            Transaction.raw_description.isnot(None), Transaction.description.isnot(None)).distinct().all()
        pairs += db.query(BankLabelMapping.raw_pattern, BankLabelMapping.clean_description).filter(
            BankLabelMapping.clean_description.isnot(None)).all()
        places = compute_place_words(pairs)
        _cache[key] = (fingerprint, places)
        return places
    except Exception:
        return frozenset()


def is_place_token(token: str, places: FrozenSet[str]) -> bool:
    """Le mot est un lieu, ou le début tronqué d'un lieu (« MOR » pour « MORVANCE »)."""
    t = (token or "").upper()
    return t in places or (len(t) >= 3 and any(p.startswith(t) for p in places))


def distinctive_words(text: str, places: FrozenSet[str]) -> Set[str]:
    return {w for w in _words(text) - _GENERIC_TOKENS if len(w) >= 3 and not is_place_token(w, places)}


def shares_only_places(a: str, b: str, places: FrozenSet[str]) -> bool:
    """Les deux libellés ont chacun un mot distinctif, mais aucun en commun : ce qui les rapproche n'est qu'un lieu.
    Faux quand un côté n'a que des mots de lieu ou génériques : rien ne permet alors d'en juger."""
    if not places:
        return False
    da, db_ = distinctive_words(a, places), distinctive_words(b, places)
    if not da or not db_:
        return False
    for x in da:
        for y in db_:
            if x == y or x.startswith(y) or y.startswith(x):
                return False
    return True
