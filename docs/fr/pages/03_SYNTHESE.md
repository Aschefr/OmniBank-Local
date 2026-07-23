# 📈 Documentation Page : Synthèse Financière & Export PDF

La page **Synthèse** offre une vue analytique consolidée et matricielle de l'ensemble de vos finances sur une période donnée (3, 6, 12 ou 24 mois glissants, année spécifique ou période personnalisée). Elle permet d'examiner la répartition détaillée de vos revenus et dépenses par type et par catégorie sous forme de tableau comparatif multi-mensuel, et d'exporter des rapports financiers.

---

## 📸 Illustrations

![Page Synthèse](../../../screenshots/04_synthèse.png)
*Vue matricielle de la synthèse financière ventilée par catégories et par mois.*

![Export PDF - Aperçu](../../../screenshots/04_synthèse_export_pdf.png)
*Génération du rapport financier PDF de la synthèse.*

![Export PDF - Impression](../../../screenshots/04_synthèse_export_pdf_print.png)
*Interface d'impression / sauvegarde PDF du document de synthèse.*

---

## 🛠️ Composants & Fonctionnalités

### 1. Matrice Analytique Catégories × Mois
La synthèse est structurée sous forme d'une grande grille matricielle interactive organisée par sections :
- **🛍️ Dépenses Variables** : Alimentation, loisirs, vêtements, etc.
- **📋 Dépenses Fixes** : Loyer, abonnements, assurances, impôts.
- **💰 Revenus** : Salaires, allocations, ventes.
- **🔁 Transferts & Virements Internes** : Mouvements entre vos différents comptes.

Chaque catégorie parent s'affiche avec ses sous-catégories associées. Pour chaque ligne, le tableau présente la somme exacte des opérations par mois, ainsi que le **Total Annuel** et la **Moyenne Mensuelle**.

### 2. Filtres & Sélection de Période
- **Sélection des Comptes** : Filtrez par un compte spécifique ou affichez le cumul de tous les comptes.
- **Filtre par Statut de Rapprochement** : Toutes les sommes, Opérations rapprochées uniquement, ou Opérations non rapprochées uniquement.
- **Horizon Temporel** : 3 mois, 6 mois, 12 mois, 24 mois glissants ou sélection d'une année calendaire spécifique.
- **Période Personnalisée** : Activez la bascule de période sur-mesure pour définir une plage exacte (date de début et date de fin au jour près).
- **Gestion des Années (⚙️ Années)** : Sélecteur d'années comparatives.

### 3. Génération & Exportation de Rapport PDF
Pour les besoins de tenue de compte personnelle, d'analyse ou de présentation pour le bilan d'une association / CSE (Mode Organisation) :
1. Cliquez sur le bouton **"📥 Exporter en PDF"**.
2. Une modale permet de configurer le rapport (sélection des colonnes, des types d'opérations et de l'orientation).
3. OmniBank génère une mise en page imprimable épurée, sans éléments de navigation d'interface.
4. Utilisez le dialogue d'impression système pour enregistrer le document au format PDF.
