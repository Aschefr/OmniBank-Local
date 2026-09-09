"""
OmniBank-Local — Gestionnaire de sessions 2FA interactives (Woob).
Maintient les files de messages bloquantes et le verrouillage inter-threads.
"""

import queue
import threading
import time
from typing import Any, Dict

# Cache mémoire pour les sessions 2FA interactives
# session_id -> {"queue": Queue, "cancelled": bool, "created_at": float}
_TWOFA_SESSIONS: Dict[str, Dict[str, Any]] = {}
_TWOFA_LOCK = threading.Lock()


def register_2fa_session(session_id: str) -> queue.Queue:
    """Enregistre une session 2FA pour attendre une réponse du frontend."""
    q: queue.Queue = queue.Queue()
    with _TWOFA_LOCK:
        _TWOFA_SESSIONS[session_id] = {
            "queue": q,
            "cancelled": False,
            "created_at": time.time(),
        }
    return q


def deliver_2fa_response(session_id: str, response_data: Dict[str, Any]) -> bool:
    """Distribue la réponse 2FA (code OTP ou validation smartphone) à la tâche en attente."""
    with _TWOFA_LOCK:
        session = _TWOFA_SESSIONS.get(session_id)
        if session:
            session["queue"].put(response_data)
            if response_data.get("response_type") == "cancel":
                session["cancelled"] = True
            return True
    return False


def is_2fa_session_cancelled(session_id: str) -> bool:
    """Vérifie si la session 2FA a été annulée par l'utilisateur."""
    with _TWOFA_LOCK:
        sess = _TWOFA_SESSIONS.get(session_id)
        return bool(sess and sess.get("cancelled"))


def unregister_2fa_session(session_id: str):
    """Nettoie la session 2FA."""
    with _TWOFA_LOCK:
        _TWOFA_SESSIONS.pop(session_id, None)
