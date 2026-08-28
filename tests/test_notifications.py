import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import app.models
from app.database import Base
from app.main import app
from app.models import Notification, GlobalConfig
from app.routers.notifications import generate_ai_report_task

# File-based SQLite database for testing notifications logic
SQLALCHEMY_DATABASE_URL = "sqlite:///data/omnibank_test.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    from tests.generate_test_db import build_test_db
    build_test_db(engine)
    db = TestingSessionLocal()
    # Mock global config needed for tests
    db.add(GlobalConfig(key="ai_reports_enabled", value="true"))
    db.add(GlobalConfig(key="ai_reports_frequency", value="daily"))
    db.commit()
    db.close()
    yield
    # Cleanup: dispose connections
    engine.dispose()

def test_notifications_lifecycle():
    client = TestClient(app)
    
    # Override get_db to return our in-memory test database session
    from app.database import get_db
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()
            
    app.dependency_overrides[get_db] = override_get_db

    # 1. Create a dummy notification directly in DB to test API
    db = TestingSessionLocal()
    notif = Notification(type="system", title="Test Alert", content="System is working properly.")
    db.add(notif)
    db.commit()
    notif_id = notif.id
    db.close()

    # 2. GET notifications
    resp = client.get("/api/notifications")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1
    assert data[0]["title"] == "Test Alert"
    assert data[0]["is_read"] is False

    # 3. PUT mark as read
    resp_read = client.put(f"/api/notifications/{notif_id}/read")
    assert resp_read.status_code == 200
    
    resp_check = client.get("/api/notifications")
    assert resp_check.json()[0]["is_read"] is True

    # 4. DELETE notification
    resp_del = client.delete(f"/api/notifications/{notif_id}")
    assert resp_del.status_code == 200
    
    resp_final = client.get("/api/notifications")
    assert len(resp_final.json()) == 0

    # Clean dependency overrides
    app.dependency_overrides.pop(get_db, None)


def test_delete_all_notifications():
    client = TestClient(app)
    from app.database import get_db
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()
    app.dependency_overrides[get_db] = override_get_db

    # Create 3 notifications
    db = TestingSessionLocal()
    for i in range(3):
        db.add(Notification(type="system", title=f"Alert {i}", content="Content"))
    db.commit()
    db.close()

    resp = client.get("/api/notifications")
    assert resp.status_code == 200
    assert len(resp.json()) == 3

    # Delete all
    resp_del_all = client.delete("/api/notifications")
    assert resp_del_all.status_code == 200
    assert resp_del_all.json()["ok"] is True
    assert resp_del_all.json()["deleted_count"] == 3

    resp_after = client.get("/api/notifications")
    assert len(resp_after.json()) == 0

    app.dependency_overrides.pop(get_db, None)


def test_generate_ai_report_task_frequency():
    """Test that frequency calculation with timezone.utc works without NameError."""
    db = TestingSessionLocal()
    # Create an existing report in DB
    existing_report = Notification(
        type="ai_report",
        title="Existing Report",
        content="Report content",
        created_at=datetime.now(timezone.utc)
    )
    db.add(existing_report)
    db.commit()
    db.close()

    # Calling generate_ai_report_task with force=False should check the frequency and skip safely
    generate_ai_report_task(TestingSessionLocal, force=False)


def test_bank_sync_and_file_import_notifications_formatting():
    """Vérifie la création et la structure des métadonnées pour les notifications bancaires et d'import."""
    import json
    client = TestClient(app)
    from app.database import get_db
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()
    app.dependency_overrides[get_db] = override_get_db

    db = TestingSessionLocal()
    notif_bank = Notification(
        type="bank_sync",
        title="🏦 Synchronisation Crédit Agricole",
        content="Crédit Agricole : 1 opération à rapprocher, 1 opération en attente, 2 nouvelles opérations.",
        link_data=json.dumps({
            "view": "accounts",
            "action": "open_pending",
            "conn_id": 1,
            "conn_label": "Crédit Agricole",
            "matches": 1,
            "coming": 1,
            "new_txs": 2
        }),
        is_read=False
    )
    notif_file = Notification(
        type="file_import",
        title="📊 Import Relevé Fichier",
        content="Fichier releve_aout.csv : 5 opérations à rapprocher.",
        link_data=json.dumps({
            "view": "accounts",
            "action": "open_pending",
            "filename": "releve_aout.csv",
            "matches": 5,
            "new_txs": 0,
            "total": 5
        }),
        is_read=False
    )
    db.add_all([notif_bank, notif_file])
    db.commit()
    db.close()

    resp = client.get("/api/notifications")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) >= 2
    types = [it["type"] for it in items]
    assert "bank_sync" in types
    assert "file_import" in types

    app.dependency_overrides.pop(get_db, None)


