# Fiche de Connaissances : Reste à Vivre, Cycles de Paie et Cadence Journalière

## 1. Concept Fondamental du Reste à Vivre
Dans OmniBank, le **Reste à Vivre** est l'indicateur central de santé financière. Il représente la somme d'argent réellement disponible pour les dépenses courantes et discrétionnaires (alimentation, loisirs, imprévus), après déduction de toutes les charges fixes et engagements incompressibles du cycle.

## 2. Formules et Calculs
- **Solde Actuel** : Solde cumulé en temps réel du compte bancaire courant.
- **Charges Fixes Restantes du Cycle** : Somme de tous les prélèvements et échéances récurrentes programmés dans le cycle en cours qui n'ont pas encore été prélevés ou pointés (`is_reconciled = False`).
- **Reste à Vivre Immédiat / Disponible** :
  $$\text{Reste à Vivre Disponible} = \text{Solde Actuel} - \text{Charges Fixes Restantes du Cycle}$$
- **Recettes Restantes du Cycle** : Salaire ou revenus attendus avant la clôture du cycle (basés sur la date de paie prédite).
- **Dépenses Variables Estimées** :
  $$\text{Dépenses Variables Estimées} = \text{Cadence Journalière de Référence} \times \text{Nombre de Jours Restants dans le Cycle}$$
- **Reste à Vivre Projeté (Fin de Cycle)** :
  $$\text{Reste à Vivre Projeté} = \text{Solde Actuel} + \text{Recettes Restantes} - \text{Charges Fixes Restantes} - \text{Dépenses Variables Estimées}$$

## 3. Cadence Budgétaire (€/jour)
- **Cadence Réelle Constatée** :
  $$\text{Cadence Constatée} = \frac{\text{Total des Dépenses Variables Réelles du Cycle}}{\text{Nombre de Jours Écoulés dans le Cycle}}$$
- **Cadence Moyenne de Référence** : Moyenne lissée des dépenses courantes mensuelles (sur 3 à 6 mois), calculée hors charges fixes, hors transferts internes et **hors dépenses exceptionnelles (outliers)**.
- **Jauge Analogique du Cockpit** :
  - Minimum (0°) : 0 €/jour.
  - Centre (90°) : Cadence moyenne de référence (rythme d'équilibre).
  - Maximum (180°) : 2 × la moyenne (zone de surconsommation critique).

## 4. Gestion des Cycles Temporels
- **Mode Personnel (Cycle de Paie)** : Le cycle financier ne suit pas le mois civil mais la date de versement du salaire (`predict_next_paycheck`). Le cycle commence le jour de la paie (ex. le 28) et se termine la veille de la paie suivante (le 27 du mois d'après).
- **Mode Organisation (Mois Civil)** : Le cycle est calé du 1er au dernier jour de chaque mois civil.

## 5. Traitement des Dépenses Exceptionnelles (Outliers)
Les achats majeurs et non répétitifs (achat d'un véhicule, caution immobilière, gros électroménager) sont identifiés statistiquement par l'algorithme d'isolation des anomalies. Ils sont exclus du calcul de la cadence quotidienne afin de ne pas fausser le reste à vivre prévisionnel futur.
