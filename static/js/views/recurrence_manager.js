window.RecurrenceView = {
    templates: [],
    transactions: [],
    selectedYear: new Date().getFullYear(),
    selectedTemplateId: null,
    modifiedRows: new Set(),
    
    render() {
        return `
            <div class="view-header" style="margin-bottom:20px;">
                <h2>🔄 <span data-i18n="nav_recurrences">Récurrences</span></h2>
                
                <div style="background: var(--bg-surface); padding: 20px; border-radius: 12px; margin-top: 20px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                    <div style="display: flex; gap: 15px; align-items: center; justify-content: center; margin-bottom: 20px;">
                        <button class="btn btn-secondary" style="padding: 5px 15px;" onclick="window.RecurrenceView.changeYear(-1)">&lt;</button>
                        <h3 style="margin: 0; width: 80px; text-align: center; font-size: 24px;" id="recYearDisplay">${this.selectedYear}</h3>
                        <button class="btn btn-secondary" style="padding: 5px 15px;" onclick="window.RecurrenceView.changeYear(1)">&gt;</button>
                    </div>
                    
                    <div style="display: flex; justify-content: center;">
                        <select id="recTemplateSelect" class="inline-input" style="width: 100%; max-width: 400px; font-size: 16px; padding: 10px;" onchange="window.RecurrenceView.selectTemplate(this.value)">
                            <option value="" data-i18n="rec_select_recurrence">${window.i18n.t('rec_select_recurrence')}</option>
                        </select>
                    </div>
                </div>
            </div>

            <div id="recDetailsContainer" style="display: none; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); flex-wrap: wrap; gap: 40px;">
                <div style="flex: 2; min-width: 300px;">
                    <h4 style="margin-top: 0; margin-bottom: 15px; color: var(--text-muted); text-align: center;" data-i18n="rec_year_details_title">${window.i18n.t('rec_year_details_title')}</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 140px; gap: 10px; margin-bottom: 10px; padding: 0 10px; font-weight: bold; color: var(--text-muted); text-align: center; font-size: 14px;">
                        <div data-i18n="rec_col_date">${window.i18n.t('rec_col_date')}</div>
                        <div data-i18n="rec_col_amount">${window.i18n.t('rec_col_amount')}</div>
                        <div></div>
                    </div>
                    <div id="recInstancesBody" style="display: flex; flex-direction: column; gap: 8px;">
                        <!-- Rendered dynamically -->
                    </div>
                </div>
                
                <div style="flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 15px; justify-content: center; padding-left: 20px; border-left: 1px dashed var(--border-color);">
                    <button class="btn btn-danger" style="padding: 15px;" onclick="window.RecurrenceView.deleteOperations()" data-i18n="btn_delete_recurrence">${window.i18n.t('btn_delete_recurrence')}</button>
                    <div style="flex: 1; min-height: 50px;"></div>
                    <button class="btn btn-primary" style="padding: 15px; font-weight: bold;" onclick="window.RecurrenceView.saveAll()" data-i18n="btn_save_changes">${window.i18n.t('btn_save_changes')}</button>
                </div>
            </div>
        `;
    },

    async init() {
        this.selectedYear = new Date().getFullYear();
        this.selectedTemplateId = null;
        this.modifiedRows.clear();
        await this.loadData();
    },

    async loadData() {
        try {
            this.templates = await API.get('/api/recurrences/');
            await this.refreshTransactions();
        } catch (e) {
            console.error("Failed to load recurrences", e);
        }
    },
    
    async refreshTransactions() {
        try {
            // Fetch all operations and filter locally
            const allTx = await API.get('/api/transactions/?limit=10000');
            
            // Find active templates for this year
            const activeTemplateIds = new Set(
                allTx.filter(tx => new Date(tx.date_operation).getFullYear() === this.selectedYear && tx.recurrence_id != null)
                     .map(tx => tx.recurrence_id)
            );
            
            // Re-populate the template select box
            const select = document.getElementById('recTemplateSelect');
            if (select) {
                const currentVal = this.selectedTemplateId || "";
                select.innerHTML = `<option value="" data-i18n="rec_select_recurrence">${window.i18n.t('rec_select_recurrence')}</option>` + 
                    this.templates
                        .filter(t => activeTemplateIds.has(t.id))
                        .sort((a,b) => a.description.localeCompare(b.description))
                        .map(t => `<option value="${t.id}">${t.description}</option>`)
                        .join('');
                select.value = currentVal;
                
                // If the selected template is no longer valid for this year, deselect it
                if (currentVal && !activeTemplateIds.has(parseInt(currentVal))) {
                    this.selectedTemplateId = null;
                    select.value = "";
                }
            }

            const container = document.getElementById('recDetailsContainer');
            if (!this.selectedTemplateId) {
                if(container) container.style.display = 'none';
                return;
            }
            
            this.transactions = allTx.filter(tx => 
                tx.recurrence_id == this.selectedTemplateId && 
                new Date(tx.date_operation).getFullYear() === this.selectedYear
            ).sort((a, b) => new Date(a.date_operation) - new Date(b.date_operation));
            
            // Backup original values for undo functionality
            this.transactions.forEach(t => {
                t._original_amount = t.amount;
                t._original_date = t.date_operation;
            });
            
            this.modifiedRows.clear();
            this.renderDetails();
        } catch (e) {
            console.error("Failed to load transactions", e);
        }
    },

    changeYear(delta) {
        this.selectedYear += delta;
        this.lastPropagate = null; // Reset undo state on year change
        const display = document.getElementById('recYearDisplay');
        if (display) display.textContent = this.selectedYear;
        this.refreshTransactions();
    },
    
    selectTemplate(val) {
        this.selectedTemplateId = val ? parseInt(val) : null;
        this.lastPropagate = null; // Reset undo state on template change
        this.refreshTransactions();
    },
    
    markModified(txId) {
        const dateInput = document.getElementById(`rec_date_${txId}`);
        const amountInput = document.getElementById(`rec_amount_${txId}`);
        
        if (dateInput && amountInput) {
            const tx = this.transactions.find(t => t.id === txId);
            if (tx) {
                // Save user input into local state before re-rendering
                tx.date_operation = dateInput.value;
                tx.amount = parseFloat(amountInput.value) || 0;
            }
        }
        
        this.modifiedRows.add(txId);
        this.renderDetails();
    },

    renderDetails() {
        const container = document.getElementById('recDetailsContainer');
        const body = document.getElementById('recInstancesBody');
        
        if (!this.selectedTemplateId || !container || !body) {
            if(container) container.style.display = 'none';
            return;
        }
        
        container.style.display = 'flex';
        
        if (this.transactions.length === 0) {
            body.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">${window.i18n.t('msg_no_operations_this_year')}</div>`;
            return;
        }
        
        let instancesHtml = this.transactions.map(tx => {
            const isModified = this.modifiedRows.has(tx.id);
            const isReconciled = tx.reconciliation_date != null;
            
            const justPropagated = (this.lastPropagate && this.lastPropagate.txId === tx.id);
            
            const bg = isModified ? 'rgba(51, 102, 255, 0.05)' : (isReconciled ? 'var(--bg-base)' : 'var(--bg-surface)');
            const opClass = isReconciled ? 'opacity: 0.6;' : '';
            const readonly = isReconciled ? 'readonly disabled' : '';
            
            // For date input we need YYYY-MM-DD
            const dateStr = tx.date_operation.split('T')[0];
            
            let actionBtn = '';
            if (justPropagated) {
                const oldAmtStr = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(this.lastPropagate.oldAmount);
                actionBtn = `<button class="btn btn-danger" style="padding: 5px; font-size: 11px; width: 100%; white-space: normal;" onclick="window.RecurrenceView.undoPropagate()">Annuler (Retour à ${oldAmtStr})</button>`;
            } else if (isModified && !isReconciled) {
                actionBtn = `<button class="btn btn-primary" style="padding: 5px; font-size: 11px; width: 100%; white-space: normal;" onclick="window.RecurrenceView.propagate(${tx.id})" data-i18n="btn_propagate_down">Propager vers le bas ⬇️</button>`;
            }

            return `
            <div class="rec-instance-row" style="display: grid; grid-template-columns: 1fr 1fr 140px; gap: 10px; align-items: center; background: ${bg}; padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); ${opClass}">
                <input type="date" id="rec_date_${tx.id}" class="inline-input" value="${dateStr}" style="text-align: center;" onchange="window.RecurrenceView.markModified(${tx.id})" ${readonly}>
                <input type="number" id="rec_amount_${tx.id}" class="inline-input" value="${tx.amount}" step="0.01" style="text-align: center;" onchange="window.RecurrenceView.markModified(${tx.id})" ${readonly}>
                <div>${actionBtn}</div>
            </div>
            `;
        }).join('');
        
        body.innerHTML = instancesHtml;
    },

    async saveAll() {
        if (this.modifiedRows.size === 0) {
            return;
        }
        
        const btn = document.querySelector('[data-i18n="btn_save_changes"]');
        const originalText = btn ? btn.textContent : '';
        
        try {
            // Visual: saving state
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ ...';
                btn.style.opacity = '0.7';
            }
            
            for (let id of this.modifiedRows) {
                const dateVal = document.getElementById(`rec_date_${id}`).value;
                const amountVal = parseFloat(document.getElementById(`rec_amount_${id}`).value);
                await API.put(`/api/transactions/${id}`, {
                    date_operation: dateVal,
                    amount: amountVal
                });
            }
            
            // Visual: success state
            if (btn) {
                btn.textContent = '✅ ' + window.i18n.t('btn_saved');
                btn.style.opacity = '1';
                btn.style.transition = 'background 0.3s';
                btn.style.background = 'var(--success, #2ecc71)';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                    btn.disabled = false;
                }, 2000);
            }
            
            window.app.refreshSidebar();
            await this.refreshTransactions();
        } catch (e) {
            console.error("Save error", e);
            if (btn) {
                btn.textContent = '❌ ' + window.i18n.t('title_error');
                btn.style.background = 'var(--danger, #e74c3c)';
                btn.style.opacity = '1';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = '';
                    btn.disabled = false;
                }, 2000);
            }
            await showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_save_error_generic'));
        }
    },
    
    async propagate(txId) {
        const dateVal = document.getElementById(`rec_date_${txId}`).value;
        const amountVal = parseFloat(document.getElementById(`rec_amount_${txId}`).value);
        
        if (!dateVal || isNaN(amountVal)) return;
        
        const originalTx = this.transactions.find(t => t.id === txId);
        if (!originalTx) return;
        
        try {
            const res = await API.post(`/api/recurrences/${this.selectedTemplateId}/propagate`, {
                transaction_id: txId,
                new_amount: amountVal,
                new_date: dateVal
            });
            window.app.refreshSidebar();
            
            // Save state for undo using the TRULY original values before user modified them
            this.lastPropagate = {
                txId: txId,
                oldDate: originalTx._original_date.split('T')[0],
                oldAmount: originalTx._original_amount
            };
            
            await this.refreshTransactions();
            
            // Highlight updated inputs successfully
            setTimeout(() => {
                const affectedRows = this.transactions.filter(t => t.date_operation >= dateVal);
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
    
    async undoPropagate() {
        if (!this.lastPropagate) return;
        const p = this.lastPropagate;
        try {
            await API.post(`/api/recurrences/${this.selectedTemplateId}/propagate`, {
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

    async deleteOperations() {
        if (!this.selectedTemplateId) return;
        
        if (await showInlineConfirm(window.i18n.t('title_deletion'), window.i18n.t('confirm_delete_template'))) {
            try {
                await API.del(`/api/recurrences/${this.selectedTemplateId}`);
                await showInlineMessage(window.i18n.t('title_success'), window.i18n.t('msg_template_deleted'));
                this.selectedTemplateId = null;
                window.app.refreshSidebar();
                await this.loadData();
            } catch (e) {
                console.error(e);
            }
        }
    }
};
