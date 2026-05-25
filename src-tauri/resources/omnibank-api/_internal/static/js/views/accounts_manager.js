// Shared palette of account badge colors
const ACCOUNT_COLORS = [
    '#3366ff', '#36b37e', '#ff5630', '#ffab00', '#00b8d9',
    '#6554c0', '#ff8a65', '#e91e8a', '#8bc34a', '#795548'
];

window.AccountsView = {
    accounts: [],
    mainAccountId: null,
    _colorPopoverId: null,  // track open popover
    
    render() {
        return `
            <div class="view-header" style="display:flex; justify-content:space-between; margin-bottom:15px;">
                <h2 data-i18n="acc_title">${window.i18n.t('acc_title')}</h2>
            </div>
            
            <div style="margin-bottom: 20px; background: var(--bg-surface); padding: 15px; border-radius: 8px; border: 1px solid var(--border-color);">
                <h3 data-i18n="acc_new_account">${window.i18n.t('acc_new_account')}</h3>
                <div class="accounts-add-form" style="display: flex; gap: 10px; margin-top: 10px; flex-wrap: wrap; align-items: flex-end;">
                    <input type="text" id="acc_name" class="inline-input" data-i18n-placeholder="acc_ph_name" placeholder="Nom du compte" style="border:1px solid var(--border-color); padding: 5px; flex: 2;">
                    <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                        <select id="acc_type_select" class="inline-input" style="border:1px solid var(--border-color); padding: 5px;" onchange="window.AccountsView.onTypeChange()">
                            <option value="Compte courant">${window.i18n.t('wizard_type_checking')}</option>
                            <option value="Livret">${window.i18n.t('wizard_type_savings')}</option>
                            <option value="PEA">${window.i18n.t('wizard_type_pea')}</option>
                            <option value="Assurance Vie">${window.i18n.t('wizard_type_life_ins')}</option>
                            <option value="PER">${window.i18n.t('wizard_type_per')}</option>
                            <option value="__other__">${window.i18n.t('wizard_type_other')}</option>
                        </select>
                        <input type="text" id="acc_type_custom" class="inline-input" data-i18n-placeholder="acc_ph_type" placeholder="Type personnalisé..." style="border:1px solid var(--border-color); padding: 5px; display:none;">
                    </div>
                    <input type="number" id="acc_balance" class="inline-input" data-i18n-placeholder="ph_initial_balance" placeholder="Solde Initial (€)" step="0.01" style="border:1px solid var(--border-color); padding: 5px; flex: 1;">
                    <div style="display:flex; flex-direction:column; gap:4px;">
                        <label style="font-size:11px; font-weight:600; color:var(--text-muted);" data-i18n="acc_th_color">${window.i18n.t('acc_th_color')}</label>
                        <div id="accNewColorPicker" class="acc-color-picker">
                            ${this._renderColorDots('accNewColor', this._nextColor())}
                        </div>
                        <input type="hidden" id="accNewColor" value="${this._nextColor()}">
                    </div>
                    <button class="btn btn-secondary" onclick="window.AccountsView.addAccount()" data-i18n="btn_add_account">${window.i18n.t('btn_add_account')}</button>
                </div>
            </div>

            <div style="overflow-x: auto;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th data-i18n="acc_th_name">${window.i18n.t('acc_th_name')}</th>
                            <th data-i18n="acc_th_type">${window.i18n.t('acc_th_type')}</th>
                            <th data-i18n="acc_th_initial_balance">${window.i18n.t('acc_th_initial_balance')}</th>
                            <th data-i18n="acc_th_color">${window.i18n.t('acc_th_color')}</th>
                            <th class="col-actions" style="width: 190px; min-width: 190px;" data-i18n="acc_th_actions">${window.i18n.t('acc_th_actions')}</th>
                        </tr>
                    </thead>
                    <tbody id="accountsBody">
                        <!-- Rendered dynamically -->
                    </tbody>
                </table>
            </div>
        `;
    },

    /** Return color dots HTML for a picker */
    _renderColorDots(inputId, selectedColor) {
        return ACCOUNT_COLORS.map(c =>
            `<span class="acc-color-dot ${c === selectedColor ? 'selected' : ''}" style="background:${c};" onclick="window.AccountsView._pickColor('${inputId}', '${c}', this)" title="${c}"></span>`
        ).join('');
    },

    _pickColor(inputId, color, dotEl) {
        const input = document.getElementById(inputId);
        if (input) input.value = color;
        // Update selected state
        const parent = dotEl.parentElement;
        parent.querySelectorAll('.acc-color-dot').forEach(d => d.classList.remove('selected'));
        dotEl.classList.add('selected');
    },

    /** Get next color from palette based on existing accounts */
    _nextColor() {
        const usedColors = this.accounts.map(a => a.color).filter(Boolean);
        for (const c of ACCOUNT_COLORS) {
            if (!usedColors.includes(c)) return c;
        }
        // All used — cycle
        return ACCOUNT_COLORS[this.accounts.length % ACCOUNT_COLORS.length];
    },

    onTypeChange() {
        const sel = document.getElementById('acc_type_select');
        const custom = document.getElementById('acc_type_custom');
        if (sel.value === '__other__') {
            custom.style.display = 'block';
            custom.focus();
        } else {
            custom.style.display = 'none';
            custom.value = '';
        }
    },

    async init() {
        await this.loadData();
        // Close popover on outside click
        document.addEventListener('click', (e) => {
            if (this._colorPopoverId && !e.target.closest('.acc-color-popover') && !e.target.classList.contains('acc-color-dot')) {
                this._closePopover();
            }
        });
    },

    async loadData() {
        try {
            this.accounts = await API.get('/api/accounts/');
            try {
                const mainAcc = await API.get('/api/stats/main_account');
                this.mainAccountId = mainAcc?.id || null;
            } catch(e) { this.mainAccountId = null; }
            this.renderTable();
        } catch (e) {
            console.error("Failed to load accounts", e);
        }
    },

    renderTable() {
        const tbody = document.getElementById('accountsBody');
        if (!tbody) return;
        
        tbody.innerHTML = this.accounts.map(acc => {
            const isMain = acc.id === this.mainAccountId;
            const color = acc.color || ACCOUNT_COLORS[0];
            return `
            <tr style="${acc.is_closed ? 'opacity: 0.6;' : ''}">
                <td>
                    ${isMain ? '<span class="acc-main-star" title="' + window.i18n.t('acc_main_account') + '">⭐</span>' : ''}
                    <strong>${acc.name}</strong>
                    ${acc.is_closed ? '<span data-i18n="badge_closed" style="background:var(--danger); color:#fff; padding:2px 5px; border-radius:4px; font-size:10px; margin-left:5px; font-weight:bold;">Fermé</span>' : ''}
                </td>
                <td>${acc.type}</td>
                <td><span class="privacy-blur">${formatCurrency(acc.initial_balance)}</span></td>
                <td>
                    <span class="acc-color-dot" style="background:${color}; cursor:pointer;" onclick="window.AccountsView.openColorPopover(${acc.id}, this)" title="${window.i18n.t('acc_color_label')}"></span>
                </td>
                <td class="col-actions" style="white-space: nowrap;">
                    <button class="acc-action-btn ${isMain ? 'acc-star-active' : 'acc-star-btn'}" onclick="window.AccountsView.setMainAccount(${acc.id})" title="${window.i18n.t('acc_set_main')}">${isMain ? '⭐' : '☆'}</button>
                    <button class="acc-action-btn acc-edit-btn" onclick="window.AccountsView.edit(${acc.id})" title="${window.i18n.t('tooltip_edit')}">✏️</button>
                    <button class="acc-action-btn acc-lock-btn" onclick="window.AccountsView.toggleClose(${acc.id})" title="${acc.is_closed ? window.i18n.t('acc_reopen_action') : window.i18n.t('acc_close_action')}">${acc.is_closed ? '🔓' : '🔒'}</button>
                    <button class="acc-action-btn acc-del-btn" onclick="window.AccountsView.delete(${acc.id})" title="${window.i18n.t('tooltip_delete')}">✕</button>
                </td>
            </tr>`;
        }).join('');
        
        if (window.app && window.app.translateDOM) {
            window.app.translateDOM(tbody);
        }
    },

    openColorPopover(accId, dotEl) {
        // Close any existing
        this._closePopover();
        
        const acc = this.accounts.find(a => a.id === accId);
        if (!acc) return;
        
        const popover = document.createElement('div');
        popover.className = 'acc-color-popover';
        popover.id = 'accColorPopover_' + accId;
        this._colorPopoverId = popover.id;
        
        popover.innerHTML = ACCOUNT_COLORS.map(c =>
            `<span class="acc-color-dot ${c === (acc.color || ACCOUNT_COLORS[0]) ? 'selected' : ''}" style="background:${c};" onclick="window.AccountsView.saveColor(${accId}, '${c}')" title="${c}"></span>`
        ).join('');
        
        // Position on body to escape table stacking context
        const rect = dotEl.getBoundingClientRect();
        popover.style.position = 'fixed';
        popover.style.left = (rect.left + rect.width + 8) + 'px';
        popover.style.top = rect.top + 'px';
        document.body.appendChild(popover);
    },

    _closePopover() {
        if (this._colorPopoverId) {
            const el = document.getElementById(this._colorPopoverId);
            if (el) el.remove();
            this._colorPopoverId = null;
        }
    },

    async saveColor(accId, color) {
        const acc = this.accounts.find(a => a.id === accId);
        if (!acc) return;
        
        try {
            await API.put(`/api/accounts/${accId}`, {
                name: acc.name,
                type: acc.type,
                initial_balance: acc.initial_balance,
                is_closed: acc.is_closed,
                color: color
            });
            this._closePopover();
            await this.loadData();
            window.app.refreshSidebar();
        } catch (e) {
            console.error(e);
        }
    },

    async addAccount() {
        try {
            const selVal = document.getElementById('acc_type_select').value;
            const customVal = document.getElementById('acc_type_custom').value;
            const type = selVal === '__other__' ? (customVal || window.i18n.t('default_account_type')) : selVal;
            const color = document.getElementById('accNewColor').value || this._nextColor();

            const data = {
                name: document.getElementById('acc_name').value,
                type: type,
                initial_balance: parseFloat(document.getElementById('acc_balance').value) || 0,
                is_closed: false,
                color: color
            };
            if (!data.name) return await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_name_required'));
            
            await API.post('/api/accounts/', data);
            
            document.getElementById('acc_name').value = '';
            document.getElementById('acc_type_select').value = 'Compte courant';
            document.getElementById('acc_type_custom').value = '';
            document.getElementById('acc_type_custom').style.display = 'none';
            document.getElementById('acc_balance').value = '';
            
            await this.loadData();
            window.app.refreshSidebar();

            // Update color picker to next available color
            const picker = document.getElementById('accNewColorPicker');
            const input = document.getElementById('accNewColor');
            if (picker && input) {
                const next = this._nextColor();
                input.value = next;
                picker.innerHTML = this._renderColorDots('accNewColor', next);
            }
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_create_error'));
        }
    },

    async delete(id) {
        if (await showInlineConfirm(window.i18n.t('title_confirmation'), window.i18n.t('confirm_delete_account'))) {
            try {
                await API.del(`/api/accounts/${id}`);
                await this.loadData();
                window.app.refreshSidebar();
            } catch (e) {
                console.error(e);
                showInlineMessage(window.i18n.t('title_error'), window.i18n.t('acc_delete_error'));
            }
        }
    },

    async toggleClose(id) {
        const acc = this.accounts.find(a => a.id === id);
        if (!acc) return;
        
        const action = acc.is_closed ? window.i18n.t('acc_reopen_action') : window.i18n.t('acc_close_action');
        if (await showInlineConfirm(window.i18n.t('title_confirmation'), window.i18n.tp('acc_confirm_toggle', {action}))) {
            try {
                await API.put(`/api/accounts/${id}`, {
                    name: acc.name,
                    type: acc.type,
                    initial_balance: acc.initial_balance,
                    is_closed: !acc.is_closed,
                    color: acc.color
                });
                await this.loadData();
                window.app.refreshSidebar();
            } catch (e) {
                console.error(e);
                showInlineMessage(window.i18n.t('title_error'), window.i18n.t('acc_toggle_error'));
            }
        }
    },

    async edit(id) {
        const acc = this.accounts.find(a => a.id === id);
        if (!acc) return;
        this._showEditModal(acc);
    },

    _showEditModal(acc) {
        // Remove any existing edit modal
        const existing = document.getElementById('accEditModal');
        if (existing) existing.remove();

        const knownTypes = ['Compte courant', 'Livret', 'PEA', 'Assurance Vie', 'PER'];
        const isCustomType = !knownTypes.includes(acc.type);
        const currentColor = acc.color || ACCOUNT_COLORS[0];

        const typeOptions = [
            { value: 'Compte courant', label: window.i18n.t('wizard_type_checking') },
            { value: 'Livret', label: window.i18n.t('wizard_type_savings') },
            { value: 'PEA', label: window.i18n.t('wizard_type_pea') },
            { value: 'Assurance Vie', label: window.i18n.t('wizard_type_life_ins') },
            { value: 'PER', label: window.i18n.t('wizard_type_per') },
            { value: '__other__', label: window.i18n.t('wizard_type_other') }
        ].map(o => `<option value="${o.value}" ${(isCustomType ? o.value === '__other__' : acc.type === o.value) ? 'selected' : ''}>${o.label}</option>`).join('');

        const modalHtml = `
        <div id="accEditModal" class="modal-overlay" style="display:flex;z-index:9999;">
            <div class="modal" style="width:480px; max-width:90vw;">
                <h3 style="margin-bottom:20px;">${window.i18n.t('acc_edit_title') || 'Modifier le compte'}</h3>
                <div style="display:flex;flex-direction:column;gap:16px;">
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_name')}</label>
                        <input type="text" id="accEditName" class="inline-input" value="${acc.name.replace(/"/g, '&quot;')}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_type')}</label>
                        <select id="accEditType" class="inline-input" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;" onchange="
                            const custom = document.getElementById('accEditTypeCustom');
                            if (this.value === '__other__') { custom.style.display='block'; custom.focus(); } else { custom.style.display='none'; custom.value=''; }
                        ">${typeOptions}</select>
                        <input type="text" id="accEditTypeCustom" class="inline-input" value="${isCustomType ? acc.type : ''}" placeholder="${window.i18n.t('acc_ph_type')}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;margin-top:6px;display:${isCustomType ? 'block' : 'none'};">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_initial_balance')}</label>
                        <input type="number" id="accEditBalance" class="inline-input" value="${acc.initial_balance}" step="0.01" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_color')}</label>
                        <div id="accEditColorPicker" class="acc-color-picker" style="margin-top:4px;">
                            ${this._renderColorDots('accEditColor', currentColor)}
                        </div>
                        <input type="hidden" id="accEditColor" value="${currentColor}">
                    </div>
                </div>
                <div class="modal-actions" style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:10px;">
                    <button class="btn btn-secondary" onclick="window.AccountsView._closeEditModal()">${window.i18n.t('btn_cancel')}</button>
                    <button class="btn btn-primary" onclick="window.AccountsView._saveEdit(${acc.id})">${window.i18n.t('btn_confirm')}</button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    _closeEditModal() {
        const modal = document.getElementById('accEditModal');
        if (modal) modal.remove();
    },

    async _saveEdit(id) {
        const acc = this.accounts.find(a => a.id === id);
        if (!acc) return;

        const name = document.getElementById('accEditName').value.trim();
        if (!name) return await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_name_required'));

        const typeSelect = document.getElementById('accEditType').value;
        const typeCustom = document.getElementById('accEditTypeCustom').value.trim();
        const type = typeSelect === '__other__' ? (typeCustom || window.i18n.t('default_account_type')) : typeSelect;

        const balanceStr = document.getElementById('accEditBalance').value;
        const balance = parseFloat(balanceStr.replace(',', '.'));
        if (isNaN(balance)) return await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_invalid_amount'));

        const color = document.getElementById('accEditColor').value || ACCOUNT_COLORS[0];

        try {
            await API.put(`/api/accounts/${id}`, {
                name: name,
                type: type,
                initial_balance: balance,
                is_closed: acc.is_closed,
                color: color
            });
            this._closeEditModal();
            await this.loadData();
            window.app.refreshSidebar();
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_edit_error'));
        }
    },

    async setMainAccount(id) {
        try {
            await API.post(`/api/stats/main_account/${id}`);
            this.mainAccountId = id;
            this.renderTable();
            window.app.refreshSidebar();
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_save_error_generic'));
        }
    }
};
