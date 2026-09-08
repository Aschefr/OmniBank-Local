import pytest
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app
from app.models import BankLabelMapping, Transaction
from app.services.smart_label_service import (
    learn_label_mapping,
    normalize_raw_label,
    resolve_smart_label,
    resolve_smart_labels_batch,
)


@pytest.fixture
def db_session():
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


@pytest.fixture
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── TEST 1 : Normalisation des libellés bancaires ───────────────────
def test_normalize_raw_label():
    assert normalize_raw_label("CB CARREFOUR 74210 2489") == "CARREFOUR"
    assert normalize_raw_label("PRLV SEPA SAS SPB 948201") == "SAS SPB"
    assert normalize_raw_label("FULLI - mobilis") == "FULLI MOBILIS"
    assert normalize_raw_label("VIR SEPA MR DUPONT JEAN 01/02/2024") == "MR DUPONT JEAN"
    assert normalize_raw_label("COTIS MENSUELLE FORMULE TRANQUILLITE") == "FORMULE TRANQUILLITE"
    # Passerelles de paiement (Gateway stripping)
    assert normalize_raw_label("CB PAYPAL *STEAM GAMES 1234") == "STEAM GAMES"
    assert normalize_raw_label("PAYPAL *ALIEXPRESS") == "ALIEXPRESS"
    assert normalize_raw_label("CB SUMUP *BOULANGERIE") == "BOULANGERIE"
    assert normalize_raw_label("PRLV SEPA PAYPAL") == "PAYPAL"
    assert normalize_raw_label("") == ""


# ── TEST 2 : Auto-apprentissage & Résolution Niveau 1 ──────────────
def test_learn_and_resolve_rule(db_session):
    # Apprendre une correspondance
    rule = learn_label_mapping(
        db=db_session,
        raw_label="PRLV SEPA SAS SPB 948201",
        clean_description="Assurance Téléphone",
        category="Assurances"
    )
    assert rule is not None
    assert rule.raw_pattern == "SAS SPB"
    assert rule.clean_description == "Assurance Téléphone"
    assert rule.category == "Assurances"
    assert rule.is_ignored is False

    # Résoudre une nouvelle opération avec un libellé bancaire similaire
    resolved = resolve_smart_label(db_session, "PRLV SEPA SAS SPB 112233")
    assert resolved["source"] == "rule"
    assert resolved["description"] == "Assurance Téléphone"
    assert resolved["category"] == "Assurances"
    assert resolved["confidence"] >= 0.85

    # Correction par l'utilisateur -> Mise à jour de la règle existante
    rule_updated = learn_label_mapping(
        db=db_session,
        raw_label="PRLV SEPA SAS SPB 999999",
        clean_description="Assurance Mobile SPB",
        category="Assurances & Prévoyance"
    )
    assert rule_updated.id == rule.id
    assert rule_updated.clean_description == "Assurance Mobile SPB"
    assert rule_updated.match_count == 2


# ── TEST 2.1 : Règle d'exclusion manuelle (Piste A - Ignorer) ───────
def test_ignored_rule_resolution_and_protection(db_session):
    # 1. Créer une règle d'exclusion (is_ignored=True)
    rule = learn_label_mapping(
        db=db_session,
        raw_label="PRLV SEPA PAYPAL",
        clean_description=None,
        category=None,
        is_ignored=True
    )
    assert rule is not None
    assert rule.raw_pattern == "PAYPAL"
    assert rule.is_ignored is True

    # 2. Résoudre un libellé Paypal -> doit être "ignored" avec confiance 0.0
    resolved = resolve_smart_label(db_session, "PRLV SEPA PAYPAL EUROPE")
    assert resolved["source"] == "ignored"
    assert resolved["confidence"] == 0.0
    assert resolved["category"] is None

    # 3. Résolution par lot -> doit être "ignored"
    batch_res = resolve_smart_labels_batch(db_session, ["PRLV SEPA PAYPAL", "AUTRE"])
    assert batch_res["PRLV SEPA PAYPAL"]["source"] == "ignored"
    assert batch_res["PRLV SEPA PAYPAL"]["confidence"] == 0.0

    # 4. Protection de la règle ignorée contre l'auto-apprentissage par import automatique
    auto_learned = learn_label_mapping(
        db=db_session,
        raw_label="PRLV SEPA PAYPAL",
        clean_description="Steam Games",
        category="Jeux Vidéo",
        is_ignored=False
    )
    assert auto_learned.is_ignored is True
    # Vérifier que la règle n'a pas été écrasée
    resolved_after = resolve_smart_label(db_session, "PRLV SEPA PAYPAL")
    assert resolved_after["source"] == "ignored"
    assert resolved_after["confidence"] == 0.0


