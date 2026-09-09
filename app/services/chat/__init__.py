"""
app/services/chat/ — Module de services pour l'Assistant IA & RAG local.
Contient :
- ollama_client.py : Connectivité Ollama (sync / async)
- chat_prompt.py : Génération dynamique des prompts système (RAG, rôles, faits)
- chat_compression.py : Compression de contexte, gestion de pile et récupération après crash
- chat_snapshot.py : Snapshots d'entités pour le contexte conversationnel
- chat_briefing.py : Briefings financiers automatiques
- chat_tools.py : Shim de rétrocompatibilité (re-exporte depuis tools/)
- tools/ : Sous-modules des outils IA par domaine fonctionnel
    - read_tools.py : Outils RAG en lecture seule (20 fonctions)
    - write_tools.py : Outils de mutation CRUD (15 fonctions)
    - analysis_tools.py : Analyse approfondie — anomalies, audit intégrité (2 fonctions)
    - simulation_tools.py : Simulation financière — prêt, scénario What-If (2 fonctions)
"""
