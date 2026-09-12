"""
tests/test_autopilot_step4_5_dynamic_lifecycle.py — Suite de validation automatisée pour l'Étape 4.5
Cycle de vie dynamique & maintenance autonome des récurrences.

Périmètre :
- T4.5.1 : Déviation ponctuelle / Hors-forfait (Sosh 14.99 € -> 35.99 € lié auto sans altérer template).
- T4.5.2 : Plafond strict facteur 3 (Débit Orange 799 € bloqué dans le Sas, non auto-lié).
- T4.5.3 : Hausse de tarif pérenne à N=3 (Spotify 10.99 € -> 11.99 € actualise template et mois futurs).
- T4.5.4 : Auto-saut d'échéances sous triple verrou (solde banque = solde local, sas vide, délai 1 période + 3j).
- T4.5.5 : Neutralisation de l'auto-saut si solde non conforme (|écart| > 0.005 €) ou Sas non vide.
- T4.5.6 : Auto-clôture après 3 sauts consécutifs avec purge des échéances futures.
- T4.5.7 : Rétablissement en 1-clic du montant prévu via l'API.
"""

import pytest
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.main import app
from app.models import (
    Account,
    Transaction,
    Category,
    RecurrenceTemplate,
    AutopilotDecisionLog,
    GlobalConfig,
    BankConnection,
)
from app.services.bank_sync.pending_store import (
    save_pending_sync_data,
    clear_all_pending_sync,
)
from app.services.autopilot_service import process_incoming_batch
from app.services.recurrence_detector import (
    process_recurrence_promotions,
    process_auto_skipping,
    propagate_recurrence_update,
)
from app.services import stats_cache


@pytest.fixture
def db_session():
    """Base SQLite en mémoire isolée pour les tests de l'Étape 4.5."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    stats_cache.invalidate()

    # Initialisation minimale de configuration
    db.add_all([
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="auto_link_deviant_recurrences", value="true"),
        GlobalConfig(key="auto_propagate_recurrence_hikes", value="true"),
        GlobalConfig(key="auto_skip_unreconciled_recurrences", value="true"),
        GlobalConfig(key="auto_close_unreconciled_recurrences", value="true"),
        GlobalConfig(key="base_pay_day", value="28"),
    ])

    cat_telecom = Category(name="Téléphonie / Internet", type="expense_fixed")
    cat_leisure = Category(name="Loisirs", type="expense_leisure")
    cat_sports = Category(name="Sport", type="expense_fixed")
    db.add_all([cat_telecom, cat_leisure, cat_sports])
    db.commit()

    clear_all_pending_sync(db)
    yield db
    clear_all_pending_sync(db)
    db.close()


@pytest.fixture
def test_client(db_session):
    """Client FastAPI avec injection de la base de test."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app)
    yield client
    app.dependency_overrides.clear()


def test_t4_5_1_deviant_recurrence_auto_linking(db_session):
    """T4.5.1 : Auto-liaison avec déviation ponctuelle (Sosh 14,99 € prévu -> 35,99 € réel)."""
    account = Account(name="Compte Courant", initial_balance=2000.0)
    db_session.add(account)
    db_session.commit()

    # Template récurrence Sosh 14.99 €
    tpl = RecurrenceTemplate(
        description="Abonnement Sosh Mobile",
        amount=14.99,
        type="expense",
        category="Téléphonie / Internet",
        frequency="Monthly",
        day_of_month=10,
        from_account_id=account.id,
    )
    db_session.add(tpl)
    db_session.commit()

    # Prévision pour Août 2026 (non pointée)
    tx_aug = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 8, 10),
        amount=14.99,
        type="expense",
        category="Téléphonie / Internet",
        description="Abonnement Sosh Mobile",
        recurrence_id=tpl.id,
        reconciliation_date=None,
    )
    # Prévision pour Septembre 2026 (non pointée)
    tx_sep = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 9, 10),
        amount=14.99,
        type="expense",
        category="Téléphonie / Internet",
        description="Abonnement Sosh Mobile",
        recurrence_id=tpl.id,
        reconciliation_date=None,
    )
    db_session.add_all([tx_aug, tx_sep])
    db_session.commit()

    # Transaction réelle arrivant du relevé (Sas) : 35.99 €
    preview_data = {
        "accounts": [
            {
                "account_id": account.id,
                "bank_balance": 2000.0,
                "transactions": [
                    {
                        "csv_id": "test_sosh_aug",
                        "description": "PRLV SEPA SOSH ORANGE MOBILE REF 98712",
                        "raw_description": "PRLV SEPA SOSH ORANGE MOBILE REF 98712",
                        "date_operation": "2026-08-10",
                        "raw_amount": -35.99,
                        "amount": 35.99,
                    }
                ]
            }
        ]
    }

    result = process_incoming_batch(
        db=db_session,
        conn_id=1,
        preview_data=preview_data,
    )

    assert result["auto_reconciled"] == 1

    # Vérification de l'échéance d'août
    db_session.refresh(tx_aug)
    assert tx_aug.amount == 35.99
    assert tx_aug.reconciliation_date is not None
    assert tx_aug.is_skipped is False
    assert "Auto-ajusté" in (tx_aug.comment or "")

    # Sanctuarisation : Le template et le mois suivant restent à 14.99 €
    db_session.refresh(tpl)
    db_session.refresh(tx_sep)
    assert tpl.amount == 14.99
    assert tx_sep.amount == 14.99
    assert tx_sep.reconciliation_date is None

    # Log de décision consigné
    log = db_session.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.action == "AUTO_RECONCILED_DEVIANT"
    ).first()
    assert log is not None
    assert "35.99" in log.raw_snapshot
    assert "14.99" in log.raw_snapshot