# ── TEST 3 : Fuzzy Matching sur Historique & Détection d'Ambiguïté (Niveau 2 & Piste C) ──────────────
def test_fuzzy_match_history_and_ambiguity(db_session):
    # 1. Cas non ambigu : historique avec une seule catégorie cohérente
    past_tx = Transaction(
        date_saisie=date.today(),
        date_operation=date.today(),
        description="Fulli - Péages",
        amount=45.60,
        type="expense_var",
        category="Transports",
        reconciliation_date=date.today(),
    )
    db_session.add(past_tx)
    db_session.commit()

    resolved = resolve_smart_label(db_session, "FULLI - mobilis")
    assert resolved["source"] == "history"
    assert resolved["description"] == "Fulli - Péages"
    assert resolved["category"] == "Transports"
    assert resolved["confidence"] >= 0.75

    # 2. Cas ambigu (Piste C) : historique avec plusieurs catégories contradictoires pour un même terme
    tx_ambig_1 = Transaction(
        date_saisie=date.today(),
        date_operation=date.today(),
        description="Achat Bazar",
        amount=10.0,
        type="expense_var",
        category="Shopping",
        reconciliation_date=date.today(),
    )
    tx_ambig_2 = Transaction(
        date_saisie=date.today(),
        date_operation=date.today(),
        description="Achat Bazar",
        amount=15.0,
        type="expense_var",
        category="Alimentation",
        reconciliation_date=date.today(),
    )
    db_session.add_all([tx_ambig_1, tx_ambig_2])
    db_session.commit()

    resolved_ambig = resolve_smart_label(db_session, "CB ACHAT BAZAR 1234")
    assert resolved_ambig["source"] == "ambiguous"
    assert resolved_ambig["confidence"] == 0.0
    assert resolved_ambig["category"] is None


# ── TEST 4 : Résolution en Lot (Batch) ─────────────────────────────
def test_resolve_batch(db_session):
    learn_label_mapping(db_session, "CARREFOUR 1234", "Courses Carrefour", "Alimentation")

    past_tx = Transaction(
        date_saisie=date.today(),
        date_operation=date.today(),
        description="Abonnement Netflix",
        amount=17.99,
        type="expense_fixed",
        category="Abonnements",
        reconciliation_date=date.today(),
    )
    db_session.add(past_tx)
    db_session.commit()

    raw_list = [
        "CB CARREFOUR 75001 9876",
        "PRLV NETFLIX COM PARIS",
        "INCONNU TOTAL 9999"
    ]
    batch_results = resolve_smart_labels_batch(db_session, raw_list)

    assert "CB CARREFOUR 75001 9876" in batch_results
    assert batch_results["CB CARREFOUR 75001 9876"]["source"] == "rule"
    assert batch_results["CB CARREFOUR 75001 9876"]["description"] == "Courses Carrefour"

    assert "PRLV NETFLIX COM PARIS" in batch_results
    assert batch_results["PRLV NETFLIX COM PARIS"]["source"] == "history"
    assert batch_results["PRLV NETFLIX COM PARIS"]["description"] == "Abonnement Netflix"

    assert "INCONNU TOTAL 9999" in batch_results
    assert batch_results["INCONNU TOTAL 9999"]["source"] == "none"


