"""Profil neuf sans IA : moins d'opérations à vérifier, assurance de la banque et crédit reconnus, noms lisibles,
récurrences des charges fixes dès le premier mois."""
from datetime import date, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Account, AutopilotDecisionLog, GlobalConfig, RecurrenceTemplate, Transaction
from app.services import stats_cache
from app.migrations.versions import v35_full_preset_recurrence_promotion as v35
from app.services.autopilot_service import (
    process_incoming_batch,
    set_autopilot_enabled,
    set_autopilot_preset,
    set_autopilot_subtoggle,
)
from app.services.first_month_recurrences import is_monthly_family
from app.services.smart_label.categories import starter_match
from app.services.smart_label.normalization import display_name_from_label
from app.services.smart_label.resolver import resolve_smart_labels_batch


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(autocommit=False, autoflush=False, bind=engine)()
    s.add(GlobalConfig(key="enable_ai", value="false"))
    s.commit()
    stats_cache.invalidate()
    yield s
    s.close()


@pytest.mark.parametrize("label,expected", [
    ("ORANGE SA-ORANGE", ("Télécoms et internet", "expense", True)),
    ("GC RE OCTOPUS ENERGY", ("Énergie", "expense", True)),
    ("00009998887 ECHEANCE", ("Prêts et crédits", "expense", True)),
    ("ASSU. CNP PRET HABITAT", ("Assurances", "expense", True)),            # assurance du prêt
    ("Wero vers JEAN D", ("Virements envoyés", "expense", True)),
    ("0123456 CREDIT AGRICOLE CENTRE E", ("Assurances", "expense", False)),   # cotisation Pacifica, à vérifier
    ("CRCAM CENTRE-EST", ("Prêts et crédits", "expense", False)),             # mensualité de crédit, à vérifier
    ("X1234 AUCHAN SUP 247 VILLE", ("Courses", "expense", False)),            # enseigne qui vend de tout
    ("COTISATION ASSOCIATION", ("Frais bancaires", "expense", False)),        # pas forcément la banque
])
def test_keyword_families_reliable_or_to_review(label, expected):
    assert starter_match(label, "expense_var") == expected


def test_reliable_keyword_is_trusted_and_catch_all_stays_below(db):
    res = resolve_smart_labels_batch(db, ["ORANGE SA-ORANGE", "X1234 AUCHAN SUP 247 VILLE", "X1234 CAPI STYLE VILLE"],
                                     use_ai_fallback=False, auto_fallback_category=True,
                                     tx_types={l: "expense_var" for l in ["ORANGE SA-ORANGE", "X1234 AUCHAN SUP 247 VILLE",
                                                                          "X1234 CAPI STYLE VILLE"]})
    assert res["ORANGE SA-ORANGE"]["confidence"] >= 0.85
    assert res["X1234 AUCHAN SUP 247 VILLE"]["confidence"] < 0.85
    shop = res["X1234 CAPI STYLE VILLE"]
    assert shop["smart_is_fallback"] is True
    assert shop["confidence"] < res["X1234 AUCHAN SUP 247 VILLE"]["confidence"]  # le fourre-tout ne passe pas devant


@pytest.mark.parametrize("raw,name", [
    ("00009998887 ECHEANCE", "Échéance prêt …8887"),
    ("0123456 CREDIT AGRICOLE CENTRE E", "Assurance Crédit Agricole"),
    ("CRCAM CENTRE-EST", "Prêt Crédit Agricole"),
    ("DIRECTION GENERALE DES FINANCES", "Impôts (DGFiP)"),
    ("Wero vers JEAN D", "Wero vers Jean D"),
])
def test_readable_names(raw, name):
    assert display_name_from_label(raw) == name


def test_monthly_families():
    assert all(is_monthly_family(c) for c in ("Assurances", "Prêts et crédits", "Télécoms et internet", "Énergie"))
    assert not any(is_monthly_family(c) for c in ("Abonnements", "Impôts", "Courses", None))


