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
from datetime import date, timedelta
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session

from app.models import Account, Transaction, Budget, Category

logger = logging.getLogger(__name__)

# Patterns déclencheurs signalant une action promise (Français & Anglais)
PROMISED_ACTION_PATTERNS = [
    # Français
    re.compile(r"j'ai préparé (?:l'enregistrement|le virement|la modification|la création|la clôture|la cloture|la réactivation|la reactivation)", re.IGNORECASE),
    re.compile(r"veuillez l'examiner et le valider", re.IGNORECASE),
    re.compile(r"veuillez l'examiner et la valider", re.IGNORECASE),
    re.compile(r"veuillez examiner et valider", re.IGNORECASE),
    re.compile(r"veuillez valider (?:ces|ce|cette|les)", re.IGNORECASE),
    re.compile(r"valider ci-dessous", re.IGNORECASE),
    re.compile(r"examiner et valider ci-dessous", re.IGNORECASE),
    re.compile(r"soumis pour validation", re.IGNORECASE),
    re.compile(r"propose d'enregistrer ce virement", re.IGNORECASE),
    re.compile(r"enregistrement d'un virement de précaution", re.IGNORECASE),
    re.compile(r"enregistrement de ce virement", re.IGNORECASE),
    re.compile(r"j'ai également préparé l'enregistrement", re.IGNORECASE),
    re.compile(r"je prépare également l'enregistrement", re.IGNORECASE),
    re.compile(r"veuillez examiner les deux virement", re.IGNORECASE),
    # English
    re.compile(r"i have prepared (?:the recording|the transfer|the modification|the creation|the closure|the reactivation)", re.IGNORECASE),
    re.compile(r"please review and validate", re.IGNORECASE),
    re.compile(r"please review and confirm", re.IGNORECASE),
    re.compile(r"please validate (?:this|these|the)", re.IGNORECASE),
    re.compile(r"validate below", re.IGNORECASE),
    re.compile(r"review and validate below", re.IGNORECASE),
    re.compile(r"submitted for validation", re.IGNORECASE),
    re.compile(r"propose to record this transfer", re.IGNORECASE),
    re.compile(r"i also prepared the recording", re.IGNORECASE),
    re.compile(r"i am also preparing the recording", re.IGNORECASE),
]

MONTH_NAMES = {
    # Français
    'janvier': 1, 'février': 2, 'fevrier': 2, 'mars': 3, 'avril': 4,
    'mai': 5, 'juin': 6, 'juillet': 7, 'août': 8, 'aout': 8,
    'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12, 'decembre': 12,
    # English
    'january': 1, 'february': 2, 'march': 3, 'april': 4,
    'may': 5, 'june': 6, 'july': 7, 'august': 8,
    'september': 9, 'october': 10, 'november': 11, 'december': 12
}
# Alias rétrocompatible
FRENCH_MONTHS = MONTH_NAMES


def strip_accents(s: str) -> str:
    if not s:
        return ""
    return "".join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn').lower().strip()


def extract_existing_action_blocks(text: str) -> List[Dict[str, Any]]:
    """Extrait tous les blocs JSON ```action ... ``` ou ```json ... ``` déjà présents dans le texte."""
    if not text:
        return []
    actions = []
    for m in re.finditer(r'```(?:action|json)?\s*(\{[\s\S]*?\})\s*```', text):
        try:
            d = json.loads(m.group(1))
            if isinstance(d, dict) and "action" in d:
                actions.append(d)
        except Exception:
            pass
    return actions


