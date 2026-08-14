// static/js/views/recurrences/recurrences_timeline.js — Vues Tableau & Chronogramme Gantt 12 mois
window.RecurrenceView = Object.assign(window.RecurrenceView || {}, {
    renderTableView(tableContainer, displayTemplates) {
        let tableHtml = `
            <div class="table-responsive" style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
                 <table class="data-table mobile-card-table" style="width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 10px;">
                    <thead>
                        <tr style="text-align: left; background: rgba(0, 0, 0, 0.02); border-bottom: 2px solid var(--border-color); user-select: none;">
                            <th style="width: 3px; padding: 0; overflow: visible;"></th>
                            <th style="padding: 12px; width: 45px; text-align: center;"></th>
                            <th style="padding: 12px; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('description')">${window.i18n.t('col_description')} ${this.getSortArrow('description')}</th>
                            <th style="padding: 12px; width: 170px; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('category')">${window.i18n.t('col_category')} ${this.getSortArrow('category')}</th>
                            <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('frequency')">${window.i18n.t('wizard_th_frequency') || 'Frequency'} ${this.getSortArrow('frequency')}</th>
                            <th style="padding: 12px; width: 100px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('status')">${window.i18n.t('col_status')} ${this.getSortArrow('status')}</th>
                            <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('day')">${window.i18n.t('wizard_th_day') || 'Day of month'} ${this.getSortArrow('day')}</th>
                            <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('progress')">${window.i18n.t('col_progress') || 'Progression'} ${this.getSortArrow('progress')}</th>
                            <th style="padding: 12px; width: 120px; text-align: right; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('amount')">${window.i18n.t('col_amount')} ${this.getSortArrow('amount')}</th>
                            <th style="padding: 12px; width: 140px; text-align: right; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('annual_total')">${window.i18n.t('col_total_annual') || 'Annual Total'} ${this.getSortArrow('annual_total')}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        displayTemplates.forEach(t => {
            const isExpanded = this.expandedTemplateIds.has(t.id);
            const chevronStyle = `display: inline-block; transition: transform 0.2s ease; transform: ${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}; font-size: 11px; color: var(--text-muted); cursor: pointer;`;
            const displayStyle = isExpanded ? 'table-row' : 'none';
            
            const typeColors = this.getTypeColors(t);
            const freqLabel = window.i18n.t('rec_' + t.frequency.toLowerCase()) || t.frequency;
            
            let badgeStyle = '';
            const freq = t.frequency.toLowerCase();
            if (freq === 'monthly') {
                badgeStyle = 'background: rgba(51, 102, 255, 0.1); color: var(--accent); border: 1px solid rgba(51, 102, 255, 0.2);';
            } else if (freq === 'yearly') {
                badgeStyle = 'background: rgba(139, 92, 246, 0.1); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.2);';
            } else if (freq === 'weekly') {
                badgeStyle = 'background: rgba(245, 158, 11, 0.1); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.2);';
            } else if (freq === 'quarterly') {
                badgeStyle = 'background: rgba(14, 165, 233, 0.1); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, 0.2);';
            } else if (freq === 'semi-annually') {
                badgeStyle = 'background: rgba(236, 72, 153, 0.1); color: #ec4899; border: 1px solid rgba(236, 72, 153, 0.2);';
            } else {
                badgeStyle = 'background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2);';
            }
            const badgeHtml = `<span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; ${badgeStyle}">${freqLabel}</span>`;
            
            const statusLabel = t.is_closed ? window.i18n.t('rec_status_closed') : window.i18n.t('rec_status_active');
            const statusBadgeStyle = t.is_closed 
                ? 'background: rgba(100, 116, 139, 0.1); color: #64748b; border: 1px solid rgba(100, 116, 139, 0.2);' 
                : 'background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2);';
            const statusBadgeHtml = `<span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; ${statusBadgeStyle}">${statusLabel}</span>`;
            
            const catOptionsHtml = (this.categories || [])
                .filter(c => !c.is_closed || c.name === t.category)
                .map(c => `<option value="${c.name}" ${t.category === c.name ? 'selected' : ''}>${c.name}</option>`)
                .join('');
            
            tableHtml += `
                <tr id="rec-row-${t.id}" onclick="window.RecurrenceView.toggleRow(${t.id})" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(99,102,241,0.03)'" onmouseout="this.style.backgroundColor=''">
                    <td style="width: 3px; min-width: 3px; max-width: 3px; padding: 0; position: relative; overflow: visible;" onclick="event.stopPropagation()">
                        <div style="position: absolute; top: 0; bottom: 0; left: -2px; width: 3px; background: ${typeColors.border}; box-shadow: -3px 0 8px -1px ${typeColors.border}; cursor: help;" title="${typeColors.label}"></div>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <span id="chevron_${t.id}" style="${chevronStyle}">❯</span>
                    </td>
                    <td data-label="Description" style="padding: 12px; font-weight: 600; color: var(--text-main); font-size: 14px;">${t.description}</td>
                    <td data-label="${window.i18n.t('col_category') || 'Catégorie'}" style="padding: 6px 12px;" onclick="event.stopPropagation()">
                        <select class="inline-input" style="padding: 4px 8px; border-radius: 6px; font-size: 13px; width: 100%; border: 1px solid var(--border-color); background: var(--bg-surface); cursor: pointer;" onchange="window.RecurrenceView.changeTemplateCategory(this, ${t.id})">
                            <option value="">-- Sans catégorie --</option>
                            ${catOptionsHtml}
                            <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ Nouvelle catégorie...</option>
                        </select>
                    </td>
                    <td data-label="${window.i18n.t('wizard_th_frequency') || 'Fréquence'}" style="padding: 12px; text-align: center;">${badgeHtml}</td>
                    <td data-label="${window.i18n.t('col_status') || 'Statut'}" style="padding: 12px; text-align: center;">${statusBadgeHtml}</td>
                    <td data-label="${window.i18n.t('wizard_th_day') || 'Jour'}" style="padding: 12px; text-align: center; font-size: 13px; color: var(--text-muted); font-weight: 500;">${t.day_of_month || 1}</td>
                    <td data-label="${window.i18n.t('col_progress') || 'Progression'}" style="padding: 12px; text-align: center;" onclick="event.stopPropagation()">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; min-width: 90px;">
                            <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden; border: 1px solid var(--border-color);">
                                <div style="width: ${t.progressPct}%; height: 100%; background: ${t.progressPct === 100 ? 'linear-gradient(90deg, #2ecc71, #27ae60)' : 'linear-gradient(90deg, var(--accent, #6c5ce7), #a29bfe)'}; border-radius: 3px; transition: width 0.3s ease;"></div>
                            </div>
                            <span style="font-size: 11px; font-weight: 600; color: var(--text-muted);">${t.progressPct}% <span style="font-size: 10px; font-weight: 500; opacity: 0.7;">(${t.reconciledCount}/${t.totalCount})</span></span>
                        </div>
                    </td>
                    <td data-label="${window.i18n.t('col_amount') || 'Montant'}" style="padding: 12px; text-align: right; font-weight: 600; color: ${typeColors.text}; font-size: 13px;">${formatCurrency(t.displayAmount)}</td>
                    <td data-label="${window.i18n.t('col_total_annual') || 'Total Annuel'}" style="padding: 12px; text-align: right; font-weight: 700; color: ${typeColors.text}; font-size: 14px;"><span class="privacy-blur">${formatCurrency(t.totalAnnualAmount)}</span></td>
                </tr>
                <tr id="details_row_${t.id}" class="rec-details-row" style="display: ${displayStyle}; background: var(--bg-sidebar);">
                    <td colspan="10" class="rec-details-cell" style="padding: 15px 20px; border-bottom: 1px solid var(--border-color);">
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
            </div>
        `;
        tableContainer.innerHTML = tableHtml;
        
        this.expandedTemplateIds.forEach(id => {
            this.renderTemplateDetails(id);
        });
    },

    renderTimelineView(tableContainer, displayTemplates) {
        const locale = window.i18n.locale || 'fr';
        
        // Build month headers
        let monthHeaders = '';
        for (let m = 0; m < 12; m++) {
            const dateSample = new Date(this.selectedYear, m, 1);
            const monthLabel = new Intl.DateTimeFormat(locale, { month: 'short' }).format(dateSample);
            const capitalizedMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
            monthHeaders += `<div>${capitalizedMonth}</div>`;
        }
        
        let timelineHtml = `
            <div style="border: 1px solid var(--border-color); border-radius: 10px; margin-top: 10px;">
                <div class="gantt-header">
                    <div style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: var(--text-muted);">Description</div>
                    <div class="gantt-header-months">${monthHeaders}</div>
                </div>
        `;
        
        displayTemplates.forEach(t => {
            const isExpanded = this.expandedTemplateIds.has(t.id);
            const chevronStyle = `display: inline-block; transition: transform 0.2s ease; transform: ${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}; font-size: 11px; color: var(--text-muted); cursor: pointer;`;
            const typeColors = this.getTypeColors(t);
            const freqLabel = window.i18n.t('rec_' + t.frequency.toLowerCase()) || t.frequency;
            
            const templateTx = (this.allTransactions || []).filter(tx => 
                tx.recurrence_id == t.id && 
                tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear
            );
            
            // Build month-indexed segments
            let segmentsHtml = '';
            for (let m = 0; m < 12; m++) {
                const monthTx = templateTx.filter(tx => {
                    if (!tx.date_operation) return false;
                    const txMonth = parseInt(tx.date_operation.split('T')[0].split('-')[1]) - 1;
                    return txMonth === m;
                }).sort((a, b) => a.date_operation.localeCompare(b.date_operation));
                
                if (monthTx.length > 0) {
                    // Use the first transaction of the month for the segment
                    const tx = monthTx[0];
                    const isSkipped = tx.is_skipped === true || tx.is_skipped === 'true';
                    const isReconciled = tx.reconciliation_date != null && !isSkipped;
                    
                    let segmentClass = 'gantt-segment-pending';
                    if (isSkipped) segmentClass = 'gantt-segment-skipped';
                    else if (isReconciled) segmentClass = 'gantt-segment-reconciled';
                    
                    const day = parseInt(tx.date_operation.split('T')[0].split('-')[2]);
                    
                    // Round corners for first and last segments with occurrences
                    const isFirst = !templateTx.some(otx => {
                        const om = parseInt(otx.date_operation.split('T')[0].split('-')[1]) - 1;
                        return om < m;
                    });
                    const isLast = !templateTx.some(otx => {
                        const om = parseInt(otx.date_operation.split('T')[0].split('-')[1]) - 1;
                        return om > m;
                    });
                    let borderRadius = '';
                    if (isFirst && isLast) borderRadius = 'border-radius: 4px;';
                    else if (isFirst) borderRadius = 'border-radius: 4px 0 0 4px;';
                    else if (isLast) borderRadius = 'border-radius: 0 4px 4px 0;';
                    
                    // Build tooltip
                    const datePart = tx.date_operation.split('T')[0];
                    const formattedDate = datePart.split('-').reverse().join('/');
                    let statusText = window.i18n.t('rec_gantt_status_pending');
                    if (isReconciled) statusText = window.i18n.t('rec_gantt_status_reconciled');
                    else if (isSkipped) statusText = window.i18n.t('rec_gantt_status_skipped');
                    const tooltip = `${tx.description} — ${formattedDate}\n${formatCurrency(tx.amount)} • ${statusText}`;
                    
                    // Multiple transactions in same month: show count, plus stacked amount
                    let labelDayStr = '';
                    if (window.i18n.lang === 'en') {
                        const getOrdinalSuffix = (d) => {
                            if (d > 3 && d < 21) return 'th';
                            switch (d % 10) {
                                case 1:  return "st";
                                case 2:  return "nd";
                                case 3:  return "rd";
                                default: return "th";
                            }
                        };
                        labelDayStr = `${day}${getOrdinalSuffix(day)}`;
                        if (monthTx.length > 1) {
                            labelDayStr += `+${monthTx.length - 1}`;
                        }
                    } else {
                        const labelBase = monthTx.length > 1 ? `${day}+${monthTx.length - 1}` : `${day}`;
                        labelDayStr = `Le ${labelBase}`;
                    }
                    const skipStyle = isSkipped ? 'text-decoration: line-through;' : '';
                    const label = `<span style="${skipStyle}">${labelDayStr}</span><span style="font-size: 8.5px; opacity: 0.95; font-weight: 600; ${skipStyle}">${formatCurrency(tx.amount)}</span>`;
                    
                    segmentsHtml += `<div class="gantt-segment ${segmentClass}" style="${borderRadius}" title="${tooltip}" data-tx-id="${tx.id}" data-template-id="${t.id}" onclick="event.stopPropagation(); window.RecurrenceView.showSegmentPopover(${tx.id}, ${t.id}, this)"><span class="gantt-segment-label">${label}</span></div>`;
                } else {
                    segmentsHtml += `<div class="gantt-segment gantt-segment-empty"></div>`;
                }
            }
            
            const displayStyle = isExpanded ? '' : 'display: none;';
            
            timelineHtml += `
                <div id="rec-row-${t.id}" class="gantt-row" onclick="window.RecurrenceView.toggleRow(${t.id})" style="position: relative;">
                    <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: ${typeColors.border}; box-shadow: -3px 0 8px -1px ${typeColors.border}; z-index: 2;"></div>
                    <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 10px; cursor: help; z-index: 3;" title="${typeColors.label}" onclick="event.stopPropagation()"></div>
                    <div class="gantt-desc">
                        <span id="chevron_${t.id}" style="${chevronStyle}">❯</span>
                        <span style="margin-left: 5px;">${t.description}</span>
                        <div style="font-size: 11px; font-weight: normal; color: var(--text-muted); margin-top: 2px;">${t.category || '--'} • ${freqLabel} • <span class="privacy-blur" style="color: ${typeColors.text};">${formatCurrency(t.displayAmount)}</span></div>
                    </div>
                    <div class="gantt-bar-container">${segmentsHtml}</div>
                </div>
                <div id="details_row_${t.id}" style="${displayStyle} background: var(--bg-sidebar); border-bottom: 1px solid var(--border-color);">
                    <div style="padding: 15px 20px;">
                        <div id="details_content_${t.id}">
                            <!-- Rendered dynamically -->
                        </div>
                    </div>
                </div>
            `;
        });
        
        timelineHtml += `</div>`;
        tableContainer.innerHTML = timelineHtml;
        
        this.expandedTemplateIds.forEach(id => {
            this.renderTemplateDetails(id);
        });
    },

    getTypeColors(t) {
        let detectedType = t.type;
        // Infer type dynamically based on accounts configuration to safeguard against database inconsistency
        if (t.from_account_id && t.to_account_id) {
            detectedType = 'transfer';
        } else if (!t.from_account_id && t.to_account_id) {
            detectedType = 'income';
        } else if (t.from_account_id && !t.to_account_id && (t.type === 'transfer' || t.type === 'income')) {
            // Safe fallback if it was misconfigured as transfer/income but lacks one of the accounts
            detectedType = 'expense_fixed';
        }

        if (detectedType === 'income') {
            return { border: '#36b37e', text: '#36b37e', label: window.i18n.t('edit_type_option_income') || 'Revenu' };
        } else if (detectedType === 'transfer') {
            return { border: '#00b8d9', text: '#00b8d9', label: window.i18n.t('edit_type_option_transfer') || 'Virement' };
        }
        const label = detectedType === 'expense_var'
            ? (window.i18n.t('edit_type_option_expense_var') || 'Dépense variable')
            : (window.i18n.t('edit_type_option_expense_fixed') || 'Dépense fixe');
        return { border: '#e06050', text: 'var(--text-main)', label };
    },

    getAvailableFrequencies() {
        const templates = this.lastDisplayTemplates || this.templates || [];
        const freqSet = new Set();
        templates.forEach(t => {
            if (t.frequency) freqSet.add(t.frequency.toLowerCase());
        });
        // Sort: monthly first, then yearly, then alphabetical for the rest
        const order = ['monthly', 'yearly', 'weekly', 'bi-weekly', 'bi-monthly', 'quarterly', 'semi-annually'];
        return Array.from(freqSet).sort((a, b) => {
            const ia = order.indexOf(a);
            const ib = order.indexOf(b);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.localeCompare(b);
        });
    },

    showSegmentPopover(txId, templateId, segmentEl) {
        // Close any existing popover
        this.closeSegmentPopover();
        
        const tx = (this.allTransactions || []).find(t => t.id === txId);
        if (!tx) return;
        
        const isSkipped = tx.is_skipped === true || tx.is_skipped === 'true';
        const isReconciled = tx.reconciliation_date != null && !isSkipped;
        
        const datePart = tx.date_operation.split('T')[0];
        const formattedDate = datePart.split('-').reverse().join('/');
        
        const popover = document.createElement('div');
        popover.className = 'gantt-popover';
        popover.id = 'ganttPopoverActive';
        popover.style.padding = '8px';
        popover.style.width = '240px';
        
        let skipActionHtml = '';
        if (!isReconciled) {
            if (isSkipped) {
                skipActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.toggleSkipInDetails(${txId}, ${templateId})">↩️ ${window.i18n.t('rec_popover_action_unskip') || 'Rétablir l\'échéance'}</button>`;
            } else {
                skipActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.toggleSkipInDetails(${txId}, ${templateId})">⏭️ ${window.i18n.t('rec_popover_action_skip') || 'Ignorer l\'échéance'}</button>`;
            }
        }
        
        let reconcileActionHtml = '';
        if (isReconciled) {
            reconcileActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.toggleReconciliationInDetails(${txId}, ${templateId})">🔓 ${window.i18n.t('rec_popover_action_unreconcile') || 'Annuler le rapprochement'}</button>`;
        } else if (!isSkipped) {
            reconcileActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.toggleReconciliationInDetails(${txId}, ${templateId})">✅ ${window.i18n.t('rec_popover_action_reconcile') || 'Rapprocher (Pointer)'}</button>`;
        }
        
        // Pass complete transaction object to FormView.openEdit by resolving it from memory
        const editActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.openEditForTx(${txId})">✏️ ${window.i18n.t('rec_popover_action_edit') || 'Modifier l\'opération'}</button>`;
        
        const tpl = (this.templates || []).find(t => t.id === templateId);
        let closeSubActionHtml = '';
        if (tpl) {
            if (tpl.is_closed) {
                closeSubActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.reopenTemplate(${templateId})">🔓 ${window.i18n.t('rec_popover_action_reopen_sub') || 'Rouvrir l\'abonnement'}</button>`;
            } else {
                closeSubActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.showCloseModal(${templateId})">🛑 ${window.i18n.t('rec_popover_action_close_sub') || 'Clôturer l\'abonnement'}</button>`;
            }
        }
        
        popover.innerHTML = `
            <div style="padding: 6px 10px; border-bottom: 1px solid var(--border-color); margin-bottom: 4px;">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">${window.i18n.t('rec_popover_title') || 'Options de l\'échéance'}</div>
                <div style="font-size: 12px; font-weight: 600; color: var(--text-main); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tx.description}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">📅 ${formattedDate} • <span class="privacy-blur">${formatCurrency(tx.amount)}</span></div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
                ${skipActionHtml}
                ${reconcileActionHtml}
                ${editActionHtml}
                ${closeSubActionHtml}
            </div>
        `;
        
        document.body.appendChild(popover);
        
        // Position relative to segmentEl
        const rect = segmentEl.getBoundingClientRect();
        const popW = 240;
        const popH = popover.offsetHeight || 180;
        let left = rect.left + rect.width / 2 - popW / 2;
        let top = rect.bottom + 8;
        
        // Keep within viewport
        if (left < 10) left = 10;
        if (left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;
        if (top + popH > window.innerHeight) top = rect.top - popH - 8;
        
        popover.style.left = left + 'px';
        popover.style.top = top + 'px';
        
        // Close on outside click (delayed to avoid immediate close)
        setTimeout(() => {
            this._popoverClickHandler = (e) => {
                if (!popover.contains(e.target) && e.target !== segmentEl) {
                    this.closeSegmentPopover();
                }
            };
            document.addEventListener('click', this._popoverClickHandler, { once: true });
        }, 50);
    },

    openEditForTx(txId) {
        const tx = (this.allTransactions || []).find(t => t.id === txId);
        if (tx && window.FormView && window.FormView.openEdit) {
            window.FormView.openEdit(tx);
        }
    },

    closeSegmentPopover() {
        const existing = document.getElementById('ganttPopoverActive');
        if (existing) existing.remove();
        if (this._popoverClickHandler) {
            document.removeEventListener('click', this._popoverClickHandler);
            this._popoverClickHandler = null;
        }
    },

    async toggleReconciliationInDetails(txId, templateId) {
        try {
            await API.post(`/api/transactions/${txId}/toggle_reconciliation`);
            window.app.refreshSidebar();
            await this.loadData();
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la modification", "error");
        }
    },

    setPeriodFilter(freq) {
        // Toggle: if already selected, deselect
        if (this.activePeriodFilter === freq) {
            this.activePeriodFilter = 'all';
        } else {
            this.activePeriodFilter = freq;
        }
        ProfileStorage.set('recurrences_periodFilter', this.activePeriodFilter);
        this._updateFilterBadges();
        this.renderMainContent();
    },

    setDurationFilter(duration) {
        // Toggle: if already selected, deselect
        if (this.activeDurationFilter === duration) {
            this.activeDurationFilter = 'all';
        } else {
            this.activeDurationFilter = duration;
        }
        ProfileStorage.set('recurrences_durationFilter', this.activeDurationFilter);
        this._updateFilterBadges();
        this.renderMainContent();
    },

    resetAllFilters() {
        this.activeDurationFilter = 'all';
        this.activePeriodFilter = 'all';
        ProfileStorage.set('recurrences_durationFilter', 'all');
        ProfileStorage.set('recurrences_periodFilter', 'all');
        this._updateFilterBadges();
        this.renderMainContent();
    },

    changeYear(delta) {
        this.selectedYear += delta;
        const yearDisplay = document.getElementById('recYearDisplay');
        if (yearDisplay) yearDisplay.textContent = this.selectedYear;
        this.loadData();
    },

    _updateFilterBadges() {
        // Update duration badges
        document.querySelectorAll('.btn-filter-duration').forEach(btn => {
            const val = btn.getAttribute('data-filter-duration');
            btn.classList.toggle('active', val === this.activeDurationFilter);
        });
        // Update period badges
        document.querySelectorAll('.btn-filter-period').forEach(btn => {
            const val = btn.getAttribute('data-filter-period');
            btn.classList.toggle('active', val === this.activePeriodFilter);
        });
        // Update reset/all button
        document.querySelectorAll('.btn-filter-reset').forEach(btn => {
            btn.classList.toggle('active', this.activeDurationFilter === 'all' && this.activePeriodFilter === 'all');
        });
    },

    _renderDynamicFrequencyBadges() {
        // Find the filter container (parent of the reset button)
        const resetBtn = document.querySelector('.btn-filter-reset');
        if (!resetBtn) return;
        const container = resetBtn.parentElement;
        if (!container) return;
        
        // Remove old dynamic period badges
        container.querySelectorAll('.btn-filter-period').forEach(b => b.remove());
        // Remove old dynamic separator (the one before the period badges)
        const separators = container.querySelectorAll('.filter-separator');
        if (separators.length > 2) {
            // Keep only the first two separators (before/after duration buttons)
            for (let i = 2; i < separators.length; i++) separators[i].remove();
        }
        
        const availableFreqs = this.getAvailableFrequencies();
        if (availableFreqs.length === 0) return;
        
        const periodFilter = this.activePeriodFilter || 'all';
        
        // Add separator before frequency badges
        const sep = document.createElement('div');
        sep.className = 'filter-separator';
        container.appendChild(sep);
        
        availableFreqs.forEach(freq => {
            const btn = document.createElement('button');
            const isActive = periodFilter === freq.toLowerCase();
            btn.className = `btn-filter btn-filter-period${isActive ? ' active' : ''}`;
            btn.setAttribute('data-filter-period', freq.toLowerCase());
            btn.onclick = () => window.RecurrenceView.setPeriodFilter(freq.toLowerCase());
            btn.textContent = window.i18n.t('rec_' + freq.toLowerCase()) || freq;
            container.appendChild(btn);
        });
    },

    applyFilter() {
        this.renderMainContent();
    },

    setViewMode(viewMode) {
        this.currentViewMode = viewMode;
        ProfileStorage.set('recurrences_viewMode', viewMode);
        
        const tableBtn = document.getElementById('viewModeTable');
        const timelineBtn = document.getElementById('viewModeTimeline');
        if (tableBtn && timelineBtn) {
            if (viewMode === 'timeline') {
                tableBtn.classList.remove('active');
                timelineBtn.classList.add('active');
            } else {
                tableBtn.classList.add('active');
                timelineBtn.classList.remove('active');
            }
        }
        
        this.renderMainContent();
    },

    setSort(columnName) {
        if (this.sortBy === columnName) {
            this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortBy = columnName;
            this.sortOrder = 'asc';
        }
        ProfileStorage.set('recurrences_sortBy', this.sortBy);
        ProfileStorage.set('recurrences_sortOrder', this.sortOrder);
        this.loadData();
    },

    getSortArrow(columnName) {
        if (this.sortBy === columnName) {
            return this.sortOrder === 'asc' ? ' <span style="font-size: 10px; color: var(--accent);">▲</span>' : ' <span style="font-size: 10px; color: var(--accent);">▼</span>';
        }
        return ' <span style="font-size: 10px; color: var(--text-muted); opacity: 0.3;">▲</span>';
    },


});
