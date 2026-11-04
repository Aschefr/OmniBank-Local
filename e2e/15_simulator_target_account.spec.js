// e2e/15_simulator_target_account.spec.js
// Simulateur : changement de compte cible sans courbe périmée, conseil d'effort cohérent, compte d'un événement.
// Les réponses de /api/simulator/run sont simulées : le test ne dépend pas des données de l'instance.
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays } = require('./helpers/page_objects');

const WITH_BANDS = 1;
const WITHOUT_BANDS = 2;

function patchTrajectory(json, base, stddev) {
  json.variable_expense_stddev = stddev;
  json.monthly_data = json.monthly_data.map((m, i) => ({
    ...m,
    simulated_end_balance: base + i,
    baseline_end_balance: base + i,
    optimistic_end_balance: base + i + stddev,
    pessimistic_end_balance: base + i - stddev,
  }));
  return json;
}

async function mockRun(page, patchFor) {
  await page.route('**/api/simulator/run', async route => {
    const response = await route.fetch();
    const json = await response.json();
    const accountId = route.request().postDataJSON().account_id;
    await route.fulfill({ response, json: patchFor(json, accountId) });
  });
}

const setAccount = (page, id) => page.evaluate(v => window.SimulatorView.onAccountChange(v), String(id));
const chartSeries = page => page.evaluate(() => window.SimulatorView.chart.data.datasets.map(d => ({
  label: d.label,
  last: d.data[d.data.length - 1],
})));

// Le bouton du menu peut être replié dans « Plus » selon la largeur.
async function openSimulator(page) {
  await page.evaluate(() => window.app.loadView('simulator'));
  await page.waitForSelector('#simAccountSelect');
  // Le premier calcul doit être terminé : sa réponse écraserait celle du compte choisi par le test
  await page.waitForFunction(() => window.SimulatorView.simulationData && window.SimulatorView.chart);
}

