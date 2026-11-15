"""
app/request_profile.py — Profil de la requête ou de la tâche en cours.

Plusieurs personnes peuvent utiliser le même serveur en même temps, chacune sur son profil.
Le profil n'est donc plus seulement celui de profiles.json (« profil par défaut ») :
chaque requête peut nommer le sien (en-tête X-OmniBank-Profile, ou ?omni_profile= pour une URL
ouverte hors fetch), et les tâches de fond qui parcourent les profils travaillent dans le leur.

get_active_profile() lit d'abord ce profil-ci, puis le profil par défaut. Un thread ne reçoit pas
le contexte de celui qui le lance : on lui passe le profil avec bind_profile().
Jamais de cookie pour ce choix : un cookie est commun à tous les onglets d'un navigateur, ce qui
fermerait la porte à un profil par onglet.
"""
import contextvars
from contextlib import contextmanager
from typing import Callable, Optional

PROFILE_HEADER = "X-OmniBank-Profile"
PROFILE_QUERY = "omni_profile"

_current: contextvars.ContextVar = contextvars.ContextVar("omnibank_profile_id", default=None)


def current_profile_id() -> Optional[str]:
    """Profil fixé pour la requête ou la tâche en cours, ou None (profil par défaut)."""
    return _current.get()


@contextmanager
def profile_scope(profile_id: Optional[str]):
    """Travaille dans ce profil le temps du bloc."""
    token = _current.set(profile_id)
    try:
        yield
    finally:
        _current.reset(token)


def bind_profile(fn: Callable, profile_id: Optional[str] = None) -> Callable:
    """Fonction à donner à un thread ou à un exécuteur : elle s'exécute dans le profil courant
    au moment de l'appel à bind_profile (ou dans profile_id s'il est donné)."""
    pid = profile_id if profile_id is not None else _current.get()

    def run(*args, **kwargs):
        with profile_scope(pid):
            return fn(*args, **kwargs)

    run.__name__ = getattr(fn, "__name__", "run")
    return run


def requested_profile_id(request) -> Optional[str]:
    """Profil nommé par le client dans la requête (en-tête, sinon paramètre d'URL)."""
    value = request.headers.get(PROFILE_HEADER) or request.query_params.get(PROFILE_QUERY)
    return value.strip() if value and value.strip() else None
