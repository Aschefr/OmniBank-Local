// e2e/14_pdf_export_intent.spec.js
// Mesure l'accord entre l'intention et le PDF obtenu : voir e2e/PDF_EXPORT_PROTOCOL.md
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { dismissOverlays } = require('./helpers/page_objects');
const { norm, readPdfPages, locate, computeExpected, parseAmount, measureLayout, readPrintDom } = require('./helpers/pdf_intent');

const OUT = path.resolve(__dirname, '..', 'test-results', 'pdf-intent');
const BASE = 'http://127.0.0.1:8435';
const YEAR = String(new Date().getFullYear());
const PERSONAL_ALL = ['kpi', 'pie_chart', 'bar_chart', 'balances', 'type_tables', 'transactions_list'];
const ORG_ALL = ['header', 'compte_resultat_ag', 'kpi', 'pie_chart', 'bar_chart', 'balances', 'type_tables', 'transactions_list', 'quitus_ag', 'signature'];

// Chaque scénario écrit ce que veut l'utilisateur. `expect` n'est jamais relu dans le code de l'export.
const PERSONAL = [
  { id: 'P1_defaut', title: 'Réglages par défaut, année en cours', sections: PERSONAL_ALL },
  { id: 'P16_telephone', title: 'Modèle Relevé Détaillé sur téléphone', env: { phone: true }, preset: 'detailed', sections: ['kpi', 'balances', 'type_tables', 'transactions_list'] },
  { id: 'P2_bilan_menage', title: 'Modèle Bilan Annuel Ménage', preset: 'personal', sections: ['kpi', 'balances', 'pie_chart', 'bar_chart', 'type_tables'] },
  { id: 'P3_releve_detaille', title: 'Modèle Relevé Détaillé', preset: 'detailed', sections: ['kpi', 'balances', 'type_tables', 'transactions_list'] },
  { id: 'P4_un_compte', title: 'Un seul compte', oneAccount: true, sections: PERSONAL_ALL },
  { id: 'P5_trois_mois', title: 'Période personnalisée de 3 mois', custom: [`${YEAR}-01-01`, `${YEAR}-03-31`], sections: PERSONAL_ALL },
  { id: 'P6_ordre_et_saut', title: 'Ordre inversé, un saut de page, 3 sections', order: ['type_tables', 'PB', 'balances', 'kpi'], sections: ['type_tables', 'balances', 'kpi'] },
  { id: 'P7_texte_petit', title: 'Texte petit', font: 'small', sections: ['type_tables'] },
  { id: 'P8_texte_grand', title: 'Texte grand', font: 'large', sections: ['type_tables'] },
  { id: 'P9_trois_annees', title: 'Totaux des 3 dernières années', yearTotals: [YEAR, String(+YEAR - 1), String(+YEAR - 2)], sections: ['type_tables'] },
  { id: 'P10_un_type', title: 'Un seul type, 2 catégories', onlyType: 'expense_var', twoCats: true, sections: ['type_tables', 'transactions_list'] },
  { id: 'P11_colonnes', title: 'Détail avec 3 colonnes', cols: ['date', 'desc', 'amount'], sections: ['transactions_list'] },
  // Mêmes demandes, autre environnement d'affichage : le document ne doit pas en dépendre
  { id: 'P12_compact', title: 'Totaux des 3 dernières années, affichage compact', env: { compact: true }, yearTotals: [YEAR, String(+YEAR - 1), String(+YEAR - 2)], sections: ['type_tables'] },
  { id: 'P13_compact_titanium', title: 'Réglages par défaut, compact et thème Titanium sombre', env: { compact: true, theme: 'titanium-dark' }, sections: PERSONAL_ALL },
  { id: 'P14_titanium_clair', title: 'Totaux des 3 dernières années, thème Titanium clair', env: { theme: 'titanium-light' }, yearTotals: [YEAR, String(+YEAR - 1), String(+YEAR - 2)], sections: ['type_tables'] },
  { id: 'P15_classique_clair', title: 'Totaux des 3 dernières années, thème clair', env: { theme: 'light' }, yearTotals: [YEAR, String(+YEAR - 1), String(+YEAR - 2)], sections: ['type_tables'] },
];
const ORG = [
  { id: 'O1_defaut', title: 'Réglages par défaut, exercice en cours', sections: ORG_ALL.filter(s => s !== 'signature' && s !== 'quitus_ag') },
  { id: 'O10_telephone', title: 'Modèle Assemblée Générale sur téléphone', env: { phone: true }, preset: 'ag', headerTitle: 'Rapport Financier - Assemblée Générale Ordinaire', sections: ['header', 'compte_resultat_ag', 'kpi', 'balances', 'pie_chart', 'bar_chart', 'type_tables', 'quitus_ag'] },
  { id: 'O2_ag', title: 'Modèle Assemblée Générale', preset: 'ag', headerTitle: 'Rapport Financier - Assemblée Générale Ordinaire', sections: ['header', 'compte_resultat_ag', 'kpi', 'balances', 'pie_chart', 'bar_chart', 'type_tables', 'quitus_ag'] },
  { id: 'O3_grand_livre', title: 'Modèle Grand Livre & Audit', preset: 'ledger', headerTitle: 'Grand Livre & Audit Analytique', sections: ['header', 'compte_resultat_ag', 'kpi', 'balances', 'type_tables', 'transactions_list', 'signature'] },
  { id: 'O4_titre_libre', title: 'Titre libre et date d\'AG', headerTitle: 'Rapport CSE test 2026', agDate: `${YEAR}-06-15`, enable: ['quitus_ag'], sections: ORG_ALL.filter(s => s !== 'signature') },
  { id: 'O5_un_compte', title: 'Un seul compte', oneAccount: true, sections: ORG_ALL.filter(s => s !== 'signature' && s !== 'quitus_ag') },
  { id: 'O6_exercice_decale', title: 'Exercice à cheval sur 2 années', custom: [`${+YEAR - 1}-09-01`, `${YEAR}-08-31`], sections: ORG_ALL.filter(s => s !== 'signature' && s !== 'quitus_ag') },
  { id: 'O7_signature', title: 'Bloc de signature sans quitus', enable: ['signature'], order: ['header', 'kpi', 'PB', 'signature'], sections: ['header', 'kpi', 'signature'] },
  { id: 'O8_trois_annees', title: 'Totaux des 3 dernières années', yearTotals: [YEAR, String(+YEAR - 1), String(+YEAR - 2)], sections: ['header', 'type_tables'] },
  { id: 'O9_compact', title: 'Modèle Assemblée Générale, affichage compact', env: { compact: true }, preset: 'ag', headerTitle: 'Rapport Financier - Assemblée Générale Ordinaire', sections: ['header', 'compte_resultat_ag', 'kpi', 'balances', 'pie_chart', 'bar_chart', 'type_tables', 'quitus_ag'] },
];

