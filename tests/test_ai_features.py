import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models import AIFact, OrgUser, ChatSession
from app.routers.chat import store_financial_fact_tool, forget_financial_fact_tool, load_system_prompt

# Setup in-memory SQLite DB for testing with StaticPool to share connection
@pytest.fixture
def db_session():
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

def test_ai_facts_scoping(db_session):
    db = db_session
    
    # 1. Create a dummy user and chat session
    user = OrgUser(name="Alice")
    db.add(user)
    session = ChatSession(id=1, role="advisor")
    db.add(session)
    db.commit()
    
    # 2. Store facts
    # Global fact (no user, no session)
    store_financial_fact_tool(db, key="global_key", value="global_value")
    
    # Session fact (isolated to session 1)
    store_financial_fact_tool(db, key="session_key", value="session_value", private_to_session=True, session_id=1)
    
    # User fact (isolated to user Alice)
    store_financial_fact_tool(db, key="user_key", value="user_value", user_name="Alice")
    
    # 3. Check fact loading scenarios via load_system_prompt
    # Case A: Global client (no user, no session)
    prompt_A = load_system_prompt(db=db)
    assert "global_key" in prompt_A
    assert "session_key" not in prompt_A
    assert "user_key" not in prompt_A
    
    # Case B: Client in session 1 (no user name)
    prompt_B = load_system_prompt(db=db, session_id=1)
    assert "global_key" in prompt_B
    assert "session_key" in prompt_B
    assert "user_key" not in prompt_B
    
    # Case C: User Alice (no session)
    prompt_C = load_system_prompt(db=db, user_name="Alice")
    assert "global_key" in prompt_C
    assert "session_key" not in prompt_C
    assert "user_key" in prompt_C
    
    # Case D: User Alice in session 1
    prompt_D = load_system_prompt(db=db, session_id=1, user_name="Alice")
    assert "global_key" in prompt_D
    assert "session_key" in prompt_D
    assert "user_key" in prompt_D

def test_forget_financial_fact(db_session):
    db = db_session
    
    # Store a fact
    store_financial_fact_tool(db, key="some_key", value="some_val")
    prompt_before = load_system_prompt(db=db)
    assert "some_key" in prompt_before
    
    # Forget the fact
    forget_financial_fact_tool(db, key="some_key")
    prompt_after = load_system_prompt(db=db)
    assert "some_key" not in prompt_after

def test_ai_facts_api(db_session):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.database import get_db

    # Override get_db dependency
    def override_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_db

    client = TestClient(app)

    # 1. Create a fact via API
    resp_post = client.post("/api/chat/facts", json={
        "fact_key": "rent_euros",
        "fact_value": "1200",
        "private_to_session": False
    })
    if resp_post.status_code != 200:
        with open("api_error.txt", "w") as f:
            f.write(resp_post.text)
        raise Exception(f"API Error 500: {resp_post.text}")
    assert resp_post.status_code == 200

    # 2. Retrieve facts via API
    resp_get = client.get("/api/chat/facts")
    assert resp_get.status_code == 200
    data = resp_get.json()
    assert len(data) == 1
    assert data[0]["fact_key"] == "rent_euros"
    assert data[0]["fact_value"] == "1200"
    fact_id = data[0]["id"]

    # 3. Delete the fact via API
    resp_del = client.delete(f"/api/chat/facts/{fact_id}")
    assert resp_del.status_code == 200

    # 4. Verify list is empty
    resp_get_after = client.get("/api/chat/facts")
    assert len(resp_get_after.json()) == 0

    # Cleanup overrides
    app.dependency_overrides.clear()
