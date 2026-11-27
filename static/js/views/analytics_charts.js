// analytics_charts.js — Synthèse en graphiques : répartition des dépenses (anneau) et recettes/dépenses par mois.
// Mêmes données que les tableaux (/api/stats/categories_by_month), mêmes filtres.
window.AnalyticsCharts = {
    MAX_SLICES: 7,           // au-delà, les plus petites catégories sont regroupées dans « Autres »
    _resizeObs: null,
    _lastWidth: 0,

    _t(key, fallback) {
        const v = window.i18n && window.i18n.t(key);
        return v && v !== key ? v : fallback;
    },

    render(container, data) {
        const byType = data.by_type || {};
        const slices = this._expenseSlices(byType);
        const fixedTotal = byType.expense_fixed ? byType.expense_fixed.grand_total || 0 : 0;
        const varTotal = byType.expense_var ? byType.expense_var.grand_total || 0 : 0;

        container.innerHTML = `
        <div class="an-charts">
            <section class="an-chart-card" aria-labelledby="anDonutTitle">
                <header class="an-chart-head">
                    <h3 id="anDonutTitle" class="an-chart-title">${this._t('analytics_chart_breakdown', 'Répartition des dépenses')}</h3>
                    <div class="an-chart-sub">
                        <span>${window.app.getTypeLabel('expense_fixed')} <span class="privacy-blur">${formatCurrency(fixedTotal)}</span></span>
                        <span class="an-dot-sep" aria-hidden="true">·</span>
                        <span>${window.app.getTypeLabel('expense_var')} <span class="privacy-blur">${formatCurrency(varTotal)}</span></span>
                    </div>
                </header>
                ${slices.total > 0 ? this._donutHTML(slices) : `<p class="an-chart-empty">${this._t('analytics_chart_no_expense', 'Aucune dépense sur cette période.')}</p>`}
            </section>
            <section class="an-chart-card" aria-labelledby="anBarsTitle">
                <header class="an-chart-head">
                    <h3 id="anBarsTitle" class="an-chart-title">${this._t('analytics_chart_monthly', 'Recettes et dépenses par mois')}</h3>
                    <div class="an-legend-inline">
                        <span><i class="an-swatch" style="background:var(--an-income)"></i>${window.app.getTypeLabel('income')}</span>
                        <span><i class="an-swatch" style="background:var(--an-expense)"></i>${this._t('export_kpi_expenses', 'Dépenses')}</span>
                    </div>
                </header>
                <div class="an-bars-wrap" id="anBarsWrap"></div>
            </section>
        </div>`;

        this._bindDonut(container, slices);
        this._series = this._monthlySeries(data);
        this._drawBars();
        this._watchResize(container);
    },

    // ── Répartition des dépenses ──────────────────────────────────────────

    _expenseSlices(byType) {
        const sums = {};
        ['expense_fixed', 'expense_var'].forEach(t => {
            const per = byType[t] && byType[t].totals_per_cat;
            if (!per) return;
            for (const [cat, v] of Object.entries(per)) {
                if (v > 0) sums[cat] = (sums[cat] || 0) + v;
            }
        });
        const all = Object.entries(sums).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
        const total = all.reduce((s, c) => s + c.amount, 0);
        // « Autres » seulement s'il regroupe au moins deux catégories
        const keep = all.length > this.MAX_SLICES + 1 ? all.slice(0, this.MAX_SLICES) : all;
        const rest = all.slice(keep.length);
        const items = keep.map((c, i) => ({ ...c, color: `var(--an-s${i + 1})` }));
        if (rest.length) {
            items.push({
                name: this._t('analytics_chart_other', 'Autres'),
                amount: rest.reduce((s, c) => s + c.amount, 0),
                color: 'var(--an-other)',
                isOther: true,
                members: rest,
            });
        }
        return { items, total };
    },

    _donutHTML({ items, total }) {
        const size = 200, cx = 100, cy = 100, rO = 92, rI = 60;
        const GAP = 2; // espace de 2 px (couleur du fond) entre deux parts
        let a0 = -Math.PI / 2;
        const paths = items.map((s, i) => {
            const sweep = (s.amount / total) * 2 * Math.PI;
            const a1 = a0 + sweep;
            const d = items.length === 1 ? this._ringPath(cx, cy, rO, rI) : this._arcPath(cx, cy, rO, rI, a0, a1, GAP);
            a0 = a1;
            return `<path class="an-slice" data-i="${i}" d="${d}" fill="${s.color}"></path>`;
        }).join('');

        const pct = v => (v / total * 100).toLocaleString(this._lang(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';
        const legend = items.map((s, i) => `
            <li class="an-legend-row${s.isOther ? ' is-other' : ''}" data-i="${i}" tabindex="0">
                <i class="an-swatch" style="background:${s.color}"></i>
                <span class="an-legend-name" title="${window.escapeHtml(s.name)}">${window.escapeHtml(s.name)}${s.isOther ? ` <span class="an-muted">(${s.members.length})</span>` : ''}</span>
                <span class="an-legend-amt privacy-blur">${formatCurrency(s.amount)}</span>
                <span class="an-legend-pct">${pct(s.amount)}</span>
            </li>
            ${s.isOther ? `<li class="an-other-list" hidden><ul>${s.members.map(m => `
                <li><span class="an-legend-name" title="${window.escapeHtml(m.name)}">${window.escapeHtml(m.name)}</span>
                <span class="an-legend-amt privacy-blur">${formatCurrency(m.amount)}</span>
                <span class="an-legend-pct">${pct(m.amount)}</span></li>`).join('')}</ul></li>` : ''}
        `).join('');

        return `
        <div class="an-donut-layout">
            <div class="an-donut">
                <svg viewBox="0 0 ${size} ${size}" role="img" aria-labelledby="anDonutTitle">${paths}</svg>
                <div class="an-donut-center" aria-live="polite">
                    <span class="an-center-label">${this._t('analytics_chart_total', 'Total')}</span>
                    <span class="an-center-value privacy-blur">${formatCurrency(total)}</span>
                    <span class="an-center-pct"></span>
                </div>
            </div>
            <ul class="an-legend">${legend}</ul>
        </div>`;
    },

    _bindDonut(container, { items, total }) {
        const root = container.querySelector('.an-donut-layout');
        if (!root) return;
        const label = root.querySelector('.an-center-label');
        const value = root.querySelector('.an-center-value');
        const pctEl = root.querySelector('.an-center-pct');
        const defLabel = label.textContent;
        const defValue = value.textContent;
        const fmtPct = v => (v / total * 100).toLocaleString(this._lang(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' %';

        const focus = i => {
            root.classList.toggle('has-focus', i !== null);
            root.querySelectorAll('[data-i]').forEach(el => el.classList.toggle('is-focus', i !== null && el.dataset.i === String(i)));
            if (i === null) {
                label.textContent = defLabel; value.textContent = defValue; pctEl.textContent = '';
            } else {
                const s = items[i];
                label.textContent = s.name; value.textContent = formatCurrency(s.amount); pctEl.textContent = fmtPct(s.amount);
            }
        };

        this._onOutside('donut', root, () => focus(null));
        root.querySelectorAll('[data-i]').forEach(el => {
            const i = parseInt(el.dataset.i, 10);
            // Souris : survol. Toucher : la part touchée reste choisie jusqu'à un toucher ailleurs.
            el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') focus(i); });
            el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') focus(null); });
            el.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') focus(i); });
            el.addEventListener('focus', () => focus(i));
            el.addEventListener('blur', () => focus(null));
            // Touche ou clic : sur « Autres », ouvre la liste des catégories regroupées
            if (items[i] && items[i].isOther && el.tagName === 'LI') {
                const toggle = () => {
                    const list = el.nextElementSibling;
                    if (list) list.hidden = !list.hidden;
                    el.classList.toggle('is-open', list && !list.hidden);
                };
                el.addEventListener('click', toggle);
                el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
            }
        });
    },

    _arcPath(cx, cy, rO, rI, a0, a1, gap) {
        // Retire un demi-écart de chaque côté, en angle, pour que l'espace reste de largeur constante
        const dO = (gap / 2) / rO, dI = (gap / 2) / rI;
        const o0 = a0 + dO, o1 = Math.max(o0, a1 - dO);
        const i0 = a0 + dI, i1 = Math.max(i0, a1 - dI);
        const large = (a1 - a0) > Math.PI ? 1 : 0;
        const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
        return `M ${p(rO, o0)} A ${rO} ${rO} 0 ${large} 1 ${p(rO, o1)} L ${p(rI, i1)} A ${rI} ${rI} 0 ${large} 0 ${p(rI, i0)} Z`;
    },

    _ringPath(cx, cy, rO, rI) {
        return `M ${cx - rO} ${cy} a ${rO} ${rO} 0 1 0 ${rO * 2} 0 a ${rO} ${rO} 0 1 0 ${-rO * 2} 0 Z `
             + `M ${cx - rI} ${cy} a ${rI} ${rI} 0 1 1 ${rI * 2} 0 a ${rI} ${rI} 0 1 1 ${-rI * 2} 0 Z`;
    },

    // ── Recettes et dépenses par mois ─────────────────────────────────────

    _monthlySeries(data) {
        const bt = data.by_type || {};
        const per = t => (bt[t] && bt[t].totals_per_month) || {};
        const inc = per('income'), fx = per('expense_fixed'), vr = per('expense_var');
        return (data.months || []).map(mk => ({
            mk,
            income: inc[mk] || 0,
            expense: (fx[mk] || 0) + (vr[mk] || 0),
        }));
    },

    _drawBars() {
        const wrap = document.getElementById('anBarsWrap');
        if (!wrap) return;
        const series = this._series || [];
        if (!series.length || series.every(s => !s.income && !s.expense)) {
            wrap.innerHTML = `<p class="an-chart-empty">${this._t('analytics_no_data', 'Aucune donnée trouvée sur cette période.')}</p>`;
            return;
        }
        const W = Math.max(280, Math.floor(wrap.clientWidth));
        this._lastWidth = W;
        const H = 220;
        const max = Math.max(...series.map(s => Math.max(s.income, s.expense)));
        const ticks = this._niceTicks(max, 4);
        const top = ticks[ticks.length - 1] || 1;

        const tickLabels = ticks.map(v => this._compact(v));
        const padL = Math.ceil(Math.max(...tickLabels.map(l => window.AnalyticsView._measureText(l, 11)))) + 10;
        const padR = 4, padT = 8, padB = 24;
        const plotW = W - padL - padR, plotH = H - padT - padB;
        const n = series.length;
        const slot = plotW / n;
        const barW = Math.max(3, Math.min(24, (slot - 6) / 2));
        const y = v => padT + plotH - (v / top) * plotH;

        // Un libellé de mois sur k, pour qu'ils ne se chevauchent pas
        const labelW = window.AnalyticsView._measureText(window.AnalyticsView.formatShortMonth(series[0].mk), 11) + 8;
        const every = Math.max(1, Math.ceil(labelW / slot));

        const grid = ticks.map((v, i) => `
            <line class="an-grid" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"></line>
            <text class="an-axis" x="${padL - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${tickLabels[i]}</text>`).join('');

        const bars = series.map((s, i) => {
            const cx = padL + slot * i + slot / 2;
            const bar = (v, x, cls) => v > 0 ? `<path class="${cls}" d="${this._colPath(x, y(v), barW, y(0) - y(v))}"></path>` : '';
            const lbl = (i % every === 0) ? `<text class="an-axis" x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle">${window.AnalyticsView.formatShortMonth(s.mk)}</text>` : '';
            return `<g class="an-month" data-m="${i}">
                <rect class="an-hit" x="${(padL + slot * i).toFixed(1)}" y="${padT}" width="${slot.toFixed(1)}" height="${plotH}"></rect>
                ${bar(s.income, cx - barW - 1, 'an-bar-income')}
                ${bar(s.expense, cx + 1, 'an-bar-expense')}
                ${lbl}
            </g>`;
        }).join('');

        wrap.innerHTML = `
            <svg class="an-bars" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="anBarsTitle">
                <g class="privacy-blur">${grid}</g>
                <line class="an-baseline" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"></line>
                ${bars}
            </svg>
            <div class="an-tip" hidden></div>`;
        this._bindBars(wrap, series);
    },

    _bindBars(wrap, series) {
        const svg = wrap.querySelector('svg');
        const tip = wrap.querySelector('.an-tip');
        const show = (g, evt) => {
            const s = series[parseInt(g.dataset.m, 10)];
            const net = s.income - s.expense;
            svg.classList.add('has-focus');
            svg.querySelectorAll('.an-month').forEach(m => m.classList.toggle('is-focus', m === g));
            tip.innerHTML = `
                <div class="an-tip-title">${this._monthLong(s.mk)}</div>
                <div class="an-tip-row"><i class="an-swatch" style="background:var(--an-income)"></i>${window.app.getTypeLabel('income')}<b class="privacy-blur">${formatCurrency(s.income)}</b></div>
                <div class="an-tip-row"><i class="an-swatch" style="background:var(--an-expense)"></i>${this._t('export_kpi_expenses', 'Dépenses')}<b class="privacy-blur">${formatCurrency(s.expense)}</b></div>
                <div class="an-tip-row an-tip-net">${this._t('analytics_chart_net', 'Solde')}<b class="privacy-blur">${net > 0 ? '+' : ''}${formatCurrency(net)}</b></div>`;
            tip.hidden = false;
            const r = wrap.getBoundingClientRect();
            const hit = g.querySelector('.an-hit').getBoundingClientRect();
            // À côté du mois survolé (à gauche dans la moitié droite), pour ne pas cacher ses barres
            const tw = tip.offsetWidth;
            const mid = hit.left - r.left + hit.width / 2;
            let left = mid > r.width / 2 ? hit.left - r.left - tw - 6 : hit.right - r.left + 6;
            left = Math.max(0, Math.min(left, r.width - tw));
            tip.style.left = `${left}px`;
        };
        const hide = () => {
            tip.hidden = true;
            svg.classList.remove('has-focus');
            svg.querySelectorAll('.an-month.is-focus').forEach(m => m.classList.remove('is-focus'));
        };
        svg.querySelectorAll('.an-month').forEach(g => {
            g.addEventListener('pointerenter', e => show(g, e));
            g.addEventListener('pointerdown', e => show(g, e));
        });
        svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
        this._onOutside('bars', wrap, hide);
    },

    // Un toucher hors du graphique efface la sélection (un seul écouteur par graphique, remplacé à chaque rendu)
    _outside: {},
    _onOutside(key, el, fn) {
        if (this._outside[key]) document.removeEventListener('pointerdown', this._outside[key], true);
        this._outside[key] = e => { if (!el.isConnected) { document.removeEventListener('pointerdown', this._outside[key], true); delete this._outside[key]; return; }
            if (!el.contains(e.target)) fn(); };
        document.addEventListener('pointerdown', this._outside[key], true);
    },

    _colPath(x, yTop, w, h) {
        // Haut arrondi (4 px), base carrée posée sur la ligne de zéro
        const r = Math.min(4, w / 2, h);
        const b = yTop + h;
        return `M ${x.toFixed(1)} ${b.toFixed(1)} V ${(yTop + r).toFixed(1)} Q ${x.toFixed(1)} ${yTop.toFixed(1)} ${(x + r).toFixed(1)} ${yTop.toFixed(1)} `
             + `H ${(x + w - r).toFixed(1)} Q ${(x + w).toFixed(1)} ${yTop.toFixed(1)} ${(x + w).toFixed(1)} ${(yTop + r).toFixed(1)} V ${b.toFixed(1)} Z`;
    },

    _niceTicks(max, count) {
        if (max <= 0) return [0, 1];
        const raw = max / count;
        const mag = Math.pow(10, Math.floor(Math.log10(raw)));
        const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
        const out = [];
        for (let v = 0; v <= max + step * 0.001; v += step) out.push(v);
        if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
        return out;
    },

    _compact(v) {
        try {
            const code = (window.appBaseCurrency || 'EUR');
            const prof = window.app && window.app.profiles && window.app.profiles.find(p => p.id === window.app.activeProfileId);
            return new Intl.NumberFormat(this._lang(), {
                style: 'currency', currency: (prof && prof.currency) || code,
                notation: v >= 10000 ? 'compact' : 'standard', maximumFractionDigits: v >= 10000 ? 1 : 0,
            }).format(v);
        } catch (e) {
            return String(Math.round(v));
        }
    },

    _monthLong(mk) {
        const [yy, mm] = mk.split('-');
        const s = new Date(parseInt(yy, 10), parseInt(mm, 10) - 1, 1).toLocaleDateString(this._lang(), { month: 'long', year: 'numeric' });
        return s.charAt(0).toUpperCase() + s.slice(1);
    },

    _lang() {
        return (window.i18n && window.i18n.currentLang === 'en') ? 'en-US' : 'fr-FR';
    },

    _watchResize(container) {
        if (this._resizeObs) this._resizeObs.disconnect();
        if (typeof ResizeObserver === 'undefined') return;
        let raf = 0;
        this._resizeObs = new ResizeObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                const wrap = document.getElementById('anBarsWrap');
                if (!wrap || !wrap.isConnected) { this.stop(); return; }
                if (Math.abs(Math.floor(wrap.clientWidth) - this._lastWidth) > 4) this._drawBars();
            });
        });
        this._resizeObs.observe(container);
    },

    stop() {
        if (this._resizeObs) { this._resizeObs.disconnect(); this._resizeObs = null; }
        for (const k of Object.keys(this._outside)) { document.removeEventListener('pointerdown', this._outside[k], true); delete this._outside[k]; }
    },
};
