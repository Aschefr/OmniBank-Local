// e2e/11_reconciliation_reactive_sidebar.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module K : Réactivité Instantanée Sidebar & Rapprochement', () => {
  test('11.01 - Le pointage d\'une opération met à jour la barre latérale sans rechargement de page (sans F5)', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // 1. Créer un compte propre au test, à 1 000 €, quels que soient les comptes déjà présents
    const accountName = 'Compte Pointage ' + Date.now();
    await page.evaluate(async (name) => {
      await window.API.post('/api/accounts/', {
        name,
        type: 'Compte courant',
        initial_balance: 1000.0,
        color: '#3366ff',
        currency: 'EUR'
      });
      await window.app.refreshSidebar();
    }, accountName);

    const sidebarAccount = page.locator('#sidebar .account-item').filter({ hasText: accountName });
    // La barre latérale est un tiroir fermé par défaut : son contenu existe sans être visible
    await expect(sidebarAccount).toBeAttached({ timeout: 5000 });

    // 2. Aller dans la vue Toutes les opérations
    await goToView(page, 'all_operations');

    // 3. Créer une dépense non pointée liée au compte
    const uniqueOpName = 'Dépense Réactive ' + Date.now();
    const addOpBtn = page.locator('button[data-i18n="btn_add_operation"]:visible').first();
    await addOpBtn.click();
    await expect(page.locator('#operationModal')).toBeVisible({ timeout: 5000 });

    await page.fill('#op_desc', uniqueOpName);
    await page.fill('#op_amount', '50.00');

    // Attendre le chargement des options du compte et sélectionner
    const fromSelect = page.locator('#op_from_account');
    await expect(fromSelect.locator('option')).not.toHaveCount(0, { timeout: 5000 });
    await fromSelect.selectOption({ label: accountName });

    await page.click('#op_save_btn');
    await expect(page.locator('#operationModal')).not.toBeVisible({ timeout: 5000 });

    // 4. Repérer la ligne de l'opération créée
    const targetRow = page.locator('tr').filter({ hasText: uniqueOpName }).first();
    await expect(targetRow).toBeVisible({ timeout: 5000 });

    // Avant pointage : la sidebar affiche 1 000,00 €
    await expect(sidebarAccount).toContainText('1 000,00');

    // 5. Cliquer sur le bouton de pointage (rapprochement) de l'opération
    const reconcileBtn = targetRow.locator('.recon-btn, .btn-reconcile, button[onclick*="toggleReconciliation"]').first();
    await expect(reconcileBtn).toBeVisible({ timeout: 5000 });
    await reconcileBtn.click();

    // 6. Vérifier que la barre latérale affiche 950,00 € RÉACTIVEMENT (SANS F5)
    // 1000.00 € - 50.00 € = 950.00 €
    await expect(sidebarAccount).toContainText('950,00', { timeout: 6000 });

    // 7. Vérifier que le statut de l'opération dans la table est passé à l'état pointé
    await expect(targetRow.locator('.recon-date-link').first()).toBeVisible({ timeout: 5000 });
  });
});
