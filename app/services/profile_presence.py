"""
app/services/profile_presence.py — Profil utilisé en ce moment par chaque client (navigateur, application).

Sert à ne pas couper la route à quelqu'un d'autre : une restauration globale ferme toutes les bases,
elle est refusée tant qu'un autre client utilise un autre profil.
Seules les requêtes des clients comptent (middleware), jamais les tâches de fond. Un client est
reconnu par l'en-tête X-OmniBank-Client s'il l'envoie, sinon par son adresse : changer soi-même
de profil remplace son ancien profil au lieu de compter comme une autre personne.
"""
import threading
import time
from typing import Dict, List, Tuple

CLIENT_HEADER = "X-OmniBank-Client"
ACTIVE_WINDOW_SECONDS = 10 * 60

_lock = threading.Lock()
_clients: Dict[str, Tuple[str, float]] = {}  # client -> (profil, dernière requête)


def client_key(request) -> str:
    explicit = (request.headers.get(CLIENT_HEADER) or "").strip()
    if explicit:
        return f"id:{explicit[:64]}"
    return f"ip:{request.client.host if request.client else '?'}"


def seen(client: str, profile_id: str):
    with _lock:
        _clients[client] = (profile_id, time.time())


def other_active_profiles(client: str, profile_id: str) -> List[str]:
    """Profils, autres que celui-ci, utilisés ces dernières minutes par d'autres clients."""
    from app.profile_manager import load_profiles_data
    existing = {p["id"] for p in load_profiles_data().get("profiles", [])}
    cutoff = time.time() - ACTIVE_WINDOW_SECONDS
    with _lock:
        found = {pid for c, (pid, t) in _clients.items()
                 if c != client and pid != profile_id and t >= cutoff and pid in existing}
    return sorted(found)


def reset_all():
    """Réinitialise l'état (tests)."""
    with _lock:
        _clients.clear()
