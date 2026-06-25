import os
import sys
import pytest
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app
from app.database import get_db
from tests.generate_test_db import build_test_db

TEST_DB_PATH = "data/omnibank_test.db"

from sqlalchemy.pool import NullPool

# Setup testing session database engine
engine = create_engine(
    f"sqlite:///{TEST_DB_PATH}",
    connect_args={"check_same_thread": False, "timeout": 30},
    poolclass=NullPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

# Apply the dependency override to the app
app.dependency_overrides[get_db] = override_get_db

@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    # Before each test, rebuild a fresh database by dropping and recreating tables on the engine
    build_test_db(engine)
    yield
    # Cleanup: dispose connections
    engine.dispose()

client = TestClient(app)

# ==============================================================================
# TEST 1: Functional core - Accounts CRUD & initial balance validation
# ==============================================================================
def test_accounts_crud():
    # List initial accounts (seeded: Compte Courant and Livret A)
    res = client.get("/api/accounts/")
    assert res.status_code == 200
    accounts = res.json()
    assert len(accounts) == 2
    assert accounts[0]["name"] == "Compte Courant"
    assert accounts[0]["initial_balance"] == 1500.0
    
    # Create new Account
    res = client.post("/api/accounts/", json={
        "name": "Nouveau Compte",
        "type": "Compte courant",
        "initial_balance": 100.0,
        "color": "#ff0000"
    })
    assert res.status_code == 200
    new_acc = res.json()
    assert new_acc["name"] == "Nouveau Compte"
    assert new_acc["initial_balance"] == 100.0
    
    # Update Account
    res = client.put(f"/api/accounts/{new_acc['id']}", json={
        "name": "Compte Modifié",
        "type": "Compte courant",
        "initial_balance": 120.0,
        "color": "#00ff00",
        "is_closed": False
    })
    assert res.status_code == 200
    updated = res.json()
    assert updated["name"] == "Compte Modifié"
    assert updated["initial_balance"] == 120.0

    # Delete Account
    res = client.delete(f"/api/accounts/{new_acc['id']}")
    assert res.status_code == 200
    assert res.json() == {"ok": True}


# ==============================================================================
# TEST 2: Functional core - Sign Logic and Transactions
# ==============================================================================
def test_transactions_sign_logic():
    # Seeded:
    # CC initial: 1500.0
    # CC income March: +2500.0
    # CC income April: +2500.0
    # CC Netflix March: -15.0
    # CC Netflix April: -15.0
    # CC Loyer April: -600.0
    # Starting CC balance = 1500 + 2500 + 2500 - 15 - 15 - 600 = 5870.0
    
    # 1. Expense: Depuis [Compte X] / Vers [Vide]
    res = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-29",
        "date_operation": "2026-05-29",
        "description": "Achat Test Dépense",
        "amount": 150.0,
        "type": "expense_var",
        "category": "Alimentaire",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": "2026-05-29"
    })
    assert res.status_code == 200
    tx = res.json()
    assert tx["from_account_id"] == 1
    assert tx["to_account_id"] is None
    
    # Re-calculate balances
    res_accs = client.get("/api/stats/accounts")
    # Compte Courant initial = 5870.0, -150 expense = 5720.0
    compte_courant = next(a for a in res_accs.json() if a["id"] == 1)
    assert compte_courant["balance"] == 5720.0

    # 2. Income: Depuis [Vide] / Vers [Compte X]
    res = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-29",
        "date_operation": "2026-05-29",
        "description": "Remboursement Test",
        "amount": 50.0,
        "type": "income",
        "category": "Salaire",
        "from_account_id": None,
        "to_account_id": 1,
        "reconciliation_date": "2026-05-29"
    })
    assert res.status_code == 200
    
    res_accs = client.get("/api/stats/accounts")
    compte_courant = next(a for a in res_accs.json() if a["id"] == 1)
    # 5720 + 50 = 5770.0
    assert compte_courant["balance"] == 5770.0

    # 3. Transfer: Depuis [Compte X] / Vers [Compte Y]
    res = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-29",
        "date_operation": "2026-05-29",
        "description": "Virement interne",
        "amount": 200.0,
        "type": "transfer",
        "category": None,
        "from_account_id": 1,
        "to_account_id": 2,
        "reconciliation_date": "2026-05-29"
    })
    assert res.status_code == 200

    res_accs = client.get("/api/stats/accounts")
    compte_courant = next(a for a in res_accs.json() if a["id"] == 1)
    livret_a = next(a for a in res_accs.json() if a["id"] == 2)
    # Compte Courant: 5770 - 200 = 5570.0
    # Livret A: 5000 (initial) + 200 = 5200.0
    assert compte_courant["balance"] == 5570.0
    assert livret_a["balance"] == 5200.0


