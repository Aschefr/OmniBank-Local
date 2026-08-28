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


# ── Improvement 18 : Durcissement Sécurité & Solidité ─────────────────
import io
import zipfile


class TestZipSlipSingleProfile:
    """Vérifie que la restauration de profil bloque les chemins malveillants."""

    def test_upload_backup_rejects_zip_slip(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("omnibank.db", b"fake db content")
            z.writestr("uploads/../../malicious.txt", b"evil content")
        buf.seek(0)

        res = client.post("/api/backup/upload", files={
            "file": ("backup.zip", buf, "application/zip")
        })
        assert res.status_code == 400
        detail = res.json().get("detail", "")
        assert "suspecte" in detail.lower() or "interdit" in detail.lower()


class TestMaintenanceSQLSafety:
    """Vérifie le bon fonctionnement du endpoint apply_fix de maintenance."""

    def test_apply_fix_no_mismatches_returns_safely(self):
        res = client.post("/api/maintenance/fix_type_mismatch/apply")
        assert res.status_code == 200
        data = res.json()
        assert "tx_fixed" in data
        assert "cat_fixed" in data


class TestUploadSizeLimit:
    """Vérifie que les uploads dépassant 50 Mo sont rejetés avec code 413."""

    def test_upload_large_file_rejected(self):
        class LargeStream:
            def __init__(self, size):
                self.size = size
                self.read_so_far = 0
            def read(self, chunk_size=65536):
                if self.read_so_far >= self.size:
                    return b""
                to_read = min(chunk_size, self.size - self.read_so_far)
                self.read_so_far += to_read
                return b"A" * to_read

        # 51 MB dummy file
        large_data = LargeStream(51 * 1024 * 1024)
        res = client.post("/api/upload", files={
            "file": ("huge_file.pdf", large_data, "application/pdf")
        })
        assert res.status_code == 413
        assert "50 Mo" in res.json().get("detail", "")


class TestClearDBConfirmationHeader:
    """Vérifie que la purge complète de la BDD exige l'en-tête X-Confirm-Danger: clear."""

    @pytest.fixture(autouse=True)
    def isolate_db(self):
        """Isole la base de données via un override in-memory pour ne jamais toucher à la vraie BDD."""
        mem_engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool
        )
        Base.metadata.create_all(mem_engine)
        TestingSession = sessionmaker(bind=mem_engine)

        def _get_test_db():
            db = TestingSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = _get_test_db
        yield
        app.dependency_overrides.pop(get_db, None)

    def test_clear_without_header_fails(self):
        res = client.delete("/api/transactions/all/clear")
        assert res.status_code == 400
        assert "X-Confirm-Danger" in res.json().get("detail", "")

    def test_clear_with_wrong_header_fails(self):
        res = client.delete("/api/transactions/all/clear", headers={"X-Confirm-Danger": "yes"})
        assert res.status_code == 400

    def test_clear_with_correct_header_succeeds(self):
        res = client.delete("/api/transactions/all/clear", headers={"X-Confirm-Danger": "clear"})
        assert res.status_code == 200
        assert res.json().get("ok") is True


class TestCORSAllowedMethods:
    """Vérifie que les méthodes autorisées par CORS sont explicites."""

    def test_cors_preflight_allows_explicit_methods(self):
        res = client.options("/api/transactions/", headers={
            "Origin": "http://127.0.0.1:8434",
            "Access-Control-Request-Method": "DELETE"
        })
        allowed = res.headers.get("access-control-allow-methods", "")
        assert "DELETE" in allowed
        assert "GET" in allowed
        assert "POST" in allowed

