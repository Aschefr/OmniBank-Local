"""
Tests d'intégrité structurelle des modules Bank Sync (Guardrails de Refactoring).
Garantit la non-régression structurelle :
1. Préservation de l'ensemble des symboles publics importables depuis la façade bank_sync_scheduler.
2. Identité mémoire stricte de _PENDING_SYNC_DATA (singleton anti-désynchronisation).
3. Préservation intégrale des routes FastAPI /api/bank-sync/* (méthodes et chemins).
4. Efficacité des mocks ciblant la façade sur les endpoints routeurs.
"""

import pytest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app

EXPECTED_PUBLIC_SYMBOLS = [
    "_PENDING_SYNC_DATA",
    "_SCHEDULER_RUNNING",
    "CSV_IMPORT_CONN_ID",
    "CSV_IMPORT_CONN_LABEL",
    "TRIGGER_SOURCE_LABELS",
    "_resolve_profile_id",
    "_get_config_value",
    "_set_config_value",
    "clear_pending_sync_for_connection",
    "clear_all_pending_sync",
    "get_dismissed_transactions",
    "add_dismissed_transaction",
    "remove_dismissed_transaction",
    "dismiss_pending_transaction",
    "remove_committed_from_pending",
    "save_pending_sync_data",
    "get_all_pending_sync",
    "clear_pending_sync_for_conn",
    "execute_auto_sync_for_connection",
    "get_auto_sync_cooldown_status",
    "is_background_sync_running",
    "trigger_manual_auto_sync",
    "bank_sync_scheduler_loop",
    "start_bank_sync_scheduler",
]

EXPECTED_BANK_SYNC_ROUTES = {
    ("/api/bank-sync/backends", ("GET",)),
    ("/api/bank-sync/connections", ("GET",)),
    ("/api/bank-sync/connections", ("POST",)),
    ("/api/bank-sync/connections/{conn_id}", ("PUT",)),
    ("/api/bank-sync/connections/{conn_id}", ("DELETE",)),
    ("/api/bank-sync/vault/unlock", ("POST",)),
    ("/api/bank-sync/vault/status", ("GET",)),
    ("/api/bank-sync/vault/lock", ("POST",)),
    ("/api/bank-sync/vault/reset", ("POST",)),
    ("/api/bank-sync/settings/auto-sync", ("GET",)),
    ("/api/bank-sync/settings/auto-sync", ("POST",)),
    ("/api/bank-sync/trigger-auto-sync", ("POST",)),
    ("/api/bank-sync/status", ("GET",)),
    ("/api/bank-sync/pending", ("GET",)),
    ("/api/bank-sync/update-pending", ("POST",)),
    ("/api/bank-sync/re-evaluate-preview", ("POST",)),
    ("/api/bank-sync/reconcile-fast/{tx_id}", ("POST",)),
    ("/api/bank-sync/reconcile-all-pending", ("POST",)),
    ("/api/bank-sync/commit-ghost", ("POST",)),
    ("/api/bank-sync/commit-all-ghosts", ("POST",)),
    ("/api/bank-sync/dismiss-ghost/{csv_id}", ("POST",)),
    ("/api/bank-sync/restore-ghost/{csv_id}", ("POST",)),
    ("/api/bank-sync/purge-pending", ("POST",)),
    ("/api/bank-sync/link-ghost", ("POST",)),
    ("/api/bank-sync/test-credentials", ("POST",)),
    ("/api/bank-sync/connections/{conn_id}/test", ("POST",)),
    ("/api/bank-sync/connections/{conn_id}/test-stream", ("GET",)),
    ("/api/bank-sync/connections/{conn_id}/preview", ("POST",)),
    ("/api/bank-sync/connections/{conn_id}/commit", ("POST",)),
    ("/api/bank-sync/2fa/respond", ("POST",)),
    ("/api/bank-sync/connections/{conn_id}/sync-stream", ("GET",)),
}


def test_all_public_symbols_importable_from_facade():
    """Vérifie que les symboles historiques sont accessibles depuis app.services.bank_sync_scheduler."""
    from app.services import bank_sync_scheduler

    for sym in EXPECTED_PUBLIC_SYMBOLS:
        assert hasattr(bank_sync_scheduler, sym), f"Symbole public manquant dans la façade : {sym}"


def test_pending_data_is_same_object():
    """
    Vérifie que _PENDING_SYNC_DATA est le même objet mémoire (singleton),
    qu'il soit importé depuis bank_sync_scheduler ou depuis pending_store.
    """
    from app.services import bank_sync_scheduler
    assert isinstance(bank_sync_scheduler._PENDING_SYNC_DATA, dict)

    try:
        from app.services.bank_sync import pending_store
        assert bank_sync_scheduler._PENDING_SYNC_DATA is pending_store._PENDING_SYNC_DATA, (
            "_PENDING_SYNC_DATA dans la façade et dans pending_store doivent pointer sur le même objet en mémoire !"
        )
    except ImportError:
        # pending_store pas encore créé (baseline pré-refactoring)
        pass


def test_router_endpoints_unchanged():
    """
    Vérifie que l'intégralité des endpoints /api/bank-sync/* reste enregistrée
    sans double préfixe ni suppression de route.
    """
    current_routes = set()
    for route in app.routes:
        if hasattr(route, "path") and route.path.startswith("/api/bank-sync"):
            methods = tuple(sorted(m for m in route.methods if m not in ("HEAD", "OPTIONS")))
            current_routes.add((route.path, methods))

    for exp_path, exp_methods in EXPECTED_BANK_SYNC_ROUTES:
        assert (exp_path, exp_methods) in current_routes, (
            f"Route manquante ou méthode incorrecte : {exp_methods} {exp_path}"
        )


def test_facade_mock_patch_intercepts_call():
    """
    Vérifie qu'un mock ciblant app.services.bank_sync_scheduler.trigger_manual_auto_sync
    intercepte fidèlement l'appel de routeur (compatibilité des tests existants).
    """
    client = TestClient(app)
    with patch("app.services.bank_sync_scheduler.trigger_manual_auto_sync") as mock_sync:
        mock_sync.return_value = {
            "ok": True,
            "message": "Relevé simulé avec succès",
            "cooldown_active": False,
            "profile_id": "default"
        }
        res = client.post("/api/bank-sync/trigger-auto-sync", json={"force": True})
        assert res.status_code == 200
        assert mock_sync.called
        assert mock_sync.call_args.kwargs.get("force") is True