# ==============================================================================
# TEST 3: Functional core - Categories CRUD & cascading renaming
# ==============================================================================
def test_categories_cascade():
    # Rename category "Salaire" (ID 3) to "Revenue"
    res = client.put("/api/categories/3", json={
        "name": "Revenue",
        "type": "income",
        "is_closed": False
    })
    assert res.status_code == 200
    
    # Check if existing transactions with category "Salaire" were renamed to "Revenue"
    res_txs = client.get("/api/transactions/")
    assert res_txs.status_code == 200
    txs = res_txs.json()
    sal_txs = [t for t in txs if t["description"].startswith("Salaire")]
    assert len(sal_txs) > 0
    for t in sal_txs:
        assert t["category"] == "Revenue"


# ==============================================================================
# TEST 4: Recurrences - generate_to_end_of_year with/without template_id and de-duplication
# ==============================================================================
def test_recurrences_generation_and_deduplication(monkeypatch):
    from datetime import date
    class MockDate(date):
        @classmethod
        def today(cls):
            return date(2026, 5, 29)
    monkeypatch.setattr("app.routers.recurrences.date", MockDate)

    # Call generate_to_end_of_year with a template_id (Template 1: Loyer mensuel, 600€)
    # This should only generate instances for Template 1
    res = client.post("/api/recurrences/generate_to_end_of_year?template_id=1")
    assert res.status_code == 200
    
    # Check transactions: template 1 should be generated, template 2 (Netflix) should NOT be generated.
    res_txs = client.get("/api/transactions/")
    txs = res_txs.json()
    loyer_txs = [t for t in txs if t["recurrence_id"] == 1]
    netflix_txs = [t for t in txs if t["recurrence_id"] == 2]
    
    # Originally seeded 1 Loyer tx. With generation, it should have generated May-Dec (8 instances). Total = 9.
    assert len(loyer_txs) == 9
    # We seeded 2 netflix instances, should still be only 2 (since we filtered by template_id=1)
    assert len(netflix_txs) == 2 

    # Verify duplicate prevention:
    # Netflix (template 2) has transactions in March and April.
    # Calling global generate_to_end_of_year (no template_id) should generate future instances for Netflix starting in May
    # without duplicating March/April transactions.
    res_global = client.post("/api/recurrences/generate_to_end_of_year")
    assert res_global.status_code == 200
    
    res_txs2 = client.get("/api/transactions/")
    txs2 = res_txs2.json()
    
    # Verify May-Dec Netflix instances exist but March/April were not duplicated
    netflix_txs_final = [t for t in txs2 if t["recurrence_id"] == 2]
    # Seeded: 2. Generating May to Dec: 8 instances. Total should be 10 instances.
    assert len(netflix_txs_final) == 10
    
    # Ensure there's exactly 1 Netflix transaction for March 2026 and 1 for April 2026
    march_netflix = [t for t in netflix_txs_final if "2026-03" in t["date_operation"]]
    april_netflix = [t for t in netflix_txs_final if "2026-04" in t["date_operation"]]
    assert len(march_netflix) == 1
    assert len(april_netflix) == 1


# ==============================================================================
# TEST 5: Category Creation & Recurrence Migration (Point 4)
# ==============================================================================
def test_category_recurrence_migration_and_conflicts():
    # 1. Create a variable category "TestLoyer"
    res = client.post("/api/categories/", json={"name": "TestLoyer", "type": "expense_var"})
    assert res.status_code == 200
    
    # 2. Create recurrence template with "TestLoyer" category.
    # It should automatically migrate "TestLoyer" type to "expense_fixed"
    res_rec = client.post("/api/recurrences/", json={
        "amount": 750.0,
        "description": "Loyer Test Automatique",
        "frequency": "Monthly",
        "start_date": "2026-06-01",
        "category": "TestLoyer",
        "type": "expense_fixed",
        "is_active": True
    })
    assert res_rec.status_code == 200
    
    # Verify category type has updated
    res_cats = client.get("/api/categories/")
    test_loyer_cat = next(c for c in res_cats.json() if c["name"] == "TestLoyer")
    assert test_loyer_cat["type"] == "expense_fixed"

    # 3. Test Conflict and force_move
    # Create variable category "Internet"
    client.post("/api/categories/", json={"name": "Internet", "type": "expense_var"})
    # Create a transaction to make it "used"
    client.post("/api/transactions/", json={
        "amount": 29.99,
        "description": "Abonnement Box",
        "date_operation": "2026-05-29",
        "date_saisie": "2026-05-29",
        "category": "Internet",
        "type": "expense_var",
        "from_account_id": 1
    })
    
    # Try to create category with same name "Internet" but type "expense_fixed"
    # Should conflict (409)
    res_conf = client.post("/api/categories/", json={"name": "Internet", "type": "expense_fixed"})
    assert res_conf.status_code == 409
    
    # Try with force_move=true
    res_force = client.post("/api/categories/?force_move=true", json={"name": "Internet", "type": "expense_fixed"})
    assert res_force.status_code == 200
    assert res_force.json()["type"] == "expense_fixed"


