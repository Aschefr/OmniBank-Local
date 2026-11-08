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

### 2. Modèles recommandés
L'assistant de démarrage (étape IA) et **Configuration > Assistant IA** proposent trois modèles. « Utiliser » choisit le modèle et règle sa température et son contexte ; avec Ollama, « Télécharger » le récupère sans passer par la ligne de commande.

| Niveau | Modèle | Mémoire graphique | Réponse du conseiller | Téléchargement |
|---|---|---|---|---|
| Minimum | `gemma4:e4b` | environ 3,5 Go | environ 5 s | 9,6 Go |
| Recommandé | `bonsai-2:27b` | environ 9,2 Go | environ 16 s | 8,3 Go |
| Top qualité | `qwen3.8:27b` | environ 17,5 Go | environ 13 s | 17,7 Go |

Réglages appliqués : température 0,2 et contexte 32K pour les trois.

Ce choix vient d'un banc d'essai de 16 modèles sur les tâches d'OmniBank : nom et catégorie de libellés bancaires, regroupement des catégories en enveloppes, et douze questions au conseiller (bons outils, chiffres exacts, rien d'inventé, réponse dans votre langue). Les temps ont été mesurés sur une carte graphique de 24 Go ; sans carte graphique, comptez plusieurs fois plus long.

- **Minimum** : tient sur presque toute carte graphique récente ; le conseiller se trompe plus souvent sur les questions difficiles.
- **Recommandé** : la qualité d'un modèle de 27 milliards de paramètres dans environ 9 Go, grâce à des poids ternaires. Il a répondu juste aux douze questions du conseiller, mais regroupe les enveloppes de façon moins régulière.
- **Top qualité** : le meilleur ensemble mesuré, pour une carte graphique de 24 Go.

#### Comment ces modèles ont été choisis
Les mêmes chiffres sont affichés dans **Configuration > Assistant IA**, sous les trois cartes. Banc du 6 novembre 2026 : chaque tâche jouée deux fois, température 0,2, contexte 32K, carte RTX 3090. Libellés : catégorie de 45 libellés inventés ; vrai relevé : catégorie de 120 libellés d'un vrai relevé ; enveloppes : 22 catégories à placer ; conseiller : 12 questions sur un profil de démonstration. Quand les deux passes diffèrent, les deux résultats sont donnés.

| Modèle | Rang | Libellés /45 | Vrai relevé /120 | Enveloppes /22 | Conseiller /12 | Réponse | Mémoire |
|---|---|---:|---:|---:|---:|---:|---:|
| `qwen3.8:27b` | Top qualité | 44 | 78–80 | 20 | 12 | 13 s | 17,5 Go |
| `bonsai-2:27b` | Recommandé | 43 | 73–74 | 16–20 | 12 | 16 s | 9,2 Go |
| `gemma4:e4b` | Minimum | 41–42 | 64–66 | 21 | 9–10 | 5 s | 3,5 Go |
| `gemma4:31b` | Alternative | 44 | 87 | 21 | 12 | 23 s | 19,9 Go |
| `ministral-3:14b` | Non retenu | 41 | 56–57 | 20–22 | **6** | 5 s | 11,1 Go |
| `mistral-nemo` | Non retenu | 38 | 58 | 21 | **0–3** | 1,4 s | 9,9 Go |

- Le conseiller départage : `ministral-3:14b` et `mistral-nemo` rangent bien les libellés, mais répondent faux à la moitié des questions ou plus, presque toujours sans consulter vos données. `gemma4:31b` lit le mieux un vrai relevé, mais répond presque deux fois plus lentement que `qwen3.8:27b`.
- `gemma4:e4b` tient dans 3,5 Go et place bien les enveloppes (21 sur 22) ; il se trompe sur 2 ou 3 des 12 questions du conseiller.
- Le conseiller garde la réflexion du modèle (vérifié le 8 novembre 2026) : sans elle, `gemma4:e4b` n'appelle plus ses outils et tombe à 2 ou 3 bonnes réponses sur 12, et `bonsai-2:27b` en perd jusqu'à deux. Seul `qwen3.8:27b` n'y perd rien, en répondant en 7 à 8 s au lieu de 12. Les autres tâches, elles, s'en passent.

Tout autre modèle installé reste disponible dans la liste déroulante. Préférez un modèle qui sait appeler des outils : le conseiller et l'extraction de données en ont besoin.

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
