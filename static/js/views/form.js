window.FormView = {
    categories: [],
    accounts: [],
    descriptions: [],
    projectBudgets: [],
    currentTxId: null,
    currentTxBase: null,
    keepOpen: false,
    lastSavedId: null,

    _setupCategoriesListener() {
        if (this._categoriesListenerBound) return;
        this._categoriesListenerBound = true;
        window.addEventListener('categoriesUpdated', () => {
            // Reload categories if the modal is currently open
            if (document.getElementById('operationModal')?.style.display === 'flex') {
                this.loadCategories();
            }
        });
    },

    async init() {
        this._setupCategoriesListener();
        await this.loadAccounts();
        await this.loadCategories();
        await this.loadDescriptions();
        await this.loadProjectBudgets();

        // Load keepOpen from localStorage
        const storedKeepOpen = localStorage.getItem('form_keep_open');
        this.keepOpen = storedKeepOpen === 'true';
        const cb = document.getElementById('op_keep_open');
        if (cb) {
            cb.checked = this.keepOpen;
        }
        this.updateCancelButtonText();
    },

    adjustDate(inputId, offset) {
        const input = document.getElementById(inputId);
        if (!input) return;
        let val = input.value;
        if (!val) {
            val = new Date().toISOString().split('T')[0];
        }
        const date = new Date(val);
        if (isNaN(date.getTime())) return;
        date.setDate(date.getDate() + offset);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        input.value = `${year}-${month}-${day}`;
    },

    updateCancelButtonText() {
        const cancelBtn = document.getElementById('op_cancel_btn');
        if (cancelBtn) {
            if (this.keepOpen) {
                cancelBtn.setAttribute('data-i18n', 'btn_close');
                cancelBtn.textContent = window.i18n.t('btn_close');
            } else {
                cancelBtn.setAttribute('data-i18n', 'btn_cancel');
                cancelBtn.textContent = window.i18n.t('btn_cancel');
            }
        }
    },

    async loadProjectBudgets() {
        try {
            const all = await API.get('/api/budgets/');
            const projects = all.filter(b => b.is_project && !b.is_closed);
            const savings = all.filter(b => (b.envelope_type || 'spending') === 'savings' && !b.is_closed);
            this.projectBudgets = [...projects, ...savings];
            const container = document.getElementById('op_budget_container');
            const select = document.getElementById('op_budget_id');
            if (!container || !select) return;
            if (this.projectBudgets.length === 0) {
                container.style.display = 'none';
                return;
            }
            container.style.display = 'block';
            let optionsHtml = '<option value="">-- Aucune enveloppe --</option>';
            if (projects.length > 0) {
                optionsHtml += `<optgroup label="${window.i18n.t('budget_optgroup_projects')}">`;
                optionsHtml += projects.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
                optionsHtml += '</optgroup>';
            }
            if (savings.length > 0) {
                optionsHtml += `<optgroup label="🏦 ${window.i18n.t('budget_optgroup_savings')}">`;
                optionsHtml += savings.map(b => `<option value="${b.id}">🏦 ${b.name}</option>`).join('');
                optionsHtml += '</optgroup>';
            }
            select.innerHTML = optionsHtml;
        } catch(e) { /* budgets endpoint not critical */ }
    },

    async open() {
        this.currentTxId = null;
        this.currentTxBase = null;
        
        document.getElementById('op_desc').value = '';
        document.getElementById('op_amount').value = '';
        document.getElementById('op_date').value = new Date().toISOString().split('T')[0];
        document.getElementById('op_date_saisie').value = new Date().toISOString().split('T')[0];
        document.getElementById('op_recon_date').value = '';
        
        document.getElementById('op_is_recurrent').checked = false;
        document.getElementById('op_is_recurrent').disabled = false;
        
        document.getElementById('op_from_account').value = '';
        document.getElementById('op_to_account').value = '';
        
        document.getElementById('op_check_slip').value = '';
        document.getElementById('op_attachments').value = '';
        document.getElementById('op_attachments_list').innerHTML = '';
        document.getElementById('op_rec_day_1').value = '';
        document.getElementById('op_rec_day_2').value = '';
        document.getElementById('op_rec_limit').value = '';
        const budgetSel = document.getElementById('op_budget_id');
        if (budgetSel) budgetSel.value = '';
        
        this.applyConfigVisibility();
        
        this.toggleRecurrenceFields();
        document.getElementById('op_rec_edit_hint').style.display = 'none';
        this.hideNewCatInput();
        
        // Always reload fresh data (accounts, categories, descriptions)
        await this.init();
        
        this.renderAccountsDropdowns(null, null);
        
        this.updateInferredType();
        
        document.getElementById('operationModal').style.display = 'flex';
    },

    onKeepOpenToggle() {
        this.keepOpen = document.getElementById('op_keep_open').checked;
        localStorage.setItem('form_keep_open', this.keepOpen ? 'true' : 'false');
        this.updateCancelButtonText();
        if (!this.keepOpen) {
            this.lastSavedId = null;
            const undoBtn = document.getElementById('op_undo_last_btn');
            if (undoBtn) undoBtn.style.display = 'none';
        }
    },

    async undoLastEntry() {
        if (!this.lastSavedId) return;
        try {
            await API.del(`/api/transactions/${this.lastSavedId}`);
            this.lastSavedId = null;
            const undoBtn = document.getElementById('op_undo_last_btn');
            if (undoBtn) undoBtn.style.display = 'none';
            // PERF: Refresh sidebar and reload view data in parallel
            const refreshPromises = [window.app.refreshSidebar()];
            if (window.app.currentView === 'dashboard' && window.TimelineView.loadData) refreshPromises.push(window.TimelineView.loadData());
            if (window.app.currentView === 'all_operations' && window.AllOperationsView.loadData) refreshPromises.push(window.AllOperationsView.loadData());
            await Promise.all(refreshPromises);
            showToast(window.i18n.t('form_undo_done') || 'Derni\u00e8re saisie supprim\u00e9e', 'success');
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },
    
    // Helper: fetch the most recently created transaction id for undo support
    async _getLastCreatedId() {
        try {
            const txs = await API.get('/api/transactions/?limit=1&sort=desc');
            return (txs && txs.length > 0) ? txs[0].id : null;
        } catch(e) { return null; }
    },

    async openEdit(tx) {
        this.currentTxId = tx.id;
        this.currentTxBase = tx;
        this._pendingRecId = tx.recurrence_id || null;
        
        document.getElementById('op_desc').value = tx.description;
        document.getElementById('op_amount').value = tx.amount;
        document.getElementById('op_date').value = tx.date_operation;
        document.getElementById('op_date_saisie').value = tx.date_saisie || new Date().toISOString().split('T')[0];
        document.getElementById('op_recon_date').value = tx.reconciliation_date || '';
        
        // is_salary flag (checkbox)
        const isSalaryCheckbox = document.getElementById('op_is_salary');
        if (isSalaryCheckbox) {
            isSalaryCheckbox.checked = tx.is_salary === true;
        }
        
        // Determine if recurrent
        const isRecurrent = tx.is_monthly || tx.is_yearly || !!tx.recurrence_id;
        document.getElementById('op_is_recurrent').checked = isRecurrent;
        document.getElementById('op_is_recurrent').disabled = true; // Cannot toggle an existing one
        
        await this.init();
        
        this.renderAccountsDropdowns(tx.from_account_id, tx.to_account_id);
        
        document.getElementById('op_from_account').value = tx.from_account_id || '';
        document.getElementById('op_to_account').value = tx.to_account_id || '';
        
        document.getElementById('op_check_slip').value = tx.check_slip_number || '';
        document.getElementById('op_attachments').value = tx.attachments || '';
        this.renderAttachmentsList(tx.attachments);
        
        if (tx.is_bimonthly) {
            document.getElementById('op_rec_freq').value = 'Bi-Monthly';
            document.getElementById('op_rec_day_1').value = tx.recurrence_day_1 || '';
            document.getElementById('op_rec_day_2').value = tx.recurrence_day_2 || '';
        } else if (tx.is_monthly) {
            document.getElementById('op_rec_freq').value = 'Monthly';
        } else if (tx.is_yearly) {
            document.getElementById('op_rec_freq').value = 'Yearly';
        }
        
        // Reset limit field — fetch from template if exists
        document.getElementById('op_rec_limit').value = '';
        if (tx.recurrence_id) {
            try {
                const templates = await API.get('/api/recurrences/');
                const tpl = templates.find(t => t.id === tx.recurrence_id);
                if (tpl && tpl.max_occurrences) {
                    document.getElementById('op_rec_limit').value = tpl.max_occurrences;
                }
            } catch(e) { /* non-critical */ }
        }
        
        this.applyConfigVisibility();
        this.toggleRecurrenceFields();
        document.getElementById('op_rec_edit_hint').style.display = isRecurrent ? 'flex' : 'none';
        this.hideNewCatInput();
        
        // This will update the type listbox and filter categories
        this.updateInferredType();
        
        if (tx.category) {
            document.getElementById('op_category').value = tx.category;
        }

        // Pre-fill project budget if assigned
        const budgetSel = document.getElementById('op_budget_id');
        if (budgetSel) budgetSel.value = tx.budget_id || '';

        document.getElementById('operationModal').style.display = 'flex';
    },

    close() {
        document.getElementById('operationModal').style.display = 'none';
        this.currentTxId = null;
        this.currentTxBase = null;
    },

    toggleRecurrenceFields() {
        const isRecurrent = document.getElementById('op_is_recurrent').checked;
        document.getElementById('op_rec_options').style.display = isRecurrent ? 'flex' : 'none';
        this.onFreqChange();
        this.updateInferredType();
    },

    onFreqChange() {
        const isRecurrent = document.getElementById('op_is_recurrent').checked;
        const freq = document.getElementById('op_rec_freq').value;
        const showDays = isRecurrent && freq === 'Bi-Monthly';
        document.getElementById('op_bimonthly_days_container').style.display = showDays ? 'block' : 'none';
    },

    calculateDay2() {
        const day1 = parseInt(document.getElementById('op_rec_day_1').value);
        if (!isNaN(day1) && day1 >= 1 && day1 <= 31) {
            let day2 = day1 + 15;
            if (day2 > 30) day2 = day2 - 30;
            document.getElementById('op_rec_day_2').value = day2;
        }
    },

    applyConfigVisibility() {
        const cfg = window.app.config || {};
        
        // Dynamically add/remove Bi-Monthly option
        const selectFreq = document.getElementById('op_rec_freq');
        let optBimonthly = Array.from(selectFreq.options).find(o => o.value === 'Bi-Monthly');
        
        if (cfg.enable_bimonthly === 'true' || cfg.enable_bimonthly === true) {
            if (!optBimonthly) {
                optBimonthly = document.createElement('option');
                optBimonthly.value = 'Bi-Monthly';
                optBimonthly.textContent = window.i18n.t('opt_freq_bimonthly');
                selectFreq.insertBefore(optBimonthly, selectFreq.firstChild);
            }
        } else {
            if (optBimonthly) {
                if (selectFreq.value === 'Bi-Monthly') selectFreq.value = 'Monthly';
                optBimonthly.remove();
            }
        }
        
        if (cfg.enable_check_slips === 'true' || cfg.enable_check_slips === true) {
            document.getElementById('op_check_slip_container').style.display = 'block';
        } else {
            document.getElementById('op_check_slip_container').style.display = 'none';
        }
        
        if (cfg.enable_attachments === 'true' || cfg.enable_attachments === true) {
            document.getElementById('op_attachments_container').style.display = 'block';
        } else {
            document.getElementById('op_attachments_container').style.display = 'none';
        }

        const aiBtn = document.getElementById('op_autocat_btn');
        if (aiBtn) {
            aiBtn.style.display = (cfg.enable_ai === 'true' || cfg.enable_ai === true) ? 'inline-block' : 'none';
        }
    },
    
    async uploadFile(input) {
        if (!input.files || input.files.length === 0) return;
        const file = input.files[0];
        
        const fd = new FormData();
        fd.append("file", file);
        
        try {
            const res = await fetch('/api/upload', { method: 'POST', body: fd });
            const data = await res.json();
            if (res.ok && data.path) {
                let current = document.getElementById('op_attachments').value;
                let paths = current ? current.split(',') : [];
                paths.push(data.path);
                const newVal = paths.join(',');
                document.getElementById('op_attachments').value = newVal;
                this.renderAttachmentsList(newVal);
            } else {
                showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_upload_failed'));
            }
        } catch(e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_upload_network_error'));
        }
        input.value = '';
    },
    
    renderAttachmentsList(attachmentsStr) {
        const list = document.getElementById('op_attachments_list');
        list.innerHTML = '';
        if (!attachmentsStr) return;
        
        const paths = attachmentsStr.split(',');
        paths.forEach((p, idx) => {
            const name = p.split('/').pop().split('\\').pop();
            const fileUrl = `${window.location.origin}/${p}`;
            const div = document.createElement('div');
            div.style.display = 'flex';
            div.style.gap = '10px';
            div.style.alignItems = 'center';

            const link = document.createElement('a');
            link.href = `/${p}`;
            link.textContent = name;
            link.style.cssText = 'color:var(--accent);text-decoration:none;flex:1;';

            // In Tauri WebView, target=_blank doesn't work — open via system browser
            if (window.__TAURI_INTERNALS__) {
                link.href = '#';
                link.addEventListener('click', async (e) => {
                    e.preventDefault();
                    try {
                        await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: fileUrl });
                    } catch(err) { console.error('Shell open failed', err); }
                });
            } else {
                link.target = '_blank';
            }

            const removeBtn = document.createElement('span');
            removeBtn.textContent = '❌';
            removeBtn.style.cssText = 'cursor:pointer;color:var(--color-expense);';
            removeBtn.onclick = () => window.FormView.removeAttachment(idx);

            div.appendChild(document.createTextNode('📄 '));
            div.appendChild(link);
            div.appendChild(removeBtn);
            list.appendChild(div);
        });
    },

    removeAttachment(idx) {
        let current = document.getElementById('op_attachments').value;
        if (!current) return;
        let paths = current.split(',');
        paths.splice(idx, 1);
        const newVal = paths.join(',');
        document.getElementById('op_attachments').value = newVal;
        this.renderAttachmentsList(newVal);
    },

    async loadAccounts() {
        try {
            this.accounts = await API.get('/api/accounts/');
            this.renderAccountsDropdowns(null, null);
        } catch (e) {
            console.error('Failed to load accounts', e);
        }
    },

    renderAccountsDropdowns(currentFrom, currentTo) {
        const renderAcc = (selectId, currentVal) => {
            const select = document.getElementById(selectId);
            if (!select) return;
            select.innerHTML = this.accounts
                .filter(a => !a.is_closed || a.id == currentVal)
                .map(a => `<option value="${a.id}">${a.name}${a.is_closed ? ' (Fermé)' : ''}</option>`).join('');
            select.value = currentVal || '';
        };
        renderAcc('op_from_account', currentFrom);
        renderAcc('op_to_account', currentTo);
    },
    
    async loadDescriptions() {
        try {
            this.descriptions = await API.get('/api/transactions/descriptions');
            const dataList = document.getElementById('descList');
            // descriptions is now a dictionary: { "Desc": {category, from_account_id, to_account_id}, ... }
            dataList.innerHTML = Object.keys(this.descriptions).map(d => `<option value="${d}">`).join('');
        } catch (e) {
            console.error('Failed to load descriptions', e);
        }
    },

    onDescriptionInput() {
        const desc = document.getElementById('op_desc').value;
        if (this.descriptions && this.descriptions[desc]) {
            const data = this.descriptions[desc];
            
            if (data.from_account_id !== null) {
                document.getElementById('op_from_account').value = data.from_account_id;
            } else {
                document.getElementById('op_from_account').value = '';
            }
            
            if (data.to_account_id !== null) {
                document.getElementById('op_to_account').value = data.to_account_id;
            } else {
                document.getElementById('op_to_account').value = '';
            }
            
            this.updateInferredType();
            
            if (data.category) {
                document.getElementById('op_category').value = data.category;
            }
        }
    },

    async loadCategories() {
        try {
            this.categories = await API.get('/api/categories/');
            this.renderCategories();
        } catch (e) {
            console.error(e);
        }
    },

    updateInferredType() {
        const fromAcc = document.getElementById('op_from_account').value;
        const toAcc = document.getElementById('op_to_account').value;
        const isRecurrent = document.getElementById('op_is_recurrent').checked;
        const limitStr = document.getElementById('op_rec_limit').value;
        const isLimited = limitStr && parseInt(limitStr) > 0;
        
        let type = 'neutral';
        if (fromAcc && toAcc) {
            type = 'transfer';
        } else if (!fromAcc && toAcc) {
            type = 'income';
        } else if (fromAcc && !toAcc) {
            type = (isRecurrent && !isLimited) ? 'expense_fixed' : 'expense_var';
        } else {
            type = 'neutral';
        }
        
        // Update hidden input and display badge
        document.getElementById('op_tx_type').value = type;
        document.getElementById('op_inferred_type_display').textContent = window.app.getTypeLabel(type);
        
        // Change badge color based on type
        const badge = document.getElementById('op_inferred_type_display');
        if (type === 'income') {
            badge.style.backgroundColor = '#10b981'; // Green
        } else if (type === 'transfer') {
            badge.style.backgroundColor = '#3b82f6'; // Blue
        } else if (type === 'expense_var') {
            badge.style.backgroundColor = '#f59e0b'; // Orange
        } else if (type === 'expense_fixed') {
            badge.style.backgroundColor = '#ef4444'; // Red
        } else {
            badge.style.backgroundColor = 'var(--text-muted)';
        }
        
        // Show/hide is_salary checkbox container for income types in edit mode (we have an ID/currentTxId)
        const isSalaryContainer = document.getElementById('op_is_salary_container');
        if (isSalaryContainer) {
            if (type === 'income' && this.currentTxId) {
                isSalaryContainer.style.display = 'flex';
            } else {
                isSalaryContainer.style.display = 'none';
            }
        }
        
        // Update recurrence limit badge
        const badgeEl = document.getElementById('op_rec_limit_badge');
        if (badgeEl) {
            if (isRecurrent) {
                badgeEl.style.display = 'inline-block';
                if (isLimited) {
                    badgeEl.setAttribute('data-i18n', 'rec_limit_limited');
                    badgeEl.textContent = window.i18n.t('rec_limit_limited') || 'Limitée dans le temps';
                    badgeEl.style.backgroundColor = 'rgba(245,158,11,0.15)';
                    badgeEl.style.color = '#f59e0b';
                    badgeEl.style.borderColor = 'rgba(245,158,11,0.25)';
                } else {
                    badgeEl.setAttribute('data-i18n', 'rec_limit_unlimited');
                    badgeEl.textContent = window.i18n.t('rec_limit_unlimited') || 'Illimitée dans le temps';
                    badgeEl.style.backgroundColor = 'rgba(16,185,129,0.15)';
                    badgeEl.style.color = '#10b981';
                    badgeEl.style.borderColor = 'rgba(16,185,129,0.25)';
                }
            } else {
                badgeEl.style.display = 'none';
            }
        }
        
        this.renderCategories();
    },

    renderCategories() {
        const currentType = document.getElementById('op_tx_type').value;
        const select = document.getElementById('op_category');
        
        // Check for search input
        const searchInput = document.getElementById('op_category_search');
        const search = searchInput ? searchInput.value.toLowerCase() : '';
        
        const currentVal = select.value;
        
        let html = '<option value="">-- Sans cat\u00e9gorie --</option>';
        this.categories.forEach(c => {
            if (c.is_closed && c.name !== currentVal) return;
            // Show only categories matching the current type
            const typeMatch = !currentType || c.type === currentType;
            if (typeMatch) {
                if (!search || c.name.toLowerCase().includes(search)) {
                    html += `<option value="${c.name}">${c.name}</option>`;
                }
            }
        });
        
        select.innerHTML = html;
        if (currentVal) {
            select.value = currentVal;
        }
    },

    showNewCatInput() {
        document.getElementById('newCatForm').style.display = 'flex';
        document.getElementById('new_cat_name').focus();
    },
    
    hideNewCatInput() {
        document.getElementById('newCatForm').style.display = 'none';
        document.getElementById('new_cat_name').value = '';
    },

    async createNewCategory() {
        const name = document.getElementById('new_cat_name').value;
        const type = document.getElementById('op_tx_type').value;
        
        if (!name) return;
        if (!type || type === 'neutral') {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_select_accounts_first'));
            return;
        }

        try {
            const newCat = await API.post('/api/categories/', { name, type });
            await this.loadCategories();
            this.updateInferredType();
            document.getElementById('op_category').value = newCat.name;
            this.hideNewCatInput();
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
                        const newCat = await API.post('/api/categories/?force_move=true', { name, type });
                        await this.loadCategories();
                        this.updateInferredType();
                        document.getElementById('op_category').value = newCat.name;
                        this.hideNewCatInput();
                        return;
                    } catch(err2) {
                        showInlineMessage(window.i18n.t('title_info'), "Erreur lors du déplacement de la catégorie.");
                        return;
                    }
                }
            } else {
                showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_category_create_error'));
            }
        }
    },

    async autoCategorizeCurrent() {
        const desc = document.getElementById('op_desc').value;
        const amount = document.getElementById('op_amount').value;
        if (!desc) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_enter_desc_first'));
            return;
        }
        const btn = document.getElementById('op_autocat_btn');
        btn.disabled = true;
        btn.textContent = '⏳';
        try {
            const data = await API.post('/api/chat/autocategorize', {
                description: desc,
                amount: parseFloat(amount) || null
            });
            const cat = data.category;
            if (cat) {
                // Try to select existing, otherwise set search and prompt creation
                const select = document.getElementById('op_category');
                const match = Array.from(select.options).find(o => o.value.toLowerCase() === cat.toLowerCase());
                if (match) {
                    select.value = match.value;
                } else {
                    // Not in list — prefill new category name
                    document.getElementById('op_category_search').value = cat;
                    this.renderCategories();
                    document.getElementById('new_cat_name').value = cat;
                    this.showNewCatInput();
                }
            }
        } catch(e) {
            let errorMsg = e.message;
            try {
                const parsed = JSON.parse(e.message);
                errorMsg = parsed.detail || e.message;
            } catch(err) {}
            showInlineMessage(window.i18n.t('title_info'), window.i18n.tp('msg_autocategorize_error', {error: errorMsg}));
        } finally {
            btn.disabled = false;
            btn.textContent = '✨ IA';
        }
    },

    async save() {
        const desc = document.getElementById('op_desc').value;
        const amount = parseFloat(document.getElementById('op_amount').value) || 0;
        const dateOp = document.getElementById('op_date').value;
        const reconDate = document.getElementById('op_recon_date').value;
        
        const type = document.getElementById('op_tx_type').value;
        const category = document.getElementById('op_category').value;
        
        const fromAcc = document.getElementById('op_from_account').value;
        const toAcc = document.getElementById('op_to_account').value;
        
        const isRecurrent = document.getElementById('op_is_recurrent').checked;

        if (!desc || !dateOp) return await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_desc_date_required'));

        this.pendingSaveData = {
            date_operation: dateOp,
            description: desc,
            amount: amount,
            type: type,
            category: category || null,
            reconciliation_date: reconDate || null,
            from_account_id: fromAcc ? parseInt(fromAcc) : null,
            to_account_id: toAcc ? parseInt(toAcc) : null,
            check_slip_number: document.getElementById('op_check_slip').value || null,
            attachments: document.getElementById('op_attachments').value || null,
            budget_id: (() => { const v = document.getElementById('op_budget_id')?.value; return v ? parseInt(v) : null; })(),
            is_salary: (() => {
                const cb = document.getElementById('op_is_salary');
                if (cb && document.getElementById('op_is_salary_container').style.display !== 'none') {
                    return cb.checked;
                }
                return null;
            })()
        };

        // Phase 9: Inject org user audit fields
        if (window.app && window.app.currentUser) {
            if (this.currentTxId) {
                this.pendingSaveData.modified_by = window.app.currentUser;
            } else {
                this.pendingSaveData.created_by = window.app.currentUser;
            }
        }

        if (this.currentTxId) {
            // Edit Mode
            if (isRecurrent || (this.currentTxBase && this.currentTxBase.recurrence_id)) {
                // Show propagate modal
                document.getElementById('propagateConfirmModal').style.display = 'flex';
                return; // Pauses save until confirmation
            } else {
                this.executeSave(false);
            }
        } else {
            // Create Mode
            if (isRecurrent) {
                const freq = document.getElementById('op_rec_freq').value;
                const dateObj = new Date(dateOp);
                this.pendingSaveData.frequency = freq;
                this.pendingSaveData.is_monthly = (freq === 'Monthly');
                this.pendingSaveData.is_yearly = (freq === 'Yearly');
                this.pendingSaveData.is_bimonthly = (freq === 'Bi-Monthly');
                
                const limitStr = document.getElementById('op_rec_limit').value;
                if (limitStr) {
                    const limitVal = parseInt(limitStr);
                    if (!isNaN(limitVal) && limitVal > 0) {
                        this.pendingSaveData.max_occurrences = limitVal;
                    }
                }
                
                if (freq === 'Bi-Monthly') {
                    this.pendingSaveData.recurrence_day_1 = parseInt(document.getElementById('op_rec_day_1').value) || dateObj.getDate();
                    this.pendingSaveData.recurrence_day_2 = parseInt(document.getElementById('op_rec_day_2').value) || null;
                    this.pendingSaveData.day_of_month = this.pendingSaveData.recurrence_day_1;
                } else {
                    this.pendingSaveData.day_of_month = dateObj.getDate();
                }
            }
            this.executeSave(false);
        }
    },
    
    confirmPropagate(propagate) {
        document.getElementById('propagateConfirmModal').style.display = 'none';
        this.executeSave(propagate);
    },

    async executeSave(propagate) {
        try {
            if (this.currentTxId) {
                // UPDATE
                await API.put(`/api/transactions/${this.currentTxId}?propagate=${propagate}`, this.pendingSaveData);
                
                // If propagating and recurrence limit changed, update template and regenerate
                if (propagate && this.currentTxBase && this.currentTxBase.recurrence_id) {
                    const limitStr = document.getElementById('op_rec_limit').value;
                    const newLimit = limitStr ? parseInt(limitStr) : null;
                    if (!isNaN(newLimit) && newLimit > 0) {
                        // Update template max_occurrences via PATCH-like PUT
                        const templates = await API.get('/api/recurrences/');
                        const tpl = templates.find(t => t.id === this.currentTxBase.recurrence_id);
                        if (tpl && tpl.max_occurrences !== newLimit) {
                            tpl.max_occurrences = newLimit;
                            await API.put(`/api/recurrences/${tpl.id}`, tpl);
                            await API.post(`/api/recurrences/generate_to_end_of_year?template_id=${tpl.id}`, {});
                        }
                    }
                }
            } else {
                // CREATE
                if (document.getElementById('op_is_recurrent').checked) {
                    const tplData = {
                        description: this.pendingSaveData.description,
                        amount: this.pendingSaveData.amount,
                        type: this.pendingSaveData.type,
                        category: this.pendingSaveData.category,
                        frequency: this.pendingSaveData.frequency,
                        day_of_month: this.pendingSaveData.day_of_month,
                        max_occurrences: this.pendingSaveData.max_occurrences,
                        from_account_id: this.pendingSaveData.from_account_id,
                        to_account_id: this.pendingSaveData.to_account_id
                    };
                    
                    let createdTxId = null;
                    const newTpl = await API.post('/api/recurrences/', tplData);
                    
                    const txData = { ...this.pendingSaveData, date_saisie: new Date().toISOString().split('T')[0] };
                    delete txData.frequency; delete txData.day_of_month;
                    txData.recurrence_id = newTpl.id;
                    
                    const newTx = await API.post('/api/transactions/', txData);
                    if (newTx && newTx.id) createdTxId = newTx.id;
                    await API.post(`/api/recurrences/generate_to_end_of_year?template_id=${newTpl.id}`, {});
                    
                    this._recentlyCreatedId = createdTxId;
                } else {
                    const txData = { ...this.pendingSaveData, date_saisie: new Date().toISOString().split('T')[0] };
                    const newTx = await API.post('/api/transactions/', txData);
                    this._recentlyCreatedId = (newTx && newTx.id) ? newTx.id : null;
                }
            }

            // Determine if we should keep modal open
            const isCreate = !this.currentTxId;
            const savedRes = isCreate ? this._recentlyCreatedId : null;

            const highlightId = this.currentTxId || savedRes;
            if (highlightId) {
                if (window.TimelineView) window.TimelineView._pendingHighlightTxId = highlightId;
                if (window.AllOperationsView) window.AllOperationsView._pendingHighlightTxId = highlightId;
            }

            if (this.keepOpen && isCreate) {
                // Animate save button
                const saveBtn = document.getElementById('op_save_btn');
                if (saveBtn) {
                    saveBtn.classList.add('btn-save-confirm');
                    setTimeout(() => saveBtn.classList.remove('btn-save-confirm'), 700);
                }
                // Store last saved id for undo
                this.lastSavedId = savedRes;
                const undoBtn = document.getElementById('op_undo_last_btn');
                if (undoBtn) undoBtn.style.display = 'inline-flex';
            } else {
                this.close();
            }

            // Reload descriptions on save
            this.loadDescriptions();

            // PERF: Refresh sidebar and reload view data in parallel
            const refreshPromises = [window.app.refreshSidebar()];
            if (window.app.currentView === 'dashboard' && window.TimelineView.loadData) {
                refreshPromises.push(window.TimelineView.loadData());
            }
            if (window.app.currentView === 'all_operations' && window.AllOperationsView.loadData) {
                refreshPromises.push(window.AllOperationsView.loadData());
            }
            if (window.app.currentView === 'recurrences' && window.RecurrenceView.loadData) {
                refreshPromises.push(window.RecurrenceView.loadData());
            }
            await Promise.all(refreshPromises);


        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error_generic'));
        }
    }
};

