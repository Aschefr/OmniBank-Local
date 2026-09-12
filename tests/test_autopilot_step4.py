"""
tests/test_autopilot_step4.py — Suite de validation automatisée pour l'Étape 4 de la roadmap Auto-Pilote.

Périmètre :
- T4.1 : Détection et parsing des signatures fractionnées (Alma, Klarna, Oney M/N).
- T4.2 : Ségrégation stricte dépenses vs recettes/remboursements (virement CPAM jamais promu).
- T4.3 : Cycle de vie du paiement fractionné Alma (1/3 -> 2/3 -> 3/3 -> clôture is_closed = True).
- T4.4 : Anticipation dynamique Reste à Vivre (N=2) et garde-fou anti-doublon.
- T4.5 : Promotion Full-Auto (N >= 3) des abonnements réguliers avec liaison rétroactive.
- T4.6 : Intégration de bout en bout sur le benchmark réel des 4 mois (Septembre à Décembre 2026).
"""

import os
import re
import pytest
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import (
    Account,
    Transaction,
    Category,
    RecurrenceTemplate,
    AutopilotDecisionLog,
    GlobalConfig,
)
from app.services.recurrence_detector import (
    parse_fractional_signature,
    detect_candidate_recurring_expenses,
    process_recurrence_promotions,
    get_clean_merchant,
)
from app.services.finance_engine import calculate_rest_to_live, get_anticipated_candidate_charges
from app.services.autopilot_service import process_incoming_batch
from app.services import stats_cache
from tests.test_autopilot_benchmark import _load_benchmark_csv, BENCHMARK_DIR


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée pour les tests de l'Étape 4."""
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
        GlobalConfig(key="base_pay_day", value="28"),
        Category(name="Logement", type="expense_fixed"),
        Category(name="Abonnements", type="expense_fixed"),
        Category(name="Alimentation", type="expense_var"),
        Category(name="Santé", type="expense_var"),
        Category(name="Achats", type="expense_var"),
        Category(name="Salaire", type="income"),
    ])
    db.commit()

    try:
        yield db
    finally:
        stats_cache.invalidate()
        db.close()


# ── T4.1 : Parsing des signatures de paiements fractionnés ────────────────────
def test_parse_fractional_signature():
    """Vérifie l'extraction regex des signatures fractionnées Alma, Klarna, Oney, Floa, Cofidis."""
    valid_cases = [
        ("PRLV ALMA 1/3 80,00 €", ("ALMA", 1, 3)),
        ("CB ALMA 2/3", ("ALMA", 2, 3)),
        ("ALMA 3/3 FIN", ("ALMA", 3, 3)),
        ("PRLV KLARNA 2/4 PARIS", ("KLARNA", 2, 4)),
        ("CB ONEY 1x3 FNAC", ("ONEY", 1, 3)),
        ("FLOA 1/4 BILLET", ("FLOA", 1, 4)),
        ("COFIDIS 3/10 ECHEANCE", ("COFIDIS", 3, 10)),
    ]
    for raw, expected in valid_cases:
        res = parse_fractional_signature(raw)
        assert res == expected, f"Échec d'extraction pour '{raw}': attendu {expected}, reçu {res}"

    invalid_cases = [
        "CB SPOTIFY PARIS",
        "PRLV EDF ELECTRICITE DE FRANCE",
        "VIR RECU CPAM 64,50",
        "ALMA 0/3",       # M = 0 invalide
        "KLARNA 5/4",      # M > N invalide
        "ONEY 1/15",      # N > 12 rejeté par garde-fou anti-promotion infinie
        "",
        None,
    ]
    for raw in invalid_cases:
        assert parse_fractional_signature(raw) is None, f"Devrait être rejeté : '{raw}'"