def test_t4_5_2_deviant_tolerance_ceiling_factor_3(db_session):
    """T4.5.2 : Plafond strict facteur 3 (Débit Orange Smartphone 799 € bloqué dans le Sas)."""
    account = Account(name="Compte Courant", initial_balance=2000.0)
    db_session.add(account)
    db_session.commit()

    tpl = RecurrenceTemplate(
        description="Abonnement Orange Mobile",
        amount=14.99,
        type="expense",
        category="Téléphonie / Internet",
        frequency="Monthly",
        day_of_month=10,
        from_account_id=account.id,
    )
    db_session.add(tpl)
    db_session.commit()

    tx_aug = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 8, 10),
        amount=14.99,
        type="expense",
        category="Téléphonie / Internet",
        description="Abonnement Orange Mobile",
        recurrence_id=tpl.id,
        reconciliation_date=None,
    )
    db_session.add(tx_aug)
    db_session.commit()

    # Débit exceptionnel de 799 € (Smartphone Orange) -> ratio 799/14.99 = 53.3 >> 3.0
    preview_data = {
        "accounts": [
            {
                "account_id": account.id,
                "bank_balance": 2000.0,
                "transactions": [
                    {
                        "csv_id": "test_orange_phone",
                        "description": "PRLV SEPA ORANGE ACHAT SMARTPHONE",
                        "raw_description": "PRLV SEPA ORANGE ACHAT SMARTPHONE",
                        "date_operation": "2026-08-10",
                        "raw_amount": -799.00,
                        "amount": 799.00,
                    }
                ]
            }
        ]
    }

    result = process_incoming_batch(
        db=db_session,
        conn_id=1,
        preview_data=preview_data,
    )

    # L'opération ne doit PAS être auto-rapprochée sur la récurrence à 14.99 €
    assert result["auto_reconciled"] == 0
    db_session.refresh(tx_aug)
    assert tx_aug.amount == 14.99
    assert tx_aug.reconciliation_date is None


def test_t4_5_3_perennial_hike_propagation_n_equals_3(db_session):
    """T4.5.3 : Hausse de tarif pérenne à N=3 (Spotify 10,99 € -> 11,99 €)."""
    account = Account(name="Compte Courant", initial_balance=2000.0)
    db_session.add(account)
    db_session.commit()

    tpl = RecurrenceTemplate(
        description="Spotify Premium",
        amount=10.99,
        type="expense",
        category="Loisirs",
        frequency="Monthly",
        day_of_month=15,
        from_account_id=account.id,
    )
    db_session.add(tpl)
    db_session.commit()

    # 3 mois consécutifs prélevés à 11.99 € (Juin, Juillet, Août 2026)
    t1 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 6, 15),
        amount=11.99,
        type="expense",
        category="Loisirs",
        description="Spotify Premium",
        recurrence_id=tpl.id,
        reconciliation_date=date(2026, 6, 15),
    )
    t2 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 7, 15),
        amount=11.99,
        type="expense",
        category="Loisirs",
        description="Spotify Premium",
        recurrence_id=tpl.id,
        reconciliation_date=date(2026, 7, 15),
    )
    t3 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 8, 15),
        amount=11.99,
        type="expense",
        category="Loisirs",
        description="Spotify Premium",
        recurrence_id=tpl.id,
        reconciliation_date=date(2026, 8, 15),
    )
    # Mois futur (Septembre 2026) encore non pointé et à l'ancien tarif
    t4 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 9, 15),
        amount=10.99,
        type="expense",
        category="Loisirs",
        description="Spotify Premium",
        recurrence_id=tpl.id,
        reconciliation_date=None,
    )
    db_session.add_all([t1, t2, t3, t4])
    db_session.commit()

    # Déclenchement de la détection et propagation
    promotions = process_recurrence_promotions(db_session, account.id)

    assert promotions["hikes_propagated"] == 1

    # Le template doit être actualisé à 11.99 €
    db_session.refresh(tpl)
    assert tpl.amount == 11.99

    # Les transactions passées doivent rester intactes à 11.99 €
    db_session.refresh(t1)
    db_session.refresh(t2)
    db_session.refresh(t3)
    assert t1.amount == 11.99
    assert t2.amount == 11.99
    assert t3.amount == 11.99

    # Le mois futur doit être mis à jour à 11.99 €
    updated_future_txs = db_session.query(Transaction).filter(
        Transaction.recurrence_id == tpl.id,
        Transaction.date_operation >= date(2026, 9, 1),
    ).all()
    assert len(updated_future_txs) >= 1
    for fut in updated_future_txs:
        assert fut.amount == 11.99

    # Vérification du log
    log = db_session.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.action == "AUTO_PROPAGATE_HIKE"
    ).first()
    assert log is not None
    assert "Spotify" in log.raw_snapshot
    assert "11.99" in log.raw_snapshot


