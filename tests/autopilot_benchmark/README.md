# OmniBank Local — Dataset de Benchmark Global Auto-Pilote (Cold Start 4 Mois)

Ce dataset fournit un banc d'essai complet, standardisé et reproductible pour tester le moteur **Auto-Pilote** lors d'une initialisation à blanc (**cold-start**) sur un profil maître vierge.

---

## 1. Vue d'Ensemble du Scénario & Mathématiques de Solde

- **Compte cible** : `Compte de dépôt N° 00012345678`
- **Solde initial (au 31/08/2026)** : **`1 500,00 €`**
- **Format** : CSV bancaire standard français (`Date;Libellé;Débit;Crédit`, séparateur `;`, décimale `,`, dates `JJ/MM/AAAA`).
- **Précision comptable** : Rapprochement au centime d'euro garanti sur chaque mois sans perte ni écart.

### Tableau de Continuité des Soldes

| Fichier | Période | Total Crédits | Total Débits | Flux Net | Solde Fin de Mois |
| :--- | :--- | :---: | :---: | :---: | :---: |
| *(Initial)* | *Au 31/08/2026* | — | — | — | **`1 500,00 €`** |
| [mois_01_septembre_2026.csv](file:///tests/autopilot_benchmark/mois_01_septembre_2026.csv) | Septembre 2026 | `+2 400,00 €` | `-1 295,48 €` | `+1 104,52 €` | **`2 604,52 €`** |
| [mois_02_octobre_2026.csv](file:///tests/autopilot_benchmark/mois_02_octobre_2026.csv) | Octobre 2026 | `+2 400,00 €` | `-1 638,18 €` | `+761,82 €` | **`3 366,34 €`** |
| [mois_03_novembre_2026.csv](file:///tests/autopilot_benchmark/mois_03_novembre_2026.csv) | Novembre 2026 | `+2 464,50 €` | `-1 290,68 €` | `+1 173,82 €` | **`4 540,16 €`** |
| [mois_04_decembre_2026.csv](file:///tests/autopilot_benchmark/mois_04_decembre_2026.csv) | Décembre 2026 | `+3 250,00 €` | `-1 534,18 €` | `+1 715,82 €` | **`6 255,98 €`** |

---

## 2. Déroulement Chronologique & Assertions Attendues

### Mois 1 — Septembre 2026 : Le Cold-Start
*Importation du premier relevé sur profil maître neuf.*

- **Opérations clés** :
  - `01/09` : Salaire ACME Corp (+2 400,00 €)
  - Charges fixes candidates : Loyer (-750,00 €), EDF (-65,00 €), Freebox (-34,99 €), Spotify (-10,99 €)
  - Échelonnement Alma : 1ère échéance `PRLV SEPA ALMA 1/3 COMMERCE HIGH-TECH` (-80,00 €)
  - Dépenses courantes : Alimentation, carburant, pharmacie, restaurant
- **Attentes Auto-Pilote (Mois 1)** :
  1. Auto-catégorisation initiale (salaire -> Revenus, Loyer -> Logement, EDF -> Énergie, etc.).
  2. Solde final validé : `2 604,52 €`.
  3. **Aucun template de récurrence officiel créé** (historique $N=1$ insuffisant pour certitude statistique).
  4. La mention `1/3` est stockée pour analyse prédictive d'échelonnement.

---

### Mois 2 — Octobre 2026 : Détection Niveau 1 (Candidatures In-Memory)
*Deuxième relevé importé (J+30).*

- **Opérations clés** :
  - `01/10` : Salaire ACME Corp (+2 400,00 €)
  - Charges fixes répétées ($N=2$) : Loyer, EDF, Freebox, Spotify à montants strictement identiques.
  - Échelonnement Alma : 2ème échéance `PRLV SEPA ALMA 2/3 COMMERCE HIGH-TECH` (-80,00 €)
  - Dépense exceptionnelle : `CB GARAGE AUTO REPARATION` (-380,00 €)
- **Attentes Auto-Pilote (Mois 2)** :
  1. **Détection Niveau 1** : Loyer, EDF, Freebox et Spotify sont flaggés en `recurrence_candidates` en mémoire (score de confiance ~65%).
  2. Le tableau de bord du *Reste à Vivre* projette ces dépenses candidates pour le mois suivant en filigrane sans les figer en base.
  3. L'échéance Alma `2/3` est matchée avec le préfixe Alma `1/3` (reconnaissance d'un paiement en 3x, échéance attendue pour Novembre).
  4. L'opération Garage (-380 €) est catégorisée en Transport/Entretien Auto mais **exclue** des candidats de récurrence (variance/unicité).
  5. Solde final validé : `3 366,34 €`.

---

### Mois 3 — Novembre 2026 : Promotion Full-Auto ($N=3$) & Fin d'Échelonnement
*Troisième relevé importé (J+60).*

- **Opérations clés** :
  - `01/11` : Salaire ACME Corp (+2 400,00 €)
  - Charges récurrentes confirmées ($N=3$) : Loyer (-750 €), EDF (-65 €), Freebox (-34,99 €), Spotify (-10,99 €)
  - Échelonnement Alma : 3ème et dernière échéance `PRLV SEPA ALMA 3/3 COMMERCE HIGH-TECH` (-80,00 €)
  - Remboursement exceptionnel : `VIR RECU REMBOURSEMENT SEPA CPAM` (+64,50 €)
- **Attentes Auto-Pilote (Mois 3)** :
  1. **Promotion Automatique Niveau 2** : Le seuil de 3 occurrences successives étant atteint avec un écart type nul sur le montant et une périodicité mensuelle (~30 jours), l'Auto-Pilote promeut automatiquement ces 4 lignes en **Modèles de Récurrence officiels** (`recurrence_templates`).
  2. Une notification d'information transparente est enregistrée dans le flux d'audit (`AutopilotDecisionLog`) : *"4 charges récurrentes officialisées automatiquement"*.
  3. Alma `3/3` : L'Auto-Pilote constate la mention finale `3/3` et solde l'échelonnement. Aucune 4ème échéance ne doit être planifiée pour Décembre.
  4. Le virement CPAM (+64,50 €) est catégorisé en *Santé / Remboursement* et étiqueté comme revenu ponctuel non récurrent.
  5. Solde final validé : `4 540,16 €`.

---

### Mois 4 — Décembre 2026 : Pleine Automatisation & Revenus Exceptionnels
*Quatrième relevé importé (J+90).*

- **Opérations clés** :
  - `01/12` : Salaire ACME Corp (+3 150,00 € = Salaire 2 400 € + Prime de fin d'année 750 €)
  - Charges récurrentes : Loyer, EDF, Freebox, Spotify prélevés.
  - **Absence d'Alma** : Aucune ligne Alma le 10/12.
  - Cadeau de fin d'année : `VIR DE GRAND-MERE ETRENNES` (+100,00 €)
  - Dépenses festives : Jouets, Fnac cadeaux, repas de fêtes.
- **Attentes Auto-Pilote (Mois 4)** :
  1. **Rapprochement Automatique sur Modèle** : Les 4 prélèvements (Loyer, EDF, Freebox, Spotify) sont immédiatement réconciliés avec les templates créés au Mois 3. Zéro doublon généré.
  2. **Contrôle Échelonnement** : Aucune alerte de retard ni prévision orpheline pour Alma. L'échelonnement reste bien clôturé.
  3. **Analyse de Salaire avec Prime** : L'Auto-Pilote rattache le virement de 3 150,00 € au salaire habituel ACME Corp (reconnaissance de l'employeur), isole le delta de +750,00 € comme bonus/prime, et met à jour les statistiques de moyenne de revenus sans écraser la base fixe de 2 400 €.
  4. Le virement des étrennes (+100 €) est classé en *Cadeaux / Divers* sans créer de récurrence.
  5. Solde final validé : **`6 255,98 €`**.

---

## 3. Matrice de Succès / Échec du Test Global

| Assertion | Résultat Attendu | Statut PASS | Statut FAIL |
| :--- | :--- | :---: | :---: |
| **Continuité des Soldes** | `1 500,00 €` -> `2 604,52 €` -> `3 366,34 €` -> `4 540,16 €` -> `6 255,98 €` | Écart exact = 0,00 € | Tout écart $\neq 0$ |
| **Création Templates $N=3$** | 4 templates créés au Mois 3 (Loyer, EDF, Freebox, Spotify) | Exactement 4 templates | $<4$ ou $>4$ templates |
| **Échelonnement Alma 3x** | Planifié pour 3 mois, soldé au mois 3, éteint au mois 4 | 3 débits totalisant 240 €, 0 débit au M4 | Prévision fantôme au M4 |
| **Ségrégation Revenu vs Prime** | Base salaire 2 400 € préservée, prime 750 € isolée | Salaire reconnu + prime taguée | Salaire non reconnu ou fausse alerte |
| **Journal d'Audit Auto-Pilote** | Toutes les promotions et décisions tracées avec horodatage et justification | Décisions listées et réversibles | Journal vide ou actions silencieuses |

---

## 4. Protocole d'Exécution du Test

> [!NOTE]
> **Rôle du Benchmark & État d'Implémentation** :
> Ce dataset fournit le terrain d'épreuve de référence.
> Le script `tests/test_autopilot_benchmark.py` valide actuellement l'intégrité brute des données CSV.
> Les étapes manuelles et le scénario navigateur dans [`E2E_BROWSER_TEST_SCENARIO.md`](file:///tests/autopilot_benchmark/E2E_BROWSER_TEST_SCENARIO.md) correspondent aux critères d'acceptation cibles (**Acceptance Criteria**) validant le moteur Auto-Pilote au fur et à mesure du développement de ses briques.

1. **Initialiser la base** : Créer un profil maître propre `Test Auto-Pilote`.
2. **Étape 1** : Importer [mois_01_septembre_2026.csv](file:///tests/autopilot_benchmark/mois_01_septembre_2026.csv). Vérifier solde et catégorisation.
3. **Étape 2** : Importer [mois_02_octobre_2026.csv](file:///tests/autopilot_benchmark/mois_02_octobre_2026.csv). Vérifier la détection in-memory Niveau 1 et le statut Alma 2/3.
4. **Étape 3** : Importer [mois_03_novembre_2026.csv](file:///tests/autopilot_benchmark/mois_03_novembre_2026.csv). Vérifier la promotion Full-Auto des 4 templates et la clôture d'Alma.
5. **Étape 4** : Importer [mois_04_decembre_2026.csv](file:///tests/autopilot_benchmark/mois_04_decembre_2026.csv). Vérifier la réconciliation sur template, la gestion de la prime de 750 € et l'absence d'Alma.
