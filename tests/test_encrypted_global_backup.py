"""Sauvegarde globale : les profils protégés par PIN sont chiffrés, sauvegardables sans leur PIN,
et restaurables uniquement avec leur PIN (ce serveur) ou leur code de récupération (ailleurs).

Exécuté dans un dossier de données temporaire : une restauration globale réécrit tout le dossier."""
import io
import json
import os
import zipfile

import pytest
from fastapi.testclient import TestClient

import app.database as database
import app.profile_manager as pm
import app.services.backup_archive as backup_archive
from app.main import app
from app.services import pin_session


@pytest.fixture
def isolated_data(tmp_path, monkeypatch):
    data_dir = str(tmp_path)
    for pid in list(database._engines):
        database.dispose_engine(pid)
    monkeypatch.setattr(database, "DATA_DIR", data_dir)
    monkeypatch.setattr(pm, "DATA_DIR", data_dir)
    monkeypatch.setattr(pm, "PROFILES_FILE", os.path.join(data_dir, "profiles.json"))
    monkeypatch.setattr(pm, "PROFILES_DIR", os.path.join(data_dir, "profiles"))
    monkeypatch.setattr(backup_archive, "DATA_DIR", data_dir)
    pin_session.reset_all()
    pm.ensure_profiles_initialized()
    yield data_dir
    for pid in list(database._engines):
        database.dispose_engine(pid)
    pin_session.reset_all()


def _marker(profile_id, text=None):
    path = os.path.join(pm.get_profile_uploads_dir(profile_id), "marker.txt")
    if text is not None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read()


@pytest.fixture
def setup(isolated_data):
    """Profil 'default' libre et actif ; profil 'Secret' protégé par PIN (verrouillé)."""
    secret = pm.create_profile(name="Secret")
    recovery = pm.set_pin(secret["id"], "4321")
    _marker("default", "default-v1")
    _marker(secret["id"], "secret-v1")
    pm.set_active_profile("default")
    return {"secret_id": secret["id"], "recovery": recovery}


def _download(client):
    res = client.get("/api/backup/download-all")
    assert res.status_code == 200, res.text
    return res.content


def _restore(client, archive: bytes, secrets=None):
    data = {} if secrets is None else {"secrets": json.dumps(secrets)}
    return client.post("/api/backup/upload-all", files={"file": ("b.zip", archive, "application/zip")}, data=data)


def test_backup_works_while_profile_locked_and_is_encrypted(setup):
    sid = setup["secret_id"]
    archive = _download(TestClient(app))
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        names = z.namelist()
        assert f"encrypted/{sid}.omnienc" in names
        # Aucun fichier en clair du profil protégé
        assert not any(sid in n and not n.startswith("encrypted/") for n in names)
        assert b"secret-v1" not in z.read(f"encrypted/{sid}.omnienc")
        archived = next(p for p in json.loads(z.read("profiles.json"))["profiles"] if p["id"] == sid)
        # Ni le hash du PIN ni la clé emballée par le PIN ne quittent le serveur
        assert archived["pin_hash"] is None
        assert all(k["pin"] is None and k["recovery"] for k in archived["backup_keys"])
        # Le profil libre reste en clair
        assert "uploads/marker.txt" in names


def test_restore_asks_for_secrets_then_restores_with_pin(setup):
    sid = setup["secret_id"]
    client = TestClient(app)
    archive = _download(client)
    _marker("default", "default-v2")
    _marker(sid, "secret-v2")

    res = _restore(client, archive)
    assert res.status_code == 409
    needs = res.json()["detail"]["profiles"]
    assert [n["id"] for n in needs] == [sid] and needs[0]["encrypted"]

    assert _restore(client, archive, {sid: {"secret": "0000"}}).status_code == 401
    res = _restore(client, archive, {sid: {"secret": "4321"}})
    assert res.status_code == 200, res.text
    assert _marker("default") == "default-v1"
    assert _marker(sid) == "secret-v1"
    # La protection est conservée
    assert pm.verify_pin(sid, "4321") and not pm.verify_pin(sid, "0000")


def test_restore_without_secret_keeps_local_protected_profile(setup):
    sid = setup["secret_id"]
    client = TestClient(app)
    archive = _download(client)
    _marker("default", "default-v2")
    _marker(sid, "secret-v2")

    res = _restore(client, archive, {})
    assert res.status_code == 200, res.text
    assert res.json()["skipped"] == ["Secret"]
    assert _marker("default") == "default-v1"
    assert _marker(sid) == "secret-v2"


def test_restore_on_new_machine_with_recovery_code(setup):
    sid = setup["secret_id"]
    client = TestClient(app)
    archive = _download(client)
    # « Nouvelle machine » : le profil protégé n'existe plus localement
    pm.delete_profile(sid)
    pm.set_active_profile("default")

    needs = _restore(client, archive).json()["detail"]["profiles"]
    assert needs[0]["needs_new_pin"]
    # Le PIN seul ne suffit pas hors du serveur d'origine (slot PIN absent de l'archive)
    assert _restore(client, archive, {sid: {"secret": "4321", "new_pin": "2468"}}).status_code == 401
    res = _restore(client, archive, {sid: {"secret": setup["recovery"], "new_pin": "2468"}})
    assert res.status_code == 200, res.text
    new_code = res.json()["recovery_codes"][sid]
    assert new_code and new_code != setup["recovery"]
    assert _marker(sid) == "secret-v1"
    assert pm.verify_pin(sid, "2468")


def test_old_backup_still_readable_after_pin_change(setup):
    sid = setup["secret_id"]
    client = TestClient(app)
    archive = _download(client)
    pm.set_pin(sid, "9999", unlock_secret="4321")
    _marker(sid, "secret-v2")
    res = _restore(client, archive, {sid: {"secret": "9999"}})
    assert res.status_code == 200, res.text
    assert _marker(sid) == "secret-v1"


def test_legacy_pin_without_key_is_skipped_until_unlocked(isolated_data):
    legacy = pm.create_profile(name="Legacy")
    pm.set_pin(legacy["id"], "1357")
    # Simule un PIN défini avant cette fonctionnalité : aucune clé de sauvegarde
    data = pm.load_profiles_data()
    target = next(p for p in data["profiles"] if p["id"] == legacy["id"])
    target["backup_keys"], target["backup_key_id"] = [], None
    pm._save_profiles_data(data)
    pm.set_active_profile("default")

    client = TestClient(app)
    res = client.get("/api/backup/download-all")
    assert res.status_code == 200
    assert "Legacy" in res.headers.get("X-OmniBank-Skipped-Profiles", "")

    # Un déverrouillage crée la clé ; le profil est alors inclus (chiffré)
    assert client.post(f"/api/profiles/{legacy['id']}/activate", json={"pin": "1357"}).status_code == 200
    pm.set_active_profile("default")
    with zipfile.ZipFile(io.BytesIO(_download(TestClient(app)))) as z:
        assert f"encrypted/{legacy['id']}.omnienc" in z.namelist()
