// static/js/views/recurrences/recurrences_wizard.js — Assistant annuel de renouvellement et génération en masse
window.RecurrenceView = Object.assign(window.RecurrenceView || {}, {
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
                 <option value="Weekly" ${t.frequency === 'Weekly' ? 'selected' : ''}>${window.i18n.t('opt_freq_weekly') || 'Hebdomadaire'}</option>
                 <option value="Monthly" ${t.frequency === 'Monthly' ? 'selected' : ''}>${window.i18n.t('opt_freq_monthly')}</option>
                 <option value="Quarterly" ${t.frequency === 'Quarterly' ? 'selected' : ''}>${window.i18n.t('opt_freq_quarterly') || 'Trimestrielle'}</option>
                 <option value="Semi-Annually" ${t.frequency === 'Semi-Annually' ? 'selected' : ''}>${window.i18n.t('opt_freq_semi_annually') || 'Bi-annuelle'}</option>
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
                            <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ ${window.i18n.t('wizard_opt_new_category') || 'New category...'}</option>
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
            <option value="Weekly">${window.i18n.t('opt_freq_weekly') || 'Hebdomadaire'}</option>
            <option value="Monthly" selected>${window.i18n.t('opt_freq_monthly')}</option>
            <option value="Quarterly">${window.i18n.t('opt_freq_quarterly') || 'Trimestrielle'}</option>
            <option value="Semi-Annually">${window.i18n.t('opt_freq_semi_annually') || 'Bi-annuelle'}</option>
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
                        <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ ${window.i18n.t('wizard_opt_new_category') || 'New category...'}</option>
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
            const title = window.i18n.t('wizard_prompt_new_category_title') || 'Name of the new fixed expense category:';
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
                    
                    showToast(window.i18n.t('msg_category_added') || 'Category added');
                } catch (e) {
                    console.error("Failed to create category in wizard", e);
                    showToast(window.i18n.t('msg_category_create_error') || 'Category creation error', 'error');
                    select.value = '';
                }
            } else {
                select.value = '';
            }
        }
    },
    
    updateWizardCategorySelectOptions(selectElement, fixedCategories, currentValue, originalCategoryValue = null) {
        const noCatLabel = window.i18n.t('wizard_opt_no_category') || '-- Category --';
        const newCatLabel = window.i18n.t('wizard_opt_new_category') || 'New category...';
        
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
            await showInlineMessage(window.i18n.t('error_title') || "Erreur", window.i18n.t('rec_generate_error') || "Une erreur s'est produite lors de la génération.");
            const btn = document.querySelector('#recWizardModal .btn-primary');
            if (btn) {
                btn.disabled = false;
                btn.textContent = window.i18n.t('wizard_btn_validate');
            }
        }
    },


});
