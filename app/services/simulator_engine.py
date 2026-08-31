"""
app/services/simulator_engine.py — Moteur de projection et simulation What-If (Sandbox).
Zéro pollution DB : calculs en mémoire à partir des soldes réels, récurrences et événements simulés.
Inclut : projection dépenses variables, saisonnalité, inflation, bandes de confiance ±1σ.
"""
import logging
import math
from datetime import date, datetime
from typing import List, Dict, Any, Optional
from calendar import monthrange
from sqlalchemy.orm import Session

from app.models import Account, Transaction, RecurrenceTemplate, Scenario, ScenarioEvent
from app.services.finance_engine import calculate_balances, get_main_account

logger = logging.getLogger(__name__)


PRESET_TEMPLATES = [
    {
        "id": "vehicle_project",
        "i18n_key": "sim_preset_vehicle",
        "name": "Achat Véhicule",
        "name_fr": "Achat Véhicule",
        "name_en": "Vehicle Purchase",
        "description": "Apport initial + Mensualité crédit auto + Assurance",
        "desc_fr": "Apport initial + Mensualité crédit auto + Assurance",
        "desc_en": "Initial down payment + Auto loan monthly + Insurance",
        "color": "#3b82f6",
        "events": [
            {
                "label": "Apport personnel véhicule",
                "label_fr": "Apport personnel véhicule",
                "label_en": "Vehicle Down Payment",
                "event_type": "one_off_expense",
                "amount": 5000.0,
                "duration_months": 1,
                "notes": "Paiement comptant ou apport concessionnaire",
                "notes_fr": "Paiement comptant ou apport concessionnaire",
                "notes_en": "Cash payment or dealer down payment"
            },
            {
                "label": "Mensualité crédit auto",
                "label_fr": "Mensualité crédit auto",
                "label_en": "Auto Loan Monthly Payment",
                "event_type": "recurring_expense",
                "amount": 260.0,
                "duration_months": 24,
                "notes": "Remboursement prêt auto sur 2 ans",
                "notes_fr": "Remboursement prêt auto sur 2 ans",
                "notes_en": "Auto loan repayment over 2 years"
            },
            {
                "label": "Assurance tous risques additionnelle",
                "label_fr": "Assurance tous risques additionnelle",
                "label_en": "Additional Comprehensive Insurance",
                "event_type": "recurring_expense",
                "amount": 45.0,
                "duration_months": 24,
                "notes": "Surcoût assurance mensuelle",
                "notes_fr": "Surcoût assurance mensuelle",
                "notes_en": "Additional monthly insurance cost"
            }
        ]
    },
    {
        "id": "renovation_project",
        "i18n_key": "sim_preset_renovation",
        "name": "Travaux & Rénovation",
        "name_fr": "Travaux & Rénovation",
        "name_en": "Home Renovations",
        "description": "Acompte + Solde fin de chantier + Mensualité prêt travaux",
        "desc_fr": "Acompte + Solde fin de chantier + Mensualité prêt travaux",
        "desc_en": "Deposit + Final payment + Home improvement loan",
        "color": "#f59e0b",
        "events": [
            {
                "label": "Acompte signature devis",
                "label_fr": "Acompte signature devis",
                "label_en": "Initial Quote Deposit",
                "event_type": "one_off_expense",
                "amount": 3000.0,
                "duration_months": 1,
                "notes": "Premier versement 30%",
                "notes_fr": "Premier versement 30%",
                "notes_en": "Initial 30% deposit"
            },
            {
                "label": "Solde fin de travaux",
                "label_fr": "Solde fin de travaux",
                "label_en": "Final Work Payment",
                "event_type": "one_off_expense",
                "amount": 4000.0,
                "duration_months": 1,
                "notes": "Règlement final à la livraison",
                "notes_fr": "Règlement final à la livraison",
                "notes_en": "Final balance upon completion"
            },
            {
                "label": "Mensualité prêt travaux",
                "label_fr": "Mensualité prêt travaux",
                "label_en": "Home Improvement Loan",
                "event_type": "recurring_expense",
                "amount": 180.0,
                "duration_months": 36,
                "notes": "Prêt rénovation sur 3 ans",
                "notes_fr": "Prêt rénovation sur 3 ans",
                "notes_en": "Home improvement loan over 3 years"
            }
        ]
    },
    {
        "id": "sabbatical_project",
        "i18n_key": "sim_preset_sabbatical",
        "name": "Congé Sabbatique / Parental",
        "name_fr": "Congé Sabbatique / Parental",
        "name_en": "Sabbatical / Parental Leave",
        "description": "Baisse temporaire de salaire avec réduction des dépenses",
        "desc_fr": "Baisse temporaire de salaire avec réduction des dépenses",
        "desc_en": "Temporary income drop with spending reductions",
        "color": "#10b981",
        "events": [
            {
                "label": "Baisse de revenu mensuel",
                "label_fr": "Baisse de revenu mensuel",
                "label_en": "Monthly Income Reduction",
                "event_type": "recurring_expense",
                "amount": 1200.0,
                "duration_months": 6,
                "notes": "Perte nette de revenu d'activité pendant 6 mois",
                "notes_fr": "Perte nette de revenu d'activité pendant 6 mois",
                "notes_en": "Net loss of employment income for 6 months"
            },
            {
                "label": "Réduction budget sorties/transport",
                "label_fr": "Réduction budget sorties/transport",
                "label_en": "Reduced Transport & Leisure Budget",
                "event_type": "recurring_income",
                "amount": 350.0,
                "duration_months": 6,
                "notes": "Économies sur carburant, cantine et loisirs",
                "notes_fr": "Économies sur carburant, cantine et loisirs",
                "notes_en": "Savings on fuel, commute and dining out"
            }
        ]
    },
    {
        "id": "real_estate_project",
        "i18n_key": "sim_preset_real_estate",
        "name": "Achat Immobilier",
        "name_fr": "Achat Immobilier",
        "name_en": "Real Estate Purchase",
        "description": "Frais de notaire + Mensualité crédit immobilier",
        "desc_fr": "Frais de notaire + Mensualité crédit immobilier",
        "desc_en": "Closing costs / down payment + Mortgage loan",
        "color": "#8b5cf6",
        "events": [
            {
                "label": "Apport personnel & Notaire",
                "label_fr": "Apport personnel & Notaire",
                "label_en": "Down Payment & Closing Costs",
                "event_type": "one_off_expense",
                "amount": 20000.0,
                "duration_months": 1,
                "notes": "Apport versé lors de la signature de l'acte authentique",
                "notes_fr": "Apport versé lors de la signature de l'acte authentique",
                "notes_en": "Down payment and notary fees upon signing"
            },
            {
                "label": "Mensualité crédit immobilier",
                "label_fr": "Mensualité crédit immobilier",
                "label_en": "Monthly Mortgage Payment",
                "event_type": "recurring_expense",
                "amount": 1050.0,
                "duration_months": 36,
                "notes": "Mensualité projetée assurance comprise",
                "notes_fr": "Mensualité projetée assurance comprise",
                "notes_en": "Projected mortgage payment including insurance"
            }
        ]
    },
    {
        "id": "inflation_project",
        "i18n_key": "sim_preset_inflation",
        "name": "Hausse Coût de la Vie",
        "name_fr": "Hausse Coût de la Vie",
        "name_en": "Cost of Living Increase",
        "description": "Inflation des charges fixes (énergie, alimentation)",
        "desc_fr": "Inflation des charges fixes (énergie, alimentation)",
        "desc_en": "Inflation on fixed costs (utilities, groceries)",
        "color": "#ef4444",
        "events": [
            {
                "label": "Hausse énergie & alimentation",
                "label_fr": "Hausse énergie & alimentation",
                "label_en": "Utilities & Groceries Increase",
                "event_type": "recurring_expense",
                "amount": 120.0,
                "duration_months": 24,
                "notes": "Augmentation moyenne estimée des dépenses courantes",
                "notes_fr": "Augmentation moyenne estimée des dépenses courantes",
                "notes_en": "Estimated average increase on living expenses"
            }
        ]
    }
]


