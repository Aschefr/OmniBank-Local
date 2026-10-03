# ⚙️ Analyse Approfondie des Pipelines & Mécanismes Techniques

Ce document analyse en profondeur le code source, le fonctionnement interne et les pipelines de traitement d'OmniBank Local, depuis l'initialisation du premier lancement jusqu'à l'export/restauration de la base de données.

---

## 🔁 Pipeline 1 : Premier Lancement & Seed de la Base SQL

### 1. Détection de l'état d'initialisation
Au démarrage du serveur FastAPI (`app/main.py`), la fonction d'initialisation vérifie si la base de données SQLite existe et si des comptes bancaires sont configurés :
- Fichier SQLite : `omnibank.db` (géré par SQLAlchemy via `app/database.py`).
- Si aucun compte n'est détecté dans la table `accounts`, l'API renvoie le statut `setup_required = True`.
- Le frontend Vanilla JS (`static/js/app.js`) intercepte ce statut et affiche l'écran plein de l'**Assistant d'Initialisation** (`static/js/views/setup_wizard.js`).

### 2. Le Seed des données par défaut (`app/init_data.py`)
Lors de la validation du Setup Wizard :
1. **Création du Compte Initial** : L'API exécute `POST /api/setup/initialize` pour créer le premier compte.
2. **Injection des Catégories** : La fonction `seed_initial_categories(db)` dans `app/init_data.py` insère l'arborescence par défaut des catégories de revenus et de dépenses (Alimentation, Logement, Transports, Loisirs, Santé, Salaire, etc.) avec leurs icônes et couleurs adaptées.
3. **Configuration de base** : La table `config` est initialisée avec la langue par défaut (`fr`), le thème (`dark` ou `light`) et les paramètres Ollama.

---

## 📥 Pipeline 2 : Parsing, Catégorisation & Déduplication CSV

Le pipeline d'importation CSV (`app/routers/csv_parser.py`, `app/services/csv_service.py` et `static/js/views/import_wizard.js`) se déroule en 4 phases :

```mermaid
flowchart TD
    A[Fichier CSV Téléchargé] --> B[Détection Encodage & Séparateur]
    B --> C[Parsing Pandas & Alignment Colonnes]
    C --> D[Détection des Doublons sur Empreinte SHA256 / Chiffres]
    D --> E[Catégorisation Automatique par Règles Mots-Clés]
    E --> F[Validation Utilisateur & Insertion SQL Transaction]
```

### Phase A : Détection Automatique de Format
- **Encodage** : Analyse d'échantillon pour distinguer `UTF-8`, `UTF-8-SIG`, `ISO-8859-1` / `Windows-1252`.
- **Délimiteur** : Comptage statistique des apparitions de (`;`, `,`, `\t`) sur les 10 premières lignes.
- **Format des Nombres** : Gestion automatique de la virgule décimale européenne (`1234,56`) et du point anglo-saxon (`1234.56`).

### Phase B : Détection des Doublons (Dédoublonnage)
Afin d'éviter toute double comptabilisation lors d'imports successifs contenant des périodes chevauchantes :
- Pour chaque ligne CSV, l'algorithme génère un identifiant unique (empreinte) basé sur : `Compte_ID + Date + Montant + Libellé nettoyé`.
- L'API recherche si une transaction avec ces caractéristiques exactes existe déjà dans la base SQLite. Si oui, elle est marquée comme **"Doublon probable"** dans l'assistant et désélectionnée par défaut.

### Phase C : Catégorisation Automatique
- Le service `csv_service.py` compare les mots-clés du libellé de l'opération avec les règles d'affectation mémorisées (ex: `"CARREFOUR"` ➔ *Alimentation*, `"TOTAL"` ➔ *Carburant*).

---

## 💳 Pipeline 3 : Moteur Financier & Rapprochement Bancaire

Le moteur financier (`app/services/finance_engine.py`) assure le calcul instantané et sans erreur des soldes et des projections.

### 1. Distinction Solde Pointé vs Solde Réel
Toute transaction `Transaction` possède une date de rapprochement `reconciliation_date` (null si non rapprochée) :
- **Solde Pointé (Réel)** : $$\text{Solde Initial} + \sum \text{Transactions Rapprochées (reconciliation\_date} \neq \text{null)}$$
- **Solde En Cours (Prévu)** : $$\text{Solde Pointé} + \sum \text{Transactions Non Rapprochées (reconciliation\_date} = \text{null)}$$

### 2. Procédure de Rapprochement (Pointage)
Depuis la vue Historique ou Tableau de Bord (`static/js/views/all_operations.js`) :
1. L'utilisateur bascule le statut de l'opération dans la colonne Rapprochement (ou édite sa date de rapprochement) à la réception de son relevé bancaire officiel.
2. Le frontend émet une requête optimisée `PATCH /api/transactions/{id}` enregistrant ou supprimant la `reconciliation_date`.
3. Le tableau de bord et l'historique recalculent dynamiquement le solde pointé et ajustent la différence avec le solde en cours.

---

## 💾 Pipeline 4 : Sauvegardes, Restauration & Exportation DB

OmniBank Local garantit que l'utilisateur est le seul propriétaire de ses données.

