"""
Cache en mémoire léger pour les endpoints stats coûteux.
Invalidé explicitement à chaque écriture de données (transactions, budgets, comptes, récurrences).
"""
import time
import logging

logger = logging.getLogger(__name__)

# Stockage interne : { "profile_id:cache_key": {"data": ..., "ts": float} }
_cache: dict = {}

# TTL de sécurité maximum (en secondes). Même sans invalidation explicite,
# les entrées expirent après ce délai.
MAX_TTL_SECONDS = 10


def get(profile_id: str, key: str):
    """Retourne les données en cache si valides, sinon None."""
    full_key = f"{profile_id}:{key}"
    entry = _cache.get(full_key)
    if entry is None:
        return None
    if (time.time() - entry["ts"]) > MAX_TTL_SECONDS:
        # TTL expiré — nettoyage silencieux
        _cache.pop(full_key, None)
        return None
    logger.debug(f"[Cache] HIT pour '{key}' (profil={profile_id})")
    return entry["data"]


def set(profile_id: str, key: str, data):
    """Stocke les données en cache avec un timestamp."""
    full_key = f"{profile_id}:{key}"
    _cache[full_key] = {"data": data, "ts": time.time()}
    logger.debug(f"[Cache] SET pour '{key}' (profil={profile_id})")


def invalidate(profile_id: str = None):
    """
    Invalide le cache.
    Si profile_id est fourni, invalide uniquement les clés de ce profil.
    Sinon, invalide tout le cache.
    """
    global _cache
    if profile_id is None:
        count = len(_cache)
        _cache.clear()
        if count > 0:
            logger.debug(f"[Cache] Invalidation globale ({count} entrées supprimées)")
    else:
        keys_to_remove = [k for k in _cache if k.startswith(f"{profile_id}:")]
        for k in keys_to_remove:
            del _cache[k]
        if keys_to_remove:
            logger.debug(f"[Cache] Invalidation profil={profile_id} ({len(keys_to_remove)} entrées supprimées)")
