"""
tests/test_csv_multi_account_import.py
--------------------------------------
Tests automatisés validant la Phase B :
1. Extraction multi-onglets XLSX avec conservation des sections de comptes
2. Mémorisation persistante du mapping fichier <-> compte dans GlobalConfig
3. Auto-assignation des comptes via mapping persistant
4. Ré-évaluation dynamique du rapprochement lors du changement de compte
"""
import io
import json
import pytest
import pandas as pd
from datetime import date
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

from app.database import Base, get_db
from app.models import Account, Transaction, GlobalConfig
from app.main import app
from app.routers.csv_manager import parse_file_to_raw_data, save_file_account_mapping
from app.routers.csv_parser import extract_all_sections_parsed
from app.services.bank_sync_service import re_evaluate_preview_data
from app.schemas.api_schemas import FileAccountMappingRequest


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée."""
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


@pytest.fixture
def client(test_db):
    """Client FastAPI avec injection de la session test_db."""
    def override_get_db():
        try:
            yield test_db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def create_mock_excel_bytes() -> bytes:
    """Génère un classeur XLSX en mémoire avec 2 onglets contenant des opérations."""
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine='openpyxl') as writer:
        df_courant = pd.DataFrame([
            ["Date", "Libellé", "Montant"],
            ["01/03/2026", "Supermarché Bio", "-45,50"],
            ["02/03/2026", "Virement Salaire", "2500,00"],
        ])
        df_courant.to_excel(writer, sheet_name="Compte Courant", index=False, header=False)

        df_livret = pd.DataFrame([
            ["Date", "Libellé", "Montant"],
            ["05/03/2026", "Intérêts Trimestriels", "35,20"],
        ])
        df_livret.to_excel(writer, sheet_name="Livret A", index=False, header=False)

    return buf.getvalue()


def test_multi_sheet_xlsx_parsing():
    """Vérifie que parse_file_to_raw_data lit toutes les feuilles d'un classeur Excel."""
    excel_content = create_mock_excel_bytes()
    raw_data = parse_file_to_raw_data("releve_bancaire.xlsx", excel_content)

    assert len(raw_data) > 0
    # Vérifier que les en-têtes de section ont été injectés pour chaque feuille
    section_headers = [row[0] for row in raw_data if row and str(row[0]).startswith("Compte :")]
    assert "Compte : Compte Courant" in section_headers
    assert "Compte : Livret A" in section_headers


def test_extract_all_sections_parsed_multi_account(test_db):
    """Vérifie que extract_all_sections_parsed extrait les comptes et leurs opérations respectives."""
    # Créer les 2 comptes correspondants en base
    acc_courant = Account(name="Compte Courant", type="checking", initial_balance=1000.0)
    acc_livret = Account(name="Livret A", type="savings", initial_balance=5000.0)
    test_db.add_all([acc_courant, acc_livret])
    test_db.commit()
    test_db.refresh(acc_courant)
    test_db.refresh(acc_livret)

    excel_content = create_mock_excel_bytes()
    raw_data = parse_file_to_raw_data("releve.xlsx", excel_content)

    accounts_out = extract_all_sections_parsed(raw_data, db=test_db)
    assert len(accounts_out) == 2

    # Vérifier le Compte Courant
    courant_data = next((a for a in accounts_out if a.get("account_id") == acc_courant.id), None)
    assert courant_data is not None
    assert len(courant_data["transactions"]) == 2
    descriptions_courant = [t["description"] for t in courant_data["transactions"]]
    assert any("Bio" in d or "Supermarché" in d for d in descriptions_courant)
    assert any("Salaire" in d for d in descriptions_courant)

    # Vérifier le Livret A
    livret_data = next((a for a in accounts_out if a.get("account_id") == acc_livret.id), None)
    assert livret_data is not None
    assert len(livret_data["transactions"]) == 1
    assert any("Intérêts" in d or "Trimestriels" in d for d in [livret_data["transactions"][0]["description"]])


