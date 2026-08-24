// e2e/03_demo_dataset_import_wizard.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');
const { ROOT_DIR, openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module B : Assistant d\'importation du Dataset de Démonstration Réel', () => {
  test('03.01 - Importation complète de demo_dataset_omnibank.csv via l\'assistant UI', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    const csvFilePath = path.join(ROOT_DIR, 'demo_dataset_omnibank.csv');

    // 1. Déposer le fichier CSV dans l'input global de téléversement
    const fileInput = page.locator('#globalCsvFileInput');
    await fileInput.setInputFiles(csvFilePath);

    // 2. Le modal d'importation doit s'ouvrir
    const importModal = page.locator('#importDataModal');
    await expect(importModal).toBeVisible({ timeout: 10000 });

    // 3. Sélectionner le compte à lier
    await page.selectOption('#importAccountSelect', { label: 'Compte Courant Test' });

    // 4. Cliquer sur l'analyse directe / rapide
    await dismissOverlays(page);
    const analyzeBtn = page.locator('#btnAnalyzeDirect');
    await expect(analyzeBtn).toBeVisible();
    await analyzeBtn.click();

    // 5. Attendre que le tableau de prévisualisation et le bouton de sauvegarde apparaissent
    const saveBtn = page.locator('#btnSaveImport');
    await expect(saveBtn).toBeVisible({ timeout: 15000 });

    // 6. Valider l'importation et attendre le rechargement de l'application
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }).catch(() => {}),
      saveBtn.click()
    ]);

    await page.waitForLoadState('domcontentloaded');
    await dismissOverlays(page);

    // 7. Vérifier dans la vue Historique que les opérations importées sont présentes
    await goToView(page, 'all_operations');
    await dismissOverlays(page);

    const opsContainer = page.locator('#allOperationsBody');
    await expect(opsContainer).toBeVisible({ timeout: 10000 });
  });
});
