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


# Mots qui ne désignent pas un marchand : passerelles de paiement et termes bancaires génériques
_NON_MERCHANT_WORDS = {
    "PAYPAL", "STRIPE", "SUMUP", "LYDIA", "KLARNA", "CARTE", "PRLV", "PRELEVEMENT", "SEPA", "VIREMENT", "VIR",
    "FACTURE", "PAIEMENT", "ACHAT", "RETRAIT", "WEB", "INST", "VERS", "EUROPE", "SARL", "CIE",
}


def label_words(label: Optional[str]) -> set:
    """Mots distinctifs d'un libellé (normalisé, 3 lettres et plus, hors passerelles et termes génériques)."""
    if not label:
        return set()
    return {w for w in normalize_raw_label(label).upper().split() if len(w) >= 3 and w not in _NON_MERCHANT_WORDS}


def template_matches_labels(db: Session, tpl: RecurrenceTemplate, txs: List[Transaction]) -> bool:
    """Un modèle de récurrence de même montant ne vaut pour ces opérations que s'il désigne le même marchand :
    un mot en commun avec les libellés bancaires déjà pointés sur le modèle, ou, s'il n'en a pas, avec son nom."""
    words = set()
    for t in txs:
        words |= label_words(t.raw_description) | label_words(t.description)
    if not words:
        return False
    tx_ids = {t.id for t in txs if t.id is not None}
    known = set()
    for tid, raw in db.query(Transaction.id, Transaction.raw_description).filter(
        Transaction.recurrence_id == tpl.id,
        Transaction.csv_id.isnot(None),
        Transaction.raw_description.isnot(None),
        Transaction.reconciliation_date.isnot(None),  # une annonce « à venir » n'est pas encore une preuve
    ).all():
        if tid not in tx_ids:
            known |= label_words(raw)
    if known:
        return bool(known & words)
    return bool(label_words(tpl.description) & words)


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
        frac = parse_fractional_signature(t.raw_description or t.description)
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
        frac = parse_fractional_signature(tx.raw_description or tx.description)
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
        frac_latest = parse_fractional_signature(latest_f_tx.raw_description or latest_f_tx.description)
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
            if parse_fractional_signature(tx.raw_description or tx.description):
                continue

            clean_merchant = get_clean_merchant(tx.description)
            amt = round(float(tx.amount or 0.0), 2)
            ordinary_groups.setdefault((clean_merchant, amt), []).append(tx)

        for (clean_merchant, amt), o_txs in ordinary_groups.items():
            # 1. Si toutes les transactions sont déjà rattachées à un template (actif ou clôturé), ignorer
            if all(t.recurrence_id is not None for t in o_txs):
                continue

            # 2. Vérifier si un template (actif ou clôturé) de même montant existe déjà pour ce compte. Le montant
            # seul ne suffit pas : un médecin à 10 € n'est pas l'« Offre Essentiel » à 10 €.
            same_amount = [
                tpl for tpl in db.query(RecurrenceTemplate).filter(
                    RecurrenceTemplate.from_account_id == account_id,
                    RecurrenceTemplate.amount == amt,
                ).all()
                if template_matches_labels(db, tpl, o_txs)
            ]
            existing_tpl = next((tpl for tpl in same_amount if not tpl.is_closed), None)
            closed_tpl = next((tpl for tpl in same_amount if tpl.is_closed), None)

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

                # Synchronisation automatique de l'enveloppe budgétaire
                try:
                    from app.services.budget_service import sync_budget_from_recurrence_change
                    sync_budget_from_recurrence_change(
                        db,
                        category=tpl.category,
                        change_type="promotion",
                        amount_delta=amt,
                        batch_id=bid,
                        profile_id=pid,
                        frequency=tpl.frequency,
                    )
                except Exception as sync_b_err:
                    logger.debug(f"[AutoPilot] Sync budget promotion ignorée: {sync_b_err}")

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

            if a1 == a2 == a3 and a1 != tpl_amt and a1 > 0:
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

                        # Synchronisation de l'enveloppe budgétaire suite à la hausse
                        try:
                            from app.services.budget_service import sync_budget_from_recurrence_change
                            sync_budget_from_recurrence_change(
                                db,
                                category=tpl.category,
                                change_type="hike",
                                amount_delta=(a1 - old_amt),
                                batch_id=bid,
                                profile_id=pid,
                                frequency=tpl.frequency,
                            )
                        except Exception as sync_b_err:
                            logger.debug(f"[AutoPilot] Sync budget hike ignorée: {sync_b_err}")

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