# ==============================================================================
# TEST 6: CSV Import/Export
# ==============================================================================
def test_csv_import_export(tmp_path):
    # Prepare a mock CSV content
    csv_content = (
        "Date de saisie;Date opération;Description;Montant;Type;Catégorie;Date de rapprochement;Répétition mensuelle;Répétition annuelle;Depuis;Vers;ID\n"
        "29/05/2026;29/05/2026;Course supermarche;45.50;expense_var;Alimentaire;;0;0;Compte Courant;;csv_tx_123\n"
    )
    csv_file = tmp_path / "import.csv"
    csv_file.write_text(csv_content, encoding="utf-8")
    
    # Perform import via API
    with open(csv_file, "rb") as f:
        res = client.post("/api/csv/import", files={"file": ("import.csv", f, "text/csv")})
    assert res.status_code == 200
    assert res.json()["imported"] == 1
    
    # Verify transaction got imported
    res_txs = client.get("/api/transactions/")
    txs = res_txs.json()
    imported = next((t for t in txs if t["csv_id"] == "csv_tx_123"), None)
    assert imported is not None
    assert imported["amount"] == 45.50
    assert imported["description"] == "Course supermarche"

    # Test CSV export
    res_exp = client.get("/api/csv/export")
    assert res_exp.status_code == 200
    export_content = res_exp.text
    assert "csv_tx_123" in export_content
    assert "Course supermarche" in export_content


# ==============================================================================
# TEST 7: Budgets (Envelopes)
# ==============================================================================
def test_budgets_envelopes():
    # Create new budget
    res = client.post("/api/budgets/", json={
        "name": "Cadeaux",
        "monthly_amount": 100.0,
        "period": "monthly",
        "is_project": False,
        "is_closed": False,
        "categories": ["Alimentaire"]
    })
    assert res.status_code == 200
    b = res.json()
    assert b["name"] == "Cadeaux"
    
    # Check budget status endpoint
    today = date.today()
    res_status = client.get(f"/api/budgets/status?year={today.year}&month={today.month}")
    assert res_status.status_code == 200
    status_data = res_status.json()
    assert "budgets" in status_data
    assert any(bud["name"] == "Cadeaux" for bud in status_data["budgets"])


# ==============================================================================
# TEST 8: Payday updates & Dashboard Force Next Month (Points 7 & 8)
# ==============================================================================
def test_payday_and_dashboard_forcing():
    # 1. Update payday config
    res = client.post("/api/config/", json={"base_pay_day": "25"})
    assert res.status_code == 200
    
    # Verify configuration has updated
    res_conf = client.get("/api/config/")
    assert res_conf.status_code == 200
    assert res_conf.json().get("base_pay_day") == "25"

    # 2. Test dashboard paycheck override & cycle forcing
    # Force validate the current May cycle to advance logical period to June
    res_force = client.post("/api/stats/validate_pay_period?action=force")
    assert res_force.status_code == 200
    assert res_force.json()["ok"] is True

    # Now the logical period is June. Set override for June.
    res_ov = client.post("/api/stats/override_paycheck", json={"date": "2026-06-25", "amount": 2000.0})
    assert res_ov.status_code == 200
    
    # Verify that the dashboard responds to override
    res_dash = client.get("/api/stats/dashboard")
    assert res_dash.status_code == 200
    assert res_dash.json()["is_pay_override"] is True
    assert res_dash.json()["next_pay_amount"] == 2000.0

    # Reset period
    res_reset = client.post("/api/stats/validate_pay_period?action=reset")
    assert res_reset.status_code == 200
    
    # Delete paycheck overrides
    res_del = client.delete("/api/stats/override_paycheck")
    assert res_del.status_code == 200


