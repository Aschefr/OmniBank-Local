"""
Rattrapage après une longue absence : ce que le relevé doit reprendre sans intervention.
- le montant bancaire remplace le montant prévu d'un rapprochement ;
- une ligne au montant voisin ne prend pas la prévision d'une ligne au montant exact ;
- une prévision déjà attribuée à une ligne ne rend pas une autre ligne suspecte ;
- les lignes non traitées du relevé précédent ne se perdent pas ;
- le relevé remonte jusqu'à la dernière ligne traitée, dans une limite.
"""
import json
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.main import app
from app.models import Account, AutopilotDecisionLog, Base, BankConnection, GlobalConfig, RecurrenceTemplate, Transaction
from app.services import stats_cache
from app.services.autopilot_service import process_incoming_batch
from app.services.bank_sync import sync_service
from app.services.bank_sync.pending_store import _set_config_value, clear_all_pending_sync
from app.services.credential_vault import CredentialVault
from app.services.finance_engine import calculate_balances

TAX_LABEL = "DIRECTION GENERALE DES FINANCES"
REMOTE_ID = "0001"


def days_ago(days: int) -> date:
    return date.today() - timedelta(days=days)


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    stats_cache.invalidate()
    session.add_all([
        Account(id=1, name="Courant", type="Compte courant", initial_balance=1000.0),
        BankConnection(id=1, backend="fake", label="Banque", account_mapping=json.dumps({REMOTE_ID: 1})),
        GlobalConfig(key="auto_pilot_enabled", value="true"),
        GlobalConfig(key="auto_link_deviant_recurrences", value="true"),
    ])
    session.commit()
    clear_all_pending_sync(session)
    yield session
    clear_all_pending_sync(session)
    session.close()


class _Obj:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _FakeBackend:
    """Banque simulée : le plus récent d'abord, comme un vrai relevé."""
    config = {}

    def __init__(self, lines, balance):
        self.lines = lines
        self.balance = balance

    def iter_accounts(self):
        return [_Obj(id=REMOTE_ID, label="Courant", balance=self.balance)]

    def iter_history(self, account):
        for day, amount, label in sorted(self.lines, key=lambda line: line[0], reverse=True):
            yield _Obj(date=day, amount=amount, label=label)

    def iter_coming(self, account):
        return []


@pytest.fixture
def bank(monkeypatch):
    """Sert un relevé sans banque ni réseau : bank(lines, balance) renvoie le backend à utiliser."""
    def install(lines, balance=0.0):
        backend = _FakeBackend(lines, balance)
        monkeypatch.setattr(sync_service, "_get_woob", lambda: _Obj(load_backend=lambda *a, **k: backend))
        monkeypatch.setattr(sync_service, "_get_woob_storage", lambda: None)
        monkeypatch.setattr(sync_service, "_apply_hotfixes", lambda *a, **k: None)
        monkeypatch.setattr(sync_service, "_safe_unload_backend", lambda *a, **k: None)
        monkeypatch.setattr(CredentialVault, "has_credentials", staticmethod(lambda db, cid: True))
        monkeypatch.setattr(CredentialVault, "retrieve_credentials", staticmethod(lambda db, cid, pw: {"login": "x"}))
        return backend
    return install


def run_statement(db, **kwargs):
    connection = db.query(BankConnection).first()
    kwargs.setdefault("since_days", 30)
    preview = sync_service.BankSyncService.fetch_preview_transactions(
        db=db, connection=connection, master_password="x", defer_ai=True, **kwargs
    )
    return process_incoming_batch(db, connection.id, preview, profile_id="default")


def add_forecast(db, description, amount, day, category="Impots", recurrent=True):
    recurrence_id = None
    if recurrent:
        template = RecurrenceTemplate(
            description=description, amount=amount, type="expense_fixed", category=category,
            frequency="Monthly", day_of_month=day.day, from_account_id=1,
        )
        db.add(template)
        db.flush()
        recurrence_id = template.id
    forecast = Transaction(
        description=description, amount=amount, type="expense_fixed", category=category,
        date_operation=day, from_account_id=1, recurrence_id=recurrence_id,
    )
    db.add(forecast)
    db.commit()
    return forecast


def add_pointed_line(db, day, amount=10.0):
    db.add(Transaction(
        description="Ligne pointée", amount=amount, type="expense_var", category="Divers",
        date_operation=day, reconciliation_date=day, from_account_id=1,
    ))
    db.commit()


