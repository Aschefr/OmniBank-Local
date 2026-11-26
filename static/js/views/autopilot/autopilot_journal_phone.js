// static/js/views/autopilot/autopilot_journal_phone.js — Journal d'audit Auto-Pilote sur téléphone
// Sur téléphone, chaque lot tient sur une ligne et chaque décision sur deux (libellé et montant, puis statut, score,
// catégorie et compte), comme les lignes du Journal. Les actions passent dans une feuille ouverte par « ⋯ ».
// Les lignes du rendu PC restent dans le DOM, masquées : la feuille reprend leur contenu et déclenche leurs boutons,
// pour garder une seule logique d'actions.
window.AutopilotView = Object.assign(window.AutopilotView || {}, {
    _phoneIcons: {
        chevron: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>`,
        pencil: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`,
    },

    _phoneT(key, fallback) {
        const v = window.i18n ? window.i18n.t(key) : null;
        return (v && v !== key) ? v : fallback;
    },

    _phoneBatchHead(batchId, items, isAllUndone, isUnbatched) {
        const first = items[0];
        let title;
        if (isUnbatched) {
            title = this._phoneT('autopilot_feed_unbatched_label', 'Hors lot');
        } else {
            const dt = first.created_at ? new Date(first.created_at) : null;
            const lang = window.i18n ? window.i18n.currentLang : undefined;
            const when = dt ? `${dt.toLocaleDateString(lang, { day: '2-digit', month: '2-digit' })} · ${dt.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })}` : '';
            title = this._phoneT('autopilot_feed_batch_phone_title', 'Lot du {date}').replace('{date}', when);
        }
        const count = items.length === 1
            ? this._phoneT('autopilot_feed_actions_one', '1 action')
            : this._phoneT('autopilot_feed_actions_many', '{count} actions').replace('{count}', items.length);
        const hasActions = Boolean(this._restorePointForBatch(batchId)) || (!isAllUndone && !isUnbatched);
        const more = this._phoneT('acc_more_actions', "Plus d'actions");
        return `
            <div class="ap-mbatch-head" onclick="window.AutopilotView.toggleBatch(${window.jsArg(batchId)})">
                <span class="ap-batch-chevron">${this._phoneIcons.chevron}</span>
                <span class="ap-mbatch-title">${escapeHtml(title)}</span>
                <span class="ap-mbatch-count">${escapeHtml(count)}</span>
                ${isAllUndone ? `<span class="ap-mbatch-undone">${escapeHtml(this._phoneT('autopilot_feed_batch_undone', 'Lot annulé'))}</span>` : ''}
                ${hasActions ? `<button type="button" class="ap-mbtn-more" aria-label="${escapeHtml(more)}" aria-haspopup="menu" onclick="event.stopPropagation(); window.AutopilotView.openBatchSheet(${window.jsArg(batchId)}, this)">${window.PhoneSheet.icons.dots}</button>` : ''}
            </div>`;
    },

    _phoneDecisionRow(d, v) {
        const status = v.isUndone ? this._phoneT('autopilot_feed_badge_undone', 'Annulé') : this._shortStatusLabel(v.typeLabel);
        const statusClass = v.isUndone ? 'badge-slate' : v.badgeClass;
        const accColor = d.account_color || '#3366ff';
        const more = this._phoneT('acc_more_actions', "Plus d'actions");
        const edited = v.isOverridden
            ? `<span class="ap-mrow-edited" title="${escapeHtml(this._phoneT('autopilot_reason_user_override', "Modifiée par l'utilisateur"))}">${this._phoneIcons.pencil}${escapeHtml(this._phoneT('autopilot_feed_edited_short', 'Modifiée'))}</span>`
            : '';
        return `
            <div class="ap-mrow ${v.isUndone ? 'is-undone' : ''}" onclick="window.AutopilotView.openDecisionSheet(${d.id}, this.querySelector('.ap-mbtn-more'))">
                <div class="ap-mrow-main">
                    <div class="ap-mrow-l1">
                        <span class="ap-mrow-label">${escapeHtml(d.label || this._phoneT('autopilot_feed_no_label', 'Sans libellé'))}</span>
                        ${this._ledgerAmount(d, v.amtColor, 'ap-mrow-amt')}
                    </div>
                    <div class="ap-mrow-l2">
                        <span class="ap-mrow-status ${statusClass}"><i aria-hidden="true"></i>${escapeHtml(status)}</span>
                        ${v.score !== null ? `<span class="ap-mrow-score">${v.score} %</span>` : ''}
                        ${edited}
                        <span class="ap-mrow-cat">${escapeHtml(d.category || '—')}</span>
                        ${d.account_name ? `<span class="ap-mrow-acc" style="background: ${escapeHtml(accColor)};" title="${escapeHtml(d.account_name)}"></span>` : ''}
                    </div>
                </div>
                <button type="button" class="ap-mbtn-more" aria-label="${escapeHtml(more)}" aria-haspopup="menu" onclick="event.stopPropagation(); window.AutopilotView.openDecisionSheet(${d.id}, this)">${window.PhoneSheet.icons.dots}</button>
            </div>`;
    },

    openDecisionSheet(decisionId, trigger) {
        const row = document.querySelector(`.ap-decision-row[data-decision-id="${Number(decisionId)}"]`);
        if (!row) return;
        const phoneRow = row.previousElementSibling;
        const title = row.querySelector('.ap-decision-title');
        const amount = row.querySelector('.ap-decision-amount-mobile');
        const meta = row.querySelector('.ap-decision-meta');
        const status = phoneRow && phoneRow.querySelector('.ap-mrow-status');
        const score = phoneRow && phoneRow.querySelector('.ap-mrow-score');
        // Décision corrigée : ancien → nouveau sur toute la largeur, le montant passe dessous
        const corrected = Boolean((title && title.querySelector('.ap-chain')) || (amount && amount.querySelector('.ap-override-arrow')));
        const head = `
            <div class="ap-psheet-top ${corrected ? 'is-corrected' : ''}">
                <div class="ap-psheet-title">${title ? title.innerHTML : ''}</div>
                <div class="ap-psheet-amt">${amount ? amount.innerHTML : ''}</div>
            </div>
            <div class="ap-psheet-status">${status ? status.outerHTML : ''}${score ? ` <span class="ap-mrow-score">${score.innerHTML}</span>` : ''}</div>
            ${meta ? `<div class="ap-decision-meta ap-psheet-meta">${meta.innerHTML}</div>` : ''}`;
        this._openPhoneSheet(head, [...row.querySelectorAll('.ap-decision-actions button')], trigger);
    },

    openBatchSheet(batchId, trigger) {
        const card = document.querySelector(`.ap-batch-card[data-batch-id="${CSS.escape(batchId)}"]`);
        if (!card) return;
        const title = card.querySelector('.ap-mbatch-title');
        const count = card.querySelector('.ap-mbatch-count');
        const code = card.querySelector('.ap-batch-code');
        const head = `
            <div class="ap-psheet-title">${title ? title.innerHTML : ''}</div>
            <div class="ap-psheet-sub">${count ? count.innerHTML : ''}${code ? ` · <span class="ap-psheet-code">${code.innerHTML}</span>` : ''}</div>`;
        this._openPhoneSheet(head, [...card.querySelectorAll('.ap-batch-header button')], trigger);
    },

    // Les actions de la feuille déclenchent les boutons (masqués) du rendu PC : une seule logique d'actions
    _openPhoneSheet(headHtml, sources, trigger) {
        const items = sources.map(src => {
            // Libellé : l'infobulle quand elle est courte (« Annuler cette décision »), sinon le texte du bouton
            const text = (src.textContent || '').trim().replace(/\s+/g, ' ');
            const tip = (src.getAttribute('title') || '').trim();
            const label = src.classList.contains('ap-btn-inspect')
                ? this._phoneT('autopilot_feed_sheet_inspect', "Voir l'élément concerné")
                : (tip && tip.length <= 32 ? tip : (text || tip));
            const icon = src.querySelector('svg');
            return { icon: icon ? icon.outerHTML : window.PhoneSheet.icons.restore, label,
                     danger: src.classList.contains('btn-danger') || src.classList.contains('is-danger'), onClick: () => src.click() };
        });
        window.PhoneSheet.open(headHtml, items, trigger, 'ap-psheet');
    },
});
