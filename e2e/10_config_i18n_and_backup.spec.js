// e2e/10_config_i18n_and_backup.spec.js
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays } = require('./helpers/page_objects');

test.describe('Module C : Configuration, Thème, i18n & Export de Sauvegarde', () => {
  test('10.01 - Bascule du thème Clair / Sombre et Mode Discrétion', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // 1. Tester le bouton de thème
    const themeBtn = page.locator('#themeToggle');
    await expect(themeBtn).toBeVisible();

    const body = page.locator('body');
    const wasDark = await body.evaluate(el => el.classList.contains('theme-dark'));

    await themeBtn.click();
    await page.waitForTimeout(200);

    const isDarkNow = await body.evaluate(el => el.classList.contains('theme-dark'));
    expect(isDarkNow).toBe(!wasDark);

    // Remettre dans l'état initial
    await themeBtn.click();

    // 2. Tester le mode discrétion (Privacy Mode)
    const privacyBtn = page.locator('#privacyToggle');
    await expect(privacyBtn).toBeVisible();
    await privacyBtn.click();
    await page.waitForTimeout(200);

    const isPrivate = await body.evaluate(el => el.classList.contains('privacy-mode'));
    expect(isPrivate).toBe(true);

    // Désactiver le mode discrétion
    await privacyBtn.click();
    await page.waitForTimeout(200);
    const isPrivateAfter = await body.evaluate(el => el.classList.contains('privacy-mode'));
    expect(isPrivateAfter).toBe(false);
  });

  test('10.02 - Internationalisation dynamique (FR <-> EN)', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    const langToggleBtn = page.locator('#langToggleBtn');
    await expect(langToggleBtn).toBeVisible();

    // Ouvrir le menu des langues
    await langToggleBtn.click();
    const enOption = page.locator('.lang-option[data-lang="en"]');
    await expect(enOption).toBeVisible();

    // Basculer en Anglais
    await enOption.click();
    await page.waitForTimeout(400);

    // Vérifier la traduction d'éléments clés en anglais
    const sidebar = page.locator('#sidebar');
    await expect(sidebar).toContainText('Dashboard');

    // Rebasculer en Français
    await langToggleBtn.click();
    const frOption = page.locator('.lang-option[data-lang="fr"]');
    await expect(frOption).toBeVisible();
    await frOption.click();
    await page.waitForTimeout(400);
  });

  test('10.03 - Téléchargement de la sauvegarde complète ZIP', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Effectuer une requête de sauvegarde directe sur le profil actif
    const response = await page.request.get('/api/backup/download');
    expect(response.status()).toBe(200);
    const headers = response.headers();
    expect(headers['content-type']).toContain('zip');
  });
});
