// static/js/views/autopilot/autopilot_journal_ledger.js — Journal d'audit Auto-Pilote sur ordinateur
// Une décision = une ligne de grand livre (statut, opération, catégorie, compte, score, montant, actions), colonnes
// alignées d'une ligne à l'autre ; un clic sur la ligne déplie le détail (nom d'origine, libellé de la banque, raison,
// catégorie et montant avant correction, prévision liée, compte). Quand la liste est étroite, le score passe à côté
// du statut et le compte devient une pastille devant le nom (container query dans autopilot.css).
// La ligne garde la classe .ap-decision-row et ses boutons .ap-decision-actions : la feuille du téléphone les déclenche.
window.AutopilotView = Object.assign(window.AutopilotView || {}, {
    _ledgerIcons: {
        chevron: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
        restore: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path></svg>`,
    },

    // Libellés de statut courts pour la colonne Statut (et la ligne du téléphone)
    _shortStatusLabel(typeLabel) {
        const t = (k) => (window.i18n ? window.i18n.t(k) : null);
        const pairs = [
            ['autopilot_action_reconciled_confirmed', 'autopilot_short_reconciled'],
            ['autopilot_action_linked_coming', 'autopilot_short_linked_coming'],
            ['autopilot_action_budget_created', 'autopilot_short_budget_created'],
            ['autopilot_action_deviant_confirmed', 'autopilot_short_deviant'],
            ['autopilot_action_promoted', 'autopilot_short_promoted'],
        ];
        for (const [full, short] of pairs) {
            const s = t(short);
            if (t(full) === typeLabel && s && s !== short) return s;
        }
        return typeLabel;
    },

    // Montant affiché dans la ligne : la valeur retenue (l'ancienne reste dans le détail)
    _ledgerAmount(d, amtColor, cls = 'apl-amt') {
        // -0,00 € n'a pas de sens : un montant nul s'affiche 0,00 €
        const signed = (v) => { const n = Math.abs(v) < 0.005 ? 0 : v; return `${n > 0 ? '+' : ''}${formatCurrency(n)}`; };
        const det = d.details || {};
        let html;
        if (d.decision_type === 'budget_suggestion' && det.suggested_amount !== undefined) {
            html = formatCurrency(Number(det.suggested_amount));
        } else if ((d.decision_type === 'recurrence_hike' || d.decision_type === 'budget_recurrence_sync') && det.new_amount !== undefined) {
            html = formatCurrency(Number(det.new_amount));
        } else if (d.action === 'AUTO_SKIPPED_UNRECONCILED' || d.decision_type === 'recurrence_skip'
                   || d.action === 'AUTO_CLOSED_SKIPPED' || d.decision_type === 'recurrence_close') {
            return `<span class="${cls} privacy-blur is-struck">${formatCurrency(-Math.abs(d.amount))}</span>`;
        } else {
            html = signed(d.amount);
        }
        return `<span class="${cls} privacy-blur" style="color: ${amtColor};">${html}</span>`;
    },

    // Avant → après pour le montant, quand il a changé (correction ou ajustement automatique)
    _ledgerAmountChange(d) {
        const det = d.details || {};
        const uo = d.user_override || {};
        if (uo.is_overridden && uo.amount_changed && uo.original_amount !== null && uo.original_amount !== undefined) {
            return [formatCurrency(Number(uo.original_amount)), formatCurrency(d.amount)];
        }
        if (d.decision_type === 'budget_suggestion' && det.suggested_amount !== undefined && det.current_amount !== undefined) {
            const pct = det.delta_pct !== undefined ? ` (${det.delta_pct > 0 ? '+' : ''}${det.delta_pct} %)` : '';
            return [formatCurrency(Number(det.current_amount)), formatCurrency(Number(det.suggested_amount)) + pct];
        }
        if ((d.decision_type === 'recurrence_hike' || d.decision_type === 'budget_recurrence_sync')
            && det.old_amount !== undefined && det.new_amount !== undefined) {
            return [formatCurrency(Number(det.old_amount)), formatCurrency(Number(det.new_amount))];
        }
        return null;
    },

    _ledgerRow(d, v) {
        const tr = (k, f) => this._phoneT(k, f);
        const uo = d.user_override || {};
        const status = v.isUndone ? tr('autopilot_feed_badge_undone', 'Annulé') : this._shortStatusLabel(v.typeLabel);
        const statusClass = v.isUndone ? 'badge-slate' : v.badgeClass;
        const label = d.label || tr('autopilot_feed_no_label', 'Sans libellé');
        const accColor = escapeHtml(d.account_color || '#3366ff');
        const nameHtml = (v.isOverridden && uo.description_changed && uo.original_description)
            ? `<s class="apl-old">${escapeHtml(uo.original_description)}</s><span class="apl-arrow" aria-hidden="true">→</span><b>${escapeHtml(label)}</b>`
            : `<b>${escapeHtml(label)}</b>`;
        const edited = v.isOverridden
            ? `<span class="ap-mrow-edited apl-edited" title="${escapeHtml(tr('autopilot_reason_user_override', "Modifiée par l'utilisateur"))}">${this._phoneIcons.pencil}<span class="apl-edited-text">${escapeHtml(tr('autopilot_feed_edited_short', 'Modifiée'))}</span></span>`
            : '';
        const score = v.score !== null ? `${v.score} %` : '';
        const detailLabel = escapeHtml(tr('autopilot_ledger_show_detail', 'Afficher le détail'));
        return `
            <div class="ap-decision-row apl-row ${v.isUndone ? 'ap-decision-undone' : ''}" data-decision-id="${d.id}"
                 role="button" tabindex="0" aria-expanded="false" aria-label="${detailLabel} : ${escapeHtml(label)}"
                 onclick="window.AutopilotView.toggleDecisionDetail(${d.id})"
                 onkeydown="if (event.target === this && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); window.AutopilotView.toggleDecisionDetail(${d.id}); }">
                <span class="apl-status ap-mrow-status ${statusClass}" title="${escapeHtml(v.tooltipText || v.typeLabel)}"><i aria-hidden="true"></i>${escapeHtml(status)}</span>
                <span class="apl-name">${d.account_name ? `<span class="apl-accdot" style="background: ${accColor};" title="${escapeHtml(d.account_name)}"></span>` : ''}${nameHtml}${edited}</span>
                <span class="apl-cat"><span>${escapeHtml(d.category || '—')}</span></span>
                <span class="apl-acc">${d.account_name ? `<i style="background: ${accColor};"></i>${escapeHtml(d.account_name)}` : ''}</span>
                <span class="apl-score">${score}</span>
                ${this._ledgerAmount(d, v.amtColor)}
                <span class="apl-actions" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">${v.actionsHtml}</span>
                <div class="ap-decision-src" hidden>${v.srcHtml}</div>
            </div>
            ${this._ledgerDetail(d, v)}`;
    },

    _ledgerDetail(d, v) {
        const tr = (k, f) => this._phoneT(k, f);
        const uo = d.user_override || {};
        const det = d.details || {};
        const rows = [];
        const row = (k, html) => rows.push(`<dt>${escapeHtml(k)}</dt><dd>${html}</dd>`);
        const change = (a, b) => `<s>${escapeHtml(a)}</s> <span aria-hidden="true">→</span> ${escapeHtml(b)}`;
        if (v.isOverridden && uo.description_changed && uo.original_description) {
            row(tr('autopilot_detail_name', 'Nom'), change(uo.original_description, d.label || ''));
        }
        if (d.raw_label && d.raw_label !== d.label) row(tr('autopilot_detail_bank_label', 'Libellé de la banque'), escapeHtml(d.raw_label));
        const reasonOf = (r) => { const s = tr('autopilot_reason_' + r, r); return s; };
        if (v.isOverridden) {
            const orig = uo.original_reason || d.reason;
            row(tr('autopilot_detail_reason', 'Raison'), orig ? change(reasonOf(orig), reasonOf('user_override')) : escapeHtml(reasonOf('user_override')));
        } else if (d.reason) {
            row(tr('autopilot_detail_reason', 'Raison'), escapeHtml(reasonOf(d.reason)));
        }
        if (v.isOverridden && uo.category_changed && uo.original_category) {
            row(tr('autopilot_detail_category', 'Catégorie'), change(uo.original_category, d.category || '—'));
        }
        const amount = this._ledgerAmountChange(d);
        if (amount) row(tr('autopilot_detail_amount', 'Montant'), `<span class="privacy-blur">${change(amount[0], amount[1])}</span>`);
        const forecast = det.linked_to_forecast_description || det.forecast_description;
        if (forecast) row(tr('autopilot_detail_forecast', 'Prévision liée'), escapeHtml(forecast));
        this._gatewayRows(d, row, tr);
        if (d.account_name) row(tr('autopilot_detail_account', 'Compte'), escapeHtml(d.account_name));
        // Score : visible dans la ligne quand la liste est large, ici sinon (voir autopilot.css)
        if (v.score !== null) rows.push(`<div class="apl-score-detail"><dt>${escapeHtml(tr('autopilot_col_score', 'Score'))}</dt><dd>${v.score} %</dd></div>`);
        return `<div class="apl-detail" id="apl_det_${d.id}" hidden><dl>${rows.join('')}</dl></div>`;
    },

    // Paiement PayPal & co : d'après quel paiement déjà nommé, et ce qui reste à confirmer
    _gatewayRows(d, row, tr) {
        const bt = (d.details && d.details.bank_tx) || {};
        const g = bt.smart_gateway_detail;
        if (g && g.ref_description) {
            const when = g.ref_date ? new Date(g.ref_date + 'T00:00:00').toLocaleDateString(window.i18n?.currentLang || undefined, { day: 'numeric', month: 'short' }) : '';
            const amount = g.same_amount ? tr('autopilot_gateway_same_amount', 'même montant') : tr('autopilot_gateway_close_amount', 'montant proche');
            const gap = g.day_gap === 0 ? tr('autopilot_gateway_same_day', 'même jour du mois')
                : tr(g.day_gap === 1 ? 'autopilot_gateway_day_gap_one' : 'autopilot_gateway_day_gap_other', "{count} jours d'écart dans le mois").replace('{count}', g.day_gap);
            row(tr('autopilot_detail_gateway_ref', "D'après"), `« ${escapeHtml(g.ref_description)} »${when ? ' ' + escapeHtml(tr('autopilot_gateway_of_date', 'du {date}').replace('{date}', when)) : ''} · ${escapeHtml(amount)} · ${escapeHtml(gap)}`);
            const checks = [];
            if (g.other_description) checks.push(tr('autopilot_gateway_check_two', 'deux paiements possibles ({a}, {b})').replace('{a}', g.ref_description).replace('{b}', g.other_description));
            if (g.day_gap > 3) checks.push(tr('autopilot_gateway_check_day', 'jour du mois éloigné'));
            if (!g.same_amount) checks.push(tr('autopilot_gateway_check_amount', 'montant proche, pas identique'));
            if (checks.length && ((d.details && d.details.needs_review) || (bt.smart_confidence ?? 1) < 0.85)) {
                row(tr('autopilot_detail_gateway_check', 'À confirmer'), escapeHtml(checks.join(' · ')));
            }
        } else if (bt.smart_is_gateway && d.reason === 'gateway_unknown') {
            row(tr('autopilot_detail_gateway_hint', 'À noter'), escapeHtml(tr('autopilot_gateway_unknown_hint', 'Une fois ce paiement nommé, les suivants du même montant reprendront ce nom.')));
        }
    },

    toggleDecisionDetail(decisionId) {
        const det = document.getElementById(`apl_det_${decisionId}`);
        const row = document.querySelector(`.apl-row[data-decision-id="${Number(decisionId)}"]`);
        if (!det || !row) return;
        const open = det.hasAttribute('hidden');
        det.toggleAttribute('hidden', !open);
        row.classList.toggle('is-open', open);
        row.setAttribute('aria-expanded', open ? 'true' : 'false');
    },

    _ledgerColumnsHead() {
        const tr = (k, f) => this._phoneT(k, f);
        return `
            <div class="apl-head" aria-hidden="true">
                <span>${escapeHtml(tr('col_status', 'Statut'))}</span>
                <span>${escapeHtml(tr('autopilot_col_operation', 'Opération'))}</span>
                <span>${escapeHtml(tr('col_category', 'Catégorie'))}</span>
                <span class="apl-acc">${escapeHtml(tr('autopilot_col_account', 'Compte'))}</span>
                <span class="apl-score">${escapeHtml(tr('autopilot_col_score', 'Score'))}</span>
                <span class="apl-num">${escapeHtml(tr('col_amount', 'Montant'))}</span>
                <span></span>
            </div>`;
    },

    // En-tête de lot sur ordinateur : date, nombre d'actions, identifiant, puis deux boutons texte discrets
    _ledgerBatchHead(batchId, items, isAllUndone, isUnbatched) {
        const tr = (k, f) => this._phoneT(k, f);
        let title;
        if (isUnbatched) {
            title = tr('autopilot_feed_unbatched_label', 'Hors lot');
        } else {
            const dt = items[0].created_at ? new Date(items[0].created_at) : null;
            const lang = window.i18n ? window.i18n.currentLang : undefined;
            const when = dt ? `${dt.toLocaleDateString(lang, { day: '2-digit', month: '2-digit' })} · ${dt.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}` : '';
            title = tr('autopilot_feed_batch_phone_title', 'Lot du {date}').replace('{date}', when);
        }
        const count = items.length === 1
            ? tr('autopilot_feed_actions_one', '1 action')
            : tr('autopilot_feed_actions_many', '{count} actions').replace('{count}', items.length);
        const point = this._restorePointForBatch(batchId);
        const batchTitle = isUnbatched ? '' : tr('autopilot_feed_batch_id_title', 'Identifiant du lot : {batchId}').replace('{batchId}', batchId);
        return `
            <div class="ap-batch-header apl-batch-head" onclick="window.AutopilotView.toggleBatch(${window.jsArg(batchId)})">
                <span class="ap-batch-chevron">${this._ledgerIcons.chevron}</span>
                <span class="apl-batch-title">${escapeHtml(title)}</span>
                <span class="apl-batch-count">${escapeHtml(count)}</span>
                ${!isUnbatched ? `<code class="ap-batch-code apl-batch-code" title="${escapeHtml(batchTitle)}">#${escapeHtml(batchId.substring(0, 8))}</code>` : ''}
                <span class="apl-batch-spacer"></span>
                <span class="apl-batch-actions" onclick="event.stopPropagation()">
                    ${point ? `
                        <button type="button" class="apl-tb" data-point-id="${escapeHtml(point.id)}" onclick="window.AutopilotView.openRestoreDialog(this.dataset.pointId)">
                            ${this._ledgerIcons.restore}<span data-i18n="autopilot_restore_btn">${escapeHtml(tr('autopilot_restore_btn', 'Restaurer avant ce lot'))}</span>
                        </button>` : ''}
                    ${!isAllUndone && !isUnbatched ? `
                        <button type="button" class="apl-tb is-danger" data-batch-id="${escapeHtml(batchId)}" onclick="window.AutopilotView.onRollbackCycleClick(this)">
                            ${this._icons.undo}<span data-i18n="autopilot_feed_batch_rollback">${escapeHtml(tr('autopilot_feed_batch_rollback', 'Annuler le lot'))}</span>
                        </button>` : (isAllUndone ? `<span class="apl-batch-undone">${escapeHtml(tr('autopilot_feed_batch_undone', 'Lot annulé'))}</span>` : '')}
                </span>
            </div>`;
    },
});