test.describe('Simulateur : compte cible', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);
  });

  test('15.01 - Le graphique suit le compte choisi, sans courbe périmée', async ({ page }) => {
    await mockRun(page, (json, accountId) => (accountId === WITHOUT_BANDS
      ? patchTrajectory(json, -5000, 0)
      : patchTrajectory(json, 7000, 100)));
    await openSimulator(page);

    await setAccount(page, WITH_BANDS);
    let series = await chartSeries(page);
    expect(series).toHaveLength(4);

    await setAccount(page, WITHOUT_BANDS);
    series = await chartSeries(page);
    const last = -5000 + (await page.evaluate(() => window.SimulatorView.horizonMonths)) - 1;
    expect(series.map(s => s.last)).toEqual([last, last]);

    await setAccount(page, WITH_BANDS);
    series = await chartSeries(page);
    const lastWith = 7000 + (await page.evaluate(() => window.SimulatorView.horizonMonths)) - 1;
    expect(series.map(s => s.last)).toEqual([lastWith + 100, lastWith, lastWith - 100, lastWith]);
  });

  test("15.02 - Pas de conseil d'effort sans dépense variable, et le vrai pourcentage sinon", async ({ page }) => {
    await mockRun(page, (json, accountId) => Object.assign(patchTrajectory(json, -5000, 0), {
      is_overdraft_risk: true,
      break_even_monthly_saving: 500,
      break_even_var_reduction_pct: 95.6,
      is_fixed_expenses_deficit: accountId === WITHOUT_BANDS,
      fixed_deficit_monthly: accountId === WITHOUT_BANDS ? 500 : 0,
      avg_variable_expense: accountId === WITHOUT_BANDS ? 0 : 1000,
    }));
    await openSimulator(page);

    await setAccount(page, WITHOUT_BANDS);
    await expect(page.locator('.sim-break-even-container')).toHaveCount(0);

    await setAccount(page, WITH_BANDS);
    await expect(page.locator('.sim-break-even-container')).toContainText('-96%');
  });

  test('15.03 - Sans salaire sur le compte, les sources ne parlent pas de salaire', async ({ page }) => {
    await mockRun(page, json => Object.assign(json, { predicted_salary: 0, conservative_weight: 1 }));
    await openSimulator(page);
    await page.evaluate(() => {
      window.SimulatorView.conservativeWeight = 1;
      return window.SimulatorView.onAccountChange('2');
    });

    const sources = page.locator('#simSourcesBody');
    await expect(sources).toHaveCount(1);
    const text = await sources.evaluate(el => el.textContent);
    expect(text).not.toContain('0 €/');
    const expected = await page.evaluate(() => window.i18n.t('sim_transparency_recommended_no_other'));
    expect(text).toContain(expected);
  });

  test('15.05 - Pas de « -0,00 € » dans le détail mois par mois', async ({ page }) => {
    await mockRun(page, json => {
      json.monthly_data = json.monthly_data.map(m => ({ ...m, baseline_fixed: 0, baseline_variable: 0 }));
      return json;
    });
    await openSimulator(page);
    await setAccount(page, WITHOUT_BANDS);

    const html = await page.evaluate(() => window.SimulatorView.renderMonthlyTable(window.SimulatorView.simulationData));
    expect(html).not.toMatch(/[-+]\s*0,00/);
  });

  test('15.07 - Le curseur de scénario change le solde affiché à côté, et le mode conseillé le remet à zéro', async ({ page }) => {
    await openSimulator(page);
    await page.evaluate(() => window.SimulatorView.setSimMode('advanced'));
    await page.waitForSelector('#simScenarioSlider');
    await page.evaluate(() => window.SimulatorView.setScenarioLevel(0));
    await page.waitForFunction(() => window.SimulatorView.simulationData.scenario.level === 0);

    const sent = [];
    page.on('request', r => { if (r.url().includes('/api/simulator/run')) sent.push(r.postDataJSON()); });
    const shown = () => page.evaluate(() => document.getElementById('simScenarioReadout').textContent);
    const before = await shown();

    await page.evaluate(() => {
      const slider = document.getElementById('simScenarioSlider');
      slider.value = 100;
      slider.dispatchEvent(new Event('input'));
    });
    await expect(page.locator('#simScenarioLabel')).toHaveText(await page.evaluate(() => window.i18n.t('sim_adv_level_hard')));
    await page.waitForFunction(() => window.SimulatorView.simulationData.scenario.level === 1);
    expect(sent.some(body => body.projection_profile === 'recommended' && body.scenario_level === 1)).toBeTruthy();
    await expect.poll(shown).not.toBe(before);

    await page.evaluate(() => window.SimulatorView.setSimMode('recommended'));
    await page.waitForFunction(() => window.SimulatorView.simulationData.scenario.level === 0);
    expect(sent[sent.length - 1].scenario_level).toBe(0);
  });

  test('15.08 - Ouvert directement en mode avancé, le panneau suit le premier calcul', async ({ page }) => {
    await openSimulator(page);
    await page.evaluate(() => window.SimulatorView.setSimMode('advanced'));
    await page.waitForSelector('#simScenarioSlider');
    await page.evaluate(() => { window.SimulatorView.simulationData = null; window.SimulatorView.render(); });
    await page.evaluate(() => window.SimulatorView.runSimulation());
    await page.evaluate(() => window.SimulatorView.updateLiveSimulationView(false));
    await page.evaluate(() => window.SimulatorView.onHorizonChange('6'));

    const panel = await page.evaluate(() => ({
      label: document.querySelector('.sim-adv-result span').textContent,
      favorable: window.SimulatorView.simulationData.scenario.favorable_available,
      min: document.getElementById('simScenarioSlider').min,
    }));
    expect(panel.label).toContain('6');
    expect(panel.min).toBe(panel.favorable ? '-100' : '0');

    await page.evaluate(() => window.SimulatorView.onHorizonChange('12'));
    await page.evaluate(() => window.SimulatorView.setSimMode('recommended'));
  });

  test('15.06 - Sur téléphone, rien de coupé ni de caché', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openSimulator(page);
    await page.evaluate(() => window.SimulatorView.setSimMode('recommended'));

    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      return {
        headerBottom: rect('.app-header').bottom,
        titleTop: rect('#simulatorRoot .view-header-title').top,
        titleRight: rect('#simulatorRoot .view-header-title span:last-child').right,
        barPosition: getComputedStyle(document.querySelector('#simulatorRoot .view-header-bar')).position,
        stripRight: rect('#simRecommendedStrip').right,
        stripButtonRight: rect('#simRecommendedStrip button').right,
      };
    });
    expect(layout.titleTop).toBeGreaterThanOrEqual(layout.headerBottom);
    expect(layout.barPosition).toBe('static');
    expect(layout.stripButtonRight).toBeLessThanOrEqual(layout.stripRight);
    expect(layout.titleRight).toBeLessThanOrEqual(360);

    await page.evaluate(() => window.SimulatorView.setSimMode('advanced'));
    await page.waitForSelector('#simScenarioSlider');
    await page.evaluate(() => { document.querySelector('.sim-adv-details').open = true; });
    const advanced = await page.evaluate(() => {
      const panel = document.querySelector('.sim-adv');
      const select = document.getElementById('simIncomeModeSelect').getBoundingClientRect();
      return { width: panel.clientWidth, content: panel.scrollWidth, selectRight: select.right, viewport: innerWidth, resultRight: document.getElementById('simAdvResultValue').getBoundingClientRect().right };
    });
    expect(advanced.content).toBeLessThanOrEqual(advanced.width);
    expect(advanced.selectRight).toBeLessThanOrEqual(advanced.viewport);
    expect(advanced.resultRight).toBeLessThanOrEqual(advanced.viewport);
    await page.evaluate(() => window.SimulatorView.setSimMode('recommended'));

    await page.evaluate(() => {
      window.SimulatorView.activeScenarioId = 1;
      window.SimulatorView.openAddEventModal();
    });
    const form = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect();
      return { type: rect('simEvType').width, account: rect('simEvAccount').width };
    });
    expect(form.type).toBe(form.account);
    await expect(page.locator('#simEventModal button[type=submit]')).toBeInViewport();
  });

  test("15.04 - Le formulaire d'événement enregistre le compte choisi", async ({ page }) => {
    await openSimulator(page);
    await page.evaluate(() => {
      window.SimulatorView.accounts = [{ id: 2, name: 'Compte test' }];
      window.SimulatorView.activeScenarioId = 1;
      window.SimulatorView.openAddEventModal();
    });

    let sent = null;
    await page.route('**/api/simulator/scenarios/1/events', route => {
      sent = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: 1, ...sent } });
    });
    await page.fill('#simEvLabel', 'Achat');
    await page.selectOption('#simEvAccount', '2');
    await page.evaluate(() => window.SimulatorView.saveEventModal());

    await expect.poll(() => sent && sent.account_id).toBe(2);
  });
});