def test_t4_5_4_auto_skipping_conforming_balance(db_session):
    """T4.5.4 : Auto-saut d'échéance dépassée sous triple verrou conforme."""
    account = Account(name="Compte Courant", initial_balance=0.0)
    db_session.add(account)
    db_session.commit()

    # Création d'une connexion bancaire avec solde distant officiel à 1500.0 €
    conn = BankConnection(
        backend="boursorama",
        label="Mock Bank",
    )
    db_session.add(conn)

    tpl = RecurrenceTemplate(
        description="Salle de Sport Fitness",
        amount=40.0,
        type="expense",
        category="Sport",
        frequency="Monthly",
        day_of_month=5,
        from_account_id=account.id,
    )
    db_session.add(tpl)
    db_session.commit()

    # Transaction historique pointée justifiant le solde de 1500 € (0 + 1500 = 1500)
    tx_base = Transaction(
        to_account_id=account.id,
        date_operation=date(2026, 6, 1),
        amount=1500.0,
        type="income",
        category="Salaire",
        description="Salaire initial",
        reconciliation_date=date(2026, 6, 1),
    )
    # Échéance de sport au 5 Juillet 2026 (non pointée)
    tx_sport = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 7, 5),
        amount=40.0,
        type="expense",
        category="Sport",
        description="Salle de Sport Fitness",
        recurrence_id=tpl.id,
        reconciliation_date=None,
        is_skipped=False,
    )
    db_session.add_all([tx_base, tx_sport])
    db_session.commit()

    # Date simulée : 10 Août 2026 (> 5 Juillet + 1 mois + 3 jours = 8 Août 2026)
    simulated_date = date(2026, 8, 10)

    # Exécution de l'auto-saut
    result = process_auto_skipping(
        db=db_session,
        account_id=account.id,
        current_date=simulated_date,
        bank_balance=1500.0,
    )

    assert result["skipped_count"] == 1

    db_session.refresh(tx_sport)
    assert tx_sport.is_skipped is True
    assert "Auto-sauté" in (tx_sport.comment or "")

    # Vérification log
    log = db_session.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.action == "AUTO_SKIPPED_UNRECONCILED"
    ).first()
    assert log is not None
    assert "Salle de Sport" in log.raw_snapshot