# ==============================================================================
# TEST 9: Recurrence Category Modification & Cascade
# ==============================================================================
def test_recurrence_category_modification_cascade():
    # Template 1: Loyer mensuel, category is currently "Loyer" (seeded)
    # Generate instances first
    res_gen = client.post("/api/recurrences/generate_to_end_of_year?template_id=1")
    assert res_gen.status_code == 200
    
    # Get all transactions for template 1
    res_txs = client.get("/api/transactions/")
    txs = res_txs.json()
    loyer_txs = [t for t in txs if t["recurrence_id"] == 1]
    assert len(loyer_txs) > 1
    
    # Reconcile the first one (id=5 is seeded Loyer Avril with reconciliation_date)
    reconciled_tx = next(t for t in loyer_txs if t["id"] == 5)
    assert reconciled_tx["reconciliation_date"] is not None
    
    unreconciled_txs = [t for t in loyer_txs if t["reconciliation_date"] is None]
    assert len(unreconciled_txs) > 0
    
    # Update category of the template to "Logement"
    res_patch = client.patch("/api/recurrences/1/category", json={"category": "Logement"})
    assert res_patch.status_code == 200
    assert res_patch.json()["category"] == "Logement"
    
    # Verify that unreconciled transactions have changed category to "Logement"
    res_txs2 = client.get("/api/transactions/")
    txs2 = res_txs2.json()
    loyer_txs2 = [t for t in txs2 if t["recurrence_id"] == 1]
    
    # Reconciled transaction should still have the old category "Loyer"
    rec_tx2 = next(t for t in loyer_txs2 if t["id"] == 5)
    assert rec_tx2["category"] == "Loyer"
    
    # Unreconciled transactions should have the new category "Logement"
    unrec_txs2 = [t for t in loyer_txs2 if t["reconciliation_date"] is None]
    for t in unrec_txs2:
        assert t["category"] == "Logement"


# ==============================================================================
# TEST 10: Synthesis / Analytics Drilldown Filters Simulation
# ==============================================================================
def test_synthesis_drilldown_filters():
    # Seed or verify existing transactions
    res = client.get("/api/transactions/?limit=10000")
    assert res.status_code == 200
    txs = res.json()
    
    # Drilldown scenario A: Category = "Abonnement", MonthKey = "2026-03"
    category_filter = "Abonnement"
    month_filter = "2026-03"
    
    filtered_a = [
        tx for tx in txs
        if tx["category"] == category_filter and tx["date_operation"].startswith(month_filter)
    ]
    assert len(filtered_a) == 1
    assert filtered_a[0]["description"] == "Netflix.com Mars"
    
    # Drilldown scenario B: Category = "Salaire", MonthKey = "2026-04"
    filtered_b = [
        tx for tx in txs
        if tx["category"] == "Salaire" and tx["date_operation"].startswith("2026-04")
    ]
    assert len(filtered_b) == 1
    assert filtered_b[0]["description"] == "Salaire Avril"
    
    # Drilldown scenario C: Year in search searchInput = "2026"
    search_q = "2026"
    filtered_c = [
        tx for tx in txs
        if (tx["description"] or "").lower().find(search_q) != -1
        or (tx["category"] or "").lower().find(search_q) != -1
        or (tx["date_operation"] or "").find(search_q) != -1
    ]
    assert len(filtered_c) == len(txs)


# ==============================================================================
# TEST 11: Delete Reconciled Recurrent Operation (Template Deletion Behavior)
# ==============================================================================
def test_delete_recurrence_template_preserves_reconciled():
    # Template 1: Loyer mensuel. Let's generate instances
    client.post("/api/recurrences/generate_to_end_of_year?template_id=1")
    
    # Get all transactions before deletion
    res_txs = client.get("/api/transactions/")
    txs = res_txs.json()
    loyer_txs_before = [t for t in txs if t["recurrence_id"] == 1]
    assert len(loyer_txs_before) > 1
    
    # Delete the template
    res_del = client.delete("/api/recurrences/1")
    assert res_del.status_code == 200
    assert res_del.json() == {"ok": True}
    
    # Verify the template is deleted
    res_templates = client.get("/api/recurrences/")
    assert not any(t["id"] == 1 for t in res_templates.json())
    
    # Verify transactions: unreconciled are deleted, reconciled (id=5) is preserved
    res_txs_after = client.get("/api/transactions/")
    txs_after = res_txs_after.json()
    loyer_txs_after = [t for t in txs_after if t["recurrence_id"] == 1]
    
    assert len(loyer_txs_after) == 1
    assert loyer_txs_after[0]["id"] == 5
    assert loyer_txs_after[0]["reconciliation_date"] == "2026-04-05"