/** Un texte qui identifie chaque section dans le PDF, dans la langue de l'interface. */
const sectionTokens = page => page.evaluate(() => {
  const t = (k, f) => { const v = window.i18n.t(k); return v && v !== k ? v : f; };
  return {
    kpiWanted: `${t('export_kpi_expenses', 'Dépenses')} / ${t('export_kpi_net', 'Résultat net')}`.toLowerCase(),
    kpi: t('export_kpi_net', t('stat_net_worth', 'Résultat Net')),
    pie_chart: t('print_chart_expenses_breakdown', 'Répartition des Dépenses'),
    bar_chart: t('print_chart_monthly_compare', 'Comparatif Mensuel'),
    balances: t('export_balance_title', 'Situation'),
    type_tables: t('analytics_total_period', 'Total période'),
    transactions_list: t('export_sec_transactions_list', 'Détail des opérations'),
    compte_resultat_ag: t('export_org_statement_title', 'Compte de Résultat'),
    quitus_ag: t('export_sec_quitus_ag', 'Quitus'),
    signature: t('print_signature_audit_title', 'Validation'),
  };
});

async function openExport(page, s) {
  await page.goto(BASE);
  // Mode organisation : l'application attend le choix d'un utilisateur avant d'activer la navigation
  const picker = page.locator('#userPickerOverlay');
  await page.waitForTimeout(1500);
  if (await picker.isVisible().catch(() => false)) {
    await page.locator('#userPickerBadges > *').first().click();
    await page.waitForTimeout(800);
  }
  await dismissOverlays(page);
  if (s.env && s.env.compact) await page.click('#compactToggle');
  // Sur téléphone, le menu replie cette entrée sous « Plus »
  if (s.env && s.env.phone) await page.evaluate(() => document.querySelector('.nav-btn[data-view="analytics"]').click());
  else await page.click('.nav-btn[data-view="analytics"]');
  await page.waitForFunction(() => window.AnalyticsView && window.AnalyticsView.data && window.AnalyticsView.data.by_type, null, { timeout: 20000 });
  await page.evaluate(() => window.AnalyticsView.showExportModal());
  await page.waitForSelector('#exportPdfModal');
  await page.waitForTimeout(1500);
}

