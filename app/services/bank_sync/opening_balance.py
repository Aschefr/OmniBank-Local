"""Solde de départ d'un compte à son premier relevé.

Un compte créé depuis la banque reçoit son solde du jour comme solde de départ. Son premier relevé importe ensuite le
mois d'historique que ce solde contenait déjà : les opérations comptaient deux fois et le solde pointé s'écartait du
solde de la banque. Au premier relevé d'un compte (aucune opération pointée avant lui), le solde de départ est donc
recalé pour que le solde pointé égale celui de la banque, comme le fait déjà la validation du Sas.
"""
import logging
from typing import Any, Dict, Iterable, List, Set

from sqlalchemy.orm import Session

from app.models import Account, Transaction
from app.services.history_service import record_action, snapshot_entity

logger = logging.getLogger(__name__)


def accounts_without_bank_history(db: Session, account_ids: Iterable[int]) -> Set[int]:
    """Comptes sans aucune opération pointée : leur prochain relevé est le premier."""
    first = set()
    for acc_id in {a for a in account_ids if a}:
        has_history = db.query(Transaction.id).filter(
            Transaction.reconciliation_date.isnot(None),
            (Transaction.from_account_id == acc_id) | (Transaction.to_account_id == acc_id),
        ).first()
        if not has_history:
            first.add(acc_id)
    return first


def align_opening_balances(db: Session, preview_accounts: List[Dict[str, Any]], first_ids: Set[int]) -> int:
    """Recale le solde de départ des comptes à leur premier relevé. Renvoie le nombre de comptes recalés."""
    if not first_ids:
        return 0
    from app.services.finance_engine import calculate_balances

    db.flush()
    balances = calculate_balances(db, only_reconciled=True)
    fixed = 0
    for acc_data in preview_accounts:
        acc_id = acc_data.get("account_id")
        bank_balance = acc_data.get("bank_balance")
        if acc_id not in first_ids or bank_balance is None:
            continue
        acc = db.query(Account).filter(Account.id == acc_id).first()
        if not acc:
            continue
        delta = round(float(bank_balance) - balances.get(acc_id, acc.initial_balance or 0.0), 2)
        if abs(delta) < 0.01:
            continue
        before = snapshot_entity(acc)
        acc.initial_balance = round((acc.initial_balance or 0.0) + delta, 2)
        record_action(db, "account", acc.id, "UPDATE", before, snapshot_entity(acc),
                      user_name="Automatisme (Solde de départ)")
        fixed += 1
        logger.info(f"[AutoPilot] Premier relevé de '{acc.name}' : solde de départ recalé à {acc.initial_balance:.2f} € "
                    f"pour égaler la banque ({float(bank_balance):.2f} €)")
    return fixed
