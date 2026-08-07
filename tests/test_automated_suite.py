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
    from app.database import _engines, _session_factories
    _engines['default'] = engine
    _session_factories['default'] = TestingSessionLocal
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
    assert res.json().get("ok") is True


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
    
    # Originally seeded 1 Loyer tx. With 12-month rolling window (mocked today=2026-05-29), it should generate May 2026 to May 2027 (13 instances). Total = 14.
    assert len(loyer_txs) == 14
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
    # Seeded: 2. Generating May 2026 to May 2027: 13 instances. Total should be 15 instances.
    assert len(netflix_txs_final) == 15
    
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
    assert res_del.json().get("ok") is True
    
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


def test_chat_premium_flow():
    # 1. List initial sessions
    res = client.get("/api/chat/sessions")
    assert res.status_code == 200
    assert len(res.json()) == 0

    # 2. Create new session
    res = client.post("/api/chat/sessions", json={"role": "advisor"})
    assert res.status_code == 200
    session = res.json()
    assert session["role"] == "advisor"
    assert session["title"] == "Nouvelle conversation"

    # 3. Update session title and role
    res = client.put(f"/api/chat/sessions/{session['id']}", json={"title": "Test Chat", "role": "simulator"})
    assert res.status_code == 200

    # 4. Get messages (empty list)
    res = client.get(f"/api/chat/sessions/{session['id']}/messages")
    assert res.status_code == 200
    assert len(res.json()["messages"]) == 0
    assert res.json()["compressed_context"] is None

    # 5. Update compressed context
    res = client.put(f"/api/chat/sessions/{session['id']}/context", json={"compressed_context": "Compacted history test"})
    assert res.status_code == 200

    # 6. Verify updated context
    res = client.get(f"/api/chat/sessions/{session['id']}/messages")
    assert res.status_code == 200
    assert res.json()["compressed_context"] == "Compacted history test"

    # 7. Delete session
    res = client.delete(f"/api/chat/sessions/{session['id']}")
    assert res.status_code == 200
    
    # 8. Verify list is empty again
    res = client.get("/api/chat/sessions")
    assert res.status_code == 200
    assert len(res.json()) == 0


def test_chat_delete_message_keeps_context_after_compression():
    """When deleting a message AFTER the compression point, compressed context must remain."""
    from app.models import ChatSession as CS, ChatMessage as CM

    # 1. Create session
    res = client.post("/api/chat/sessions", json={"role": "advisor"})
    assert res.status_code == 200
    session_id = res.json()["id"]

    # 2. Add messages: U1, A1, U2, A2
    for content, role in [("Hello", "user"), ("Hi there", "assistant"), ("Budget?", "user"), ("Here it is", "assistant")]:
        res = client.post(f"/api/chat/sessions/{session_id}/system-message", json={"content": content, "role": role})
        assert res.status_code == 200

    # 3. Verify messages
    res = client.get(f"/api/chat/sessions/{session_id}/messages")
    assert res.status_code == 200
    data = res.json()
    msgs = data["messages"]
    assert len(msgs) == 4
    a2_id = msgs[3]["id"]  # Last assistant = compression boundary

    # 4. Set compressed context via DB (simulate compression having run)
    db = TestingSessionLocal()
    try:
        session = db.query(CS).filter(CS.id == session_id).first()
        session.compressed_context = "Summarized history up to A2"
        session.last_compressed_message_id = a2_id
        db.commit()
    finally:
        db.close()

    # 5. Add U3 = trigger message (after compression point)
    res = client.post(f"/api/chat/sessions/{session_id}/system-message", json={"content": "What about savings?", "role": "user"})
    assert res.status_code == 200
    res = client.get(f"/api/chat/sessions/{session_id}/messages")
    u3 = res.json()["messages"][4]
    u3_id = u3["id"]
    assert u3_id > a2_id  # U3 is AFTER the compression point

    # 6. Set bubble_after_id = U3 (as compression would do)
    db = TestingSessionLocal()
    try:
        session = db.query(CS).filter(CS.id == session_id).first()
        session.bubble_after_id = u3_id
        db.commit()
    finally:
        db.close()

    # 7. Verify compressed context is present before delete
    res = client.get(f"/api/chat/sessions/{session_id}/messages")
    assert res.json()["compressed_context"] == "Summarized history up to A2"

    # 8. Delete U3 (message RIGHT AFTER the compression point)
    res = client.delete(f"/api/chat/messages/{u3_id}")
    assert res.status_code == 200

    # 9. Verify the compressed context is STILL present (bubble must stay)
    res = client.get(f"/api/chat/sessions/{session_id}/messages")
    data = res.json()
    assert data["compressed_context"] == "Summarized history up to A2", \
        f"Compressed context was cleared! Got: {data['compressed_context']}"
    assert data["last_compressed_message_id"] == a2_id, \
        "last_compressed_message_id was cleared!"
    assert data["bubble_after_id"] == u3_id, \
        "bubble_after_id was cleared!"


