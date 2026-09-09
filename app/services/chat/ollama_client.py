"""
app/services/chat/ollama_client.py — Helpers d'appel au serveur Ollama local.
Fournit la configuration et les méthodes d'appel bloquant (sync) et non-bloquant (async).
"""
import logging
from typing import Any, Optional, Dict, List
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
    "Your task is to assign the single most appropriate category to each transaction.\n"
    "Rules:\n"
    "1. PREFER using categories present in the provided categories list.\n"
    "2. If no category fits well, you may propose a concise new category name (2-3 words max, Capitalized, e.g. 'Bricolage', 'Jardinage'). Do NOT use conversational filler, punctuation, or generic words like 'Achat', 'Dépense', 'Autre', 'Inconnu'.\n"
    "3. If totally unsure, use null.\n"
    "4. Return ONLY a valid JSON object mapping each transaction description to its category name (or null).\n"
    "Example format:\n"
    '{"LEROY MERLIN": "Logement & Maison", "TRUFFAUT 92": "Jardinage", "UNKNOWN SHOP": null}'
)

BATCH_SMART_LABEL_SYSTEM_PROMPT = (
    "You are an expert expense classifier and merchant identifier for personal finance.\n"
    "You will receive a list of transaction descriptions, a list of authorized categories, and optionally a list of the user's typical transaction naming habits.\n"
    "For each transaction description, your task is to return:\n"
    "1. 'name': A clean commercial merchant name or a matching user habit name (e.g. 'Leroy Merlin', 'Spotify', 'Amazon'). Do NOT add conversational filler, sentence output, or emojis. If unsure, return null.\n"
    "2. 'category': The single most appropriate category. PREFER categories from the authorized list. If none truly fits, you may propose a concise new category name (2-3 words max, Capitalized, e.g. 'Jardinage', 'Animaux'). Do NOT use generic words like 'Achat', 'Dépense', 'Autre', 'Inconnu'. If totally unsure, return null.\n"
    "Rules:\n"
    "- Return ONLY a valid JSON object mapping each transaction description to {'name': ..., 'category': ...}.\n"
    "Example format:\n"
    '{"LEROY MERLIN BRICOLAGE 7501": {"name": "Leroy Merlin", "category": "Logement & Maison"}, "TRUFFAUT 92": {"name": "Truffaut", "category": "Jardinage"}, "UNKNOWN": {"name": null, "category": null}}'
)

_BANNED_AI_CATEGORY_TOKENS = {
    "unknown", "inconnu", "achat", "paiement", "cb", "prlv", "virement", "vir",
    "transaction", "operation", "autre", "autres", "none", "null", "n/a", "sans nom",
    "depense", "dépense", "depenses", "dépenses", "facture", "prelevement", "carte", "carte bancaire",
    "divers", "fourre-tout", "catégorie", "categorie", "argent",
    "dépenses diverses", "depenses diverses", "revenus divers", "recettes diverses",
    "dépense diverse", "revenu divers", "revenus", "recettes"
}


def validate_ai_suggested_category(
    suggested_category: Optional[str],
    existing_categories: list[str]
) -> tuple[Optional[str], bool]:
    """
    Garde-fou anti-déchets et anti-hallucination pour les catégories proposées par l'IA.
    1. Longueur : 3 à 35 caractères.
    2. Absence de balisage ou syntaxe : {}, [], <>, \\, ;, ", *, _, http.
    3. Absence de préfixes conversationnels : 'voici', 'je propose', 'catégorie :', 'here is', etc.
    4. Absence de mots parasites génériques.
    5. Proximité lexicale avec les catégories existantes (ratio >= 0.80 ou singulier/pluriel) -> fusion automatique.
    Retourne (nom_validé, est_fusionné_avec_existant).
    Si rejeté, retourne (None, False).
    """
    if not suggested_category:
        return None, False

    cat = str(suggested_category).strip().strip('"\'`*')
    if len(cat) < 3 or len(cat) > 35:
        return None, False

    # Rejet des artefacts de syntaxe ou programmation
    if any(ch in cat for ch in ('{', '}', '[', ']', '<', '>', '\\', ';', '"', '*', '_', '|', ':')):
        return None, False
    if "http://" in cat.lower() or "https://" in cat.lower():
        return None, False

    cat_lower = cat.lower()

    # Rejet des phrases conversationnelles LLM
    if any(prefix in cat_lower for prefix in ("voici", "je propose", "catégorie :", "categorie :", "here is", "category:", "i suggest")):
        return None, False

    # Rejet des tokens interdits
    if cat_lower in _BANNED_AI_CATEGORY_TOKENS:
        return None, False

    # Proximité lexicale avec l'existant (ex: "Alimentations" vs "Alimentation")
    import difflib
    for existing in existing_categories:
        if not existing:
            continue
        ex_clean = existing.strip()
        ex_lower = ex_clean.lower()
        if cat_lower == ex_lower:
            return ex_clean, False
        # Singular / plural check
        if cat_lower.rstrip('s') == ex_lower.rstrip('s'):
            return ex_clean, False
        # Fuzzy match >= 80%
        if difflib.SequenceMatcher(None, cat_lower, ex_lower).ratio() >= 0.80:
            return ex_clean, False

    # Mise en forme propre en Title Case
    formatted_name = " ".join(word.capitalize() for word in cat.split())
    return formatted_name, True


