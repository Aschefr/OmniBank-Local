"""
app/services/chat/ollama_client.py — Helpers d'appel au serveur Ollama local.
Fournit la configuration et les méthodes d'appel bloquant (sync) et non-bloquant (async).
"""
import logging
from sqlalchemy.orm import Session
from fastapi import HTTPException
import httpx

from app.models import GlobalConfig

logger = logging.getLogger(__name__)


def get_ollama_config(db: Session) -> dict:
    """Return Ollama config dict with keys: enabled, url, model, temperature, num_ctx."""
    def _val(key):
        row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
        return row.value if row else None

    enabled = _val("enable_ai") in ("true", "True", "1")
    return {
        "enabled": enabled,
        "url": _val("ollama_url"),
        "model": _val("ollama_model"),
        "temperature": float(_val("ollama_temperature") or 0.3),
        "num_ctx": int(_val("ollama_context") or 4096),
    }


def call_ollama_sync(prompt: str, cfg: dict, extra_options: dict = None) -> str:
    """Blocking (sync) call to Ollama — use from non-async endpoints only.
    extra_options: additional Ollama options (e.g. num_predict) merged on top of defaults."""
    url = (cfg.get("url") or "").rstrip("/")
    model = cfg.get("model") or ""
    if not url or not model:
        raise HTTPException(status_code=400, detail="Ollama URL ou modèle non configuré dans les paramètres.")
    options = {"temperature": cfg.get("temperature", 0.3), "num_ctx": cfg.get("num_ctx", 4096)}
    format_opt = None
    if extra_options:
        opts_copy = dict(extra_options)
        format_opt = opts_copy.pop("format", None)
        options.update(opts_copy)

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": options,
    }
    if format_opt:
        payload["format"] = format_opt

    try:
        resp = httpx.post(
            f"{url}/api/chat",
            json=payload,
            timeout=httpx.Timeout(300.0, connect=10.0),
        )
        if resp.status_code != 200:
            err_text = resp.text[:300] if resp.text else f"Code HTTP {resp.status_code}"
            raise HTTPException(status_code=502, detail=f"Erreur Ollama ({resp.status_code}) : {err_text}")
        
        res_json = resp.json()
        content = res_json.get("message", {}).get("content", "")
        if not content or not content.strip():
            raise HTTPException(status_code=502, detail="Le modèle Ollama a renvoyé une réponse vide.")
        return content
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Impossible de contacter le serveur Ollama ({url}) : {exc}")


async def call_ollama_async(prompt: str, cfg: dict, extra_options: dict = None) -> str:
    """Non-blocking async call to Ollama — use from async endpoints to avoid blocking the server.
    Même interface que call_ollama_sync, mais utilise httpx.AsyncClient."""
    url = (cfg.get("url") or "").rstrip("/")
    model = cfg.get("model") or ""
    if not url or not model:
        raise HTTPException(status_code=400, detail="Ollama URL ou modèle non configuré dans les paramètres.")
    options = {"temperature": cfg.get("temperature", 0.3), "num_ctx": cfg.get("num_ctx", 4096)}
    format_opt = None
    if extra_options:
        opts_copy = dict(extra_options)
        format_opt = opts_copy.pop("format", None)
        options.update(opts_copy)

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": options,
    }
    if format_opt:
        payload["format"] = format_opt

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            resp = await client.post(f"{url}/api/chat", json=payload)
        if resp.status_code != 200:
            err_text = resp.text[:300] if resp.text else f"Code HTTP {resp.status_code}"
            raise HTTPException(status_code=502, detail=f"Erreur Ollama ({resp.status_code}) : {err_text}")

        res_json = resp.json()
        content = res_json.get("message", {}).get("content", "")
        if not content or not content.strip():
            raise HTTPException(status_code=502, detail="Le modèle Ollama a renvoyé une réponse vide.")
        return content
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Impossible de contacter le serveur Ollama ({url}) : {exc}")


def call_ollama_safe(prompt: str, cfg: dict, extra_options: dict = None) -> str | None:
    """Appel bloquant sécurisé vers Ollama pour les tâches d'arrière-plan (scheduler, AutoPilot).
    Ne lève JAMAIS d'HTTPException et retourne None si Ollama est injoignable ou désactivé."""
    if not cfg or not cfg.get("enabled"):
        return None
    try:
        return call_ollama_sync(prompt, cfg, extra_options)
    except Exception as e:
        logger.warning(f"[OllamaSafe] Échec de l'appel LLM en arrière-plan : {e}")
        return None


async def call_ollama_safe_async(prompt: str, cfg: dict, extra_options: dict = None) -> str | None:
    """Appel asynchrone sécurisé vers Ollama pour les workers d'ingestion AutoPilot.
    Ne lève JAMAIS d'HTTPException et retourne None si Ollama est indisponible."""
    if not cfg or not cfg.get("enabled"):
        return None
    try:
        return await call_ollama_async(prompt, cfg, extra_options)
    except Exception as e:
        logger.warning(f"[OllamaSafe] Échec de l'appel LLM asynchrone : {e}")
        return None