def test_weekly_recurrence_and_strict_id_deduplication():
    # 1. Create a Weekly recurrence template
    res_tpl = client.post("/api/recurrences/", json={
        "amount": 25.0,
        "description": "Weekly Veggie Box",
        "frequency": "Weekly",
        "start_date": "2026-01-01",
        "category": "Courses",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 5
    })
    assert res_tpl.status_code == 200
    tpl = res_tpl.json()
    tpl_id = tpl["id"]

    # 2. Add the first instance transaction for 2026-05-04 (Monday)
    res_tx = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-04",
        "date_operation": "2026-05-04",
        "description": "Weekly Veggie Box",
        "amount": 25.0,
        "type": "expense_fixed",
        "category": "Courses",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": None,
        "recurrence_id": tpl_id
    })
    assert res_tx.status_code == 200

    # 3. Trigger generate_to_end_of_year. It should generate weekly instances.
    res_gen = client.post("/api/recurrences/generate_to_end_of_year?template_id=" + str(tpl_id))
    assert res_gen.status_code == 200
    
    # 4. Fetch transactions linked to this recurrence
    res_txs = client.get("/api/transactions/?limit=10000")
    txs = [t for t in res_txs.json() if t["recurrence_id"] == tpl_id]
    
    # May 4th (1) + remaining weeks generated from first of current month (July 2026 onwards)
    assert len(txs) > 20

    # Verify that the distance between consecutive generated date_operations is exactly 7 days
    txs_sorted = sorted(txs, key=lambda x: x["date_operation"])
    from datetime import datetime
    for i in range(1, len(txs_sorted) - 1):
        d1 = datetime.strptime(txs_sorted[i]["date_operation"].split('T')[0], "%Y-%m-%d")
        d2 = datetime.strptime(txs_sorted[i+1]["date_operation"].split('T')[0], "%Y-%m-%d")
        assert (d2 - d1).days == 7

    # 5. Modify the description of one of the generated transactions (e.g. index 5)
    tx_to_mod = txs_sorted[5]
    res_mod = client.put(f"/api/transactions/{tx_to_mod['id']}", json={
        "description": "Weekly Veggie Box - Modified Name"
    })
    assert res_mod.status_code == 200

    # 6. Run generation again. It should generate 0 new instances because the ID check
    # finds that the instance already exists even though its description was changed.
    res_gen2 = client.post("/api/recurrences/generate_to_end_of_year?template_id=" + str(tpl_id))
    assert res_gen2.status_code == 200
    assert res_gen2.json()["generated_instances"] == 0

    # Cleanup
    client.delete(f"/api/recurrences/{tpl_id}")


def test_quarterly_and_semiannual_recurrences():
    # 1. Create a Quarterly template
    res_tpl_q = client.post("/api/recurrences/", json={
        "amount": 100.0,
        "description": "Quarterly Water Bill",
        "frequency": "Quarterly",
        "start_date": "2026-01-01",
        "category": "Factures",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 15
    })
    assert res_tpl_q.status_code == 200
    tpl_q_id = res_tpl_q.json()["id"]

    # Add first instance in January
    client.post("/api/transactions/", json={
        "date_saisie": "2026-01-15",
        "date_operation": "2026-01-15",
        "description": "Quarterly Water Bill",
        "amount": 100.0,
        "type": "expense_fixed",
        "category": "Factures",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": None,
        "recurrence_id": tpl_q_id
    })

    # Trigger generation
    res_gen = client.post("/api/recurrences/generate_to_end_of_year?template_id=" + str(tpl_q_id))
    assert res_gen.status_code == 200

    # Fetch generated transactions
    res_txs = client.get("/api/transactions/?limit=10000")
    txs_q = sorted([t for t in res_txs.json() if t["recurrence_id"] == tpl_q_id], key=lambda x: x["date_operation"])

    # Jan 15th + fast-forwarded starting July 15th + Oct 15th = 3 transactions
    assert len(txs_q) >= 2

    # Clean up
    client.delete(f"/api/recurrences/{tpl_q_id}")


def test_configurable_rolling_window_recurrences():
    from datetime import date
    today = date.today()
    # Use current month as seed so fast-forward doesn't inflate count
    seed_date = f"{today.year}-{today.month:02d}-15"

    # 1. Set config to 3 months
    res_cfg = client.post("/api/config/", json={"recurrence_generation_months": "3"})
    assert res_cfg.status_code == 200

    # 2. Create a Monthly recurrence template
    res_tpl = client.post("/api/recurrences/", json={
        "amount": 50.0,
        "description": "Configurable Rolling Test",
        "frequency": "Monthly",
        "start_date": seed_date,
        "category": "Abonnement",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 15
    })
    assert res_tpl.status_code == 200
    tpl_id = res_tpl.json()["id"]

    # 3. Add first instance in current month
    client.post("/api/transactions/", json={
        "date_saisie": seed_date,
        "date_operation": seed_date,
        "description": "Configurable Rolling Test",
        "amount": 50.0,
        "type": "expense_fixed",
        "category": "Abonnement",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": None,
        "recurrence_id": tpl_id
    })

    # 4. Trigger generation
    client.post("/api/recurrences/generate_to_end_of_year?template_id=" + str(tpl_id))

    # Fetch generated transactions
    res_txs = client.get("/api/transactions/?limit=10000")
    txs_3 = [t for t in res_txs.json() if t["recurrence_id"] == tpl_id]
    # With seed in current month + 3-month window: seed + up to 3 generated = max 4
    assert len(txs_3) <= 4

    # 5. Now update config to 6 months
    res_cfg2 = client.post("/api/config/", json={"recurrence_generation_months": "6"})
    assert res_cfg2.status_code == 200

    # Trigger generation again
    client.post("/api/recurrences/generate_to_end_of_year?template_id=" + str(tpl_id))

    # Fetch generated transactions again
    res_txs2 = client.get("/api/transactions/?limit=10000")
    txs_6 = [t for t in res_txs2.json() if t["recurrence_id"] == tpl_id]
    assert len(txs_6) > len(txs_3)

    # Clean up
    client.delete(f"/api/recurrences/{tpl_id}")
    # Reset config to 12
    client.post("/api/config/", json={"recurrence_generation_months": "12"})


