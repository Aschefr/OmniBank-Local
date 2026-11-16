"""Un virement vers son livret ne prend plus le nom d'un abonnement (« iCloud Camille » pour « WEB MARTIN CAMILLE »).

Trois défauts se cumulaient : un prénom commun suffisait à rapprocher deux libellés, l'historique prêtait un nom vu
pour 0,99 € à une opération de 250 €, et la liaison du virement gardait ce nom venu de l'historique."""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Category, Transaction
from app.services import stats_cache
from app.services.autopilot_service import process_incoming_batch, set_autopilot_enabled
from app.services.smart_label.matcher import _compute_match_score
from app.services.smart_label.resolver import resolve_smart_labels_batch


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    yield s
    s.close()


def test_a_first_name_alone_does_not_make_the_same_merchant():
    assert _compute_match_score("WEB MARTIN CAMILLE", "iCloud Camille") < 0.75
    # Un mot commun en tête d'un des deux libellés reste un même commerçant
    assert _compute_match_score("CTM RHONE ALP", "GARAGE CTM") >= 0.75


def _history(db, description, amount, days_ago=20):
    db.add(Category(name="Abonnements", type="expense_var"))
    db.add(Transaction(description=description, raw_description=description.upper(), amount=amount,
                       type="expense_var", category="Abonnements", from_account_id=1,
                       date_operation=date.today() - timedelta(days=days_ago), date_saisie=date.today()))
    db.commit()


@pytest.mark.parametrize("amount, borrowed", [(13.49, True), (250.0, False)])
def test_history_lends_a_name_only_for_an_amount_of_the_same_order(db, amount, borrowed):
    _history(db, "Netflix", 13.49)
    res = resolve_smart_labels_batch(db, ["NETFLIX COM"], tx_types={"NETFLIX COM": "expense_var"},
                                     amounts={"NETFLIX COM": amount})["NETFLIX COM"]
    assert (res.get("source") == "history" and res.get("description") == "Netflix") is borrowed


def _line(acc, raw_amount, label, n, **smart):
    return {"date_operation": (date.today() - timedelta(days=2)).isoformat(), "amount": abs(raw_amount),
            "raw_amount": raw_amount, "raw_description": label, "csv_id": f"woob_test_{n}",
            "account_id": acc.id, "account_name": acc.name, "is_reconciled": False, "already_reconciled": False,
            "matched_db_id": None, "smart_suggested": True, **smart}


@pytest.mark.parametrize("source, name, expected", [
    ("history", "iCloud Camille", "Compte courant → Livret A"),
    ("rule", "Épargne du mois", "Épargne du mois"),
])
def test_a_paired_transfer_keeps_only_a_name_from_a_rule(db, source, name, expected):
    set_autopilot_enabled(db, True, preset="full")
    cc = Account(name="Compte courant", type="Compte courant", initial_balance=0)
    livret = Account(name="Livret A", type="Livret", initial_balance=0)
    db.add_all([cc, livret, Category(name="Abonnements", type="expense_var")])
    db.commit()
    preview = {"connection_id": 1, "accounts": [
        {"account_id": cc.id, "account_name": cc.name, "transactions": [
            _line(cc, -250.0, "WEB MARTIN CAMILLE", 1, description=name, category="Abonnements",
                  smart_source=source, smart_confidence=0.82)]},
        {"account_id": livret.id, "account_name": livret.name, "transactions": [
            _line(livret, 250.0, "DE MME MARTIN CAMILLE", 2, description="De Mme Martin Camille",
                  category="Revenus divers", smart_source="keyword", smart_confidence=0.9)]},
    ]}

    process_incoming_batch(db, conn_id=1, preview_data=preview)

    transfer = db.query(Transaction).filter(Transaction.type == "transfer").one()
    assert transfer.description == expected
    assert transfer.category == "Virement interne"
