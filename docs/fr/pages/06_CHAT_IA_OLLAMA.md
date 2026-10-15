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
Lorsque vous demandez à l'IA d'exécuter une tâche de gestion (ex: *"Ajoute une dépense de 45€ en supermarché aujourd'hui"*, *"Prépare un virement de précaution de 280 € de mon Livret A vers mon compte courant"*, ou *"Lance une synchronisation bancaire"*), l'IA ne modifie pas vos données sans votre accord :
1. Elle prépare la fonction d'action correspondante :
   - `create_transaction` : Saisie d'une dépense ou d'un revenu.
   - `create_planned_transfer` : Saisie d'un virement prévisionnel direct entre deux de vos comptes.
   - `set_budget` : Ajustement d'une enveloppe budgétaire.
   - `trigger_bank_sync` : Déclenchement d'un relevé en ligne de vos comptes bancaires synchronisés.
2. L'interface affiche une **Carte de Confirmation d'Action** interactive avec les détails précis.
3. Vous validez l'action en cliquant sur **"Confirmer"** (ou annulez), garantissant une sécurité et une maîtrise totales.

### 4. Virements de Précaution et Périmètre Bancaire (Strictement Hors-Ligne & Lecture Seule)
OmniBank et son assistant IA fonctionnent selon une règle fondamentale : **aucune action d'écriture bancaire réelle n'est possible**.
- L'application est strictement en **lecture seule** vis-à-vis des établissements bancaires. Ni l'IA ni l'application ne peuvent déplacer de l'argent réel sur vos comptes bancaires.
- Face à un besoin de trésorerie (ex. déficit de liquidité ou risque de découvert), l'assistant applique le workflow vertueux en **3 étapes** :
  1. **Réalisation bancaire réelle par l'utilisateur** : Vous effectuez le virement réel directement sur l'application ou le site sécurisé de votre banque.
  2. **Enregistrement prévisionnel dans OmniBank** : L'assistant vous propose de saisir immédiatement ce virement prévisionnel dans OmniBank (`create_planned_transfer`). Une fois validé, cela sécurise instantanément vos projections de solde et votre Reste à Vivre (RTL).
  3. **Rapprochement automatique** : Dès que l'opération est traitée par votre banque, le relevé bancaire en ligne (lancé via l'outil `trigger_bank_sync` de l'IA, manuellement, ou par l'Auto-Pilote) détecte l'écriture réelle et la rapproche automatiquement de la ligne prévisionnelle sans doublon.

---

## 🔒 Confidentialité des Données RAG

> [!IMPORTANT]
> Aucune donnée financière, aucun libellé et aucun montant ne sort de votre ordinateur. Les prompts d'analyse sont transmis uniquement au serveur Ollama local sur l'adresse `127.0.0.1`.
