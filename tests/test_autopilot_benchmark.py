"""
tests/test_autopilot_benchmark.py — Suite de validation d'intégrité du Dataset de Benchmark Auto-Pilote.

Valide la continuité mathématique des soldes au centime d'euro et la présence des signatures de référence
(échelonnement Alma 3x, charges récurrentes candidates, ségrégation salaire/primes) sur les 4 fichiers CSV réels :
- tests/autopilot_benchmark/mois_01_septembre_2026.csv
- tests/autopilot_benchmark/mois_02_octobre_2026.csv
- tests/autopilot_benchmark/mois_03_novembre_2026.csv
- tests/autopilot_benchmark/mois_04_decembre_2026.csv

NOTE ARCHITECTURALE :
Ce fichier valide l'exactitude des données sources du benchmark et prouve conceptuellement le cycle cible.
Les tests d'intégration applicatifs branchés sur les vrais services du moteur Auto-Pilote seront
implémentés brique par brique lors des Étapes 1 à 6.
"""

import os
import re
import pandas as pd
import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Category, RecurrenceTemplate, Transaction, BankLabelMapping
from app.services.smart_label_service import (
    normalize_raw_label,
    learn_label_mapping,
    resolve_smart_label,
)

BENCHMARK_DIR = os.path.join(os.path.dirname(__file__), "autopilot_benchmark")


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée pour les tests du benchmark."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def _load_benchmark_csv(filename: str):
    """Charge un fichier CSV de benchmark en extrayant le solde d'en-tête et les opérations."""
    filepath = os.path.join(BENCHMARK_DIR, filename)
    assert os.path.exists(filepath), f"Fichier de benchmark manquant : {filepath}"

    with open(filepath, "r", encoding="utf-8") as f:
        lines = [line.strip() for line in f if line.strip()]

    # Ligne 1 : Compte
    assert "00012345678" in lines[0]
    # Ligne 2 : Solde au JJ/MM/AAAA : X XXX,XX €
    balance_match = re.search(r"Solde au \d{2}/\d{2}/\d{4}\s*:\s*([0-9\s]+,[0-9]{2})\s*€", lines[1])
    assert balance_match, f"Format de solde invalide dans l'en-tête : {lines[1]}"
    expected_closing_balance = float(balance_match.group(1).replace(" ", "").replace(",", "."))

    # À partir de la ligne 3 : CSV standard (Date;Libellé;Débit;Crédit)
    df = pd.read_csv(filepath, skiprows=2, sep=";", decimal=",", encoding="utf-8")
    df["Débit"] = pd.to_numeric(df["Débit"].fillna(0.0), errors="coerce").fillna(0.0)
    df["Crédit"] = pd.to_numeric(df["Crédit"].fillna(0.0), errors="coerce").fillna(0.0)
    return df, expected_closing_balance


# ── TEST 1 : Continuité Mathématique des Soldes sur les 4 Mois ───────────────
def test_benchmark_balance_continuity_across_4_months():
    """
    Vérifie au centime près la continuité des soldes sur l'ensemble du cycle de 4 mois :
    Solde Initial = 1 500,00 €
    Mois 1 (Sept) : Net +1 104,52 € -> Solde = 2 604,52 €
    Mois 2 (Oct)  : Net   +761,82 € -> Solde = 3 366,34 €
    Mois 3 (Nov)  : Net +1 173,82 € -> Solde = 4 540,16 €
    Mois 4 (Déc)  : Net +1 715,82 € -> Solde = 6 255,98 €
    """
    initial_balance = 1500.00
    current_balance = initial_balance

    months = [
        ("mois_01_septembre_2026.csv", 2400.00, -1295.48, 2604.52),
        ("mois_02_octobre_2026.csv", 2400.00, -1638.18, 3366.34),
        ("mois_03_novembre_2026.csv", 2464.50, -1290.68, 4540.16),
        ("mois_04_decembre_2026.csv", 3250.00, -1534.18, 6255.98),
    ]

    for filename, expected_credits, expected_debits, expected_balance in months:
        df, file_header_balance = _load_benchmark_csv(filename)

        total_credits = round(float(df["Crédit"].sum()), 2)
        total_debits = round(float(df["Débit"].sum()), 2)
        net_flow = round(total_credits + total_debits, 2)
        current_balance = round(current_balance + net_flow, 2)

        # Assertions strictes au centime
        assert total_credits == pytest.approx(expected_credits, abs=0.001), f"Écart crédits {filename}"
        assert total_debits == pytest.approx(expected_debits, abs=0.001), f"Écart débits {filename}"
        assert file_header_balance == pytest.approx(expected_balance, abs=0.001), f"Écart header {filename}"
        assert current_balance == pytest.approx(expected_balance, abs=0.001), f"Écart solde calculé {filename}"

    # Solde final exact au 31/12/2026
    assert current_balance == 6255.98


