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


UNIVERSAL_MERCHANT_ALIASES: Dict[str, List[str]] = {
    "FINANCES PUBLIQUES": ["impot", "taxe", "tresor public", "finances publiques", "dgfip", "foncier", "revenu"],
    "DIRECTION GENERALE DES FINANCES": ["impot", "taxe", "tresor public", "finances publiques", "dgfip", "foncier", "revenu"],
    "DGFIP": ["impot", "taxe", "tresor public", "finances publiques", "foncier", "revenu"],
    "CPAM": ["sante", "remboursement", "secu", "ameli", "soins", "medical", "mutuelle"],
    "AMELI": ["sante", "remboursement", "secu", "cpam", "soins", "medical", "mutuelle"],
    "CAF": ["allocation", "prestations", "caf", "famille", "logement", "apl"],
    "URSSAF": ["cotisations", "charges", "urssaf", "independant", "auto-entrepreneur"],
    "POLE EMPLOI": ["france travail", "chomage", "indemnites", "allocation"],
    "FRANCE TRAVAIL": ["pole emploi", "chomage", "indemnites", "allocation"],
    "FREE MOBILE": ["free", "telecom", "mobile", "internet", "telephone", "forfait"],
    "FREE TELECOM": ["free", "telecom", "mobile", "internet", "telephone", "forfait", "freebox"],
    "ORANGE": ["telecom", "mobile", "internet", "telephone", "sosh", "livebox"],
    "SFR": ["telecom", "mobile", "internet", "telephone", "red"],
    "BOUYGUES": ["telecom", "mobile", "internet", "telephone", "bbox"],
    "EDF": ["electricite", "energie", "edf"],
    "ENGIE": ["gaz", "energie", "engie"],
    "TOTALENERGIES": ["electricite", "gaz", "energie", "carburant", "essence"],
}


def compute_temporal_score(candidate_dt, bank_dt) -> int:
    """Calcule le score de proximité temporelle (0 à 35 pts)."""
    if not candidate_dt or not bank_dt:
        return 0
    delta = (candidate_dt - bank_dt).days
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
        return 20  # Équilibré à 20 pts (débits anticipés de week-ends/fériés fréquents)
    elif delta in (-5, -6, -7):
        return 10
    elif delta in (5, 6, 7):
        return 10  # Équilibré à 10 pts
    elif 8 <= abs_delta <= 15:
        return 5
    elif 16 <= abs_delta <= 30:
        return 2
    else:
        return 0


def compute_text_score(
    candidate_desc: Optional[str],
    raw_bank_label: Optional[str],
    candidate_cat: Optional[str] = None,
    db: Optional[Session] = None
) -> int:
    """Calcule le score de similarité textuelle marchand (0 à 25 pts) avec sémantique et alias."""
    if not candidate_desc or not raw_bank_label:
        return 0
    try:
        from app.services.smart_label_service import _compute_match_score, normalize_raw_label
        from app.services.recurrence_detector import parse_fractional_signature
        frac_bank = parse_fractional_signature(raw_bank_label)
        cand_upper = candidate_desc.strip().upper()
        if frac_bank and (cand_upper.startswith(frac_bank[0]) or frac_bank[0] in cand_upper):
            return 25

        # 1. Vérification par dictionnaire sémantique universel
        norm_bank = normalize_raw_label(raw_bank_label).upper()
        norm_cand = (normalize_raw_label(candidate_desc) + " " + normalize_raw_label(candidate_cat or "")).upper()

        for alias_key, target_keywords in UNIVERSAL_MERCHANT_ALIASES.items():
            if alias_key in norm_bank or alias_key in raw_bank_label.upper():
                if any(kw.upper() in norm_cand for kw in target_keywords):
                    return 25

        # 2. Vérification par règles BankLabelMapping si db disponible
        if db:
            try:
                from app.models import BankLabelMapping
                mappings = db.query(BankLabelMapping).filter(
                    BankLabelMapping.is_ignored == False
                ).all()
                for m in mappings:
                    if m.raw_pattern and m.raw_pattern.upper() in norm_bank:
                        clean_m = (m.clean_description or "").upper()
                        cat_m = (m.category or "").upper()
                        if (clean_m and clean_m in norm_cand) or (cat_m and cat_m in norm_cand):
                            return 25
            except Exception:
                pass

        ratio = _compute_match_score(raw_bank_label, candidate_desc)
        return round(ratio * 25)
    except Exception as e:
        logger.warning(f"[Reconciliation] Erreur calcul score textuel: {e}")
        return 0


