from datetime import date
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, Account, Transaction, BankConnection
from app.services.reconciliation_engine import check_reconciliation
from app.services.bank_sync.pending_store import (
    save_pending_sync_data,
    get_all_pending_sync,
    clear_all_pending_sync
)
from app.services.bank_sync.import_engine import re_evaluate_preview_data


@pytest.fixture
def twopass_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    try:
        yield db
    finally:
        db.close()


def test_check_reconciliation_exact_only_flag(twopass_db):
    """
    Vérifie que exact_only=True ne retourne un résultat QUE si le csv_id correspond exactement.
    Si le csv_id est différent ou absent, même en cas de similarité parfaite sur montant/libellé,
    exact_only=True doit renvoyer None.
    """
    acc = Account(name="Compte Test", initial_balance=1000.0)
    twopass_db.add(acc)
    twopass_db.commit()

    db_tx = Transaction(
        description="Abonnement Loisirs Sport",
        amount=140.0,
        type="expense_var",
        category="Loisirs",
        date_operation=date(2026, 9, 26),
        reconciliation_date=date(2026, 9, 27),
        from_account_id=acc.id,
        csv_id="woob_old_111"
    )
    twopass_db.add(db_tx)
    twopass_db.commit()

    # 1. Requête avec csv_id identique -> exact_only=True doit matcher (score 100)
    res_exact = check_reconciliation(
        twopass_db,
        date(2026, 9, 26),
        -140.0,
        account_id=acc.id,
        is_coming=False,
        bank_label="Abonnement Loisirs Sport",
        csv_id="woob_old_111",
        exact_only=True
    )
    assert res_exact is not None
    assert res_exact["id"] == db_tx.id
    assert res_exact["match_score"] == 100
    assert res_exact["already_reconciled"] is True

    # 2. Requête avec nouveau csv_id (opération nouvelle ayant le même libellé/montant)
    # exact_only=True doit refuser d'associer et renvoyer None
    res_diff_csv = check_reconciliation(
        twopass_db,
        date(2026, 10, 16),
        -140.0,
        account_id=acc.id,
        is_coming=False,
        bank_label="Abonnement Loisirs Sport",
        csv_id="woob_new_222",
        exact_only=True
    )
    assert res_diff_csv is None

    # 3. Requête sans csv_id -> exact_only=True doit renvoyer None
    res_no_csv = check_reconciliation(
        twopass_db,
        date(2026, 9, 26),
        -140.0,
        account_id=acc.id,
        is_coming=False,
        bank_label="Abonnement Loisirs Sport",
        csv_id=None,
        exact_only=True
    )
    assert res_no_csv is None


def test_anti_theft_guardrail_prevents_stealing_existing_csv_id(twopass_db):
    """
    Garde-fou anti-usurpation :
    Une transaction en base possédant déjà un csv_id (ex: woob_old_111) ne doit JAMAIS
    pouvoir être capturée par une nouvelle transaction bancaire portant un autre csv_id (woob_new_222),
    même lors de la passe floue / recherche d'opérations déjà pointées.
    """
    acc = Account(name="Compte Courant", initial_balance=5000.0)
    twopass_db.add(acc)
    twopass_db.commit()

    # Opération historique déjà pointée en base avec son csv_id d'origine
    db_tx = Transaction(
        description="GINET LICENCE SPORTIVE",
        amount=140.0,
        type="expense_var",
        category="Loisirs",
        date_operation=date(2026, 9, 26),
        reconciliation_date=date(2026, 9, 27),
        from_account_id=acc.id,
        csv_id="woob_old_ginet_577"
    )
    twopass_db.add(db_tx)
    twopass_db.commit()

    # Nouvelle opération survenue 20 jours plus tard avec libellé proche et même montant
    res_fuzzy = check_reconciliation(
        twopass_db,
        date(2026, 10, 16),
        -140.0,
        account_id=acc.id,
        is_coming=False,
        bank_label="FACTURE CARTE DU 151026 PELLET F LICENCE SPORTIVE",
        csv_id="woob_new_pellet_999",
        exact_only=False
    )
    # Le garde-fou doit interdire à db_tx d'être matché car db_tx.csv_id != woob_new_pellet_999
    assert res_fuzzy is None, "La nouvelle opération PELLET F ne doit pas usurper la ligne DB de GINET !"


