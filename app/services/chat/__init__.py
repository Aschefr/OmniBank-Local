"""
app/services/chat/ — Module de services pour l'Assistant IA & RAG local.
Contient :
- ollama_client.py : Connectivité Ollama (sync / async)
- chat_tools.py : Définitions et exécution des 15 outils RAG et d'écriture
- chat_prompt.py : Génération dynamique des prompts système (RAG, rôles, faits)
- chat_compression.py : Compression de contexte, gestion de pile et récupération après crash
"""