def evaluate_candidate(
    candidate_tx: Transaction,
    target_dt,
    bank_label: Optional[str],
    db: Optional[Session] = None
) -> int:
    """Calcule le score composite total (0-100 pts) pour un candidat."""
    amt_score = 40
    t_dt = candidate_tx.date_operation if hasattr(candidate_tx.date_operation, "strftime") else (candidate_tx.date_operation if candidate_tx.date_operation else None)
    temp_score = compute_temporal_score(t_dt, target_dt)

    # Si la transaction est issue d'une récurrence, évaluer également la proximité par rapport
    # au jour théorique du modèle (template.day_of_month) pour absorber les dérives d'instances
    if candidate_tx.recurrence_id and target_dt:
        try:
            from app.models import RecurrenceTemplate
            session = db or Session.object_session(candidate_tx)
            if session:
                tmpl = session.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == candidate_tx.recurrence_id).first()
                cand_dt = t_dt
                if isinstance(cand_dt, str):
                    from datetime import datetime
                    try:
                        cand_dt = datetime.strptime(cand_dt[:10], "%Y-%m-%d").date()
                    except Exception:
                        cand_dt = None
                if tmpl and tmpl.day_of_month and cand_dt and hasattr(cand_dt, "year"):
                    import calendar
                    from datetime import date
                    max_day = calendar.monthrange(cand_dt.year, cand_dt.month)[1]
                    target_day = min(tmpl.day_of_month, max_day)
                    tmpl_dt = date(cand_dt.year, cand_dt.month, target_day)
                    tmpl_score = compute_temporal_score(tmpl_dt, target_dt)
                    if tmpl_score > temp_score:
                        temp_score = tmpl_score
        except Exception as e:
            logger.debug(f"[Reconciliation] Note récurrence day_of_month ignorée: {e}")

    session_for_text = db or Session.object_session(candidate_tx)
    text_score = compute_text_score(
        candidate_tx.description,
        bank_label,
        candidate_cat=candidate_tx.category,
        db=session_for_text
    )
    return amt_score + temp_score + text_score