def _line(acc, day, raw_amount, label, n):
    return {"date_operation": (date.today() - timedelta(days=day)).isoformat(), "amount": abs(raw_amount),
            "raw_amount": raw_amount, "description": label, "raw_description": label, "csv_id": f"woob_fm_{n}",
            "account_id": acc.id, "account_name": acc.name, "is_reconciled": False, "already_reconciled": False,
            "matched_db_id": None}


def _statement(db, promote: bool):
    set_autopilot_enabled(db, True, preset="full")  # Autonomie totale allume la création des récurrences
    if not promote:
        set_autopilot_subtoggle(db, "auto_promote_recurrences", False)
    cc = Account(name="Compte courant", type="Compte courant", initial_balance=0)
    db.add(cc)
    db.commit()
    preview = {"connection_id": 1, "accounts": [{"account_id": cc.id, "account_name": cc.name, "transactions": [
        _line(cc, 12, -46.79, "ORANGE SA-ORANGE", 1),
        _line(cc, 10, -47.94, "0123456 CREDIT AGRICOLE CENTRE E", 2),
        _line(cc, 10, -22.50, "0123456 CREDIT AGRICOLE CENTRE E", 3),
        _line(cc, 8, -137.50, "X1234 Google Play Apps Dub", 4),   # achat ponctuel possible : pas de récurrence
        _line(cc, 6, -72.00, "DIRECTION GENERALE DES FINANCES", 5),
        _line(cc, 4, -5.22, "X1234 UEP*ALIM SUPER U VIL", 6),
        _line(cc, 3, -70.00, "CB TOTALENERGIES RELAIS", 7),          # plein à la pompe, pas un contrat d'énergie
    ]}]}
    process_incoming_batch(db, conn_id=1, preview_data=preview)
    return cc


def test_fixed_charges_get_a_monthly_recurrence_from_the_first_month(db):
    cc = _statement(db, promote=True)
    tpls = {round(t.amount, 2): t for t in db.query(RecurrenceTemplate).all()}
    assert set(tpls) == {46.79, 47.94, 22.50}
    orange = tpls[46.79]
    assert orange.frequency == "Monthly" and orange.category == "Télécoms et internet" and orange.from_account_id == cc.id
    real = db.query(Transaction).filter(Transaction.csv_id == "woob_fm_1").one()
    assert real.recurrence_id == orange.id
    upcoming = db.query(Transaction).filter(Transaction.recurrence_id == orange.id, Transaction.id != real.id).all()
    assert upcoming and all(t.date_operation > real.date_operation for t in upcoming)
    logs = db.query(AutopilotDecisionLog).filter(AutopilotDecisionLog.decision_type == "recurrence_promotion").all()
    assert len(logs) == 3 and all('"first_month_fixed"' in l.raw_snapshot for l in logs)


def test_no_first_month_recurrence_when_promotion_is_off(db):
    _statement(db, promote=False)
    assert db.query(RecurrenceTemplate).count() == 0


def _cfg(db, key):
    row = db.query(GlobalConfig).filter(GlobalConfig.key == key).first()
    return row.value if row else None


def test_full_autonomy_turns_on_recurrence_creation_with_a_start_date(db):
    set_autopilot_preset(db, "full")
    assert _cfg(db, "auto_promote_recurrences") == "true"
    assert _cfg(db, "auto_promote_recurrences_since") == (date.today() - timedelta(days=45)).isoformat()
    set_autopilot_preset(db, "balanced")
    assert _cfg(db, "auto_promote_recurrences") == "false"
    assert _cfg(db, "auto_promote_recurrences_since") == (date.today() - timedelta(days=45)).isoformat()  # gardée


def test_a_start_date_chosen_by_the_user_is_kept(db):
    db.add(GlobalConfig(key="auto_promote_recurrences_since", value="2026-01-15"))
    db.commit()
    set_autopilot_preset(db, "full")
    assert _cfg(db, "auto_promote_recurrences_since") == "2026-01-15"


