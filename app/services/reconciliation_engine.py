"""
app/services/reconciliation_engine.py — Moteur de Rapprochement Comptable & Détection de Correspondances.
Extrait de csv_parser.py pour éliminer la dépendance inversée service -> routeur
et servir de brique unifiée au mode Auto-Pilote.
"""
import logging
from datetime import timedelta
from typing import Any, Dict, List, Optional, Set, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from app.models import Transaction, Account

logger = logging.getLogger(__name__)


def compute_temporal_score(candidate_dt, bank_dt) -> int:
    """Calcule le score de proximité temporelle (0 à 35 pts)."""
    if not candidate_dt or not bank_dt:
        return 0
    delta = (candidate_dt - bank_dt).days
    # delta < 0 : la date en base est antérieure au débit banque (ex: achat le 20, débité le 22 -> delta = -2)
    # delta > 0 : la date en base est postérieure au débit banque (ex: prévu le 24, débité le 23 -> delta = +1)
    abs_delta = abs(delta)
    if abs_delta == 0:
        return 35
    elif delta in (-1, -2):
        return 30
    elif delta in (1, 2):
        return 28
    elif delta in (-3, -4):
        return 20
    elif delta in (3, 4):
        return 15
    elif delta in (-5, -6, -7):
        return 10
    elif delta in (5, 6, 7):
        return 8
    elif 8 <= abs_delta <= 15:
        return 5
    elif 16 <= abs_delta <= 30:
        return 2
    else:
        return 0


def compute_text_score(candidate_desc: Optional[str], raw_bank_label: Optional[str]) -> int:
    """Calcule le score de similarité textuelle marchand (0 à 25 pts)."""
    if not candidate_desc or not raw_bank_label:
        return 0
    try:
        from app.services.smart_label_service import _compute_match_score
        ratio = _compute_match_score(raw_bank_label, candidate_desc)
        return round(ratio * 25)
    except Exception:
        return 0


def evaluate_candidate(candidate_tx: Transaction, target_dt, bank_label: Optional[str]) -> int:
    """Calcule le score composite total (0-100 pts) pour un candidat."""
    amt_score = 40
    t_dt = candidate_tx.date_operation if hasattr(candidate_tx.date_operation, "strftime") else (candidate_tx.date_operation if candidate_tx.date_operation else None)
    temp_score = compute_temporal_score(t_dt, target_dt)
    text_score = compute_text_score(candidate_tx.description, bank_label)
    return amt_score + temp_score + text_score


def best_scored_tx(candidates: List[Transaction], target_dt, bank_label: Optional[str]) -> Tuple[Optional[Transaction], int]:
    """Sélectionne le meilleur candidat parmi une liste avec tri score décroissant puis proximité date."""
    if not candidates:
        return None, 0
    scored = []
    for c in candidates:
        s = evaluate_candidate(c, target_dt, bank_label)
        if s >= 40:
            scored.append((s, c))
    if not scored:
        return None, 0
    # Trier par score décroissant, puis par proximité de date la plus faible
    scored.sort(
        key=lambda item: (
            item[0],
            -abs((item[1].date_operation - target_dt).days) if item[1].date_operation else -9999
        ),
        reverse=True
    )
    best_score, best_candidate = scored[0]
    return best_candidate, best_score


