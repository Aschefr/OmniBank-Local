window.RecurrenceView = {
    templates: [],
    transactions: [],
    selectedYear: new Date().getFullYear(),
    modifiedRows: new Set(),
    expandedTemplateIds: new Set(),
    
    render() {
        return `
            <div class="view-header" style="margin-bottom:20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <h2>🔄 <span data-i18n="nav_recurrences">Récurrences</span></h2>
                <div style="display: flex; align-items: center; gap: 10px; flex: 1; justify-content: flex-end;">
                    <input type="text" id="recurrenceSearch" class="inline-input" data-i18n-placeholder="ph_search_recurrence" placeholder="${window.i18n.t('ph_search_recurrence')}" style="min-width: 180px; max-width: 300px; flex: 1;" oninput="window.RecurrenceView.applyFilter()">
                    <button class="btn btn-primary" style="padding: 10px 20px; font-weight: bold; background: linear-gradient(135deg, #6c5ce7, #a29bfe); color: white; border: none; box-shadow: 0 4px 6px rgba(108, 92, 231, 0.2);" onclick="window.RecurrenceView.showWizard()" data-i18n="rec_wizard_btn">${window.i18n.t('rec_wizard_btn')}</button>
                </div>
            </div>
            
            <div style="background: var(--bg-surface); padding: 20px; border-radius: 12px; margin-top: 20px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display: flex; gap: 15px; align-items: center; justify-content: center; margin-bottom: 20px;">
                    <button class="btn btn-secondary" style="padding: 5px 15px;" onclick="window.RecurrenceView.changeYear(-1)">&lt;</button>
                    <h3 style="margin: 0; width: 80px; text-align: center; font-size: 24px;" id="recYearDisplay">${this.selectedYear}</h3>
                    <button class="btn btn-secondary" style="padding: 5px 15px;" onclick="window.RecurrenceView.changeYear(1)">&gt;</button>
                </div>
                
                <div id="recurrencesTableContainer" style="margin-top: 20px; overflow-x: auto;">
                    <!-- Table rendered dynamically -->
                </div>
            </div>
        `;
    },

    async init() {
        this.selectedYear = new Date().getFullYear();
        this.modifiedRows.clear();
        this.expandedTemplateIds.clear();
        await this.loadData();
    },

    async loadData() {
        try {
            this.templates = await API.get('/api/recurrences/?include_closed=true');
            this.categories = await API.get('/api/categories/');
            // Fetch all operations and filter locally
            const allTx = await API.get('/api/transactions/?limit=10000');
            this.allTransactions = allTx;
            
            // Find active templates for this year
            const activeTemplateIds = new Set(
                allTx.filter(tx => tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear && tx.recurrence_id != null)
                     .map(tx => tx.recurrence_id)
            );
            
            // Filter templates: only show those that have transactions in the selected year
            const displayTemplates = this.templates.filter(t => 
                activeTemplateIds.has(t.id)
            );
            
            const tableContainer = document.getElementById('recurrencesTableContainer');
            if (tableContainer) {
                if (displayTemplates.length === 0) {
                    const emptyMsg = (window.i18n.t('msg_no_recurrences_configured_year') || 'Aucune opération récurrente planifiée pour {year}').replace('{year}', this.selectedYear);
                    tableContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 16px;">${emptyMsg}</div>`;
                    return;
                }
                
                let tableHtml = `
                     <table class="data-table" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <thead>
                            <tr style="text-align: left; background: rgba(0, 0, 0, 0.03); border-bottom: 2px solid var(--border-color);">
                                <th style="padding: 12px; width: 40px; text-align: center;"></th>
                                <th style="padding: 12px;">${window.i18n.t('col_description')}</th>
                                <th style="padding: 12px; width: 200px;">${window.i18n.t('col_category')}</th>
                                <th style="padding: 12px; width: 120px;">${window.i18n.t('wizard_th_frequency') || 'Fréquence'}</th>
                                <th style="padding: 12px; width: 100px; text-align: center;">${window.i18n.t('wizard_th_day') || 'Jour'}</th>
                                <th style="padding: 12px; width: 130px; text-align: right;">${window.i18n.t('col_amount')}</th>
                                <th style="padding: 12px; width: 80px; text-align: center;">${window.i18n.t('th_actions') || 'Actions'}</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                
                displayTemplates.sort((a, b) => a.description.localeCompare(b.description)).forEach(t => {
                    const isExpanded = this.expandedTemplateIds.has(t.id);
                    const chevronChar = isExpanded ? '▼' : '▶';
                    const displayStyle = isExpanded ? 'table-row' : 'none';
                    
                    const freqLabel = window.i18n.t('rec_' + t.frequency.toLowerCase()) || t.frequency;
                    
                    const catOptionsHtml = (this.categories || [])
                        .filter(c => !c.is_closed || c.name === t.category)
                        .map(c => `<option value="${c.name}" ${t.category === c.name ? 'selected' : ''}>${c.name}</option>`)
                        .join('');
                    
                    tableHtml += `
                        <tr onclick="window.RecurrenceView.toggleRow(${t.id})" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(99,102,241,0.05)'" onmouseout="this.style.backgroundColor=''">
                            <td style="padding: 12px; text-align: center; font-size: 12px; font-weight: bold; color: var(--primary-color);" id="chevron_${t.id}">${chevronChar}</td>
                            <td style="padding: 12px; font-weight: 600;">${t.description}</td>
                            <td style="padding: 6px 12px;" onclick="event.stopPropagation()">
                                <select class="inline-input" style="padding: 4px 8px; border-radius: 6px; font-size: 13px; width: 100%; border: 1px solid var(--border-color); background: var(--bg-surface); cursor: pointer;" onchange="window.RecurrenceView.changeTemplateCategory(this, ${t.id})">
                                    <option value="">-- Sans catégorie --</option>
                                    ${catOptionsHtml}
                                    <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ Nouvelle catégorie...</option>
                                </select>
                            </td>
                            <td style="padding: 12px; font-size: 13px;">${freqLabel}</td>
                            <td style="padding: 12px; text-align: center; font-size: 13px;">${t.day_of_month || 1}</td>
                            <td style="padding: 12px; text-align: right; font-weight: 700; color: var(--text-main); font-size: 14px;">${formatCurrency(t.amount)}</td>
                            <td style="padding: 12px; text-align: center;" onclick="event.stopPropagation()">
                                <button class="btn btn-danger" style="padding: 6px 10px; font-size: 12px;" onclick="window.RecurrenceView.deleteTemplate(${t.id})" title="${window.i18n.t('tooltip_delete') || 'Supprimer'}">🗑️</button>
                            </td>
                        </tr>
                        <tr id="details_row_${t.id}" style="display: ${displayStyle}; background: var(--bg-sidebar);">
                            <td colspan="7" style="padding: 15px 20px; border-bottom: 1px solid var(--border-color);">
                                <div id="details_content_${t.id}">
                                    <!-- Rendered dynamically -->
                                </div>
                            </td>
                        </tr>
                    `;
                });
                
                tableHtml += `
                        </tbody>
                    </table>
                `;
                tableContainer.innerHTML = tableHtml;
                
                // Re-render contents of all expanded templates
                this.expandedTemplateIds.forEach(id => {
                    this.renderTemplateDetails(id);
                });
            }
        } catch (e) {
            console.error("Failed to load transactions", e);
        }
    },
    
    async refreshTransactions() {
        await this.loadData();
    },

    applyFilter() {
        const input = document.getElementById('recurrenceSearch');
        const q = input ? input.value.toLowerCase().trim() : '';
        const container = document.getElementById('recurrencesTableContainer');
        if (!container) return;
        const rows = container.querySelectorAll('tbody > tr');
        for (let i = 0; i < rows.length; i += 2) {
            const mainRow = rows[i];
            const detailRow = rows[i + 1];
            if (!mainRow) continue;
            
            const selectEl = mainRow.querySelector('select');
            const descText = mainRow.cells[1] ? mainRow.cells[1].textContent.toLowerCase() : '';
            const catText = selectEl ? selectEl.value.toLowerCase() : '';
            const freqText = mainRow.cells[3] ? mainRow.cells[3].textContent.toLowerCase() : '';
            const dayText = mainRow.cells[4] ? mainRow.cells[4].textContent.toLowerCase() : '';
            const amountText = mainRow.cells[5] ? mainRow.cells[5].textContent.toLowerCase() : '';
            
            const match = !q || 
                          descText.includes(q) || 
                          catText.includes(q) || 
                          freqText.includes(q) || 
                          dayText.includes(q) || 
                          amountText.includes(q);
                          
            mainRow.style.display = match ? '' : 'none';
            if (detailRow && detailRow.id && detailRow.id.startsWith('details_row_')) {
                if (!match) {
                    detailRow.style.display = 'none';
                } else {
                    // Restore expanded state if matching
                    const templateId = parseInt(detailRow.id.replace('details_row_', ''));
                    detailRow.style.display = this.expandedTemplateIds.has(templateId) ? 'table-row' : 'none';
                }
            }
        }
    },

    changeYear(delta) {
        this.selectedYear += delta;
        this.lastPropagate = null; // Reset undo state on year change
        this.expandedTemplateIds.clear(); // Clear expanded templates on year change
        const display = document.getElementById('recYearDisplay');
        if (display) display.textContent = this.selectedYear;
        this.refreshTransactions();
    },

    toggleRow(templateId) {
        const detailsRow = document.getElementById(`details_row_${templateId}`);
        const chevron = document.getElementById(`chevron_${templateId}`);
        if (!detailsRow) return;
        
        if (this.expandedTemplateIds.has(templateId)) {
            this.expandedTemplateIds.delete(templateId);
            detailsRow.style.display = 'none';
            if (chevron) chevron.textContent = '▶';
        } else {
            this.expandedTemplateIds.add(templateId);
            detailsRow.style.display = 'table-row';
            if (chevron) chevron.textContent = '▼';
            this.renderTemplateDetails(templateId);
        }
    },

    renderTemplateDetails(templateId) {
        const container = document.getElementById(`details_content_${templateId}`);
        if (!container) return;
        
        // Filter occurrences for this template in the selected year
        const templateTx = (this.allTransactions || []).filter(tx => 
            tx.recurrence_id == templateId && 
            tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear
        ).sort((a, b) => a.date_operation.localeCompare(b.date_operation));
        
        if (templateTx.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">${window.i18n.t('msg_no_operations_this_year')}</div>`;
            return;
        }
        
        // Backup original values if not already backed up
        templateTx.forEach(tx => {
            if (tx._original_amount === undefined) tx._original_amount = tx.amount;
            if (tx._original_date === undefined) tx._original_date = tx.date_operation;
        });
        
        let instancesHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4 style="margin: 0; color: var(--text-muted); font-size: 14px; font-weight: bold;">${window.i18n.t('rec_year_details_title') || 'Détails des opérations de l\'année'}</h4>
                <button id="save_btn_${templateId}" class="btn btn-primary" style="padding: 6px 15px; font-size: 13px; font-weight: bold;" onclick="window.RecurrenceView.saveTemplateChanges(${templateId})">${window.i18n.t('btn_save_changes')}</button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 140px; gap: 10px; margin-bottom: 10px; padding: 0 10px; font-weight: bold; color: var(--text-muted); text-align: center; font-size: 13px;">
                <div data-i18n="rec_col_date">${window.i18n.t('rec_col_date')}</div>
                <div data-i18n="rec_col_amount">${window.i18n.t('rec_col_amount')}</div>
                <div></div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
        `;
        
        instancesHtml += templateTx.map(tx => {
            const isModified = this.modifiedRows.has(tx.id);
            const isReconciled = tx.reconciliation_date != null;
            
            const justPropagated = (this.lastPropagate && this.lastPropagate.txId === tx.id);
            
            const bg = isModified ? 'rgba(51, 102, 255, 0.05)' : (isReconciled ? 'var(--bg-base)' : 'var(--bg-surface)');
            const opClass = isReconciled ? 'opacity: 0.6;' : '';
            const readonly = isReconciled ? 'readonly disabled' : '';
            
            const dateStr = tx.date_operation.split('T')[0];
            
            let actionBtn = '';
            if (justPropagated) {
                const oldAmtStr = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(this.lastPropagate.oldAmount);
                actionBtn = `<button class="btn btn-danger" style="padding: 5px; font-size: 11px; width: 100%; white-space: normal;" onclick="window.RecurrenceView.undoPropagate(${templateId})">Annuler (Retour à ${oldAmtStr})</button>`;
            } else if (isModified && !isReconciled) {
                actionBtn = `<button class="btn btn-primary" style="padding: 5px; font-size: 11px; width: 100%; white-space: normal;" onclick="window.RecurrenceView.propagate(${tx.id})" data-i18n="btn_propagate_down">Propager vers le bas ⬇️</button>`;
            }

            return `
            <div class="rec-instance-row" style="display: grid; grid-template-columns: 1fr 1fr 140px; gap: 10px; align-items: center; background: ${bg}; padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); ${opClass}">
                <input type="date" id="rec_date_${tx.id}" class="inline-input" value="${dateStr}" style="text-align: center; font-size: 13px;" onchange="window.RecurrenceView.markTemplateRowModified(${tx.id}, ${templateId})" ${readonly}>
                <input type="number" id="rec_amount_${tx.id}" class="inline-input" value="${tx.amount}" step="0.01" style="text-align: center; font-size: 13px;" onchange="window.RecurrenceView.markTemplateRowModified(${tx.id}, ${templateId})" ${readonly}>
                <div>${actionBtn}</div>
            </div>
            `;
        }).join('');
        
        instancesHtml += `</div>`;
        container.innerHTML = instancesHtml;
    },
    
    markTemplateRowModified(txId, templateId) {
        const dateInput = document.getElementById(`rec_date_${txId}`);
        const amountInput = document.getElementById(`rec_amount_${txId}`);
        
        if (dateInput && amountInput) {
            const tx = this.allTransactions.find(t => t.id === txId);
            if (tx) {
                tx.date_operation = dateInput.value;
                tx.amount = parseFloat(amountInput.value) || 0;
            }
        }
        
        this.modifiedRows.add(txId);
        this.renderTemplateDetails(templateId);
    },

    async saveTemplateChanges(templateId) {
        // Find all modified transactions that belong to this template
        const templateTx = this.allTransactions.filter(tx => 
            tx.recurrence_id == templateId && 
            tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear
        );
        const modifiedInTemplate = Array.from(this.modifiedRows).filter(id => 
            templateTx.some(tx => tx.id === id)
        );
        
        if (modifiedInTemplate.length === 0) return;
        
        const btn = document.getElementById(`save_btn_${templateId}`);
        const originalText = btn ? btn.innerHTML : '';
        
        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ ...';
            }
            
            for (let id of modifiedInTemplate) {
                const dateVal = document.getElementById(`rec_date_${id}`).value;
                const amountVal = parseFloat(document.getElementById(`rec_amount_${id}`).value);
                await API.put(`/api/transactions/${id}`, {
                    date_operation: dateVal,
                    amount: amountVal
                });
                this.modifiedRows.delete(id);
            }
            
            window.app.refreshSidebar();
            await this.loadData();
            
            // Re-fetch the new button from the DOM after loadData re-renders the table
            const successBtn = document.getElementById(`save_btn_${templateId}`);
            if (successBtn) {
                const successOriginalText = successBtn.innerHTML;
                successBtn.innerHTML = '✅ ' + window.i18n.t('btn_saved');
                successBtn.style.background = 'var(--success, #2ecc71)';
                successBtn.style.transition = 'background-color 0.5s ease';
                setTimeout(() => {
                    const currentBtn = document.getElementById(`save_btn_${templateId}`);
                    if (currentBtn) {
                        currentBtn.style.background = '';
                        currentBtn.innerHTML = successOriginalText;
                    }
                }, 4000);
            }
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la sauvegarde", "error");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    },
    
    async propagate(txId) {
        const dateVal = document.getElementById(`rec_date_${txId}`).value;
        const amountVal = parseFloat(document.getElementById(`rec_amount_${txId}`).value);
        
        if (!dateVal || isNaN(amountVal)) return;
        
        const originalTx = this.allTransactions.find(t => t.id === txId);
        if (!originalTx) return;
        
        const templateId = originalTx.recurrence_id;
        
        try {
            const res = await API.post(`/api/recurrences/${templateId}/propagate`, {
                transaction_id: txId,
                new_amount: amountVal,
                new_date: dateVal
            });
            window.app.refreshSidebar();
            
            // Save state for undo using the TRULY original values before user modified them
            this.lastPropagate = {
                txId: txId,
                templateId: templateId,
                oldDate: originalTx._original_date.split('T')[0],
                oldAmount: originalTx._original_amount
            };
            
            await this.refreshTransactions();
            
            // Highlight updated inputs successfully
            setTimeout(() => {
                const templateTx = this.allTransactions.filter(tx => tx.recurrence_id == templateId);
                const affectedRows = templateTx.filter(t => t.date_operation >= dateVal);
                affectedRows.forEach(t => {
                    const dInput = document.getElementById(`rec_date_${t.id}`);
                    const aInput = document.getElementById(`rec_amount_${t.id}`);
                    if (dInput && dInput.value !== originalTx._original_date.split('T')[0]) {
                        dInput.style.transition = 'background-color 0.5s';
                        dInput.style.backgroundColor = 'rgba(40, 167, 69, 0.2)';
                        setTimeout(() => dInput.style.backgroundColor = '', 2000);
                    }
                    if (aInput && parseFloat(aInput.value) !== originalTx._original_amount) {
                        aInput.style.transition = 'background-color 0.5s';
                        aInput.style.backgroundColor = 'rgba(40, 167, 69, 0.2)';
                        setTimeout(() => aInput.style.backgroundColor = '', 2000);
                    }
                });
            }, 100);
            
        } catch (e) {
            console.error("Propagate error", e);
            await showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_propagation_error'));
        }
    },
    
    async undoPropagate(templateId) {
        if (!this.lastPropagate || this.lastPropagate.templateId !== templateId) return;
        const p = this.lastPropagate;
        try {
            await API.post(`/api/recurrences/${templateId}/propagate`, {
                transaction_id: p.txId,
                new_amount: p.oldAmount,
                new_date: p.oldDate
            });
            this.lastPropagate = null;
            window.app.refreshSidebar();
            await this.refreshTransactions();
        } catch (e) {
            console.error("Undo error", e);
            await showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_cancel_error'));
        }
    },

    async changeTemplateCategory(selectElement, templateId) {
        const val = selectElement.value;
        if (val === '__new__') {
            const title = window.i18n.t('wizard_prompt_new_category_title') || 'Nom de la nouvelle catégorie de dépenses fixes :';
            const name = await showInlinePrompt(title);
            if (name && name.trim()) {
                try {
                    const newCat = await API.post('/api/categories/', { name: name.trim(), type: 'expense_fixed' });
                    await API.patch(`/api/recurrences/${templateId}/category`, { category: newCat.name });
                    showToast(window.i18n.t('msg_category_added') || 'Catégorie ajoutée');
                } catch (e) {
                    let isConflict = false;
                    let msg = e.message;
                    try {
                        const parsed = JSON.parse(e.message);
                        msg = parsed.detail || e.message;
                        if (msg.includes("already exists") && msg.includes("currently in use")) {
                            isConflict = true;
                        }
                    } catch(err) {}

                    if (isConflict) {
                        const confirmMsg = `La catégorie '${name}' existe déjà en tant que dépense variable. Voulez-vous la déplacer définitivement vers les charges fixes ?`;
                        if (await showInlineConfirm("Conflit de catégorie", confirmMsg)) {
                            try {
                                const newCat = await API.post('/api/categories/?force_move=true', { name: name.trim(), type: 'expense_fixed' });
                                await API.patch(`/api/recurrences/${templateId}/category`, { category: newCat.name });
                                showToast(window.i18n.t('msg_category_added') || 'Catégorie ajoutée');
                            } catch(err2) {
                                showToast("Erreur lors du déplacement de la catégorie", "error");
                            }
                        }
                    } else {
                        console.error("Failed to create category", e);
                        showToast(window.i18n.t('msg_category_create_error') || 'Erreur lors de la création de la catégorie', 'error');
                    }
                }
            }
            await this.loadData();
        } else {
            try {
                await API.patch(`/api/recurrences/${templateId}/category`, { category: val || null });
                showToast("Catégorie mise à jour");
            } catch (e) {
                console.error(e);
                showToast("Erreur lors de la mise à jour de la catégorie", "error");
            }
            await this.loadData();
        }
    },

    async deleteTemplate(templateId) {
        const confirm = await showInlineConfirm('title_deletion', 'confirm_delete_template');
        if (!confirm) return;
        
        try {
            await API.del(`/api/recurrences/${templateId}`);
            showToast(window.i18n.t('msg_template_deleted') || 'Récurrence supprimée');
            if (this.expandedTemplateIds.has(templateId)) {
                this.expandedTemplateIds.delete(templateId);
            }
            await window.app.refreshSidebar();
            await this.loadData();
        } catch (e) {
            console.error(e);
            showToast("Impossible de supprimer la récurrence", "error");
        }
    },
    
    async showWizard() {
        const targetYear = this.selectedYear + 1;
        const currentTemplates = JSON.parse(JSON.stringify(this.templates));
        
        let categories = [];
        try {
            categories = await API.get('/api/categories/');
            this.categories = categories; // Cache for addWizardRow()
        } catch (e) {
            console.error("Failed to load categories for wizard", e);
        }
        
        const cfg = window.app.config || {};
        const showBimonthly = (cfg.enable_bimonthly === 'true' || cfg.enable_bimonthly === true);
        
        const allTx = this.allTransactions || [];
        const uniqueYears = Array.from(new Set(allTx.filter(tx => tx.date_operation).map(tx => parseInt(tx.date_operation.substring(0, 4))))).sort((a, b) => b - a);
        const currentYear = new Date().getFullYear();
        if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
        if (!uniqueYears.includes(targetYear - 1)) uniqueYears.push(targetYear - 1);
        uniqueYears.sort((a, b) => b - a);

        const yearOptions = uniqueYears.map(yr => `<option value="${yr}" ${yr === (targetYear - 1) ? 'selected' : ''}>${yr}</option>`).join('');

        let wizardHtml = `
            <div id="recWizardModal" class="modal-overlay" style="z-index: 1000;">
                <div class="modal" style="width: 95%; max-width: 1200px; height: 90vh; display: flex; flex-direction: column; overflow: hidden; padding: 0; border-radius: 14px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);">
                    <div style="padding: 20px; background: var(--bg-surface); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                        <h2 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">${window.i18n.t('wizard_title_prep')} <input type="number" id="wizardTargetYear" value="${targetYear}" style="background:transparent; border:none; color:inherit; font-size:inherit; font-weight:inherit; width:80px; border-bottom: 2px solid var(--primary-color); outline:none;" oninput="window.RecurrenceView.onTargetYearInput()"></h2>
                        <button class="btn btn-secondary" onclick="document.getElementById('recWizardModal').remove()">❌ ${window.i18n.t('btn_close')}</button>
                    </div>
                    <div style="padding: 15px 20px; background: var(--bg-sidebar); border-bottom: 1px solid var(--border-color); display: flex; gap: 20px; align-items: center; flex-wrap: wrap; justify-content: space-between; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-weight: 600; font-size: 14px;">${window.i18n.t('wizard_ref_year_label')} :</span>
                            <select id="wizardRefYearSelect" class="inline-input" style="padding: 6px 12px; border-radius: 6px; font-weight: bold; width: 100px;" onchange="window.RecurrenceView.filterWizardTemplates()">
                                ${yearOptions}
                            </select>
                        </div>
                        <button class="btn btn-secondary" style="padding: 8px 16px; font-size: 13px;" onclick="window.RecurrenceView.resetFromReferenceYear()">${window.i18n.t('wizard_btn_reset')}</button>
                    </div>
                    <div style="flex: 1; overflow-y: auto; padding: 20px; background: var(--bg-base);">
                        <table style="width: 100%; border-collapse: collapse; background: var(--bg-surface); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow-sm);">
                            <thead>
                                <tr style="background: rgba(0,0,0,0.05); text-align: left;">
                                    <th style="padding: 15px; width: 100px; text-align: center; vertical-align: middle;">
                                        <input type="checkbox" id="wizardSelectAll" checked style="width: 20px; height: 20px; cursor: pointer; margin-bottom: 4px;" onclick="window.RecurrenceView.toggleSelectAll(this.checked)" title="${window.i18n.t('wizard_tooltip_select_all')}">
                                        <div style="font-size: 11px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('wizard_th_renew')}</div>
                                    </th>
                                    <th style="padding: 15px;">${window.i18n.t('col_description')}</th>
                                    <th style="padding: 15px;">${window.i18n.t('wizard_th_frequency')}</th>
                                    <th style="padding: 15px;">${window.i18n.t('col_category')}</th>
                                    <th style="padding: 15px;">${window.i18n.t('col_amount')}</th>
                                    <th style="padding: 15px;">${window.i18n.t('wizard_th_day')}</th>
                                </tr>
                            </thead>
                            <tbody id="wizardTemplatesBody">
        `;
        
        currentTemplates.forEach(t => {
            let freqOptions = `
                <option value="Monthly" ${t.frequency === 'Monthly' ? 'selected' : ''}>${window.i18n.t('opt_freq_monthly')}</option>
                <option value="Yearly" ${t.frequency === 'Yearly' ? 'selected' : ''}>${window.i18n.t('opt_freq_yearly')}</option>
            `;
            if (showBimonthly) {
                freqOptions = `
                    <option value="Bi-Monthly" ${(t.frequency === 'Bi-Monthly' || t.frequency === 'Bi-Weekly') ? 'selected' : ''}>${window.i18n.t('opt_freq_bimonthly')}</option>
                ` + freqOptions;
            }

            wizardHtml += `
                <tr style="border-bottom: 1px solid var(--border-color); transition: opacity 0.2s; ${t.is_closed ? 'opacity: 0.4;' : ''}" id="wizard_row_${t.id}">
                    <td style="padding: 10px; text-align: center;">
                        <input type="checkbox" id="wiz_renew_${t.id}" ${t.is_closed ? '' : 'checked'} style="width: 20px; height: 20px; cursor: pointer;" onchange="window.RecurrenceView.onRowRenewChange(this, '${t.id}')">
                    </td>
                    <td style="padding: 10px; font-weight: bold; font-size: 14px;">${t.description}</td>
                    <td style="padding: 10px;">
                        <select id="wiz_freq_${t.id}" class="inline-input" style="width:100%; font-size: 13px;">
                            ${freqOptions}
                        </select>
                    </td>
                    <td style="padding: 10px;">
                        <select id="wiz_cat_${t.id}" class="inline-input" style="width:100%; font-size: 13px;" onchange="window.RecurrenceView.onWizardCategoryChange(this, '${t.id}')">
                            <option value="">${window.i18n.t('wizard_opt_no_category')}</option>
                            ${categories.filter(c => c.type === 'expense_fixed' || c.name === t.category).map(c => `<option value="${c.name}" ${t.category === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}
                            <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ ${window.i18n.t('wizard_opt_new_category') || 'Nouvelle catégorie...'}</option>
                        </select>
                    </td>
                    <td style="padding: 10px;">
                        <input type="number" id="wiz_amount_${t.id}" class="inline-input" value="${t.amount}" step="0.01" style="width: 100px; font-size: 13px; text-align: right;">
                    </td>
                    <td style="padding: 10px;">
                        <input type="number" id="wiz_day_${t.id}" class="inline-input" value="${t.day_of_month || 1}" min="1" max="31" style="width: 60px; font-size: 13px; text-align: center;">
                    </td>
                </tr>
            `;
        });
        
        wizardHtml += `
                            </tbody>
                        </table>
                        <div style="margin-top: 20px; text-align: center;">
                            <button class="btn btn-secondary" onclick="window.RecurrenceView.addWizardRow()">${window.i18n.t('wizard_btn_add_recurrence')}</button>
                        </div>
                    </div>
                    <div style="padding: 20px; background: var(--bg-surface); border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 15px; flex-shrink: 0;">
                        <button class="btn btn-secondary" style="padding: 15px 30px; font-weight: bold; font-size: 16px;" onclick="window.RecurrenceView.submitWizard(false)">${window.i18n.t('wizard_btn_save_close')}</button>
                        <button class="btn btn-primary" style="padding: 15px 30px; font-weight: bold; font-size: 16px; background: linear-gradient(135deg, #6c5ce7, #a29bfe); border: none;" onclick="window.RecurrenceView.submitWizard(true)">${window.i18n.t('wizard_btn_validate')}</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', wizardHtml);
        this.filterWizardTemplates();
    },
    
    onTargetYearInput() {
        const input = document.getElementById('wizardTargetYear');
        const refSelect = document.getElementById('wizardRefYearSelect');
        if (input && refSelect) {
            const targetYear = parseInt(input.value);
            if (targetYear && targetYear >= 2000) {
                refSelect.value = targetYear - 1;
                this.filterWizardTemplates();
            }
        }
    },
    
    filterWizardTemplates() {
        const refSelect = document.getElementById('wizardRefYearSelect');
        if (!refSelect) return;
        const refYear = parseInt(refSelect.value);
        if (!refYear) return;
        
        // Find active templates for the reference year
        const allTx = this.allTransactions || [];
        const activeTemplateIds = new Set(
            allTx.filter(tx => tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === refYear && tx.recurrence_id != null)
                 .map(tx => tx.recurrence_id)
        );
        
        this.templates.forEach(t => {
            const row = document.getElementById(`wizard_row_${t.id}`);
            if (row) {
                if (activeTemplateIds.has(t.id)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            }
        });
        this.updateMasterCheckbox();
    },
    
    toggleSelectAll(checked) {
        const rows = document.querySelectorAll('#wizardTemplatesBody tr');
        rows.forEach(row => {
            if (row.style.display !== 'none') {
                const checkbox = row.querySelector('input[type="checkbox"][id^="wiz_renew_"]');
                if (checkbox) {
                    checkbox.checked = checked;
                    row.style.opacity = checked ? '1' : '0.4';
                }
            }
        });
    },
    
    onRowRenewChange(checkbox, id) {
        const row = document.getElementById(`wizard_row_${id}`);
        if (row) {
            row.style.opacity = checkbox.checked ? '1' : '0.4';
        }
        this.updateMasterCheckbox();
    },
    
    updateMasterCheckbox() {
        const master = document.getElementById('wizardSelectAll');
        if (!master) return;
        
        const rows = document.querySelectorAll('#wizardTemplatesBody tr');
        let allChecked = true;
        let anyChecked = false;
        let visibleCount = 0;
        
        rows.forEach(row => {
            if (row.style.display !== 'none') {
                const checkbox = row.querySelector('input[type="checkbox"][id^="wiz_renew_"]');
                if (checkbox) {
                    visibleCount++;
                    if (checkbox.checked) {
                        anyChecked = true;
                    } else {
                        allChecked = false;
                    }
                }
            }
        });
        
        if (visibleCount === 0) {
            master.checked = false;
            master.indeterminate = false;
        } else if (allChecked) {
            master.checked = true;
            master.indeterminate = false;
        } else if (anyChecked) {
            master.checked = false;
            master.indeterminate = true;
        } else {
            master.checked = false;
            master.indeterminate = false;
        }
    },
    
    resetFromReferenceYear() {
        const refSelect = document.getElementById('wizardRefYearSelect');
        if (!refSelect) return;
        const refYear = parseInt(refSelect.value);
        if (!refYear) return;
        
        this.templates.forEach(t => {
            // Find transactions of this template in refYear
            const refTx = (this.allTransactions || []).filter(tx => 
                tx.recurrence_id == t.id && 
                tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === refYear
            );
            
            let targetAmt = t.amount;
            let targetCat = t.category || "";
            let targetDay = t.day_of_month || 1;
            
            const renewCheckbox = document.getElementById(`wiz_renew_${t.id}`);
            const row = document.getElementById(`wizard_row_${t.id}`);
            
            if (refTx.length > 0) {
                // Sort descending to get the most recent transaction (lexicographical sort is timezone-independent)
                refTx.sort((a, b) => b.date_operation.localeCompare(a.date_operation));
                const latest = refTx[0];
                targetAmt = latest.amount;
                targetCat = latest.category || "";
                targetDay = parseInt(latest.date_operation.split('-')[2]) || 1;
                
                if (renewCheckbox) renewCheckbox.checked = true;
                if (row) row.style.opacity = '1';
            } else {
                if (renewCheckbox) renewCheckbox.checked = false;
                if (row) row.style.opacity = '0.4';
            }
            
            const amtInput = document.getElementById(`wiz_amount_${t.id}`);
            if (amtInput) amtInput.value = targetAmt;
            const catSelect = document.getElementById(`wiz_cat_${t.id}`);
            if (catSelect) catSelect.value = targetCat;
            const dayInput = document.getElementById(`wiz_day_${t.id}`);
            if (dayInput) dayInput.value = targetDay;
        });
        this.updateMasterCheckbox();
    },
    
    addWizardRow() {
        const body = document.getElementById('wizardTemplatesBody');
        const categories = this.categories || [];
        // Filter categories of type expense_fixed
        const fixedCats = categories.filter(c => c.type === 'expense_fixed');
        const catOptions = fixedCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        const newId = 'new_' + Date.now();
        
        const cfg = window.app.config || {};
        const showBimonthly = (cfg.enable_bimonthly === 'true' || cfg.enable_bimonthly === true);
        
        let freqOptions = `
            <option value="Monthly" selected>${window.i18n.t('opt_freq_monthly')}</option>
            <option value="Yearly">${window.i18n.t('opt_freq_yearly')}</option>
        `;
        if (showBimonthly) {
            freqOptions = `
                <option value="Bi-Monthly">${window.i18n.t('opt_freq_bimonthly')}</option>
            ` + freqOptions;
        }

        const row = `
            <tr style="border-bottom: 1px solid var(--border-color); background: rgba(108, 92, 231, 0.05);" class="wizard-new-row" data-id="${newId}">
                <td style="padding: 10px; text-align: center;">
                    <span title="${window.i18n.t('wizard_new_recurrence_title')}">✨</span>
                </td>
                <td style="padding: 10px;">
                    <input type="text" id="wiz_desc_${newId}" class="inline-input" placeholder="${window.i18n.t('col_description')}" style="width: 100%; font-size: 13px;">
                </td>
                <td style="padding: 10px;">
                    <select id="wiz_freq_${newId}" class="inline-input" style="width: 100%; font-size: 13px;">
                        ${freqOptions}
                    </select>
                </td>
                <td style="padding: 10px;">
                    <select id="wiz_cat_${newId}" class="inline-input" style="width:100%; font-size: 13px;" onchange="window.RecurrenceView.onWizardCategoryChange(this, '${newId}')">
                        <option value="">${window.i18n.t('wizard_opt_no_category')}</option>
                        ${catOptions}
                        <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ ${window.i18n.t('wizard_opt_new_category') || 'Nouvelle catégorie...'}</option>
                    </select>
                </td>
                <td style="padding: 10px;">
                    <input type="number" id="wiz_amount_${newId}" class="inline-input" placeholder="0.00" step="0.01" style="width: 100px; font-size: 13px; text-align: right;">
                </td>
                <td style="padding: 10px;">
                    <input type="number" id="wiz_day_${newId}" class="inline-input" value="1" min="1" max="31" style="width: 60px; font-size: 13px; text-align: center;">
                </td>
            </tr>
        `;
        body.insertAdjacentHTML('beforeend', row);
    },
    
    async onWizardCategoryChange(select, id) {
        if (select.value === '__new__') {
            const title = window.i18n.t('wizard_prompt_new_category_title') || 'Nom de la nouvelle catégorie de dépenses fixes :';
            const name = await showInlinePrompt(title);
            if (name && name.trim()) {
                try {
                    const newCat = await API.post('/api/categories/', { name: name.trim(), type: 'expense_fixed' });
                    
                    const categories = await API.get('/api/categories/');
                    this.categories = categories;
                    
                    const fixedCategories = categories.filter(c => c.type === 'expense_fixed');
                    
                    this.templates.forEach(tpl => {
                        const sel = document.getElementById(`wiz_cat_${tpl.id}`);
                        if (sel) {
                            const val = (tpl.id == id) ? newCat.name : sel.value;
                            this.updateWizardCategorySelectOptions(sel, fixedCategories, val, tpl.category);
                        }
                    });
                    
                    document.querySelectorAll('.wizard-new-row').forEach(row => {
                        const rowId = row.getAttribute('data-id');
                        const sel = document.getElementById(`wiz_cat_${rowId}`);
                        if (sel) {
                            const val = (rowId == id) ? newCat.name : sel.value;
                            this.updateWizardCategorySelectOptions(sel, fixedCategories, val);
                        }
                    });
                    
                    showToast(window.i18n.t('msg_category_added') || 'Catégorie ajoutée');
                } catch (e) {
                    console.error("Failed to create category in wizard", e);
                    showToast(window.i18n.t('msg_category_create_error') || 'Erreur lors de la création de la catégorie', 'error');
                    select.value = '';
                }
            } else {
                select.value = '';
            }
        }
    },
    
    updateWizardCategorySelectOptions(selectElement, fixedCategories, currentValue, originalCategoryValue = null) {
        const noCatLabel = window.i18n.t('wizard_opt_no_category') || '-- Catégorie --';
        const newCatLabel = window.i18n.t('wizard_opt_new_category') || 'Nouvelle catégorie...';
        
        const displayCategories = [...fixedCategories];
        if (originalCategoryValue && !displayCategories.some(c => c.name === originalCategoryValue)) {
            displayCategories.push({ name: originalCategoryValue, type: 'other' });
        }
        
        let html = `<option value="">${noCatLabel}</option>`;
        html += displayCategories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        html += `<option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ ${newCatLabel}</option>`;
        
        selectElement.innerHTML = html;
        selectElement.value = currentValue;
    },
    
    async submitWizard(generateInstances = true) {
        const targetYear = parseInt(document.getElementById('wizardTargetYear').value);
        if (!targetYear || targetYear < 2000) return;
        
        const updates = [];
        this.templates.forEach(t => {
            const row = document.getElementById(`wizard_row_${t.id}`);
            const isVisible = row && row.style.display !== 'none';
            
            const renewVal = isVisible && (document.getElementById(`wiz_renew_${t.id}`)?.checked || false);
            const amountEl = document.getElementById(`wiz_amount_${t.id}`);
            const dayEl = document.getElementById(`wiz_day_${t.id}`);
            const catEl = document.getElementById(`wiz_cat_${t.id}`);
            const freqEl = document.getElementById(`wiz_freq_${t.id}`);
            
            updates.push({
                id: t.id,
                renew: renewVal,
                amount: amountEl ? (parseFloat(amountEl.value) || 0) : t.amount,
                day_of_month: dayEl ? (parseInt(dayEl.value) || 1) : t.day_of_month,
                category: catEl ? (catEl.value || null) : t.category,
                frequency: freqEl ? freqEl.value : t.frequency
            });
        });
        
        const newTemplates = [];
        document.querySelectorAll('.wizard-new-row').forEach(row => {
            const newId = row.getAttribute('data-id');
            const desc = document.getElementById(`wiz_desc_${newId}`).value.trim();
            if (desc) {
                newTemplates.push({
                    description: desc,
                    amount: parseFloat(document.getElementById(`wiz_amount_${newId}`).value) || 0,
                    type: "expense_fixed", // par défaut
                    category: document.getElementById(`wiz_cat_${newId}`).value || null,
                    frequency: document.getElementById(`wiz_freq_${newId}`).value,
                    day_of_month: parseInt(document.getElementById(`wiz_day_${newId}`).value) || 1
                });
            }
        });
        
        try {
            const btn = document.querySelector('#recWizardModal .btn-primary');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ Génération...';
            }
            
            await API.post('/api/recurrences/wizard_generate', {
                target_year: targetYear,
                updates: updates,
                new_templates: newTemplates,
                generate_instances: generateInstances
            });
            if (generateInstances) {
                await showInlineMessage(window.i18n.t('title_success'), window.i18n.t('wizard_msg_success'));
            }
            document.getElementById('recWizardModal').remove();
            
            if (generateInstances) {
                this.selectedYear = targetYear;
                const display = document.getElementById('recYearDisplay');
                if (display) display.textContent = this.selectedYear;
            }
            window.app.refreshSidebar();
            await this.loadData();
            
        } catch (e) {
            console.error(e);
            await showInlineMessage("Erreur", "Une erreur s'est produite lors de la génération.");
            const btn = document.querySelector('#recWizardModal .btn-primary');
            if (btn) {
                btn.disabled = false;
                btn.textContent = window.i18n.t('wizard_btn_validate');
            }
        }
    }
};
