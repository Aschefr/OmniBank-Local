"""Un vrai relevé part seulement s'il est nécessaire ou demandé explicitement ; aucun appel à une banque ici."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import BankConnection, Base, GlobalConfig
from app.services import bank_sync_scheduler as scheduler
from app.services.bank_sync import auto_sync
from app.services.bank_sync_service import BankSyncService

PID = "t_due"
MAPPING = '{"r1": 1}'
NOW = datetime.now(timezone.utc)


@pytest.fixture
def engine():
    return create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@pytest.fixture
def db(engine):
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine, autoflush=False)()
    yield s
    s.close()


@pytest.fixture
def run(db, engine, monkeypatch):
    """Lance le déclencheur réel et son fil, en remplaçant uniquement l'appel à la banque."""
    monkeypatch.setenv("OMNIBANK_ENABLE_TEST_BACKGROUND_SYNC", "1")
    monkeypatch.setattr("app.database.get_engine", lambda pid: engine)
    monkeypatch.setattr(auto_sync, "start_label_refinement", lambda pid: None)
    synced = []
    monkeypatch.setattr(auto_sync, "execute_auto_sync_for_connection",
                        lambda session, conn, pw, profile_id=None, trigger_source="": synced.append(conn.label))

    def _run(force=False, source="scheduled"):
        res = auto_sync.trigger_manual_auto_sync(master_password="pw", profile_id=PID, force=force, trigger_source=source)
        thread = auto_sync._ACTIVE_BACKGROUND_THREADS.get(PID)
        if thread:
            thread.join(timeout=10)
        return res, synced
    yield _run
    auto_sync._ACTIVE_BACKGROUND_THREADS.pop(PID, None)
    auto_sync._SYNC_PROGRESS.pop(PID, None)


def _conn(db, id_, label, hours_ago=None, mapping=MAPPING, active=True):
    last = NOW - timedelta(hours=hours_ago) if hours_ago is not None else None
    db.add(BankConnection(id=id_, label=label, backend="woob", is_active=active, account_mapping=mapping, last_sync_at=last))
    db.commit()


def _labels(db):
    return sorted(c.label for c in auto_sync.due_connections(db))


def test_due_rule(db):
    _conn(db, 1, "jamais relevée")
    _conn(db, 2, "récente", hours_ago=1)
    _conn(db, 3, "ancienne", hours_ago=30)
    _conn(db, 4, "sans comptes associés", mapping="{}")
    _conn(db, 5, "inactive", hours_ago=30, active=False)
    assert _labels(db) == ["ancienne", "jamais relevée"]


def test_due_rule_follows_the_chosen_interval(db):
    _conn(db, 1, "banque", hours_ago=7)
    assert _labels(db) == []
    db.add(GlobalConfig(key="bank_auto_sync_interval_hours", value="6"))
    db.commit()
    assert _labels(db) == ["banque"]


def test_failed_attempt_is_not_retried_before_the_interval(db, monkeypatch):
    def boom(**kwargs):
        raise RuntimeError("banque indisponible")
    monkeypatch.setattr(BankSyncService, "fetch_preview_transactions", boom)
    _conn(db, 1, "banque")
    assert _labels(db) == ["banque"]

    auto_sync.execute_auto_sync_for_connection(db, db.get(BankConnection, 1), "pw", profile_id=PID)

    assert db.get(BankConnection, 1).last_sync_status == "auto_error"
    assert _labels(db) == []


def test_nothing_due_means_no_statement_even_right_after_the_old_three_hours(db, run):
    """Déverrouiller 4 h après le dernier relevé en relançait un : plus maintenant."""
    _conn(db, 1, "banque", hours_ago=4)
    res, synced = run(source="vault_unlock")
    assert res["nothing_due"] is True and res["cooldown_active"] is False
    assert synced == []
    # Rien n'est parti : le filet n'est pas armé
    assert db.query(GlobalConfig).filter(GlobalConfig.key == "last_auto_sync_attempt").first() is None


def test_automatic_statement_only_touches_what_is_due(db, run):
    _conn(db, 1, "récente", hours_ago=1)
    _conn(db, 2, "ancienne", hours_ago=30)
    _conn(db, 3, "jamais relevée")
    res, synced = run()
    assert not res.get("nothing_due")
    assert sorted(synced) == ["ancienne", "jamais relevée"]


def test_explicit_request_always_reads_every_connection(db, run):
    _conn(db, 1, "récente", hours_ago=1)
    _conn(db, 2, "autre récente", hours_ago=1)
    db.add(GlobalConfig(key="last_auto_sync_attempt", value=NOW.isoformat()))
    db.commit()
    res, synced = run(force=True, source="manual")
    assert not res.get("nothing_due")
    assert sorted(synced) == ["autre récente", "récente"]


def test_safety_floor_stops_a_loop_of_automatic_attempts(db, run):
    """Si la date du relevé n'a pas pu être enregistrée, pas de reconnexion à la banque chaque minute."""
    _conn(db, 1, "banque")
    run()
    res, synced = run()
    assert synced == ["banque"]
    assert res["nothing_due"] is True and res["cooldown_active"] is True


def test_scheduler_goes_through_the_same_lock_as_the_button(db, engine, monkeypatch):
    """Un relevé lancé par le bouton est en cours : le planificateur n'ouvre pas une seconde connexion."""
    monkeypatch.setenv("OMNIBANK_ENABLE_TEST_BACKGROUND_SYNC", "1")
    monkeypatch.setattr("app.database.get_engine", lambda pid: engine)
    monkeypatch.setattr(scheduler.VaultSessionManager, "get_password", lambda *a, **k: "pw")

    class Running:
        calls = 0

        def is_alive(self):
            Running.calls += 1
            return Running.calls == 1  # encore en cours pour le verrou, terminé pour l'attente
    db.add(GlobalConfig(key="bank_auto_sync_enabled", value="true"))
    _conn(db, 1, "banque")
    monkeypatch.setitem(auto_sync._ACTIVE_BACKGROUND_THREADS, PID, Running())
    started = []
    monkeypatch.setattr(auto_sync.threading.Thread, "start", lambda self: started.append(self))

    asyncio.run(scheduler._run_scheduled_statement(db, PID))

    assert started == []


def test_budget_analysis_runs_whatever_the_statement_does(db, engine, monkeypatch):
    """Le bug d'origine : le délai anti-spam sautait aussi l'analyse budgétaire du profil."""
    monkeypatch.setattr("app.database.get_engine", lambda pid: engine)
    monkeypatch.setattr(scheduler.VaultSessionManager, "get_password", lambda *a, **k: None)
    db.add(GlobalConfig(key="bank_auto_sync_enabled", value="true"))
    db.add(GlobalConfig(key="last_auto_sync_attempt", value=NOW.isoformat()))
    db.commit()
    analysed = []
    monkeypatch.setattr("app.services.budget_service.run_background_analysis", lambda session, pid: analysed.append(pid))

    asyncio.run(scheduler._run_profile_cycle(PID))

    assert analysed == [PID]
