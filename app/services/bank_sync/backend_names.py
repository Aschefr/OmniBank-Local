"""
OmniBank-Local — Nom des connexions dans woob.

woob range la session d'une banque (cookies, appareil de confiance 2FA) dans woob_storage.json sous le nom de la
connexion. Chaque profil numérote ses connexions à partir de 1 : sans le profil dans le nom, deux profils clients de la
même banque partageraient la même session. Les sessions enregistrées sous l'ancien nom sont reprises une fois, seulement
quand un seul profil a cette connexion ; sinon elles sont oubliées et la banque redemande une validation.
"""

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

_LEGACY_NAME = re.compile(r"^conn_(\d+)_(.+)$")


def backend_instance_name(profile_id: str, connection_id: int, backend: str) -> str:
    return f"{profile_id}_conn_{connection_id}_{backend}"


def migrate_legacy_backend_states(storage) -> None:
    """Renomme les sessions « conn_<id>_<banque> » vers le nom qui porte leur profil."""
    backends = getattr(getattr(storage, "config", None), "values", {}).get("backends") or {}
    legacy = {name: m for name in backends if (m := _LEGACY_NAME.match(name))}
    if not legacy:
        return
    owners = _connection_owners()
    if owners is None:  # une base illisible : rien n'est touché, nouvel essai au prochain démarrage
        return
    for name, m in legacy.items():
        state = backends.pop(name)
        profiles = owners.get((int(m.group(1)), m.group(2)), [])
        if len(profiles) == 1:
            new_name = backend_instance_name(profiles[0], int(m.group(1)), m.group(2))
            backends.setdefault(new_name, state)
            logger.info(f"[BankSync] Session bancaire '{name}' reprise sous '{new_name}'")
        else:
            logger.info(f"[BankSync] Session bancaire '{name}' oubliée ({len(profiles)} profils possibles)")
    storage.config.save()


def _connection_owners() -> Optional[dict]:
    """(id de connexion, banque) -> profils qui ont cette connexion."""
    from sqlalchemy.orm import sessionmaker

    from app.database import get_engine
    from app.models import BankConnection
    from app.profile_manager import load_profiles_data

    owners: dict = {}
    for prof in load_profiles_data().get("profiles", []):
        pid = prof["id"]
        try:
            db = sessionmaker(bind=get_engine(pid))()
            try:
                rows = db.query(BankConnection.id, BankConnection.backend).all()
            finally:
                db.close()
        except Exception as e:
            logger.warning(f"[BankSync] Sessions bancaires non reprises : base du profil '{pid}' illisible ({e})")
            return None
        for conn_id, backend in rows:
            owners.setdefault((conn_id, backend), []).append(pid)
    return owners
