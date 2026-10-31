# 📊 Documentation Page : Cockpit, Tableau de bord et Journal

OmniBank Local propose trois vues complémentaires pour suivre le cycle en cours (d'une paie à la suivante) :

| Vue | Rôle | Accès |
|---|---|---|
| **🎛️ Cockpit** | L'essentiel en un coup d'œil : reste à vivre, dépenses pointées, rythme de dépense. **Écran d'accueil** de l'application. | Menu principal, clic sur le logo, onglet mobile |
| **📊 Tableau de bord** | La version détaillée : soldes, moyennes, opérations à rapprocher, tendances. | Menu principal, onglet mobile |
| **📒 Journal** | La liste des opérations du cycle, pour saisir, rapprocher et filtrer. | Menu principal, menu « Plus » sur mobile |

Le Cockpit et le Tableau de bord sont toujours disponibles : ils ne se désactivent pas dans la Configuration.

---

## 📸 Illustrations

![Journal des opérations](../../../screenshots/02_dashboard.png)
*Le Journal : opérations du cycle, soldes et rapprochement.*

![Saisie d'une opération](../../../screenshots/02_dashboard_saisie_operation.png)
*Modale de saisie rapide d'une nouvelle opération.*

---

## 🎛️ 1. Le Cockpit

Vue simplifiée, pensée pour un contrôle quotidien rapide :
- **Reste à vivre** : jauge circulaire du pourcentage restant et montant restant sur le reste à vivre initial du cycle.
- **Dépenses pointées** : part des dépenses prévues déjà rapprochées, avec le reste à venir.
- **Rythme de dépense (€/jour)** : jauge à aiguille comparant votre dépense quotidienne à votre moyenne, avec un verdict (ex. « Dans les clous »).
- **Projection fin de cycle** : solde prévisionnel à la prochaine paie.
- **Auto-Pilote** et **À rapprocher** : état de l'Auto-Pilote, opérations à vérifier et nombre d'opérations en attente de rapprochement (un clic ouvre le Journal).
- **Cap sur le mois prochain** : recettes prévues, charges fixes, dépenses variables estimées et marge nette estimée, avec un lien vers le Simulateur.

## 📊 2. Le Tableau de bord

Vue complète des mêmes données, pour une analyse plus poussée :
- **Cartes de synthèse** : patrimoine net, reste à vivre, projection fin de cycle, prochaine paie.
- **Moyennes & rythme** : revenus, dépenses fixes, dépenses variables et solde net moyens, sur une période réglable (1 semaine à tout l'historique) et par mois, semaine, jour ou heure.
- **Opérations à rapprocher** : liste filtrable (passées, dépenses, recettes), rapprochement en un clic ou en lot pour les échéances passées.
- **Graphique de tendance** de l'évolution des soldes.

Dans l'en-tête du Cockpit comme du Tableau de bord : choix du compte affiché, état de l'Auto-Pilote et bouton **Nouvelle opération**.

## 📒 3. Le Journal

La liste des opérations du cycle en cours, l'outil de travail quotidien :
- **Colonnes** : date, libellé, catégorie, montant, rapprochement et actions ; d'autres colonnes (comptes, enveloppe, récurrence, pièces jointes…) s'activent via le bouton **Colonnes**.
- **Filtres** : recherche, période, type, catégorie et « Non-rapproché avant paie ».
- **Actions** : **Importer un relevé**, **Relever en ligne** (si une banque est connectée), **Automatismes** et **Nouvelle opération**. Sur mobile, les trois premières sont dans le menu **⋯**, les filtres derrière le bouton **Filtres** (avec le nombre de filtres actifs) et **Nouvelle opération** est le bouton rond **＋** en bas à droite. L'Historique suit le même principe.
- **Rapprochement** : bouton **Rapprocher** sur chaque opération ; les opérations rapprochées s'affichent en retrait avec leur date de rapprochement. Sur mobile, chaque opération tient sur deux lignes : un bouton rond **✓** rapproche, un appui sur la carte ouvre la modification (avec **Dupliquer**, **Ignorer** et **Supprimer**), le compte est indiqué par sa pastille de couleur et les icônes 🔁 📎 🗂️ signalent récurrence, pièce jointe et enveloppe.
- **Barre « Période »** : navigation entre les cycles (◀ 📅 ▶) et bouton **Clôturer le mois en cours**. Sur ordinateur, elle reste en bas de la liste ; sur mobile, elle s'affiche dans l'en-tête via le bouton **📅 Période**.

Pour consulter toutes les opérations, toutes périodes confondues, utilisez l'**Historique**.

## ➕ 4. Saisie rapide (Nouvelle opération)

Le bouton **Nouvelle opération** ouvre la modale de création :
- **Compte(s)** : « Depuis » et/ou « Vers » selon le sens (dépense, recette ou virement).
- **Montant** et **date**.
- **Libellé** et **catégorie**.
- **Statut de rapprochement** : coché ou non.

## 🤖 5. Widget Auto-Pilote

Le Cockpit et le Tableau de bord affichent l'état de l'Auto-Pilote :
- **Statut en direct** : actif ou en veille.
- **Opérations à vérifier** : nombre de décisions en attente de votre revue.
- **Accès rapide au Centre de contrôle** de l'Auto-Pilote.

## 🧭 6. Navigation et contrôles d'en-tête

- **Sur ordinateur** : menu horizontal en haut de l'écran.
- **Sur mobile** : barre d'onglets en bas de l'écran (Cockpit, Tableau de bord, Auto-Pilote, Chat IA s'il est activé, et **Plus** pour toutes les autres vues).
- **Annuler / Rétablir** : flèches ↩️ / ↪️ (ou `Ctrl+Z` / `Ctrl+Y`) pour annuler ou rétablir une action comptable.
- **Centre de notifications (🔔)** : alertes de budget, bilans IA et rappels d'échéances.
- **Sélecteur de profil** : bascule entre vos profils (ex. *Finances personnelles*, *Association*).
- **Mode discrétion (👁️)** : masque les montants (`••• €`) dans un lieu public.
- **Thèmes** : Classique sombre et clair, Titanium sombre et Albâtre clair.

---

## 💡 Astuces & Bonnes Pratiques

> [!TIP]
> Commencez la journée sur le Cockpit : le reste à vivre et le rythme de dépense vous disent en un coup d'œil où vous en êtes. Passez ensuite au Journal pour rapprocher les nouvelles opérations.
