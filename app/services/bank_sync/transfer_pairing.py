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
from datetime import date
from typing import List, Tuple

from sqlalchemy.orm import Session

from app.models import Account, AutopilotDecisionLog, Transaction
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)

TRANSFER_CATEGORY = "Virement interne"
MAX_DAYS_APART = 15
REVIEW_DAYS_APART = 3  # au-delà, la paire est gardée mais à vérifier
_LOAN_WORDS = ("prêt", "pret", "emprunt", "loan", "crédit", "credit")
# Nom donné par une règle de l'utilisateur : on le garde. Un nom venu de l'historique, non : l'historique ne
# propose que des dépenses et des revenus, jamais un virement (« iCloud Camille » pour « WEB MARTIN CAMILLE »).
_KEPT_NAME_SOURCES = ("rule",)


def _is_loan(account: Account) -> bool:
    return bool(account.type and any(w in account.type.lower() for w in _LOAN_WORDS))


def pair_internal_transfers(db: Session, created: List[Tuple[Transaction, AutopilotDecisionLog]]) -> Tuple[int, int]:
    """Réunit les deux côtés d'un virement interne créés dans le même lot.
    Renvoie (virements formés, opérations à vérifier en moins)."""
    if len(created) < 2:
        return 0, 0
    accounts = db.query(Account).all()
    loan_ids = {a.id for a in accounts if _is_loan(a)}
    names = {a.id: a.name for a in accounts if a.name}
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
        # « WEB M. NOM » ne dit rien : on nomme le virement par ses deux comptes, sauf nom appris de l'utilisateur
        bank_tx = json.loads(out_dec.raw_snapshot or "{}").get("bank_tx") or {}
        learned = bank_tx.get("smart_source") in _KEPT_NAME_SOURCES
        if not learned and out_tx.from_account_id in names and in_tx.to_account_id in names:
            out_tx.description = f"{names[out_tx.from_account_id]} → {names[in_tx.to_account_id]}"
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


_WEAK_MATCH_KEYS = {
    "matched_db_id": None, "is_reconciled": False, "already_reconciled": False, "match_score": 0,
    "collision_detected": False, "suggested_forecast_id": None, "suggested_match_score": None,
    "is_orphan_transfer_link": False, "orphan_account_id": None, "orphan_account_name": None,
    "is_mirror_transfer": False, "is_amount_deviant": False, "original_forecast_amount": None,
}


def _keeps_its_match(tx: dict) -> bool:
    """Ligne déjà portée en base, ou correspondance d'au moins 60 (rapprochée ou proposée) : elle prime sur la
    réunion dans le relevé, par exemple un virement prévu « Économie » que la banque confirme."""
    if tx.get("is_reconciled") and tx.get("already_reconciled"):
        return True
    score = max(float(tx.get("match_score") or 0), float(tx.get("suggested_match_score") or 0))
    return (tx.get("matched_db_id") is not None or tx.get("suggested_forecast_id") is not None) and score >= 60.0


def release_weak_matches_for_batch_mirrors(db: Session, accounts: list) -> int:
    """Les deux côtés d'un virement interne sont dans ce relevé, mais l'un n'a trouvé en base qu'une correspondance
    faible (score < 60) : le revenu prévu « Aide de Camille » de 150 € dans 9 jours pour la sortie de 150 € du Livret A,
    dont l'entrée sur le compte courant n'est pas encore créée. Cette correspondance le laissait en attente : il n'était
    jamais créé, donc jamais réuni à l'autre côté, qui restait un revenu. On l'oublie pour que les deux côtés soient
    créés puis réunis par pair_internal_transfers. Un vrai rapprochement (score ≥ 60) reste prioritaire.
    Renvoie le nombre de lignes libérées."""
    loan_ids = {a.id for a in db.query(Account).all() if _is_loan(a)}
    lines = []
    for acc in accounts or []:
        acc_id = acc.get("account_id")
        if not acc_id or acc_id in loan_ids:
            continue
        for tx in acc.get("transactions") or []:
            if tx.get("is_coming") or tx.get("raw_amount") is None or not tx.get("date_operation") or _keeps_its_match(tx):
                continue
            try:
                amount = float(tx["raw_amount"])
                op_date = date.fromisoformat(str(tx["date_operation"])[:10])
            except (TypeError, ValueError):
                continue
            if amount:
                lines.append((acc_id, amount, op_date, tx))
    if len(lines) < 2:
        return 0
    csv_ids = [t.get("csv_id") for _, _, _, t in lines if t.get("csv_id")]
    known = {row[0] for row in db.query(Transaction.csv_id).filter(Transaction.csv_id.in_(csv_ids)).all()} if csv_ids else set()
    lines = [line for line in lines if line[3].get("csv_id") not in known]

    outs = sorted((line for line in lines if line[1] < 0), key=lambda line: line[2])
    ins = [line for line in lines if line[1] > 0]
    used = set()
    released = 0
    for out_acc, out_amt, out_date, out_tx in outs:
        candidates = [line for line in ins if id(line[3]) not in used and line[0] != out_acc
                      and abs(line[1] + out_amt) < 0.01 and abs((line[2] - out_date).days) <= MAX_DAYS_APART]
        if not candidates:
            continue
        in_line = min(candidates, key=lambda line: abs((line[2] - out_date).days))
        used.add(id(in_line[3]))
        for tx in (out_tx, in_line[3]):
            if tx.get("matched_db_id") is not None or tx.get("suggested_forecast_id") is not None:
                logger.info(f"[AutoPilot] Correspondance faible écartée pour '{tx.get('raw_description') or tx.get('description')}' "
                            f"(#{tx.get('matched_db_id') or tx.get('suggested_forecast_id')}, score {tx.get('match_score') or tx.get('suggested_match_score')}) : "
                            f"l'autre côté du virement est dans ce relevé")
                tx.update(_WEAK_MATCH_KEYS)
                released += 1
    return released
