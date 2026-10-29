"""Le PIN d'un profil doit réellement protéger l'accès aux données (SEC-08)."""
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.profile_manager import (
    load_profiles_data, set_active_profile, create_profile, delete_profile, clear_pin, set_pin,
)
from app.services import pin_session


@pytest.fixture
def protected_profile():
    pin_session.reset_all()
    prof = create_profile(name="PinGuardTest")
    recovery_code = set_pin(prof["id"], "4321")
    set_active_profile(prof["id"])
    yield prof, recovery_code
    pin_session.reset_all()
    set_active_profile("default")
    try:
        clear_pin(prof["id"])
        delete_profile(prof["id"])
    except Exception:
        pass


def _unlock(client, profile_id, pin="4321"):
    res = client.post(f"/api/profiles/{profile_id}/activate", json={"pin": pin})
    assert res.status_code == 200, res.text
    return res.json()["session_token"]


def test_data_blocked_without_session(protected_profile):
    client = TestClient(app)
    res = client.get("/api/accounts/")
    assert res.status_code == 401
    assert res.json()["code"] == "pin_required"
    # Les routes nécessaires à l'écran de verrouillage restent accessibles
    assert client.get("/api/profiles/").status_code == 200
    assert client.get("/api/health").status_code == 200


def test_header_token_unlocks_and_lock_revokes(protected_profile):
    prof, _ = protected_profile
    client = TestClient(app)
    token = _unlock(client, prof["id"])
    other = TestClient(app)  # sans cookie : uniquement l'en-tête
    headers = {pin_session.SESSION_HEADER: token}
    assert other.get("/api/accounts/", headers=headers).status_code == 200
    assert other.get(f"/api/accounts/?{pin_session.SESSION_QUERY}={token}").status_code == 200

    assert other.post("/api/profiles/lock", headers=headers).status_code == 200
    assert other.get("/api/accounts/", headers=headers).status_code == 401


def test_cookie_session_works_for_same_origin(protected_profile):
    prof, _ = protected_profile
    client = TestClient(app)
    _unlock(client, prof["id"])
    assert client.get("/api/accounts/").status_code == 200


def test_bruteforce_is_rate_limited(protected_profile):
    prof, _ = protected_profile
    client = TestClient(app)
    for _ in range(pin_session.MAX_FAILURES):
        assert client.post(f"/api/profiles/{prof['id']}/activate", json={"pin": "0000"}).status_code == 401
    # Même le bon PIN est refusé pendant le blocage
    res = client.post(f"/api/profiles/{prof['id']}/activate", json={"pin": "4321"})
    assert res.status_code == 429


def test_recovery_code_resets_pin(protected_profile):
    prof, recovery_code = protected_profile
    client = TestClient(app)
    old_token = _unlock(client, prof["id"])

    bad = client.post(f"/api/profiles/{prof['id']}/pin/recover", json={"recovery_code": "AAAA-BBBB-CCCC-DDDD", "new_pin": "9999"})
    assert bad.status_code == 401

    res = client.post(f"/api/profiles/{prof['id']}/pin/recover",
                      json={"recovery_code": recovery_code.lower().replace("-", " "), "new_pin": "9999"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["recovery_code"] and body["recovery_code"] != recovery_code
    # Les anciennes sessions sont révoquées, le nouveau PIN fonctionne
    assert not pin_session.is_valid(old_token, prof["id"])
    assert TestClient(app).post(f"/api/profiles/{prof['id']}/activate", json={"pin": "9999"}).status_code == 200
    # L'ancien code de récupération ne fonctionne plus
    again = client.post(f"/api/profiles/{prof['id']}/pin/recover", json={"recovery_code": recovery_code})
    assert again.status_code == 401


def test_recovery_without_new_pin_removes_protection(protected_profile):
    prof, recovery_code = protected_profile
    client = TestClient(app)
    res = client.post(f"/api/profiles/{prof['id']}/pin/recover", json={"recovery_code": recovery_code})
    assert res.status_code == 200
    assert TestClient(app).get("/api/accounts/").status_code == 200


def test_secrets_never_exposed(protected_profile):
    client = TestClient(app)
    for p in client.get("/api/profiles/").json()["profiles"]:
        for key in ("pin_hash", "pin_salt", "recovery_hash", "recovery_salt"):
            assert key not in p
    target = next(p for p in client.get("/api/profiles/").json()["profiles"] if p["name"] == "PinGuardTest")
    assert target["has_pin"] and target["has_recovery_code"]


def test_reset_pin_cli(protected_profile, capsys):
    from app.reset_pin import main
    prof, _ = protected_profile
    assert main(["reset_pin", prof["id"]]) == 0
    target = next(p for p in load_profiles_data()["profiles"] if p["id"] == prof["id"])
    assert not target.get("pin_hash") and not target.get("recovery_hash")


def test_global_backup_refused_when_other_profile_protected(protected_profile):
    prof, _ = protected_profile
    client = TestClient(app)
    set_active_profile("default")
    res = client.get("/api/backup/download-all")
    assert res.status_code == 403
    assert "PinGuardTest" in res.json()["detail"]