def test_reconciled_transaction_takes_the_bank_amount(db, bank):
    """Le moteur connaît l'écart ; le relevé doit le transmettre, sinon le solde pointé reste faux."""
    forecast = add_forecast(db, "Forfait Orange", 14.99, days_ago(10), category="Telecoms")
    bank([(days_ago(10), -46.79, "ORANGE SA-ORANGE")], balance=953.21)

    run_statement(db)
    db.refresh(forecast)

    assert forecast.reconciliation_date is not None
    assert forecast.amount == 46.79
    assert calculate_balances(db, only_reconciled=True)[1] == 953.21
    decision = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.entity_id == forecast.id).first()
    assert "DEVIANT" in decision.action


def test_close_amount_does_not_take_the_forecast_of_an_exact_amount(db, bank):
    """Une ligne de -10 € ne doit pas prendre la prévision de 72 €, ni la ligne de -72 € celle de 331 €."""
    monthly = add_forecast(db, "Impots", 72.0, days_ago(20))
    extra = add_forecast(db, "Impots Complement", 331.0, days_ago(20))
    bank([
        (days_ago(20), -10.0, TAX_LABEL),
        (days_ago(19), -72.0, TAX_LABEL),
        (days_ago(9), -331.0, TAX_LABEL),
    ], balance=587.0)

    run_statement(db)
    db.refresh(monthly)
    db.refresh(extra)

    assert monthly.reconciliation_date is not None and monthly.amount == 72.0
    assert extra.reconciliation_date is not None and extra.amount == 331.0
    small = db.query(Transaction).filter(Transaction.amount == 10.0).one()
    assert small.id not in (monthly.id, extra.id)
    assert small.reconciliation_date is not None
    assert calculate_balances(db, only_reconciled=True)[1] == round(1000 - 10 - 72 - 331, 2)


def test_forecast_of_the_same_statement_does_not_make_a_line_suspect(db, bank):
    """Deux lignes de même montant : l'une prend la prévision, l'autre reste une opération réelle et pointée."""
    forecast = add_forecast(db, "Free Telecom", 49.99, days_ago(25), category="Telecoms")
    bank([
        (days_ago(25), -49.99, "Free Telecom"),
        (days_ago(5), -49.99, "PayPal Europe"),
    ], balance=900.02)

    run_statement(db)
    db.refresh(forecast)

    assert forecast.reconciliation_date is not None
    other = db.query(Transaction).filter(Transaction.raw_description == "PayPal Europe").one()
    assert other.reconciliation_date is not None
    assert db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.action.like("%DUPLICATE%")).count() == 0
    assert calculate_balances(db, only_reconciled=True)[1] == round(1000 - 2 * 49.99, 2)


def test_genuine_suspicion_still_goes_to_review(db, bank):
    """Le garde-fou reste : une prévision encore libre au même montant laisse la ligne en attente de vérification."""
    forecast = add_forecast(db, "Free Telecom", 49.99, days_ago(25), category="Telecoms")
    bank([(days_ago(5), -49.99, "PayPal Europe")])

    run_statement(db)
    db.refresh(forecast)

    line = db.query(Transaction).filter(Transaction.raw_description == "PayPal Europe").one()
    assert forecast.reconciliation_date is None
    assert line.needs_review is True and line.reconciliation_date is None
    assert db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.action.like("%DUPLICATE%")).count() == 1


def _old_pending(lines, **account_extra):
    return json.dumps({"1": {"updated_at": 0, "accounts": [{
        "account_id": 1, "account_name": "Courant", "remote_id": REMOTE_ID, "transactions": lines, **account_extra,
    }]}})


def _pending_line(day, amount, label, **extra):
    return {
        "date_operation": day.isoformat(), "raw_amount": amount, "amount": abs(amount),
        "raw_description": label, "description": label, "csv_id": f"woob_fake_{label}_{day}", **extra,
    }


def test_unprocessed_lines_of_previous_statement_are_not_lost(db, bank):
    """Le relevé précédent n'a pas été traité et ce relevé ne le couvre plus : ses lignes passent quand même."""
    forecast = add_forecast(db, "Assurance", 25.02, days_ago(50), category="Assurance")
    add_pointed_line(db, days_ago(20))
    _set_config_value(db, "bank_pending_sync_cache", _old_pending([
        _pending_line(days_ago(50), -25.02, "ASSURANCE"),
        _pending_line(days_ago(48), 137.5, "VIREMENT RECU"),
        _pending_line(days_ago(45), -99.0, "A VENIR", is_coming=True),
        _pending_line(days_ago(44), -98.0, "DEJA POINTEE", is_reconciled=True, already_reconciled=True),
        _pending_line(days_ago(43), -97.0, "ECARTEE", is_dismissed=True),
    ]))
    bank([(days_ago(3), -5.0, "BOULANGERIE")])

    result = run_statement(db)
    db.refresh(forecast)

    assert forecast.reconciliation_date is not None
    assert db.query(Transaction).filter(Transaction.raw_description == "VIREMENT RECU", Transaction.amount == 137.5).count() == 1
    for ignored in ("A VENIR", "DEJA POINTEE", "ECARTEE"):
        assert db.query(Transaction).filter(Transaction.raw_description == ignored).count() == 0
    assert result["total"] == 3


