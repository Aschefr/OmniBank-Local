window.ImportWizard = {
    selectedFile: null,
    fileBalance: null,
    descriptions: {},

    async loadDescriptions() {
        try {
            this.descriptions = await API.get('/api/transactions/descriptions');
            const dataList = document.getElementById('importDescList');
            if (dataList) {
                dataList.innerHTML = Object.keys(this.descriptions).map(d => `<option value="${d}">`).join('');
            }
        } catch (e) {
            console.error('Failed to load descriptions', e);
        }
    },

    onDescriptionInput(input) {
        const desc = input.value;
        if (this.descriptions && this.descriptions[desc]) {
            const data = this.descriptions[desc];
            if (data.category) {
                const tr = input.closest('tr');
                if (tr) {
                    const catSelect = tr.querySelector('.import-cat');
                    if (catSelect) {
                        catSelect.value = data.category;
                    }
                }
            }
        }
    },

    open() {
        if (this._pendingAIResult) {
            this._openWithPendingAI();
            return;
        }
        // If AI analysis is in progress, re-open modal with loading view
        if (this._aiAbortController && !this._aiAborted) {
            this._aiDismissed = false;
            document.getElementById('importDataModal').style.display = 'flex';
            return;
        }
        document.getElementById('globalCsvFileInput').click();
    },

    // ── Adaptateur CSV → previewData → Cockpit Unifié ──────────────────
    openReviewFromCSV(result, accountId) {
        let previewData;
        if (result.accounts && Array.isArray(result.accounts)) {
            // Nouveau format multi-comptes direct depuis /import_to_pending
            previewData = {
                _source: 'csv_import',
                _csvAlerts: result._csvAlerts || {},
                _fileBalance: result._fileBalance || null,
                accounts: result.accounts
            };
        } else {
            // Ancien format mono-compte (fallback / AI import)
            const txs = result.transactions || [];
            const acc = (window.app?.accounts || []).find(a => a.id == accountId);
            const accName = acc ? acc.name : 'Compte';

            // Transformer chaque ligne CSV en format cockpit
            const cockpitTxs = txs.map((tx, i) => {
                const rawAmt = parseFloat(tx.amount || 0);
                return {
                    csv_id: tx.csv_id || `csv_import_${i}`,
                    date_operation: tx.date_operation || tx.date || null,
                    description: tx.description || 'Opération importée',
                    raw_description: tx.raw_description || tx.db_description || tx.description || '',
                    db_description: tx.db_description || null,
                    amount: Math.abs(rawAmt),
                    raw_amount: rawAmt,
                    category: tx.category || null,
                    is_reconciled: !!tx.is_reconciled,
                    already_reconciled: !!tx.already_reconciled,
                    matched_db_id: tx.matched_db_id || null,
                    is_coming: false,
                    attachments: tx.attachments || null,
                    check_slip_number: tx.check_slip_number || null,
                    smart_suggested: false
                };
            });

            previewData = {
                _source: 'csv_import',
                _csvAlerts: result.alerts || {},
                _fileBalance: result.file_balance || null,
                accounts: [{
                    account_id: accountId ? parseInt(accountId) : null,
                    account_name: accName,
                    transactions: cockpitTxs,
                    bank_balance: null,
                    local_reconciled_balance: null
                }]
            };
        }

        // Fermer le pré-wizard d'import
        document.getElementById('importDataModal').style.display = 'none';

        // Rafraîchir immédiatement le sas d'attente pour que les opérations fantômes s'affichent
        if (window.BankSyncView && window.BankSyncView.loadPendingSync) {
            window.BankSyncView.loadPendingSync(true);
        }

        // Ouvrir le cockpit unifié avec le preview multi-comptes
        window.BankSyncView.openReviewModal('csv_import', previewData);
    },

    async onFileSelected(event) {
        this.selectedFile = event.target.files[0];
        if (!this.selectedFile) return;
        
        const file = this.selectedFile;
        event.target.value = ''; // reset input so same file can be re-selected if needed

        // Réinitialiser les états et masquer les sous-composants préliminaires
        this.fileBalance = null;
        document.getElementById('importDataTable').style.display = 'none';
        document.getElementById('importDataBody').innerHTML = '';
        const summaryDiv = document.getElementById('importSummaryText');
        if (summaryDiv) summaryDiv.style.display = 'none';
        const alertBox = document.getElementById('importAlertBox');
        if (alertBox) alertBox.style.display = 'none';
        const sectionContainer = document.getElementById('importSectionContainer');
        if (sectionContainer) sectionContainer.style.display = 'none';
        const filtersContainer = document.getElementById('importFiltersContainer');
        if (filtersContainer) filtersContainer.style.display = 'none';
        const saveBtns = document.getElementById('importSaveButtons');
        if (saveBtns) saveBtns.style.display = 'none';
        const analysisBtns = document.getElementById('importAnalysisButtons');
        if (analysisBtns) analysisBtns.style.display = 'none';
        const accSelectBox = document.getElementById('importAccountSelect')?.parentElement;
        if (accSelectBox) accSelectBox.style.display = 'none';

        // Afficher l'indicateur d'analyse
        this.showImportLoading('direct');
        document.getElementById('importDataModal').style.display = 'flex';

        // Ingestion directe multi-comptes dans le Sas d'attente
        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch('/api/csv/import_to_pending', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (res.ok) {
                this.fileBalance = result._fileBalance || result.file_balance || null;
                // Ouvrir immédiatement le cockpit unifié avec tous les comptes et rapprochements
                this.openReviewFromCSV(result);
            } else {
                if (accSelectBox) accSelectBox.style.display = 'flex';
                this.showImportError('direct', result.detail);
            }
        } catch (e) {
            console.error('[ImportWizard] Erreur import_to_pending:', e);
            if (accSelectBox) accSelectBox.style.display = 'flex';
            this.showImportError('direct', window.i18n ? window.i18n.t('msg_network_error') : 'Erreur de communication réseau');
        }
    },

    _setAnalysisButtonsEnabled(enabled) {
        const btns = document.querySelectorAll('#importAnalysisButtons button:not([data-i18n="btn_cancel"]):not([data-i18n="btn_hide"])');
        btns.forEach(btn => { btn.disabled = !enabled; btn.style.opacity = enabled ? '' : '0.5'; });
    },

    showImportLoading(mode) {
        const descEl = document.getElementById('importDataDesc');
        const isAI = mode === 'ai';
        descEl.style.display = 'block';
        descEl.style.color = '';
        descEl.innerHTML = `
            <div class="import-loading-box">
                <div class="import-spinner"></div>
                <div class="import-loading-text">${isAI ? window.i18n.t('msg_ai_analyzing') : window.i18n.t('msg_analyzing')}</div>
                <div class="import-loading-hint">${isAI ? window.i18n.t('msg_ai_analyzing_hint') : window.i18n.t('msg_analyzing_hint')}</div>
            </div>
        `;
        this._setAnalysisButtonsEnabled(false);
        // Show hide button during AI analysis
        const hideBtn = document.getElementById('btnImportHide');
        if (hideBtn) hideBtn.style.display = isAI ? 'inline-block' : 'none';
    },

    showImportError(mode, detail) {
        const descEl = document.getElementById('importDataDesc');
        const isAI = mode === 'ai';
        const tipKey = isAI ? 'msg_ai_error_tip' : 'msg_heuristic_error_tip';
        descEl.style.display = 'block';
        descEl.style.color = '';
        const aiAvailable = window.app && window.app.config && window.app.config.enable_ai === 'true';
        let aiOptionHtml = '';
        if (!isAI && aiAvailable) {
            aiOptionHtml = `
                <div style="margin-top: 12px;">
                    <button class="btn btn-primary" onclick="window.ImportWizard.analyzeAI()" style="font-size: 13px; display: inline-flex; align-items: center; gap: 6px;">
                        <span>🧠</span> <span>${window.i18n ? window.i18n.t('btn_analyze_ai') || 'Essayer l\'Analyse IA' : 'Essayer l\'Analyse IA'}</span>
                    </button>
                </div>
            `;
        }
        descEl.innerHTML = `
            <div class="import-error-box">
                <div class="import-error-title">⚠️ ${isAI ? window.i18n.t('msg_ai_error_title') : window.i18n.t('msg_heuristic_error_title')}</div>
                <div class="import-error-detail">${detail || window.i18n.t('msg_unknown_error')}</div>
                <div class="import-error-tip">💡 ${window.i18n.t(tipKey)}</div>
                ${aiOptionHtml}
            </div>
        `;
        const analysisBtns = document.getElementById('importAnalysisButtons');
        if (analysisBtns) analysisBtns.style.display = 'flex';
        this._setAnalysisButtonsEnabled(true);
    },

    async analyzeHeuristic() {
        if (!this.selectedFile) return;
        
        const formData = new FormData();
        formData.append("file", this.selectedFile);
        
        const accountId = document.getElementById('importAccountSelect')?.value;
        if (accountId) {
            formData.append("account_id", accountId);
        }
        if (this.detectedSections && this.detectedSections.length > 1 && this.recommendedSection) {
            formData.append("section_title", this.recommendedSection);
        }
        
        this.showImportLoading('direct');
        
        try {
            const res = await fetch('/api/csv/import_to_pending', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            if (res.ok) {
                this.fileBalance = result._fileBalance || result.file_balance || null;
                // Déléguer au cockpit unifié
                this.openReviewFromCSV(result, accountId);
            } else {
                this.showImportError('direct', result.detail);
            }
        } catch (e) {
            console.error(e);
            this.showImportError('direct', window.i18n.t('msg_network_error'));
        }
    },
    
    async analyzeAI() {
        if (!this.selectedFile) return;
        
        const formData = new FormData();
        formData.append("file", this.selectedFile);
        
        const accountId = document.getElementById('importAccountSelect')?.value;
        if (accountId) {
            formData.append("account_id", accountId);
        }
        if (this.detectedSections && this.detectedSections.length > 1 && this.recommendedSection) {
            formData.append("section_title", this.recommendedSection);
        }
        
        this.showImportLoading('ai');
        this._aiDismissed = false;
        this._aiAborted = false;
        this._aiAbortController = new AbortController();
        this._setImportBtnState('working');
        
        // Auto-hide modal after 5s if still open
        this._bgTimer = setTimeout(() => {
            const modal = document.getElementById('importDataModal');
            if (modal && modal.style.display !== 'none' && !this._aiAborted) {
                this.hideImportModal();
            }
        }, 5000);
        
        try {
            const res = await fetch('/api/ai/import_csv', { 
                method: 'POST',
                body: formData,
                signal: this._aiAbortController.signal
            });
            const result = await res.json();
            
            if (res.ok) {
                if (this._aiDismissed) {
                    this._pendingAIResult = result;
                    this._pendingAIAccountId = document.getElementById('importAccountSelect')?.value;
                    this._setImportBtnState('ready');
                    showToast(window.i18n.t('msg_ai_ready'), 'success', 8000);
                    if (window.BankSyncView && window.BankSyncView.loadPendingSync) {
                        window.BankSyncView.loadPendingSync(true);
                    }
                } else {
                    this._setImportBtnState('idle');
                    this.fileBalance = result.file_balance || null;
                    // Déléguer au cockpit unifié
                    const accountId = document.getElementById('importAccountSelect')?.value;
                    this.openReviewFromCSV(result, accountId);
                }
            } else {
                this._setImportBtnState('idle');
                if (this._aiDismissed) {
                    showToast(window.i18n.t('msg_ai_error_title') + ' : ' + (result.detail || ''), 'error', 6000);
                } else {
                    this.showImportError('ai', result.detail);
                }
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                // User cancelled — no action needed
                return;
            }
            console.error(e);
            this._setImportBtnState('idle');
            if (this._aiDismissed) {
                showToast(window.i18n.t('msg_ai_error_title'), 'error', 5000);
            } else {
                this.showImportError('ai', window.i18n.t('msg_ai_network_error'));
            }
        } finally {
            clearTimeout(this._bgTimer);
            this._aiAbortController = null;
            const hideBtn = document.getElementById('btnImportHide');
            if (hideBtn) hideBtn.style.display = 'none';
        }
    },

    cancelAI() {
        clearTimeout(this._bgTimer);
        if (this._aiAbortController) {
            this._aiAborted = true;
            this._aiAbortController.abort();
            this._aiAbortController = null;
        }
        this._setImportBtnState('idle');
        this._pendingAIResult = null;
        const hideBtn = document.getElementById('btnImportHide');
        if (hideBtn) hideBtn.style.display = 'none';
        document.getElementById('importDataModal').style.display = 'none';
    },

    hideImportModal() {
        this._aiDismissed = true;
        document.getElementById('importDataModal').style.display = 'none';
        if (!this._aiAborted) {
            showToast(window.i18n.t('msg_ai_background'), 'info', 5000);
        }
    },

    _setImportBtnState(state) {
        const btn = document.getElementById('btnImportStatement');
        if (!btn) return;
        btn.classList.remove('btn-ai-working', 'btn-ai-ready');
        if (state === 'working') {
            btn.classList.add('btn-ai-working');
        } else if (state === 'ready') {
            btn.classList.add('btn-ai-ready');
        }
    },

    async _openWithPendingAI() {
        const result = this._pendingAIResult;
        if (!result) return;
        const accountId = this._pendingAIAccountId || null;
        this._pendingAIResult = null;
        this._pendingAIAccountId = null;
        this._setImportBtnState('idle');
        
        this.fileBalance = result.file_balance || null;
        // Déléguer au cockpit unifié
        this.openReviewFromCSV(result, accountId);
    },

    async renderImportTable(txs, alerts = {}) {
        if (!window.app.categoriesList || window.app.categoriesList.length === 0) {
            try {
                window.app.categoriesList = await API.get('/api/categories/');
            } catch (e) {
                console.error("Failed to load categories", e);
                window.app.categoriesList = [];
            }
        }
        const summaryDiv = document.getElementById('importSummaryText');
        if (summaryDiv) {
            summaryDiv.style.display = 'block';
            summaryDiv.textContent = window.i18n.tp('msg_analysis_complete', {count: txs.length});
        }
        document.getElementById('importDataDesc').style.display = 'none';
        document.getElementById('importDataTable').style.display = 'table';
        document.getElementById('btnSaveImport').style.display = 'inline-block';
        
        const filtersContainer = document.getElementById('importFiltersContainer');
        if (filtersContainer) {
            filtersContainer.style.display = 'flex';
        }
        this.currentFilter = 'all';
        this.updateFilterButtons();
        
        const analysisBtns = document.getElementById('importAnalysisButtons');
        if (analysisBtns) analysisBtns.style.display = 'none';
        const saveBtns = document.getElementById('importSaveButtons');
        if (saveBtns) saveBtns.style.display = 'flex';
        
        const btnCatAll = document.getElementById('btnCategorizeAllAI');
        if (btnCatAll) {
            if (window.app.config && window.app.config.enable_ai === 'true') {
                btnCatAll.style.display = 'flex';
            } else {
                btnCatAll.style.display = 'none';
            }
        }
        
        const cfg = window.app && window.app.config ? window.app.config : {};
        const enableAttach = cfg.enable_attachments === 'true';
        let hasAttachments = enableAttach && txs.some(tx => tx.attachments);
        let attachmentsCheckHtml = '';
        if (hasAttachments) {
            attachmentsCheckHtml = `
                <div style="margin-top: 10px; display: flex; align-items: center; gap: 8px; font-size: 13px;">
                    <input type="checkbox" id="importAttachmentsCheck" checked style="cursor: pointer;">
                    <label for="importAttachmentsCheck" style="cursor: pointer; color: var(--text-color);">Importer les pièces jointes (colonnes Fichier / Documents joints)</label>
                </div>
            `;
        }
        
        if (summaryDiv) {
            summaryDiv.style.display = 'block';
            summaryDiv.innerHTML = window.i18n.tp('msg_analysis_complete_attachments', {count: txs.length, attachHtml: attachmentsCheckHtml});
        }
        
        const tbody = document.getElementById('importDataBody');
        tbody.innerHTML = '';
        
        // Store account used for these alerts
        const currentAccountId = document.getElementById('importAccountSelect')?.value;
        this._lastAnalyzedAccountId = currentAccountId || null;
        
        // Render alert box
        const alertBox = document.getElementById('importAlertBox');
        if (alertBox) {
            alertBox.style.display = 'none';
            alertBox.innerHTML = '';
            
            const warningMsgs = [];
            if (alerts.all_duplicate) {
                warningMsgs.push(`⚠️ ${window.i18n.t('import_alert_all_duplicate')}`);
            }
            if (alerts.is_old_file) {
                warningMsgs.push(`⚠️ ${window.i18n.t('import_alert_old_file')
                    .replace('{date_import}', formatDate(alerts.latest_import_date))
                    .replace('{date_db}', formatDate(alerts.latest_db_date))}`);
            }
            if (alerts.has_gap) {
                const dbD = new Date(alerts.latest_db_date);
                const impD = new Date(alerts.oldest_import_date);
                const diffTime = Math.abs(impD - dbD);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                warningMsgs.push(`⚠️ ${window.i18n.t('import_alert_gap')
                    .replace('{jours}', diffDays)
                    .replace('{date_db}', formatDate(alerts.latest_db_date))
                    .replace('{date_import_debut}', formatDate(alerts.oldest_import_date))}`);
            }
            if (alerts.is_old_compared_to_today && !alerts.is_old_file) {
                warningMsgs.push(`⚠️ ${window.i18n.t('import_alert_obsolete')
                    .replace('{date_import}', formatDate(alerts.latest_import_date))}`);
            }
            
            if (warningMsgs.length > 0) {
                alertBox.style.display = 'block';
                alertBox.innerHTML = warningMsgs.map(m => `<div style="margin-bottom: 5px; line-height: 1.4;">${m}</div>`).join('');
            }
        }
        
        // Reset scroll to top so the first row is always visible
        const tableContainer = document.getElementById('importTableContainer');
        if (tableContainer) tableContainer.scrollTop = 0;
        
        // Enrichissement Smart Label sur les opérations importées
        const unrecTxs = txs.filter(t => !t.is_reconciled && t.description);
        if (unrecTxs.length > 0) {
            try {
                const rawList = unrecTxs.map(t => t.raw_description || t.description);
                const smartRes = await API.post('/api/smart-labels/resolve-batch', { labels: rawList });
                if (smartRes && smartRes.results) {
                    txs.forEach(t => {
                        const raw = t.raw_description || t.description;
                        if (!t.is_reconciled && raw && smartRes.results[raw]) {
                            const r = smartRes.results[raw];
                            if (r.source === 'rule' || r.source === 'history') {
                                t.raw_description = raw;
                                t.description = r.description;
                                if (!t.category && r.category) {
                                    t.category = r.category;
                                }
                            }
                        }
                    });
                }
            } catch(errSmart) {
                console.warn('[ImportWizard] Erreur smart-labels:', errSmart);
            }
        }

        txs.forEach((tx, i) => {
            const isRec = tx.is_reconciled;
            const alreadyRec = tx.already_reconciled;
            
            let statusHtml = '';
            let actionText = '';
            let actionColor = '';
            
            if (isRec && alreadyRec) {
                statusHtml = `<span class="badge" style="background:var(--bg-surface);color:var(--text-muted);border:1px solid var(--border-color);">${window.i18n.t('import_status_reconciled')}</span>`;
                actionText = `Ignorée<br>(déjà traitée)`;
                actionColor = `color: var(--text-muted);`;
            } else if (isRec && !alreadyRec) {
                statusHtml = `<span class="badge" style="background:var(--color-income);color:white;">${window.i18n.t('import_status_to_reconcile')}</span>`;
                actionText = `Sera rapprochée<br>(pas de doublon)`;
                actionColor = `color: var(--color-income);`;
            } else {
                statusHtml = `<span class="badge" style="background:var(--color-expense);color:white;">${window.i18n.t('import_status_new')}</span>`;
                actionText = `Sera ajoutée`;
                actionColor = `color: var(--color-expense);`;
            }
            
            const dbDescValue = (tx.db_description || '').replace(/"/g, '&quot;');
            const mappedDescValue = (tx.description || tx.db_description || '').replace(/"/g, '&quot;');
            
            const rawDescHtml = dbDescValue ? `<div style="font-size: 10px; color: var(--text-muted); margin-bottom: 4px; white-space: pre-wrap; line-height: 1.2;">${dbDescValue}</div>` : '';
            
            const descInputStr = isRec ? 
                `${rawDescHtml}<input type="text" class="import-desc inline-input" value="${mappedDescValue}" style="width: 100%; border: 1px solid transparent; background: transparent; padding: 5px; color: var(--text-muted);" readonly title="Existant en DB">` : 
                `${rawDescHtml}<input type="text" class="import-desc inline-input" value="${mappedDescValue}" list="importDescList" oninput="window.ImportWizard.onDescriptionInput(this)" style="width: 100%; border: 1px solid var(--border-color); padding: 5px;">`;
                
            let catInputStr = '';
            if (!isRec) {
                let options = `<option value="">-- Catégorie --</option>`;
                (window.app.categoriesList || []).forEach(cat => {
                    if (!cat.is_closed) {
                        options += `<option value="${cat.name.replace(/"/g, '&quot;')}">${cat.name}</option>`;
                    }
                });
                
                const aiBtnHtml = (window.app.config && window.app.config.enable_ai === 'true') ? 
                    `<button class="btn btn-secondary" onclick="window.ImportWizard.categorizeRow(this)" style="padding: 4px; border: none; background: transparent; cursor: pointer;" title=\"${window.i18n.t('tooltip_categorize_ai')}\">🧠</button>` : '';
                    
                catInputStr = `
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <select class="import-cat inline-input" style="width: 100%; border: 1px solid var(--border-color); padding: 5px;">
                            ${options}
                        </select>
                        ${aiBtnHtml}
                    </div>
                `;
            } else {
                catInputStr = `<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">${window.i18n.t('import_already_in_db')}</span><input type="hidden" class="import-cat" value="">`;
            }
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="border-bottom: 1px solid var(--border-color);">
                    <input type="date" class="import-date inline-input" value="${tx.date_operation || tx.date}" style="width: 130px; border: 1px solid var(--border-color); padding: 5px;">
                </td>
                <td style="border-bottom: 1px solid var(--border-color);">
                    ${descInputStr}
                </td>
                <td style="border-bottom: 1px solid var(--border-color);">
                    ${catInputStr}
                </td>
                <td style="border-bottom: 1px solid var(--border-color); text-align: right;">
                    <input type="number" step="0.01" class="import-amt inline-input" value="${tx.amount || 0}" style="width: 80px; text-align:right; border: 1px solid var(--border-color); padding: 5px;">
                </td>
                <td style="border-bottom: 1px solid var(--border-color); text-align: center;">
                    ${statusHtml}
                    <input type="hidden" class="import-raw-desc" value="${(tx.raw_description || tx.description || '').replace(/"/g, '&quot;')}">
                    <input type="hidden" class="import-reconciled" value="${isRec ? 'true' : 'false'}">
                    <input type="hidden" class="import-already-rec" value="${alreadyRec ? 'true' : 'false'}">
                    <input type="hidden" class="import-matched-id" value="${tx.matched_db_id || ''}">
                    <input type="hidden" class="import-attachments" value="${tx.attachments ? tx.attachments.replace(/"/g, '&quot;') : ''}">
                    <input type="hidden" class="import-check" value="${tx.check_slip_number ? tx.check_slip_number.replace(/"/g, '&quot;') : ''}">
                </td>
                <td style="border-bottom: 1px solid var(--border-color);">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 12px;">
                        <div style="font-size: 11px; text-align: right; line-height: 1.2; ${actionColor}">
                            ${actionText}
                        </div>
                        <button class="btn btn-danger" style="padding: 6px 10px; font-size: 14px; font-weight: bold; color: white;" onclick="this.closest('tr').remove(); window.ImportWizard.updateImportSummary();" title="Ignorer cette ligne">✕</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
        
        this.updateImportSummary();
    },
    
    updateImportSummary() {
        const rows = document.querySelectorAll('#importDataBody tr');
        let newCount = 0;
        let recCount = 0;
        let ignoredCount = 0;
        
        rows.forEach(tr => {
            const isRec = tr.querySelector('.import-reconciled').value === 'true';
            const alreadyRec = tr.querySelector('.import-already-rec').value === 'true';
            
            if (isRec && alreadyRec) {
                ignoredCount++;
            } else if (isRec) {
                recCount++;
            } else {
                newCount++;
            }
        });
        
        const summaryDiv = document.getElementById('importSummaryText');
        if (summaryDiv) {
            summaryDiv.style.display = rows.length > 0 ? 'block' : 'none';
            let summaryHtml = `<strong style="font-size: 14px; margin-bottom: 8px; display: block;">Si vous validez cet import :</strong><ul style="margin: 0 0 0 20px; padding: 0; line-height: 1.6;">`;
            
            if (newCount > 0) {
                summaryHtml += `<li><span style="color: var(--color-expense); font-weight: bold;">${newCount} opération(s)</span> seront ajoutées comme <strong>nouvelles</strong>.</li>`;
            } else {
                summaryHtml += `<li><span style="color: var(--text-muted);">Aucune nouvelle opération ne sera ajoutée.</span></li>`;
            }
            
            if (recCount > 0) {
                summaryHtml += `<li><span style="color: var(--color-income); font-weight: bold;">${recCount} opération(s)</span> seront <strong>rapprochées</strong> (marquées comme validées). <em>Aucun doublon.</em></li>`;
            }
            
            if (ignoredCount > 0) {
                summaryHtml += `<li><span style="color: var(--text-muted); font-weight: bold;">${ignoredCount} opération(s)</span> seront <strong>ignorées</strong> (déjà rapprochées).</li>`;
            }
            
            summaryHtml += `</ul>`;
            summaryDiv.innerHTML = summaryHtml;
        }
        
        this.updateBalanceVerification();
    },
    
    updateBalanceVerification() {
        const box = document.getElementById('balanceVerificationBox');
        if (!box) return;
        
        if (this.selectedFile) {
            this.reinspectFileSections();
        }
        
        const accountId = document.getElementById('importAccountSelect')?.value;
        
        // Handle account changed warnings
        const alertBox = document.getElementById('importAlertBox');
        if (alertBox) {
            if (this._lastAnalyzedAccountId !== undefined && this._lastAnalyzedAccountId !== (accountId || null)) {
                alertBox.style.display = 'block';
                alertBox.innerHTML = `<div style="line-height: 1.4; color: #e67e22;">⚠️ ${window.i18n.t('import_alert_account_changed')}</div>`;
            } else if (this._lastAnalyzedAccountId === (accountId || null) && alertBox.innerHTML.includes('import_alert_account_changed')) {
                alertBox.style.display = 'none';
                alertBox.innerHTML = '';
            }
        }
        
        if (!accountId) {
            box.style.display = 'none';
            return;
        }
        
        const account = window.app.accounts.find(a => a.id == accountId);
        if (!account) return;
        
        const rows = document.querySelectorAll('#importDataBody tr');
        let newAmountSum = 0;
        
        rows.forEach(tr => {
            const alreadyRec = tr.querySelector('.import-already-rec').value === 'true';
            
            // The `account.balance` only includes transactions that are ALREADY reconciled in the DB.
            // If the user hits Save, any transaction in this list that is NOT `alreadyRec` 
            // (meaning it's either a NEW transaction, or a PENDING transaction being reconciled)
            // will now be part of the reconciled balance.
            if (!alreadyRec) {
                const amt = parseFloat(tr.querySelector('.import-amt').value) || 0;
                newAmountSum += amt;
            }
        });
        
        const finalDbBalance = account.balance + newAmountSum;
        
        box.style.display = 'block';
        if (this.fileBalance === null) {
            box.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
            box.style.borderColor = 'var(--border-color)';
            box.innerHTML = window.i18n.tp('msg_balance_info', {balance: formatCurrency(finalDbBalance)});
        } else {
            const diff = Math.abs(finalDbBalance - this.fileBalance);
            if (diff < 0.05) {
                box.style.backgroundColor = 'rgba(46, 204, 113, 0.1)';
                box.style.borderColor = 'rgba(46, 204, 113, 0.5)';
                box.innerHTML = window.i18n.tp('msg_balance_ok', {fileBalance: formatCurrency(this.fileBalance)});
            } else {
                box.style.backgroundColor = 'rgba(231, 76, 60, 0.1)';
                box.style.borderColor = 'rgba(231, 76, 60, 0.5)';
                box.innerHTML = window.i18n.tp('msg_balance_diff', {fileBalance: formatCurrency(this.fileBalance), dbBalance: formatCurrency(finalDbBalance), diff: formatCurrency(diff)});
            }
        }
    },
    
    async categorizeRow(btn) {
        const tr = btn.closest('tr');
        const desc = tr.querySelector('.import-desc').value;
        const select = tr.querySelector('.import-cat');
        
        if (!desc) return;
        
        btn.innerHTML = '⏳';
        btn.disabled = true;
        
        try {
            const res = await API.post('/api/ai/categorize', { description: desc });
            if (res.category) {
                select.value = res.category;
            }
        } catch (e) {
            console.error("Erreur IA", e);
        } finally {
            btn.innerHTML = '🧠';
            btn.disabled = false;
        }
    },
    
    async categorizeAllNew() {
        const rows = Array.from(document.querySelectorAll('#importDataBody tr')).filter(tr => {
            const isRec = tr.querySelector('.import-reconciled').value === 'true';
            const catSelect = tr.querySelector('.import-cat');
            return !isRec && catSelect && !catSelect.value;
        });
        
        if (rows.length === 0) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_all_categorized'));
            return;
        }
        
        const btnAll = document.getElementById('btnCategorizeAllAI');
        const originalHtml = btnAll.innerHTML;
        btnAll.innerHTML = '<span style="font-size: 14px;">⏳</span> Traitement...';
        btnAll.disabled = true;
        
        const descriptions = rows.map(tr => tr.querySelector('.import-desc').value);
        
        try {
            const res = await API.post('/api/ai/categorize_batch', { descriptions });
            if (res.categories) {
                rows.forEach(tr => {
                    const desc = tr.querySelector('.import-desc').value;
                    const cat = res.categories[desc];
                    if (cat) {
                        const sel = tr.querySelector('.import-cat');
                        if (sel) sel.value = cat;
                    }
                });
            }
        } catch (e) {
            console.error("Erreur IA Batch", e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_ai_failed'));
        } finally {
            btnAll.innerHTML = originalHtml;
            btnAll.disabled = false;
        }
    },

    async saveImport() {
        const rows = document.querySelectorAll('#importDataBody tr');
        const txs = [];
        rows.forEach(tr => {
            const date = tr.querySelector('.import-date').value;
            const desc = tr.querySelector('.import-desc').value;
            const rawDesc = tr.querySelector('.import-raw-desc')?.value || desc;
            const amt = parseFloat(tr.querySelector('.import-amt').value);
            const isRec = tr.querySelector('.import-reconciled').value === 'true';
            const matchId = tr.querySelector('.import-matched-id').value;
            const attachments = tr.querySelector('.import-attachments').value;
            const check = tr.querySelector('.import-check').value;
            const catSelect = tr.querySelector('.import-cat');
            const cat = catSelect ? catSelect.value : null;
            
            if (date && !isNaN(amt)) {
                txs.push({
                    date_operation: date,
                    description: desc,
                    raw_description: rawDesc,
                    category: cat || null,
                    amount: amt,
                    is_reconciled: isRec,
                    matched_db_id: matchId,
                    attachments: attachments || null,
                    check_slip_number: check || null
                });
            }
        });
        
        if (txs.length === 0) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_no_transactions'));
            return;
        }
        
        const accountId = document.getElementById('importAccountSelect')?.value || null;
        if (!accountId) {
            showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_select_account'));
            return;
        }
        
        const importAttachments = document.getElementById('importAttachmentsCheck')?.checked;
        const txsWithAttachments = txs.filter(t => t.attachments);
        
        if (importAttachments && txsWithAttachments.length > 0) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_select_attachment_folder'));
            const input = document.createElement('input');
            input.type = 'file';
            input.webkitdirectory = true;
            input.onchange = async (e) => {
                if (!e.target.files.length) {
                    this.finalizeSave(txs, accountId);
                    return;
                }
                const files = Array.from(e.target.files);
                const formData = new FormData();
                const paths = [];
                
                for (const tx of txsWithAttachments) {
                    const expectedName = tx.attachments.replace(/\\/g, '/').split('/').pop();
                    const matchedFile = files.find(f => f.name === expectedName || f.webkitRelativePath.endsWith(expectedName));
                    if (matchedFile) {
                        formData.append("files", matchedFile);
                        paths.push(tx.attachments);
                    }
                }
                
                if (paths.length > 0) {
                    formData.append("relative_paths", JSON.stringify(paths));
                    try {
                        document.getElementById('importDataDesc').textContent = window.i18n.t('msg_uploading_attachments');
                        document.getElementById('importDataDesc').style.display = 'block';
                        const res = await fetch('/api/csv/upload_attachments', {
                            method: 'POST',
                            body: formData
                        });
                        const data = await res.json();
                        if (data.saved) {
                            txs.forEach(t => {
                                if (t.attachments && data.saved[t.attachments]) {
                                    t.attachments = data.saved[t.attachments];
                                } else if (t.attachments) {
                                    t.attachments = null;
                                }
                            });
                        }
                    } catch(err) {
                        console.error("Erreur upload", err);
                    }
                }
                this.finalizeSave(txs, accountId);
            };
            input.click();
            return;
        }
        
        this.finalizeSave(txs, accountId);
    },
    
    populateSectionsDropdown() {
        const select = document.getElementById('importSectionSelect');
        if (!select) return;
        select.innerHTML = '';
        
        this.detectedSections.forEach(sec => {
            const opt = document.createElement('option');
            opt.value = sec;
            opt.textContent = sec;
            if (sec === this.recommendedSection) {
                opt.selected = true;
            }
            select.appendChild(opt);
        });
    },

    onSectionChanged() {
        const select = document.getElementById('importSectionSelect');
        if (select) {
            this.recommendedSection = select.value;
        }
        
        document.getElementById('importDataTable').style.display = 'none';
        document.getElementById('importDataBody').innerHTML = '';
        this.fileBalance = null;
        document.getElementById('balanceVerificationBox').style.display = 'none';
        
        const alertBox = document.getElementById('importAlertBox');
        if (alertBox) {
            alertBox.style.display = 'none';
            alertBox.innerHTML = '';
        }
        
        document.getElementById('btnSaveImport').style.display = 'none';
        
        const saveBtns = document.getElementById('importSaveButtons');
        if (saveBtns) saveBtns.style.display = 'none';
        
        const analysisBtns = document.getElementById('importAnalysisButtons');
        if (analysisBtns) analysisBtns.style.display = 'flex';
        
        const filtersContainer = document.getElementById('importFiltersContainer');
        if (filtersContainer) {
            filtersContainer.style.display = 'none';
        }
        
        this._setAnalysisButtonsEnabled(true);
    },
    
    async reinspectFileSections() {
        if (!this.selectedFile) return;
        
        const sectionContainer = document.getElementById('importSectionContainer');
        const accountId = document.getElementById('importAccountSelect')?.value;
        
        const formData = new FormData();
        formData.append("file", this.selectedFile);
        if (accountId) {
            formData.append("account_id", accountId);
        }
        
        try {
            const res = await fetch("/api/csv/inspect_file", {
                method: "POST",
                body: formData
            });
            if (res.ok) {
                const data = await res.json();
                this.detectedSections = data.sections || [];
                this.recommendedSection = data.recommended_section || null;
                this.sectionConfidence = data.confidence || 100;
                
                this.populateSectionsDropdown();
                
                if (this.detectedSections.length > 1) {
                    if (this.sectionConfidence < 50) {
                        if (sectionContainer) {
                            sectionContainer.style.display = 'flex';
                        }
                    } else {
                        if (sectionContainer) {
                            sectionContainer.style.display = 'none';
                        }
                    }
                } else {
                    if (sectionContainer) {
                        sectionContainer.style.display = 'none';
                    }
                }
            }
        } catch (e) {
            console.error("Error inspecting file sections:", e);
        }
    },
    
    setFilter(type) {
        this.currentFilter = type;
        this.updateFilterButtons();
        
        const rows = document.querySelectorAll('#importDataBody tr');
        rows.forEach(tr => {
            const isRec = tr.querySelector('.import-reconciled').value === 'true';
            const alreadyRec = tr.querySelector('.import-already-rec').value === 'true';
            
            if (type === 'all') {
                tr.style.display = '';
            } else if (type === 'add') {
                tr.style.display = !isRec ? '' : 'none';
            } else if (type === 'reconcile') {
                tr.style.display = (isRec && !alreadyRec) ? '' : 'none';
            }
        });
    },
    
    updateFilterButtons() {
        const btnAll = document.getElementById('btnFilterAll');
        const btnAdd = document.getElementById('btnFilterAdd');
        const btnRec = document.getElementById('btnFilterReconcile');
        if (!btnAll || !btnAdd || !btnRec) return;
        
        const resetBtn = (btn) => {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-muted)';
            btn.style.borderColor = 'var(--border-color)';
        };
        
        const activeBtn = (btn) => {
            btn.style.background = 'var(--accent)';
            btn.style.color = 'white';
            btn.style.borderColor = 'var(--accent)';
        };
        
        resetBtn(btnAll);
        resetBtn(btnAdd);
        resetBtn(btnRec);
        
        if (this.currentFilter === 'all') {
            activeBtn(btnAll);
        } else if (this.currentFilter === 'add') {
            activeBtn(btnAdd);
        } else if (this.currentFilter === 'reconcile') {
            activeBtn(btnRec);
        }
    },
    
    async finalizeSave(txs, accountId) {
        try {
            const res = await API.post('/api/csv/save_batch', { transactions: txs, account_id: accountId });
            showInlineMessage(window.i18n.t('title_info'), window.i18n.tp('msg_import_done', {count: res.imported}));
            document.getElementById('importDataModal').style.display = 'none';
            window.location.reload();
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error'));
        }
    }
};
