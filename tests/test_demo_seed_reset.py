"""Tests du jeu de démo enrichi et du reset sélectif (wizard d'accueil)."""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, AutopilotDecisionLog, Budget, Category, RecurrenceTemplate, Transaction
from app.services.demo_seed import is_demo_active, reset_demo, seed_demo


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    yield session
    session.close()


def test_seed_is_rich_and_idempotent(db):
    res = seed_demo(db)
    assert res["ok"] and res["accounts"] == 4
    assert is_demo_active(db)
    assert db.query(Transaction).count() >= 100
    assert db.query(Budget).count() >= 6
    assert db.query(RecurrenceTemplate).count() >= 12
    assert db.query(Category).count() >= 18
    assert db.query(AutopilotDecisionLog).count() > 0
    assert db.query(Transaction).filter(Transaction.needs_review.is_(True)).count() >= 1
    assert db.query(Transaction).filter(Transaction.amount < 0).count() == 0

    before = db.query(Transaction).count()
    assert seed_demo(db).get("already_seeded") is True
    assert db.query(Transaction).count() == before


def test_reset_demo_keeps_real_data(db):
    real = Account(name="Mon Compte Réel", type="Compte courant", initial_balance=10.0, currency="EUR")
    db.add(real)
    db.commit()
    real_id = real.id

    seed_demo(db)
    out = reset_demo(db)

    assert out["ok"] and not out["needs_setup"]
    assert [a.id for a in db.query(Account).all()] == [real_id]
    assert db.query(Transaction).count() == 0
    assert db.query(Budget).count() == 0
    assert not is_demo_active(db)


def test_reset_demo_needs_setup_when_only_demo(db):
    seed_demo(db)
    assert reset_demo(db)["needs_setup"] is True
