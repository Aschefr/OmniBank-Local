# OmniBank Local 🏦

<p align="center">
  <a href="#-français">Français</a> • 
  <a href="#-english">English</a>
</p>

---

# 🇫🇷 Français

[![Version](https://img.shields.io/badge/version-1.0.30-blue.svg)](https://github.com/Aschefr/OmniBank-Local/releases)
[![Publisher](https://img.shields.io/badge/éditeur-Amify_Studio-purple.svg)](https://amify-studio.fr)
[![Tech](https://img.shields.io/badge/stack-FastAPI%20%7C%20Tauri%20%7C%20Ollama-orange.svg)](#)

**OmniBank Local** est une solution de gestion de finances personnelles et associatives ultra-privée, conçue pour ceux qui exigent un contrôle total sur leurs données. Alliant la puissance d'un tableur à l'intelligence d'une IA locale, elle transforme votre gestion financière en une expérience fluide et sécurisée.

![Dashboard Overview](screenshots/02_dashboard.png)

> [!CAUTION]
> **Avertissement** : La sécurité du code n'a pas fait l'objet d'un audit indépendant. Utilisez cette application à vos propres risques et uniquement dans un environnement local sécurisé.

---

## 🌟 Pourquoi OmniBank ?

*   **🔒 Confidentialité Absolue (Zéro Cloud)** : Vos données financières ne quittent jamais votre machine. Tout est stocké localement dans une base SQLite.
*   **🤖 Assistant IA Local (Ollama)** : Interagissez avec vos finances en langage naturel. Catégorisation intelligente, analyses de tendances et conseils personnalisés sans compromettre votre vie privée.
*   **⚡ Performance Extrême** : Grâce au rendu virtualisé, gérez des milliers de transactions sans aucun ralentissement.
*   **🎯 Gestion par Enveloppes** : Un système budgétaire visuel et intuitif pour suivre vos projets et vos dépenses courantes.

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
Prenez le contrôle total de votre structure financière avec des outils de gestion flexibles.

| Comptes | Catégories | Récurrences | Configuration |
| :---: | :---: | :---: | :---: |
| ![Gestion des comptes](screenshots/10_comptes.png) | ![Gestion des catégories](screenshots/09_catégories.png) | ![Opérations récurrentes](screenshots/08_recurrences.png) | ![Configuration globale](screenshots/11_configuration.png) |

![Propagation des changements](screenshots/08_recurrences_modification_propagé.png)

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

---

## 🆕 Dernières Mises à Jour (v1.0.30)

*   **✨ Assistant de transition annuelle (Year-End Wizard)** : Interface complète sous forme de tableur pour préparer et générer en masse les opérations récurrentes d'une année sur l'autre (avec sélection d'année de référence, réinitialisation de valeurs, et création en ligne de catégories/récurrences).
*   **🔄 Tableau dépliable des récurrences** : Redesign complet de la page principale des récurrences en un tableau interactif, où chaque ligne de récurrence peut être dépliée pour modifier et propager individuellement ses occurrences pour l'année.
*   **🌍 Traduction intégrale (FR/EN)** : Support complet de l'anglais et du français sur l'ensemble de l'interface de gestion et de transition des récurrences.
*   **🏢 Mode Organisation & Améliorations** : Mode multi-utilisateurs pour associations/CSE, DB partagée, et installateur NSIS pour tous les utilisateurs Windows.

---

# 🇺🇸 English

[![Version](https://img.shields.io/badge/version-1.0.30-blue.svg)](https://github.com/Aschefr/OmniBank-Local/releases)
[![Publisher](https://img.shields.io/badge/publisher-Amify_Studio-purple.svg)](https://amify-studio.fr)
[![Tech](https://img.shields.io/badge/stack-FastAPI%20%7C%20Tauri%20%7C%20Ollama-orange.svg)](#)

**OmniBank Local** is an ultra-private personal and organizational finance management solution, designed for those who demand total control over their data. Combining spreadsheet-like power with local AI intelligence, it transforms financial management into a smooth and secure experience.

![Dashboard Overview](screenshots/02_dashboard.png)

> [!CAUTION]
> **Disclaimer**: The code's security has not undergone any independent audit. Use this application at your own risk and only in a secure local environment.

---

## 🌟 Why OmniBank?

*   **🔒 Absolute Privacy (Zero Cloud)**: Your financial data never leaves your machine. Everything is stored locally in a SQLite database.
*   **🤖 Local AI Assistant (Ollama)**: Interact with your finances using natural language. Intelligent categorization, trend analysis, and personalized advice without compromising your privacy.
*   **⚡ Extreme Performance**: Thanks to virtualized rendering, manage thousands of transactions without any slowdown.
*   **🎯 Envelope Management**: A visual and intuitive budgeting system to track your projects and daily expenses.

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
Track your spending by categories or projects with a visual envelope system. The AI can even suggest budgets based on your habits.

| Budget View | Budget Detail | AI Suggestions |
| :---: | :---: | :---: |
| ![Budget View](screenshots/05_budgets.png) | ![Budget Detail](screenshots/05_budgets_detail.png) | ![AI Budget Suggestions](screenshots/05_budgets_suggestion_ia.png) |

### 🤖 Local AI Assistant
Interact with your personal financial assistant via Ollama. Using RAG (Retrieval-Augmented Generation), the AI accesses your data to provide precise answers. It can even submit **interactive action proposals** directly in the chat.

![AI Chat](screenshots/07_chat_ia.png)

### 📊 Synthesis & Trends
Visualize the evolution of your wealth and generate **high-fidelity PDF reports**, perfect for rigorous accounting tracking or secure sharing.

| Synthesis | Trends | PDF Export |
| :---: | :---: | :---: |
| ![Monthly synthesis](screenshots/04_synthèse.png) | ![Long term trends](screenshots/06_tendances.png) | ![PDF Export](screenshots/04_synthèse_export_pdf.png) |

### 🛠️ Administration & Customization
Take full control of your financial structure with flexible management tools.

| Accounts | Categories | Recurrences | Configuration |
| :---: | :---: | :---: | :---: |
| ![Account management](screenshots/10_comptes.png) | ![Category management](screenshots/09_catégories.png) | ![Recurring operations](screenshots/08_recurrences.png) | ![Global configuration](screenshots/11_configuration.png) |

![Propagation of changes](screenshots/08_recurrences_modification_propagé.png)

---

## 🏢 Organisation Mode (Nonprofits / Work Councils)

OmniBank offers an **organisation mode** designed for nonprofits, work councils, and small organizations needing multi-user tracking.

*   **👥 Password-free multi-user**: Each member (treasurer, deputy, secretary…) selects their profile at launch.
*   **📋 Built-in audit trail**: Every transaction automatically records who created it and who last modified it.
*   **🔑 License required**: Activating organisation mode requires a license key.

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

---

## 🆕 Recent Updates (v1.0.22)

*   **🏢 Organisation Mode**: Multi-user management for nonprofits and work councils, with full audit trail.
*   **🖥️ Shared Database**: Share the DB between Windows sessions via ProgramData.
*   **📦 NSIS Installer**: System-wide installation in `Program Files` for all users on the same PC.
*   **🎯 Custom Budgets**: New free-form period type with custom start/end dates.
*   **📊 Custom Period**: Date range picker in the Synthesis view.
*   **🔧 Maintenance**: Automatic type-mismatch correction tool.
*   **🐛 Fixes**: Backend crash fixes, Windows permission issues, general stability.

---

## 🆕 Recent Updates (v1.0.30)

*   **✨ Year-End Wizard**: A full spreadsheet-like assistant to review, adjust, and mass-generate recurring transactions for the next year (with reference year selection, value resets, and inline category/recurrence creation).
*   **🔄 Collapsible Recurrence Table**: Complete redesign of the main recurrences page into an interactive table, where each template can be expanded to modify and propagate individual occurrences for the year inline.
*   **🌍 Multi-language Support (EN/FR)** : Complete English and French localization for the year-end wizard and the main recurrences table.
*   **🏢 Organisation Mode & Enhancements**: Password-free multi-user mode for nonprofits/work councils, shared database support, and NSIS installer for system-wide Windows installation.

---

1. `python -m venv venv`
2. `.\venv\Scripts\activate`
3. `pip install -r requirements.txt`
4. `uvicorn app.main:app --host 127.0.0.1 --port 8434 --reload`

---

## 📝 License
© 2026 Amify Studio — All rights reserved.
