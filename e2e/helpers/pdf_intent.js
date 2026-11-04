// e2e/helpers/pdf_intent.js
// Outils du protocole e2e/PDF_EXPORT_PROTOCOL.md : référence indépendante, lecture du PDF, mesures de mise en page
const { execFileSync } = require('child_process');

const norm = s => String(s).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** Texte du PDF, page par page. */
function readPdfPages(pdfPath) {
  const text = execFileSync('pdftotext', ['-layout', '-enc', 'UTF-8', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const pages = text.split('\f');
  if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
  return pages;
}

/** Première position (page, ligne) d'un texte dans le PDF. */
function locate(pages, token) {
  const needle = norm(token);
  for (let p = 0; p < pages.length; p++) {
    const lines = pages[p].split('\n');
    for (let l = 0; l < lines.length; l++) {
      if (norm(lines[l]).includes(needle)) return { page: p, line: l };
    }
  }
  return null;
}

/**
 * Référence : recalcule les montants depuis les opérations brutes, sans passer par l'API des statistiques.
 * Règles métier : opérations ignorées exclues, montant absolu, un mouvement entre deux comptes retenus
 * n'est ni une dépense ni une recette, et n'a d'effet que sur le compte filtré.
 */
function computeExpected(allTx, { start, end, accountIds }) {
  const ids = accountIds && accountIds.length ? accountIds : null;
  const byType = {};
  const listed = [];
  for (const tx of allTx) {
    const d = String(tx.date_operation).slice(0, 10);
    if (d < start || d > end || tx.is_skipped) continue;
    if (ids && !ids.includes(tx.from_account_id) && !ids.includes(tx.to_account_id)) continue;
    listed.push(tx);
    let type = tx.type || 'neutral';
    let amount = Math.abs(tx.amount);
    if (tx.from_account_id != null && tx.to_account_id != null) {
      const fromIn = ids ? ids.includes(tx.from_account_id) : true;
      const toIn = ids ? ids.includes(tx.to_account_id) : true;
      if (fromIn && toIn) {
        if (type !== 'transfer') amount = 0;
      } else if (toIn) {
        if (type !== 'transfer') type = 'income';
      } else if (type === 'income') {
        type = 'transfer';
      }
    }
    if (!amount) continue;
    const cat = tx.category || 'Sans catégorie';
    const mk = d.slice(0, 7);
    byType[type] = byType[type] || {};
    byType[type][cat] = byType[type][cat] || {};
    byType[type][cat][mk] = (byType[type][cat][mk] || 0) + amount;
  }
  const typeTotal = t => Object.values(byType[t] || {}).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);
  return {
    byType,
    listed,
    income: typeTotal('income'),
    expense: typeTotal('expense_fixed') + typeTotal('expense_var'),
  };
}

/** Lit un montant affiché (« 1 234,56 € », « -36 138,52 € »). */
const parseAmount = s => {
  const m = String(s).replace(/[\s  ]/g, '').match(/-?\d[\d.,]*/);
  if (!m) return null;
  return Math.abs(parseFloat(m[0].replace(/\.(?=\d{3})/g, '').replace(',', '.')));
};

/** Mesures dans la page : à exécuter sur le conteneur d'impression ou sur l'aperçu. */
function measureLayout(selector) {
  const root = document.querySelector(selector);
  if (!root) return { missing: true };
  // Le texte réellement affiché seulement : une poignée de colonne ou un élément masqué ne compte pas
  const rectOf = (el) => {
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    const lines = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent.trim() || !node.parentElement.getClientRects().length) continue;
      const r = document.createRange();
      r.selectNodeContents(node);
      for (const c of r.getClientRects()) {
        if (c.width < 0.5) continue;
        left = Math.min(left, c.left); right = Math.max(right, c.right);
        top = Math.min(top, c.top); bottom = Math.max(bottom, c.bottom);
        lines.add(Math.round(c.top));
      }
    }
    return right > -Infinity ? { left, right, top, bottom, lines: lines.size } : null;
  };
  const label = el => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 28);
  const out = { overlaps: [], splitWords: [], overflows: [], clippedAmounts: [], clippedLabels: [], minFont: 99, offPage: [], tableFont: null };
  const pageRight = root.getBoundingClientRect().right;

  for (const table of root.querySelectorAll('table')) {
    const tb = table.getBoundingClientRect();
    if (!tb.width) continue;
    if (tb.right > pageRight + 1) out.offPage.push(`tableau dépasse de ${Math.round(tb.right - pageRight)} px`);
    for (const row of table.rows) {
      const cells = [...row.cells];
      // Ce qui est visible : un texte coupé par sa cellule s'arrête à son bord
      const rects = cells.map(cell => {
        const r = rectOf(cell);
        if (!r || getComputedStyle(cell).overflowX === 'visible') return r;
        const b = cell.getBoundingClientRect();
        return { ...r, left: Math.max(r.left, b.left), right: Math.min(r.right, b.right) };
      });
      cells.forEach((cell, i) => {
        const txt = label(cell);
        if (!txt || !rects[i]) return;
        const cs = getComputedStyle(cell);
        const fs = parseFloat(cs.fontSize);
        if (fs < out.minFont) out.minFont = fs;
        const b = cell.getBoundingClientRect();
        if (cell.tagName === 'TH') {
          if (rects[i].lines > 1 && !/\s/.test(cell.innerText.trim())) out.splitWords.push(`« ${txt} » sur ${rects[i].lines} lignes (${Math.round(b.width)} px)`);
        }
        const next = rects[i + 1];
        if (next && rects[i].right - next.left > 0.75 && rects[i].bottom > next.top && next.bottom > rects[i].top) {
          out.overlaps.push(`« ${txt} » chevauche « ${label(cells[i + 1])} » de ${(rects[i].right - next.left).toFixed(1)} px`);
        }
        const clipped = cell.scrollWidth > cell.clientWidth + 1 && cs.overflowX !== 'visible';
        if (clipped) {
          const money = /\d/.test(txt) && /[€$£]|,\d\d/.test(txt);
          if (cell.tagName === 'TH') out.splitWords.push(`en-tête « ${txt} » coupé`);
          else (money ? out.clippedAmounts : out.clippedLabels).push(txt);
        } else if (rects[i].right - b.right > 1 || b.left - rects[i].left > 1) {
          out.overflows.push(`« ${txt} » sort de sa cellule de ${Math.max(rects[i].right - b.right, b.left - rects[i].left).toFixed(1)} px`);
        }
        if (rects[i].right > pageRight + 1) out.offPage.push(`« ${txt} » hors de la page`);
      });
    }
  }
  const td = root.querySelector('[data-type] td[data-col-type="month"]');
  out.tableFont = td ? parseFloat(getComputedStyle(td).fontSize) : null;
  const th = root.querySelector('[data-type] th[data-col-type="month"]');
  out.headFont = th ? parseFloat(getComputedStyle(th).fontSize) : null;
  for (const k of ['overlaps', 'splitWords', 'overflows', 'clippedAmounts', 'clippedLabels', 'offPage']) out[k] = [...new Set(out[k])];
  return out;
}

