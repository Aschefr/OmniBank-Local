from fastapi.testclient import TestClient
import uuid
import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from app.main import app

client = TestClient(app)

def run_tests():
    print("Running Point 4 API Tests via TestClient...")
    suffix = str(uuid.uuid4())[:8]
    cat_name = f"LoyerTest_{suffix}"
    
    # 1. Create category as "variable"
    print(f"\n[1] Creating category '{cat_name}' as 'variable' (expense_var)...")
    res = client.post('/api/categories/', json={"name": cat_name, "type": "expense_var"})
    assert res.status_code == 200, f"Failed: {res.text}"
    cat_data = res.json()
    print("OK:", cat_data)
    
    # 2. Try to create recurrent template using this variable category.
    print(f"\n[2] Creating Recurrence Template with category '{cat_name}' as expense_fixed...")
    res = client.post('/api/recurrences/', json={
        "amount": 500.0,
        "description": f"Test Loyer {suffix}",
        "frequency": "Monthly",
        "start_date": "2026-06-01",
        "category": cat_name,
        "type": "expense_fixed",
        "is_active": True
    })
    
    if res.status_code == 200:
        rec_data = res.json()
        print("OK: Recurrence created.", rec_data)
        
        # Verify the category type
        res_cat = client.get('/api/categories/')
        all_cats = res_cat.json()
        cat_updated = next((c for c in all_cats if c["name"] == cat_name), None)
        print(f"Category type after recurrence creation: {cat_updated['type']}")
        if cat_updated['type'] != "expense_fixed":
            print(f"WARNING: Category '{cat_name}' is still '{cat_updated['type']}'! It did not automatically migrate to fixed.")
    else:
        print("FAILED to create recurrence:", res.text)
        
    # 3. Simulate assigning a DIFFERENT 'variable' category to a recurrence via edit
    cat2_name = f"AssuranceTest_{suffix}"
    print(f"\n[3] Creating second category '{cat2_name}' as 'variable' (expense_var)...")
    client.post('/api/categories/', json={"name": cat2_name, "type": "expense_var"})
    
    print(f"Editing Recurrence ID {rec_data['id']} to use category '{cat2_name}'...")
    res_upd = client.put(f"/api/recurrences/{rec_data['id']}", json={
        "amount": 500.0,
        "description": f"Test Loyer {suffix}",
        "frequency": "Monthly",
        "start_date": "2026-06-01",
        "category": cat2_name,
        "type": "expense_fixed",
        "is_active": True
    })
    if res_upd.status_code == 200:
        print("OK: Recurrence updated.")
        
        res_cat = client.get('/api/categories/')
        all_cats = res_cat.json()
        cat_updated2 = next((c for c in all_cats if c["name"] == cat2_name), None)
        print(f"Category type after recurrence update: {cat_updated2['type']}")
        if cat_updated2['type'] != "expense_fixed":
            print(f"WARNING: Category '{cat2_name}' is still '{cat_updated2['type']}'!")
    else:
        print("FAILED to update recurrence:", res_upd.text)

    # 4. Check if we can create a 'fixed' category with the exact same name as 'variable'
    cat3_name = f"InternetTest_{suffix}"
    print(f"\n[4] Testing force_move category conflict...")
    client.post('/api/categories/', json={"name": cat3_name, "type": "expense_var"})
    
    # ADD a transaction to make it "used"
    client.post('/api/transactions/', json={
        "amount": 10.0,
        "description": "Test TX",
        "date_operation": "2026-05-29",
        "date_saisie": "2026-05-29",
        "category": cat3_name,
        "type": "expense_var",
        "from_account_id": 1
    })

    res_conf = client.post('/api/categories/', json={"name": cat3_name, "type": "expense_fixed"})
    print("Trying to create fixed with same name. Status:", res_conf.status_code)
    if res_conf.status_code == 409:
        print("Conflict correctly detected (409). Now trying with force_move=True...")
        res_f = client.post('/api/categories/?force_move=true', json={"name": cat3_name, "type": "expense_fixed"})
        print("With force_move=True. Status:", res_f.status_code)
        if res_f.status_code == 200:
            print("SUCCESS! Category moved.")
        else:
            print("FAILED to move category:", res_f.text)
    else:
        print("Unexpected status:", res_conf.status_code, res_conf.text)

if __name__ == "__main__":
    try:
        run_tests()
    except Exception as e:
        print("Error:", e)
