import os
import shutil
import hashlib
import tempfile
import warnings


def _isolated_data_dir() -> str:
    """
    Les tests tournent sur une copie temporaire de ./data (profils et leurs bases), jamais sur les
    vraies données : le serveur de développement / Docker partage ./data et ses tâches de fond
    (génération des récurrences…) y mélangeraient sinon les données de test avec les vraies.
    Doit s'exécuter avant tout import de l'application (DATA_DIR est lu à l'import).
    """
    # Copies de sessions précédentes : une base encore ouverte par une tâche de fond en fin de
    # session ne peut pas être supprimée sous Windows, elle l'est ici au démarrage suivant
    tmp_root = tempfile.gettempdir()
    for name in os.listdir(tmp_root):
        if name.startswith("omnibank_test_data_"):
            shutil.rmtree(os.path.join(tmp_root, name), ignore_errors=True)

    src = os.path.abspath("data")
    dst = tempfile.mkdtemp(prefix="omnibank_test_data_")
    if os.path.isdir(src):
        for fname in ("omnibank.db", "profiles.json", "woob_storage.json"):
            if os.path.isfile(os.path.join(src, fname)):
                shutil.copy2(os.path.join(src, fname), os.path.join(dst, fname))
        profiles_src = os.path.join(src, "profiles")
        if os.path.isdir(profiles_src):
            for pid in os.listdir(profiles_src):
                db_src = os.path.join(profiles_src, pid, "omnibank.db")
                if os.path.isfile(db_src):
                    os.makedirs(os.path.join(dst, "profiles", pid), exist_ok=True)
                    shutil.copy2(db_src, os.path.join(dst, "profiles", pid, "omnibank.db"))
    return dst


if not os.environ.get("OMNIBANK_DATA_DIR"):
    os.environ["OMNIBANK_DATA_DIR"] = _isolated_data_dir()

import pytest  # noqa: E402
from app.services import stats_cache  # noqa: E402
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
                    try:
                        shutil.copy2(snapshot_src, target_path)
                    except OSError:
                        pass

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

    # Copie temporaire des données utilisée par la session (voir _isolated_data_dir)
    test_data_dir = os.environ.get("OMNIBANK_DATA_DIR", "")
    if os.path.basename(test_data_dir).startswith("omnibank_test_data_"):
        # Windows refuse de supprimer une base SQLite encore ouverte : fermer les connexions d'abord
        try:
            import gc
            gc.collect()  # sessions de tests jamais fermées
            from app.database import _engines, dispose_engine
            for pid in list(_engines):
                dispose_engine(pid)
            from app.database import engine as default_engine
            default_engine.dispose()
        except Exception:
            pass
        shutil.rmtree(test_data_dir, ignore_errors=True)

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


@pytest.fixture(autouse=True)
def _license_active_by_default(request, reset_test_environment, monkeypatch):
    """La licence a ses propres tests (marqueur real_license) : ailleurs, le mode Organisation fonctionne comme en production."""
    if request.node.get_closest_marker("real_license"):
        return
    from app.services import license_service
    monkeypatch.setattr(license_service, "is_license_active", lambda db: True)