/** Ce que le conteneur d'impression montre, pour comparer à l'intention. */
function readPrintDom(selector) {
  const root = document.querySelector(selector);
  const types = {};
  for (const block of root.querySelectorAll('[data-type]')) {
    const t = block.getAttribute('data-type');
    const months = [...block.querySelectorAll('th[data-col-type="month"]')].map(h => h.getAttribute('data-year'));
    const monthKeys = [...new Set([...block.querySelectorAll('td[data-col-type="month"][data-month], td[data-month]')].map(c => c.getAttribute('data-month')))];
    const years = [...block.querySelectorAll('th[data-col-type="year"]')].map(h => h.getAttribute('data-year'));
    const heads = [...block.querySelectorAll('th[data-col-type="month"]')].map(h => h.innerText.trim());
    const rows = {};
    for (const tr of block.querySelectorAll('tr[data-category]')) {
      const cells = [...tr.querySelectorAll('td[data-col-type="month"]')].map(c => c.innerText.trim());
      rows[tr.getAttribute('data-category')] = cells;
    }
    types[t] = { months, heads, years, rows, monthKeys };
  }
  const detail = root.querySelector('.export-transactions-detail-block');
  const detailRows = detail ? detail.querySelectorAll('tbody tr').length : null;
  const detailCols = detail ? [...detail.querySelectorAll('th[data-col]')].map(h => h.getAttribute('data-col')) : [];
  const balanceBlock = root.querySelector('[data-export-balances]');
  const balances = balanceBlock ? {
    rows: [...balanceBlock.querySelectorAll('tbody tr')].map(tr => ({ name: tr.cells[0].innerText.replace('●', '').trim(), amount: tr.cells[tr.cells.length - 1].innerText })),
    total: balanceBlock.querySelector('tfoot td:last-child')?.innerText
  } : null;
  const cash = root.querySelector('[data-export-cash]')?.innerText ?? null;
  const kpiLabels = {};
  root.querySelectorAll('[data-kpi-label]').forEach(el => { kpiLabels[el.getAttribute('data-kpi-label')] = el.textContent.trim(); });
  return { types, detailRows, detailCols, charts: root.querySelectorAll('svg').length, text: root.innerText, balances, cash, kpiLabels };
}

module.exports = { norm, readPdfPages, locate, computeExpected, parseAmount, measureLayout, readPrintDom };
