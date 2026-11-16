"""
Échéances récurrentes jamais prélevées et reste à vivre.

- Délai de saut écoulé (1 période + 3 jours) : l'échéance n'est plus déduite du reste à vivre.
- En retard mais délai pas encore écoulé : elle reste déduite.
- Le saut automatique n'est retenu que par une opération du sas qui peut être le prélèvement :
  rattachée à cette échéance, ou non rattachée avec un montant compatible.
"""

from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models import Account, Transaction, RecurrenceTemplate, GlobalConfig, BankConnection
from app.services.bank_sync.pending_store import save_pending_sync_data, clear_all_pending_sync
from app.services.finance_engine import calculate_rest_to_live, overdue_echeances
from app.services.recurrence_detector import process_auto_skipping
from app.services import stats_cache

TODAY = date(2026, 11, 16)
NEXT_PAY = date(2026, 11, 28)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add_all([
        GlobalConfig(key="auto_link_deviant_recurrences", value="true"),
        GlobalConfig(key="auto_skip_unreconciled_recurrences", value="true"),
        GlobalConfig(key="auto_close_unreconciled_recurrences", value="false"),
    ])
    session.commit()
    clear_all_pending_sync(session)
    yield session
    clear_all_pending_sync(session)
    session.close()


@pytest.fixture
def setup(db):
    """Compte à 1000 € pointés, cotisation mensuelle de 16 € jamais prélevée en octobre et novembre."""
    acc = Account(name="Compte Courant", initial_balance=0.0)
    db.add(acc)
    db.commit()
    db.add(Transaction(to_account_id=acc.id, date_operation=date(2026, 10, 1), amount=1000.0, type="income",
                       category="Salaire", description="Salaire", reconciliation_date=date(2026, 10, 1)))
    tpl = RecurrenceTemplate(description="Cotisation compte", amount=16.0, type="expense", category="Frais",
                             frequency="Monthly", day_of_month=4, from_account_id=acc.id)
    db.add(tpl)
    db.commit()
    rows = {}
    for key, d in (("oct", date(2026, 10, 4)), ("nov", date(2026, 11, 4)), ("dec", date(2026, 12, 4))):
        tx = Transaction(from_account_id=acc.id, date_operation=d, amount=16.0, type="expense", category="Frais",
                         description="Cotisation compte", recurrence_id=tpl.id, is_skipped=False)
        db.add(tx)
        rows[key] = tx
    other = Transaction(from_account_id=acc.id, date_operation=date(2026, 11, 15), amount=110.37, type="expense",
                        category="Prêt", description="Échéance prêt")
    db.add(other)
    db.commit()
    rows["other"] = other
    return acc, rows


def _queue(db, acc, ops):
    conn = BankConnection(backend="cragr", label="Banque test")
    db.add(conn)
    db.commit()
    save_pending_sync_data(db=db, conn_id=conn.id, preview_data={
        "accounts": [{"account_id": acc.id, "bank_balance": 1000.0, "transactions": ops}]
    })


def test_skip_pending_echeance_no_longer_deducted(db, setup):
    acc, rows = setup
    ready, late = overdue_echeances(db, acc.id, TODAY, NEXT_PAY)
    assert [t.id for t in ready] == [rows["oct"].id]
    assert [t.id for t in late] == [rows["nov"].id]
    # 1000 − 16 (novembre, en retard) − 110,37 (prêt prévu) ; octobre n'est plus déduit
    assert calculate_rest_to_live(db, TODAY, NEXT_PAY) == pytest.approx(1000 - 16 - 110.37)


def test_without_auto_skip_everything_stays_deducted(db, setup):
    acc, rows = setup
    db.query(GlobalConfig).filter(GlobalConfig.key == "auto_skip_unreconciled_recurrences").update({"value": "false"})
    db.commit()
    ready, late = overdue_echeances(db, acc.id, TODAY, NEXT_PAY)
    assert ready == []
    assert {t.id for t in late} == {rows["oct"].id, rows["nov"].id}
    assert calculate_rest_to_live(db, TODAY, NEXT_PAY) == pytest.approx(1000 - 32 - 110.37)