def test_t4_5_5_auto_skipping_neutralized_on_discrepancy_or_pending(db_session):
    """T4.5.5 : Neutralisation de l'auto-saut si solde non conforme ou Sas non vide."""
    account = Account(name="Compte Courant", initial_balance=1460.0)
    db_session.add(account)
    db_session.commit()

    # Solde banque distant = 1500.0 € alors que le solde local = 1460.0 € (écart 40.0 €)
    conn = BankConnection(
        backend="boursorama",
        label="Mock Bank",
    )
    db_session.add(conn)

    tpl = RecurrenceTemplate(
        description="Salle de Sport Fitness",
        amount=40.0,
        type="expense",
        category="Sport",
        frequency="Monthly",
        day_of_month=5,
        from_account_id=account.id,
    )
    db_session.add(tpl)
    db_session.commit()

    tx_sport = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 7, 5),
        amount=40.0,
        type="expense",
        category="Sport",
        description="Salle de Sport Fitness",
        recurrence_id=tpl.id,
        reconciliation_date=None,
        is_skipped=False,
    )
    db_session.add(tx_sport)
    db_session.commit()

    simulated_date = date(2026, 8, 10)

    # 1. Écart de solde : ne doit rien sauter
    res1 = process_auto_skipping(db=db_session, account_id=account.id, current_date=simulated_date, bank_balance=1500.0)
    assert res1["skipped_count"] == 0
    db_session.refresh(tx_sport)
    assert tx_sport.is_skipped is False

    # 2. Solde réajusté à 1500.0 € mais Sas non vide (1 item en attente)
    tx_base = Transaction(
        to_account_id=account.id,
        date_operation=date(2026, 6, 1),
        amount=1500.0,
        type="income",
        category="Salaire",
        description="Salaire initial",
        reconciliation_date=date(2026, 6, 1),
    )
    db_session.add(tx_base)
    db_session.commit()

    save_pending_sync_data(
        db=db_session,
        conn_id=conn.id,
        preview_data={
            "accounts": [
                {
                    "account_id": account.id,
                    "bank_balance": 1500.0,
                    "transactions": [
                        {
                            "csv_id": "test_pending_tx_1",
                            "date_operation": "2026-08-09",
                            "raw_amount": -10.0,
                            "description": "ACHAT CB PENDING",
                        }
                    ]
                }
            ]
        }
    )

    res2 = process_auto_skipping(db=db_session, account_id=account.id, current_date=simulated_date, bank_balance=1500.0)
    assert res2["skipped_count"] == 0
    db_session.refresh(tx_sport)
    assert tx_sport.is_skipped is False

    # Nettoyage du sas
    clear_all_pending_sync(db_session)


def test_t4_5_6_auto_close_on_3_consecutive_skips(db_session):
    """T4.5.6 : Auto-clôture après 3 sauts consécutifs et purge des prévisions ultérieures."""
    account = Account(name="Compte Courant", initial_balance=1500.0)
    db_session.add(account)
    db_session.commit()

    conn = BankConnection(
        backend="boursorama",
        label="Mock Bank",
    )
    db_session.add(conn)

    tpl = RecurrenceTemplate(
        description="Magazine Hebdo",
        amount=15.0,
        type="expense",
        category="Loisirs",
        frequency="Monthly",
        day_of_month=1,
        from_account_id=account.id,
        is_closed=False,
    )
    db_session.add(tpl)
    db_session.commit()

    # 3 échéances passées sautées (Juin, Juillet, Août)
    s1 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 6, 1),
        amount=15.0,
        type="expense",
        category="Loisirs",
        description="Magazine Hebdo",
        recurrence_id=tpl.id,
        is_skipped=True,
    )
    s2 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 7, 1),
        amount=15.0,
        type="expense",
        category="Loisirs",
        description="Magazine Hebdo",
        recurrence_id=tpl.id,
        is_skipped=True,
    )
    s3 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 8, 1),
        amount=15.0,
        type="expense",
        category="Loisirs",
        description="Magazine Hebdo",
        recurrence_id=tpl.id,
        is_skipped=True,
    )
    # Échéances futures prévues (Septembre, Octobre)
    f1 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 9, 1),
        amount=15.0,
        type="expense",
        category="Loisirs",
        description="Magazine Hebdo",
        recurrence_id=tpl.id,
        is_skipped=False,
    )
    f2 = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 10, 1),
        amount=15.0,
        type="expense",
        category="Loisirs",
        description="Magazine Hebdo",
        recurrence_id=tpl.id,
        is_skipped=False,
    )
    db_session.add_all([s1, s2, s3, f1, f2])
    db_session.commit()

    res = process_auto_skipping(
        db=db_session,
        account_id=account.id,
        current_date=date(2026, 8, 15),
        bank_balance=1500.0,
    )

    assert res["closed_templates"] == 1

    # Le template doit être clôturé
    db_session.refresh(tpl)
    assert tpl.is_closed is True

    # Les prévisions futures (Septembre, Octobre) doivent être purgées
    future_count = db_session.query(Transaction).filter(
        Transaction.recurrence_id == tpl.id,
        Transaction.date_operation >= date(2026, 9, 1),
    ).count()
    assert future_count == 0

    # Les 3 échéances passées sautées restent conservées
    past_count = db_session.query(Transaction).filter(
        Transaction.recurrence_id == tpl.id,
        Transaction.is_skipped == True,
    ).count()
    assert past_count == 3

    # Log de décision
    log = db_session.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.action == "AUTO_CLOSED_SKIPPED"
    ).first()
    assert log is not None
    assert "Magazine Hebdo" in log.raw_snapshot


