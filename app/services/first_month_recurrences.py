"""Récurrences dès le premier mois pour les charges fixes.

La promotion habituelle (recurrence_detector, N >= 3) attend trois échéances consécutives : un profil neuf n'a donc
aucune prévision pendant trois mois. Une échéance de prêt, une cotisation d'assurance, une box ou un contrat d'énergie
reviennent pourtant chaque mois : dès la première occurrence, on crée la récurrence mensuelle et ses prochaines
échéances, marquée « 1er mois » dans le fil Auto-Pilote, où l'utilisateur l'annule si elle ne revient pas.

Pas les abonnements (achats ponctuels dans un store, offres annuelles) ni les impôts (montants irréguliers).
Même interrupteur que la promotion N >= 3 (auto_promote_recurrences) et même date d'effet.
"""
import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models import AutopilotDecisionLog, GlobalConfig, RecurrenceTemplate, Transaction
from app.services.history_service import record_action, snapshot_entity
from app.services.smart_label.categories import _clean_token_str

logger = logging.getLogger(__name__)

FIRST_MONTH_REASON = "first_month_fixed"
FIRST_MONTH_CONFIDENCE = 60.0
_RECENT_DAYS = 45
_CARD_LABEL = re.compile(r"^(CB|CARTE|PAIEMENT CB|X\d{4})\b", re.IGNORECASE)
_MONTHLY_FAMILY_WORDS = ("pret", "credit", "emprunt", "assurance", "mutuelle", "prevoyance", "telecom", "internet",
                         "energie", "electricite", "gaz", "frais bancaires", "frais de compte", "loyer")


def _cfg(db: Session, key: str) -> str:
    row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    return (row.value or "").strip() if row else ""


def is_monthly_family(category: Optional[str]) -> bool:
    clean = _clean_token_str(category or "")
    return bool(clean) and any(w in clean for w in _MONTHLY_FAMILY_WORDS)


def _is_card_payment(label: Optional[str]) -> bool:
    """« CB … », « X1234 … » (carte du Crédit Agricole), « CARTE … » : achat par carte, jamais un prélèvement."""
    return bool(_CARD_LABEL.match((label or "").strip()))


def _as_date(value) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def propose_first_month_recurrences(db: Session, account_id: int, batch_id: Optional[str] = None,
                                    profile_id: Optional[str] = None) -> int:
    """Crée une récurrence mensuelle pour chaque charge fixe récente encore sans modèle. Renvoie le nombre créé."""
    if _cfg(db, "auto_promote_recurrences").lower() not in ("true", "1", "yes"):
        return 0
    from app.services.recurrence_detector import parse_fractional_signature

    txs = db.query(Transaction).filter(
        Transaction.from_account_id == account_id,
        Transaction.to_account_id.is_(None),
        Transaction.type == "expense_fixed",
        Transaction.reconciliation_date.isnot(None),
        Transaction.recurrence_id.is_(None),
        (Transaction.is_skipped == False) | (Transaction.is_skipped.is_(None)),
    ).order_by(Transaction.date_operation.asc()).all()
    if not txs:
        return 0
    # Récent = le dernier mois et demi du relevé (pas d'aujourd'hui) : un vieil historique importé ne crée rien
    newest = max(filter(None, (_as_date(t.date_operation) for t in txs)), default=None)
    if not newest:
        return 0
    oldest = newest - timedelta(days=_RECENT_DAYS)
    since = _as_date(_cfg(db, "auto_promote_recurrences_since")) if _cfg(db, "auto_promote_recurrences_since") else None
    if since and since > oldest:
        oldest = since

    templates = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.from_account_id == account_id).all()
    taken_amounts = {round(float(t.amount or 0), 2) for t in templates}

    created = 0
    for tx in txs:
        op_date = _as_date(tx.date_operation)
        amt = round(float(tx.amount or 0), 2)
        if not op_date or op_date < oldest or amt <= 0 or amt in taken_amounts:
            continue
        if not is_monthly_family(tx.category) or _is_card_payment(tx.raw_description or tx.description):
            continue  # un paiement par carte n'est pas un contrat mensuel (plein chez TotalEnergies)
        if parse_fractional_signature(tx.raw_description or tx.description):
            continue  # paiement en plusieurs fois : géré par la promotion des fractionnés

        tpl = RecurrenceTemplate(
            description=tx.description,
            amount=amt,
            type="expense_fixed",
            category=tx.category,
            frequency="Monthly",
            day_of_month=op_date.day,
            max_occurrences=None,
            from_account_id=account_id,
            is_closed=False,
        )
        db.add(tpl)
        db.flush()
        tx.recurrence_id = tpl.id
        taken_amounts.add(amt)
        record_action(db, "recurrence_template", tpl.id, "CREATE", None, snapshot_entity(tpl),
                      user_name="Automatisme (Récurrence 1er mois)")
        db.add(AutopilotDecisionLog(
            batch_id=batch_id or "auto_pilot_first_month",
            decision_type="recurrence_promotion",
            action="AUTO_COMMIT",
            entity_type="recurrence_template",
            entity_id=tpl.id,
            account_id=account_id,
            raw_snapshot=json.dumps({
                "decision_reason": FIRST_MONTH_REASON,
                "merchant": tx.description,
                "amount": amt,
                "category": tx.category,
                "consecutive_months": 1,
                "linked_transactions": [tx.id],
                "template_id": tpl.id,
            }, default=str),
            confidence_score=FIRST_MONTH_CONFIDENCE,
            is_undone=False,
        ))
        created += 1
        try:
            from app.routers.recurrences import generate_recurrences
            generate_recurrences(template_id=tpl.id, db=db)
        except Exception as gen_err:
            logger.warning(f"[AutoPilot] Prévisions de la récurrence 1er mois {tpl.id} non générées : {gen_err}")
        try:  # comme la promotion N >= 3 : l'enveloppe de la catégorie suit
            from app.services.budget_service import sync_budget_from_recurrence_change
            sync_budget_from_recurrence_change(db, category=tpl.category, change_type="promotion", amount_delta=amt,
                                               batch_id=batch_id, profile_id=profile_id or "default",
                                               frequency=tpl.frequency)
        except Exception as sync_err:
            logger.debug(f"[AutoPilot] Sync budget récurrence 1er mois ignorée : {sync_err}")

    if created:
        logger.info(f"[AutoPilot] {created} récurrence(s) créée(s) dès le premier mois sur le compte #{account_id}")
    return created
