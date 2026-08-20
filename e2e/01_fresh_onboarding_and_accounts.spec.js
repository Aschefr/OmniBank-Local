// e2e/01_fresh_onboarding_and_accounts.spec.js
const { test, expect } = require('@playwright/test');
const { resetE2EDatabase, openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module A : Parcours Base Vierge - Onboarding & Gestion des Comptes', () => {
  test.beforeAll(() => {
    // Initialise une base de données complètement vierge avec les options activées
    resetE2EDatabase('fresh');
  });

  test('01.01 - Affichage du SetupWizard lors du tout premier lancement', async ({ page }) => {
    // Ne pas auto-dismiss pour pouvoir tester l'apparition du wizard
    await openApp(page, { autoDismiss: false });
    
    const wizard = page.locator('#setupWizardOverlay');
    await expect(wizard).toBeVisible({ timeout: 10000 });

    // Vérifie la présence du bouton de fermeture
    const skipBtn = page.locator('#wizardSkipBtn');
    await expect(skipBtn).toBeVisible();

    // Fermeture du wizard pour passer à l'interface
    await skipBtn.click();
    await expect(wizard).not.toBeVisible();
  });

  test('01.02 - Création de comptes et validation des soldes consolidés', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Comptes
    await goToView(page, 'accounts');
    const tableBody = page.locator('#accountsBody');

    // 1. Créer un Compte Courant avec 1500 € de solde initial
    await page.fill('#acc_name', 'Compte Courant Test');
    await page.selectOption('#acc_type_select', 'Compte courant');
    await page.fill('#acc_balance', '1500');
    await page.click('button[data-i18n="btn_add_account"]');

    // Attendre l'apparition dans la table des comptes
    await expect(tableBody).toContainText('Compte Courant Test', { timeout: 5000 });
    await expect(tableBody).toContainText('1 500,00');

    // 2. Créer un Livret d\'épargne avec 5000 € de solde initial
    await page.fill('#acc_name', 'Livret A Test');
    await page.selectOption('#acc_type_select', 'Livret');
    await page.fill('#acc_balance', '5000');
    await page.click('button[data-i18n="btn_add_account"]');

    // Attendre l'apparition du livret
    await expect(tableBody).toContainText('Livret A Test', { timeout: 5000 });
    await expect(tableBody).toContainText('5 000,00');

    // 3. Vérifier le solde total consolidé dans la barre latérale (1500 + 5000 = 6500 €)
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toContainText('6 500,00');
  });
});
