"""
Migration v35 : « Autonomie totale » inclut désormais la création automatique des récurrences (promotion N >= 3 et
récurrences dès le premier mois des charges fixes). Un profil déjà en Autonomie totale (ses 14 automatismes allumés)
reçoit l'interrupteur allumé, sinon il passerait en « Personnalisé ». Date d'effet 45 jours en arrière, comme le
préréglage : seul le dernier mois et demi peut donner une récurrence, pas tout l'historique.
"""
from datetime import date, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection

VERSION = 35
DESCRIPTION = "Autonomie totale : création automatique des récurrences"

_PREVIOUS_FULL_KEYS = (
    "auto_reconcile_transactions", "auto_commit_incoming_transactions", "auto_assign_chameleon_fallback",
    "auto_close_empty_import_sas", "auto_create_missing_categories", "enable_budget_creation_suggestions",
    "enable_budget_recalibration_suggestions", "bank_auto_sync_enabled", "auto_link_deviant_recurrences",
    "auto_propagate_recurrence_hikes", "auto_skip_unreconciled_recurrences", "auto_close_unreconciled_recurrences",
    "auto_create_budget_envelopes", "auto_apply_budget_suggestions",
)


def _value(conn: Connection, key: str) -> str:
    row = conn.execute(text("SELECT value FROM global_config WHERE key = :k"), {"k": key}).fetchone()
    return (row[0] or "").strip().lower() if row else ""


def upgrade(conn: Connection) -> None:
    if not all(_value(conn, k) in ("true", "1", "yes", "on") for k in _PREVIOUS_FULL_KEYS):
        return
    conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_promote_recurrences', 'true')"))
    conn.execute(text("UPDATE global_config SET value = 'true' WHERE key = 'auto_promote_recurrences'"))
    if not _value(conn, "auto_promote_recurrences_since"):
        start = (date.today() - timedelta(days=45)).isoformat()
        conn.execute(text("INSERT OR IGNORE INTO global_config (key, value) VALUES ('auto_promote_recurrences_since', :d)"),
                     {"d": start})
        conn.execute(text("UPDATE global_config SET value = :d WHERE key = 'auto_promote_recurrences_since' "
                          "AND (value IS NULL OR TRIM(value) = '')"), {"d": start})