def test_t4_5_7_restore_amount_endpoint(test_client, db_session):
    """T4.5.7 : Rétablissement 1-clic du montant prévu via l'API."""
    account = Account(name="Compte Courant", initial_balance=2000.0)
    db_session.add(account)
    db_session.commit()

    tpl = RecurrenceTemplate(
        description="Abonnement Sosh Mobile",
        amount=14.99,
        type="expense",
        category="Téléphonie / Internet",
        frequency="Monthly",
        day_of_month=10,
        from_account_id=account.id,
    )
    db_session.add(tpl)
    db_session.commit()

    tx = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 8, 10),
        amount=35.99,
        type="expense",
        category="Téléphonie / Internet",
        description="Abonnement Sosh Mobile",
        recurrence_id=tpl.id,
        reconciliation_date=date(2026, 8, 10),
        comment="Auto-ajusté (prévu: 14.99 €) | Facture détaillée",
    )
    db_session.add(tx)
    db_session.commit()

    # Appel de l'endpoint POST /api/recurrences/transactions/{tx.id}/restore-amount
    resp = test_client.post(f"/api/recurrences/transactions/{tx.id}/restore-amount")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["restored_amount"] == 14.99

    db_session.refresh(tx)
    assert tx.amount == 14.99
    assert "Rétabli montant prévu (14.99 €)" in (tx.comment or "")


def test_t4_5_8_hierarchy_disabling_master_prevents_hikes_and_skipping(db_session):
    """
    T4.5.8 : Hiérarchie des options.
    Si auto_link_deviant_recurrences est False :
    - La détection/propagation des hausses tarifaires (N=3) est neutralisée
    - L'auto-saut des échéances non prélevées est neutralisé
    - L'auto-clôture est neutralisée
    """
    # 1. Configurer auto_link_deviant_recurrences à false
    cfg = db_session.query(GlobalConfig).filter(GlobalConfig.key == "auto_link_deviant_recurrences").first()
    if cfg:
        cfg.value = "false"
    else:
        db_session.add(GlobalConfig(key="auto_link_deviant_recurrences", value="false"))
    db_session.commit()

    account = Account(name="Compte Courant", initial_balance=1000.0)
    db_session.add(account)
    db_session.commit()

    # Cas Hausse N=3 : Template Spotify à 10.99 € avec 3 débits pointés à 11.99 €
    tpl_hike = RecurrenceTemplate(
        description="Abonnement Spotify",
        amount=10.99,
        type="expense",
        category="Loisirs",
        frequency="Monthly",
        day_of_month=5,
        from_account_id=account.id,
    )
    db_session.add(tpl_hike)
    db_session.commit()

    for m in [5, 6, 7]:
        tx = Transaction(
            from_account_id=account.id,
            date_operation=date(2026, m, 5),
            amount=11.99,
            type="expense",
            category="Loisirs",
            description="Spotify Premium",
            recurrence_id=tpl_hike.id,
            reconciliation_date=date(2026, m, 5),
        )
        db_session.add(tx)
    db_session.commit()

    # Cas Auto-Saut : Échéance dépassée de 1 mois + 3 jours avec solde conforme
    tpl_skip = RecurrenceTemplate(
        description="Salle de sport",
        amount=30.0,
        type="expense",
        category="Sport",
        frequency="Monthly",
        day_of_month=1,
        from_account_id=account.id,
    )
    db_session.add(tpl_skip)
    db_session.commit()

    tx_overdue = Transaction(
        from_account_id=account.id,
        date_operation=date(2026, 6, 1),
        amount=30.0,
        type="expense",
        category="Sport",
        description="Salle de sport",
        recurrence_id=tpl_skip.id,
        reconciliation_date=None,  # non pointée
    )
    db_session.add(tx_overdue)
    db_session.commit()

    # 2. Exécuter la routine de promotion / hausses
    res_promotions = process_recurrence_promotions(
        db=db_session,
        account_id=account.id,
    )
    # Les hausses doivent être neutralisées
    assert res_promotions["propagated_hikes"] == 0
    db_session.refresh(tpl_hike)
    assert tpl_hike.amount == 10.99  # Non modifié

    # 3. Exécuter la routine d'auto-saut
    res_skip = process_auto_skipping(
        db=db_session,
        account_id=account.id,
        current_date=date(2026, 8, 15),
        bank_balance=1000.0,
    )
    # L'auto-saut doit être neutralisé
    assert res_skip["skipped_count"] == 0
    assert res_skip["closed_templates"] == 0
    db_session.refresh(tx_overdue)
    assert tx_overdue.is_skipped is not True
