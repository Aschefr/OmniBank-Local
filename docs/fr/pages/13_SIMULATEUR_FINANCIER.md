# 🔮 Documentation Page : Simulateur Financier & Projections

Le **Simulateur Financier** (`static/js/views/simulator.js`) est le moteur de projection patrimoniale et de modélisation prospective à moyen et long terme d'OmniBank Local. Il permet de simuler l'impact de grands choix de vie (achat immobilier, reconversion professionnelle, nouvel emprunt, année sabbatique, investissements) sur vos finances de 1 à 30 ans.

---

## 🎯 1. Vision & Approche Local-First

Le simulateur calcule l'intégralité des trajectoires de trésorerie en local dans votre navigateur et le backend FastAPI :
- **Zéro fuite de données** : Vos hypothèses d'avenir et vos projets personnels ne sont jamais transmis à des calculateurs ou banques en ligne.
- **Réalisme basé sur l'historique** : Contrairement aux simulateurs simplistes reposant sur des moyennes théoriques, OmniBank Local injecte vos dépenses réelles constatées et vos récurrences actives pour calibrer la trajectoire de départ.

---

## 🧭 2. Scénarios Multiples & Comparaison

Le simulateur permet de créer et comparer plusieurs scénarios indépendants :

### A. Scénario de Référence (Baseline)
- Calibré automatiquement à partir de vos flux récurrents actuels (salaires, loyers, abonnements, dépenses moyennes).
- Sert de repère étalon pour évaluer tout projet alternatif.

### B. Scénarios Alternatifs Personnalisés
- Exemples types : *« Achat Résidence Principale »*, *« Reconversion / Création d'Entreprise »*, *« Investissement Locatif »*, *« Arrivée d'un Enfant »*, *« Départ en Retraite »*.
- Possibilité de cloner le scénario de référence en un clic pour modifier des paramètres sans repartir de zéro.
- Activation / Désactivation instantanée d'hypothèses pour tester leur sensibilité.

---

## 📅 3. Événements Planifiés (Timeline Events)

Le cœur de chaque simulation est constitué de jalons temporels positionnés sur une frise chronologique :

| Type d'Événement | Description | Exemples Concrets |
| :--- | :--- | :--- |
| **💥 Ponctuel (One-off)** | Dépense ou recette unique intervenant à une date précise. | Achat de véhicule, travaux de toiture, apport personnel, héritage, vente d'un bien. |
| **🔄 Récurrent / Évolution de Flux** | Modification durable des revenus ou des charges démarrant à une date donnée (avec fin optionnelle). | Augmentation de salaire de +250 €/mois, nouvelle mensualité de prêt immobilier sur 20 ans, fin de pension. |

Chaque événement peut être rattaché à une catégorie spécifique et associé à un compte bancaire cible (Courant, Épargne, Livret A).

---

## 📈 4. Modulateurs Macro-Économiques & Comportementaux

Pour garantir un réalisme financier maximal, le simulateur intègre trois modulateurs configurables :

1. **Taux d'Inflation Annuel (%)** : Applique une hausse progressive composée sur les dépenses de la vie courante au fil des années simulées.
2. **Saisonnalité Historique Réelle** : Plutôt que de répartir les dépenses de manière linéaire et uniforme (1/12 par mois), le moteur peut répliquer les pics annuels constatés dans votre historique (vacances d'été en juillet/août, impôts ou rentrée en septembre, cadeaux en décembre).
3. **Rendement de l'Épargne (%)** : Calcule les intérêts composés générés par les soldes placés sur vos comptes d'épargne ou placements.

---

## 📊 5. Visualisation Graphique & Indicateurs d'Arbitrage

### Graphique Comparatif Interactif (Chart.js)
- Affiche la courbe du **Scénario de Référence** (en trait pointillé) superposée à celle du **Scénario Actif** (en trait plein coloré).
- Survol à la souris pour visualiser le solde exact mois par mois et les événements déclencheurs.

### Cartes d'Indicateurs Clés
- **Solde Final Projeté** : Montant estimé de votre trésorerie globale au terme de l'horizon de simulation.
- **Différentiel Net** : Gain ou surcoût total du scénario alternatif comparé au scénario de base.
- **Point Bas de Trésorerie** : Solde minimal atteint au cours de la période (permet d'anticiper tout risque de découvert ou tension de trésorerie).
- **Point Mort / Date d'Épuisement** : Date à laquelle les réserves financières s'épuisent si le cash-flow est déficitaire, ou date à laquelle un investissement devient rentable.

---

## 💡 Astuces & Recommandations

> [!TIP]
> Testez systématiquement un scénario de résistance (*stress-test*) en augmentant l'inflation de 2% et en ajoutant un événement imprévu de 3 000 € pour vérifier la solidité de votre plan financier.

> [!NOTE]
> Les événements créés dans le simulateur sont strictement virtuels : ils n'affectent jamais vos transactions réelles ni votre solde bancaire officiel sur le Tableau de Bord.
