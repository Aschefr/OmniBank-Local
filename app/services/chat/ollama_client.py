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


# ─────────────────────────────────────────────────────────────────────────────
# BATCH PROMPTING OLLAMA (Étage 3 - AutoPilot & Smart Label)
# ─────────────────────────────────────────────────────────────────────────────

BATCH_CATEGORIZATION_SYSTEM_PROMPT = (
    "You are an expert expense classifier for personal finance.\n"
    "You will receive a list of transaction descriptions and a list of available categories.\n"
    "Your task is to assign the single most appropriate category to each transaction strictly from the provided categories list.\n"
    "Rules:\n"
    "1. Use ONLY categories present in the provided list. Do NOT invent new categories.\n"
    "2. If no category fits well, use null.\n"
    "3. Return ONLY a valid JSON object mapping each transaction description to its category name (or null).\n"
    "Example format:\n"
    '{"LEROY MERLIN": "Logement & Maison", "UNKNOWN SHOP": null}'
)


def _parse_and_validate_batch_response(
    raw_content: str,
    descriptions: list[str],
    categories: list[str]
) -> dict[str, str | None]:
    """Parse la réponse JSON renvoyée par Ollama et valide les catégories par rapport à la liste autorisée.
    Rejette toute hallucination en la forçant à None (garde-fou anti-prolifération)."""
    import json
    import re

    result: dict[str, str | None] = {d: None for d in descriptions}
    if not raw_content or not raw_content.strip():
        return result

    text = raw_content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        data = json.loads(text)
    except Exception as exc:
        logger.warning(f"[OllamaBatch] Erreur de parsing JSON de la réponse LLM : {exc}")
        return result

    if not isinstance(data, dict):
        logger.warning(f"[OllamaBatch] Réponse LLM inattendue (type {type(data)} au lieu d'un dictionnaire JSON)")
        return result

    # Indexation insensible à la casse des descriptions attendues
    desc_lookup = {d.strip().lower(): d for d in descriptions}

    # Indexation stricte et insensible à la casse des catégories valides
    valid_exact = set(categories)
    valid_lower = {c.strip().lower(): c for c in categories if c and c.strip()}

    for key, val in data.items():
        canonical_desc = desc_lookup.get(str(key).strip().lower())
        if not canonical_desc:
            # Clé renvoyée par le LLM légèrement altérée -> recherche par sous-chaîne
            for d in descriptions:
                if str(key).strip().lower() in d.lower() or d.lower() in str(key).strip().lower():
                    canonical_desc = d
                    break

        if not canonical_desc:
            continue

        if val is None:
            result[canonical_desc] = None
            continue

        val_str = str(val).strip()
        if not val_str:
            result[canonical_desc] = None
            continue

        # Vérification d'appartenance à la liste autorisée
        if val_str in valid_exact:
            result[canonical_desc] = val_str
        elif val_str.lower() in valid_lower:
            result[canonical_desc] = valid_lower[val_str.lower()]
        else:
            logger.info(f"[OllamaBatch] Catégorie hallucinée '{val_str}' rejetée pour '{canonical_desc}' -> Forcée à None")
            result[canonical_desc] = None

    return result


def call_ollama_batch(
    descriptions: list[str],
    categories: list[str],
    cfg: dict = None,
    db: Session = None,
    extra_options: dict = None
) -> dict[str, str | None]:
    """Catégorise un lot de descriptions en une seule requête JSON groupée vers Ollama (bloquante/sync).
    Ne lève JAMAIS d'HTTPException et retourne {d: None} si Ollama est indisponible ou désactivé.
    Garantit le respect strict des catégories existantes (zéro création de catégorie sauvage)."""
    import json

    if not descriptions:
        return {}

    if cfg is None and db is not None:
        cfg = get_ollama_config(db)

    if not cfg or not cfg.get("enabled"):
        return {d: None for d in descriptions}

    url = (cfg.get("url") or "").rstrip("/")
    model = cfg.get("model") or ""
    if not url or not model:
        return {d: None for d in descriptions}

    options = {
        "temperature": 0.1,  # Déterminisme maximal pour la classification
        "num_ctx": cfg.get("num_ctx", 4096)
    }
    if extra_options:
        options.update(extra_options)

    user_payload = {
        "categories": categories,
        "transactions": descriptions
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": BATCH_CATEGORIZATION_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}
        ],
        "stream": False,
        "format": "json",
        "options": options,
    }

    try:
        resp = httpx.post(
            f"{url}/api/chat",
            json=payload,
            timeout=httpx.Timeout(45.0, connect=5.0),
        )
        if resp.status_code != 200:
            logger.warning(f"[OllamaBatch] Erreur HTTP Ollama ({resp.status_code}) : {resp.text[:200]}")
            return {d: None for d in descriptions}

        res_json = resp.json()
        content = res_json.get("message", {}).get("content", "")
        return _parse_and_validate_batch_response(content, descriptions, categories)
    except Exception as exc:
        logger.warning(f"[OllamaBatch] Échec de l'appel LLM par lot : {exc}")
        return {d: None for d in descriptions}


async def call_ollama_batch_async(
    descriptions: list[str],
    categories: list[str],
    cfg: dict = None,
    db: Session = None,
    extra_options: dict = None
) -> dict[str, str | None]:
    """Version asynchrone non-bloquante de call_ollama_batch pour les routeurs FastAPI."""
    import json

    if not descriptions:
        return {}

    if cfg is None and db is not None:
        cfg = get_ollama_config(db)

    if not cfg or not cfg.get("enabled"):
        return {d: None for d in descriptions}

    url = (cfg.get("url") or "").rstrip("/")
    model = cfg.get("model") or ""
    if not url or not model:
        return {d: None for d in descriptions}

    options = {
        "temperature": 0.1,
        "num_ctx": cfg.get("num_ctx", 4096)
    }
    if extra_options:
        options.update(extra_options)

    user_payload = {
        "categories": categories,
        "transactions": descriptions
    }

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": BATCH_CATEGORIZATION_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}
        ],
        "stream": False,
        "format": "json",
        "options": options,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=5.0)) as client:
            resp = await client.post(f"{url}/api/chat", json=payload)
        if resp.status_code != 200:
            logger.warning(f"[OllamaBatch] Erreur HTTP Ollama asynchrone ({resp.status_code}) : {resp.text[:200]}")
            return {d: None for d in descriptions}

        res_json = resp.json()
        content = res_json.get("message", {}).get("content", "")
        return _parse_and_validate_batch_response(content, descriptions, categories)
    except Exception as exc:
        logger.warning(f"[OllamaBatch] Échec de l'appel LLM asynchrone par lot : {exc}")
        return {d: None for d in descriptions}