# ── TEST 5 : Endpoints API FastAPI ─────────────────────────────────
def test_api_endpoints(client, db_session):
    # 1. Créer une règle manuellement
    res_create = client.post("/api/smart-labels/mappings", json={
        "raw_pattern": "TOTAL ACCESS",
        "clean_description": "Carburant Total",
        "category": "Véhicule"
    })
    assert res_create.status_code == 200
    data_create = res_create.json()
    assert data_create["ok"] is True
    mapping_id = data_create["id"]

    # 2. Créer une règle d'exclusion manuellement (is_ignored=True)
    res_create_ignored = client.post("/api/smart-labels/mappings", json={
        "raw_pattern": "PAYPAL",
        "is_ignored": True
    })
    assert res_create_ignored.status_code == 200
    assert res_create_ignored.json()["ok"] is True

    # 3. Lister les règles
    res_list = client.get("/api/smart-labels/mappings")
    assert res_list.status_code == 200
    mappings = res_list.json()
    assert len(mappings) >= 2
    assert any(m["clean_description"] == "Carburant Total" and not m["is_ignored"] for m in mappings)
    assert any(m["raw_pattern"] == "PAYPAL" and m["is_ignored"] for m in mappings)

    # 4. Résoudre un batch via API
    res_batch = client.post("/api/smart-labels/resolve-batch", json={
        "labels": ["CB TOTAL ACCESS RELAIS 1234", "PRLV PAYPAL EUROPE"]
    })
    assert res_batch.status_code == 200
    results = res_batch.json()["results"]
    assert "CB TOTAL ACCESS RELAIS 1234" in results
    assert results["CB TOTAL ACCESS RELAIS 1234"]["description"] == "Carburant Total"
    assert results["PRLV PAYPAL EUROPE"]["source"] == "ignored"

    # 5. Supprimer la règle
    res_del = client.delete(f"/api/smart-labels/mappings/{mapping_id}")
    assert res_del.status_code == 200
    assert res_del.json()["ok"] is True

    # 6. Vérifier suppression
    res_list2 = client.get("/api/smart-labels/mappings")
    assert not any(m["id"] == mapping_id for m in res_list2.json())


# ── TEST 6 : Bascule de statut (Toggle) & Mise à jour (PUT) ──────────
def test_api_toggle_and_update_mapping(client, db_session):
    # 1. Créer une règle associée
    res = client.post("/api/smart-labels/mappings", json={
        "raw_pattern": "FULLI TELEPEAGE",
        "clean_description": "Fulli - Péages",
        "category": "Transports",
        "is_ignored": False
    })
    assert res.status_code == 200
    mapping_id = res.json()["id"]

    # 2. Basculer la règle vers "Ignoré"
    res_toggle_1 = client.post(f"/api/smart-labels/mappings/{mapping_id}/toggle", json={})
    assert res_toggle_1.status_code == 200
    data_1 = res_toggle_1.json()
    assert data_1["is_ignored"] is True
    # Vérifier que le nom et la catégorie d'origine sont préservés
    assert data_1["clean_description"] == "Fulli - Péages"
    assert data_1["category"] == "Transports"

    # 3. Basculer à nouveau vers "Associé"
    res_toggle_2 = client.post(f"/api/smart-labels/mappings/{mapping_id}/toggle", json={})
    assert res_toggle_2.status_code == 200
    data_2 = res_toggle_2.json()
    assert data_2["is_ignored"] is False
    assert data_2["clean_description"] == "Fulli - Péages"

    # 4. Mettre à jour avec PUT
    res_put = client.put(f"/api/smart-labels/mappings/{mapping_id}", json={
        "clean_description": "Fulli Autoroutes",
        "category": "Péages"
    })
    assert res_put.status_code == 200
    data_put = res_put.json()
    assert data_put["clean_description"] == "Fulli Autoroutes"
    assert data_put["category"] == "Péages"

    # 5. Créer une règle directement en ignoré sans clean_description, puis toggle avec clean_description
    res_ignored = client.post("/api/smart-labels/mappings", json={
        "raw_pattern": "SPOTIFY ABONNEMENT",
        "is_ignored": True
    })
    assert res_ignored.status_code == 200
    ign_id = res_ignored.json()["id"]

    res_toggle_ign = client.post(f"/api/smart-labels/mappings/{ign_id}/toggle", json={
        "clean_description": "Spotify Musique",
        "category": "Abonnements"
    })
    assert res_toggle_ign.status_code == 200
    data_ign = res_toggle_ign.json()
    assert data_ign["is_ignored"] is False
    assert data_ign["clean_description"] == "Spotify Musique"
    assert data_ign["category"] == "Abonnements"


# ── TEST 7 : Sanctuarisation des règles manuelles (Protection anti-écrasement) ──
def test_manual_rule_protection_against_auto_learning(db_session):
    # 1. L'utilisateur crée une règle manuelle
    rule = learn_label_mapping(
        db=db_session,
        raw_label="PRLV SPB MOBILE",
        clean_description="Assurance Téléphone Perso",
        category="Assurances",
        is_manual=True
    )
    assert rule.is_manual is True
    assert rule.category == "Assurances"

    # 2. Un import automatique tente d'écraser la règle avec une autre catégorie
    auto_learned = learn_label_mapping(
        db=db_session,
        raw_label="PRLV SPB MOBILE",
        clean_description="Autre Description",
        category="Loisirs",
        is_manual=False
    )
    assert auto_learned.id == rule.id
    # La règle manuelle est sanctuarisée : nom et catégorie intacts
    assert auto_learned.clean_description == "Assurance Téléphone Perso"
    assert auto_learned.category == "Assurances"
    assert auto_learned.is_manual is True
    assert auto_learned.match_count == 2


