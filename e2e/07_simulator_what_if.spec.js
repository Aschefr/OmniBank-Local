// e2e/07_simulator_what_if.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module C : Simulateur Financier & Scénarios Sandbox What-If', () => {
  test('07.01 - Chargement du simulateur et calcul de la trajectoire prévisionnelle', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Simulateur
    await goToView(page, 'simulator');

    const viewContainer = page.locator('#mainContent');
    await expect(viewContainer).toContainText('Simulateur');

    // Vérifier la présence du canvas de projection financière
    const simChart = page.locator('canvas').first();
    await expect(simChart).toBeVisible();
  });
});
