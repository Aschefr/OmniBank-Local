"""Virements internes dont les deux côtés arrivent dans le même relevé.

La liaison habituelle (reconciliation_engine, « virement orphelin ») cherche l'autre côté parmi les opérations déjà en
base : elle marche quand les deux côtés arrivent dans deux relevés successifs. Dans un même relevé, aucun n'existe
encore au moment de la recherche, et un virement compte courant → Livret A devenait une dépense et un revenu. Ce
passage, une fois les nouvelles opérations du lot créées, réunit chaque paire en un seul virement, avec les mêmes
critères : même montant, sens opposés, deux comptes différents, 15 jours d'écart au plus. Les comptes de prêt sont
laissés de côté : une échéance reste une dépense.
"""
import json
import logging
from typing import List, Tuple

from sqlalchemy.orm import Session

from app.models import Account, AutopilotDecisionLog, Transaction
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

TRANSFER_CATEGORY = "Virement interne"
MAX_DAYS_APART = 15
REVIEW_DAYS_APART = 3  # au-delà, la paire est gardée mais à vérifier
_LOAN_WORDS = ("prêt", "pret", "emprunt", "loan", "crédit", "credit")


def _is_loan(account: Account) -> bool:
    return bool(account.type and any(w in account.type.lower() for w in _LOAN_WORDS))


def pair_internal_transfers(db: Session, created: List[Tuple[Transaction, AutopilotDecisionLog]]) -> Tuple[int, int]:
    """Réunit les deux côtés d'un virement interne créés dans le même lot.
    Renvoie (virements formés, opérations à vérifier en moins)."""
    if len(created) < 2:
        return 0, 0
    loan_ids = {a.id for a in db.query(Account).all() if _is_loan(a)}
    outs = [(t, d) for t, d in created
            if t.type != "income" and t.from_account_id and not t.to_account_id and t.from_account_id not in loan_ids]
    ins = [(t, d) for t, d in created
           if t.type == "income" and t.to_account_id and not t.from_account_id and t.to_account_id not in loan_ids]
    if not outs or not ins:
        return 0, 0

    from app.services.smart_label_service import ensure_category_exists

    used = set()
    paired = 0
    review_drop = 0
    for out_tx, out_dec in sorted(outs, key=lambda p: p[0].date_operation):
        candidates = [
            (in_tx, in_dec) for in_tx, in_dec in ins
            if in_tx.id not in used
            and in_tx.to_account_id != out_tx.from_account_id
            and abs(float(in_tx.amount or 0) - float(out_tx.amount or 0)) < 0.01
            and abs((in_tx.date_operation - out_tx.date_operation).days) <= MAX_DAYS_APART
        ]
        if not candidates:
            continue
        in_tx, in_dec = min(candidates, key=lambda p: abs((p[0].date_operation - out_tx.date_operation).days))
        used.add(in_tx.id)
        days_apart = abs((in_tx.date_operation - out_tx.date_operation).days)

        before = snapshot_entity(out_tx)
        review_before = int(bool(out_tx.needs_review)) + int(bool(in_tx.needs_review))
        out_tx.to_account_id = in_tx.to_account_id
        out_tx.type = "transfer"
        ensure_category_exists(db, TRANSFER_CATEGORY, "transfer")
        out_tx.category = TRANSFER_CATEGORY
        out_tx.needs_review = days_apart > REVIEW_DAYS_APART
        out_tx.created_by = "Automatisme (Liaison Virement)"
        db.flush()
        record_action(db, "transaction", out_tx.id, "UPDATE", before, snapshot_entity(out_tx), user_name="Automatisme (Liaison Virement)")
        record_action(db, "transaction", in_tx.id, "DELETE", snapshot_entity(in_tx), None, user_name="Automatisme (Liaison Virement)")

        action = "AUTO_LINKED_TRANSFER" if not out_tx.needs_review else "AUTO_LINKED_TRANSFER_PENDING_REVIEW"
        for dec, other_id in ((out_dec, in_tx.id), (in_dec, out_tx.id)):
            snap = json.loads(dec.raw_snapshot or "{}")
            snap.update({"decision_reason": "internal_transfer_same_statement", "paired_with": other_id,
                         "after": snapshot_entity(out_tx)})
            dec.action = action
            dec.entity_id = out_tx.id
            dec.raw_snapshot = json.dumps(snap, default=str)
        db.delete(in_tx)
        db.flush()
        paired += 1
        review_drop += review_before - int(bool(out_tx.needs_review))
        logger.info(f"[AutoPilot] Virement interne réuni dans le relevé : {out_tx.amount:.2f} € "
                    f"compte #{out_tx.from_account_id} → #{out_tx.to_account_id} ({days_apart} j d'écart)")
    return paired, review_drop