# ── TEST 8 : Apprentissage progressif & Seuil de confirmation (N >= 2) ──
def test_progressive_learning_threshold(db_session):
    # 1ère occurrence automatique (N=1)
    rule = learn_label_mapping(
        db=db_session,
        raw_label="CB BOULANGERIE DU PARC 92",
        clean_description="Boulangerie Du Parc",
        category="Alimentation",
        is_manual=False
    )
    assert rule.is_manual is False
    assert rule.match_count == 1

    # Lors de la résolution, la règle doit être provisoire (confiance 0.60)
    resolved_1 = resolve_smart_label(db_session, "CB BOULANGERIE DU PARC 92")
    assert resolved_1["source"] == "rule"
    assert resolved_1["is_provisional"] is True
    assert resolved_1["confidence"] == 0.60
    assert resolved_1["category"] == "Alimentation"

    # 2ème occurrence automatique concordante (N=2)
    learn_label_mapping(
        db=db_session,
        raw_label="CB BOULANGERIE DU PARC 92",
        clean_description="Boulangerie Du Parc",
        category="Alimentation",
        is_manual=False
    )
    # Règle confirmée (confiance 1.0)
    resolved_2 = resolve_smart_label(db_session, "CB BOULANGERIE DU PARC 92")
    assert resolved_2["is_provisional"] is False
    assert resolved_2["confidence"] == 1.0


# ── TEST 9 : Marchands Caméléons Natifs (Amazon, Carrefour, Total...) ──
def test_multi_category_merchant_native_resolution(db_session):
    # Aucune règle en base, libellé Amazon brut
    resolved = resolve_smart_label(db_session, "CB AMAZON EU 1234 PARIS")
    assert resolved["source"] == "multi_category"
    assert resolved["is_multi_category"] is True
    assert resolved["description"] == "Amazon Eu Paris"
    assert resolved["category"] is None

    # Batch resolution avec un marchand caméléon
    batch = resolve_smart_labels_batch(db_session, ["CB AMAZON EU 1234 PARIS", "CB TOTAL ACCESS"])
    assert batch["CB AMAZON EU 1234 PARIS"]["source"] == "multi_category"
    assert batch["CB AMAZON EU 1234 PARIS"]["category"] is None
    assert batch["CB TOTAL ACCESS"]["source"] == "multi_category"
    assert batch["CB TOTAL ACCESS"]["category"] is None


# ── TEST 10 : Détection de Dispersion Statistique (Bascule en Multi-Catégories) ──
def test_category_dispersion_detection(db_session):
    # Marchand non caméléon natif
    raw = "CB BAZAR CENTRAL 75"
    
    # Vote 1 : Loisirs
    learn_label_mapping(db_session, raw, "Bazar Central", "Loisirs", is_manual=False)
    # Vote 2 : Maison
    learn_label_mapping(db_session, raw, "Bazar Central", "Maison", is_manual=False)

    rule = db_session.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern == "BAZAR CENTRAL").first()
    # Aucune catégorie dominante (50% / 50% < 60%) -> Bascule automatique en multi-catégories
    assert rule.is_multi_category is True
    assert rule.category is None

    resolved = resolve_smart_label(db_session, raw)
    assert resolved["source"] == "multi_category"
    assert resolved["category"] is None