# ==============================================================================
# TEST 12: Paycheck Override Reset/Fallback Flow
# ==============================================================================
def test_paycheck_override_reset_fallback():
    # Force validate the current May cycle to advance logical period to June
    res_force = client.post("/api/stats/validate_pay_period?action=force")
    assert res_force.status_code == 200
    assert res_force.json()["ok"] is True

    # Get original predicted paycheck amount for June before override
    res_dash_init = client.get("/api/stats/dashboard")
    assert res_dash_init.status_code == 200
    orig_amount = res_dash_init.json()["next_pay_amount"]
    orig_is_override = res_dash_init.json()["is_pay_override"]
    assert orig_is_override is False
    
    # Override paycheck for June to a different amount (e.g. 3500.0)
    res_ov = client.post("/api/stats/override_paycheck", json={"date": "2026-06-25", "amount": 3500.0})
    assert res_ov.status_code == 200
    
    # Verify dashboard shows override
    res_dash_ov = client.get("/api/stats/dashboard")
    assert res_dash_ov.json()["is_pay_override"] is True
    assert res_dash_ov.json()["next_pay_amount"] == 3500.0
    
    # Delete the paycheck override
    res_del = client.delete("/api/stats/override_paycheck")
    assert res_del.status_code == 200
    
    # Verify dashboard falls back to original predicted paycheck
    res_dash_after = client.get("/api/stats/dashboard")
    assert res_dash_after.json()["is_pay_override"] is False
    assert res_dash_after.json()["next_pay_amount"] == orig_amount


# ==============================================================================
# TEST 13: Orphan Recurrence Cleanup Logic
# ==============================================================================
def test_orphan_recurrences_cleanup_logic():
    # 1. Create an active recurrence template (is_closed=False)
    # Template ID 1 is active (Loyer mensuel, is_closed=False)
    # Generate instances for it
    client.post("/api/recurrences/generate_to_end_of_year?template_id=1")
    
    # 2. Create a CLOSED recurrence template (is_closed=True)
    res_tpl = client.post("/api/recurrences/", json={
        "amount": 100.0,
        "description": "Abonnement Ferme",
        "frequency": "Monthly",
        "start_date": "2026-01-01",
        "category": "Abonnement",
        "type": "expense_fixed",
        "is_active": False,
        "is_closed": True
    })
    assert res_tpl.status_code == 200
    closed_tpl_id = res_tpl.json()["id"]
    
    # Generate an unreconciled transaction for this closed template
    res_tx = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-30",
        "date_operation": "2026-06-15",
        "description": "Abonnement Ferme Juin",
        "amount": 100.0,
        "type": "expense_fixed",
        "category": "Abonnement",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": None,
        "recurrence_id": closed_tpl_id
    })
    assert res_tx.status_code == 200
    orphan_tx_id = res_tx.json()["id"]
    
    # 3. Call preview endpoint
    res_prev = client.get("/api/maintenance/orphan_recurrences/preview")
    assert res_prev.status_code == 200
    data = res_prev.json()
    
    # Only the transaction from the closed template should be in orphans
    orphan_ids = [tx["id"] for group in data["groups"] for tx in group["transactions"]]
    assert orphan_tx_id in orphan_ids
    
    # Verify that unreconciled transactions from the active template (1) are NOT in orphans
    res_txs = client.get("/api/transactions/")
    txs_active_unrec = [t["id"] for t in res_txs.json() if t["recurrence_id"] == 1 and t["reconciliation_date"] is None]
    assert len(txs_active_unrec) > 0
    for tid in txs_active_unrec:
        assert tid not in orphan_ids
        
    # 4. Call cleanup endpoint on the orphan transaction
    res_clean = client.post("/api/maintenance/orphan_recurrences/cleanup", json=[orphan_tx_id])
    assert res_clean.status_code == 200
    assert res_clean.json()["deleted"] == 1
    
    # Verify the orphan transaction is deleted
    res_check = client.get(f"/api/transactions/{orphan_tx_id}")
    assert res_check.status_code == 404
    
    # Verify that the active template's unreconciled transactions are NOT deleted
    for tid in txs_active_unrec:
        res_check_active = client.get(f"/api/transactions/{tid}")
        assert res_check_active.status_code == 200