def test_queue_ops_for_other_forecasts_do_not_hold_the_skip(db, setup):
    acc, rows = setup
    _queue(db, acc, [
        {"csv_id": "q1", "date_operation": "2026-11-15", "raw_amount": -110.37, "amount": 110.37,
         "description": "ECHEANCE PRET", "matched_db_id": rows["other"].id},
        {"csv_id": "q2", "date_operation": "2026-11-14", "raw_amount": -3.0, "amount": 3.0,
         "description": "CB BOULANGERIE", "matched_db_id": None},
        {"csv_id": "q3", "date_operation": "2026-11-14", "raw_amount": 15.0, "amount": 15.0,
         "description": "REMBOURSEMENT", "matched_db_id": None},
    ])
    res = process_auto_skipping(db=db, account_id=acc.id, current_date=TODAY, bank_balance=1000.0)
    assert res["skipped_count"] == 1
    db.refresh(rows["oct"])
    db.refresh(rows["nov"])
    assert rows["oct"].is_skipped is True
    assert rows["nov"].is_skipped is False


@pytest.mark.parametrize("op", [
    {"matched_db_id": "OCT", "raw_amount": -16.0},   # rattachée à cette échéance
    {"matched_db_id": None, "raw_amount": -14.0},    # non rattachée, montant compatible
])
def test_queue_op_that_may_be_the_debit_holds_the_skip(db, setup, op):
    acc, rows = setup
    op = dict(op, csv_id="q1", date_operation="2026-11-14", amount=abs(op["raw_amount"]), description="PRLV CA")
    if op["matched_db_id"] == "OCT":
        op["matched_db_id"] = rows["oct"].id
    _queue(db, acc, [op])
    res = process_auto_skipping(db=db, account_id=acc.id, current_date=TODAY, bank_balance=1000.0)
    assert res["skipped_count"] == 0
    db.refresh(rows["oct"])
    assert rows["oct"].is_skipped is False
    # Retenue, elle reste déduite du reste à vivre
    assert calculate_rest_to_live(db, TODAY, NEXT_PAY) == pytest.approx(1000 - 32 - 110.37)


def test_echeance_announced_by_the_bank_is_not_late(db, setup):
    acc, rows = setup
    _queue(db, acc, [{"csv_id": "q1", "date_operation": "2026-11-17", "raw_amount": -16.0, "amount": 16.0,
                      "description": "PRLV CA", "matched_db_id": rows["nov"].id, "is_coming": True}])
    _ready, late = overdue_echeances(db, acc.id, TODAY, NEXT_PAY)
    assert late == []
    # Annoncée, elle reste déduite
    assert calculate_rest_to_live(db, TODAY, NEXT_PAY) == pytest.approx(1000 - 16 - 110.37)


def test_balance_mismatch_still_blocks(db, setup):
    acc, rows = setup
    res = process_auto_skipping(db=db, account_id=acc.id, current_date=TODAY, bank_balance=980.0)
    assert res["skipped_count"] == 0


def test_dashboard_reports_overdue_echeances(db, setup, monkeypatch):
    acc, rows = setup
    import app.routers.stats as stats_router
    import app.services.finance_engine as fe

    class _Today(date):
        @classmethod
        def today(cls):
            return TODAY

    monkeypatch.setattr(stats_router, "date", _Today)
    monkeypatch.setattr(fe, "predict_next_paycheck", lambda db: {"date": NEXT_PAY, "amount": 1000.0, "is_override": False})
    monkeypatch.setattr(stats_router, "predict_next_paycheck", lambda db: {"date": NEXT_PAY, "amount": 1000.0, "is_override": False})
    app.dependency_overrides[get_db] = lambda: db
    try:
        data = TestClient(app).get("/api/stats/dashboard").json()
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert data["skip_pending_echeances"] == {"total": 16.0, "count": 1, "ids": [rows["oct"].id]}
    assert data["late_echeances"] == {"total": 16.0, "count": 1}
    assert data["rest_to_live"] == pytest.approx(1000 - 16 - 110.37)
    # Le cadre « non pointé » suit le reste à vivre : octobre n'y est plus
    assert data["unreconciled_expenses"] == pytest.approx(16 + 110.37)
