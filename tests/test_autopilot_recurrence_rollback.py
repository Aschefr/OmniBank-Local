"""
Annuler une récurrence créée par l'Auto-Pilote : ses prévisions partent avec elle, au lieu de rester dans le
prévisionnel en opérations « mensuelles » sans récurrence (le formulaire proposait alors « Modifier la récurrence »,
qui répondait « Récurrence introuvable »). Annuler dans l'en-tête la remet, avec ses prévisions.
"""
import json
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, AutopilotDecisionLog, Base, RecurrenceTemplate, Transaction
from app.routers.recurrences import generate_recurrences
from app.services import stats_cache
from app.services.autopilot_service import rollback_autopilot_cycle, rollback_autopilot_decision
from app.services.bank_sync.pending_store import clear_all_pending_sync
from app.services.history_service import last_undoable, undo_entry

TODAY = date.today()
PAID = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=15)  # le 15 du mois dernier, déjà payé


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add(Account(id=1, name="Courant", type="Compte courant", initial_balance=1000.0))
    session.commit()
    yield session
    clear_all_pending_sync(session)
    session.close()


def _promoted(db, batch="b1"):
    """Récurrence du premier mois, comme après un premier relevé : la ligne payée de la banque est reprise et
    la récurrence génère ses prévisions."""
    paid = Transaction(description="Contrat Prévoyance", raw_description="CONTRAT PREVOYANCE", amount=40.0,
                       type="expense_fixed", category="Assurances", date_operation=PAID, from_account_id=1,
                       reconciliation_date=PAID, csv_id="woob_bank_0001_paid")
    db.add(paid)
    db.flush()
    tpl = RecurrenceTemplate(description="Contrat Prévoyance", amount=40.0, type="expense_fixed", category="Assurances",
                             frequency="Monthly", day_of_month=15, from_account_id=1, is_closed=False)
    db.add(tpl)
    db.flush()
    paid.recurrence_id = tpl.id
    d = AutopilotDecisionLog(batch_id=batch, decision_type="recurrence_promotion", action="AUTO_COMMIT",
                             entity_type="recurrence_template", entity_id=tpl.id, account_id=1, confidence_score=60.0,
                             raw_snapshot=json.dumps({"decision_reason": "first_month_fixed", "linked_transactions": [paid.id],
                                                      "template_id": tpl.id}), is_undone=False)
    db.add(d)
    db.commit()
    generate_recurrences(template_id=tpl.id, db=db)
    db.commit()
    return paid, tpl, d


def _forecasts(db):
    db.expire_all()
    return db.query(Transaction).filter(Transaction.reconciliation_date.is_(None), Transaction.csv_id.is_(None)).all()


def test_undoing_the_decision_removes_its_forecasts_and_keeps_the_bank_line(db):
    paid, tpl, d = _promoted(db)
    assert _forecasts(db), "la récurrence doit avoir généré des prévisions"

    rollback_autopilot_decision(db, d.id)
    db.commit()
    db.expire_all()

    assert db.query(RecurrenceTemplate).count() == 0
    assert _forecasts(db) == []
    kept = db.get(Transaction, paid.id)
    assert kept is not None and kept.recurrence_id is None and not kept.is_monthly


def test_header_undo_brings_the_recurrence_back_with_its_forecasts(db):
    paid, tpl, d = _promoted(db)
    before = sorted((t.date_operation, t.amount) for t in _forecasts(db))

    rollback_autopilot_decision(db, d.id)
    db.commit()
    ok, _ = undo_entry(db, last_undoable(db))
    assert ok
    db.commit()
    db.expire_all()

    assert db.get(RecurrenceTemplate, tpl.id) is not None
    assert db.get(Transaction, paid.id).recurrence_id == tpl.id
    assert sorted((t.date_operation, t.amount) for t in _forecasts(db)) == before
    assert db.get(AutopilotDecisionLog, d.id).is_undone is False


def test_announced_bank_line_stays_when_the_batch_is_undone(db):
    paid, tpl, d = _promoted(db)
    # Ligne « à venir » de la banque reprise par la récurrence : elle n'est pas une prévision générée
    announced = Transaction(description="Contrat Prévoyance", raw_description="CONTRAT PREVOYANCE", amount=40.0,
                            type="expense_fixed", category="Assurances", date_operation=TODAY + timedelta(days=3),
                            from_account_id=1, csv_id="woob_coming_bank_0001", recurrence_id=tpl.id)
    db.add(announced)
    db.commit()

    rollback_autopilot_cycle(db, "b1")
    db.commit()
    db.expire_all()

    assert db.query(RecurrenceTemplate).count() == 0
    assert _forecasts(db) == []
    still = db.get(Transaction, announced.id)
    assert still is not None and still.recurrence_id is None
