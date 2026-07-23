# 🚀 Guide Rapide de Prise en Main - OmniBank Local

Ce guide vous accompagne pas à pas, de la première ouverture d'OmniBank Local jusqu'à l'export de sécurité de votre base de données, en passant par l'importation de vos opérations et le suivi de votre budget.

---

## 📸 Vue d'Ensemble du Parcours Utilisateur

![Assistant d'Accueil](../../screenshots/01_wizard_acceuil.png)

---

## 1. Premier Lancement & Assistant Initial (Setup Wizard)

Au tout premier démarrage de l'application, l'assistant d'accueil s'affiche automatiquement :

1. **Choix de la langue** : Sélectionnez le Français (FR) ou l'Anglais (EN).
2. **Création du premier compte bancaire** :
   - Indiquez le nom de votre compte (ex: *Compte Courant Principal*).
   - Choisissez le type de compte (*Courant*, *Épargne*, *Carte à débit différé*, etc.).
   - Entrez le solde initial de votre compte au jour de démarrage.
3. **Catégories par défaut** : OmniBank injecte automatiquement un arbre complet de catégories financières présélectionnées (Alimentation, Logement, Transports, Loisirs, Salaires, etc.).
4. **Configuration optionnelle de l'IA (Ollama)** :
   - Si Ollama est installé sur votre ordinateur (`http://localhost:11434`), OmniBank le détecte automatiquement et liste les modèles disponibles (ex: `gemma4:e4b` recommandé, `mistral`, `llama3`, `qwen`).

---

## 2. Ingestion des Données : Importation d'un Relevé CSV

Pour alimenter votre compte sans saisie manuelle fastidieuse :

1. Allez sur le **Tableau de Bord** ou dans l'**Historique**, puis cliquez sur le bouton **"📥 Importer un relevé"**.
2. **Sélection du fichier** : Glissez-déposez le fichier `.csv`, `.xlsx` ou `.txt` téléchargé depuis le site web de votre banque.
3. **Mapping des colonnes** :
   - L'assistant d'importation identifie automatiquement le délimiteur (virgule, point-virgule ou tabulation) et l'encodage (UTF-8, ISO-8859-1).
   - Associez si besoin les colonnes de votre fichier aux champs OmniBank (*Date*, *Libellé / Description*, *Montant*, *Tiers*).
4. **Prévisualisation, Catégorisation & Écart de Rapprochement** :
   - OmniBank compare les lignes importées avec vos transactions existantes pour surligner les doublons.
   - Vous pouvez déclencher l'IA locale (**`gemma4:e4b`**) via **"🤖 Analyser par l'IA"** pour tenter d'affecter une catégorie adaptée (en privilégiant vos catégories existantes).
   - Saisissez votre solde de fin de relevé bancaire : l'**Écart de Rapprochement s'annule (0,00 €)** en vert lorsque la sélection d'opérations correspond parfaitement.

---

## 3. Gestion Quotidienne & Rapprochement Bancaire

![Dashboard après Rapprochement](../../screenshots/02_dashboard_après_rapprochement.png)

1. **Saisie rapide d'opération** : Cliquez sur le bouton **"+ Nouvelle Opération"** pour ajouter un achat ou un virement direct.
2. **Rapprochement bancaire (Pointage)** :
   - Lorsque vous consultez votre relevé bancaire papier ou en ligne, basculez le statut de l'opération dans la colonne Rapprochement pour la marquer comme pointée/rapprochée.
   - Le solde de votre compte se sépare en **Solde Réel / Pointé** et **Solde Prévu / Non pointé**.

---

## 4. Gestion des Budgets Enveloppes & Assistant IA

![Budgets & IA](../../screenshots/05_budgets.png)

1. **Définir un budget** : Allez dans la section **Budgets**, créez une enveloppe mensuelle pour une catégorie (ex: *Alimentation : 400 €*).
2. **Suivi visuel** : Une barre de progression colorée vous indique la consommation en temps réel (Vert = Sous contrôle, Orange = Attention, Rouge = Dépassement).
3. **Suggestions par IA** : Cliquez sur **"Suggestions IA"** pour que le modèle local Ollama analyse l'historique de vos dépenses et propose un réajustement réaliste de vos enveloppes budgétaires.

---

## 5. Sauvegarde, Restauration & Exportation de la Base SQLite

Vos données sont 100% locales et stockées dans le fichier SQLite `omnibank.db`.

### Exportation Manuelle de Sauvegarde DB :
1. Allez dans les **Paramètres / Configuration** (icône engrenage ⚙️).
2. Naviguez vers la section **Sauvegarde & Restauration**.
3. Cliquez sur **"Télécharger Sauvegarde Complète (ZIP)"** ou **"Exporter les données (CSV)"**.
4. Enregistrez l'archive `.zip` contenant la base SQLite et la configuration dans le dossier sécurisé de votre choix (clé USB, disque externe, coffre-fort local).

### Restauration :
En cas de changement d'ordinateur, réinstallez OmniBank Local, allez dans **Configuration > Restauration**, sélectionnez votre fichier de sauvegarde et validez. L'ensemble de vos comptes, catégories, opérations et historiques sera réinstallé instantanément.