def test_obsolete_orphan_recurrences():
    """Tests three orphan scenarios:
    - Rule 2.5: ABANDONED — confirmed in 2023 only, unreconciled in 2026
    - Rule 2.6: ZEROED_OUT — last 3+ reconciled at €0, unreconciled in 2026 at non-zero
    - Rule 3b:  YEARLY_DUPE_RECON — already reconciled this year, another unreconciled appears
    """
    # ---- Scenario A: ABANDONED ----
    # Template active but last confirmed in 2023, nothing in 2024/2025
    res_tpl_a = client.post("/api/recurrences/", json={
        "amount": 185.0,
        "description": "TotalEnergies Obsolete Test",
        "frequency": "Monthly",
        "start_date": "2023-01-01",
        "category": "Facture énergie",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False
    })
    assert res_tpl_a.status_code == 200
    tpl_a = res_tpl_a.json()["id"]

    # One reconciled in 2023
    client.post("/api/transactions/", json={
        "date_saisie": "2023-06-12", "date_operation": "2023-06-12",
        "description": "TotalEnergies Obsolete Test", "amount": 185.0,
        "type": "expense_fixed", "category": "Facture énergie",
        "from_account_id": 1, "to_account_id": None,
        "reconciliation_date": "2023-06-12", "recurrence_id": tpl_a
    })
    # Unreconciled in 2026
    res_orphan_a = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-30", "date_operation": "2026-06-12",
        "description": "TotalEnergies Obsolete Test", "amount": 185.0,
        "type": "expense_fixed", "category": "Facture énergie",
        "from_account_id": 1, "to_account_id": None,
        "reconciliation_date": None, "recurrence_id": tpl_a
    })
    orphan_a = res_orphan_a.json()["id"]

    # ---- Scenario B: ZEROED_OUT ----
    res_tpl_b = client.post("/api/recurrences/", json={
        "amount": 63.01, "description": "Amalia Zeroed Test",
        "frequency": "Monthly", "start_date": "2024-01-01",
        "category": "Virement", "type": "expense_fixed",
        "is_active": True, "is_closed": False
    })
    assert res_tpl_b.status_code == 200
    tpl_b = res_tpl_b.json()["id"]

    # Three consecutive reconciled at €0 in 2025
    for day, month in [("05", "10"), ("05", "11"), ("05", "12")]:
        client.post("/api/transactions/", json={
            "date_saisie": f"2025-{month}-{day}", "date_operation": f"2025-{month}-{day}",
            "description": "Amalia Zeroed Test", "amount": 0.0,
            "type": "expense_fixed", "category": "Virement",
            "from_account_id": 1, "to_account_id": None,
            "reconciliation_date": f"2025-{month}-{day}", "recurrence_id": tpl_b
        })
    # Unreconciled in 2026 at original non-zero amount
    res_orphan_b = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-30", "date_operation": "2026-06-05",
        "description": "Amalia Zeroed Test", "amount": 63.01,
        "type": "expense_fixed", "category": "Virement",
        "from_account_id": 1, "to_account_id": None,
        "reconciliation_date": None, "recurrence_id": tpl_b
    })
    orphan_b = res_orphan_b.json()["id"]

    # ---- Scenario C: YEARLY_DUPE_RECON ----
    res_tpl_c = client.post("/api/recurrences/", json={
        "amount": 19.99, "description": "Google One Yearly Test",
        "frequency": "Yearly", "start_date": "2024-01-01",
        "category": "Abonnement", "type": "expense_fixed",
        "is_active": True, "is_closed": False
    })
    assert res_tpl_c.status_code == 200
    tpl_c = res_tpl_c.json()["id"]

    # One reconciled in 2026 (Jan)
    client.post("/api/transactions/", json={
        "date_saisie": "2026-01-21", "date_operation": "2026-01-21",
        "description": "Google One Yearly Test", "amount": 19.99,
        "type": "expense_fixed", "category": "Abonnement",
        "from_account_id": 1, "to_account_id": None,
        "reconciliation_date": "2026-01-21", "recurrence_id": tpl_c
    })
    # Second unreconciled in same year (May)
    res_orphan_c = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-30", "date_operation": "2026-05-21",
        "description": "Google One Yearly Test", "amount": 19.99,
        "type": "expense_fixed", "category": "Abonnement",
        "from_account_id": 1, "to_account_id": None,
        "reconciliation_date": None, "recurrence_id": tpl_c
    })
    orphan_c = res_orphan_c.json()["id"]

    # ---- Verify preview catches all three ----
    res_prev = client.get("/api/maintenance/orphan_recurrences/preview")
    assert res_prev.status_code == 200
    orphan_ids = [tx["id"] for group in res_prev.json()["groups"] for tx in group["transactions"]]
    assert orphan_a in orphan_ids, f"ABANDONED orphan {orphan_a} not detected"
    assert orphan_b in orphan_ids, f"ZEROED_OUT orphan {orphan_b} not detected"
    assert orphan_c in orphan_ids, f"YEARLY_DUPE orphan {orphan_c} not detected"

    # ---- Cleanup ----
    res_clean = client.post("/api/maintenance/orphan_recurrences/cleanup", json=[orphan_a, orphan_b, orphan_c])
    assert res_clean.status_code == 200
    assert res_clean.json()["deleted"] == 3

    for oid in [orphan_a, orphan_b, orphan_c]:
        assert client.get(f"/api/transactions/{oid}").status_code == 404