# ── T4.2 : Ségrégation stricte dépenses vs recettes/remboursements ────────────
def test_strict_expense_filter_non_promotion_of_incomes(test_db):
    """
    Vérifie que les remboursements de santé (CPAM) et virements entrants répétés
    ne sont JAMAIS détectés comme charges récurrentes candidates ni promus en templates.
    """
    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    # 3 virements CPAM mensuels réguliers de 64,50 €
    dates = [date(2026, 9, 15), date(2026, 10, 15), date(2026, 11, 15)]
    for d in dates:
        test_db.add(Transaction(
            date_saisie=d,
            date_operation=d,
            description="VIR RECU REMBOURSEMENT SEPA CPAM",
            amount=64.50,
            type="income",
            to_account_id=acc.id,
            reconciliation_date=d
        ))
    test_db.commit()

    # 1. Vérifier qu'aucune charge candidate n'est détectée
    candidates = detect_candidate_recurring_expenses(test_db, acc.id, date(2026, 11, 20), date(2026, 11, 28))
    assert len(candidates) == 0, "Les recettes CPAM ne doivent pas être détectées en charges candidates"

    # 2. Vérifier qu'aucune promotion n'est effectuée
    summary = process_recurrence_promotions(test_db, acc.id)
    assert summary["promoted_templates"] == 0
    assert test_db.query(RecurrenceTemplate).count() == 0, "Aucun template ne doit être créé pour un revenu"


# ── T4.3 : Cycle de vie du paiement fractionné Alma (1/3 -> 2/3 -> 3/3) ───────
def test_fractional_payment_lifecycle_alma(test_db):
    """
    Valide le cycle de vie complet d'un paiement en 3 fois (Alma) :
    - Échéance 1/3 : création du template borné (max_occurrences = 3, is_closed = False).
    - Échéance 2/3 : liaison rétroactive, maintien actif.
    - Échéance 3/3 : liaison rétroactive et clôture automatique finale (is_closed = True).
    """
    acc = Account(name="Courant", type="Compte courant", initial_balance=2000.0)
    test_db.add(acc)
    test_db.commit()

    # Mois 1 : Alma 1/3 (80 €)
    tx1 = Transaction(
        date_saisie=date(2026, 9, 10),
        date_operation=date(2026, 9, 10),
        description="PRLV ALMA 1/3 80,00 €",
        amount=80.00,
        type="expense_var",
        from_account_id=acc.id,
        reconciliation_date=date(2026, 9, 10)
    )
    test_db.add(tx1)
    test_db.commit()

    process_recurrence_promotions(test_db, acc.id)
    tpl = test_db.query(RecurrenceTemplate).filter(RecurrenceTemplate.amount == 80.00).first()
    assert tpl is not None, "Le template Alma 3x doit être créé dès la première échéance"
    assert tpl.max_occurrences == 3
    assert tpl.is_closed is False, "Le template doit être actif à l'échéance 1/3"
    assert tx1.recurrence_id == tpl.id, "La transaction 1/3 doit être liée au template"

    # Mois 2 : Alma 2/3 (80 €)
    tx2 = Transaction(
        date_saisie=date(2026, 10, 10),
        date_operation=date(2026, 10, 10),
        description="PRLV ALMA 2/3 80,00 €",
        amount=80.00,
        type="expense_var",
        from_account_id=acc.id,
        reconciliation_date=date(2026, 10, 10)
    )
    test_db.add(tx2)
    test_db.commit()

    process_recurrence_promotions(test_db, acc.id)
    test_db.refresh(tpl)
    assert tpl.is_closed is False, "Le template doit rester actif à l'échéance 2/3"
    assert tx2.recurrence_id == tpl.id, "La transaction 2/3 doit être liée au template"

    # Mois 3 : Alma 3/3 (80 €) -> Dernière échéance M = N
    tx3 = Transaction(
        date_saisie=date(2026, 11, 10),
        date_operation=date(2026, 11, 10),
        description="PRLV ALMA 3/3 80,00 €",
        amount=80.00,
        type="expense_var",
        from_account_id=acc.id,
        reconciliation_date=date(2026, 11, 10)
    )
    test_db.add(tx3)
    test_db.commit()

    process_recurrence_promotions(test_db, acc.id)
    test_db.refresh(tpl)
    assert tpl.is_closed is True, "Le template Alma DOIT être clôturé à l'échéance finale 3/3"
    assert tx3.recurrence_id == tpl.id, "La transaction 3/3 doit être liée au template"

    # Les templates actifs (is_closed == False) ne doivent plus inclure Alma
    active_tpls = test_db.query(RecurrenceTemplate).filter(RecurrenceTemplate.is_closed == False).all()
    assert len(active_tpls) == 0, "Aucun template actif ne doit subsister après extinction Alma"


