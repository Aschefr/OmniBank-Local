"""
Points de restauration de l'Auto-Pilote : une copie de la base avant chaque lot, avec ses lignes. Restaurer remet les
données du moment, garde les réglages et les connexions bancaires d'aujourd'hui, et peut s'annuler.
"""
import json
import os
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Account, Base, BankConnection, GlobalConfig, Transaction
from app.services import restore_points as rp
from app.services import stats_cache
from app.services.autopilot_service import process_incoming_batch

PID = "p_test"


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(rp, "DATA_DIR", str(tmp_path / "data"))
    db_path = str(tmp_path / "omnibank.db")
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = factory()
    stats_cache.invalidate()
    db.add_all([
        Account(id=1, name="Courant", type="Compte courant", initial_balance=1000.0),
        BankConnection(id=1, backend="fake", label="Banque", account_mapping=json.dumps({"0001": 1})),
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="pay_day", value="28"),
    ])
    db.commit()
    yield db, db_path, engine, factory
    db.close()
    engine.dispose()


def _preview(amount=-12.5, label="X1234 BOULANGERIE DU PONT"):
    return {"accounts": [{"account_id": 1, "bank_balance": 1000.0 + amount, "transactions": [
        {"csv_id": "woob_fake_0001_a", "date_operation": date.today().isoformat(), "raw_amount": amount,
         "amount": abs(amount), "description": label, "raw_description": label},
    ]}]}


def test_a_batch_leaves_a_restore_point_with_its_lines(env):
    db, _path, _engine, _factory = env
    summary = process_incoming_batch(db, 1, _preview(), profile_id=PID)
    points = rp.list_points(PID)
    assert len(points) == 1
    assert points[0]["batch_id"] == summary["batch_id"]
    assert points[0]["line_count"] == 1 and points[0]["has_lines"] is True
    assert "preview_data" not in points[0]
    assert rp.list_points(PID, with_preview=True)[0]["preview_data"] == _preview()


def test_restore_brings_data_back_but_keeps_todays_settings_and_bank_connections(env):
    db, path, engine, factory = env
    point_id = rp.create_point(path, PID, "batch", batch_id="b1", conn_id=1, preview_data=_preview())
    # Après le point : une opération, un réglage changé, une nouvelle connexion bancaire
    db.add(Transaction(description="Après le point", amount=40.0, type="expense_var", date_operation=date.today(),
                       from_account_id=1))
    db.query(GlobalConfig).filter(GlobalConfig.key == "pay_day").update({"value": "5"})
    db.add(BankConnection(id=2, backend="fake2", label="Autre banque", account_mapping="{}"))
    db.commit()
    db.close()
    engine.dispose()

    result = rp.restore_point(path, PID, point_id)

    after = factory()
    try:
        assert after.query(Transaction).filter(Transaction.description == "Après le point").count() == 0
        assert after.query(GlobalConfig).filter(GlobalConfig.key == "pay_day").one().value == "5"
        assert {c.id for c in after.query(BankConnection).all()} == {1, 2}
    finally:
        after.close()
    engine.dispose()
    assert result["point"]["preview_data"] == _preview()

    # Le point pris avant la restauration la défait
    rp.restore_point(path, PID, result["undo_point_id"])
    back = factory()
    try:
        assert back.query(Transaction).filter(Transaction.description == "Après le point").count() == 1
    finally:
        back.close()


def test_points_older_than_fourteen_days_are_removed(env):
    _db, path, _engine, _factory = env
    point_id = rp.create_point(path, PID, "batch", batch_id="old")
    rp.prune(PID, now=datetime.now() + timedelta(days=rp.RETENTION_DAYS + 1))
    assert rp.list_points(PID) == []
    assert not os.path.exists(os.path.join(rp.points_dir(PID), point_id + ".db"))


def test_unknown_or_malformed_point_is_refused(env):
    _db, path, _engine, _factory = env
    for point_id in ("rp_20260101_000000_000000", "../omnibank", "rp_x"):
        with pytest.raises(ValueError):
            rp.restore_point(path, PID, point_id)
