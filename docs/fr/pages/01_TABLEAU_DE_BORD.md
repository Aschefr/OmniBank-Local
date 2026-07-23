# 📊 Documentation Page : Tableau de Bord (Dashboard)

Le **Tableau de Bord** est l'écran d'accueil central d'OmniBank Local. Il offre un aperçu immédiat de la santé financière globale, des soldes des comptes, des dernières opérations et des raccourcis d'action rapide.

---

## 📸 Illustrations

![Tableau de Bord principal](../../../screenshots/02_dashboard.png)
*Vue générale du Tableau de bord avec soldes, graphiques et opérations récentes.*

![Saisie d'une opération](../../../screenshots/02_dashboard_saisie_operation.png)
*Modale de saisie rapide d'une nouvelle opération.*

---

## 🛠️ Composants & Fonctionnalités

### 1. Cartes de Synthese des Soldes
En haut de page, les cartes de solde affichent :
- **Solde Total Pointé (Réel)** : La somme des soldes validés sur vos relevés bancaires.
- **Solde Total En Cours (Prévu)** : Le solde incluant les opérations saisies mais pas encore pointées.
- **Variation du Mois** : Le total des entrées moins les sorties sur le mois en cours.

### 2. Graphique d'Évolution du Solde
Le graphique interactif (propulsé par **Chart.js**) trace la courbe du solde au fil des jours du mois sélectionné. Il permet de repérer visuellement les pics de dépenses ou les rentrées d'argent.

### 3. Liste des Dernières Opérations
Un aperçu des $N$ plus récentes transactions. Chaque ligne permet de :
- Consulter la date, le libellé, le tiers (payeur/bénéficiaire) et le montant.
- Voir la catégorie associée avec sa couleur.
- Basculer rapidement le statut de pointage/rapprochement dans la colonne dédiée.
- **Statut de Rapprochement** : Indiquer la date de rapprochement ou marquer l'opération comme pointée.

### 4. Saisie Rapide (+ Nouvelle Opération)
Le bouton **"+ Nouvelle Opération"** ouvre la modale de création :
- **Compte** : Sélection du compte concerné.
- **Type** : Dépense (Débit) ou Revenu (Crédit).
- **Montant** : Valeur exacte.
- **Date** : Date de la transaction.
- **Libellé & Tiers** : Description et nom du commerçant/organisme.
- **Catégorie** : Choix de la catégorie et sous-catégorie.
- **Statut de Pointage** : Coché ou non.

---

## 💡 Astuces & Bonnes Pratiques

> [!TIP]
> Utilisez la touche d'accès rapide sur le Tableau de Bord pour vérifier chaque matin si des opérations prévues ou récurrentes doivent être enregistrées.
