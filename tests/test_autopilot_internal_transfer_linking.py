"""
tests/test_autopilot_internal_transfer_linking.py — Validation de la fusion/liaison
automatique des virements internes asynchrones entre deux comptes connectés.
"""

from datetime import date
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
    BankConnection,
)
from app.services.autopilot_service import process_incoming_batch
from app.services.bank_sync.pending_store import clear_all_pending_sync
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

    cat_virement = Category(name="Virement interne", type="transfer")
    cat_achats = Category(name="Achats", type="expense_var")
    db.add_all([cat_virement, cat_achats])
    db.commit()

    clear_all_pending_sync(db)
    yield db
    clear_all_pending_sync(db)
    db.close()


def test_asynchronous_internal_transfer_linking_debit_first(db_session):
    """
    Cas 1 : Le débit (Compte Courant) synchronise d'abord et crée une écriture.
    Puis le crédit (Livret A) synchronise ensuite et est automatiquement fusionné
    en une transaction unique de type 'transfer' sans créer de fausse recette.
    """
    conn = BankConnection(id=1, backend="cragr", label="CA Multi-Comptes", is_active=True)
    acc_courant = Account(id=1, name="Compte Courant", initial_balance=2000.0)
    acc_livret = Account(id=2, name="Livret A", initial_balance=5000.0)
    db_session.add_all([conn, acc_courant, acc_livret])
    db_session.commit()

    # ÉTAPE 1 : Synchronisation du Compte Courant (Débit -500 €)
    preview_debit = {
        "accounts": [
            {
                "account_id": acc_courant.id,
                "account_name": acc_courant.name,
                "transactions": [
                    {
                        "date_operation": "2026-09-20",
                        "description": "Virement émis vers Livret A",
                        "raw_description": "VIR SEPA VERS LIVRET A",
                        "amount": 500.0,
                        "raw_amount": -500.0,
                        "category": "Virement interne",
                        "csv_id": "woob_cragr_debit_500_01",
                        "is_coming": False,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }

    res1 = process_incoming_batch(db_session, conn_id=1, preview_data=preview_debit)
    assert res1["auto_committed"] == 1

    txs_step1 = db_session.query(Transaction).all()
    assert len(txs_step1) == 1
    tx1 = txs_step1[0]
    assert tx1.from_account_id == acc_courant.id
    assert tx1.to_account_id is None
    assert tx1.amount == 500.0

    # ÉTAPE 2 : Synchronisation ultérieure du Livret A (Crédit +500 €)
    preview_credit = {
        "accounts": [
            {
                "account_id": acc_livret.id,
                "account_name": acc_livret.name,
                "transactions": [
                    {
                        "date_operation": "2026-09-20",
                        "description": "Virement reçu de Compte Courant",
                        "raw_description": "VIR SEPA DE COMPTE COURANT",
                        "amount": 500.0,
                        "raw_amount": 500.0,
                        "category": "Virement interne",
                        "csv_id": "woob_cragr_credit_500_01",
                        "is_coming": False,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }

    res2 = process_incoming_batch(db_session, conn_id=1, preview_data=preview_credit)
    assert res2["auto_reconciled"] == 1
    assert res2["auto_committed"] == 0  # Aucune fausse écriture de recette créée !

    # Vérification : Toujours exactement 1 transaction en base, désormais de type transfer
    all_txs = db_session.query(Transaction).all()
    assert len(all_txs) == 1
    merged_tx = all_txs[0]
    assert merged_tx.id == tx1.id
    assert merged_tx.type == "transfer"
    assert merged_tx.from_account_id == acc_courant.id
    assert merged_tx.to_account_id == acc_livret.id
    assert merged_tx.amount == 500.0
    assert merged_tx.reconciliation_date == date.today()

    # Vérifier le log de décision
    decision = db_session.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.action == "AUTO_LINKED_TRANSFER"
    ).first()
    assert decision is not None
    assert decision.entity_id == merged_tx.id


def test_asynchronous_internal_transfer_linking_credit_first(db_session):
    """
    Cas 2 : Le crédit (Livret A) synchronise d'abord, puis le débit (Compte Courant)
    synchronise ensuite et est fusionné en une transaction unique de type 'transfer'.
    """
    conn = BankConnection(id=1, backend="cragr", label="CA Multi-Comptes", is_active=True)
    acc_courant = Account(id=1, name="Compte Courant", initial_balance=2000.0)
    acc_livret = Account(id=2, name="Livret A", initial_balance=5000.0)
    db_session.add_all([conn, acc_courant, acc_livret])
    db_session.commit()

    # ÉTAPE 1 : Le crédit synchronise d'abord
    preview_credit = {
        "accounts": [
            {
                "account_id": acc_livret.id,
                "transactions": [
                    {
                        "date_operation": "2026-09-21",
                        "description": "Virement reçu Compte Courant",
                        "raw_description": "VIR SEPA DE CPT COURANT",
                        "amount": 350.0,
                        "raw_amount": 350.0,
                        "category": "Virement interne",
                        "csv_id": "woob_cragr_credit_350_01",
                        "is_coming": False,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }
    res1 = process_incoming_batch(db_session, conn_id=1, preview_data=preview_credit)
    assert res1["auto_committed"] == 1

    tx1 = db_session.query(Transaction).first()
    assert tx1.from_account_id is None
    assert tx1.to_account_id == acc_livret.id

    # ÉTAPE 2 : Le débit synchronise ensuite
    preview_debit = {
        "accounts": [
            {
                "account_id": acc_courant.id,
                "transactions": [
                    {
                        "date_operation": "2026-09-21",
                        "description": "Virement émis vers Livret A",
                        "raw_description": "VIR SEPA VERS LIVRET A",
                        "amount": 350.0,
                        "raw_amount": -350.0,
                        "category": "Virement interne",
                        "csv_id": "woob_cragr_debit_350_01",
                        "is_coming": False,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }
    res2 = process_incoming_batch(db_session, conn_id=1, preview_data=preview_debit)
    assert res2["auto_reconciled"] == 1
    assert res2["auto_committed"] == 0

    all_txs = db_session.query(Transaction).all()
    assert len(all_txs) == 1
    merged = all_txs[0]
    assert merged.type == "transfer"
    assert merged.from_account_id == acc_courant.id
    assert merged.to_account_id == acc_livret.id
    assert merged.amount == 350.0


def test_cross_batch_mirror_transfer_recognition_on_already_reconciled(db_session):
    """
    Cas 3 : Un virement interne (CA -> Livret A) a déjà été rapproché lors d'une synchronisation
    antérieure (reconciliation_date est déjà renseignée).
    Lorsqu'une synchronisation ultérieure ramène le crédit miroir sur le Livret A,
    le moteur doit reconnaître qu'il s'agit du pendant miroir d'un virement déjà rapproché,
    et ne JAMAIS créer de transaction supplémentaire non justifiée.
    """
    conn = BankConnection(id=1, backend="cragr", label="CA Multi-Comptes", is_active=True)
    acc_courant = Account(id=1, name="CA Centre-Est", initial_balance=2000.0)
    acc_livret = Account(id=3, name="Livret A", initial_balance=5000.0)
    db_session.add_all([conn, acc_courant, acc_livret])
    db_session.commit()

    # Virement interne existant et DÉJÀ rapproché au préalable
    tx_existing = Transaction(
        id=2389,
        date_operation=date(2026, 9, 14),
        description="Economie",
        amount=250.0,
        type="expense_fixed",
        category="Transfert",
        from_account_id=acc_courant.id,
        to_account_id=acc_livret.id,
        reconciliation_date=date(2026, 9, 15),
        csv_id="woob_cragr_04113708641_4c869e488e9c"
    )
    db_session.add(tx_existing)
    db_session.commit()

    # Arrivée du crédit miroir sur le Livret A dans un nouveau relevé
    preview_mirror_credit = {
        "accounts": [
            {
                "account_id": acc_livret.id,
                "account_name": acc_livret.name,
                "transactions": [
                    {
                        "date_operation": "2026-09-15",
                        "description": "De M Bazinet Quentin",
                        "raw_description": "DE M. BAZINET QUENTIN",
                        "amount": 250.0,
                        "raw_amount": 250.0,
                        "category": "Revenus divers",
                        "csv_id": "woob_cragr_04115259259_credit_250",
                        "is_coming": False,
                        "is_reconciled": False
                    }
                ]
            }
        ]
    }

    # Le rapprochement doit détecter le pendant miroir
    from app.services.reconciliation_engine import check_reconciliation
    match_res = check_reconciliation(
        db=db_session,
        tx_date=date(2026, 9, 15),
        tx_amount=250.0,
        bank_label="DE M. BAZINET QUENTIN",
        account_id=acc_livret.id,
        csv_id="woob_cragr_04115259259_credit_250"
    )

    assert match_res is not None
    assert match_res["is_mirror_transfer"] is True
    assert match_res["already_reconciled"] is True
    assert match_res["id"] == tx_existing.id

    # Auto-Pilot ne doit créer AUCUNE transaction
    preview_mirror_credit["accounts"][0]["transactions"][0]["is_reconciled"] = True
    preview_mirror_credit["accounts"][0]["transactions"][0]["already_reconciled"] = True
    preview_mirror_credit["accounts"][0]["transactions"][0]["is_mirror_transfer"] = True
    preview_mirror_credit["accounts"][0]["transactions"][0]["matched_db_id"] = match_res["id"]

    res = process_incoming_batch(db_session, conn_id=1, preview_data=preview_mirror_credit)
    assert res["auto_committed"] == 0

    all_txs = db_session.query(Transaction).all()
    assert len(all_txs) == 1
    assert all_txs[0].id == 2389

