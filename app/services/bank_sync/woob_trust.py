"""
OmniBank-Local — Confiance dans les modules bancaires woob.

Sans ces garde-fous, woob saute le contrôle de signature s'il ne trouve ni gpg ni gpgv, fait confiance
à la première clé servie par le dépôt, conserve sur disque un index rétrogradé en `signed = 0`, et
efface ses index avant de savoir si le téléchargement aboutira. woob est figé dans requirements.txt :
tests/test_woob_trust.py échoue si une version future ne s'accorde plus avec ces remplacements.
"""

import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Optional

import packaging.version
from woob import __version__ as WOOB_VERSION
from woob.core.repositories import (
    DEFAULT_SOURCES_LIST,
    IProgress,
    Keyring,
    Repositories,
    Repository,
    RepositoryUnavailable,
    Versions,
    open_for_config,
)

from app.services.bank_sync.openpgp_verify import OpenPGPError, verify_detached

logger = logging.getLogger(__name__)

TRUSTED_REPOSITORY_URL = f"https://updates.woob.tech/{packaging.version.Version(WOOB_VERSION).major}/main/"

_KEYRING_BASENAME = Repositories.url2filename(TRUSTED_REPOSITORY_URL)
_INDEX_FILENAME = f"00-{_KEYRING_BASENAME}"
_VERIFIER_NAME = "omnibank-python-openpgp"

_original_repositories_init = Repositories.__init__
_original_parse_index = Repository.parse_index


def pinned_keyring_dir() -> Optional[Path]:
    """Dossier du trousseau livré : dans le bundle PyInstaller ou dans le dépôt. Absent de l'image Docker, qui le préinstalle."""
    bundle = getattr(sys, "_MEIPASS", None)
    candidate = Path(bundle) / "woob-keyring" if bundle else Path(__file__).resolve().parents[3] / "docker" / "woob-keyring"
    return candidate if candidate.is_dir() else None


def _pin_keyring(keyrings_dir: str, modules_dir: str) -> None:
    """Remet le trousseau épinglé à chaque démarrage. Une rotation de clés reste validée par lui lors de l'actualisation."""
    source = pinned_keyring_dir()
    if source is None:
        return
    pinned_gpg = source / f"{_KEYRING_BASENAME}{Keyring.EXTENSION}"
    pinned_version = source / f"{_KEYRING_BASENAME}.version"
    if not pinned_gpg.is_file() or not pinned_version.is_file():
        logger.error(f"[BankSync] Trousseau épinglé incomplet pour {TRUSTED_REPOSITORY_URL} : modules bancaires refusés.")
        return

    os.makedirs(keyrings_dir, exist_ok=True)
    target_gpg = Path(keyrings_dir) / pinned_gpg.name
    target_version = Path(keyrings_dir) / pinned_version.name
    first_pin = not target_gpg.is_file()
    if not first_pin and target_gpg.read_bytes() == pinned_gpg.read_bytes() and target_version.is_file():
        if target_version.read_text(encoding="utf-8").strip() == pinned_version.read_text(encoding="utf-8").strip():
            return
    shutil.copyfile(pinned_gpg, target_gpg)
    shutil.copyfile(pinned_version, target_version)
    logger.info("[BankSync] Trousseau des modules woob épinglé.")

    # Jamais de trousseau jusqu'ici : les modules présents ont été installés sans contrôle. Les marquer
    # périmés les fait retélécharger et vérifier à leur prochain usage ; ils restent utilisables entre-temps.
    if first_pin and os.path.isdir(modules_dir):
        versions = Versions(modules_dir)
        if versions.versions:
            versions.versions = {name: 0 for name in versions.versions}
            versions.save()
            logger.info(f"[BankSync] {len(versions.versions)} module(s) installé(s) sans contrôle : à revérifier.")


def _guarded_repositories_init(self, workdir, datadir, version):
    _pin_keyring(os.path.join(datadir, Repositories.KEYRINGS_DIR), os.path.join(datadir, Repositories.MODULES_DIR, version, Repositories.MODULES_SUBDIR))
    # Avec sources.list déjà là, woob se contente de relire ses index : installation neuve ou
    # existante, le réseau ne passe alors que par refresh_module_index, qui ne casse rien en cas d'échec.
    sources_list = os.path.join(workdir, Repositories.SOURCES_LIST)
    if not os.path.exists(sources_list):
        os.makedirs(workdir, exist_ok=True)
        with open_for_config(sources_list) as f:
            f.write(DEFAULT_SOURCES_LIST)
    _original_repositories_init(self, workdir, datadir, version)