# ── T4.4 : Anticipation Reste à Vivre (N=2) et Garde-fou Anti-Doublon ─────────
def test_rest_to_live_candidate_charges_level1_and_anti_doublon(test_db):
    """
    Vérifie l'impact des charges candidates (N=2) dans le calcul du Reste à Vivre :
    - Avant prélèvement du mois en cours : la charge de 750 € est déduite du Reste à Vivre.
    - Après prélèvement du mois en cours : le garde-fou anti-doublon empêche de la soustraire à nouveau.
    """
    acc = Account(name="Courant", type="Compte courant", initial_balance=3000.0)
    test_db.add(acc)
    test_db.commit()
    test_db.add(GlobalConfig(key="main_account_id", value=str(acc.id)))
    test_db.commit()

    # 2 débits Foncia consécutifs au 05/09 et 05/10 (N=2)
    tx_sept = Transaction(
        date_saisie=date(2026, 9, 5),
        date_operation=date(2026, 9, 5),
        description="PRLV LOYER RESIDENCE - FONCIA",
        amount=750.00,
        type="expense_fixed",
        from_account_id=acc.id,
        reconciliation_date=date(2026, 9, 5)
    )
    tx_oct = Transaction(
        date_saisie=date(2026, 10, 5),
        date_operation=date(2026, 10, 5),
        description="PRLV LOYER RESIDENCE - FONCIA",
        amount=750.00,
        type="expense_fixed",
        from_account_id=acc.id,
        reconciliation_date=date(2026, 10, 5)
    )
    test_db.add_all([tx_sept, tx_oct])
    test_db.commit()

    # Cas A : Début Novembre 2026 (le 01/11), avant le débit de Novembre.
    # Prochaine paie le 28/11. Solde actuel = 3000 - 1500 = 1500 €.
    # Foncia (750 €) doit être anticipé dans le Reste à Vivre => RAV = 1500 - 750 = 750 €.
    current_date_a = date(2026, 11, 1)
    next_pay_date_a = date(2026, 11, 28)

    candidates = detect_candidate_recurring_expenses(test_db, acc.id, current_date_a, next_pay_date_a)
    assert len(candidates) == 1, "Foncia doit être détectée en charge candidate N=2"
    assert candidates[0]["amount"] == 750.00

    rav_a = calculate_rest_to_live(test_db, current_date_a, next_pay_date_a)
    assert rav_a == pytest.approx(750.00, abs=0.01), f"Le RAV attendu est 750 €, calculé: {rav_a}"

    # Cas B : Le 06/11/2026, après que le loyer de Novembre a été débité et rapproché.
    # Solde = 3000 - 2250 = 750 €.
    # Le garde-fou anti-doublon doit s'activer : Foncia ne doit plus être déduit une seconde fois !
    tx_nov = Transaction(
        date_saisie=date(2026, 11, 5),
        date_operation=date(2026, 11, 5),
        description="PRLV LOYER RESIDENCE - FONCIA",
        amount=750.00,
        type="expense_fixed",
        from_account_id=acc.id,
        reconciliation_date=date(2026, 11, 5)
    )
    test_db.add(tx_nov)
    test_db.commit()
    stats_cache.invalidate()

    current_date_b = date(2026, 11, 6)
    candidates_b = detect_candidate_recurring_expenses(test_db, acc.id, current_date_b, next_pay_date_a)
    assert len(candidates_b) == 0, "Garde-fou anti-doublon : la charge ne doit plus être candidate car déjà débitée"

    rav_b = calculate_rest_to_live(test_db, current_date_b, next_pay_date_a)
    assert rav_b == pytest.approx(750.00, abs=0.01), f"Le RAV après paiement doit rester 750 € sans double déduction, calculé: {rav_b}"


