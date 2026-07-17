# 🧪 OmniBank — Suite de Tests

> **28 tests automatisés** validant l'intégrité de l'application.

---

### 💳 Comptes & Transactions (CRUD)
- **test_accounts_crud** : Création, édition et suppression de comptes bancaires.
- **test_transactions_sign_logic** : Impact des dépenses (-), revenus (+) et transferts sur les soldes.
- **test_categories_cascade** : Renommer une catégorie met à jour toutes ses transactions associées.

### 🔄 Récurrences (Échéances)
- **test_recurrences_generation_and_deduplication** : Génération des échéances futures et déduplication stricte.
- **test_recurrence_category_modification_cascade** : Associer un template à une nouvelle catégorie modifie toutes ses échéances.
- **test_delete_recurrence_template_preserves_reconciled** : Supprimer un template garde ses transactions pointées historiques en base.
- **test_orphan_recurrences_cleanup_logic** : Nettoyage automatique des récurrences orphelines sans transactions associées.
- **test_obsolete_orphan_recurrences** : Archivage des récurrences inactives n'ayant plus d'échéances.
- **test_weekly_recurrence_and_strict_id_deduplication** : Répétition hebdomadaire et déduplication par ID unique d'échéance.
- **test_quarterly_and_semiannual_recurrences** : Calcul exact des échéances trimestrielles et semestrielles.
- **test_configurable_rolling_window_recurrences** : Génération limitée au nombre de mois configuré dans les paramètres.
- **test_auto_close_abandoned_templates** : Fermeture automatique des récurrences abandonnées depuis plus de 6 mois.
- **test_auto_close_zeroed_out_template** : Archivage d'un template si l'utilisateur met à jour son montant à 0 €.
- **test_dynamic_amount_generation** : Propagation et conservation des montants spécifiques d'échéances modifiées.
- **test_update_template_without_reconciled_transactions_does_not_disappear** : Modifier un template sans transactions rapprochées ne le supprime pas.

### 💰 Budgets & Enveloppes
- **test_budgets_envelopes** : Création d'enveloppes et calcul en temps réel des dépenses associées.
- **test_piggy_bank_overflow** : Bloque le versement d'une tirelire (savings) si le compte courant n'a pas les fonds.

### 🧠 Logique Financière & AI (Ollama)
- **test_payday_and_dashboard_forcing** : Détection du jour de paie et calcul des dépenses jusqu'au prochain salaire.
- **test_synthesis_drilldown_filters** : Filtres analytiques de la synthèse par compte et catégorie.
- **test_paycheck_override_reset_fallback** : Rétablissement de la date théorique de paie après suppression d'un forçage manuel.
- **test_paycheck_threshold_small_income** : Ignore les petits revenus pour la détection automatique du salaire principal.
- **test_chat_premium_flow** : Sessions de chat IA (Ollama), historique des messages et compression de contexte.
- **test_budgets_status_tool_returns_summary** : L'outil IA de budgets renvoie bien la synthèse consolidée du mois (budget global, dépenses pointées/engagées, solde restant).

### 🔑 Licence & Organisation
- **test_license_validation_flow** : Validation cryptographique des clés de licence locale.

### 🕓 Système d'Annulation (Undo/Redo)
- **test_global_undo_redo_system** : 
  - Annulation et rétablissement des écritures (Transactions, Comptes, Budgets, Catégories, Récurrences, Utilisateurs).
  - Validation de non-régression : retour strict au centime près des indicateurs financiers initiaux après annulation complète.
