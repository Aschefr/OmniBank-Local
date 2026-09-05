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

  test('01.03 - Parcours interactif SetupWizard (Thème, Profil, Mode d\'entrée et Salaire)', async ({ page }) => {
    // Relancer le wizard via la fonction globale
    await openApp(page, { autoDismiss: false });
    await page.evaluate(() => window.SetupWizard && window.SetupWizard.show());

    const wizard = page.locator('#setupWizardOverlay');
    await expect(wizard).toBeVisible({ timeout: 5000 });

    // Étape 0 : Sélection d'un thème (ex: Titanium Dark)
    const themeTitanium = page.locator('.wizard-theme-card').filter({ hasText: 'Titanium' });
    if (await themeTitanium.count() > 0) {
      await themeTitanium.first().click();
      await expect(themeTitanium.first()).toHaveClass(/active/);
    }
    // Clic Suivant -> Étape 1
    await page.click('.wizard-step-content button.wizard-btn-primary');

    // Étape 1 : Profil & Sécurité
    const profileNameInput = page.locator('#wizProfileName');
    await expect(profileNameInput).toBeVisible({ timeout: 5000 });
    await profileNameInput.fill('Foyer Test');
    await page.click('.wizard-nav button.wizard-btn-primary');

    // Étape 2 : Mode d'entrée
    const entryManual = page.locator('.wizard-entry-tile').first();
    await expect(entryManual).toBeVisible({ timeout: 5000 });
    await page.click('.wizard-nav button.wizard-btn-primary');

    // Étape 3 : Salaire & Reste à vivre
    const payDayInput = page.locator('#wizPayDay');
    await expect(payDayInput).toBeVisible({ timeout: 5000 });
    const payAmountInput = page.locator('#wizPayAmount');
    await payAmountInput.fill('2800');
    await page.click('.wizard-nav button.wizard-btn-primary');

    // Étape 4 : Guide Opérations & Accueil
    await expect(page.locator('.wizard-home-card').first()).toBeVisible({ timeout: 5000 });
    await page.click('.wizard-nav button.wizard-btn-primary');

    // Étape 5 : IA (Passer)
    const skipAiBtn = page.locator('button[data-i18n="wizard_btn_skip_ai"]');
    await expect(skipAiBtn).toBeVisible({ timeout: 5000 });
    await skipAiBtn.click();

    // Étape 6 : Lancement
    const launchBtn = page.locator('button.wizard-btn-launch');
    await expect(launchBtn).toBeVisible({ timeout: 5000 });
    await launchBtn.click();

    // Le wizard doit disparaître
    await expect(wizard).not.toBeVisible({ timeout: 5000 });
  });
});

