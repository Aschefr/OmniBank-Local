// static/js/reconciliation_states.js — Moteur centralisé de résolution des états de rapprochement
// Factorise la logique dupliquée entre timeline.js, all_operations.js, overview.js et bank_sync.js

/**
 * Résout l'état visuel d'une opération en fonction de son contexte de rapprochement bancaire.
 *
 * @param {Object} tx - La transaction (doit contenir au minimum : id, reconciliation_date, is_skipped)
 * @param {Object} [options] - Options de contexte
 * @param {string} [options.view] - Vue appelante : 'timeline' | 'all_operations' | 'overview'
 * @param {Function} [options.formatDate] - Fonction de formatage de date
 * @returns {{ html: string, state: string }} - HTML du badge/bouton + identifiant d'état
 */
window.ReconciliationStates = {

    /**
     * États possibles retournés dans `state` :
     * - 'skipped'           : Opération ignorée (is_skipped)
     * - 'reconciled'        : Pointée, conforme (pas de discordance)
     * - 'reconciled_discrepancy' : Pointée, mais en attente en ligne (discordance)
     * - 'match_coming'      : Non pointée, matchée avec opération à venir
     * - 'match_confirmed'   : Non pointée, matchée avec opération confirmée
     * - 'unmatched'         : Non pointée, aucun match bancaire
     */

    resolve(tx, options = {}) {
        const view = options.view || 'timeline';
        const formatDate = options.formatDate || window.formatDate || (d => d);
        const i18n = window.i18n || { t: k => null, tp: (k, p) => null };

        const isReconciled = !!tx.reconciliation_date;
        const pendingMatches = window.BankSyncView?.pendingMatches || {};
        const pendingDiscrepancies = window.BankSyncView?.pendingDiscrepancies || {};
        const matchInfo = pendingMatches[tx.id];
        const hasDiscrepancy = !!pendingDiscrepancies[tx.id];

        // ── 1. Ignorée (skip) ──
        if (tx.is_skipped) {
            return {
                state: 'skipped',
                html: `<span class="recon-badge recon-skipped">${i18n.t('rec_status_skipped') || '⏭️ Ignorée'}</span>`
            };
        }

        // ── 2. Pointée ──
        if (isReconciled) {
            const dateStr = formatDate(tx.reconciliation_date);

            // 2a. Pointée avec discordance d'état (en attente en ligne)
            if (hasDiscrepancy) {
                const badgeTip = (i18n.t('bank_badge_discrepancy_tooltip') || "Discordance d'état : cette opération est pointée dans OmniBank, mais apparaît encore dans les opérations en attente (non imputées) de votre banque en ligne.").replace(/"/g, '&quot;');
                const badgeLbl = i18n.t('bank_badge_discrepancy') || 'En attente en ligne';
                const toggleFn = this._getToggleFn(tx.id, view);

                return {
                    state: 'reconciled_discrepancy',
                    html: `<div class="recon-cell-stack">
                        <span class="recon-date-link" onclick="${toggleFn}" title="${i18n.t('tooltip_cancel_reconciliation') || 'Cliquer pour annuler le pointage'}">${dateStr}</span>
                        <span class="recon-badge recon-discrepancy" title="${badgeTip}">⏳ <span>${badgeLbl}</span></span>
                    </div>`
                };
            }

            // 2b. Pointée, conforme
            const toggleFn = this._getToggleFn(tx.id, view);
            return {
                state: 'reconciled',
                html: `<span class="recon-date-link" onclick="${toggleFn}" title="${i18n.t('tooltip_cancel_reconciliation') || 'Cliquer pour annuler le pointage'}"><span style="color:#10b981; font-weight:700; margin-right:4px; font-size:11px;">✔</span>${dateStr}</span>`
            };
        }

        // ── 3. Non pointée, match bancaire détecté ──
        if (matchInfo) {
            // 3a. Match avec opération à venir (non encore imputée)
            if (matchInfo.is_coming) {
                const comingTip = (i18n.t('bank_sync_coming_tooltip') || 'Opération détectée dans les opérations à venir de votre banque.').replace(/"/g, '&quot;');
                const comingBadge = i18n.t('bank_sync_coming_badge') || 'À venir';

                if (view === 'overview') {
                    return {
                        state: 'match_coming',
                        html: `<button class="overview-coming-action-btn" onclick="window.BankSyncView.reconcileFast(${tx.id})" title="${comingTip}"><span>⏳</span> <span>${comingBadge}</span></button>`
                    };
                }
                return {
                    state: 'match_coming',
                    html: `<button class="recon-btn recon-btn-coming" onclick="window.BankSyncView.reconcileFast(${tx.id})" title="${comingTip}">⏳ <span>${comingBadge}</span></button>`
                };
            }

            // 3b. Match avec opération confirmée (imputée en banque)
            const onlineTip = (i18n.t('bank_badge_found_online_tooltip') || 'Opération trouvée sur votre relevé bancaire. Cliquez pour pointer en 1 clic !').replace(/"/g, '&quot;');
            const onlineBadge = i18n.t('bank_badge_found_online') || 'Trouvé en banque';

            if (view === 'overview') {
                return {
                    state: 'match_confirmed',
                    html: `<button class="overview-matched-action-btn" onclick="window.BankSyncView.reconcileFast(${tx.id})" title="${onlineTip}"><span>⚡</span> <span>${onlineBadge}</span></button>`
                };
            }
            return {
                state: 'match_confirmed',
                html: `<button class="recon-btn recon-btn-matched" onclick="window.BankSyncView.reconcileFast(${tx.id})" title="${onlineTip}">⚡ <span>${onlineBadge}</span></button>`
            };
        }

        // ── 4. Non pointée, aucun match ──
        const reconLabel = i18n.t('btn_reconcile') || '✓ Rapprocher';
        const toggleFn = this._getToggleFn(tx.id, view);

        if (view === 'overview') {
            return {
                state: 'unmatched',
                html: `<button class="overview-recon-action-btn" onclick="${toggleFn}" title="${reconLabel}">${reconLabel}</button>`
            };
        }
        return {
            state: 'unmatched',
            html: `<button class="recon-btn recon-btn-unmatched" onclick="${toggleFn}" title="${reconLabel}">${reconLabel}</button>`
        };
    },

    /**
     * Retourne l'appel onclick approprié pour toggleReconciliation selon la vue.
     * @private
     */
    _getToggleFn(txId, view) {
        switch (view) {
            case 'timeline': return `window.TimelineView.toggleReconciliation(${txId})`;
            case 'all_operations': return `window.AllOperationsView.toggleReconciliation(${txId})`;
            case 'overview': return `window.OverviewView.toggleReconciliation(${txId})`;
            default: return `window.TimelineView.toggleReconciliation(${txId})`;
        }
    }
};


/**
 * Actions centralisées de rapprochement.
 * Factorise les 5 implémentations dupliquées de toggleReconciliation.
 */
window.ReconciliationActions = {

    /**
     * Bascule le rapprochement d'une opération et rafraîchit les vues.
     *
     * @param {number} id - L'ID de la transaction
     * @param {Object} [options] - Options
     * @param {Function} [options.refreshView] - Callback de rafraîchissement spécifique à la vue
     * @param {HTMLElement} [options.row] - Élément de ligne pour feedback visuel optimiste
     * @param {string} [options.rowSelector] - Sélecteur CSS alternatif pour trouver la ligne
     * @param {boolean} [options.animateFade] - Si true, animation de fondu sur la ligne
     * @returns {Promise<Object>} Résultat de l'API
     */
    async toggle(id, options = {}) {
        const { refreshView, row, rowSelector, animateFade } = options;

        // Résolution de l'élément de ligne pour UI optimiste
        let rowEl = row || (rowSelector ? document.querySelector(rowSelector) : null);

        // Feedback visuel optimiste
        if (rowEl) {
            if (animateFade) {
                rowEl.style.transition = 'opacity 0.2s, transform 0.2s';
                rowEl.style.opacity = '0.15';
                rowEl.style.transform = 'translateX(-10px)';
                rowEl.style.pointerEvents = 'none';
            } else {
                rowEl.style.opacity = '0.5';
            }
            const btn = rowEl.querySelector('.btn-reconcile, .btn-unreconcile, .recon-btn');
            if (btn) btn.disabled = true;
        }

        try {
            const res = await API.post(`/api/transactions/${id}/toggle_reconciliation`);

            // Restaurer l'opacité de la ligne
            if (rowEl && !animateFade) {
                rowEl.style.opacity = '';
                const btn = rowEl.querySelector('.btn-reconcile, .btn-unreconcile, .recon-btn');
                if (btn) btn.disabled = false;
            }

            // Toast undo
            if (typeof showUndoToast === 'function') {
                const msg = (window.i18n && window.i18n.t('toast_tx_updated')) || "Opération modifiée";
                showUndoToast(msg, res.action_id, refreshView || (() => {}));
            }

            // Rafraîchir le sas de synchronisation puis la vue
            const syncPromise = (window.BankSyncView && typeof window.BankSyncView.loadPendingSync === 'function')
                ? window.BankSyncView.loadPendingSync()
                : Promise.resolve();

            syncPromise
                .then(() => {
                    const promises = [];
                    if (window.app && typeof window.app.refreshSidebar === 'function') {
                        promises.push(window.app.refreshSidebar());
                    }
                    if (typeof refreshView === 'function') {
                        promises.push(refreshView());
                    }
                    return Promise.all(promises);
                })
                .catch(e => console.error('[ReconciliationActions] Erreur refresh arrière-plan:', e));

            return res;
        } catch (e) {
            // Restaurer l'UI en cas d'erreur
            if (rowEl) {
                rowEl.style.opacity = '1';
                rowEl.style.transform = '';
                rowEl.style.pointerEvents = '';
                const btn = rowEl.querySelector('.btn-reconcile, .btn-unreconcile, .recon-btn');
                if (btn) btn.disabled = false;
            }
            console.error('[ReconciliationActions] Erreur toggle:', e);
            const errMsg = (window.i18n && window.i18n.t('msg_save_error')) || 'Erreur lors de la modification';
            if (typeof showToast === 'function') {
                showToast(errMsg, 'error');
            }
            throw e;
        }
    }
};
