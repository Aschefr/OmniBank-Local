"""Appels d'outils écrits en texte par le modèle au lieu du format d'Ollama.

Certains petits modèles (gemma4:e4b) écrivent parfois l'appel dans leur réponse, par exemple
<tool_call name="get_account_balances"/>. Ollama ne le reconnaît pas : sans ce filtre, l'outil
n'est pas appelé et la balise s'affiche telle quelle dans le chat.
"""
import json
import re
from typing import Any, Dict, Iterable, List, Tuple

_THINK_SPLIT_RE = re.compile(r'(<think>[\s\S]*?(?:</think>|$))')
# <tool_call name="x" a="1"/>, <tool_call name="x">{...}</tool_call>, <tool_call>{"name": "x", ...}</tool_call>
_TAG_RE = re.compile(
    r'<tool_call\b(?P<attrs>[^>]*?)(?:/>|>(?P<body>[\s\S]*?)</tool_call>)',
    re.IGNORECASE,
)
_ATTR_RE = re.compile(r'([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|\'([^\']*)\')')


def _parse_tag(attrs: str, body: str) -> Tuple[str, Dict[str, Any]]:
    fields = {m.group(1): m.group(2) if m.group(2) is not None else m.group(3) for m in _ATTR_RE.finditer(attrs or "")}
    name = fields.pop("name", "") or ""
    args: Dict[str, Any] = dict(fields)
    body = (body or "").strip()
    if body:
        try:
            data = json.loads(body)
        except ValueError:
            data = None
        if isinstance(data, dict):
            if not name and isinstance(data.get("name"), str):
                name = data["name"]
                inner = data.get("arguments", data.get("parameters", {}))
                if isinstance(inner, str):
                    try:
                        inner = json.loads(inner)
                    except ValueError:
                        inner = {}
                if isinstance(inner, dict):
                    args.update(inner)
            else:
                args.update(data)
    return name.strip(), args


def extract_text_tool_calls(text: str, allowed_names: Iterable[str]) -> Tuple[List[Dict[str, Any]], str]:
    """Retire les balises <tool_call> écrites hors du raisonnement et renvoie les appels d'outils connus,
    au format d'Ollama ({"function": {"name", "arguments"}}), avec le texte nettoyé.
    Une balise vers un outil inconnu est retirée sans être appelée."""
    if not text or "tool_call" not in text.lower():
        return [], text
    allowed = set(allowed_names)
    calls: List[Dict[str, Any]] = []

    def _sub(m: re.Match) -> str:
        name, args = _parse_tag(m.group("attrs"), m.group("body"))
        if name in allowed:
            calls.append({"function": {"name": name, "arguments": args}})
        return ""

    parts = _THINK_SPLIT_RE.split(text)
    cleaned = "".join(p if p.startswith("<think>") else _TAG_RE.sub(_sub, p) for p in parts)
    if cleaned == text:
        return [], text
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return calls, cleaned
