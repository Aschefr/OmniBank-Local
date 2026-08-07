"""
Tests unitaires et d'intégration spécifiques pour le système de cache d'Option C (stats_cache.py)
et l'invalidation automatique lors des mutations de données.
"""
import time
import pytest
from app.services import stats_cache


def test_cache_set_get():
    """Vérifie l'écriture et la lecture directe dans le cache."""
    stats_cache.invalidate()
    stats_cache.set("profile_1", "dashboard", {"net_worth": 15000.0})
    
    data = stats_cache.get("profile_1", "dashboard")
    assert data is not None
    assert data["net_worth"] == 15000.0


def test_cache_profile_isolation():
    """Vérifie l'isolation stricte des données entre profils d'utilisateurs."""
    stats_cache.invalidate()
    stats_cache.set("profile_A", "dashboard", {"net_worth": 100.0})
    stats_cache.set("profile_B", "dashboard", {"net_worth": 200.0})
    
    assert stats_cache.get("profile_A", "dashboard")["net_worth"] == 100.0
    assert stats_cache.get("profile_B", "dashboard")["net_worth"] == 200.0
    
    # Invalidation sélective de profile_A
    stats_cache.invalidate("profile_A")
    assert stats_cache.get("profile_A", "dashboard") is None
    assert stats_cache.get("profile_B", "dashboard") is not None


def test_cache_ttl_expiration(monkeypatch):
    """Vérifie que les clés du cache expirent automatiquement après le délai TTL."""
    stats_cache.invalidate()
    now = time.time()
    
    monkeypatch.setattr(time, "time", lambda: now)
    stats_cache.set("profile_1", "accounts", [{"name": "Compte A"}])
    assert stats_cache.get("profile_1", "accounts") is not None
    
    # Simuler le passage de 11 secondes (dépassant MAX_TTL_SECONDS = 10)
    monkeypatch.setattr(time, "time", lambda: now + 11)
    assert stats_cache.get("profile_1", "accounts") is None


def test_cache_global_invalidation():
    """Vérifie que l'invalidation globale vide toutes les clés de tous les profils."""
    stats_cache.invalidate()
    stats_cache.set("prof1", "dashboard", 1)
    stats_cache.set("prof2", "dashboard", 2)
    
    stats_cache.invalidate()
    assert stats_cache.get("prof1", "dashboard") is None
    assert stats_cache.get("prof2", "dashboard") is None
