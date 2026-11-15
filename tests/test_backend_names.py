"""
Deux profils clients de la même banque ont chacun leur connexion n° 1 : leurs sessions woob ne se mélangent pas.
Les sessions enregistrées sous l'ancien nom (sans profil) ne sont reprises que si leur profil est certain.
Valeurs inventées.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.database as database
import app.profile_manager as profile_manager
from app.database import Base
from app.models import BankConnection
from app.services.bank_sync import backend_names
from app.services.bank_sync.backend_names import backend_instance_name, migrate_legacy_backend_states
from app.services.bank_sync.sync_service import _connection_instance_name


class _Config:
    def __init__(self, backends):
        self.values = {"backends": backends}
        self.saved = 0

    def save(self):
        self.saved += 1


class _Storage:
    def __init__(self, backends):
        self.config = _Config(backends)


def _profile_engines(monkeypatch, connections_by_profile):
    engines = {}
    for pid, conns in connections_by_profile.items():
        eng = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(bind=eng)
        db = sessionmaker(bind=eng)()
        db.add_all([BankConnection(id=cid, backend=backend, label="Banque") for cid, backend in conns])
        db.commit()
        db.close()
        engines[pid] = eng
    monkeypatch.setattr(profile_manager, "load_profiles_data",
                        lambda: {"profiles": [{"id": pid} for pid in connections_by_profile]})
    monkeypatch.setattr(database, "get_engine", lambda pid=None: engines[pid])
    monkeypatch.setattr(database, "_engines", engines)
    return engines


def test_same_connection_number_in_two_profiles_gets_two_names(monkeypatch):
    engines = _profile_engines(monkeypatch, {"p_aaaa1111": [(1, "boursorama")], "p_bbbb2222": [(1, "boursorama")]})
    names = set()
    for pid, eng in engines.items():
        db = sessionmaker(bind=eng)()
        names.add(_connection_instance_name(db, db.query(BankConnection).one()))
        db.close()
    assert names == {"p_aaaa1111_conn_1_boursorama", "p_bbbb2222_conn_1_boursorama"}


def test_legacy_session_follows_its_only_profile(monkeypatch):
    _profile_engines(monkeypatch, {"p_aaaa1111": [(1, "boursorama")], "p_bbbb2222": [(2, "cragr")]})
    storage = _Storage({"conn_1_boursorama": {"browser_state": "A"}, "test_cragr_x": {"k": 1}})
    migrate_legacy_backend_states(storage)
    assert storage.config.values["backends"] == {
        backend_instance_name("p_aaaa1111", 1, "boursorama"): {"browser_state": "A"},
        "test_cragr_x": {"k": 1},
    }
    assert storage.config.saved == 1


def test_legacy_session_of_two_possible_profiles_is_forgotten(monkeypatch):
    _profile_engines(monkeypatch, {"p_aaaa1111": [(1, "boursorama")], "p_bbbb2222": [(1, "boursorama")]})
    storage = _Storage({"conn_1_boursorama": {"browser_state": "A"}, "conn_9_cragr": {"browser_state": "old"}})
    migrate_legacy_backend_states(storage)
    assert storage.config.values["backends"] == {}


def test_unreadable_profile_database_changes_nothing(monkeypatch):
    monkeypatch.setattr(backend_names, "_connection_owners", lambda: None)
    storage = _Storage({"conn_1_boursorama": {"browser_state": "A"}})
    migrate_legacy_backend_states(storage)
    assert storage.config.values["backends"] == {"conn_1_boursorama": {"browser_state": "A"}}
    assert storage.config.saved == 0


def test_nothing_to_migrate_does_not_rewrite_the_file():
    storage = _Storage({"p_aaaa1111_conn_1_boursorama": {"browser_state": "A"}})
    migrate_legacy_backend_states(storage)
    assert storage.config.saved == 0