# ==============================================================================
# TEST 14: License Validation (Ed25519 & Passive Migration)
# ==============================================================================
def test_license_validation_flow():
    # 1. Initially status is inactive
    res = client.get("/api/license/status")
    assert res.status_code == 200
    assert res.json() == {"active": False, "email": None}

    # 2. Try activation with invalid email/key format
    res = client.post("/api/license/activate", json={"email": "", "key": ""})
    assert res.status_code == 400

    # 3. Try activation with old OMNI- key (should be rejected)
    res = client.post("/api/license/activate", json={"email": "test@example.com", "key": "OMNI-12345-67890-12345"})
    assert res.status_code == 400
    assert "Les anciennes clés (OMNI-) ne sont plus acceptées" in res.json()["detail"]

    # 4. Try activation with invalid Ed25519 signature
    res = client.post("/api/license/activate", json={"email": "test@example.com", "key": "invalidbase64signature=="})
    assert res.status_code == 403

    # 5. Activate with valid Ed25519 signature (pre-generated for test@example.com)
    # Public key: rlAgxcf0MapA13+WZi5CpGg42HhjTth/O40yV5qTxgY=
    valid_key = "zuQ9Y6lxxTsi1hOJgjoi/P3RX1F1lf+NWHXOuspxBo3kxaUw/RZs4ksxv0eU40FLTe90CpIRDDKGxfJzpEXbAA=="
    res = client.post("/api/license/activate", json={"email": "test@example.com", "key": valid_key})
    assert res.status_code == 200
    assert res.json() == {"active": True, "email": "test@example.com"}

    # 6. Verify status is active
    res = client.get("/api/license/status")
    assert res.status_code == 200
    assert res.json() == {"active": True, "email": "test@example.com"}

    # 7. Deactivate
    res = client.post("/api/license/deactivate")
    assert res.status_code == 200
    assert res.json() == {"active": False}
    
    # 8. Verify status is inactive again
    res = client.get("/api/license/status")
    assert res.json() == {"active": False, "email": None}

    # 9. Test Passive Migration: directly insert an old OMNI- key into the database
    db = TestingSessionLocal()
    from app.models import GlobalConfig
    db.add(GlobalConfig(key="license_key", value="OMNI-LEGACY-KEY"))
    db.add(GlobalConfig(key="license_email", value="legacy@example.com"))
    db.commit()
    db.close()

    # Verify status is active due to passive migration
    res = client.get("/api/license/status")
    assert res.status_code == 200
    assert res.json() == {"active": True, "email": "legacy@example.com"}


# ==============================================================================
# TEST 15: Piggy Bank Overflow (Savings consumption warning)
# ==============================================================================
def test_piggy_bank_overflow():
    # 1. Create a savings/tirelire budget
    res_b = client.post("/api/budgets/", json={
        "name": "Tirelire Vacances",
        "monthly_amount": 1000.0,
        "period": "monthly",
        "is_project": False,
        "envelope_type": "savings"
    })
    assert res_b.status_code == 200
    b_id = res_b.json()["id"]

    # Deposit funds to it by adding a manual allocation of 500€
    res_alloc = client.post(f"/api/budgets/{b_id}/allocations", json={
        "amount": 500.0,
        "date": "2026-05-29",
        "note": "Initial deposit"
    })
    assert res_alloc.status_code == 200

    # 2. Add an unreconciled expense that will exceed rest_to_live but stay within savings limit
    # CC balance: ~5500€ (from test_transactions_sign_logic if run sequentially, but since DB is rebuilt fresh
    # before each test via setup_and_teardown_db, starting balance is 5870.0€)
    # Savings total: 500€
    # Rest to live: 5870.0 - 500.0 = 5370.0€
    # Let's add an expense of 5500€ to make rest_to_live negative: -130€ (which is > -500€ total savings)
    res_tx = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-29",
        "date_operation": "2026-06-15", # before next paycheck
        "description": "Big purchase",
        "amount": 5500.0,
        "type": "expense_var",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": None
    })
    assert res_tx.status_code == 200

    # Get stats dashboard
    res_dash = client.get("/api/stats/dashboard")
    assert res_dash.status_code == 200
    data = res_dash.json()
    
    # Rest to live should be negative: 5870.0 - 5500.0 - 500.0 = -130.0€
    assert data["rest_to_live"] == -130.0
    overflow = data["savings_overflow"]
    assert overflow is not None
    assert overflow["overflow_amount"] == 130.0
    assert overflow["total_savings"] == 500.0
    assert overflow["fully_consumed"] is False

    # 3. Add another unreconciled expense of 500€ (total expenses 6000€)
    # Rest to live: 5870.0 - 6000.0 - 500.0 = -630.0€
    # Overflow amount: 630.0€ (> 500€ total savings), meaning fully_consumed should be True
    client.post("/api/transactions/", json={
        "date_saisie": "2026-05-29",
        "date_operation": "2026-06-15",
        "description": "Another purchase",
        "amount": 500.0,
        "type": "expense_var",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": None
    })
    
    res_dash2 = client.get("/api/stats/dashboard")
    assert res_dash2.status_code == 200
    data2 = res_dash2.json()
    assert data2["rest_to_live"] == -630.0
    overflow2 = data2["savings_overflow"]
    assert overflow2 is not None
    assert overflow2["overflow_amount"] == 630.0
    assert overflow2["fully_consumed"] is True