def best_scored_tx(
    candidates: List[Transaction],
    target_dt,
    bank_label: Optional[str],
    db: Optional[Session] = None
) -> Tuple[Optional[Transaction], int, bool]:
    """
    Sélectionne le meilleur candidat parmi une liste avec tri score décroissant puis proximité date.
    Retourne (best_candidate, best_score, collision_detected).
    """
    if not candidates:
        return None, 0, False
    scored = []
    for c in candidates:
        s = evaluate_candidate(c, target_dt, bank_label, db=db)
        if s >= 40:
            scored.append((s, c))
    if not scored:
        return None, 0, False
    # Trier par score décroissant, puis par proximité de date la plus faible
    scored.sort(
        key=lambda item: (
            item[0],
            -abs((item[1].date_operation - target_dt).days) if item[1].date_operation else -9999
        ),
        reverse=True
    )
    best_score, best_candidate = scored[0]

    # Détection des candidats concurrents crédibles (score >= 60)
    eligible_candidates = [item for item in scored if item[0] >= 60]

    collision_detected = False
    if len(eligible_candidates) > 1:
        second_score, _ = eligible_candidates[1]
        if (best_score - second_score) < 10:
            collision_detected = True
    elif len(eligible_candidates) == 1 and not collision_detected:
        # Candidat unique sans concurrent immédiat au centime près :
        # Si la date est très proche (delta <= 2j), bonus d'unicité évident (+15 pts, max 100)
        c_dt = best_candidate.date_operation
        if c_dt and hasattr(c_dt, "strftime"):
            delta_d = abs((c_dt - target_dt).days)
            if delta_d <= 2:
                best_score = min(100, best_score + 15)
            else:
                best_score = min(100, best_score + 5)
        else:
            best_score = min(100, best_score + 5)

    return best_candidate, best_score, collision_detected


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
    Gère également la double échelle (suggéré >= 60 vs auto-commit >= 85),
    l'anti-collision sur montants homonymes, les virements internes et orphelins.
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
            is_already = bool(exact_csv_match.reconciliation_date)
            return {
                "id": exact_csv_match.id,
                "description": exact_csv_match.description,
                "already_reconciled": is_already,
                "match_score": 100,
                "collision_detected": False,
                "suggested_match": False,
                "auto_committed": not is_already
            }

    target_dt = tx_date.date() if hasattr(tx_date, "date") and callable(tx_date.date) else tx_date

    # 1. Recherche d'un doublon déjà rapproché / existant
    def _find_already_reconciled():
        if is_coming:
            # Pour une opération à venir (autorisation CB récente / débit annoncé),
            # elle ne peut correspondre à une opération déjà pointée que si le pointage ou l'opération
            # a eu lieu dans un intervalle temporel ultra-resserré (max 2 jours).
            # Une opération pointée il y a plus de 2 jours (ex: 13 jours) est une opération passée distincte.
            start_op_limit_c = tx_date - timedelta(days=2)
            end_op_limit_c = tx_date + timedelta(days=2)
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

        recon_match, recon_score, recon_collision = best_scored_tx(recon_query_filtered.all(), target_dt, bank_label, db=db)
        if recon_match and recon_score >= 60:
            cand_dt = recon_match.date_operation
            if cand_dt and is_coming:
                delta_days = abs((target_dt - cand_dt).days)
                if delta_days > 2:
                    logger.debug(f"[Reconciliation] Candidat déjà pointé écarté car delta={delta_days}j > 2j pour op à venir")
                    return None

            return {
                "id": recon_match.id,
                "description": recon_match.description,
                "category": recon_match.category,
                "type": recon_match.type,
                "already_reconciled": True,
                "match_score": recon_score,
                "collision_detected": recon_collision,
                "suggested_match": (60 <= recon_score < 85) or recon_collision,
                "auto_committed": False
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

        op_match, op_score, op_collision = best_scored_tx(available_op_query.all(), target_dt, bank_label, db=db)
        if op_match and op_score >= 60:
            return {
                "id": op_match.id,
                "description": op_match.description,
                "category": op_match.category,
                "type": op_match.type,
                "already_reconciled": False,
                "match_score": op_score,
                "collision_detected": op_collision,
                "suggested_match": (60 <= op_score < 85) or op_collision,
                "auto_committed": op_score >= 85 and not op_collision
            }
        return None

    # 2.C : Recherche d'une prévision de récurrence active avec montant déviant (Hors-forfait / Frais variables)
    def _find_deviant_recurrence():
        from app.models import GlobalConfig
        try:
            cfg = db.query(GlobalConfig).filter(GlobalConfig.key == "auto_link_deviant_recurrences").first()
            is_enabled = (cfg.value.strip().lower() in ("true", "1", "yes")) if (cfg and cfg.value) else True
        except Exception:
            is_enabled = True

        if not is_enabled or not bank_label:
            return None

        # Chercher des prévisions non pointées issues d'une récurrence
        # Fenêtre temporelle : tx_date +/- 5 jours
        start_op = tx_date - timedelta(days=5)
        end_op = tx_date + timedelta(days=5)

        op_query = db.query(Transaction).filter(
            Transaction.reconciliation_date == None,
            Transaction.recurrence_id != None,
            Transaction.date_operation >= start_op,
            Transaction.date_operation <= end_op,
            or_(Transaction.is_skipped == False, Transaction.is_skipped == None)
        )
        if acc_filter is not None:
            op_query = op_query.filter(acc_filter)

        if matched_ids:
            op_query = op_query.filter(Transaction.id.notin_(matched_ids))

        candidates = op_query.all()
        if not candidates:
            return None

        valid_matches = []
        for cand in candidates:
            # Vérifier sens du flux (dépense vs recette)
            raw_float = float(tx_amount)
            cand_is_expense = (cand.type in ("expense_fixed", "expense_var", "transfer") or (cand.from_account_id and not cand.to_account_id))
            is_expense = (raw_float < 0)
            if is_expense != cand_is_expense:
                continue

            # Similarité textuelle marchand >= 85%
            txt_score = compute_text_score(cand.description, bank_label)
            if txt_score < 21:
                # Vérifier aussi si clean merchants concordent nettement
                try:
                    from app.services.recurrence_detector import get_clean_merchant
                    cm_cand = get_clean_merchant(cand.description)
                    cm_bank = get_clean_merchant(bank_label)
                    if cm_cand and cm_bank and (cm_cand in cm_bank or cm_bank in cm_cand):
                        txt_score = 25
                    else:
                        continue
                except Exception:
                    continue

            # Plafond de tolérance : facteur 3 strict
            # montant réel compris entre (prévu / 3.0) et (prévu * 3.0)
            exp_amt = abs(float(cand.amount or 0.0))
            act_amt = abs_amount
            if exp_amt <= 0 or act_amt <= 0:
                continue

            min_allowed = exp_amt / 3.0
            max_allowed = exp_amt * 3.0
            if not (min_allowed <= act_amt <= max_allowed):
                continue

            tmp_score = compute_temporal_score(cand.date_operation, target_dt)
            valid_matches.append((cand, exp_amt, act_amt, txt_score + tmp_score))

        if not valid_matches:
            return None

        # Trier par score décroissant
        valid_matches.sort(key=lambda x: x[3], reverse=True)
        collision = (len(valid_matches) > 1 and (valid_matches[0][3] - valid_matches[1][3]) < 10)
        best_cand, best_exp, best_act, total_sc = valid_matches[0]

        return {
            "id": best_cand.id,
            "description": best_cand.description,
            "category": best_cand.category,
            "type": best_cand.type,
            "already_reconciled": False,
            "is_amount_deviant": True,
            "original_forecast_amount": best_exp,
            "actual_amount": best_act,
            "match_score": 90 if not collision else 65,
            "collision_detected": collision,
            "suggested_match": collision,
            "auto_committed": not collision
        }

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

    # 2.C : Si aucun match exact en montant, tenter l'auto-liaison tolérante sur récurrence active
    deviant_match = _find_deviant_recurrence()
    if deviant_match:
        return deviant_match

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
        mirror_match, mirror_score, mirror_collision = best_scored_tx(mirror_query.all(), target_dt, bank_label)
        if mirror_match:
            return {
                "id": mirror_match.id,
                "description": mirror_match.description,
                "category": mirror_match.category,
                "type": mirror_match.type,
                "already_reconciled": True,
                "is_mirror_transfer": True,
                "match_score": mirror_score,
                "collision_detected": mirror_collision,
                "suggested_match": False,
                "auto_committed": False
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

        orphan_match, orphan_score, orphan_collision = best_scored_tx(orphan_q.all(), target_dt, bank_label)
        if orphan_match:
            other_acc_id = orphan_match.to_account_id if raw_num < 0 else orphan_match.from_account_id
            other_acc = db.query(Account).filter(Account.id == other_acc_id).first()
            other_acc_name = other_acc.name if other_acc else f"Compte #{other_acc_id}"

            return {
                "id": orphan_match.id,
                "description": orphan_match.description,
                "category": orphan_match.category,
                "type": orphan_match.type,
                "already_reconciled": False,
                "is_orphan_transfer_link": True,
                "orphan_account_id": other_acc_id,
                "orphan_account_name": other_acc_name,
                "match_score": orphan_score,
                "collision_detected": orphan_collision,
                "suggested_match": (60 <= orphan_score < 85) or orphan_collision,
                "auto_committed": orphan_score >= 85 and not orphan_collision
            }

    return None