def test_migration_keeps_existing_full_autonomy_profiles_full(db):
    for key in v35._PREVIOUS_FULL_KEYS:
        db.add(GlobalConfig(key=key, value="true"))
    db.commit()
    v35.upgrade(db.connection())
    db.commit()
    assert _cfg(db, "auto_promote_recurrences") == "true"
    assert _cfg(db, "auto_promote_recurrences_since") == (date.today() - timedelta(days=45)).isoformat()


def test_migration_leaves_other_profiles_alone(db):
    for key in v35._PREVIOUS_FULL_KEYS[:7]:
        db.add(GlobalConfig(key=key, value="true"))
    db.commit()
    v35.upgrade(db.connection())
    db.commit()
    assert _cfg(db, "auto_promote_recurrences") is None


def test_first_statement_aligns_the_opening_balance_with_the_bank(db):
    set_autopilot_enabled(db, True, preset="full")
    cc = Account(name="Compte courant", type="Compte courant", initial_balance=1000.0)  # solde du jour, à la création
    db.add(cc)
    db.commit()
    lines = [_line(cc, 20, -300.0, "CB SUPER U", 21), _line(cc, 10, 2000.0, "VIR SALAIRE ACME", 22)]
    preview = {"connection_id": 1, "accounts": [{"account_id": cc.id, "account_name": cc.name, "bank_balance": 1000.0,
                                                 "transactions": lines}]}
    process_incoming_batch(db, conn_id=1, preview_data=preview)
    from app.services.finance_engine import calculate_balances
    db.refresh(cc)
    assert cc.initial_balance == -700.0
    assert round(calculate_balances(db, only_reconciled=True)[cc.id], 2) == 1000.0
    # Relevé suivant : le compte a son historique, plus de recalage
    preview2 = {"connection_id": 1, "accounts": [{"account_id": cc.id, "account_name": cc.name, "bank_balance": 9999.0,
                                                  "transactions": [_line(cc, 1, -50.0, "CB BOULANGERIE", 23)]}]}
    process_incoming_batch(db, conn_id=1, preview_data=preview2)
    db.refresh(cc)
    assert cc.initial_balance == -700.0


def test_the_bank_announced_next_debit_stands_in_for_the_forecast(db):
    set_autopilot_enabled(db, True, preset="full")
    cc = Account(name="Compte courant", type="Compte courant", initial_balance=0)
    db.add(cc)
    db.commit()
    coming = _line(cc, -2, -171.07, "GC RE OCTOPUS ENERGY", 31)   # dans 2 jours, annoncée par la banque
    coming.update({"is_coming": True, "csv_id": "woob_coming_fm_31"})
    preview = {"connection_id": 1, "accounts": [{"account_id": cc.id, "account_name": cc.name, "transactions": [
        _line(cc, 29, -171.07, "GC RE OCTOPUS ENERGY", 30), coming]}]}
    process_incoming_batch(db, conn_id=1, preview_data=preview)
    tpl = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.amount == 171.07).one()
    soon = db.query(Transaction).filter(Transaction.recurrence_id == tpl.id, Transaction.reconciliation_date.is_(None),
                                        Transaction.date_operation <= date.today() + timedelta(days=20)).all()
    assert [t.csv_id for t in soon] == ["woob_coming_fm_31"]  # pas de prévision en double à côté


def test_decision_times_carry_their_time_zone():
    from datetime import datetime
    from app.schemas.api_schemas import AutopilotDecisionItem
    item = AutopilotDecisionItem(id=1, batch_id="b", decision_type="new_entry", action="AUTO_COMMIT",
                                 entity_type="transaction", label="x", amount=-1.0,
                                 created_at=datetime(2026, 11, 7, 17, 57, 34))
    assert item.model_dump_json().count("2026-11-07T17:57:34Z") == 1
