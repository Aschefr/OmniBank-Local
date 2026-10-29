"""
app/services/pin_session.py — Sessions de déverrouillage des profils protégés par PIN.

Un profil avec PIN n'est accessible via l'API qu'avec un jeton de session obtenu
en fournissant le PIN (en-tête X-OmniBank-Session, cookie omni_session ou
paramètre ?omni_session= pour EventSource / téléchargements).
Les sessions sont en mémoire : un redémarrage du serveur exige de ressaisir le PIN.
"""
import secrets
import threading
import time
from typing import Optional

SESSION_HEADER = "X-OmniBank-Session"
SESSION_COOKIE = "omni_session"
SESSION_QUERY = "omni_session"

SESSION_IDLE_SECONDS = 24 * 3600

# Anti brute-force : MAX_FAILURES échecs par profil sur FAILURE_WINDOW_SECONDS
MAX_FAILURES = 5
FAILURE_WINDOW_SECONDS = 300

_lock = threading.Lock()
_sessions: dict = {}   # token -> {"profile_id": str, "last_seen": float}
_failures: dict = {}   # profile_id -> [timestamps]


def create_session(profile_id: str) -> str:
    token = secrets.token_urlsafe(32)
    with _lock:
        _sessions[token] = {"profile_id": profile_id, "last_seen": time.time()}
    return token


def is_valid(token: Optional[str], profile_id: str) -> bool:
    """Vérifie le jeton pour ce profil et prolonge la session."""
    if not token:
        return False
    now = time.time()
    with _lock:
        sess = _sessions.get(token)
        if not sess:
            return False
        if now - sess["last_seen"] > SESSION_IDLE_SECONDS:
            _sessions.pop(token, None)
            return False
        if sess["profile_id"] != profile_id:
            return False
        sess["last_seen"] = now
        return True


def revoke(token: Optional[str]):
    if token:
        with _lock:
            _sessions.pop(token, None)


def revoke_profile(profile_id: str, keep_token: Optional[str] = None):
    """Révoque toutes les sessions d'un profil (changement/réinitialisation de PIN)."""
    with _lock:
        for tok in [t for t, s in _sessions.items() if s["profile_id"] == profile_id and t != keep_token]:
            _sessions.pop(tok, None)


def get_request_token(request) -> Optional[str]:
    return (
        request.headers.get(SESSION_HEADER)
        or request.query_params.get(SESSION_QUERY)
        or request.cookies.get(SESSION_COOKIE)
    )


def retry_after_seconds(profile_id: str) -> int:
    """Secondes avant un nouvel essai autorisé (0 si autorisé)."""
    now = time.time()
    with _lock:
        recent = [t for t in _failures.get(profile_id, []) if now - t < FAILURE_WINDOW_SECONDS]
        _failures[profile_id] = recent
        if len(recent) < MAX_FAILURES:
            return 0
        return int(FAILURE_WINDOW_SECONDS - (now - recent[0])) + 1


def record_failure(profile_id: str):
    with _lock:
        _failures.setdefault(profile_id, []).append(time.time())


def clear_failures(profile_id: str):
    with _lock:
        _failures.pop(profile_id, None)


def reset_all():
    """Réinitialise l'état (tests)."""
    with _lock:
        _sessions.clear()
        _failures.clear()
