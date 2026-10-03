# 🤖 Documentation Page : Auto-Pilote & Centre de Contrôle

L'**Auto-Pilote** est le moteur d'automatisation financière autonome et souverain d'OmniBank Local. Il permet à l'utilisateur de passer du rôle de gestionnaire de saisie manuelle à celui de décideur avisé : l'application catégorise, rapproche, ajuste les budgets et détecte les récurrences de manière transparente et sécurisée, sans aucun recours au cloud.

---

## 🎯 1. Vision & Principes Fondamentaux

L'Auto-Pilote repose sur quatre piliers :

1. **Souveraineté Totale (Zero Cloud)** : Tous les algorithmes de décision (règles de normalisation marchands, modèles statistiques EMA et inférence locale Ollama) tournent exclusivement sur votre ordinateur.
2. **Paradigme Post-Action (Zéro Modale Bloquante)** : Les décisions à haute confiance sont appliquées immédiatement pour maintenir les soldes et le *Reste à Vivre* à jour en continu.
3. **Réversibilité Totale (1-Click Rollback)** : Chaque action prise par l'Auto-Pilote est consignée dans un journal d'audit (`autopilot_decision_logs`) et peut être annulée instantanément.
4. **Gradualité du Contrôle** : L'utilisateur choisit entre le **Mode Veille** (suggestions uniquement) et le **Mode Actif** (autonomie contrôlée sous plafonds de sécurité).

---

## 🧭 2. Les Modes de Fonctionnement

| Mode | Comportement | Cas d'Usage Idéal |
| :--- | :--- | :--- |
| **⏸️ Mode Veille (Suggestions)** | L'Auto-Pilote analyse les flux, calcule les scores de confiance et prépare les décisions dans la file d'attente sans rien modifier en base. | Phase de découverte, vérification préalable des règles marchands. |
| **🚀 Mode Actif (Autonome)** | Les transactions à haute certitude (≥ 85%) sont automatiquement catégorisées et rapprochées. Les cas ambigus sont enregistrés avec le drapeau `needs_review`. | Utilisation quotidienne rapide et sans friction. |

---

## 🎛️ 3. Le Widget Cockpit (Tableau de Bord & Vue d'Ensemble)

Sur le **Tableau de Bord** et la **Vue d'ensemble**, un panneau escamotable **Cockpit Auto-Pilote** offre une visibilité synthétique immédiate :

- **Indicateur d'État** : Badge lumineux vert (Actif) ou gris (Veille).
- **Règles Actives** : Nombre de règles marchands et de correspondances apprises (`bank_label_mappings`).
- **File en Attente** : Indicateur numérique du nombre d'opérations nécessitant une revue.
- **Bouton "⚡ Exécuter l'Auto-Pilote"** : Déclenche manuellement un cycle d'analyse complet sur l'ensemble des comptes.
- **Raccourci "Ouvrir le Centre de Contrôle"** : Bascule directement vers la page complète de gestion de l'Auto-Pilote.

---

## 🏛️ 4. Vue Dédiée : Centre de Contrôle (`autopilot`)

Accessible depuis la barre de navigation principale via le bouton **🤖 Auto-Pilote**, le Centre de Contrôle regroupe tous les outils d'arbitrage et d'audit :

### 📊 A. Cartes KPI Supérieures
1. **Taux d'Automatisation** : Pourcentage des opérations traitées sans intervention manuelle.
2. **Décisions Totales** : Nombre de décisions prises depuis l'activation de l'Auto-Pilote.
3. **File de Révision** : Nombre de transactions marquées `needs_review = True`.
4. **Optimisations Budgétaires** : Recalibrages et propositions d'économies générées par le moteur statistique.

### 📜 B. Flux de Décisions (Decision Feed)
Le flux chronologique détaille chaque intervention autonome :
- **Nature de la décision** : Catégorisation automatique, rapprochement d'opération, détection d'une nouvelle récurrence, suggestion de recalibrage d'enveloppe budgétaire, ou auto-clôture.
- **Confiance & Justification** : Score d'affinité algorithmique (ex: *96% - Règle marchande "CARREFOUR MARKET"*).
- **Snapshot avant/après** : Valeurs initiales et nouvelles valeurs appliquées.
- **Bouton "Annuler" (1-Click Rollback)** : Rétablit instantanément l'état antérieur de la transaction ou du budget sans perturber le reste de la base.

### 📥 C. File de Revue Post-Action (Review Queue)
Présente les opérations pour lesquelles l'Auto-Pilote a un doute raisonnable (score de confiance compris entre 60% et 84%, ou montant supérieur aux seuils usuels) :
- **Validation en 1 clic** : Confirme la proposition de l'Auto-Pilote.
- **Réaffectation rapide** : Permet de choisir une autre catégorie.
- **Création de règle automatique** : Mémorise le libellé pour les imports futurs.

### ⚙️ D. Paramètres & Disjoncteurs de Sécurité
- **Plafond Montant Maximum par Action Autonome** : Toute opération excédant ce montant (ex: 500 €) est obligatoirement soumise à la File de Revue.
- **Seuil de Confiance de Rapprochement** : Fixé par défaut à 85% pour éviter tout faux positif bancaire.
- **Recalibrage Budgétaire EMA** : Lissage exponentiel sur 3 à 6 mois pour éviter qu'un mois exceptionnel (vacances, réparations) ne fausse durablement les plafonds budgétaires.

---

## 💡 Astuces & Bonnes Pratiques

> [!TIP]
> Consultez la File de Revue une fois par semaine : valider ou réaffecter une opération enrichit immédiatement la table des règles (`bank_label_mappings`), rendant votre Auto-Pilote toujours plus précis au fil du temps.

> [!NOTE]
> En cas de fausse manipulation ou d'import erroné, le bouton global **Annuler (Ctrl+Z)** ou le bouton **Rollback** dans le Flux de Décisions rétablit l'état antérieur en une fraction de seconde.
