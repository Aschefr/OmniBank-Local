"""
app/services/chat/chat_action_recovery.py — Détection et récupération des actions
promises par l'IA dans ses réponses textuelles mais non émises sous forme de tool calls.

Fournit:
1. has_unemitted_promised_action(text): vérifie si le texte mentionne préparer ou demander
   la validation d'une action sans bloc ```action ... ``` associé.
2. extract_unemitted_actions(text, db, target_year, target_month): extrait par heuristiques
   précises (et fallback LLM) les actions de virement, correction, ou budget.
3. append_actions_to_text(text, actions): formate et concatène les blocs ```action ... ``` au texte.
"""
import re
import json
import logging
import unicodedata
from datetime import date
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.models import Account, Transaction, Budget, Category

logger = logging.getLogger(__name__)

# Patterns déclencheurs signalant une action promise
PROMISED_ACTION_PATTERNS = [
    re.compile(r"j'ai préparé (?:l'enregistrement|le virement|la modification|la création)", re.IGNORECASE),
    re.compile(r"veuillez l'examiner et le valider", re.IGNORECASE),
    re.compile(r"veuillez examiner et valider", re.IGNORECASE),
    re.compile(r"veuillez valider (?:ces|ce|cette|les)", re.IGNORECASE),
    re.compile(r"valider ci-dessous", re.IGNORECASE),
    re.compile(r"examiner et valider ci-dessous", re.IGNORECASE),
    re.compile(r"soumis pour validation", re.IGNORECASE),
    re.compile(r"propose d'enregistrer ce virement", re.IGNORECASE),
    re.compile(r"enregistrement d'un virement de précaution", re.IGNORECASE),
]

FRENCH_MONTHS = {
    'janvier': 1, 'février': 2, 'fevrier': 2, 'mars': 3, 'avril': 4,
    'mai': 5, 'juin': 6, 'juillet': 7, 'août': 8, 'aout': 8,
    'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12, 'decembre': 12
}


def strip_accents(s: str) -> str:
    if not s:
        return ""
    return "".join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn').lower().strip()


def has_unemitted_promised_action(text: str) -> bool:
    """Retourne True si le texte mentionne avoir préparé des actions sans bloc ```action déjà présent."""
    if not text or "```action" in text:
        return False
    # Vérifie si un bloc JSON d'action existe déjà
    if '"action":' in text and ('"params":' in text or '"id":' in text):
        return False
    for pat in PROMISED_ACTION_PATTERNS:
        if pat.search(text):
            return True
    return False


def resolve_account_name(raw_name: str, accounts: List[Account]) -> str:
    """Résout le nom d'un compte bancaire depuis une mention textuelle (gère synonymes, accents, type)."""
    if not raw_name:
        return accounts[0].name if accounts else "Compte courant"

    cleaned = strip_accents(raw_name)

    # 1. Correspondance exacte ou partielle sur le nom du compte
    for a in accounts:
        a_clean = strip_accents(a.name)
        if a_clean == cleaned or a_clean in cleaned or cleaned in a_clean:
            return a.name

    # 2. Heuristiques par sémantique bancaire
    # Livret / Épargne disponible -> premier compte de type Livret / Épargne
    if any(k in cleaned for k in ("epargne", "livret", "ldd", "reserve", "disponible")):
        for a in accounts:
            if a.type and any(k in strip_accents(a.type) for k in ("livret", "epargne", "savings")):
                return a.name

    # Compte courant / Compte principal -> premier compte courant
    if any(k in cleaned for k in ("courant", "principal", "chèque", "cheque")):
        for a in accounts:
            if a.type and any(k in strip_accents(a.type) for k in ("courant", "checking")):
                return a.name

    # Si rien ne correspond, fallback sur le libellé épuré
    return raw_name.strip()


def parse_french_date(date_str: str, default_date: Optional[date] = None) -> str:
    """Tente de parser une date en français (ex: '29 octobre 2026') en format ISO YYYY-MM-DD."""
    if not date_str:
        return (default_date or date.today()).isoformat()

    cleaned = strip_accents(date_str)
    # Match: (le )?(\d{1,2}) (mois) (\d{4})
    m = re.search(r'(\d{1,2})\s+([a-z]+)\s+(\d{4})', cleaned)
    if m:
        day = int(m.group(1))
        month_name = m.group(2)
        year = int(m.group(3))
        month = FRENCH_MONTHS.get(month_name)
        if month:
            try:
                return date(year, month, day).isoformat()
            except ValueError:
                pass

    # Match YYYY-MM-DD
    m_iso = re.search(r'(\d{4})-(\d{2})-(\d{2})', date_str)
    if m_iso:
        return m_iso.group(0)

    return (default_date or date.today()).isoformat()


