"""La prédiction de paie lit le jour de paie du profil de la base interrogée, pas celui de l'interface :
les tâches de fond (alertes d'enveloppes…) parcourent tous les profils."""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

from app import database, profile_manager
from app.models import Base
from app.services.finance_engine import predict_next_paycheck


def _db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    return engine, sessionmaker(bind=engine)()


@pytest.fixture
def two_profiles(monkeypatch):
    engine_b, db_b = _db()
    monkeypatch.setitem(database._engines, "p_background", engine_b)
    monkeypatch.setattr(profile_manager, "load_profiles_data", lambda: {"profiles": [
        {"id": "default", "pay_cycle_day": 28}, {"id": "p_background", "pay_cycle_day": 10}]})
    monkeypatch.setattr(profile_manager, "get_active_profile", lambda: {"id": "default", "pay_cycle_day": 28})
    yield db_b
    db_b.close()


def test_session_of_another_profile_uses_that_profiles_pay_day(two_profiles):
    assert database.profile_id_for_session(two_profiles) == "p_background"
    assert predict_next_paycheck(two_profiles)["date"].day == 10


def test_session_without_profile_keeps_the_active_profile(two_profiles):
    _, db = _db()
    assert database.profile_id_for_session(db) is None
    assert predict_next_paycheck(db)["date"].day == 28
