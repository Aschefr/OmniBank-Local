"""
app/services/recurrence_detector.py — Moteur de détection périodique et promotion des récurrences (Étape 4 Auto-Pilote).

Fonctionnalités :
1. Détection des signatures d'échelonnement (Alma, Klarna, Oney, Floa, Cofidis) via regex M/N.
2. Détection dynamique des charges candidates (N=2) pour anticipation dans le Reste à Vivre sans écriture en base.
3. Garde-fou anti-doublon pour le Reste à Vivre (exclusion si déjà débité dans le cycle en cours).
4. Promotion Full-Auto (N >= 3) des abonnements réguliers en RecurrenceTemplate avec liaison rétroactive.
5. Gestion du cycle de vie des paiements fractionnés avec extinction automatique à M = N (is_closed = True).
6. Traçabilité des promotions dans AutopilotDecisionLog et ActionHistory.
"""

import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from dateutil.relativedelta import relativedelta
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Account, RecurrenceTemplate, Transaction, AutopilotDecisionLog, GlobalConfig
from app.services.smart_label_service import normalize_raw_label
from app.services.history_service import record_action, snapshot_entity
from app.services import stats_cache

logger = logging.getLogger(__name__)

# Regex pour capturer les signatures fractionnées (ex: "ALMA 1/3", "KLARNA 2/4", "ONEY 1x3", "ALMA 1 3")
FRACTIONAL_PAYMENT_REGEX = re.compile(
    r'\b(ALMA|KLARNA|ONEY|FLOA|COFIDIS).*?\b(\d+)\s*[/x\s]\s*(\d+)\b',
    re.IGNORECASE
)

# Intervalle mensuel attendu avec battement calendaire (+/- 2 jours sur 28-31j)
MIN_MONTHLY_INTERVAL_DAYS = 26
MAX_MONTHLY_INTERVAL_DAYS = 33


def parse_fractional_signature(label: str) -> Optional[Tuple[str, int, int]]:
    """
    Extrait les composantes d'un paiement fractionné à partir du libellé brut.
    Renvoie (provider, current_installment, total_installments) ou None si non trouvé.
    Garde-fou : total_installments doit être compris entre 2 et 12.
    """
    if not label:
        return None
    match = FRACTIONAL_PAYMENT_REGEX.search(label)
    if not match:
        return None
    provider = match.group(1).upper()
    try:
        current_m = int(match.group(2))
        total_n = int(match.group(3))
    except (ValueError, TypeError):
        return None

    if 1 <= current_m <= total_n <= 12:
        return (provider, current_m, total_n)
    return None


def get_clean_merchant(label: str) -> str:
    """Normalise un libellé pour regrouper de manière déterministe les transactions d'un même marchand."""
    if not label:
        return ""
    normalized = normalize_raw_label(label)
    return normalized.strip().upper()


def _is_valid_expense_for_recurrence(tx: Transaction) -> bool:
    """
    Filtre strict sur les dépenses récurrentes :
    - Doit être un débit (amount > 0 ou raw_amount < 0)
    - type != 'income'
    - to_account_id == None (pas un transfert interne)
    - Les remboursements de santé (ex: CPAM) ou recettes ne doivent jamais être traités en charges.
    """
    if tx.type == "income":
        return False
    if tx.to_account_id is not None:
        return False
    if tx.amount is not None and tx.amount <= 0:
        return False
    return True


