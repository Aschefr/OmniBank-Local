import pytest
from app.services import stats_cache
from app.profile_manager import set_active_profile

@pytest.fixture(autouse=True)
def reset_test_environment():
    """Garantit l'isolation stricte de l'environnement de test (profil par défaut et cache invalidé)."""
    try:
        set_active_profile("default")
    except Exception:
        pass
    stats_cache.invalidate()
    yield
    try:
        set_active_profile("default")
    except Exception:
        pass
    stats_cache.invalidate()

