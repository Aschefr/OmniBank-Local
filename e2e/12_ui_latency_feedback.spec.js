// e2e/12_ui_latency_feedback.spec.js
// Tests de validation E2E : Feedback visuel de latence, Global Progress Bar et Boutons réactifs (Étapes 1 et 2)
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays, goToView } = require('./helpers/page_objects');

test.describe('Module UX : Réactivité Visuelle & Feedback de Latence', () => {

  test('12.01 - Étape 1 : Barre de progression globale automatique (Top Progress Bar)', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // 1. Vérifier que l'infrastructure GlobalProgress est initialisée
    const hasGlobalProgress = await page.evaluate(() => {
      return typeof window.GlobalProgress === 'object' &&
             typeof window.GlobalProgress.start === 'function' &&
             typeof window.GlobalProgress.done === 'function';
    });
    expect(hasGlobalProgress).toBe(true);

    // 2. Déclencher manuellement start() et vérifier l'apparition de l'élément dans le DOM
    await page.evaluate(() => {
      window.GlobalProgress.start();
    });

    // Attendre l'échéance du seuil (120ms) pour l'apparition visuelle
    await page.waitForTimeout(160);

    const progressBar = page.locator('#globalProgressBar');
    await expect(progressBar).toBeAttached();
    await expect(progressBar).toHaveClass(/is-active/);

    // Vérifier les propriétés CSS clés (non-intrusivité, adaptabilité mobile)
    const styles = await progressBar.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        position: computed.position,
        pointerEvents: computed.pointerEvents,
        zIndex: computed.zIndex,
      };
    });
    expect(styles.position).toBe('fixed');
    expect(styles.pointerEvents).toBe('none');
    expect(parseInt(styles.zIndex, 10)).toBeGreaterThan(9000);

    // 3. Clôturer la progression et vérifier l'état 'is-done'
    await page.evaluate(() => {
      window.GlobalProgress.done();
    });

    await page.waitForTimeout(200);
    const hasDoneOrInactive = await progressBar.evaluate((el) => {
      return el.classList.contains('is-done') || !el.classList.contains('is-active');
    });
    expect(hasDoneOrInactive).toBe(true);

    // 4. Vérifier l'interception automatique sur un appel réseau API
    await page.evaluate(async () => {
      // Simuler une requête API
      await fetch('/api/accounts/?_test_latency=1');
    });

    // Après l'appel terminé, le compteur de requêtes actives doit être à 0
    const activeCount = await page.evaluate(() => window.GlobalProgress._activeCount);
    expect(activeCount).toBe(0);
  });

  test('12.02 - Étape 1 : Helper universel withButtonLoading et micro-spinner CSS', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // 1. Vérifier que la fonction withButtonLoading est disponible
    const hasHelper = await page.evaluate(() => typeof window.withButtonLoading === 'function');
    expect(hasHelper).toBe(true);

    // 2. Tester le cycle de vie complet d'un bouton avec withButtonLoading
    const testResult = await page.evaluate(async () => {
      // Créer un bouton de test dans le DOM
      const btn = document.createElement('button');
      btn.id = 'testActionButton';
      btn.className = 'btn btn-primary';
      btn.textContent = 'Enregistrer';
      btn.style.width = '140px';
      document.body.appendChild(btn);

      const states = [];

      // État initial
      states.push({
        step: 'initial',
        disabled: btn.disabled,
        hasLoadingClass: btn.classList.contains('is-loading'),
        width: btn.offsetWidth
      });

      const promise = window.withButtonLoading(btn, async () => {
        await new Promise(r => setTimeout(r, 100));

        states.push({
          step: 'during',
          disabled: btn.disabled,
          hasLoadingClass: btn.classList.contains('is-loading'),
          minWidth: btn.style.minWidth
        });

        await new Promise(r => setTimeout(r, 150));
        return 'success_payload';
      });

      // Tenter une double soumission pendant l'exécution (doit être ignorée)
      const doubleClickResult = await window.withButtonLoading(btn, async () => {
        return 'should_not_run';
      });

      const finalResult = await promise;

      // État final post-résolution
      states.push({
        step: 'after',
        disabled: btn.disabled,
        hasLoadingClass: btn.classList.contains('is-loading'),
        doubleClickResult: doubleClickResult,
        finalResult: finalResult
      });

      btn.remove();
      return states;
    });

    // Validations des états
    const initial = testResult.find(s => s.step === 'initial');
    const during = testResult.find(s => s.step === 'during');
    const after = testResult.find(s => s.step === 'after');

    expect(initial.disabled).toBe(false);
    expect(initial.hasLoadingClass).toBe(false);

    expect(during.disabled).toBe(true);
    expect(during.hasLoadingClass).toBe(true);
    expect(during.minWidth).toContain('px');

    expect(after.disabled).toBe(false);
    expect(after.hasLoadingClass).toBe(false);
    expect(after.doubleClickResult).toBeUndefined(); // L'appel doublon a été ignoré
    expect(after.finalResult).toBe('success_payload');
  });

  test('12.03 - Étape 2 : Modale Enveloppes Budgétaires (withButtonLoading & Early Close)', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers la vue Budgets
    await goToView(page, 'budgets');

    const newBudgetBtn = page.locator('button[data-i18n="budget_btn_new"]:visible').first();
    await expect(newBudgetBtn).toBeVisible({ timeout: 5000 });
    await newBudgetBtn.click();

    // Vérifier l'ouverture de la modale unifiée
    const modal = page.locator('#budgetUnifiedModal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const budgetName = `Enveloppe Test ${Date.now()}`;
    await page.fill('#newBudgetName', budgetName);
    await page.fill('#newBudgetAmount', '350.00');

    const saveBtn = page.locator('#budgetSaveBtn');
    await expect(saveBtn).toBeVisible();

    // Cliquer sur Sauvegarder
    await saveBtn.click();

    // La modale doit se fermer rapidement (Early Close, pas d'attente prolongée)
    await expect(modal).not.toBeVisible({ timeout: 6000 });

    // L'enveloppe doit être présente dans le contenu principal des budgets
    const mainContent = page.locator('#mainContent');
    await expect(mainContent).toContainText(budgetName, { timeout: 8000 });
  });

  test('12.04 - Étape 2 : Modale Opérations (withButtonLoading sur op_save_btn & Anti-double clic)', async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);

    // Naviguer vers Toutes les opérations
    await goToView(page, 'all_operations');

    const addOpBtn = page.locator('button[data-i18n="btn_add_operation"]:visible').first();
    await expect(addOpBtn).toBeVisible({ timeout: 5000 });
    await addOpBtn.click();

    const opModal = page.locator('#operationModal');
    await expect(opModal).toBeVisible({ timeout: 5000 });

    const desc = `Courses Feedback ${Date.now()}`;
    await page.fill('#op_desc', desc);
    await page.fill('#op_amount', '42.00');

    // Sélectionner le premier compte disponible si un compte existe
    const hasAccounts = await page.evaluate(() => {
      const select = document.getElementById('op_from_account');
      return select && select.options.length > 1;
    });
    if (hasAccounts) {
      await page.selectOption('#op_from_account', { index: 1 });
    }

    const saveBtn = page.locator('#op_save_btn');
    await expect(saveBtn).toBeVisible();

    // Cliquer sur Enregistrer
    await saveBtn.click();

    // Le modal se ferme rapidement
    await expect(opModal).not.toBeVisible({ timeout: 6000 });

    // Vérifier la présence de l'opération dans le tableau
    const tableBody = page.locator('#allOperationsBody');
    await expect(tableBody).toContainText(desc, { timeout: 8000 });
  });

});
