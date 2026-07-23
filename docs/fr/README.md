# Documentation Officielle OmniBank Local 🏦

Bienvenue dans la documentation officielle en français d'**OmniBank Local**, l'application de gestion financière personnelle et d'association local-first.

 OmniBank Local est conçue selon le principe de **Souveraineté Totale des Données (Zero Cloud)** : vos données financières ne quittent jamais votre machine, la base de données SQLite s'exécute en local, et toutes les fonctionnalités d'assistance IA reposent sur une instance **Ollama** locale.

---

## 📚 Sommaire de la Documentation

La documentation se compose de guides généraux pour comprendre le fonctionnement global et de fiches détaillées par page accessible directement pour un usage contextuel.

### 🚀 Guides Généraux

1. 📖 **[Guide Rapide de Prise en Main](01_GUIDE_RAPIDE.md)**
   - De l'installation et la première ouverture à la création de comptes et l'export de sauvegarde DB.

2. ⚙️ **[Analyse Approfondie des Pipelines & Mécanismes](02_PREMIER_LANCEMENT_ET_PIPELINES.md)**
   - Analyse technique : Assistant d'initialisation, parsing CSV & détection des doublons, moteur financier & rapprochement bancaire, système de sauvegardes automatiques et export DB.

3. 🛠️ **[Architecture Technique & Outils](03_ARCHITECTURE_TECHNIQUE_ET_OUTILS.md)**
   - Stack logicielle (FastAPI, SQLite, Tauri 2.x, Vanilla JS), schéma de la base de données SQL, intégration de l'IA locale Ollama (RAG & Function Calling) et gestion de l'i18n.

---

### 📄 Guides Détaillés par Page (`pages/`)

Accédez directement à la fiche explicative correspondant à l'écran sur lequel vous vous trouvez :

| Page / Fonctionnalité | Document de Référence | Description |
| :--- | :--- | :--- |
| **Tableau de Bord** | 📊 [01_TABLEAU_DE_BORD.md](pages/01_TABLEAU_DE_BORD.md) | Synthèse visuelle des comptes, graphiques et saisie rapide d'opérations. |
| **Historique & Opérations** | 📜 [02_HISTORIQUE_ET_OPERATIONS.md](pages/02_HISTORIQUE_ET_OPERATIONS.md) | Liste complète des transactions, filtres multicritères et rapprochement bancaire. |
| **Synthèse financière** | 📈 [03_SYNTHESE.md](pages/03_SYNTHESE.md) | Bilan des entrées/sorties par catégorie et export de rapports PDF. |
| **Budgets & IA** | 🎯 [04_BUDGETS_ET_SUGGESTIONS_IA.md](pages/04_BUDGETS_ET_SUGGESTIONS_IA.md) | Gestion des enveloppes budgétaires, plafonds et générateur de conseils par Ollama. |
| **Tendances** | 📉 [05_TENDANCES.md](pages/05_TENDANCES.md) | Visualisation graphique de l'évolution des finances dans le temps. |
| **Assistant Chat IA** | 🤖 [06_CHAT_IA_OLLAMA.md](pages/06_CHAT_IA_OLLAMA.md) | Chat conversationnel 100% offline avec Function Calling pour interagir sur vos finances. |
| **Récurrences** | 🔁 [07_RECURRENCES_ET_ECHEANCIER.md](pages/07_RECURRENCES_ET_ECHEANCIER.md) | Gestion des abonnements, factures récurrentes et propagation des échéances. |
| **Catégories** | 🏷️ [08_CATEGORIES.md](pages/08_CATEGORIES.md) | Arborescence personnalisée des catégories/sous-catégories de revenus et dépenses. |
| **Comptes** | 💳 [09_COMPTES.md](pages/09_COMPTES.md) | Gestion de vos comptes bancaires (Courant, Épargne, Livrets) et soldes initiaux. |
| **Configuration & Licence** | ⚙️ [10_CONFIGURATION_ET_LICENCE.md](pages/10_CONFIGURATION_ET_LICENCE.md) | Réglages généraux, connexion Ollama, i18n et activation Mode Organisation. |
| **Assistant & Importation CSV** | 📥 [11_ASSISTANT_ET_IMPORTATION_CSV.md](pages/11_ASSISTANT_ET_IMPORTATION_CSV.md) | Assistant de démarrage initial et moteur d'importation de relevés bancaires CSV. |

---

## 🎨 Captures d'Écran et Illustrations

Toutes les fiches de documentation s'appuient sur les captures d'écran situées dans le dossier `screenshots/` du projet pour illustrer le fonctionnement exact de l'interface utilisateur.

---

## 🔒 Engagement Confidentialité & Hors-Ligne

- **Aucune télémétrie** : Aucun paquet de données n'est envoyé à des serveurs tiers.
- **Stockage Local** : Toutes vos transactions sont enregistrées dans le fichier local SQLite `omnibank.db`.
- **IA Éthique & Privée** : L'IA utilise l'API Ollama s'exécutant sur votre propre ordinateur (par exemple `localhost:11434`).
