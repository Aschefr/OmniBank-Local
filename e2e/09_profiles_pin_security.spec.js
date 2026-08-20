// e2e/09_profiles_pin_security.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module C : Multi-Profils & Sécurité', () => {
  test('09.01 - Création d\'un profil maître secondaire et bascule automatique', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Configuration
    await goToView(page, 'config');

    // Cliquer sur "Créer un profil"
    const createProfileBtn = page.locator('button[onclick*="_showCreateProfileModal"]');
    await expect(createProfileBtn).toBeVisible();
    await createProfileBtn.click();

    // Vérifier l'ouverture du modal de création de profil
    const modal = page.locator('#masterProfileModal');
    await expect(modal).toBeVisible();

    // Remplir le nom du profil
    await page.fill('#masterProfileNameInput', 'Profil Association E2E');

    // Cliquer sur le bouton de création et attendre le rechargement
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
      page.click('#masterProfileSubmitBtn')
    ]);

    await page.waitForLoadState('domcontentloaded');
    await dismissOverlays(page);

    // Vérifier que le profil actif dans le header est le nouveau profil
    const profileBadge = page.locator('#profileName');
    await expect(profileBadge).toContainText('Profil Association E2E');
  });
});