# Une opération du sas non rattachée ne retient une échéance que si son montant
# reste dans ce facteur (16 € retenu par 8 à 32 €, pas par un achat de 3 €).
SKIP_HOLD_AMOUNT_FACTOR = 2.0


def auto_skip_limit_date(d: date, frequency: Optional[str]) -> date:
    """Date à partir de laquelle une échéance non prélevée peut être sautée : 1 période + 3 jours."""
    freq = (frequency or "Monthly").capitalize()
    if freq == "Monthly":
        year = d.year + (1 if d.month == 12 else 0)
        month = 1 if d.month == 12 else d.month + 1
        return date(year, month, min(d.day, 28)) + timedelta(days=3)
    if freq == "Weekly":
        return d + timedelta(days=7 + 3)
    if freq == "Quarterly":
        return d + timedelta(days=90 + 3)
    if freq == "Yearly":
        return date(d.year + 1, d.month, min(d.day, 28)) + timedelta(days=3)
    return d + timedelta(days=34)


def _config_flag(db: Session, key: str) -> bool:
    cfg = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    return (cfg.value.strip().lower() in ("true", "1", "yes")) if (cfg and cfg.value) else True


def auto_skip_enabled(db: Session) -> bool:
    """L'auto-saut dépend de l'auto-liaison (hiérarchie des règles)."""
    return _config_flag(db, "auto_link_deviant_recurrences") and _config_flag(db, "auto_skip_unreconciled_recurrences")


def _pending_accounts(db: Session, profile_id: Optional[str], account_id: int) -> List[Dict[str, Any]]:
    """Entrées du sas d'attente (toutes connexions) pour ce compte."""
    from app.services.bank_sync.pending_store import _PENDING_SYNC_DATA, _get_config_value, _resolve_profile_id
    prof_data = _PENDING_SYNC_DATA.get(_resolve_profile_id(profile_id)) or {}
    if not prof_data:
        raw = _get_config_value(db, "bank_pending_sync_cache", "")
        if raw:
            try:
                prof_data = json.loads(raw)
            except Exception:
                prof_data = {}
    return [
        p_acc
        for data in prof_data.values()
        for p_acc in (data or {}).get("accounts", [])
        if p_acc.get("account_id") == account_id
    ]


def pending_bank_ops(db: Session, profile_id: Optional[str], account_id: int) -> List[Dict[str, Any]]:
    """Opérations du sas encore à traiter pour ce compte."""
    return [
        tx
        for p_acc in _pending_accounts(db, profile_id, account_id)
        for tx in p_acc.get("transactions", [])
        if not tx.get("is_dismissed") and not tx.get("_excluded")
    ]


def _pending_op_may_be(op: Dict[str, Any], tx: Transaction) -> bool:
    """Cette opération du sas pourrait-elle être le prélèvement de l'échéance ?"""
    matched = op.get("matched_db_id")
    if matched is not None:
        return matched == tx.id
    raw = op.get("raw_amount")
    if raw is None:
        raw = -abs(float(op.get("amount") or 0.0))
    raw = float(raw)
    if raw >= 0:
        return False
    expected = abs(float(tx.amount or 0.0))
    if expected <= 0:
        return False
    return expected / SKIP_HOLD_AMOUNT_FACTOR <= abs(raw) <= expected * SKIP_HOLD_AMOUNT_FACTOR