def test_unprocessed_lines_survive_a_bank_that_returns_less_than_requested(db, bank):
    """La ligne est dans la fenêtre demandée, mais la banque ne remonte pas si loin : elle ne doit pas se perdre."""
    add_pointed_line(db, days_ago(60))
    _set_config_value(db, "bank_pending_sync_cache", _old_pending([_pending_line(days_ago(40), -30.0, "DANS LE SAS")]))
    bank([(days_ago(3), -5.0, "BOULANGERIE")])

    run_statement(db, catch_up=True)

    assert db.query(Transaction).filter(Transaction.raw_description == "DANS LE SAS").count() == 1


def test_line_returned_again_by_the_bank_is_not_duplicated(db, bank):
    add_pointed_line(db, days_ago(60))
    day = days_ago(40)
    line_hash = sync_service.hashlib.sha256(f"fake_{REMOTE_ID}_{day}_-30.0_DANS LE SAS".encode("utf-8")).hexdigest()[:12]
    line = _pending_line(day, -30.0, "DANS LE SAS", csv_id=f"woob_fake_{REMOTE_ID}_{line_hash}")
    _set_config_value(db, "bank_pending_sync_cache", _old_pending([line]))
    bank([(day, -30.0, "DANS LE SAS")])

    run_statement(db, catch_up=True)

    assert db.query(Transaction).filter(Transaction.raw_description == "DANS LE SAS").count() == 1


def test_blocked_statement_is_not_carried_over(db, bank):
    """Un relevé bloqué par le garde-fou d'empreinte n'est pas digne de confiance : il ne revient pas."""
    add_pointed_line(db, days_ago(20))
    _set_config_value(db, "bank_pending_sync_cache", _old_pending(
        [_pending_line(days_ago(50), -11.0, "SUSPECTE")], is_suspicious_statement=True,
    ))
    bank([(days_ago(3), -5.0, "BOULANGERIE")])

    run_statement(db)

    assert db.query(Transaction).filter(Transaction.raw_description == "SUSPECTE").count() == 0


@pytest.mark.parametrize("absence, expected", [(2, 30), (35, 42), (62, 69), (200, 75)])
def test_statement_goes_back_to_the_last_processed_line(db, absence, expected):
    add_pointed_line(db, days_ago(absence))
    assert sync_service._catch_up_days(db, 1, 30) == expected


def test_statement_keeps_the_base_window_without_processed_line(db):
    add_forecast(db, "Prevue seulement", 10.0, days_ago(100))
    assert sync_service._catch_up_days(db, 1, 30) == 30


def test_catch_up_fetches_the_absence_and_nothing_older(db, bank):
    add_pointed_line(db, days_ago(50))
    inside, outside = days_ago(40), days_ago(70)
    bank([(inside, -20.0, "PENDANT ABSENCE"), (outside, -21.0, "AVANT ABSENCE")])

    run_statement(db, catch_up=True)

    assert db.query(Transaction).filter(Transaction.raw_description == "PENDANT ABSENCE").count() == 1
    assert db.query(Transaction).filter(Transaction.raw_description == "AVANT ABSENCE").count() == 0


def test_explicit_window_ignores_catch_up(db, bank):
    add_pointed_line(db, days_ago(50))
    bank([(days_ago(40), -20.0, "PENDANT ABSENCE")])

    run_statement(db)

    assert db.query(Transaction).filter(Transaction.raw_description == "PENDANT ABSENCE").count() == 0


def test_automatic_statement_uses_catch_up(db, monkeypatch):
    """Le relevé en arrière-plan et le bouton « Relever en ligne » passent par ce chemin."""
    from app.services.bank_sync import auto_sync
    seen = {}

    def fake_fetch(**kwargs):
        seen.update(kwargs)
        raise RuntimeError("arrêt du test")

    monkeypatch.setattr(auto_sync.BankSyncService, "fetch_preview_transactions", staticmethod(fake_fetch))
    connection = db.query(BankConnection).first()
    try:
        auto_sync.execute_auto_sync_for_connection(db, connection, "x", profile_id="default")
    except RuntimeError:
        pass
    assert seen.get("catch_up") is True