def has_unemitted_promised_action(text: str, db: Optional[Session] = None) -> bool:
    """
    Retourne True si le texte mentionne avoir préparé des actions sans que l'ensemble
    de ces actions n'ait été matérialisé par des blocs ```action associés.
    Gère aussi bien l'absence totale d'action que le cas où 1 action sur 2 a été omise.
    """
    if not text:
        return False

    if db is not None:
        missing = find_missing_promised_actions(text, db)
        return len(missing) > 0

    # Heuristique textuelle rapide sans DB (ex: tests unitaires isolés)
    existing_blocks = extract_existing_action_blocks(text)
    promise_count = sum(1 for pat in PROMISED_ACTION_PATTERNS if pat.search(text))

    if promise_count == 0:
        return False
    if not existing_blocks:
        return True

    return promise_count > len(existing_blocks)


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
    """Tente de parser une date en français (ex: '29 octobre 2026', '30/10/2026') en format ISO YYYY-MM-DD."""
    if not date_str:
        return (default_date or date.today()).isoformat()

    cleaned = strip_accents(date_str).strip('.,;:() ')

    # 1. Match DD/MM/YYYY ou DD-MM-YYYY
    m_fr = re.search(r'(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})', cleaned)
    if m_fr:
        d, mo, y = int(m_fr.group(1)), int(m_fr.group(2)), int(m_fr.group(3))
        try:
            return date(y, mo, d).isoformat()
        except ValueError:
            pass

    # 2. Match (le )?(\d{1,2}) (mois) (\d{4})?
    m = re.search(r'(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?', cleaned)
    if m:
        day = int(m.group(1))
        month_name = m.group(2)
        year = int(m.group(3)) if m.group(3) else (default_date or date.today()).year
        month = FRENCH_MONTHS.get(month_name)
        if month:
            try:
                return date(year, month, day).isoformat()
            except ValueError:
                pass

    # 3. Match YYYY-MM-DD
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
    # Pattern 1 : formulation standard
    # "virement de précaution de 310 EUR de votre Épargne disponible vers votre compte courant."
    # "virement de retour de 250 EUR de CA Centre-Est vers Livret A, à planifier le 29 octobre 2026."
    p1 = re.compile(
        r'virement\s+(?:[a-zéèêûôîà\-]+\s+)?(?:de\s+[a-zéèêûôîà\-]+\s+)?de\s+(?:\*\*)?~?(\d+(?:[.,]\d+)?)\s*(?:EUR|€)?(?:\*\*)?\s+(?:de|depuis)\s+(?:votre\s+)?([^,.:\n()]+?)\s+vers\s+(?:votre\s+)?([^,.:\n()]+)(?:,\s*(?:à\s+planifier|programmé|prévu)?\s*(?:pour\s+)?le\s+([^,.:\n()]+))?.*?(?:[\.\n]|$)',
        re.IGNORECASE
    )

    # Pattern 2 : formulation condensée / parenthésée
    # "virement prévisionnel de 366 € (Livret A -> Compte Courant)"
    # "virement de reconstitution de 366 € (Compte Courant -> Livret A) pour le 30/10/2026"
    p2 = re.compile(
        r'virement\s+(?:[a-zéèêûôîà\-]+\s+)?(?:de\s+[a-zéèêûôîà\-]+\s+)?de\s+(?:\*\*)?~?(\d+(?:[.,]\d+)?)\s*(?:EUR|€)?(?:\*\*)?\s*\(\s*(?:votre\s+)?([^,.:\n()]+?)\s*(?:->|vers)\s*(?:votre\s+)?([^,.:\n()]+?)\s*\)(?:[^\n.]*?(?:pour\s+le|le|au)\s+([0-9a-zéèêûôîà/.\-]+))?',
        re.IGNORECASE
    )

    seen_transfers = set()
    for transfer_pattern in (p1, p2):
        for m in transfer_pattern.finditer(text):
            before = text[max(0, m.start() - 60):m.start()].lower()
            if any(p in before for p in ('nous avons enregistré', 'nous avions enregistré', 'suite au', 'suite à', 'déjà effectué', 'déjà enregistré', 'déjà programmé', 'déjà planifié')):
                continue

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
            matched_text = m.group(0).lower()
            if any(w in matched_text for w in ("reconstitution", "retour")):
                desc = f"Reconstitution épargne {from_acc} -> {to_acc}"
            elif "précaution" in matched_text or "precaution" in matched_text:
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

    # Pattern 3 : formulation contextuelle / implicite
    # Ex: "ce virement de précaution de 280,00 € (pour couvrir le déficit...)"
    # Ex: "la reconstitution de 250,00 € pour le lendemain"
    # Ex: "virement prévisionnel de 300 €"
    savings_accounts = [a for a in accounts if any(k in strip_accents(a.type or '') for k in ('livret', 'epargne', 'savings')) or any(k in strip_accents(a.name) for k in ('livret', 'epargne', 'ldd'))]
    checking_accounts = [a for a in accounts if any(k in strip_accents(a.type or '') for k in ('courant', 'checking'))]
    default_savings = savings_accounts[0].name if savings_accounts else (accounts[1].name if len(accounts) > 1 else 'Livret A')
    default_checking = checking_accounts[0].name if checking_accounts else (accounts[0].name if accounts else 'Compte courant')

    text_clean = strip_accents(text)
    text_savings = [a.name for a in savings_accounts if strip_accents(a.name) in text_clean]
    text_checking = [a.name for a in checking_accounts if strip_accents(a.name) in text_clean or 'compte courant' in text_clean]
    active_savings = text_savings[0] if text_savings else default_savings
    active_checking = text_checking[0] if text_checking else default_checking

    payday_date = None
    m_pay = re.search(r'(?:salaire|paie|paye)\s+(?:du|arrive\s+le|de)?\s*(\d{1,2})\s*([a-z]+)?', text, re.IGNORECASE)
    if m_pay:
        try:
            d = int(m_pay.group(1))
            mo_str = m_pay.group(2)
            mo = FRENCH_MONTHS.get(strip_accents(mo_str)) if mo_str else today.month
            payday_date = date(today.year, mo, d)
        except Exception:
            pass

    p3 = re.compile(
        r'(?:virement\s+(?:[a-zéèêûôîà\'-]+\s+)*|pont\s+de\s+trésorerie\s+(?:[a-zéèêûôîà\'-]+\s+)*|reconstitution\s+(?:[a-zéèêûôîà\'-]+\s+)*)de\s+(?:\*\*)?~?(\d+(?:[.,]\d+)?)\s*(?:EUR|€)?',
        re.IGNORECASE
    )
    for m_t in p3.finditer(text):
        start = m_t.start()
        before = text[max(0, start - 100):start].lower()
        if any(p in before for p in ('déjà programmée', 'déjà planifiée', 'déjà enregistrée', 'déjà effectué', 'déjà été', 'déjà fait')):
            continue

        amt_str = m_t.group(1)
        try:
            amt = float(amt_str.replace(',', '.'))
        except ValueError:
            continue
        if amt <= 0:
            continue

        matched_term = m_t.group(0).lower()
        after = text[m_t.end():min(len(text), m_t.end() + 80)].lower()
        if any(k in matched_term for k in ('reconstitution', 'retour', 'rembourser')):
            from_acc = active_checking
            to_acc = active_savings
            desc = f"Reconstitution épargne {from_acc} -> {to_acc}"
            if 'lendemain' in after and payday_date:
                dt_iso = (payday_date + timedelta(days=1)).isoformat()
            else:
                dt_iso = parse_french_date(after, default_date=today)
        else:
            from_acc = active_savings
            to_acc = active_checking
            desc = f"Virement de précaution {from_acc} -> {to_acc}"
            dt_iso = today.isoformat()

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

    # ── 3. Extraction Clôture / Réactivation de Récurrences ───────────────────
    from app.models import RecurrenceTemplate
    recurrences = db.query(RecurrenceTemplate).all()

    closure_pattern = re.compile(
        r'(?:clôture|cloture)\s+de\s+(?:la\s+récurrence\s+|l\'abonnement\s+)?(?:\*\*)?([^,.:\n*]+?)(?:\*\*)?\s*(?:\([^\n)]+\))?[\.\n]',
        re.IGNORECASE
    )
    for m in closure_pattern.finditer(text):
        raw_name = m.group(1).strip()
        matched_tpl = None
        norm_target = strip_accents(raw_name)
        for tpl in recurrences:
            if tpl.description and (norm_target == strip_accents(tpl.description) or norm_target in strip_accents(tpl.description) or strip_accents(tpl.description) in norm_target):
                matched_tpl = tpl
                break
        if matched_tpl:
            actions.append({
                "action": "close_recurrence_template",
                "params": {
                    "template_id": matched_tpl.id,
                    "description": matched_tpl.description,
                    "amount": matched_tpl.amount,
                    "is_closed": True
                }
            })

    reactivate_pattern = re.compile(
        r'(?:réactivation|reactivation|réouverture|reouverture)\s+de\s+(?:la\s+récurrence\s+|l\'abonnement\s+)?(?:\*\*)?([^,.:\n*]+?)(?:\*\*)?\s*(?:\([^\n)]+\))?[\.\n]',
        re.IGNORECASE
    )
    for m in reactivate_pattern.finditer(text):
        raw_name = m.group(1).strip()
        matched_tpl = None
        norm_target = strip_accents(raw_name)
        for tpl in recurrences:
            if tpl.description and (norm_target == strip_accents(tpl.description) or norm_target in strip_accents(tpl.description) or strip_accents(tpl.description) in norm_target):
                matched_tpl = tpl
                break
        if matched_tpl:
            actions.append({
                "action": "update_recurrence_template",
                "params": {
                    "template_id": matched_tpl.id,
                    "description": matched_tpl.description,
                    "amount": matched_tpl.amount,
                    "is_active": True
                }
            })

    logger.debug(f"[Chat Action Recovery] {len(actions)} action(s) extraite(s) depuis le texte.")
    return actions


