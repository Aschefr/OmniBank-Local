// e2e/09_profiles_pin_security.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

const PROFILE_NAME = 'Profil Association E2E';

test.describe('Module C : Multi-Profils & Sécurité', () => {
  // Le profil créé est vide : s'il restait actif, les tests suivants tourneraient sans aucune catégorie
  test.afterEach(async ({ request }) => {
    const { profiles, active_profile_id: active } = await (await request.get('/api/profiles/')).json();
    for (const profile of profiles.filter(p => p.name === PROFILE_NAME)) {
      // Le serveur ne supprime que le profil actif, puis rebascule sur le profil restant
      if (profile.id !== active) await request.post(`/api/profiles/${profile.id}/activate`, { data: {} });
      expect((await request.delete(`/api/profiles/${profile.id}`)).ok()).toBeTruthy();
    }
  });

  test('09.01 - Création d\'un profil maître secondaire et bascule automatique', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Configuration
    await goToView(page, 'config');

    // Basculer sur l'onglet Profils & accès
    await page.locator('.config-tab-btn[data-tab="profiles"]').click();

    // Cliquer sur "Créer un profil"
    const createProfileBtn = page.locator('button[onclick*="_showCreateProfileModal"]');
    await expect(createProfileBtn).toBeVisible();
    await createProfileBtn.click();

    // Vérifier l'ouverture du modal de création de profil
    const modal = page.locator('#masterProfileModal');
    await expect(modal).toBeVisible();

    // Remplir le nom du profil
    await page.fill('#masterProfileNameInput', PROFILE_NAME);

    // Cliquer sur le bouton de création et attendre le rechargement
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
      page.click('#masterProfileSubmitBtn')
    ]);

    await page.waitForLoadState('domcontentloaded');
    await dismissOverlays(page);

    // Vérifier que le profil actif dans le header est le nouveau profil
    const profileBadge = page.locator('#profileName');
    await expect(profileBadge).toContainText(PROFILE_NAME);
  });
});
