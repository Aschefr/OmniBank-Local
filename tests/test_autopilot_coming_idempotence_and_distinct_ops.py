"""
tests/test_autopilot_coming_idempotence_and_distinct_ops.py
Validation des corrections de l'Auto-Pilote et du Moteur de Rapprochement :
1. Distinction stricte entre une opération passée déjà pointée (ex: 11/09) et une nouvelle opération entrante (ex: 24/09).
2. Création de la nouvelle opération en base à l'état non-pointé (reconciliation_date=None) pour impacter le reste à vivre.
3. Idempotence des opérations à venir (is_coming=True) : aucun lot redondant ni doublon lors des synchronisations répétées.
4. Transition fluide vers l'état pointé (is_coming=False) lors de la confirmation définitive par la banque.
"""

from datetime import date, timedelta
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account,
    Transaction,
    Category,
    AutopilotDecisionLog,
    GlobalConfig,
)
from app.services.reconciliation_engine import check_reconciliation
from app.services.autopilot_service import process_incoming_batch
from app.services.bank_sync.pending_store import get_all_pending_sync, clear_all_pending_sync
from app.services import stats_cache


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = Session()
    stats_cache.invalidate()

    db.add_all([
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="auto_reconcile_transactions", value="true"),
        GlobalConfig(key="auto_commit_incoming_transactions", value="true"),
        GlobalConfig(key="auto_reconcile_threshold", value="85.0"),
    ])

    cat_ia = Category(name="IA", type="expense_var")
    cat_resto = Category(name="Restaurant", type="expense_var")
    cat_sub = Category(name="Abonnement", type="expense_fixed")
    db.add_all([cat_ia, cat_resto, cat_sub])
    db.commit()

    clear_all_pending_sync(db)
    yield db
    clear_all_pending_sync(db)
    db.close()


def test_distinct_past_reconciled_op_vs_new_coming_op(db_session):
    """
    Vérifie qu'une opération du 11/09 déjà pointée n'est PAS confondue avec une nouvelle
    opération de même montant arrivant en 'is_coming' le 24/09 (delta 13 jours).
    La nouvelle opération doit être créée en DB en état non pointé.
    """
    account = Account(name="CA Centre-Est", initial_balance=2000.0)
    db_session.add(account)
    db_session.commit()

    # 1. Opération passée du 11/09, déjà rapprochée
    tx_past = Transaction(
        date_saisie=date(2026, 9, 10),
        date_operation=date(2026, 9, 10),
        description="Google One Crédits IA",
        amount=25.99,
        type="expense_var",
        category="IA",
        reconciliation_date=date(2026, 9, 11),
        from_account_id=account.id,
        csv_id="woob_cragr_past_google_01"
    )
    db_session.add(tx_past)
    db_session.commit()

    # 2. Arrivée d'une nouvelle opération le 24/09 en 'is_coming'
    rec_info = check_reconciliation(
        db_session,
        tx_date=date(2026, 9, 24),
        tx_amount=-25.99,
        account_id=account.id,
        is_coming=True,
        bank_label="X1208 Google G1AI101M Dubl",
        csv_id="woob_coming_cragr_google_2409"
    )

    # Doit être None : l'ancienne opération du 11/09 ne doit pas être matchée
    assert rec_info is None or rec_info.get("already_reconciled") is False

    # 3. Traitement par l'Auto-Pilote du lot entrant
    preview_data = {
        "accounts": [
            {
                "account_id": account.id,
                "transactions": [
                    {
                        "date_operation": "2026-09-24",
                        "description": "Google One Crédits IA",
                        "raw_description": "X1208 Google G1AI101M Dubl",
                        "amount": 25.99,
                        "raw_amount": -25.99,
                        "category": "IA",
                        "smart_suggested": True,
                        "csv_id": "woob_coming_cragr_google_2409",
                        "is_coming": True,
                        "confidence": 0.95
                    }
                ]
            }
        ]
    }

    res = process_incoming_batch(db_session, conn_id=1, preview_data=preview_data)
    assert res["auto_committed"] == 1

    # 4. Vérifier que la nouvelle transaction a bien été créée en DB à l'état NON-POINTÉ
    all_txs = db_session.query(Transaction).filter(Transaction.from_account_id == account.id).all()
    assert len(all_txs) == 2

    new_tx = [t for t in all_txs if t.id != tx_past.id][0]
    assert new_tx.date_operation == date(2026, 9, 24)
    assert new_tx.amount == 25.99
    assert new_tx.category == "IA"
    assert new_tx.reconciliation_date is None  # Non pointé car is_coming
    assert new_tx.csv_id == "woob_coming_cragr_google_2409"

    # Vérifier que l'ancienne opération n'a pas été altérée
    db_session.refresh(tx_past)
    assert tx_past.reconciliation_date == date(2026, 9, 11)

    # 5. Vérifier que get_all_pending_sync ne génère pas de fausse discordance sur l'ancienne transaction
    pending = get_all_pending_sync(db_session)
    assert tx_past.id not in pending.get("discrepancies_by_tx_id", {})


