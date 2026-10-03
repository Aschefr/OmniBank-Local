# 🛠️ Architecture Technique & Outils

Ce document décrit l'architecture logicielle, le schéma de base de données SQLite, le système de traduction i18n et l'intégration de l'IA locale Ollama dans OmniBank Local.

---

## 🏗️ Architecture Globale

OmniBank Local s'appuie sur une architecture hybride **Desktop / Web local-first** ultra-performante et autonome :

```
+-----------------------------------------------------------------------+
|                         APPLICATION CLIENT                            |
|  Tauri 2.x (Rust Container) OR Navigateur Web (Chrome/Firefox/Edge)   |
|                                                                       |
|  Frontend Vanilla HTML5 / CSS3 / JS ES6 Modules                        |
|  - VirtualTable (Rendu haute vitesse pour grands volumes)             |
|  - Chart.js (Visualisation graphique interactive)                     |
+-----------------------------------------------------------------------+
                                  |
                           HTTP / SSE / REST
                                  v
+-----------------------------------------------------------------------+
|                      SERVEUR BACKEND (LOCAL)                          |
|  Python FastAPI + Uvicorn Async Server                                |
|                                                                       |
|  Routers & Services :                                                 |
|  - Finance Engine (Calculs de soldes & budgets)                       |
|  - Auto-Pilot Engine (Découverte d'enveloppes, recalibrage EMA)       |
|  - CSV Parser & Bank Sync Manager (Woob / Synchronisation locale)     |
|  - Backup & Auto-Backup Manager                                       |
|  - Budget AI & Chat Service (RAG Local & Function Calling)            |
+-----------------------------------------------------------------------+
           |                                             |
   SQLAlchemy ORM                                HTTP Local (Port 11434)
           v                                             v
+-----------------------+                     +-----------------------+
|  Base SQLite          |                     |  Instance OLLAMA      |
|  (omnibank.db)        |                     |  (LLM Local Off-line) |
+-----------------------+                     +-----------------------+
```

---

## 💾 Schéma de la Base de Données SQLite

La base de données SQLite `omnibank.db` s'appuie sur un schéma relationnel normalisé avec SQLAlchemy :

### Tables Principales :
1. `accounts` : Comptes bancaires (id, name, type ['Compte courant', 'Livret'...], initial_balance, is_closed, color).
2. `categories` : Catégories & sous-catégories (id, parent_id, name, type ['expense_fixed', 'expense_var', 'income', 'transfer'], icon, color).
3. `transactions` : Opérations financières (id, csv_id, date_saisie, date_operation, description, amount, type, category, reconciliation_date, from_account_id, to_account_id, recurrence_id, budget_id, created_by, modified_by).
4. `budgets` & `budget_categories` : Enveloppes budgétaires multi-catégories (id, name, monthly_amount, period, is_locked, is_closed, is_project, envelope_type, base_annual_amount).
5. `recurrence_templates` : Modèles de récurrence (id, description, amount, type, category, frequency ['Monthly', 'Yearly', 'Bi-Monthly'...], day_of_month, is_closed, max_occurrences).
6. `autopilot_decision_logs` : Registre horodaté des décisions et suggestions autonomes (création d'enveloppes, enrichissements, recalibrages, auto-saut, auto-clôture) avec snapshots JSON complets et statuts (SUGGESTED, AUTO_COMMIT, DISMISSED).
7. `history` (`action_history`) : Journal d'audit des actions utilisateur, snapshots différentiels (diffs avant/après) et traçabilité pour le moteur Undo/Redo.
8. `config` / `global_config` : Clés-valeurs de configuration (langue, thème, URL Ollama, options d'Auto-Pilote, seuils planchers).
9. `org_users` : Utilisateurs et droits d'accès en Mode Organisation (CSE / Association).
10. `bank_sync_connections` : Connexions bancaires Woob locales, chiffrement des accès (Fernet AES-256), horodatages et statuts de synchronisation.
11. `bank_label_mappings` : Table d'apprentissage et de normalisation marchands (libellés bruts vers catégories et tiers nettoyés).
12. `simulations` & `simulation_events` : Scénarios patrimoniaux prospectifs, événements temporels (ponctuels et récurrents), taux d'inflation et modulation de saisonnalité.

---

## ⚡ Réactivité de l'Interface (Architecture Événementielle Zero F5)

OmniBank Local applique une règle absolue de réactivité : **aucun rechargement de page (F5)** n'est requis lors de l'utilisation.
- **Bus d'Événements DOM (`CustomEvent`)** : Chaque mutation (ajout d'opération, pointage, modification de budget, déclenchement de l'Auto-Pilote ou Undo) émet des événements personnalisés (`omni-transaction-mutated`, `omni-budget-updated`, `omni-balance-changed`).
- **Composants Découplés** : Les vues actives écoutent ces événements pour rafraîchir chirurgicalement leurs tableaux (`VirtualTable`) et jauges sans perte de focus ni scintillement d'écran.
- **Restauration au Changement d'Onglet (`visibilitychange`)** : Si l'utilisateur revient sur l'application après une synchronisation en arrière-plan, les données sont immédiatement resynchronisées.

---

## 🤖 Intégration de l'IA Locale (Ollama RAG & Function Calling)

OmniBank Local intègre un assistant IA fonctionnant **100% hors-ligne** grâce à **Ollama** (`app/routers/chat.py` et `app/services/budget_ai_service.py`).

### 1. Architecture RAG (Retrieval-Augmented Generation) Local
Lorsqu'une question financière est posée au Chat IA (ex: *"Combien ai-je dépensé en restaurant ce mois-ci ?"*) :
1. Le backend extrait de SQLite les agrégats de dépenses anonymisés pertinents pour la période demandée.
2. Un contexte financier sécurisé est préparé et injecté dans le prompt système d'Ollama.
3. Le modèle LLM (**`gemma4:e4b`** recommandé, Mistral, Llama 3, Qwen) génère une réponse analytique sans qu'aucune donnée personnelle ne sorte de la machine.

### 2. Native Function Calling (Actions Autonomes)
L'assistant IA est capable d'exécuter des actions à la demande de l'utilisateur via la déclaration d'outils JSON (*Function Calling*) :
- `create_transaction` : Prépaire la création d'une dépense ou d'un virement.
- `set_budget` : Propose l'ajustement d'une enveloppe budgétaire.
- `analyze_trends` : Calcule les variations d'un mois sur l'autre.

---

## 🌐 System I18n (Internationalisation FR / EN)

- Les fichiers de traduction sont situés dans `data/i18n/fr.json` et `data/i18n/en.json`.
- **Règle d'Encodage Stricte** : Les fichiers JSON i18n doivent être encodés en **UTF-8 avec BOM (utf-8-sig)** pour garantir la compatibilité Python/Windows.
- Le module JS `static/js/i18n.js` charge la langue active et remplace dynamiquement les clés de traduction (`i18n.t('key')`) dans l'interface sans rechargement de page.