def overdue_unpaid_echeances(
    db: Session, account_id: int, today: date, pending_ops: Optional[List[Dict[str, Any]]] = None
) -> Tuple[List[Transaction], List[Transaction], List[Transaction]]:
    """
    Échéances récurrentes passées et non prélevées sur ce compte, en trois groupes :
    - ready  : délai de saut écoulé, aucune opération du sas ne peut être leur prélèvement ;
    - held   : délai écoulé, mais une opération du sas pourrait l'être ;
    - late   : en retard, délai de saut pas encore écoulé, et pas encore annoncée par la banque
               (aucune opération du sas rattachée à elle).
    Les groupes ready et held ne sont remplis que si l'auto-saut est actif.
    """
    rows = db.query(Transaction).filter(
        Transaction.from_account_id == account_id,
        Transaction.reconciliation_date.is_(None),
        Transaction.recurrence_id.isnot(None),
        Transaction.date_operation < today,
        or_(Transaction.is_skipped == False, Transaction.is_skipped.is_(None)),
        or_(Transaction.cross_profile_status.is_(None), Transaction.cross_profile_status != "pending"),
    ).order_by(Transaction.date_operation).all()
    if not rows:
        return [], [], []

    skip_on = auto_skip_enabled(db)
    ops = pending_ops or []
    freqs = dict(db.query(RecurrenceTemplate.id, RecurrenceTemplate.frequency).filter(
        RecurrenceTemplate.id.in_({tx.recurrence_id for tx in rows})
    ).all())
    announced = {op.get("matched_db_id") for op in ops if op.get("matched_db_id") is not None}
    ready, held, late = [], [], []
    for tx in rows:
        if tx.recurrence_id not in freqs:
            continue
        if not skip_on or today < auto_skip_limit_date(tx.date_operation, freqs[tx.recurrence_id]):
            if tx.id not in announced:
                late.append(tx)
        elif any(_pending_op_may_be(op, tx) for op in ops):
            held.append(tx)
        else:
            ready.append(tx)
    return ready, held, late


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
        2. Aucune opération du sas ne peut être le prélèvement de l'échéance
           (rattachée à elle, ou non rattachée avec un montant compatible)
        3. Date d'échéance + 1 période + 3 jours de battement dépassée
    - Auto-Clôture après 3 échéances sautées consécutives (contrats abandonnés ou résiliés).
    """
    bid = batch_id or "auto_skip_routine"
    today = current_date or date.today()

    # 1. Vérifier si l'auto-saut et l'auto-liaison sont activés (hiérarchie des règles)
    if not auto_skip_enabled(db):
        return {"skipped_count": 0, "closed_templates": 0}

    # 2. Vérifier le triple verrou
    acc = db.query(Account).filter(Account.id == account_id).first()
    if not acc:
        return {"skipped_count": 0, "closed_templates": 0}

    from app.services.finance_engine import calculate_balances
    balances_reconciled = calculate_balances(db, only_reconciled=True)
    local_reconciled_bal = round(balances_reconciled.get(acc.id, acc.initial_balance or 0.0), 2)

    if bank_balance is None:
        for p_acc in _pending_accounts(db, profile_id, account_id):
            if p_acc.get("bank_balance") is not None:
                bank_balance = float(p_acc["bank_balance"])
                break

    if bank_balance is None:
        logger.info(f"[AutoSkip] Compte #{account_id}: Aucun solde bancaire distant de référence. Auto-saut neutralisé.")
        return {"skipped_count": 0, "closed_templates": 0}

    # Verrou 1 : Solde conforme (|Δ| < 0.005 €)
    if abs(float(bank_balance) - local_reconciled_bal) >= 0.005:
        logger.info(f"[AutoSkip] Compte #{account_id}: Solde bancaire distant ({bank_balance} €) différent du solde local pointé ({local_reconciled_bal} €). Auto-saut neutralisé.")
        return {"skipped_count": 0, "closed_templates": 0}

    # Verrous 2 et 3 : délai écoulé, aucune opération du sas ne peut être le prélèvement
    ready, held, _late = overdue_unpaid_echeances(db, account_id, today, pending_bank_ops(db, profile_id, account_id))
    for tx in held:
        logger.info(f"[AutoSkip] Transaction #{tx.id} ('{tx.description}', {tx.amount} €) retenue : une opération du sas peut être son prélèvement.")

    skipped_count = 0
    templates_to_check: Set[int] = set()
    templates = {t.id: t for t in db.query(RecurrenceTemplate).filter(
        RecurrenceTemplate.id.in_({tx.recurrence_id for tx in ready})
    ).all()} if ready else {}

    for tx in ready:
        tpl = templates.get(tx.recurrence_id)
        if not tpl:
            continue
        limit_date = auto_skip_limit_date(tx.date_operation, tpl.frequency)
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
            "local_balance": local_reconciled_bal,
            "decision_reason": "unreconciled_overdue"
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
                        "template_description": tpl.description,
                        "description": tpl.description,
                        "amount": tpl.amount,
                        "category": tpl.category,
                        "consecutive_skipped": 3,
                        "skipped_tx_ids": [t.id for t in last_3],
                        "decision_reason": "recurrence_closed_3_skips"
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
        stats_cache.invalidate(profile_id)

    return {
        "skipped_count": skipped_count,
        "closed_templates": closed_templates_count
    }
