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
4. **Curseur de Prudence** :
   - Permet d'injecter une marge de sécurité réglable sur les dépenses courantes imprévues.
   - En mode organisation, le maximum ne garde que les recettes revenues l'année d'avant, au plus bas des deux années, et retient les dépenses de l'année la plus chère. Sans année complète pour comparer, il applique une marge de 10 %.
5. **Dépenses exceptionnelles** :
   - Le mode Conseillé ne retire que les achats hors norme (plus de 800 €). Le mode Avancé permet de filtrer davantage ou de tout inclure.
6. **Historique récent** :
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
