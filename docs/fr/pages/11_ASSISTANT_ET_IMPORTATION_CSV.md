# 📥 Documentation Page : Assistant Initial & Importation CSV / XLSX

Ce document détaille le fonctionnement complet des deux assistants interactifs d'OmniBank Local : l'**Assistant d'Initialisation (Setup Wizard)** présenté au premier lancement et l’**Assistant d'Importation & Rapprochement CSV/XLSX (Import Wizard)** pour intégrer vos relevés bancaires.

---

## 📸 Illustration

![Assistant d'Accueil](../../../screenshots/01_wizard_acceuil.png)
*Assistant de premier démarrage guidé.*

---

## 🧙‍♂️ 1. Assistant d'Initialisation (Setup Wizard)

Lors du premier lancement d'OmniBank Local (ou en cliquant sur *"Relancer l'assistant d'initialisation"* dans la configuration), le **Setup Wizard** accompagne la configuration pas à pas en 6 ou 7 étapes (`static/js/views/setup_wizard.js`) :

1. **👋 Étape 0 : Bienvenue & Langue**
   - Sélection de la langue de l'interface (Français FR ou Anglais EN).
   - Activation optionnelle du Mode Organisation (CSE / Association).
2. **🏦 Étape 1 : Création des Comptes Bancaires**
   - Définition de vos comptes de départ : Nom du compte, Type (*Courant*, *Épargne*, *Livret*, *Carte à débit différé*...), solde de référence initial et couleur d'affichage.
   - Sélection du compte principal.
3. **👥 Étape 2 (Mode Organisation) : Utilisateurs d'Association**
   - *(Uniquement si le Mode Organisation est activé)* : Création des profils d'utilisateurs (ex: *Président*, *Trésorier*) pour la traçabilité de l'historique d'audit.
4. **💰 Étape 3 : Configuration de la Paie / Revenu Principal**
   - Date habituelle de versement du salaire (ex: le 28 du mois), montant net moyen et option de versement bimensuel (deux paies par mois).
5. **📝 Étape 4 : Catégories Initiales**
   - Validation et injection de l'arbre complet des catégories par défaut (Alimentation, Logement, Transports, Loisirs, Santé, Salaires, etc.).
6. **🤖 Étape 5 : Assistant IA Ollama**
   - Détection de l'instance locale Ollama (`http://127.0.0.1:11434`), vérification du serveur et sélection du modèle IA initial (**`gemma4:e4b`** recommandé).
7. **🚀 Étape 6 : Finalisation**
   - Résumé des paramètres et démarrage vers le Tableau de Bord.

---

## 📥 2. Assistant d'Importation & Rapprochement (Import Wizard)

Accessible depuis le Tableau de Bord ou l'Historique via le bouton **"📥 Importer un relevé"**, cet assistant déroule un workflow complet d'analyse, d'auto-catégorisation et de vérification d'équilibre bancaire (`static/js/views/import_wizard.js`) :

### 📄 Étape 1 : Sélection du Fichier & Détection de Structure
- **Sélecteur de Compte Destinataire (`importAccountSelect`)** : Choisissez le compte bancaire sur lequel importer les données (ou *"Aucun compte"* pour un import libre).
- **Formats Acceptés** : Fichiers `.csv`, Excel (`.xlsx`) ou texte (`.txt`).
- **Détection Automatique d'Encodage & Séparateurs** : Le moteur backend analyse l'encodage (UTF-8, ISO-8859-1 / Windows-1252), les délimiteurs (virgule, point-virgule, tabulation), les dates (format français `JJ/MM/AAAA` ou ISO) et le séparateur décimal.
- **Sélecteur de Section (`importSectionSelect`)** : Si le fichier contient plusieurs tableaux ou en-têtes (ex: relevé mutuelle ou compte multi-sections), un menu déroulant permet d'isoler la section à importer.

### 📐 Étape 2 : Mapping des Colonnes (Alignement)
Si la structure du fichier n'est pas pré-configurée par les règles automatiques de votre banque, un sélecteur permet de lier les colonnes :
- **Colonne Date d'opération & Date de saisie**
- **Colonne Description / Libellé**
- **Colonne Montant** : Soit une colonne unique (signes +/-), soit deux colonnes distinctes Débit / Crédit (dans ce cas, les valeurs du débit sont automatiquement inversées en nombres négatifs).
- **Colonne Tiers / Payeur** (Optionnel).

### 🔍 Étape 3 : Grille d'Aperçu, Catégorisation & Options d'Action

Une grille interactive liste l'ensemble des lignes prêtes à l'import. Pour chaque ligne, l'utilisateur peut modifier en direct : Date, Libellé, Type (`Dépense fixe`, `Dépense variable`, `Revenus`, `Transfert`), Catégorie et état de sélection.

#### Options & Boutons d'Action Spécifiques :
- **Déduplication Automatique** : Les transactions existantes dans la base SQLite sont identifiées par leur empreinte unique (`date + montant + description`), surlignées en orange et décochées par défaut pour éviter les doublons.
- **Auto-complétion Historique** : La saisie d'un libellé propose l'auto-complétion basée sur vos opérations passées (`importDescList`) et applique automatiquement la catégorie associée.
- **Bouton "🤖 Analyser par l'IA" (`btnAnalyzeAI`)** : Soumet les libellés non encore catégorisés au modèle local Ollama (**`gemma4:e4b`**) pour tenter de leur affecter une catégorie adaptée (en privilégiant vos catégories déjà existantes).
- **Bouton "🏷️ Tout catégoriser par l'IA" (`btnCategorizeAllAI`)** : Re-soumet l'intégralité du tableau à l'IA pour tenter d'affecter une catégorie adaptée (en privilégiant les catégories déjà existantes).
- **Filtres d'Affichage** : Boutons de bascule pour afficher Toutes les lignes, uniquement les Débits/Dépenses, uniquement les Crédits/Revenus, ou Cacher les doublons.

### ⚖️ Étape 4 : Rapprochement de Relevé (Vérification d'Équilibre)
- **Zone "Vérification du Solde de Relevé" (`balanceVerificationBox`)** : Champ permettant de saisir le solde final figurant sur votre extrait bancaire officiel papier ou PDF.
- **Calcul de l'Écart de Rapprochement** : L'assistant calcule en temps réel le solde théorique de fin de période. Lorsque la sélection des lignes coche exactement les opérations de la période, l'**Écart de Rapprochement s'annule (0,00 €)** en vert, confirmant un équilibre parfait avec votre relevé bancaire.

### 💾 Étape 5 : Validation & Insertion SQL
- **Bouton "Enregistrer l'importation" (`btnSaveImport`)** : Valide l'importation. Les transactions cochées sont enregistrées de façon atomique dans SQLite `omnibank.db`, et les soldes du compte destinataire sont recalculés instantanément.
