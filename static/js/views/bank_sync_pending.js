// static/js/views/bank_sync_pending.js — Opérations en attente & ghost transactions
// Enrichit window.BankSyncView via Object.assign()

Object.assign(window.BankSyncView, {

    async loadPendingSync(force = false) {
        if (!force && this._lastPendingSyncData && this._lastPendingSyncTime && (Date.now() - this._lastPendingSyncTime < 10000)) {
            return this._lastPendingSyncData;
        }
        if (this._inFlightPendingSyncPromise) {
            return this._inFlightPendingSyncPromise;
        }

        this._inFlightPendingSyncPromise = (async () => {
            try {
                const data = await API.get('/api/bank-sync/pending');
                this.pendingMatches = data?.matches_by_tx_id || {};
                this.pendingDiscrepancies = data?.discrepancies_by_tx_id || {};
                this.totalDiscrepancies = data?.total_discrepancies || 0;

                // Dédupliquer les comptes défensivement
                const seenAccKeys = new Set();
                const uniquePendingAccs = [];
                (data?.accounts || []).forEach(acc => {
                    const k = acc.account_id ? `id_${acc.account_id}` : `name_${(acc.account_name || acc.name || '').trim().toLowerCase()}`;
                    if (!seenAccKeys.has(k)) {
                        seenAccKeys.add(k);
                        uniquePendingAccs.push(acc);
                    }
                });
                this.pendingAccounts = uniquePendingAccs;

                // Extraire toutes les opérations fantômes (non encore rapprochées)
                this.ghostTransactions = [];
                this._ghostCategoryCache = this._ghostCategoryCache || {};
                const seenGhostKeys = new Set();
                if (this.pendingAccounts && this.pendingAccounts.length > 0) {
                    this.pendingAccounts.forEach(acc => {
                        const connId = acc.connection_id || 0;
                        const connLabel = acc.connection_label || '';
                        const accId = acc.account_id;
                        const accName = acc.account_name || acc.name || `Compte #${accId}`;
                        (acc.transactions || []).forEach(tx => {
                            if (!tx.is_reconciled && !tx.is_dismissed && !tx.is_auto_dismissed && !tx._excluded) {
                                const ghostKey = tx.csv_id || `${accId}_${tx.date_operation}_${tx.raw_amount}_${tx.description}`;
                                if (seenGhostKeys.has(ghostKey)) return;
                                seenGhostKeys.add(ghostKey);

                                const key = tx.raw_description || tx.description;
                                const cached = this._ghostCategoryCache[key];
                                const ghost = {
                                    ...tx,
                                    account_id: tx.account_id || accId,
                                    account_name: accName,
                                    connection_id: connId,
                                    connection_label: connLabel
                                };
                                if (cached) {
                                    if (cached.description) ghost.description = cached.description;
                                    if (cached.category && !ghost.category) ghost.category = cached.category;
                                    if (cached.smart_suggested) ghost.smart_suggested = true;
                                    if (cached.smart_source) ghost.smart_source = cached.smart_source;
                                }
                                this.ghostTransactions.push(ghost);
                            }
                        });
                    });
                }

                // Auto-catégorisation Smart Labels (local/instantané) et IA en tâche de fond
                if (this.ghostTransactions.some(g => !g.category && g.description)) {
                    await this.autoCategorizeGhosts();
                }

                this._ghostBoxManualCollapse = undefined;
                this.renderPendingSyncBox(data);
                this._lastPendingSyncData = data;
                this._lastPendingSyncTime = Date.now();
                return data;
            } catch (e) {
                console.warn('[BankSync] Erreur chargement pending sync:', e);
                return null;
            } finally {
                this._inFlightPendingSyncPromise = null;
            }
        })();

        return this._inFlightPendingSyncPromise;
    },

    async autoCategorizeGhosts() {
        if (this._ghostCategorizing) return;
        const toCat = this.ghostTransactions.filter(g => !g.category && g.description);
        if (!toCat.length) return;
        this._ghostCategorizing = true;
        this._ghostCategoryCache = this._ghostCategoryCache || {};

        try {
            // 1. Résolution Smart Label locale instantanée (Règles & Historique)
            const rawLabels = Array.from(new Set(toCat.map(g => g.raw_description || g.description)));
            try {
                const smartRes = await API.post('/api/smart-labels/resolve-batch', { labels: rawLabels });
                if (smartRes && smartRes.results) {
                    this.ghostTransactions.forEach(g => {
                        const raw = g.raw_description || g.description;
                        const r = smartRes.results[raw];
                        if (r && (r.source === 'rule' || r.source === 'history')) {
                            g.description = r.description;
                            g.smart_suggested = true;
                            g.smart_source = r.source;
                            if (!g.category && r.category) {
                                g.category = r.category;
                            }
                            this._ghostCategoryCache[raw] = {
                                description: g.description,
                                category: g.category,
                                smart_suggested: true,
                                smart_source: r.source
                            };
                        }
                    });
                }
            } catch (errSmart) {
                console.warn('[BankSync] Erreur Smart Label batch:', errSmart);
            }

            // 2. Fallback IA pour les opérations restantes sans catégorie (si activée)
            if (this.isAIEnabled()) {
                const stillUncat = this.ghostTransactions.filter(g => !g.category && g.description);
                if (stillUncat.length > 0) {
                    const descriptions = Array.from(new Set(stillUncat.map(g => g.description)));
                    const res = await API.post('/api/ai/categorize_batch', { descriptions });
                    if (res && res.categories) {
                        this.ghostTransactions.forEach(g => {
                            if (!g.category && res.categories[g.description]) {
                                g.category = res.categories[g.description];
                                const raw = g.raw_description || g.description;
                                this._ghostCategoryCache[raw] = {
                                    description: g.description,
                                    category: g.category,
                                    smart_suggested: true,
                                    smart_source: 'ai'
                                };
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
            // Re-render unreconciled table in Vue d'ensemble if present
            if (window.OverviewView && typeof window.OverviewView._renderUnreconciled === 'function' && window.OverviewView._transactions) {
                window.OverviewView._renderUnreconciled(window.OverviewView._transactions);
            }
        } catch(e) {
            console.warn('[BankSync] Erreur auto-catégorisation des fantômes:', e);
        } finally {
            this._ghostCategorizing = false;
        }
    },

    async refreshActiveViews(highlightTxId = null) {
        await this.loadPendingSync(true);
        const curView = window.app?.currentView;
        if (curView === 'overview' && window.OverviewView && typeof window.OverviewView.init === 'function') {
            await window.OverviewView.init();
            if (highlightTxId && typeof window.OverviewView.highlightRow === 'function') {
                requestAnimationFrame(() => window.OverviewView.highlightRow(highlightTxId));
            }
        } else if ((curView === 'dashboard' || curView === 'timeline') && window.TimelineView && typeof window.TimelineView.loadData === 'function') {
            await window.TimelineView.loadData();
            if (highlightTxId && typeof window.TimelineView.highlightRow === 'function') {
                requestAnimationFrame(() => window.TimelineView.highlightRow(highlightTxId));
            }
        } else if (curView === 'all_operations' && window.AllOperationsView && typeof window.AllOperationsView.loadData === 'function') {
            await window.AllOperationsView.loadData();
            if (highlightTxId && typeof window.AllOperationsView.highlightRow === 'function') {
                requestAnimationFrame(() => window.AllOperationsView.highlightRow(highlightTxId));
            }
        } else if (curView === 'accounts' && window.AccountsView && typeof window.AccountsView.loadData === 'function') {
            await window.AccountsView.loadData();
        }
        if (window.app && typeof window.app.refreshSidebar === 'function') {
            await window.app.refreshSidebar();
        }
    },

    getConfirmedMatchesList(pendingData) {
        const list = [];
        const seenIds = new Set();
        if (pendingData && pendingData.accounts) {
            pendingData.accounts.forEach(acc => {
                const accName = acc.account_name || acc.name || (window.app?.accounts?.find(a => a.id === acc.account_id)?.name) || (window.OverviewView?._accountsMap?.[acc.account_id]?.name) || `Compte #${acc.account_id}`;
                (acc.transactions || []).forEach(tx => {
                    if (tx.is_reconciled && !tx.already_reconciled && !tx.is_coming && tx.matched_db_id) {
                        if (seenIds.has(tx.matched_db_id)) return;
                        seenIds.add(tx.matched_db_id);
                        list.push({
                            date_operation: tx.date_operation,
                            account_name: accName,
                            description: tx.db_description || tx.description || tx.raw_description || '—',
                            amount: typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0),
                            type: tx.type || ((typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0)) >= 0 ? 'income' : 'expense')
                        });
                    }
                });
            });
        }
        if (list.length === 0 && pendingData && pendingData.matches_by_tx_id) {
            Object.entries(pendingData.matches_by_tx_id).forEach(([dbId, tx]) => {
                if (!tx.is_coming) {
                    if (seenIds.has(dbId)) return;
                    seenIds.add(dbId);
                    const accName = tx.account_name || (window.app?.accounts?.find(a => a.id === tx.account_id)?.name) || (window.OverviewView?._accountsMap?.[tx.account_id]?.name) || '—';
                    list.push({
                        date_operation: tx.date_operation,
                        account_name: accName,
                        description: tx.db_description || tx.description || tx.raw_description || '—',
                        amount: typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0),
                        type: tx.type || ((typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0)) >= 0 ? 'income' : 'expense')
                    });
                }
            });
        }
        list.sort((a, b) => String(b.date_operation || '').localeCompare(String(a.date_operation || '')));
        return list;
    },

    getGhostTransactionsList(pendingData) {
        const list = [];
        const seenKeys = new Set();
        if (this.ghostTransactions && this.ghostTransactions.length > 0) {
            this.ghostTransactions.forEach(g => {
                const k = g.csv_id || `${g.account_id}_${g.date_operation}_${g.raw_amount}_${g.description}`;
                if (seenKeys.has(k)) return;
                seenKeys.add(k);
                const accName = g.account_name || (window.app?.accounts?.find(a => a.id === g.account_id)?.name) || (window.OverviewView?._accountsMap?.[g.account_id]?.name) || `Compte #${g.account_id}`;
                list.push({
                    date_operation: g.date_operation,
                    account_name: accName,
                    description: g.description || g.raw_description || '—',
                    amount: typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0),
                    type: g.type || ((typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0)) >= 0 ? 'income' : 'expense')
                });
            });
        } else if (pendingData && pendingData.accounts) {
            pendingData.accounts.forEach(acc => {
                const accName = acc.account_name || acc.name || (window.app?.accounts?.find(a => a.id === acc.account_id)?.name) || (window.OverviewView?._accountsMap?.[acc.account_id]?.name) || `Compte #${acc.account_id}`;
                (acc.transactions || []).forEach(tx => {
                    if (!tx.is_reconciled && !tx.is_dismissed && !tx.is_auto_dismissed && !tx._excluded) {
                        const k = tx.csv_id || `${acc.account_id}_${tx.date_operation}_${tx.raw_amount}_${tx.description}`;
                        if (seenKeys.has(k)) return;
                        seenKeys.add(k);
                        list.push({
                            date_operation: tx.date_operation,
                            account_name: accName,
                            description: tx.description || tx.raw_description || '—',
                            amount: typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0),
                            type: tx.type || ((typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0)) >= 0 ? 'income' : 'expense')
                        });
                    }
                });
            });
        }
        list.sort((a, b) => String(b.date_operation || '').localeCompare(String(a.date_operation || '')));
        return list;
    },

    renderOperationsTooltipHtml(title, items, maxItems = 15) {
        if (!items || items.length === 0) return '';
        let ttHtml = `<div class="overview-bulk-tooltip">`;
        ttHtml += `<div class="overview-tt-title">${title} (${items.length}) :</div>`;
        ttHtml += `<div class="overview-tt-list">`;
        for (const item of items.slice(0, maxItems)) {
            const rawAmt = typeof item.raw_amount !== 'undefined' ? parseFloat(item.raw_amount) : (parseFloat(item.amount) || 0);
            const absAmt = Math.abs(rawAmt);
            let isIncome = false;
            if (item.type === 'income') isIncome = true;
            else if (item.type === 'expense') isIncome = false;
            else if (typeof item.raw_amount !== 'undefined') isIncome = parseFloat(item.raw_amount) >= 0;
            else isIncome = (parseFloat(item.amount) || 0) >= 0;

            const amtColor = isIncome ? '#10b981' : '#ef4444';
            const dateStr = typeof formatDate === 'function' && item.date_operation ? formatDate(item.date_operation) : (item.date_operation ? String(item.date_operation).substring(0, 10) : '—');
            const accName = item.account_name || '—';
            const desc = item.description || '—';
            const safeAcc = typeof escapeHtml === 'function' ? escapeHtml(accName) : accName;
            const safeDesc = typeof escapeHtml === 'function' ? escapeHtml(desc) : desc;
            const amtFmt = typeof formatCurrency === 'function' ? formatCurrency(absAmt) : `${absAmt.toFixed(2)} €`;

            ttHtml += `
                <div class="overview-tt-item">
                    <span class="overview-tt-date">${dateStr}</span>
                    <span class="overview-tt-acc" title="${safeAcc}">${safeAcc}</span>
                    <span class="overview-tt-desc" title="${safeDesc}">${safeDesc}</span>
                    <span class="overview-tt-amt" style="color: ${amtColor}">${amtFmt}</span>
                </div>
            `;
        }
        if (items.length > maxItems) {
            const moreLabel = window.i18n ? window.i18n.t('overview_more_unreconciled_ops') || 'autres opérations' : 'autres opérations';
            ttHtml += `<div class="overview-tt-more">+ ${items.length - maxItems} ${moreLabel}...</div>`;
        }
        ttHtml += `</div></div>`;
        return ttHtml;
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

        const confirmedList = this.getConfirmedMatchesList(data);
        const ghostList = this.getGhostTransactionsList(data);
        const confirmedTooltipTitle = window.i18n ? window.i18n.t('bank_btn_reconcile_confirmed_tooltip') || 'Opérations confirmées qui seront rapprochées' : 'Opérations confirmées qui seront rapprochées';
        const ghostTooltipTitle = window.i18n ? window.i18n.t('ghost_commit_all_tooltip') || 'Nouvelles opérations qui seront ajoutées' : 'Nouvelles opérations qui seront ajoutées';
        const confirmedTooltipHtml = this.renderOperationsTooltipHtml(confirmedTooltipTitle, confirmedList);
        const ghostsTooltipHtml = this.renderOperationsTooltipHtml(ghostTooltipTitle, ghostList);

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

            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                ${totalConfirmedMatches > 0 ? `
                <div class="overview-bulk-wrapper">
                    <button class="btn btn-primary" onclick="window.BankSyncView.reconcileAllPending()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 600; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                        <span>⚡</span> <span>${window.i18n ? window.i18n.t('bank_btn_reconcile_confirmed') || 'Rapprocher les opérations confirmées' : 'Rapprocher les opérations confirmées'} (${totalConfirmedMatches})</span>
                    </button>
                    ${confirmedTooltipHtml}
                </div>
                ` : ''}
                ${totalNew > 0 ? `
                <div class="overview-bulk-wrapper">
                    <button class="btn ${totalConfirmedMatches > 0 ? 'btn-secondary' : 'btn-primary'}" onclick="window.BankSyncView.commitAllGhosts()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 600; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                        <span>📥</span> <span>${window.i18n.t('ghost_commit_all') || 'Valider les nouvelles opérations'} (${totalNew})</span>
                    </button>
                    ${ghostsTooltipHtml}
                </div>
                ` : ''}
                ${data.accounts && data.accounts.length > 0 ? `
                <button class="btn btn-secondary" onclick="window.BankSyncView.openPendingReviewModal(this)" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 600; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                    <span>📋</span> <span>${window.i18n.t('bank_sync_pending_review_btn') || 'Ouvrir la revue'}</span>
                </button>
                ` : ''}
                <button class="btn btn-secondary" onclick="if(confirm('${(window.i18n ? window.i18n.t('bank_sync_purge_confirm') || 'Vider tout le sas de synchronisation ? Cette action est irréversible.' : 'Vider tout le sas de synchronisation ? Cette action est irréversible.').replace(/'/g, "\\'")}')) window.BankSyncView.clearAllCaches()" style="font-size: 11px; padding: 4px 8px; border-radius: 6px; height: 28px; display: inline-flex; align-items: center; gap: 4px; opacity: 0.6; color: var(--text-muted);" title="${window.i18n ? window.i18n.t('bank_sync_purge_tooltip') || 'Vider le sas et supprimer toutes les suggestions en attente' : 'Vider le sas et supprimer toutes les suggestions en attente'}">
                    <span>🗑️</span> <span>${window.i18n ? window.i18n.t('bank_sync_purge_btn') || 'Vider le sas' : 'Vider le sas'}</span>
                </button>
            </div>
        </div>
        `;
    },

    computeAccountBalanceSyncStatus(acc, ghosts = []) {
        const bankBal = (typeof acc.bank_balance === 'number') ? acc.bank_balance : null;
        const localBal = (typeof acc.local_reconciled_balance === 'number') ? acc.local_reconciled_balance : null;
        if (bankBal === null || localBal === null) {
            return { hasBalances: false };
        }

        const delta = Math.round((bankBal - localBal) * 100) / 100;
        if (Math.abs(delta) < 0.005) {
            return {
                hasBalances: true,
                delta: 0,
                isSynced: true,
                isResolvedBySync: false,
                isExplainedByComing: false,
                bankBal,
                localBal
            };
        }

        const accGhosts = (ghosts || []).filter(g => String(g.account_id) === String(acc.account_id));
        const allTxs = (acc.transactions && acc.transactions.length > 0)
            ? acc.transactions
            : accGhosts;

        let netSyncImpact = 0.0;
        let hasResolvingTx = false;
        let accComingCount = 0;
        let accComingAmount = 0.0;

        allTxs.forEach(tx => {
            const isIgnored = tx._excluded || tx.is_dismissed || tx.is_auto_dismissed || (tx.is_reconciled && tx.already_reconciled);
            if (!isIgnored) {
                const rawAmt = typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0);
                if (tx.is_coming) {
                    accComingCount++;
                    accComingAmount += rawAmt;
                } else {
                    netSyncImpact += rawAmt;
                }
                if (tx._resolves_diff || Math.abs(rawAmt - delta) < 0.005) {
                    hasResolvingTx = true;
                    tx._resolves_diff = true;
                }
            }
        });

        // Si acc.transactions ne contenait pas certains fantômes présents dans ghosts, les incorporer
        if (acc.transactions && acc.transactions.length > 0 && accGhosts.length > 0) {
            const knownCsvIds = new Set(allTxs.map(t => t.csv_id).filter(Boolean));
            accGhosts.forEach(g => {
                if (g.csv_id && knownCsvIds.has(g.csv_id)) return;
                const rawAmt = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
                if (g.is_coming) {
                    accComingCount++;
                    accComingAmount += rawAmt;
                } else {
                    netSyncImpact += rawAmt;
                }
                if (g._resolves_diff || Math.abs(rawAmt - delta) < 0.005) {
                    hasResolvingTx = true;
                    g._resolves_diff = true;
                }
            });
        }

        netSyncImpact = Math.round(netSyncImpact * 100) / 100;
        const isResolvedBySync = hasResolvingTx || Math.abs(netSyncImpact - delta) < 0.01;
        const isExplainedByComing = !isResolvedBySync && accComingCount > 0 && Math.abs(Math.abs(accComingAmount) - Math.abs(delta)) < 0.01;

        return {
            hasBalances: true,
            delta,
            isSynced: false,
            isResolvedBySync,
            isExplainedByComing,
            netSyncImpact,
            accComingCount,
            accComingAmount,
            bankBal,
            localBal
        };
    },

    _updateMobilePendingBadge(ghostCount, confirmedCount, hasDiscrepancy) {
        const btn = document.getElementById('btnMobilePendingSync');
        if (!btn) return;

        const totalItems = (ghostCount || 0) + (confirmedCount || 0);
        if (totalItems === 0 && !hasDiscrepancy) {
            btn.classList.remove('active');
            return;
        }

        btn.classList.add('active');
        const lbl = document.getElementById('btnMobilePendingSyncLabel');
        const cnt = document.getElementById('btnMobilePendingSyncCount');

        if (totalItems > 0) {
            if (lbl) lbl.textContent = window.i18n ? window.i18n.t('bank_sync_pending_badge_short') || 'En attente' : 'En attente';
            if (cnt) {
                cnt.textContent = totalItems;
                cnt.style.display = 'inline-block';
            }
        } else if (hasDiscrepancy) {
            if (lbl) lbl.textContent = window.i18n ? window.i18n.t('bank_sync_balance_diff') || 'Écart' : 'Écart';
            if (cnt) {
                cnt.textContent = '!';
                cnt.style.display = 'inline-block';
            }
        }
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

        const hasGhosts = ghosts.length > 0;
        const totalCount = ghosts.length;

        // ── 1. Cohérence des soldes & Guide par Delta ─────────────────────
        let rawRelevantAccounts = (this.pendingAccounts && this.pendingAccounts.length > 0)
            ? this.pendingAccounts
            : (this.previewData?.accounts || []);
        if (accountFilter) {
            rawRelevantAccounts = rawRelevantAccounts.filter(a => String(a.account_id) === String(accountFilter));
        }

        // Dédupliquer les comptes par account_id ou nom pour ne jamais afficher de barre en double
        const seenBarAccKeys = new Set();
        const relevantAccounts = [];
        rawRelevantAccounts.forEach(acc => {
            const k = acc.account_id ? `id_${acc.account_id}` : `name_${(acc.account_name || acc.name || acc.section_title || '').trim().toLowerCase()}`;
            if (!seenBarAccKeys.has(k)) {
                seenBarAccKeys.add(k);
                relevantAccounts.push(acc);
            }
        });

        const accsWithBalance = relevantAccounts.filter(a =>
            typeof a.bank_balance === 'number' && typeof a.local_reconciled_balance === 'number'
        );
        const hasDiscrepancy = accsWithBalance.some(a => {
            const st = this.computeAccountBalanceSyncStatus(a, ghosts);
            return st.hasBalances && !st.isSynced && !st.isResolvedBySync && !st.isExplainedByComing;
        });
        const confirmedMatchCount = Object.values(this.pendingMatches || {}).filter(m => !m.is_coming).length;

        // Mise à jour du badge mobile d'en-tête (ouvre la revue détaillée sur demande)
        this._updateMobilePendingBadge(totalCount, confirmedMatchCount, hasDiscrepancy);

        // Masquer si aucune opération fantôme ET aucun écart de solde
        if (!hasGhosts && !hasDiscrepancy) {
            box.style.display = 'none';
            box.innerHTML = '';
            if (container) container.style.display = 'none';
            return;
        }

        box.style.display = 'block';
        if (container) container.style.display = 'block';

        // État replié/déplié : déplié si opérations fantômes, replié si seulement écarts
        const defaultCollapsed = !hasGhosts;
        const isCollapsed = (this._ghostBoxManualCollapse !== undefined)
            ? this._ghostBoxManualCollapse
            : defaultCollapsed;

        // Réinitialiser le flag de résolution delta sur les fantômes
        ghosts.forEach(g => { g._resolves_diff = false; });

        const balanceBarsHtml = relevantAccounts.map(acc => {
            const accName = acc.account_name || acc.name || '';
            const status = this.computeAccountBalanceSyncStatus(acc, ghosts);
            if (!status.hasBalances) return '';
            const { bankBal, localBal, delta } = status;

            let statusBadge = '';
            if (status.isSynced) {
                statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 600; padding: 0 10px; height: 26px; border-radius: 6px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px; box-sizing: border-box;" title="${(window.i18n ? window.i18n.t('bank_sync_balance_tooltip_synced') : 'Le solde de votre banque correspond au centime près à votre solde rapproché dans OmniBank.').replace(/"/g, '&quot;')}">✓ ${window.i18n ? window.i18n.t('bank_sync_balance_synced') : 'Soldes conformes'}</span>`;
            } else if (status.isResolvedBySync) {
                const deltaTip = (window.i18n ? window.i18n.t('bank_sync_delta_resolved_by_sync_tip') || "L'écart sera automatiquement comblé lors de l'enregistrement de vos opérations sélectionnées." : "L'écart sera automatiquement comblé lors de l'enregistrement de vos opérations sélectionnées.").replace(/"/g, '&quot;');
                statusBadge = `<span class="badge" style="background: rgba(99, 102, 241, 0.12); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.35); font-weight: 600; padding: 0 10px; height: 26px; border-radius: 6px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box; cursor: pointer;" onclick="window.BankSyncView.openPendingReviewModal ? window.BankSyncView.openPendingReviewModal(this, ${acc.account_id}) : null" title="${deltaTip}">💡 ${window.i18n ? window.i18n.t('bank_sync_balance_will_sync') || 'Conforme après validation' : 'Conforme après validation'}</span>`;
            } else if (status.isExplainedByComing) {
                const comingTip = (window.i18n && typeof window.i18n.tp === 'function' ? window.i18n.tp('bank_sync_delta_explained_by_coming', { count: status.accComingCount }) : `L'écart de ${(delta > 0 ? '+' : '') + delta.toFixed(2)} € correspond aux ${status.accComingCount} opération(s) en attente.`).replace(/"/g, '&quot;');
                statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 600; padding: 0 10px; height: 26px; border-radius: 6px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box;" title="${comingTip}">⏳ ${window.i18n ? window.i18n.t('bank_sync_balance_explained_coming') || 'Expliqué par opérations en attente' : 'Expliqué par opérations en attente'}</span>`;
            } else {
                const diffFormatted = (delta > 0 ? '+' : '') + delta.toFixed(2) + ' €';
                const escapedAccName = (window.escapeHtml ? window.escapeHtml(accName) : accName).replace(/'/g, "\\'");
                statusBadge = `
                    <button type="button" class="badge" onclick="window.BankSyncView.openBalanceAdjustModal(${acc.account_id}, '${escapedAccName}', ${bankBal}, ${localBal}, ${delta})" style="background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35); font-weight: 700; padding: 0 10px; height: 26px; border-radius: 6px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.15s ease; box-sizing: border-box;" title="${(window.i18n ? window.i18n.t('bank_sync_balance_adjust_tooltip') : 'Cliquer pour ajuster le solde et combler l\'écart').replace(/"/g, '&quot;')}">
                        <span>⚠️ ${window.i18n ? window.i18n.t('bank_sync_balance_diff') : 'Écart'} : ${diffFormatted}</span>
                        <span style="background: rgba(239, 68, 68, 0.2); padding: 2px 6px; border-radius: 4px; font-size: 10.5px;">${window.i18n ? window.i18n.t('bank_sync_balance_adjust_btn') || '⚡ Ajuster' : '⚡ Ajuster'}</span>
                    </button>
                `;
            }

            const accObj = (window.app?.accounts || []).find(x => x.id === acc.account_id);
            const accColor = accObj?.color || '#3366ff';
            const accPrefix = accName ? `<span style="display:inline-flex; align-items:center; gap:6px;"><span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:${accColor}; flex-shrink:0;"></span><strong style="color:var(--text-main); font-weight:700;">${window.escapeHtml ? window.escapeHtml(accName) : accName} :</strong></span> ` : '';

            return `
            <div class="ghost-balance-bar" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px;">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    ${accPrefix}
                    <span>🏦 ${window.i18n ? window.i18n.t('bank_sync_balance_bank') : 'Solde banque'} : <strong style="color: var(--text-main);">${bankBal.toFixed(2)} €</strong></span>
                    <span style="color: var(--text-muted); opacity: 0.5;">•</span>
                    <span>💻 ${window.i18n ? window.i18n.t('bank_sync_balance_local') : 'Solde rapproché'} : <strong style="color: var(--text-main);">${localBal.toFixed(2)} €</strong></span>
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
                : 'background: rgba(245, 158, 11, 0.04); border-left: 3px dashed #f59e0b; transition: background 0.15s ease;'

            const showRaw = g.raw_description && g.raw_description !== g.description;
            const rawSubHtml = showRaw ? `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 2px; font-weight: normal; opacity: 0.85;">🏦 ${window.escapeHtml ? window.escapeHtml(g.raw_description) : g.raw_description}</div>` : '';

            const gAccObj = (window.app?.accounts || []).find(x => x.id === g.account_id || x.name === g.account_name);
            const gAccColor = gAccObj?.color || '#3366ff';
            const gAccBadge = g.account_name ? `<span class="account-badge" style="border-color:${gAccColor}40; background:${gAccColor}18; color:${gAccColor};"><span class="acc-badge-dot" style="background:${gAccColor};"></span>${window.escapeHtml ? window.escapeHtml(g.account_name) : g.account_name}</span>` : '';

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
                <td style="padding: 8px 12px; font-size: 11px;">${gAccBadge}</td>
                <td style="padding: 8px 12px; font-size: 11px;">
                    ${g.category ? `<span style="background: rgba(99, 102, 241, 0.12); color: var(--accent, #6366f1); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏷️ ${window.escapeHtml ? window.escapeHtml(g.category) : g.category}</span>` : `<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Sans catégorie</span>`}
                </td>
                <td style="padding: 8px 12px; font-size: 12px; font-weight: 700; text-align: right; color: ${amtColor}; white-space: nowrap;">${amtFormatted}</td>
                <td style="padding: 8px 12px; text-align: right; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end;">
                        <button class="btn btn-primary" onclick="window.BankSyncView.validateGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}" style="font-size: 11.5px; padding: 0 10px; border-radius: 6px; height: 26px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                            ✔ ${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}
                        </button>
                        <button class="btn-action-icon" onclick="window.BankSyncView.openLinkGhostModal('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_link_single') || 'Lier à une opération existante' : 'Lier à une opération existante'}">
                            🔗
                        </button>
                        <button class="btn-action-icon" onclick="window.BankSyncView.editGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_edit_single') || 'Modifier' : 'Modifier'}">
                            ✏️
                        </button>
                        <button class="btn-action-del" onclick="window.BankSyncView.dismissGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_dismiss_single') || 'Ignorer' : 'Ignorer'}">
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

            const gAccObj = (window.app?.accounts || []).find(x => x.id === g.account_id || x.name === g.account_name);
            const gAccColor = gAccObj?.color || '#3366ff';
            const gAccBadge = g.account_name ? `<span class="account-badge" style="border-color:${gAccColor}40; background:${gAccColor}18; color:${gAccColor};"><span class="acc-badge-dot" style="background:${gAccColor};"></span>${window.escapeHtml ? window.escapeHtml(g.account_name) : g.account_name}</span>` : '';

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
                    ${gAccBadge}
                    ${g.category ? `<span style="background: rgba(99, 102, 241, 0.12); color: var(--accent, #6366f1); padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏷️ ${window.escapeHtml ? window.escapeHtml(g.category) : g.category}</span>` : `<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Sans catégorie</span>`}
                </div>
                <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
                    <button class="btn btn-primary" onclick="window.BankSyncView.validateGhostRow('${g.csv_id}')" style="flex: 1; font-size: 12px; padding: 6px 8px; border-radius: 6px; font-weight: 700; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                        ✔ ${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.openLinkGhostModal('${g.csv_id}')" style="font-size: 12px; padding: 6px 10px; border-radius: 6px; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;" title="${window.i18n ? window.i18n.t('ghost_link_single') || 'Lier' : 'Lier'}">
                        🔗 ${window.i18n ? window.i18n.t('ghost_link_single_short') || 'Lier' : 'Lier'}
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.editGhostRow('${g.csv_id}')" style="font-size: 12px; padding: 6px 10px; border-radius: 6px; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;" title="${window.i18n ? window.i18n.t('ghost_edit_single') || 'Modifier' : 'Modifier'}">
                        ✏️
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.dismissGhostRow('${g.csv_id}')" style="font-size: 12px; padding: 6px 10px; border-radius: 6px; height: 32px; color: var(--text-muted); display: inline-flex; align-items: center; justify-content: center;" title="${window.i18n ? window.i18n.t('ghost_dismiss_single') || 'Ignorer' : 'Ignorer'}">
                        ✕
                    </button>
                </div>
            </div>
            `;
        }).join('');

        // ── Résumé pour l'en-tête replié ─────────────────────────────
        let summaryParts = [];
        if (confirmedMatchCount > 0) {
            const readyLbl = window.i18n ? window.i18n.t('bank_sync_ready_to_reconcile') || 'prête(s) à rapprocher' : 'prête(s) à rapprocher';
            summaryParts.push(`<strong style="color: #10b981;">${confirmedMatchCount}</strong> ${readyLbl}`);
        }
        if (hasGhosts) {
            summaryParts.push(`<strong>${totalCount}</strong> nouvelle(s)`);
        }
        if (hasDiscrepancy) {
            let totalDiff = 0;
            accsWithBalance.forEach(a => {
                const d = a.bank_balance - a.local_reconciled_balance;
                if (Math.abs(d) >= 0.005) totalDiff += d;
            });
            totalDiff = Math.round(totalDiff * 100) / 100;
            const diffFmt = (totalDiff > 0 ? '+' : '') + totalDiff.toFixed(2) + ' €';
            summaryParts.push(`⚠️ ${window.i18n ? window.i18n.t('bank_sync_balance_diff') || 'Écart' : 'Écart'} : ${diffFmt}`);
        }
        const summaryText = summaryParts.join(' • ');

        const chevron = isCollapsed ? '▶' : '▼';
        const containerBg = hasGhosts
            ? 'background: rgba(245, 158, 11, 0.06);'
            : 'background: rgba(99, 102, 241, 0.06);';
        const containerBorder = hasGhosts
            ? 'border: 1px dashed rgba(245, 158, 11, 0.35);'
            : 'border: 1px solid rgba(99, 102, 241, 0.25);';
        const headerIcon = hasGhosts ? '👻' : '📥';
        const headerTitle = hasGhosts
            ? (window.i18n ? window.i18n.t('ghost_box_title') || 'Opérations en ligne non enregistrées' : 'Opérations en ligne non enregistrées')
            : (window.i18n ? window.i18n.t('bank_sync_pending_box_title') || 'Synchronisation bancaire' : 'Synchronisation bancaire');

        const confirmedList = this.getConfirmedMatchesList(this._lastPendingSyncData);
        const ghostList = ghosts || this.getGhostTransactionsList(this._lastPendingSyncData);
        const confirmedTooltipTitle = window.i18n ? window.i18n.t('bank_btn_reconcile_confirmed_tooltip') || 'Opérations confirmées qui seront rapprochées' : 'Opérations confirmées qui seront rapprochées';
        const ghostTooltipTitle = window.i18n ? window.i18n.t('ghost_commit_all_tooltip') || 'Nouvelles opérations qui seront ajoutées' : 'Nouvelles opérations qui seront ajoutées';
        const confirmedTooltipHtml = this.renderOperationsTooltipHtml(confirmedTooltipTitle, confirmedList);
        const ghostsTooltipHtml = this.renderOperationsTooltipHtml(ghostTooltipTitle, ghostList);

        box.innerHTML = `
        <div class="ghost-rows-container" style="${containerBg} ${containerBorder} border-radius: 12px; padding: 12px 14px; margin-bottom: 4px;">
            <div onclick="window.BankSyncView.toggleGhostBox()" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; cursor: pointer; user-select: none;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-size: 14px; color: var(--text-muted); display: inline-block;">${chevron}</span>
                    <span style="font-size: 18px;">${headerIcon}</span>
                    <span style="font-size: 13px; font-weight: 700; color: var(--text-main);">
                        ${headerTitle}
                    </span>
                    ${hasGhosts ? `
                    <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 10px;">
                        ${totalCount}
                    </span>` : ''}
                    ${isCollapsed && summaryText ? `
                    <span style="font-size: 12px; color: var(--text-muted); margin-left: 4px;">
                        ${summaryText}
                    </span>` : ''}
                </div>
                <div class="ghost-box-header-btn-wrap" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;" onclick="event.stopPropagation();">
                    ${confirmedMatchCount > 0 ? `
                    <div class="overview-bulk-wrapper">
                        <button class="btn btn-primary" onclick="window.BankSyncView.reconcileAllPending()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 700; height: 30px; display: inline-flex; align-items: center; gap: 4px;">
                            <span>⚡</span> <span>${window.i18n ? window.i18n.t('bank_btn_reconcile_confirmed') || 'Rapprocher' : 'Rapprocher'} (${confirmedMatchCount})</span>
                        </button>
                        ${confirmedTooltipHtml}
                    </div>` : ''}
                    ${hasGhosts ? `
                    <div class="overview-bulk-wrapper">
                        <button class="btn ${confirmedMatchCount > 0 ? 'btn-secondary' : 'btn-primary'} ghost-box-header-btn" onclick="window.BankSyncView.commitAllGhosts()" style="font-size: 12px; padding: 5px 14px; border-radius: 6px; font-weight: 600; height: 30px; display: inline-flex; align-items: center; gap: 6px;">
                            <span>📥</span> <span>${window.i18n ? window.i18n.t('ghost_commit_all') || 'Valider les nouvelles opérations' : 'Valider les nouvelles opérations'} (${totalCount})</span>
                        </button>
                        ${ghostsTooltipHtml}
                    </div>` : ''}
                    <button class="btn btn-secondary" onclick="window.BankSyncView.openPendingReviewModal(this)" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 600; height: 30px; display: inline-flex; align-items: center; gap: 4px;" title="${window.i18n ? window.i18n.t('bank_sync_pending_review_tooltip') || 'Ouvrir la vue détaillée de revue et rapprochement' : 'Ouvrir la vue détaillée de revue et rapprochement'}">
                        <span>📋</span> <span>${window.i18n ? window.i18n.t('bank_sync_pending_review_btn') || 'Ouvrir la revue' : 'Ouvrir la revue'}</span>
                    </button>
                </div>
            </div>
            <div id="ghostBoxContent" style="${isCollapsed ? 'display: none;' : 'margin-top: 10px; max-height: min(45vh, 400px); overflow-y: auto; overflow-x: hidden; padding-right: 4px;'}">
                ${balanceBarsHtml}
                ${hasGhosts ? `
            <!-- Vue Tableau Desktop -->
            <div class="ghost-desktop-table-wrapper">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(245, 158, 11, 0.2); text-align: left; color: var(--text-muted); font-size: 11px;">
                            <th style="padding: 6px 12px; width: 60px;">${(window.i18n && window.i18n.t('th_status')) || 'Statut'}</th>
                            <th style="padding: 6px 12px; width: 90px;">${(window.i18n && window.i18n.t('th_date')) || 'Date'}</th>
                            <th style="padding: 6px 12px;">${(window.i18n && window.i18n.t('col_description')) || 'Description'}</th>
                            <th style="padding: 6px 12px; width: 140px;">${(window.i18n && window.i18n.t('th_account')) || 'Compte'}</th>
                            <th style="padding: 6px 12px; width: 140px;">${(window.i18n && window.i18n.t('col_category')) || 'Catégorie'}</th>
                            <th style="padding: 6px 12px; width: 100px; text-align: right;">${(window.i18n && window.i18n.t('col_amount')) || 'Montant'}</th>
                            <th style="padding: 6px 12px; width: 130px; text-align: right;">${(window.i18n && window.i18n.t('th_actions')) || 'Actions'}</th>
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
                ` : ''}
            </div>
        </div>
        `;
    },

    toggleGhostBox() {
        const content = document.getElementById('ghostBoxContent');
        const isCurrentlyCollapsed = content ? content.style.display === 'none' : true;
        this._ghostBoxManualCollapse = !isCurrentlyCollapsed;
        const box = document.getElementById('ghostRowsBox');
        if (box && box.parentElement) {
            this.renderGhostBox(box.parentElement);
        }
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
            const res = await API.post('/api/bank-sync/commit-ghost', {
                connection_id: ghost.connection_id || 0,
                transaction: ghost
            });
            const createdTxId = res?.result?.created_ids?.[0] || res?.result?.transactions?.[0]?.id;
            if (createdTxId) {
                if (window.TimelineView) window.TimelineView._pendingHighlightTxId = createdTxId;
                if (window.AllOperationsView) window.AllOperationsView._pendingHighlightTxId = createdTxId;
                if (window.OverviewView) window.OverviewView._pendingHighlightTxId = createdTxId;
            }
            this.ghostTransactions = this.ghostTransactions.filter(g => g.csv_id !== csvId);
            this.showToast(window.i18n ? window.i18n.t('ghost_validated') || 'Opération validée' : 'Opération validée', 'success');
            await this.refreshActiveViews(createdTxId);
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
            const firstCreatedId = res?.created_ids?.[0];
            if (firstCreatedId) {
                if (window.TimelineView) window.TimelineView._pendingHighlightTxId = firstCreatedId;
                if (window.AllOperationsView) window.AllOperationsView._pendingHighlightTxId = firstCreatedId;
                if (window.OverviewView) window.OverviewView._pendingHighlightTxId = firstCreatedId;
            }
            const toastMsg = (window.i18n ? window.i18n.t('ghost_committed_success') || '{count} opération(s) validée(s) avec succès' : '{count} opération(s) validée(s) avec succès').replace('{count}', committed);
            this.showToast(toastMsg, 'success');
            this.ghostTransactions = [];
            await this.refreshActiveViews(firstCreatedId);
        } catch (err) {
            this.showToast('Erreur validation en lot : ' + (err.detail || err.message), 'error');
        }
    },

    async openPendingReviewModal(triggerEl = null, targetAccountId = null) {
        if (this._isOpeningPendingReview) return;
        this._isOpeningPendingReview = true;

        let btn = triggerEl;
        if (!btn && typeof event !== 'undefined' && event) {
            btn = (event.currentTarget instanceof HTMLElement ? event.currentTarget : (event.target instanceof HTMLElement ? event.target.closest('button') : null));
        }
        if (!btn) {
            btn = document.getElementById('btnMobilePendingSync');
        }

        let origContent = null;
        if (btn) {
            btn.classList.add('loading');
            btn.style.pointerEvents = 'none';
            btn.style.opacity = '0.85';
            origContent = btn.innerHTML;
            btn.innerHTML = `
                <span class="btn-spinner" style="display:inline-block; width:13px; height:13px; border:2px solid currentColor; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite; vertical-align: middle;"></span>
                <span>${window.i18n ? window.i18n.t('loading') || 'Chargement...' : 'Chargement...'}</span>
            `;
        }

        try {
            this.ensureModalsExist();
            let data = await API.get('/api/bank-sync/pending');
            if (data && data.accounts && data.accounts.length > 0) {
                const firstConnId = data.accounts[0]?.connection_id != null ? data.accounts[0].connection_id : (this.connections?.[0]?.id || 1);
                const isCsv = firstConnId === -1;
                await this.openReviewModal(firstConnId, {
                    _source: isCsv ? 'csv_import' : 'bank_sync',
                    connection_id: firstConnId,
                    accounts: data.accounts
                }, targetAccountId);
                return;
            }

            // Fallback : vérifier le cache local des connexions actives
            if (this.connections && this.connections.length > 0) {
                for (const conn of this.connections) {
                    const cached = this.getCachedPreview(conn.id);
                    if (cached && cached.data && cached.data.accounts && cached.data.accounts.length > 0) {
                        await this.openReviewModal(conn.id, cached.data, targetAccountId);
                        return;
                    }
                }
            }

            this.showToast('Aucune opération en attente de revue.', 'info');
        } catch (e) {
            console.error('[BankSync] Erreur ouverture des opérations en attente:', e);
            this.showToast('Erreur ouverture des opérations en attente : ' + (e.message || e), 'error');
        } finally {
            if (btn && origContent !== null) {
                btn.classList.remove('loading');
                btn.style.pointerEvents = '';
                btn.style.opacity = '';
                btn.innerHTML = origContent;
            }
            this._isOpeningPendingReview = false;
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
            this.showToast(window.i18n ? window.i18n.t('bank_sync_reconciled_success') || 'Opération rapprochée avec succès !' : 'Opération rapprochée avec succès !', 'success');

            // Retirer de pendingMatches localement
            if (this.pendingMatches && this.pendingMatches[txId]) {
                delete this.pendingMatches[txId];
            }

            if (window.TimelineView) window.TimelineView._pendingHighlightTxId = txId;
            if (window.AllOperationsView) window.AllOperationsView._pendingHighlightTxId = txId;
            if (window.OverviewView) window.OverviewView._pendingHighlightTxId = txId;

            await this.refreshActiveViews();
        } catch (err) {
            const ovRow = document.getElementById(`ovRow_${txId}`);
            if (ovRow) {
                ovRow.style.opacity = '1';
                ovRow.style.transform = '';
                ovRow.style.pointerEvents = '';
            }
            this.showToast('Erreur rapprochement : ' + (err.detail || err.message), 'error');
        }
    },

    async reconcileAllPending() {
        try {
            const res = await API.post('/api/bank-sync/reconcile-all-pending');
            const count = res?.reconciled_count || 0;
            this.showToast(`${count} opération(s) rapprochée(s) avec succès !`, 'success');
            this.pendingMatches = {};

            await this.refreshActiveViews();
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── AJUSTEMENT DU SOLDE EN 1 CLIC (Gestion des écarts sans opération) ──
    _adjustTargetAccountId: null,
    _adjustDelta: 0,
    _adjustBankBalance: 0,
    _adjustLocalBalance: 0,

    openBalanceAdjustModal(accountId, accountName, bankBalance, localBalance, delta) {
        this.ensureModalsExist();
        this._adjustTargetAccountId = accountId;
        this._adjustDelta = delta;
        this._adjustBankBalance = bankBalance;
        this._adjustLocalBalance = localBalance;

        const modal = document.getElementById('balanceAdjustModal');
        if (!modal) return;

        // Traduire dynamiquement le DOM de la modale selon la langue courante
        if (window.i18n && typeof window.i18n.translateDOM === 'function') {
            window.i18n.translateDOM(modal);
        }

        const diffFormatted = (delta > 0 ? '+' : '') + delta.toFixed(2) + ' €';
        const isPositive = delta >= 0;

        const headerEl = document.getElementById('balanceAdjustModalHeader');
        if (headerEl) {
            const diffLabel = window.i18n ? window.i18n.t('bank_sync_balance_diff', 'Écart') : 'Écart';
            const bankLabel = window.i18n ? window.i18n.t('modal_adjust_header_bank_bal', 'Solde banque') : 'Solde banque';
            const localLabel = window.i18n ? window.i18n.t('modal_adjust_header_local_bal', 'Solde rapproché actuel') : 'Solde rapproché actuel';

            headerEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 8px;">
                    <span style="font-weight: 700; font-size: 14px; color: var(--text-main);">💳 ${window.escapeHtml ? window.escapeHtml(accountName) : accountName}</span>
                    <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-weight: 800; font-size: 12px; padding: 3px 8px; border-radius: 6px;">
                        ⚠️ ${diffLabel} : ${diffFormatted}
                    </span>
                </div>
                <div style="display: flex; gap: 14px; font-size: 12px; color: var(--text-muted); flex-wrap: wrap;">
                    <span>🏦 ${bankLabel} : <strong style="color: var(--text-main);">${bankBalance.toFixed(2)} €</strong></span>
                    <span>•</span>
                    <span>💻 ${localLabel} : <strong style="color: var(--text-main);">${localBalance.toFixed(2)} €</strong></span>
                </div>
            `;
        }

        const btnInit = document.getElementById('btnAdjustInitialBalance');
        if (btnInit) {
            const initBtnPattern = window.i18n ? window.i18n.t('modal_adjust_opt_initial_btn', '🎯 Ajuster le solde initial ({diff})') : '🎯 Ajuster le solde initial ({diff})';
            btnInit.textContent = initBtnPattern.includes('{diff}') ? initBtnPattern.replace('{diff}', diffFormatted) : `${initBtnPattern} (${diffFormatted})`;
        }

        const btnTx = document.getElementById('btnAdjustCreateTx');
        if (btnTx) {
            const txBtnPattern = window.i18n ? window.i18n.t('modal_adjust_opt_tx_btn', '📝 Créer l\'opération rapprochée ({diff})') : '📝 Créer l\'opération rapprochée ({diff})';
            btnTx.textContent = txBtnPattern.includes('{diff}') ? txBtnPattern.replace('{diff}', diffFormatted) : `${txBtnPattern} (${diffFormatted})`;
        }

        const descInput = document.getElementById('balanceAdjustTxDesc');
        if (descInput) {
            const defaultInterest = window.i18n ? window.i18n.t('modal_adjust_tx_default_interest', 'Intérêts annuels') : 'Intérêts annuels';
            const defaultFee = window.i18n ? window.i18n.t('modal_adjust_tx_default_fee', 'Régularisation bancaire') : 'Régularisation bancaire';
            descInput.value = isPositive ? defaultInterest : defaultFee;
        }

        const catSelect = document.getElementById('balanceAdjustTxCategory');
        if (catSelect) {
            const rawCategories = window.app?.categoriesList || [];
            const catNames = rawCategories.length > 0
                ? rawCategories.map(c => typeof c === 'string' ? c : c?.name).filter(Boolean)
                : ['Intérêts', 'Épargne', 'Frais bancaires', 'Autre'];
            catSelect.innerHTML = catNames.map(cat => `<option value="${window.escapeHtml ? window.escapeHtml(cat) : cat}">${window.escapeHtml ? window.escapeHtml(cat) : cat}</option>`).join('');
            if (isPositive && catNames.includes('Intérêts')) {
                catSelect.value = 'Intérêts';
            } else if (isPositive && catNames.includes('Épargne')) {
                catSelect.value = 'Épargne';
            } else if (!isPositive && catNames.includes('Frais bancaires')) {
                catSelect.value = 'Frais bancaires';
            }
        }

        modal.style.display = 'flex';
    },

    closeBalanceAdjustModal() {
        const modal = document.getElementById('balanceAdjustModal');
        if (modal) modal.style.display = 'none';
        this._adjustTargetAccountId = null;
    },

    async submitBalanceAdjustment(mode) {
        if (!this._adjustTargetAccountId) return;
        const accId = this._adjustTargetAccountId;
        const delta = this._adjustDelta;

        const payload = {
            mode: mode,
            delta: delta,
            transaction_date: new Date().toISOString().split('T')[0],
            transaction_description: document.getElementById('balanceAdjustTxDesc')?.value || (delta >= 0 ? 'Intérêts annuels' : 'Régularisation bancaire'),
            transaction_category: document.getElementById('balanceAdjustTxCategory')?.value || (delta >= 0 ? 'Intérêts' : 'Frais bancaires')
        };

        try {
            const res = await API.post(`/api/accounts/${accId}/reconcile-balance-delta`, payload);
            this.closeBalanceAdjustModal();
            const successMsg = window.i18n ? window.i18n.t('toast_balance_adjusted_success') || 'Solde du compte ajusté avec succès !' : 'Solde du compte ajusté avec succès !';
            if (typeof showUndoToast === 'function' && res.action_id) {
                showUndoToast(successMsg, res.action_id, () => this.refreshActiveViews());
            } else {
                this.showToast(successMsg, 'success');
            }
            await this.refreshActiveViews();
        } catch (err) {
            console.error('[BankSync] Erreur ajustement solde:', err);
            this.showToast('Erreur lors de l\'ajustement du solde : ' + (err.detail || err.message), 'error');
        }
    },


    // ── LIAISON MANUELLE GHOST -> TRANSACTION DB ─────────────────────
    _linkGhostCurrentGhost: null,
    _linkGhostSelectedTarget: null,
    _linkGhostFieldSources: { desc: 'db', amount: 'online', cat: 'db' },
    _linkGhostDebounceTimer: null,

    async openLinkGhostModal(csvId) {
        this.ensureModalsExist();
        const ghost = this.ghostTransactions.find(g => g.csv_id === csvId);
        if (!ghost) return;

        this._linkGhostCurrentGhost = ghost;
        this._linkGhostSelectedTarget = null;
        this._linkGhostFieldSources = { desc: 'db', amount: 'online', cat: 'db' };

        const modal = document.getElementById('linkGhostModal');
        if (!modal) return;

        if (window.i18n && typeof window.i18n.translateDOM === 'function') {
            window.i18n.translateDOM(modal);
        }

        // Peupler la liste des catégories
        const catSelect = document.getElementById('linkFinalCategory');
        if (catSelect) {
            let catNames = [];
            try {
                if (!window.app?.categoriesList || !window.app.categoriesList.length) {
                    window.app = window.app || {};
                    window.app.categoriesList = await API.get('/api/categories/');
                }
                catNames = (window.app?.categoriesList || []).map(c => typeof c === 'string' ? c : c?.name).filter(Boolean);
            } catch (_) {}
            if (!catNames.length) {
                catNames = ['Alimentation', 'Loisirs', 'Transport', 'Logement', 'Salaire', 'Autre'];
            }
            catNames = Array.from(new Set(catNames)).sort((a, b) => a.localeCompare(b));
            catSelect.innerHTML = `<option value="">-- ${window.i18n ? window.i18n.t('no_category') || 'Sans catégorie' : 'Sans catégorie'} --</option>` + catNames.map(cat => `<option value="${window.escapeHtml ? window.escapeHtml(cat) : cat}">${window.escapeHtml ? window.escapeHtml(cat) : cat}</option>`).join('');
        }

        // Rendu du résumé de l'opération fantôme source
        const summaryEl = document.getElementById('linkGhostSourceSummary');
        if (summaryEl) {
            const rawAmt = typeof ghost.raw_amount !== 'undefined' ? parseFloat(ghost.raw_amount) : (parseFloat(ghost.amount) || 0);
            const isPositive = rawAmt >= 0;
            const absAmt = Math.abs(parseFloat(ghost.amount) || rawAmt || 0);
            const amtFmt = (isPositive ? '+ ' : '- ') + absAmt.toFixed(2) + ' €';
            const amtColor = isPositive ? 'var(--accent-success, #10b981)' : 'var(--text-main, #f87171)';
            const dateStr = ghost.date_operation ? String(ghost.date_operation).substring(0, 10) : '';

            summaryEl.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; margin-bottom: 6px;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="badge ghost-badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 11px;">👻 ${window.i18n ? window.i18n.t('ghost_badge') || 'En ligne' : 'En ligne'}</span>
                        <span style="font-weight: 700; font-size: 13px; color: var(--text-main);">${window.escapeHtml ? window.escapeHtml(ghost.description) : ghost.description}</span>
                    </div>
                    <span style="font-weight: 800; font-size: 14px; color: ${amtColor};">${amtFmt}</span>
                </div>
                <div style="display: flex; gap: 12px; font-size: 11.5px; color: var(--text-muted); flex-wrap: wrap;">
                    <span>📅 ${dateStr}</span>
                    <span>•</span>
                    <span>💳 ${window.escapeHtml ? window.escapeHtml(ghost.account_name || '') : (ghost.account_name || '')}</span>
                    ${ghost.raw_description && ghost.raw_description !== ghost.description ? `<span>•</span><span style="font-style: italic;">🏦 ${window.escapeHtml ? window.escapeHtml(ghost.raw_description) : ghost.raw_description}</span>` : ''}
                </div>
            `;
        }

        // Réinitialiser le panneau de résolution et le bouton
        const resPanel = document.getElementById('linkGhostResolutionPanel');
        if (resPanel) resPanel.style.display = 'none';
        const btnSubmit = document.getElementById('btnSubmitLinkGhost');
        if (btnSubmit) btnSubmit.disabled = true;

        const searchInput = document.getElementById('linkGhostSearchInput');
        if (searchInput) {
            searchInput.value = '';
        }

        modal.style.display = 'flex';

        // Lancer la recherche initiale (non rapprochées en priorité sur le compte)
        this.searchDbTransactions('', ghost.account_id, true);
    },

    closeLinkGhostModal() {
        const modal = document.getElementById('linkGhostModal');
        if (modal) modal.style.display = 'none';
        this._linkGhostCurrentGhost = null;
        this._linkGhostSelectedTarget = null;
        this._linkFromReviewContext = null;
    },

    onLinkGhostSearchInput() {
        if (this._linkGhostDebounceTimer) clearTimeout(this._linkGhostDebounceTimer);
        this._linkGhostDebounceTimer = setTimeout(() => {
            const searchInput = document.getElementById('linkGhostSearchInput');
            const query = searchInput ? searchInput.value.trim() : '';
            const unrecCheck = document.getElementById('linkGhostUnrecOnly');
            const unrecOnly = unrecCheck ? unrecCheck.checked : false;
            const accId = this._linkGhostCurrentGhost ? this._linkGhostCurrentGhost.account_id : null;
            this.searchDbTransactions(query, accId, unrecOnly);
        }, 200);
    },

    async searchDbTransactions(query, accountId, unrecOnly = true) {
        const listEl = document.getElementById('linkGhostResultsList');
        if (!listEl) return;
        listEl.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px;">Chargement...</div>`;

        try {
            let url = `/api/transactions/?limit=40&order=asc`;
            if (accountId) url += `&account_id=${accountId}`;
            if (unrecOnly) url += `&unreconciled_only=true`;
            if (query) url += `&search=${encodeURIComponent(query)}`;

            const results = await API.get(url);
            // Tri chronologique croissant (les dates les plus proches / anciennes en premier)
            const sortedResults = (results || []).slice().sort((a, b) => {
                const cmp = (a.date_operation || '').localeCompare(b.date_operation || '');
                if (cmp !== 0) return cmp;
                return (a.id || 0) - (b.id || 0);
            });
            this.renderLinkGhostResults(sortedResults);
        } catch (err) {
            console.error('[BankSync] Erreur recherche transactions pour liaison:', err);
            listEl.innerHTML = `<div style="padding: 12px; text-align: center; color: #ef4444; font-size: 12px;">Erreur lors de la recherche</div>`;
        }
    },

    renderLinkGhostResults(transactions) {
        const listEl = document.getElementById('linkGhostResultsList');
        if (!listEl) return;

        if (!transactions || transactions.length === 0) {
            const noResTxt = window.i18n ? window.i18n.t('ghost_link_no_results') || 'Aucune opération trouvée dans la base de données.' : 'Aucune opération trouvée dans la base de données.';
            listEl.innerHTML = `<div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 12px;">${noResTxt}</div>`;
            return;
        }

        const selectedId = this._linkGhostSelectedTarget ? this._linkGhostSelectedTarget.id : null;

        listEl.innerHTML = transactions.map(tx => {
            const isSel = selectedId === tx.id;
            const isRec = !!tx.reconciliation_date;
            const dateStr = tx.date_operation ? String(tx.date_operation).substring(0, 10) : '';
            const amtFmt = (tx.amount || 0).toFixed(2) + ' €';
            const bgStyle = isSel
                ? 'background: rgba(99, 102, 241, 0.18); border: 1px solid var(--accent, #6366f1);'
                : 'background: var(--bg-surface, var(--bg-base)); border: 1px solid var(--border-color);';

            const recBadge = isRec
                ? `<span style="font-size: 10px; background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 1px 5px; border-radius: 4px; font-weight: 700;">🟢 ${window.i18n ? window.i18n.t('ghost_link_status_reconciled') || 'Rapprochée' : 'Rapprochée'}</span>`
                : `<span style="font-size: 10px; background: rgba(239, 68, 68, 0.15); color: #ef4444; padding: 1px 5px; border-radius: 4px; font-weight: 700;">⚪ ${window.i18n ? window.i18n.t('ghost_link_status_unreconciled') || 'Non rapprochée' : 'Non rapprochée'}</span>`;

            // Compte associé à la transaction en base
            const txAccId = tx.from_account_id || tx.to_account_id;
            const txAccObj = (window.app?.accounts || []).find(a => a.id === txAccId);
            const txAccColor = txAccObj?.color || '#3366ff';
            const txAccBadge = txAccObj ? `<span class="account-badge" style="border-color:${txAccColor}40; background:${txAccColor}18; color:${txAccColor}; font-size:10.5px; padding:1px 6px; height:20px;"><span class="acc-badge-dot" style="background:${txAccColor}; width:5px; height:5px;"></span>${window.escapeHtml ? window.escapeHtml(txAccObj.name) : txAccObj.name}</span>` : '';

            // Libellé original / brut si présent
            const showRaw = tx.raw_description && tx.raw_description !== tx.description;
            const rawSubHtml = showRaw
                ? `<div style="font-size: 10.5px; color: var(--text-muted); font-style: italic; margin-top: 2px; opacity: 0.85;">🏦 ${window.escapeHtml ? window.escapeHtml(tx.raw_description) : tx.raw_description}</div>`
                : '';

            return `
                <div onclick="window.BankSyncView.selectLinkTarget(${tx.id})" style="${bgStyle} border-radius: 8px; padding: 8px 12px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 10px; transition: all 0.15s ease;" onmouseenter="if(!this.dataset.selected) this.style.borderColor='var(--accent, #6366f1)';" onmouseleave="if(!this.dataset.selected) this.style.borderColor='${isSel ? 'var(--accent, #6366f1)' : 'var(--border-color)'}';" ${isSel ? 'data-selected="true"' : ''}>
                    <div style="display: flex; flex-direction: column; gap: 2px; overflow: hidden; flex: 1;">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="font-weight: 700; font-size: 12.5px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${window.escapeHtml ? window.escapeHtml(tx.description) : tx.description}</span>
                            ${recBadge}
                            ${txAccBadge}
                        </div>
                        ${rawSubHtml}
                        <div style="font-size: 11px; color: var(--text-muted); display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                            <span>📅 ${dateStr}</span>
                            ${tx.category ? `<span>• 🏷️ ${window.escapeHtml ? window.escapeHtml(tx.category) : tx.category}</span>` : ''}
                        </div>
                    </div>
                    <div style="font-weight: 800; font-size: 13px; color: var(--text-main); white-space: nowrap;">
                        ${amtFmt}
                    </div>
                </div>
            `;
        }).join('');
    },

    async selectLinkTarget(txId) {
        try {
            const tx = await API.get(`/api/transactions/${txId}`);
            if (!tx) return;
            this._linkGhostSelectedTarget = tx;

            // Re-render pour mettre à jour la sélection visuelle
            const searchInput = document.getElementById('linkGhostSearchInput');
            const query = searchInput ? searchInput.value.trim() : '';
            const unrecCheck = document.getElementById('linkGhostUnrecOnly');
            const unrecOnly = unrecCheck ? unrecCheck.checked : false;
            const accId = this._linkGhostCurrentGhost ? this._linkGhostCurrentGhost.account_id : null;
            await this.searchDbTransactions(query, accId, unrecOnly);

            const resPanel = document.getElementById('linkGhostResolutionPanel');
            if (resPanel) resPanel.style.display = 'flex';

            const btnSubmit = document.getElementById('btnSubmitLinkGhost');
            if (btnSubmit) btnSubmit.disabled = false;

            // Sens par défaut :
            // - Libellé : DB
            // - Montant : En ligne (Ghost)
            // - Catégorie : DB (ou Ghost si DB n'en a pas)
            this._linkGhostFieldSources = {
                desc: 'db',
                amount: 'online',
                cat: tx.category ? 'db' : (this._linkGhostCurrentGhost?.category ? 'online' : 'db')
            };

            this.setLinkFieldSource('desc', this._linkGhostFieldSources.desc);
            this.setLinkFieldSource('amount', this._linkGhostFieldSources.amount);
            this.setLinkFieldSource('cat', this._linkGhostFieldSources.cat);

            const dateInput = document.getElementById('linkFinalReconDate');
            if (dateInput) {
                dateInput.value = new Date().toISOString().split('T')[0];
            }
        } catch (e) {
            console.error('[BankSync] Erreur sélection transaction cible:', e);
        }
    },

    setLinkFieldSource(field, source) {
        this._linkGhostFieldSources[field] = source;
        const ghost = this._linkGhostCurrentGhost;
        const target = this._linkGhostSelectedTarget;
        if (!ghost || !target) return;

        if (field === 'desc') {
            const val = source === 'db' ? target.description : (ghost.description || ghost.raw_description || '');
            const input = document.getElementById('linkFinalDesc');
            if (input) input.value = val;
            const hintEl = document.getElementById('linkDescOriginalHint');
            if (hintEl) {
                if (source === 'db') {
                    const rawDesc = ghost.raw_description || ghost.description;
                    if (rawDesc && rawDesc !== val) {
                        hintEl.innerHTML = `🏦 Libellé en ligne (banque) : <span style="color:var(--text-main); font-style:italic;">${window.escapeHtml ? window.escapeHtml(rawDesc) : rawDesc}</span>`;
                    } else {
                        hintEl.innerHTML = '';
                    }
                } else {
                    if (target.description && target.description !== val) {
                        hintEl.innerHTML = `💾 Libellé OmniBank (base) : <span style="color:var(--text-main); font-style:italic;">${window.escapeHtml ? window.escapeHtml(target.description) : target.description}</span>`;
                    } else {
                        hintEl.innerHTML = '';
                    }
                }
            }
        } else if (field === 'amount') {
            const ghostRawAmt = typeof ghost.raw_amount !== 'undefined' ? parseFloat(ghost.raw_amount) : (parseFloat(ghost.amount) || 0);
            const ghostAbsAmt = Math.abs(parseFloat(ghost.amount) || ghostRawAmt || 0);
            const val = source === 'db' ? (parseFloat(target.amount) || 0) : ghostAbsAmt;
            const input = document.getElementById('linkFinalAmount');
            if (input) input.value = val ? val.toFixed(2) : '';
        } else if (field === 'cat') {
            const val = (source === 'db' ? (target.category || '') : (ghost.category || '')).trim();
            const select = document.getElementById('linkFinalCategory');
            if (select) {
                if (val) {
                    let matchingOpt = Array.from(select.options).find(o => o.value.toLowerCase() === val.toLowerCase());
                    if (!matchingOpt) {
                        matchingOpt = document.createElement('option');
                        matchingOpt.value = val;
                        matchingOpt.textContent = val;
                        select.appendChild(matchingOpt);
                    }
                    select.value = matchingOpt.value;
                } else {
                    select.value = '';
                }
            }
        }

        this.updateLinkPillStyles(field, source);
    },

    updateLinkPillStyles(field, source) {
        const activeStyle = 'background: var(--accent, #6366f1); color: #ffffff; border: 1px solid var(--accent, #6366f1); font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;';
        const inactiveStyle = 'background: var(--bg-base); color: var(--text-muted); border: 1px solid var(--border-color); font-weight: 500; padding: 2px 8px; border-radius: 4px; font-size: 11px; cursor: pointer;';

        const capField = field.charAt(0).toUpperCase() + field.slice(1);
        const pillDb = document.getElementById(`linkPill${capField}Db`);
        const pillOnline = document.getElementById(`linkPill${capField}Online`);

        if (pillDb) pillDb.style.cssText = source === 'db' ? activeStyle : inactiveStyle;
        if (pillOnline) pillOnline.style.cssText = source === 'online' ? activeStyle : inactiveStyle;
    },

    async submitGhostLink() {
        const ghost = this._linkGhostCurrentGhost;
        const target = this._linkGhostSelectedTarget;
        if (!ghost || !target) return;

        const btnSubmit = document.getElementById('btnSubmitLinkGhost');
        if (btnSubmit) btnSubmit.disabled = true;

        const finalDesc = document.getElementById('linkFinalDesc')?.value || target.description;
        const finalAmount = parseFloat(document.getElementById('linkFinalAmount')?.value) || target.amount;
        const finalCat = document.getElementById('linkFinalCategory')?.value || null;

        // ── MODE REVIEW : modification en RAM uniquement ──
        if (this._linkFromReviewContext) {
            const ctx = this._linkFromReviewContext;
            const acc = this.previewData?.accounts?.[ctx.accountIndex];
            const tx = acc?.transactions?.find(t => t.csv_id === ctx.csvId);

            if (tx) {
                tx.is_reconciled = true;
                tx.already_reconciled = false;
                tx.matched_db_id = target.id;
                tx.db_description = target.description;
                tx.description = finalDesc;
                tx.amount = finalAmount;
                tx.category = finalCat;
                tx.is_mirror_transfer = false;
                tx.is_orphan_transfer_link = false;

                // Persister le lien forcé (survit au F5 et au re-evaluate)
                if (this.activeConnId) {
                    this.addForceMatch(this.activeConnId, ctx.csvId, target.id);
                    this.saveCachedPreview(this.activeConnId, this.previewData);
                }
            }

            this._linkFromReviewContext = null;
            this.closeLinkGhostModal();
            this.renderReviewTable();
            const successMsg = window.i18n ? window.i18n.t('bank_sync_relink_review_success') || 'Opération liée avec succès !' : 'Opération liée avec succès !';
            this.showToast(successMsg, 'success');
            return;
        }

        const isComing = !!ghost.is_coming;
        const finalReconDate = document.getElementById('linkFinalReconDate')?.value || (isComing ? '' : new Date().toISOString().split('T')[0]);

        try {
            const res = await API.post('/api/bank-sync/link-ghost', {
                csv_id: ghost.csv_id,
                target_tx_id: target.id,
                description: finalDesc,
                amount: finalAmount,
                category: finalCat,
                is_coming: isComing,
                reconciliation_date: finalReconDate || null
            });

            this.closeLinkGhostModal();
            this.ghostTransactions = this.ghostTransactions.filter(g => g.csv_id !== ghost.csv_id);

            // Propager le highlight pour la ligne ciblée modifiée/rapprochée
            if (window.TimelineView) window.TimelineView._pendingHighlightTxId = target.id;
            if (window.AllOperationsView) window.AllOperationsView._pendingHighlightTxId = target.id;
            if (window.OverviewView) window.OverviewView._pendingHighlightTxId = target.id;

            const successMsg = isComing
                ? (window.i18n ? window.i18n.t('ghost_link_coming_success') || 'Opération liée avec succès (en attente banque)' : 'Opération liée avec succès (en attente banque)')
                : (window.i18n ? window.i18n.t('ghost_link_success') || 'Opération liée et rapprochée avec succès !' : 'Opération liée et rapprochée avec succès !');
            this.showToast(successMsg, 'success');

            await this.refreshActiveViews(target.id);
        } catch (err) {
            console.error('[BankSync] Erreur liaison ghost:', err);
            if (btnSubmit) btnSubmit.disabled = false;
            this.showToast('Erreur lors de la liaison : ' + (err.detail || err.message), 'error');
        }
    }
});

