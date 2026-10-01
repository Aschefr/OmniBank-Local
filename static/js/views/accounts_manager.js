// Shared palette of account badge colors
const ACCOUNT_COLORS = [
    '#3366ff', '#36b37e', '#ff5630', '#ffab00', '#00b8d9',
    '#6554c0', '#ff8a65', '#e91e8a', '#8bc34a', '#795548'
];

window.AccountsView = {
    accounts: [],
    mainAccountId: null,
    bankConnections: [],
    fileAccountMapping: {},
    _colorPopoverId: null,  // track open popover
    
    render() {
        const bankSyncHtml = window.BankSyncView ? window.BankSyncView.render() : '';

        return `
            <div class="view-header-bar" style="position:relative;top:0;margin-top:0;padding-top:0;margin-bottom:24px;">
                <div class="view-header-title-group">
                    <h2 class="view-header-title">
                        🏦 <span data-i18n="acc_header_title">${window.i18n.t('acc_header_title')}</span>
                    </h2>
                </div>
            </div>
            
            <!-- Section 1 : Synchronisation Bancaire -->
            <div style="margin-bottom: 28px;">
                ${bankSyncHtml}
            </div>

            <!-- Séparateur -->
            <div style="height: 1px; background: var(--border-color); margin: 30px 0 25px 0;"></div>

            <!-- Section 2 : Gestion des Comptes OmniBank -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h3 style="margin:0; font-size:18px; font-weight:700; color:var(--text-main); display:flex; align-items:center; gap:8px;">
                    <span>📋</span> <span data-i18n="acc_section_omnibank">${window.i18n.t('acc_section_omnibank')}</span>
                </h3>
            </div>

            <div class="accounts-add-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 18px; border-radius: 14px; border: 1px solid var(--border-color);">
                <h4 style="margin:0 0 12px 0; font-size:14px; font-weight:600; color:var(--text-main);" data-i18n="acc_new_account">${window.i18n.t('acc_new_account')}</h4>
                <div class="accounts-add-form" style="display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end;">
                    <input type="text" id="acc_name" class="inline-input" data-i18n-placeholder="acc_ph_name" placeholder="${window.i18n.t('acc_ph_name') || 'Nom du compte'}" style="border:1px solid var(--border-color); padding: 5px; flex: 2;">
                    <div style="flex:1; display:flex; flex-direction:column; gap:4px;">
                        <select id="acc_type_select" class="inline-input" style="border:1px solid var(--border-color); padding: 5px;" onchange="window.AccountsView.onTypeChange()">
                            <option value="Compte courant">${window.i18n.t('wizard_type_checking')}</option>
                            <option value="Livret">${window.i18n.t('wizard_type_savings')}</option>
                            <option value="PEA">${window.i18n.t('wizard_type_pea')}</option>
                            <option value="Assurance Vie">${window.i18n.t('wizard_type_life_ins')}</option>
                            <option value="PER">${window.i18n.t('wizard_type_per')}</option>
                            <option value="Prêt / Emprunt">${window.i18n ? (window.i18n.t('wizard_type_loan') || 'Prêt / Emprunt') : 'Prêt / Emprunt'}</option>
                            <option value="__other__">${window.i18n.t('wizard_type_other')}</option>
                        </select>
                        <input type="text" id="acc_type_custom" class="inline-input" data-i18n-placeholder="acc_ph_type" placeholder="${window.i18n.t('acc_ph_type') || 'Type personnalisé...'}" style="border:1px solid var(--border-color); padding: 5px; display:none;">
                    </div>
                    <select id="acc_currency" class="inline-input" style="border:1px solid var(--border-color); padding: 5px; flex: 0.8;">
                        <option value="EUR">EUR (€)</option>
                        <option value="USD">USD ($)</option>
                        <option value="GBP">GBP (£)</option>
                        <option value="CHF">CHF (CHF)</option>
                        <option value="CAD">CAD (CA$)</option>
                        <option value="JPY">JPY (¥)</option>
                    </select>
                    <input type="number" id="acc_balance" class="inline-input" data-i18n-placeholder="ph_initial_balance" placeholder="${window.i18n.t('ph_initial_balance') || 'Solde Initial'}" step="0.01" style="border:1px solid var(--border-color); padding: 5px; flex: 1;">
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

            <div class="accounts-table-card" style="overflow-x: auto;">
                <table class="data-table accounts-data-table">
                    <thead>
                        <tr>
                            <th class="acc-col-name" data-i18n="acc_th_name">${window.i18n.t('acc_th_name')}</th>
                            <th class="acc-col-type" data-i18n="acc_th_type">${window.i18n.t('acc_th_type')}</th>
                            <th class="acc-col-feed" data-i18n="acc_th_feed">${window.i18n.t('acc_th_feed') || 'Alimentation'}</th>
                            <th class="acc-col-init" data-i18n="acc_th_initial_balance">${window.i18n.t('acc_th_initial_balance')}</th>
                            <th class="acc-col-curr" data-i18n="acc_th_current_balance">${window.i18n.t('acc_th_current_balance') || 'Solde Actuel'}</th>
                            <th class="acc-col-actions col-actions" data-i18n="acc_th_actions">${window.i18n.t('acc_th_actions')}</th>
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
        await Promise.all([
            this.loadData(),
            window.BankSyncView ? window.BankSyncView.init() : Promise.resolve()
        ]);
        // Close popover on outside click
        document.addEventListener('click', (e) => {
            if (this._colorPopoverId && !e.target.closest('.acc-color-popover') && !e.target.classList.contains('acc-color-dot')) {
                this._closePopover();
            }
        });
    },

    async loadData() {
        try {
            const [accs, mainAcc, configs, conns] = await Promise.all([
                API.get('/api/accounts/'),
                API.get('/api/stats/main_account').catch(() => null),
                API.get('/api/config/').catch(() => ({})),
                API.get('/api/bank-sync/connections').catch(() => [])
            ]);

            this.accounts = accs || [];
            this.mainAccountId = mainAcc?.id || null;
            this.bankConnections = conns || [];
            try {
                this.fileAccountMapping = (configs && configs.file_account_mapping)
                    ? (typeof configs.file_account_mapping === 'string' ? JSON.parse(configs.file_account_mapping) : configs.file_account_mapping)
                    : {};
            } catch (e) {
                this.fileAccountMapping = {};
            }

            this.renderTable();

            if (window.BankSyncView && typeof window.BankSyncView.init === 'function') {
                window.BankSyncView.init().catch(e => console.warn('[BankSync] Erreur init:', e));
            }
        } catch (e) {
            console.error("Failed to load accounts", e);
        }
    },

    _getAccountFeedSource(accountId) {
        // 1. Vérifier si associé à une connexion Woob en ligne
        if (this.bankConnections && this.bankConnections.length > 0) {
            for (const conn of this.bankConnections) {
                if (!conn.account_mapping) continue;
                let mapping = {};
                try {
                    mapping = typeof conn.account_mapping === 'string'
                        ? JSON.parse(conn.account_mapping)
                        : conn.account_mapping;
                } catch (_) {}

                for (const [remoteId, localId] of Object.entries(mapping)) {
                    if (parseInt(localId, 10) === accountId) {
                        return {
                            type: 'online',
                            conn: conn,
                            label: conn.label || conn.backend
                        };
                    }
                }
            }
        }

        // 2. Vérifier si associé à une section/onglet de relevé (fichier)
        if (this.fileAccountMapping) {
            for (const [sectionTitle, targetId] of Object.entries(this.fileAccountMapping)) {
                if (parseInt(targetId, 10) === accountId) {
                    return {
                        type: 'file',
                        section: sectionTitle
                    };
                }
            }
        }

        // 3. Sinon : Manuel
        return {
            type: 'manual'
        };
    },

    openImportForAccount(accId) {
        if (window.ImportWizard && typeof window.ImportWizard.open === 'function') {
            window.ImportWizard.open(accId);
        }
    },

    async syncOnlineAccount(connId) {
        if (window.BankSyncView && typeof window.BankSyncView.triggerBackgroundSyncNow === 'function') {
            await window.BankSyncView.triggerBackgroundSyncNow();
        }
    },

    _getAccountCategory(type) {
        const t = (type || '').toLowerCase();
        if (t.includes('prêt') || t.includes('pret') || t.includes('emprunt') || t.includes('loan') || t.includes('crédit') || t.includes('credit')) {
            return 'loans';
        }
        if (t.includes('livret') || t.includes('saving') || t.includes('epargne') || t.includes('épargne') || t.includes('pea') || t.includes('assurance') || t.includes('per') || t.includes('titres')) {
            return 'savings';
        }
        return 'checking';
    },

    renderTable() {
        const tbody = document.getElementById('accountsBody');
        if (!tbody) return;

        if (!this.accounts || this.accounts.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">${window.i18n.t('no_accounts') || 'Aucun compte enregistré.'}</td></tr>`;
            return;
        }

        const groups = {
            checking: {
                title: window.i18n.t('acc_section_checking') || 'Comptes Courants & Cartes',
                icon: '💳',
                accounts: [],
                total_current: 0,
                total_initial: 0
            },
            savings: {
                title: window.i18n.t('acc_section_savings') || 'Épargne & Placements',
                icon: '🏦',
                accounts: [],
                total_current: 0,
                total_initial: 0
            },
            loans: {
                title: window.i18n.t('acc_section_loans') || 'Crédits & Emprunts',
                icon: '📑',
                accounts: [],
                total_current: 0,
                total_initial: 0
            }
        };

        this.accounts.forEach(acc => {
            const cat = this._getAccountCategory(acc.type);
            groups[cat].accounts.push(acc);
            if (!acc.is_closed) {
                const curBal = acc.current_balance !== undefined && acc.current_balance !== null ? acc.current_balance : (acc.initial_balance || 0);
                groups[cat].total_current += curBal;
                groups[cat].total_initial += (acc.initial_balance || 0);
            }
        });

        let html = '';
        ['checking', 'savings', 'loans'].forEach(key => {
            const group = groups[key];
            if (group.accounts.length === 0) return;

            const totalColor = key === 'loans' ? '#ef4444' : (group.total_current >= 0 ? '#10b981' : '#ef4444');
            const totalPrefix = key === 'loans' 
                ? (window.i18n.t('acc_total_crd') || 'Capital restant dû :') 
                : (key === 'savings' ? (window.i18n.t('acc_total_saved') || 'Épargne totale :') : (window.i18n.t('acc_total_available') || 'Disponibilités :'));

            html += `
            <tr class="acc-group-header-tr" style="background: var(--bg-hover, rgba(255,255,255,0.03)); border-top: 2px solid var(--border-color);">
                <td colspan="6" style="padding: 9px 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <span style="font-weight: 700; font-size: 13px; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                            <span>${group.icon}</span> <span>${group.title}</span>
                            <span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">(${group.accounts.length})</span>
                        </span>
                        <div style="display: flex; align-items: center; gap: 12px; font-size: 12px;">
                            <span style="color: var(--text-muted); font-size: 11px;">(Initial : <strong class="privacy-blur" style="font-family: monospace;">${formatCurrency(group.total_initial)}</strong>)</span>
                            <span style="font-weight: 600; color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
                                <span>${totalPrefix}</span>
                                <strong style="color: ${totalColor}; font-family: monospace; font-size: 13px;" class="privacy-blur">${formatCurrency(group.total_current)}</strong>
                            </span>
                        </div>
                    </div>
                </td>
            </tr>
            `;

            html += group.accounts.map(acc => {
                const isMain = acc.id === this.mainAccountId;
                const color = acc.color || ACCOUNT_COLORS[0];
                const curr = acc.currency || 'EUR';
                const curBal = acc.current_balance !== undefined && acc.current_balance !== null ? acc.current_balance : (acc.initial_balance || 0);
                const curBalColor = curBal < 0 ? '#ef4444' : '#10b981';

                // Calculs dynamiques de taux et mensualités
                let subInfoHtml = '';
                if (key === 'savings' && acc.interest_rate > 0) {
                    const today = new Date();
                    const monthsLeft = Math.max(1, 12 - today.getMonth());
                    const bal = Math.max(0, curBal);
                    const estimated = Math.round(bal * (acc.interest_rate / 100) * (monthsLeft / 12) * 100) / 100;
                    subInfoHtml = `
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        <span>${window.i18n.t('acc_rate_label')} <strong style="color: var(--accent);">${acc.interest_rate}%</strong></span>
                        <span>•</span>
                        <span>${window.i18n.t('acc_estimated_interest') || 'Intérêts estimés au 31/12'} : <strong style="color: #10b981;">+${formatCurrency(estimated, curr)}</strong></span>
                        <button class="btn btn-secondary btn-sm" onclick="window.AccountsView.openInterestModal(${acc.id}, ${estimated})" style="padding: 1px 7px; font-size: 10px; border-radius: 6px; height: 22px;" title="${window.i18n.t('acc_btn_record_interest') || 'Comptabiliser les intérêts'}">
                            🎁 ${window.i18n.t('acc_btn_record_interest') || 'Comptabiliser'}
                        </button>
                    </div>
                    `;
                } else if (key === 'loans') {
                    const crd = Math.abs(curBal);
                    const rate = acc.interest_rate || 0;
                    const payment = acc.monthly_payment || 0;
                    const interestM = rate > 0 ? Math.round(crd * (rate / 100) / 12 * 100) / 100 : 0;
                    const capitalM = Math.round(Math.max(0, payment - interestM) * 100) / 100;

                    let parts = [];
                    if (rate > 0) parts.push(`${window.i18n.t('acc_rate_label')} <strong style="color: #ef4444;">${rate}%</strong>`);
                    if (payment > 0) {
                        parts.push(`${window.i18n.t('acc_monthly_payment_label')} <strong>${formatCurrency(payment, curr)}</strong> (<span style="color:#10b981;">${window.i18n.t('acc_capital_label')} ${formatCurrency(capitalM, curr)}</span> • <span style="color:#ef4444;">${window.i18n.t('acc_interest_label')} ${formatCurrency(interestM, curr)}</span>)`);
                    }
                    if (parts.length > 0) {
                        subInfoHtml = `
                        <div style="font-size: 11px; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            ${parts.join(' • ')}
                        </div>
                        `;
                    }
                }

                const feedSource = this._getAccountFeedSource(acc.id);
                let sourceBadgeHtml = '';
                let feedActionBtn = '';

                if (feedSource.type === 'online') {
                    const rawTemplate = window.i18n.t('acc_source_online') || 'En ligne : {bank}';
                    const text = rawTemplate.replace('{bank}', feedSource.label);
                    sourceBadgeHtml = `
                        <span class="acc-feed-badge feed-online" style="display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 6px; background: rgba(16,185,129,0.1); color: #10b981; border: 1px solid rgba(16,185,129,0.25); font-size: 11px; font-weight: 600;">
                            <span style="font-size: 8px;">🟢</span>
                            <span>${text}</span>
                        </span>`;
                    feedActionBtn = `
                        <button class="acc-action-btn acc-feed-btn" onclick="window.AccountsView.syncOnlineAccount(${feedSource.conn.id})" title="${window.i18n.t('acc_btn_sync_tooltip') || 'Relever les opérations en ligne pour ce compte'}" style="color: #10b981;">⚡</button>
                        <button class="acc-action-btn acc-feed-btn" onclick="window.AccountsView.openImportForAccount(${acc.id})" title="${window.i18n.t('acc_btn_import_tooltip') || 'Importer un relevé pour ce compte (XLSX / CSV)'}" style="color: var(--accent);">📥</button>
                    `;
                } else if (feedSource.type === 'file') {
                    const rawTemplate = window.i18n.t('acc_source_file') || 'Relevé : "{section}"';
                    const text = rawTemplate.replace('{section}', feedSource.section);
                    sourceBadgeHtml = `
                        <span class="acc-feed-badge feed-file" style="display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 6px; background: rgba(99,102,241,0.1); color: var(--accent); border: 1px solid rgba(99,102,241,0.25); font-size: 11px; font-weight: 600;">
                            <span style="font-size: 10px;">📄</span>
                            <span>${text}</span>
                        </span>`;
                    feedActionBtn = `<button class="acc-action-btn acc-feed-btn" onclick="window.AccountsView.openImportForAccount(${acc.id})" title="${window.i18n.t('acc_btn_import_tooltip') || 'Importer un relevé pour ce compte (XLSX / CSV)'}" style="color: var(--accent);">📥</button>`;
                } else {
                    const text = window.i18n.t('acc_source_manual') || 'Saisie manuelle';
                    sourceBadgeHtml = `
                        <span class="acc-feed-badge feed-manual" style="display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px; border-radius: 6px; background: var(--bg-hover, rgba(255,255,255,0.03)); color: var(--text-muted); border: 1px solid var(--border-color); font-size: 11px; font-weight: 500;">
                            <span style="font-size: 10px;">✏️</span>
                            <span>${text}</span>
                        </span>`;
                    feedActionBtn = `<button class="acc-action-btn acc-feed-btn" onclick="window.AccountsView.openImportForAccount(${acc.id})" title="${window.i18n.t('acc_btn_import_tooltip') || 'Importer un relevé pour ce compte (XLSX / CSV)'}" style="color: var(--text-muted);">📥</button>`;
                }

                return `
                <tr style="${acc.is_closed ? 'opacity: 0.6;' : ''}">
                    <td class="acc-col-name">
                        <div style="display: inline-flex; align-items: center; gap: 6px;">
                            ${isMain ? '<span class="acc-main-star" title="' + window.i18n.t('acc_main_account') + '" style="cursor:pointer;" onclick="window.AccountsView.setMainAccount(' + acc.id + ')">⭐</span>' : ''}
                            <strong style="color: var(--text-main); font-size: 13px;">${acc.name}</strong>
                            <span class="acc-color-dot" style="background:${color}; cursor:pointer; width: 11px; height: 11px; border-radius: 50%; display: inline-block; flex-shrink: 0; box-shadow: 0 0 0 1px var(--border-color);" onclick="window.AccountsView.openColorPopover(${acc.id}, this)" title="${window.i18n.t('acc_color_label')}"></span>
                            ${acc.is_closed ? `<span data-i18n="badge_closed" style="background:var(--danger); color:#fff; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:bold;">${window.i18n.t('badge_closed') || 'Fermé'}</span>` : ''}
                        </div>
                        ${subInfoHtml}
                    </td>
                    <td class="acc-col-type" style="white-space: nowrap;">
                        <span class="badge" style="background: var(--bg-hover); color: var(--text-main); font-size: 11px; padding: 2px 7px; border-radius: 6px; border: 1px solid var(--border-color);">${acc.type}</span>
                        <span class="badge" style="background: rgba(99,102,241,0.08); color: var(--primary); font-weight: 700; padding: 2px 5px; border-radius: 4px; font-size: 10px; margin-left: 3px;">${curr}</span>
                    </td>
                    <td class="acc-col-feed" style="white-space: nowrap;">
                        ${sourceBadgeHtml}
                    </td>
                    <td class="acc-col-init" style="text-align: right; font-size: 12.5px;"><span class="privacy-blur" style="color: var(--text-muted); font-family: monospace;">${formatCurrency(acc.initial_balance, curr)}</span></td>
                    <td class="acc-col-curr" style="text-align: right; font-size: 12.5px;"><strong class="privacy-blur" style="color: ${curBalColor}; font-family: monospace;">${formatCurrency(curBal, curr)}</strong></td>
                    <td class="acc-col-actions col-actions">
                        <div class="acc-actions-wrap">
                            ${feedActionBtn}
                            <button class="acc-action-btn ${isMain ? 'acc-star-active' : 'acc-star-btn'}" onclick="window.AccountsView.setMainAccount(${acc.id})" title="${window.i18n.t('acc_set_main')}">${isMain ? '⭐' : '☆'}</button>
                            <button class="acc-action-btn acc-history-btn" onclick="window.AccountsView.viewHistory(${acc.id})" title="${window.i18n.t('acc_view_history') || 'Voir les opérations dans l\'historique'}">↗️</button>
                            <button class="acc-action-btn acc-edit-btn" onclick="window.AccountsView.edit(${acc.id})" title="${window.i18n.t('tooltip_edit')}">✏️</button>
                            <button class="acc-action-btn acc-lock-btn" onclick="window.AccountsView.toggleClose(${acc.id})" title="${acc.is_closed ? window.i18n.t('acc_reopen_action') : window.i18n.t('acc_close_action')}">${acc.is_closed ? '🔓' : '🔒'}</button>
                            <button class="acc-action-btn acc-del-btn" onclick="window.AccountsView.delete(${acc.id})" title="${window.i18n.t('tooltip_delete')}">✕</button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        });

        tbody.innerHTML = html;

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
        this._closePopover();
        const acc = this.accounts.find(a => a.id === accId);
        if (!acc) return;
        try {
            await API.put(`/api/accounts/${accId}`, {
                name: acc.name,
                type: acc.type,
                initial_balance: acc.initial_balance,
                is_closed: acc.is_closed,
                color: color,
                currency: acc.currency || 'EUR',
                interest_rate: acc.interest_rate,
                borrowed_amount: acc.borrowed_amount,
                monthly_payment: acc.monthly_payment,
                loan_insurance: acc.loan_insurance,
                loan_end_date: acc.loan_end_date
            });
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
            const currency = document.getElementById('acc_currency') ? document.getElementById('acc_currency').value : 'EUR';

            const data = {
                name: document.getElementById('acc_name').value,
                type: type,
                initial_balance: parseFloat(document.getElementById('acc_balance').value) || 0,
                is_closed: false,
                color: color,
                currency: currency
            };
            if (!data.name) return await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_name_required'));
            
            const res = await API.post('/api/accounts/', data);
            
            document.getElementById('acc_name').value = '';
            document.getElementById('acc_type_select').value = 'Compte courant';
            document.getElementById('acc_type_custom').value = '';
            document.getElementById('acc_type_custom').style.display = 'none';
            document.getElementById('acc_balance').value = '';
            
            await this.loadData();
            window.app.refreshSidebar();
            
            showUndoToast(window.i18n.t('toast_acc_created') || 'Compte créé', res.action_id, () => this.loadData().then(() => window.app.refreshSidebar()));

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
                const res = await API.del(`/api/accounts/${id}`);
                await this.loadData();
                window.app.refreshSidebar();
                showUndoToast(window.i18n.t('toast_acc_deleted') || 'Compte supprimé', res.action_id, () => this.loadData().then(() => window.app.refreshSidebar()));
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
                const res = await API.put(`/api/accounts/${id}`, {
                    name: acc.name,
                    type: acc.type,
                    initial_balance: acc.initial_balance,
                    is_closed: !acc.is_closed,
                    color: acc.color,
                    currency: acc.currency || 'EUR',
                    interest_rate: acc.interest_rate,
                    borrowed_amount: acc.borrowed_amount,
                    monthly_payment: acc.monthly_payment,
                    loan_insurance: acc.loan_insurance,
                    loan_end_date: acc.loan_end_date
                });
                await this.loadData();
                window.app.refreshSidebar();
                showUndoToast(window.i18n.t('toast_acc_updated') || 'Statut du compte modifié', res.action_id, () => this.loadData().then(() => window.app.refreshSidebar()));
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
        const existing = document.getElementById('accEditModal');
        if (existing) existing.remove();

        const knownTypes = ['Compte courant', 'Livret', 'PEA', 'Assurance Vie', 'PER', 'Prêt / Emprunt'];
        const isCustomType = !knownTypes.includes(acc.type);
        const currentColor = acc.color || ACCOUNT_COLORS[0];
        const currentCurrency = acc.currency || 'EUR';
        const curBal = acc.current_balance !== undefined && acc.current_balance !== null ? acc.current_balance : (acc.initial_balance || 0);
        const netFlow = curBal - (acc.initial_balance || 0);
        const flowStr = typeof formatCurrency === 'function' ? formatCurrency(netFlow, currentCurrency) : `${netFlow.toFixed(2)} ${currentCurrency}`;
        const curBalStr = typeof formatCurrency === 'function' ? formatCurrency(curBal, currentCurrency) : `${curBal.toFixed(2)} ${currentCurrency}`;

        const typeOptions = [
            { value: 'Compte courant', label: window.i18n.t('wizard_type_checking') },
            { value: 'Livret', label: window.i18n.t('wizard_type_savings') },
            { value: 'PEA', label: window.i18n.t('wizard_type_pea') },
            { value: 'Assurance Vie', label: window.i18n.t('wizard_type_life_ins') },
            { value: 'PER', label: window.i18n.t('wizard_type_per') },
            { value: 'Prêt / Emprunt', label: window.i18n ? (window.i18n.t('wizard_type_loan') || 'Prêt / Emprunt') : 'Prêt / Emprunt' },
            { value: '__other__', label: window.i18n.t('wizard_type_other') }
        ].map(o => `<option value="${o.value}" ${(isCustomType ? o.value === '__other__' : acc.type === o.value) ? 'selected' : ''}>${o.label}</option>`).join('');

        const currencyOpts = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'JPY'].map(c =>
            `<option value="${c}" ${currentCurrency === c ? 'selected' : ''}>${c}</option>`
        ).join('');

        const modalHtml = `
        <div id="accEditModal" class="modal-overlay" style="display:flex;z-index:10000;" onclick="if(event.target===this) this.remove()">
            <div class="modal" style="width: min(520px, calc(100vw - 24px)); max-width:90vw;">
                <h3 style="margin-bottom:18px;">${window.i18n.t('acc_edit_title') || 'Modifier le compte'}</h3>
                <div style="display:flex;flex-direction:column;gap:14px; max-height: 75vh; overflow-y: auto; padding-right: 4px;">
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_name')}</label>
                        <input type="text" id="accEditName" class="inline-input" value="${acc.name.replace(/"/g, '&quot;')}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_type')}</label>
                        <select id="accEditType" class="inline-input" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;" onchange="
                            const custom = document.getElementById('accEditTypeCustom');
                            if (this.value === '__other__') { custom.style.display='block'; custom.focus(); } else { custom.style.display='none'; custom.value=''; }
                            window.AccountsView._updateEditModalFields();
                        ">${typeOptions}</select>
                        <input type="text" id="accEditTypeCustom" class="inline-input" value="${isCustomType ? acc.type : ''}" placeholder="${window.i18n.t('acc_ph_type')}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;margin-top:6px;display:${isCustomType ? 'block' : 'none'};" oninput="window.AccountsView._updateEditModalFields()">
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <div style="flex: 1;">
                            <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_currency') || 'Devise'}</label>
                            <select id="accEditCurrency" class="inline-input" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">${currencyOpts}</select>
                        </div>
                        <div style="flex: 1.5;">
                            <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_initial_balance')}</label>
                            <input type="number" id="accEditBalance" class="inline-input" value="${acc.initial_balance}" step="0.01" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                        </div>
                    </div>

                    <!-- Encart Recalage / Ajustement Intelligent de Solde -->
                    <div style="background: var(--bg-hover, rgba(255,255,255,0.03)); border: 1px dashed var(--border-color); border-radius: 8px; padding: 10px 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 4px;">
                            <span style="font-size: 11px; font-weight: 700; color: var(--accent);">${window.i18n.t('acc_realign_title')}</span>
                            <span style="font-size: 11px; color: var(--text-muted);">${window.i18n.t('acc_current_balance_lbl')} : <strong style="color:var(--text-main); font-family: monospace;">${curBalStr}</strong></span>
                        </div>
                        <div style="font-size: 10.5px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.35;">
                            ${(window.i18n.t('acc_realign_hint') || '').replace('{flow}', flowStr)}
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="number" step="0.01" id="accEditTargetBal" class="inline-input" placeholder="${window.i18n.t('ph_initial_balance') || 'Ex: 1119.68'}" style="flex: 1; height: 32px; padding: 0 8px; font-size: 12px; border-radius: 6px;">
                            <button type="button" class="btn btn-secondary" style="height: 32px; font-size: 11px; padding: 0 10px; border-radius: 6px; white-space: nowrap; font-weight: 600;" onclick="window.AccountsView._realignInitialBalance(${acc.id})">
                                ${window.i18n.t('acc_realign_btn')}
                            </button>
                        </div>
                    </div>

                    <!-- Encart Taux & Paramètres Financiers Dynamiques -->
                    <div id="accEditFinancialBox" style="background: var(--bg-hover, rgba(255,255,255,0.03)); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px;">
                        <div id="accEditFinancialTitle" style="font-size: 11px; font-weight: 700; color: var(--text-main); margin-bottom: 8px; text-transform: uppercase;">
                            📊 ${window.i18n.t('acc_section_savings_rate') || 'Rendement & Taux annuel'}
                        </div>
                        <div id="accEditFinancialGrid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <div id="accEditRateCol">
                                <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;">${window.i18n.t('acc_interest_rate') || 'Taux annuel (%)'}</label>
                                <input type="number" step="0.01" id="accEditRate" class="inline-input" value="${acc.interest_rate !== null && acc.interest_rate !== undefined ? acc.interest_rate : ''}" placeholder="Ex: 3.0" style="width:100%;border:1px solid var(--border-color);padding:6px;border-radius:6px;font-size:12px;">
                            </div>
                            <div id="accEditMonthlyCol">
                                <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;">${window.i18n.t('acc_monthly_payment') || 'Mensualité (€)'}</label>
                                <input type="number" step="0.01" id="accEditMonthly" class="inline-input" value="${acc.monthly_payment !== null && acc.monthly_payment !== undefined ? acc.monthly_payment : ''}" placeholder="Ex: 650.0" style="width:100%;border:1px solid var(--border-color);padding:6px;border-radius:6px;font-size:12px;">
                            </div>
                            <div id="accEditBorrowedCol">
                                <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;">${window.i18n.t('acc_borrowed_amount') || 'Montant initial emprunté'}</label>
                                <input type="number" step="0.01" id="accEditBorrowed" class="inline-input" value="${acc.borrowed_amount !== null && acc.borrowed_amount !== undefined ? acc.borrowed_amount : ''}" placeholder="Ex: 120000" style="width:100%;border:1px solid var(--border-color);padding:6px;border-radius:6px;font-size:12px;">
                            </div>
                            <div id="accEditInsuranceCol">
                                <label style="font-size: 11px; color: var(--text-muted); display: block; margin-bottom: 2px;">${window.i18n.t('acc_loan_insurance') || 'Assurance (€/mois)'}</label>
                                <input type="number" step="0.01" id="accEditInsurance" class="inline-input" value="${acc.loan_insurance !== null && acc.loan_insurance !== undefined ? acc.loan_insurance : ''}" placeholder="Ex: 25.0" style="width:100%;border:1px solid var(--border-color);padding:6px;border-radius:6px;font-size:12px;">
                            </div>
                        </div>
                    </div>

                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_color')}</label>
                        <div id="accEditColorPicker" class="acc-color-picker" style="margin-top:4px;">
                            ${this._renderColorDots('accEditColor', currentColor)}
                        </div>
                        <input type="hidden" id="accEditColor" value="${currentColor}">
                    </div>
                </div>
                <div class="modal-actions" style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:10px;">
                    <button class="btn btn-secondary" onclick="window.AccountsView._closeEditModal()">${window.i18n.t('btn_cancel')}</button>
                    <button class="btn btn-primary" onclick="window.AccountsView._saveEdit(${acc.id})">${window.i18n.t('btn_save_changes') || 'Enregistrer'}</button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this._updateEditModalFields();
    },

    _updateEditModalFields() {
        const typeSelect = document.getElementById('accEditType');
        const customInput = document.getElementById('accEditTypeCustom');
        const box = document.getElementById('accEditFinancialBox');
        const title = document.getElementById('accEditFinancialTitle');
        const grid = document.getElementById('accEditFinancialGrid');
        const monthlyCol = document.getElementById('accEditMonthlyCol');
        const borrowedCol = document.getElementById('accEditBorrowedCol');
        const insuranceCol = document.getElementById('accEditInsuranceCol');

        if (!typeSelect || !box) return;

        const effectiveType = (typeSelect.value === '__other__' ? (customInput?.value || '') : typeSelect.value).toLowerCase();
        const isLoan = effectiveType.includes('prêt') || effectiveType.includes('pret') || effectiveType.includes('emprunt') || effectiveType.includes('loan') || effectiveType.includes('crédit') || effectiveType.includes('credit');
        const isSavings = effectiveType.includes('livret') || effectiveType.includes('pea') || effectiveType.includes('assurance') || effectiveType.includes('per') || effectiveType.includes('épargne') || effectiveType.includes('saving');

        if (isLoan) {
            box.style.display = 'block';
            title.innerHTML = '📑 ' + (window.i18n.t('acc_section_loan_params') || 'Paramètres de l\'Emprunt');
            grid.style.gridTemplateColumns = '1fr 1fr';
            monthlyCol.style.display = 'block';
            borrowedCol.style.display = 'block';
            insuranceCol.style.display = 'block';
        } else if (isSavings) {
            box.style.display = 'block';
            title.innerHTML = '📈 ' + (window.i18n.t('acc_section_savings_rate') || 'Rendement & Taux annuel');
            grid.style.gridTemplateColumns = '1fr';
            monthlyCol.style.display = 'none';
            borrowedCol.style.display = 'none';
            insuranceCol.style.display = 'none';
        } else {
            box.style.display = 'none';
        }
    },

    _realignInitialBalance(accId) {
        const acc = this.accounts.find(a => a.id === accId);
        if (!acc) return;
        const targetInput = document.getElementById('accEditTargetBal');
        const rawStr = (targetInput ? targetInput.value : '').replace(/\s/g, '').replace(',', '.');
        const targetVal = parseFloat(rawStr);
        if (isNaN(targetVal)) {
            if (typeof showToast === 'function') {
                const errMsg = (window.i18n && window.i18n.t('toast_invalid_amount') && window.i18n.t('toast_invalid_amount') !== 'toast_invalid_amount') 
                    ? window.i18n.t('toast_invalid_amount') 
                    : (window.i18n ? window.i18n.t('msg_invalid_amount') || 'Veuillez saisir un montant valide.' : 'Veuillez saisir un montant valide.');
                showToast(errMsg, 'warning');
            }
            if (targetInput) targetInput.focus();
            return;
        }

        const curBal = acc.current_balance !== undefined && acc.current_balance !== null ? acc.current_balance : (acc.initial_balance || 0);
        const netFlow = curBal - (acc.initial_balance || 0);
        const calculatedInitial = parseFloat((targetVal - netFlow).toFixed(2));
        
        const initInput = document.getElementById('accEditBalance');
        if (initInput) {
            initInput.value = calculatedInitial;
            initInput.style.borderColor = 'var(--accent)';
            setTimeout(() => { initInput.style.borderColor = 'var(--border-color)'; }, 1500);
        }

        if (typeof showToast === 'function') {
            const fmtInit = typeof formatCurrency === 'function' ? formatCurrency(calculatedInitial, acc.currency) : `${calculatedInitial} €`;
            const fmtCur = typeof formatCurrency === 'function' ? formatCurrency(targetVal, acc.currency) : `${targetVal} €`;
            const msg = (window.i18n.t('acc_realign_success') || 'Solde initial ajusté à {initial} pour un solde actuel de {current}')
                .replace('{initial}', fmtInit)
                .replace('{current}', fmtCur);
            showToast(msg, 'success');
        }
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

        const currency = document.getElementById('accEditCurrency').value;

        const balanceStr = document.getElementById('accEditBalance').value;
        const balance = parseFloat(balanceStr.replace(',', '.'));
        if (isNaN(balance)) return await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_invalid_amount'));

        const color = document.getElementById('accEditColor').value || ACCOUNT_COLORS[0];

        const rateVal = parseFloat(document.getElementById('accEditRate')?.value);
        const monthlyVal = parseFloat(document.getElementById('accEditMonthly')?.value);
        const borrowedVal = parseFloat(document.getElementById('accEditBorrowed')?.value);
        const insuranceVal = parseFloat(document.getElementById('accEditInsurance')?.value);

        try {
            const res = await API.put(`/api/accounts/${id}`, {
                name: name,
                type: type,
                initial_balance: balance,
                is_closed: acc.is_closed,
                color: color,
                currency: currency,
                interest_rate: !isNaN(rateVal) ? rateVal : null,
                monthly_payment: !isNaN(monthlyVal) ? monthlyVal : null,
                borrowed_amount: !isNaN(borrowedVal) ? borrowedVal : null,
                loan_insurance: !isNaN(insuranceVal) ? insuranceVal : null
            });
            this._closeEditModal();
            await this.loadData();
            window.app.refreshSidebar();
            showUndoToast(window.i18n.t('toast_acc_updated') || 'Compte mis à jour', res.action_id, () => this.loadData().then(() => window.app.refreshSidebar()));
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_edit_error'));
        }
    },

    openInterestModal(accId, defaultAmount = 0) {
        const existing = document.getElementById('accInterestModal');
        if (existing) existing.remove();

        const acc = this.accounts.find(a => a.id === accId);
        if (!acc) return;

        const today = new Date();
        const defaultDate = `${today.getFullYear()}-12-31`;

        const modalHtml = `
        <div id="accInterestModal" class="modal-overlay" style="display:flex;z-index:10000;backdrop-filter:blur(4px);" onclick="if(event.target===this) this.remove()">
            <div class="modal" style="width: min(440px, calc(100vw - 24px)); max-width:90vw;">
                <h3 style="margin-bottom:8px; display:flex; align-items:center; gap:8px;">
                    <span>🎁</span> <span>${window.i18n.t('acc_modal_interest_title') || 'Comptabilisation des Intérêts'}</span>
                </h3>
                <p style="font-size:12px; color:var(--text-muted); margin-bottom:16px;">
                    ${window.i18n.t('acc_modal_interest_desc') || "Ajustez le montant exact versé par votre banque pour l'année :"}
                </p>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <div>
                        <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_interest_modal_account')}</label>
                        <input type="text" class="inline-input" value="${acc.name} (${acc.currency || 'EUR'})" disabled style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;opacity:0.75;">
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_interest_modal_amount')}</label>
                        <input type="number" step="0.01" id="accInterestAmount" class="inline-input" value="${defaultAmount.toFixed(2)}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;font-size:14px;font-weight:700;color:#10b981;">
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_interest_modal_date')}</label>
                        <input type="date" id="accInterestDate" class="inline-input" value="${defaultDate}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                    </div>
                    <div>
                        <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_interest_modal_desc_label')}</label>
                        <input type="text" id="accInterestDesc" class="inline-input" value="${window.i18n.tp('acc_interest_default_desc', { year: today.getFullYear() })}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                    </div>
                </div>
                <div class="modal-actions" style="margin-top:20px;padding-top:14px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:10px;">
                    <button class="btn btn-secondary" onclick="document.getElementById('accInterestModal').remove()">${window.i18n.t('btn_cancel')}</button>
                    <button class="btn btn-primary" onclick="window.AccountsView.submitInterest(${accId})">${window.i18n.t('acc_interest_modal_submit')}</button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
    },

    async submitInterest(accId) {
        const amtInput = document.getElementById('accInterestAmount');
        const dateInput = document.getElementById('accInterestDate');
        const descInput = document.getElementById('accInterestDesc');

        const amount = parseFloat(amtInput?.value) || 0.0;
        const opDate = dateInput?.value || null;
        const desc = descInput?.value?.trim() || 'Intérêts annuels';

        if (amount <= 0) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_interest_modal_invalid_amt'));
            return;
        }

        try {
            await API.post(`/api/accounts/${accId}/apply-interest`, {
                amount: amount,
                date_operation: opDate,
                description: desc,
                category: 'Intérêts'
            });

            const modal = document.getElementById('accInterestModal');
            if (modal) modal.remove();

            await this.loadData();
            window.app.refreshSidebar();
            showUndoToast(window.i18n.t('acc_interest_modal_success'));
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.t('acc_interest_modal_error'));
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
    },

    viewHistory(accId) {
        if (window.AllOperationsView) {
            window.AllOperationsView.pendingFilter = {
                accountId: accId,
                backToView: 'accounts'
            };
        }
        if (window.app && window.app.loadView) {
            window.app.loadView('all_operations');
        }
    }
};