def test_auto_close_abandoned_templates(monkeypatch):
    from datetime import date
    class MockDate(date):
        @classmethod
        def today(cls):
            return date(2026, 5, 29)
    monkeypatch.setattr("app.routers.recurrences.date", MockDate)

    # 1. Create a template
    res_tpl = client.post("/api/recurrences/", json={
        "amount": 120.0,
        "description": "Old Abandoned Subscription",
        "frequency": "Monthly",
        "start_date": "2024-01-01",
        "category": "Abonnement",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 10
    })
    assert res_tpl.status_code == 200
    tpl_id = res_tpl.json()["id"]

    # 2. Add reconciled transaction in 2024
    client.post("/api/transactions/", json={
        "date_saisie": "2024-01-10",
        "date_operation": "2024-01-10",
        "description": "Old Abandoned Subscription",
        "amount": 120.0,
        "type": "expense_fixed",
        "category": "Abonnement",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": "2024-01-11",
        "recurrence_id": tpl_id
    })

    # 3. Trigger generate_recurrences. It should auto-close this template first.
    res_gen = client.post("/api/recurrences/generate_to_end_of_year")
    assert res_gen.status_code == 200

    # 4. Check if the template is now closed
    res_check = client.get(f"/api/recurrences/?include_closed=true")
    templates = res_check.json()
    tpl = next(t for t in templates if t["id"] == tpl_id)
    assert tpl["is_closed"] is True

    # 5. Clean up
    client.delete(f"/api/recurrences/{tpl_id}")


def test_auto_close_zeroed_out_template(monkeypatch):
    """Zeroed templates are NOT auto-closed, but are skipped during generation."""
    from datetime import date
    class MockDate(date):
        @classmethod
        def today(cls):
            return date(2026, 5, 29)
    monkeypatch.setattr("app.routers.recurrences.date", MockDate)

    # 1. Create a template
    res_tpl = client.post("/api/recurrences/", json={
        "amount": 15.0,
        "description": "Zeroed Out Spotify Test",
        "frequency": "Monthly",
        "start_date": "2026-01-01",
        "category": "Abonnement",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 22
    })
    assert res_tpl.status_code == 200
    tpl_id = res_tpl.json()["id"]

    # 2. Add reconciled transaction with 0.0 amount in 2026 (current year)
    client.post("/api/transactions/", json={
        "date_saisie": "2026-04-22",
        "date_operation": "2026-04-22",
        "description": "Zeroed Out Spotify Test",
        "amount": 0.0,
        "type": "expense_fixed",
        "category": "Abonnement",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": "2026-04-23",  # Reconciled!
        "recurrence_id": tpl_id
    })

    # 3. Trigger generate_recurrences
    res_gen = client.post("/api/recurrences/generate_to_end_of_year")
    assert res_gen.status_code == 200

    # 4. Template should remain OPEN (not auto-closed)
    res_check = client.get(f"/api/recurrences/?include_closed=true")
    templates = res_check.json()
    tpl = next(t for t in templates if t["id"] == tpl_id)
    assert tpl["is_closed"] is False  # NOT closed, just skipped during generation

    # 5. No future transactions should have been generated (skipped due to zeroed)
    res_txs = client.get("/api/transactions/?limit=10000")
    future_txs = [t for t in res_txs.json() 
                  if t["recurrence_id"] == tpl_id and t["date_operation"] > "2026-04-22"]
    assert len(future_txs) == 0

    # 6. Clean up
    client.delete(f"/api/recurrences/{tpl_id}")


def test_dynamic_amount_generation(monkeypatch):
    from datetime import date
    class MockDate(date):
        @classmethod
        def today(cls):
            return date(2026, 5, 29)
    monkeypatch.setattr("app.routers.recurrences.date", MockDate)

    # 1. Create template with initial amount 50.0
    res_tpl = client.post("/api/recurrences/", json={
        "amount": 50.0,
        "description": "Dynamic Price Increase Test",
        "frequency": "Monthly",
        "start_date": "2026-01-01",
        "category": "Abonnement",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 15
    })
    assert res_tpl.status_code == 200
    tpl_id = res_tpl.json()["id"]

    # 2. Add reconciled transaction with updated amount 55.0 (price increase)
    client.post("/api/transactions/", json={
        "date_saisie": "2026-04-15",
        "date_operation": "2026-04-15",
        "description": "Dynamic Price Increase Test",
        "amount": 55.0,
        "type": "expense_fixed",
        "category": "Abonnement",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": "2026-04-16",
        "recurrence_id": tpl_id
    })

    # 3. Trigger generation
    res_gen = client.post("/api/recurrences/generate_to_end_of_year?template_id=" + str(tpl_id))
    assert res_gen.status_code == 200

    # 4. Fetch generated transactions
    res_txs = client.get("/api/transactions/?limit=10000")
    txs = [t for t in res_txs.json() if t["recurrence_id"] == tpl_id]
    
    # Newly generated ones (e.g. May 15) should have amount = 55.0
    may_tx = next(t for t in txs if t["date_operation"] == "2026-05-15")
    assert may_tx["amount"] == 55.0

    # Clean up
    client.delete(f"/api/recurrences/{tpl_id}")


