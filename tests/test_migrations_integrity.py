"""
Tests unitaires et d'intégration pour le moteur de migrations incrémentales (Action 13).
Vérifie la complétude du registre, l'initialisation complète à neuf (v0 -> v25),
la mise à niveau incrémentale depuis une version intermédiaire, l'idempotence et le fast-path.
"""
import pytest
from sqlalchemy import create_engine, text
from app.database import Base
from app.init_data import init_db, TARGET_SCHEMA_VERSION
from app.migrations.runner import (
    run_migrations,
    get_current_schema_version,
    set_schema_version,
    safe_add_column,
    column_exists,
    table_exists
)
from app.migrations.versions import ALL_MIGRATIONS


def test_migration_order_and_registry():
    """Vérifie que toutes les migrations de v02 à v25 sont consécutives, valides et complètes."""
    assert len(ALL_MIGRATIONS) == 24, f"Nombre de migrations inattendu : {len(ALL_MIGRATIONS)}"

    expected_versions = list(range(2, 26))
    actual_versions = [m.version for m in ALL_MIGRATIONS]
    assert actual_versions == expected_versions, f"Désalignement des versions : {actual_versions} vs {expected_versions}"

    for m in ALL_MIGRATIONS:
        assert m.description and len(m.description.strip()) > 5, f"Description invalide pour v{m.version}"
        assert callable(m.upgrade), f"Fonction upgrade non callable pour v{m.version}"


def test_fresh_database_full_migration():
    """Vérifie qu'une base SQLite vierge est amenée de v0 à v25 avec toutes les tables, colonnes et seeds."""
    engine = create_engine("sqlite:///:memory:")
    init_db(target_engine=engine)

    with engine.connect() as conn:
        current_v = get_current_schema_version(conn)
        assert current_v == TARGET_SCHEMA_VERSION == 25

        # Vérifier l'existence de toutes les tables créées au fil des versions
        critical_tables = [
            "transactions", "accounts", "categories", "budgets",
            "budget_allocations", "chat_sessions", "chat_messages",
            "notifications", "action_history", "exchange_rates",
            "scenarios", "scenario_events", "bank_label_mappings",
            "autopilot_decision_log"
        ]
        for tbl in critical_tables:
            assert table_exists(conn, tbl), f"Table critique manquante : {tbl}"

        # Vérifier des colonnes représentatives créées par migrations
        assert column_exists(conn, "budgets", "envelope_type")  # v03
        assert column_exists(conn, "transactions", "is_salary")  # v04
        assert column_exists(conn, "notifications", "link_data")  # v10
        assert column_exists(conn, "accounts", "currency")  # v16
        assert column_exists(conn, "budgets", "is_locked")  # v24
        assert column_exists(conn, "bank_label_mappings", "is_manual")  # v25
        assert column_exists(conn, "bank_label_mappings", "category_counts")  # v25

        # Vérifier le seed de la configuration et des taux de change (v16, v24)
        base_curr = conn.execute(text("SELECT value FROM global_config WHERE key = 'base_currency'")).scalar()
        assert base_curr == "EUR"

        autopilot_cfg = conn.execute(text("SELECT value FROM global_config WHERE key = 'auto_pilot_enabled'")).scalar()
        assert autopilot_cfg == "false"

        rate_count = conn.execute(text("SELECT COUNT(*) FROM exchange_rates")).scalar()
        assert rate_count >= 10


def test_incremental_migration_from_intermediate_version():
    """Vérifie qu'une base pré-existante (ex: v8) monte proprement à v25 sans régression."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        # Simuler une base en version 8
        set_schema_version(conn, 8)
        conn.commit()

    # Exécuter les migrations incrémentales
    final_v = run_migrations(engine)
    assert final_v == 25

    with engine.connect() as conn:
        assert get_current_schema_version(conn) == 25
        # Les tables introduites après la v8 doivent exister
        assert table_exists(conn, "action_history")  # v11
        assert table_exists(conn, "exchange_rates")  # v16
        assert table_exists(conn, "scenarios")  # v18
        assert table_exists(conn, "bank_label_mappings")  # v20
        assert table_exists(conn, "autopilot_decision_log")  # v24


def test_migration_fast_path():
    """Vérifie que sur une base déjà en v25, init_db termine immédiatement."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        set_schema_version(conn, 25)
        conn.commit()

    # init_db doit court-circuiter (fast-path) sans erreur
    init_db(target_engine=engine)
    with engine.connect() as conn:
        assert get_current_schema_version(conn) == 25


def test_safe_add_column_idempotency():
    """Vérifie que safe_add_column est non-destructif et idempotent."""
    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        conn.execute(text("CREATE TABLE test_box (id INTEGER PRIMARY KEY)"))
        conn.commit()

        # Premier ajout -> doit réussir et renvoyer True
        added_1 = safe_add_column(conn, "test_box", "custom_tag", "TEXT DEFAULT 'active'")
        conn.commit()
        assert added_1 is True
        assert column_exists(conn, "test_box", "custom_tag") is True

        # Deuxième ajout -> doit détecter l'existence et renvoyer False sans erreur
        added_2 = safe_add_column(conn, "test_box", "custom_tag", "TEXT DEFAULT 'active'")
        conn.commit()
        assert added_2 is False


def test_idempotent_multiple_init_db():
    """Vérifie que plusieurs appels successifs à init_db n'altèrent pas l'état et restent stables."""
    engine = create_engine("sqlite:///:memory:")
    init_db(target_engine=engine)
    init_db(target_engine=engine)
    init_db(target_engine=engine)

    with engine.connect() as conn:
        assert get_current_schema_version(conn) == 25