# ── TEST 11 : Endpoints API Bidirectional Toggle Manual & Toggle Multi ───────────
def test_api_promote_and_toggle_multi(client, db_session):
    # Créer une règle auto avec historique de catégorie
    learn_label_mapping(db_session, "CB TEST AUTO PROMO", "Test Auto", "Divers", is_manual=False)
    rule = db_session.query(BankLabelMapping).filter(BankLabelMapping.raw_pattern == "TEST AUTO PROMO").first()
    assert rule is not None
    assert rule.is_manual is False

    # 1. Sanctuariser via l'API (promote-manual / toggle-manual)
    res_promote = client.post(f"/api/smart-labels/mappings/{rule.id}/toggle-manual")
    assert res_promote.status_code == 200
    assert res_promote.json()["is_manual"] is True

    db_session.refresh(rule)
    assert rule.is_manual is True

    # 2. Revenir en arrière : repasser en auto-apprentissage (toggle-manual)
    res_demote = client.post(f"/api/smart-labels/mappings/{rule.id}/toggle-manual")
    assert res_demote.status_code == 200
    assert res_demote.json()["is_manual"] is False

    db_session.refresh(rule)
    assert rule.is_manual is False

    # 3. Basculer en multi-catégorie via l'API
    res_toggle_multi = client.post(f"/api/smart-labels/mappings/{rule.id}/toggle-multi")
    assert res_toggle_multi.status_code == 200
    assert res_toggle_multi.json()["is_multi_category"] is True

    db_session.refresh(rule)
    assert rule.is_multi_category is True
    assert rule.category is None

    # 4. Revenir en arrière : repasser en mode avec catégorie (restaure "Divers")
    res_unmulti = client.post(f"/api/smart-labels/mappings/{rule.id}/toggle-multi")
    assert res_unmulti.status_code == 200
    assert res_unmulti.json()["is_multi_category"] is False
    assert res_unmulti.json()["category"] == "Divers"

    db_session.refresh(rule)
    assert rule.is_multi_category is False
    assert rule.category == "Divers"


# ── TEST 12 : ActionHistory & Global Undo for BankLabelMapping ───────────────────
def test_smart_label_history_and_undo(client, db_session):
    from app.models import ActionHistory
    from app.services.history_service import undo_action

    # 1. Créer une règle via l'API
    res = client.post("/api/smart-labels/mappings", json={
        "raw_pattern": "MONOPRIX PARIS 11",
        "clean_description": "Monoprix",
        "category": "Alimentation"
    })
    assert res.status_code == 200
    mapping_id = res.json()["id"]

    # Vérifier l'enregistrement dans ActionHistory
    act_create = db_session.query(ActionHistory).filter(
        ActionHistory.entity_type == "bank_label_mapping",
        ActionHistory.entity_id == mapping_id,
        ActionHistory.action_type == "CREATE"
    ).first()
    assert act_create is not None

    # 2. Modifier la règle (ex: passer en multi)
    res_multi = client.post(f"/api/smart-labels/mappings/{mapping_id}/toggle-multi")
    assert res_multi.status_code == 200

    act_update = db_session.query(ActionHistory).filter(
        ActionHistory.entity_type == "bank_label_mapping",
        ActionHistory.entity_id == mapping_id,
        ActionHistory.action_type == "UPDATE"
    ).order_by(ActionHistory.id.desc()).first()
    assert act_update is not None

    rule = db_session.query(BankLabelMapping).filter(BankLabelMapping.id == mapping_id).first()
    assert rule.is_multi_category is True

    # 3. Exécuter l'annulation globale (undo) de cette modification
    ok, err = undo_action(db_session, act_update)
    assert ok is True
    assert err is None
    db_session.commit()

    db_session.refresh(rule)
    assert rule.is_multi_category is False
    assert rule.category == "Alimentation"


# ── TEST 13 (T3.10) : Fallback IA Ollama Groupé par Lot (call_ollama_batch) ─────
def test_call_ollama_batch_success():
    from unittest.mock import patch, MagicMock
    from app.services.chat.ollama_client import call_ollama_batch
    import json

    cfg = {"enabled": True, "url": "http://localhost:11434", "model": "mistral"}
    categories = ["Alimentation", "Logement & Maison", "Sport & Loisirs"]
    descriptions = ["LEROY MERLIN", "DECATHLON", "BOUTIQUE INCONNUE"]

    mock_resp_content = json.dumps({
        "LEROY MERLIN": "Logement & Maison",
        "DECATHLON": "Sport & Loisirs",
        "BOUTIQUE INCONNUE": None
    })
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"message": {"content": mock_resp_content}}

    with patch("httpx.post", return_value=mock_resp) as mock_post:
        result = call_ollama_batch(descriptions, categories, cfg)
        assert mock_post.called
        assert result["LEROY MERLIN"] == "Logement & Maison"
        assert result["DECATHLON"] == "Sport & Loisirs"
        assert result["BOUTIQUE INCONNUE"] is None