# ==============================================================================
# TEST 16: Paycheck Threshold — small non-salary income must NOT trigger period advance
# ==============================================================================
def test_paycheck_threshold_small_income(monkeypatch):
    """
    Reproduces: user adds a 500€ 'Mercer' mutuelle income near payday (day 28).
    Even though the amount exceeds the fallback threshold (1000€ * 30% = 300€),
    it should NOT be detected as a paycheck because the REAL historical average
    is ~2500€, giving a threshold of ~750€.
    The pay_category is set to 'Salaire' and the Mercer tx has category 'Mutuelle'.
    """
    from datetime import date
    from app.models import GlobalConfig

    # Fix today to a date near the pay day
    class MockDate(date):
        @classmethod
        def today(cls):
            return date(2026, 5, 29)
    monkeypatch.setattr("app.services.finance_engine.date", MockDate)

    # Configure pay_category to 'Salaire' and threshold to 30%
    client.post("/api/config/", json={"key": "pay_category", "value": "Salaire"})
    client.post("/api/config/", json={"key": "pay_threshold_percent", "value": "30"})

    # The test DB already has 2 reconciled Salaire incomes of 2500€ each (March & April).
    # Add a small non-salary income near payday that should NOT be detected as paycheck:
    res = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-25",
        "date_operation": "2026-05-25",
        "description": "Mercer Mutuelle",
        "amount": 500.0,
        "type": "income",
        "category": "Mutuelle",
        "from_account_id": None,
        "to_account_id": 1,
        "reconciliation_date": "2026-05-25"
    })
    assert res.status_code == 200

    # Get dashboard — the 500€ Mercer should NOT appear as pay_history entry for May
    res_dash = client.get("/api/stats/dashboard")
    assert res_dash.status_code == 200
    data = res_dash.json()

    # Check pay_history: the Mercer 500€ should NOT be in the list
    mercer_entries = [h for h in data["pay_history"] if h.get("description") == "Mercer Mutuelle"]
    assert len(mercer_entries) == 0, (
        f"500€ Mercer income was incorrectly detected as paycheck! "
        f"pay_history entries with 'Mercer Mutuelle': {mercer_entries}"
    )

    # The real paychecks (Salaire Mars/Avril at 2500€) should still be detected
    salary_entries = [h for h in data["pay_history"] if "Salaire" in h.get("description", "")]
    assert len(salary_entries) >= 2, (
        f"Expected at least 2 salary entries, got {len(salary_entries)}: {salary_entries}"
    )


if __name__ == "__main__":
    build_test_db(engine)
    test_accounts_crud()
    test_transactions_sign_logic()
    test_categories_cascade()
    test_recurrences_generation_and_deduplication()
    test_payday_and_dashboard_forcing()
    test_recurrence_category_modification_cascade()
    test_synthesis_drilldown_filters()
    test_delete_recurrence_template_preserves_reconciled()
    test_paycheck_override_reset_fallback()
    test_orphan_recurrences_cleanup_logic()
    test_obsolete_orphan_recurrences()
    test_license_validation_flow()
    test_piggy_bank_overflow()
    test_paycheck_threshold_small_income()

