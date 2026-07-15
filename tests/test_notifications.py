import pytest
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
