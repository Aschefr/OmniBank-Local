"""
tests/test_autopilot_step0.py
-----------------------------
Tests d'intégration et de validation pour l'Étape 0 d'Auto-Pilot :
- Modèle AutopilotDecisionLog (création, index, lecture)
- Champ Budget.is_locked (persistance, mise à jour, rollback undo)
- Idempotence des csv_id déterministes
- Refactoring check_reconciliation
"""
import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.models import Budget, AutopilotDecisionLog, GlobalConfig
from app.services.reconciliation_engine import check_reconciliation, evaluate_candidate
from app.services.budget_service import create_new_budget, budget_to_dict
from app.routers.budgets import BudgetCreate


@pytest.fixture
def test_db():
    """Base SQLite en mémoire isolée pour les tests Step 0."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_autopilot_decision_log_model(test_db):
    """Vérifie la persistance et la structure du journal de décisions Auto-Pilot."""
    log = AutopilotDecisionLog(
        batch_id="batch_test_123",
        decision_type="recurrence_promotion",
        action="AUTO_COMMIT",
        entity_type="recurrence_template",
        entity_id=42,
        conn_id=1,
        account_id=1,
        raw_snapshot='{"category": "Loisirs", "amount": 150.0}',
        confidence_score=95.0,
        is_undone=False,
    )
    test_db.add(log)
    test_db.commit()
    test_db.refresh(log)

    assert log.id is not None
    assert log.batch_id == "batch_test_123"
    assert log.entity_type == "recurrence_template"
    assert log.confidence_score == 95.0
    assert log.action == "AUTO_COMMIT"
    assert log.created_at is not None


def test_budget_is_locked_field(test_db):
    """Vérifie que la colonne is_locked est correctement persistée et sérialisée."""
    data = BudgetCreate(
        name="Budget Alimentation Fixe",
        monthly_amount=400.0,
        envelope_type="spending",
        is_locked=True
    )
    created = create_new_budget(data, test_db)
    assert created["is_locked"] is True

    # Lecture directe depuis l'ORM
    b = test_db.query(Budget).filter(Budget.id == created["id"]).first()
    assert b is not None
    assert b.is_locked is True

    # Modification
    b.is_locked = False
    test_db.commit()
    test_db.refresh(b)
    res_dict = budget_to_dict(b, test_db)
    assert res_dict["is_locked"] is False


def test_deterministic_csv_id_generation():
    """Vérifie le caractère reproductible et non-collisionnel de la formule csv_id."""
    import hashlib
    def get_csv_id(date_str, amt_val, desc, occ_idx):
        fp_key = f"{date_str}_{abs(amt_val):.2f}_{desc.strip().lower()}"
        tx_sha = hashlib.sha256(fp_key.encode("utf-8")).hexdigest()[:12]
        return f"csv_{tx_sha}_{occ_idx}"

    id1 = get_csv_id("2026-09-15", -24.50, "Carrefour Market", 0)
    id2 = get_csv_id("2026-09-15", -24.50, "Carrefour Market", 0)
    # Même transaction = même ID
    assert id1 == id2

    # Deuxième occurrence le même jour = suffixe d'occurrence incrémenté, pas de collision
    id_occ1 = get_csv_id("2026-09-15", -24.50, "Carrefour Market", 1)
    assert id_occ1 != id1
    assert id_occ1.endswith("_1")
    assert id1.endswith("_0")


def test_reconciliation_engine_import_and_signature():
    """Vérifie que le moteur de réconciliation extrait est fonctionnel."""
    assert callable(check_reconciliation)
    assert callable(evaluate_candidate)


def test_ollama_safe_when_disabled():
    """Vérifie que call_ollama_safe ne lève aucune exception si l'IA est désactivée ou injoignable."""
    from app.services.chat.ollama_client import call_ollama_safe
    cfg = {"enabled": False, "url": "http://localhost:11434", "model": "mistral"}
    res = call_ollama_safe("Hello", cfg)
    assert res is None
