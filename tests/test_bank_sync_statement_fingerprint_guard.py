import pytest
from datetime import date, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, Transaction, GlobalConfig
from app.services.bank_sync.sync_service import evaluate_historical_fingerprint
from app.services.autopilot_service import process_incoming_batch, set_autopilot_enabled
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
    ])
    db.commit()

    yield db
    db.close()


def test_evaluate_historical_fingerprint_cold_start(db_session):
    """Vérifie qu'un compte neuf (< 5 transactions en base) n'est pas bloqué par le garde-fou."""
    db = db_session
    acc = Account(name="Compte Neuf", type="checking", initial_balance=500.0)
    db.add(acc)
    db.commit()

    # Seulement 2 transactions en base
    t1 = Transaction(
        date_operation=date.today() - timedelta(days=5),
        amount=50.0,
        type="expense_var",
        from_account_id=acc.id,
        description="Achat 1"
    )
    t2 = Transaction(
        date_operation=date.today() - timedelta(days=2),
        amount=30.0,
        type="expense_var",
        from_account_id=acc.id,
        description="Achat 2"
    )
    db.add_all([t1, t2])
    db.commit()

    incoming_txs = [
        {"date_operation": date.today().isoformat(), "amount": 25.0, "raw_amount": -25.0, "description": "Nouveau marchand"}
    ]

    res = evaluate_historical_fingerprint(
        db,
        acc.id,
        incoming_txs,
        cutoff_date=date.today() - timedelta(days=30),
        min_history_threshold=5
    )

    assert res["is_suspicious"] is False
    assert res["is_cold_start"] is True
    assert res["db_recent_count"] == 2


def test_evaluate_historical_fingerprint_warm_account_normal_overlap(db_session):
    """Vérifie qu'un compte actif dont certaines opérations matchent la base n'est pas bloqué."""
    db = db_session
    acc = Account(name="Compte Actif", type="checking", initial_balance=2000.0)
    db.add(acc)
    db.commit()

    # Créer 10 transactions récentes
    for i in range(10):
        t = Transaction(
            date_operation=date.today() - timedelta(days=i + 1),
            amount=10.0 + i,
            type="expense_var",
            from_account_id=acc.id,
            description=f"Transaction {i}",
            csv_id=f"known_csv_{i}"
        )
        db.add(t)
    db.commit()

    # Le relevé contient des opérations connues
    incoming_txs = [
        {"date_operation": (date.today() - timedelta(days=1)).isoformat(), "amount": 10.0, "raw_amount": -10.0, "description": "Transaction 0", "is_reconciled": True},
        {"date_operation": date.today().isoformat(), "amount": 99.0, "raw_amount": -99.0, "description": "Nouvelle opération"}
    ]

    res = evaluate_historical_fingerprint(
        db,
        acc.id,
        incoming_txs,
        cutoff_date=date.today() - timedelta(days=30),
        min_history_threshold=5
    )

    assert res["is_suspicious"] is False
    assert res["is_cold_start"] is False
    assert res["db_recent_count"] == 10
    assert res["matched_count"] == 1
    assert res["overlap_ratio"] == 0.5


def test_evaluate_historical_fingerprint_warm_account_zero_overlap(db_session):
    """Vérifie qu'un compte actif recevant un relevé sans AUCUNE correspondance est bloqué comme suspect."""
    db = db_session
    acc = Account(name="Compte Courant Principal", type="checking", initial_balance=1500.0)
    db.add(acc)
    db.commit()

    # 15 transactions récentes en base
    for i in range(15):
        t = Transaction(
            date_operation=date.today() - timedelta(days=i + 1),
            amount=20.0 + i,
            type="expense_var",
            from_account_id=acc.id,
            description=f"Dépense connue {i}",
            csv_id=f"tx_{acc.id}_{i}"
        )
        db.add(t)
    db.commit()

    # Relevé entrant : 1 seule opération provenant d'un autre compte (ex: livret A versé +250€)
    # Aucune correspondance avec les 15 transactions du compte courant
    incoming_txs = [
        {
            "date_operation": (date.today() - timedelta(days=14)).isoformat(),
            "amount": 250.0,
            "raw_amount": 250.0,
            "description": "DE M. BAZINET QUENTIN",
            "csv_id": "woob_cragr_livret_a_isolated",
            "is_reconciled": False,
            "already_reconciled": False,
            "matched_db_id": None
        }
    ]

    res = evaluate_historical_fingerprint(
        db,
        acc.id,
        incoming_txs,
        cutoff_date=date.today() - timedelta(days=30),
        min_history_threshold=5
    )

    assert res["is_suspicious"] is True
    assert res["is_cold_start"] is False
    assert res["reason"] == "zero_db_overlap"
    assert res["db_recent_count"] == 15
    assert res["matched_count"] == 0
    assert "Garde-fou d'intégrité activé" in res["warning_message"]


def test_process_incoming_batch_blocks_suspicious_statement(db_session):
    """Vérifie que l'Auto-Pilote suspend strictement tout auto-commit et auto-reconciliation sur un relevé suspect."""
    db = db_session
    set_autopilot_enabled(db, True, preset="full")

    acc = Account(name="Compte Courant Sécurisé", type="checking", initial_balance=1200.0)
    db.add(acc)
    db.commit()

    # Remplir l'historique récent
    for i in range(12):
        t = Transaction(
            date_operation=date.today() - timedelta(days=i + 1),
            amount=15.0 + i,
            type="expense_var",
            from_account_id=acc.id,
            description=f"Courses {i}"
        )
        db.add(t)
    db.commit()

    initial_tx_count = db.query(Transaction).filter(Transaction.from_account_id == acc.id).count()

    # Préparer un lot suspect (0 overlap)
    incoming_tx = {
        "date_operation": (date.today() - timedelta(days=10)).isoformat(),
        "amount": 250.0,
        "raw_amount": 250.0,
        "description": "DE M. BAZINET QUENTIN",
        "csv_id": f"woob_cragr_suspicious_{acc.id}_001",
        "account_id": acc.id,
        "account_name": acc.name,
        "is_reconciled": False,
        "already_reconciled": False,
        "matched_db_id": None
    }

    preview_data = {
        "connection_id": 1,
        "accounts": [
            {
                "account_id": acc.id,
                "account_name": acc.name,
                "is_suspicious_statement": True,
                "suspicious_fingerprint": {
                    "is_suspicious": True,
                    "reason": "zero_db_overlap",
                    "db_recent_count": 12,
                    "warning_message": "Relevé suspect bloqué"
                },
                "transactions": [incoming_tx]
            }
        ]
    }

    res = process_incoming_batch(db, conn_id=1, preview_data=preview_data)

    # 1. Zéro écriture créée en base !
    assert res["auto_committed"] == 0
    assert res["auto_reconciled"] == 0
    final_tx_count = db.query(Transaction).filter(Transaction.from_account_id == acc.id).count()
    assert final_tx_count == initial_tx_count

    # 2. L'opération reste en attente de validation humaine
    assert res["pending"] == 1
    assert incoming_tx.get("needs_review") is True
    assert incoming_tx.get("_blocked_by_guard") is True