def test_notification_archiving_and_unarchiving():
    """Vérifie le cycle d'archivage, de désarchivage et de filtrage actif/archivé."""
    client = TestClient(app)
    from app.database import get_db
    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()
    app.dependency_overrides[get_db] = override_get_db

    db = TestingSessionLocal()
    # Nettoyer les notifications de tests précédents
    db.query(Notification).delete()
    notif1 = Notification(type="system", title="Active Notif 1", content="Content 1", is_read=False, is_archived=False)
    notif2 = Notification(type="ai_report", title="Active Notif 2", content="Content 2", is_read=False, is_archived=False)
    db.add_all([notif1, notif2])
    db.commit()
    n1_id = notif1.id
    n2_id = notif2.id
    db.close()

    # 1. Vérifier que les 2 sont actives et non archivées
    resp_active = client.get("/api/notifications?archived=false")
    assert resp_active.status_code == 200
    assert len(resp_active.json()) == 2

    resp_arch = client.get("/api/notifications?archived=true")
    assert resp_arch.status_code == 200
    assert len(resp_arch.json()) == 0

    # 2. Vérifier les compteurs
    resp_counts = client.get("/api/notifications/counts")
    assert resp_counts.status_code == 200
    counts = resp_counts.json()
    assert counts["active_unread"] == 2
    assert counts["active_total"] == 2
    assert counts["archived_total"] == 0

    # 3. Archiver notif 1
    resp_archive = client.put(f"/api/notifications/{n1_id}/archive")
    assert resp_archive.status_code == 200
    assert resp_archive.json()["ok"] is True

    # 4. Vérifier la séparation Actives vs Archives
    resp_active2 = client.get("/api/notifications?archived=false")
    assert len(resp_active2.json()) == 1
    assert resp_active2.json()[0]["id"] == n2_id

    resp_arch2 = client.get("/api/notifications?archived=true")
    assert len(resp_arch2.json()) == 1
    arch_item = resp_arch2.json()[0]
    assert arch_item["id"] == n1_id
    assert arch_item["is_archived"] is True
    assert arch_item["is_read"] is True
    assert arch_item["archived_at"] is not None

    # 5. Désarchiver notif 1
    resp_unarchive = client.put(f"/api/notifications/{n1_id}/unarchive")
    assert resp_unarchive.status_code == 200

    resp_active3 = client.get("/api/notifications?archived=false")
    assert len(resp_active3.json()) == 2
    resp_arch3 = client.get("/api/notifications?archived=true")
    assert len(resp_arch3.json()) == 0

    # 6. Tester 'archive-all'
    resp_archive_all = client.put("/api/notifications/archive-all")
    assert resp_archive_all.status_code == 200
    assert resp_archive_all.json()["archived_count"] == 2

    resp_active4 = client.get("/api/notifications?archived=false")
    assert len(resp_active4.json()) == 0
    resp_arch4 = client.get("/api/notifications?archived=true")
    assert len(resp_arch4.json()) == 2

    # 7. Tester 'clear archives'
    resp_clear = client.delete("/api/notifications/archives/clear")
    assert resp_clear.status_code == 200
    assert resp_clear.json()["deleted_count"] == 2

    resp_arch5 = client.get("/api/notifications?archived=true")
    assert len(resp_arch5.json()) == 0

    app.dependency_overrides.pop(get_db, None)


