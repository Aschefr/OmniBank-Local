"""Licence du Mode Organisation : les clés, et le verrou côté serveur. Clés de test générées ici, jamais la clé réelle."""
import base64
import json
import pathlib

import pytest
from cryptography.hazmat.primitives.asymmetric import ed25519
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import GlobalConfig
from app.routers.config import get_all_config as get_config, set_config
from app.routers.license import LicenseActivateRequest, activate_license, deactivate_license
from app.services import license_service
from app.services.budget_service import is_org_mode

pytestmark = pytest.mark.real_license

EMAIL = "tresorier@example.org"

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture
def db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture
def signer(monkeypatch):
    """Une clé de signature jetable, reconnue par le service le temps du test."""
    private_key = ed25519.Ed25519PrivateKey.generate()
    raw = private_key.public_key().public_bytes_raw()
    monkeypatch.setattr(license_service, "PUBLIC_KEYS_B64", (base64.b64encode(raw).decode(),))
    license_service.read_license.cache_clear()
    yield private_key
    license_service.read_license.cache_clear()


def _urlsafe(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def v2_key(private_key, email=EMAIL, license_id="OB-TEST-0001", org="CSE Exemple", context=license_service.LICENSE_V2_CONTEXT):
    payload = json.dumps({"v": 2, "id": license_id, "org": org, "email": email, "issued": "2026-11-04"}, separators=(",", ":")).encode()
    return f"OB2.{_urlsafe(payload)}.{_urlsafe(private_key.sign(context + payload))}"


def _store(db, email, key):
    db.add_all([GlobalConfig(key="license_email", value=email), GlobalConfig(key="license_key", value=key)])
    db.commit()


# ── Lecture des clés ─────────────────────────────────────────

def test_new_key_gives_its_content(signer):
    info = license_service.read_license(EMAIL, v2_key(signer))

    assert info == {"kind": "v2", "email": EMAIL, "id": "OB-TEST-0001", "org": "CSE Exemple", "issued": "2026-11-04"}


def test_email_is_compared_without_case_or_spaces(signer):
    assert license_service.read_license(f"  {EMAIL.upper()} ", v2_key(signer)) is not None


def test_new_key_is_refused_for_another_email(signer):
    assert license_service.read_license("autre@example.org", v2_key(signer)) is None


def test_modified_content_is_refused(signer):
    prefix, payload, signature = v2_key(signer).split(".")
    changed = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    changed["org"] = "Autre association"

    assert license_service.read_license(EMAIL, f"{prefix}.{_urlsafe(json.dumps(changed).encode())}.{signature}") is None


def test_signature_made_for_something_else_is_refused(signer):
    assert license_service.read_license(EMAIL, v2_key(signer, context=b"autre-usage\n")) is None


def test_key_from_another_signer_is_refused(signer):
    assert license_service.read_license(EMAIL, v2_key(ed25519.Ed25519PrivateKey.generate())) is None


def test_revoked_license_is_refused(signer, monkeypatch):
    monkeypatch.setattr(license_service, "REVOKED_LICENSE_IDS", frozenset({"OB-TEST-0001"}))

    assert license_service.read_license(EMAIL, v2_key(signer)) is None
    assert license_service.read_license(EMAIL, v2_key(signer, license_id="OB-TEST-0002")) is not None


def test_first_signed_keys_stay_valid(signer):
    key = base64.b64encode(signer.sign(EMAIL.encode())).decode()

    assert license_service.read_license(EMAIL, key)["kind"] == "signed"
    assert license_service.read_license("autre@example.org", key) is None


@pytest.mark.parametrize("key", ["", "   ", "***", "OB2.", "OB2.a.b", "OB2.a.b.c", base64.b64encode(bytes(64)).decode()])
def test_malformed_keys_are_refused(signer, key):
    assert license_service.read_license(EMAIL, key) is None


# ── Anciennes clés ───────────────────────────────────────────

def test_invented_legacy_key_is_refused(db):
    _store(db, "nimporte@qui.fr", "OMNI-INVENTEE")

    assert license_service.is_license_active(db) is False


def test_listed_legacy_key_keeps_working_on_its_instance(db, monkeypatch):
    monkeypatch.setattr(license_service, "LEGACY_KEY_HASHES", frozenset({license_service.legacy_key_hash(EMAIL, "OMNI-TEST-KEY")}))
    license_service.read_license.cache_clear()
    db.add(GlobalConfig(key="enable_org_mode", value="true"))
    _store(db, EMAIL, "OMNI-TEST-KEY")

    assert is_org_mode(db) is True
    assert license_service.license_status(db) == {"active": True, "email": EMAIL, "kind": "legacy"}
    license_service.read_license.cache_clear()


def test_legacy_key_cannot_come_back_once_deactivated(db, monkeypatch):
    monkeypatch.setattr(license_service, "LEGACY_KEY_HASHES", frozenset({license_service.legacy_key_hash(EMAIL, "OMNI-TEST-KEY")}))
    license_service.read_license.cache_clear()
    _store(db, EMAIL, "OMNI-TEST-KEY")

    deactivate_license(db)

    assert license_service.is_license_active(db) is False
    with pytest.raises(HTTPException) as refused:
        activate_license(LicenseActivateRequest(email=EMAIL, key="OMNI-TEST-KEY"), db)
    assert refused.value.status_code == 400
    license_service.read_license.cache_clear()


def test_real_legacy_list_contains_only_hashes():
    assert license_service.LEGACY_KEY_HASHES
    assert all(len(value) == 64 and set(value) <= set("0123456789abcdef") for value in license_service.LEGACY_KEY_HASHES)


# ── Le verrou côté serveur ───────────────────────────────────

def test_org_mode_cannot_be_turned_on_without_a_license(db):
    with pytest.raises(HTTPException) as refused:
        set_config({"enable_org_mode": "true"}, db)

    assert refused.value.status_code == 403
    assert db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first() is None


def test_org_mode_can_always_be_turned_off(db):
    set_config({"enable_org_mode": "false"}, db)

    assert is_org_mode(db) is False


def test_org_mode_written_in_the_database_stays_off_without_a_license(db):
    db.add(GlobalConfig(key="enable_org_mode", value="true"))
    db.commit()

    assert is_org_mode(db) is False
    assert get_config(db)["enable_org_mode"] == "false"
    assert license_service.license_status(db) == {"active": False, "email": None, "org_mode_blocked": True}


def test_org_mode_works_with_a_valid_license(db, signer):
    activate_license(LicenseActivateRequest(email=EMAIL, key=v2_key(signer), contract_version=license_service.CONTRACT_VERSION), db)

    set_config({"enable_org_mode": "true"}, db)

    assert is_org_mode(db) is True
    assert get_config(db)["enable_org_mode"] == "true"
    assert license_service.license_status(db)["org"] == "CSE Exemple"


def test_losing_the_license_keeps_the_data_and_the_setting(db, signer):
    activate_license(LicenseActivateRequest(email=EMAIL, key=v2_key(signer), contract_version=license_service.CONTRACT_VERSION), db)
    set_config({"enable_org_mode": "true"}, db)
    db.query(GlobalConfig).filter(GlobalConfig.key == "license_key").delete()
    db.commit()

    assert is_org_mode(db) is False
    assert db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first().value == "true"


def test_license_keys_cannot_be_written_through_the_config(db):
    with pytest.raises(HTTPException) as refused:
        set_config({"license_key": "OMNI-INVENTEE"}, db)

    assert refused.value.status_code == 403


def test_activation_requires_the_current_contract(db, signer):
    for version in ("", "1.0"):
        with pytest.raises(HTTPException) as refused:
            activate_license(LicenseActivateRequest(email=EMAIL, key=v2_key(signer), contract_version=version), db)
        assert refused.value.status_code == 400
    assert license_service.is_license_active(db) is False


def test_accepted_contract_is_recorded_and_cleared(db, signer):
    activate_license(LicenseActivateRequest(email=EMAIL, key=v2_key(signer), contract_version=license_service.CONTRACT_VERSION), db)

    assert license_service.license_status(db)["contract_version"] == license_service.CONTRACT_VERSION
    assert db.query(GlobalConfig).filter(GlobalConfig.key == "license_contract_accepted_at").first().value

    deactivate_license(db)

    assert db.query(GlobalConfig).filter(GlobalConfig.key.like("license_%")).count() == 0


def test_config_does_not_expose_the_license(db, signer):
    activate_license(LicenseActivateRequest(email=EMAIL, key=v2_key(signer), contract_version=license_service.CONTRACT_VERSION), db)

    assert not [key for key in get_config(db) if key.startswith("license_")]


def test_contract_file_and_interface_announce_the_same_version():
    root = pathlib.Path(__file__).resolve().parent.parent
    version = license_service.CONTRACT_VERSION

    assert f"**Version {version}," in (root / "static/legal/LICENSE_ORGANISATION.md").read_text(encoding="utf-8")
    assert f"CONTRACT_VERSION: '{version}'" in (root / "static/js/views/license_manager.js").read_text(encoding="utf-8")


def test_deactivation_turns_org_mode_off(db, signer):
    activate_license(LicenseActivateRequest(email=EMAIL, key=v2_key(signer), contract_version=license_service.CONTRACT_VERSION), db)
    set_config({"enable_org_mode": "true"}, db)

    deactivate_license(db)

    assert license_service.license_status(db) == {"active": False, "email": None}
    assert db.query(GlobalConfig).filter(GlobalConfig.key == "enable_org_mode").first().value == "false"


def test_key_issued_to_check_the_desktop_build_stays_revoked():
    assert "OB-2026-0001" in license_service.REVOKED_LICENSE_IDS