/** Applique l'intention avec les commandes de la fenêtre. */
async function applyIntent(page, s, ctx) {
  if (s.preset) await page.click(`#exportPdfModal [onclick*="applyExportPreset('${s.preset}')"]`).catch(() => page.evaluate(p => window.AnalyticsView.applyExportPreset(p), s.preset));
  if (s.custom) {
    await page.evaluate(() => window.AnalyticsView.switchExportTab('custom'));
    await page.fill('#exportDateStart', s.custom[0]);
    await page.fill('#exportDateEnd', s.custom[1]);
    await page.evaluate(() => { document.getElementById('exportDateEnd').dispatchEvent(new Event('change', { bubbles: true })); });
  } else {
    await page.evaluate(y => { const sel = document.getElementById('exportSelectYear'); if (sel && [...sel.options].some(o => o.value === y) && sel.value !== y) { sel.value = y; sel.dispatchEvent(new Event('change', { bubbles: true })); } }, YEAR);
  }
  await page.waitForTimeout(600);
  if (s.oneAccount) await page.evaluate(id => window.AnalyticsView._toggleExportAccount(id), ctx.accountId);
  if (!s.preset) {
    await page.evaluate(({ wanted }) => {
      document.querySelectorAll('.sec-enable-cb').forEach(cb => {
        const id = cb.id.replace('sec_enable_', '');
        const on = wanted.includes(id);
        if (cb.checked !== on) cb.click();
      });
    }, { wanted: s.sections });
  }
  if (s.order) {
    await page.evaluate((order) => {
      const V = window.AnalyticsView;
      const list = document.getElementById('exportSectionsList');
      const real = [];
      for (const id of order) {
        if (id === 'PB') { V._addPageBreakCard(); real.push(list.lastElementChild.getAttribute('data-section-id')); } else real.push(id);
      }
      const rest = [...list.querySelectorAll('.export-section-card')].map(c => c.getAttribute('data-section-id')).filter(i => !real.includes(i));
      [...real, ...rest].forEach(id => list.appendChild(list.querySelector(`[data-section-id="${id}"]`)));
      V._saveSectionsOrder();
    }, s.order);
  }
  if (s.font) await page.evaluate(v => { const e = document.getElementById('exportTableFontSize'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, s.font);
  if (s.yearTotals) await page.evaluate(ys => document.querySelectorAll('.export-year-total-cb').forEach(cb => { const on = ys.includes(cb.value); if (cb.checked !== on) cb.click(); }), s.yearTotals);
  if (s.onlyType) {
    ctx.cats = await page.evaluate(({ t, two }) => {
      const out = [];
      document.querySelectorAll('.export-type-cb').forEach(cb => { const on = cb.value === t; if (cb.checked !== on) cb.click(); });
      document.querySelectorAll('.export-cat-cb').forEach(cb => {
        if (cb.getAttribute('data-type') !== t) { cb.checked = false; return; }
        const on = !two || out.length < 2;
        cb.checked = on;
        if (on) out.push(cb.value);
      });
      window.AnalyticsView._saveExportCategorySelection();
      return out;
    }, { t: s.onlyType, two: s.twoCats });
  }
  if (s.cols) await page.evaluate(cols => document.querySelectorAll('.export-col-cb').forEach(cb => { cb.checked = cols.includes(cb.value); }), s.cols);
  // Le champ peut être dans une section repliée : on écrit dedans comme le fait la saisie
  if (s.headerTitle && !s.preset) await page.evaluate(t => { const e = document.getElementById('exportHeaderTitle'); e.value = t; e.dispatchEvent(new Event('input', { bubbles: true })); }, s.headerTitle);
  if (s.agDate) await page.evaluate(d => { const e = document.getElementById('exportAgDate'); if (e) { e.value = d; e.dispatchEvent(new Event('change', { bubbles: true })); } }, s.agDate);
  await page.evaluate(() => window.AnalyticsView.triggerLivePreviewUpdate());
  await page.waitForTimeout(1800);
}

/** Lance le vrai chemin d'impression, puis remet son contenu en place pour produire le PDF. */
async function printToPdf(page, file) {
  await page.evaluate(async () => {
    window.print = () => {
      const c = document.getElementById('printContainer');
      window.__printedHtml = c ? c.innerHTML : null;
    };
    await window.AnalyticsView.executePrint();
  });
  await page.waitForFunction(() => window.__printedHtml !== undefined, null, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    let c = document.getElementById('printContainer');
    if (!c) { c = document.createElement('div'); c.id = 'printContainer'; document.body.appendChild(c); }
    c.innerHTML = window.__printedHtml;
    document.body.classList.add('printing-offline');
  });
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 718, height: 1040 });
  await page.waitForTimeout(300);
  const layout = await page.evaluate(measureLayout, '#printContainer');
  const dom = await page.evaluate(readPrintDom, '#printContainer');
  await page.screenshot({ path: file.replace('.pdf', '_impression.png'), fullPage: true });
  await page.pdf({ path: file, format: 'A4', preferCSSPageSize: true, printBackground: true });
  return { layout, dom };
}

