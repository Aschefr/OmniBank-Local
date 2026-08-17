import os
import shutil
import hashlib
import tempfile
import warnings
import pytest
from app.services import stats_cache
from app.profile_manager import set_active_profile


def _compute_file_hash(filepath: str) -> str:
    """Calcule le hash SHA-256 d'un fichier pour vérifier son intégrité."""
    if not os.path.isfile(filepath):
        return ""
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


_SNAPSHOT_DIR = None
_BASELINE_HASHES = {}


def pytest_sessionstart(session):
    """
    GARDE-FOU ANTI-CORRUPTION / DATA INTEGRITY SENTINEL
    Prend un instantané de sécurité complet des bases de données locales avant tout test.
    """
    global _SNAPSHOT_DIR, _BASELINE_HASHES
    _SNAPSHOT_DIR = tempfile.mkdtemp(prefix="omnibank_test_guardian_")
    _BASELINE_HASHES = {}

    data_dir = os.path.abspath("data")
    if os.path.isdir(data_dir):
        for fname in ["omnibank.db", "profiles.json"]:
            src = os.path.join(data_dir, fname)
            if os.path.isfile(src):
                dst = os.path.join(_SNAPSHOT_DIR, fname)
                shutil.copy2(src, dst)
                _BASELINE_HASHES[fname] = _compute_file_hash(src)

        profiles_dir = os.path.join(data_dir, "profiles")
        if os.path.isdir(profiles_dir):
            _BASELINE_HASHES["_initial_profile_dirs"] = set(os.listdir(profiles_dir))


def pytest_sessionfinish(session, exitstatus):
    """
    Vérifie l'intégrité des bases après l'exécution des tests.
    Restaure automatiquement l'état initial et émet une alerte si une altération est détectée.
    """
    global _SNAPSHOT_DIR, _BASELINE_HASHES
    data_dir = os.path.abspath("data")
    mutations_detected = []

    if _SNAPSHOT_DIR and os.path.isdir(_SNAPSHOT_DIR):
        for fname in ["omnibank.db", "profiles.json"]:
            target_path = os.path.join(data_dir, fname)
            current_hash = _compute_file_hash(target_path)
            expected_hash = _BASELINE_HASHES.get(fname, "")

            if expected_hash and current_hash != expected_hash:
                mutations_detected.append(fname)
                # Restauration immédiate du snapshot de sécurité
                snapshot_src = os.path.join(_SNAPSHOT_DIR, fname)
                if os.path.isfile(snapshot_src):
                    shutil.copy2(snapshot_src, target_path)

        profiles_dir = os.path.join(data_dir, "profiles")
        initial_dirs = _BASELINE_HASHES.get("_initial_profile_dirs", set())
        if os.path.isdir(profiles_dir):
            current_dirs = set(os.listdir(profiles_dir))
            created_dirs = current_dirs - initial_dirs
            for extra in created_dirs:
                extra_path = os.path.join(profiles_dir, extra)
                try:
                    if os.path.isdir(extra_path):
                        shutil.rmtree(extra_path, ignore_errors=True)
                        mutations_detected.append(f"profiles/{extra} (nettoyé)")
                except Exception:
                    pass

        shutil.rmtree(_SNAPSHOT_DIR, ignore_errors=True)

    if mutations_detected:
        msg = (
            f"\n"
            f"+--------------------------------------------------------------------------------------+\n"
            f"| [OMNIBANK TEST GUARDIAN] ALERTE D'INTEGRITE DES DONNEES                              |\n"
            f"| Des modifications directes ont ete interceptees sur : {', '.join(mutations_detected):<30} |\n"
            f"| -> Le snapshot d'origine a ete AUTOMATIQUEMENT restaure avec succes.                 |\n"
            f"| -> Aucune perte de donnees ni regression n'a ete appliquee a votre environnement.    |\n"
            f"+--------------------------------------------------------------------------------------+\n"
        )
        warnings.warn(UserWarning(msg), stacklevel=2)


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

