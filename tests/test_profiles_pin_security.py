import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.profile_manager import load_profiles_data, set_active_profile, create_profile, delete_profile, clear_pin

client = TestClient(app)

def test_pin_security_only_active_profile_can_manage_pin():
    """Vérifie qu'un profil ne peut pas modifier ni supprimer le code PIN d'un autre profil."""
    # 1. Créer deux profils distincts
    data = load_profiles_data()
    p1 = get_or_create_test_profile("TestProf1")
    p2 = get_or_create_test_profile("TestProf2")

    try:
        # Activer p1
        set_active_profile(p1["id"])

        # Tenter de configurer le PIN de p2 (profil inactif) depuis la session de p1
        res_post = client.post(f"/api/profiles/{p2['id']}/pin", json={"pin": "1234"})
        assert res_post.status_code == 403
        assert "Seul le profil actuellement actif" in res_post.json()["detail"]

        # Tenter de supprimer le PIN de p2 depuis la session de p1
        res_del = client.delete(f"/api/profiles/{p2['id']}/pin")
        assert res_del.status_code == 403
        assert "Seul le profil actuellement actif" in res_del.json()["detail"]

        # Tenter de modifier le profil p2 (profil inactif) depuis la session de p1
        res_put_other = client.put(f"/api/profiles/{p2['id']}", json={"name": "PiratedName"})
        assert res_put_other.status_code == 403
        assert "Seul le profil actuellement actif" in res_put_other.json()["detail"]

        # Modifier le profil p1 (actif) -> Succès
        res_put_self = client.put(f"/api/profiles/{p1['id']}", json={"name": "TestProf1Edited"})
        assert res_put_self.status_code == 200
        assert res_put_self.json()["name"] == "TestProf1Edited"

        # Activer p1 et définir son propre PIN -> Succès
        res_self_post = client.post(f"/api/profiles/{p1['id']}/pin", json={"pin": "1234"})
        assert res_self_post.status_code == 200

        # Tenter de supprimer p2 (inactif) depuis la session de p1 -> 403 Forbidden
        res_del_other = client.delete(f"/api/profiles/{p2['id']}")
        assert res_del_other.status_code == 403
        assert "Seul le profil actuellement actif" in res_del_other.json()["detail"]

        # Activer p2 puis supprimer p2 -> Succès (200 OK), bascule sur fallback
        set_active_profile(p2["id"])
        res_del_self = client.delete(f"/api/profiles/{p2['id']}")
        assert res_del_self.status_code == 200
        assert res_del_self.json()["reload_required"] is True

        # Rebasculer sur p1 pour le nettoyage
        set_active_profile(p1["id"])

    finally:
        # Nettoyage
        set_active_profile("default")
        try:
            clear_pin(p1["id"])
        except Exception:
            pass
        try:
            clear_pin(p2["id"])
        except Exception:
            pass
        try:
            delete_profile(p1["id"])
        except Exception:
            pass
        try:
            delete_profile(p2["id"])
        except Exception:
            pass


def get_or_create_test_profile(name: str):
    data = load_profiles_data()
    existing = next((p for p in data.get("profiles", []) if p["name"] == name), None)
    if existing:
        return existing
    return create_profile(name=name, color="#6366f1")
