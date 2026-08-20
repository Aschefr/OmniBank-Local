// e2e/05_trends_and_virtual_table.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module B : Tendances multi-années & Recherche / VirtualTable', () => {
  test('05.01 - Affichage des graphiques de Tendances multi-années', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Tendances
    await goToView(page, 'trends');

    // Vérifier la présence du conteneur de tendances et des graphiques
    const viewContainer = page.locator('#mainContent');
    await expect(viewContainer).toContainText('Tendances');

    // Vérifier la présence d'au moins un canvas de graphique
    const chartCanvas = page.locator('canvas').first();
    await expect(chartCanvas).toBeVisible();
  });

  test('05.02 - Recherche, filtres multi-critères et stabilité de la VirtualTable', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    await goToView(page, 'all_operations');

    // 1. Recherche par mot-clé "Supermarché"
    const searchInput = page.locator('#historySearch');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('Supermarché');

    // Attendre l'application du filtre
    await page.waitForTimeout(400);

    const opsList = page.locator('#allOperationsBody');
    await expect(opsList).toContainText('Courses Supermarché Test');
    await expect(opsList).not.toContainText('Salaire Virement Test');

    // 2. Réinitialiser la recherche
    await searchInput.fill('');
    await page.waitForTimeout(400);

    // 3. Filtrer par type "Transfert"
    const typeFilter = page.locator('#historyTypeFilter');
    await typeFilter.selectOption('transfer');
    await page.waitForTimeout(400);

    await expect(opsList).toContainText('Virement Épargne Test');
    await expect(opsList).not.toContainText('Courses Supermarché Test');

    // 4. Réinitialiser le filtre de type
    await typeFilter.selectOption('');
    await page.waitForTimeout(400);

    // Vérifier que toutes les opérations réapparaissent
    await expect(opsList).toContainText('Courses Supermarché Test');
  });
});
