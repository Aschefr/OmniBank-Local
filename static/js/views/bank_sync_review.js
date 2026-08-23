// static/js/views/bank_sync_review.js — Modale de revue des opérations
// Enrichit window.BankSyncView via Object.assign()

Object.assign(window.BankSyncView, {

    async openReviewModal(connId, previewData) {
        this.ensureModalsExist();
        if (!window.app?.categoriesList || window.app.categoriesList.length === 0) {
            try {
                window.app.categoriesList = await API.get('/api/categories/');
            } catch (_) {
                window.app.categoriesList = [];
            }
        }
        this.activeConnId = connId;

        // 0. Re-calcule dynamiquement en direct le rapprochement par rapport à l'état actuel de la base SQLite
        if (previewData && previewData.accounts && previewData.accounts.length > 0) {
            try {
                const refreshed = await API.post('/api/bank-sync/re-evaluate-preview', previewData);
                if (refreshed && refreshed.accounts) {
                    previewData = refreshed;
                    if (connId) {
                        this.saveCachedPreview(connId, previewData);
                    }
                }
            } catch (e) {
                console.warn('[BankSync] Erreur re-évaluation temps réel du preview:', e);
            }
        }

        this.previewData = previewData;
        this.currentAccountIndex = 0;
        this.currentFilter = 'all';

        // 1. Résolution proactive Smart Label pour garantir l'application des règles et la conservation du nom brut
        try {
            const unrecTxs = [];
            (this.previewData?.accounts || []).forEach(acc => {
                (acc.transactions || []).forEach(t => {
                    if (!t.is_reconciled) {
                        unrecTxs.push(t);
                    }
                });
            });

            if (unrecTxs.length > 0) {
                const rawLabels = Array.from(new Set(unrecTxs.map(t => t.raw_description || t.description)));
                const smartRes = await API.post('/api/smart-labels/resolve-batch', { labels: rawLabels });
                if (smartRes && smartRes.results) {
                    unrecTxs.forEach(t => {
                        const raw = t.raw_description || t.description;
                        t.raw_description = raw;
                        if (smartRes.results[raw]) {
                            const r = smartRes.results[raw];
                            if (r.source === 'rule' || r.source === 'history') {
                                t.description = r.description;
                                if (r.category && !t.category) {
                                    t.category = r.category;
                                }
                                t.smart_suggested = true;
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[BankSync] Erreur smart label resolve dans review modal:', e);
        }

        const modal = document.getElementById('bankSyncReviewModal');
        if (modal) modal.style.display = 'flex';

        // Adapter la visibilité du bouton IA global selon paramètre enable_ai
        const aiBtn = document.getElementById('btnSyncCategorizeAllAI');
        if (aiBtn) {
            aiBtn.style.display = this.isAIEnabled() ? 'inline-flex' : 'none';
        }

        this.renderAccountTabs();
        this.renderReviewTable();
    },

    closeReviewModal() {
        document.getElementById('bankSyncReviewModal').style.display = 'none';
        this.previewData = null;
    },

    renderAccountTabs() {
        const container = document.getElementById('reviewAccountTabs');
        if (!container || !this.previewData || !this.previewData.accounts) return;

        const accs = this.previewData.accounts;
        if (accs.length <= 1) {
            container.innerHTML = `<span style="font-weight: 700; font-size: 13px; color: var(--text-main);">${accs[0]?.account_name || 'Compte'}</span>`;
            return;
        }

        container.innerHTML = accs.map((acc, idx) => `
            <button class="btn btn-sm ${idx === this.currentAccountIndex ? 'btn-primary' : 'btn-secondary'}" 
                    onclick="window.BankSyncView.switchAccountTab(${idx})" 
                    style="padding: 4px 12px; font-size: 12px; border-radius: 8px;">
                ${acc.account_name} (${acc.transactions?.length || 0})
            </button>
        `).join('');
    },

    switchAccountTab(idx) {
        this.currentAccountIndex = idx;
        this.renderAccountTabs();
        this.renderReviewTable();
    },

    setReviewFilter(filter) {
        this.currentFilter = filter;

        ['btnSyncFilterAll', 'btnSyncFilterAdd', 'btnSyncFilterReconcile', 'btnSyncFilterComing', 'btnSyncFilterIgnored'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.background = 'transparent';
                btn.style.borderColor = 'var(--border-color)';
                btn.style.color = 'var(--text-muted)';
            }
        });

        const activeMap = {
            'all': 'btnSyncFilterAll',
            'add': 'btnSyncFilterAdd',
            'reconcile': 'btnSyncFilterReconcile',
            'coming': 'btnSyncFilterComing',
            'ignored': 'btnSyncFilterIgnored'
        };
        const activeBtn = document.getElementById(activeMap[filter]);
        if (activeBtn) {
            activeBtn.style.background = filter === 'coming' ? '#d97706' : 'var(--accent)';
            activeBtn.style.borderColor = filter === 'coming' ? '#d97706' : 'var(--accent)';
            activeBtn.style.color = 'white';
        }

        this.renderReviewTable();
    },

    renderReviewTable() {
        const tbody = document.getElementById('bankSyncReviewBody');
        if (!tbody || !this.previewData || !this.previewData.accounts) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_transactions')}</td></tr>`;
            return;
        }

        const bankBal = (typeof currentAcc.bank_balance === 'number') ? currentAcc.bank_balance : null;
        const localBal = (typeof currentAcc.local_reconciled_balance === 'number') ? currentAcc.local_reconciled_balance : null;
        const delta = (bankBal !== null && localBal !== null) ? Math.round((bankBal - localBal) * 100) / 100 : null;

        const txs = currentAcc.transactions;
        const categories = window.app?.categoriesList || [];
        const aiEnabled = this.isAIEnabled();

        // Identifier les opérations qui résolvent l'écart
        txs.forEach(tx => {
            tx._resolves_diff = false;
            if (!tx.is_reconciled && delta !== null && Math.abs(delta) >= 0.005) {
                const rawAmt = typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0);
                if (Math.abs(rawAmt - delta) < 0.005) {
                    tx._resolves_diff = true;
                }
            }
        });

        let visibleTxs = txs.filter(tx => {
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'coming') return !!tx.is_coming;
            if (this.currentFilter === 'ignored') return (tx.is_reconciled && tx.already_reconciled && !tx.is_coming);
            if (this.currentFilter === 'reconcile') return (tx.is_reconciled && !tx.already_reconciled && !tx.is_coming);
            if (this.currentFilter === 'add') return (!tx.is_reconciled && !tx.is_coming);
            return true;
        });

        // Tri chronologique décroissant (les opérations les plus récentes en haut)
        visibleTxs.sort((a, b) => (b.date_operation || '').localeCompare(a.date_operation || ''));

        if (visibleTxs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_transactions_filter')}</td></tr>`;
            this.updateReviewSummary();
            return;
        }

        const lblInDb = window.i18n.t('bank_sync_in_db') || 'En base :';
        const lblAutoCat = window.i18n.t('bank_sync_auto_cat') || '(Automatique)';
        const lblSelectCat = window.i18n.t('bank_sync_select_category') || '-- Catégorie --';
        const lblIgnoreRow = window.i18n.t('bank_sync_ignore_row_tooltip') || 'Ignorer cette ligne';

        tbody.innerHTML = visibleTxs.map((tx) => {
            const isRec = tx.is_reconciled;
            const alreadyRec = tx.already_reconciled;

            let statusBadge = '';
            let actionText = '';
            let actionColor = '';

            const resolvesBadge = tx._resolves_diff
                ? `<span class="badge resolves-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_resolves_diff_tooltip') : 'La validation de cette opération permettra d\'aligner le solde OmniBank sur celui de la banque.').replace(/"/g, '&quot;')}">🎯 ${window.i18n ? window.i18n.t('bank_sync_resolves_diff') : 'Résout l\'écart'}</span>`
                : '';

            if (isRec && tx.is_orphan_transfer_link) {
                const targetName = tx.orphan_account_name || 'autre compte';
                const badgeLabel = window.i18n.t('bank_sync_orphan_transfer_badge') || 'Liaison virement';
                const badgeTip = (window.i18n.t('bank_sync_orphan_transfer_tooltip') || 'Une écriture isolée du même montant existe déjà sur un autre compte. La validation fusionnera ces écritures en un virement interne sans créer de doublon.').replace(/"/g, '&quot;');
                statusBadge = `<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.3); font-weight: 700; cursor: help;" title="${badgeTip}">🔗 ${badgeLabel}</span>${resolvesBadge}`;
                actionText = (window.i18n.tp ? window.i18n.tp('bank_sync_orphan_transfer_action', { account: targetName }) : `Lier au compte ${targetName}`);
                actionColor = `color: #8b5cf6; font-weight: 600;`;
            } else if (isRec && alreadyRec) {
                if (tx.is_mirror_transfer) {
                    const badgeLabel = window.i18n.t('bank_sync_mirror_transfer_badge') || 'Virement miroir';
                    const badgeTip = (window.i18n.t('bank_sync_mirror_transfer_tooltip') || 'Écriture miroir d\'un virement interne déjà enregistré.').replace(/"/g, '&quot;');
                    statusBadge = `<span class="badge" style="background:rgba(99,102,241,0.12); color:var(--accent); border:1px solid rgba(99,102,241,0.3); cursor:help; display:inline-flex; align-items:center; gap:4px;" title="${badgeTip}"><span>🔗 ${badgeLabel}</span> <span style="font-size:11px; opacity:0.8;">ℹ️</span></span>`;
                    actionText = window.i18n.t('bank_sync_mirror_transfer_action') || 'Ignorée (miroir de virement)';
                    actionColor = `color: var(--text-muted);`;
                } else if (tx.is_coming) {
                    const badgeLabel = window.i18n.t('bank_sync_discrepancy_badge') || 'Pointée / En attente banque';
                    const badgeTip = (window.i18n.t('bank_sync_discrepancy_tooltip') || 'Cette opération a déjà été pointée dans OmniBank, mais la banque l\'affiche encore dans ses opérations en attente / autorisations.').replace(/"/g, '&quot;');
                    statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700; cursor: help; display:inline-flex; align-items:center; gap:4px;" title="${badgeTip}"><span>⏳ ${badgeLabel}</span></span>`;
                    actionText = window.i18n.t('bank_sync_discrepancy_action') || 'Ignorée (déjà pointée en local)';
                    actionColor = `color: #d97706; font-weight: 500;`;
                } else {
                    const alreadyLabel = window.i18n.t('bank_sync_status_already_reconciled') || '✅ Déjà pointée';
                    statusBadge = `<span class="badge" style="background:var(--bg-surface); color:var(--text-muted); border:1px solid var(--border-color);">${alreadyLabel}</span>`;
                    actionText = window.i18n.t('bank_sync_action_ignored_duplicate') || 'Ignorée (doublon)';
                    actionColor = `color: var(--text-muted);`;
                }
            } else if (isRec && !alreadyRec) {
                if (tx.is_coming) {
                    const badgeLabel = window.i18n.t('bank_sync_coming_to_reconcile') || '⏳ En attente (À pointer)';
                    const badgeTip = (window.i18n.t('bank_sync_coming_to_reconcile_tooltip') || 'Opération en attente banque correspondant à une opération locale non encore pointée.').replace(/"/g, '&quot;');
                    statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); font-weight: 700; cursor: help; display:inline-flex; align-items:center; gap:4px;" title="${badgeTip}"><span>${badgeLabel}</span></span>${resolvesBadge}`;
                    actionText = window.i18n.t('bank_sync_action_will_reconcile') || 'Sera pointée';
                    actionColor = `color: var(--color-income, #10b981);`;
                } else {
                    const reconLabel = window.i18n.t('bank_sync_status_to_reconcile') || '⚡ À pointer';
                    statusBadge = `<span class="badge" style="background:var(--color-income, #10b981); color:white;">${reconLabel}</span>${resolvesBadge}`;
                    actionText = window.i18n.t('bank_sync_action_will_reconcile') || 'Sera pointée';
                    actionColor = `color: var(--color-income, #10b981);`;
                }
            } else if (!isRec && tx.is_coming) {
                const badgeLabel = window.i18n.t('bank_sync_coming_new') || '⏳ En attente (Nouvelle)';
                statusBadge = `<span class="badge" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.3); font-weight: 700; display:inline-flex; align-items:center; gap:4px;"><span>${badgeLabel}</span></span>${resolvesBadge}`;
                actionText = window.i18n.t('bank_sync_coming_action') || 'Nouvelle (non encore débitée)';
                actionColor = `color: #6366f1;`;
            } else {
                const newLabel = window.i18n.t('bank_sync_status_to_add') || '🆕 Nouvelle opération';
                statusBadge = `<span class="badge" style="background:var(--color-expense, #6366f1); color:white;">${newLabel}</span>${resolvesBadge}`;
                actionText = window.i18n.t('bank_sync_action_new_operation') || 'Nouvelle opération';
                actionColor = `color: var(--color-expense, #6366f1);`;
            }

            const showRaw = tx.raw_description && tx.raw_description !== tx.description;
            const tipSuggested = (window.i18n ? window.i18n.t('smart_label_suggested_tooltip') || window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique / règles' : 'Suggéré d’après votre historique / règles').replace(/"/g, '&quot;');
            const rawSubHtml = showRaw 
                ? `<div style="font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 3px; font-weight: normal; opacity: 0.85; display: flex; align-items: center; gap: 4px;"><span>🏛️</span> <span>${window.escapeHtml ? window.escapeHtml(tx.raw_description) : tx.raw_description}</span> ${tx.smart_suggested ? `<span title="${tipSuggested}" style="cursor:help; font-size:11px;">💡</span>` : ''}</div>` 
                : '';
            const dbDesc = (tx.db_description && tx.db_description !== tx.description) 
                ? `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 3px;">${lblInDb} ${window.escapeHtml ? window.escapeHtml(tx.db_description) : tx.db_description}</div>` 
                : '';

            const descInput = isRec 
                ? `${dbDesc}<input type="text" class="sync-desc input-styled" value="${(tx.description || '').replace(/"/g, '&quot;')}" style="width: 100%; border: 1px solid transparent; background: transparent; padding: 4px; color: var(--text-muted);" readonly>${rawSubHtml}` 
                : `${dbDesc}<input type="text" class="sync-desc input-styled" value="${(tx.description || '').replace(/"/g, '&quot;')}" style="width: 100%; padding: 4px;" onchange="window.BankSyncView.updateTxDesc(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">${rawSubHtml}`;

            const catOptions = `<option value="">${lblSelectCat}</option>` + categories.filter(c => !c.is_closed).map(c => 
                `<option value="${c.name.replace(/"/g, '&quot;')}" ${tx.category === c.name ? 'selected' : ''}>${c.name}</option>`
            ).join('');

            const aiButtonHtml = (!isRec && aiEnabled) ? `
                <button class="btn btn-secondary" style="padding: 3px 6px; font-size: 11px; border-radius: 6px;" onclick="window.BankSyncView.categorizeRowAI('${tx.csv_id}', this)" title="${window.i18n.t('bank_categorize_ai_tooltip')}">🧠</button>
            ` : '';

            const catSelect = isRec 
                ? `<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">${lblAutoCat}</span>`
                : `
                <div style="display: flex; gap: 4px; align-items: center;">
                    <select class="input-styled sync-cat" id="catSel_${tx.csv_id}" style="flex: 1; padding: 4px;" onchange="window.BankSyncView.updateTxCat(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">
                        ${catOptions}
                    </select>
                    ${aiButtonHtml}
                </div>
                `;

            const amountColor = (tx.raw_amount < 0) ? '#ef4444' : '#10b981';
            const amountInput = isRec 
                ? `<span style="font-weight: 700; color: ${amountColor};">${(tx.raw_amount < 0 ? '-' : '+')} ${tx.amount.toFixed(2)} €</span>`
                : `<input type="number" step="0.01" class="input-styled" value="${tx.amount.toFixed(2)}" style="width: 80px; text-align: right; padding: 4px; font-weight: 700; color: ${amountColor};" onchange="window.BankSyncView.updateTxAmount(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">`;

            let rowStyle = 'border-bottom: 1px solid var(--border-color);';
            if (tx.is_coming) {
                rowStyle += ' background: rgba(245, 158, 11, 0.05); border-left: 3px solid #f59e0b;';
            } else if (alreadyRec) {
                rowStyle += ' opacity: 0.6;';
            }

            const comingDateIcon = tx.is_coming 
                ? `<span title="${(window.i18n ? window.i18n.t('bank_sync_coming_badge') : 'Opération à venir / En attente banque').replace(/"/g, '&quot;')}" style="color: #f59e0b; font-weight: 700; margin-right: 4px; cursor: help;">⏳</span>` 
                : '';

            return `
            <tr id="syncRow_${tx.csv_id}" style="${rowStyle}">
                <td style="padding: 10px 14px; white-space: nowrap;">
                    ${comingDateIcon}<input type="date" class="input-styled sync-date" value="${tx.date_operation}" style="width: 120px; padding: 4px;" ${isRec ? 'disabled' : ''} onchange="window.BankSyncView.updateTxDate(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">
                </td>
                <td style="padding: 10px 14px;">${descInput}</td>
                <td style="padding: 10px 14px;">${catSelect}</td>
                <td style="padding: 10px 14px; text-align: right;">
                    ${amountInput}
                </td>
                <td style="padding: 10px 14px; text-align: center;">${statusBadge}</td>
                <td style="padding: 10px 14px;">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px;">
                        <span style="font-size: 11px; ${actionColor}">${actionText}</span>
                        <button class="btn btn-secondary" style="padding: 4px 8px; color: #ef4444; border: 1px solid var(--border-color); border-radius: 6px;" onclick="window.BankSyncView.removeTxRow('${tx.csv_id}')" title="${lblIgnoreRow}">✕</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        this.updateReviewSummary();
    },

    updateTxDesc(accIdx, csvId, newDesc) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.description = newDesc;
    },

    updateTxCat(accIdx, csvId, newCat) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.category = newCat || null;
    },

    updateTxDate(accIdx, csvId, newDate) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.date_operation = newDate;
    },

    updateTxAmount(accIdx, csvId, newAmt) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) {
            const val = parseFloat(newAmt) || 0;
            tx.amount = Math.abs(val);
            tx.raw_amount = tx.raw_amount < 0 ? -Math.abs(val) : Math.abs(val);
        }
    },

    removeTxRow(csvId) {
        if (!this.previewData) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (currentAcc) {
            currentAcc.transactions = currentAcc.transactions.filter(t => t.csv_id !== csvId);
            this.renderReviewTable();
        }
    },

    // ── AUTO-CATÉGORISATION IA (Conditionnelle) ──────────────────────
    async categorizeRowAI(csvId, btnEl) {
        if (!this.isAIEnabled()) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        const tx = currentAcc?.transactions.find(t => t.csv_id === csvId);
        if (!tx) return;

        const originalText = btnEl.innerText;
        btnEl.innerText = '⏳';
        btnEl.disabled = true;

        try {
            const res = await API.post('/api/ai/categorize', { description: tx.description });
            if (res && res.category) {
                tx.category = res.category;
                const sel = document.getElementById(`catSel_${csvId}`);
                if (sel) sel.value = res.category;
                this.showToast(`Catégorie suggérée : ${res.category}`, 'success');
            }
        } catch (err) {
            this.showToast('Erreur IA : ' + (err.detail || err.message), 'error');
        } finally {
            btnEl.innerText = originalText;
            btnEl.disabled = false;
        }
    },

    async categorizeAllNewAI() {
        if (!this.isAIEnabled() || !this.previewData) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) return;

        const uncatTxs = currentAcc.transactions.filter(t => !t.is_reconciled && !t.category);
        if (uncatTxs.length === 0) {
            this.showToast('Toutes les nouvelles opérations sont déjà catégorisées.', 'info');
            return;
        }

        const btn = document.getElementById('btnSyncCategorizeAllAI');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> <span>Catégorisation IA en cours...</span>';
        }

        try {
            const descriptions = uncatTxs.map(t => t.description);
            const res = await API.post('/api/ai/categorize_batch', { descriptions });
            if (res && res.categories) {
                uncatTxs.forEach((tx, idx) => {
                    const assigned = res.categories[idx];
                    if (assigned) {
                        tx.category = assigned;
                    }
                });
                this.renderReviewTable();
                this.showToast(`${uncatTxs.length} opération(s) catégorisée(s) par l'IA !`, 'success');
            }
        } catch (err) {
            this.showToast('Erreur catégorisation IA en lot : ' + (err.detail || err.message), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>✨</span> <span>${window.i18n.t('bank_categorize_all_ai')}</span>`;
            }
        }
    },

    updateReviewSummary() {
        const box = document.getElementById('reviewSummaryBox');
        if (!box || !this.previewData || !this.previewData.accounts) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        const currentTxs = currentAcc?.transactions || [];

        // Compteurs pour le compte actuellement affiché
        let accNew = 0;
        let accReconciled = 0;
        let accComing = 0;
        let accIgnored = 0;
        let accComingAmount = 0.0;

        currentTxs.forEach(tx => {
            if (tx.is_coming) {
                accComing++;
                const rawAmt = typeof tx.raw_amount !== 'undefined' ? parseFloat(tx.raw_amount) : (parseFloat(tx.amount) || 0);
                accComingAmount += rawAmt;
            } else if (tx.is_reconciled && tx.already_reconciled) {
                accIgnored++;
            } else if (tx.is_reconciled) {
                accReconciled++;
            } else {
                accNew++;
            }
        });

        // Mise à jour dynamique des boutons de filtre avec les compteurs
        const btnAll = document.getElementById('btnSyncFilterAll');
        const btnAdd = document.getElementById('btnSyncFilterAdd');
        const btnRec = document.getElementById('btnSyncFilterReconcile');
        const btnComing = document.getElementById('btnSyncFilterComing');
        const btnIgnored = document.getElementById('btnSyncFilterIgnored');

        const lblAll = (window.i18n && window.i18n.t('bank_sync_filter_all')) || 'Toutes';
        const lblAdd = (window.i18n && window.i18n.t('bank_sync_filter_add')) || 'À ajouter';
        const lblRec = (window.i18n && window.i18n.t('bank_sync_filter_reconcile')) || 'À rapprocher';
        const lblComing = (window.i18n && window.i18n.t('bank_sync_filter_coming')) || 'En attente en ligne';
        const lblIgnored = (window.i18n && window.i18n.t('bank_sync_status_already_processed_short')) || 'Déjà traitées';

        if (btnAll) btnAll.textContent = `${lblAll} (${currentTxs.length})`;
        if (btnAdd) btnAdd.textContent = `${lblAdd} (+${accNew})`;
        if (btnRec) btnRec.textContent = `${lblRec} (${accReconciled})`;
        if (btnComing) {
            btnComing.textContent = `⏳ ${lblComing} (${accComing})`;
            btnComing.style.display = accComing > 0 ? 'inline-block' : 'none';
        }
        if (btnIgnored) btnIgnored.textContent = `${lblIgnored} (${accIgnored})`;

        // Compteurs globaux pour le résumé
        let totalNew = 0;
        let totalReconciled = 0;
        let totalComing = 0;
        let totalIgnored = 0;

        this.previewData.accounts.forEach(acc => {
            (acc.transactions || []).forEach(tx => {
                if (tx.is_coming) {
                    totalComing++;
                } else if (tx.is_reconciled && tx.already_reconciled) {
                    totalIgnored++;
                } else if (tx.is_reconciled) {
                    totalReconciled++;
                } else {
                    totalNew++;
                }
            });
        });

        const toAddStr = window.i18n.tp('bank_sync_summary_to_add', { count: totalNew });
        const toRecStr = window.i18n.tp('bank_sync_summary_to_reconcile', { count: totalReconciled });
        const comingStr = window.i18n.tp ? window.i18n.tp('bank_sync_summary_coming', { count: totalComing }) : `${totalComing} en attente en ligne`;
        const ignoredStr = (window.i18n.tp ? window.i18n.tp('bank_sync_summary_ignored', { count: totalIgnored }) : `${totalIgnored} déjà en base`).replace(/\(déjà en base\)/i, '(déjà traitées)');

        let balanceBadgeHtml = '';
        if (currentAcc && typeof currentAcc.bank_balance === 'number' && typeof currentAcc.local_reconciled_balance === 'number') {
            const delta = Math.round((currentAcc.bank_balance - currentAcc.local_reconciled_balance) * 100) / 100;
            if (Math.abs(delta) < 0.005) {
                balanceBadgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_balance_tooltip_synced') : 'Soldes conformes').replace(/"/g, '&quot;')}">🟢 ${window.i18n ? window.i18n.t('bank_sync_balance_synced') || 'Soldes conformes' : 'Soldes conformes'} (${currentAcc.bank_balance.toFixed(2)} €)</span>`;
            } else {
                const diffFormatted = (delta > 0 ? '+' : '') + delta.toFixed(2) + ' €';
                const isExplainedByComing = accComing > 0 && Math.abs(Math.abs(accComingAmount) - Math.abs(delta)) < 0.01;

                const explanationText = isExplainedByComing
                    ? ` • 💡 ${window.i18n ? window.i18n.tp('bank_sync_delta_explained_by_coming', { count: accComing }) : `Correspond aux ${accComing} opération(s) en attente en ligne.`}`
                    : '';

                const deltaTip = isExplainedByComing
                    ? (window.i18n ? window.i18n.tp('bank_sync_delta_explained_by_coming', { count: accComing }) : `L'écart de ${diffFormatted} s'explique par les opérations en attente de débit par la banque.`).replace(/"/g, '&quot;')
                    : (window.i18n ? window.i18n.t('bank_sync_balance_tooltip_diff') : 'Écart de solde').replace(/"/g, '&quot;');

                balanceBadgeHtml = `<span class="badge" style="background: ${isExplainedByComing ? 'rgba(245, 158, 11, 0.12)' : 'rgba(239, 68, 68, 0.12)'}; color: ${isExplainedByComing ? '#d97706' : '#ef4444'}; border: 1px solid ${isExplainedByComing ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.3)'}; font-weight: 700; padding: 3px 10px; border-radius: 6px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 4px;" title="${deltaTip}"><span>⚠️ ${window.i18n ? window.i18n.t('bank_sync_balance_diff') || 'Écart' : 'Écart'} : ${diffFormatted} (Banque: ${currentAcc.bank_balance.toFixed(2)} € • Pointé: ${currentAcc.local_reconciled_balance.toFixed(2)} €)${explanationText}</span></span>`;
            }
        }

        box.innerHTML = `
            <span>🟢 <strong>${toAddStr}</strong></span>
            <span>🔵 <strong>${toRecStr}</strong></span>
            ${totalComing > 0 ? `<span style="color: #d97706; cursor: pointer;" onclick="window.BankSyncView.setReviewFilter('coming')" title="Filtrer les opérations en attente">⏳ <strong>${comingStr}</strong></span>` : ''}
            <span style="color: var(--text-muted);">⚪ <strong>${ignoredStr}</strong></span>
            ${balanceBadgeHtml ? `<span style="border-left: 1px solid var(--border-color); padding-left: 12px; margin-left: 4px;">${balanceBadgeHtml}</span>` : ''}
        `;
    },

    async commitSync() {
        if (!this.previewData || !this.activeConnId) return;

        const allTxs = [];
        this.previewData.accounts.forEach(acc => {
            (acc.transactions || []).forEach(tx => {
                allTxs.push({
                    account_id: acc.account_id,
                    date_operation: tx.date_operation,
                    description: tx.description,
                    raw_description: tx.raw_description || tx.description,
                    amount: tx.amount,
                    raw_amount: tx.raw_amount,
                    category: tx.category,
                    csv_id: tx.csv_id,
                    is_reconciled: tx.is_reconciled,
                    already_reconciled: tx.already_reconciled,
                    matched_db_id: tx.matched_db_id
                });
            });
        });

        try {
            const res = await API.post(`/api/bank-sync/connections/${this.activeConnId}/commit`, {
                transactions: allTxs
            });

            this.closeReviewModal();
            this.showToast(`Synchronisation validée : +${res.imported} ajoutée(s), ✔ ${res.reconciled} pointée(s)`, 'success');
            await this.loadConnections();
            await this.loadPendingSync();

            if (window.OverviewView && window.OverviewView.init) {
                window.OverviewView.init();
            }
            if (window.AccountsView && window.AccountsView.loadData) {
                window.AccountsView.loadData();
            }
            if (window.TimelineView && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
            if (window.AllOperationsView && window.AllOperationsView.loadData) {
                window.AllOperationsView.loadData();
            }
            if (window.app && window.app.refreshSidebar) {
                window.app.refreshSidebar();
            }
        } catch (err) {
            this.showToast('Erreur lors de la validation : ' + (err.detail || err.message), 'error');
        }
    },

});