def detect_candidate_recurring_expenses(
    db: Session,
    account_id: int,
    current_date: date,
    next_pay_date: date,
    profile_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Niveau 1 — Détection dynamique déterministe des charges candidates (N >= 2)
    pour anticipation dans le calcul du Reste à Vivre sans écriture en base.
    
    Applique le garde-fou anti-doublon : une charge candidate n'est retenue
    que si aucun débit concordant n'a déjà été débité et comptabilisé
    depuis le début du cycle de paie en cours.
    """
    pid = profile_id or "default"
    cache_key = f"rec_candidates_{account_id}_{current_date.isoformat()}_{next_pay_date.isoformat()}"
    cached = stats_cache.get(pid, cache_key)
    if cached is not None:
        return cached

    # Fenêtre d'analyse : ~120 jours dans le passé jusqu'à current_date
    lookback_date = current_date - timedelta(days=120)

    # Récupérer les transactions débitrices confirmées/reconciliées sur le compte
    txs = db.query(Transaction).filter(
        Transaction.from_account_id == account_id,
        Transaction.to_account_id.is_(None),
        Transaction.date_operation >= lookback_date,
        Transaction.date_operation <= current_date,
        Transaction.reconciliation_date.isnot(None),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
        (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
    ).order_by(Transaction.date_operation.asc()).all()

    # Filtrer les dépenses et exclure les fractionnés déjà terminés
    eligible_txs = [t for t in txs if _is_valid_expense_for_recurrence(t)]

    # Charger les templates de récurrence actifs pour ce compte afin d'éviter les doublons
    active_templates = db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.from_account_id == account_id) | (RecurrenceTemplate.from_account_id.is_(None)),
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed.is_(None))
    ).all()
    active_tpl_signatures = set()
    for tpl in active_templates:
        clean_desc = get_clean_merchant(tpl.description)
        active_tpl_signatures.add((clean_desc, round(float(tpl.amount or 0.0), 2)))

    # Déterminer le début du cycle de paie en cours (1 mois avant next_pay_date)
    cycle_start_date = next_pay_date - relativedelta(months=1)

    # Regrouper par (clean_merchant, amount)
    grouped: Dict[Tuple[str, float], List[Transaction]] = {}
    for t in eligible_txs:
        # Si c'est un paiement fractionné, on utilise le provider comme clé
        frac = parse_fractional_signature(t.description)
        if frac:
            clean_merchant = frac[0]
        else:
            clean_merchant = get_clean_merchant(t.description)

        amt = round(float(t.amount or 0.0), 2)
        key = (clean_merchant, amt)
        grouped.setdefault(key, []).append(t)

    candidates: List[Dict[str, Any]] = []

    for (clean_merchant, amt), group_txs in grouped.items():
        # Ignorer si un template actif existe déjà pour ce montant et ce marchand
        if (clean_merchant, amt) in active_tpl_signatures:
            continue
        # Recherche tolérante si le nom contient ou est contenu dans le template
        if any(tpl_sig[1] == amt and (tpl_sig[0] in clean_merchant or clean_merchant in tpl_sig[0]) for tpl_sig in active_tpl_signatures):
            continue

        # Vérifier si on a au moins 2 occurrences consécutives avec intervalle 26-33 jours
        dates = [t.date_operation for t in group_txs]
        dates.sort()

        matching_chain_len = 1
        for i in range(len(dates) - 1):
            delta = (dates[i + 1] - dates[i]).days
            if MIN_MONTHLY_INTERVAL_DAYS <= delta <= MAX_MONTHLY_INTERVAL_DAYS:
                matching_chain_len += 1
            else:
                # Si la rupture est trop ancienne, réinitialiser la chaîne
                matching_chain_len = 1

        if matching_chain_len >= 2:
            # GARDE-FOU ANTI-DOUBLON :
            # Vérifier si un débit concordant a déjà été débité et comptabilisé depuis le début du cycle en cours
            already_debited = any(
                t.date_operation >= cycle_start_date and t.date_operation <= current_date
                for t in group_txs
            )
            if not already_debited:
                latest_tx = group_txs[-1]
                candidates.append({
                    "merchant": clean_merchant,
                    "amount": amt,
                    "occurrences": matching_chain_len,
                    "category": latest_tx.category,
                    "day_of_month": latest_tx.date_operation.day
                })

    stats_cache.set(pid, cache_key, candidates)
    return candidates


def process_recurrence_promotions(
    db: Session,
    account_id: int,
    profile_id: Optional[str] = None,
    batch_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Niveau 2 & Paiements fractionnés :
    - Identifie les signatures fractionnées (Alma, Klarna...), crée le template borné avec max_occurrences,
      rattache rétroactivement les écritures réelles passées, et clôture automatiquement à M = N (is_closed = True).
    - Pour les abonnements ordinaires (N >= 3 consécutifs sans signature fractionnée) :
      officialise automatiquement en RecurrenceTemplate actif, lie rétroactivement les écritures passées,
      et déclenche generate_recurrences.
    """
    pid = profile_id or "default"
    bid = batch_id or "auto_pilot_promotion"

    promoted_count = 0
    fractional_processed = 0
    closed_templates = 0

    # 1. Traitement des paiements fractionnés (Alma / Klarna / Oney...)
    recent_txs = db.query(Transaction).filter(
        Transaction.from_account_id == account_id,
        Transaction.reconciliation_date.isnot(None),
        (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
    ).order_by(Transaction.date_operation.asc()).all()

    fractional_groups: Dict[Tuple[str, float, int], List[Transaction]] = {}
    for tx in recent_txs:
        frac = parse_fractional_signature(tx.description)
        if frac:
            provider, current_m, total_n = frac
            amt = round(float(tx.amount or 0.0), 2)
            fractional_groups.setdefault((provider, amt, total_n), []).append(tx)

    for (provider, amt, total_n), f_txs in fractional_groups.items():
        # Trouver ou créer le template
        tpl = db.query(RecurrenceTemplate).filter(
            RecurrenceTemplate.from_account_id == account_id,
            RecurrenceTemplate.amount == amt,
            RecurrenceTemplate.max_occurrences == total_n
        ).first()

        latest_f_tx = f_txs[-1]
        frac_latest = parse_fractional_signature(latest_f_tx.description)
        latest_m = frac_latest[1] if frac_latest else len(f_txs)
        is_final_installment = (latest_m >= total_n or len(f_txs) >= total_n)

        if not tpl:
            clean_desc = f"{provider.capitalize()} {total_n}x"
            tpl = RecurrenceTemplate(
                description=clean_desc,
                amount=amt,
                type="expense_fixed",
                category=latest_f_tx.category or "Achats",
                frequency="Monthly",
                day_of_month=latest_f_tx.date_operation.day,
                max_occurrences=total_n,
                from_account_id=account_id,
                is_closed=is_final_installment
            )
            db.add(tpl)
            db.flush()

            record_action(
                db,
                "recurrence_template",
                tpl.id,
                "CREATE",
                None,
                snapshot_entity(tpl),
                user_name="Automatisme (Fractionné)"
            )

            # Liaison rétroactive immédiate des transactions existantes
            for t in f_txs:
                t.recurrence_id = tpl.id
                t.type = "expense_fixed"
            db.flush()

            # Journalisation de la décision
            snap_payload = {
                "provider": provider,
                "total_installments": total_n,
                "current_installment": latest_m,
                "linked_transactions": [t.id for t in f_txs],
                "template_id": tpl.id,
                "is_closed": is_final_installment
            }
            decision = AutopilotDecisionLog(
                batch_id=bid,
                decision_type="recurrence_promotion",
                action="PROMOTED_FRACTIONAL",
                entity_type="recurrence_template",
                entity_id=tpl.id,
                account_id=account_id,
                raw_snapshot=json.dumps(snap_payload, default=str),
                confidence_score=100.0,
                is_undone=False
            )
            db.add(decision)
            fractional_processed += 1
            if is_final_installment:
                closed_templates += 1
            else:
                try:
                    from app.routers.recurrences import generate_recurrences
                    generate_recurrences(template_id=tpl.id, db=db)
                except Exception as gen_err:
                    logger.warning(f"[AutoPilot] Erreur lors de la génération prévisionnelle fractionnée {tpl.id}: {gen_err}")
        else:
            # Le template existe déjà : s'assurer de la liaison rétroactive
            for t in f_txs:
                if t.recurrence_id != tpl.id:
                    t.recurrence_id = tpl.id
                    t.type = "expense_fixed"

            if is_final_installment and not tpl.is_closed:
                tpl.is_closed = True
                db.add(tpl)
                closed_templates += 1
                # Purger toute éventuelle transaction future non rapprochée au-delà de la date d'opération
                db.query(Transaction).filter(
                    Transaction.recurrence_id == tpl.id,
                    Transaction.reconciliation_date.is_(None),
                    Transaction.date_operation > latest_f_tx.date_operation
                ).delete()

    # 2. Promotion Full-Auto pour abonnements ordinaires (N >= 3)
    cfg_promote = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_promote_recurrences").first()
    promote_enabled = (cfg_promote.value.strip().lower() in ("true", "1", "yes")) if (cfg_promote and cfg_promote.value) else False

    if promote_enabled:
        cfg_since = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_promote_recurrences_since").first()
        since_date_str = cfg_since.value.strip() if (cfg_since and cfg_since.value) else None
        since_date = None
        if since_date_str:
            try:
                since_date = datetime.strptime(since_date_str[:10], "%Y-%m-%d").date()
            except Exception:
                since_date = None

        ordinary_txs = []
        for tx in recent_txs:
            if since_date:
                t_date = tx.date_operation
                if isinstance(t_date, datetime):
                    t_date = t_date.date()
                elif isinstance(t_date, str):
                    try:
                        t_date = datetime.strptime(t_date[:10], "%Y-%m-%d").date()
                    except Exception:
                        t_date = None
                if t_date and t_date < since_date:
                    continue
            ordinary_txs.append(tx)

        ordinary_groups: Dict[Tuple[str, float], List[Transaction]] = {}
        for tx in ordinary_txs:
            if not _is_valid_expense_for_recurrence(tx):
                continue
            # Exclure formellement les fractionnés de la promotion infinie
            if parse_fractional_signature(tx.description):
                continue

            clean_merchant = get_clean_merchant(tx.description)
            amt = round(float(tx.amount or 0.0), 2)
            ordinary_groups.setdefault((clean_merchant, amt), []).append(tx)

        for (clean_merchant, amt), o_txs in ordinary_groups.items():
            # 1. Si toutes les transactions sont déjà rattachées à un template (actif ou clôturé), ignorer
            if all(t.recurrence_id is not None for t in o_txs):
                continue

            # 2. Vérifier si un template (actif ou clôturé) existe déjà pour ce compte
            existing_tpl = db.query(RecurrenceTemplate).filter(
                RecurrenceTemplate.from_account_id == account_id,
                RecurrenceTemplate.amount == amt,
                (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed.is_(None))
            ).first()

            closed_tpl = db.query(RecurrenceTemplate).filter(
                RecurrenceTemplate.from_account_id == account_id,
                RecurrenceTemplate.amount == amt,
                RecurrenceTemplate.is_closed == True
            ).first()

            # Vérifier les recurrence_id existants parmi les transactions
            existing_rec_ids = {t.recurrence_id for t in o_txs if t.recurrence_id}
            if existing_rec_ids:
                linked_tpls = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id.in_(existing_rec_ids)).all()
                for lt in linked_tpls:
                    if lt.is_closed:
                        closed_tpl = lt
                    elif not existing_tpl:
                        existing_tpl = lt

            # Vérifier par correspondance de libellé marchand
            if not existing_tpl and not closed_tpl:
                all_acc_tpls = db.query(RecurrenceTemplate).filter(
                    RecurrenceTemplate.from_account_id == account_id
                ).all()
                for atpl in all_acc_tpls:
                    if atpl.description and clean_merchant and (
                        atpl.description.strip().lower() == clean_merchant.strip().lower() or
                        clean_merchant.strip().lower() in atpl.description.strip().lower() or
                        atpl.description.strip().lower() in clean_merchant.strip().lower()
                    ):
                        if atpl.is_closed:
                            closed_tpl = atpl
                        else:
                            existing_tpl = atpl
                        break

            # Si un template clôturé correspond : ignorer silencieusement le groupe (ne pas recréer de template)
            if closed_tpl and not existing_tpl:
                continue

            if existing_tpl:
                # S'assurer du rattachement des transactions au template existant
                for t in o_txs:
                    if t.recurrence_id != existing_tpl.id:
                        t.recurrence_id = existing_tpl.id
                        t.type = "expense_fixed"
                continue

            # Vérifier les intervalles consécutifs (au moins 2 intervalles valides => 3 transactions consécutives)
            dates = [t.date_operation for t in o_txs]
            dates.sort()

            consecutive_intervals = 0
            chain_txs = [o_txs[0]]
            for i in range(len(dates) - 1):
                delta = (dates[i + 1] - dates[i]).days
                if MIN_MONTHLY_INTERVAL_DAYS <= delta <= MAX_MONTHLY_INTERVAL_DAYS:
                    consecutive_intervals += 1
                    chain_txs.append(o_txs[i + 1])
                else:
                    consecutive_intervals = 0
                    chain_txs = [o_txs[i + 1]]

            # Promotion automatique à partir du 3ème mois consécutif (N >= 3)
            if consecutive_intervals >= 2 and len(chain_txs) >= 3:
                latest_tx = chain_txs[-1]
                tpl = RecurrenceTemplate(
                    description=clean_merchant,
                    amount=amt,
                    type="expense_fixed",
                    category=latest_tx.category or "Abonnements",
                    frequency="Monthly",
                    day_of_month=latest_tx.date_operation.day,
                    max_occurrences=None,
                    from_account_id=account_id,
                    is_closed=False
                )
                db.add(tpl)
                db.flush()

                # Liaison rétroactive immédiate
                for t in chain_txs:
                    t.recurrence_id = tpl.id
                    t.type = "expense_fixed"
                db.flush()

                record_action(
                    db,
                    "recurrence_template",
                    tpl.id,
                    "CREATE",
                    None,
                    snapshot_entity(tpl),
                    user_name="Automatisme (Récurrence N=3)"
                )

                # Inscription au journal de décision Auto-Pilote
                snap_payload = {
                    "merchant": clean_merchant,
                    "amount": amt,
                    "consecutive_months": len(chain_txs),
                    "linked_transactions": [t.id for t in chain_txs],
                    "template_id": tpl.id
                }
                decision = AutopilotDecisionLog(
                    batch_id=bid,
                    decision_type="recurrence_promotion",
                    action="AUTO_COMMIT",
                    entity_type="recurrence_template",
                    entity_id=tpl.id,
                    account_id=account_id,
                    raw_snapshot=json.dumps(snap_payload, default=str),
                    confidence_score=100.0,
                    is_undone=False
                )
                db.add(decision)
                promoted_count += 1

                # Génération ordonnée des futures occurrences
                try:
                    from app.routers.recurrences import generate_recurrences
                    generate_recurrences(template_id=tpl.id, db=db)
                except Exception as gen_err:
                    logger.warning(f"[AutoPilot] Erreur lors de la génération prévisionnelle pour le template {tpl.id}: {gen_err}")

    # 3. Détection et Auto-Propagation des hausses tarifaires pérennes (N=3)
    cfg_link = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_link_deviant_recurrences").first()
    link_enabled = (cfg_link.value.strip().lower() in ("true", "1", "yes")) if (cfg_link and cfg_link.value) else True

    cfg_hikes = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_propagate_recurrence_hikes").first()
    propagate_hikes_enabled = (cfg_hikes.value.strip().lower() in ("true", "1", "yes")) if (cfg_hikes and cfg_hikes.value) else True

    propagated_hikes_count = 0
    if link_enabled and propagate_hikes_enabled:
        active_templates = db.query(RecurrenceTemplate).filter(
            RecurrenceTemplate.from_account_id == account_id,
            (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed.is_(None)),
            RecurrenceTemplate.max_occurrences.is_(None)
        ).all()

        for tpl in active_templates:
            reconciled_txs = db.query(Transaction).filter(
                Transaction.recurrence_id == tpl.id,
                Transaction.reconciliation_date.isnot(None),
                (Transaction.is_skipped == False) | (Transaction.is_skipped.is_(None))
            ).order_by(Transaction.date_operation.desc()).all()

            if len(reconciled_txs) < 3:
                continue

            t1, t2, t3 = reconciled_txs[0], reconciled_txs[1], reconciled_txs[2]
            a1 = round(float(t1.amount or 0.0), 2)
            a2 = round(float(t2.amount or 0.0), 2)
            a3 = round(float(t3.amount or 0.0), 2)
            tpl_amt = round(float(tpl.amount or 0.0), 2)

            if a1 == a2 == a3 and a1 != tpl_amt:
                d1 = t1.date_operation
                d2 = t2.date_operation
                d3 = t3.date_operation
                if d1 and d2 and d3:
                    delta_1_2 = abs((d1 - d2).days)
                    delta_2_3 = abs((d2 - d3).days)
                    if (MIN_MONTHLY_INTERVAL_DAYS <= delta_1_2 <= MAX_MONTHLY_INTERVAL_DAYS and
                        MIN_MONTHLY_INTERVAL_DAYS <= delta_2_3 <= MAX_MONTHLY_INTERVAL_DAYS):
                        old_amt = tpl.amount
                        tpl.amount = a1
                        db.flush()

                        propagate_recurrence_update(db, tpl.id)

                        snap_payload = {
                            "template_id": tpl.id,
                            "template_description": tpl.description,
                            "old_amount": old_amt,
                            "new_amount": a1,
                            "consecutive_months": 3,
                            "linked_tx_ids": [t1.id, t2.id, t3.id]
                        }
                        decision = AutopilotDecisionLog(
                            batch_id=bid,
                            decision_type="recurrence_hike",
                            action="AUTO_PROPAGATE_HIKE",
                            entity_type="recurrence_template",
                            entity_id=tpl.id,
                            account_id=account_id,
                            raw_snapshot=json.dumps(snap_payload, default=str),
                            confidence_score=100.0,
                            is_undone=False
                        )
                        db.add(decision)
                        propagated_hikes_count += 1
                        logger.info(f"[AutoPilot] Template #{tpl.id} ('{tpl.description}') : Hausse tarifaire pérenne propagée ({old_amt} € -> {a1} €)")

    db.commit()
    stats_cache.invalidate(pid)

    return {
        "promoted_templates": promoted_count,
        "fractional_processed": fractional_processed,
        "closed_templates": closed_templates,
        "propagated_hikes": propagated_hikes_count,
        "hikes_propagated": propagated_hikes_count
    }


def propagate_recurrence_update(db: Session, template_id: int):
    """
    Supprime les futures prévisions non pointées pour ce template
    et régénère les nouvelles échéances au nouveau montant,
    en conservant fidèlement toutes les écritures passées déjà rapprochées.
    """
    unreconciled_future = db.query(Transaction).filter(
        Transaction.recurrence_id == template_id,
        Transaction.reconciliation_date.is_(None)
    ).all()
    for fut_tx in unreconciled_future:
        db.delete(fut_tx)
    db.flush()
    db.expire_all()
    from app.routers.recurrences import generate_recurrences
    generate_recurrences(template_id=template_id, db=db)


def process_auto_skipping(
    db: Session,
    account_id: int,
    bank_balance: Optional[float] = None,
    profile_id: Optional[str] = None,
    batch_id: Optional[str] = None,
    current_date: Optional[date] = None,
) -> Dict[str, Any]:
    """
    Brique 3 & 4 :
    - Auto-Saut conditionnel d'échéances non prélevées sous triple verrou :
        1. Solde bancaire officiel distant == solde pointé OmniBank (|Δ| < 0.005 €)
        2. Sas d'attente 100% vide pour ce compte (pending == 0)
        3. Date d'échéance + 1 période + 3 jours de battement dépassée
    - Auto-Clôture après 3 échéances sautées consécutives (contrats abandonnés ou résiliés).
    """
    pid = profile_id or "default"
    bid = batch_id or "auto_skip_routine"
    today = current_date or date.today()

    # 1. Vérifier si l'auto-saut et l'auto-liaison sont activés (hiérarchie des règles)
    cfg_link = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_link_deviant_recurrences").first()
    link_enabled = (cfg_link.value.strip().lower() in ("true", "1", "yes")) if (cfg_link and cfg_link.value) else True

    cfg_skip = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_skip_unreconciled_recurrences").first()
    skip_enabled = (cfg_skip.value.strip().lower() in ("true", "1", "yes")) if (cfg_skip and cfg_skip.value) else True

    if not (link_enabled and skip_enabled):
        return {"skipped_count": 0, "closed_templates": 0}

    # 2. Vérifier le triple verrou
    acc = db.query(Account).filter(Account.id == account_id).first()
    if not acc:
        return {"skipped_count": 0, "closed_templates": 0}

    from app.services.finance_engine import calculate_balances
    balances_reconciled = calculate_balances(db, only_reconciled=True)
    local_reconciled_bal = round(balances_reconciled.get(acc.id, acc.initial_balance or 0.0), 2)

    from app.services.bank_sync.pending_store import _PENDING_SYNC_DATA, _get_config_value
    prof_data = _PENDING_SYNC_DATA.get(pid, {})
    if not prof_data:
        raw = _get_config_value(db, "bank_pending_sync_cache", "")
        if raw:
            try:
                cached = json.loads(raw)
                for k, v in cached.items():
                    prof_data[int(k)] = v
            except Exception:
                pass

    if bank_balance is None:
        for cid, data in prof_data.items():
            for p_acc in data.get("accounts", []):
                if p_acc.get("account_id") == account_id and p_acc.get("bank_balance") is not None:
                    bank_balance = float(p_acc["bank_balance"])
                    break
            if bank_balance is not None:
                break

    if bank_balance is None:
        logger.info(f"[AutoSkip] Compte #{account_id}: Aucun solde bancaire distant de référence. Auto-saut neutralisé.")
        return {"skipped_count": 0, "closed_templates": 0}

    # Verrou 1 : Solde conforme (|Δ| < 0.005 €)
    if abs(float(bank_balance) - local_reconciled_bal) >= 0.005:
        logger.info(f"[AutoSkip] Compte #{account_id}: Solde bancaire distant ({bank_balance} €) différent du solde local pointé ({local_reconciled_bal} €). Auto-saut neutralisé.")
        return {"skipped_count": 0, "closed_templates": 0}

    # Verrou 2 : Sas d'attente vide pour ce compte
    pending_count = 0
    for cid, data in prof_data.items():
        for p_acc in data.get("accounts", []):
            if p_acc.get("account_id") == account_id:
                for tx in p_acc.get("transactions", []):
                    if not tx.get("is_dismissed") and not tx.get("_excluded"):
                        pending_count += 1
    if pending_count > 0:
        logger.info(f"[AutoSkip] Compte #{account_id}: Sas non vide ({pending_count} opérations en attente). Auto-saut neutralisé.")
        return {"skipped_count": 0, "closed_templates": 0}

    # Verrou 3 : Échéance + 1 période + 3 jours dépassée
    unreconciled_recurrences = db.query(Transaction).filter(
        Transaction.from_account_id == account_id,
        Transaction.reconciliation_date.is_(None),
        Transaction.recurrence_id.isnot(None),
        or_(Transaction.is_skipped == False, Transaction.is_skipped.is_(None))
    ).all()

    skipped_count = 0
    templates_to_check: Set[int] = set()

    for tx in unreconciled_recurrences:
        tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tx.recurrence_id).first()
        if not tpl or not tx.date_operation:
            continue

        freq = (tpl.frequency or "Monthly").capitalize()
        d = tx.date_operation
        if freq == "Monthly":
            year = d.year + (1 if d.month == 12 else 0)
            month = 1 if d.month == 12 else d.month + 1
            day = min(d.day, 28)
            limit_date = date(year, month, day) + timedelta(days=3)
        elif freq == "Weekly":
            limit_date = d + timedelta(days=7 + 3)
        elif freq == "Quarterly":
            limit_date = d + timedelta(days=90 + 3)
        elif freq == "Yearly":
            limit_date = date(d.year + 1, d.month, min(d.day, 28)) + timedelta(days=3)
        else:
            limit_date = d + timedelta(days=34)

        if today >= limit_date:
            tx.is_skipped = True
            tx.comment = "Auto-sauté (échéance non prélevée)"
            skipped_count += 1
            templates_to_check.add(tpl.id)

            snap_payload = {
                "tx_id": tx.id,
                "template_id": tpl.id,
                "template_description": tpl.description,
                "amount": tx.amount,
                "date_operation": str(tx.date_operation),
                "limit_date": str(limit_date),
                "bank_balance": bank_balance,
                "local_balance": local_reconciled_bal
            }
            decision = AutopilotDecisionLog(
                batch_id=bid,
                decision_type="recurrence_skip",
                action="AUTO_SKIPPED_UNRECONCILED",
                entity_type="transaction",
                entity_id=tx.id,
                account_id=account_id,
                raw_snapshot=json.dumps(snap_payload, default=str),
                confidence_score=100.0,
                is_undone=False
            )
            db.add(decision)
            logger.info(f"[AutoSkip] Transaction #{tx.id} ('{tx.description}', {tx.amount} €) auto-sautée.")

    # 4. Brique 4 : Auto-Clôture après 3 sauts consécutifs
    closed_templates_count = 0
    cfg_close = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_close_unreconciled_recurrences").first()
    close_enabled = (cfg_close.value.strip().lower() in ("true", "1", "yes")) if (cfg_close and cfg_close.value) else True

    if close_enabled:
        active_account_tpls = db.query(RecurrenceTemplate).filter(
            RecurrenceTemplate.from_account_id == account_id,
            or_(RecurrenceTemplate.is_closed == False, RecurrenceTemplate.is_closed.is_(None))
        ).all()
        templates_to_eval = set(templates_to_check).union({t.id for t in active_account_tpls})

        for tpl_id in templates_to_eval:
            tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
            if not tpl or tpl.is_closed:
                continue

            all_past_occurrences = db.query(Transaction).filter(
                Transaction.recurrence_id == tpl.id,
                Transaction.date_operation <= today
            ).order_by(Transaction.date_operation.desc()).all()

            if len(all_past_occurrences) >= 3:
                last_3 = all_past_occurrences[:3]
                if all(t.is_skipped is True for t in last_3):
                    tpl.is_closed = True
                    db.flush()

                    db.query(Transaction).filter(
                        Transaction.recurrence_id == tpl.id,
                        Transaction.reconciliation_date.is_(None),
                        Transaction.date_operation > last_3[0].date_operation
                    ).delete()

                    closed_templates_count += 1
                    snap_payload = {
                        "template_id": tpl.id,
                        "description": tpl.description,
                        "consecutive_skipped": 3,
                        "skipped_tx_ids": [t.id for t in last_3]
                    }
                    decision = AutopilotDecisionLog(
                        batch_id=bid,
                        decision_type="recurrence_close",
                        action="AUTO_CLOSED_SKIPPED",
                        entity_type="recurrence_template",
                        entity_id=tpl.id,
                        account_id=account_id,
                        raw_snapshot=json.dumps(snap_payload, default=str),
                        confidence_score=100.0,
                        is_undone=False
                    )
                    db.add(decision)
                    logger.info(f"[AutoClose] Template #{tpl.id} ('{tpl.description}') clôturé automatiquement après 3 sauts consécutifs.")

    if skipped_count > 0 or closed_templates_count > 0:
        db.commit()
        stats_cache.invalidate(pid)

    return {
        "skipped_count": skipped_count,
        "closed_templates": closed_templates_count
    }
