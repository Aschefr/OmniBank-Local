"""
Tests de validation des corrections de sécurité (audit août 2026).
Couvre : path traversal (SEC-02), CORS (SEC-05), licence legacy (SEC-10).
"""
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app, _safe_filename
from app.database import Base, get_db

client = TestClient(app)


# ── FIX-02 : Path Traversal Upload ─────────────────────────────────
class TestUploadPathTraversal:
    """Vérifie que les noms de fichier uploadés sont correctement sanitisés."""

    def test_safe_filename_strips_directory_components(self):
        assert _safe_filename("../../../etc/passwd") == "passwd"
        assert _safe_filename("..\\..\\Windows\\System32\\cmd.exe") == "cmd.exe"

    def test_safe_filename_sanitizes_special_chars(self):
        assert _safe_filename("file<script>.txt") == "file_script_.txt"
        assert _safe_filename("normal-file_v2.pdf") == "normal-file_v2.pdf"

    def test_safe_filename_preserves_safe_names(self):
        assert _safe_filename("rapport_2026.csv") == "rapport_2026.csv"
        assert _safe_filename("photo-vacances.jpg") == "photo-vacances.jpg"

    def test_safe_filename_handles_empty_and_dot(self):
        result = _safe_filename("")
        assert result.startswith("upload_")
        result2 = _safe_filename(".hidden")
        assert result2.startswith("upload_")

    def test_safe_filename_handles_none(self):
        result = _safe_filename(None)
        assert result.startswith("upload_")

    def test_upload_endpoint_rejects_traversal(self):
        """Un fichier avec un nom malveillant doit être sanitisé, pas rejeté."""
        from io import BytesIO
        malicious_file = BytesIO(b"test content")
        res = client.post("/api/upload", files={
            "file": ("../../etc/shadow", malicious_file, "application/octet-stream")
        })
        assert res.status_code == 200
        path = res.json()["path"]
        assert ".." not in path
        assert path.startswith("/uploads/")

    def test_serve_upload_rejects_traversal(self):
        """La lecture d'un fichier avec traversée de chemin doit être bloquée."""
        res = client.get("/uploads/../../../etc/passwd")
        assert res.status_code in (400, 404)


# ── FIX-05 : CORS Origins ──────────────────────────────────────────
class TestCORSPolicy:
    """Vérifie que CORS n'accepte que les origines locales connues."""

    def test_cors_rejects_foreign_origin(self):
        res = client.options("/api/health", headers={
            "Origin": "https://evil-site.com",
            "Access-Control-Request-Method": "GET"
        })
        allow_origin = res.headers.get("access-control-allow-origin")
        assert allow_origin != "https://evil-site.com"

    def test_cors_allows_localhost(self):
        res = client.options("/api/health", headers={
            "Origin": "http://127.0.0.1:8434",
            "Access-Control-Request-Method": "GET"
        })
        assert res.headers.get("access-control-allow-origin") == "http://127.0.0.1:8434"

    def test_cors_allows_tauri_origin(self):
        res = client.options("/api/health", headers={
            "Origin": "tauri://localhost",
            "Access-Control-Request-Method": "GET"
        })
        assert res.headers.get("access-control-allow-origin") == "tauri://localhost"


# ── FIX-10 : Legacy License OMNI- Passive Migration ────────────────
class TestLicensePassiveMigration:
    """Vérifie que les licences OMNI- déjà stockées en BDD restent actives."""

    @pytest.fixture
    def license_db(self):
        from app.models import GlobalConfig
        engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine)()
        yield db
        db.close()

    def test_omni_legacy_key_remains_active(self, license_db):
        """Un utilisateur avec une clé OMNI- stockée doit rester activé."""
        from app.models import GlobalConfig
        from app.routers.license import license_status

        license_db.add(GlobalConfig(key="license_key", value="OMNI-ABCD-1234-EFGH"))
        license_db.add(GlobalConfig(key="license_email", value="user@example.com"))
        license_db.commit()

        result = license_status(db=license_db)
        assert result["active"] is True
        assert result["email"] == "user@example.com"

    def test_new_omni_key_activation_blocked(self):
        """Les nouvelles activations avec des clés OMNI- doivent être refusées."""
        res = client.post("/api/license/activate", json={
            "email": "new@example.com",
            "key": "OMNI-NEW-KEY-1234"
        })
        assert res.status_code == 400


# ── FIX-10 : _license_secret.py supprimé ────────────────────────────
class TestLicenseSecretRemoved:
    def test_license_secret_file_deleted(self):
        """Le fichier _license_secret.py ne doit plus exister."""
        secret_path = os.path.join(os.path.dirname(__file__), "..", "app", "_license_secret.py")
        assert not os.path.exists(secret_path), "_license_secret.py should have been deleted"
