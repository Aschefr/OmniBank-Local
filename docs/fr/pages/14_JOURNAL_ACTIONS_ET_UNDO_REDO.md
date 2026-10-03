# 🕓 Documentation Page : Journal d'Audit des Actions & Undo / Redo

Le **Journal d'Audit des Actions** (`static/js/views/history_manager.js`) et le moteur global d'**Annulation / Rétablissement (Undo / Redo)** assurent la traçabilité intégrale et la réversibilité absolue de toutes les opérations effectuées dans OmniBank Local.

---

## 🎯 1. Vision & Garantie de Réversibilité

OmniBank Local applique un principe de sécurité comptable totale :
- **Zéro action destructrice irréversible** : Toute création, modification, suppression ou pointage d'opération enregistre un instantané avant/après (snapshot JSON) dans la table SQLite `action_history`.
- **Droit à l'erreur sans stress** : Une opération supprimée par erreur, un montant mal saisi ou une mauvaise affectation de catégorie peut être immédiatement annulée en une fraction de seconde.

---

## ⌨️ 2. Undo / Redo Global (Raccourcis & En-Tête)

Dans l'en-tête supérieur de l'application, deux boutons d'action rapide permettent d'annuler ou de rétablir les dernières opérations :

- ↩️ **Bouton Annuler (`#headerUndoBtn`)** ou raccourci clavier **`Ctrl + Z`** (ou `Cmd + Z` sur macOS) :
  - Annule immédiatement la dernière modification effectuée dans l'application (suppression d'une transaction, changement de catégorie, modification de budget, etc.).
  - Restaure l'état antérieur exact de la base SQLite et met à jour l'interface en direct sans recharger la page.
- ↪️ **Bouton Rétablir (`#headerRedoBtn`)** ou raccourci clavier **`Ctrl + Y`** (ou `Ctrl + Shift + Z`) :
  - Réapplique l'action qui venait d'être annulée.
- **Notification Toast Interactive** : Un message de confirmation s'affiche au bas de l'écran avec un bouton rapide pour annuler l'action sur-le-champ.

---

## 🏛️ 3. La Vue Dédiée : Journal des Actions (`history`)

Accessible depuis le menu de navigation principal via le bouton **🕓 Actions**, cette vue propose un tableau chronologique complet de toutes les mutations enregistrées dans la base de données.

### A. Tableau Chronologique des Événements
Pour chaque ligne d'historique, le tableau indique :
- **Horodatage** : Date et heure précises de l'opération (à la seconde près).
- **Entité Concernée** : Type d'objet impacté (Transaction, Budget, Catégorie, Compte, Récurrence, Règle Auto-Pilote).
- **Type d'Action** :
  - 🟢 `CREATE` : Création d'une nouvelle entrée.
  - 🟡 `UPDATE` : Modification d'un ou plusieurs champs.
  - 🔴 `DELETE` : Suppression d'une entrée.
  - 🔵 `RECONCILE` : Pointage ou dépointage bancaire.
  - 🟣 `BATCH_ACTION` : Traitement par lot ou décision automatique.
- **Auteur (Mode Organisation)** : Identifiant ou nom de l'utilisateur ayant exécuté l'action (ex: *Trésorier*, *Président*).
- **Résumé Descriptif** : Intitulé clair de l'action (ex: *« Modification montant de 45.00 € à 50.00 € sur CARREFOUR »*).
- **Bouton d'Action** : Bouton individuel **"Annuler"** permettant d'annuler une action spécifique ciblée, même ancienne.

### B. Modale d'Inspection de Snapshot (Diff Avant / Après)
En cliquant sur une ligne du journal, une fenêtre d'inspection détaille le différentiel précis :
- **Anciennes valeurs (Rouge)** : État des champs avant l'intervention.
- **Nouvelles valeurs (Vert)** : État des champs après l'intervention.

---

## 👥 4. Mode Organisation & Traçabilité Multi-Utilisateurs

Dans le cadre d'un fonctionnement associatif ou de comité d'entreprise (Mode Organisation avec clé de licence) :
- Chaque action enregistre le profil utilisateur actif sélectionné dans le menu d'en-tête (`created_by`, `modified_by`).
- L'historique permet d'auditer avec précision qui a validé un virement, qui a modifié une enveloppe budgétaire ou qui a pointé un relevé bancaire officiel.
- Les données d'audit sont conservées localement dans la base SQLite `omnibank.db` et exportées lors des sauvegardes complètes.

---

## 🔍 5. Recherche & Filtres Avancés

La barre d'outils supérieure du Journal d'Audit permet de filtrer rapidement les événements :
- **Filtre par Entité** : Isoler uniquement les modifications sur les transactions ou sur les budgets.
- **Filtre par Type d'Action** : Afficher uniquement les suppressions (`DELETE`) pour récupérer un élément effacé.
- **Filtre par Période** : Aujourd'hui, 7 derniers jours, 30 derniers jours, ou plage personnalisée.
- **Recherche Textuelle** : Recherche par mot-clé sur les libellés ou les montants.

---

## 💡 Astuces & Bonnes Pratiques

> [!TIP]
> Si vous supprimez par inadvertance une catégorie parente contenant plusieurs sous-catégories, appuyez immédiatement sur **Ctrl + Z** : l'arborescence complète et les liaisons associées seront restaurées instantanément.

> [!NOTE]
> Le journal d'audit est optimisé pour les bases volumineuses : les snapshots JSON sont compressés et indexés pour garantir des temps de réponse sous les 10 millisecondes lors du parcours de dizaines de milliers d'actions.