def test_call_ollama_batch_hallucination_discarded():
    from unittest.mock import patch, MagicMock
    from app.services.chat.ollama_client import call_ollama_batch
    import json

    cfg = {"enabled": True, "url": "http://localhost:11434", "model": "mistral"}
    categories = ["Alimentation", "Santé"]
    descriptions = ["MAGASIN BRICOLAGE", "PHARMACIE"]

    # Le LLM hallucine "Bricolage Fantaisiste" qui n'existe pas dans categories
    mock_resp_content = json.dumps({
        "MAGASIN BRICOLAGE": "Bricolage Fantaisiste",
        "PHARMACIE": "Santé"
    })
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"message": {"content": mock_resp_content}}

    with patch("httpx.post", return_value=mock_resp):
        result = call_ollama_batch(descriptions, categories, cfg)
        # La catégorie hallucinée doit être immédiatement neutralisée à None
        assert result["MAGASIN BRICOLAGE"] is None
        assert result["PHARMACIE"] == "Santé"


def test_call_ollama_batch_offline_and_disabled_safety():
    from unittest.mock import patch
    import httpx
    from app.services.chat.ollama_client import call_ollama_batch

    descriptions = ["LEROY MERLIN"]
    categories = ["Logement & Maison"]

    # 1. IA désactivée -> 0 appel réseau
    with patch("httpx.post") as mock_post:
        res = call_ollama_batch(descriptions, categories, cfg={"enabled": False})
        assert mock_post.called is False
        assert res == {"LEROY MERLIN": None}

    # 2. IA activée mais serveur Ollama inaccessible / Timeout
    cfg = {"enabled": True, "url": "http://localhost:11434", "model": "mistral"}
    with patch("httpx.post", side_effect=httpx.ConnectError("Connection refused")):
        res = call_ollama_batch(descriptions, categories, cfg)
        # Ne doit JAMAIS lever d'exception
        assert res == {"LEROY MERLIN": None}


def test_t3_10_smart_label_batch_with_ai_fallback_integration(db_session):
    """Test officiel du Cahier de Recette T3.10 :
    Libellé brut : CB LEROY MERLIN BRICOLAGE (Marchand inconnu, IA Ollama connectée).
    Résolution avec fallback IA local groupé (call_ollama_batch).
    Prompt JSON strict envoyé à Ollama avec les catégories existantes.
    Catégorie choisie = 'Logement & Maison' en 1 seul batch."""
    from unittest.mock import patch, MagicMock
    from app.models import Category, GlobalConfig
    import json

    # 1. Initialiser les catégories dans la base SQLite
    db_session.add(Category(name="Alimentation", type="expense_var"))
    db_session.add(Category(name="Logement & Maison", type="expense_var"))
    db_session.add(Category(name="Santé", type="expense_var"))
    # Activer l'IA dans GlobalConfig
    db_session.add(GlobalConfig(key="enable_ai", value="true"))
    db_session.add(GlobalConfig(key="ollama_url", value="http://localhost:11434"))
    db_session.add(GlobalConfig(key="ollama_model", value="mistral"))
    db_session.commit()

    raw_label = "CB LEROY MERLIN BRICOLAGE 7501"

    mock_resp_content = json.dumps({
        "Leroy Merlin Bricolage": "Logement & Maison"
    })
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"message": {"content": mock_resp_content}}

    with patch("httpx.post", return_value=mock_resp):
        # Appel du pipeline avec use_ai_fallback=True
        results = resolve_smart_labels_batch(db_session, [raw_label], use_ai_fallback=True)

        assert raw_label in results
        entry = results[raw_label]
        assert entry["source"] == "ai"
        assert entry["category"] == "Logement & Maison"
        assert entry["confidence"] == 0.85
        assert entry["description"] == "Leroy Merlin Bricolage"

        # Résolution unitaire
        single = resolve_smart_label(db_session, raw_label, use_ai_fallback=True)
        assert single["source"] == "ai"
        assert single["category"] == "Logement & Maison"
        assert single["confidence"] == 0.85


def test_ai_helpers_categorize_batch_endpoint(client, db_session):
    from unittest.mock import patch
    from app.models import Category

    db_session.add(Category(name="Alimentation", type="expense_var"))
    db_session.commit()

    with patch("app.services.chat.ollama_client.call_ollama_batch_async") as mock_async_batch:
        mock_async_batch.return_value = {"BOULANGERIE": "Alimentation"}
        res = client.post("/api/ai/categorize_batch", json={"descriptions": ["BOULANGERIE"]})
        assert res.status_code == 200
        assert res.json() == {"categories": {"BOULANGERIE": "Alimentation"}}