def test_is_coming_sync_idempotence(db_session):
    """
    Vérifie qu'exécuter plusieurs synchronisations successives avec les mêmes opérations 'is_coming'
    est strictement idempotent (aucun lot ou action en double).
    """
    account = Account(name="CA Centre-Est", initial_balance=1000.0)
    db_session.add(account)
    db_session.commit()

    preview_data = {
        "accounts": [
            {
                "account_id": account.id,
                "transactions": [
                    {
                        "date_operation": "2026-09-24",
                        "description": "PayPal Europe",
                        "raw_description": "PayPal Europe S.a.r.l.",
                        "amount": 2.73,
                        "raw_amount": -2.73,
                        "category": "Abonnement",
                        "csv_id": "woob_coming_cragr_paypal_01",
                        "is_coming": True,
                        "confidence": 0.95
                    }
                ]
            }
        ]
    }

    # 1ère sync
    res1 = process_incoming_batch(db_session, conn_id=1, preview_data=preview_data)
    assert res1["auto_committed"] == 1

    decisions_count_1 = db_session.query(AutopilotDecisionLog).count()
    tx_count_1 = db_session.query(Transaction).count()
    assert decisions_count_1 == 1
    assert tx_count_1 == 1

    # 2ème sync (même batch quelques heures plus tard)
    res2 = process_incoming_batch(db_session, conn_id=1, preview_data=preview_data)
    assert res2["auto_committed"] == 0
    assert res2["auto_reconciled"] == 0

    decisions_count_2 = db_session.query(AutopilotDecisionLog).count()
    tx_count_2 = db_session.query(Transaction).count()
    assert decisions_count_2 == decisions_count_1  # Pas de nouveau lot
    assert tx_count_2 == tx_count_1  # Pas de doublon en DB


def test_is_coming_transition_to_confirmed(db_session):
    """
    Vérifie la transition fluide : une opération créée en 'is_coming' (non pointée)
    qui passe ensuite en débit confirmé (is_coming=False) est alors pointée avec reconciliation_date.
    """
    account = Account(name="CA Centre-Est", initial_balance=1000.0)
    db_session.add(account)
    db_session.commit()

    # Étape 1 : Opération à venir
    coming_preview = {
        "accounts": [
            {
                "account_id": account.id,
                "transactions": [
                    {
                        "date_operation": "2026-09-24",
                        "description": "Chanchai Thai Food",
                        "raw_description": "X1208 CHANCHAI THAI FO DOL",
                        "amount": 17.0,
                        "raw_amount": -17.0,
                        "category": "Restaurant",
                        "csv_id": "woob_coming_cragr_chanchai_01",
                        "is_coming": True,
                        "confidence": 0.95
                    }
                ]
            }
        ]
    }
    process_incoming_batch(db_session, conn_id=1, preview_data=coming_preview)

    tx = db_session.query(Transaction).filter(Transaction.csv_id == "woob_coming_cragr_chanchai_01").first()
    assert tx is not None
    assert tx.reconciliation_date is None

    # Étape 2 : Le lendemain, la banque confirme le débit (is_coming=False)
    confirmed_preview = {
        "accounts": [
            {
                "account_id": account.id,
                "transactions": [
                    {
                        "date_operation": "2026-09-25",
                        "description": "X1208 CHANCHAI THAI FOOD D",
                        "raw_description": "X1208 CHANCHAI THAI FOOD D",
                        "amount": 17.0,
                        "raw_amount": -17.0,
                        "csv_id": "woob_cragr_chanchai_01_confirmed",
                        "is_coming": False,
                        "is_reconciled": True,
                        "already_reconciled": False,
                        "matched_db_id": tx.id,
                        "match_score": 100.0
                    }
                ]
            }
        ]
    }
    res_conf = process_incoming_batch(db_session, conn_id=1, preview_data=confirmed_preview)
    assert res_conf["auto_reconciled"] == 1

    db_session.refresh(tx)
    assert tx.reconciliation_date == date.today()
    assert tx.csv_id == "woob_cragr_chanchai_01_confirmed"