def test_review_queue_shows_bank_and_forecast_amounts(db, bank):
    """Passe par l'API : le modèle de réponse retire les champs qu'il ne déclare pas."""
    forecast = add_forecast(db, "Forfait Orange", 14.99, days_ago(10), category="Telecoms")
    bank([(days_ago(10), -46.79, "ORANGE SA-ORANGE")])
    run_statement(db)

    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    try:
        items = TestClient(app).get("/api/autopilot/review-queue").json()
    finally:
        app.dependency_overrides.pop(get_db, None)

    item = next(i for i in items if i["id"] == forecast.id)
    assert item["bank_amount"] == 46.79
    assert item["forecast_amount"] == 14.99


def test_review_queue_shows_amounts_of_a_transaction_reconciled_before_the_fix(db):
    """Déjà pointée au montant prévu : la revue doit révéler l'écart, sans rien modifier."""
    from app.services.autopilot_service import get_review_queue
    forecast = add_forecast(db, "Impots Complement", 331.0, days_ago(20))
    forecast.reconciliation_date = date.today()
    forecast.needs_review = True
    forecast.confidence_score = 70.0
    db.add(AutopilotDecisionLog(
        batch_id="ancien", decision_type="reconciliation", action="AUTO_COMMIT_PENDING_REVIEW",
        entity_type="transaction", entity_id=forecast.id,
        raw_snapshot=json.dumps({"bank_tx": {"raw_amount": -72.0}, "before": {"amount": 331.0}}),
    ))
    db.commit()

    item = next(i for i in get_review_queue(db) if i["id"] == forecast.id)

    assert (item["bank_amount"], item["forecast_amount"]) == (72.0, 331.0)
    assert item["amount"] == 331.0


def test_review_queue_without_reconciliation_has_no_amounts(db):
    from app.services.autopilot_service import get_review_queue
    db.add(Transaction(
        description="Nouvelle", amount=12.0, type="expense_var", category="Divers",
        date_operation=days_ago(2), from_account_id=1, needs_review=True,
    ))
    db.commit()

    item = get_review_queue(db)[0]

    assert item["bank_amount"] is None and item["forecast_amount"] is None


def test_line_weeks_after_a_pointed_one_of_same_amount_is_not_absorbed(db, bank):
    """Un abonnement de même montant, 17 jours après une opération déjà pointée : c'est une nouvelle ligne."""
    db.add(Transaction(
        description="Abonnement", amount=25.99, type="expense_var", category="Abonnements",
        date_operation=days_ago(40), reconciliation_date=days_ago(38), from_account_id=1,
        csv_id="woob_coming_fake_0001_ancien",
    ))
    db.commit()
    bank([(days_ago(23), -25.99, "X1208 ABONNEMENT DUBLIN")])

    run_statement(db, catch_up=True)

    assert db.query(Transaction).filter(Transaction.amount == 25.99).count() == 2
    assert calculate_balances(db, only_reconciled=True)[1] == round(1000 - 2 * 25.99, 2)


def test_manual_entry_pointed_weeks_before_its_debit_is_still_recognised(db, bank):
    """Une saisie manuelle pointée trois semaines avant son débit reste reconnue : pas de doublon (règle des 30 jours)."""
    db.add(Transaction(
        description="Saisie manuelle", amount=42.0, type="expense_var", category="Divers",
        date_operation=days_ago(30), reconciliation_date=days_ago(30), from_account_id=1,
    ))
    db.commit()
    bank([(days_ago(9), -42.0, "SAISIE MANUELLE")])

    run_statement(db)

    assert db.query(Transaction).filter(Transaction.amount == 42.0).count() == 1


def test_purchase_from_the_same_merchant_as_a_small_forecast_is_not_suspect(db, bank):
    """Un achat de 81,70 € chez le marchand d'un abonnement prévu à 9,95 € n'est pas ce prélèvement."""
    add_forecast(db, "Audible Amazon", 9.95, days_ago(26), category="Abonnements")
    bank([(days_ago(20), -81.7, "AMAZON PAYMENTS EUROPE S C A AMA")])

    run_statement(db)

    line = db.query(Transaction).filter(Transaction.amount == 81.7).one()
    assert line.reconciliation_date is not None
    assert db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.action.like("%DUPLICATE%")).count() == 0
