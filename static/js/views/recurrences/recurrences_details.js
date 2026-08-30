// static/js/views/recurrences/recurrences_details.js — Tiroir de détails des opérations annuelles & propagation
window.RecurrenceView = Object.assign(window.RecurrenceView || {}, {
    async toggleReconciliationInDetails(txId, templateId) {
        await window.ReconciliationActions.toggle(txId, {
            refreshView: () => this.loadData()
        });
    },

    toggleRow(templateId) {
        const detailsRow = document.getElementById(`details_row_${templateId}`);
        const chevron = document.getElementById(`chevron_${templateId}`);
        if (!detailsRow) return;
        
        if (this.expandedTemplateIds.has(templateId)) {
            this.expandedTemplateIds.delete(templateId);
            detailsRow.style.setProperty('display', 'none', 'important');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        } else {
            this.expandedTemplateIds.add(templateId);
            const disp = (this.currentViewMode === 'timeline' || window.innerWidth <= 1024) ? 'block' : 'table-row';
            detailsRow.style.setProperty('display', disp, 'important');
            if (chevron) chevron.style.transform = 'rotate(90deg)';
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
        
        const hasChanges = templateTx.some(tx => this.modifiedRows.has(tx.id));
        const buttonDisplay = hasChanges ? 'inline-block' : 'none';

        const tpl = (this.templates || []).find(t => t.id === templateId);

        let instancesHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4 style="margin: 0; color: var(--text-muted); font-size: 14px; font-weight: bold;">${window.i18n.t('rec_year_details_title') || 'Détails des opérations de l\'année'}</h4>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <button id="save_btn_${templateId}" class="btn btn-primary" style="display: ${buttonDisplay}; padding: 6px 15px; font-size: 13px; font-weight: bold;" onclick="window.RecurrenceView.saveTemplateChanges(${templateId})">${window.i18n.t('btn_save_changes') || 'Sauvegarder les modifications'}</button>
                    <div style="display: flex; gap: 6px; border-left: 1px solid var(--border-color); padding-left: 10px;">
                        <button class="btn btn-secondary" style="padding: 5px 9px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='var(--primary-color, #6366f1)'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.openEditModal(${templateId})" title="${window.i18n.t('tooltip_edit') || 'Modifier'}">✏️</button>
                        ${tpl && tpl.is_closed
                            ? `<button class="btn btn-secondary" style="padding: 5px 9px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='#10b981'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.reopenTemplate(${templateId})" title="${window.i18n.t('tooltip_reopen') || 'Rouvrir'}">🔓</button>`
                            : `<button class="btn btn-secondary" style="padding: 5px 9px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='#f59e0b'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.showCloseModal(${templateId})" title="${window.i18n.t('tooltip_close') || 'Clôturer'}">🛑</button>`
                        }
                        <button class="btn btn-secondary btn-delete" style="padding: 5px 9px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='var(--danger, #ff5630)'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.deleteTemplate(${templateId})" title="${window.i18n.t('tooltip_delete') || 'Delete'}">🗑️</button>
                    </div>
                </div>
            </div>
            <div class="rec-instance-header" style="display: grid; grid-template-columns: 1fr 1fr 110px 140px; gap: 10px; margin-bottom: 10px; padding: 0 10px; font-weight: bold; color: var(--text-muted); text-align: center; font-size: 13px;">
                <div data-i18n="rec_col_date">${window.i18n.t('rec_col_date')}</div>
                <div data-i18n="rec_col_amount">${window.i18n.t('rec_col_amount')}</div>
                <div data-i18n="rec_col_status" data-i18n="rec_col_status">${window.i18n.t('rec_col_status') || 'Statut'}</div>
                <div></div>
            </div>
            <div class="rec-instances-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto; padding-right: 4px;">
        `;
        
        instancesHtml += templateTx.map(tx => {
            const isModified = this.modifiedRows.has(tx.id);
            const isSkipped = tx.is_skipped === true;
            const isReconciled = tx.reconciliation_date != null && !isSkipped;
            
            const justPropagated = (this.lastPropagate && this.lastPropagate.txId === tx.id);
            
            let bg = isModified ? 'rgba(51, 102, 255, 0.05)' : (isReconciled ? 'var(--bg-base)' : 'var(--bg-surface)');
            if (isSkipped) {
                bg = 'rgba(100, 116, 139, 0.05)';
            }
            const opClass = (isReconciled || isSkipped) ? 'opacity: 0.6;' : '';
            const readonly = (isReconciled || isSkipped) ? 'readonly disabled' : '';
            
            const dateStr = tx.date_operation.split('T')[0];
            
            let actionBtn = '';
            if (justPropagated) {
                const oldAmtStr = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(this.lastPropagate.oldAmount);
                actionBtn = `<button class="btn btn-danger" style="padding: 5px; font-size: 11px; width: 100%; white-space: normal;" onclick="window.RecurrenceView.undoPropagate(${templateId})">Annuler (Retour à ${oldAmtStr})</button>`;
            } else if (isModified && !isReconciled) {
                actionBtn = `<button class="btn btn-primary" style="padding: 5px; font-size: 11px; width: 100%; white-space: normal;" onclick="window.RecurrenceView.propagate(${tx.id})" data-i18n="btn_propagate_down">Propager vers le bas ⬇️</button>`;
            }

            let statusHTML = '';
            if (isReconciled) {
                statusHTML = `<span class="badge" style="background: rgba(54, 179, 126, 0.15); color: var(--success); padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; white-space: nowrap;" onclick="event.stopPropagation(); window.RecurrenceView.showSegmentPopover(${tx.id}, ${templateId}, this)">✅ ${window.i18n.t('rec_gantt_status_reconciled') || 'Rapprochée'}</span>`;
            } else if (isSkipped) {
                statusHTML = `<span class="badge" style="background: rgba(145, 158, 171, 0.15); color: var(--text-muted); padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; text-decoration: line-through; white-space: nowrap;" onclick="event.stopPropagation(); window.RecurrenceView.showSegmentPopover(${tx.id}, ${templateId}, this)">⏭️ ${window.i18n.t('rec_gantt_status_skipped') || 'Ignoré'}</span>`;
            } else {
                statusHTML = `<span class="badge" style="background: rgba(51, 102, 255, 0.12); color: var(--accent); padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; white-space: nowrap;" onclick="event.stopPropagation(); window.RecurrenceView.showSegmentPopover(${tx.id}, ${templateId}, this)">⏳ ${window.i18n.t('rec_gantt_status_pending') || 'En attente'}</span>`;
            }
 
            return `
            <div class="rec-instance-row" style="display: grid; grid-template-columns: 1fr 1fr 110px 140px; gap: 10px; align-items: center; background: ${bg}; padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); ${opClass}">
                <input type="date" id="rec_date_${tx.id}" class="inline-input" value="${dateStr}" style="text-align: center; font-size: 13px;" onchange="window.RecurrenceView.markTemplateRowModified(${tx.id}, ${templateId})" ${readonly}>
                <input type="number" id="rec_amount_${tx.id}" class="inline-input" value="${tx.amount}" step="0.01" style="text-align: center; font-size: 13px;" onchange="window.RecurrenceView.markTemplateRowModified(${tx.id}, ${templateId})" ${readonly}>
                <div style="text-align: center; display: flex; justify-content: center; align-items: center;">${statusHTML}</div>
                <div>${actionBtn}</div>
            </div>
            `;
        }).join('');
        
        instancesHtml += `</div>`;
        container.innerHTML = instancesHtml;
    },
    async toggleSkipInDetails(txId, templateId) {
        try {
            await API.post(`/api/transactions/${txId}/toggle_skip`);
            window.app.refreshSidebar();
            await this.loadData();
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la modification", "error");
        }
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
            const title = window.i18n.t('wizard_prompt_new_category_title') || 'Name of the new fixed expense category:';
            const name = await showInlinePrompt(title);
            if (name && name.trim()) {
                try {
                    const newCat = await API.post('/api/categories/', { name: name.trim(), type: 'expense_fixed' });
                    await API.patch(`/api/recurrences/${templateId}/category`, { category: newCat.name });
                    showToast(window.i18n.t('msg_category_added') || 'Category added');
                } catch (e) {
                    let isConflict = false;
                    let msg = e.message || '';
                    try {
                        const parsed = JSON.parse(e.message);
                        msg = parsed.detail || e.message;
                    } catch(err) {}

                    if (msg.includes("already exists") || msg.includes("déjà")) {
                        isConflict = true;
                    }

                    if (isConflict) {
                        const suffix = window.i18n.t('cat_suffix_fixed') || ' (Fixes)';
                        const suggestedName = `${name.trim()}${suffix}`;
                        const suffixPromptMsg = window.i18n.tp('cat_conflict_suffix_prompt', { name: name.trim(), suggestedName: suggestedName });

                        if (await showInlineConfirm(window.i18n.t('cat_conflict_title') || "Conflit de catégorie", suffixPromptMsg)) {
                            try {
                                const newCat = await API.post('/api/categories/', { name: suggestedName, type: 'expense_fixed' });
                                await API.patch(`/api/recurrences/${templateId}/category`, { category: newCat.name });
                                showToast(window.i18n.t('msg_category_added') || 'Category added');
                                await this.loadData();
                                return;
                            } catch(errSuffix) {
                                showToast(window.i18n.t('msg_category_create_error') || 'Category creation error', 'error');
                                return;
                            }
                        }

                        const confirmMsg = window.i18n.tp('cat_conflict_confirm', { name: name });
                        if (await showInlineConfirm(window.i18n.t('cat_conflict_title') || "Conflit de catégorie", confirmMsg)) {
                            try {
                                const newCat = await API.post('/api/categories/?force_move=true', { name: name.trim(), type: 'expense_fixed' });
                                await API.patch(`/api/recurrences/${templateId}/category`, { category: newCat.name });
                                showToast(window.i18n.t('msg_category_added') || 'Category added');
                            } catch(err2) {
                                showToast(window.i18n.t('cat_move_error') || "Erreur lors du déplacement de la catégorie", "error");
                            }
                        }
                    } else {
                        console.error("Failed to create category", e);
                        showToast(window.i18n.t('msg_category_create_error') || 'Category creation error', 'error');
                    }
                }
            }
            await this.loadData();
        } else {
            try {
                await API.patch(`/api/recurrences/${templateId}/category`, { category: val || null });
                showToast(window.i18n.t('cat_updated') || "Catégorie mise à jour");
            } catch (e) {
                console.error(e);
                showToast(window.i18n.t('cat_update_error') || "Erreur lors de la mise à jour de la catégorie", "error");
            }
            await this.loadData();
        }
    },


});
