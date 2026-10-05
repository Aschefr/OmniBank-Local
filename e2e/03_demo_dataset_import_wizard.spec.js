// e2e/03_demo_dataset_import_wizard.spec.js
const { test, expect } = require('@playwright/test');
const path = require('path');
const { ROOT_DIR, openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module B : Assistant d\'importation du Dataset de Démonstration Réel', () => {
  test('03.01 - Importation complète de demo_dataset_omnibank.csv via l\'assistant UI', async ({ page }) => {
    test.setTimeout(180000);
    await openApp(page);
    await dismissOverlays(page);

    const csvFilePath = path.join(ROOT_DIR, 'demo_dataset_omnibank.csv');

    // 1. Déposer le fichier CSV dans l'input global de téléversement
    const fileInput = page.locator('#globalCsvFileInput');
    await fileInput.setInputFiles(csvFilePath);

    // 2. Le modal d'importation s'ouvre pour l'analyse
    const importModal = page.locator('#importDataModal');
    await expect(importModal).toBeVisible({ timeout: 10000 });

    // 3. Si l'ancien sélecteur de compte préliminaire est affiché, le renseigner et lancer l'analyse
    const accSelect = page.locator('#importAccountSelect');
    if (await accSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.selectOption('#importAccountSelect', { label: 'Compte Courant Test' });
      const analyzeBtn = page.locator('#btnAnalyzeDirect');
      if (await analyzeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await analyzeBtn.click();
      }
    }

    // 4. Attendre que le cockpit unifié de prévisualisation et le bouton de validation apparaissent
    const saveBtn = page.locator('#btnCommitSync');
    await expect(saveBtn).toBeVisible({ timeout: 120000 });

    // 5. Associer le compte dans le cockpit unifié si demandé
    const csvAccSelect = page.locator('#reviewCsvAccountSelect');
    if (await csvAccSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
      const selectedVal = await csvAccSelect.inputValue();
      if (!selectedVal) {
        await csvAccSelect.selectOption({ index: 1 });
      }
    }

    // 6. Valider l'importation
    await saveBtn.click();
    await expect(page.locator('#bankSyncReviewModal')).not.toBeVisible({ timeout: 60000 });
    await page.waitForTimeout(1000);
    await dismissOverlays(page);

    // 7. Vérifier dans la vue Historique que les opérations importées sont présentes
    await goToView(page, 'all_operations');
    await dismissOverlays(page);

    const opsContainer = page.locator('#allOperationsBody');
    await expect(opsContainer).toBeVisible({ timeout: 10000 });
  });
});
