// e2e/04_analytics_and_overview.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module B : Vue d\'ensemble & Synthèse Financière (Analytics) sur Dataset Réel', () => {
  test('04.01 - Affichage des KPIs et graphiques de la Vue d\'ensemble', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la Vue d'ensemble (Overview)
    await goToView(page, 'overview');

    // Vérifier la présence du conteneur principal Overview
    const main = page.locator('#mainContent');
    await expect(main).toContainText('Vue d\'ensemble');

    // Vérifier que le sélecteur de compte contient les comptes enregistrés
    const accSelect = page.locator('#ovAccountSelect');
    await expect(accSelect).toBeVisible();
    await expect(accSelect).toContainText('Compte Courant');
  });

  test('04.02 - Affichage de la matrice Synthèse Catégories × Mois (Analytics)', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Synthèse (Analytics)
    await goToView(page, 'analytics');

    // Sélectionner la période 24 mois glissants
    const periodSelect = page.locator('#analyticsPeriod');
    await expect(periodSelect).toBeVisible();
    await periodSelect.selectOption('m24');
    await page.waitForTimeout(500);

    // Vérifier que le conteneur de synthèse s'est chargé
    const analyticsContainer = page.locator('#mainContent');
    await expect(analyticsContainer).toContainText('Synthèse');
  });
});
