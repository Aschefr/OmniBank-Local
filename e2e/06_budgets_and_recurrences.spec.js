// e2e/06_budgets_and_recurrences.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module C : Échéancier (Récurrences) & Enveloppes Budgétaires', () => {
  test('06.01 - Affichage et consultation de l\'Échéancier des Récurrences', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Récurrences
    await goToView(page, 'recurrences');

    const main = page.locator('#mainContent');
    await expect(main).toContainText('Récurrences');
  });

  test('06.02 - Gestion des Budgets & Enveloppes de dépenses', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Budgets
    await goToView(page, 'budgets');

    const main = page.locator('#mainContent');
    await expect(main).toContainText('Budgets');

    // Vérifier la présence du bouton de création de budget
    const newBudgetBtn = page.locator('button[data-i18n="budget_btn_new"]');
    await expect(newBudgetBtn).toBeVisible();
  });
});
