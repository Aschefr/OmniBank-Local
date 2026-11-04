# Fiche de Connaissances : Simulateur What-If et Projections Prévisionnelles

## 1. Objectif du Simulateur
Le **Simulateur What-If** d'OmniBank permet d'anticiper l'impact de décisions financières, d'événements de vie ou de projets d'achat sur la trésorerie et le patrimoine futur (de 1 à 60 mois), sans impacter les données bancaires réelles.

## 2. Moteur de Modélisation Financière
1. **Trajectoire Déterministe** :
   - Recettes futures (salaires récurrents prévus, rentrées programmées).
   - Charges fixes engagées (abonnements, loyers, mensualités de prêts).
   - Dépenses variables calculées selon le rythme moyen constaté. Sans historique sur toute la trésorerie : enveloppes de dépenses libres ramenées au mois. Un compte précis sans dépense variable n'en projette aucune. Les moyennes divisent par les mois écoulés, y compris ceux sans dépense.
   - Mode organisation : le rythme est annuel. Les recettes et les virements reviennent aux mois où ils ont eu lieu l'an dernier, les dépenses variables sont lissées sur 12 mois, et seule une grosse opération isolée (sans équivalent depuis trois ans, avec au moins deux ans d'historique) est écartée.
2. **Cônes de Confiance et Incertitude Stochastique** :
   - Modélisation de l'aléa financier par un processus brownien dont l'écart-type croît avec la racine carrée du temps ($\sigma \sqrt{t}$).
   - Visualisation d'une fourchette haute et basse (intervalles de confiance à $\pm 1\sigma$ et $\pm 2\sigma$).
3. **Profils de Saisonnalité** :
   - Intégration des variations annuelles régulières : pic estival de vacances (juillet/août) et dépenses de fin d'année / fêtes (décembre).
4. **Mode Avancé** :
   - Il part du mode Conseillé. Le curseur « Scénario de l'année » va de l'année favorable au coup dur.
   - Année favorable : la meilleure des deux dernières années pour les recettes hors salaire, la moins chère pour les dépenses courantes. Elle demande deux ans d'historique.
   - Coup dur : plus de recettes hors salaire, dépenses courantes +20 %, inflation 2 %/an. Le salaire reste. En organisation : seules les recettes revenues deux années de suite, et un écart de dépenses aussi grand que celui constaté entre les deux années.
   - Le second curseur, « Et si vous changiez vos dépenses courantes ? », va de −50 % à +30 %. Plus de réglages : gros achats passés, revenus, rythme des dépenses, inflation en plus.
   - Une augmentation de salaire se simule avec le modèle prédéfini « Augmentation de salaire ».
5. **Mode Conseillé** :
   - Une prévision réaliste : salaire, récurrences et charges connus, plus ce que l'historique montre de régulier (remboursements, ventes, primes, charges sans récurrence). Une recette unique, comme un prêt ou un gain, ne compte pas. En organisation : les recettes et dépenses de la dernière année, à leur mois. Un gros achat futur n'est jamais prévu.
6. **Dépenses exceptionnelles** :
   - Le mode Conseillé ne retire que les achats hors norme (plus de 800 €) et lit les dépenses courantes sur 18 mois. Le mode Avancé permet de filtrer davantage ou de tout inclure.
7. **Historique récent** :
   - Avec moins de 4 mois d'historique, les enveloppes servent de repère si elles dépassent les dépenses saisies. La projection reste à prendre avec recul tant que les dépenses courantes ne sont pas toutes saisies.

## 3. Scénarios et Événements de Vie
Le simulateur prend en charge :
- **Achat Immobilier ou Véhicule** : Apport initial, mensualité d'emprunt, coût de l'assurance, impact sur le taux d'endettement (règle des 33% max).
- **Événements Professionnels** : Augmentation ou diminution de salaire, changement de poste, période de chômage ou congé parental.
- **Dépenses Ponctuelles / Travaux** : Décaissements étalés ou en une fois.

## 4. Synthèse Prévisionnelle dans le Cockpit (Vue d'Ensemble)
Le Cockpit affiche un résumé prévisionnel direct en 3 cartes multi-horizons :
1. **Horizon 7 Jours** : Flux imminents et échéances programmées de la semaine.
2. **Horizon Cycle en Cours** : Recettes prévues, charges fixes restantes, budget variable alloué et solde prévisionnel de fin de cycle.
3. **Horizon Trajectoire 3 Mois** : Prévision à M+1, M+2 et M+3 avec détection automatique de la tendance (`Croissance`, `Stable`, `Baisse`) et capacité d'épargne nette cumulée.