function monthsOfPeriod(start, end) {
  const out = [];
  let y = +start.slice(0, 4), m = +start.slice(5, 7);
  const ey = +end.slice(0, 4), em = +end.slice(5, 7);
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

function evaluate(s, ctx, r) {
  const checks = [];
  const add = (code, dim, ok, detail) => checks.push({ code, dim, status: ok === null ? 'SANS OBJET' : ok ? 'OK' : 'ÉCART', detail: ok ? '' : detail });
  const { pages, tokens, layout, dom, preview, previewBadge } = r;
  const on = s.sections.filter(x => x !== 'header');
  const pos = Object.fromEntries(on.map(id => [id, locate(pages, tokens[id])]));
  const missing = on.filter(id => !pos[id]);
  const all = ctx.isOrg ? ORG_ALL : PERSONAL_ALL;
  const extra = all.filter(id => id !== 'header' && !s.sections.includes(id) && locate(pages, tokens[id]) && !(id === 'kpi' && s.sections.includes('compte_resultat_ag')));
  add('C1', 'Contenu', !missing.length && !extra.length, [missing.length && `absentes : ${missing.join(', ')}`, extra.length && `en trop : ${extra.join(', ')}`].filter(Boolean).join(' ; '));

  const wantedOrder = (s.order ? s.order.filter(x => x !== 'PB') : s.sections).filter(x => x !== 'header' && pos[x]);
  const before = (a, b) => a.page < b.page || (a.page === b.page && a.line <= b.line);
  const wrong = wantedOrder.slice(1).filter((id, i) => !before(pos[wantedOrder[i]], pos[id])).map(id => id);
  add('C2', 'Contenu', wantedOrder.length < 2 ? null : !wrong.length, `mal placées : ${wrong.join(', ')}`);

  const start = s.custom ? s.custom[0] : `${YEAR}-01-01`;
  const end = s.custom ? s.custom[1] : `${YEAR}-12-31`;
  const wantMonths = monthsOfPeriod(start, end);
  const firstType = Object.values(dom.types)[0];
  add('C3', 'Contenu', firstType ? firstType.heads.length === wantMonths.length : null, firstType ? `${firstType.heads.length} colonnes de mois pour ${wantMonths.length} demandés` : '');

  const expected = computeExpected(ctx.allTx, { start, end, accountIds: s.oneAccount ? [ctx.accountId] : null });
  if (s.onlyType) {
    const shown = Object.keys(dom.types);
    const rows = dom.types[s.onlyType] ? Object.keys(dom.types[s.onlyType].rows) : [];
    const strayCats = rows.filter(c => !ctx.cats.includes(c));
    add('C4', 'Contenu', shown.length === 1 && shown[0] === s.onlyType && !strayCats.length, `types : ${shown.join(', ')} ; catégories en trop : ${strayCats.slice(0, 5).join(', ')}`);
  } else add('C4', 'Contenu', null);

  const firstYears = firstType ? firstType.years : [];
  add('C5', 'Contenu', s.yearTotals && firstType ? [...firstYears].sort().join() === [...s.yearTotals].sort().join() : null, `colonnes de totaux : ${firstYears.join(', ')} pour ${(s.yearTotals || []).join(', ')} demandées`);

  if (s.cols) {
    const same = [...dom.detailCols].sort().join() === [...s.cols].sort().join();
    add('C6', 'Contenu', dom.detailRows === 0 ? null : same, `colonnes obtenues : ${dom.detailCols.join(', ')}`);
  } else add('C6', 'Contenu', null);

  const pdfText = norm(pages.join(' '));
  if (s.headerTitle) add('C7', 'Contenu', pdfText.includes(norm(s.headerTitle)), `titre absent : ${s.headerTitle}`);
  else add('C7', 'Contenu', null);
  if (s.agDate) {
    const [y, m, d] = s.agDate.split('-');
    add('C7', 'Contenu', pdfText.includes(`${d}/${m}/${y}`) || pdfText.includes(s.agDate), `date d'AG absente : ${s.agDate}`);
  }
  if (s.oneAccount && s.sections.includes('balances')) {
    const others = ctx.accounts.filter(a => a.id !== ctx.accountId && !a.is_closed).filter(a => r.balanceText.includes(norm(a.name)));
    add('C8', 'Contenu', !others.length, `autres comptes présents dans la situation : ${others.length}`);
  } else add('C8', 'Contenu', null);

  // Montants
  if (s.sections.includes('kpi') && !s.onlyType) {
    const has = v => r.pdfAmounts.has(Math.round(v * 100));
    const miss = [];
    if (!has(expected.income)) miss.push(`recettes attendues ${expected.income.toFixed(2)}`);
    if (!has(expected.expense)) miss.push(`dépenses attendues ${expected.expense.toFixed(2)}`);
    add('M1', 'Montants', !miss.length, miss.join(' ; '));
  } else add('M1', 'Montants', null);

  if (Object.keys(dom.types).length) {
    const diffs = [];
    let compared = 0;
    for (const [t, block] of Object.entries(dom.types)) {
      for (const [cat, cells] of Object.entries(block.rows)) {
        const months = wantMonths;
        if (cells.length !== months.length) continue;
        cells.forEach((txt, i) => {
          const want = (((expected.byType[t] || {})[cat] || {})[months[i]] || 0);
          const got = parseAmount(txt) || 0;
          compared++;
          if (Math.abs(want - got) > 0.011) diffs.push(`${t}/${cat}/${months[i]} : ${got} au lieu de ${want.toFixed(2)}`);
        });
      }
    }
    add('M2', 'Montants', compared ? !diffs.length : null, `${diffs.length} cellule(s) sur ${compared}, ex. ${diffs.slice(0, 3).join(' ; ')}`);
  } else add('M2', 'Montants', null);

  if (s.sections.includes('transactions_list') && !s.onlyType) {
    add('M3', 'Montants', dom.detailRows === expected.listed.length, `${dom.detailRows} opérations listées, ${expected.listed.length} attendues`);
  } else add('M3', 'Montants', null);

  add('L7', 'Lisibilité', !r.brokenButtons.length, `boutons débordés : ${r.brokenButtons.join(', ')}`);

  // Soldes : ce que le document annonce, comparé aux soldes de l'application
  const shownAccounts = ctx.accounts.filter(a => !a.is_closed && (!s.oneAccount || a.id === ctx.accountId));
  const cents = v => Math.round(v * 100);
  if (s.sections.includes('balances') && dom.balances) {
    const wrong = dom.balances.rows.filter(row => {
      const acc = shownAccounts.find(a => a.name === row.name);
      return !acc || cents(parseAmount(row.amount)) !== cents(acc.current_balance);
    }).map(row => `${row.name} : ${row.amount}`);
    const total = shownAccounts.reduce((sum, a) => sum + a.current_balance, 0);
    if (cents(parseAmount(dom.balances.total)) !== cents(total)) wrong.push(`total ${dom.balances.total}, attendu ${total.toFixed(2)}`);
    add('M4', 'Montants', !wrong.length, wrong.slice(0, 4).join(' ; '));
  } else add('M4', 'Montants', null);

  if (dom.cash !== null) {
    const liquid = shownAccounts.filter(a => a.type !== 'Prêt / Emprunt').reduce((sum, a) => sum + a.current_balance, 0);
    add('M5', 'Montants', cents(parseAmount(dom.cash)) === cents(liquid), `trésorerie ${dom.cash}, attendue ${liquid.toFixed(2)}`);
  } else add('M5', 'Montants', null);

  // Un total de toutes les dépenses ne s'appelle pas « dépenses fixes », un résultat de période pas « valeur nette »
  if (s.sections.includes('kpi') && dom.kpiLabels.expense) {
    const labels = `${dom.kpiLabels.expense} / ${dom.kpiLabels.net}`.toLowerCase();
    add('C9', 'Contenu', labels === r.kpiWanted, `libellés : ${labels}, attendus : ${r.kpiWanted}`);
  } else add('C9', 'Contenu', null);

  // Pagination
  if (s.order && s.order.includes('PB')) {
    const i = s.order.indexOf('PB');
    const a = pos[s.order[i - 1]], b = pos[s.order[i + 1]];
    add('P1', 'Pagination', a && b ? b.page > a.page : null, `${s.order[i - 1]} page ${a && a.page + 1}, ${s.order[i + 1]} page ${b && b.page + 1}`);
  } else add('P1', 'Pagination', null);
  const blanks = pages.map((p, i) => (p.trim().length < 8 ? i + 1 : 0)).filter(Boolean);
  add('P2', 'Pagination', !blanks.length, `pages blanches : ${blanks.join(', ')}`);
  const orphans = pages.flatMap((p, i) => {
    if (i === pages.length - 1) return [];
    const lines = p.split('\n').map(l => l.trim()).filter(Boolean);
    const last = norm(lines[lines.length - 1] || '');
    return Object.entries(tokens).filter(([id]) => id !== 'kpi' && s.sections.includes(id)).filter(([, t]) => last.includes(norm(t))).map(([id]) => `${id} page ${i + 1}`);
  });
  add('P3', 'Pagination', !orphans.length, `titres isolés : ${orphans.join(', ')}`);

  // Fidélité
  // Le nombre de pages est une estimation annoncée comme telle : l'écart reste petit
  add('F1', 'Fidélité', previewBadge ? Math.abs(previewBadge - pages.length) <= Math.max(1, Math.ceil(pages.length * 0.15)) : null, `aperçu : ${previewBadge} page(s), PDF : ${pages.length}`);
  const previewOrder = on.map(id => [id, preview.text.indexOf(norm(tokens[id]))]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const pdfOrder = on.filter(id => pos[id]).sort((a, b) => (before(pos[a], pos[b]) ? -1 : 1));
  add('F2', 'Fidélité', previewOrder.join() === pdfOrder.join(), `aperçu : ${previewOrder.join(' > ')} ; PDF : ${pdfOrder.join(' > ')}`);
  const hp = preview.layout.headFont, hi = layout.headFont;
  add('F3', 'Fidélité', hp && hi ? Math.abs(hp - hi) <= 1 : null, `en-têtes de tableau : ${hp} px dans l'aperçu, ${hi} px à l'impression`);

  // Lisibilité, à l'impression puis dans l'aperçu
  const both = (code, key, msg) => {
    const a = (layout[key] || []).slice(0, 4), b = (preview.layout[key] || []).slice(0, 4);
    add(code, 'Lisibilité', !a.length && !b.length, [a.length && `impression (${layout[key].length}) : ${a.join(' | ')}`, b.length && `aperçu (${preview.layout[key].length}) : ${b.join(' | ')}`].filter(Boolean).join(' ; ') || msg);
  };
  both('L1', 'overlaps');
  both('L2', 'splitWords');
  const leaks = [...(layout.overflows || []), ...(layout.offPage || [])];
  const leaksP = [...(preview.layout.overflows || []), ...(preview.layout.offPage || [])];
  add('L3', 'Lisibilité', !leaks.length && !leaksP.length, [leaks.length && `impression (${leaks.length}) : ${leaks.slice(0, 4).join(' | ')}`, leaksP.length && `aperçu (${leaksP.length}) : ${leaksP.slice(0, 4).join(' | ')}`].filter(Boolean).join(' ; '));
  add('L4', 'Lisibilité', !layout.clippedAmounts.length, `${layout.clippedAmounts.length} montant(s) coupé(s) : ${layout.clippedAmounts.slice(0, 4).join(' | ')}`);
  add('L5', 'Lisibilité', layout.minFont === 99 ? null : layout.minFont >= 6, `plus petit texte de tableau : ${layout.minFont} px`);
  return checks;
}

function score(checks) {
  const ok = checks.filter(c => c.status === 'OK').length;
  const ko = checks.filter(c => c.status === 'ÉCART').length;
  return { ok, ko, pct: ok + ko ? Math.round((ok / (ok + ko)) * 1000) / 10 : 100 };
}

const results = [];

test.describe.configure({ mode: 'serial' });

test('Export PDF : accord entre intention et résultat', async ({ browser, request }) => {
  test.setTimeout(45 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const initial = (await (await request.get(`${BASE}/api/profiles/`)).json());
  const profiles = (process.env.PDF_INTENT_PROFILES || initial.active_profile_id).split(',').map(s => s.trim()).filter(Boolean);
  const fontSizes = {};

  for (const pid of profiles) {
    const act = await request.post(`${BASE}/api/profiles/${pid}/activate`, { data: {} });
    expect(act.ok(), `activation du profil ${pid}`).toBeTruthy();
    const cfg = await (await request.get(`${BASE}/api/config/`)).json();
    const isOrg = String(cfg.enable_org_mode) === 'true';
    const accounts = await (await request.get(`${BASE}/api/accounts/`)).json();
    const allTx = await (await request.get(`${BASE}/api/transactions/?limit=200000`)).json();
    const openAccounts = accounts.filter(a => !a.is_closed);
    const usage = id => allTx.filter(t => t.from_account_id === id || t.to_account_id === id).length;
    const accountId = [...openAccounts].sort((a, b) => usage(b.id) - usage(a.id))[0]?.id;
    const label = isOrg ? 'organisation' : 'personnel';
    const dir = path.join(OUT, `${label}_${pid}`);
    fs.mkdirSync(dir, { recursive: true });

    for (const s of (isOrg ? ORG : PERSONAL).filter(x => !process.env.PDF_INTENT_ONLY || process.env.PDF_INTENT_ONLY.split(',').includes(x.id))) {
      const ctx = { isOrg, allTx, accounts, accountId };
      const context = await browser.newContext(s.env && s.env.phone
        ? { viewport: { width: 448, height: 998 }, isMobile: true, hasTouch: true, locale: 'fr-FR' }
        : { viewport: { width: 1400, height: 1000 }, locale: 'fr-FR' });
      if (s.env && s.env.theme) {
        await context.addInitScript(theme => { try { localStorage.setItem('omni_theme', theme); } catch (_) {} }, s.env.theme);
      }
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
      let entry;
      try {
        await openExport(page, s);
        await applyIntent(page, s, ctx);
        const tokens = await sectionTokens(page);
        // Le contenu de chaque bouton de la fenêtre reste dans son bouton
        const brokenButtons = await page.evaluate(() => [...document.querySelectorAll('#exportPdfModal button')].filter(e => {
          const box = e.getBoundingClientRect();
          if (!box.width) return false;
          const range = document.createRange();
          range.selectNodeContents(e);
          const content = range.getBoundingClientRect();
          return content.height > box.height + 1 || content.width > box.width + 1 || box.right > innerWidth + 1;
        }).map(e => e.innerText.trim().slice(0, 30)));
        if (s.env && s.env.phone) {
          await page.evaluate(() => window.AnalyticsView.switchPreviewPane('preview'));
          await page.waitForTimeout(1800);
        }
        const previewShot = await page.$('#exportPaperContainer, #exportPaperSheet');
        if (previewShot) await previewShot.screenshot({ path: path.join(dir, `${s.id}_apercu.png`) }).catch(() => {});
        const preview = await page.evaluate(() => {
          const el = document.getElementById('exportPaperContainer') || document.getElementById('exportPaperSheet');
          return { sel: el.id, text: (el.innerText || '').normalize('NFKC').replace(/\s+/g, ' ').toLowerCase(), badge: document.querySelector('#exportPageCountBadge')?.textContent || '' };
        });
        preview.layout = await page.evaluate(measureLayout, `#${preview.sel}`);
        const pdfFile = path.join(dir, `${s.id}.pdf`);
        const { layout, dom } = await printToPdf(page, pdfFile);
        const pages = readPdfPages(pdfFile);
        const pdfAmounts = new Set((pages.join(' ').match(/-?\d[\d\s  ]*,\d\d/g) || []).map(a => Math.round(parseAmount(a) * 100)));
        const balanceMatch = dom.text.match(new RegExp(`${tokens.balances}[\\s\\S]{0,1500}`, 'i'));
        const badge = parseInt((String(preview.badge).match(/\d+/) || [])[0], 10) || null;
        const checks = evaluate(s, ctx, { pages, tokens, layout, dom, preview, previewBadge: badge, pdfAmounts, balanceText: norm(balanceMatch ? balanceMatch[0] : ''), kpiWanted: tokens.kpiWanted, brokenButtons });
        if (s.font) fontSizes[`${label}:${s.font}`] = layout.tableFont;
        entry = { profile: label, id: s.id, title: s.title, pages: pages.length, checks, score: score(checks), tableFont: layout.tableFont, clippedLabels: layout.clippedLabels.length, errors: [...new Set(errors)].slice(0, 3) };
      } catch (e) {
        entry = { profile: label, id: s.id, title: s.title, pages: 0, checks: [{ code: 'X0', dim: 'Exécution', status: 'ÉCART', detail: String(e).slice(0, 300) }], score: { ok: 0, ko: 1, pct: 0 }, errors: [...new Set(errors)].slice(0, 3) };
      }
      results.push(entry);
      console.log(`${label} ${s.id} : ${entry.score.pct} % (${entry.score.ok} OK, ${entry.score.ko} écarts, ${entry.pages} p.)`);
      await context.close();
    }

    // L6 : la taille demandée doit changer le rendu
    const sm = fontSizes[`${label}:small`], lg = fontSizes[`${label}:large`];
    const target = results.find(r => r.profile === label && r.id === 'P8_texte_grand');
    if (target && sm && lg) {
      target.checks.push({ code: 'L6', dim: 'Lisibilité', status: lg > sm ? 'OK' : 'ÉCART', detail: lg > sm ? '' : `petit ${sm} px, grand ${lg} px : aucun effet` });
      target.score = score(target.checks);
    }
  }
  if (initial.active_profile_id) await request.post(`${BASE}/api/profiles/${initial.active_profile_id}/activate`, { data: {} });

  writeReport(results);
  if (process.env.PDF_INTENT_STRICT) {
    expect(results.flatMap(r => r.checks).filter(c => c.status === 'ÉCART')).toEqual([]);
  }
});

function writeReport(rows) {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 1));
  const all = rows.flatMap(r => r.checks.map(c => ({ ...c, profile: r.profile, id: r.id })));
  const total = score(all);
  const dims = [...new Set(all.map(c => c.dim))];
  const codes = [...new Set(all.map(c => c.code))].sort();
  const profiles = [...new Set(rows.map(r => r.profile))];
  const lines = ['# Accord intention / PDF', '', `**Accord global : ${total.pct} %** (${total.ok} OK, ${total.ko} écarts, ${rows.length} scénarios)`, '', '| Dimension | ' + profiles.join(' | ') + ' |', '|---|' + profiles.map(() => '---').join('|') + '|'];
  for (const d of dims) lines.push(`| ${d} | ` + profiles.map(p => { const s = score(all.filter(c => c.dim === d && c.profile === p)); return `${s.pct} % (${s.ko} écarts)`; }).join(' | ') + ' |');
  lines.push('', '| Scénario | Accord | Pages | ' + codes.join(' | ') + ' |', '|---|---|---|' + codes.map(() => '---').join('|') + '|');
  for (const r of rows) lines.push(`| ${r.id} | ${r.score.pct} % | ${r.pages} | ` + codes.map(c => { const x = r.checks.filter(k => k.code === c); if (!x.length || x.every(k => k.status === 'SANS OBJET')) return '·'; return x.some(k => k.status === 'ÉCART') ? '✗' : '✓'; }).join(' | ') + ' |');
  lines.push('', '## Écarts', '');
  for (const r of rows) {
    const ko = r.checks.filter(c => c.status === 'ÉCART');
    if (!ko.length && !r.errors?.length) continue;
    lines.push(`### ${r.profile} / ${r.id} : ${r.title}`);
    ko.forEach(c => lines.push(`- **${c.code}** ${c.detail}`));
    if (r.clippedLabels) lines.push(`- (info) ${r.clippedLabels} libellé(s) raccourci(s) par « … »`);
    (r.errors || []).forEach(e => lines.push(`- (erreur page) ${e}`));
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
}