def test_persistent_file_account_mapping(test_db):
    """Vérifie la sauvegarde du mapping fichier <-> compte et son utilisation automatique."""
    acc_pro = Account(name="Compte Professionnel", type="checking", initial_balance=200.0)
    test_db.add(acc_pro)
    test_db.commit()
    test_db.refresh(acc_pro)

    # Enregistrer un mapping arbitraire
    req = FileAccountMappingRequest(section_title="Onglet Export Bank 2026", account_id=acc_pro.id)
    res = save_file_account_mapping(req, db=test_db)
    assert res["ok"] is True

    # Vérifier le stockage dans GlobalConfig
    conf = test_db.query(GlobalConfig).filter(GlobalConfig.key == "file_account_mapping").first()
    assert conf is not None
    mapping_dict = json.loads(conf.value)
    assert mapping_dict.get("onglet export bank 2026") == acc_pro.id

    # Simuler des raw_data avec cet intitulé de section
    raw_data = [
        ["Compte : Onglet Export Bank 2026"],
        ["Date", "Libellé", "Montant"],
        ["10/03/2026", "Prestation Conseil", "800,00"]
    ]

    accounts_out = extract_all_sections_parsed(raw_data, db=test_db)
    assert len(accounts_out) == 1
    assert accounts_out[0]["account_id"] == acc_pro.id
    assert len(accounts_out[0]["transactions"]) == 1


def test_re_evaluate_preview_on_account_change(test_db):
    """Vérifie que changer d'account_id ré-évalue en direct le rapprochement des opérations."""
    acc1 = Account(name="Compte 1", type="checking", initial_balance=500.0)
    acc2 = Account(name="Compte 2", type="checking", initial_balance=1500.0)
    test_db.add_all([acc1, acc2])
    test_db.commit()
    test_db.refresh(acc1)
    test_db.refresh(acc2)

    # Créer une opération existante dans Compte 1
    tx_db = Transaction(
        from_account_id=acc1.id,
        date_operation=date(2026, 3, 1),
        amount=45.50,
        type="expense_var",
        description="Courses Bio Match",
        reconciliation_date=None
    )
    test_db.add(tx_db)
    test_db.commit()
    test_db.refresh(tx_db)

    # Preview initialement assigné au Compte 2 (pas de rapprochement attendu)
    preview_data = {
        "_source": "csv_import",
        "accounts": [
            {
                "account_id": acc2.id,
                "account_name": "Compte 2",
                "transactions": [
                    {
                        "csv_id": "test_tx_1",
                        "date_operation": "2026-03-01",
                        "amount": 45.50,
                        "raw_amount": -45.50,
                        "description": "Courses Bio Match",
                        "is_reconciled": False,
                        "matched_db_id": None
                    }
                ]
            }
        ]
    }

    evaluated_acc2 = re_evaluate_preview_data(test_db, preview_data)
    tx_evaluated_2 = evaluated_acc2["accounts"][0]["transactions"][0]
    assert tx_evaluated_2["is_reconciled"] is False

    # Changement d'assignation vers Compte 1
    preview_data["accounts"][0]["account_id"] = acc1.id
    preview_data["accounts"][0]["account_name"] = "Compte 1"

    evaluated_acc1 = re_evaluate_preview_data(test_db, preview_data)
    tx_evaluated_1 = evaluated_acc1["accounts"][0]["transactions"][0]
    assert tx_evaluated_1["is_reconciled"] is True
    assert tx_evaluated_1["matched_db_id"] == tx_db.id


def test_api_save_account_mapping_endpoint(client, test_db):
    """Teste l'endpoint POST /api/csv/save_account_mapping via TestClient."""
    acc = Account(name="Compte Test API", type="checking", initial_balance=0.0)
    test_db.add(acc)
    test_db.commit()
    test_db.refresh(acc)

    payload = {
        "section_title": "Extrait Compte N°48593",
        "account_id": acc.id
    }
    resp = client.post("/api/csv/save_account_mapping", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert "extrait compte n°48593" in data["mapped"]


def test_balance_rows_ignored_from_transactions(test_db):
    """Vérifie que les lignes d'arrêté ou de solde ('Solde au 06/09/2026') sont exclues des opérations et enregistrées en solde."""
    acc = Account(name="Compte Courant", type="checking", initial_balance=100.0)
    test_db.add(acc)
    test_db.commit()

    raw_data = [
        ["Date", "Description", "Montant"],
        ["01/09/2026", "Achat Carrefour", "-35,00"],
        ["06/09/2026", "Solde au 06/09/2026", "5718,76"],
        ["06/09/2026", "Virement Salaire", "2500,00"],
    ]

    accounts = extract_all_sections_parsed(raw_data, test_db)
    assert len(accounts) == 1
    txs = accounts[0]["transactions"]

    # Seules les 2 vraies opérations doivent être présentes (pas la ligne de solde)
    assert len(txs) == 2
    descs = [t["description"] for t in txs]
    assert "Achat Carrefour" in descs
    assert "Virement Salaire" in descs
    assert not any("solde au" in d.lower() for d in descs)

    # Le solde de compte doit avoir été capturé
    assert accounts[0]["bank_balance"] == 5718.76