# ── T4.5 : Promotion Full-Auto (N >= 3) des abonnements réguliers ────────────
def test_full_auto_promotion_n3(test_db):
    """
    Vérifie qu'à la 3ème occurrence mensuelle consécutive (N=3) :
    - Un RecurrenceTemplate permanent (is_closed = False) est créé automatiquement.
    - Les 3 transactions passées sont rétroactivement rattachées (recurrence_id).
    - La décision est enregistrée dans AutopilotDecisionLog.
    """
    acc = Account(name="Courant", type="Compte courant", initial_balance=1000.0)
    test_db.add(acc)
    test_db.commit()

    # 3 débits Freebox consécutifs (34,99 €)
    d1 = date(2026, 9, 8)
    d2 = date(2026, 10, 8)
    d3 = date(2026, 11, 8)

    txs = [
        Transaction(date_saisie=d1, date_operation=d1, description="PRLV FREEBOX FIBRE INTERNET", amount=34.99, type="expense_var", from_account_id=acc.id, reconciliation_date=d1),
        Transaction(date_saisie=d2, date_operation=d2, description="PRLV FREEBOX FIBRE INTERNET", amount=34.99, type="expense_var", from_account_id=acc.id, reconciliation_date=d2),
        Transaction(date_saisie=d3, date_operation=d3, description="PRLV FREEBOX FIBRE INTERNET", amount=34.99, type="expense_var", from_account_id=acc.id, reconciliation_date=d3),
    ]
    test_db.add_all(txs)
    test_db.commit()

    summary = process_recurrence_promotions(test_db, acc.id)
    assert summary["promoted_templates"] == 1, "Exactement 1 template doit être promu pour Freebox"

    tpl = test_db.query(RecurrenceTemplate).filter(RecurrenceTemplate.amount == 34.99).first()
    assert tpl is not None
    assert tpl.is_closed is False
    assert tpl.type == "expense_fixed"
    assert tpl.frequency == "Monthly"

    # Vérification de la liaison rétroactive
    for t in txs:
        test_db.refresh(t)
        assert t.recurrence_id == tpl.id, f"La transaction {t.id} doit être liée au template"
        assert t.type == "expense_fixed"

    # Vérification du Decision Log
    decision = test_db.query(AutopilotDecisionLog).filter(
        AutopilotDecisionLog.decision_type == "recurrence_promotion",
        AutopilotDecisionLog.entity_id == tpl.id
    ).first()
    assert decision is not None
    assert decision.action == "AUTO_COMMIT"