def _guarded_parse_index(self, fp):
    """Passage obligé de tout index, téléchargé ou relu sur disque : woob l'enregistre avant de le juger."""
    _original_parse_index(self, fp)
    if not self.signed or self.url != TRUSTED_REPOSITORY_URL:
        self.modules.clear()
        raise RepositoryUnavailable(f"Index refusé (signed={int(self.signed)}, url={self.url})")


def _is_valid_without_gpg(self, data, sigdata):
    try:
        with open(self.path, "rb") as f:
            verify_detached(data, sigdata, f.read())
        return True
    except (OSError, OpenPGPError) as e:
        logger.warning(f"[BankSync] Signature refusée : {e}")
        return False


def install_woob_guards() -> None:
    """Pose les garde-fous sur woob. À appeler avant toute création de `Woob()`."""
    Repositories.__init__ = _guarded_repositories_init
    Repository.parse_index = _guarded_parse_index

    # Windows : pas de gpgv livré, et un gpg trouvé dans le PATH ne doit pas décider (celui de Git refuse
    # les chemins Windows, donc tous les modules). Ailleurs, l'image Docker fournit gpgv : on le garde.
    if os.name == "nt" or not (Keyring.find_gpg() or Keyring.find_gpgv()):
        Keyring.find_gpg = staticmethod(lambda: None)
        Keyring.find_gpgv = staticmethod(lambda: _VERIFIER_NAME)
        Keyring.is_valid = _is_valid_without_gpg


class _Progress(IProgress):
    """Refuse toute première confiance : sans trousseau épinglé, aucune clé servie par le dépôt n'est acceptée."""

    def progress(self, percent, message):
        logger.debug(f"[BankSync] {message}")

    def error(self, message):
        logger.warning(f"[BankSync] {message}")

    def prompt(self, message):
        logger.error("[BankSync] Trousseau absent : clé proposée par le dépôt refusée.")
        return False


def _current_repository(repositories: Repositories) -> Optional[Repository]:
    return next((r for r in repositories.repositories if r.url == TRUSTED_REPOSITORY_URL), None)


def index_path(repositories: Repositories) -> str:
    return os.path.join(repositories.repos_dir, _INDEX_FILENAME)


def keyring_outdated(repositories: Repositories) -> bool:
    """L'index annonce des clés plus récentes que le trousseau : à actualiser sans attendre."""
    current = _current_repository(repositories)
    if current is None:
        return False
    return current.key_update > Keyring(os.path.join(repositories.keyrings_dir, _KEYRING_BASENAME)).version


def refresh_module_index(repositories: Repositories) -> bool:
    """
    Remplace l'index des modules, seulement une fois le nouveau jugé bon : en cas de panne réseau ou de
    refus, l'index et les modules en place ne bougent pas. Les modules eux-mêmes sont mis à jour plus
    tard, un par un et après vérification, par `repositories.install`. Retourne True si l'index a changé.
    """
    keyring_path = os.path.join(repositories.keyrings_dir, _KEYRING_BASENAME)
    try:
        repositories.load_browser()
        repository = Repository(TRUSTED_REPOSITORY_URL)
        repository.retrieve_index(repositories.browser, None)
        if not repository.modules:
            raise RepositoryUnavailable("Index vide")
        current = _current_repository(repositories)
        if current is not None and repository.update < current.update:
            raise RepositoryUnavailable(f"Index plus ancien que celui en place ({repository.update} < {current.update})")
        repository.retrieve_keyring(repositories.browser, keyring_path, _Progress())
        repository.save(index_path(repositories), private=True)
    except Exception as e:  # Réseau, signature, index illisible : l'existant doit survivre à tout échec
        logger.warning(f"[BankSync] Index des modules bancaires non actualisé : {type(e).__name__}: {e}")
        return False
    repositories.repositories = [repository]
    logger.info(f"[BankSync] Index des modules bancaires actualisé ({repository.update}).")
    return True
