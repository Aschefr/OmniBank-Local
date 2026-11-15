"""Deux personnes utilisent le même serveur en même temps, chacune sur son profil."""
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.database import get_engine
from app.main import app
from app.models import Account
from app.profile_manager import (
    clear_pin, create_profile, delete_profile, get_default_profile, set_active_profile, set_pin,
)
from app.request_profile import PROFILE_HEADER, bind_profile, current_profile_id, profile_scope
from app.services import pin_session, profile_presence
from app.services.credential_vault import VaultSessionManager


@pytest.fixture
def two_profiles():
    pin_session.reset_all()
    profile_presence.reset_all()
    set_active_profile("default")
    first = create_profile(name="Profil Un")
    second = create_profile(name="Profil Deux")
    for prof, account in ((first, "Compte Un"), (second, "Compte Deux")):
        db = sessionmaker(bind=get_engine(prof["id"]))()
        db.add(Account(name=account, type="Compte courant", initial_balance=0.0))
        db.commit()
        db.close()
    yield first, second
    pin_session.reset_all()
    profile_presence.reset_all()
    set_active_profile("default")
    for prof in (first, second):
        VaultSessionManager.lock_session(profile_id=prof["id"])
        try:
            clear_pin(prof["id"])
            delete_profile(prof["id"])
        except Exception:
            pass


def _names(res):
    assert res.status_code == 200, res.text
    return {a["name"] for a in res.json()}


def test_each_client_sees_its_own_profile(two_profiles):
    first, second = two_profiles
    client = TestClient(app)
    seen_first = _names(client.get("/api/accounts/", headers={PROFILE_HEADER: first["id"]}))
    seen_second = _names(client.get("/api/accounts/", headers={PROFILE_HEADER: second["id"]}))
    assert "Compte Un" in seen_first and "Compte Deux" not in seen_first
    assert "Compte Deux" in seen_second and "Compte Un" not in seen_second
    assert get_default_profile()["id"] == "default"


def test_profile_list_names_the_request_profile_and_the_default(two_profiles):
    first, _ = two_profiles
    body = TestClient(app).get("/api/profiles/", headers={PROFILE_HEADER: first["id"]}).json()
    assert body["active_profile_id"] == first["id"]
    assert body["default_profile_id"] == "default"


def test_switching_profile_keeps_the_other_vault_open(two_profiles):
    first, second = two_profiles
    VaultSessionManager.create_session("mot-de-passe-invente", profile_id=first["id"])
    client = TestClient(app)
    assert client.post(f"/api/profiles/{second['id']}/activate", headers={PROFILE_HEADER: first["id"]}).status_code == 200
    assert client.post(f"/api/profiles/{second['id']}/activate").status_code == 200
    assert VaultSessionManager.is_unlocked(profile_id=first["id"])


def test_a_client_naming_its_profile_leaves_the_default_alone(two_profiles):
    first, second = two_profiles
    client = TestClient(app)
    client.post(f"/api/profiles/{second['id']}/activate", headers={PROFILE_HEADER: first["id"]})
    assert get_default_profile()["id"] == "default"
    # Un client d'avant les profils simultanés change toujours le profil par défaut
    client.post(f"/api/profiles/{second['id']}/activate")
    assert get_default_profile()["id"] == second["id"]


def test_pin_is_checked_against_the_request_profile(two_profiles):
    first, second = two_profiles
    set_pin(second["id"], "4321")
    client = TestClient(app)
    locked = client.get("/api/accounts/", headers={PROFILE_HEADER: second["id"]})
    assert locked.status_code == 401
    assert locked.json()["profile_id"] == second["id"]
    # L'autre profil, sans PIN, reste utilisable au même moment
    assert client.get("/api/accounts/", headers={PROFILE_HEADER: first["id"]}).status_code == 200

    token = client.post(f"/api/profiles/{second['id']}/activate", json={"pin": "4321"},
                        headers={PROFILE_HEADER: first["id"]}).json()["session_token"]
    unlocked = TestClient(app).get("/api/accounts/", headers={PROFILE_HEADER: second["id"], pin_session.SESSION_HEADER: token})
    assert "Compte Deux" in _names(unlocked)


def test_a_deleted_profile_is_reported_not_replaced(two_profiles):
    client = TestClient(app)
    res = client.get("/api/accounts/", headers={PROFILE_HEADER: "p_disparu0"})
    assert res.status_code == 409
    assert res.json()["code"] == "profile_unknown"
    # L'écran de choix du profil reste accessible
    assert client.get("/api/profiles/", headers={PROFILE_HEADER: "p_disparu0"}).status_code == 200


def test_a_thread_works_in_the_profile_it_was_given():
    seen = {}

    def work(key):
        seen[key] = current_profile_id()

    with profile_scope("p_aaaa1111"):
        bound = threading.Thread(target=bind_profile(work), args=("bound",))
        plain = threading.Thread(target=work, args=("plain",))
    for t in (bound, plain):
        t.start()
        t.join()
    assert seen == {"bound": "p_aaaa1111", "plain": None}


def _restore(client, profile_id, device):
    files = {"file": ("sauvegarde.zip", b"pas une archive", "application/zip")}
    headers = {PROFILE_HEADER: profile_id, profile_presence.CLIENT_HEADER: device}
    return client.post("/api/backup/upload-all", files=files, headers=headers)


def test_global_restore_waits_for_the_other_person(two_profiles):
    first, second = two_profiles
    client = TestClient(app)
    client.get("/api/accounts/", headers={PROFILE_HEADER: second["id"], profile_presence.CLIENT_HEADER: "telephone"})

    refused = _restore(client, first["id"], "ordinateur")
    assert refused.status_code == 409
    assert "Profil Deux" in refused.json()["detail"]

    profile_presence.reset_all()
    assert _restore(client, first["id"], "ordinateur").status_code == 400  # la garde laisse passer, l'archive est refusée ensuite


def test_changing_profile_yourself_does_not_block_the_restore(two_profiles):
    first, second = two_profiles
    client = TestClient(app)
    client.get("/api/accounts/", headers={PROFILE_HEADER: second["id"], profile_presence.CLIENT_HEADER: "ordinateur"})
    assert _restore(client, first["id"], "ordinateur").status_code == 400


def test_a_deleted_profile_no_longer_blocks_the_restore(two_profiles):
    first, _ = two_profiles
    profile_presence.seen("id:telephone", "p_disparu0")
    assert _restore(TestClient(app), first["id"], "ordinateur").status_code == 400
