# 🤖 Documentation Page : Assistant Chat IA (Ollama Local)

La page **Chat IA** fournit une interface de dialogue naturelle avec votre conseiller financier personnel autonome. Il fonctionne entièrement hors-ligne sur votre machine via l'instance **Ollama**.

---

## 📸 Illustrations

![Chat IA Interface](../../../screenshots/07_chat_ia.png)
*Interface du Chat IA conversationnel avec historique de discussion et sélecteur de modèle.*

![Chat IA Proposition Action](../../../screenshots/07_chat_ia_proposition_ia.png)
*Proposition d'action automatique par l'IA (Function Calling avec carte de validation).*

---

## 🛠️ Composants & Fonctionnalités

### 1. Dialogue en Langage Naturel
Vous pouvez poser n'importe quelle question sur votre comptabilité ou demander des analyses personnalisées :
- *"Quel a été mon plus gros poste de dépense le mois dernier ?"*
- *"Combien me reste-t-il sur mon budget alimentation ?"*
- *"Est-ce que je peux me permettre d'économiser 200 € ce mois-ci ?"*

### 2. Modèles Supportés & Détection Automatique
L'interface détecte automatiquement les modèles LLM installés localement via Ollama :
- **`gemma4:e4b`** (⭐ Recommandé — Modèle principal utilisé et testé durant le développement d'OmniBank)
- **Mistral 7B**
- **Llama 3 / Llama 3.1**
- **Qwen 2.5**
- **Phi-3 / Gemma**

Vous pouvez basculer d'un modèle à un autre à tout moment depuis le menu déroulant en haut à droite.

### 3. Modales d'Action Autonome (Function Calling)
Lorsque vous demandez à l'IA d'exécuter une tâche de gestion (ex: *"Ajoute une dépense de 45€ en supermarché aujourd'hui"*), l'IA ne modifie pas la base sans votre accord :
1. Elle prépare la fonction `create_transaction` avec tous les paramètres décodés (montant, catégorie, date).
2. L'interface affiche une **Carte de Confirmation d'Action** interactive.
3. Vous validez l'action en cliquant sur **"Confirmer"** (ou annulez), garantissant une sécurité totale.

---

## 🔒 Confidentialité des Données RAG

> [!IMPORTANT]
> Aucune donnée financière, aucun libellé et aucun montant ne sort de votre ordinateur. Les prompts d'analyse sont transmis uniquement au serveur Ollama local sur l'adresse `127.0.0.1`.
