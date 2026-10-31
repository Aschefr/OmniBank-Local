"""CHANGELOG.md (English, reference) and CHANGELOG.fr.md (French) must stay in step."""
from fastapi.testclient import TestClient

from app.main import app, parse_changelog


def test_french_versions_exist_in_english_changelog():
    en = {r["version"] for r in parse_changelog("CHANGELOG.md")}
    fr = {r["version"] for r in parse_changelog("CHANGELOG.fr.md")}
    assert fr, "CHANGELOG.fr.md is missing or has no release section"
    assert fr <= en, f"Versions only in the French changelog: {sorted(fr - en)}"


def test_unreleased_notes_are_translated():
    en = parse_changelog("CHANGELOG.md")
    fr = parse_changelog("CHANGELOG.fr.md")
    if en and en[0]["version"] == "Unreleased":
        assert fr and fr[0]["version"] == "Unreleased", "Add the French notes to CHANGELOG.fr.md"
        assert fr[0]["notes"].count("\n- ") == en[0]["notes"].count("\n- "), \
            "Unreleased: English and French have a different number of entries"


def test_changelog_endpoint_serves_requested_language():
    client = TestClient(app)
    fr = client.get("/api/changelog?lang=fr").json()
    en = client.get("/api/changelog?lang=en").json()
    es = client.get("/api/changelog?lang=es").json()
    assert fr["history"][0]["notes"] != en["history"][0]["notes"]
    assert es["history"][0]["notes"] == en["history"][0]["notes"]  # no Spanish file: falls back to English
    assert len(fr["history"]) == len(en["history"])
