"""Un nom de compte déjà pris répond 409 avec un message lisible, au lieu d'une erreur 500 (contrainte UNIQUE)."""
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.routers import accounts as accounts_router
from app.schemas.api_schemas import AccountBase


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()


def test_creating_a_second_account_with_the_same_name_is_refused_cleanly(db):
    accounts_router.create_account(AccountBase(name="LDD Solidaire", type="Livret", initial_balance=46.33), db=db)
    with pytest.raises(HTTPException) as e:
        accounts_router.create_account(AccountBase(name="LDD Solidaire", type="Livret", initial_balance=46.33), db=db)
    assert e.value.status_code == 409
    assert "LDD Solidaire" in e.value.detail


def test_renaming_onto_another_account_name_is_refused_but_keeping_its_own_name_is_fine(db):
    a = accounts_router.create_account(AccountBase(name="Livret A", type="Livret", initial_balance=0), db=db)
    b = accounts_router.create_account(AccountBase(name="Compte courant", type="Compte courant", initial_balance=0), db=db)
    accounts_router.update_account(a.id, AccountBase(name="Livret A", type="Livret", initial_balance=10), db=db)
    with pytest.raises(HTTPException) as e:
        accounts_router.update_account(b.id, AccountBase(name="Livret A", type="Compte courant", initial_balance=0), db=db)
    assert e.value.status_code == 409
