"""
OmniBank-Local — Smart Label : libellés de passerelles de paiement (PayPal, Stripe, SumUp, Lydia, Klarna).

« PayPal Europe S.a.r.l. et Cie S.C.A » ne désigne aucun marchand : le même libellé couvre un abonnement vidéo, un
plugin de musique et un cadeau. Une règle ou l'historique du libellé lui donnait le nom du dernier marchand appris.
Seul l'utilisateur sait qui il a payé ; une fois qu'il a nommé un paiement, un autre paiement par la même passerelle,
du même montant, vers le même jour du mois, est probablement le même marchand : on le propose, et sous le seuil de
confiance la ligne attend dans le sas de validation.
"""

from datetime import date, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models import Transaction
from .normalization import normalize_raw_label

_GATEWAYS = {"PAYPAL", "SUMUP", "STRIPE", "LYDIA", "KLARNA"}
# Raison sociale de la passerelle elle-même (« PayPal (Europe) S.à r.l. et Cie, S.C.A. »)
_GATEWAY_COMPANY_WORDS = {
    "EUROPE", "SARL", "SCA", "CIE", "ET", "LTD", "LIMITED", "SAS", "BV", "GMBH", "INC", "LUXEMBOURG", "FRANCE",
    "IRELAND", "PAYMENT", "PAYMENTS", "SERVICES",
}
HISTORY_DAYS = 400


def gateway_of_label(raw: Optional[str]) -> Optional[str]:
    """« PAYPAL » si le libellé ne nomme que la passerelle, None s'il nomme aussi un marchand (« PAYPAL *NETFLIX »)."""
    tokens = normalize_raw_label(raw or "").split()
    gateways = [t for t in tokens if t in _GATEWAYS]
    if not gateways:
        return None
    rest = [t for t in tokens if t not in _GATEWAYS and t not in _GATEWAY_COMPANY_WORDS and len(t) > 1]
    return None if rest else gateways[0]


def _day_gap(a: date, b: date) -> int:
    gap = abs(a.day - b.day)
    return min(gap, 31 - gap)


def _score(amount: float, day: date, cand: Transaction) -> int:
    """Montant (60 exact, 40 à quelques centimes ou pour cent près) + jour du mois (30 à 3 jours, 15 à 7 jours)."""
    gap = abs(abs(float(cand.amount or 0)) - amount)
    if gap <= 0.01:
        pts = 60
    elif gap <= max(0.50, amount * 0.03):
        pts = 40
    else:
        return 0
    if cand.date_operation:
        d = _day_gap(day, cand.date_operation)
        pts += 30 if d <= 3 else (15 if d <= 7 else 0)
    return pts


def _parse_day(value: Any) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return date.today()


def _named_payments(db: Session, gateway: str, cache: Dict[str, List[Transaction]]) -> List[Transaction]:
    """Paiements passés par cette passerelle que l'utilisateur a nommés (ni à vérifier, ni restés « PayPal »)."""
    if gateway not in cache:
        since = date.today() - timedelta(days=HISTORY_DAYS)
        rows = db.query(Transaction).filter(
            Transaction.raw_description.isnot(None),
            Transaction.description.isnot(None),
            Transaction.date_operation >= since,
            Transaction.reconciliation_date.isnot(None),
            Transaction.type != "transfer",
        ).all()
        cache[gateway] = [
            t for t in rows
            if not t.needs_review
            and gateway_of_label(t.raw_description) == gateway
            and not gateway_of_label(t.description)
            and normalize_raw_label(t.description) != normalize_raw_label(t.raw_description)
        ]
    return cache[gateway]


def suggest_gateway_name(db: Session, raw: str, raw_amount: float, day: date,
                         cache: Optional[Dict[str, List[Transaction]]] = None) -> Optional[Dict[str, Any]]:
    """Nom, catégorie et confiance (0-1) d'un paiement par passerelle d'après les paiements déjà nommés, ou None."""
    gateway = gateway_of_label(raw)
    if not gateway or not raw_amount:
        return None
    is_income = raw_amount > 0
    amount = abs(float(raw_amount))
    best_by_name: Dict[str, tuple] = {}
    for cand in _named_payments(db, gateway, cache if cache is not None else {}):
        if (cand.type == "income") != is_income:
            continue
        pts = _score(amount, day, cand)
        key = cand.description.strip().lower()
        if pts and (key not in best_by_name or pts > best_by_name[key][0]
                    or (pts == best_by_name[key][0] and cand.date_operation > best_by_name[key][1].date_operation)):
            best_by_name[key] = (pts, cand)
    ranked = sorted(best_by_name.values(), key=lambda x: (x[0], x[1].date_operation), reverse=True)
    if not ranked or ranked[0][0] < 60:
        return None
    pts, cand = ranked[0]
    # Deux marchands aussi plausibles l'un que l'autre : on propose le meilleur, à vérifier
    other = ranked[1][1].description if len(ranked) > 1 and ranked[1][0] >= pts - 10 else None
    if other:
        pts = min(pts, 60)
    detail = {
        "ref_description": cand.description,
        "ref_date": cand.date_operation.isoformat() if cand.date_operation else None,
        "day_gap": _day_gap(day, cand.date_operation) if cand.date_operation else None,
        "same_amount": abs(abs(float(cand.amount or 0)) - amount) <= 0.01,
        "other_description": other,
    }
    return {"description": cand.description, "category": cand.category, "confidence": pts / 100.0,
            "ref_id": cand.id, "detail": detail}


def name_gateway_lines(db: Session, accounts: List[Dict[str, Any]]) -> int:
    """Nomme les lignes non rapprochées d'un relevé dont le libellé ne cite qu'une passerelle de paiement."""
    cache: Dict[str, List[Transaction]] = {}
    named = 0
    for acc in accounts or []:
        for tx in acc.get("transactions", []):
            if tx.get("is_reconciled") or tx.get("smart_is_manual") or tx.get("smart_gateway_ref"):
                continue
            raw = tx.get("raw_description") or tx.get("description") or ""
            raw_amount = tx.get("raw_amount")
            if raw_amount is None or not gateway_of_label(raw):
                continue
            # Encore au nom de la passerelle, ou nommée par une ancienne règle « PayPal → un marchand » ; un nom
            # donné à la main dans le sas reste
            if not (gateway_of_label(tx.get("description")) or tx.get("smart_source") == "rule"):
                continue
            res = suggest_gateway_name(db, raw, float(raw_amount), _parse_day(tx.get("date_operation")), cache)
            tx["smart_is_gateway"] = True
            if not res:
                continue
            tx.update({
                "description": res["description"],
                "category": res["category"] or tx.get("category"),
                "smart_suggested": True,
                "smart_source": "history",
                "smart_confidence": res["confidence"],
                "smart_is_fallback": False,
                "smart_is_manual": False,
                "smart_is_provisional": False,
                "smart_is_multi_category": False,
                "smart_is_new_category": False,
                "smart_gateway_ref": res["ref_id"],
                "smart_gateway_detail": res["detail"],
            })
            named += 1
    return named