def get_simulator_presets() -> List[Dict[str, Any]]:
    """Retourne la liste des modèles de simulation prédéfinis."""
    return PRESET_TEMPLATES


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
    conservative_weight: Optional[float] = None
) -> Dict[str, Any]:
    """
    Exécute la projection sur `horizon_months` mois.
    Compare la trajectoire de base (réelle) avec la trajectoire simulée (What-If).
    Supporte un curseur continu de prudence / conservatisme `conservative_weight` (0.0 = 100% Réel, 1.0 = 100% Conservateur).
    Supporte 4 modes de revenu de référence : 'auto', 'historical_n1', 'custom', 'none'.
    Inclut projection des dépenses variables (moyenne glissante 6 mois avec filtrage IQR),
    saisonnalité (profil mensuel N-1), inflation optionnelle, curseur d'effort budgétaire,
    calcul du point d'équilibre et bandes de confiance ±1σ.
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

    logger.info(f"[Simulateur] Lancement projection sur {horizon_months} mois (scénario: {scenario_id}, compte: {account_id}, poids_conservateur: {conservative_weight:.2f}, mode_revenu: {income_mode}, inflation: {inflation_rate}, ajustement_var: {variable_expense_adjustment_pct})")

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
        # Si aucun compte spécifié, utiliser le compte courant principal
        main_acc = get_main_account(db)
        if main_acc:
            target_accounts.append(main_acc)
            initial_balance = balances.get(main_acc.id, 0.0)
        else:
            initial_balance = sum(balances.values())
            target_accounts = db.query(Account).filter(Account.is_closed == False).all()

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
                    except Exception:
                        st_date = today
                elif not isinstance(st_date, date):
                    st_date = today

                end_d = ev.get("end_date")
                if isinstance(end_d, str):
                    try:
                        end_d = datetime.strptime(end_d, "%Y-%m-%d").date()
                    except Exception:
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

    try:
        from app.services.finance_engine import predict_next_paycheck
        pay_info = predict_next_paycheck(db)
        if pay_info and pay_info.get("amount"):
            predicted_salary = float(pay_info.get("amount") or 0.0)
            history = pay_info.get("history") or []
            current_period_str = f"{today.year:04d}-{today.month:02d}"
            current_entry = next((h for h in history if h.get("logical_period") == current_period_str), None)
            if current_entry and current_entry.get("amount") is not None and not current_entry.get("is_placeholder"):
                is_current_month_pay_received = True
            elif pay_info.get("is_period_validated"):
                is_current_month_pay_received = True

            for h in history:
                if h.get("amount") is not None and not h.get("is_placeholder"):
                    lp = h.get("logical_period")
                    if lp and "-" in lp:
                        try:
                            hy, hm = map(int, lp.split("-"))
                            amt = float(h["amount"])
                            historical_salary_by_month[(hy, hm)] = amt
                            # Mémoriser la saisonnalité par mois calendaire (1..12) pour répétition pluriannuelle
                            if hm not in seasonal_salary_by_calendar_month:
                                seasonal_salary_by_calendar_month[hm] = amt
                        except Exception:
                            pass
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

        # ── Filtrage des outliers (IQR) — même logique que chat_tools.py ──
        # Les achats exceptionnels (véhicule, gros électroménager) ne doivent pas
        # gonfler la moyenne des dépenses variables projetées.
        excluded_outlier_txs = []
        filtered_var_txs = list(var_exp_txs)

        if len(var_exp_txs) >= 5:
            amounts = sorted([abs(t.amount) for t in var_exp_txs])
            q1 = amounts[len(amounts) // 4]
            q3 = amounts[3 * len(amounts) // 4]
            iqr = q3 - q1
            upper_fence = q3 + 3.0 * iqr  # 3×IQR — conservateur
            import statistics as _stats
            median_amt = _stats.median(amounts)

            filtered_var_txs = []
            for t in var_exp_txs:
                amt = abs(t.amount)
                # Triple condition pour classifier comme outlier :
                #  1. Dépasse le fence statistique (3×IQR)
                #  2. Montant absolu > 500 € (petits montants jamais outliers)
                #  3. Montant > 5× la médiane (vraiment exceptionnel)
                is_outlier = (
                    amt > upper_fence
                    and amt > 500
                    and amt > 5 * median_amt
                )
                if is_outlier:
                    excluded_outlier_txs.append(t)
                    logger.info(
                        f"[Simulateur] Outlier exclu de la projection variable : "
                        f"{t.description} — {amt:.2f} € "
                        f"(fence={upper_fence:.2f}, médiane={median_amt:.2f})"
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

        # Saisonnalité sur 12 derniers mois (profil par mois calendaire 1-12 avec filtrage outliers)
        twelve_months_ago = _add_months(date(today.year, today.month, 1), -12)
        seasonal_query = db.query(Transaction).filter(
            Transaction.type.in_(["expense_var", "expense_fixed"]),
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

        # Filtrage outliers sur 12 mois pour des profils mensuels cohérents (ne pas répéter l'achat d'un véhicule ou gros travaux)
        filtered_seasonal_txs = list(seasonal_txs)
        if len(seasonal_txs) >= 5:
            amounts_seas = sorted([abs(t.amount) for t in seasonal_txs])
            q1_s = amounts_seas[len(amounts_seas) // 4]
            q3_s = amounts_seas[3 * len(amounts_seas) // 4]
            iqr_s = q3_s - q1_s
            upper_fence_s = q3_s + 3.0 * iqr_s
            import statistics as _stats
            median_s = _stats.median(amounts_seas)
            filtered_seasonal_txs = [
                t for t in seasonal_txs
                if not (abs(t.amount) > upper_fence_s and abs(t.amount) > 500 and abs(t.amount) > 5 * median_s)
            ]

        seasonal_totals = {}  # mois_cal (1..12) -> total dépenses
        for t in filtered_seasonal_txs:
            cm = t.date_operation.month
            seasonal_totals.setdefault(cm, 0.0)
            seasonal_totals[cm] += abs(t.amount)

        seasonal_history_months = len(seasonal_totals)

        if seasonal_history_months >= 6:
            # Calculer la moyenne globale mensuelle pour normaliser
            global_monthly_avg = sum(seasonal_totals.values()) / seasonal_history_months
            if global_monthly_avg > 0:
                for cm, total in seasonal_totals.items():
                    seasonal_expense_coefficients[cm] = total / global_monthly_avg
                logger.info(f"[Simulateur] Coefficients saisonniers calculés sur {seasonal_history_months} mois: {seasonal_expense_coefficients}")
        else:
            logger.info(f"[Simulateur] Historique saisonnier insuffisant ({seasonal_history_months}/6 mois minimum) - moyenne brute utilisée")
    except Exception as e:
        logger.warning(f"[Simulateur] Erreur calcul dépenses variables/saisonnalité: {e}")

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
        filtered_inc_txs = list(real_inc_txs)
        excluded_inc_outliers = []
        if len(real_inc_txs) >= 4:
            inc_amounts = sorted([abs(t.amount) for t in real_inc_txs])
            q1_inc = inc_amounts[len(inc_amounts) // 4]
            q3_inc = inc_amounts[3 * len(inc_amounts) // 4]
            iqr_inc = q3_inc - q1_inc
            upper_fence_inc = q3_inc + 3.0 * iqr_inc
            import statistics as _stats
            median_inc = _stats.median(inc_amounts)
            
            filtered_inc_txs = []
            for t in real_inc_txs:
                amt = abs(t.amount)
                # Outlier si dépasse le seuil statistique 3×IQR, supérieur à 1000€ et > 2.5× la médiane
                is_outlier = (
                    amt > upper_fence_inc
                    and amt > 1000.0
                    and (amt > 2.5 * median_inc or (predicted_salary > 0 and amt > 2.5 * predicted_salary))
                )
                if is_outlier:
                    excluded_inc_outliers.append(t)
                    logger.info(
                        f"[Simulateur] Outlier de recette exclu du modèle moyen : {t.description} — {amt:.2f} € "
                        f"(fence={upper_fence_inc:.2f}, médiane={median_inc:.2f})"
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
    current_optimistic_bal = initial_balance
    current_pessimistic_bal = initial_balance

    min_baseline_bal = initial_balance
    min_baseline_date = today.strftime("%Y-%m")
    min_simulated_bal = initial_balance
    min_simulated_date = today.strftime("%Y-%m")

    first_overdraft_date = None
    max_overdraft_amount = 0.0

    month_names_fr = [
        "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
        "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
    ]

    for m_offset in range(horizon_months):
        curr_date = _add_months(date(start_year, start_month, 1), m_offset)
        y = curr_date.year
        m = curr_date.month
        month_str = f"{y:04d}-{m:02d}"
        month_label = f"{month_names_fr[m]} {y}"
        first_day = date(y, m, 1)
        last_day = date(y, m, monthrange(y, m)[1])

        # Transactions déjà saisies en DB pour ce mois (uniquement non rapprochées pour éviter les doublons avec le solde initial)
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
        existing_rec_template_ids = set()

        existing_income_total = 0.0
        existing_fixed_total = 0.0

        for t in existing_txs:
            # Filtrer par compte cible si applicable
            is_relevant = False
            if not target_acc_ids:
                is_relevant = True
            elif t.from_account_id in target_acc_ids or t.to_account_id in target_acc_ids:
                is_relevant = True

            if is_relevant:
                if t.recurrence_id:
                    existing_rec_template_ids.add(t.recurrence_id)

                if t.type == "income" or (target_acc_ids and t.to_account_id in target_acc_ids and (not t.from_account_id or t.from_account_id not in target_acc_ids)):
                    existing_income_total += abs(t.amount)
                elif t.type == "expense_fixed" or (target_acc_ids and t.from_account_id in target_acc_ids and (not t.to_account_id or t.to_account_id not in target_acc_ids) and t.type != "expense_var"):
                    existing_fixed_total += abs(t.amount)
                elif t.type == "expense_var":
                    baseline_expense += abs(t.amount)

        baseline_income += existing_income_total
        baseline_expense += existing_fixed_total

        # Calcul des récurrences théoriques pour ce mois m
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

            freq = (rec.frequency or "monthly").lower()
            should_apply = False
            if freq in ("monthly", "mensuel"):
                should_apply = True
            elif freq in ("yearly", "annuel"):
                if rec.month_of_year == m:
                    should_apply = True
            elif freq in ("quarterly", "trimestriel"):
                if (m - 1) % 3 == 0:
                    should_apply = True
            elif freq in ("semiannual", "semestriel"):
                if (m - 1) % 6 == 0:
                    should_apply = True
            elif freq in ("weekly", "hebdomadaire"):
                should_apply = True
            else:
                should_apply = True

            if should_apply:
                amt = rec.amount if freq != "weekly" else (rec.amount * 4.33)
                if is_incoming:
                    theoretical_income_for_month += amt
                elif is_outgoing:
                    theoretical_fixed_for_month += amt

        # Ajout des flux récurrents théoriques si pas déjà couverts par les transactions saisies
        if theoretical_income_for_month > 0:
            if existing_income_total == 0:
                baseline_income += theoretical_income_for_month
            elif existing_income_total < (0.6 * theoretical_income_for_month):
                baseline_income += (theoretical_income_for_month - existing_income_total)

        # 1. Charges fixes projetées : interpolation continue entre réel saisonnier et théorique
        real_fixed_ref = seasonal_real_fixed_by_calendar_month.get(m, historical_real_fixed_avg if historical_real_fixed_avg > 0 else theoretical_fixed_for_month)
        blended_fixed_for_month = (1.0 - conservative_weight) * real_fixed_ref + conservative_weight * theoretical_fixed_for_month

        if existing_fixed_total == 0:
            baseline_expense += blended_fixed_for_month
        elif existing_fixed_total < (0.6 * blended_fixed_for_month):
            baseline_expense += (blended_fixed_for_month - existing_fixed_total)

        # 2. Revenus projetés : interpolation continue entre réel et salaire de base plancher
        cons_salary_ref = predicted_salary_for_account

        if income_mode in ("historical_n1", "auto"):
            # 1. Recettes réelles de l'année précédente (saisonnier mois par mois)
            real_salary_ref = seasonal_real_income_by_calendar_month.get(m, historical_real_income_avg if historical_real_income_avg > 0 else predicted_salary_for_account)
            blended_salary = (1.0 - conservative_weight) * real_salary_ref + conservative_weight * cons_salary_ref
            has_main_salary = existing_income_total >= (0.6 * blended_salary) if blended_salary > 0 else False
            if not (m_offset == 0 and is_current_month_pay_received) and not has_main_salary:
                baseline_income += blended_salary
        elif income_mode in ("average", "historical_avg"):
            # 2. Recettes moyennes (moyenne mensuelle sur les 12 derniers mois ou mois existants)
            avg_salary_ref = historical_real_income_avg if historical_real_income_avg > 0 else predicted_salary_for_account
            blended_salary = (1.0 - conservative_weight) * avg_salary_ref + conservative_weight * cons_salary_ref
            has_main_salary = existing_income_total >= (0.6 * blended_salary) if blended_salary > 0 else False
            if not (m_offset == 0 and is_current_month_pay_received) and not has_main_salary:
                baseline_income += blended_salary
        elif income_mode == "custom":
            # 3. Montant personnalisé
            custom_val = float(custom_income_amount or 0.0)
            has_main_salary = existing_income_total >= (0.6 * custom_val) if custom_val > 0 else False
            if not (m_offset == 0 and is_current_month_pay_received) and not has_main_salary:
                baseline_income += custom_val
        elif income_mode == "none":
            # 4. Désactivé (Scénario zéro salaire)
            pass


        # ── Projection des dépenses variables pour les mois sans transactions réelles ──
        has_real_variable_txs = any(
            t.type == "expense_var" for t in existing_txs
            if (not target_acc_ids or t.from_account_id in target_acc_ids or t.to_account_id in target_acc_ids)
        )

        base_variable_projected = 0.0
        variable_expense_projected = 0.0
        if avg_variable_expense > 0 and not has_real_variable_txs:
            # Appliquer le coefficient saisonnier si disponible
            coeff = seasonal_expense_coefficients.get(m, 1.0)
            base_variable_projected = avg_variable_expense * coeff
            # Appliquer le curseur d'ajustement utilisateur (-100% à +50%)
            var_adj_factor = max(0.0, 1.0 + float(variable_expense_adjustment_pct or 0.0))
            variable_expense_projected = base_variable_projected * var_adj_factor
            baseline_expense += variable_expense_projected

        # ── Facteur d'inflation ──
        inflation_factor = 1.0
        if inflation_rate > 0 and m_offset > 0:
            inflation_factor = (1 + inflation_rate) ** (m_offset / 12.0)
            # L'inflation s'applique sur les dépenses projetées (pas sur les transactions réelles déjà saisies)
            inflation_delta = baseline_expense * (inflation_factor - 1.0)
            baseline_expense += inflation_delta

        baseline_net = baseline_income - baseline_expense
        month_start_baseline = current_baseline_bal
        current_baseline_bal += baseline_net

        # ── Bandes de confiance ±1σ ──
        # Optimiste = dépenses variables réduites de 1σ, Pessimiste = augmentées de 1σ
        optimistic_net = baseline_net
        pessimistic_net = baseline_net
        if variable_expense_stddev > 0 and not has_real_variable_txs:
            optimistic_net = baseline_net + variable_expense_stddev  # moins de dépenses → plus de solde
            pessimistic_net = baseline_net - variable_expense_stddev  # plus de dépenses → moins de solde

        month_start_optimistic = current_optimistic_bal
        month_start_pessimistic = current_pessimistic_bal
        current_optimistic_bal += optimistic_net
        current_pessimistic_bal += pessimistic_net




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

        # Calculer les bandes de confiance simulées (baseline ±σ + events)
        optimistic_simulated = current_optimistic_bal + simulated_events_impact
        pessimistic_simulated = current_pessimistic_bal + simulated_events_impact

        fixed_expense_actual = blended_fixed_for_month if existing_fixed_total == 0 else (existing_fixed_total + max(0.0, blended_fixed_for_month - existing_fixed_total))
        var_expense_actual = variable_expense_projected if not has_real_variable_txs else sum(abs(t.amount) for t in existing_txs if t.type == "expense_var" and (not target_acc_ids or t.from_account_id in target_acc_ids or t.to_account_id in target_acc_ids))
        inflation_delta_actual = inflation_delta if (inflation_rate > 0 and m_offset > 0) else 0.0

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
    if seasonal_expense_coefficients:
        projection_sources.append(f"seasonality_months:{seasonal_history_months}")
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
        "optimistic_final_balance": round(current_optimistic_bal, 2),
        "pessimistic_final_balance": round(current_pessimistic_bal, 2),
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
        "excluded_outliers_count": excluded_outliers_count,
        "excluded_outliers_total": round(excluded_outliers_total, 2),
        "excluded_income_outliers_count": excluded_income_outliers_count,
        "excluded_income_outliers_total": round(excluded_income_outliers_total, 2),
        "seasonal_history_months": seasonal_history_months,
        "has_seasonality": bool(seasonal_expense_coefficients),
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