def check_reconciliation(
    db: Session,
    tx_date,
    tx_amount,
    matched_ids: Optional[Set[int]] = None,
    account_id: Optional[int] = None,
    is_coming: bool = False,
    bank_label: Optional[str] = None,
    csv_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Vérifie si une transaction correspondante existe en base via un score composite (0-100 pts):
      - Priorité 0: Correspondance exacte par empreinte unique bancaire (csv_id) : 100 pts
      - Montant exact (+/- 0.01 €) : 40 pts
      - Proximité temporelle (delta asymétrique) : 0 à 35 pts
      - Similarité textuelle marchand (SmartLabelService) : 0 à 25 pts
    Gère également les virements internes inter-comptes et la détection d'orphelins.
    """
    if tx_date is None or tx_amount is None:
        return None
    try:
        abs_amount = abs(float(tx_amount))
    except (ValueError, TypeError):
        return None

    epsilon = 0.01

    # Clause de filtre par compte si fourni
    acc_filter = None
    if account_id:
        acc_filter = or_(
            Transaction.from_account_id == account_id,
            Transaction.to_account_id == account_id
        )

    # ── PASSE 0 : Correspondance exacte et prioritaire par empreinte bancaire (csv_id) ──
    if csv_id:
        target_csv_ids = [csv_id]
        if csv_id.startswith("woob_") and not csv_id.startswith("woob_coming_"):
            target_csv_ids.append(csv_id.replace("woob_", "woob_coming_"))
        elif csv_id.startswith("woob_coming_"):
            target_csv_ids.append(csv_id.replace("woob_coming_", "woob_"))

        csv_query = db.query(Transaction).filter(
            Transaction.csv_id.in_(target_csv_ids),
            Transaction.amount >= abs_amount - epsilon,
            Transaction.amount <= abs_amount + epsilon
        )
        if acc_filter is not None:
            csv_query = csv_query.filter(acc_filter)
        if matched_ids:
            csv_query = csv_query.filter(
                or_(
                    Transaction.id.notin_(matched_ids),
                    Transaction.type == "transfer",
                    and_(Transaction.from_account_id.isnot(None), Transaction.to_account_id.isnot(None))
                )
            )
        exact_csv_match = csv_query.first()
        if exact_csv_match:
            return {
                "id": exact_csv_match.id,
                "description": exact_csv_match.description,
                "already_reconciled": bool(exact_csv_match.reconciliation_date),
                "match_score": 100
            }

    target_dt = tx_date.date() if hasattr(tx_date, "date") and callable(tx_date.date) else tx_date

    # 1. Recherche d'un doublon déjà rapproché / existant
    def _find_already_reconciled():
        if is_coming:
            start_op_limit_c = tx_date - timedelta(days=15)
            end_op_limit_c = tx_date + timedelta(days=15)
            recon_query = db.query(Transaction).filter(
                Transaction.reconciliation_date != None,
                Transaction.amount >= abs_amount - epsilon,
                Transaction.amount <= abs_amount + epsilon,
                Transaction.date_operation >= start_op_limit_c,
                Transaction.date_operation <= end_op_limit_c
            )
        else:
            start_recon = tx_date - timedelta(days=30)
            end_recon = tx_date + timedelta(days=30)
            start_op_limit = tx_date - timedelta(days=30)
            end_op_limit = tx_date + timedelta(days=30)
            recon_query = db.query(Transaction).filter(
                Transaction.reconciliation_date != None,
                Transaction.amount >= abs_amount - epsilon,
                Transaction.amount <= abs_amount + epsilon,
                Transaction.date_operation >= start_op_limit,
                Transaction.date_operation <= end_op_limit,
                or_(
                    (Transaction.reconciliation_date >= start_recon) & (Transaction.reconciliation_date <= end_recon),
                    (Transaction.date_operation >= start_op_limit) & (Transaction.date_operation <= end_op_limit)
                )
            )

        if acc_filter is not None:
            recon_query = recon_query.filter(acc_filter)

        # Pour les virements internes, autoriser la détection même si l'ID a déjà été vu dans le lot
        if matched_ids:
            recon_query_filtered = recon_query.filter(
                or_(
                    Transaction.id.notin_(matched_ids),
                    Transaction.type == "transfer",
                    and_(Transaction.from_account_id.isnot(None), Transaction.to_account_id.isnot(None))
                )
            )
        else:
            recon_query_filtered = recon_query

        recon_match, recon_score = best_scored_tx(recon_query_filtered.all(), target_dt, bank_label)
        if recon_match:
            return {
                "id": recon_match.id,
                "description": recon_match.description,
                "already_reconciled": True,
                "match_score": recon_score
            }
        return None

    # 2. Recherche d'une prédiction non pointée / transaction planifiée
    def _find_unreconciled_prediction():
        if is_coming:
            start_op = tx_date - timedelta(days=10)
            end_op = tx_date + timedelta(days=30)
        else:
            start_op = tx_date - timedelta(days=30)
            end_op = tx_date + timedelta(days=3)

        op_query = db.query(Transaction).filter(
            Transaction.reconciliation_date == None,
            Transaction.date_operation >= start_op,
            Transaction.date_operation <= end_op,
            Transaction.amount >= abs_amount - epsilon,
            Transaction.amount <= abs_amount + epsilon
        )
        if acc_filter is not None:
            op_query = op_query.filter(acc_filter)

        available_op_query = op_query
        if matched_ids:
            available_op_query = op_query.filter(Transaction.id.notin_(matched_ids))

        op_match, op_score = best_scored_tx(available_op_query.all(), target_dt, bank_label)
        if op_match:
            return {
                "id": op_match.id,
                "description": op_match.description,
                "already_reconciled": False,
                "match_score": op_score
            }
        return None

    # Recherche des candidats parmi les prédictions non pointées et les opérations déjà pointées
    unrec_match = _find_unreconciled_prediction()
    recon_match = _find_already_reconciled()

    if unrec_match and recon_match:
        # Si les deux existent, comparer leurs scores de confiance respectifs.
        if unrec_match.get("match_score", 0) >= recon_match.get("match_score", 0):
            return unrec_match
        else:
            return recon_match
    elif unrec_match:
        return unrec_match
    elif recon_match:
        return recon_match

    # 2.B : Si aucun match libre, vérifier si c'est le pendant miroir d'un virement interne
    # déjà apparié dans ce même lot (dans matched_ids)
    if matched_ids:
        start_mirror = tx_date - timedelta(days=15)
        end_mirror = tx_date + timedelta(days=15)
        base_mirror_query = db.query(Transaction).filter(
            Transaction.reconciliation_date == None,
            Transaction.date_operation >= start_mirror,
            Transaction.date_operation <= end_mirror,
            Transaction.amount >= abs_amount - epsilon,
            Transaction.amount <= abs_amount + epsilon
        )
        if acc_filter is not None:
            base_mirror_query = base_mirror_query.filter(acc_filter)

        mirror_query = base_mirror_query.filter(
            Transaction.id.in_(matched_ids),
            or_(
                Transaction.type == "transfer",
                and_(Transaction.from_account_id.isnot(None), Transaction.to_account_id.isnot(None))
            )
        )
        mirror_match, mirror_score = best_scored_tx(mirror_query.all(), target_dt, bank_label)
        if mirror_match:
            return {
                "id": mirror_match.id,
                "description": mirror_match.description,
                "already_reconciled": True,
                "is_mirror_transfer": True,
                "match_score": mirror_score
            }

    # 3. Recherche d'un virement orphelin inter-comptes (Auto-linking)
    if account_id:
        start_orphan = tx_date - timedelta(days=15)
        end_orphan = tx_date + timedelta(days=15)

        raw_num = float(tx_amount)
        if raw_num < 0:
            orphan_q = db.query(Transaction).filter(
                Transaction.from_account_id == None,
                Transaction.to_account_id != None,
                Transaction.to_account_id != account_id,
                Transaction.date_operation >= start_orphan,
                Transaction.date_operation <= end_orphan,
                Transaction.amount >= abs_amount - epsilon,
                Transaction.amount <= abs_amount + epsilon
            )
        else:
            orphan_q = db.query(Transaction).filter(
                Transaction.from_account_id != None,
                Transaction.from_account_id != account_id,
                Transaction.to_account_id == None,
                Transaction.date_operation >= start_orphan,
                Transaction.date_operation <= end_orphan,
                Transaction.amount >= abs_amount - epsilon,
                Transaction.amount <= abs_amount + epsilon
            )

        if matched_ids:
            orphan_q = orphan_q.filter(Transaction.id.notin_(matched_ids))

        orphan_match, orphan_score = best_scored_tx(orphan_q.all(), target_dt, bank_label)
        if orphan_match:
            other_acc_id = orphan_match.to_account_id if raw_num < 0 else orphan_match.from_account_id
            other_acc = db.query(Account).filter(Account.id == other_acc_id).first()
            other_acc_name = other_acc.name if other_acc else f"Compte #{other_acc_id}"

            return {
                "id": orphan_match.id,
                "description": orphan_match.description,
                "already_reconciled": False,
                "is_orphan_transfer_link": True,
                "orphan_account_id": other_acc_id,
                "orphan_account_name": other_acc_name,
                "match_score": orphan_score
            }

    return None
