# OmniBank Local 🏦

<p align="center">
  <a href="#-français">Français</a> • 
  <a href="#-english">English</a>
</p>
---

# 🇫🇷[![Version](https://img.shields.io/badge/version-1.0.99-blue.svg)](https://github.com/Aschefr/OmniBank-Local/releases)
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

## 🆕 Nouveautés (v1.0.99)

* **💡 Impact des Recettes Prévues sur les Indicateurs Clés** : Intégration d'indicateurs secondaires sur les cartes Hero et la barre latérale ("Reste à vivre" et "Risque de découvert") pour refléter en temps réel l'impact positif et rassurant des recettes prévues sur la période (ex : `+287,50 € prévus` et `Couvert (+287,50 €)`).
* **🔄 Cascade Intelligente & Résolution du Cold Start** : Moteur d'estimation des dépenses variables en 3 étages (historique réel filtré des anomalies IQR, repli sur les enveloppes budgétaires actives, et étalonnage prudentiel à 35% du salaire net pour les comptes récents) avec explication transparente de l'IA.
* **📈 Projections Multi-Cycles & Trésorerie Réaliste** : Projection automatique des salaires mensuels à venir sur 30, 60 et 90 jours dans l'outil prévisionnel de l'IA, éliminant tout faux déficit de trésorerie.
* **📊 Rendu Stylisé des Tableaux Markdown** : Affichage responsive, moderne et contrasté des tableaux générés par l'IA dans le Chat (fond sombre, en-têtes bleutés, padding généreux, chiffres tabulaires).
* **🛠 Nouveaux Outils RAG IA** : Intégration de l'auditeur d'intégrité comptable (`audit_transactions_integrity`) et du simulateur de projets financiers (`simulate_financial_scenario`).
* **🛡️ Sérialisation Robuste de l'API** : Assouplissement du schéma `TransactionBase` (`date_saisie` optionnelle) pour fiabiliser la consultation de l'Historique.

> 📖 Pour l'historique complet et détaillé de toutes les versions antérieures, consultez le **[CHANGELOG.md](CHANGELOG.md)**.

---

# 🇺🇸 English

[![Version](https://img.shields.io/badge/version-1.0.99-blue.svg)](https://github.com/Aschefr/OmniBank-Local/releases)
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

## 🆕 What's New (v1.0.99)

* **💡 Planned Receipts Impact on Key Indicators** : Integrated secondary indicators across Overview Hero cards and Sidebar summary cards ("Safe to Spend / Reste à vivre" and "Overdraft Risk") to display the beneficial impact of upcoming expected income within the current cycle (e.g. `+287.50 € expected` and `Covered (+287.50 €)`).
* **🔄 Intelligent Cascade & Cold Start Resolution**: 3-tier hierarchical spending rate estimation engine (observed history with IQR outlier filtering, fallback to active spending envelopes, and 35% net salary prudential baseline) with transparent AI source notes.
* **📈 Multi-Cycle Projections & Realistic Forecasting**: Automated multi-month paycheck projection over 30, 60, and 90 days in the AI Forecaster, eliminating artificial cash deficits.
* **📊 Rich Markdown Tables in AI Chat**: Custom modern styling for AI-generated tables (dark backdrop, subtle blue accent headers, tabular numerals, generous cell spacing, hover effects).
* **🛠 New AI Assistant RAG Tools**: Added accounting integrity audit tool (`audit_transactions_integrity`) and What-If project simulator (`simulate_financial_scenario`).
* **🛡️ Resilient API Serialization**: Made `date_saisie` optional in `TransactionBase` FastAPI schema to ensure faultless History table rendering on legacy or imported entries.

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
