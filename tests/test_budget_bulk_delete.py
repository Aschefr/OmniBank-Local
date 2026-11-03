"""Suppression groupée d'enveloppes : seules celles choisies partent, en une seule action d'historique, et
Annuler restaure tout (catégories, dépôts, suggestions en attente)."""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import ActionHistory, AutopilotDecisionLog, Base, Budget, BudgetAllocation, BudgetCategory, Transaction
from app.services import budget_service as bs
from app.services import history_service as hs


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _envelope(db, name, cats=(), **kw):
    b = Budget(name=name, monthly_amount=100.0, period=kw.pop("period", "monthly"),
               envelope_type=kw.pop("envelope_type", "spending"), **kw)
    db.add(b)
    db.flush()
    db.add_all([BudgetCategory(budget_id=b.id, category_name=c) for c in cats])
    db.commit()
    return b.id


def _state(db):
    return {
        b.name: (sorted(c.category_name for c in db.query(BudgetCategory).filter(BudgetCategory.budget_id == b.id)),
                 sorted(a.amount for a in db.query(BudgetAllocation).filter(BudgetAllocation.budget_id == b.id)))
        for b in db.query(Budget).all()
    }


def _setup(db):
    food = _envelope(db, "Courses", ["Alimentation", "Boulangerie"])
    keep = _envelope(db, "Loisirs", ["Cinéma"])
    pot = _envelope(db, "Vacances", envelope_type="savings", period="indefinite")
    db.add_all([BudgetAllocation(budget_id=pot, amount=150.0, date=date(2026, 10, 5)),
                BudgetAllocation(budget_id=pot, amount=-40.0, date=date(2026, 10, 20), note="Cadeau")])
    db.add(AutopilotDecisionLog(batch_id="b", decision_type="budget_suggestion", action="SUGGESTED", entity_type="budget",
                                entity_id=food, confidence_score=1.0))
    db.commit()
    return food, keep, pot


def test_only_the_chosen_envelopes_are_deleted_in_one_history_action(db):
    food, keep, pot = _setup(db)
    res = bs.bulk_delete_budgets(db, [food, pot])
    assert res["deleted_count"] == 2
    assert [b.id for b in db.query(Budget).all()] == [keep]
    assert db.query(BudgetAllocation).count() == 0
    assert db.query(ActionHistory).filter(ActionHistory.entity_type == "budget_bulk").count() == 1
    assert db.query(AutopilotDecisionLog).one().action == "DISMISSED"


def test_undo_restores_everything_and_redo_deletes_again(db):
    food, keep, pot = _setup(db)
    before = _state(db)
    res = bs.bulk_delete_budgets(db, [food, pot])
    action = db.query(ActionHistory).get(res["action_id"])
    assert hs.check_undo_safety(db, action)["safe"] is True

    assert hs.undo_action(db, action)[0] is True
    db.commit()
    assert _state(db) == before
    assert {b.id for b in db.query(Budget).all()} == {food, keep, pot}
    assert db.query(AutopilotDecisionLog).one().action == "SUGGESTED"

    assert hs.redo_action(db, action)[0] is True
    db.commit()
    assert list(_state(db)) == ["Loisirs"]
    assert db.query(BudgetCategory).filter(BudgetCategory.budget_id == food).count() == 0


def test_undo_keeps_linked_transactions_attached(db):
    food, keep, pot = _setup(db)
    project = _envelope(db, "Rénovation", is_project=True)
    db.add(Transaction(date_operation=date(2026, 10, 1), description="Peinture", amount=-50.0, type="expense_var", budget_id=project))
    db.commit()
    res = bs.bulk_delete_budgets(db, [project])
    assert db.query(Transaction).count() == 1
    hs.undo_action(db, db.query(ActionHistory).get(res["action_id"]))
    db.commit()
    assert db.query(Transaction).one().budget_id == db.query(Budget).filter(Budget.name == "Rénovation").one().id


def test_undo_when_an_id_was_reused_gives_the_envelope_a_new_one(db):
    food, keep, pot = _setup(db)
    res = bs.bulk_delete_budgets(db, [pot])
    db.add(Budget(id=pot, name="Nouvelle", monthly_amount=10.0, period="monthly", envelope_type="spending"))
    db.commit()
    action = db.query(ActionHistory).get(res["action_id"])
    assert hs.undo_action(db, action)[0] is True
    db.commit()
    assert _state(db)["Vacances"][1] == [-40.0, 150.0]
    assert db.query(Budget).filter(Budget.id == pot).one().name == "Nouvelle"
    # Rétablir vise bien l'enveloppe restaurée, pas celle qui a repris son ancien id
    hs.redo_action(db, action)
    db.commit()
    assert "Nouvelle" in _state(db) and "Vacances" not in _state(db)


def test_undoing_a_single_deletion_brings_savings_deposits_back(db):
    food, keep, pot = _setup(db)
    res = bs.delete_single_budget(pot, db)
    assert db.query(BudgetAllocation).count() == 0
    action = db.query(ActionHistory).get(res["action_id"])
    hs.undo_action(db, action)
    db.commit()
    assert _state(db)["Vacances"][1] == [-40.0, 150.0]
    hs.redo_action(db, action)
    db.commit()
    assert db.query(BudgetAllocation).count() == 0


def test_nothing_selected_deletes_nothing(db):
    _setup(db)
    assert bs.bulk_delete_budgets(db, [])["deleted_count"] == 0
    assert db.query(Budget).count() == 3
