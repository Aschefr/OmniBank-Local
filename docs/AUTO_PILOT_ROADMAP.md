# OmniBank-Local — Architecture & Feuille de Route : Mode Auto-Pilote

> **Vision Ultime** : Fonctionnement en autonomie totale (100% offline et local-first). L'utilisateur configure ses comptes, déverrouille son coffre-fort chiffré, et l'application s'occupe du reste : synchronisation bancaire, labellisation/catégorisation multi-stage, rapprochement comptable instantané et calibration stabilisée des enveloppes budgétaires. L'utilisateur passe du rôle de *gestionnaire de saisie* à celui de *décideur éclairé*, consultant ses statistiques et échangeant avec son assistant IA local.

---

## Sommaire

1. [Vision & Spécifications de l'Interrupteur "Auto-Pilote"](#1-vision--spécifications-de-linterrupteur-auto-pilote)
2. [Cartographie des Briques & État d'Avancement Réel](#2-cartographie-des-briques--état-davancement-réel)
   - [Brique 1 : Déverrouillage Coffre, Modes de Relevé (Immédiat / Passif) & Cycle de Vie](#brique-1--déverrouillage-coffre-modes-de-relevé-immédiat--passif--cycle-de-vie)
   - [Brique 2 : Pipeline de Catégorisation Multi-Stage & Enregistrement Auto](#brique-2--pipeline-de-catégorisation-multi-stage--enregistrement-auto)
   - [Brique 3 : Moteur de Rapprochement Automatique à Haute Certitude](#brique-3--moteur-de-rapprochement-automatique-à-haute-certitude)
   - [Brique 4 : Détection & Promotion des Récurrences (Anticipation Reste à Vivre)](#brique-4--détection--promotion-des-récurrences-anticipation-reste-à-vivre)
   - [Brique 4.5 : Cycle de Vie Dynamique & Maintenance Autonome des Récurrences (Brique Modulaire Découplée)](#brique-45--cycle-de-vie-dynamique--maintenance-autonome-des-récurrences-brique-modulaire-découplée)
   - [Brique 5 : Gestionnaire Dynamique d'Enveloppes (Analyse & Suggestion → Recalibrage Contrôlé)](#brique-5--gestionnaire-denveloppes-analyse--suggestion--recalibrage-contrôlé)
   - [Brique 6 : Sas d'Attente ("Pending Sync") & Matrice d'Arbitrage](#brique-6--sas-dattente-pending-sync--matrice-darbitrage)
   - [Brique 7 : Page Dédiée « Centre de Contrôle Auto-Pilote » (Vue Décisions, Réversibilité & Réorientation)](#brique-7--page-dédiée-centre-de-contrôle-auto-pilote-vue-décisions-réversibilité--réorientation)
3. [Pièges à Éviter & Points d'Attention Critiques](#3-pièges-à-éviter--points-dattention-critiques)
4. [Risques de Régression & Stratégies d'Étanchéité](#4-risques-de-régression--stratégies-détanchéité)
5. [Rappel des Règles Projets & Contraintes d'Ingénierie](#5-rappel-des-règles-projets--contraintes-dingénierie)
6. [Feuille de Route Incrémentale (Ordre de Réalisation)](#6-feuille-de-route-incrémentale-ordre-de-réalisation)
7. [Matrice de Validation & Cahier de Recette (Critères de Succès Pré-établis)](#7-matrice-de-validation--cahier-de-recette-critères-de-succès-pré-établis)

---

## 1. Vision & Spécifications de l'Interrupteur "Auto-Pilote"

Le mode **Auto-Pilote** n'est pas une boîte noire opaque ni une refonte complète du code, mais l'aboutissement d'une chaîne de briques modulaires déjà amorcées. Il dispose de son propre **Centre de Contrôle Dédié** (accessible via le menu de navigation `🤖 Auto-Pilote` ou par clic sur le badge d'état du header) et s'active via un interrupteur clair :

```
[ Mode Auto-Pilote : ACTIF ]
├── Sources d'Alimentation Détectées :
│    ├── Mode Hors Ligne (Fichier) : Ingestion automatique dès le glisser-déposer (CSV, XLSX, Relevé IA)
│    └── Mode En Ligne (Woob)      : Relevé planifié (12h/24h/48h) ou immédiat au déverrouillage du coffre en RAM
├── Pipeline d'ingestion : SmartLabelService (Règles -> Historique -> Inférence IA)
├── Ingestion comptable :
│    ├── Score certitude >= 85%  ──>  Rapprochement direct ou Enregistrement DB direct
│    └── Score certitude < 85%   ──>  Sas d'attente (Cockpit) pour arbitrage humain 1-clic
├── Budgets dynamiques : Analyse & suggestion mensuelle lissée (filtre EMA 3-6 mois, opt-in Full-Auto)
├── Restitution silencieuse : Badge discret dans l'en-tête, zéro blocage, consultation 100% facultative
└── Souveraineté & Contrôle : Page dédiée pour auditer les décisions, dépointer, réorienter ou annuler
```

### Cycles d'Intronisation Cold-Start (Parcours Hybride Fichiers / Ligne)

L'Auto-Pilote est **universel** : il s'applique avec la même intelligence comptable que l'utilisateur choisisse d'importer ses relevés à la main (100% hors-ligne) ou de connecter sa banque :

#### Parcours 1 : Mode Fichier Local (CSV / Excel / Relevé IA) — 100% Hors Ligne & Souverain
```
[ Wizard de Démarrage (7 Étapes) ]
 ├── Étape 1/7 à 4/7 : Thème, Sécurité (PIN), Compte bancaire principal, Cycle de paie
 ├── Étape 5/7 : Choix de la tuile "📥 Importer un relevé (CSV / Excel)"
 ├── Étape 6/7 : Détection IA Locale (Ollama) & Interrupteur Auto-Pilote (indépendant et autonome même sans IA)
 └── Étape 7/7 : Confirmation & Lancement
          │
          ▼
[ Utilisation Quotidienne : Dépose de Fichiers (Dropzone CSV / Excel / IA) ]
 ├── L'utilisateur glisse-dépose son relevé mensuel ou hebdomadaire
 ├── 🤖 L'Auto-Pilote prend le relais instantanément sur le lot :
 │    ├── Calcule un csv_id déterministe (hash SHA-256 date/montant/marchand) garantissant l'idempotence
 │    ├── Normalise les libellés commerciaux (SmartLabelService)
 │    ├── Rapproche automatiquement les correspondances parfaites (≥ 85%)
 │    ├── Enregistre les dépenses courantes directes en base sans friction
 │    └── Ne dépose dans le Sas d'attente (Cockpit) QUE les doutes ou opérations ambiguës
 └── Bilan comptable et solde actualisés au centime d'euro en un éclair !
```

#### Parcours 2 : Mode Synchronisation en Ligne (Woob) — Optionnel avec Coffre-fort
```
[ Wizard de Démarrage ]
 └── Étape 5/7 : Choix de la tuile "⚡ Synchroniser en ligne"
          │
          ▼
[ Page "Comptes & Livrets" (Post-Wizard) ]
 ├── L'utilisateur clique sur "Ajouter une connexion bancaire"
 ├── Choix de la banque (Woob) + Saisie des identifiants
 ├── Création du mot de passe maître du Coffre-fort (PBKDF2 / Fernet)
 ├── Validation du challenge 2FA bancaire (SMS/Application mobile)
 └── Association (mapping) des comptes distants aux comptes locaux OmniBank
          │
          ▼
[ Le "Sacrement" d'Activation Auto-Pilote (Si non activé dans le Wizard) ]
 └── Modale d'intronisation dès confirmation de la 1ère connexion bancaire :
     « 🎉 Votre banque est reliée avec succès !
        Souhaitez-vous activer le Mode Auto-Pilote dès maintenant ?
        Vos futures opérations seront relevées, catégorisées et
        rapprochées automatiquement (selon votre fréquence 12/24/48h ou au déverrouillage). »
        [ Interrupteur : OUI / NON ]
```

### Machine à États & Visibilité de l'Interrupteur Auto-Pilote

L'interrupteur respecte une machine à états stricte pour garantir clarté et contrôle absolu à l'utilisateur, **indépendamment de son mode d'alimentation (fichiers CSV/Excel ou banque connectée)** :

1. **État Grisé / Inactif (`DISABLED`)** :
   - *Condition* : Aucun compte bancaire créé dans l'application (base totalement vierge sans compte courant, livret ou compte d'épargne).
   - *Comportement UI* : Switch grisé non cliquable avec infobulle explicite : *"Créez ou importez au moins un compte bancaire pour débloquer le Mode Auto-Pilote"*.
2. **État Disponible / Découverte (`DISCOVERY_MILESTONE`)** :
   - *Condition* : Déclenché lors du premier import réussi d'un relevé (CSV/Excel) OU lors de la première connexion bancaire réussie (si l'interrupteur n'était pas déjà activé dans le Wizard).
   - *Comportement UI* : Modale d'intronisation proposant d'activer l'interrupteur :
     *« 🎉 Vos opérations sont importées avec succès ! Souhaitez-vous activer le Mode Auto-Pilote ? Vos futurs relevés (fichiers CSV/Excel ou synchronisation bancaire) seront automatiquement classés, rapprochés et réconciliés. »*
3. **État Engagé mais en Rodage (`ENABLED_LEARNING` — 🟡 Badge d'Apprentissage)** :
   - *Condition* : Auto-Pilote activé, mais en phase de Cold-Start (moins de 60 jours d'historique, ou socle de catégories encore incomplet).
   - *Comportement UI* : Switch vert allumé + badge d'accompagnement jaune : `[ Auto-Pilote : 🟡 En apprentissage ]`. Infobulle : *"Auto-Pilote actif (relevés importés ou synchronisés). En attente d'une première catégorie pour parfaire l'auto-classification. Les budgets s'initialiseront au premier cycle de paie."*
4. **État Vitesse de Croisière (`ENABLED_CRUISING` — 🟢 Badge Actif)** :
   - *Condition* : Comptes stabilisés, socle de catégories actif, récurrences identifiées.
   - *Comportement UI* : `[ Auto-Pilote : 🟢 Actif ]`. Les écritures et rapprochements à haute certitude ($\ge 85\%$) sont validés sans action manuelle dès l'injection du relevé. Le Sas d'attente ne retient que les exceptions réelles.
5. **État Veille Manuelle (`ENABLED = false`)** :
   - *Comportement* : L'application fonctionne en mode classique (100% des opérations bancaires, qu'elles proviennent d'un import de fichier ou d'un relevé en ligne, sont déposées dans le Sas d'attente / Cockpit pour validation manuelle ligne par ligne).

> [!IMPORTANT]
> **Garantie d'Étanchéité & Clé de Configuration (`auto_pilot_enabled`)** :
> Pour ne jamais forcer l'autonomie sur les profils souhaitant une gestion manuelle classique, la clé `auto_pilot_enabled` est introduite dès l'Étape 1 dans la table `GlobalConfig` (valeur par défaut : `"false"`). Tant que cet interrupteur n'est pas activé, 100% des opérations continuent d'atterrir dans le Sas d'attente (Cockpit) sans aucune altération de comportement par rapport à OmniBank v1.1.2.

### Rôle de l'IA Locale (Ollama) : Strictement Optionnelle

Conformément à la règle fondatrice du projet (*« L'app est 100% fonctionnelle sans Ollama »*), le mode Auto-Pilote s'adapte sans rupture :
* **Sans IA (Mode Déterministe Pur)** : Le système repose sur la normalisation Regex, les règles exactes `BankLabelMapping`, le fuzzy-matching sur l'historique et la détection mathématique des récurrences. Les marchands inconnus sont assignés *"À catégoriser"*, et l'apprentissage s'enrichit dès le 1er clic de l'utilisateur.
* **Avec IA (Mode Augmenté)** : Le LLM local intervient en secours pour inférer les catégories des nouveaux marchands inconnus et proposer des suggestions textuelles de gestion budgétaire.

---

## 2. Cartographie des Briques & État d'Avancement Réel

### Brique 1 : Déverrouillage Coffre, Modes de Relevé (Immédiat / Passif) & Cycle de Vie
*Permettre au logiciel d'exploiter la clé de déchiffrement en mémoire vive soit par synchronisation immédiate au déverrouillage, soit en mode passif silencieux confié au planificateur d'arrière-plan (12h/24h/48h).*

* **Fichiers concernés** :
  - [`app/services/credential_vault.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/credential_vault.py) (`CredentialVault`, `VaultSessionManager`)
  - [`app/services/bank_sync_scheduler.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/bank_sync_scheduler.py) (`bank_sync_scheduler_loop`, `trigger_manual_auto_sync`)
  - [`app/routers/bank_sync.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/bank_sync.py) (`/vault/unlock`)
* **État d'avancement actuel : 100% — ✅ LIVRÉ (v1.1.4 / Étape 1)**
  - ✅ Chiffrement Fernet + dérivation PBKDF2-HMAC-SHA256 (480 000 itérations).
  - ✅ Gestion de session en mémoire vive avec TTL (jours) scopée par profil (`VaultSessionManager`).
  - ✅ Boucle planifiée d'arrière-plan (`bank_sync_scheduler_loop`) vérifiant toutes les 60s si le mot de passe maître est présent en RAM.
  - ✅ **Interrupteur Maître & Clé de Configuration (`auto_pilot_enabled`)** : Clé technique interne initialisée à `"false"` dans `GlobalConfig` (SQLite v24) garantissant le mode manuel classique par défaut.
  - ✅ **Hook réactif et paramétrable `on_vault_unlocked`** : Paramètre utilisateur `sync_on_vault_unlock` (géré en base et dans les réglages/modale) permettant la bascule entre le Mode A (Relevé immédiat au déverrouillage, `< 200 ms`) et le Mode B (Déverrouillage passif silencieux en RAM sans requête réseau bancaire à T0).
  - ✅ **Prise en charge des deux cycles de vie** : Conteneur Docker 24/7 (maintien de session selon TTL) et Desktop Tauri (session en mémoire vive active).
  - ✅ **Régulateur de Fréquence Persistant (Cooldown Policy 3h)** : Clé `GlobalConfig.last_auto_sync_attempt` protégeant les serveurs bancaires lors d'ouvertures/fermetures répétées, avec maintien du forçage manuel immédiat (`force=True`).
  - ✅ **Isolation de Session SQLAlchemy & Concurrence Thread-Safe** : Sessions dédiées `SessionProf` au sein de chaque thread worker, et verrou d'exécution anti-collision `_ACTIVE_BACKGROUND_THREADS` avec vérification `t.is_alive()` éliminant les doubles relevés et doubles notifications.
  - ✅ **Horodatage ISO UTC & Affichage Heure Locale** : Suffixe standard `Z` sur les dates de notifications (`app/routers/notifications.py`) et helper de normalisation `_parseNotifDate` (`app.js`) garantissant une restitution fidèle au fuseau local de l'utilisateur.
  - ✅ **Rafraîchissement Réactif Global en Temps Réel** : Branchement de `BankSyncView.refreshActiveViews()` dès la fin du relevé en tâche de fond ou la réception de notification bancaire (actualisation immédiate de l'Overview, Dashboard/Timeline, Opérations, Comptes et soldes sans F5).
  - ✅ **Mode Catch-Up & Tri Chronologique Strict** : Tri croissant systématique `history_raw.sort(key=lambda x: x["tx_date_obj"])` et `coming_raw` éliminant l'antéchronologie Woob.
  - ✅ **Gestion asynchrone non-bloquante du 2FA** : Notifications in-app dédiées et attente sans thread bloqué.
  - ✅ **Traçabilité du Déclencheur (`trigger_source`)** : Marquage contextuel de l'origine de la synchronisation (`vault_unlock`, `scheduled`, `manual`) dans les logs et notifications bancaires, offrant une visibilité immédiate sur la cause de chaque relevé.
  - ✅ **Déduplication Intelligente des Notifications Bancaires** : Mise à jour in-place évitant l'empilement intempestif de notifications d'erreur successives pour un même compte bancaire.
  - ✅ **Suite de tests unitaires et d'intégration validée** : 100% de succès sur le Pack de Test 1 (T1.1 à T1.6 dans `tests/test_bank_sync_step1.py`).

> [!NOTE]
> **Périmètre Desktop (Tauri Rust) vs Backend (Brique 1)** :
> La Brique 1 traite exclusivement la logique d'authentification et de planification en Python (`CredentialVault`, `BankSyncScheduler`, `GlobalConfig`). Sur Desktop, l'application fonctionne selon le comportement standard actuel : tant que la fenêtre est ouverte, la session vit ; si la fenêtre est fermée, le processus s'arrête.
> L'interception de fermeture sécurisée (`CloseRequested`) et une éventuelle option de minimisation en barre des tâches (**System Tray**, fonctionnalité inexistante à ce jour dans l'application) sont des développements natifs Rust programmés à l'**Étape 6** (Finitions Desktop).

---

### Brique 2 : Pipeline de Catégorisation Multi-Stage & Enregistrement Auto
*Transformer un libellé bancaire brut illisible en une opération claire avec catégorie fiable sans intervention humaine.*

* **Fichiers concernés** :
  - [`app/services/smart_label_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/smart_label_service.py) (`normalize_raw_label`, `resolve_smart_labels_batch`, `_compute_match_score`)
  - [`app/routers/ai_helpers.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/ai_helpers.py) / [`app/routers/chat.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/chat.py)
* **État d'avancement actuel : 100% — ✅ LIVRÉ (Étape 3)**
  - ✅ Nettoyage regex haute précision (suppression dates, codes guichets, CB, PRLV, préfixes passerelles PayPal/Stripe/SumUp).
  - ✅ Étage 1 : Base de règles déterministes (`BankLabelMapping`).
  - ✅ Étage 2 : Fuzzy matching Levenshtein + Jaccard tokens signifiants sur l'historique réel.
  - ✅ Détection d'ambiguïté : Si plusieurs catégories concurrentes n'atteignent pas un consensus de $\ge 75\%$, le moteur refuse de deviner à l'aveugle.
  - ✅ Résolution par lot vectorisée ultra-rapide ($O(N)$).
  - ✅ **Sanctuarisation Manuelle des Règles (`is_manual = True`)** : Les règles configurées ou modifiées manuellement par l'utilisateur sont formellement protégées contre tout écrasement ou réécriture lors des imports ou détections ultérieurs.
  - ✅ **Apprentissage Progressif Fiabilisé ($N \ge 2$)** : La première observation d'un marchand ($N=1$) reste à l'état provisoire (`is_provisional = True`) sans figer prématurément de catégorie automatique. L'apprentissage ne se consolide qu'à partir de 2 détections concordantes.
  - ✅ **Prise en Charge Native des Marchands Caméléons / Multi-Catégories (`_MULTI_CATEGORY_MERCHANTS`)** : Amazon, PayPal, grandes surfaces et marketplaces ne sont plus figés sur une catégorie unique erronée ; ils conservent leur libellé commercial propre tout en laissant la catégorie libre à l'arbitrage humain (`is_multi_category = True`).
  - ✅ **Détection de Dispersion Catégorielle** : Si l'historique d'un commerçant est éclaté entre plusieurs catégories sans consensus net, le moteur neutralise l'affectation automatique pour éviter tout mauvais choix.
  - ✅ **Réversibilité Totale & Intégration `ActionHistory`** : Toute modification d'une règle (passage manuel/auto, changement de catégorie, activation multi-catégorie) est tracée dans l'historique d'annulation/rétablissement global avec toast d'annulation 1-clic (`undo_action` / `redo_action`).
  - ✅ **Badges de Transparence dans le Sas d'Attente (Cockpit de Revue)** : Affichage direct de badges d'explication de provenance (`🛡️ Règle manuelle`, `🤖 Règle apprise`, `⚠️ Provisoire (1ère fois)`, `🔀 Multi-catégories`, `🕒 Historique`) avec info-bulles détaillées guidant l'utilisateur sur la manière de modifier la règle si besoin.
  - ✅ **Modale d'Édition Ergonomique avec Recherche Permissive** : Modale dédiée d'édition de règle dans l'Atelier avec recherche instantanée insensible à la casse et aux accents (`removeAccents`), prévisualisation en direct et navigation clavier.
  - ✅ **Garde-fou Anti-Prolifération, Filet de Sécurité Déterministe & Revue Manuelle IA (Étape 3.5)** : Attribution d'une catégorie fourre-tout intelligente (`"Dépenses diverses"` / `"Revenus divers"`) pour 100% des opérations inconnues afin de garantir un Sas propre, proposition automatique IA dès la synchronisation manuelle et à l'ouverture de revue avec badges explicatifs (`🤖 Suggestion IA`, `✨ Nouvelle catégorie`, `🛡️ Fourre-tout`), quota maximal de 2 nouvelles catégories par lot d'import IA, fusion lexicale (≥ 80%) et création différée en base au moment du commit.
  - ✅ **Étage 3 : Fallback IA local Ollama Groupé par Lot (`call_ollama_batch`)** : Résolution des marchands inconnus en 1 seule requête JSON groupée (`format: "json"`) avec garde-fou anti-hallucination, validation linguistique anti-déchet et proposition contrôlée de nouvelles catégories.
  - ✅ **Banc d'Essai & Simulation Smart Label** : Atelier interactif de test de la cascade décisionnelle en direct avec sauvegarde 1-clic en règle permanente et plancher de fluidité UX.
  - ✅ **Auto-Commit des Nouvelles Écritures Courantes & Marchands Caméléons** : Enregistrement autonome des dépenses courantes directes non ambiguës dans [`app/services/autopilot_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/autopilot_service.py) avec traçabilité complète `AutopilotDecisionLog` (`new_entry`) lorsque `auto_pilot_enabled == True`, incluant les marchands caméléons par défaut.

---

### Brique 3 : Moteur de Rapprochement Automatique à Haute Certitude
*Associer automatiquement les opérations débitées/créditées avec les prévisions ou récurrences sans faux positif.*

* **Fichiers concernés** :
  - [`app/services/reconciliation_engine.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/reconciliation_engine.py) (`check_reconciliation` — extrait et découplé en Étape 0)
  - [`app/services/autopilot_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/autopilot_service.py) (Nouveau service d'orchestration unifié : `AutoPilotService`)
  - [`app/models.py`](file:///d:/Code%20Projects/OmniBank-Local/app/models.py) (Modèle de traçabilité : `AutopilotDecisionLog` — créé en Étape 0)
  - [`app/routers/csv_parser.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/csv_parser.py) (`csv_id` déterministe SHA-256)
  - [`app/services/bank_sync_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/bank_sync_service.py)

> [!NOTE]
> **Dette Technique Soldée — Refactoring `check_reconciliation` (Étape 0)** :
> La fonction `check_reconciliation` a été extraite avec succès depuis le routeur `csv_parser.py` vers son module dédié [`app/services/reconciliation_engine.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/reconciliation_engine.py) (Jalon 0.1), éliminant la dépendance inversée et préparant l'orchestration par `AutoPilotService`.

* **État d'avancement actuel : 100% — ✅ LIVRÉ (Étape 2)**
  - ✅ Score composite de matching (0 à 100 points) :
    - Empreinte bancaire unique (`csv_id`) : 100 pts.
    - Montant exact ($\pm 0.01$ €) : 40 pts.
    - Proximité temporelle asymétrique : 0 à 35 pts (privilégie les débits 1 à 3 jours après la date prévue).
    - Similarité textuelle : 0 à 25 pts.
  - ✅ Gestion des virements internes compte à compte (transferts miroirs).
  - ✅ Distinction nette entre opérations confirmées et opérations à venir (`is_coming`).
  - ✅ Empreinte idempotente des fichiers (`csv_id` déterministe SHA-256 + index intra-lot dans `csv_parser.py` — Jalon 0.3).
  - ✅ Modèle de traçabilité `AutopilotDecisionLog` dans `app/models.py`, schéma v24 SQLite et DTO Pydantic `AutopilotDecisionLogOut` (Jalons 0.4, 0.5, 0.6).
  - ✅ **Séparation Stricte : Évaluation Pure vs Mutation Orchestrée** : `check_reconciliation` (`reconciliation_engine.py`) reste une fonction pure d'évaluation sans mutation, tandis que `AutoPilotService.process_incoming_batch()` (`autopilot_service.py`) orchestre l'auto-commit DB, le journal de bord `AutopilotDecisionLog`, la traçabilité Undo/Redo `ActionHistory` et l'invalidation du cache de statistiques.
  - ✅ **Politique d'Auto-Validation (Auto-Commit Threshold)** :
    - **Zone Verte ($\ge 85$ pts ou `csv_id` identique sans collision)** : Rapprochement automatique instantané en base.
    - **Zone Orange ($60 \le \text{Score} < 85$ pts)** : Maintien dans le Sas d'attente (Cockpit) avec statut *"Rapprochement suggéré"*.
    - **Zone Rouge ($< 60$ pts)** : Traitée comme nouvelle opération distincte.
  - ✅ **Détection Anti-Collision sur Montants Homonymes** : Si plusieurs prévisions concordent au centime près, l'arbitrage textuel départage les candidats ; en l'absence de discriminant, `collision_detected = True` neutralise l'auto-commit et bascule l'opération dans le sas d'attente pour arbitrage humain.
  - ✅ **Suite de tests unitaires et d'intégration validée** : 100% de succès sur le Pack de Test 2 (T2.1 à T2.8 dans `tests/test_autopilot_step2.py`).

### Brique 4 : Détection & Promotion des Récurrences (Anticipation Reste à Vivre)
*Détecter automatiquement les opérations répétées pour affiner le Reste à Vivre sans polluer la base de données.*

* **Fichiers concernés** :
  - [`app/services/recurrence_detector.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/recurrence_detector.py) (Nouveau service : parsing fractionnés, détection périodique, promotions récurrences)
  - [`app/services/finance_engine.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/finance_engine.py) (`calculate_rest_to_live` déduit les charges candidates $N=2$, `get_anticipated_candidate_charges`)
  - [`app/routers/stats.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/stats.py) (Exposition de `anticipated_recurrences` dans `/api/stats/dashboard`)
  - [`app/routers/recurrences.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/recurrences.py) (`generate_recurrences` avec auto-clôture à `max_occurrences`)
  - [`app/services/autopilot_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/autopilot_service.py) (Déclenchement des promotions et cycle fractionné post-batch)
* **État d'avancement actuel : 100% — ✅ LIVRÉ (Étape 4)**
   1. ✅ **Algorithme de Détection Périodique (Pattern Matching)** :
      - Détection des débits récurrents : Même marchand nettoyé + Montant identique ($\pm 0,00$ €) + Intervalle de 28 à 31 jours ($\pm 2$ jours de battement calendaire). **Filtre strict sur les dépenses (`raw_amount < 0` ou `type == 'expense_var'`)** : Les remboursements de santé (ex: virement CPAM) ou recettes exceptionnelles ne sont jamais convertis en modèles de charges fixes.
      - **Enrichissement de `calculate_rest_to_live`** dans [`finance_engine.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/finance_engine.py) : déduction dynamique des charges candidates ($N \ge 2$) non encore débitées avant la prochaine paie.
      - **Optimisation de Performance via Cache** : Calcul mis en cache dans [`app/services/stats_cache.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/stats_cache.py) et invalidé lors des mutations de transactions ou templates.
   2. ✅ **Approche à Deux Niveaux & Règle Anti-Doublon Comptable** :
      - **Niveau 1 — Anticipation Reste à Vivre Déterministe Dynamique ($N=2$)** : Dès 2 occurrences consécutives détectées, l'échéance du mois suivant est intégrée dynamiquement comme charge prévisionnelle sans écriture prématurée en base.
      - **Garde-fou Anti-Doublon dans `calculate_rest_to_live`** : Une charge candidate n'est déduite que si aucun débit concordant n'a déjà été débité et comptabilisé depuis le début du cycle de paie en cours.
      - **Niveau 2 — Suggestion d'Officialisation (1-Clic)** : Exposition via `/api/stats/dashboard` (`anticipated_recurrences`).
   3. ✅ **Règle du Mode Full-Auto pour Charges Ordinaires (Abonnements / Loyers)** :
      - Promotion automatique en `RecurrenceTemplate` permanent actif (`is_closed = False`) dès le **3ème mois consécutif ($N \ge 3$)**.
      - Liaison rétroactive immédiate de l'ensemble des transactions de la chaîne passée (`t.recurrence_id = tpl.id`).
   4. ✅ **Détection des Paiements Fractionnés (Alma / Klarna / Oney) & Cycle de Clôture Déterministe** :
      - **Regex de Détection** : Identification des signatures d'échelonnement `r'\b(?:ALMA|KLARNA|ONEY|FLOA|COFIDIS).*?\b(\d+)\s*[/x\s]\s*(\d+)\b'` capturant l'échéance courante $M$ et le total $N$.
      - **Liaison Rétroactive Immédiate & Extinction Déterministe ($M = N$)** : Clôture formelle (`is_closed = True`) dès que la dernière échéance est honorée, avec purge des prévisions orphelines.
      - **Cohérence des Décomptes d'Assertions** : Exactement 4 templates actifs au Mois 3 du benchmark (Foncia, EDF, Freebox, Spotify), Alma étant clôturé.
      - **Garde-fou Anti-Promotion Infinie** : Exclusion des fractionnés de la promotion infinie.
   5. ✅ **Suite de Tests Dédiée Validée** : 100% de succès sur les 6 tests unitaires et d'intégration (`tests/test_autopilot_step4.py`).

---

### Brique 4.5 : Cycle de Vie Dynamique & Maintenance Autonome des Récurrences (Brique Modulaire Découplée)
*Gérer intelligemment la vie réelle des abonnements et charges régulières : variations ponctuelles (hors-forfaits), hausses de tarifs durables ($N=3$), auto-saut des échéances non débitées et auto-clôture des contrats résiliés.*

* **Fichiers concernés** :
  - [`app/services/reconciliation_engine.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/reconciliation_engine.py) (Passe 2.C : détection tolérante aux déviations de montants sur prévisions actives)
  - [`app/services/recurrence_detector.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/recurrence_detector.py) (Détection des hausses tarifaires pérennes à $N=3$, auto-clôture après 3 carences consécutives)
  - [`app/services/autopilot_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/autopilot_service.py) & [`app/services/bank_sync/sync_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/bank_sync/sync_service.py) (Auto-liaison ponctuelle et routine d'évaluation d'auto-saut `process_auto_skipping`)
  - [`app/routers/recurrences.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/recurrences.py) (Propagation sécurisée des hausses de template `propagate_recurrence`, désautage et rétablissement)
  - [`static/js/views/recurrence_manager.js`](file:///d:/Code%20Projects/OmniBank-Local/static/js/views/recurrence_manager.js) & [`static/js/views/recurrences_modals.js`](file:///d:/Code%20Projects/OmniBank-Local/static/js/views/recurrences_modals.js) (Modale `⚙️ Automatismes`, badges visuels, actions d'annulation 1-clic)
  - [`app/models.py`](file:///d:/Code%20Projects/OmniBank-Local/app/models.py) & [`app/migrations/versions/v26_transaction_comment.py`](file:///d:/Code%20Projects/OmniBank-Local/app/migrations/versions/v26_transaction_comment.py) (Colonne `comment` sur `Transaction`, schéma v26)
  - [`app/config.py`](file:///d:/Code%20Projects/OmniBank-Local/app/config.py), [`static/i18n/fr.json`](file:///d:/Code%20Projects/OmniBank-Local/static/i18n/fr.json) & [`static/i18n/en.json`](file:///d:/Code%20Projects/OmniBank-Local/static/i18n/en.json) (4 toggles `GlobalConfig` indépendants et 21 clés i18n bilingues)

* **État d'avancement actuel : 100% — ✅ LIVRÉ (Étape 4.5)**

* **Architecture des 4 Règles Métier Découplées** :
  1. **Cas A — Auto-Liaison Tolérante aux Déviations Ponctuelles (Hors-forfait / Frais variables)** :
     - *Problème résolu* : Une facture mobile prévue à 14,99 € arrive à 35,99 € (hors-forfait). Sans tolérance, l'opération atterrit dans le Sas comme nouvelle dépense, laissant la prévision de 14,99 € orpheline et faussant le solde prévisionnel.
     - *Comportement* : Dans `reconciliation_engine.py`, si aucun match exact n'est trouvé, une passe spécifique cherche une échéance récurrente active sur le même compte à date concordante ($\pm 4$ jours) avec similarité marchand Smart Label élevée ($\ge 85\%$).
     - *Garde-fou Anti-Smartphone* : Plafond strict : facteur 3 (montant réel compris entre $\frac{1}{3} \times$ et $3 \times$ le montant prévu). Au-delà (ex: achat d'un téléphone à 800 € chez Orange), neutralisation de l'auto-liaison et maintien dans le Sas pour arbitrage humain.
     - *Comptabilisation* : L'échéance du mois est liée et pointée au montant réel constaté (35,99 €). **Le montant du template et les mois futurs restent strictement intacts à 14,99 €**.
  2. **Cas B — Détection & Auto-Propagation des Hausses Tarifaires ($N=3$)** :
     - *Problème résolu* : Un abonnement passe de 10,99 € à 11,99 € (augmentation globale). Ajuster chaque mois manuellement est fastidieux.
     - *Comportement* : Si 3 débits consécutifs ($N=3$) partagent le même nouveau montant déviant à intervalle régulier (26 à 33 jours) :
       - Le modèle de récurrence bascule automatiquement au nouveau montant (`template.amount = 11.99`).
       - Propagation automatique (`propagate_recurrence`) sur toutes les prévisions futures non pointées.
       - Conservation stricte et sanctuarisation de l'historique passé aux anciens montants.
  3. **Cas 2.A — Auto-Saut des Échéances Non Prélevées sur Solde Conforme (Triple Verrou)** :
     - *Problème résolu* : Un prélèvement exceptionnellement non effectué bloque indéfiniment la trésorerie dans le Reste à Vivre.
     - *Comportement* : L'échéance est automatiquement marquée comme « Sautée » (`is_skipped = True`), libérant immédiatement la réserve dans le Reste à Vivre.
     - *Triple Verrou de Sécurité Stricte* :
       1. Date d'échéance $+ 1$ période calendaire $+ 3$ jours de battement dépassée (ex: $M+1 + 3\text{j}$ pour un mensuel).
       2. Solde bancaire réel strictement égal au solde pointé OmniBank ($|\Delta| < 0.005 \text{ €}$).
       3. Sas d'attente parfaitement vide (`pending == 0`).
       *Garantie* : Si des opérations sont en cours de validation dans le Sas ou si les soldes divergent, l'auto-saut est formellement neutralisé pour ne jamais sauter une opération en transit.
  4. **Cas 2.B / 2.C — Auto-Clôture sur 3 Échéances Sautées Consécutives (Résiliations / Contrats Morts)** :
     - *Problème résolu* : Contrat de salle de sport résilié mais continuant à générer 12 échéances fantômes par an.
     - *Comportement* : Si les 3 dernières occurrences d'un template sont toutes sautées (`is_skipped = True`), bascule automatique du modèle à `is_closed = True` et purge de toutes les occurrences futures non pointées.
  5. **Toggles Indépendants & Rétroaction Visuelle (Ergonomie & Contrôle)** :
     - 4 interrupteurs configurables indépendamment dans `GlobalConfig` :
       - `auto_link_deviant_recurrences` (Défaut : `true`)
       - `auto_propagate_recurrence_hikes` (Défaut : `true`)
       - `auto_skip_unreconciled_recurrences` (Défaut : `true`)
       - `auto_close_unreconciled_recurrences` (Défaut : `true`)
     - Bouton `⚙️ Automatismes` dans la barre d'outils de la vue Récurrences (`recurrence_manager.js`).
     - Badges distinctifs `Ajusté auto` et `Sauté auto` dans la vue chronologique et tabulaire.
     - Boutons de correction 1-clic dans la modale d'échéance (`[Rétablir montant initial]`, `[Désauter]`).

---

### Brique 5 : Gestionnaire Dynamique d'Enveloppes (Découverte Déterministe, Création & Recalibrage Contrôlé)
*Détecter les catégories non budgétées pour proposer de nouvelles enveloppes au Cold-Start ou au fil de l'eau, et analyser les tendances de dépenses pour proposer des ajustements d'enveloppes existantes, de manière 100% déterministe et offline. Le système fonctionne en deux temps : **d'abord la suggestion (notification/preview)** avec validation ou refus persistant, **puis l'auto-acceptation contrôlée (opt-in)** après mise en place du Centre de Contrôle en Étape 6.*

> [!IMPORTANT]
> **Principe de Souveraineté Budgétaire** : Un budget est un **plafond intentionnel de dépense**, pas un reflet passif de la réalité. Le système ne doit jamais valider rétroactivement des excès en augmentant silencieusement les enveloppes. Le mode par défaut est **proposition + approbation 1-clic ou refus explicite**, jamais mutation silencieuse.

* **Fichiers concernés** :
  - [`app/services/budget_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/budget_service.py) (Détection déterministe de catégories orphelines, calcul mathématique du lissage EMA, Winsorizing et plafonnement — **100% offline sans dépendance Ollama**)
  - [`app/services/stats_utils.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/stats_utils.py) (Filtre d'écrêtage Winsorizing extrait et partagé — Étape 0)
  - [`app/services/budget_ai_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/budget_ai_service.py) (Suggestions de regroupement multi-catégories et commentaires qualitatifs IA — facultatifs)
* **État d'avancement actuel : 50%**
  - ✅ Calcul des moyennes historiques sur fenêtres glissantes configurables (3 à 12 mois).
  - ✅ Écrêtage statistique des anomalies (Winsorizing / outlier sensitivity 1 à 5) extrait dans [`app/services/stats_utils.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/stats_utils.py) et re-exporté dans `budget_service.py` (**100% offline sans Ollama** — Jalon 0.7).
  - ✅ Colonne `Budget.is_locked` ajoutée en base de données (schéma SQLite v24) et intégrée aux DTOs Pydantic (Jalons 0.4, 0.5, 0.6).
  - ⬜ Synchronisation dynamique des dépenses fixes vs variables avec les `RecurrenceTemplate` — jalon distinct (cf. §5.6 ci-dessous).
* **Architecture Complète des Deux Volets Budgétaires** :

  #### Volet A : Découverte & Suggestion de Création d'Enveloppes (Cold-Start & Nouvelles Catégories)
  1. **Détection Déterministe Pure (100% Hors-Ligne sans IA)** :
     - Le moteur identifie toutes les catégories de dépenses actives non encore couvertes par une enveloppe (`unbudgeted_categories`).
     - Pour chaque catégorie orpheline présentant des dépenses observées ($N \ge 1$) ou une récurrence active (`RecurrenceTemplate`) :
       - Calcul du montant d'amorçage : moyenne mensuelle observée avec Winsorizing.
       - Périodicité suggérée : `yearly` si récurrence annuelle, `monthly` par défaut.
       - Application du plancher configurable `GlobalConfig.budget_minimum_threshold` (défaut : 30 €).
       - Suggestion de création d'enveloppe émise dans `AutopilotDecisionLog` (`decision_type = 'budget_creation_suggestion'`, `action = 'SUGGESTED'`).
  2. **Cadence Réactive Cold-Start (Découverte au Fil de l'Eau)** :
     - **En phase Cold-Start** (`< 60 jours` d'historique ou `< 3 enveloppes actives`) : l'évaluation des catégories orphelines se déclenche **à chaque import de lot ou relevé bancaire** (`process_incoming_batch`). Dès qu'une nouvelle catégorie cumule des débits, l'utilisateur reçoit immédiatement une suggestion pour créer l'enveloppe sans attendre la fin du mois.
     - **En vitesse de croisière** : le rythme bascule sur une fréquence mensuelle (1er du mois / cycle de paie), évitant toute sollicitation superflue.
  3. **Cycle Complet : Approbation 1-Clic, Refus Persistant (`DISMISSED`) & Auto-Création** :
     - **[Approuver 1-clic]** : Crée l'enveloppe en base (`Budget` + `BudgetCategory`), trace l'action dans `ActionHistory` (Undo/Redo possible) et passe la décision à `action = 'AUTO_COMMIT'`.
     - **[Ignorer / Refuser]** : Passe la décision à `action = 'DISMISSED'`. **Garantie anti-harcèlement** : une catégorie explicitement refusée n'est plus reproposée lors des imports ultérieurs.
     - **Auto-Création Full-Auto (Étape 6)** : Interrupteur dédié `GlobalConfig.auto_create_budget_envelopes` (défaut : `false`) permettant, une fois le Centre de Contrôle actif, d'auto-créer les enveloppes évidentes avec réversibilité garantie dans le Decision Feed.
  4. **Enrichissement Optionnel avec IA (Ollama)** :
     - Si Ollama est disponible, le LLM peut proposer un regroupement sémantique élégant de plusieurs catégories affines au sein d'une même enveloppe (ex: `Boulangerie` + `Supermarché` $\to$ Enveloppe `Alimentation & Courses`). Si l'IA est absente, le mode déterministe prend le relais sans rupture.

  #### Volet B : Recalibrage Amorti des Enveloppes Existantes (Lissage EMA)
  1. **Cadence Périodique & Déclencheur Temporel (Anti-Thrashing)** :
     - **Règle absolue** : Les montants des enveloppes ne doivent **JAMAIS** être recalculés lors d'une synchronisation quotidienne.
     - **Déclencheur Temporel Backend** : Exécution uniquement à date fixe : **au 1er du mois ou lors d'un nouveau cycle de paie**.
     - **Implémentation** : Vérification dans `bank_sync_scheduler_loop` et au démarrage applicatif dans `lifespan` (`app/main.py`) via la clé persistante `last_budget_recalibration_period` (format `YYYY-MM`).
  2. **Filtre de Lissage Exponentiel Déterministe (EMA 3–6 mois)** :
     - Formule amortie : $\text{Suggestion}_{t} = (1 - \alpha) \cdot \text{Budget}_{t-1} + \alpha \cdot \overline{\text{Dépenses}}_{3-6m}$ avec $\alpha = 0.20$.
     - Résultat : une suggestion tracée dans `AutopilotDecisionLog` (`decision_type = 'budget_suggestion'`), **sans mutation directe de `Budget.monthly_amount` en Étape 5**.
  3. **Double Plafond de Dérive (Drift Guard) & Sanctuarisation des Enveloppes** :
     - **Filtre strict d'éligibilité** : `Budget.envelope_type == 'spending' and not is_project and not is_closed and not is_locked and period in ('monthly', None)`.
     - **Exclusions absolues** : Épargne (`savings`), projets (`is_project`), enveloppes verrouillées (`is_locked == True`), enveloppes annuelles ou closes.
     - **Borne instantanée** : variation limitée à $\pm 10\%$ max d'un mois sur l'autre.
     - **Borne cumulée annuelle** : dérive limitée à $\pm 25\%$ max par rapport à la référence annuelle (`Budget.base_annual_amount`). Au-delà, blocage et alerte de révision manuelle.
  4. **Synchronisation `RecurrenceTemplate` → Enveloppes (Jalon Distinct §5.6)** :
     - Reporté à l'Étape 6 : répercussion des hausses tarifaires ($N=3$) ou clôtures d'abonnements sur les enveloppes concernées. dans le Dashboard (ex: `📊 3 ajustements budgétaires proposés`) et valide/refuse 1-clic. **Aucune mutation directe des montants `Budget.monthly_amount`.**
     - **Étape 6 — Mode Full-Auto (opt-in après Centre de Contrôle)** : Une fois le Centre de Contrôle livré (Étape 6), un toggle `auto_apply_budget_suggestions` dans `GlobalConfig` (défaut : `false`) permet d'activer la mutation automatique des montants avec traçabilité complète et rollback 1-clic dans le Decision Feed. Ce mode n'est proposé que lorsque l'outillage de contrôle et de réversibilité est opérationnel.
  6. **Synchronisation `RecurrenceTemplate` → Enveloppes Budgétaires (Jalon Distinct)** :
     - **Périmètre reporté** : La synchronisation automatique entre les templates de récurrence et les enveloppes budgétaires constitue un jalon distinct, traité en Étape 6 une fois le Centre de Contrôle opérationnel.
     - **Cas couverts (spécification préalable)** :
       - Hausse tarifaire détectée ($N=3$) sur un template lié à une enveloppe → Proposition d'ajustement de l'enveloppe du delta constaté.
       - Clôture d'un template (résiliation) → Proposition de réduction de l'enveloppe du montant correspondant.
       - Promotion d'un nouveau template ($N \ge 3$) → Suggestion d'augmentation de l'enveloppe concernée.
     - **Mécanisme** : Toujours via le mode suggestion (notification + validation 1-clic), jamais mutation directe sauf opt-in Full-Auto.

---

### Brique 6 : Sas d'Attente ("Pending Sync") & Matrice d'Arbitrage
*Le sas d'attente devient le filtre d'exception de l'Auto-Pilote pour tous les modes d'entrée.*

* **Fichiers concernés** :
  - [`app/services/autopilot_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/autopilot_service.py) (Point d'entrée unique de traitement des lots entrants)
  - [`app/services/bank_sync_scheduler.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/bank_sync_scheduler.py) (`save_pending_sync_data`, `_PENDING_SYNC_DATA`)
  - [`app/routers/csv_manager.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/csv_manager.py) (`import_to_pending`)
  - [`app/routers/bank_sync.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/bank_sync.py)
* **État d'avancement actuel : 100% — ✅ LIVRÉ (Étape 3)**
  - ✅ Sas d'attente persistant (RAM + `GlobalConfig`).
  - ✅ Déduplication automatique entre imports de fichiers CSV et connexions bancaires en ligne.
  - ✅ Cockpit visuel ergonomique permettant d'ignorer, modifier ou valider les opérations.
  - ✅ Support multi-onglets XLSX & multi-sections CSV avec mémorisation de mapping par compte (`GlobalConfig.file_account_mapping`) et ré-évaluation dynamique instantanée du rapprochement (Phase B / v1.1.3).
  - ✅ **Unification du Pipeline d'Ingestion & Routage Dynamique** : Les relevés Woob (`execute_auto_sync_for_connection`) et les imports de fichiers (`import_to_pending`) transitent désormais par le point d'entrée unique `AutoPilotService.process_incoming_batch()`.
  - ✅ **Routage Conditionnel Transparent** : Si l'Auto-Pilote est désactivé, 100% des opérations vont dans le Sas (comportement manuel classique 100% intact). S'il est activé, les rapprochements à haute certitude court-circuitent le Sas avec audit et notification enrichie.
  - ✅ **Adaptation Dropzone CSV / Excel (`import_wizard.js` — Jalon 3.9)** : Fermeture automatique de la modale avec toast de confirmation récapitulatif enrichi lorsque 100% des opérations d'un lot sont traitées de manière autonome (`pending === 0`), sans ouvrir de modale de revue vide.

---

### Brique 7 : Page Dédiée « Centre de Contrôle Auto-Pilote » (Vue Décisions, Réversibilité & Réorientation)
*Garantir la souveraineté absolue et le contrôle de l'utilisateur grâce à une page dédiée transparente, réversible et interactive (consultation 100% facultative).*

* **Fichiers concernés** :
  - Nouveau fichier frontend : `static/js/views/autopilot_view.js` (`AutopilotView`)
  - Nouveau routeur backend : `app/routers/autopilot.py` (`/api/autopilot/decisions`, `/api/autopilot/override`, `/api/autopilot/rollback-cycle`)
  - Routeur de gestion des règles réutilisé : [`app/routers/smart_labels.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/smart_labels.py) (`/api/smart-labels/mappings` — CRUD déjà existant sur `BankLabelMapping`)
  - [`app/services/history_service.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/history_service.py) (`record_action`, `snapshot_entity`)
  - [`app/models.py`](file:///d:/Code%20Projects/OmniBank-Local/app/models.py) (`AutopilotDecisionLog`, `BankLabelMapping`)
  - [`static/index.html`](file:///d:/Code%20Projects/OmniBank-Local/static/index.html) & [`static/js/app.js`](file:///d:/Code%20Projects/OmniBank-Local/static/js/app.js) (Bouton nav `🤖 Auto-Pilote` et badge interactif dans le header)
* **État d'avancement actuel : 60%**
  - ✅ Système `record_action` + `snapshot_entity` dans `history_service.py` pour l'historique avant/après des mutations de transactions et des règles Smart Labels.
  - ✅ Système de notifications persistantes avec filtres actif/archivé, déduplication et provenance `trigger_source`.
  - ✅ Base de règles d'apprentissage `BankLabelMapping` et API complète existante dans `smart_labels.py` (évite de réinventer un CRUD d'API en Étape 6).
  - ✅ **Atelier des Directives Opérationnel (`config_smart_labels.js`)** : Tableau des correspondances libellés/catégories avec filtres, bascule 1-clic Manuel/Auto, bascule Multi-catégories, modale d'édition in-place avec recherche ultra-permissive (casse/accents) et annulation immédiate (Undo).

#### 1. Philosophie : Autonomie Silencieuse par Défaut, Contrôle Souverain à la Demande
- **Consultation 100% Facultative** : L'Auto-Pilote travaille silencieusement en tâche de fond. Il n'interrompt jamais l'utilisateur avec des modales bloquantes ou des demandes de validation intempestives. Si l'utilisateur choisit de ne jamais visiter cette page, ses comptes restent impeccablement tenus et équilibrés.
- **Zéro "Boîte Noire"** : Chaque décision prise de manière autonome (rapprochement, écriture, catégorisation, récurrence, enveloppe) est tracée avec son motif explicatif et conservée dans un journal structuré.
- **Souveraineté & Réversibilité Absolue** : L'utilisateur n'est jamais prisonnier des décisions du robot. En cas de désaccord, il peut d'un clic défaire une action, rectifier une étiquette ou réorienter le comportement futur du système.

#### 2. Accès Ergonomique & Indicateur Silencieux
- **Bouton Navigation Principal** : Ajout de l'onglet `🤖 Auto-Pilote` (`data-view="autopilot"`) dans la barre de navigation.
- **Accès Rapide Contextuel** : Un clic direct sur le badge de statut dans le header (`[ Auto-Pilote : 🟢 Actif (3 décisions) ]`) ouvre instantanément la page.
- **Compteur Discret** : Une pastille numérique discrète signale le nombre d'actions prises depuis la dernière visite (`🤖 Auto-Pilote (3)`), sans sonnerie ni notification intrusive, et s'estompe naturellement dès la consultation.

#### 3. Architecture Détaillée des 4 Panneaux de la Page (`AutopilotView`)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🤖 CENTRE DE CONTRÔLE AUTO-PILOTE                     [ Switch : 🟢 ACTIF ] │
├─────────────────────────────────────────────────────────────────────────────┤
│ Mode : (•) Vitesse de Croisière (Full-Auto)   ( ) Prudent (Semi-Auto)       │
│ Santé : Dernier relevé : Aujourd'hui 08:34 | Coffre : Valide | IA : Ollama  │
│ KPIs  : 42 opérations gérées | Précision : 100% | 0 anomalie | 120 clics éco│
├─────────────────────────────────────────────────────────────────────────────┤
│ 📜 FLUX DES DÉCISIONS AUTOMATIQUES (Decision Feed)                          │
│ Filtres : [ Tous ] [ 🟢 Rapprochements ] [ 🏷️ Catégories ] [ 🔄 Récurrences ]│
│                                                                             │
│ ▼ Cycle de Relevé du 06/09/2026 à 08:34 (BoursoBank)   [ ⏪ Annuler ce cycle ]│
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 🟢 RAPPROCHEMENT COMPTABLE                                (Score: 94%) │ │
│ │ Débit de 65,00 € "PRLV EDF" rapproché avec prévision #412               │ │
│ │ Motif : Montant exact + échéance calendaire concordante (+1 jour)       │ │
│ │ [ ↩️ Dépointer / Dissocier ]  [ 🔍 Voir l'écriture ]                     │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 🏷️ NOUVELLE ÉCRITURE & CATÉGORISATION                     (Confiance: 92%)│ │
│ │ Débit de 38,50 € "CB CARREFOUR MARKET 7501"                             │ │
│ │ Nettoyé en : "Carrefour" ──> Affecté à : [ Alimentation ▾ ]             │ │
│ │ Motif : Règle déterministe #12                                          │ │
│ │ [ ✏️ Changer Catégorie ]  [ 🚫 Exclure ce marchand ]                     │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ 🔄 RÉCURRENCE VALIDÉE                                    (3ème mois)   │ │
│ │ Débit récurrent de 10,99 € "SPOTIFY PARIS" officialisé en charge fixe   │ │
│ │ [ 🛑 Clôturer la récurrence ]  [ ⚙️ Configurer le modèle ]               │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│ 🛠️ ATELIER DES DIRECTIVES & RÈGLES APPRISES (Rules Workshop)                 │
│ Onglets : [ 📋 Règles Marchands (18) ] [ 🚫 Marchands Exclus (2) ] [ 🔒 Budgets (4) ]│
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 4. Les Leviers de Contrôle : Revenir dessus, Modifier & Réorienter

1. **Revenir dessus (Défaire / Annuler sans risque)** :
   - **[Dépointer / Dissocier]** : Rompt instantanément le rapprochement d'une opération si l'association était erronée (ex: deux prélèvements au montant homonyme). L'opération bancaire et la prévision redeviennent indépendantes (`reconciliation_date = NULL`), et la décision est marquée `is_undone = True` sans aucune perte de données.
   - **[Rollback Global de Cycle (1-Clic)]** : Situé sur l'en-tête de chaque groupe de synchronisation, ce bouton permet d'annuler en bloc l'ensemble des décisions d'un cycle précis (`batch_id`). Le moteur applique une logique sémantique stricte selon `decision_type` :
     * **Pour `decision_type == 'new_entry'`** : L'écriture créée est purement supprimée de la table `Transaction`.
     * **Pour `decision_type == 'reconciliation'`** : L'écriture existante n'est **JAMAIS supprimée** (préservant intégralement les prévisions de l'utilisateur) ; elle est dissociée (`reconciliation_date = NULL`) et ses champs restaurés depuis son `raw_snapshot`.
     * **Pour `decision_type == 'recurrence_promotion'`** : Le template créé est clôturé ou supprimé.
     * **Statut d'Audit** : Toutes les lignes `AutopilotDecisionLog` du cycle passent à `is_undone = True` avec `undone_at = now()`.
     * **Reconstitution du Sas** : Grâce aux snapshots JSON, le lot original d'opérations est réinjecté fidèlement dans le Sas d'attente (`_PENDING_SYNC_DATA`) pour examen manuel dans le Cockpit.

2. **Modifier la Décision (Rectification immédiate)** :
   - **[Changer de Catégorie]** : Menu déroulant direct dans la tuile de décision pour corriger instantanément une affectation erronée.
   - **[Ajuster le Libellé Nettoyé]** : Rectifier le nom commercial simplifié attribué par le robot.
   - **[Ajuster l'Enveloppe Budgétaire]** : Modifier le montant issu du lissage sans attendre le cycle suivant.

3. **Réorienter pour le Futur (Directives & Éducation de l'Auto-Pilote)** :
   - **Apprentissage Dirigé Instantané** : Dès que l'utilisateur modifie la catégorie d'une transaction, l'interface affiche une invite élégante :
     *« Mémoriser cette orientation ? Voulez-vous que tous les futurs débits de ce marchand soient automatiquement classés dans cette catégorie ? »*
     $\rightarrow$ En un clic, la règle est gravée dans `BankLabelMapping`.
   - **Blacklist / Exclusion de Marchands** : Bouton *« Ne plus jamais auto-catégoriser ce marchand »*. Les opérations futures de ce commerçant seront systématiquement laissées dans le Sas d'attente pour validation humaine (via `is_ignored = True` dans `BankLabelMapping`).
   - **Verrouillage d'Enveloppe Budgétaire (Cadenas)** : Un bouton cadenas sur chaque enveloppe bascule `Budget.is_locked = True` et protège les catégories sensibles (ex: Épargne, Loisirs) du recalcul automatique par l'Auto-Pilote.
   - **Réglage des Seuils de Tolérance** : Possibilité d'ajuster le curseur d'exigence (ex: exiger 90% ou 95% au lieu de 85% pour l'auto-rapprochement).

#### 5. L'Atelier des Directives (Rules Workshop)
- Un panneau dédié en bas de page regroupe l'ensemble des connaissances acquises par l'Auto-Pilote (en s'appuyant directement sur le routeur existant [`app/routers/smart_labels.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/smart_labels.py)) :
  - **Tableau des correspondances libellés** (`BankLabelMapping` via `/api/smart-labels/mappings` : motif brut $\rightarrow$ nom propre $\rightarrow$ catégorie par défaut). Possibilité d'ajouter, modifier ou supprimer des règles.
  - **Liste des marchands exclus** (commerçants avec `is_ignored = True` requérant un arbitrage systématique).
  - **Enveloppes budgétaires protégées** (enveloppes avec `is_locked = True` exclues du lissage auto).

---

## 3. Pièges à Éviter & Points d'Attention Critiques

| Domaine | Piège identifié | Risque encouru | Solution architecturale requise |
| :--- | :--- | :--- | :--- |
| **Bancaire** | Sollicitation excessive (Polling trop fréquent) | Blocage d'IP, bannissement temporaire ou demande intempestive de 2FA. | **Cooldown strict** : Intervalle minimal de 2h à 6h entre deux relevés, même en cas de déverrouillages répétitifs du coffre. |
| **Bancaire** | Blocage sur challenge 2FA en tâche de fond | Thread gelé, application ralentie ou crash silencieux. | Exécution asynchrone isolée, timeout strict (120s max), émission d'une alerte in-app non intrusive si une action mobile est requise. |
| **Comptable** | Rapprochement sur doublon de montant | Rapprochement de la mauvaise opération (ex: 2 prélèvements identiques de 15,00 €). | Exiger la concordance textuelle et/ou l'unicité temporelle. Si ambiguïté, transférer au Sas d'attente. |
| **Comptable** | Écritures fantômes / double débit | Incohérence des soldes, écart avec le relevé de compte officiel. | Règle d'or : une écriture passée ne peut être validée qu'une seule fois. Vérification stricte via `csv_id`. |
| **Budgets** | Hyper-réactivité / Effet "Yoyo" | Les budgets changent chaque semaine, créant anxiété et illisibilité. | **Isolation stricte** : Aucun ajustement d'enveloppe pendant les syncs quotidiennes. Lissage EMA sur 3 à 6 mois au 1er du mois. |
| **Cold Start** | Extrapolation sur données partielles | Création d'enveloppes aberrantes après seulement 10 jours d'utilisation. | Pendant les 90 premiers jours, borner les estimations par les modèles de récurrence (`RecurrenceTemplate`) et imposer un plafond de variation. |
| **Récurrences** | Hors-forfait ou déviation ponctuelle | Doublon dans le Sas d'attente ou altération indésirable des prévisions annuelles. | **Auto-liaison tolérante bornée** : Lier l'échéance du mois au débit réel avec plafond de sécurité (≤ 150 € / 4x), sans modifier le template ni les mois suivants. |
| **Récurrences** | Abandon de contrat non détecté | Échéances fantômes persistant indéfiniment et bloquant le Reste à Vivre. | **Triple verrou d'auto-saut** (|Δ solde| < 0.005 €, Sas vide, période échue) + auto-clôture après 3 sauts consécutifs. |
| **UX** | Syndrome de la "Boîte Noire" | L'utilisateur ne sait plus ce qui a été fait, perte de confiance. | Journal d'activité clair : *"Auto-Pilote : 3 opérations rapprochées, 1 ajoutée. Tout est équilibré."* + Rollback 1-clic. |
| **Cycle de Vie (Tauri)** | Fermeture brutale [X] pendant la synchronisation | Données partielles ou coupure abrupte du process Python. | **Bouclier de Fermeture Sécurisée** : Interception événementielle conjointe au niveau natif Rust dans `src-tauri/src/main.rs` (`WindowEvent::CloseRequested` en plus de `RunEvent::Exit`) et côté webview (`tauri://close-requested`), consultation de l'état de synchronisation en cours via l'API locale, court écran d'attente (2 à 4s) si actif avec **fermeture automatique** dès le commit terminé. Transactions SQLite atomiques (`with db.begin():`) garantissant zéro corruption de base. |

---

## 4. Risques de Régression & Stratégies d'Étanchéité

Pour que l'ajout du mode Auto-Pilote ne casse aucune fonctionnalité existante, les verrous suivants doivent être respectés :

1. **Préservation du Workflow Manuel (Cockpit & Saisie)** :
   - L'ensemble du code de validation manuelle via le cockpit et la modale d'opérations doit rester intact. Le mode Auto-Pilote n'est qu'un court-circuit conditionnel :
     ```python
     if is_auto_pilot_enabled and match_confidence >= AUTO_COMMIT_THRESHOLD:
         commit_directly(db, tx_data)
     else:
         send_to_pending_sas(db, tx_data)
     ```
2. **Concurrence SQLite & Verrouillage DB (`database is locked`)** :
   - Les tâches de fond de synchronisation et d'ajustement budgétaire ouvrent leur propre session SQLAlchemy (`SessionProf`) et exécutent leurs commits en blocs courts.
   - Les PRAGMAs configurés (`busy_timeout = 30000`, WAL mode) doivent être préservés impérativement.
   - **Concurrence `AutoPilotService` vs Scheduler** : La méthode `process_incoming_batch()` de l'`AutoPilotService` sera appelée **depuis** le scheduler (même thread/coroutine) et non en parallèle, évitant ainsi les contentions SQLite. Si un appel CSV import déclenche le pipeline simultanément, chaque appel ouvre sa propre session `SessionProf` avec des commits atomiques courts ($< 200$ ms) pour minimiser la fenêtre de verrouillage WAL.
3. **Respect des Mémos Anti-Régression Existants** :
   - **KG-02 & KG-03 (Récurrences)** : Ne jamais régénérer ni clôturer de récurrences sans validation explicite de l'utilisateur ou sans présence de transactions réelles sur l'année.
   - **Validation Benchmark CSV vs JPG** : La précision décimale et le calcul du solde cumulé doivent correspondre exactement aux données de référence.
4. **Migration Incrémentale de Schéma DB Multi-Profils (Bases Existantes)** :
   - Le projet n'utilise pas Alembic. Les migrations sont assurées par des blocs de versionnement incrémentaux (`schema_version`) dans `app/init_data.py` et des scripts ad-hoc dans `migrations/`.
   - La dernière version de schéma actuelle dans le code étant `schema_version < 23` (`entity_snapshots` pour le chat), l'Auto-Pilote constitue officiellement le **`schema_version = '24'`**.
   - Un script dédié `migrations/migrate_autopilot.py` sera créé dès l'Étape 0 pour itérer sur **l'ensemble des profils existants** (profil racine `omni_bank.db` et tous les sous-dossiers de profils chargés via `app.profile_manager.load_profiles_data()`) afin de :
     * Créer la table `autopilot_decision_log` (si inexistante) via `CREATE TABLE IF NOT EXISTS` avec les colonnes complètes : `id`, `batch_id`, `decision_type`, `action`, `entity_type`, `entity_id`, `conn_id`, `account_id`, `raw_snapshot`, `confidence_score`, `is_undone` (BOOLEAN DEFAULT 0), `undone_at` (DATETIME NULL), `created_at`.
     * Ajouter la colonne `is_locked` sur la table `budgets` (`ALTER TABLE budgets ADD COLUMN is_locked BOOLEAN DEFAULT 0`).
     * Initialiser les clés `GlobalConfig` manquantes (`auto_pilot_enabled = "false"`, `bank_sync_on_vault_unlock = "true"`, `last_auto_sync_attempt = ""`, et passer `schema_version = "24"`).
   - L'`init_data.py` existant sera enrichi avec le bloc `if schema_version < 24:` pour initialiser ces mêmes clés et colonnes lors de la création de tout nouveau profil ou au démarrage applicatif, garantissant une compatibilité parfaite fresh install et upgrade sans profil orphelin.
5. **Scoping Multi-Profils des Clés Auto-Pilote** :
   - La clé `auto_pilot_enabled` et les préférences associées (`bank_sync_on_vault_unlock`, `last_auto_sync_attempt`) doivent être **scopées par profil**. Puisque le multi-profils utilise déjà des bases SQLite séparées (une `GlobalConfig` par profil), les clés sont naturellement isolées. Aucune convention de nommage avec préfixe profil n'est nécessaire — c'est déjà le comportement attendu.
   - Le `AutoPilotService` doit recevoir le `profile_id` courant dans chaque appel, comme les services existants (`bank_sync_scheduler`, `credential_vault`), et invalider le cache de manière ciblée via `stats_cache.invalidate(profile_id)`.

---

## 5. Rappel des Règles Projets & Contraintes d'Ingénierie

Tout développement lié au mode Auto-Pilote doit se conformer strictement à [CLAUDE.md](file:///d:/Code%20Projects/OmniBank-Local/CLAUDE.md) et [Construction Plan.yaml](file:///d:/Code%20Projects/OmniBank-Local/Construction%20Plan.yaml) :

* **Règle 1 : Réfléchir avant de coder** : Expliciter les compromis (tradeoffs), ne rien supposer.
* **Règle 2 : Simplicité d'abord** : Pas de frameworks ou d'abstractions spéculatives inutiles.
* **Règle 3 : Modifications chirurgicales** : Ne toucher qu'aux lignes requises, ne pas refactorer le code adjacent qui fonctionne.
* **Règle 4 : Validation par objectifs** : Chaque étape est validée par des tests unitaires automatisés (`pytest`).
* **Règle 5 : Internationalisation (i18n)** :
  - Clés toujours synchronisées entre `fr.json` et `en.json`.
  - Écriture des JSON **exclusivement via Python avec `encoding='utf-8-sig'`** (Règle G-07, interdiction formelle de PowerShell pour éviter la corruption en Windows-1252).
* **Règle 6 : Changelog & Releases** : `CHANGELOG.md` en anglais, concis et orienté utilisateur.
* **Règle G-04 : Logs de Debug** : Logs rédigés impérativement en **Français**.
* **Règle G-08 : Modales UI** : Utiliser `showInlineConfirm` de `common.js`, jamais de `window.confirm`.
* **Règle G-12 : Prompts Système LLM** : Rédigés en anglais dans le backend pour la stabilité du Function Calling / JSON parsing, langue de restitution injectée dynamiquement.
* **Souveraineté des Données** : Zéro appel externe, zéro télémétrie. LLM 100% local via Ollama.

---

## 6. Feuille de Route Incrémentale (Ordre de Réalisation)

La transition vers l'Auto-Pilote s'effectuera en **8 étapes autonomes**, chacune apportant une valeur immédiate sans attendre l'étape suivante :

```mermaid
graph TD
    Z["Étape 0 : Fondations & Pré-requis Techniques<br/>✅ 100% (v1.1.3)"] --> A["Étape 1 : Réactivité Déverrouillage + Cooldown<br/>✅ 100% (v1.1.4)"]
    A --> B["Étape 2 : Orchestrateur AutoPilotService<br/>Auto-Rapprochement & Modèle DecisionLog<br/>✅ 100% PASS"]
    B --> C["Étape 3 : Pipeline Smart Labels & Écritures<br/>Auto-Commit Écritures & Fallback IA<br/>✅ 100% PASS"]
    C --> C1["Étape 3.5 : Filet de Sécurité & IA Augmentée<br/>Garde-fous Anti-Prolifération & Sas Propre<br/>✅ 100% PASS"]
    C1 --> D["Étape 4 : Détection & Promotion Récurrences<br/>Charges Candidates Dynamiques (Reste à Vivre)<br/>✅ 100% PASS"]
    D --> D1["Étape 4.5 : Cycle de Vie Dynamique Récurrences<br/>Tolérance Écart, Hausse N=3, Auto-Saut & Clôture<br/>✅ 100% PASS"]
    D1 --> E["Étape 5 : Analyse & Suggestions Budgétaires EMA<br/>(Mode Preview déterministe 100% Offline)"]
    E --> F["Étape 6 : Centre de Contrôle Dédié<br/>Decision Feed, Rollback, Full-Auto Budgets & Finitions Desktop"]
```

### Détail des Étapes de Livraison :

#### Étape 0 : Fondations Techniques & Pré-requis (Zéro Fonctionnalité Visible, 100% Étanchéité) — `✅ TERMINÉE (100%)`
- [x] **Jalon 0.1 : Refactoring `check_reconciliation`** : Extraction de la fonction depuis `app/routers/csv_parser.py` vers un nouveau module dédié `app/services/reconciliation_engine.py`. Mise à jour de tous les points d'import (`bank_sync_service.py`, `bank_sync_scheduler.py`, `csv_manager.py`, `ai_helpers.py`). Objectif : éliminer la dépendance inversée routeur→service et préparer l'orchestration par `AutoPilotService`.
- [x] **Jalon 0.2 : Consolidation du client Ollama via `app/services/chat/ollama_client.py`** : Réutilisation et extension du client asynchrone existant (`call_ollama_safe` et `call_ollama_safe_async`) afin de fournir des appels LLM directs et sécurisés sans lever de `HTTPException` (FastAPI) dans les tâches d'arrière-plan, prêt pour le batch prompting d'ingestion.
- [x] **Jalon 0.3 : Empreinte Idempotente des Fichiers (`csv_id` Déterministe)** : Remplacement de l'horodatage volatile de `csv_parser.py` par un hash SHA-256 déterministe combiné à un index ordinal intra-batch (`f"{sha256}_{idx}"`) garantissant des identifiants distincts même pour plusieurs écritures identiques au sein d'un même relevé et une déduplication rigoureuse lors des ré-imports CSV.
- [x] **Jalon 0.4 : Modèle `AutopilotDecisionLog` et champ `is_locked`** : Ajout du modèle SQLAlchemy dans `app/models.py` et de la colonne `is_locked` sur `Budget`.
- [x] **Jalon 0.5 : Script de migration & Schéma SQLite v24** : Création de `migrations/migrate_autopilot.py` (itérant sur tous les profils existants) et enrichissement de `app/init_data.py` sous le bloc `if schema_version < 24:` pour initialiser la table `autopilot_decision_log`, la colonne `budgets.is_locked` et les clés `GlobalConfig` avec `schema_version = "24"`.
- [x] **Jalon 0.6 : Schémas API & DTOs Pydantic** :
  - Définition de `AutopilotDecisionLogOut` dans `app/schemas/api_schemas.py`.
  - Ajout du champ `is_locked: Optional[bool] = None` dans `BudgetCreate` et `BudgetUpdate` (`app/routers/budgets.py`).
  - Sérialisation du champ `is_locked` dans `budget_to_dict`, `get_all_budgets`, `create_new_budget` et `update_budget` (`app/services/budget_service.py`).
- [x] **Jalon 0.7 : Extraction du Winsorizing** : Refactoring du filtre d'écrêtage statistique depuis `budget_ai_service.py` vers une fonction utilitaire partagée dans `app/services/stats_utils.py` (re-exportée dans `budget_service.py`), pour que le Winsorizing soit disponible **100% offline sans Ollama**.
- [x] **Jalon 0.8 : Validation automatisée** : Exécution de la suite de tests unitaires et de non-régression (`185 passed, 0 failed` sous `pytest`).
- *Bénéfice immédiat* : Aucun changement fonctionnel visible, base de code prête pour les étapes suivantes, zéro risque de régression.

#### Étape 1 : Réactivité Déverrouillage Coffre, Option de Déverrouillage Passif, Cooldown Anti-Spam & Tri Chronologique — `✅ TERMINÉE (100%)`
- [x] **Jalon 1.1 : Branchement de l'événement `on_vault_unlocked` configurable** : paramètre `bank_sync_on_vault_unlock` (`sync_on_vault_unlock: bool`) permettant soit un rafraîchissement réactif immédiat, soit un déverrouillage passif silencieux (clé en RAM et relevé délégué au planificateur).
- [x] **Jalon 1.2 : Option UI dans les Réglages Bancaires & Modale de Déverrouillage** : Case à cocher bilingue permettant à l'utilisateur de choisir son comportement : *"Synchroniser immédiatement au déverrouillage"* (défaut) vs *"Déverrouillage passif silencieux"*.
- [x] **Jalon 1.3 : Déclenchement réactif via `trigger_manual_auto_sync` enrichi** : Réutilisation directe de la tâche de fond dans [`app/services/bank_sync_scheduler.py`](file:///d:/Code%20Projects/OmniBank-Local/app/services/bank_sync_scheduler.py), complétée du cooldown persistant (`last_auto_sync_attempt` dans `GlobalConfig`, délai minimal de 3 heures) pour éliminer le spam lors de déverrouillages rapprochés.
- [x] **Jalon 1.4 : Garantie d'Étanchéité UI (Zéro Fausse Promesse)** : Le flag `auto_pilot_enabled` reste strictement interne au backend, aucun switch prématuré n'est exposé à l'utilisateur avant l'Étape 6.
- [x] **Jalon 1.5 : Tri chronologique strict de `history_raw` et `coming_raw`** : Correction de l'antéchronologie native Woob par tri croissant via `sort(key=lambda x: x["tx_date_obj"])`.
- [x] **Jalon 1.6 : Prise en charge des deux cycles de vie** : Docker 24/7 (conservation session coffre en RAM selon TTL) et Desktop Tauri (session applicative active en mémoire vive).
- [x] **Jalon 1.7 : Cooldown persistant et mode Catch-Up** : Clé `last_auto_sync_attempt` en base SQLite et ingestion atomique ordonnée après absence prolongée.
- [x] **Jalon 1.8 : Clés i18n bilingues et Pack de test 1 validé** : Synchronisation complète FR/EN et 7/7 tests unitaires du Pack de Test 1 passés avec succès (`tests/test_bank_sync_step1.py`).
- *Bénéfice immédiat* : L'utilisateur maîtrise son mode de déverrouillage, aucun risque de spam ou de ban bancaire, et les écritures sont rigoureusement ordonnées dans le temps.

#### Étape 2 : Moteur d'Orchestration d'Ingestion, Auto-Rapprochement & Modèle DecisionLog — `✅ 100% PASS`
- [x] **Jalon 2.0 : Initialisation des clés `GlobalConfig`** : Ajout des clés `auto_pilot_enabled` ('false'), `bank_sync_on_vault_unlock` ('true') et `last_auto_sync_attempt` ('') dans `app/init_data.py` (bloc `schema_version < 24`) avec protection `INSERT OR IGNORE`.
- [x] **Jalon 2.1 : Enrichissement de `reconciliation_engine.py`** : Double échelle d'évaluation (score ≥ 60 suggéré vs ≥ 85 auto-commit direct) et détection anti-collision sur montants homonymes (`collision_detected = True`).
- [x] **Jalon 2.2 : Création du service d'orchestration unifié `app/services/autopilot_service.py`** (`process_incoming_batch`) appelé à la fois par `bank_sync_scheduler.py` (Woob) et `csv_manager.py` (fichiers). Inscription dans `AutopilotDecisionLog`, traçabilité Undo/Redo dans `ActionHistory` et invalidation de `stats_cache.invalidate(profile_id)`.
- [x] **Jalon 2.3 : Branchement conditionnel dans `bank_sync_scheduler.py`** : Routage transparent si actif, maintien 100% intact du Sas si inactif, notifications enrichies.
- [x] **Jalon 2.4 : Branchement conditionnel dans `csv_manager.py`** : Routage sous `@router.post("/import_to_pending")` (L471) avec réinjection de `_autopilot_summary`.
- [x] **Jalon 2.5 : Clés i18n bilingues (FR/EN)** : 6 clés ajoutées avec encodage strict UTF-8 BOM (`utf-8-sig`) dans `fr.json` et `en.json`.
- [x] **Jalon 2.6 : Pack de Test 2 validé** : 8 tests unitaires complets passés avec succès (`tests/test_autopilot_step2.py`).
- *Bénéfice immédiat* : Réduction de 80% des clics de validation dans le cockpit, avec traçabilité complète dès la première décision.

#### Étape 3 : Pipeline Smart Labels, Fallback Ollama Groupé & Dropzone UI — `✅ TERMINÉE (100%)`
- [x] **Jalon 3.1 : Socle Smart Labels & Normalisation Déterministe** : Nettoyage regex, règles exactes `BankLabelMapping`, fuzzy-matching Levenshtein/Jaccard, et résolution par lot ultra-rapide $O(N)$ (`app/services/smart_label_service.py`).
- [x] **Jalon 3.2 : Sanctuarisation Manuelle & Apprentissage Progressif ($N \ge 2$)** : Protection des règles configurées par l'utilisateur (`is_manual = True`), statut provisoire pour $N=1$, neutralisation sur dispersion de catégories et prise en charge native des marchands caméléons multi-catégories (`_MULTI_CATEGORY_MERCHANTS`).
- [x] **Jalon 3.3 : Réversibilité Totale & Intégration `ActionHistory`** : Historique avant/après des modifications de règles, intégration au gestionnaire Undo/Redo global et toasts d'annulation 1-clic.
- [x] **Jalon 3.4 : Badges de Transparence dans le Sas d'Attente (Cockpit)** : Affichage contextuel de la logique utilisée (`🛡️ Règle manuelle`, `🤖 Règle apprise`, `⚠️ Provisoire (1ère fois)`, `🔀 Multi-catégories`, `🕒 Historique`) avec info-bulles explicatives guidant l'arbitrage dans `bank_sync_review.js`.
- [x] **Jalon 3.5 : Atelier des Règles & Recherche Permissive** : Modale d'édition in-place avec recherche instantanée insensible à la casse et aux accents (`removeAccents`), prévisualisation dynamique et navigation clavier dans `config_smart_labels.js`.
- [x] **Jalon 3.6 : Suite de Tests Smart Labels Validée** : 100% de succès sur les 25 tests unitaires et d'intégration (`tests/test_smart_label.py`).
- [x] **Jalon 3.7 : Fallback IA Ollama Groupé par Lot (Batch Prompting) & Détective d'Habitudes Anti-Hallucination** : Méthode non-bloquante `call_ollama_batch` dans `app/services/chat/ollama_client.py` et détective de nommage d'habitudes avec garde-fous stricts rejetant les hallucinations.
- [x] **Jalon 3.8 : Auto-Commit des Écritures Courantes** : Enregistrement autonome des dépenses courantes directes non ambiguës (≥ 85%, non caméléon, non provisoire) dans `AutoPilotService.process_incoming_batch()` et traçabilité dans `AutopilotDecisionLog` (`new_entry`).
- [x] **Jalon 3.9 : Adaptation de la Dropzone CSV / Excel (`static/js/views/import_wizard.js`)** : Fermeture automatique de la modale avec toast de confirmation si 100% des opérations sont traitées (`pending === 0`), évitant d'ouvrir une modale de revue vide.
- [x] **Jalon 3.10 : Clés i18n associées** : `autopilot_batch_categorized`, `autopilot_uncategorized_fallback`, `autopilot_ai_batch_failed`, `autopilot_import_complete_toast` synchronisées en FR et EN.
- *Bénéfice immédiat* : Catégorisation fiable, transparente et souveraine, apprentissage sans pollution, auto-commit transparent des dépenses courantes non ambiguës et expérience d'importation sans friction.

#### Étape 3.5 : Filet de Sécurité Déterministe (Catégories Fourre-tout) & Catégorisation IA Augmentée avec Garde-fous Anti-Prolifération — `✅ TERMINÉE (100%)`
- [x] **Jalon 3.5.1 : Filet de Sécurité Déterministe (`resolve_fallback_category`)** :
  - Détection intelligente des synonymes existants en base : `"Dépenses diverses"`, `"Autres dépenses"`, `"Dépenses imprévues"`, `"Achats divers"` pour les débits variables (`expense_var`) ; `"Revenus divers"`, `"Autres revenus"`, `"Virements reçus"` pour les crédits (`income`).
  - Détermination du nom canonique sans insertion prématurée dans la table `categories`.
  - Garantie comptable : 100% des opérations courantes ont une destination claire, éliminant les lignes `-- Catégorie --` orphelines dans le Sas.
- [x] **Jalon 3.5.2 : Prise en Charge Fluide des Marchands Caméléons (Amazon, PayPal...)** :
  - Attribution par défaut de la catégorie fourre-tout dépenses pour les marchands caméléons natifs tout en conservant `smart_is_multi_category = True` et le badge `[🤖 Caméléon]`.
  - Préservation stricte des marchands caméléons manuellement sanctuarisés (`is_manual = True`) dans le Sas pour arbitrage humain.
  - Autorisation d'auto-commit sous Auto-Pilote avec raison explicite `decision_reason = "chameleon_default"`, débloquant la fermeture automatique du Sas.
- [x] **Jalon 3.5.3 : Catégorisation IA Augmentée & Garde-fous Anti-Déchet / Anti-Prolifération** :
  - Enrichissement de `_parse_and_validate_batch_response` dans `ollama_client.py` : priorité stricte aux catégories existantes, avec autorisation de proposer une nouvelle catégorie concise si aucune ne convient.
  - Garde-fou anti-déchet linguistique : longueur (3-35 caractères), exclusion des artefacts JSON et caractères interdits (`{}[]<>\;:"*_|:`), exclusion des préfixes conversationnels et tokens génériques interdits (`inconnu`, `null`, `dépense`), formatage automatique en Title Case.
  - Garde-fou proximité lexicale : fusion automatique vers la catégorie existante si similarité ≥ 80% (ex: `"Alimentations"` → `"Alimentation"`).
  - Garde-fou anti-prolifération (seuil par lot) : quota maximal de **2 nouvelles catégories distinctes par lot d'import** ; repli automatique déterministe sur le filet de sécurité au-delà.
- [x] **Jalon 3.5.4 : Création Différée en Base (`ensure_category_exists`) & Non-Pollution de l'Apprentissage** :
  - Aucune nouvelle catégorie n'est insérée dans SQLite lors de la simple revue ou prévisualisation ; l'insertion `Category(name=..., type=...)` n'a lieu qu'au moment du commit effectif (dans `commit_reviewed_transactions` ou `AutoPilotService`).
  - `learn_label_mapping` ignore formellement les catégories fourre-tout pour ne jamais figer un commerçant sur `"Dépenses diverses"` de façon permanente.
- [x] **Jalon 3.5.5 : Auto-Commit Élargi & Sas Vide** :
  - Ajustement d'`is_eligible_new_entry` dans `autopilot_service.py` pour auto-committer les opérations munies d'une catégorie fourre-tout ou nouvelle IA validée.
  - Résultat : Sas d'attente vide (`pending = 0`) et dropzone fermée avec toast de célébration pour les imports réguliers.
- [x] **Jalon 3.5.6 : Clés i18n & Badges UI (`bank_sync_review.js`)** :
  - Badges contextuels `🛡️ Fourre-tout` et `✨ Nouvelle catégorie` à côté du sélecteur de catégorie.
  - Injection dynamique de la nouvelle catégorie dans le menu déroulant `<select>` si absente des catégories de base.
  - Clés i18n associées synchronisées en FR et EN (`utf-8-sig`).
- *Bénéfice immédiat* : Élimination totale des blocages de saisie dans le Sas d'attente, sas propre par défaut, et mode Auto-Pilote à supervision zéro véritablement opérationnel.

#### Étape 4 : Détection Périodique, Charges Candidates Dynamiques ($N=2$) & Liaison Rétroactive — `✅ TERMINÉE (100%)`
- [x] **Jalon 4.1 : Reconnaissance de Périodicité (Pattern Matching)** : Moteur `detect_candidate_recurring_expenses` dans `app/services/recurrence_detector.py` (même montant, même marchand nettoyé, intervalle 28–31 jours ± 2 jours de battement) avec filtre strict sur dépenses décaissées.
- [x] **Jalon 4.2 : Anticipation Dynamique du Reste à Vivre (Niveau 1, $N=2$)** : Déduction des charges candidates dans `calculate_rest_to_live` (`finance_engine.py`) avec mise en cache par signature dans `stats_cache.py` et garde-fou anti-doublon (déduction neutralisée dès que le débit du cycle en cours a été exécuté).
- [x] **Jalon 4.3 : Promotion Full-Auto ($N \ge 3$) & Liaison Rétroactive** : Promotion automatique en `RecurrenceTemplate` permanent actif (`is_closed = False`), rattachement rétroactif des $N$ transactions passées (`tx.recurrence_id = tpl.id`), et journalisation `AutopilotDecisionLog`.
- [x] **Jalon 4.4 : Cycle de Vie Intégral des Paiements Fractionnés (Alma / Klarna / Oney)** : Regex flexible `M/N`, template borné (`max_occurrences = N`), liaison rétroactive des échéances honorées, et auto-clôture finale à $M = N$ (`is_closed = True`) avec purge des prévisions orphelines.
- [x] **Jalon 4.5 : Clés i18n Bilingues Synchronisées (FR/EN, UTF-8 BOM)** : `autopilot_recurrence_candidate`, `autopilot_recurrence_promoted`, `autopilot_recurrence_fractional`, `autopilot_rav_anticipated_charges`, `autopilot_promote_template_badge` ajoutées dans `static/i18n/fr.json` et `static/i18n/en.json`.
- [x] **Jalon 4.6 : Suite de Tests Dédiée Validée** : 100% de succès sur les 6 tests unitaires et d'intégration (`tests/test_autopilot_step4.py`), incluant le benchmark réel de bout en bout sur 4 mois.
- *Bénéfice immédiat* : Le Reste à Vivre anticipe les charges fixes dès le 1er du mois sans attendre les prélèvements ni polluer la base de données.

#### Étape 4.5 : Cycle de Vie Dynamique & Maintenance Autonome des Récurrences — `✅ TERMINÉE (100%)`
- [x] **Jalon 4.5.1 : Auto-Liaison Tolérante aux Déviations de Montant (Hors-forfait / Frais ponctuels)** :
  - Dans `reconciliation_engine.py` : si aucun match exact en montant n'existe, détection d'une prévision active sur le même compte à date concordante ($\pm 4$ jours) avec similarité marchand Smart Label haute certitude ($\ge 85\%$).
  - Plafond de tolérance borné : facteur 3 strict (montant réel compris entre $\frac{1}{3} \times$ et $3 \times$ le montant de l'échéance prévue) afin de bloquer les achats de smartphones ou équipements volumineux dans le Sas.
  - Rapprochement de l'échéance du mois avec actualisation du montant réel décaissé, **sans altérer le montant de référence du template ni les échéances futures**.
- [x] **Jalon 4.5.2 : Détection & Auto-Propagation des Hausses Tarifaires ($N=3$)** :
  - Dans `recurrence_detector.py` : surveillance des montants déviants liés. Si 3 mensualités consécutives ($N=3$) partagent le même nouveau montant déviant (ex: forfait Sosh passant de 14,99 € à 16,99 €) :
  - Actualisation automatique du montant de base du template (`template.amount = nouveau_montant`).
  - Déclenchement automatique de `propagate_recurrence` pour réévaluer toutes les prévisions futures non pointées.
  - Conservation stricte de l'historique passé aux anciens montants.
- [x] **Jalon 4.5.3 : Auto-Saut des Échéances Non Prélevées sur Solde Conforme** :
  - Triple verrou de sécurité : solde bancaire égal au solde pointé OmniBank ($|\Delta| < 0.005 \text{ €}$), Sas d'attente vide (`pending == 0`), et date d'échéance $+ 1$ période calendaire $+ 3$ jours de battement dépassée.
  - Marquage automatique `is_skipped = True` : neutralisation de l'échéance et libération immédiate de la réserve dans le calcul du Reste à Vivre.
- [x] **Jalon 4.5.4 : Auto-Clôture sur 3 Échéances Sautées Consécutives (Contrats Résiliés / Abandonnés)** :
  - Constat de carence prolongée : si un template enregistre 3 occurrences consécutives sautées/absentes, bascule automatique du modèle à `is_closed = True` et purge des prévisions ultérieures.
- [x] **Jalon 4.5.5 : Toggles Découplés & Ergonomie Récurrences (`recurrence_manager.js` & Modales)** :
  - Enregistrement des 4 clés de configuration indépendantes dans `GlobalConfig` (`auto_link_deviant_recurrences`, `auto_propagate_recurrence_hikes`, `auto_skip_unreconciled_recurrences`, `auto_close_unreconciled_recurrences`).
  - Ajout d'un bouton `⚙️ Automatismes` dans la barre d'outils des Récurrences ouvrant la modale de pilotage des interrupteurs.
  - Badges visuels distinctifs sur les cellules (`⚡ Ajusté auto`, `⏭️ Sauté auto`) et boutons d'action d'annulation en 1 clic dans la modale d'échéance et la timeline (`↩️ Rétablir le montant prévu`, `Désauter`).
- [x] **Jalon 4.5.6 : Clés i18n Bilingues Synchronisées & Suite de Tests Dédiée** :
  - 21 clés de traduction complètes FR/EN (`utf-8-sig`).
  - Migration de schéma v26 (`comment` sur `transactions`) et route API `/api/recurrences/transactions/{tx_id}/restore-amount`.
  - 100% de succès sur les 7 tests de cycle de vie dynamique (`tests/test_autopilot_step4_5_dynamic_lifecycle.py`).
- *Bénéfice immédiat* : Une gestion prévisionnelle vivante, résiliente aux aléas du quotidien (hors-forfait, hausses d'abonnement, prélèvements annulés), sans intervention manuelle et sans dérégler votre budget annuel.

#### Étape 5 : Découverte Déterministe d'Enveloppes, Suggestion & Recalibrage Budgétaire (Mode Preview — 100% Déterministe Offline) — `✅ TERMINÉE (100%)`
- [x] **Jalon 5.1 : Migration de schéma v27 (`base_annual_amount` & clés `GlobalConfig`)** : Ajout de `base_annual_amount` sur le modèle `Budget`, initialisation des clés `budget_minimum_threshold` ("30.0"), `last_budget_recalibration_period` (""), `auto_create_budget_envelopes` ("false") et `auto_apply_budget_suggestions` ("false").
- [x] **Jalon 5.2 : Moteur mathématique déterministe & Volet A (Création d'enveloppes)** : Détection des catégories orphelines, calcul Winsorisé avec seuil plancher 30 € et exclusion des refus antérieurs (`_get_dismissed_categories`).
- [x] **Jalon 5.3 : Moteur mathématique lissé & Volet B (Recalibrage EMA)** : Calcul $\text{EMA} = 0.80 \times \text{Budget} + 0.20 \times \overline{\text{Dépenses}}$, double borne de dérive ($\pm 10\%$/mois et $\pm 25\%$/an vs `base_annual_amount`), alerte `drift_limit_reached` et protection `is_locked`.
- [x] **Jalon 5.4 : Orchestration événementielle & Cadence Cold-Start** : Déclenchement automatique au boot (`lifespan`), au fil de l'eau post-import si $< 3$ enveloppes actives (`process_incoming_batch`), et mensuel dans `bank_sync_scheduler.py` avec anti-thrashing strict.
- [x] **Jalon 5.5 : API Endpoints unifiés & Décisions persistantes** : Routes `/api/budgets/autopilot/suggestions`, `/approve` (1-clic), `/dismiss` (garantie anti-harcèlement) et `/recalibrate` (preview forcé).
- [x] **Jalon 5.6 : Frontend & Modale ⚙️ Automatismes** : Module dédié `budgets_autopilot.js`, bandeau de suggestions responsive, bouton ⚙️ dans le header et modale de toggles hiérarchiques.
- [x] **Jalon 5.7 : Clés i18n bilingues (FR/EN)** : 31 clés de traduction complètes encodées en UTF-8 BOM (`utf-8-sig`).
- [x] **Jalon 5.8 : Suite de tests automatisés validée** : 100% de succès sur les 9 tests T5.1 à T5.9 (`tests/test_autopilot_step5_budgets.py`).
- **Volet A — Découverte & Suggestion de Création d'Enveloppes (Cold-Start & Catégories Orphelines)** :
  - Détection déterministe pure des catégories de dépenses actives non encore rattachées à un budget (`unbudgeted_categories`).
  - Calcul du montant d'amorçage initial : moyenne mensuelle observée avec Winsorizing, récurrences connues et plancher configurable `GlobalConfig.budget_minimum_threshold` (défaut : 30 €).
  - Périodicité suggérée : `yearly` si récurrence annuelle, `monthly` par défaut.
  - **Cadence Réactive Cold-Start** : Déclenchement automatique post-import de lot (`process_incoming_batch`) si l'utilisateur est en phase Cold-Start (`< 60 jours` ou `< 3 enveloppes actives`), évitant d'attendre la fin du mois pour budgétiser les nouvelles catégories générées au fil de l'eau. En vitesse de croisière, bascule au rythme mensuel.
  - **Gestion Complète des Décisions** :
    - **Approbation 1-clic (`[Approuver]`)** : Création immédiate de l'enveloppe en base (`Budget` + `BudgetCategory`), snapshot dans `ActionHistory` (Undo/Redo opérationnel) et passage de la décision à `action = 'AUTO_COMMIT'`.
    - **Refus persistant (`[Ignorer / Refuser]`)** : Enregistrement de la décision à `action = 'DISMISSED'` dans `AutopilotDecisionLog`. **Garantie anti-harcèlement** : une catégorie explicitement refusée n'est plus reproposée lors des imports ultérieurs.
  - Enregistrement structuré dans `AutopilotDecisionLog` (`decision_type = 'budget_creation_suggestion'`).
- **Volet B — Analyse & Suggestion de Recalibrage d'Enveloppes Existantes (Lissage EMA)** :
  - Moteur de calcul EMA 3–6 mois directement dans `app/services/budget_service.py` (**sans aucune dépendance à Ollama**). Le résultat est une **suggestion de montant**, pas une mutation immédiate.
  - Formule amortie : $\text{Suggestion}_{t} = (1 - \alpha) \cdot \text{Budget}_{t-1} + \alpha \cdot \overline{\text{Dépenses}}_{3-6m}$ avec $\alpha = 0.20$ et écrêtage Winsorizing.
  - **Double plafond de dérive** : borne instantanée $\pm 10\%$/mois ET borne cumulée annuelle $\pm 25\%$ vs `Budget.base_annual_amount`.
  - Migration de schéma : ajout de la colonne `Budget.base_annual_amount` (montant de référence annuel pour la borne de dérive cumulée) et des clés `GlobalConfig.budget_minimum_threshold` (30 €) et `GlobalConfig.last_budget_recalibration_period` ("").
  - Prise en compte du cadenas `Budget.is_locked` : exclusion stricte des enveloppes protégées.
  - **Filtre strict d'éligibilité des enveloppes** : application exclusive aux dépenses mensuelles opérationnelles (`Budget.envelope_type == 'spending' and not Budget.is_project and not Budget.is_closed and not Budget.is_locked and Budget.period == 'monthly'`), exclusion formelle des tirelires d'épargne et projets.
  - **Déclencheurs Périodiques & Rattrapage au Démarrage (`lifespan`)** : vérification dans `bank_sync_scheduler_loop` ET lors de l'initialisation applicative dans `app/main.py` (`lifespan`) de la clé `last_budget_recalibration_period` (format `YYYY-MM`). Ainsi, les utilisateurs Desktop ouvrant l'application ponctuellement bénéficient du calcul mensuel immédiat dès le premier lancement du mois (règle anti-thrashing).
  - Enregistrement structuré dans `AutopilotDecisionLog` (`decision_type = 'budget_suggestion'`).
- **Notification & Bandeau UI Responsive (Mobile Viewport $\le 768\text{px}$)** :
  - Émission d'une notification récapitulative (`📊 X suggestions budgétaires proposées`) et bandeau interactif dans la vue Budgets avec boutons tactiles ergonomiques ($\ge 44\text{px}$) et empilement vertical sans défilement horizontal. **Aucune mutation directe des montants `Budget.monthly_amount` à cette étape.**
- **Clés i18n requises (Étape 5)** :
  - `autopilot_budget_suggestion_title`, `autopilot_budget_creation_suggestion_title`, `autopilot_budget_creation_toast`, `autopilot_budget_suggestion_toast`, `autopilot_budget_protected`, `autopilot_budget_drift_limit_reached`, `autopilot_budget_approve`, `autopilot_budget_dismiss`, `autopilot_budget_dismissed_toast`, `autopilot_budget_created_toast`, `autopilot_budget_recalibrated_toast`, `autopilot_budget_base_annual_label`.
- *Bénéfice immédiat* : L'utilisateur bénéficie d'une découverte proactive de ses budgets dès le premier jour et de recommandations stables et éclairées au fil des mois, avec un contrôle absolu et un refus respecté. Les budgets ne sont créés ou modifiés que sur approbation explicite.
- **Évaluation de Pertinence Financière & Améliorations Découvertes (Profil Démonstration & Profil Principal)** :
  - **Diagnostic Macro-Financier** : L'expérimentation sur le profil `Demonstration` (`p_bfa7acea`, 958 opérations, salaire moyen de 1 923,97 €/mois) a révélé un total de 12 suggestions d'enveloppes s'élevant à 1 811,73 €/mois, soit un taux d'engagement critique de 94.2% (ne laissant que 112,24 € de marge libre). Ce niveau d'engagement menaçait d'écraser l'objectif d'épargne programmée (virement de 120,00 €/mois sur le Livret A).
  - **Biais des Dépenses Ponctuelles (One-Offs)** : La catégorie *"Dépenses diverses"* et les achats isolés importants (ex: achat exceptionnel) observés sur un seul mois (`observed_months = 1`) sont désormais immunisés contre l'auto-création silencieuse et signalés par un badge de vigilance `⚠️ Ponctuelle (1 mois obs.)` avec infobulle explicative.
  - **Filtrage des Transferts & Élimination des Suggestions Fantômes** : Exclusion stricte des virements internes entre comptes détenus et des mots-clés de transfert (*Transfert*, *Compte vers compte*), et élimination des suggestions à 0 € moyenne / 30 € plancher lorsque aucune dépense réelle n'a été constatée.
  - **Support Intégral du Système d'Annulation (Undo/Redo & Toasts 1-clic)** :
    - L'approbation d'une création d'enveloppe (`CREATE`), d'un recalibrage (`UPDATE`) et le rejet d'une suggestion (`DISMISSED`) génèrent chacun un identifiant d'action `action_id`.
    - L'annulation via toast (`showUndoToast`) ou via les boutons Annuler de l'en-tête supprime proprement les budgets créés et leurs liens `BudgetCategory` (zéro orphelin en base), restaure les anciens montants budgétaires et réactive instantanément la décision en statut `SUGGESTED` dans `AutopilotDecisionLog` (la carte réapparaît immédiatement dans le bandeau).
  - **Info-Bulles Interactives & Ventilation Détaillée des Catégories (`category_breakdown`)** :
    - Chaque carte de recalibrage affiche une puce interactive `📂 X catégories` avec popover listant les catégories composant l'enveloppe, leurs dépenses totales et leur moyenne mensuelle observée triées par volume décroissant.
    - Le bandeau supérieur intègre une pilule de synthèse macro `📊 Détails des sommes` affichant la ventilation créations vs recalibrages et l'impact mensuel net global.
  - **Cadence & Timing d'Exécution des Automatismes** :
    - `auto_create_budget_envelopes` : S'exécute post-ingestion de relevé (`process_incoming_batch`) ou mensuellement, validant automatiquement uniquement les catégories ayant au moins 2 mois d'historique stable (`observed_months >= 2`) et non ponctuelles (`not is_one_off`).
    - `auto_apply_budget_suggestions` : S'exécute strictement au 1er du mois / roulement de paie (règle anti-thrashing) et refuse d'appliquer automatiquement tout recalibrage si la dérive cumulée annuelle atteint le plafond de $\pm 25\%$.

#### Étape 6 : Page Dédiée « Centre de Contrôle Auto-Pilote », Activation Mutation Budgétaire & Finitions Desktop
- Développement de la vue dédiée `static/js/views/autopilot_view.js` (`AutopilotView`) avec les 4 panneaux : Cockpit & KPIs, Decision Feed chronologique avec filtres, Leviers de rétroaction 1-clic (Dépointer, Rectifier catégorie, Rollback de cycle, Verrouillage budget), et Atelier des règles (`BankLabelMapping`).
- Création du routeur backend `app/routers/autopilot.py` (`/api/autopilot/decisions`, `/api/autopilot/override`, `/api/autopilot/rollback-cycle`) et son enregistrement explicite dans `app/main.py` via `app.include_router(autopilot.router)`. Réutilisation intégrale de [`app/routers/smart_labels.py`](file:///d:/Code%20Projects/OmniBank-Local/app/routers/smart_labels.py) pour la gestion des correspondances marchand (`/api/smart-labels/mappings`).
- **Mécanisme de Rollback Global de Cycle Sémantique** : exploitation du `batch_id`, `conn_id`, `account_id` et du `raw_snapshot` de `AutopilotDecisionLog` pour identifier toutes les décisions d'un même cycle :
  - Pour `new_entry` : suppression physique des écritures ajoutées de la table `Transaction`.
  - Pour `reconciliation` : dissociation sans suppression (`reconciliation_date = NULL` et restauration snapshot) des prévisions pré-existantes (**ne supprime jamais les prévisions de l'utilisateur**).
  - Pour `recurrence_promotion` : clôture ou suppression du template créé.
  - Pour `budget_suggestion` (nouveau) : restauration du montant `Budget.monthly_amount` depuis le `raw_snapshot` si une suggestion avait été auto-appliquée.
  - Marquage de toutes les décisions du lot à `is_undone = True` (`undone_at = now()`).
  - Reconstitution fidèle du lot structuré dans le Sas `_PENDING_SYNC_DATA`.
- **Activation du Mode Full-Auto Budgétaire (Opt-in Post-Centre de Contrôle)** :
  - Toggles `GlobalConfig.auto_create_budget_envelopes` et `GlobalConfig.auto_apply_budget_suggestions` (défaut : `false`) exposés dans le Centre de Contrôle.
  - `auto_create_budget_envelopes` : Lorsque activé, les nouvelles enveloppes suggérées sur des catégories régulières ou récurrences pérennes ($N \ge 3$) sont créées automatiquement avec traçabilité et rollback possible.
  - `auto_apply_budget_suggestions` : Lorsque activé, les suggestions de recalibrage calculées en Étape 5 sont automatiquement appliquées aux montants `Budget.monthly_amount` au 1er du mois, avec traçabilité complète dans `AutopilotDecisionLog` et rollback 1-clic dans le Decision Feed.
  - Lorsque désactivé (défaut), les suggestions restent en mode preview/notification et requièrent une validation explicite de l'utilisateur.
  - **Garde-fou de borne cumulée** : Si la dérive cumulée annuelle atteint $\pm 25\%$ vs `Budget.base_annual_amount`, le mode Full-Auto est automatiquement suspendu pour l'enveloppe concernée et une notification d'alerte invite à la révision manuelle.
- **Synchronisation `RecurrenceTemplate` → Enveloppes Budgétaires** :
  - Activation de la synchronisation automatique des templates de récurrence vers les enveloppes budgétaires (cf. Brique 5 §5.6 pour la spécification des cas couverts).
  - Hausse tarifaire ($N=3$), clôture de template, promotion de nouveau template → Suggestions d'ajustement d'enveloppe via le même pipeline que le lissage EMA.
  - Soumis au même mode de fonctionnement (suggestion par défaut, mutation si opt-in `auto_apply_budget_suggestions`).
- **Intégration Frontend & Intronisation du Switch (`static/index.html`, `app.js` & `setup_wizard.js`)** :
  - **Exposition de l'Interrupteur Maître** : Ajout du switch officiel d'activation Auto-Pilote dans les Réglages, dans le Setup Wizard (Étape 6/7) et dans le Centre de Contrôle, désormais adossé à l'ensemble du moteur validé.
  - Ajout du bouton de navigation `🤖 Auto-Pilote` (`data-view="autopilot"`) dans la barre desktop `.main-nav` ET dans le tiroir mobile `.mobile-nav`.
  - Ajout de la pastille d'état interactive `#autopilotHeaderBadge` dans `.header-actions` (à côté de la cloche des notifications).
  - Inclusion du script `<script src="/static/js/views/autopilot_view.js"></script>` dans `static/index.html`.
  - Routage dans `static/js/app.js` (`loadView('autopilot')`).
  - Styles CSS dédiés aux 4 panneaux et au badge dans `static/css/style.css`.
- **Bouclier de Fermeture Sécurisée & Fermeture Automatique (Tauri)** : Interception événementielle conjointe au niveau natif Rust dans `src-tauri/src/main.rs` (`WindowEvent::CloseRequested`) et webview (`tauri://close-requested`), consultation de l'état de synchronisation en cours via l'API `/api/bank-sync/status`, avec écran d'attente bref et fermeture automatique (`getCurrentWindow().destroy()`) dès validation du commit.
- **Option System Tray** : Possibilité de minimiser OmniBank dans la barre des tâches près de l'horloge au lieu de quitter (couche native Tauri 2.x).
- **Clés i18n requises (Étape 6)** — Liste exhaustive pour le Centre de Contrôle, Switch & Mutation Budgétaire :
  - Activation & États : `autopilot_switch_label`, `autopilot_switch_tooltip_disabled`, `autopilot_switch_tooltip_discovery`, `autopilot_state_learning`, `autopilot_state_cruising`, `autopilot_state_disabled`, `autopilot_wizard_intro_title`, `autopilot_wizard_intro_desc`
  - Navigation & Header : `nav_autopilot`, `autopilot_badge_active`, `autopilot_badge_learning`, `autopilot_badge_count`
  - Panneau Cockpit : `autopilot_kpi_operations_managed`, `autopilot_kpi_precision`, `autopilot_kpi_anomalies`, `autopilot_kpi_clicks_saved`
  - Decision Feed : `autopilot_feed_title`, `autopilot_feed_filter_all`, `autopilot_feed_filter_reconciliations`, `autopilot_feed_filter_categories`, `autopilot_feed_filter_recurrences`, `autopilot_feed_filter_budgets`
  - Actions : `autopilot_action_unpoint`, `autopilot_action_change_category`, `autopilot_action_rollback_cycle`, `autopilot_action_memorize_rule`, `autopilot_action_blacklist_merchant`, `autopilot_action_lock_budget`, `autopilot_action_rollback_budget`
  - Atelier : `autopilot_rules_title`, `autopilot_rules_merchants_tab`, `autopilot_rules_excluded_tab`, `autopilot_rules_budgets_tab`
  - Budgets Full-Auto : `autopilot_budget_auto_apply_toggle`, `autopilot_budget_auto_applied_toast`, `autopilot_budget_drift_annual_alert`, `autopilot_budget_recurrence_sync_suggestion`
  - Modales : `autopilot_confirm_rollback`, `autopilot_confirm_memorize`, `autopilot_tauri_closing_wait`
- Synchronisation bilingue des clés i18n (`fr.json` et `en.json` via script Python `utf-8-sig`).
- *Bénéfice immédiat* : L'utilisateur gagne une visibilité limpide, un contrôle absolu et une réversibilité totale à tout moment. Les ajustements budgétaires ne deviennent automatiques que sur activation explicite, avec rollback garanti.

---

## 7. Matrice de Validation & Cahier de Recette (Critères de Succès Pré-établis)

Chaque brique implantée doit faire l'objet d'une validation rigoureuse avant déploiement. Le tableau ci-dessous établit **à l'avance** le résultat exact attendu (au centime et à la milliseconde près) et le compare aux conditions réelles pour statuer objectivement sur le succès (**PASS**) ou l'échec (**FAIL**).

### Pack de Test 1 : Réactivité Déverrouillage, Cooldown & Cycle de Vie (Étape 1) — `✅ 100% PASS (v1.1.4)`

| Réf | Scénario & Conditions Initiales | Action Déclenchée | Résultat Attendu Pré-établi | Critère de Succès (PASS) | Statut |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **T1.1** | Coffre verrouillé, banque configurée, dernier relevé > 3h, `sync_on_vault_unlock = true`. | Appel `/api/bank-sync/vault/unlock` avec mot de passe valide. | Synchronisation démarrée en tâche de fond dans un délai $< 200$ ms (sans attendre la boucle de 60s). | `last_auto_sync_attempt` mis à jour en DB, log backend `[AutoPilot] Sync réactive déclenchée`. | ✅ **PASS** |
| **T1.2** | Application déverrouillée et synchronisée il y a 2 minutes (`cooldown = 3h`). | L'utilisateur verrouille puis re-déverrouille son coffre immédiatement. | Aucune requête HTTP vers la banque. Notification/infobulle : *"Prochain relevé dans 2h58"*. | 0 appel réseau vers Woob, zéro challenge 2FA déclenché. | ✅ **PASS** |
| **T1.3** | Application fermée pendant 15 jours (35 opérations en attente côté banque). | Déverrouillage après 15 jours d'absence (Mode Catch-Up). | Ingestion ordonnée chronologiquement de la plus ancienne à la plus récente. | Solde final calculé identique au centime près au solde bancaire officiel en 1 seul commit. | ✅ **PASS** |
| **T1.4** | Déverrouillage passif : Coffre verrouillé, `sync_on_vault_unlock = false`, relevé auto coché (intervalle 24h, TTL = 14j sur Docker ou session Tauri). | Appel `/api/bank-sync/vault/unlock` avec mot de passe valide. | Clé chargée en mémoire vive (`is_unlocked = True`), **0 requête réseau bancaire émise à T0**. Le planificateur périodique prend le relais et planifie le relevé à l'échéance programmée (24h). | Clé en RAM, 0 appel Woob émis au déverrouillage, prochain relevé programmé avec succès. | ✅ **PASS** |
| **T1.5** | Banque déclenchant un challenge 2FA / SCA mobile pendant le relevé périodique. | Cycle de relevé automatique exécuté en arrière-plan. | Le scheduler n'interrompt ni ne bloque le backend. Il émet un événement/notification *"Validation 2FA requise"* et met la session bancaire en attente. | Pas de thread bloqué, UI réactive avec pastille d'alerte claire. | ✅ **PASS** |
| **T1.6** | Relevé bancaire automatique ou sur déverrouillage rencontrant une erreur. | Déclenchement de la synchronisation en arrière-plan. | La notification émise indique la source précise (`vault_unlock`, `scheduled`, `manual`), et les erreurs successives pour un même compte sont dédupliquées in-place. | `trigger_source` fidèlement renseigné, zéro notification en doublon. | ✅ **PASS** |

---

### Pack de Test 2 : Auto-Rapprochement Haute Certitude vs Zone d'Arbitrage (Étape 2) — `✅ 100% PASS`

| Réf | Scénario & Conditions Initiales | Action Déclenchée | Résultat Attendu Pré-établi | Critère de Succès (PASS) | Statut |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **T2.1** | Prévision existante : Loyer 750,00 € au 01/10. Relevé bancaire : Débit 750,00 € "PRLV LOYER" le 02/10. | Exécution du moteur de rapprochement Auto-Pilote. | Score composite $\ge 90$ pts. Rapprochement automatique instantané en base (`reconciliation_date` renseigné). | L'opération est pointée, statut "Rapproché" vert, 0 clic utilisateur requis. | ✅ **PASS** |
| **T2.2** | Prévision existante : Retrait DAB 40,00 € au 05/10. Relevé : Débit 40,00 € "RETRAIT DAB" le 18/10 (écart de 13 jours). | Exécution du moteur de rapprochement. | Score composite calculé : 65 pts ($60 \le \text{Score} < 85$). | L'opération est maintenue dans le Sas d'attente avec statut *"Rapprochement suggéré"*. | ✅ **PASS** |
| **T2.3** | Deux prévisions identiques : Abonnement A (15,00 €) et Abonnement B (15,00 €). Débit bancaire : 15,00 € "ABO A". | Exécution du moteur avec détection d'anti-collision. | Rapprochement sur la prévision A grâce à la similarité textuelle. La prévision B reste ouverte. | Prévision A pointée, Prévision B intacte. | ✅ **PASS** |
| **T2.4** | Deux prévisions identiques : 25,00 € sans indice textuel. Débit bancaire : 25,00 € "DEBIT RETRAIT". | Exécution du moteur sans discriminant textuel. | Détection de collision homonyme : aucune prévision n'est auto-pointée, opération basculée dans le Sas d'attente. | `collision_detected = True`, décision laissée à l'arbitrage humain. | ✅ **PASS** |
| **T2.5** | Mode Auto-Pilote inactif (`auto_pilot_enabled = "false"`), correspondance parfaite (100 pts). | Ingestion d'un relevé bancaire. | Zéro auto-commit en base, 100% des opérations envoyées dans le Sas d'attente. | Workflow manuel classique rigoureusement préservé sans régression. | ✅ **PASS** |
| **T2.6** | Une opération a été auto-rapprochée en base avec traçabilité `ActionHistory`. | Déclenchement d'un Undo puis d'un Redo. | Undo : `reconciliation_date` repasse à `NULL`, solde et cache recalculés. Redo : pointage ré-appliqué. | Réversibilité comptable totale au centime près. | ✅ **PASS** |
| **T2.7** | Une décision d'auto-rapprochement est enregistrée par `AutoPilotService`. | Inspection de la table `AutopilotDecisionLog`. | Enregistrement structuré avec `batch_id`, `raw_snapshot` (JSON `before`/`after`), score $\ge 85$. | Auditabilité et traçabilité complètes de la décision robotique. | ✅ **PASS** |
| **T2.8** | Import d'un fichier de relevé via `/api/csv/import_to_pending` avec Auto-Pilote activé. | Ingestion du fichier CSV. | Le backend applique l'auto-rapprochement et renvoie le résumé `_autopilot_summary`. | `_autopilot_summary` injecté dans la réponse avec le décompte des auto-rapprochements. | ✅ **PASS** |

---

### Pack de Test 3 : Pipeline Smart Labels & Fallback IA / Déterministe (Étape 3) — `✅ 25/25 PASS (100%)`

| Réf | Scénario & Conditions Initiales | Action Déclenchée | Résultat Attendu Pré-établi | Critère de Succès (PASS) | Statut |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **T3.1** | Libellé brut : `CB CARREFOUR MARKET 7501 04/09`. Règle #1 existante dans `BankLabelMapping`. | Normalisation et affectation par `SmartLabelService`. | Libellé nettoyé : `"Carrefour"`. Catégorie : `"Alimentation"` (Score certitude: 100%). | Libellé propre et catégorie exacte résolus par règle déterministe. | ✅ **PASS** |
| **T3.2** | Libellé brut : `CB BOULANGERIE DU PARC 92` (Marchand inconnu, IA Ollama désactivée). | Résolution déterministe pure (mode sans IA). | Libellé nettoyé : `"Boulangerie Du Parc"`. Catégorie : `None` (*"À catégoriser"*). | **Zéro nouvelle catégorie créée**. Le nombre de catégories en base reste strictement invariant. | ✅ **PASS** |
| **T3.3** | Règle utilisateur marquée manuelle (`is_manual = True`). Import d'une transaction avec catégorie différente. | Appel d'apprentissage automatique via `learn_from_transaction`. | La règle manuelle est préservée sans modification, la catégorie de l'utilisateur n'est pas écrasée. | Protection absolue des configurations utilisateur (`is_manual` respecté). | ✅ **PASS** |
| **T3.4** | Première détection d'un nouveau marchand ($N = 1$). | Résolution du label et enregistrement. | Statut provisoire appliqué (`is_provisional = True`), pas d'affectation automatique rigide. | Évite le verrouillage prématuré au cold start. | ✅ **PASS** |
| **T3.5** | Deuxième détection concordante ($N \ge 2$) pour le même marchand. | Deuxième passage dans l'apprentissage progressif. | Confirmation de la règle, passage à `is_provisional = False`. | Apprentissage progressif stabilisé. | ✅ **PASS** |
| **T3.6** | Marchand généraliste caméléon (ex: `AMAZON`, `PAYPAL`). | Résolution par `SmartLabelService`. | Libellé nettoyé propre, mais `is_multi_category = True` et catégorie laissée ouverte. | Pas de fausse catégorie unique sur les commerçants multi-rayons. | ✅ **PASS** |
| **T3.7** | Historique montrant une dispersion catégorielle (ex: 50% Loisirs, 50% High-Tech). | Détection de dispersion par `_detect_category_dispersion`. | Neutralisation de l'auto-affectation, alerte d'ambiguïté. | Consensus $\ge 75\%$ exigé avant toute suggestion de catégorie. | ✅ **PASS** |
| **T3.8** | Modification ou bascule d'une règle dans l'Atelier. | Annulation via `undo_action` (`ActionHistory`). | Rétablissement de l'état antérieur exact (catégorie, mode manuel/auto, multi-cat). | Réversibilité totale 1-clic intégrée à l'audit trail. | ✅ **PASS** |
| **T3.9** | Sas d'attente / Cockpit de revue (`bank_sync_review.js`). | Affichage d'une écriture catégorisée. | Badge de transparence affiché (`🛡️ Règle manuelle`, `🤖 Règle apprise`, etc.) avec info-bulle explicative. | Clarté totale pour l'utilisateur sur la provenance de la décision. | ✅ **PASS** |
| **T3.10** | Libellé brut : `CB LEROY MERLIN BRICOLAGE` (Marchand inconnu, IA Ollama connectée). | Résolution avec fallback IA local groupé (`call_ollama_batch`). | Prompt JSON strict envoyé à Ollama avec les catégories existantes. | Catégorie choisie = `"Logement & Maison"` ou `"Bricolage"` en 1 seul batch. | ✅ **PASS** |
| **T3.11** | Dépense courante non ambiguë avec règle sanctuarisée ou certifiée ($\ge 85\%$) en mode Auto-Pilote. | Ingestion du lot par `process_incoming_batch`. | Enregistrement direct en base dans `Transaction` (`reconciliation_date`, `created_by="Auto-Pilote (Écriture)"`), log dans `AutopilotDecisionLog` (`new_entry`). | Écriture enregistrée sans clic, traçabilité `ActionHistory` et rollback opérationnels. | ✅ **PASS** |
| **T3.12** | Dépense caméléon multi-catégories (ex: Amazon) ou règle provisoire ($N=1$). | Ingestion du lot par `process_incoming_batch`. | Neutralisation de l'auto-commit direct, maintien de l'opération dans `residual_txs` (`pending_count > 0`). | Maintien strict de la zone d'arbitrage humain dans le Sas d'attente. | ✅ **PASS** |
| **T3.13** | Ingestion d'un fichier via la Dropzone avec 100% des écritures auto-traitées (`pending === 0`). | Réception du bilan par `openReviewFromCSV` (`import_wizard.js`). | Fermeture immédiate de la modale d'import, émission d'un toast récapitulatif enrichi (`autopilot_import_complete_toast`), actualisation des soldes. | Zéro ouverture de Sas vide, expérience utilisateur fluide et sans friction. | ✅ **PASS** |

---

### Pack de Test 3.5 : Filet de Sécurité Déterministe & Catégorisation IA Augmentée (Étape 3.5) — `✅ 10/10 PASS (100%)`

| Réf | Scénario & Conditions Initiales | Action Déclenchée | Résultat Attendu Pré-établi | Critère de Succès (PASS) | Statut |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **T3.5.1** | Dépense inconnue sans IA (`CB FLEURISTE DU COIN`). Aucune règle existante. | Résolution par `resolve_smart_labels_batch`. | Libellé propre `"Fleuriste Du Coin"`, Catégorie `"Dépenses diverses"` (ou synonyme existant). Pas d'insertion immédiate dans `Category`. | Catégorie fourre-tout assignée en mémoire, table `Category` intacte. | ✅ **PASS** |
| **T3.5.2** | Recette inconnue sans IA (`VIR INST MLLE MARINE PLAZA`). | Résolution par `resolve_smart_labels_batch`. | Libellé propre, Catégorie `"Revenus divers"` (type `income`). | Catégorie recette assignée, pas d'insertion DB prématurée. | ✅ **PASS** |
| **T3.5.3** | Marchand caméléon sans règle manuelle (`AMAZON PAYMENTS`). Mode sans IA. | Résolution par `resolve_smart_labels_batch`. | Description `"Amazon"`, Catégorie `"Dépenses diverses"`, `is_multi_category = True`. | Catégorie fourre-tout renseignée, drapeau caméléon préservé. | ✅ **PASS** |
| **T3.5.4** | Nouvelle catégorie IA valide proposée (`"Jardinage"` pour `CB TRUFFAUT`). | Ingestion avec `call_ollama_batch`. | Catégorie acceptée (longueur valide, pas d'artefact, pas de syntaxe). `category_is_new = True`. | Catégorie validée en mémoire, différée jusqu'au commit. | ✅ **PASS** |
| **T3.5.5** | Déchet ou hallucination IA (`"Voici la catégorie : {Boutique}"`). | Filtrage par `validate_ai_suggested_category`. | Déchet rejeté par le garde-fou anti-déchet → Repli déterministe sur `"Dépenses diverses"`. | Hallucination neutralisée, filet de sécurité activé. | ✅ **PASS** |
| **T3.5.6** | Garde-fou anti-prolifération : Lot avec 5 propositions de nouvelles catégories. | Analyse du lot par `_parse_and_validate_batch_response`. | Maximum 2 nouvelles catégories acceptées dans le lot. Les 3 suivantes basculent sur le filet de sécurité. | Seuil de saturation respecté (max 2), pas d'explosion de l'arbre. | ✅ **PASS** |
| **T3.5.7** | Proximité lexicale : IA propose `"Alimentations"` alors qu'`"Alimentation"` existe. | Test de similarité Levenshtein/Jaccard. | Détection de proximité ≥ 80% → Fusion automatique sur la catégorie existante `"Alimentation"`. | Pas de doublon singulier/pluriel créé. | ✅ **PASS** |
| **T3.5.8** | Auto-commit Auto-Pilote sur lot mixte (Amazon + virement + commerçant) avec Auto-Pilote actif. | Ingestion du lot par `AutoPilotService.process_incoming_batch()`. | 100% des opérations insérées en base, Sas d'attente vide (`pending = 0`), notification et fermeture dropzone. | Zéro opération résiduelle dans le Sas d'attente. | ✅ **PASS** |
| **T3.5.9** | Validation manuelle Sas (`commit_reviewed_transactions`). | Commit de transactions avec catégories fourre-tout et nouvelle IA. | Appel de `ensure_category_exists` → Les catégories manquantes sont insérées dans `Category` avec le bon type. | Intégrité relationnelle parfaite, catégories persistées en base. | ✅ **PASS** |
| **T3.5.10** | Protection de l'apprentissage sur les catégories fourre-tout. | Ingestion d'une écriture affectée à `"Dépenses diverses"`. | `learn_label_mapping` n'enregistre aucune règle automatique associant le marchand à `"Dépenses diverses"`. | Marchand non pollué, règle non dénaturée pour les futurs imports. | ✅ **PASS** |

---

### Pack de Test 4 : Détection & Promotion des Récurrences (Étape 4) — `✅ 100% PASS`

| Réf | Scénario & Conditions Initiales | Action Déclenchée | Résultat Attendu Pré-établi | Critère de Succès (PASS) | Statut |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **T4.1** | Débit Netflix 13,49 € constaté en M-1 et M-2 (2 mois consécutifs). Aucun template en DB. | Calcul du Reste à Vivre au 1er du mois M (avant prélèvement). | Le Reste à Vivre déduit in-memory 13,49 € d'anticipation de charge fixe. | Calcul exact : $\text{Reste à Vivre} - 13,49 \text{ €}$, mais **0 écriture de template en DB**. | ✅ **PASS** |
| **T4.2** | Débit Netflix 13,49 € prélevé pour le 3ème mois consécutif ($N = 3$). Mode Full-Auto actif. | Ingestion du 3ème prélèvement par l'Auto-Pilote. | Promotion automatique en `RecurrenceTemplate` (fréquence mensuelle, `expense_fixed`). | Modèle créé en base, catégorie passée en charge fixe, décision loggée. | ✅ **PASS** |
| **T4.3** | Paiement fractionné détecté : `PRLV ALMA 1/3 80,00 €` (ou `M1/4`). | Ingestion des échéances successives ($1/3 \to 2/3 \to 3/3$). | Détection de la signature fractionnée ($M/N$), création d'un template borné ($N = 3$ max) avec liaison rétroactive. À $M=N$ (Mois 3), clôture automatique (`is_closed = True`). | Extinction automatique confirmée au Mois 4 (0 débit, 0 génération), 4 templates actifs au M3. | ✅ **PASS** |

---

### Pack de Test 4.5 : Cycle de Vie Dynamique & Maintenance Autonome (Étape 4.5) — `✅ 100% PASS`

| Réf | Scénario & Conditions Initiales | Action Déclenchée | Résultat Attendu Pré-établi | Critère de Succès (PASS) | Statut |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **T4.5.1** | Forfait mobile prévu à 14,99 € le 20. Prélèvement reçu : `PRLV SOSH 35,99 €` (hors-forfait). | Exécution de la synchronisation bancaire avec auto-liaison active. | L'échéance de Septembre est automatiquement liée, pointée et ajustée à 35,99 €. Le template et les prévisions futures (Octobre...) restent à **14,99 €**. | Échéance pointée à 35,99 €, mois futurs intacts à 14,99 €, 0 doublon créé. | ✅ **PASS** |
| **T4.5.2** | Forfait mobile prévu à 14,99 €. Prélèvement reçu : `ORANGE 799,00 €` (achat smartphone). | Ingestion du lot par l'Auto-Pilote. | Détection du dépassement du plafond de tolérance ($> 3 \times$). Neutralisation de l'auto-liaison. | Opération maintenue dans le Sas d'attente pour arbitrage humain. | ✅ **PASS** |
| **T4.5.3** | Abonnement Spotify prévu à 10,99 €. Trois prélèvements successifs constatés à 11,99 € ($N=3$). | Ingestion du 3ème prélèvement consécutif à 11,99 €. | Constat de hausse pérenne : le template passe à 11,99 € et toutes les échéances futures non pointées sont actualisées. | Template à 11,99 €, mois futurs à 11,99 €, passé sanctuarisé à 10,99 €. | ✅ **PASS** |
| **T4.5.4** | Échéance salle de sport non débitée au 10 Août. Au 14 Septembre (+1 mois +3j), solde bancaire conforme ($|\Delta| < 0.005$), Sas vide. | Vérification de l'entretien automatique. | L'échéance d'Août est automatiquement marquée comme « Sautée » (`is_skipped = True`), libérant le Reste à Vivre. | `is_skipped = True`, calcul du Reste à Vivre actualisé, badge `Sauté auto`. | ✅ **PASS** |
| **T4.5.5** | Échéance non débitée, mais solde bancaire distant $\ne$ solde local, ou opérations en attente dans le Sas. | Routine d'auto-saut. | Condition de solde conforme non satisfaite : neutralisation absolue de l'auto-saut. | Aucun saut automatique déclenché tant que les soldes divergent ou que le Sas est garni. | ✅ **PASS** |
| **T4.5.6** | Abonnement salle de sport avec 3 occurrences consécutives sautées (`is_skipped = True`). | Déclenchement de l'entretien des récurrences. | Constat d'abandon/résiliation : clôture automatique du template (`is_closed = True`) et purge des futures occurrences. | Template clos, 0 génération future, décision notée dans le journal d'audit. | ✅ **PASS** |
| **T4.5.7** | Échéance auto-ajustée à 35,99 € par erreur ou souhait de régularisation. | Clic sur `[↩️ Rétablir montant initial]` dans l'UI ou appel endpoint. | Le montant repasse à 14,99 € (valeur du template) et le commentaire trace la restauration. | Montant rétabli à 14,99 €, commentaire explicite en base. | ✅ **PASS** |

---

### Pack de Test 5 : Analyse & Suggestion Budgétaire EMA — Mode Preview (Étape 5)

| Réf | Scénario & Conditions Initiales | Action Déclenchée | Résultat Attendu Pré-établi | Critère de Succès (PASS) | Critère d'Échec (FAIL) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T5.1** | Enveloppe "Carburant" fixée à 120,00 €. Synchronisation quotidienne du 12 du mois (plein de 65 €). | Exécution de la synchronisation bancaire courante. | Le montant de l'enveloppe Carburant reste **strictement fixé à 120,00 €**. Aucune suggestion émise en cours de mois. | Règle absolue anti-thrashing respectée : zéro calcul et zéro notification de budget en cours de mois. | Suggestion ou modification du budget pendant un jour ordinaire du mois. |
| **T5.2** | Budget N-1 = 100,00 €. Dépenses moyennes 3 mois constatées = 150,00 €. Date : 1er du mois. Mode suggestion (défaut). | Déclencheur du calcul mensuel (EMA $\alpha = 0.20$). | Suggestion calculée : $(0.80 \times 100) + (0.20 \times 150) = 80 + 30 = \mathbf{110,00 \text{ €}}$. Le montant en base reste à 100,00 €. | Suggestion de 110,00 € enregistrée dans `AutopilotDecisionLog`, notification émise, `Budget.monthly_amount` intact à 100,00 €. | Mutation directe du montant à 110 € ou 150 € sans approbation. |
| **T5.3** | Budget N-1 = 100,00 €. Dépense exceptionnelle ponctuelle de 600,00 € (panne auto). | Calcul mensuel avec filtre Winsorizing anti-anomalie. | L'anomalie de 600 € est écrêtée par Winsorizing. | La suggestion ne dépasse pas le plafond de dérive (+10% max soit 110 €). `Budget.monthly_amount` reste à 100,00 €. | Suggestion supérieure à 110 € ou mutation directe. |
| **T5.4** | Budget "Alimentation" fixé à 300,00 € (`base_annual_amount` = 300 €). Après 11 mois de légers dépassements, la suggestion EMA cumulée atteint 385 € (+28%). | Calcul mensuel au 12ème mois. | La borne cumulée annuelle ($\pm 25\%$) bloque la suggestion : max autorisé = 375 € (300 × 1.25). Notification d'alerte invitant à la révision manuelle. | Suggestion plafonnée à 375 €, notification de dérive cumulée émise. | Suggestion à 385 € dépassant la borne annuelle sans alerte. |
| **T5.5** | Enveloppe "Loisirs" (150 €) cadenassée par l'utilisateur (`is_locked = True`). Dépenses réelles = 220 €. | Calcul mensuel au 1er du mois. | Aucune suggestion émise pour cette enveloppe. | Enveloppe ignorée par le moteur, décision notée : *"Enveloppe protégée"*. | Suggestion ou notification pour une enveloppe verrouillée. |
| **T5.6** | Validation 1-clic de la suggestion T5.2 par l'utilisateur (110,00 €). | Approbation explicite via notification ou Dashboard. | `Budget.monthly_amount` passe à 110,00 €. Décision `budget_suggestion` mise à jour dans `AutopilotDecisionLog` (`is_applied = True`). | Mutation tracée avec `raw_snapshot` avant/après, rollback possible via `ActionHistory`. | Mutation sans traçabilité ou sans snapshot. |
| **T5.7** | Catégorie active "Pharmacie" (3 débits de 25 €) non couverte par un budget. Mode déterministe (sans IA). | Exécution de la découverte des catégories orphelines. | Détection déterministe de la catégorie non couverte, calcul du montant d'amorçage (75,00 €). Suggestion de création émise dans `AutopilotDecisionLog` (`decision_type = 'budget_creation_suggestion'`, `action = 'SUGGESTED'`). | Proposition créée en base d'audit, 0 budget créé prématurément, notification émise. | Aucune suggestion émise ou création forcée sans accord. |
| **T5.8** | Suggestion de création d'enveloppe T5.7 présente dans l'UI. L'utilisateur clique sur `[Ignorer / Refuser]`. | Rejet explicite via endpoint `/api/budgets/autopilot/suggestions/{id}/dismiss`. | La décision passe à `action = 'DISMISSED'` dans `AutopilotDecisionLog`. Lors de l'import suivant avec des dépenses "Pharmacie", aucune suggestion de création n'est ré-émise. | Règle anti-harcèlement respectée : catégorie refusée non reproposée. | Suggestion ré-émise en boucle à chaque import. |
| **T5.9** | Base en phase Cold-Start (< 60 jours, 1 seule enveloppe active). Import d'un nouveau fichier de relevé avec nouvelle catégorie "Bricolage". | Ingestion par `process_incoming_batch`. | En Cold-Start, l'analyse des catégories orphelines est déclenchée immédiatement post-batch : suggestion de création pour "Bricolage" générée au fil de l'eau. | Réactivité Cold-Start confirmée sans attendre la fin du mois. | Blocage jusqu'au 1er du mois privant l'utilisateur de budget. |

---

### Pack de Test 6 : Centre de Contrôle, Rétroaction 1-Clic & Rollback (Étape 6)

| Réf | Scénario & Conditions Initiales | Action Déclenchée | Résultat Attendu Pré-établi | Critère de Succès (PASS) | Critère d'Échec (FAIL) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T6.1** | Une opération a été auto-rapprochée avec la prévision #102. | L'utilisateur clique sur `[↩️ Dépointer]` dans le Centre de Contrôle. | `reconciliation_date` repasse à `NULL`. La prévision #102 repasse en statut ouvert. | Dépointage instantané sans altération des montants ni suppression des écritures. | Suppression par erreur de l'écriture ou incohérence de solde. |
| **T6.2** | Marchand "LIDL" classé en "Alimentation" par l'Auto-Pilote. | L'utilisateur modifie la catégorie vers "Bricolage" et coche *"Mémoriser pour le futur"*. | Mise à jour de la transaction + Inscription immédiate de la règle dans `BankLabelMapping`. | Prochain relevé avec "LIDL" automatiquement classé en "Bricolage". | Règle non mémorisée ou oubliée lors du relevé suivant. |
| **T6.3** | Un relevé de 6 opérations a été auto-validé ce matin à 08:30 (4 nouvelles écritures, 2 rapprochements de prévisions). | L'utilisateur clique sur `[⏪ Annuler ce cycle]` sur l'en-tête du relevé. | Les 4 écritures créées (`new_entry`) sont supprimées de `Transaction`, les 2 prévisions rapprochées (`reconciliation`) sont dissociées (`reconciliation_date = NULL` et snapshot restauré sans suppression), et le lot complet de 6 opérations est replacé dans le Sas `_PENDING_SYNC_DATA`. Toutes les décisions passent à `is_undone = True`. | Retour à l'état exact antérieur au centime près, prévisions de l'utilisateur intactes, données restaurées dans le Sas. | Suppression par erreur des prévisions rapprochées, restes d'écritures fantômes ou perte des données du Sas. |
| **T6.4** | Une enveloppe "Loisirs" (150 €) a été cadenassée par l'utilisateur. | Recalibrage mensuel au 1er du mois (dépenses réelles constatées = 220 €). | L'Auto-Pilote détecte le cadenas et ignore l'enveloppe Loisirs. | Montant conservé à 150,00 € sans modification. Décision notée : *"Enveloppe protégée"*. | Modification automatique d'une enveloppe verrouillée. |
| **T6.5** | Synchronisation en cours d'écriture (commit de 20 opérations). | L'utilisateur clique sur la croix [X] de la fenêtre Tauri Desktop. | Rust (`src-tauri/src/main.rs`) et l'UI interceptent `WindowEvent::CloseRequested`, affichent le voile d'attente, terminent le commit atomique puis ferment la fenêtre ($< 4$s). | Base SQLite saine (0 écriture partielle), fermeture auto réussie sans crash ni corruption. | Fenêtre tuée brutalement via `taskkill /F` en plein commit ou freeze infini. |

---

## 8. Banc d'Essai Global : Dataset de Référence Cold-Start (4 Mois Réels)

Pour valider l'ensemble des briques en conditions réelles sans dépendre d'une banque en ligne vivante, un jeu complet de données de benchmark bancaire est stocké sous [`tests/autopilot_benchmark/`](file:///d:/Code%20Projects/OmniBank-Local/tests/autopilot_benchmark/) :

- **Solde initial (31/08/2026)** : `1 500,00 €`
- **Compte** : `Compte de dépôt N° 00012345678`
- **Précision comptable** : Continuité au centime sans aucune dérive sur les 4 mois.

### Table de Continuité des Soldes du Benchmark

| Fichier | Mois | Total Crédits | Total Débits | Solde Fin de Mois | Opérations Clés Éprouvées |
| :--- | :--- | :---: | :---: | :---: | :--- |
| [`mois_01_septembre_2026.csv`](file:///d:/Code%20Projects/OmniBank-Local/tests/autopilot_benchmark/mois_01_septembre_2026.csv) | Septembre 2026 | `+2 400,00 €` | `-1 295,48 €` | **`2 604,52 €`** | Cold start, 1ère détection de charges candidates, Alma 1/3 (80 €). |
| [`mois_02_octobre_2026.csv`](file:///d:/Code%20Projects/OmniBank-Local/tests/autopilot_benchmark/mois_02_octobre_2026.csv) | Octobre 2026 | `+2 400,00 €` | `-1 638,18 €` | **`3 366,34 €`** | Détection Niveau 1 (in-memory $N=2$), Alma 2/3 (80 €), Dépense exceptionnelle garage (-380 €). |
| [`mois_03_novembre_2026.csv`](file:///d:/Code%20Projects/OmniBank-Local/tests/autopilot_benchmark/mois_03_novembre_2026.csv) | Novembre 2026 | `+2 464,50 €` | `-1 290,68 €` | **`4 540,16 €`** | **Promotion Full-Auto ($N=3$)** : 4 templates créés en DB, Alma 3/3 soldé et clôturé, Virement CPAM (+64,50 €). |
| [`mois_04_decembre_2026.csv`](file:///d:/Code%20Projects/OmniBank-Local/tests/autopilot_benchmark/mois_04_decembre_2026.csv) | Décembre 2026 | `+3 250,00 €` | `-1 534,18 €` | **`6 255,98 €`** | Rapprochement sur templates officiels, Salaire + Prime (+750 €), Étrennes (+100 €), **Zéro Alma** (extinction validée). |

Consulter le guide complet et les assertions détaillées dans [`tests/autopilot_benchmark/README.md`](file:///d:/Code%20Projects/OmniBank-Local/tests/autopilot_benchmark/README.md).

### Validation du Dataset de Benchmark (Intégrité Mathématique CSV)

Le fichier de validation du dataset de référence est exécutable dans :
👉 [`tests/test_autopilot_benchmark.py`](file:///d:/Code%20Projects/OmniBank-Local/tests/test_autopilot_benchmark.py)

Commande d'exécution :
```powershell
python -m pytest tests/test_autopilot_benchmark.py -v
```

> [!NOTE]
> **Nature exacte de cette suite de tests (Validation du Jeu de Données)** :
> Ce fichier valide actuellement **l'intégrité mathématique et la cohérence des 4 fichiers CSV de référence** (continuité des soldes au centime, extraction regex des marchands via `SmartLabelService`, détection regex de l'échelonnement Alma $1/3 \to 2/3 \to 3/3$).
> Il **ne teste pas encore le moteur applicatif Auto-Pilote** lui-même (qui est en cours de développement au fil des étapes 1 à 6). Les futurs tests d'intégration applicatifs viendront brancher les véritables services d'ingestion et de décision sur ce jeu de données de référence.

Cette suite valide automatiquement les 5 axes fonctionnels critiques du dataset :
1. `test_benchmark_balance_continuity_across_4_months` : Contrôle au centime de l'équation de solde sur les 4 mois sans dérive ($1500 \to 2604.52 \to 3366.34 \to 4540.16 \to 6255.98$).
2. `test_smart_label_normalization_on_benchmark` : Extraction et nettoyage des marchands (Carrefour, EDF, Foncia, Spotify, Freebox, CPAM).
3. `test_fractional_payment_lifecycle_alma` : Cycle de vie du paiement 3x ($1/3 \to 2/3 \to 3/3 \to$ extinction confirmée au M4 avec zéro prélèvement).
4. `test_recurrence_progressive_promotion` : Transition d'apprentissage $N=1$ (neutre), $N=2$ (in-memory candidate), $N=3$ (promotion en base de 4 `RecurrenceTemplate`), et M4 (rapprochement sans doublon).
5. `test_salary_base_and_bonus_segregation` : Reconnaissance du salaire récurrent ACME CORP (2 400 €) et isolation de la prime annuelle (+750 €) et des étrennes (+100 €).

---

### Protocole de Test E2E Navigateur (Agent Browser Playbook)

> [!IMPORTANT]
> **Statut de ce Protocole : Spécification Cible (Cahier de Recette TDD / Acceptance Criteria)**
> Ce playbook constitue le contrat d'acceptation de bout en bout (**Acceptance Criteria**) de la vision cible.
> **À ce jour**, si ce test est joué immédiatement, il échoue intentionnellement dès l'Étape 1 (l'interrupteur Auto-Pilote n'existant pas encore dans le wizard) et à l'Étape 4 (les 4 templates n'étant pas encore promus automatiquement par le backend).
> L'objectif de la feuille de route est de faire passer ce scénario de **RED** à **GREEN** au fur et à mesure de l'implémentation des Étapes 1 à 6.

Pour éprouver l'expérience utilisateur complète et les interactions UI en conditions réelles, le protocole pas à pas destiné à un **Agent Browser** est formalisé dans :
👉 [`tests/autopilot_benchmark/E2E_BROWSER_TEST_SCENARIO.md`](file:///d:/Code%20Projects/OmniBank-Local/tests/autopilot_benchmark/E2E_BROWSER_TEST_SCENARIO.md)

Ce playbook pilote l'agent navigateur à travers :
1. **Étape 0 & 1** : Création du profil maître neuf `Test E2E Auto-Pilote` et parcours complet du **Setup Wizard** (thème Bento, compte courant initialisé à `1 500,00 €`, salaire cold-start, sélection mode d'entrée Import relevé, **activation du switch Auto-Pilote**).
2. **Étape 2 (Mois 1)** : Dépôt du CSV de Septembre $\to$ contrôle du solde (`2 604,52 €`), des 12 transactions nettoyées et de l'absence de récurrence prématurée.
3. **Étape 3 (Mois 2)** : Dépôt du CSV d'Octobre $\to$ contrôle du solde (`3 366,34 €`), apparition des charges candidates in-memory dans le Reste à Vivre, et franchissement de l'échéance Alma 2/3.
4. **Étape 4 (Mois 3)** : Dépôt du CSV de Novembre $\to$ contrôle du solde (`4 540,16 €`), **officialisation visuelle des 4 templates de récurrence** dans l'onglet Récurrences, clôture d'Alma 3/3, et consultation du flux d'audit dans le Centre de Contrôle.
5. **Étape 5 (Mois 4)** : Dépôt du CSV de Décembre $\to$ contrôle du solde final (**`6 255,98 €`**), pointage 1:1 sans doublon sur les prévisions existantes, vérification de l'absence totale de débit Alma et isolation du bonus de fin d'année.
6. **Étape 6** : Rapport de conformité comparant l'état final réel de l'UI avec la matrice de prédictions.

> [!CAUTION]
> **Consigne Impérative Fail-Fast pour l'Agent Browser** :
> En cas d'anomalie, d'écart de solde (même d'un centime) ou d'échec d'une assertion à une étape $M$, **l'Agent Browser a pour consigne stricte de stopper immédiatement le test**. Il est formellement interdit de charger le mois $M+1$ sur un état corrompu. L'agent prend une capture d'écran, extrait la console/logs et émet un rapport d'incident instantané pour arbitrage.