def _parse_and_validate_batch_response(
    raw_content: str,
    descriptions: list[str],
    categories: list[str],
    suggest_names: bool = False
) -> dict[str, Any]:
    """Parse la réponse JSON renvoyée par Ollama et valide les catégories par rapport à la liste autorisée.
    Applique le double garde-fou :
      1. Anti-déchet : rejet des hallucinations ou formats syntaxiques invalides.
      2. Anti-prolifération : maximum 2 nouvelles catégories distinctes par lot, avec fusion lexicale.
    Si suggest_names=True, renvoie {desc: {'name': str|None, 'category': str|None, 'category_is_new': bool}}, sinon {desc: str|None}."""
    import json
    import re

    if suggest_names:
        result: dict[str, Any] = {d: {"name": None, "category": None, "category_is_new": False} for d in descriptions}
    else:
        result: dict[str, Any] = {d: None for d in descriptions}

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

    MAX_NEW_CATEGORIES_PER_BATCH = 2
    new_categories_seen: set[str] = set()

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

        raw_cat = None
        raw_name = None

        if isinstance(val, dict):
            raw_cat = val.get("category")
            raw_name = val.get("name")
        elif val is not None:
            raw_cat = val

        # 1. Validation de la catégorie
        validated_cat = None
        cat_is_new = False
        if raw_cat is not None:
            cat_str = str(raw_cat).strip()
            if cat_str in valid_exact:
                validated_cat = cat_str
                cat_is_new = False
            elif cat_str.lower() in valid_lower:
                validated_cat = valid_lower[cat_str.lower()]
                cat_is_new = False
            else:
                # Catégorie non présente dans la liste existante -> passage au crible des garde-fous
                val_cat, is_new_cat = validate_ai_suggested_category(cat_str, categories)
                if val_cat and not is_new_cat:
                    # Fusion lexicale avec une catégorie existante (ex: singulier/pluriel ou similarité >= 80%)
                    validated_cat = val_cat
                    cat_is_new = False
                elif val_cat and is_new_cat:
                    if not suggest_names:
                        # En classification standard : respect strict des catégories existantes
                        logger.info(f"[OllamaBatch] Catégorie hors liste autorisée '{val_cat}' rejetée en classification stricte pour '{canonical_desc}'")
                        validated_cat = None
                        cat_is_new = False
                    else:
                        val_lower = val_cat.lower()
                        if val_lower in new_categories_seen:
                            # Déjà acceptée dans ce lot
                            validated_cat = val_cat
                            cat_is_new = True
                        elif len(new_categories_seen) < MAX_NEW_CATEGORIES_PER_BATCH:
                            new_categories_seen.add(val_lower)
                            validated_cat = val_cat
                            cat_is_new = True
                            logger.info(f"[OllamaBatch] Nouvelle catégorie IA validée : '{val_cat}' pour '{canonical_desc}' (quota: {len(new_categories_seen)}/{MAX_NEW_CATEGORIES_PER_BATCH})")
                        else:
                            logger.info(f"[OllamaBatch] Quota maximal de nouvelles catégories atteint ({MAX_NEW_CATEGORIES_PER_BATCH}) -> Rejet de '{val_cat}' pour '{canonical_desc}'")
                            validated_cat = None
                            cat_is_new = False
                else:
                    logger.info(f"[OllamaBatch] Catégorie hallucinée/déchet '{cat_str}' rejetée par le garde-fou pour '{canonical_desc}'")
                    validated_cat = None
                    cat_is_new = False

        # 2. Nettoyage préliminaire du nom proposé
        validated_name = None
        if raw_name is not None:
            clean_n = str(raw_name).strip().strip('"\'`*')
            if clean_n and clean_n.lower() not in ("null", "none", "n/a", "unknown", "inconnu"):
                validated_name = clean_n

        if suggest_names:
            result[canonical_desc] = {
                "name": validated_name,
                "category": validated_cat,
                "category_is_new": cat_is_new
            }
        else:
            result[canonical_desc] = validated_cat

    return result



