# Journal des modifications (français)

Traduction française de [CHANGELOG.md](CHANGELOG.md). La version anglaise fait référence ; une version absente de ce fichier s'affiche en anglais dans l'application.

## [Unreleased]

### Ajouts & améliorations
- **Refonte mobile 📱** : barre d'onglets en bas, cartes d'opérations compactes sur deux lignes, formulaire de saisie plein écran (montant en premier, listes déroulantes, champs avancés repliés) et menu « ⋯ » pour les actions secondaires. Le Journal et l'Historique ont un en-tête compact avec un bouton Période et un « + » flottant pour créer une opération.
- **Navigation Cockpit & Journal 🎛️** : le Cockpit devient la page d'accueil et l'ancien Dashboard s'appelle « Journal ». Le « Tableau de bord » complet est retiré (les vues enregistrées et anciens liens ouvrent le Cockpit). Le Cockpit gagne une carte de patrimoine net, et Tendances affiche désormais les moyennes & rythme ainsi que les 6 principales dépenses.
- **Menu « Plus » de navigation ⋯** : la barre du haut ne défile plus latéralement sur les fenêtres étroites : les onglets qui ne tiennent pas passent dans un menu « Plus », et l'onglet actif reste toujours visible.
- **Vraie progression de « Relever en ligne » ⚡** : le remplissage du bouton suit l'avancement réel du relevé au lieu de s'arrêter à mi-chemin, et la pause de 2 secondes après la dernière banque a disparu.
- **Modes du simulateur 🔮** : « Conseillé » (réglages recommandés, identique au prévisionnel du Cockpit au centime près) et « Avancé » (tous les curseurs).
- **Code PIN de profil & sauvegardes 🔐** : le code PIN d'un profil est désormais imposé par le serveur (limitation des essais, code de récupération et commande `python -m app.reset_pin`). Les sauvegardes globales des profils protégés par PIN sont chiffrées. Le port Docker est lié à localhost par défaut.

### Corrections & ergonomie
- **Ancrage du prévisionnel du Cockpit 🎯** : les revenus du mois suivant reposent sur le salaire régulier et les revenus récurrents actifs ; les rentrées exceptionnelles ne gonflent plus la prévision. L'indicateur s'intitule « Marge nette estimée » avec le détail du calcul.
- **Suggestions de description sur Firefox Android ✍️** : le champ description propose désormais des suggestions (et préremplit la catégorie) sur Firefox pour Android.
- **Listes du formulaire d'opération 📋** : les listes de comptes et de catégories gardent leur sélection directe après un passage d'une fenêtre étroite à une fenêtre large, et la ligne sélectionnée reste lisible (texte blanc) quand la liste a le focus.
- **Cartes de validation de l'Auto-Pilote** : les boutons Valider / Éditer restent alignés à droite sur écran étroit.
- **Message du coffre** : l'indication « coffre déverrouillé » affiche le nombre de jours restants au lieu d'un texte brut.
- **Lisibilité & zones à toucher 👆** : les textes de l'Auto-Pilote et des badges ne descendent plus sous 12 px, les boutons de l'Auto-Pilote sont plus faciles à toucher sur téléphone, et la liste des Catégories sur mobile a des boutons modifier/fermer/supprimer plus grands (la colonne de statut redondante est masquée).
- **Tableaux de la Synthèse sans défilement 📊** : les tableaux de la Synthèse s'affichent en entier (pas de barre verticale, et pas de barre horizontale sauf si les colonnes se chevauchent), et l'export PDF dimensionne ses colonnes d'après les montants réels : plus rien n'est coupé, et les noms de catégories passent à la ligne au lieu d'être raccourcis.
- **Corrections de mise en page 🧱** : les noms de banque des cartes de connexion (Comptes) ne s'affichent plus lettre par lettre, les montants des tableaux de la Synthèse ne sont plus coupés par « … », et les noms des types de catégories s'affichent dans la langue de l'interface.
- **Finitions mobile** : les boutons de suggestion de budget ne se chevauchent plus, la bannière de démo ne masque plus le contenu et les notifications s'affichent au-dessus de la barre d'onglets.
