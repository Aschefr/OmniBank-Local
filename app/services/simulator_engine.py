"""
app/services/simulator_engine.py — Moteur de projection et simulation What-If (Sandbox).
Zéro pollution DB : calculs en mémoire à partir des soldes réels, récurrences et événements simulés.
Inclut : projection dépenses variables, saisonnalité, inflation, bandes de confiance ±1σ.
"""
import logging
import json
import math
from datetime import date, datetime
from typing import List, Dict, Any, Optional
from calendar import monthrange
from sqlalchemy.orm import Session

from app.models import Account, Transaction, RecurrenceTemplate, Scenario, ScenarioEvent
from app.services.finance_engine import calculate_balances, get_main_account

logger = logging.getLogger(__name__)
import os as _os
import sys as _sys

def _load_presets():
    """Charge les modèles de simulation prédéfinis depuis le fichier JSON externe."""
    _path = _os.path.join(_os.path.dirname(__file__), "simulator_presets.json")
    if not _os.path.exists(_path) and getattr(_sys, 'frozen', False):
        _base = getattr(_sys, '_MEIPASS', _os.path.dirname(_sys.executable))
        _path = _os.path.join(_base, "app", "services", "simulator_presets.json")
        if not _os.path.exists(_path):
            _path = _os.path.join(_base, "simulator_presets.json")
    if _os.path.exists(_path):
        with open(_path, "r", encoding="utf-8") as _f:
            return json.load(_f)
    return []

PRESET_TEMPLATES = _load_presets()


def get_simulator_presets() -> List[Dict[str, Any]]:
    """Retourne la liste des modèles de simulation prédéfinis."""
    return PRESET_TEMPLATES


# Profil standard de saisonnalité (Vacances & Fêtes) : calibré pour représenter les variations calendaires typiques
# (Pics été et Noël, creux d'hiver, somme et moyenne rigoureusement normalisées à 1.00 sur 12 mois)
PRESET_STANDARD_SEASONALITY = {
    1: 0.90,   # Janvier (-10%, creux post-fêtes)
    2: 0.90,   # Février (-10%, hiver)
    3: 0.95,   # Mars (-5%)
    4: 0.95,   # Avril (-5%)
    5: 1.00,   # Mai (neutre)
    6: 1.05,   # Juin (+5%, début d'été)
    7: 1.15,   # Juillet (+15%, vacances d'été)
    8: 1.20,   # Août (+20%, vacances d'été, sorties, voyages)
    9: 1.10,   # Septembre (+10%, rentrée scolaire)
    10: 0.95,  # Octobre (-5%)
    11: 0.90,  # Novembre (-10%)
    12: 1.30   # Décembre (+30%, fêtes et cadeaux)
}


def _add_months(sourcedate: date, months: int) -> date:
    """Ajoute N mois à une date en gérant correctement la fin de mois."""
    month = sourcedate.month - 1 + months
    year = sourcedate.year + month // 12
    month = month % 12 + 1
    day = min(sourcedate.day, monthrange(year, month)[1])
    return date(year, month, day)