def test_update_template_without_reconciled_transactions_does_not_disappear(monkeypatch):
    from datetime import date
    class MockDate(date):
        @classmethod
        def today(cls):
            return date(2026, 5, 29)
    monkeypatch.setattr("app.routers.recurrences.date", MockDate)

    # 1. Create a template
    res_tpl = client.post("/api/recurrences/", json={
        "amount": 20.0,
        "description": "Test Disappear",
        "frequency": "Monthly",
        "start_date": "2026-05-01",
        "category": "Abonnement",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 15
    })
    assert res_tpl.status_code == 200
    tpl_id = res_tpl.json()["id"]

    # 2. Trigger generation
    res_gen = client.post("/api/recurrences/generate_to_end_of_year")
    assert res_gen.status_code == 200

    # 3. Modify template
    res_upd = client.put(f"/api/recurrences/{tpl_id}", json={
        "amount": 25.0,
        "description": "Test Disappear",
        "frequency": "Monthly",
        "category": "Abonnement Loisir",
        "type": "expense_fixed",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 15
    })
    assert res_upd.status_code == 200

    # 4. Trigger generation again
    res_gen2 = client.post("/api/recurrences/generate_to_end_of_year")
    assert res_gen2.status_code == 200

    # 5. Verify transactions exist and have new amount
    res_txs = client.get("/api/transactions/?limit=10000")
    txs = [t for t in res_txs.json() if t["recurrence_id"] == tpl_id]
    assert len(txs) > 0
    assert all(t["amount"] == 25.0 for t in txs)

    # Clean up
    client.delete(f"/api/recurrences/{tpl_id}")