def find_missing_promised_actions(
    text: str,
    db: Session,
    existing_actions: Optional[List[Dict[str, Any]]] = None,
    target_year: Optional[int] = None,
    target_month: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Compare l'ensemble des actions promises dans le texte avec les actions déjà existantes
    (soit passées en paramètre, soit extraites des blocs ```action du texte).
    Retourne la liste des actions promises qui ne sont pas encore matérialisées.
    Supporte 1, 2, 3 ou N actions sans limite.
    """
    if not text:
        return []

    # 1. Collecter les actions déjà émises / existantes
    known_actions: List[Dict[str, Any]] = []
    if existing_actions:
        known_actions.extend(existing_actions)
    known_actions.extend(extract_existing_action_blocks(text))

    # 2. Extraire toutes les actions promises dans le texte
    candidates = extract_unemitted_actions(text, db, target_year=target_year, target_month=target_month)
    if not candidates:
        return []
    if not known_actions:
        return candidates

    accounts = db.query(Account).all()

    # 3. Filtrer les candidats qui correspondent déjà à une action existante
    missing: List[Dict[str, Any]] = []
    for cand in candidates:
        cand_action = cand.get("action")
        cand_params = cand.get("params", {})
        is_matched = False

        for ex in known_actions:
            ex_action = ex.get("action")
            ex_params = ex.get("params", {})
            if ex_action != cand_action:
                continue

            if cand_action == "create_planned_transfer":
                c_amt = round(float(cand_params.get("amount") or 0), 2)
                e_amt = round(float(ex_params.get("amount") or 0), 2)
                c_from = resolve_account_name(cand_params.get("from_account", ""), accounts).lower()
                e_from = resolve_account_name(ex_params.get("from_account", ""), accounts).lower()
                c_to = resolve_account_name(cand_params.get("to_account", ""), accounts).lower()
                e_to = resolve_account_name(ex_params.get("to_account", ""), accounts).lower()

                if c_amt == e_amt and c_from == e_from and c_to == e_to:
                    is_matched = True
                    break

            elif cand_action in ("apply_transaction_correction", "delete_transaction"):
                if str(cand_params.get("transaction_id")) == str(ex_params.get("transaction_id")):
                    is_matched = True
                    break

            elif cand_action in ("close_recurrence_template", "update_recurrence_template", "delete_recurrence_template"):
                if str(cand_params.get("template_id")) == str(ex_params.get("template_id")):
                    is_matched = True
                    break

            elif cand_action in ("update_budget_envelope", "delete_budget_envelope"):
                if (cand_params.get("budget_id") and str(cand_params.get("budget_id")) == str(ex_params.get("budget_id"))) or (
                    cand_params.get("name") and strip_accents(cand_params.get("name")) == strip_accents(ex_params.get("name"))
                ):
                    is_matched = True
                    break
            else:
                if cand_params == ex_params:
                    is_matched = True
                    break

        if not is_matched:
            missing.append(cand)

    return missing


def append_actions_to_text(text: str, actions: List[Dict[str, Any]]) -> str:
    """Ajoute les blocs ```action ... ``` à la fin du texte du message."""
    if not actions:
        return text
    action_str = ""
    for act in actions:
        action_str += f"\n\n```action\n{json.dumps(act, ensure_ascii=False)}\n```"
    return text.rstrip() + action_str
