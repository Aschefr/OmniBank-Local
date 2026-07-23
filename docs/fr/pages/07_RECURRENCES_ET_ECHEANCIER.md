# 🔁 Documentation Page : Récurrences & Échéancier

La page **Récurrences** permet d'automatiser la gestion et le suivi visuel de vos opérations périodiques (abonnements, loyers, salaires, prélèvements d'électricité, assurances, virements récurrents) grâce à des modèles de récurrence (`RecurrenceTemplate`) et à deux modes d'affichage complémentaires : le **Mode Tableau** et le **Mode Chronogramme (Gantt)**.

---

## 📸 Illustrations

![Gestion des Récurrences](../../../screenshots/08_recurrences.png)
*Vue d'ensemble des récurrences avec cartes de KPI, filtres et sélecteur de mode d'affichage.*

![Modification d'une Récurrence](../../../screenshots/08_recurrences_modification.png)
*Modale d'édition des paramètres d'un modèle récurrent.*

![Propagation des Récurrences](../../../screenshots/08_recurrences_modification_propagé.png)
*Confirmation de mise à jour et régénération automatique des échéances.*

---

## 🛠️ Composants & Fonctionnalités

### 1. Indicateurs Globaux (KPIs Récurrents)
En haut de la vue, des cartes statistiques récapitulent la santé de vos engagements récurrents sur l'année sélectionnée :
- **Total Dépenses Fixes** (mensuel / annuel).
- **Total Revenus Récurrents**.
- **Solde Net Récurrent** : $$\text{Revenus Récurrents} - \text{Dépenses Fixes}$$

### 2. Les Deux Vues d'Affichage (Tableau vs Chronogramme)

OmniBank propose deux modes d'affichage commutables via les boutons en haut à droite :

#### 📋 Mode Tableau (`viewModeTable`)
- Présente la liste complète des modèles récurrents avec leurs caractéristiques : Libellé, Compte(s), Catégorie, Fréquence, Montant, Prochaine date d'échéance et Statut (`is_closed`).
- Permet l'édition, la suppression, la clôture ou la réouverture d'une récurrence.

#### 📅 Mode Chronogramme / Gantt (`viewModeTimeline`)
- Affiche une timeline graphique interactive de type **Gantt** représentant les 12 mois de l'année sélectionnée.
- Chaque récurrence dispose d'une ligne d'échéances découpée mois par mois avec un code couleur dynamique :
  - 🔵 **Segment Bleu (Prévisionnel)** : Échéance planifiée non encore rapprochée.
  - 🟢 **Segment Vert (Rapproché)** : Échéance constatée et pointée en banque.
  - ⚪ **Segment Hachuré (Ignoré)** : Échéance ignorée ou sautée (`is_skipped`).
- Un **clic direct sur un segment** ouvre un popover interactif permettant de pointer l'échéance ou de la sauter sans quitter le chronogramme.

### 3. Filtres Avancés & Recherche
- **Filtres de Durée** : Toutes, Durée illimitée, ou Durée limitée (avec date de fin).
- **Filtres de Fréquence** : Filtrez par périodicité (Mensuelle, Bimensuelle, Trimestrielle, Semestrielle, Annuelle).
- **Recherche par Mot-clé** : Filtrage en temps réel dans les libellés et descriptions.
- **Sélecteur d'Année (`< AAAA >`)** : Naviguez d'une année à l'autre pour examiner l'historique ou les prévisions futures.

### 4. Projection Automatique & Régénération Intelligente
- **Projection Automatique Glissante** : Les transactions prévisionnelles sont générées automatiquement en arrière-plan selon un nombre de mois d'avance configurable (`recurrence_generation_months`, par défaut 12 mois glissants). Aucune action manuelle de renouvellement n'est nécessaire.
- **Régénération Intelligente lors d'une Modification** : Lors de la modification d'un modèle (ex: augmentation du montant d'un loyer ou changement du jour de prélèvement), le backend (`app/routers/recurrences.py`) supprime et régénère automatiquement les échéances prévisionnelles **non rapprochées** sur l'horizon de projection, sans jamais altérer l'historique des transactions passées déjà rapprochées (`reconciliation_date != null`).