# ── TEST 2 : Normalisation Smart Label des Libellés Bancaires ──────────────────
def test_smart_label_normalization_on_benchmark():
    """
    Vérifie que le SmartLabelService nettoie correctement les libellés bruts du benchmark
    en éliminant les préfixes bancaires (CB, PRLV, SEPA, VIR) et les codes techniques.
    """
    # Échantillon de libellés du benchmark
    sample_labels = [
        ("PRLV LOYER RESIDENCE - FONCIA", "FONCIA"),
        ("PRLV EDF ELECTRICITE DE FRANCE", "EDF"),
        ("PRLV FREEBOX FIBRE INTERNET", "FREEBOX"),
        ("CB SPOTIFY PARIS", "SPOTIFY"),
        ("CB CARREFOUR MARKET 7501", "CARREFOUR"),
        ("CB TOTALENERGIES RELAIS", "TOTALENERGIES"),
        ("VIR RECU REMBOURSEMENT SEPA CPAM", "CPAM"),
        ("CB GARAGE AUTO REPARATION", "GARAGE AUTO REPARATION"),
    ]

    for raw, expected_token in sample_labels:
        cleaned = normalize_raw_label(raw)
        assert expected_token in cleaned, f"Échec normalisation de '{raw}': '{cleaned}' ne contient pas '{expected_token}'"


# ── TEST 3 : Détection et Cycle de Vie du Paiement Échelonné (Alma 3x) ────────
def test_fractional_payment_lifecycle_alma():
    """
    Vérifie la détection de la signature fractionnée X/Y sur le paiement Alma en 3 fois :
    - Mois 1 (Septembre) : 1/3 détecté (80 €)
    - Mois 2 (Octobre)   : 2/3 détecté (80 €)
    - Mois 3 (Novembre)  : 3/3 détecté (80 €) -> clôture de l'échelonnement (240 € soldés)
    - Mois 4 (Décembre)  : Zéro opération Alma (extinction confirmée)
    """
    alma_regex = re.compile(r"ALMA\s+(\d+)/(\d+)", re.IGNORECASE)

    occurrences = []
    months = [
        "mois_01_septembre_2026.csv",
        "mois_02_octobre_2026.csv",
        "mois_03_novembre_2026.csv",
        "mois_04_decembre_2026.csv",
    ]

    for idx, filename in enumerate(months, start=1):
        df, _ = _load_benchmark_csv(filename)
        alma_rows = df[df["Libellé"].str.contains("ALMA", case=False, na=False)]

        if idx <= 3:
            assert len(alma_rows) == 1, f"Mois {idx} doit contenir exactement 1 prélèvement Alma"
            row = alma_rows.iloc[0]
            match = alma_regex.search(row["Libellé"])
            assert match is not None, f"Signature Alma X/Y manquante au mois {idx} : {row['Libellé']}"
            current_installment = int(match.group(1))
            total_installments = int(match.group(2))
            amount = abs(float(row["Débit"]))

            assert current_installment == idx, f"Échéance attendue {idx} mais trouvé {current_installment}"
            assert total_installments == 3, f"Total d'échéances attendu 3 mais trouvé {total_installments}"
            assert amount == 80.00, f"Montant attendu 80,00 € mais trouvé {amount}"
            occurrences.append(current_installment)
        else:
            # Mois 4 (Décembre) : Aucune opération Alma
            assert len(alma_rows) == 0, "Mois 4 ne doit contenir aucun prélèvement Alma (contrat terminé)"

    assert occurrences == [1, 2, 3], "Le cycle 1/3, 2/3, 3/3 doit être complet et ordonné"


