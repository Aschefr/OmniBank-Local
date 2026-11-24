"""Action annoncée sans appel d'outil : le modèle la remplit en JSON structuré.

Certains modèles (gemma4:e4b) écrivent « J'ai préparé le virement » sans jamais appeler l'outil, même relancés.
Ils remplissent en revanche très bien un formulaire imposé par le paramètre `format` d'Ollama. On leur demande
donc, à partir de la demande et de leur réponse, quelle action ils ont annoncée, puis ses valeurs.

Limites voulues :
- seulement des créations, désignées par des noms : aucune action qui vise un élément par son identifiant
  (que le modèle ne voit pas ici) ni aucune suppression ;
- les comptes et catégories sont imposés parmi ceux qui existent ;
- le résultat reste une carte que l'utilisateur valide ou refuse.
"""
import copy
import json
import logging
from datetime import date
from typing import Any, Dict, List, Tuple

import httpx

from app.services.chat.chat_compression import clean_for_replay
from app.services.chat.tools import TOOL_MAP

logger = logging.getLogger(__name__)

FILLABLE_ACTIONS = (
    "create_planned_transfer",
    "create_recurrence_template",
    "create_budget_envelope",
    "create_category",
    "set_predicted_paycheck",
)
_NONE = "none"


def _params_schema(name: str, accounts: List[str], categories: List[str]) -> Dict[str, Any]:
    schema = copy.deepcopy(TOOL_MAP[name]["function"]["parameters"])
    props = schema["properties"]
    if name == "create_planned_transfer" and accounts:
        for key in ("from_account", "to_account"):
            props[key] = {"type": "string", "enum": accounts}
    if name == "create_recurrence_template" and categories:
        props["category"] = {"type": "string", "enum": categories}
    if name == "create_budget_envelope" and categories:
        props["categories"] = {"type": "array", "items": {"type": "string", "enum": categories}}
    return schema


def _is_complete(name: str, params: Dict[str, Any]) -> bool:
    required = TOOL_MAP[name]["function"]["parameters"].get("required", [])
    if any(params.get(k) in (None, "", []) for k in required):
        return False
    if name == "create_planned_transfer":
        return params["from_account"] != params["to_account"] and float(params["amount"]) > 0
    return True


async def _ask_json(client: httpx.AsyncClient, cfg: Dict[str, Any], prompt: str, schema: Dict[str, Any]) -> Dict[str, Any]:
    payload = {
        "model": cfg["model"], "messages": [{"role": "user", "content": prompt}], "format": schema,
        "stream": False, "think": False, "keep_alive": "30m",
        "options": {"temperature": 0, "num_ctx": cfg["num_ctx"]},
    }
    url = cfg["url"].rstrip("/") + "/api/chat"
    resp = await client.post(url, json=payload)
    if resp.status_code == 400 and "think" in resp.text.lower():
        payload.pop("think")
        resp = await client.post(url, json=payload)
    resp.raise_for_status()
    try:
        data = json.loads((resp.json().get("message") or {}).get("content") or "{}")
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


async def fill_announced_actions(
    cfg: Dict[str, Any], request_text: str, answer_text: str,
    accounts: List[str], categories: List[str], lang: str = "fr",
) -> List[Tuple[str, Dict[str, Any]]]:
    """(outil, paramètres) des actions que la réponse dit avoir préparées. Lève httpx.HTTPError si Ollama échoue."""
    answer = clean_for_replay(answer_text)
    en = lang == "en"
    context = (
        f"User request: {request_text}\n\nAssistant answer:\n{answer}\n\n" if en else
        f"Demande de l'utilisateur : {request_text}\n\nRéponse de l'assistant :\n{answer}\n\n"
    )
    choices = "\n".join(f"- {n}: {TOOL_MAP[n]['function']['description']}" for n in FILLABLE_ACTIONS)
    pick_prompt = context + (
        f"Possible actions:\n{choices}\n\nWhich of these actions does the answer say it prepared? "
        f"Answer \"{_NONE}\" if it prepared none of them."
        if en else
        f"Actions possibles :\n{choices}\n\nLesquelles de ces actions la réponse dit-elle avoir préparées ? "
        f"Répondez « {_NONE} » si elle n'en a préparé aucune."
    )
    pick_schema = {
        "type": "object", "required": ["actions"],
        "properties": {"actions": {"type": "array", "items": {"type": "string", "enum": [*FILLABLE_ACTIONS, _NONE]}}},
    }
    today = date.today().isoformat()
    refs = (
        f"Today: {today}.\nExisting accounts: {', '.join(accounts)}.\nExisting categories: {', '.join(categories)}.\n"
        if en else
        f"Date du jour : {today}.\nComptes existants : {', '.join(accounts)}.\nCatégories existantes : {', '.join(categories)}.\n"
    )

    found: List[Tuple[str, Dict[str, Any]]] = []
    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=15.0)) as client:
        picked = (await _ask_json(client, cfg, pick_prompt, pick_schema)).get("actions") or []
        for name in dict.fromkeys(n for n in picked if n in FILLABLE_ACTIONS):
            fill_prompt = context + refs + (
                f"Fill in the action \"{name}\" announced in the answer, with exactly its values."
                if en else
                f"Remplissez l'action « {name} » annoncée dans la réponse, avec exactement ses valeurs."
            )
            params = await _ask_json(client, cfg, fill_prompt, _params_schema(name, accounts, categories))
            try:
                complete = _is_complete(name, params)
            except (TypeError, ValueError):
                complete = False
            if complete:
                found.append((name, params))
            else:
                logger.info(f"[Chat] Action annoncée {name} : valeurs incomplètes en JSON, pas de carte ({params})")
    return found
