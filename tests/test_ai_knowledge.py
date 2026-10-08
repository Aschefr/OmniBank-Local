"""
tests/test_ai_knowledge.py — Tests unitaires pour la base de connaissances applicative de l'assistant IA local.
"""
import pytest
from app.services.chat.knowledge_service import (
    TOPIC_METADATA,
    load_knowledge_doc,
    resolve_relevant_knowledge,
    get_application_knowledge,
)
from app.services.chat.chat_prompt import load_system_prompt
from app.services.chat.tools import get_application_knowledge_tool, TOOLS


def test_knowledge_docs_exist_and_load():
    """Vérifie que l'ensemble des 6 fiches de connaissances sont présentes et non vides."""
    assert len(TOPIC_METADATA) == 6
    for topic_id in TOPIC_METADATA:
        content = load_knowledge_doc(topic_id)
        assert content is not None, f"Le document pour {topic_id} n'a pas pu être chargé."
        assert len(content) > 100, f"Le document pour {topic_id} est trop court."
        assert "# " in content, f"Le document pour {topic_id} doit contenir un titre Markdown."


def test_resolve_reste_a_vivre_knowledge():
    """Vérifie la résolution de la documentation sur le reste à vivre et la cadence."""
    query = "Comment est calculé mon reste à vivre et ma cadence par jour ?"
    res = resolve_relevant_knowledge(query)
    assert res is not None
    assert "RESTES À VIVRE" in res.upper() or "RESTE À VIVRE" in res.upper()
    assert "Charges Fixes" in res or "Solde Actuel" in res


def test_resolve_autopilot_knowledge():
    """Vérifie la résolution de la documentation sur l'Auto-Pilote et les badges LINKED_COMING."""
    query = "Que signifie le statut LINKED_COMING dans l'auto-pilote et le sas de revue ?"
    res = resolve_relevant_knowledge(query)
    assert res is not None
    assert "AUTO-PILOTE" in res.upper()
    assert "LINKED_COMING" in res
    assert "AUTO_COMMIT" in res


def test_resolve_budgets_knowledge():
    """Vérifie la résolution de la documentation sur les enveloppes budgétaires et le recalibrage."""
    query = "Comment fonctionne le recalibrage automatique des enveloppes budgétaires ?"
    res = resolve_relevant_knowledge(query)
    assert res is not None
    assert "ENVELOPPES" in res.upper() or "BUDGET" in res.upper()
    assert "±10%" in res or "EMA" in res or "Moyenne mobile" in res or "garde-fous" in res.lower()


def test_resolve_simulator_knowledge():
    """Vérifie la résolution de la documentation sur le simulateur What-If et les cônes de confiance."""
    query = "Comment fonctionne le simulateur what-if et le cône de confiance ?"
    res = resolve_relevant_knowledge(query)
    assert res is not None
    assert "SIMULATEUR" in res.upper()
    assert "Cônes de Confiance" in res or "Brownien" in res or "prudence" in res.lower()


def test_resolve_comptes_and_imports_knowledge():
    """Vérifie la résolution de la documentation sur l'import CSV et Woob."""
    query = "Comment importer mes relevés bancaires CSV et synchroniser avec Woob ?"
    res = resolve_relevant_knowledge(query)
    assert res is not None
    assert "COMPTES" in res.upper() or "IMPORTS" in res.upper()
    assert "CSV" in res
    assert "Woob" in res or "coffre-fort" in res.lower()


def test_resolve_privacy_and_sovereignty_knowledge():
    """Vérifie la résolution de la documentation sur le mode privé et la souveraineté hors-ligne."""
    query = "Est-ce que mes données partent dans le cloud et comment fonctionne le mode privé ?"
    res = resolve_relevant_knowledge(query)
    assert res is not None
    assert "CONFIDENTIALITÉ" in res.upper() or "SOUVERAINETÉ" in res.upper()
    assert "Local-First" in res or "Zero-Cloud" in res or "privacy-blur" in res


def test_resolve_unrelated_greeting_returns_none():
    """Vérifie qu'un simple salut ne déclenche pas d'injection superflue."""
    res = resolve_relevant_knowledge("Bonjour, comment allez-vous aujourd'hui ?")
    assert res is None


def test_system_prompt_knowledge_injection():
    """Vérifie que load_system_prompt intègre le bloc de connaissances pertinentes."""
    prompt = load_system_prompt(
        role="advisor",
        categories=["Alimentation", "Transport"],
        lang="fr",
        user_query="Pourquoi ai-je une opération en attente dans le sas de l'auto-pilote ?"
    )
    assert "AUTHORITATIVE OMNIBANK APPLICATION RULES" in prompt
    assert "AUTO-PILOTE" in prompt.upper()


def test_get_application_knowledge_tool():
    """Vérifie le fonctionnement de l'outil get_application_knowledge."""
    # Requête de la liste
    all_topics = get_application_knowledge_tool()
    assert all_topics["found"] is True
    assert len(all_topics["available_topics"]) == 6

    # Requête par identifiant de sujet
    res_ap = get_application_knowledge_tool(topic="autopilot")
    assert res_ap["found"] is True
    assert res_ap["topic_id"] == "autopilot"
    assert "LINKED_COMING" in res_ap["content"]

    # Vérification présence dans TOOLS
    tool_names = [t["function"]["name"] for t in TOOLS]
    assert "get_application_knowledge" in tool_names
