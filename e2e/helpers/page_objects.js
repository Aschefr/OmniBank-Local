// e2e/helpers/page_objects.js
const { expect } = require('@playwright/test');
const { execSync } = require('child_process');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

/**
 * Exécute le script python pour réinitialiser la base de données isolée E2E
 */
function resetE2EDatabase(mode = 'fresh') {
  const pythonExe = path.join(ROOT_DIR, 'venv', 'Scripts', 'python.exe');
  const scriptPath = path.join(ROOT_DIR, 'e2e', 'helpers', 'setup_e2e_db.py');
  execSync(`"${pythonExe}" "${scriptPath}" ${mode}`, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
}

/**
 * Ferme les overlays automatiques (Wizard d'accueil, Changelog et Boîtes de confirmation/alerte)
 */
async function dismissOverlays(page) {
  try {
    const skipBtn = page.locator('#wizardSkipBtn');
    if (await skipBtn.isVisible({ timeout: 500 })) {
      await skipBtn.click();
      await page.waitForSelector('#setupWizardOverlay', { state: 'detached', timeout: 3000 });
    }
  } catch (e) {}

  try {
    const confirmBtn = page.locator('#confirmCancel, #inlineConfirm button');
    if (await confirmBtn.isVisible({ timeout: 500 })) {
      await confirmBtn.click();
    }
  } catch (e) {}

  try {
    await page.evaluate(() => {
      if (window.app && typeof window.app.closeChangelog === 'function') {
        window.app.closeChangelog();
      }
      const inline = document.getElementById('inlineConfirm');
      if (inline) inline.style.display = 'none';
    });
  } catch (e) {}
}

/**
 * Ouvre l'application et attend que le conteneur principal soit prêt
 */
async function openApp(page, { autoDismiss = true } = {}) {
  // Pré-enregistrer la version vue pour éviter le popup du changelog
  await page.addInitScript(() => {
    try {
      localStorage.setItem('omni_last_seen_version', '1.0.87');
    } catch (e) {}
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.app-container', { state: 'attached', timeout: 15000 });
  if (autoDismiss) {
    await dismissOverlays(page);
  }
}

/**
 * Navigue vers une vue donnée en cliquant sur le bouton de navigation correspondant
 */
async function goToView(page, viewName) {
  await dismissOverlays(page);
  const navBtn = page.locator(`.nav-btn[data-view="${viewName}"]:visible`).first();
  await navBtn.scrollIntoViewIfNeeded();
  await navBtn.click();
  await page.waitForTimeout(300);
}

/**
 * Attend l'apparition d'un toast notification
 */
async function expectToast(page, messageSubstring) {
  const toast = page.locator('.toast, #toastNotification, .toast-success, .toast-info').filter({ hasText: messageSubstring });
  await expect(toast.first()).toBeVisible({ timeout: 6000 });
}

module.exports = {
  ROOT_DIR,
  resetE2EDatabase,
  openApp,
  dismissOverlays,
  dismissWizardIfVisible: dismissOverlays,
  goToView,
  expectToast,
};