def call_ollama_batch(
    descriptions: list[str],
    categories: list[str],
    cfg: dict = None,
    db: Session = None,
    extra_options: dict = None,
    user_habits: list[str] = None,
    suggest_names: bool = False
) -> dict[str, Any]:
    """Catégorise un lot de descriptions en une seule requête JSON groupée vers Ollama (bloquante/sync).
    Ne lève JAMAIS d'HTTPException et retourne {d: None} (ou {d: {'name': None, 'category': None}}) si Ollama est indisponible ou désactivé.
    Garantit le respect strict des catégories existantes (zéro création de catégorie sauvage)."""
    import json

    if not descriptions:
        return {}

    fallback_empty = {d: {"name": None, "category": None} if suggest_names else None for d in descriptions}

    if cfg is None and db is not None:
        cfg = get_ollama_config(db)

    if not cfg or not cfg.get("enabled"):
        return fallback_empty

    url = (cfg.get("url") or "").rstrip("/")
    model = cfg.get("model") or ""
    if not url or not model:
        return fallback_empty

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
    if user_habits:
        user_payload["user_habits"] = user_habits[:35]

    sys_prompt = BATCH_SMART_LABEL_SYSTEM_PROMPT if suggest_names else BATCH_CATEGORIZATION_SYSTEM_PROMPT

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": sys_prompt},
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
            timeout=httpx.Timeout(300.0, connect=10.0),
        )
        if resp.status_code != 200:
            logger.warning(f"[OllamaBatch] Erreur HTTP Ollama ({resp.status_code}) : {resp.text[:200]}")
            return fallback_empty

        res_json = resp.json()
        content = res_json.get("message", {}).get("content", "")
        return _parse_and_validate_batch_response(content, descriptions, categories, suggest_names=suggest_names)
    except Exception as exc:
        logger.warning(f"[OllamaBatch] Échec de l'appel LLM par lot : {exc}")
        return fallback_empty


async def call_ollama_batch_async(
    descriptions: list[str],
    categories: list[str],
    cfg: dict = None,
    db: Session = None,
    extra_options: dict = None,
    user_habits: list[str] = None,
    suggest_names: bool = False
) -> dict[str, Any]:
    """Version asynchrone non-bloquante de call_ollama_batch pour les routeurs FastAPI."""
    import json

    if not descriptions:
        return {}

    fallback_empty = {d: {"name": None, "category": None} if suggest_names else None for d in descriptions}

    if cfg is None and db is not None:
        cfg = get_ollama_config(db)

    if not cfg or not cfg.get("enabled"):
        return fallback_empty

    url = (cfg.get("url") or "").rstrip("/")
    model = cfg.get("model") or ""
    if not url or not model:
        return fallback_empty

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
    if user_habits:
        user_payload["user_habits"] = user_habits[:35]

    sys_prompt = BATCH_SMART_LABEL_SYSTEM_PROMPT if suggest_names else BATCH_CATEGORIZATION_SYSTEM_PROMPT

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}
        ],
        "stream": False,
        "format": "json",
        "options": options,
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0)) as client:
            resp = await client.post(f"{url}/api/chat", json=payload)
        if resp.status_code != 200:
            logger.warning(f"[OllamaBatch] Erreur HTTP Ollama asynchrone ({resp.status_code}) : {resp.text[:200]}")
            return fallback_empty

        res_json = resp.json()
        content = res_json.get("message", {}).get("content", "")
        return _parse_and_validate_batch_response(content, descriptions, categories, suggest_names=suggest_names)
    except Exception as exc:
        logger.warning(f"[OllamaBatch] Échec de l'appel LLM asynchrone par lot : {exc}")
        return fallback_empty