def test_global_undo_redo_system():
    # Capture initial states for non-regression assertion
    init_accounts = client.get("/api/stats/accounts").json()
    init_dashboard = client.get("/api/stats/dashboard").json()

    # 1. Test Transaction CREATE -> UNDO -> REDO
    res_tx = client.post("/api/transactions/", json={
        "date_saisie": "2026-05-29",
        "date_operation": "2026-05-29",
        "description": "Undo Test Tx",
        "amount": 42.0,
        "type": "expense_var",
        "category": "Alimentaire",
        "from_account_id": 1,
        "to_account_id": None,
        "reconciliation_date": None
    })
    assert res_tx.status_code == 200
    tx_id = res_tx.json()["id"]

    # Verify transaction exists
    assert client.get(f"/api/transactions/{tx_id}").status_code == 200

    # Undo last action (should delete the transaction)
    res_undo = client.post("/api/history/undo_last")
    assert res_undo.status_code == 200
    assert res_undo.json()["ok"] is True
    assert res_undo.json()["entity_type"] == "transaction"
    assert res_undo.json()["action_type"] == "CREATE"

    # Verify transaction is gone
    assert client.get(f"/api/transactions/{tx_id}").status_code == 404

    # Redo last action (should re-create the transaction)
    res_redo = client.post("/api/history/redo_last")
    assert res_redo.status_code == 200
    assert res_redo.json()["ok"] is True
    assert res_redo.json()["entity_type"] == "transaction"
    assert res_redo.json()["action_type"] == "CREATE"

    # Verify transaction exists again
    assert client.get(f"/api/transactions/{tx_id}").status_code == 200

    # 2. Test Account UPDATE -> UNDO
    res_acc = client.get("/api/accounts/")
    acc_id = res_acc.json()[0]["id"]
    original_name = res_acc.json()[0]["name"]

    # Update account name
    client.put(f"/api/accounts/{acc_id}", json={
        "name": "Updated Acc Name",
        "type": "Compte courant",
        "initial_balance": 1500.0,
        "color": "#123456",
        "is_closed": False
    })
    
    # Get last action ID
    res_hist = client.get("/api/history")
    last_action_id = res_hist.json()[0]["id"]
    assert res_hist.json()[0]["entity_type"] == "account"
    assert res_hist.json()[0]["action_type"] == "UPDATE"

    # Verify name is updated
    assert client.get("/api/accounts/").json()[0]["name"] == "Updated Acc Name"

    # Undo specific action
    res_specific_undo = client.post(f"/api/history/{last_action_id}/undo")
    assert res_specific_undo.status_code == 200
    assert res_specific_undo.json()["ok"] is True

    # Verify name is reverted
    assert client.get("/api/accounts/").json()[0]["name"] == original_name

    # 3. Test Budget DELETE -> UNDO
    # Create budget
    res_bg = client.post("/api/budgets/", json={
        "name": "Undo Test Budget",
        "monthly_amount": 100.0,
        "period": "monthly",
        "is_project": False,
        "is_closed": False,
        "categories": ["Alimentaire"]
    })
    assert res_bg.status_code == 200
    bg_id = res_bg.json()["id"]

    # Delete budget
    res_del_bg = client.delete(f"/api/budgets/{bg_id}")
    assert res_del_bg.status_code == 200

    # Verify budget is gone
    assert len([b for b in client.get("/api/budgets/").json() if b["id"] == bg_id]) == 0

    # Undo last action (DELETE)
    res_undo_del = client.post("/api/history/undo_last")
    assert res_undo_del.status_code == 200
    assert res_undo_del.json()["entity_type"] == "budget"
    assert res_undo_del.json()["action_type"] == "DELETE"

    # Verify budget and its category relationships are restored
    bg_list = client.get("/api/budgets/").json()
    restored_bg = next(b for b in bg_list if b["id"] == bg_id)
    assert restored_bg["name"] == "Undo Test Budget"
    assert "Alimentaire" in restored_bg["categories"]

    # 4. Test Category CREATE -> UNDO -> REDO
    res_cat = client.post("/api/categories/", json={"name": "Undo Test Cat", "type": "expense_var"})
    assert res_cat.status_code == 200
    cat_id = res_cat.json()["id"]

    # Undo CREATE category
    res_undo_cat = client.post("/api/history/undo_last")
    assert res_undo_cat.status_code == 200
    assert res_undo_cat.json()["entity_type"] == "category"
    assert res_undo_cat.json()["action_type"] == "CREATE"

    # Verify category is deleted
    assert len([c for c in client.get("/api/categories/").json() if c["id"] == cat_id]) == 0

    # Redo CREATE category
    res_redo_cat = client.post("/api/history/redo_last")
    assert res_redo_cat.status_code == 200

    # Verify category is restored
    assert len([c for c in client.get("/api/categories/").json() if c["id"] == cat_id]) == 1

    # 5. Test RecurrenceTemplate CREATE -> UNDO -> REDO
    res_rec = client.post("/api/recurrences/", json={
        "amount": 25.0,
        "description": "Undo Test Recurrence",
        "frequency": "Monthly",
        "start_date": "2026-01-15",
        "category": "Undo Test Cat",
        "type": "expense_var",
        "is_active": True,
        "is_closed": False,
        "day_of_month": 15
    })
    assert res_rec.status_code == 200
    rec_id = res_rec.json()["id"]

    # Undo CREATE RecurrenceTemplate
    res_undo_rec = client.post("/api/history/undo_last")
    assert res_undo_rec.status_code == 200
    assert res_undo_rec.json()["entity_type"] == "recurrence_template"

    # Verify template is deleted
    assert len([r for r in client.get("/api/recurrences/?include_closed=true").json() if r["id"] == rec_id]) == 0

    # Redo CREATE RecurrenceTemplate
    res_redo_rec = client.post("/api/history/redo_last")
    assert res_redo_rec.status_code == 200

    # Verify template is restored
    assert len([r for r in client.get("/api/recurrences/?include_closed=true").json() if r["id"] == rec_id]) == 1

    # 6. Test OrgUser CREATE -> UNDO -> REDO
    res_usr = client.post("/api/org_users/", json={
        "name": "Undo Test User",
        "is_active": True,
        "sort_order": 1
    })
    assert res_usr.status_code == 200
    usr_id = res_usr.json()["id"]

    # Undo CREATE OrgUser
    res_undo_usr = client.post("/api/history/undo_last")
    assert res_undo_usr.status_code == 200
    assert res_undo_usr.json()["entity_type"] == "org_user"

    # Verify user is deleted
    assert len([u for u in client.get("/api/org_users/").json() if u["id"] == usr_id]) == 0

    # Redo CREATE OrgUser
    res_redo_usr = client.post("/api/history/redo_last")
    assert res_redo_usr.status_code == 200

    # Verify user is restored
    assert len([u for u in client.get("/api/org_users/").json() if u["id"] == usr_id]) == 1

    # Cleanup all 5 created/restored entities (OrgUser, RecurrenceTemplate, Category, Budget, Transaction)
    # by chaining 5 undos to return to the absolute original state
    for _ in range(5):
        res_cleanup = client.post("/api/history/undo_last")
        assert res_cleanup.status_code == 200

    # Verify that all financial indicators have returned to their exact original values (no regression)
    final_accounts = client.get("/api/stats/accounts").json()
    final_dashboard = client.get("/api/stats/dashboard").json()

    assert final_accounts == init_accounts
    assert final_dashboard == init_dashboard


def test_budgets_status_tool_returns_summary():
    from app.routers.chat import get_budgets_status_tool
    db = TestingSessionLocal()
    try:
        # Create a test budget first to ensure we have data
        res_bg = client.post("/api/budgets/", json={
            "name": "Tool Summary Test",
            "monthly_amount": 120.0,
            "period": "monthly",
            "is_project": False,
            "is_closed": False,
            "categories": ["Alimentaire"]
        })
        assert res_bg.status_code == 200
        bg_id = res_bg.json()["id"]

        # Call tool
        res = get_budgets_status_tool(db=db)
        assert "summary" in res
        assert "total_budgeted" in res["summary"]
        assert res["summary"]["total_budgeted"] >= 120.0
        assert "budgets" in res
        assert len(res["budgets"]) > 0

        # Clean up
        client.delete(f"/api/budgets/{bg_id}")
    finally:
        db.close()


