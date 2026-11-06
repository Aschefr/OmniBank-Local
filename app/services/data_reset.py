"""« Vider la base de données » : repartir d'un profil vide en gardant ses réglages et ses connexions bancaires.

Supprimé : tout ce qui vient des données ou y renvoie (comptes, opérations, budgets, récurrences, scénarios, prévisions
figées, historique d'annulation, notifications, conversations et faits de l'IA, apprentissages de l'Auto-Pilote), et
les réglages qui désignent un compte ou une opération.

Gardé : les réglages (IA, Auto-Pilote, paie, affichage…), les taux de change, les utilisateurs du mode organisation et
les connexions bancaires avec leurs identifiants chiffrés. Leur association aux comptes et leur dernier relevé sont
effacés : SQLite réutilise les numéros des comptes supprimés, et une association restée en place aurait envoyé les
opérations d'un compte de la banque dans le premier compte recréé portant ce numéro.
"""
from sqlalchemy.orm import Session

from app.models import (
    AIFact, Account, ActionHistory, AutopilotDecisionLog, BankConnection, BankLabelMapping, Budget, BudgetAllocation,
    BudgetCategory, Category, ChatMessage, ChatSession, ForecastSnapshot, GlobalConfig, Notification, RecurrenceTemplate,
    Scenario, ScenarioEvent, Transaction,
)

# Enfants avant parents (clés étrangères)
DATA_TABLES = [
    BudgetAllocation, BudgetCategory, Budget, ScenarioEvent, Scenario, ChatMessage, ChatSession, Transaction,
    RecurrenceTemplate, ForecastSnapshot, Account, Category, AutopilotDecisionLog, ActionHistory, Notification,
    AIFact, BankLabelMapping,
]

# Réglages qui désignent un compte, une opération, un scénario, ou l'état d'un traitement sur les données supprimées
DATA_CONFIG_KEYS = [
    "main_account_id", "file_account_mapping", "overview_account_id", "trends_account_id", "sim_account",
    "sim_active_scenario", "bank_pending_sync_cache", "bank_last_statement_cache", "autopilot_seen_review_tx_ids",
    "autopilot_last_visit_at", "budget_alerts_sent", "budget_pinned_ids", "budget_sidebar_labels",
    "last_budget_recalibration_period", "last_budget_autopilot_run_at", "last_budget_alert_check_at",
    "override_paycheck_amount", "override_paycheck_date", "override_paycheck_period",
]


def clear_user_data(db: Session) -> dict:
    counts = {}
    for model in DATA_TABLES:
        counts[model.__tablename__] = db.query(model).delete(synchronize_session=False)
    counts["settings"] = db.query(GlobalConfig).filter(GlobalConfig.key.in_(DATA_CONFIG_KEYS)).delete(synchronize_session=False)
    counts["bank_connections_unlinked"] = db.query(BankConnection).update({
        BankConnection.account_mapping: None, BankConnection.last_sync_at: None, BankConnection.last_sync_status: None,
        BankConnection.last_sync_count: 0, BankConnection.last_error: None,
    }, synchronize_session=False)
    db.commit()
    return counts
