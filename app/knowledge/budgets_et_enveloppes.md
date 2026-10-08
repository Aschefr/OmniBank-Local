# Fiche de Connaissances : Enveloppes Budgétaires et Recalibrage Dynamique

## 1. Principe des Enveloppes Budgétaires
Une **enveloppe budgétaire** est un plafond de dépenses alloué à une ou plusieurs catégories financières (ex. Alimentation, Carburant, Loisirs). Elle permet de piloter la consommation au fur et à mesure du mois pour éviter les découverts et garantir la capacité d'épargne.

## 2. Enveloppes Statiques vs Enveloppes Dynamiques
- **Enveloppe Statique** : Montant mensuel fixe défini manuellement par l'utilisateur.
- **Enveloppe Dynamique (Recalibrage Automatique)** :
  - Le système recalibre automatiquement le plafond chaque mois en utilisant une moyenne mobile exponentielle (EMA) sur les 3 et 6 derniers mois d'historique de dépenses réelles.
  - **Garde-fous anti-dérive** : L'ajustement automatique est strictement encadré :
    - Variation mensuelle limitée à $\pm 10\%$ maximum par mois.
    - Dérive annuelle limitée à $\pm 25\%$ maximum sur 12 mois.
    - Cela empêche une explosion involontaire des budgets tout en s'adaptant à l'inflation ou aux changements de mode de vie.

## 3. Seuils d'Alerte et Code Couleur
- **🟢 Vert ($< 80\%$)** : Consommation normale et sous contrôle.
- **🟠 Orange ($80\% - 100\%$)** : Seuil de vigilance atteint.
- **🔴 Rouge ($> 100\%$)** : Budget dépassé.

## 4. Enveloppes de Projets d'Épargne
Une enveloppe peut être marquée comme **Projet** (`is_project = True`) :
- Elle comporte un montant cible (ex. 3 000 € pour des vacances ou travaux) et éventuellement une date d'échéance.
- Elle suit l'accumulation des fonds dédiés plutôt que la consommation de charges.

## 5. Interactions avec l'IA
L'assistant IA peut :
- Analyser la santé des enveloppes via `get_budgets_status`.
- Calculer l'impact d'un achat imprévu sur une enveloppe via `get_envelopes_impact`.
- Préparer la création ou modification d'une enveloppe via `create_budget_envelope` / `update_budget_envelope` soumise à validation humaine.