def test_pending_store_two_pass_matching_in_reverse_chronological_order(twopass_db):
    """
    Vérifie qu'un lot de relevé ordonné chronologiquement inversé (plus récentes en premier)
    ne provoque pas le vol d'identifiant et l'effet 'opération fantôme bloquée dans le sas' :
    - tx[0] (récente, 16/10) : nouvelle opération (PELLET F)
    - tx[1] (ancienne, 26/09) : opération déjà en DB (GINET)
    Résultat attendu :
    - Passe 1 associe tx[1] à la ligne DB (id 577, already_reconciled=True).
    - Passe 2 constate que tx[0] est nouvelle (is_reconciled=False, À ajouter).
    """
    conn = BankConnection(backend="cragr", label="Test Bank", is_active=True)
    acc = Account(name="Compte Test", initial_balance=2000.0)
    twopass_db.add(conn)
    twopass_db.add(acc)
    twopass_db.commit()

    # Transaction en DB
    db_ginet = Transaction(
        description="GINET LICENCE SPORTIVE",
        amount=140.0,
        type="expense_var",
        category="Sport",
        date_operation=date(2026, 9, 26),
        reconciliation_date=date(2026, 9, 27),
        from_account_id=acc.id,
        csv_id="woob_ginet_id"
    )
    twopass_db.add(db_ginet)
    twopass_db.commit()

    raw_batch = {
        "accounts": [
            {
                "account_id": acc.id,
                "name": acc.name,
                "bank_balance": 1860.0,
                "transactions": [
                    # Transaction plus récente en premier (comme reçu dans l'API Woob / tri décroissant)
                    {
                        "date_operation": "2026-10-16",
                        "description": "PELLET F LICENCE SPORTIVE",
                        "raw_description": "FACTURE CARTE PELLET F LICENCE SPORTIVE 140 EUR",
                        "amount": -140.0,
                        "raw_amount": -140.0,
                        "csv_id": "woob_pellet_new_id",
                        "is_coming": False
                    },
                    # Transaction plus ancienne ensuite
                    {
                        "date_operation": "2026-09-26",
                        "description": "GINET LICENCE SPORTIVE",
                        "raw_description": "FACTURE CARTE GINET LICENCE SPORTIVE 140 EUR",
                        "amount": -140.0,
                        "raw_amount": -140.0,
                        "csv_id": "woob_ginet_id",
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    save_pending_sync_data(twopass_db, conn.id, raw_batch)
    summary = get_all_pending_sync(twopass_db)

    assert summary["total_new"] == 1, "Il doit y avoir exactement 1 nouvelle transaction à ajouter"

    acc_res = summary["accounts"][0]
    txs = acc_res["transactions"]

    tx_pellet = next(t for t in txs if t["csv_id"] == "woob_pellet_new_id")
    tx_ginet = next(t for t in txs if t["csv_id"] == "woob_ginet_id")

    # GINET doit être reconnue comme déjà pointée vers la ligne DB
    assert tx_ginet["is_reconciled"] is True
    assert tx_ginet["already_reconciled"] is True
    assert tx_ginet["matched_db_id"] == db_ginet.id

    # PELLET F doit être nouvelle et ne pas avoir volé la ligne de GINET
    assert tx_pellet["is_reconciled"] is False
    assert tx_pellet["already_reconciled"] is False
    assert tx_pellet["matched_db_id"] is None


def test_import_engine_re_evaluate_two_pass(twopass_db):
    """
    Vérifie que re_evaluate_preview_data dans import_engine applique également la double passe
    lors de la réévaluation dynamique de la modale de prévisualisation.
    """
    acc = Account(name="Compte Modal", initial_balance=3000.0)
    twopass_db.add(acc)
    twopass_db.commit()

    db_camatta = Transaction(
        description="CAMATTA LICENCE SPORTIVE",
        amount=120.0,
        type="expense_var",
        category="Sport",
        date_operation=date(2026, 9, 21),
        reconciliation_date=date(2026, 9, 22),
        from_account_id=acc.id,
        csv_id="woob_camatta_id"
    )
    twopass_db.add(db_camatta)
    twopass_db.commit()

    preview_input = {
        "accounts": [
            {
                "account_id": acc.id,
                "name": acc.name,
                "bank_balance": 2880.0,
                "transactions": [
                    {
                        "date_operation": "2026-10-16",
                        "description": "CHASSARD LAURENT LOISIRS",
                        "raw_description": "FACTURE CARTE CHASSARD LAURENT LOISIRS 120 EUR",
                        "amount": -120.0,
                        "raw_amount": -120.0,
                        "csv_id": "woob_chassard_new_id",
                        "is_coming": False
                    },
                    {
                        "date_operation": "2026-09-21",
                        "description": "CAMATTA LICENCE SPORTIVE",
                        "raw_description": "FACTURE CARTE CAMATTA LICENCE SPORTIVE 120 EUR",
                        "amount": -120.0,
                        "raw_amount": -120.0,
                        "csv_id": "woob_camatta_id",
                        "is_coming": False
                    }
                ]
            }
        ]
    }

    evaluated = re_evaluate_preview_data(twopass_db, preview_input)
    acc_eval = evaluated["accounts"][0]
    tx_evals = acc_eval["transactions"]

    tx_camatta = next(t for t in tx_evals if t["csv_id"] == "woob_camatta_id")
    tx_chassard = next(t for t in tx_evals if t["csv_id"] == "woob_chassard_new_id")

    assert tx_camatta["is_reconciled"] is True
    assert tx_camatta["already_reconciled"] is True
    assert tx_camatta["matched_db_id"] == db_camatta.id

    assert tx_chassard["is_reconciled"] is False
    assert tx_chassard["already_reconciled"] is False
    assert tx_chassard["matched_db_id"] is None
