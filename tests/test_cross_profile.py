import pytest
from datetime import date
from fastapi.testclient import TestClient
from app.main import app
from app.database import get_db, get_engine, SessionLocal
from app.models import Account, Transaction
from app.profile_manager import (
    load_profiles_data,
    set_active_profile,
    create_profile,
    delete_profile
)
from app.services.finance_engine import calculate_balances

client = TestClient(app)


def test_cross_profile_full_workflow():
    """Test complet du workflow de virement inter-profil."""
    # 1. Préparation de deux profils distincts avec comptes
    p1 = create_profile(name="ProfilAlice", color="#6366f1")
    p2 = create_profile(name="ProfilBob", color="#3b82f6")

    try:
        # Initialiser compte Alice (p1)
        set_active_profile(p1["id"])
        db_alice = SessionLocal()
        acc_alice = Account(name="Compte Alice", type="Compte courant", initial_balance=1000.0)
        db_alice.add(acc_alice)
        db_alice.commit()
        alice_acc_id = acc_alice.id
        db_alice.close()

        # Initialiser compte Bob (p2)
        set_active_profile(p2["id"])
        db_bob = SessionLocal()
        acc_bob = Account(name="Livret Bob", type="Livret", initial_balance=500.0)
        db_bob.add(acc_bob)
        db_bob.commit()
        bob_acc_id = acc_bob.id
        db_bob.close()

        # Revenir sur Alice (p1)
        set_active_profile(p1["id"])

        # 2. GET /api/cross-profile/{p2_id}/accounts (listing des comptes distants sans PIN)
        res_accs = client.get(f"/api/cross-profile/{p2['id']}/accounts")
        assert res_accs.status_code == 200
        remote_accounts = res_accs.json()
        assert len(remote_accounts) == 1
        assert remote_accounts[0]["name"] == "Livret Bob"
        assert "initial_balance" not in remote_accounts[0]  # Sécurité : pas de solde exposé

        # 3. POST /api/cross-profile/transfer
        transfer_payload = {
            "target_profile_id": p2["id"],
            "target_account_id": bob_acc_id,
            "source_account_id": alice_acc_id,
            "amount": 200.0,
            "date_operation": date.today().isoformat(),
            "description": "Cadeau anniversaire",
            "category": "Cadeau"
        }
        res_transfer = client.post("/api/cross-profile/transfer", json=transfer_payload)
        assert res_transfer.status_code == 200
        tx_source = res_transfer.json()
        assert tx_source["amount"] == 200.0
        assert tx_source["cross_profile_status"] == "accepted"
        link_id = tx_source["cross_profile_link_id"]
        assert link_id is not None

        # Vérifier que le solde d'Alice a bien déduit 200 EUR (1000 - 200 = 800)
        db_alice = SessionLocal()
        bals_alice = calculate_balances(db_alice)
        assert bals_alice[alice_acc_id] == 800.0
        db_alice.close()

        # 4. Basculer sur Bob (p2) pour vérifier l'état PENDING
        set_active_profile(p2["id"])

        # Vérifier que le solde de Bob est encore à 500 EUR (la transaction pending est exclue des calculs)
        db_bob = SessionLocal()
        bals_bob = calculate_balances(db_bob)
        assert bals_bob[bob_acc_id] == 500.0
        db_bob.close()

        # GET /api/cross-profile/pending/count
        res_count = client.get("/api/cross-profile/pending/count")
        assert res_count.status_code == 200
        assert res_count.json()["count"] == 1

        # GET /api/cross-profile/pending
        res_pending = client.get("/api/cross-profile/pending")
        assert res_pending.status_code == 200
        pending_list = res_pending.json()
        assert len(pending_list) == 1
        assert pending_list[0]["cross_profile_link_id"] == link_id
        assert pending_list[0]["cross_profile_status"] == "pending"

        # 5. Valider le virement (Accept)
        res_val = client.post(f"/api/cross-profile/validate/{link_id}", json={"action": "accept"})
        assert res_val.status_code == 200
        assert res_val.json()["status"] == "accepted"

        # Vérifier que le solde de Bob a maintenant augmenté de 200 EUR (500 + 200 = 700)
        db_bob = SessionLocal()
        bals_bob_after = calculate_balances(db_bob)
        assert bals_bob_after[bob_acc_id] == 700.0
        db_bob.close()

        # 6. Test de suppression résiliente : supprimer le profil Bob
        set_active_profile(p1["id"])
        delete_profile(p2["id"])

        # Vérifier qu'Alice conserve sa transaction avec son label figé intact
        db_alice = SessionLocal()
        alice_tx = db_alice.query(Transaction).filter(Transaction.cross_profile_link_id == link_id).first()
        assert alice_tx is not None
        assert alice_tx.cross_profile_label == f"{p2.get('icon', '👤')} ProfilBob — Livret Bob"
        db_alice.close()

    finally:
        set_active_profile("default")
        try:
            delete_profile(p1["id"])
        except Exception:
            pass
        try:
            delete_profile(p2["id"])
        except Exception:
            pass
