# 📜 Documentation Page : Historique & Opérations

La page **Historique & Opérations** est l'outil principal de recherche, de filtrage, d'édition et de **rapprochement bancaire** de toutes vos transactions enregistrées dans OmniBank Local.

---

## 📸 Illustrations

![Historique des Opérations](../../../screenshots/03_historique.png)
*Vue complète du tableau de l'historique des opérations.*

![Avant Rapprochement](../../../screenshots/02_dashboard_avant_rapprochement.png)
*État des opérations avant le pointage bancaire.*

![Après Rapprochement](../../../screenshots/02_dashboard_après_rapprochement.png)
*État du tableau de bord et des soldes après pointage des opérations.*

---

## 🛠️ Composants & Fonctionnalités

### 1. Rendu Haute Performance avec `VirtualTable`
Grâce au composant `VirtualTable` (`static/js/virtual_table.js`), l'historique peut afficher des dizaines de milliers de transactions avec une fluidité parfaite (rendu virtuel uniquement des lignes visibles à l'écran).

### 2. Barre de Filtres Multicritères
- **Recherche Globale** : Filtrez instantanément par mot-clé (nom de commerçant, libellé, note).
- **Filtre par Compte** : Affichez la totalité des comptes ou un compte spécifique.
- **Filtre par Période** : Mois en cours, mois dernier, année complète ou plage de dates sur-mesure.
- **Filtre par Catégorie** : Filtrez par catégorie ou sous-catégorie.
- **Filtre par Statut** : Pointé uniquement, Non pointé uniquement, ou Tout.

### 3. Pointage & Rapprochement des Opérations
Le rapprochement (ou pointage) dans l'historique permet de marquer les transactions effectivement constatées sur votre relevé bancaire officiel afin de suivre précisément la différence entre votre solde réel (pointé) et votre solde engagé (en cours) :

1. Munissez-vous de votre relevé bancaire officiel.
2. Dans la colonne **Rapprochement** du tableau d'historique (ou via la modale d'édition / l'action par lot), basculez l'état de l'opération pour la marquer comme rapprochée.
3. L'opération enregistre sa date de rapprochement et passe au statut **Rapproché**, ce qui met à jour instantanément le **Solde Pointé (Réel)** du compte par rapport au **Solde En Cours (Prévu)**.

*(Note : Si vous utilisez l'assistant d'importation de relevé CSV/XLSX, un calcul d'écart de rapprochement spécifique est proposé dans l'assistant pour vérifier la concordance exacte du solde de relevé).*

### 4. Édition et Suppression d'Opérations
- **Édition rapide** : Cliquez sur n'importe quelle ligne pour ouvrir la fenêtre de modification.
- **Modification par lot** : Sélectionnez plusieurs opérations pour modifier leur catégorie ou leur statut en une seule action.
- **Suppression** : Bouton de suppression avec confirmation préalable.

---

## 💡 Astuces

> [!NOTE]
> Vous pouvez exporter à tout moment la vue filtrée au format CSV pour la partager ou l'analyser dans un tableur externe.
