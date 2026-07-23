# 🎯 Documentation Page : Budgets & Suggestions IA

La page **Budgets** permet de gérer vos dépenses selon la méthode des **Enveloppes Budgétaires**. Elle combine un suivi visuel en temps réel et un module d'intelligence artificielle locale (**Ollama**) capable de suggérer des ajustements personnalisés de vos enveloppes.

---

## 📸 Illustrations

![Page Budgets](../../../screenshots/05_budgets.png)
*Vue d'ensemble des enveloppes budgétaires.*

![Détail d'un Budget](../../../screenshots/05_budgets_detail.png)
*Détail de la consommation d'une enveloppe et liste des dépenses associées.*

![Édition d'un Budget](../../../screenshots/05_budgets_detail_edition.png)
*Modale de modification d'une enveloppe budgétaire.*

![Suggestions IA Ollama](../../../screenshots/05_budgets_suggestion_ia.png)
*Module de propositions budgétaires générées par l'IA locale.*

---

## 🛠️ Composants & Fonctionnalités

### 1. Enveloppes Budgétaires Mensuelles
Pour chaque catégorie (ex: *Alimentation*, *Loisirs*, *Carburant*) :
- Assignez un plafond mensuel (ex: 400 €).
- Observez la jauge de progression :
  - 🟢 **Vert** (0% - 80%) : Budget respecté.
  - 🟠 **Orange** (81% - 99%) : Seuil d'alerte atteint.
  - 🔴 **Rouge** (≥ 100%) : Dépassement de budget.

### 2. Consultation des Dépenses Liées
En cliquant sur une carte d'enveloppe budgétaire, le panneau latéral déplie toutes les transactions enregistrées au cours du mois pour cette catégorie, permettant d'identifier rapidement les achats responsables d'un surcoût.

### 3. Suggestions de Budgets par l'IA Locale (Ollama)
En cliquant sur le bouton **"Suggestions IA"** :
1. Le service backend (`app/services/budget_ai_service.py`) analyse l'historique de vos dépenses réelles sur les 3 à 6 derniers mois.
2. L'IA locale Ollama calcule la moyenne pondérée de vos dépenses par poste tout en détectant la saisonnalité.
3. Elle génère une grille de propositions budgétaires réalistes et expliquées en français.
4. Vous pouvez **appliquer toutes les suggestions** en un seul clic ou ajuster les montants individuellement avant de sauvegarder.
