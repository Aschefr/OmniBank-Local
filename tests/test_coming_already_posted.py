"""
Paiement carte listé à la fois débité et « à venir » dans le même relevé : une seule opération.
"""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, BankConnection, GlobalConfig, Transaction
from app.services import stats_cache
from app.services.autopilot_service import process_incoming_batch
from app.services.bank_sync import sync_service
from app.services.bank_sync.pending_store import clear_all_pending_sync
from app.services.credential_vault import CredentialVault

REMOTE_ID = "0001"
TODAY = date.today()
YESTERDAY = TODAY - timedelta(days=1)
GRILL = "X1234 GRILL DU MARCHE VILLEF"
BAKERY = "X1234 BOULANGERIE DU PONT"


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add_all([
        Account(id=1, name="Courant", type="Compte courant", initial_balance=1000.0),
        BankConnection(id=1, backend="fake", label="Banque", account_mapping=json.dumps({REMOTE_ID: 1})),
        GlobalConfig(key="auto_pilot_enabled", value="true"),
    ])
    session.commit()
    clear_all_pending_sync(session)
    yield session
    clear_all_pending_sync(session)
    session.close()


class _Obj:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _FakeBackend:
    config = {}

    def __init__(self, history, coming, balance):
        self.history, self.coming, self.balance = history, coming, balance

    def iter_accounts(self):
        return [_Obj(id=REMOTE_ID, label="Courant", balance=self.balance)]

    def iter_history(self, account):
        for day, amount, label in sorted(self.history, key=lambda line: line[0], reverse=True):
            yield _Obj(date=day, amount=amount, label=label)

    def iter_coming(self, account):
        return [_Obj(date=day, amount=amount, label=label) for day, amount, label in self.coming]


@pytest.fixture
def statement(db, monkeypatch):
    def run(history, coming):
        balance = 1000.0 + sum(amount for _, amount, _ in history)
        backend = _FakeBackend(history, coming, balance)
        monkeypatch.setattr(sync_service, "_get_woob", lambda: _Obj(load_backend=lambda *a, **k: backend))
        monkeypatch.setattr(sync_service, "_get_woob_storage", lambda: None)
        monkeypatch.setattr(sync_service, "_apply_hotfixes", lambda *a, **k: None)
        monkeypatch.setattr(sync_service, "_safe_unload_backend", lambda *a, **k: None)
        monkeypatch.setattr(CredentialVault, "has_credentials", staticmethod(lambda db, cid: True))
        monkeypatch.setattr(CredentialVault, "retrieve_credentials", staticmethod(lambda db, cid, pw: {"login": "x"}))
        connection = db.query(BankConnection).first()
        preview = sync_service.BankSyncService.fetch_preview_transactions(
            db=db, connection=connection, master_password="x", defer_ai=True, since_days=30
        )
        process_incoming_batch(db, connection.id, preview, profile_id="default")
        return db.query(Transaction).order_by(Transaction.date_operation, Transaction.id).all()
    return run


def test_coming_line_already_posted_in_the_same_statement_is_dropped(statement):
    txs = statement(history=[(TODAY, -108.36, GRILL)], coming=[(YESTERDAY, -108.36, GRILL)])
    assert len(txs) == 1
    assert txs[0].date_operation == TODAY
    assert txs[0].reconciliation_date is not None


def test_each_posted_line_cancels_one_coming_line_only(statement):
    two_days_ago = TODAY - timedelta(days=2)
    txs = statement(history=[(TODAY, -6.0, BAKERY)], coming=[(two_days_ago, -6.0, BAKERY), (YESTERDAY, -6.0, BAKERY)])
    assert len(txs) == 2
    # Le débit annule l'achat le plus proche ; l'autre reste à venir
    assert [(t.date_operation, t.reconciliation_date is not None) for t in txs] == [(two_days_ago, False), (TODAY, True)]


@pytest.mark.parametrize("coming", [
    (TODAY, -12.0, GRILL),                          # autre montant
    (YESTERDAY, -108.36, BAKERY),                   # autre commerçant
    (TODAY - timedelta(days=9), -108.36, GRILL),    # trop ancien pour être ce débit
])
def test_other_coming_lines_are_kept(statement, coming):
    txs = statement(history=[(TODAY, -108.36, GRILL)], coming=[coming])
    assert len(txs) == 2


def test_purchase_after_the_posted_one_stays_coming(statement):
    txs = statement(history=[(YESTERDAY, -6.0, BAKERY)], coming=[(TODAY, -6.0, BAKERY)])
    assert len(txs) == 2
