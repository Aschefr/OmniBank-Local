"""Garde-fou mémoire : le conseiller écrit « c'est noté » ou « j'ai enregistré » sans avoir appelé
store_financial_fact (mesuré en novembre 2026 : gemma4:e4b 40 fois sur 40). Même principe que les actions
annoncées : une relance pour obtenir l'appel, puis un avertissement visible si rien n'a été enregistré."""
import re

MEMORY_TOOLS = {"store_financial_fact", "forget_financial_fact"}

_THINK_RE = re.compile(r'<think>[\s\S]*?</think>\s*')
_CLAIM_RE = re.compile(
    r"\bc['’]est (?:bien )?not[ée]|\bbien not[ée]"
    r"|\bj['’]ai (?:bien |également |aussi |donc )?(?:enregistr[ée]|m[ée]moris[ée]|pris (?:bonne )?note|(?:not[ée]|retenu)(?! que| qu['’]))"
    r"|\bje viens d['’](?:enregistrer|m[ée]moriser|noter)"
    r"|\bje (?:le |la |les |l['’])?(?:retiens|m[ée]morise|garde en (?:m[ée]moire|t[êe]te)|note)\b(?! que| qu['’])"
    r"|\bje m['’]en souviendrai"
    r"|\bi(?: have|['’]ve) (?:also )?(?:noted|saved|stored|recorded|remembered|taken note|made a note)\b"
    r"|\bi(?:['’]ll| will) (?:remember|keep (?:that|this|it) in mind)"
    r"|\b(?:duly|got it,?) noted\b|(?:^|[.!]\s+)noted\b",
    re.IGNORECASE,
)

_NUDGE_FR = (
    "[Message automatique] Votre réponse indique qu'une information a été enregistrée, mais store_financial_fact "
    "n'a pas été appelé : rien n'est en mémoire. Appelez maintenant store_financial_fact avec une clé snake_case "
    "descriptive et la valeur de votre réponse. N'écrivez aucun texte."
)
_NUDGE_EN = (
    "[Automatic message] Your answer says the information was saved, but store_financial_fact was not called, so "
    "nothing is in memory. Call store_financial_fact now with a descriptive snake_case key and the value from your "
    "answer. Do not write any text."
)
_NOTICE_FR = ("\n\n*(⚠️ Cette information n'a pas été enregistrée dans la mémoire de l'assistant. "
              "Vous pouvez l'ajouter vous-même dans « 🧠 Mémoire de l'assistant IA ».)*")
_NOTICE_EN = ("\n\n*(⚠️ This information was not saved to the assistant's memory. "
              "You can add it yourself in “🧠 AI Assistant Memory”.)*")


def claims_memorised(text: str) -> bool:
    """Le texte affirme avoir noté ou enregistré une information (hors raisonnement interne)."""
    return bool(_CLAIM_RE.search(_THINK_RE.sub('', text or '')))


def unsaved_memory_claim(text: str, can_memorise: bool, tools_called) -> bool:
    """Le texte dit « c'est noté » alors qu'aucun outil de mémoire n'a été appelé dans cette réponse."""
    return can_memorise and not (MEMORY_TOOLS & set(tools_called)) and claims_memorised(text)


def memory_nudge(lang: str) -> str:
    return _NUDGE_EN if lang == "en" else _NUDGE_FR


def memory_notice(lang: str) -> str:
    return _NOTICE_EN if lang == "en" else _NOTICE_FR
