// @ts-check
// Cockpit : la carte du réel face à la prévision. Les réponses de /api/simulator/forecast-tracking sont simulées :
// le test ne dépend pas des données de l'instance.
const { test, expect } = require('@playwright/test');
const { openApp, dismissOverlays } = require('./helpers/page_objects');

const today = new Date().toISOString().slice(0, 10);
const inDays = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function tracking(overrides = {}) {
  return {
    available: true,
    kind: 'cycle',
    period_start: inDays(-5),
    period_end: inDays(20),
    created_on: inDays(-5),
    is_first_day: false,
    recent_history: false,
    points: [-5, 0, 10, 20].map((n, i) => ({ date: inDays(n), balance: 2000 - i * 400, tolerance: 20 + i * 50 })),
    real: [{ date: inDays(-5), balance: 2000 }, { date: today, balance: 1800 }],
    real_today: 1800,
    forecast_today: 1600,
    gap: 200,
    tolerance: 70,
    status: 'above',
    ...overrides,
  };
}

async function openCockpit(page, response) {
  await page.route('**/api/simulator/forecast-tracking*', route => route.fulfill({ json: response }));
  await page.evaluate(() => window.app.loadView('overview'));
  await page.waitForFunction(() => window.OverviewView && document.getElementById('ovCockpitTracking'));
  // La page a pu charger la vraie réponse avant la simulation, et API.get garde une réponse 500 ms
  await page.waitForTimeout(600);
  await page.evaluate(() => window.OverviewView._fetchForecastTracking());
}

test.describe('Cockpit : réel face à la prévision', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await dismissOverlays(page);
    await page.evaluate(() => window.ProfileStorage.set('ov_tracking_open', ''));
  });

  test('16.01 - La phrase dit où on en est, et la courbe montre réel et prévision', async ({ page }) => {
    await openCockpit(page, tracking());

    await expect(page.locator('.cockpit-tracking-status')).toHaveClass(/is-above/);
    await expect(page.locator('.cockpit-tracking-status')).toContainText('200');
    await expect(page.locator('#ovTrackingCanvas')).toBeVisible();

    const series = await page.evaluate(() => window.OverviewView._trackingChart.data.datasets.map(d => d.data.filter(v => v !== null).length));
    expect(series[2]).toBe(4);
    expect(series[3]).toBe(2);

    // La prévision reste tracée sur toute la période, derrière le réel
    const order = await page.evaluate(() => window.OverviewView._trackingChart.data.datasets.map(d => d.order));
    expect(order[3]).toBeLessThan(order[2]);
    expect(order[2]).toBeLessThan(order[0]);
  });

  test('16.02 - Dans la marge, en dessous et premier jour', async ({ page }) => {
    await openCockpit(page, tracking({ status: 'on_track', gap: -15 }));
    await expect(page.locator('.cockpit-tracking-status')).toHaveClass(/is-on_track/);
    await expect(page.locator('.cockpit-tracking-status')).toContainText('15');

    await page.evaluate(data => { window.OverviewView._forecastTracking = data; window.OverviewView._renderForecastTracking(); }, tracking({ status: 'below', gap: -300 }));
    await expect(page.locator('.cockpit-tracking-status')).toHaveClass(/is-below/);

    await page.evaluate(data => { window.OverviewView._forecastTracking = data; window.OverviewView._renderForecastTracking(); }, tracking({ is_first_day: true, gap: 0, status: 'on_track' }));
    await expect(page.locator('.cockpit-tracking-status')).toHaveClass(/is-first-day/);
  });

  test("16.03 - L'organisation suit son exercice, et une carte vide ne s'affiche pas", async ({ page }) => {
    await openCockpit(page, tracking({ kind: 'exercise', period_start: '2026-01-01', period_end: '2026-12-31' }));
    await expect(page.locator('.cockpit-tracking-title')).toContainText('2026');

    await page.evaluate(() => { window.OverviewView._forecastTracking = { available: false }; window.OverviewView._renderForecastTracking(); });
    await expect(page.locator('#ovCockpitTracking')).toBeHidden();
  });

  test("16.06 - L'information du titre s'ouvre aussi au toucher", async ({ page }) => {
    await openCockpit(page, tracking());
    await expect(page.locator('.cockpit-tracking-hint')).toHaveCount(0);
    await page.locator('.cockpit-tracking-info').click();
    await expect(page.locator('.cockpit-tracking-hint')).toBeVisible();
    await expect(page.locator('.cockpit-tracking-info')).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.cockpit-tracking-info').click();
    await expect(page.locator('.cockpit-tracking-hint')).toHaveCount(0);
  });

  test('16.05 - Le repère de rythme selon la situation', async ({ page }) => {
    await openCockpit(page, tracking());
    const show = (pace, known) => page.evaluate(([p, k]) => {
      const view = window.OverviewView;
      view._stats = view._stats || {};
      view._calculateProjection = () => ({ projectedEnd: k, titleText: 'Fin de cycle, opérations prévues seules' });
      view._forecastTracking = { ...view._forecastTracking, pace: p };
      view._renderForecastTracking();
    }, [pace, known]);
    const line = page.locator('.cockpit-tracking-pace');

    await show({ kind: 'cycle', usual_per_day: 38, days_left: 24 }, 213);
    await expect(line).toHaveClass(/is-warning/);
    await expect(line).toContainText('38');
    await expect(line).toContainText('9');
    await expect(page.locator('.cockpit-tracking-explain')).toBeVisible();

    await show({ kind: 'cycle', usual_per_day: 5, days_left: 24 }, 213);
    await expect(line).toHaveClass(/is-calm/);

    await show({ kind: 'cycle', usual_per_day: 38, days_left: 24 }, -120);
    await expect(line).toHaveClass(/is-warning/);
    await expect(line).toContainText('120');

    await show({ kind: 'exercise', engageable: 50000, expected_spending: 15000 }, 0);
    await expect(line).toHaveClass(/is-calm/);
    await expect(line).toContainText('50');

    await show(null, 213);
    await expect(line).toHaveCount(0);
  });

  test('16.04 - Sur téléphone, la courbe est repliée, et rien ne déborde une fois ouverte', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await openCockpit(page, tracking());
    await expect(page.locator('#ovTrackingCanvas')).toHaveCount(0);
    await expect(page.locator('.cockpit-tracking-status')).toBeVisible();

    await page.locator('.cockpit-tracking-toggle').click();
    await expect(page.locator('#ovTrackingCanvas')).toBeVisible();

    const overflow = await page.evaluate(() => {
      const box = document.getElementById('ovCockpitTracking').getBoundingClientRect();
      return { right: box.right, viewport: innerWidth, page: document.documentElement.scrollWidth - innerWidth };
    });
    expect(overflow.right).toBeLessThanOrEqual(overflow.viewport);
    expect(overflow.page).toBeLessThanOrEqual(0);
  });
});
