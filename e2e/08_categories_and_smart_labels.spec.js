// e2e/08_categories_and_smart_labels.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module C : Gestionnaire des Catégories & Personnalisation', () => {
  test('08.01 - Création d\'une nouvelle catégorie personnalisée', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Catégories
    await goToView(page, 'categories');

    // Remplir le formulaire d'ajout de catégorie
    await page.fill('#cat_name', 'Cadeaux & Fêtes E2E');
    await page.selectOption('#cat_type', 'expense_var');
    await page.click('button[data-i18n="btn_add"]');

    // Vérifier l'apparition de la catégorie dans le conteneur
    const catContainer = page.locator('#categoriesContainer');
    await expect(catContainer).toContainText('Cadeaux & Fêtes E2E');
  });
});
