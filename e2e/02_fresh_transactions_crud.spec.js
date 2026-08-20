// e2e/02_fresh_transactions_crud.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module A : Parcours Base Vierge - CRUD Opérations & Virement Interne', () => {
  test('02.01 - Saisie manuelle d\'une dépense et d\'une recette', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Historique / Toutes les opérations
    await goToView(page, 'all_operations');

    // 1. Ouvrir le modal d'ajout d'opération
    const addOpBtn = page.locator('button[data-i18n="btn_add_operation"]:visible').first();
    await addOpBtn.click();
    await expect(page.locator('#operationModal')).toBeVisible({ timeout: 5000 });

    // Remplir une dépense : Courses 45.50 € depuis Compte Courant Test
    await page.fill('#op_desc', 'Courses Supermarché Test');
    await page.fill('#op_amount', '45.50');
    // Sélectionner compte source (Depuis)
    await page.selectOption('#op_from_account', { label: 'Compte Courant Test' });

    // Sauvegarder
    await page.click('#op_save_btn');
    await expect(page.locator('#operationModal')).not.toBeVisible({ timeout: 5000 });

    // 2. Ajouter une recette : Salaire 2200 € vers Compte Courant Test
    await addOpBtn.click();
    await expect(page.locator('#operationModal')).toBeVisible({ timeout: 5000 });

    await page.fill('#op_desc', 'Salaire Virement Test');
    await page.fill('#op_amount', '2200.00');
    // Sélectionner compte destinataire (Vers)
    await page.selectOption('#op_to_account', { label: 'Compte Courant Test' });

    await page.click('#op_save_btn');
    await expect(page.locator('#operationModal')).not.toBeVisible({ timeout: 5000 });

    // Vérifier la présence des opérations dans la liste
    const opsBody = page.locator('#allOperationsBody');
    await expect(opsBody).toContainText('Courses Supermarché Test');
    await expect(opsBody).toContainText('Salaire Virement Test');
  });

  test('02.02 - Saisie d\'un virement interne entre comptes', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    await goToView(page, 'all_operations');
    const addOpBtn = page.locator('button[data-i18n="btn_add_operation"]:visible').first();
    await addOpBtn.click();

    // Virement de 300 € du Compte Courant vers le Livret A
    await page.fill('#op_desc', 'Virement Épargne Test');
    await page.fill('#op_amount', '300.00');
    await page.selectOption('#op_from_account', { label: 'Compte Courant Test' });
    await page.selectOption('#op_to_account', { label: 'Livret A Test' });

    await page.click('#op_save_btn');
    await expect(page.locator('#operationModal')).not.toBeVisible({ timeout: 5000 });

    // Vérifier la présence du virement dans la table
    const opsBody = page.locator('#allOperationsBody');
    await expect(opsBody).toContainText('Virement Épargne Test');
  });
});
