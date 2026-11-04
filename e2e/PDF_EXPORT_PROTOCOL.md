# Protocole : export PDF, de l'intention au résultat

Mesure l'accord entre ce que l'utilisateur demande dans « Options d'export PDF » et ce qu'il obtient. La référence n'est pas l'aperçu : c'est le **vrai PDF** généré après le clic sur Imprimer.

## Principe

Chaque scénario suit le même trajet :

1. **Intention.** Le scénario écrit ce que l'utilisateur veut : modèle, période, comptes, sections et leur ordre, sauts de page, catégories, colonnes, taille du texte, titre. Le résultat attendu est écrit dans le scénario, jamais relu dans le code de l'export.
2. **Action.** Le script utilise les vraies commandes de la fenêtre, puis lance `executePrint()`. Seul `window.print` est remplacé, pour produire le PDF.
3. **Référence indépendante.** Les montants attendus sont recalculés depuis `/api/transactions/`, sans passer par `/api/stats/categories_by_month`, que le rapport utilise.
4. **Observation.** Trois sources sont lues : le texte du PDF page par page (`pdftotext`), la mise en page d'impression et l'aperçu (positions réelles dans le navigateur).
5. **Verdict.** Chaque point de contrôle est `OK`, `ÉCART` ou `SANS OBJET`.

## Points de contrôle

| Code | Dimension | Question posée | Source |
|---|---|---|---|
| C1 | Contenu | Les sections demandées sont présentes, les autres absentes ? | PDF |
| C2 | Contenu | Les sections sont dans l'ordre demandé ? | PDF |
| C3 | Contenu | Les colonnes de mois sont celles de la période demandée ? | Impression |
| C4 | Contenu | Les types et catégories correspondent à la sélection ? | Impression |
| C5 | Contenu | Les colonnes de totaux annuels sont celles demandées ? | Impression |
| C6 | Contenu | La liste des opérations a les colonnes demandées ? | Impression |
| C7 | Contenu | Le titre et la date demandés figurent dans le PDF ? | PDF |
| C8 | Contenu | Seuls les comptes demandés figurent dans la situation des comptes ? | Impression |
| C9 | Contenu | Les intitulés du bandeau de chiffres disent ce qu'ils totalisent ? | Impression |
| M1 | Montants | Recettes et dépenses affichées égales à la référence ? | PDF |
| M2 | Montants | Chaque cellule mois × catégorie égale à la référence ? | Impression |
| M3 | Montants | Nombre d'opérations listées égal à la référence ? | Impression |
| M4 | Montants | Solde de chaque compte et total de la situation égaux à ceux de l'application ? | Impression |
| M5 | Montants | Trésorerie disponible du compte de résultat égale aux comptes du rapport, hors prêts ? | Impression |
| P1 | Pagination | Un saut de page demandé commence bien une nouvelle page ? | PDF |
| P2 | Pagination | Aucune page blanche ? | PDF |
| P3 | Pagination | Aucun titre de section isolé en bas de page ? | PDF |
| F1 | Fidélité | Le nombre de pages annoncé par l'aperçu reste proche du PDF (1 page ou 15 %) ? | Aperçu + PDF |
| F2 | Fidélité | L'aperçu et le PDF montrent les mêmes sections dans le même ordre ? | Aperçu + PDF |
| F3 | Fidélité | Les en-têtes de tableau ont la même taille dans l'aperçu et à l'impression ? | Aperçu + impression |
| L1 | Lisibilité | Aucun texte ne chevauche son voisin dans un tableau ? | Impression + aperçu |
| L2 | Lisibilité | Aucun en-tête n'est coupé, ni un mot séparé sur deux lignes ? | Impression + aperçu |
| L3 | Lisibilité | Aucun texte ne sort de sa cellule ou de la page ? | Impression + aperçu |
| L4 | Lisibilité | Aucun montant n'est coupé ou masqué ? | Impression |
| L5 | Lisibilité | Le texte reste au moins à 6 px ? | Impression |
| L6 | Lisibilité | La taille de texte demandée change bien le rendu ? | Impression |
| L7 | Lisibilité | Le contenu de chaque bouton de la fenêtre reste dans son bouton ? | Fenêtre d'export |

## Environnement d'affichage

Le document ne doit pas dépendre des préférences d'écran de l'utilisateur. Une partie des scénarios rejoue donc les mêmes demandes avec l'affichage compact et d'autres thèmes.

## Note d'accord

`accord = contrôles OK / (contrôles OK + ÉCARTS)`, par scénario, par dimension et au total. Chaque point vaut 1, sans pondération : la liste des écarts sert à décider des corrections.

## Lancer la mesure

Instance de test sur le port 8435, jamais sur des données réelles en service :

```bash
OMNIBANK_DATA_DIR=<copie-des-données> python -m uvicorn app.main:app --host 127.0.0.1 --port 8435
```

```bash
PDF_INTENT_PROFILES=<id-profil-1>,<id-profil-2> npx playwright test e2e/14_pdf_export_intent.spec.js
```

- `PDF_INTENT_PROFILES` : profils à mesurer ; sans cette variable, seul le profil actif l'est. Les scénarios personnels ou organisation sont choisis selon `enable_org_mode`.
- `PDF_INTENT_STRICT=1` : fait échouer le test au moindre écart, une fois l'export corrigé.
- `pdftotext` doit être disponible (fourni avec Git for Windows).

## Résultats

Dans `test-results/pdf-intent/`, ignoré par git : `report.md`, `report.json`, et pour chaque scénario le PDF, une capture de l'impression et une de l'aperçu. Ces fichiers contiennent les données du profil mesuré : ne pas les publier.

## Limites

- Le PDF vient de Chromium via Playwright : le rendu de Firefox, Safari ou de l'application peut différer.
- `pdftotext` donne le texte de chaque page, pas ses positions : les contrôles de géométrie se font dans la mise en page d'impression du navigateur, pas dans le fichier PDF.
- L'œil reste nécessaire pour l'esthétique et les graphiques : la mesure vérifie leur présence, pas leur qualité.
