// static/js/views/bank_sync_pending.js — Opérations en attente & ghost transactions
// Enrichit window.BankSyncView via Object.assign()

Object.assign(window.BankSyncView, {

    async loadPendingSync() {
        try {
            const data = await API.get('/api/bank-sync/pending');
            this.pendingMatches = data?.matches_by_tx_id || {};
            this.pendingDiscrepancies = data?.discrepancies_by_tx_id || {};
            this.totalDiscrepancies = data?.total_discrepancies || 0;
            this.pendingAccounts = data?.accounts || [];

            // Extraire toutes les opérations fantômes (non encore rapprochées)
            this.ghostTransactions = [];
            if (data && data.accounts) {
                data.accounts.forEach(acc => {
                    const connId = acc.connection_id || 0;
                    const connLabel = acc.connection_label || '';
                    const accId = acc.account_id;
                    const accName = acc.account_name || acc.name || `Compte #${accId}`;
                    (acc.transactions || []).forEach(tx => {
                        if (!tx.is_reconciled) {
                            this.ghostTransactions.push({
                                ...tx,
                                account_id: tx.account_id || accId,
                                account_name: accName,
                                connection_id: connId,
                                connection_label: connLabel
                            });
                        }
                    });
                });
            }

            // Auto-catégorisation IA en tâche de fond si activée
            if (this.isAIEnabled() && !this._ghostCategorized && this.ghostTransactions.some(g => !g.category)) {
                this.autoCategorizeGhosts();
            }

            this.renderPendingSyncBox(data);
            return data;
        } catch (e) {
            console.warn('[BankSync] Erreur chargement pending sync:', e);
            return null;
        }
    },

    async autoCategorizeGhosts() {
        const toCat = this.ghostTransactions.filter(g => !g.category && g.description);
        if (!toCat.length) return;
        this._ghostCategorized = true;
        try {
            // 1. Résolution Smart Label locale instantanée (Niveaux 1 et 2)
            const rawLabels = Array.from(new Set(toCat.map(g => g.raw_description || g.description)));
            let remainingForAI = [];
            try {
                const smartRes = await API.post('/api/smart-labels/resolve-batch', { labels: rawLabels });
                if (smartRes && smartRes.results) {
                    this.ghostTransactions.forEach(g => {
                        const raw = g.raw_description || g.description;
                        if (smartRes.results[raw]) {
                            const r = smartRes.results[raw];
                            if (r.source === 'rule' || r.source === 'history') {
                                g.description = r.description;
                                g.smart_suggested = true;
                                g.smart_source = r.source;
                                if (!g.category && r.category) {
                                    g.category = r.category;
                                }
                            }
                        }
                    });
                }
            } catch (errSmart) {
                console.warn('[BankSync] Erreur Smart Label batch:', errSmart);
            }

            // 2. Fallback IA pour les opérations restantes sans catégorie
            if (this.isAIEnabled()) {
                const stillUncat = this.ghostTransactions.filter(g => !g.category && g.description);
                if (stillUncat.length > 0) {
                    const descriptions = Array.from(new Set(stillUncat.map(g => g.description)));
                    const res = await API.post('/api/ai/categorize_batch', { descriptions });
                    if (res && res.categories) {
                        this.ghostTransactions.forEach(g => {
                            if (!g.category && res.categories[g.description]) {
                                g.category = res.categories[g.description];
                            }
                        });
                    }
                }
            }

            // Re-render ghost box in current view
            const box = document.getElementById('ghostRowsBox');
            if (box && box.parentElement) {
                this.renderGhostBox(box.parentElement);
            }
        } catch(e) {
            console.warn('[BankSync] Erreur auto-catégorisation des fantômes:', e);
        }
    },

    async refreshActiveViews() {
        await this.loadPendingSync();
        const curView = window.app?.currentView;
        if (curView === 'overview' && window.OverviewView && typeof window.OverviewView.init === 'function') {
            await window.OverviewView.init();
        } else if ((curView === 'dashboard' || curView === 'timeline') && window.TimelineView && typeof window.TimelineView.loadData === 'function') {
            await window.TimelineView.loadData();
        } else if (curView === 'all_operations' && window.AllOperationsView && typeof window.AllOperationsView.loadData === 'function') {
            await window.AllOperationsView.loadData();
        } else if (curView === 'accounts' && window.AccountsView && typeof window.AccountsView.loadData === 'function') {
            await window.AccountsView.loadData();
        }
        if (window.app && typeof window.app.refreshSidebar === 'function') {
            window.app.refreshSidebar();
        }
    },

    renderPendingSyncBox(data) {
        const box = document.getElementById('bankPendingSyncBox');
        if (!box) return;

        const totalMatches = data?.total_matches || 0;
        const totalConfirmedMatches = typeof data?.total_confirmed_matches === 'number'
            ? data.total_confirmed_matches
            : Object.values(data?.matches_by_tx_id || {}).filter(m => !m.is_coming).length;
        const totalComingMatches = typeof data?.total_coming_matches === 'number'
            ? data.total_coming_matches
            : Object.values(data?.matches_by_tx_id || {}).filter(m => m.is_coming).length;
        const totalNew = data?.total_new || 0;
        const totalDiscrepancies = data?.total_discrepancies || 0;
        const hasConnections = this.connections && this.connections.length > 0;

        if (!hasConnections || (totalMatches === 0 && totalNew === 0 && totalDiscrepancies === 0)) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        let matchesText = '';
        if (totalConfirmedMatches > 0 && totalComingMatches > 0) {
            const readyLbl = window.i18n ? window.i18n.t('bank_sync_ready_to_reconcile') || 'prête(s) à rapprocher' : 'prête(s) à rapprocher';
            const comingLbl = window.i18n ? window.i18n.t('bank_sync_coming_in_banner') || 'en attente en ligne' : 'en attente en ligne';
            matchesText = `<strong style="color: #10b981;">${totalConfirmedMatches}</strong> ${readyLbl} • <span style="color: #818cf8; font-weight: 600;">⏳ <strong>${totalComingMatches}</strong> ${comingLbl}</span>`;
        } else if (totalConfirmedMatches > 0) {
            const readyLbl = window.i18n ? window.i18n.t('bank_sync_ready_to_reconcile') || 'prête(s) à rapprocher' : 'prête(s) à rapprocher';
            matchesText = `<strong style="color: #10b981;">${totalConfirmedMatches}</strong> ${readyLbl}`;
        } else if (totalComingMatches > 0) {
            const comingLbl = window.i18n ? window.i18n.t('bank_sync_coming_in_banner') || 'en attente en ligne' : 'en attente en ligne';
            matchesText = `<span style="color: #818cf8; font-weight: 600;">⏳ <strong>${totalComingMatches}</strong> ${comingLbl}</span>`;
        }

        box.style.display = 'block';
        box.innerHTML = `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 12px; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 20px;">📥</span>
                <div>
                    <span style="font-size: 13px; font-weight: 700; color: var(--text-main); margin-right: 6px;">
                        ${window.i18n.t('bank_sync_pending_box_title') || 'Opérations en attente de synchronisation'} :
                    </span>
                    <span style="font-size: 12px; color: var(--text-muted);">
                        ${matchesText}
                        ${(matchesText && totalNew > 0) ? ' • ' : ''}
                        ${totalNew > 0 ? `<strong>${totalNew}</strong> nouvelle(s)` : ''}
                    </span>
                </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center;">
                ${totalConfirmedMatches > 0 ? `
                <button class="btn btn-primary" onclick="window.BankSyncView.reconcileAllPending()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 700; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                    <span>⚡</span> <span>${window.i18n ? window.i18n.t('bank_btn_reconcile_confirmed') || 'Rapprocher les opérations confirmées' : 'Rapprocher les opérations confirmées'} (${totalConfirmedMatches})</span>
                </button>
                ` : ''}
                ${totalNew > 0 ? `
                <button class="btn btn-gold" onclick="window.BankSyncView.commitAllGhosts()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 700; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                    <span>📥</span> <span>${window.i18n.t('ghost_commit_all') || 'Valider les nouvelles opérations'} (${totalNew})</span>
                </button>
                ` : ''}
                ${data.accounts && data.accounts.length > 0 ? `
                <button class="btn btn-secondary" onclick="window.BankSyncView.openPendingReviewModal()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 600; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                    <span>📋</span> <span>${window.i18n.t('bank_sync_pending_review_btn') || 'Ouvrir la revue'}</span>
                </button>
                ` : ''}
            </div>
        </div>
        `;
    },

    renderGhostBox(container, accountFilter = null) {
        let box = document.getElementById('ghostRowsBox');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ghostRowsBox';
            if (container) {
                container.insertBefore(box, container.firstChild);
            }
        }

        let ghosts = this.ghostTransactions || [];
        if (accountFilter) {
            ghosts = ghosts.filter(g => String(g.account_id) === String(accountFilter));
        }

        if (ghosts.length === 0) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.style.display = 'block';
        const totalCount = ghosts.length;

        // ── 1. Cohérence des soldes & Guide par Delta ─────────────────────
        let relevantAccounts = (this.pendingAccounts && this.pendingAccounts.length > 0)
            ? this.pendingAccounts
            : (this.previewData?.accounts || []);
        if (accountFilter) {
            relevantAccounts = relevantAccounts.filter(a => String(a.account_id) === String(accountFilter));
        }

        // Réinitialiser le flag de résolution delta sur les fantômes
        ghosts.forEach(g => { g._resolves_diff = false; });

        const balanceBarsHtml = relevantAccounts.map(acc => {
            const bankBal = (typeof acc.bank_balance === 'number') ? acc.bank_balance : null;
            const localBal = (typeof acc.local_reconciled_balance === 'number') ? acc.local_reconciled_balance : null;
            if (bankBal === null || localBal === null) return '';

            const delta = Math.round((bankBal - localBal) * 100) / 100;
            const accGhosts = ghosts.filter(g => String(g.account_id) === String(acc.account_id));
            const netGhostSum = Math.round(accGhosts.reduce((sum, g) => sum + (typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0)), 0) * 100) / 100;

            // Détection du delta cible : surligner l'opération qui résout exactement l'écart
            if (Math.abs(delta) >= 0.005) {
                accGhosts.forEach(g => {
                    const rawAmt = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
                    if (Math.abs(rawAmt - delta) < 0.005) {
                        g._resolves_diff = true;
                    }
                });
            }

            let statusBadge = '';
            if (Math.abs(delta) < 0.005) {
                statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 700; padding: 3px 8px; border-radius: 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_balance_tooltip_synced') : 'Le solde de votre banque correspond au centime près à votre solde pointé dans OmniBank.').replace(/"/g, '&quot;')}">🟢 ${window.i18n ? window.i18n.t('bank_sync_balance_synced') : 'Soldes conformes'}</span>`;
            } else if (accGhosts.length > 0 && Math.abs(delta - netGhostSum) < 0.005) {
                statusBadge = `<span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700; padding: 3px 8px; border-radius: 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">🔵 ${window.i18n ? window.i18n.t('bank_sync_balance_will_sync') : 'Conforme après validation'}</span>`;
            } else {
                const diffFormatted = (delta > 0 ? '+' : '') + delta.toFixed(2) + ' €';
                statusBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 700; padding: 3px 8px; border-radius: 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_balance_tooltip_diff') : 'Un écart existe entre le relevé bancaire et vos opérations pointées.').replace(/"/g, '&quot;')}">⚠️ ${window.i18n ? window.i18n.t('bank_sync_balance_diff') : 'Écart'} : ${diffFormatted}</span>`;
            }

            const accName = acc.account_name || acc.name || '';
            const accPrefix = (relevantAccounts.length > 1 && accName) ? `<strong>${window.escapeHtml ? window.escapeHtml(accName) : accName} :</strong> ` : '';

            return `
            <div class="ghost-balance-bar" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px;">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    ${accPrefix}
                    <span>🏦 ${window.i18n ? window.i18n.t('bank_sync_balance_bank') : 'Solde banque'} : <strong style="color: var(--text-main);">${bankBal.toFixed(2)} €</strong></span>
                    <span style="color: var(--text-muted); opacity: 0.5;">•</span>
                    <span>💻 ${window.i18n ? window.i18n.t('bank_sync_balance_local') : 'Solde pointé'} : <strong style="color: var(--text-main);">${localBal.toFixed(2)} €</strong></span>
                </div>
                <div>${statusBadge}</div>
            </div>
            `;
        }).filter(Boolean).join('');

        const rowsHtml = ghosts.map(g => {
            const rawAmt = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
            const absAmt = Math.abs(parseFloat(g.amount) || rawAmt || 0);
            const isPositive = rawAmt >= 0;
            const amtFormatted = (isPositive ? '+ ' : '- ') + absAmt.toFixed(2) + ' €';
            const amtColor = isPositive ? 'var(--accent-success, #10b981)' : 'var(--text-main, #f87171)';
            const dateStr = g.date_operation ? String(g.date_operation).substring(0, 10) : '';
            const isSuggested = g.smart_suggested;
            const suggestedTip = (window.i18n ? window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique' : 'Suggéré d’après votre historique').replace(/"/g, '&quot;');

            const comingBadge = g.is_coming
                ? `<span class="badge coming-badge" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_coming_tooltip') : 'Opération non encore imputée par la banque').replace(/"/g, '&quot;')}">⏳ ${window.i18n ? window.i18n.t('bank_sync_coming_badge') : 'À venir'}</span>`
                : '';

            const resolvesBadge = g._resolves_diff
                ? `<span class="badge resolves-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_resolves_diff_tooltip') : 'La validation de cette opération permettra d\'aligner le solde OmniBank sur celui de la banque.').replace(/"/g, '&quot;')}">🎯 ${window.i18n ? window.i18n.t('bank_sync_resolves_diff') : 'Résout l\'écart'}</span>`
                : '';

            const rowStyle = g._resolves_diff
                ? 'background: rgba(16, 185, 129, 0.05); border-left: 3px solid #10b981; transition: background 0.15s ease;'
                : 'background: rgba(245, 158, 11, 0.04); border-left: 3px dashed #f59e0b; transition: background 0.15s ease;';

            const showRaw = g.raw_description && g.raw_description !== g.description;
            const rawSubHtml = showRaw ? `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 2px; font-weight: normal; opacity: 0.85;">🏦 ${window.escapeHtml ? window.escapeHtml(g.raw_description) : g.raw_description}</div>` : '';

            return `
            <tr id="ghostRow_${g.csv_id}" class="ghost-row" style="${rowStyle}">
                <td style="padding: 8px 12px; font-size: 11px; white-space: nowrap;">
                    <span class="badge ghost-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px;">👻 ${window.i18n ? window.i18n.t('ghost_badge') || 'En ligne' : 'En ligne'}</span>${comingBadge}${resolvesBadge}
                </td>
                <td style="padding: 8px 12px; font-size: 12px; white-space: nowrap; color: var(--text-muted);">${dateStr}</td>
                <td style="padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--text-main);">
                    <div style="display: inline-flex; align-items: center; gap: 4px;">
                        <span>${window.escapeHtml ? window.escapeHtml(g.description) : g.description}</span>
                        ${isSuggested ? `<span title="${suggestedTip}" style="cursor:help; font-size: 11px;">💡</span>` : ''}
                    </div>
                    ${rawSubHtml}
                </td>
                <td style="padding: 8px 12px; font-size: 11px; color: var(--text-muted);">${g.account_name ? (window.escapeHtml ? window.escapeHtml(g.account_name) : g.account_name) : ''}</td>
                <td style="padding: 8px 12px; font-size: 11px;">
                    ${g.category ? `<span style="background: rgba(99, 102, 241, 0.12); color: var(--accent, #6366f1); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏷️ ${window.escapeHtml ? window.escapeHtml(g.category) : g.category}</span>` : `<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Sans catégorie</span>`}
                </td>
                <td style="padding: 8px 12px; font-size: 12px; font-weight: 700; text-align: right; color: ${amtColor}; white-space: nowrap;">${amtFormatted}</td>
                <td style="padding: 8px 12px; text-align: right; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; align-items: center;">
                        <button class="btn btn-primary" onclick="window.BankSyncView.validateGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}" style="font-size: 11px; padding: 3px 8px; border-radius: 4px; height: 24px; font-weight: 700;">
                            ✔ ${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}
                        </button>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.editGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_edit_single') || 'Modifier' : 'Modifier'}" style="font-size: 11px; padding: 3px 8px; border-radius: 4px; height: 24px;">
                            ✏️
                        </button>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.dismissGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_dismiss_single') || 'Ignorer' : 'Ignorer'}" style="font-size: 11px; padding: 3px 6px; border-radius: 4px; height: 24px; color: var(--text-muted);">
                            ✕
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        const cardsHtml = ghosts.map(g => {
            const rawAmt = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
            const absAmt = Math.abs(parseFloat(g.amount) || rawAmt || 0);
            const isPositive = rawAmt >= 0;
            const amtFormatted = (isPositive ? '+ ' : '- ') + absAmt.toFixed(2) + ' €';
            const amtColor = isPositive ? 'var(--accent-success, #10b981)' : 'var(--text-main, #f87171)';
            const dateStr = g.date_operation ? String(g.date_operation).substring(0, 10) : '';
            const isSuggested = g.smart_suggested;
            const suggestedTip = (window.i18n ? window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique' : 'Suggéré d’après votre historique').replace(/"/g, '&quot;');

            const comingBadge = g.is_coming
                ? `<span class="badge coming-badge" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_coming_tooltip') : 'Opération non encore imputée par la banque').replace(/"/g, '&quot;')}">⏳ ${window.i18n ? window.i18n.t('bank_sync_coming_badge') : 'À venir'}</span>`
                : '';

            const resolvesBadge = g._resolves_diff
                ? `<span class="badge resolves-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_resolves_diff_tooltip') : 'La validation de cette opération permettra d\'aligner le solde OmniBank sur celui de la banque.').replace(/"/g, '&quot;')}">🎯 ${window.i18n ? window.i18n.t('bank_sync_resolves_diff') : 'Résout l\'écart'}</span>`
                : '';

            const cardBorder = g._resolves_diff
                ? 'border-left: 3px solid #10b981; box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.3);'
                : 'border-left: 3px dashed #f59e0b;';

            const showRaw = g.raw_description && g.raw_description !== g.description;
            const rawSubHtml = showRaw ? `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 2px; font-weight: normal; opacity: 0.85;">🏦 ${window.escapeHtml ? window.escapeHtml(g.raw_description) : g.raw_description}</div>` : '';

            return `
            <div id="ghostCard_${g.csv_id}" class="ghost-mobile-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); ${cardBorder} border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow-sm);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="badge ghost-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px;">👻 ${window.i18n ? window.i18n.t('ghost_badge') || 'En ligne' : 'En ligne'}</span>${comingBadge}${resolvesBadge}
                        <span style="font-size: 11px; color: var(--text-muted);">${dateStr}</span>
                    </div>
                    <span style="font-size: 13px; font-weight: 800; color: ${amtColor};">${amtFormatted}</span>
                </div>
                <div style="font-size: 13px; font-weight: 600; color: var(--text-main); line-height: 1.3;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span>${window.escapeHtml ? window.escapeHtml(g.description) : g.description}</span>
                        ${isSuggested ? `<span title="${suggestedTip}" style="cursor:help; font-size: 11px;">💡</span>` : ''}
                    </div>
                    ${rawSubHtml}
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px;">
                    ${g.account_name ? `<span style="background: var(--bg-base); border: 1px solid var(--border-color); color: var(--text-muted); padding: 1px 6px; border-radius: 4px; font-size: 11px;">💳 ${window.escapeHtml ? window.escapeHtml(g.account_name) : g.account_name}</span>` : ''}
                    ${g.category ? `<span style="background: rgba(99, 102, 241, 0.12); color: var(--accent, #6366f1); padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏷️ ${window.escapeHtml ? window.escapeHtml(g.category) : g.category}</span>` : `<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Sans catégorie</span>`}
                </div>
                <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
                    <button class="btn btn-primary" onclick="window.BankSyncView.validateGhostRow('${g.csv_id}')" style="flex: 1; font-size: 12px; padding: 6px 10px; border-radius: 6px; font-weight: 700; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                        ✔ ${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.editGhostRow('${g.csv_id}')" style="font-size: 12px; padding: 6px 12px; border-radius: 6px; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                        ✏️ ${window.i18n ? window.i18n.t('ghost_edit_single') || 'Modifier' : 'Modifier'}
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.dismissGhostRow('${g.csv_id}')" style="font-size: 12px; padding: 6px 10px; border-radius: 6px; height: 32px; color: var(--text-muted); display: inline-flex; align-items: center; justify-content: center;" title="${window.i18n ? window.i18n.t('ghost_dismiss_single') || 'Ignorer' : 'Ignorer'}">
                        ✕
                    </button>
                </div>
            </div>
            `;
        }).join('');

        box.innerHTML = `
        <div class="ghost-rows-container" style="background: rgba(245, 158, 11, 0.06); border: 1px dashed rgba(245, 158, 11, 0.35); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 18px;">👻</span>
                    <span style="font-size: 13px; font-weight: 700; color: var(--text-main);">
                        ${window.i18n ? window.i18n.t('ghost_box_title') || 'Opérations en ligne non enregistrées' : 'Opérations en ligne non enregistrées'}
                    </span>
                    <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 10px;">
                        ${totalCount}
                    </span>
                </div>
                <div class="ghost-box-header-btn-wrap" style="display: flex;">
                    <button class="btn btn-gold ghost-box-header-btn" onclick="window.BankSyncView.commitAllGhosts()" style="font-size: 12px; padding: 5px 14px; border-radius: 6px; font-weight: 700; height: 30px; display: inline-flex; align-items: center; gap: 6px;">
                        <span>📥</span> <span>${window.i18n ? window.i18n.t('ghost_commit_all') || 'Valider les nouvelles opérations' : 'Valider les nouvelles opérations'} (${totalCount})</span>
                    </button>
                </div>
            </div>
            ${balanceBarsHtml}
            <!-- Vue Tableau Desktop -->
            <div class="ghost-desktop-table-wrapper">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(245, 158, 11, 0.2); text-align: left; color: var(--text-muted); font-size: 11px;">
                            <th style="padding: 4px 12px; width: 60px;">${window.i18n ? window.i18n.t('col_status') || 'Statut' : 'Statut'}</th>
                            <th style="padding: 4px 12px; width: 90px;">${window.i18n ? window.i18n.t('col_date') || 'Date' : 'Date'}</th>
                            <th style="padding: 4px 12px;">${window.i18n ? window.i18n.t('col_description') || 'Description' : 'Description'}</th>
                            <th style="padding: 4px 12px; width: 140px;">${window.i18n ? window.i18n.t('col_account') || 'Compte' : 'Compte'}</th>
                            <th style="padding: 4px 12px; width: 140px;">${window.i18n ? window.i18n.t('col_category') || 'Catégorie' : 'Catégorie'}</th>
                            <th style="padding: 4px 12px; width: 100px; text-align: right;">${window.i18n ? window.i18n.t('col_amount') || 'Montant' : 'Montant'}</th>
                            <th style="padding: 4px 12px; width: 130px; text-align: right;">${window.i18n ? window.i18n.t('acc_th_actions') || 'Actions' : 'Actions'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
            <!-- Vue Cartes Mobile -->
            <div class="ghost-mobile-cards-wrapper">
                ${cardsHtml}
            </div>
        </div>
        `;
    },


    async validateGhostRow(csvId) {
        const ghost = this.ghostTransactions.find(g => g.csv_id === csvId);
        if (!ghost) return;

        const rowEls = [
            document.getElementById(`ovGhostRow_${csvId}`),
            document.getElementById(`ghostRow_${csvId}`),
            document.getElementById(`ghostCard_${csvId}`)
        ].filter(Boolean);

        rowEls.forEach(el => {
            el.style.transition = 'opacity 0.2s, transform 0.2s';
            el.style.opacity = '0.15';
            el.style.transform = 'translateX(-10px)';
            el.style.pointerEvents = 'none';
        });

        try {
            await API.post('/api/bank-sync/commit-ghost', {
                connection_id: ghost.connection_id || 0,
                transaction: ghost
            });
            this.ghostTransactions = this.ghostTransactions.filter(g => g.csv_id !== csvId);
            this.showToast(window.i18n ? window.i18n.t('ghost_validated') || 'Opération validée' : 'Opération validée', 'success');
            await this.refreshActiveViews();
        } catch (err) {
            rowEls.forEach(el => {
                el.style.opacity = '1';
                el.style.transform = '';
                el.style.pointerEvents = '';
            });
            this.showToast('Erreur validation : ' + (err.detail || err.message), 'error');
        }
    },

    async dismissGhostRow(csvId) {
        const rowEls = [
            document.getElementById(`ovGhostRow_${csvId}`),
            document.getElementById(`ghostRow_${csvId}`),
            document.getElementById(`ghostCard_${csvId}`)
        ].filter(Boolean);

        rowEls.forEach(el => {
            el.style.transition = 'opacity 0.2s, transform 0.2s';
            el.style.opacity = '0.15';
            el.style.transform = 'translateX(-10px)';
            el.style.pointerEvents = 'none';
        });

        try {
            await API.post(`/api/bank-sync/dismiss-ghost/${encodeURIComponent(csvId)}`);
            this.ghostTransactions = this.ghostTransactions.filter(g => g.csv_id !== csvId);
            this.showToast(window.i18n ? window.i18n.t('ghost_dismissed') || 'Opération ignorée' : 'Opération ignorée', 'info');
            await this.refreshActiveViews();
        } catch (err) {
            rowEls.forEach(el => {
                el.style.opacity = '1';
                el.style.transform = '';
                el.style.pointerEvents = '';
            });
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    editGhostRow(csvId) {
        const ghost = this.ghostTransactions.find(g => g.csv_id === csvId);
        if (!ghost) return;
        if (window.FormView && typeof window.FormView.openGhost === 'function') {
            window.FormView.openGhost(ghost);
        }
    },

    async commitAllGhosts() {
        const count = this.ghostTransactions.length;
        if (count === 0) {
            this.showToast('Aucune nouvelle opération à valider.', 'info');
            return;
        }
        const confirmMsg = (window.i18n ? window.i18n.t('ghost_commit_all_confirm') || 'Valider {count} nouvelle(s) opération(s) d\'un seul coup ?' : 'Valider {count} nouvelle(s) opération(s) d\'un seul coup ?').replace('{count}', count);
        if (typeof showInlineConfirm === 'function') {
            const ok = await showInlineConfirm(window.i18n ? window.i18n.t('title_confirmation') || 'Confirmation' : 'Confirmation', confirmMsg);
            if (!ok) return;
        }
        try {
            const res = await API.post('/api/bank-sync/commit-all-ghosts');
            const committed = res?.committed_count || count;
            const toastMsg = (window.i18n ? window.i18n.t('ghost_committed_success') || '{count} opération(s) validée(s) avec succès' : '{count} opération(s) validée(s) avec succès').replace('{count}', committed);
            this.showToast(toastMsg, 'success');
            this.ghostTransactions = [];
            await this.refreshActiveViews();
        } catch (err) {
            this.showToast('Erreur validation en lot : ' + (err.detail || err.message), 'error');
        }
    },

    async openPendingReviewModal() {
        try {
            this.ensureModalsExist();
            const data = await API.get('/api/bank-sync/pending');
            if (data && data.accounts && data.accounts.length > 0) {
                const firstConnId = data.accounts[0]?.connection_id || (this.connections?.[0]?.id || 1);
                await this.openReviewModal(firstConnId, {
                    connection_id: firstConnId,
                    accounts: data.accounts
                });
            } else {
                this.showToast('Aucune opération en attente.', 'info');
            }
        } catch (e) {
            console.error('[BankSync] Erreur ouverture des opérations en attente:', e);
            this.showToast('Erreur ouverture des opérations en attente : ' + (e.message || e), 'error');
        }
    },

    // ── RAPPROCHEMENT EN 1 CLIC (Depuis Dashboard ou Historique) ─────
    async reconcileFast(txId) {
        try {
            const ovRow = document.getElementById(`ovRow_${txId}`);
            if (ovRow) {
                ovRow.style.transition = 'opacity 0.2s, transform 0.2s';
                ovRow.style.opacity = '0.15';
                ovRow.style.transform = 'translateX(-10px)';
                ovRow.style.pointerEvents = 'none';
            }

            const res = await API.post(`/api/bank-sync/reconcile-fast/${txId}`);
            this.showToast(window.i18n ? window.i18n.t('bank_sync_reconciled_success') || 'Opération pointée avec succès !' : 'Opération pointée avec succès !', 'success');

            // Retirer de pendingMatches localement
            if (this.pendingMatches && this.pendingMatches[txId]) {
                delete this.pendingMatches[txId];
            }

            await this.refreshActiveViews();
        } catch (err) {
            const ovRow = document.getElementById(`ovRow_${txId}`);
            if (ovRow) {
                ovRow.style.opacity = '1';
                ovRow.style.transform = '';
                ovRow.style.pointerEvents = '';
            }
            this.showToast('Erreur pointage : ' + (err.detail || err.message), 'error');
        }
    },

    async reconcileAllPending() {
        try {
            const res = await API.post('/api/bank-sync/reconcile-all-pending');
            const count = res?.reconciled_count || 0;
            this.showToast(`${count} opération(s) pointée(s) avec succès !`, 'success');
            this.pendingMatches = {};

            await this.refreshActiveViews();
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },


    // ── PROMPT MASTER PASSWORD (Custom in-app modal) ────────────────
});