# ── T4.6 : Test d'intégration complet sur le benchmark réel (Mois 1 à Mois 4) ─
def test_autopilot_benchmark_end_to_end_4_months(test_db):
    """
    Exécute le cycle complet des 4 mois de relevés bancaires réels du benchmark :
    - Mois 1 (Septembre) : Ingestion, Alma 1/3 borné créé, 0 template d'abonnement.
    - Mois 2 (Octobre)   : Alma 2/3 honoré, charges candidates N=2 anticipées dans le RAV, 0 template ordinaire.
    - Mois 3 (Novembre)  : Bascule Full-Auto N=3 -> EXACTEMENT 4 templates actifs (Foncia, EDF, Freebox, Spotify), Alma 3/3 clôturé.
    - Mois 4 (Décembre)  : Rapprochement parfait sur prévisions existantes, 0 nouveau template, extinction confirmée Alma.
    """
    acc = Account(name="Compte Courant Principal", type="Compte courant", initial_balance=1500.0)
    test_db.add(acc)
    test_db.commit()
    test_db.add(GlobalConfig(key="main_account_id", value=str(acc.id)))
    test_db.commit()

    def _import_benchmark_month(filename: str):
        df, _ = _load_benchmark_csv(filename)
        tx_items = []
        for idx, row in df.iterrows():
            debit = float(row["Débit"])
            credit = float(row["Crédit"])
            raw_amt = debit if debit != 0.0 else credit
            tx_items.append({
                "csv_id": f"{filename}_{idx}",
                "date_operation": str(row["Date"]),
                "date": str(row["Date"]),
                "raw_description": str(row["Libellé"]),
                "description": str(row["Libellé"]),
                "amount": abs(raw_amt),
                "raw_amount": raw_amt,
                "is_reconciled": False
            })

        preview = {
            "accounts": [{
                "account_id": acc.id,
                "transactions": tx_items
            }]
        }
        return process_incoming_batch(test_db, conn_id=1, preview_data=preview)

    # 1. MOIS 1 : Septembre 2026
    res1 = _import_benchmark_month("mois_01_septembre_2026.csv")
    assert res1["status"] == "completed"

    active_tpls_m1 = test_db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed.is_(None))
    ).all()
    # Uniquement Alma 3x créé (1 template actif)
    assert len(active_tpls_m1) == 1
    assert active_tpls_m1[0].max_occurrences == 3

    # 2. MOIS 2 : Octobre 2026
    res2 = _import_benchmark_month("mois_02_octobre_2026.csv")
    assert res2["status"] == "completed"

    active_tpls_m2 = test_db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed.is_(None))
    ).all()
    # Toujours uniquement Alma (seuil N=3 non encore atteint pour les abonnements)
    assert len(active_tpls_m2) == 1

    # 3. MOIS 3 : Novembre 2026 (Promotion Full-Auto N=3)
    res3 = _import_benchmark_month("mois_03_novembre_2026.csv")
    assert res3["status"] == "completed"

    # Alma doit être clôturé (3/3 atteint)
    alma_tpl = test_db.query(RecurrenceTemplate).filter(RecurrenceTemplate.max_occurrences == 3).first()
    assert alma_tpl is not None
    assert alma_tpl.is_closed is True, "Alma DOIT être clôturé au Mois 3"

    # Vérification des templates ACTIFS au Mois 3 : EXACTEMENT 4
    active_tpls_m3 = test_db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed.is_(None))
    ).all()
    assert len(active_tpls_m3) == 4, f"Attendu exactement 4 templates actifs, trouvé {len(active_tpls_m3)}"
    amounts = sorted([t.amount for t in active_tpls_m3])
    assert amounts == [10.99, 34.99, 65.00, 750.00], f"Montants attendus [10.99, 34.99, 65.0, 750.0], trouvé {amounts}"

    # 4. MOIS 4 : Décembre 2026 (Zéro nouveau template, zéro Alma)
    res4 = _import_benchmark_month("mois_04_decembre_2026.csv")
    assert res4["status"] == "completed"

    active_tpls_m4 = test_db.query(RecurrenceTemplate).filter(
        (RecurrenceTemplate.is_closed == False) | (RecurrenceTemplate.is_closed.is_(None))
    ).all()
    assert len(active_tpls_m4) == 4, "Le Mois 4 ne doit créer aucun nouveau template (reste 4 actifs)"

    # Vérification qu'aucune transaction Alma n'a été créée en Décembre
    dec_alma = test_db.query(Transaction).filter(
        Transaction.description.ilike("%ALMA%"),
        Transaction.date_operation >= date(2026, 12, 1)
    ).all()
    assert len(dec_alma) == 0, "Aucune transaction Alma ne doit exister au Mois 4"