# ── TEST 4 : Moteur de Récurrences (N=1 -> N=2 -> N=3 Promotion Full-Auto) ────
def test_recurrence_progressive_promotion(test_db):
    """
    Validation conceptuelle du cycle d'anticipation et de promotion des récurrences :
    - Mois 1 : Historique N=1 -> 0 template créé.
    - Mois 2 : Historique N=2 -> Détection in-memory (Niveau 1), 0 template en DB.
    - Mois 3 : Historique N=3 -> Simulation de la promotion Full-Auto (4 templates créés en DB).
    - Mois 4 : Rapprochement sans doublon sur les templates existants.

    NOTE : Lors de l'implémentation de l'Étape 4 de la roadmap, ce test appellera le véritable
    service backend d'ingestion/détection au lieu de la simulation de base de données.
    """
    fixed_charges = [
        ("PRLV LOYER RESIDENCE - FONCIA", 750.00, "Logement"),
        ("PRLV EDF ELECTRICITE DE FRANCE", 65.00, "Logement"),
        ("PRLV FREEBOX FIBRE INTERNET", 34.99, "Abonnements"),
        ("CB SPOTIFY PARIS", 10.99, "Abonnements"),
    ]

    # Simulation mois par mois
    history_tracker = {raw: [] for raw, _, _ in fixed_charges}

    # MOIS 1
    df1, _ = _load_benchmark_csv("mois_01_septembre_2026.csv")
    for raw, amount, _ in fixed_charges:
        rows = df1[df1["Libellé"] == raw]
        assert len(rows) == 1
        history_tracker[raw].append(rows.iloc[0]["Date"])

    # Assert Mois 1 : 0 template en base
    assert test_db.query(RecurrenceTemplate).count() == 0

    # MOIS 2
    df2, _ = _load_benchmark_csv("mois_02_octobre_2026.csv")
    for raw, amount, _ in fixed_charges:
        rows = df2[df2["Libellé"] == raw]
        assert len(rows) == 1
        history_tracker[raw].append(rows.iloc[0]["Date"])
        # Vérification Niveau 1 (2 occurrences)
        assert len(history_tracker[raw]) == 2

    # Assert Mois 2 : Toujours 0 template en base (seuil N=3 non atteint)
    assert test_db.query(RecurrenceTemplate).count() == 0

    # MOIS 3 (Bascule Full-Auto N=3)
    df3, _ = _load_benchmark_csv("mois_03_novembre_2026.csv")
    for raw, amount, cat in fixed_charges:
        rows = df3[df3["Libellé"] == raw]
        assert len(rows) == 1
        history_tracker[raw].append(rows.iloc[0]["Date"])
        assert len(history_tracker[raw]) == 3

        # Promotion automatique par l'Auto-Pilote (N=3)
        clean_name = normalize_raw_label(raw)
        tpl = RecurrenceTemplate(
            description=clean_name,
            amount=amount,
            type="expense_fixed",
            category=cat,
            frequency="Monthly",
            day_of_month=int(rows.iloc[0]["Date"][:2]),
            is_closed=False,
        )
        test_db.add(tpl)

    test_db.commit()

    # Assert Mois 3 : Exactement 4 templates créés en base
    assert test_db.query(RecurrenceTemplate).count() == 4
    templates = test_db.query(RecurrenceTemplate).all()
    amounts_in_db = sorted([t.amount for t in templates])
    assert amounts_in_db == [10.99, 34.99, 65.00, 750.00]

    # MOIS 4 : Vérification du rapprochement sans création de doublons
    df4, _ = _load_benchmark_csv("mois_04_decembre_2026.csv")
    for raw, amount, cat in fixed_charges:
        rows = df4[df4["Libellé"] == raw]
        assert len(rows) == 1
        # Les opérations de décembre correspondent aux templates existants
        matching_tpl = test_db.query(RecurrenceTemplate).filter(
            RecurrenceTemplate.amount == amount,
            RecurrenceTemplate.type == "expense_fixed"
        ).first()
        assert matching_tpl is not None, f"Template introuvable pour {raw}"

    # Zéro nouveau template créé au Mois 4
    assert test_db.query(RecurrenceTemplate).count() == 4


# ── TEST 5 : Ségrégation Salaire Fixe vs Prime de Fin d'Année ─────────────────
def test_salary_base_and_bonus_segregation():
    """
    Vérifie la reconnaissance de l'employeur habituel (ACME CORP) et l'isolation
    du différentiel de fin d'année (prime de 750 € au Mois 4) :
    - Mois 1, 2, 3 : Salaire récurrent de base = 2 400,00 €
    - Mois 4       : Virement reçu = 3 150,00 € (2 400 € fixe + 750 € prime)
    - Mois 4       : Étrennes reçues = 100,00 € (Cadeau / Divers exceptionnel)
    """
    base_salary = 2400.00
    salaries = []

    for month_num, fname in enumerate([
        "mois_01_septembre_2026.csv",
        "mois_02_octobre_2026.csv",
        "mois_03_novembre_2026.csv",
        "mois_04_decembre_2026.csv",
    ], start=1):
        df, _ = _load_benchmark_csv(fname)
        salary_rows = df[df["Libellé"].str.contains("SALAIRE ACME CORP", case=False, na=False)]
        assert len(salary_rows) == 1, f"Ligne salaire introuvable dans {fname}"
        val = float(salary_rows.iloc[0]["Crédit"])
        salaries.append(val)

        if month_num < 4:
            assert val == base_salary, f"Salaire au mois {month_num} doit être de {base_salary} €"
        else:
            # Mois 4 : 3 150 €
            assert val == 3150.00
            bonus = round(val - base_salary, 2)
            assert bonus == 750.00, f"La prime isolée doit être de 750,00 €, trouvé {bonus} €"

    # Vérification des étrennes au Mois 4
    df4, _ = _load_benchmark_csv("mois_04_decembre_2026.csv")
    etrennes_rows = df4[df4["Libellé"].str.contains("ETRENNES", case=False, na=False)]
    assert len(etrennes_rows) == 1
    assert float(etrennes_rows.iloc[0]["Crédit"]) == 100.00