def test_ai_write_capabilities_tools():
    from app.routers.chat import (
        create_budget_envelope_tool,
        update_budget_envelope_tool,
        delete_budget_envelope_tool,
        allocate_savings_funds_tool,
        create_recurrence_template_tool,
        update_recurrence_template_tool,
        delete_recurrence_template_tool,
        create_category_tool,
        delete_category_tool,
        set_predicted_paycheck_tool
    )
    db = TestingSessionLocal()
    try:
        # 1. Test Budget tools
        res_bg = create_budget_envelope_tool(db, name="AI Test Budget", monthly_amount=150.0, categories=["Alimentaire"], force_write=True)
        assert res_bg["success"] is True
        bg_id = res_bg["budget_id"]
        
        # Verify history entry created
        res_hist = client.get("/api/history")
        assert res_hist.json()[0]["entity_type"] == "budget"
        assert res_hist.json()[0]["action_type"] == "CREATE"

        # Update budget
        res_upd_bg = update_budget_envelope_tool(db, budget_id=bg_id, monthly_amount=200.0, force_write=True)
        assert res_upd_bg["success"] is True
        
        # Delete budget
        res_del_bg = delete_budget_envelope_tool(db, budget_id=bg_id, force_write=True)
        assert res_del_bg["success"] is True

        # 2. Test Category tools
        res_cat = create_category_tool(db, name="AI Test Cat", type="expense_var", force_write=True)
        assert res_cat["success"] is True
        
        res_del_cat = delete_category_tool(db, name="AI Test Cat", force_write=True)
        assert res_del_cat["success"] is True

        # 3. Test Recurrence tools
        res_rec = create_recurrence_template_tool(
            db, amount=-50.0, description="AI Recurrence", frequency="Monthly",
            category="Alimentaire", type="expense_fixed", day_of_month=5, force_write=True
        )
        assert res_rec["success"] is True
        rec_id = res_rec["template_id"]

        res_upd_rec = update_recurrence_template_tool(db, template_id=rec_id, amount=-60.0, force_write=True)
        assert res_upd_rec["success"] is True

        res_del_rec = delete_recurrence_template_tool(db, template_id=rec_id, force_write=True)
        assert res_del_rec["success"] is True

        # 4. Test Paycheck tools
        res_pay = set_predicted_paycheck_tool(db, amount=3000.0, day_of_month=25, force_write=True)
        assert res_pay["success"] is True
        assert res_pay["amount"] == 3000.0

    finally:
        db.close()


