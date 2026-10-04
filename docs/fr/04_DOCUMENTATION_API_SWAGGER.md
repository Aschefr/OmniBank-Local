# 🌐 Documentation Exhaustive de l'API REST & Swagger (OpenAPI)

Bienvenue dans la référence officielle de l'API REST d'**OmniBank Local**.

Cette documentation décrit l'ensemble des points d'accès (endpoints), formats de données, en-têtes et comportements du serveur backend Python FastAPI propulsant OmniBank Local.

---

## 🧭 Sommaire

1. [Principes Généraux & Souveraineté des Données](#1-principes-généraux--souveraineté-des-données)
2. [Accès aux Outils Swagger UI & ReDoc](#2-accès-aux-outils-swagger-ui--redoc)
3. [Architecture Multi-Profils & En-têtes HTTP](#3-architecture-multi-profils--en-têtes-http)
4. [Référence des 26 Domaines d'API](#4-référence-des-26-domaines-dapi)
   - [Transactions & Opérations](#41-transactions--opérations-transactions)
   - [Comptes Bancaires](#42-comptes-bancaires-accounts)
   - [Catégories & Arborescence](#43-catégories--arborescence-categories)
   - [Budgets & Enveloppes](#44-budgets--enveloppes-budgets)
   - [Centre de Contrôle Auto-Pilote](#45-centre-de-contrôle-auto-pilote-autopilot)
   - [Récurrences & Échéancier](#46-récurrences--échéancier-recurrences)
   - [Synchronisation Bancaire Directe (Woob)](#47-synchronisation-bancaire-directe-bank-sync)
   - [Normalisation Intelligente (Smart Labels)](#48-normalisation-intelligente-smart-labels)
   - [Assistant IA & RAG Local (Ollama)](#49-assistant-ia--rag-local-chat--ai)
   - [Statistiques, Reste à Vivre & Bilans](#410-statistiques-reste-à-vivre--bilans-stats)
   - [Simulateur Patrimonial & Prospective](#411-simulateur-patrimonial--prospective-simulator)
   - [Journal d'Audit & Undo/Redo](#412-journal-daudit--undoredo-history)
   - [Gestion des Profils & Cloisonnement](#413-gestion-des-profils--cloisonnement-profiles--cross-profile)
   - [Pipeline d'Importation & Export CSV](#414-pipeline-dimportation--export-csv-csv)
   - [Sauvegardes & Auto-Backup](#415-sauvegardes--auto-backup-backup--auto_backup)
   - [Maintenance & Santé de la Base](#416-maintenance--santé-de-la-base-maintenance)
   - [Centre de Notifications & Alertes](#417-centre-de-notifications--alertes-notifications)
   - [Configuration & Préférences](#418-configuration--préférences-config)
   - [Licence & Mode Organisation (CSE / Assos)](#419-licence--mode-organisation-license--orgusers)
   - [Diagnostics & Surveillance Système](#420-diagnostics--surveillance-système-diagnostics--system)
5. [Exemples Pratiques d'Intégration](#5-exemples-pratiques-dintégration)
6. [Régénération des Schémas OpenAPI](#6-régénération-des-schémas-openapi)

---

## 1. Principes Généraux & Souveraineté des Données

OmniBank Local est bâtie selon les principes stricts du **Local-First** et du **Zero-Cloud** :
- **Stockage Local** : Toutes les écritures et lectures s'effectuent sur des bases de données SQLite sur votre machine (`data/omnibank.db` ou profil dédié).
- **Zéro Télémétrie** : Aucun log, token d'analyse ou paquet de statistiques n'est expédié vers l'extérieur.
- **IA Hors-Ligne** : Toutes les requêtes d'enrichissement et de chat IA communiquent exclusivement avec l'instance locale d'**Ollama** (`http://localhost:11434`).
- **Compatibilité OpenAPI 3.1** : L'intégralité du contrat d'API est formalisée selon le standard OpenAPI v3.1.0.

---

## 2. Accès aux Outils Swagger UI & ReDoc

Lorsque le serveur OmniBank Local est démarré (par défaut sur le port `8434`), plusieurs interfaces de consultation et d'expérimentation sont disponibles :

| Interface | URL Locale | Caractéristiques |
| :--- | :--- | :--- |
| **Swagger UI** | [http://localhost:8434/docs](http://localhost:8434/docs) | Bac à sable interactif : exécutez vos requêtes en temps réel ("Try it out"), inspectez les payloads JSON et les réponses types. |
| **ReDoc** | [http://localhost:8434/redoc](http://localhost:8434/redoc) | Documentation navigable optimisée pour la lecture technique et la consultation hors-ligne. |
| **OpenAPI Schema (JSON)** | [http://localhost:8434/openapi.json](http://localhost:8434/openapi.json) | Spécification brute OpenAPI 3.1.0 générée dynamiquement. |
| **Fichiers Locaux Statiques** | `docs/api/openapi.json`<br>`docs/api/openapi.yaml` | Fichiers physiques pré-générés pour importation directe dans Postman, Insomnia ou un générateur de code. |

### 🔒 Garantie 100% Hors-Ligne (Zero CDN)
Contrairement aux configurations par défaut de FastAPI qui s'appuient sur `cdn.jsdelivr.net`, OmniBank Local embarque physiquement les assets Swagger UI et ReDoc dans `static/vendor/swagger-ui/`. Vous pouvez ainsi ouvrir `/docs` et `/redoc` en avion, sans connexion internet ou sur un réseau d'entreprise isolé.

---

## 3. Architecture Multi-Profils & En-têtes HTTP

L'application permet d'isoler des profils distincts (ex: *Personnel*, *Professionnel*, *Association*).

### En-tête `X-Profile-ID`
Pour cibler la base de données d'un profil particulier lors d'un appel REST :
```http
GET /api/transactions/ HTTP/1.1
Host: 127.0.0.1:8434
X-Profile-ID: association_loi_1901
```
*Si cet en-tête n'est pas fourni, le backend opère automatiquement sur le profil actuellement actif en mémoire.*

### En-têtes Standard
- `Content-Type: application/json` pour toute requête `POST`, `PUT` ou `PATCH` transmettant un corps JSON.
- `Cache-Control: no-store, no-cache` : injecté automatiquement par le middleware backend pour empêcher le cache navigateur des données financières privées.

---

## 4. Référence des 26 Domaines d'API

### 4.1. Transactions & Opérations (`transactions`)

Le module transactions gère le cycle de vie de chaque flux financier : saisie manuelle, modification, ventilation budgétaire, pointage et rapprochement bancaire.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/transactions/` | Liste paginée et filtrée des opérations (recherche texte, compte, statut de pointage, intervalle de dates). |
| `POST` | `/api/transactions/` | Création d'une nouvelle opération financière (dépense, recette ou virement). |
| `PUT` | `/api/transactions/{transaction_id}` | Modification complète d'une opération existante (recalcul automatique des soldes associés). |
| `DELETE` | `/api/transactions/{transaction_id}` | Suppression d'une opération et rétablissement du solde du compte. |
| `POST` | `/api/transactions/{transaction_id}/reconcile` | Pointage / Rapprochement bancaire d'une transaction avec horodatage. |
| `GET` | `/api/transactions/descriptions` | Autocomplétion intelligente des libellés usuels et commerçants récents. |
| `GET` | `/api/transactions/autopilot/history` | Historique des opérations modifiées de manière autonome par l'Auto-Pilote. |

**Exemple de payload de création (`POST /api/transactions/`) :**
```json
{
  "date_operation": "2026-10-03",
  "date_saisie": "2026-10-03",
  "description": "Courses Bio Marché",
  "amount": -64.80,
  "type": "expense_var",
  "category": "Alimentation",
  "from_account_id": 1,
  "to_account_id": null
}
```

---

### 4.2. Comptes Bancaires (`accounts`)

Gestion du référentiel des comptes (Courants, Épargne, Titres, Espèces).

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/accounts/` | Liste exhaustive des comptes avec solde calculé en temps réel et solde pointé. |
| `POST` | `/api/accounts/` | Création d'un nouveau compte bancaire (type, solde initial, couleur, devise). |
| `PUT` | `/api/accounts/{acc_id}` | Mise à jour des informations d'un compte (nom, couleur, type). |
| `DELETE` | `/api/accounts/{acc_id}` | Clôture ou suppression d'un compte. |
| `PUT` | `/api/accounts/{acc_id}/balance` | Ajustement forcé du solde initial d'ouverture. |

---

### 4.3. Catégories & Arborescence (`categories`)

Arborescence personnalisée des dépenses fixes, variables, revenus et virements internes.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/categories/` | Arbre complet des catégories avec leurs sous-catégories et propriétés visuelles (icône, couleur). |
| `POST` | `/api/categories/` | Ajout d'une nouvelle catégorie ou sous-catégorie rattachée à un parent. |
| `PUT` | `/api/categories/{cat_id}` | Renommage ou ajustement des métadonnées d'une catégorie. |
| `DELETE` | `/api/categories/{cat_id}` | Suppression d'une catégorie (avec réaffectation optionnelle des transactions). |
| `GET` | `/api/categories/averages` | Calcul des moyennes historiques mensuelles de consommation par catégorie. |

---

### 4.4. Budgets & Enveloppes (`budgets`)

Pilotage des enveloppes budgétaires mensuelles, annuelles et par projet.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/budgets/` | Récupération des enveloppes avec consommation constatée, reste à dépenser et alertes. |
| `POST` | `/api/budgets/` | Création d'une enveloppe budgétaire (plafond, période, catégories associées). |
| `PUT` | `/api/budgets/{budget_id}` | Ajustement du montant ou des limites d'une enveloppe. |
| `DELETE` | `/api/budgets/{budget_id}` | Clôture ou suppression d'un budget. |
| `POST` | `/api/budgets/copy-previous` | Duplication automatique des budgets du mois précédent sur le mois en cours. |
| `GET` | `/api/budgets/history` | Historique de consommation et respect des plafonds sur 12 mois glissants. |

---

### 4.5. Centre de Contrôle Auto-Pilote (`autopilot`)

Moteur autonome de détection d'opportunités, recalibrage prédictif par lissage exponentiel (EMA), saut automatique et registre de décisions réversibles.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/autopilot/status` | Rapport d'état complet de l'Auto-Pilote (mode actif, score de confiance, file de revue). |
| `POST` | `/api/autopilot/toggle` | Activation / Désactivation du mode maître Auto-Pilote. |
| `POST` | `/api/autopilot/preset` | Application d'un préréglage d'autonomie (`balanced`, `full_auto`, `conservative`). |
| `GET` | `/api/autopilot/decisions` | Registre horodaté des décisions autonomes avec snapshots différentiels. |
| `POST` | `/api/autopilot/decisions/{id}/revert` | Annulation chirurgicale d'une décision prise par l'Auto-Pilote. |
| `POST` | `/api/autopilot/evaluate-now` | Déclenchement forcé d'un cycle d'analyse prédictive. |

---

### 4.6. Récurrences & Échéancier (`recurrences`)

Modélisation des abonnements et factures périodiques, avec prévisions d'échéances.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/recurrences/` | Liste des modèles de récurrence (loyer, abonnements, salaire, fréquence). |
| `POST` | `/api/recurrences/` | Création d'un modèle d'échéance récurrente. |
| `PUT` | `/api/recurrences/{tpl_id}` | Modification d'un modèle (montant, jour de prélèvement, périodicité). |
| `POST` | `/api/recurrences/generate` | Génération et matérialisation des échéances dues en transactions réelles. |
| `POST` | `/api/recurrences/{tpl_id}/close` | Résiliation / Clôture d'un abonnement récurrent. |

---

### 4.7. Synchronisation Bancaire Directe (`bank-sync`)

Gestion locale des connexions bancaires automatisées via Woob, coffre-fort d'identifiants chiffré AES-256 (Fernet) et sas d'intégrité.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/bank-sync/backends` | Liste des connecteurs bancaires disponibles (banques supportées). |
| `GET` | `/api/bank-sync/connections` | Liste des connexions configurées dans le profil actif. |
| `POST` | `/api/bank-sync/connections` | Ajout et chiffrement local d'une nouvelle connexion bancaire. |
| `POST` | `/api/bank-sync/sync-now` | Lancement d'une synchronisation locale des comptes et opérations. |
| `GET` | `/api/bank-sync/pending` | Examen des opérations en attente dans le sas de validation sécurisé. |
| `POST` | `/api/bank-sync/pending/validate` | Approbation et injection des opérations dans le grand livre. |

---

### 4.8. Normalisation Intelligente (`smart-labels`)

Moteur d'apprentissage automatique des tiers marchands et règles de pré-catégorisation.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/api/smart-labels/resolve-batch` | Résolution d'un lot de libellés bruts vers catégories et tiers nettoyés. |
| `POST` | `/api/smart-labels/simulate` | Simulation de l'évaluation d'un libellé bancaire sans écriture en base. |
| `GET` | `/api/smart-labels/mappings` | Liste ordonnée des correspondances apprises. |
| `POST` | `/api/smart-labels/mappings` | Création ou mise à jour manuelle d'une règle d'apprentissage. |
| `DELETE` | `/api/smart-labels/mappings/{mapping_id}` | Suppression d'une règle marchande. |

---

### 4.9. Assistant IA & RAG Local (`chat` & `ai`)

Chat financier contextuel 100% hors-ligne connecté à Ollama avec Function Calling.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/chat/sessions` | Liste des sessions de conversation avec l'assistant. |
| `POST` | `/api/chat/sessions` | Démarrage d'une nouvelle session de discussion. |
| `POST` | `/api/chat/sessions/{id}/message` | Envoi d'un message utilisateur et streaming SSE de la réponse IA enrichie par RAG. |
| `POST` | `/api/ai/categorize` | Prédiction heuristique de la catégorie d'une transaction sans LLM. |
| `POST` | `/api/ai/categorize_batch` | Traitement par lot de catégorisation automatique. |

---

### 4.10. Statistiques, Reste à Vivre & Bilans (`stats`)

Moteur de calcul analytique pour les tableaux de bord et rapports financiers.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/stats/dashboard` | Données consolidées du tableau de bord (solde global, dépenses du mois, reste à vivre). |
| `GET` | `/api/stats/accounts` | Évolution temporelle des soldes pour génération des courbes Chart.js. |
| `GET` | `/api/stats/categories-breakdown` | Répartition sectorielle des dépenses par catégorie (camemberts / jauges). |
| `GET` | `/api/stats/monthly-summary` | Bilan comparatif entrées / sorties par mois sur 1 à 5 ans. |

---

### 4.11. Simulateur Patrimonial & Prospective (`simulator`)

Projections financières pluriannuelles (1 à 30 ans), multi-scénarios, inflation et événements de vie.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/simulator/presets` | Bibliothèque de scénarios prêts à l'emploi (Achat immobilier, Retraite, Coup dur). |
| `GET` | `/api/simulator/scenarios` | Liste des scénarios personnalisés enregistrés dans le profil. |
| `POST` | `/api/simulator/scenarios` | Création d'un scénario de prospective patrimoniale. |
| `POST` | `/api/simulator/scenarios/{id}/run` | Calcul et projection de la trajectoire de trésorerie sur la période cible. |

---

### 4.12. Journal d'Audit & Undo/Redo (`history`)

Traçabilité exhaustive de toutes les mutations, différentiels JSON et annulation chirurgicale (`Ctrl+Z`).

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/history` | Journal d'audit complet paginé des actions effectuées par les utilisateurs ou l'IA. |
| `GET` | `/api/history/{action_id}/check` | Vérification de sécurité préalable avant tentative d'annulation. |
| `POST` | `/api/history/{action_id}/undo` | Annulation de l'action (`Undo`), restaurant l'état antérieur exact. |
| `POST` | `/api/history/{action_id}/redo` | Rétablissement de l'action précédemment annulée (`Redo`). |

---

### 4.13. Gestion des Profils & Cloisonnement (`profiles` & `cross-profile`)

Gestion des profils de données étanches et transferts inter-profils.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/profiles/` | Liste des profils configurés avec mention du profil actif en cours. |
| `POST` | `/api/profiles/` | Création d'un profil avec cloisonnement immédiat de sa base SQLite. |
| `POST` | `/api/profiles/switch` | Basculement immédiat du contexte vers un autre profil sans redémarrage. |
| `POST` | `/api/cross-profile/transfer` | Création d'un virement miroir sécurisé entre deux profils distincts. |
| `GET` | `/api/cross-profile/pending` | Récupération des opérations inter-profils en attente d'approbation. |

---

### 4.14. Pipeline d'Importation & Export CSV (`csv`)

Détection de dialectes bancaires, élimination des doublons et réconciliation de relevés.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/api/csv/import` | Analyse, parsing et importation d'un fichier de relevé bancaire CSV. |
| `GET` | `/api/csv/export` | Exportation du grand livre des transactions au format CSV universel. |
| `POST` | `/api/csv/save_account_mapping` | Enregistrement de correspondances de colonnes réutilisables. |

---

### 4.15. Sauvegardes & Auto-Backup (`backup` & `auto_backup`)

Système de sauvegarde à chaud, instantanés de sécurité et rotation automatisée.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/backup/download` | Téléchargement d'une archive ZIP complète du profil actif (base SQLite + justificatifs). |
| `POST` | `/api/backup/upload` | Restauration d'une sauvegarde dans le profil actif courant. |
| `GET` | `/api/backup/download-all` | Sauvegarde globale de l'ensemble des profils et métadonnées système. |
| `GET` | `/api/backup/auto/status` | Statut du planificateur de sauvegardes périodiques et historique des instantanés. |
| `POST` | `/api/backup/auto/trigger` | Déclenchement manuel immédiat d'une sauvegarde automatique. |

---

### 4.16. Maintenance & Santé de la Base (`maintenance`)

Outils d'optimisation bas niveau pour la base SQLite.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `POST` | `/api/maintenance/vacuum` | Exécution de l'opération `VACUUM` SQLite pour défragmenter et réduire la taille disque. |
| `GET` | `/api/maintenance/integrity-check` | Vérification de conformité `PRAGMA integrity_check`. |
| `POST` | `/api/maintenance/recalculate-balances` | Recalcul complet et mise en conformité de tous les soldes de comptes. |

---

### 4.17. Centre de Notifications & Alertes (`notifications`)

Alertes de gestion financière et synthèse proactive.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/notifications` | Liste des notifications actives (alertes budget, échéances à venir, anomalies). |
| `GET` | `/api/notifications/counts` | Synthèse chiffrée des alertes non lues. |
| `PUT` | `/api/notifications/{id}/read` | Marquer une notification comme lue. |
| `PUT` | `/api/notifications/read-all` | Marquer l'ensemble des notifications comme lues. |

---

### 4.18. Configuration & Préférences (`config`)

Paramètres globaux, devise, langue et connexion à l'IA locale.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/config/` | Récupération de l'ensemble des clés de configuration active. |
| `POST` | `/api/config/` | Mise à jour des paramètres (langue `fr`/`en`, devise, seuils planchers). |
| `GET` | `/api/config/ollama/models` | Détection locale des modèles LLM installés dans Ollama (`/api/tags`). |

---

### 4.19. Licence & Mode Organisation (`license` & `OrgUsers`)

Gestion de la clé de licence OmniBank et permissions pour CSE et associations.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/license/status` | Vérification du statut de la licence active (Particulier ou Organisation). |
| `POST` | `/api/license/activate` | Validation cryptographique et activation d'une clé de licence. |
| `GET` | `/api/org_users/` | Liste des utilisateurs et trésoriers autorisés en Mode Organisation. |
| `POST` | `/api/org_users/` | Création d'un nouvel utilisateur avec rôle spécifique (Admin, Éditeur, Lecteur). |

---

### 4.20. Diagnostics & Surveillance Système (`diagnostics` & `system`)

Santé de l'infrastructure backend et endpoints techniques.

| Méthode | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Vérification de disponibilité du serveur HTTP (retourne `{"status": "ok"}`). |
| `GET` | `/api/version` | Version courante de l'application extraite de `package.json`. |
| `GET` | `/api/changelog` | Historique dynamique des versions et notes de publication de `CHANGELOG.md`. |
| `POST` | `/api/upload` | Téléversement sécurisé de justificatifs ou documents attachés (limite 50 Mo). |
| `GET` | `/api/diagnostics/report` | Rapport technique anonymisé pour le dépannage et support. |

---

## 5. Exemples Pratiques d'Intégration

### Exemple 1 : Récupérer les soldes de comptes en cURL
```bash
curl -X GET "http://127.0.0.1:8434/api/accounts/" \
     -H "Accept: application/json"
```

### Exemple 2 : Créer une transaction en JavaScript (Fetch API)
```javascript
const response = await fetch("http://127.0.0.1:8434/api/transactions/", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Profile-ID": "default"
  },
  body: JSON.stringify({
    date_operation: "2026-10-03",
    date_saisie: "2026-10-03",
    description: "Abonnement Internet Fibre",
    amount: -39.99,
    type: "expense_fixed",
    category: "Logement",
    from_account_id: 1
  })
});

const newTransaction = await response.json();
console.log("Transaction créée avec ID :", newTransaction.id);
```

### Exemple 3 : Déclencher une sauvegarde en Python (Requests)
```python
import requests

url = "http://127.0.0.1:8434/api/backup/download"
headers = {"X-Profile-ID": "default"}

with requests.get(url, headers=headers, stream=True) as r:
    r.raise_for_status()
    with open("backup_omnibank.zip", "wb") as f:
        for chunk in r.iter_content(chunk_size=8192):
            f.write(chunk)

print("Sauvegarde locale téléchargée avec succès.")
```

---

## 6. Régénération des Schémas OpenAPI

Si vous développez de nouvelles routes FastAPI dans le projet, vous pouvez rafraîchir les fichiers de spécification à tout moment avec le script dédié :

```bash
python scripts/export_openapi.py
```

Le script inspecte les métadonnées de l'application et génère automatiquement :
- `docs/api/openapi.json`
- `docs/api/openapi.yaml`
