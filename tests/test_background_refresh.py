"""Les pages ouvertes se rechargent sur des marqueurs du statut Auto-Pilote : ces marqueurs doivent
sortir réellement de l'API et ne bouger que sur un vrai changement."""
from datetime import date

import pytest
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, Budget, GlobalConfig, Transaction
from app.schemas.api_schemas import AutopilotStatusOut
from app.services import budget_service as bs
from app.services.autopilot_service import get_autopilot_status

TODAY = date.today()
MONTHS = [TODAY.replace(day=1) - relativedelta(months=k) for k in range(3)]


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    s.add(Account(id=1, name="Courant"))
    s.commit()
    yield s
    s.close()


def _spend(db, cat):
    for m in MONTHS:
        when = min(m.replace(day=5), TODAY)
        db.add(Transaction(date_operation=when, date_saisie=when, description=f"{cat} {when}", amount=40.0,
                           type="expense_var", category=cat, from_account_id=1))
    db.commit()


def _marker(db):
    row = db.query(GlobalConfig).filter(GlobalConfig.key == bs.BACKGROUND_CHANGED_AT_KEY).first()
    return row.value if row else None


def test_status_really_exposes_its_markers(db):
    """Le modèle de réponse filtre ce qu'il ne déclare pas : passer par lui, comme l'API."""
    db.add(GlobalConfig(key="bank_labels_refined_at", value="2026-11-03T10:00:00+00:00"))
    db.add(GlobalConfig(key=bs.BACKGROUND_CHANGED_AT_KEY, value="2026-11-03T11:00:00+00:00"))
    db.commit()

    out = AutopilotStatusOut(**get_autopilot_status(db, profile_id="default")).model_dump()

    assert out["labels_refined_at"] == "2026-11-03T10:00:00+00:00"
    assert out["background_changed_at"] == "2026-11-03T11:00:00+00:00"


def test_quiet_cycle_leaves_the_marker_alone(db):
    assert bs.run_background_analysis(db) is False
    assert _marker(db) is None


def test_new_proposal_moves_the_marker_once(db):
    _spend(db, "Bricolage")

    assert bs.run_background_analysis(db) is True
    first = _marker(db)
    assert first

    # La proposition reste en attente : pas de rechargement à chaque minute
    assert bs.run_background_analysis(db) is False
    assert _marker(db) == first


def test_auto_creation_of_a_pending_proposal_moves_the_marker(db):
    _spend(db, "Bricolage")
    bs.run_background_analysis(db)
    first = _marker(db)

    db.add(GlobalConfig(key="auto_create_budget_envelopes", value="true"))
    db.commit()

    assert bs.run_background_analysis(db) is True
    assert db.query(Budget).count() == 1
    assert _marker(db) != first
    assert bs.run_background_analysis(db) is False