def test_grouped_recurrence_undo_redo_and_restore():
    """Verify that:
    1. Undoing the first transaction of a newly created recurrence template also undoes the template creation itself (and deletes generated instances).
    2. Redoing this creation restores both the template, the transaction, and regenerates future instances.
    3. Undoing a template DELETE automatically regenerates all its future occurrences.
    4. Undoing a subsequent transaction only deletes that transaction and keeps the template.
    """
    # 1. Create a Recurrence Template
    res_tpl = client.post("/api/recurrences/", json={
        "amount": 49.99,
        "description": "Bi-Annual Subscription",
        "frequency": "Semi-Annually",
        "category": "Loisirs",
        "type": "expense_fixed",
        "day_of_month": 15,
        "from_account_id": 1,
        "to_account_id": None
    })
    assert res_tpl.status_code == 200
    tpl = res_tpl.json()
    tpl_id = tpl["id"]

    # 2. Create the first transaction linked to it
    res_tx = client.post("/api/transactions/", json={
        "date_saisie": "2026-07-18",
        "date_operation": "2026-07-15",
        "description": "Bi-Annual Subscription",
        "amount": 49.99,
        "type": "expense_fixed",
        "category": "Loisirs",
        "from_account_id": 1,
        "to_account_id": None,
        "recurrence_id": tpl_id
    })
    assert res_tx.status_code == 200
    tx_id = res_tx.json()["id"]

    # 3. Propagate/generate to the end of the year (simulating UI flow)
    res_gen = client.post(f"/api/recurrences/generate_to_end_of_year?template_id={tpl_id}")
    assert res_gen.status_code == 200

    # Ensure future instances were generated
    db = TestingSessionLocal()
    try:
        from app.models import Transaction, RecurrenceTemplate
        all_txs = db.query(Transaction).filter(Transaction.recurrence_id == tpl_id).all()
        # Should have the first transaction plus 1 semi-annual occurrence (approx 6 months later)
        assert len(all_txs) >= 2
    finally:
        db.close()

    # 4. Undo the last action (the transaction CREATE, which is grouped with the template CREATE)
    res_undo = client.post("/api/history/undo_last")
    assert res_undo.status_code == 200
    assert res_undo.json()["ok"] is True

    # Verify both the transaction AND the template are gone, and all generated instances are cleaned up
    db = TestingSessionLocal()
    try:
        tpl_in_db = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
        txs_in_db = db.query(Transaction).filter(Transaction.recurrence_id == tpl_id).all()
        assert tpl_in_db is None, "Grouped template was not deleted on undo!"
        assert len(txs_in_db) == 0, "Transactions generated from template were not cleaned up!"
    finally:
        db.close()

    # 5. Redo the action
    res_redo = client.post("/api/history/redo_last")
    assert res_redo.status_code == 200
    assert res_redo.json()["ok"] is True

    # Verify template, first transaction and generated occurrences are restored
    db = TestingSessionLocal()
    try:
        tpl_in_db = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
        txs_in_db = db.query(Transaction).filter(Transaction.recurrence_id == tpl_id).all()
        assert tpl_in_db is not None, "Template was not restored on redo!"
        assert len(txs_in_db) >= 2, "Transactions were not restored/regenerated on redo!"
    finally:
        db.close()

    # 6. Test delete restoration (DELETE -> UNDO)
    # Delete the template (which cascades to delete unreconciled transactions)
    res_del = client.delete(f"/api/recurrences/{tpl_id}")
    assert res_del.status_code == 200

    # Verify deleted in DB
    db = TestingSessionLocal()
    try:
        tpl_in_db = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
        txs_in_db = db.query(Transaction).filter(Transaction.recurrence_id == tpl_id, Transaction.reconciliation_date == None).all()
        assert tpl_in_db is None
        assert len(txs_in_db) == 0
    finally:
        db.close()

    # Undo the DELETE
    res_undo_del = client.post("/api/history/undo_last")
    assert res_undo_del.status_code == 200

    # Verify template is restored AND future instances are automatically regenerated
    db = TestingSessionLocal()
    try:
        tpl_in_db = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
        txs_in_db = db.query(Transaction).filter(Transaction.recurrence_id == tpl_id).all()
        assert tpl_in_db is not None, "Restored template not found!"
        assert len(txs_in_db) >= 2, "Restored template transactions were not automatically regenerated!"
    finally:
        db.close()

    # 7. Test subsequent transaction independence (only deletes the transaction, keeps the template)
    # Add a new transaction (simulating a subsequent occurrence or a later manual addition)
    res_subseq_tx = client.post("/api/transactions/", json={
        "date_saisie": "2026-07-18",
        "date_operation": "2026-12-15",
        "description": "Bi-Annual Subscription (manual)",
        "amount": 49.99,
        "type": "expense_fixed",
        "category": "Loisirs",
        "from_account_id": 1,
        "to_account_id": None,
        "recurrence_id": tpl_id
    })
    assert res_subseq_tx.status_code == 200
    subseq_tx_id = res_subseq_tx.json()["id"]

    # Wait a tiny bit (not needed here but simulate time elapsed)
    # Undo this subsequent transaction CREATE
    res_undo_subseq = client.post("/api/history/undo_last")
    assert res_undo_subseq.status_code == 200

    # Verify only the subsequent transaction is deleted, but the template remains
    db = TestingSessionLocal()
    try:
        subseq_in_db = db.query(Transaction).filter(Transaction.id == subseq_tx_id).first()
        tpl_in_db = db.query(RecurrenceTemplate).filter(RecurrenceTemplate.id == tpl_id).first()
        assert subseq_in_db is None, "Subsequent transaction was not deleted!"
        assert tpl_in_db is not None, "Template was incorrectly deleted when undoing subsequent transaction!"
    finally:
        db.close()


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
    test_chat_premium_flow()
    test_weekly_recurrence_and_strict_id_deduplication()
    test_quarterly_and_semiannual_recurrences()
    test_configurable_rolling_window_recurrences()
    test_auto_close_abandoned_templates()
    test_auto_close_zeroed_out_template()
    test_dynamic_amount_generation()
    test_update_template_without_reconciled_transactions_does_not_disappear()
    test_global_undo_redo_system()
    test_budgets_status_tool_returns_summary()
    test_ai_write_capabilities_tools()
    test_grouped_recurrence_undo_redo_and_restore()


def test_multi_currency_support():
    # 1. Test Base Currency configuration
    res = client.post("/api/config/", json={"base_currency": "USD"})
    assert res.status_code == 200
    res_cfg = client.get("/api/config/")
    assert res_cfg.json().get("base_currency") == "USD"

    # 2. Test Account Currency creation and retrieval
    res_acc = client.post("/api/accounts/", json={
        "name": "Compte Dollar US",
        "type": "Compte courant",
        "initial_balance": 100.0,
        "is_closed": False,
        "color": "#3366ff",
        "currency": "USD"
    })
    assert res_acc.status_code == 200
    acc_data = res_acc.json()
    assert acc_data["currency"] == "USD"

    # 3. Test Exchange Rates API CRUD
    res_rate = client.post("/api/config/exchange-rates", json={
        "from_currency": "USD",
        "to_currency": "EUR",
        "rate": 0.92
    })
    assert res_rate.status_code == 200
    rates = client.get("/api/config/exchange-rates").json()
    assert any(r["from_currency"] == "USD" and r["to_currency"] == "EUR" for r in rates)

    # 4. Test Transaction creation with original currency & foreign amount
    res_tx = client.post("/api/transactions/", json={
        "date_saisie": "2026-07-01",
        "date_operation": "2026-07-01",
        "description": "Achat New York",
        "amount": 92.0,
        "type": "expense_var",
        "category": "Alimentaire",
        "from_account_id": acc_data["id"],
        "original_amount": 100.0,
        "original_currency": "USD"
    })
    assert res_tx.status_code == 200, res_tx.text
    tx_json = res_tx.json()
    assert tx_json["original_amount"] == 100.0
    assert tx_json["original_currency"] == "USD"

    # 5. Test Online Rates fetch endpoint
    res_online = client.post("/api/config/exchange-rates/fetch-online")
    # Should return 200 if internet is available, or 502/500 if offline
    assert res_online.status_code in [200, 500, 502]