### 1. Sauvegarde Automatique (`app/routers/auto_backup.py`)
- À chaque modification majeure ou de manière planifiée, un instantané léger est créé dans le sous-dossier `backups/`.
- Les sauvegardes automatiques d'arrière-plan englobent automatiquement **l'ensemble de vos profils maîtres** dans une archive unifiée (`omnibank_all_profiles_backup_*.db`), garantissant une protection globale et sans omission de toutes vos données financières multi-utilisateurs (Mode Organisation et multi-profils).
- Le système conserve un roulement configurable des $N$ dernières sauvegardes automatiques (3, 5, 10 ou 20) pour prévenir toute corruption accidentelle.

### 2. Exportation Manuelle au format ZIP (`app/routers/backup.py`)
Lorsque l'utilisateur clique sur **"Exporter la sauvegarde"** depuis les paramètres :
1. Le backend FastAPI verrouille temporairement les écritures SQLite en mode WAL (Write-Ahead Logging).
2. Il génère une archive ZIP contenant :
   - `omnibank.db` : La base de données SQLite complète (toutes tables, opérations, catégories, budgets).
   - `config.json` : Les préférences d'interface et de langue.
   - `metadata.json` : La date de l'export, la version de l'application et le checksum de vérification.
3. Le fichier ZIP est transmis en téléchargement direct au client (Browser ou Tauri wrapper).

### 3. Pipeline de Restauration
- L'utilisateur envoie son fichier `.zip` ou `.db` via `POST /api/backup/restore`.
- Le backend valide le schéma de la base de données.
- Si le fichier est valide, la base de données active est remplacée de manière atomique et les connexions SQLAlchemy sont réinitialisées sans nécessiter le redémarrage du serveur.

---

## 🤖 Pipeline 5 : Moteur Auto-Pilote & Normalisation Multi-Stage

Le pipeline de l'Auto-Pilote (`app/services/autopilot_orchestrator.py` et `app/services/autopilot_rules.py`) traite les flux de transactions de bout en bout sans blocage de l'interface :

```mermaid
flowchart TD
    A[Nouvelle Écriture / Relevé] --> B{Recherche Règles Marchands}
    B -- Trouvé (Score 100%) --> C[Application Catégorie & Tiers]
    B -- Non Trouvé --> D{Similarité Historique (Levenshtein/Jaro)}
    D -- Confiance >= 85% --> E[Catégorisation Déterministe]
    D -- 60% <= Confiance < 85% --> F[Auto-Commit avec needs_review=True]
    D -- Inconnu (<60%) --> G[Inférence Ollama Locale ou File de Revue]
    C & E --> H{Vérification Rapprochement}
    H -- Match Parfait --> I[Rapprochement Automatique Pointé]
    H -- Non Rapproché --> J[Solde & Reste à Vivre Actualisés]
    I & J --> K[Enregistrement Journal autopilot_decision_logs]
```

1. **Normalisation & Dépoussiérage Marchand** : Extraction du nom propre du commerçant (ex: suppression des codes cartes `CB*`, `CARTE 1234`, codes postaux ou références techniques).
2. **Filtrage EMA des Budgets** : Le moteur statistique calcule une moyenne mobile exponentielle sur les 3 à 6 derniers mois pour suggérer des ajustements d'enveloppes lissés et fiables.
3. **Détection Proactive des Récurrences** : Identification automatique des montants et périodicités fixes (ex: même montant prélevé à intervalle mensuel régulier) avec proposition de conversion en modèle de récurrence.

---

## 🏦 Pipeline 6 : Synchronisation Bancaire Directe (Woob & Coffre-Fort)

La synchronisation directe (`app/services/woob_service.py` et `app/services/bank_sync_service.py`) assure le relevé sécurisé sans passer par le cloud :

1. **Déchiffrement Volatile en RAM** : Le mot de passe maître de l'utilisateur dérive la clé Fernet (PBKDF2) pour déchiffrer en mémoire vive les identifiants de la banque.
2. **Exécution du Module Woob** : Un sous-processus local isolé exécute le connecteur bancaire approprié et négocie la session avec le portail bancaire.
3. **Challenge d'Authentification Forte** : Si un OTP SMS ou une validation sur smartphone est requis, une communication bidirectionnelle SSE/WebSocket transmet l'état au frontend pour solliciter l'utilisateur.
4. **Passage par le Sas d'Intégrité ("Pending Sync")** :
   - Vérification de la continuité des soldes et filtrage strict des doublons via hash SHA-256.
   - Si les écarts dépassent les seuils de tolérance, le lot est mis en quarantaine pour validation manuelle.

---

## 🕓 Pipeline 7 : Traçabilité Complète & Pipeline d'Inversion (Undo / Redo)

Le moteur d'audit (`app/services/history_service.py` et `static/js/views/history_manager.js`) garantit la réversibilité absolue de chaque interaction :

1. **Capture Systématique Avant / Après** : Avant chaque opération `INSERT`, `UPDATE`, ou `DELETE` via SQLAlchemy, un événement d'écoute capture l'état complet de l'entité sous forme de dictionnaire JSON.
2. **Enregistrement dans `action_history`** : Un enregistrement immutable stocke : l'entité (`Transaction`, `Budget`, `Category`, `Account`), le type d'action, le snapshot avant, le snapshot après, l'utilisateur auteur, et l'horodatage.
3. **Pipeline d'Annulation (Rollback / Ctrl+Z)** :
   - L'API `POST /api/history/undo/{history_id}` charge le snapshot antérieur.
   - Elle réinjecte les valeurs exactes dans la base SQLite de manière transactionnelle atomique.
   - Les soldes bancaires et les totaux d'enveloppes sont immédiatement recalculés et réémis via des événements frontend pour une actualisation sans rafraîchissement d'écran (Zero F5).