def run_simulation(
    db: Session,
    horizon_months: int = 12,
    account_id: Optional[int] = None,
    scenario_id: Optional[int] = None,
    custom_events: Optional[List[Dict[str, Any]]] = None,
    income_mode: str = "auto",
    custom_income_amount: Optional[float] = None,
    inflation_rate: float = 0.0,
    variable_expense_adjustment_pct: float = 0.0,
    projection_profile: str = "realistic",
    conservative_weight: Optional[float] = None,
    outlier_sensitivity: int = 2,
    seasonality_mode: str = "disabled",
    seasonality_intensity: float = 1.0
) -> Dict[str, Any]:
    """
    Exécute la projection sur `horizon_months` mois.
    Compare la trajectoire de base (réelle) avec la trajectoire simulée (What-If).
    Supporte un curseur continu de prudence / conservatisme `conservative_weight` (0.0 = 100% Réel, 1.0 = 100% Conservateur).
    Supporte un curseur de sensibilité aux dépenses exceptionnelles `outlier_sensitivity` (1: Strict, 2: Prudent, 3: Équilibré, 4: Permissif, 5: Intégral).
    Supporte une saisonnalité optionnelle `seasonality_mode` ('disabled', 'historical', 'preset_standard') et son intensité `seasonality_intensity` (0.0 à 1.0).
    Supporte 4 modes de revenu de référence : 'auto', 'historical_n1', 'custom', 'none'.
    Supporte toutes les fréquences de récurrence (mensuelle, annuelle, semestrielle, trimestrielle, bimestrielle, hebdo, bi-hebdo).
    Gère la totalité du patrimoine liquide lorsqu'aucun compte précis n'est sélectionné (comptes courants + livrets d'épargne).
    Zéro modification de la base de données.
    """
    if conservative_weight is not None:
        conservative_weight = max(0.0, min(float(conservative_weight), 1.0))
    elif projection_profile == "conservative":
        conservative_weight = 1.0
    elif projection_profile == "realistic":
        conservative_weight = 0.0
    else:
        conservative_weight = 0.20

    outlier_sens = max(1, min(int(outlier_sensitivity if outlier_sensitivity is not None else 2), 5))

    valid_seasonality_modes = {"disabled", "historical", "preset_standard"}
    if seasonality_mode not in valid_seasonality_modes:
        seasonality_mode = "disabled"
    try:
        seasonality_intensity = max(0.0, min(float(seasonality_intensity if seasonality_intensity is not None else 1.0), 1.0))
    except (ValueError, TypeError):
        seasonality_intensity = 1.0
    if seasonality_mode == "disabled":
        seasonality_intensity = 0.0

    logger.info(f"[Simulateur] Lancement projection sur {horizon_months} mois (scénario: {scenario_id}, compte: {account_id}, prudence: {conservative_weight:.2f}, outliers_sens: {outlier_sens}, saisonnalité: {seasonality_mode} [{seasonality_intensity:.0%}], mode_revenu: {income_mode}, inflation: {inflation_rate}, ajustement_var: {variable_expense_adjustment_pct})")

    horizon_months = max(1, min(horizon_months, 300))
    today = date.today()
    start_year = today.year
    start_month = today.month

    # 1. Calcul du solde initial de référence (uniquement rapproché pour exactitude)
    balances = calculate_balances(db, only_reconciled=True)
    target_accounts = []
    if account_id:
        acc = db.query(Account).filter(Account.id == account_id).first()
        if acc:
            target_accounts.append(acc)
            initial_balance = balances.get(acc.id, 0.0)
        else:
            main_acc = get_main_account(db)
            initial_balance = balances.get(main_acc.id, 0.0) if main_acc else 0.0
            if main_acc:
                target_accounts.append(main_acc)
    else:
        # "Tous les comptes liquides" (Comptes courants + Livrets d'épargne)
        target_accounts = db.query(Account).filter(
            Account.is_closed == False,
            Account.type != "Prêt / Emprunt"
        ).all()
        if not target_accounts:
            target_accounts = db.query(Account).filter(Account.is_closed == False).all()
        initial_balance = sum(balances.get(a.id, 0.0) for a in target_accounts)

    target_acc_ids = {a.id for a in target_accounts}

    # 2. Récupération des événements de simulation
    events_to_apply = []
    if scenario_id:
        scenario = db.query(Scenario).filter(Scenario.id == scenario_id).first()
        if scenario:
            for ev in scenario.events:
                if ev.is_active:
                    events_to_apply.append({
                        "id": ev.id,
                        "label": ev.label,
                        "event_type": ev.event_type,
                        "amount": float(ev.amount or 0.0),
                        "account_id": ev.account_id,
                        "category": ev.category,
                        "start_date": ev.start_date,
                        "end_date": ev.end_date,
                        "duration_months": ev.duration_months,
                        "is_active": ev.is_active,
                        "notes": ev.notes
                    })

    if custom_events:
        for ev in custom_events:
            is_active = ev.get("is_active", True)
            if is_active:
                st_date = ev.get("start_date")
                if isinstance(st_date, str):
                    try:
                        st_date = datetime.strptime(st_date, "%Y-%m-%d").date()
                    except (ValueError, TypeError):
                        st_date = today
                elif not isinstance(st_date, date):
                    st_date = today

                end_d = ev.get("end_date")
                if isinstance(end_d, str):
                    try:
                        end_d = datetime.strptime(end_d, "%Y-%m-%d").date()
                    except (ValueError, TypeError):
                        end_d = None

                events_to_apply.append({
                    "id": ev.get("id"),
                    "label": ev.get("label", "Événement simulé"),
                    "event_type": ev.get("event_type", "one_off_expense"),
                    "amount": float(ev.get("amount", 0.0)),
                    "account_id": ev.get("account_id"),
                    "category": ev.get("category"),
                    "start_date": st_date,
                    "end_date": end_d,
                    "duration_months": ev.get("duration_months"),
                    "is_active": is_active,
                    "notes": ev.get("notes")
                })

    # 3. Pré-chargement des récurrences actives pour génération des instances virtuelles
    active_recurrences = db.query(RecurrenceTemplate).filter(
        RecurrenceTemplate.is_closed == False
    ).all()

    # Récupération de l'historique des salaires et prédiction automatique
    predicted_salary = 0.0
    is_current_month_pay_received = False
    historical_salary_by_month = {}
    seasonal_salary_by_calendar_month = {}
    salary_history_ids = set()

    try:
        from app.services.finance_engine import predict_next_paycheck
        pay_info = predict_next_paycheck(db)
        if pay_info and pay_info.get("amount"):
            predicted_salary = float(pay_info.get("amount") or 0.0)
            history = pay_info.get("history") or []
            salary_history_ids = {h.get("id") for h in history if h.get("id")}
            current_period_str = f"{today.year:04d}-{today.month:02d}"

            # Détection rigoureuse : la paie du mois en cours est-elle déjà encaissée et présente dans initial_balance ?
            # 1. Transaction rapprochée de salaire déjà enregistrée pour ce mois calendaire
            has_reconciled_salary_tx = db.query(Transaction).filter(
                Transaction.reconciliation_date.isnot(None),
                Transaction.date_operation >= date(today.year, today.month, 1),
                Transaction.date_operation <= date(today.year, today.month, monthrange(today.year, today.month)[1]),
                Transaction.type == "income",
                (Transaction.is_salary == True) | (Transaction.amount >= (0.6 * predicted_salary if predicted_salary > 0 else 1000.0))
            ).first() is not None

            # 2. Le cycle logique a-t-il déjà basculé sur le mois suivant (paie validée/encaissée)
            logical_period = pay_info.get("logical_period")
            is_period_advanced = bool(logical_period and logical_period > current_period_str)

            if is_period_advanced or has_reconciled_salary_tx or pay_info.get("is_period_validated"):
                is_current_month_pay_received = True
            else:
                is_current_month_pay_received = False

            for h in history:
                if h.get("amount") is not None and not h.get("is_placeholder"):
                    lp = h.get("logical_period")
                    if lp and "-" in lp:
                        try:
                            hy, hm = map(int, lp.split("-"))
                            # Ne pas inclure le mois courant s'il n'est pas encore perçu pour éviter de fausser la saisonnalité N-1
                            if (hy, hm) == (today.year, today.month) and not is_current_month_pay_received:
                                continue
                            amt = float(h["amount"])
                            historical_salary_by_month[(hy, hm)] = amt
                            # Mémoriser la saisonnalité par mois calendaire (1..12) pour répétition pluriannuelle
                            if hm not in seasonal_salary_by_calendar_month:
                                seasonal_salary_by_calendar_month[hm] = amt
                        except (ValueError, TypeError) as e:
                            logger.debug(f"[Simulateur] Période ou montant historique invalide dans pay_info: {e}")
    except Exception as e:
        logger.warning(f"[Simulateur] Impossible d'estimer la paie automatique: {e}")

    # Vérifier si une récurrence active correspond déjà au salaire principal (pour éviter le double compte)
    is_salary_in_recurrence = any(
        r.type == "income" and r.amount >= (0.6 * predicted_salary)
        for r in active_recurrences
    ) if predicted_salary > 0 else False

    # ── 3B. Projection des dépenses variables (moyenne glissante 6 mois + saisonnalité) ──
    avg_variable_expense = 0.0
    variable_expense_stddev = 0.0
    seasonal_expense_coefficients = {}  # mois_calendaire (1..12) -> coefficient multiplicateur
    variable_expense_history_months = 0
    seasonal_history_months = 0

    try:
        # Moyenne glissante sur les 6 derniers mois complets
        six_months_ago = _add_months(date(today.year, today.month, 1), -6)
        current_month_start = date(today.year, today.month, 1)

        var_exp_query = db.query(Transaction).filter(
            Transaction.type == "expense_var",
            Transaction.date_operation >= six_months_ago,
            Transaction.date_operation < current_month_start,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
        )
        if target_acc_ids:
            var_exp_query = var_exp_query.filter(
                (Transaction.from_account_id.in_(target_acc_ids)) |
                (Transaction.to_account_id.in_(target_acc_ids))
            )
        var_exp_txs = var_exp_query.all()

        # ── Filtrage des outliers (IQR) paramétrable selon outlier_sens (1..5) ──
        # Les achats exceptionnels (véhicule, gros électroménager) ne doivent pas
        # gonfler artificiellement la moyenne des dépenses variables projetées.
        exp_outlier_cfg = {
            1: {"iqr_mult": 1.5, "min_thresh": 150.0, "median_mult": 2.0},
            2: {"iqr_mult": 2.0, "min_thresh": 250.0, "median_mult": 3.0},
            3: {"iqr_mult": 2.5, "min_thresh": 400.0, "median_mult": 4.0},
            4: {"iqr_mult": 3.5, "min_thresh": 800.0, "median_mult": 6.0},
            5: {"iqr_mult": 999999.0, "min_thresh": 999999999.0, "median_mult": 999999.0}
        }
        var_cfg = exp_outlier_cfg.get(outlier_sens, exp_outlier_cfg[2])

        excluded_outlier_txs = []
        filtered_var_txs = list(var_exp_txs)

        if len(var_exp_txs) >= 5 and outlier_sens < 5:
            amounts = sorted([abs(t.amount) for t in var_exp_txs])
            q1 = amounts[len(amounts) // 4]
            q3 = amounts[3 * len(amounts) // 4]
            iqr = q3 - q1
            upper_fence = q3 + var_cfg["iqr_mult"] * iqr
            import statistics as _stats
            median_amt = _stats.median(amounts)

            filtered_var_txs = []
            for t in var_exp_txs:
                amt = abs(t.amount)
                # Triple condition pour classifier comme outlier :
                #  1. Dépasse le fence statistique (IQR selon sensibilité)
                #  2. Montant absolu > seuil plancher
                #  3. Montant > N× la médiane (vraiment exceptionnel)
                is_outlier = (
                    amt > upper_fence
                    and amt > var_cfg["min_thresh"]
                    and amt > var_cfg["median_mult"] * median_amt
                )
                if is_outlier:
                    excluded_outlier_txs.append(t)
                    logger.info(
                        f"[Simulateur] Outlier exclu de la projection variable : "
                        f"{t.description} — {amt:.2f} € "
                        f"(sensibilité={outlier_sens}, fence={upper_fence:.2f}, médiane={median_amt:.2f})"
                    )
                else:
                    filtered_var_txs.append(t)

        # Regrouper par mois (après filtrage outliers)
        var_by_month = {}
        for t in filtered_var_txs:
            key = (t.date_operation.year, t.date_operation.month)
            var_by_month.setdefault(key, 0.0)
            var_by_month[key] += abs(t.amount)

        variable_expense_history_months = len(var_by_month)
        excluded_outliers_count = len(excluded_outlier_txs)
        excluded_outliers_total = sum(abs(t.amount) for t in excluded_outlier_txs)

        if var_by_month:
            monthly_amounts = list(var_by_month.values())
            avg_variable_expense = sum(monthly_amounts) / len(monthly_amounts)
            if len(monthly_amounts) >= 2:
                variance = sum((x - avg_variable_expense) ** 2 for x in monthly_amounts) / (len(monthly_amounts) - 1)
                variable_expense_stddev = math.sqrt(variance)
            logger.info(
                f"[Simulateur] Dépenses variables - moyenne 6 mois: {avg_variable_expense:.2f} €, "
                f"écart-type: {variable_expense_stddev:.2f} €, mois analysés: {len(monthly_amounts)}"
                f"{f', outliers exclus: {excluded_outliers_count} ({excluded_outliers_total:.2f} €)' if excluded_outliers_count else ''}"
            )

        # ── Saisonnalité sur 12 derniers mois (profil par mois calendaire 1-12 avec filtrage outliers) ──
        # Restreint strictement aux dépenses variables (expense_var), les charges fixes ayant leur propre calendrier
        twelve_months_ago = _add_months(date(today.year, today.month, 1), -12)
        seasonal_query = db.query(Transaction).filter(
            Transaction.type == "expense_var",
            Transaction.date_operation >= twelve_months_ago,
            Transaction.date_operation < current_month_start,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
        )
        if target_acc_ids:
            seasonal_query = seasonal_query.filter(
                (Transaction.from_account_id.in_(target_acc_ids)) |
                (Transaction.to_account_id.in_(target_acc_ids))
            )
        seasonal_txs = seasonal_query.all()

        # Filtrage outliers sur 12 mois pour des profils mensuels cohérents
        filtered_seasonal_txs = list(seasonal_txs)
        if len(seasonal_txs) >= 5 and outlier_sens < 5:
            amounts_seas = sorted([abs(t.amount) for t in seasonal_txs])
            q1_s = amounts_seas[len(amounts_seas) // 4]
            q3_s = amounts_seas[3 * len(amounts_seas) // 4]
            iqr_s = q3_s - q1_s
            upper_fence_s = q3_s + var_cfg["iqr_mult"] * iqr_s
            import statistics as _stats
            median_s = _stats.median(amounts_seas)
            filtered_seasonal_txs = [
                t for t in seasonal_txs
                if not (
                    abs(t.amount) > upper_fence_s
                    and abs(t.amount) > var_cfg["min_thresh"]
                    and abs(t.amount) > var_cfg["median_mult"] * median_s
                )
            ]

        # Regrouper par (année, mois) pour dénombrer les mois d'historique effectifs
        seasonal_monthly_sums = {}
        for t in filtered_seasonal_txs:
            k = (t.date_operation.year, t.date_operation.month)
            seasonal_monthly_sums.setdefault(k, 0.0)
            seasonal_monthly_sums[k] += abs(t.amount)

        seasonal_history_months = len(seasonal_monthly_sums)

        # Calcul des moyennes par mois calendaire (1..12)
        cal_month_totals = {}
        cal_month_counts = {}
        for (yr, mo), total_amt in seasonal_monthly_sums.items():
            cal_month_totals.setdefault(mo, 0.0)
            cal_month_totals[mo] += total_amt
            cal_month_counts.setdefault(mo, 0)
            cal_month_counts[mo] += 1

        cal_month_averages = {
            mo: (cal_month_totals[mo] / cal_month_counts[mo])
            for mo in cal_month_totals
        }

        # Profil historique normalisé (moyenne sur 12 mois = 1.00)
        historical_coefficients = {cm: 1.0 for cm in range(1, 13)}
        if seasonal_history_months >= 6 and cal_month_averages:
            global_cal_avg = sum(cal_month_averages.values()) / len(cal_month_averages)
            if global_cal_avg > 0:
                raw_coeffs = {cm: (cal_month_averages[cm] / global_cal_avg if cm in cal_month_averages else 1.0) for cm in range(1, 13)}
                mean_raw = sum(raw_coeffs.values()) / 12.0
                if mean_raw > 0:
                    historical_coefficients = {cm: round(raw_coeffs[cm] / mean_raw, 4) for cm in range(1, 13)}
                logger.info(f"[Simulateur] Coefficients saisonniers historiques normalisés ({seasonal_history_months} mois): {historical_coefficients}")
        else:
            logger.info(f"[Simulateur] Historique saisonnier insuffisant ({seasonal_history_months}/6 mois minimum pour historique réel)")

        # Sélection du profil de base selon seasonality_mode
        if seasonality_mode == "historical":
            if seasonal_history_months >= 6:
                base_seasonal_coeffs = historical_coefficients
            else:
                base_seasonal_coeffs = {cm: 1.0 for cm in range(1, 13)}
        elif seasonality_mode == "preset_standard":
            base_seasonal_coeffs = PRESET_STANDARD_SEASONALITY
        else:
            base_seasonal_coeffs = {cm: 1.0 for cm in range(1, 13)}

        # Application de l'intensité (0.0 = lissage 100%, 1.0 = effet plein)
        if seasonality_mode != "disabled" and seasonality_intensity > 0:
            for cm in range(1, 13):
                base_c = base_seasonal_coeffs.get(cm, 1.0)
                seasonal_expense_coefficients[cm] = 1.0 + seasonality_intensity * (base_c - 1.0)
        else:
            seasonal_expense_coefficients = {cm: 1.0 for cm in range(1, 13)}
    except Exception as e:
        logger.warning(f"[Simulateur] Erreur calcul dépenses variables/saisonnalité: {e}")
        historical_coefficients = {cm: 1.0 for cm in range(1, 13)}
        seasonal_expense_coefficients = {cm: 1.0 for cm in range(1, 13)}

    # ── 3C. Calcul de l'empreinte historique réelle (Revenus réels complets & Charges fixes réelles observées) ──
    historical_real_income_avg = 0.0
    historical_real_fixed_avg = 0.0
    seasonal_real_income_by_calendar_month = {}
    seasonal_real_fixed_by_calendar_month = {}
    excluded_income_outliers_count = 0
    excluded_income_outliers_total = 0.0

    # Déterminer si le compte cible reçoit le salaire principal
    pay_account_id = None
    if predicted_salary > 0:
        main_pay_tx = db.query(Transaction).filter(
            Transaction.type == "income",
            Transaction.amount >= 0.5 * predicted_salary,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
        ).order_by(Transaction.date_operation.desc()).first()
        if main_pay_tx:
            pay_account_id = main_pay_tx.to_account_id

    predicted_salary_for_account = predicted_salary if (not target_acc_ids or (pay_account_id and pay_account_id in target_acc_ids)) else 0.0

    # ── Cascade intelligente si aucun historique de dépenses variables (Cold Start) ──
    if avg_variable_expense == 0.0:
        from app.models import Budget
        active_spending_budgets = db.query(Budget).filter(
            Budget.envelope_type == "spending",
            Budget.is_closed == False
        ).all()
        total_budgets_limit = sum(b.monthly_amount for b in active_spending_budgets if b.monthly_amount)
        if total_budgets_limit > 0:
            avg_variable_expense = float(total_budgets_limit)
            logger.info(f"[Simulateur] Cascade: Dépenses variables initialisées via les enveloppes budgétaires ({avg_variable_expense:.2f} €/mois)")

    try:
        twelve_months_ago = _add_months(date(today.year, today.month, 1), -12)
        current_month_start = date(today.year, today.month, 1)

        # 1. Revenus réels observés (tous flux entrants réels de type income sur 12 mois)
        real_inc_query = db.query(Transaction).filter(
            Transaction.type == "income",
            Transaction.date_operation >= twelve_months_ago,
            Transaction.date_operation < current_month_start,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
        )
        if target_acc_ids:
            real_inc_query = real_inc_query.filter(Transaction.to_account_id.in_(target_acc_ids))
        real_inc_txs = real_inc_query.all()

        # Filtrage statistique des rentrées exceptionnelles (outliers de recettes non répétitifs)
        inc_outlier_cfg = {
            1: {"iqr_mult": 1.5, "min_thresh": 500.0, "salary_mult": 1.3},
            2: {"iqr_mult": 2.0, "min_thresh": 800.0, "salary_mult": 1.5},
            3: {"iqr_mult": 3.0, "min_thresh": 1000.0, "salary_mult": 1.8},
            4: {"iqr_mult": 4.5, "min_thresh": 2000.0, "salary_mult": 2.5},
            5: {"iqr_mult": 999999.0, "min_thresh": 999999999.0, "salary_mult": 999999.0}
        }
        inc_cfg = inc_outlier_cfg.get(outlier_sens, inc_outlier_cfg[2])

        filtered_inc_txs = list(real_inc_txs)
        excluded_inc_outliers = []
        if len(real_inc_txs) >= 4 and outlier_sens < 5:
            inc_amounts = sorted([abs(t.amount) for t in real_inc_txs])
            q1_inc = inc_amounts[len(inc_amounts) // 4]
            q3_inc = inc_amounts[3 * len(inc_amounts) // 4]
            iqr_inc = q3_inc - q1_inc
            upper_fence_inc = q3_inc + inc_cfg["iqr_mult"] * iqr_inc
            import statistics as _stats
            median_inc = _stats.median(inc_amounts)
            
            filtered_inc_txs = []
            for t in real_inc_txs:
                amt = abs(t.amount)
                # Une transaction explicitement marquée salaire ou rattachée à une récurrence n'est jamais un outlier
                if getattr(t, 'is_salary', False) or t.recurrence_id is not None:
                    filtered_inc_txs.append(t)
                    continue

                # Si la transaction fait partie de l'historique détecté de paie ET reste cohérente avec la paie attendue (<= N×)
                if t.id and t.id in salary_history_ids and (predicted_salary == 0 or amt <= inc_cfg["salary_mult"] * predicted_salary):
                    filtered_inc_txs.append(t)
                    continue

                if predicted_salary > 0:
                    is_outlier = (
                        amt > upper_fence_inc
                        and amt > inc_cfg["min_thresh"]
                        and amt > inc_cfg["salary_mult"] * predicted_salary
                    )
                else:
                    is_outlier = (
                        amt > upper_fence_inc
                        and amt > inc_cfg["min_thresh"]
                        and amt > (inc_cfg["salary_mult"] * 2.2) * median_inc
                    )

                if is_outlier:
                    excluded_inc_outliers.append(t)
                    logger.info(
                        f"[Simulateur] Outlier de recette exclu du modèle moyen : {t.description} — {amt:.2f} € "
                        f"(sensibilité={outlier_sens}, fence={upper_fence_inc:.2f}, médiane={median_inc:.2f})"
                    )
                else:
                    filtered_inc_txs.append(t)

        excluded_income_outliers_count = len(excluded_inc_outliers)
        excluded_income_outliers_total = sum(abs(t.amount) for t in excluded_inc_outliers)

        inc_by_month = {}
        for t in filtered_inc_txs:
            k = (t.date_operation.year, t.date_operation.month)
            inc_by_month.setdefault(k, 0.0)
            inc_by_month[k] += abs(t.amount)

        if inc_by_month:
            historical_real_income_avg = sum(inc_by_month.values()) / len(inc_by_month)
            seasonal_inc_by_cal = {}
            for (yr, mo), total_m_inc in inc_by_month.items():
                seasonal_inc_by_cal.setdefault(mo, []).append(total_m_inc)
            for mo, monthly_totals in seasonal_inc_by_cal.items():
                seasonal_real_income_by_calendar_month[mo] = sum(monthly_totals) / len(monthly_totals)

        # 2. Charges fixes réellement débitées sur 12 mois (strictement expense_fixed)
        real_fix_query = db.query(Transaction).filter(
            Transaction.type == "expense_fixed",
            Transaction.date_operation >= twelve_months_ago,
            Transaction.date_operation < current_month_start,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
        )
        if target_acc_ids:
            real_fix_query = real_fix_query.filter(Transaction.from_account_id.in_(target_acc_ids))
        real_fix_txs = real_fix_query.all()

        fix_by_month = {}
        for t in real_fix_txs:
            k = (t.date_operation.year, t.date_operation.month)
            fix_by_month.setdefault(k, 0.0)
            fix_by_month[k] += abs(t.amount)

        if fix_by_month:
            historical_real_fixed_avg = sum(fix_by_month.values()) / len(fix_by_month)
            seasonal_fix_by_cal = {}
            for (yr, mo), total_m_fix in fix_by_month.items():
                seasonal_fix_by_cal.setdefault(mo, []).append(total_m_fix)
            for mo, monthly_totals in seasonal_fix_by_cal.items():
                seasonal_real_fixed_by_calendar_month[mo] = sum(monthly_totals) / len(monthly_totals)

        effective_inc = historical_real_income_avg if historical_real_income_avg > 0 else predicted_salary_for_account
        effective_fix = historical_real_fixed_avg if historical_real_fixed_avg > 0 else sum(r.amount for r in active_recurrences if r.type != 'income')
        historical_real_net_avg = effective_inc - effective_fix - avg_variable_expense
        logger.info(f"[Simulateur] Empreinte historique réelle: Revenus={historical_real_income_avg:.2f} €/m, Fixe={historical_real_fixed_avg:.2f} €/m, Net={historical_real_net_avg:.2f} €/m")
    except Exception as e:
        logger.warning(f"[Simulateur] Erreur calcul empreinte historique: {e}")
        historical_real_net_avg = (predicted_salary_for_account or 0.0) - avg_variable_expense

    # ── 3D. Normalisation du taux d'inflation ──
    inflation_rate = max(0.0, min(float(inflation_rate or 0.0), 0.20))  # Plafonné à 20%

    # 4. Itération mois par mois sur l'horizon
    monthly_data = []
    current_baseline_bal = initial_balance
    current_simulated_bal = initial_balance

    min_baseline_bal = initial_balance
    min_baseline_date = today.strftime("%Y-%m")
    min_simulated_bal = initial_balance
    min_simulated_date = today.strftime("%Y-%m")

    first_overdraft_date = None
    max_overdraft_amount = 0.0

    # Pré-calcul des occurrences déjà matérialisées en base pour les récurrences limitées (max_occurrences)
    db_rec_occurrences = {}
    for rec in active_recurrences:
        if rec.max_occurrences:
            db_rec_occurrences[rec.id] = db.query(Transaction).filter(
                Transaction.recurrence_id == rec.id,
                (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
            ).count()
        else:
            db_rec_occurrences[rec.id] = 0
    sim_rec_occurrences = {rec.id: 0 for rec in active_recurrences}

    month_names_fr = [
        "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
        "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
    ]

    days_in_cur_m = monthrange(today.year, today.month)[1]
    days_left_cur_m = max(0, days_in_cur_m - today.day)
    prorata_m0 = max(0.05, min(1.0, days_left_cur_m / float(days_in_cur_m))) if days_in_cur_m > 0 else 1.0

    for m_offset in range(horizon_months):
        curr_date = _add_months(date(start_year, start_month, 1), m_offset)
        y = curr_date.year
        m = curr_date.month
        month_str = f"{y:04d}-{m:02d}"
        month_label = f"{month_names_fr[m]} {y}"
        first_day = date(y, m, 1)
        last_day = date(y, m, monthrange(y, m)[1])

        # 1. Recensement de toutes les récurrences déjà honorées pour ce mois (rapprochées OU non)
        # pour éviter d'ajouter des récurrences théoriques en double
        month_all_rec_query = db.query(Transaction.recurrence_id).filter(
            Transaction.date_operation >= first_day,
            Transaction.date_operation <= last_day,
            Transaction.recurrence_id.isnot(None),
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None)
        )
        if target_acc_ids:
            month_all_rec_query = month_all_rec_query.filter(
                (Transaction.from_account_id.in_(target_acc_ids)) |
                (Transaction.to_account_id.in_(target_acc_ids))
            )
        existing_rec_template_ids = {r[0] for r in month_all_rec_query.all() if r[0]}

        # 2. Transactions déjà saisies en DB mais non encore rapprochées
        # (seules ces transactions doivent impacter le solde initial, car les rapprochées y sont déjà intégrées)
        tx_query = db.query(Transaction).filter(
            Transaction.reconciliation_date == None,
            Transaction.date_operation >= first_day,
            Transaction.date_operation <= last_day,
            (Transaction.is_skipped == False) | (Transaction.is_skipped == None),
            (Transaction.cross_profile_status == None) | (Transaction.cross_profile_status != "pending")
        )
        existing_txs = tx_query.all()

        baseline_income = 0.0
        baseline_expense = 0.0

        existing_income_total = 0.0
        existing_fixed_total = 0.0
        existing_var_total = 0.0

        for t in existing_txs:
            # Filtrer par compte cible si applicable
            is_relevant = False
            if not target_acc_ids:
                is_relevant = True
            elif t.from_account_id in target_acc_ids or t.to_account_id in target_acc_ids:
                is_relevant = True

            if is_relevant:
                if t.type == "income" or (target_acc_ids and t.to_account_id in target_acc_ids and (not t.from_account_id or t.from_account_id not in target_acc_ids)):
                    existing_income_total += abs(t.amount)
                elif t.type == "expense_fixed" or (target_acc_ids and t.from_account_id in target_acc_ids and (not t.to_account_id or t.to_account_id not in target_acc_ids) and t.type != "expense_var"):
                    existing_fixed_total += abs(t.amount)
                elif t.type == "expense_var":
                    existing_var_total += abs(t.amount)

        baseline_income += existing_income_total
        baseline_expense += (existing_fixed_total + existing_var_total)

        # 3. Calcul des récurrences théoriques pour ce mois m
        theoretical_fixed_for_month = 0.0
        theoretical_income_for_month = 0.0
        for rec in active_recurrences:
            if rec.id in existing_rec_template_ids:
                continue

            rec_match = False
            is_incoming = False
            is_outgoing = False

            if not target_acc_ids:
                rec_match = True
                if rec.type == "income":
                    is_incoming = True
                else:
                    is_outgoing = True
            else:
                if rec.to_account_id in target_acc_ids and (not rec.from_account_id or rec.from_account_id not in target_acc_ids):
                    rec_match = True
                    is_incoming = True
                elif rec.from_account_id in target_acc_ids and (not rec.to_account_id or rec.to_account_id not in target_acc_ids):
                    rec_match = True
                    is_outgoing = True

            if not rec_match:
                continue

            # Si le mode de revenu est "custom" ou "none", ne pas injecter une récurrence de salaire
            is_salary_rec = (rec.type == "income" and rec.amount >= 0.6 * (predicted_salary if predicted_salary > 0 else 1500.0))
            if is_salary_rec and income_mode in ("custom", "none"):
                continue

            # Vérification du plafond max_occurrences (échéance finie)
            if rec.max_occurrences and (db_rec_occurrences.get(rec.id, 0) + sim_rec_occurrences.get(rec.id, 0)) >= rec.max_occurrences:
                continue

            raw_freq = (rec.frequency or "monthly").strip().lower()
            base_m = rec.month_of_year or 1
            rec_amt = float(rec.amount or 0.0)
            should_apply = False
            effective_amt = rec_amt

            # 1. Mensuel
            if raw_freq in ("monthly", "mensuel", "mensuelle"):
                should_apply = True
                effective_amt = rec_amt
            # 2. Annuel
            elif "year" in raw_freq or "annuel" in raw_freq:
                if m == base_m:
                    should_apply = True
                    effective_amt = rec_amt
            # 3. Semestriel (tous les 6 mois, calé sur base_m, ex: Fév & Août)
            elif "semi" in raw_freq or "semestr" in raw_freq:
                m2 = (base_m + 5) % 12 + 1
                if m in (base_m, m2):
                    should_apply = True
                    effective_amt = rec_amt
            # 4. Trimestriel (tous les 3 mois, calé sur base_m)
            elif "quarter" in raw_freq or "trimestr" in raw_freq:
                applicable_quarters = [(base_m - 1 + 3 * i) % 12 + 1 for i in range(4)]
                if m in applicable_quarters:
                    should_apply = True
                    effective_amt = rec_amt
            # 5. Bimestriel (tous les 2 mois, calé sur base_m)
            elif "bimestr" in raw_freq:
                applicable_bimonthly = [(base_m - 1 + 2 * i) % 12 + 1 for i in range(6)]
                if m in applicable_bimonthly:
                    should_apply = True
                    effective_amt = rec_amt
            # 6. Bi-hebdomadaire / Quinzaine (toutes les 2 semaines -> 26 échéances / 12 mois = 2.167 par mois)
            elif "bi-week" in raw_freq or "bi-hebdo" in raw_freq or "quinzain" in raw_freq or ("bi-month" in raw_freq and "bimestr" not in raw_freq):
                should_apply = True
                effective_amt = rec_amt * 2.167
            # 7. Hebdomadaire (toutes les semaines -> 52 échéances / 12 mois = 4.333 par mois)
            elif "week" in raw_freq or "hebdo" in raw_freq:
                should_apply = True
                effective_amt = rec_amt * 4.333
            else:
                # Repli par défaut : mensuel
                should_apply = True
                effective_amt = rec_amt

            if should_apply:
                sim_rec_occurrences[rec.id] = sim_rec_occurrences.get(rec.id, 0) + 1
                if is_incoming:
                    theoretical_income_for_month += effective_amt
                elif is_outgoing:
                    theoretical_fixed_for_month += effective_amt

        # Ajout des flux récurrents théoriques de recettes
        if theoretical_income_for_month > 0:
            if existing_income_total == 0:
                baseline_income += theoretical_income_for_month
            elif existing_income_total < (0.6 * theoretical_income_for_month):
                baseline_income += (theoretical_income_for_month - existing_income_total)

        # 4. Charges fixes projetées :
        if m_offset == 0:
            # Pour le mois 0 : le solde initial intègre déjà les charges passées rapprochées.
            # On ajoute uniquement les récurrences théoriques restantes d'ici la fin du mois
            blended_fixed_for_month = theoretical_fixed_for_month
            baseline_expense += theoretical_fixed_for_month
        else:
            # Pour les mois futurs : interpolation continue entre réel saisonnier et total contractuel théorique
            total_contractual_fixed = existing_fixed_total + theoretical_fixed_for_month
            real_fixed_ref = seasonal_real_fixed_by_calendar_month.get(m, historical_real_fixed_avg if historical_real_fixed_avg > 0 else total_contractual_fixed)
            blended_fixed_for_month = (1.0 - conservative_weight) * real_fixed_ref + conservative_weight * total_contractual_fixed

            if existing_fixed_total == 0:
                baseline_expense += blended_fixed_for_month
            elif existing_fixed_total < (0.6 * blended_fixed_for_month):
                baseline_expense += (blended_fixed_for_month - existing_fixed_total)

        # 5. Revenus projetés : interpolation continue entre réel et salaire de base plancher
        cons_salary_ref = predicted_salary_for_account

        if income_mode in ("historical_n1", "auto"):
            # 1. Recettes réelles de l'année précédente (saisonnier mois par mois)
            if predicted_salary_for_account > 0:
                real_salary_ref = seasonal_salary_by_calendar_month.get(m, predicted_salary_for_account)
            else:
                real_salary_ref = seasonal_real_income_by_calendar_month.get(m, historical_real_income_avg)
            blended_salary = (1.0 - conservative_weight) * real_salary_ref + conservative_weight * cons_salary_ref
            has_main_salary = any(
                t.type == "income" and abs(t.amount) >= (0.6 * blended_salary)
                for t in existing_txs
                if (not target_acc_ids or t.to_account_id in target_acc_ids)
            ) if blended_salary > 0 else False
            if not is_salary_in_recurrence and not (m_offset == 0 and is_current_month_pay_received) and not has_main_salary:
                baseline_income += blended_salary
        elif income_mode in ("average", "historical_avg"):
            # 2. Recettes moyennes (moyenne mensuelle sur les 12 derniers mois ou mois existants)
            avg_salary_ref = predicted_salary_for_account if predicted_salary_for_account > 0 else historical_real_income_avg
            blended_salary = (1.0 - conservative_weight) * avg_salary_ref + conservative_weight * cons_salary_ref
            has_main_salary = any(
                t.type == "income" and abs(t.amount) >= (0.6 * blended_salary)
                for t in existing_txs
                if (not target_acc_ids or t.to_account_id in target_acc_ids)
            ) if blended_salary > 0 else False
            if not is_salary_in_recurrence and not (m_offset == 0 and is_current_month_pay_received) and not has_main_salary:
                baseline_income += blended_salary
        elif income_mode == "custom":
            # 3. Montant personnalisé
            custom_val = float(custom_income_amount or 0.0)
            has_main_salary = any(
                t.type == "income" and abs(t.amount) >= (0.6 * custom_val)
                for t in existing_txs
                if (not target_acc_ids or t.to_account_id in target_acc_ids)
            ) if custom_val > 0 else False
            if not (m_offset == 0 and is_current_month_pay_received) and not has_main_salary:
                baseline_income += custom_val
        elif income_mode == "none":
            # 4. Désactivé (Scénario zéro salaire)
            pass

        # 6. Projection des dépenses variables (socle de vie courante)
        base_variable_projected = 0.0
        variable_expense_projected = 0.0
        seasonal_coeff_m = seasonal_expense_coefficients.get(m, 1.0) if seasonality_mode != "disabled" else 1.0

        if avg_variable_expense > 0:
            if m_offset == 0:
                # Mois 0 : prorata temporis des jours restants d'ici la fin du mois
                base_variable_projected = avg_variable_expense * seasonal_coeff_m * prorata_m0
            else:
                base_variable_projected = avg_variable_expense * seasonal_coeff_m

            # Appliquer le curseur d'effort budgétaire utilisateur (-100% à +50%)
            var_adj_factor = max(0.0, 1.0 + float(variable_expense_adjustment_pct or 0.0))
            variable_expense_projected = base_variable_projected * var_adj_factor
            baseline_expense += variable_expense_projected

        # 7. Facteur d'inflation (hors emprunts à taux fixe)
        inflation_factor = 1.0
        inflation_delta = 0.0
        if inflation_rate > 0 and m_offset > 0:
            inflation_factor = (1 + inflation_rate) ** (m_offset / 12.0)
            # Exclusion des emprunts/prêts à taux fixe de l'assiette d'inflation
            loan_keywords = ("prêt", "pret", "emprunt", "crédit", "credit")
            non_inflatable_fixed = 0.0
            for rec in active_recurrences:
                desc = (rec.description or "").lower()
                cat = (rec.category or "").lower()
                if any(k in desc or k in cat for k in loan_keywords):
                    non_inflatable_fixed += rec.amount

            inflatable_base = max(0.0, baseline_expense - non_inflatable_fixed)
            inflation_delta = inflatable_base * (inflation_factor - 1.0)
            baseline_expense += inflation_delta

        baseline_net = baseline_income - baseline_expense
        month_start_baseline = current_baseline_bal
        current_baseline_bal += baseline_net


        # ── B. Flux Simulés (What-If) ──
        simulated_events_impact = 0.0
        events_applied_this_month = []

        for ev in events_to_apply:
            ev_type = ev.get("event_type")
            ev_amt = float(ev.get("amount", 0.0))
            ev_start = ev.get("start_date") or today
            ev_dur = int(ev.get("duration_months") or 1)
            ev_end = ev.get("end_date")

            # Déterminer si l'événement s'applique pour le mois en cours
            months_since_start = (y - ev_start.year) * 12 + (m - ev_start.month)

            applies = False
            if ev_type in ("one_off_expense", "one_off_income"):
                if months_since_start == 0:
                    applies = True
            elif ev_type in ("recurring_expense", "recurring_income"):
                if months_since_start >= 0:
                    if ev_end:
                        months_until_end = (ev_end.year - y) * 12 + (ev_end.month - m)
                        if months_until_end >= 0:
                            applies = True
                    elif months_since_start < ev_dur:
                        applies = True
            elif ev_type == "percentage_adjustment":
                if months_since_start >= 0 and months_since_start < ev_dur:
                    applies = True

            if applies:
                if ev_type == "one_off_expense":
                    simulated_events_impact -= ev_amt
                    events_applied_this_month.append(f"{ev['label']} (-{ev_amt:,.2f} €)")
                elif ev_type == "one_off_income":
                    simulated_events_impact += ev_amt
                    events_applied_this_month.append(f"{ev['label']} (+{ev_amt:,.2f} €)")
                elif ev_type == "recurring_expense":
                    simulated_events_impact -= ev_amt
                    events_applied_this_month.append(f"{ev['label']} (-{ev_amt:,.2f} €)")
                elif ev_type == "recurring_income":
                    simulated_events_impact += ev_amt
                    events_applied_this_month.append(f"{ev['label']} (+{ev_amt:,.2f} €)")
                elif ev_type == "percentage_adjustment":
                    pct_delta = (baseline_expense * (ev_amt / 100.0))
                    simulated_events_impact -= pct_delta
                    sign = "+" if ev_amt >= 0 else ""
                    events_applied_this_month.append(f"{ev['label']} ({sign}{ev_amt:.1f}% : -{pct_delta:,.2f} €)")

        simulated_income = baseline_income + max(0.0, simulated_events_impact) if simulated_events_impact > 0 else baseline_income
        simulated_expense = baseline_expense + abs(min(0.0, simulated_events_impact)) if simulated_events_impact < 0 else baseline_expense
        simulated_net = baseline_net + simulated_events_impact
        month_start_simulated = current_simulated_bal
        current_simulated_bal += simulated_net

        # ── C. Suivi des Points Bas et Découverts ──
        if current_baseline_bal < min_baseline_bal:
            min_baseline_bal = current_baseline_bal
            min_baseline_date = month_str

        if current_simulated_bal < min_simulated_bal:
            min_simulated_bal = current_simulated_bal
            min_simulated_date = month_str

        if current_simulated_bal < 0:
            if first_overdraft_date is None:
                first_overdraft_date = month_str
            if abs(current_simulated_bal) > max_overdraft_amount:
                max_overdraft_amount = abs(current_simulated_bal)

        # ── Bandes de confiance canoniques (Théorème Central Limite / Marche Aléatoire : ±σ√t) ──
        # La dispersion d'une somme de variables aléatoires croît avec la racine carrée du temps (diffusion brownienne),
        # évitant l'explosion linéaire artificielle du cône d'incertitude sur les horizons longs (12 à 36 mois).
        t_eff = prorata_m0 if m_offset == 0 else (prorata_m0 + m_offset)
        sigma_cumul = (variable_expense_stddev * math.sqrt(t_eff)) if (variable_expense_stddev > 0 and base_variable_projected > 0) else 0.0
        optimistic_simulated = current_simulated_bal + sigma_cumul
        pessimistic_simulated = current_simulated_bal - sigma_cumul

        if m_offset == 0:
            fixed_expense_actual = existing_fixed_total + theoretical_fixed_for_month
        else:
            fixed_expense_actual = blended_fixed_for_month if existing_fixed_total == 0 else (existing_fixed_total + max(0.0, blended_fixed_for_month - existing_fixed_total))
        var_expense_actual = variable_expense_projected + existing_var_total
        inflation_delta_actual = inflation_delta if (inflation_rate > 0 and m_offset > 0) else 0.0

        seasonal_tag = None
        if m == 12:
            seasonal_tag = "holidays"
        elif m in (7, 8):
            seasonal_tag = "summer"
        elif m == 9:
            seasonal_tag = "back_to_school"
        elif m in (1, 2):
            seasonal_tag = "winter"

        monthly_data.append({
            "month": month_str,
            "month_label": month_label,
            "start_balance_baseline": round(month_start_baseline, 2),
            "baseline_income": round(baseline_income, 2),
            "baseline_fixed": round(fixed_expense_actual, 2),
            "baseline_variable": round(var_expense_actual, 2),
            "baseline_inflation_delta": round(inflation_delta_actual, 2),
            "baseline_expense": round(baseline_expense, 2),
            "baseline_net": round(baseline_net, 2),
            "baseline_end_balance": round(current_baseline_bal, 2),
            "start_balance_simulated": round(month_start_simulated, 2),
            "simulated_income": round(simulated_income, 2),
            "simulated_expense": round(simulated_expense, 2),
            "simulated_events_impact": round(simulated_events_impact, 2),
            "simulated_net": round(simulated_net, 2),
            "simulated_end_balance": round(current_simulated_bal, 2),
            "optimistic_end_balance": round(optimistic_simulated, 2),
            "pessimistic_end_balance": round(pessimistic_simulated, 2),
            "base_variable_projected": round(base_variable_projected, 2),
            "variable_expense_projected": round(variable_expense_projected, 2),
            "seasonal_factor": round(seasonal_coeff_m, 3),
            "seasonal_pct": round((seasonal_coeff_m - 1.0) * 100),
            "seasonal_tag": seasonal_tag if (seasonality_mode != "disabled" and seasonality_intensity > 0) else None,
            "inflation_factor": round(inflation_factor, 4),
            "difference": round(current_simulated_bal - current_baseline_bal, 2),
            "events_applied": events_applied_this_month,
            "is_negative": current_simulated_bal < 0
        })

    # Marquer le point bas de trésorerie simulée
    for m_item in monthly_data:
        m_item["is_min_cash"] = (m_item["month"] == min_simulated_date)

    total_diff = current_simulated_bal - current_baseline_bal
    pct_diff = round((total_diff / abs(current_baseline_bal) * 100), 1) if current_baseline_bal != 0 else 0.0

    avg_baseline_net = sum(m["baseline_net"] for m in monthly_data) / len(monthly_data) if monthly_data else 0.0
    avg_simulated_net = sum(m["simulated_net"] for m in monthly_data) / len(monthly_data) if monthly_data else 0.0

    # ── Calcul analytique exact du point d'équilibre (Break-Even) ──
    projected_var_months = [m for m in monthly_data if m.get("base_variable_projected", 0.0) > 0]
    proj_var_count = len(projected_var_months)

    total_base_projected_var_with_inflation = sum(
        m.get("base_variable_projected", 0.0) * m.get("inflation_factor", 1.0)
        for m in projected_var_months
    )

    break_even_monthly_saving = 0.0
    break_even_var_reduction_pct = 0.0
    is_fixed_expenses_deficit = False
    fixed_deficit_monthly = 0.0
    break_even_maintain_initial_saving = 0.0

    current_adj = float(variable_expense_adjustment_pct or 0.0)
    # Solde final sans ajustement (effort = 0.0)
    unadjusted_final_bal = current_simulated_bal + (current_adj * total_base_projected_var_with_inflation)

    if current_simulated_bal < 0 or unadjusted_final_bal < 0:
        deficit_to_cover = max(0.0, -unadjusted_final_bal)
        # Effort mensuel calculé sur les mois projetés (pour que X €/mois corresponde exactement au % affiché)
        break_even_monthly_saving = round(deficit_to_cover / proj_var_count, 2) if proj_var_count > 0 else round(deficit_to_cover / horizon_months, 2)
        
        if total_base_projected_var_with_inflation > 0:
            target_reduction_ratio = deficit_to_cover / total_base_projected_var_with_inflation
            break_even_var_reduction_pct = round(target_reduction_ratio * 100, 1)
            if target_reduction_ratio > 1.0:
                is_fixed_expenses_deficit = True
                fixed_deficit_monthly = round((deficit_to_cover - total_base_projected_var_with_inflation) / horizon_months, 2)
        else:
            is_fixed_expenses_deficit = True
            fixed_deficit_monthly = round(deficit_to_cover / horizon_months, 2)

    if current_simulated_bal < initial_balance:
        break_even_maintain_initial_saving = round((initial_balance - current_simulated_bal) / horizon_months, 2)

    # Métadonnées de transparence pour informer l'utilisateur des sources de données
    projection_sources = []
    if avg_variable_expense > 0:
        projection_sources.append(f"variable_expenses_avg_6m:{avg_variable_expense:.2f}")
    if variable_expense_stddev > 0:
        projection_sources.append(f"variable_expenses_stddev:{variable_expense_stddev:.2f}")
    if excluded_outliers_count > 0:
        projection_sources.append(f"outliers_excluded:{excluded_outliers_count}:{excluded_outliers_total:.2f}")
    if excluded_income_outliers_count > 0:
        projection_sources.append(f"income_outliers_excluded:{excluded_income_outliers_count}:{excluded_income_outliers_total:.2f}")
    if variable_expense_adjustment_pct != 0.0:
        projection_sources.append(f"variable_adjustment_pct:{variable_expense_adjustment_pct * 100:+.0f}%")
    has_seasonality = bool(seasonality_mode != "disabled" and seasonality_intensity > 0 and any(abs(c - 1.0) > 0.01 for c in seasonal_expense_coefficients.values()))
    if has_seasonality:
        projection_sources.append(f"seasonality:{seasonality_mode}:{int(round(seasonality_intensity * 100))}%")
    if inflation_rate > 0:
        projection_sources.append(f"inflation_rate:{inflation_rate}")
    if predicted_salary > 0:
        projection_sources.append(f"predicted_salary:{predicted_salary:.2f}")

    return {
        "horizon_months": horizon_months,
        "income_mode": income_mode,
        "custom_income_amount": custom_income_amount,
        "inflation_rate": inflation_rate,
        "variable_expense_adjustment_pct": variable_expense_adjustment_pct,
        "predicted_salary": round(predicted_salary, 2),
        "initial_balance": round(initial_balance, 2),
        "baseline_final_balance": round(current_baseline_bal, 2),
        "simulated_final_balance": round(current_simulated_bal, 2),
        "optimistic_final_balance": round(monthly_data[-1]["optimistic_end_balance"] if monthly_data else initial_balance, 2),
        "pessimistic_final_balance": round(monthly_data[-1]["pessimistic_end_balance"] if monthly_data else initial_balance, 2),
        "total_difference": round(total_diff, 2),
        "percentage_difference": pct_diff,
        "min_baseline_balance": round(min_baseline_bal, 2),
        "min_baseline_date": min_baseline_date,
        "min_simulated_balance": round(min_simulated_bal, 2),
        "min_simulated_date": min_simulated_date,
        "is_overdraft_risk": min_simulated_bal < 0,
        "first_overdraft_date": first_overdraft_date,
        "max_overdraft_amount": round(max_overdraft_amount, 2),
        "avg_baseline_net": round(avg_baseline_net, 2),
        "avg_simulated_net": round(avg_simulated_net, 2),
        "events_count": len(events_to_apply),
        "avg_variable_expense": round(avg_variable_expense, 2),
        "variable_expense_stddev": round(variable_expense_stddev, 2),
        "variable_expense_history_months": variable_expense_history_months,
        "outlier_sensitivity": outlier_sens,
        "excluded_outliers_count": excluded_outliers_count,
        "excluded_outliers_total": round(excluded_outliers_total, 2),
        "excluded_outliers_list": [
            {
                "id": t.id,
                "description": t.description,
                "amount": round(abs(t.amount), 2),
                "date": str(t.date_operation),
                "type": t.type
            }
            for t in excluded_outlier_txs
        ],
        "excluded_income_outliers_count": excluded_income_outliers_count,
        "excluded_income_outliers_total": round(excluded_income_outliers_total, 2),
        "excluded_income_outliers_list": [
            {
                "id": t.id,
                "description": t.description,
                "amount": round(abs(t.amount), 2),
                "date": str(t.date_operation),
                "type": t.type
            }
            for t in excluded_inc_outliers
        ],
        "seasonal_history_months": seasonal_history_months,
        "seasonality_mode": seasonality_mode,
        "seasonality_intensity": round(seasonality_intensity, 2),
        "has_seasonality": has_seasonality,
        "seasonal_expense_coefficients": {cm: round(seasonal_expense_coefficients.get(cm, 1.0), 3) for cm in range(1, 13)},
        "historical_seasonal_coefficients": {cm: round(historical_coefficients.get(cm, 1.0), 3) for cm in range(1, 13)},
        "preset_standard_coefficients": PRESET_STANDARD_SEASONALITY,
        "break_even_monthly_saving": break_even_monthly_saving,
        "break_even_var_reduction_pct": break_even_var_reduction_pct,
        "is_fixed_expenses_deficit": is_fixed_expenses_deficit,
        "fixed_deficit_monthly": fixed_deficit_monthly,
        "break_even_maintain_initial_saving": break_even_maintain_initial_saving,
        "conservative_weight": round(conservative_weight, 2),
        "projection_profile": "conservative" if conservative_weight == 1.0 else ("realistic" if conservative_weight == 0.0 else "blend"),
        "historical_real_income_avg": round(historical_real_income_avg, 2),
        "historical_real_fixed_avg": round(historical_real_fixed_avg, 2),
        "historical_real_net_avg": round(historical_real_net_avg, 2),
        "projection_sources": projection_sources,
        "monthly_data": monthly_data
    }