# ==============================================================================
# TEST 20: PDF Financial Report Data & Section Aggregation
# ==============================================================================
def test_pdf_report_data_and_section_aggregation():
    # 1. Fetch categories_by_month with year filter
    res_year = client.get("/api/stats/categories_by_month?reconciled=all&year=2026")
    assert res_year.status_code == 200
    data_year = res_year.json()
    assert "months" in data_year
    assert "years" in data_year
    assert "by_type" in data_year
    by_type = data_year["by_type"]
    assert len(by_type.keys()) > 0
    for t_key, t_val in by_type.items():
        assert "grand_total" in t_val
        assert "totals_per_cat" in t_val
        assert "totals_per_month" in t_val

    # 2. Fetch with custom date range
    res_custom = client.get("/api/stats/categories_by_month?reconciled=all&date_start=2026-01-01&date_end=2026-06-30")
    assert res_custom.status_code == 200
    data_custom = res_custom.json()
    assert "by_type" in data_custom

    # 3. Fetch with specific account filter
    res_acc = client.get("/api/stats/categories_by_month?reconciled=all&account_ids=1")
    assert res_acc.status_code == 200

    # 4. Org Users endpoint verification for PDF signature block
    res_org = client.post("/api/org_users/ensure_default")
    assert res_org.status_code == 200
    res_users = client.get("/api/org_users/")
    assert res_users.status_code == 200
    assert len(res_users.json()) >= 1


# ==============================================================================
# TEST 21: Subscription Closure & Reopen Flow (Mid-Year Closure)
# ==============================================================================
def test_subscription_closure_and_reopen_flow():
    # 1. Create a monthly recurrence template
    res_tpl = client.post("/api/recurrences/", json={
        "description": "Abonnement Gym Test",
        "amount": 29.99,
        "type": "expense_fixed",
        "category": "Sport",
        "frequency": "Monthly",
        "day_of_month": 15,
        "is_closed": False
    })
    assert res_tpl.status_code == 200
    tpl_id = res_tpl.json()["id"]

    # 2. Generate instances for current year
    res_gen = client.post(f"/api/recurrences/generate_to_end_of_year?template_id={tpl_id}")
    assert res_gen.status_code == 200

    res_txs = client.get("/api/transactions/")
    txs_before = [t for t in res_txs.json() if t["recurrence_id"] == tpl_id]
    assert len(txs_before) > 0

    # 3. Close the subscription with cutoff date 2026-06-30
    res_close = client.post(f"/api/recurrences/{tpl_id}/close", json={"closure_date": "2026-06-30"})
    assert res_close.status_code == 200
    assert res_close.json()["is_closed"] is True

    # 4. Verify future unreconciled transactions after 2026-06-30 are deleted
    res_txs_after = client.get("/api/transactions/")
    txs_after = [t for t in res_txs_after.json() if t["recurrence_id"] == tpl_id]
    future_txs = [t for t in txs_after if t["date_operation"] > "2026-06-30" and t["reconciliation_date"] is None]
    assert len(future_txs) == 0

    # 5. Reopen the subscription
    res_reopen = client.post(f"/api/recurrences/{tpl_id}/reopen")
    assert res_reopen.status_code == 200
    assert res_reopen.json()["is_closed"] is False

    # 6. Verify future transactions are regenerated
    res_txs_final = client.get("/api/transactions/")
    txs_final = [t for t in res_txs_final.json() if t["recurrence_id"] == tpl_id]
    assert len(txs_final) > len(txs_after)


def test_subscription_closure_undo_redo_flow():
    """TEST 22: Verify undoing and redoing a subscription closure action."""
    res_tpl = client.post("/api/recurrences/", json={
        "description": "Abonnement Undo Test",
        "amount": 25.0,
        "type": "expense_fixed",
        "category": "Loisirs",
        "frequency": "Monthly",
        "day_of_month": 10,
        "is_closed": False
    })
    assert res_tpl.status_code == 200
    tpl_id = res_tpl.json()["id"]

    # Generate instances
    res_gen = client.post(f"/api/recurrences/generate_to_end_of_year?template_id={tpl_id}")
    assert res_gen.status_code == 200

    # Close subscription
    res_close = client.post(f"/api/recurrences/{tpl_id}/close", json={"closure_date": "2026-06-10"})
    assert res_close.status_code == 200
    assert res_close.json()["is_closed"] is True
    action_id = res_close.json()["action_id"]
    assert action_id is not None

    # Undo closure
    res_undo = client.post(f"/api/history/{action_id}/undo")
    assert res_undo.status_code == 200
    assert res_undo.json()["ok"] is True

    # Verify template is open and transactions are regenerated
    res_tpl_check = client.get(f"/api/recurrences/?include_closed=true")
    tpl_obj = next(t for t in res_tpl_check.json() if t["id"] == tpl_id)
    assert tpl_obj["is_closed"] is False

    res_txs = client.get("/api/transactions/")
    txs = [t for t in res_txs.json() if t["recurrence_id"] == tpl_id]
    assert len(txs) > 0

    # Redo closure
    res_redo = client.post(f"/api/history/{action_id}/redo")
    assert res_redo.status_code == 200
    assert res_redo.json()["ok"] is True

    res_tpl_check2 = client.get(f"/api/recurrences/?include_closed=true")
    tpl_obj2 = next(t for t in res_tpl_check2.json() if t["id"] == tpl_id)
    assert tpl_obj2["is_closed"] is True



