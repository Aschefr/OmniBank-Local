"""Modèles recommandés pour OmniBank, avec leurs réglages, et leur téléchargement sur un serveur Ollama.

La liste vient d'un banc d'essai sur les tâches d'OmniBank : noms et catégories des libellés bancaires, placement
des catégories en enveloppes, et questions au conseiller (outils appelés, chiffres exacts, rien d'inventé, réponse
dans la langue de l'utilisateur). Voir docs/*/pages/ (modèles recommandés).

Seul Ollama sait télécharger un modèle (/api/pull) ; /api/version le distingue des autres serveurs. Seuls les
modèles de cette liste peuvent être demandés.
"""
import asyncio
import json
import logging

import httpx

logger = logging.getLogger(__name__)

# tier : minimum | recommended | top. size_gb : ce que /api/tags annonce une fois téléchargé. vram_gb : mémoire
# de la carte une fois chargé seul avec num_ctx, en Gio (nvidia-smi moins la carte à vide ; /api/ps la sous-estime).
# typical_seconds : réponse médiane du conseiller, outils compris, mesurée sur une RTX 3090.
# Campagne commune du 2026-11-09 au 11 (ai-bench/CAMPAGNE_2026-11.md), 9 modèles, trois passages, température 0,2,
# contexte 32768 ; gemma4:e4b et gemma4:31b dans leur version du registre du 2026-11-10 :
# - gemma4:e4b : relevé 67-69/120, 42/45 libellés, 90/97 enveloppes, conseiller 16-19/20, ~3,4 s ; le plus léger.
# - bonsai-2:27b (poids ternaires) : 71-72/120, 42/45, 93-94/97, 20/20, ~14,6 s, 9,5 Gio au lieu de ~18.
# - gemma4:31b : 87/120, 44/45, 95/97, 20/20, ~13,8 s ; meilleure note.
CATALOG = [
    {"name": "gemma4:e4b", "tier": "minimum", "size_gb": 6.6, "vram_gb": 5.4, "typical_seconds": 3.4,
     "temperature": 0.2, "num_ctx": 32768},
    {"name": "bonsai-2:27b", "tier": "recommended", "size_gb": 8.3, "vram_gb": 9.5, "typical_seconds": 14.6,
     "temperature": 0.2, "num_ctx": 32768},
    {"name": "gemma4:31b", "tier": "top", "size_gb": 20.4, "vram_gb": 22.2, "typical_seconds": 13.8,
     "temperature": 0.2, "num_ctx": 32768},
]
_NAMES = {m["name"] for m in CATALOG}

# Entre deux lignes de progression : la vérification d'un gros modèle sur un disque lent peut durer des minutes
PULL_TIMEOUT = httpx.Timeout(connect=10.0, read=900.0, write=10.0, pool=10.0)

_pulls: dict = {}  # (url, model) -> {"downloading", "percent", "error"}
_tasks: dict = {}  # (url, model) -> tâche en cours, gardée en vie


def _key(url: str, model: str) -> tuple:
    return (url.rstrip("/"), model)


def pull_state(url: str, model: str) -> dict:
    return _pulls.get(_key(url, model)) or {"downloading": False, "percent": 0, "error": None}


async def is_ollama(url: str) -> bool:
    if not url or not url.startswith(("http://", "https://")):
        return False
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{url.rstrip('/')}/api/version", timeout=5.0)
        return res.status_code == 200 and "version" in res.json()
    except Exception:
        return False


async def installed_models(url: str) -> set:
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{url.rstrip('/')}/api/tags", timeout=5.0)
    res.raise_for_status()
    names = set()
    for m in res.json().get("models", []):
        name = m.get("name") or ""
        names.add(name)
        if name.endswith(":latest"):
            names.add(name[: -len(":latest")])
    return names


async def catalog_for(url: str) -> dict:
    """La liste vue depuis un serveur. downloadable est faux quand il ne sait pas télécharger."""
    installed = set()
    downloadable = await is_ollama(url)
    if downloadable:
        try:
            installed = await installed_models(url)
        except Exception:
            downloadable = False
    return {
        "downloadable": downloadable,
        "models": [{**m, "installed": m["name"] in installed, **pull_state(url, m["name"])} for m in CATALOG],
    }


def _percent(layers: dict, size_gb: float) -> int:
    """Ollama annonce les couches l'une après l'autre : leur total grandit en route. Diviser par la taille attendue
    évite que la barre recule quand une nouvelle couche commence."""
    done = sum(c for c, _ in layers.values())
    total = max(sum(t for _, t in layers.values()), size_gb * 1e9)
    return min(99, int(done * 100 / total))


async def _pull(url: str, model: str) -> None:
    state = _pulls[_key(url, model)]
    size_gb = next(m["size_gb"] for m in CATALOG if m["name"] == model)
    layers = {}
    try:
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", f"{url.rstrip('/')}/api/pull", json={"model": model, "stream": True},
                                     timeout=PULL_TIMEOUT) as res:
                if res.status_code != 200:
                    body = (await res.aread()).decode("utf-8", "replace")
                    try:
                        raise RuntimeError(json.loads(body).get("error") or f"HTTP {res.status_code}")
                    except ValueError:
                        raise RuntimeError(f"HTTP {res.status_code}") from None
                success = False
                async for line in res.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    if data.get("error"):
                        raise RuntimeError(data["error"])
                    if data.get("digest") and data.get("total"):
                        layers[data["digest"]] = (data.get("completed") or 0, data["total"])
                        state["percent"] = max(state["percent"], _percent(layers, size_gb))
                    success = data.get("status") == "success"
        if not success:
            raise RuntimeError("download interrupted")
        state.update(percent=100, error=None)
    except Exception as e:
        logger.warning(f"[Models] Download of {model} on {url} failed: {e}")
        state["error"] = str(e) or e.__class__.__name__
    finally:
        state["downloading"] = False
        _tasks.pop(_key(url, model), None)


def start_pull(url: str, model: str) -> dict:
    """Lance le téléchargement en tâche de fond, ou renvoie celui en cours. Un téléchargement interrompu reprend
    où il s'était arrêté : Ollama garde ce qu'il a déjà."""
    if model not in _NAMES:
        raise ValueError(model)
    key = _key(url, model)
    if key not in _tasks:
        _pulls[key] = {"downloading": True, "percent": 0, "error": None}
        _tasks[key] = asyncio.create_task(_pull(url, model))
    return _pulls[key]
