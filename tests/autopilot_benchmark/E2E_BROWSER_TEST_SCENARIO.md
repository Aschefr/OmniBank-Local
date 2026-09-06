# Protocole de Test E2E Navigateur — Benchmark Auto-Pilote (Agent Browser)

Ce document fournit le **cahier de conduite pas à pas pour un Agent Browser** (ou un testeur humain en conditions réelles) chargé d'exécuter le test end-to-end de bout en bout sur l'interface graphique d'OmniBank Local.

---

> [!IMPORTANT]
> **Nature du Document : Cahier de Recette Cible (Spécification par l'Exemple / TDD)**
> Ce protocole formalise les **Critères d'Acceptation (Acceptance Criteria)** de la vision cible.
> **État initial : RED**. Si ce test est joué immédiatement, il échouera dès l'Étape 1 (l'interrupteur Auto-Pilote n'étant pas encore présent dans le wizard) et aux étapes d'auto-promotion non encore branchées.
> Chaque brique livrée (Étapes 1 à 6 de la feuille de route) permettra de franchir progressivement les étapes du scénario jusqu'à la réussite complète (**GREEN**).

---

## 1. Objectif du Test E2E

Valider visuellement et fonctionnellement la chaîne complète :
1. **Création d'un profil neuf** et franchissement du **Setup Wizard** d'accueil.
2. **Configuration et activation du mode Auto-Pilote**.
3. **Importation successive des 4 mois de relevés** (`mois_01` à `mois_04`).
4. **Observation en direct des réactions** :
   - Mise à jour instantanée des soldes au centime d'euro.
   - Nettoyage des libellés et catégorisation automatique (`SmartLabelService`).
   - Progression de détection des récurrences (Niveau 1 in-memory $\to$ Promotion Full-Auto $N=3$).
   - Gestion du paiement fractionné Alma en 3 fois (1/3 $\to$ 2/3 $\to$ 3/3 $\to$ extinction).
   - Rapprochement 1:1 sur modèles au Mois 4 sans doublon.
   - Isolation de la prime annuelle sur salaire (+750 €) et de l'étrenne (+100 €).
5. **Audit comparatif final** entre l'état réel de l'application et les prédictions établies.

---

## 2. Consigne Impérative d'Exécution : Règle d'Arrêt Immédiat (Fail-Fast)

> [!CAUTION]
> **ARRÊT IMMÉDIAT EN CAS D'ANOMALIE OU D'ÉCHEC D'ASSERTION**
> 
> En cas d'erreur (écart de solde même d'un centime, échec d'importation, erreur HTTP 4xx/5xx, non-création d'un template attendu, ou comportement inattendu de l'Auto-Pilote) :
> 1. **INTERDICTION FORMELLE DE POURSUIVRE LE TEST** : Ne jamais charger le fichier CSV du mois suivant sur un état applicatif corrompu ou divergent.
> 2. **CAPTURE D'ÉTAT** : Capturer immédiatement l'écran actuel (screenshot), relever le message d'erreur UI, inspecter la console JavaScript et les logs backend.
> 3. **RAPPORT D'INCIDENT IMMÉDIAT** : Rédiger sur-le-champ un rapport d'échec précis comprenant :
>    - Le mois exact et l'étape où le blocage est survenu.
>    - La valeur attendue vs la valeur réelle constatée (ex: *« Solde attendu 3 366,34 €, solde affiché 3 350,00 € »*).
>    - La cause technique probable (erreur de parsing, collision de règle, template non promu).
> 4. **INTERRUPTION DU CYCLE** : Stopper immédiatement l'exécution et attendre l'intervention ou la correction humaine.

---

## 3. Données & Prérequis

- **URL de l'application** : `http://localhost:8000`
- **Fichiers CSV à injecter** (dans l'ordre chronologique) :
  1. [`tests/autopilot_benchmark/mois_01_septembre_2026.csv`](file:///tests/autopilot_benchmark/mois_01_septembre_2026.csv)
  2. [`tests/autopilot_benchmark/mois_02_octobre_2026.csv`](file:///tests/autopilot_benchmark/mois_02_octobre_2026.csv)
  3. [`tests/autopilot_benchmark/mois_03_novembre_2026.csv`](file:///tests/autopilot_benchmark/mois_03_novembre_2026.csv)
  4. [`tests/autopilot_benchmark/mois_04_decembre_2026.csv`](file:///tests/autopilot_benchmark/mois_04_decembre_2026.csv)

---

## 4. Déroulement Chronologique pour l'Agent Browser

### Étape 0 : Préparation & Initialisation du Profil Vierge

1. Naviguer sur `http://localhost:8000`.
2. Ouvrir le sélecteur de profils dans le header (ou la modale des profils).
3. Créer un nouveau profil maître nommé : **`Test E2E Auto-Pilote`**.
   - Devise : `EUR (€)`
   - Couleur : Bleu / Indigo
   - Basculer sur ce profil immédiatement (`auto_activate = true`).
4. L'overlay du **Setup Wizard** (`#setupWizardOverlay`) apparaît automatiquement à l'écran.

---

### Étape 1 : Franchissement du Setup Wizard d'Accueil

* **Étape 1/7 (Bienvenue & Thème)** :
  - Langue : Sélectionner `Français` (`.wizard-lang-btn`).
  - Thème : Sélectionner le thème de votre choix (ex: `Titanium Dark` ou `Dark`).
  - Devise : `EUR (€)` par défaut.
  - Cliquer sur `Suivant →`.
* **Étape 2/7 (Sécurité du Profil)** :
  - Nom du profil : `Test E2E Auto-Pilote`.
  - PIN : Laisser vide (ou définir `0000` pour tester le déverrouillage).
  - Cliquer sur `Suivant →`.
* **Étape 3/7 (Création du Compte Bancaire Principal & Mode d'Entrée)** :
  - Mode d'entrée : Laisser sur `✍️ Saisie manuelle` (ou sélectionner `📥 Importer un relevé`).
  - Nom du compte : `Compte de dépôt N° 00012345678` (ou `Compte Courant`).
  - Type : `Compte courant`.
  - Solde initial au 31/08/2026 : **`1 500,00 €`**.
  - Cliquer sur `Ajouter ce compte` puis `Suivant →`.
* **Étape 4/7 (Cycle de Paie)** :
  - Jour de versement du salaire : `1` (ou `28`).
  - Salaire net habituel estimé : `2 400,00 €`.
  - Cliquer sur `Suivant →`.
* **Étape 5/7 (Guide des Opérations & Choix de l'Accueil)** :
  - Sélectionner la tuile : **`📊 Vue d'ensemble moderne (Bento)`** (ou `🏠 Journal des opérations classique`).
  - Prendre connaissance des flux et cliquer sur `J'ai compris →`.
* **Étape 6/7 (Intelligence Artificielle & Mode Auto-Pilote)** :
  - Vérifier la détection de l'assistant local Ollama.
  - **Activer l'interrupteur : `[X] Activer le mode Auto-Pilote (Full-Auto)`**.
  - Cliquer sur `Suivant →`.
* **Étape 7/7 (Confirmation)** :
  - Cliquer sur le bouton d'action : **`🚀 Lancer OmniBank`**.
  - Le wizard se ferme avec animation fondue et ouvre la vue principale.

---

### Étape 2 : Simulation Mois 1 — Septembre 2026 (Le Cold-Start)

1. **Action Browser** :
   - Ouvrir la modale d'importation de relevé (`#btnImportStatement` ou modale Cockpit/Sas).
   - Déposer / sélectionner le fichier : [`mois_01_septembre_2026.csv`](file:///tests/autopilot_benchmark/mois_01_septembre_2026.csv).
   - Cliquer sur `Analyser et Importer`.
2. **Observation & Assertions Visuelles** :
   - ✅ **Solde bancaire affiché** : **`2 604,52 €`** (en vert, conforme au relevé).
   - ✅ **Nombre d'opérations** : 12 transactions créditées/débitées.
   - ✅ **Libellés nettoyés** : `Foncia`, `EDF`, `Freebox`, `Spotify`, `Carrefour`, etc.
   - ✅ **Échelonnement Alma** : Le débit de 80,00 € affiche la mention `1/3`.
   - ✅ **Page Récurrences (`#view-recurrences`)** : Aucun modèle de récurrence officiel créé en base ($N=1$).
   - ✅ **Centre de Contrôle Auto-Pilote (`#view-autopilot`)** : Journalise le cycle d'ingestion de septembre avec 100% de succès.

---

### Étape 3 : Simulation Mois 2 — Octobre 2026 (Détection Niveau 1 In-Memory)

1. **Action Browser** :
   - Ouvrir la modale d'importation.
   - Déposer / sélectionner le fichier : [`mois_02_octobre_2026.csv`](file:///tests/autopilot_benchmark/mois_02_octobre_2026.csv).
   - Valider l'importation.
2. **Observation & Assertions Visuelles** :
   - ✅ **Nouveau solde bancaire** : **`3 366,34 €`** (Écart = 0,00 €).
   - ✅ **Charges candidates ($N=2$)** :
     - Les débits Loyer (750 €), EDF (65 €), Freebox (34,99 €) et Spotify (10,99 €) sont reconnus.
     - Le widget **Reste à Vivre** déduit prédictivement ces charges pour le mois suivant.
     - **En base** : Aucun `RecurrenceTemplate` officiel n'est encore gravé (stricte conformité seuil $N=3$).
   - ✅ **Alma 2/3** : L'échéancier passe à 2/3 honoré (160 € / 240 € réglés).
   - ✅ **Dépense Garage (-380 €)** : Catégorisée en Transports/Entretien, **exclue** de toute détection de récurrence.

---

### Étape 4 : Simulation Mois 3 — Novembre 2026 (Promotion Full-Auto & Fin Alma)

1. **Action Browser** :
   - Ouvrir la modale d'importation.
   - Déposer / sélectionner le fichier : [`mois_03_novembre_2026.csv`](file:///tests/autopilot_benchmark/mois_03_novembre_2026.csv).
   - Valider l'importation.
2. **Observation & Assertions Visuelles** :
   - ✅ **Nouveau solde bancaire** : **`4 540,16 €`** (Écart = 0,00 €).
   - ✅ **Bascule Récurrences Full-Auto** :
     - Naviguer sur l'onglet **`🔄 Récurrences`** : **Exactement 4 modèles créés automatiquement** (`FONCIA 750 €`, `EDF 65 €`, `FREEBOX 34,99 €`, `SPOTIFY 10,99 €`).
     - Le type est bien assigné à `Dépenses fixes`.
   - ✅ **Alma 3/3** : Le 3ème prélèvement (80 €) solde l'échelonnement (240 € au total). Statut affiché : **Terminé / Clôturé**.
   - ✅ **Remboursement CPAM (+64,50 €)** : Classé en Santé/Remboursement, aucun template de revenu créé.
   - ✅ **Centre de Contrôle Auto-Pilote (`#view-autopilot`)** :
     - Pastille dans le header : badge d'action récent.
     - Decision feed : Affiche *"4 récurrences officialisées automatiquement après 3 mois de régularité"*.
     - Boutons de rétroaction disponibles (`[ 🛑 Clôturer ]`, `[ ⚙️ Modifier ]`).

---

### Étape 5 : Simulation Mois 4 — Décembre 2026 (Pleine Vitesse & Bonus Annuel)

1. **Action Browser** :
   - Ouvrir la modale d'importation.
   - Déposer / sélectionner le fichier : [`mois_04_decembre_2026.csv`](file:///tests/autopilot_benchmark/mois_04_decembre_2026.csv).
   - Valider l'importation.
2. **Observation & Assertions Visuelles** :
   - ✅ **Solde final au 31/12/2026** : **`6 255,98 €`** (Rapprochement bancaire parfait au centime).
   - ✅ **Rapprochement Automatique sur Modèle** :
     - Les 4 débits (Loyer, EDF, Freebox, Spotify) sont **pointés directement sur les prévisions existantes**.
     - **Zéro doublon créé** dans la vue Opérations / Timeline.
   - ✅ **Contrôle Alma** :
     - Aucun prélèvement Alma le 10 décembre.
     - **Zéro fausse alerte de retard**, zéro prévision orpheline.
   - ✅ **Salaire & Prime** :
     - Virement ACME CORP de 3 150,00 € reconnu comme Salaire.
     - La prime de 750,00 € est isolée du salaire habituel de 2 400,00 €.
   - ✅ **Étrennes (+100 €)** : Enregistrées en recette exceptionnelle.

---

### Étape 6 : Bilan & Rapport de Validation E2E

À l'issue des 4 mois, l'Agent Browser effectue les vérifications globales suivantes :

| Composant UI | Valeur Attendue | Statut Contrôlé |
| :--- | :---: | :---: |
| **Solde Compte Courant** | `6 255,98 €` | [ ] CONFORME |
| **Templates Récurrences** | Exactement 4 (Loyer, EDF, Freebox, Spotify) | [ ] CONFORME |
| **Échelonnement Alma** | Soldé à 240 € (3 échéances), éteint en M4 | [ ] CONFORME |
| **Nombre de Catégories** | Invariant (pas de prolifération de micro-catégories) | [ ] CONFORME |
| **Centre de Contrôle** | Toutes les décisions consignées, réversibles et auditables | [ ] CONFORME |
| **Intégrité Base SQLite** | Zéro corruption, PRAGMA integrity_check = ok | [ ] CONFORME |
