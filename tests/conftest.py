import pytest
from app.services import stats_cache

@pytest.fixture(autouse=True)
def auto_invalidate_stats_cache():
    """Garantit qu'aucun reste de cache d'un test précédent ne stagne entre deux tests."""
    stats_cache.invalidate()
    yield
    stats_cache.invalidate()
