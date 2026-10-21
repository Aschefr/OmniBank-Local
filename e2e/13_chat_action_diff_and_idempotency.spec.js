// e2e/13_chat_action_diff_and_idempotency.spec.js
const { test, expect } = require('@playwright/test');
const { resetE2EDatabase, openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module IA Chat : Cartes d\'action interactives, Mini-diff Avant/Après et Idempotence', () => {
  test.beforeEach(() => {
    // Initialise la base E2E isolée avec une transaction #1 et une session de chat contenant une carte d'action
    resetE2EDatabase('chat_diff');
  });

  test('13.01 - Affichage direct du mini-diff Avant ➔ Après sur la carte d\'action du chat', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers le module Chat IA
    await goToView(page, 'chat');

    // Attendre que la session soit chargée et affichée
    const chatContainer = page.locator('#chatMessages');
    await expect(chatContainer).toBeVisible({ timeout: 10000 });

    // Vérifier la présence de la carte d'action
    const actionBox = page.locator('.ai-action-box').first();
    await expect(actionBox).toBeVisible({ timeout: 10000 });

    // Vérifier que le conteneur de mini-diff (.ai-action-diff) est hydraté avec l'état actuel et proposé
    const diffContainer = actionBox.locator('.ai-action-diff');
    await expect(diffContainer).toBeVisible({ timeout: 8000 });

    // 1. Vérifier le diff de catégorie (Alimentation ➔ Loisirs)
    await expect(diffContainer).toContainText('Alimentation');
    await expect(diffContainer).toContainText('➔');
    await expect(diffContainer).toContainText('Loisirs');

    // 2. Vérifier le diff de montant (54.20 € ➔ 75.00 €)
    await expect(diffContainer).toContainText('54.20 €');
    await expect(diffContainer).toContainText('75.00 €');

    // Vérifier que l'ancien texte est bien barré (line-through)
    const oldValCat = diffContainer.locator('span', { hasText: 'Alimentation' });
    await expect(oldValCat).toHaveCSS('text-decoration-line', 'line-through');
  });

  test('13.02 - Validation de l\'action via la modale, mise à jour en base et idempotence', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    await goToView(page, 'chat');

    const actionBox = page.locator('.ai-action-box').first();
    await expect(actionBox).toBeVisible({ timeout: 10000 });

    // Cliquer sur le bouton d'examen de la carte
    const reviewBtn = actionBox.locator('button[data-action-id]').first();
    await reviewBtn.click();

    // Vérifier l'ouverture de la modale de révision détaillée
    const modal = page.locator('#aiActionModal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    const modalDetails = page.locator('#aiActionDetails');
    await expect(modalDetails).toContainText("Correction d'une opération");
    await expect(modalDetails).toContainText("Courses Supermarché");

    // Valider l'application de l'action
    const confirmBtn = page.locator('#aiActionConfirmBtn');
    await confirmBtn.click();

    // La modale doit se fermer
    await expect(modal).toBeHidden({ timeout: 5000 });

    // La carte d'action doit maintenant être marquée comme appliquée
    const appliedBadge = page.locator('.ai-action-box-applied');
    await expect(appliedBadge).toBeVisible({ timeout: 8000 });
    await expect(appliedBadge).toContainText('Action appliquée');

    // Vérifier que la transaction a bien été mise à jour en base via l'API
    const res = await page.request.get('/api/transactions/1');
    expect(res.ok()).toBeTruthy();
    const updatedTx = await res.json();
    expect(updatedTx.category).toBe('Loisirs');
    expect(updatedTx.amount).toBe(75.0);

    // Recharger la vue pour vérifier la persistance de l'état appliqué (anti-double clic)
    await page.reload();
    await dismissOverlays(page);
    await goToView(page, 'chat');

    const reloadedAppliedBadge = page.locator('.ai-action-box-applied');
    await expect(reloadedAppliedBadge).toBeVisible({ timeout: 8000 });
    await expect(reloadedAppliedBadge).toContainText('Action appliquée');
  });
});
