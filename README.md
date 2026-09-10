# OmniBank Local 🏦

<p align="center">
  <a href="#-français">Français</a> • 
  <a href="#-english">English</a>
</p>
---

# 🇫🇷[![Version](https://img.shields.io/badge/version-1.1.7-blue.svg)](https://github.com/Aschefr/OmniBank-Local/releases)
[![Publisher](https://img.shields.io/badge/éditeur-Amify_Studio-purple.svg)](https://amify-studio.fr)
[![Tech](https://img.shields.io/badge/stack-FastAPI%20%7C%20Tauri%20%7C%20Ollama-orange.svg)](#)

**OmniBank Local** est une solution de gestion de finances personnelles et associatives ultra-privée, conçue pour ceux qui exigent un contrôle total sur vos données. Alliant la puissance d'un tableur à l'intelligence d'une IA locale, elle transforme votre gestion financière en une expérience fluide et sécurisée.

![Dashboard Overview](screenshots/02_dashboard.png)

> [!CAUTION]
> **Avertissement** : La sécurité du code n'a pas fait l'objet d'un audit indépendant. Utilisez cette application à vos propres risques et uniquement dans un environnement local sécurisé.

> [!TIP]
> **Chiffrement du disque recommandé** : La base de données SQLite stocke vos données financières en clair sur le disque. Pour une protection optimale, activez le chiffrement intégral de votre disque (BitLocker sous Windows, LUKS sous Linux, FileVault sous macOS).

---

## 🌟 Pourquoi OmniBank ?

*   **0 Cloud, 100% Offline** : Vos données restent physiquement sur votre machine. Aucune télémétrie, aucun tracking.
*   **IA Locale & RAG** : Vos transactions sont vectorisées en local pour permettre un dialogue fluide avec votre historique financier via **Ollama**.
*   **Contrôle Total des Catégories** : Règles automatiques, détection intelligente de patterns et classification assistée.
*   **Visualisations Riches** : Graphiques financiers clairs (Chart.js) et tableau virtuel pour les historiques volumineux.
*   **Conçu pour Durer** : Base SQLite standard et exports universels (CSV, JSON).

---

## ✨ Fonctionnalités Clés

### 🏗️ Configuration Simplifiée (Setup Wizard)
Dès le premier lancement, un **Assistant d'Initialisation** vous guide pour configurer vos comptes, vos préférences et connecter votre instance Ollama.

![Setup Wizard](screenshots/01_wizard_acceuil.png)

### 📈 Analytique & Gestion Quotidienne
*   **Tableau de Bord Dynamique** : Une vue d'ensemble de vos soldes, de vos budgets et de vos prochaines échéances.
*   **Historique Virtualisé** : Gérez des milliers de transactions avec une fluidité parfaite grâce au rendu ultra-rapide.
*   **Rapprochement Intelligent** : Un système visuel pour pointer vos opérations. Comparez d'un coup d'œil vos relevés bancaires (avant) et votre comptabilité propre (après).

| Saisie d'opération | Historique | Rapprochement |
| :---: | :---: | :---: |
| ![Saisie d'opération](screenshots/02_dashboard_saisie_operation.png) | ![Historique des transactions](screenshots/03_historique.png) | ![Dashboard avec rapprochement](screenshots/02_dashboard_après_rapprochement.png) |

### 🎯 Budget & Enveloppes
Suivez vos dépenses par catégories ou par projets avec un système d'enveloppes visuel. L'IA peut même vous suggérer des budgets basés sur vos habitudes.

| Vue Budget | Détail Budget | Suggestions IA |
| :---: | :---: | :---: |
| ![Vue Budget](screenshots/05_budgets.png) | ![Détail d'un budget](screenshots/05_budgets_detail.png) | ![Suggestions IA pour budgets](screenshots/05_budgets_suggestion_ia.png) |

### 🤖 Intelligence Artificielle Locale
Interagissez avec votre assistant financier personnel via Ollama. Grâce au RAG (Retrieval-Augmented Generation), l'IA accède à vos données pour répondre précisément. Elle peut même vous soumettre des **propositions d'actions interactives** directement dans le chat.

![Chat IA](screenshots/07_chat_ia.png)

### 📊 Synthèse & Tendances
Visualisez l'évolution de votre patrimoine et générez des **rapports PDF haute fidélité**, parfaits pour un suivi comptable rigoureux ou un partage sécurisé.

| Synthèse | Tendances | Export PDF |
| :---: | :---: | :---: |
| ![Synthèse mensuelle](screenshots/04_synthèse.png) | ![Tendances long terme](screenshots/06_tendances.png) | ![Export PDF](screenshots/04_synthèse_export_pdf.png) |

### 🛠️ Administration & Personnalisation
Prenez le contrôle total de votre structure financière grâce à des outils de gestion flexibles.

| Comptes | Catégories | Récurrences | Configuration |
| :---: | :---: | :---: | :---: |
| ![Gestion des comptes](screenshots/10_comptes.png) | ![Gestion des catégories](screenshots/09_catégories.png) | ![Opérations récurrentes](screenshots/08_recurrences.png) | ![Configuration globale](screenshots/11_configuration.png) |

![Propagation des modifications](screenshots/08_recurrences_modification_propagé.png)

---

## 🏢 Mode Organisation (Associations / CSE)

OmniBank propose un **mode organisation** conçu pour les associations, comités d'entreprise (CSE) et petites structures ayant besoin d'un suivi multi-utilisateur.

*   **👥 Multi-utilisateur sans mot de passe** : Chaque membre (trésorier, adjoint, secrétaire…) sélectionne son profil au lancement.
*   **📋 Audit intégré** : Chaque opération enregistre automatiquement qui l'a créée et qui l'a modifiée en dernier.
*   **🔑 Licence requise** : L'activation du mode organisation nécessite une clé de licence.

> Pour obtenir une licence, ouvrez une **[Issue sur GitHub](https://github.com/Aschefr/OmniBank-Local/issues)**.

---

## 🚀 Installation

### 🖥️ Windows (Recommandé)
Téléchargez le dernier installateur `.msi` depuis la page des [Releases](https://github.com/Aschefr/OmniBank-Local/releases).

### 🐳 Docker
```bash
docker-compose up -d --build
```
Accédez à l'interface sur `http://localhost:8434`.

---

## 🛠 Stack Technique

*   **Backend** : Python (FastAPI), SQLAlchemy, Pandas.
*   **Frontend** : HTML5/CSS3 (Vanilla), JavaScript, Chart.js.
*   **Desktop** : Tauri (Wrapper Rust).
*   **IA** : Ollama (Support Texte & Vision).

## 🆕 Nouveautés (v1.1.7)

* **📱 Forçage Manuel & Modale 2FA Directe** : Le bouton « Relevé en ligne » force désormais instantanément la synchronisation avec la banque (court-circuitant le délai de sécurité automatique de 3h). Déclenchement automatique de la modale 2FA interactive lors des validations smartphone requises (Crédit Mutuel, Crédit Agricole) et fermeture automatique dès validation mobile. Persistance des sessions Woob pour conserver les jetons SCA 90 jours.
* **🛡️ Résilience Desktop & Double Smoke Test de Packaging** : Intégration de tests de fumée automatisés à 2 niveaux (test de santé `/api/health` du sidecar + extraction administrative `msiexec /a` du paquet MSI compilé avant toute publication). Écran de repli automatique avec diagnostic et téléchargement de version précédente en cas d'anomalie au lancement.

## 📦 Historique Récent (v1.1.6)

* **🏛️ Moteur de Migrations SQLite Incrémental & Modulaire** : Déconstruction d'`init_data.py` en 24 modules de versions numérotées sous `app/migrations/` avec runner transactionnel atomique, utilitaire idempotent `safe_add_column` et fast-path (<1ms) au démarrage.
* **🎨 Architecture CSS Modulaire & Design System Thématique** : Découpage de `style.css` (13 919 lignes) en 21 feuilles de style structurées dans 5 répertoires sémantiques (`base/`, `themes/`, `components/`, `views/`, `responsive/`) orchestrées sans dépendance de compilation.
* **🏗️ Modularisation Frontend (`app.js`)** : Découpage du cœur applicatif en un orchestrateur léger (~460 lignes) et 5 modules spécialisés (`notifications`, `sidebar`, `profiles`, `changelog`, `i18n_picker`) montés sur `App.prototype`.
* **📦 Souveraineté 100% Zero-Cloud** : Intégration locale de toutes les dépendances CDN dans `/static/vendor/` (Chart.js, KaTeX, Marked, DOMPurify, polices Inter, drapeaux SVG) pour un fonctionnement hors-ligne absolu.
* **🧠 Cockpit de Revue IA & Persistance Anti-Dégradation** : Animations d'analyse IA en direct (`🧠 Analyse IA...`), analyse unique par batch, endpoint `/api/bank-sync/update-pending` protégeant les suggestions contre les écrasements, et badges d'origine contextuels.
* **🔔 Toast Rouge d'Échec de Relevé & Détection de Panne Bancaire** : Affichage d'un toast d'alerte rouge avec bouton direct vers le centre de notifications lors des échecs de synchronisation, différenciation explicite entre interruption de service bancaire et action utilisateur requise, et correction de l'affichage du carrousel de prêts.

## 📦 Historique Récent (v1.1.5)

* **🚀 Enregistrement Autonome Direct (Auto-Pilote Étape 3)** : Les dépenses et recettes sans ambiguïté et à haute confiance sont désormais enregistrées directement en compte avec traçabilité d'audit et annulation possible à tout moment.
* **🧠 Revue Assistée par IA & Bandeau Dynamique** : Proposition automatique de catégories et de noms propres dans le sas de revue via l'IA locale Ollama, avec badges de provenance explicites (`Règle manuelle`, `Règle apprise`, `Historique`, `Suggestion IA`) et bandeau de suivi en direct.
* **📥 Importation Directe de Relevés Sans Friction** : Les imports de relevés où 100% des opérations sont prises en charge par l'auto-pilote s'enregistrent instantanément sans modale superflue avec un toast récapitulatif festif.
* **🧪 Banc d'Essai Smart Label & Règles Réversibles** : Simulation en temps réel de la reconnaissance des commerçants et du repli IA dans les Paramètres, avec gestion réversible des règles manuelles/caméléons et support d'annulation (Undo).
* **📱 Requalification 2FA & Fluidité de Démarrage** : Notification dédiée et action contextuelle "Valider sur smartphone" pour la double authentification bancaire. Démarrage instantané de l'application avec temporisation des rapports IA d'arrière-plan.

> 📖 Pour l'historique complet et détaillé de toutes les versions antérieures, consultez le **[CHANGELOG.md](CHANGELOG.md)**.

---

# 🇺🇸 English

[![Version](https://img.shields.io/badge/version-1.1.7-blue.svg)](https://github.com/Aschefr/OmniBank-Local/releases)
[![Publisher](https://img.shields.io/badge/publisher-Amify_Studio-purple.svg)](https://amify-studio.fr)
[![Tech](https://img.shields.io/badge/stack-FastAPI%20%7C%20Tauri%20%7C%20Ollama-orange.svg)](#)

**OmniBank Local** is an ultra-private personal and organizational finance management solution, designed for those who demand total control over their data. Combining spreadsheet-like power with local AI intelligence, it transforms financial management into a smooth and secure experience.

![Dashboard Overview](screenshots/02_dashboard.png)

> [!CAUTION]
> **Disclaimer**: The code's security has not undergone any independent audit. Use this application at your own risk and only in a secure local environment.

---

## 🌟 Why OmniBank?

*   **🔒 Absolute Privacy (Zero Cloud)**: Your financial data never leaves your machine. Everything is stored locally in a SQLite database.
*   **🤖 Local AI Assistant (Ollama)**: Chat with your finances in natural language. Smart categorization, trend forecasting, and tailored advice without compromising privacy.
*   **⚡ Extreme Performance**: Virtualized table rendering to handle tens of thousands of transactions seamlessly.
*   **🎯 Envelope Budgeting**: Intuitive visual envelopes for ongoing spending and savings goals.

---

## ✨ Key Features

### 🏗️ Simplified Setup (Setup Wizard)
From the very first launch, an **Initialization Assistant** guides you through configuring your accounts, preferences, and connecting your Ollama instance.

![Setup Wizard](screenshots/01_wizard_acceuil.png)

### 📈 Analytics & Daily Management
*   **Dynamic Dashboard**: An overview of your balances, budgets, and upcoming deadlines.
*   **Virtualized History**: Manage thousands of transactions with perfect fluidity thanks to ultra-fast rendering.
*   **Smart Reconciliation**: A visual system to check your operations. Compare bank statements (before) and your clean accounting (after) at a glance.

| Transaction entry | History | Reconciliation |
| :---: | :---: | :---: |
| ![Transaction entry](screenshots/02_dashboard_saisie_operation.png) | ![Transaction history](screenshots/03_historique.png) | ![Dashboard with reconciliation](screenshots/02_dashboard_après_rapprochement.png) |

### 🎯 Budget & Envelopes
Suivez vos dépenses par catégories ou par projets avec un système d'enveloppes visuel. L'IA peut même vous suggérer des budgets basés sur vos habitudes.

| Vue Budget | Détail Budget | Suggestions IA |
| :---: | :---: | :---: |
| ![Vue Budget](screenshots/05_budgets.png) | ![Détail d'un budget](screenshots/05_budgets_detail.png) | ![Suggestions IA pour budgets](screenshots/05_budgets_suggestion_ia.png) |

### 🤖 Local AI Assistant
Interact with your personal financial assistant via Ollama. Thanks to RAG (Retrieval-Augmented Generation), the AI accesses your data to answer accurately. It can even propose **interactive action cards** directly in the chat.

![Chat IA](screenshots/07_chat_ia.png)

### 📊 Analytics & Trends
Visualize your financial trajectory and export **high-fidelity PDF reports**, perfect for strict accounting follow-up or secure sharing.

| Monthly Analytics | Long-Term Trends | PDF Export |
| :---: | :---: | :---: |
| ![Monthly Summary](screenshots/04_synthèse.png) | ![Long-term trends](screenshots/06_tendances.png) | ![PDF Export](screenshots/04_synthèse_export_pdf.png) |

### 🛠️ Administration & Customization
Take full control over your financial structure with flexible management tools.

| Accounts | Categories | Recurrences | Settings |
| :---: | :---: | :---: | :---: |
| ![Account Management](screenshots/10_comptes.png) | ![Category Management](screenshots/09_catégories.png) | ![Recurring operations](screenshots/08_recurrences.png) | ![Global Settings](screenshots/11_configuration.png) |

![Change Propagation](screenshots/08_recurrences_modification_propagé.png)

---

## 🏢 Organisation Mode (Associations / Works Councils)

OmniBank includes an **organization mode** designed for non-profits, sports clubs, works councils (CSE), and small organizations requiring multi-user access.

*   **👥 Multi-user without passwords**: Every member (treasurer, deputy, secretary…) selects their profile at launch.
*   **📋 Built-in audit trail**: Every transaction automatically logs who created it and who modified it last.
*   **🔑 License required**: Activating Organization Mode requires a valid license key.

> To obtain a license, open an **[Issue on GitHub](https://github.com/Aschefr/OmniBank-Local/issues)**.

---

## 🚀 Installation

### 🖥️ Windows (Recommended)
Download the latest `.msi` installer from the [Releases](https://github.com/Aschefr/OmniBank-Local/releases) page.

### 🐳 Docker
```bash
docker-compose up -d --build
```
Access the interface at `http://localhost:8434`.

---

## 🛠 Technical Stack

*   **Backend**: Python (FastAPI), SQLAlchemy, Pandas.
*   **Frontend**: HTML5/CSS3 (Vanilla), JavaScript, Chart.js.
*   **Desktop**: Tauri (Rust Wrapper).
*   **AI**: Ollama (Text & Vision Support).

## 🆕 What's New (v1.1.7)

* **📱 Forced Manual Bank Sync & Direct 2FA Auto-Prompt**: Manual clicks on 'Relevé en ligne' now immediately force online synchronization (bypassing the 3-hour automated background cooldown). Automatically surfaces the interactive 2FA modal when strong customer authentication is required (Crédit Mutuel, Crédit Agricole) and auto-closes upon mobile approval. Added persistent Woob storage to preserve 90-day SCA session tokens.
* **🛡️ Desktop Startup Resilience & Dual Packaging Smoke Tests**: Added automated dual-stage smoke tests (sidecar `/api/health` validation + post-build administrative MSI extraction test) to guarantee 100% functional release bundles. Added a startup failure fallback screen with direct diagnostic logs and previous version download link.

## 📦 Recent History (v1.1.6)

* **🏛️ Modular Incremental SQLite Migration Engine**: Refactored monolithic `init_data.py` into 24 sequential version modules under `app/migrations/` with an atomic transactional runner, idempotent `safe_add_column`, and fast-path bypass (<1ms) at startup.
* **🎨 Modular CSS Architecture & Thematic Design System**: Partitioned monolithic `style.css` (~14,000 lines) into 21 domain stylesheets across 5 semantic directories (`base/`, `themes/`, `components/`, `views/`, `responsive/`) with zero build dependencies.
* **🏗️ Frontend Application Modularization (`app.js`)**: Decoupled core lifecycle into a lightweight orchestrator (~460 lines) and 5 domain modules (`notifications`, `sidebar`, `profiles`, `changelog`, `i18n_picker`) mounted on `App.prototype`.
* **📦 100% Zero-Cloud Offline Sovereignty**: Bundled all external CDN dependencies locally into `/static/vendor/` (Chart.js, KaTeX, Marked, DOMPurify, Inter fonts, SVG flags) for completely offline operation without third-party requests.
* **🧠 AI Review Cockpit & Anti-Demotion Persistence**: Real-time AI analysis animations (`🧠 AI Analysis...`), single-pass batch classification, `/api/bank-sync/update-pending` protecting suggestions from being overwritten, and dynamic origin provenance badges.
* **🔔 Bank Sync Red Error Toast & Outage Diagnostics**: Dedicated red toast alert with 1-click notification center access upon sync failure, clear differentiation between bank server outages/maintenance and required user actions, and sidebar loan carousel display fix.

## 📦 Recent History (v1.1.5)

* **🚀 Autonomous Direct Expense Auto-Commit (Auto-Pilot Stage 3)**: Unambiguous incoming transactions with certified high confidence are automatically recorded directly to accounts with audit trail logging and instant rollback capability.
* **🧠 AI-Assisted Review & Live Status Feedback**: The review cockpit automatically suggests smart categories and merchant names via local Ollama AI in the background, featuring explicit provenance badges (`Manual Rule`, `Learned Rule`, `History`, `AI Suggestion`) and a live status banner.
* **📥 Frictionless Statement Import Dropzone**: Statement imports fully handled by Auto-Pilot now close automatically with a celebratory toast summary, eliminating empty review dialogs.
* **🧪 Smart Label Simulation Sandbox & Reversible Rules**: Test merchant recognition and local AI fallback in real time directly within Settings. Manual rule protection and chameleon multi-category status are fully reversible with 1-click toggles and undo support.
* **📱 Bank 2FA Requalification & Fast Startup**: Contextual "Validate on smartphone" actions and notifications for bank 2FA challenges. Decoupled background AI reporting ensures instant application boot.

> 📖 For the full, detailed history of all previous releases, see the **[CHANGELOG.md](CHANGELOG.md)**.

### 🐍 Développement Local / Local Development

1. `python -m venv venv`
2. `.\venv\Scripts\activate`
3. `pip install -r requirements.txt`
4. `uvicorn app.main:app --host 127.0.0.1 --port 8434 --reload`

## 📝 Licence / License

Ce projet est disponible en accès partagé (**Source-Available**) sous la licence propriétaire d'Amify Studio.

* **Usage Personnel / Personal Use** : Gratuit et autorisé pour un usage strictement individuel et privé. / Free and permitted for strictly individual and private use.
* **Usage Organisation / Organizational Use** : L'utilisation collective, par une association (Loi 1901, CSE) ou une entreprise (y compris l'activation du "Mode Organisation") requiert l'acquisition d'une clé de licence commerciale. / Any group, non-profit, or corporate use (including enabling "Organisation Mode") requires a commercial license key.
* **Détails / Details** : Voir le fichier [LICENSE](LICENSE) pour les termes complets. / See the [LICENSE](LICENSE) file for full terms.