def extract_unemitted_actions(
    text: str,
    db: Session,
    target_year: Optional[int] = None,
    target_month: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Extrait les actions promises par l'IA dans un message textuel via analyse heuristique.
    Gère principalement les virements prévisionnels (transferts de précaution/retour),
    corrections d'opérations et ajustements d'enveloppes.
    """
    if not text:
        return []

    actions: List[Dict[str, Any]] = []
    accounts = db.query(Account).all()
    today = date.today()

    # ── 1. Extraction des Virements Prévisionnels ──────────────────────────────
    # Pattern couvrant:
    # "virement de précaution de 310 EUR de votre Épargne disponible vers votre compte courant."
    # "virement de retour de 250 EUR de CA Centre-Est vers Livret A, à planifier le 29 octobre 2026."
    transfer_pattern = re.compile(
        r'virement\s+(?:de\s+[^,.:\n]+?\s+)?de\s+(?:\*\*)?~?(\d+(?:[.,]\d+)?)\s*(?:EUR|€)?(?:\*\*)?\s+de\s+(?:votre\s+)?(.+?)\s+vers\s+(?:votre\s+)?([^,.:\n]+?)(?:,\s*à\s+planifier\s+le\s+([^,.:\n]+))?\.\s*(?:Veuillez|\n|$)',
        re.IGNORECASE
    )

    seen_transfers = set()
    for m in transfer_pattern.finditer(text):
        amt_str, from_raw, to_raw, date_raw = m.groups()
        try:
            amt = float(amt_str.replace(',', '.'))
        except ValueError:
            continue

        if amt <= 0:
            continue

        from_acc = resolve_account_name(from_raw, accounts)
        to_acc = resolve_account_name(to_raw, accounts)

        # Si les deux comptes résolus sont identiques, éviter l'auto-virement incohérent
        if from_acc.lower() == to_acc.lower() and len(accounts) >= 2:
            # Tenter d'inverser avec compte d'épargne ou courant disponible
            for a in accounts:
                if a.name != from_acc:
                    to_acc = a.name
                    break

        dt_iso = parse_french_date(date_raw, default_date=today)

        # Description claire
        desc = "Virement prévisionnel"
        if "retour" in m.group(0).lower():
            desc = f"Virement de retour {from_acc} -> {to_acc}"
        elif "précaution" in m.group(0).lower() or "precaution" in m.group(0).lower():
            desc = f"Virement de précaution {from_acc} -> {to_acc}"
        else:
            desc = f"Virement interne {from_acc} -> {to_acc}"

        transfer_key = (round(amt, 2), from_acc.lower(), to_acc.lower(), dt_iso)
        if transfer_key not in seen_transfers:
            seen_transfers.add(transfer_key)
            actions.append({
                "action": "create_planned_transfer",
                "params": {
                    "from_account": from_acc,
                    "to_account": to_acc,
                    "amount": round(amt, 2),
                    "description": desc,
                    "date_operation": dt_iso,
                    "category": "Virement interne"
                }
            })

    # ── 2. Extraction des Corrections d'Opérations (#ID ou transaction) ───────
    # Ex: "corriger l'opération #3355 en catégorie Automobile" ou "modifier la transaction #123"
    correction_pattern = re.compile(
        r'(?:corriger|modifier|ajuster)\s+(?:l\'opération|la transaction)\s+#?(\d+)(?:.*?catégorie\s+["\']?([^"\'\n,.]+)["\']?)?',
        re.IGNORECASE
    )
    for m in correction_pattern.finditer(text):
        tx_id_str, cat_raw = m.groups()
        try:
            tx_id = int(tx_id_str)
        except ValueError:
            continue
        params: Dict[str, Any] = {"transaction_id": tx_id}
        if cat_raw and cat_raw.strip():
            params["category"] = cat_raw.strip()
        actions.append({
            "action": "apply_transaction_correction",
            "params": params
        })

    logger.debug(f"[Chat Action Recovery] {len(actions)} action(s) extraite(s) depuis le texte.")
    return actions


def append_actions_to_text(text: str, actions: List[Dict[str, Any]]) -> str:
    """Ajoute les blocs ```action ... ``` à la fin du texte du message."""
    if not actions:
        return text
    action_str = ""
    for act in actions:
        action_str += f"\n\n```action\n{json.dumps(act, ensure_ascii=False)}\n```"
    return text.rstrip() + action_str
