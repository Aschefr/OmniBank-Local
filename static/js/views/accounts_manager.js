// Shared palette of account badge colors
const ACCOUNT_COLORS = [
    '#3366ff', '#36b37e', '#ff5630', '#ffab00', '#00b8d9',
    '#6554c0', '#ff8a65', '#e91e8a', '#8bc34a', '#795548'
];

// Stroke icons for the Accounts page (inherit currentColor)
const ACC_ICON_PATHS = {
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    hand: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    unlock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
    gift: '<path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1 0 1.6-.8 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.8-1.7 1.7-1.7H16a6 6 0 0 0 6-6C22 6 17.5 2 12 2z"/>'
};

function accIcon(name, size = 15) {
    return `<svg class="acc-ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ACC_ICON_PATHS[name] || ''}</svg>`;
}

function accEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

window.AccountsView = {
    accounts: [],
    mainAccountId: null,
    bankConnections: [],
    fileAccountMapping: {},
    _menuAccId: null,

    render() {
        const t = (k) => window.i18n.t(k);
        const bs = window.BankSyncView;
        if (bs && typeof bs.ensureModalsExist === 'function') bs.ensureModalsExist();
        const hasConn = !!(bs && Array.isArray(bs.connections) && bs.connections.length > 0);
        const newLabel = t('acc_new_account');

        return `
            <div class="view-header-bar acc-head">
                <div class="view-header-title-group">
                    <h2 class="view-header-title">🏦 <span data-i18n="acc_header_title">${t('acc_header_title')}</span></h2>
                    <button type="button" class="btn btn-primary acc-new-icon-btn" onclick="window.AccountsView.openCreateModal()" title="${newLabel}" aria-label="${newLabel}">${accIcon('plus', 18)}</button>
                </div>
                <div class="acc-head-actions">
                    <button id="btnHeaderBgSync" class="btn btn-secondary overview-bank-sync-btn" onclick="window.BankSyncView.triggerBackgroundSyncNow()" style="display: ${hasConn ? 'inline-flex' : 'none'};" data-i18n-title="bank_sync_run_background_tooltip" title="${t('bank_sync_run_background_tooltip')}">
                        <span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${t('bank_sync_run_background_btn')}</span>
                    </button>
                    <button type="button" class="btn btn-secondary acc-head-btn" onclick="window.ImportWizard ? window.ImportWizard.open() : null">
                        ${accIcon('download')}<span data-i18n="btn_import_statement">${t('btn_import_statement')}</span>
                    </button>
                    <button type="button" class="btn btn-primary acc-head-btn acc-new-btn" onclick="window.AccountsView.openCreateModal()">
                        ${accIcon('plus')}<span data-i18n="acc_new_account">${newLabel}</span>
                    </button>
                </div>
            </div>

            <div class="acc-sync-zone"><div class="acc-sync-row"><span id="bankSyncVaultPill" class="bank-sync-vault-wrapper"></span><div id="bankSyncAutoSyncCompact" class="bank-sync-auto-sync-widget" style="display:none;"></div></div><div id="bankPendingSyncBox" style="display:none;"></div></div>

            <div class="accounts-table-card acc-list-card">
                <table class="acc-t">
                    <thead>
                        <tr>
                            <th class="acc-col-name" data-i18n="acc_th_name">${t('acc_th_name')}</th>
                            <th class="acc-col-src" data-i18n="acc_th_feed">${t('acc_th_feed')}</th>
                            <th class="acc-col-num" data-i18n="acc_th_initial_balance">${t('acc_th_initial_balance')}</th>
                            <th class="acc-col-num" data-i18n="acc_th_current_balance">${t('acc_th_current_balance')}</th>
                            <th class="acc-col-act"><span class="acc-sr" data-i18n="acc_th_actions">${t('acc_th_actions')}</span></th>
                        </tr>
                    </thead>
                    <tbody id="accountsBody"></tbody>
                </table>
            </div>

            <div class="acc-conn-head">
                <h3 class="acc-sect-title" data-i18n="acc_section_connections">${t('acc_section_connections')}</h3>
                <button type="button" id="accLinkBankBtn" class="btn btn-secondary acc-head-btn" onclick="window.BankSyncView.openAddModal()" style="display: ${hasConn ? 'inline-flex' : 'none'};">
                    ${accIcon('plus', 14)}<span data-i18n="bank_link_add_btn">${t('bank_link_add_btn')}</span>
                </button>
            </div>
            <div id="bankConnectionsList"></div>
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

    async init() {
        // SWR : Rendu instantané si des comptes sont déjà en mémoire de session (0 ms)
        const knownAccounts = (this.accounts && this.accounts.length > 0) ? this.accounts : window.app.accounts;
        if (knownAccounts && knownAccounts.length > 0) {
            this.accounts = knownAccounts;
            this.mainAccountId = window.app.mainAccount?.id || this.mainAccountId;
            this.renderTable();
        }

        await this.loadData();

        if (!this._globalListenersAttached) {
            this._globalListenersAttached = true;
            document.addEventListener('click', (e) => {
                if (this._menuAccId !== null && !e.target.closest('.acc-menu') && !e.target.closest('.acc-more-btn')) {
                    this._closeMenu();
                }
            });
            document.addEventListener('keydown', (e) => {
                if (e.key !== 'Escape') return;
                if (this._menuAccId !== null) { this._closeMenu(true); return; }
                if (document.getElementById('accInterestModal')) { document.getElementById('accInterestModal').remove(); return; }
                if (document.getElementById('accEditModal')) this._closeEditModal();
            });
            window.addEventListener('resize', () => this._closeMenu());
            document.addEventListener('scroll', (e) => {
                if (this._menuAccId !== null && !e.target.closest?.('.acc-menu')) this._closeMenu();
            }, true);
        }
    },

    async loadData() {
        try {
            const [accs, mainAcc, configs, conns] = await Promise.all([
                API.get('/api/accounts/'),
                API.get('/api/stats/main_account').catch(() => null),
                (window.app && window.app.config) ? window.app.config : API.get('/api/config/').catch(() => ({})),
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
            this._updateLinkButton();

            if (window.BankSyncView && typeof window.BankSyncView.init === 'function') {
                window.BankSyncView.init()
                    .then(() => this._updateLinkButton())
                    .catch(e => console.warn('[BankSync] Erreur init:', e));
            }
        } catch (e) {
            console.error("Failed to load accounts", e);
        }
    },

    /** « Lier des comptes » appears in the section header only when a connection exists; the empty state carries its own button. */
    _updateLinkButton() {
        const btn = document.getElementById('accLinkBankBtn');
        if (!btn) return;
        const conns = (window.BankSyncView && Array.isArray(window.BankSyncView.connections) && window.BankSyncView.connections.length)
            ? window.BankSyncView.connections
            : this.bankConnections;
        btn.style.display = (conns && conns.length > 0) ? 'inline-flex' : 'none';
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

    _feedSourceText(feedSource) {
        if (feedSource.type === 'online') {
            return (window.i18n.t('acc_source_online') || 'En ligne : {bank}').replace('{bank}', feedSource.label);
        }
        if (feedSource.type === 'file') {
            return (window.i18n.t('acc_source_file') || 'Relevé : "{section}"').replace('{section}', feedSource.section);
        }
        return window.i18n.t('acc_source_manual') || 'Saisie manuelle';
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

    _baseCurrency() {
        return window.appBaseCurrency || 'EUR';
    },

    _currentBalance(acc) {
        return acc.current_balance !== undefined && acc.current_balance !== null ? acc.current_balance : (acc.initial_balance || 0);
    },

    _formatRate(rate) {
        const locale = window.i18n && window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR';
        return `${Number(rate).toLocaleString(locale, { maximumFractionDigits: 3 })} %`;
    },

    /** Interest estimated until Dec 31 for a savings account (same formula as before). */
    _estimatedInterest(acc) {
        const today = new Date();
        const monthsLeft = Math.max(1, 12 - today.getMonth());
        const bal = Math.max(0, this._currentBalance(acc));
        return Math.round(bal * (acc.interest_rate / 100) * (monthsLeft / 12) * 100) / 100;
    },

    renderTable() {
        const tbody = document.getElementById('accountsBody');
        if (!tbody) return;
        const t = (k) => window.i18n.t(k);

        if (!this.accounts || this.accounts.length === 0) {
            tbody.innerHTML = `
                <tr class="acc-empty-tr"><td colspan="5">
                    <div class="acc-empty">
                        <span>${t('no_accounts') || 'Aucun compte'}</span>
                        <button type="button" class="btn btn-primary acc-head-btn" onclick="window.AccountsView.openCreateModal()">${accIcon('plus')}<span>${t('acc_new_account')}</span></button>
                    </div>
                </td></tr>`;
            return;
        }

        const groups = {
            checking: { title: t('acc_section_checking') || 'Comptes Courants & Cartes', label: t('acc_total_available') || 'Disponibilités :', accounts: [], totals: {} },
            savings: { title: t('acc_section_savings') || 'Épargne & Placements', label: t('acc_total_saved') || 'Épargne totale :', accounts: [], totals: {} },
            loans: { title: t('acc_section_loans') || 'Crédits & Emprunts', label: t('acc_total_crd') || 'Capital restant dû :', accounts: [], totals: {} }
        };

        this.accounts.forEach(acc => {
            const group = groups[this._getAccountCategory(acc.type)];
            group.accounts.push(acc);
            if (!acc.is_closed) {
                // Un total par devise : on n'additionne jamais des euros et des dollars
                const ccy = acc.currency || 'EUR';
                group.totals[ccy] = (group.totals[ccy] || 0) + this._currentBalance(acc);
            }
        });

        const base = this._baseCurrency();
        let html = '';
        ['checking', 'savings', 'loans'].forEach(key => {
            const group = groups[key];
            if (group.accounts.length === 0) return;

            const ccys = Object.keys(group.totals).sort((a, b) => (a === base ? -1 : b === base ? 1 : a.localeCompare(b)));
            const totalsHtml = ccys.map(c => {
                const v = Math.round(group.totals[c] * 100) / 100;
                return `<b class="privacy-blur ${v < 0 ? 'acc-neg' : ''}">${formatCurrency(v, c)}</b>`;
            }).join('<span class="acc-dot-sep">·</span>');

            html += `
            <tr class="acc-group-tr">
                <td colspan="5">
                    <div class="acc-group-row">
                        <span class="acc-group-title">${group.title} <span class="acc-group-count">${group.accounts.length}</span></span>
                        <span class="acc-group-total"><span class="acc-group-label">${group.label}</span> ${totalsHtml || `<b class="privacy-blur">${formatCurrency(0, base)}</b>`}</span>
                    </div>
                </td>
            </tr>`;

            html += group.accounts.map(acc => this._renderRow(acc, key)).join('');
        });

        tbody.innerHTML = html;

        if (window.app && window.app.translateDOM) {
            window.app.translateDOM(tbody);
        }
    },

    _renderRow(acc, groupKey) {
        const t = (k) => window.i18n.t(k);
        const isMain = acc.id === this.mainAccountId;
        const color = acc.color || ACCOUNT_COLORS[0];
        const curr = acc.currency || 'EUR';
        const curBal = this._currentBalance(acc);
        const feedSource = this._getAccountFeedSource(acc.id);
        const sourceText = this._feedSourceText(feedSource);

        // Sous-ligne : type, devise si différente du profil, taux et mensualités
        const subParts = [accEsc(acc.type)];
        if (curr !== this._baseCurrency()) subParts.push(curr);
        if (groupKey === 'savings' && acc.interest_rate > 0) {
            subParts.push(this._formatRate(acc.interest_rate));
            subParts.push(`${t('acc_estimated_interest') || 'Intérêts estimés au 31/12'} : <b class="acc-pos privacy-blur">+${formatCurrency(this._estimatedInterest(acc), curr)}</b>`);
        } else if (groupKey === 'loans') {
            const crd = Math.abs(curBal);
            const rate = acc.interest_rate || 0;
            const payment = acc.monthly_payment || 0;
            const interestM = rate > 0 ? Math.round(crd * (rate / 100) / 12 * 100) / 100 : 0;
            const capitalM = Math.round(Math.max(0, payment - interestM) * 100) / 100;
            if (rate > 0) subParts.push(this._formatRate(rate));
            if (payment > 0) {
                subParts.push(`${t('acc_monthly_payment_label')} <b class="privacy-blur">${formatCurrency(payment, curr)}</b> <span class="acc-nowrap">(<span class="privacy-blur">${t('acc_capital_label')} ${formatCurrency(capitalM, curr)}</span> · <span class="privacy-blur">${t('acc_interest_label')} ${formatCurrency(interestM, curr)}</span>)</span>`);
            }
        }

        const srcIcon = feedSource.type === 'online' ? 'link' : (feedSource.type === 'file' ? 'file' : 'hand');
        const feedBtn = feedSource.type === 'online'
            ? `<button type="button" class="acc-ib acc-desk" onclick="window.AccountsView.syncOnlineAccount(${feedSource.conn.id})" title="${t('acc_btn_sync_tooltip')}" aria-label="${t('acc_btn_sync_tooltip')}">${accIcon('zap')}</button>`
            : `<button type="button" class="acc-ib acc-desk" onclick="window.AccountsView.openImportForAccount(${acc.id})" title="${t('acc_btn_import_tooltip')}" aria-label="${t('acc_btn_import_tooltip')}">${accIcon('download')}</button>`;

        return `
            <tr class="acc-row ${acc.is_closed ? 'is-closed' : ''}" style="--acc-color:${color};">
                <td class="acc-col-name">
                    <div class="acc-name-line">
                        <span class="acc-name">${accEsc(acc.name)}</span>
                        ${isMain ? `<span class="acc-main-mark" title="${t('acc_main_account')}" aria-label="${t('acc_main_account')}">${accIcon('star', 12)}</span>` : ''}
                        ${acc.is_closed ? `<span class="acc-closed-badge">${t('badge_closed') || 'Fermé'}</span>` : ''}
                    </div>
                    <div class="acc-sub">${subParts.join(' · ')}<span class="acc-src-inline"> · ${accEsc(sourceText)}</span></div>
                </td>
                <td class="acc-col-src"><span class="acc-src acc-src-${feedSource.type}" title="${accEsc(sourceText)}">${accIcon(srcIcon, 13)}<span>${accEsc(sourceText)}</span></span></td>
                <td class="acc-col-num acc-init"><span class="privacy-blur">${formatCurrency(acc.initial_balance, curr)}</span></td>
                <td class="acc-col-num acc-cur ${curBal < 0 ? 'acc-neg' : ''}"><span class="privacy-blur">${formatCurrency(curBal, curr)}</span></td>
                <td class="acc-col-act">
                    <div class="acc-act-wrap">
                        ${feedBtn}
                        <button type="button" class="acc-ib acc-desk" onclick="window.AccountsView.viewHistory(${acc.id})" title="${t('acc_view_history')}" aria-label="${t('acc_view_history')}">${accIcon('list')}</button>
                        <button type="button" class="acc-ib acc-desk" onclick="window.AccountsView.edit(${acc.id})" title="${t('tooltip_edit')}" aria-label="${t('tooltip_edit')}">${accIcon('pencil')}</button>
                        <button type="button" class="acc-ib acc-more-btn" onclick="window.AccountsView.toggleMenu(${acc.id}, this)" title="${t('acc_more_actions')}" aria-label="${t('acc_more_actions')}" aria-haspopup="menu" aria-expanded="false">${accIcon('dots', 16)}</button>
                    </div>
                </td>
            </tr>`;
    },

    _isPhoneLayout() {
        return window.matchMedia('(max-width: 768px)').matches;
    },

    _menuItemsHtml(acc, isSheet) {
        const t = (k) => window.i18n.t(k);
        const feedSource = this._getAccountFeedSource(acc.id);
        const isMain = acc.id === this.mainAccountId;
        const item = (icon, label, onclick, extraClass = '') =>
            `<button type="button" role="menuitem" class="acc-menu-item ${extraClass}" onclick="${onclick}">${accIcon(icon)}<span>${label}</span></button>`;
        const close = 'window.AccountsView._closeMenu();';

        let html = '';
        if (isSheet) {
            if (feedSource.type === 'online') {
                html += item('zap', t('bank_sync_run_background_btn'), `${close} window.AccountsView.syncOnlineAccount(${feedSource.conn.id})`);
            }
            html += item('download', t('btn_import_statement'), `${close} window.AccountsView.openImportForAccount(${acc.id})`);
            html += item('list', t('acc_view_history'), `${close} window.AccountsView.viewHistory(${acc.id})`);
            html += item('pencil', t('tooltip_edit'), `${close} window.AccountsView.edit(${acc.id})`);
        } else if (feedSource.type === 'online') {
            // Sur bureau, l'icône visible relève en ligne : l'import reste accessible ici
            html += item('download', t('btn_import_statement'), `${close} window.AccountsView.openImportForAccount(${acc.id})`);
        }

        html += isMain
            ? `<div class="acc-menu-item is-static">${accIcon('star')}<span>${t('acc_main_account')}</span></div>`
            : item('star', t('acc_set_main'), `${close} window.AccountsView.setMainAccount(${acc.id})`);

        if (this._getAccountCategory(acc.type) === 'savings' && acc.interest_rate > 0) {
            html += item('gift', t('acc_btn_record_interest'), `${close} window.AccountsView.openInterestModal(${acc.id}, ${this._estimatedInterest(acc)})`);
        }

        const current = acc.color || ACCOUNT_COLORS[0];
        html += `<div class="acc-menu-item is-static">${accIcon('palette')}<span>${t('acc_th_color')}</span></div>
            <div class="acc-menu-colors">${ACCOUNT_COLORS.map(c =>
                `<button type="button" class="acc-menu-color ${c === current ? 'selected' : ''}" style="--swatch:${c};" onclick="window.AccountsView._closeMenu(); window.AccountsView.saveColor(${acc.id}, '${c}')" title="${c}" aria-label="${t('acc_th_color')} ${c}"></button>`
            ).join('')}</div>
            <div class="acc-menu-sep" role="separator"></div>`;

        html += item(acc.is_closed ? 'unlock' : 'lock', acc.is_closed ? t('acc_menu_reopen') : t('acc_menu_close'), `${close} window.AccountsView.toggleClose(${acc.id})`);
        html += item('trash', t('acc_menu_delete'), `${close} window.AccountsView.delete(${acc.id})`, 'is-danger');
        return html;
    },

    toggleMenu(accId, btn) {
        if (this._menuAccId === accId) { this._closeMenu(true); return; }
        this._closeMenu();
        const acc = this.accounts.find(a => a.id === accId);
        if (!acc) return;
        this._menuAccId = accId;
        this._menuTrigger = btn;
        btn.setAttribute('aria-expanded', 'true');
        btn.classList.add('is-open');

        if (this._isPhoneLayout()) {
            const sheet = document.createElement('div');
            sheet.className = 'acc-sheet-backdrop';
            sheet.onclick = (e) => { if (e.target === sheet) this._closeMenu(true); };
            sheet.innerHTML = `
                <div class="acc-menu acc-sheet" role="menu" aria-label="${accEsc(acc.name)}">
                    <div class="acc-sheet-grab"></div>
                    <div class="acc-sheet-head">
                        <div class="acc-name">${accEsc(acc.name)}</div>
                        <div class="acc-sub">${accEsc(acc.type)} · ${accEsc(this._feedSourceText(this._getAccountFeedSource(acc.id)))}</div>
                    </div>
                    ${this._menuItemsHtml(acc, true)}
                </div>`;
            document.body.appendChild(sheet);
        } else {
            const menu = document.createElement('div');
            menu.className = 'acc-menu acc-dropdown';
            menu.setAttribute('role', 'menu');
            menu.innerHTML = this._menuItemsHtml(acc, false);
            document.body.appendChild(menu);
            // Positionné sur la page, aligné à droite du bouton ; s'ouvre vers le haut s'il manque de place
            const r = btn.getBoundingClientRect();
            const w = menu.offsetWidth;
            const h = menu.offsetHeight;
            const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
            const top = (r.bottom + 4 + h > window.innerHeight - 8) ? Math.max(8, r.top - h - 4) : r.bottom + 4;
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        }
        const first = document.querySelector('.acc-menu .acc-menu-item:not(.is-static)');
        if (first) first.focus({ preventScroll: true });
    },

    _closeMenu(restoreFocus = false) {
        document.querySelectorAll('.acc-dropdown, .acc-sheet-backdrop').forEach(el => el.remove());
        if (this._menuTrigger) {
            this._menuTrigger.setAttribute('aria-expanded', 'false');
            this._menuTrigger.classList.remove('is-open');
            if (restoreFocus && document.body.contains(this._menuTrigger)) this._menuTrigger.focus({ preventScroll: true });
        }
        this._menuAccId = null;
        this._menuTrigger = null;
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

    /** New account: same window as editing, without the balance realignment box. */
    openCreateModal() {
        this._closeMenu();
        this._showEditModal(null);
    },

    _showEditModal(acc) {
        const existing = document.getElementById('accEditModal');
        if (existing) existing.remove();

        const isNew = !acc;
        if (isNew) {
            acc = { name: '', type: 'Compte courant', initial_balance: '', color: this._nextColor(), currency: this._baseCurrency() };
        }

        const knownTypes = ['Compte courant', 'Livret', 'PEA', 'Assurance Vie', 'PER', 'Prêt / Emprunt'];
        const isCustomType = !knownTypes.includes(acc.type);
        const currentColor = acc.color || ACCOUNT_COLORS[0];
        const currentCurrency = acc.currency || 'EUR';
        const curBal = isNew ? 0 : this._currentBalance(acc);
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

        const title = isNew ? window.i18n.t('acc_new_account') : (window.i18n.t('acc_edit_title') || 'Modifier le compte');
        const saveLabel = isNew ? window.i18n.t('btn_add_account') : (window.i18n.t('btn_save_changes') || 'Enregistrer');
        const saveAction = isNew ? 'window.AccountsView._saveNew()' : `window.AccountsView._saveEdit(${acc.id})`;

        const realignBox = isNew ? '' : `
                    <!-- Encart Recalage / Ajustement Intelligent de Solde -->
                    <div style="background: var(--bg-hover, rgba(255,255,255,0.03)); border: 1px dashed var(--border-color); border-radius: 8px; padding: 10px 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 4px;">
                            <span style="font-size: 12px; font-weight: 700; color: var(--accent);">${window.i18n.t('acc_realign_title')}</span>
                            <span style="font-size: 12px; color: var(--text-muted);">${window.i18n.t('acc_current_balance_lbl')} : <strong class="privacy-blur" style="color:var(--text-main); font-variant-numeric: tabular-nums;">${curBalStr}</strong></span>
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.35;">
                            ${(window.i18n.t('acc_realign_hint') || '').replace('{flow}', `<span class="privacy-blur">${flowStr}</span>`)}
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="number" step="0.01" id="accEditTargetBal" class="inline-input" placeholder="${window.i18n.t('acc_realign_ph')}" aria-label="${window.i18n.t('acc_realign_ph')}" style="flex: 1; min-width: 0; height: 32px; padding: 0 8px; font-size: 12px; border-radius: 6px;">
                            <button type="button" class="btn btn-secondary" style="height: 32px; font-size: 12px; padding: 0 10px; border-radius: 6px; white-space: nowrap; font-weight: 600;" onclick="window.AccountsView._realignInitialBalance(${acc.id})">
                                ${window.i18n.t('acc_realign_btn')}
                            </button>
                        </div>
                    </div>`;

        const modalHtml = `
        <div id="accEditModal" class="modal-overlay" style="display:flex;z-index:10000;position:fixed;inset:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(6px);align-items:center;justify-content:center;overflow-y:auto;padding:clamp(12px,3vh,24px) clamp(8px,2vw,16px);box-sizing:border-box;" onclick="if(event.target===this) window.AccountsView._closeEditModal()">
            <div class="modal" role="dialog" aria-modal="true" aria-labelledby="accEditTitle" style="width:100%;max-width:540px;min-width:0;max-height:calc(100dvh - 32px);overflow:hidden;box-sizing:border-box;background:var(--bg-surface);color:var(--text-main);border:1px solid var(--border-color);border-radius:14px;box-shadow:var(--shadow-md);padding:0;display:flex;flex-direction:column;animation:modalFadeIn 0.3s ease;">
                <div class="modal-header" style="background:linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(99,102,241,0.02) 100%), var(--bg-surface);">
                    <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
                        <div class="modal-header-icon-badge badge-accent">
                            💳
                        </div>
                        <div class="modal-header-info">
                            <h3 class="modal-header-title" id="accEditTitle">${title}</h3>
                            ${isNew ? '' : `<div class="modal-header-desc">${accEsc(acc.name)} (${acc.currency || 'EUR'})</div>`}
                        </div>
                    </div>
                    <button type="button" class="modal-close-btn" onclick="window.AccountsView._closeEditModal()" aria-label="${window.i18n?.t('btn_close') || 'Fermer'}" title="${window.i18n?.t('btn_close') || 'Fermer'}">✕</button>
                </div>
                <div style="flex:1 1 auto;overflow-y:auto;padding:clamp(14px,3vw,20px) clamp(16px,3.5vw,24px);display:flex;flex-direction:column;gap:14px;scrollbar-width:thin;">
                    <div>
                        <label for="accEditName" style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_name')}</label>
                        <input type="text" id="accEditName" class="inline-input" value="${accEsc(acc.name)}" placeholder="${window.i18n.t('acc_ph_name')}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                    </div>
                    <div>
                        <label for="accEditType" style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_type')}</label>
                        <select id="accEditType" class="inline-input" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;" onchange="
                            const custom = document.getElementById('accEditTypeCustom');
                            if (this.value === '__other__') { custom.style.display='block'; custom.focus(); } else { custom.style.display='none'; custom.value=''; }
                            window.AccountsView._updateEditModalFields();
                        ">${typeOptions}</select>
                        <input type="text" id="accEditTypeCustom" class="inline-input" value="${isCustomType ? accEsc(acc.type) : ''}" placeholder="${window.i18n.t('acc_ph_type')}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;margin-top:6px;display:${isCustomType ? 'block' : 'none'};" oninput="window.AccountsView._updateEditModalFields()">
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <div style="flex: 1;">
                            <label for="accEditCurrency" style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_currency') || 'Devise'}</label>
                            <select id="accEditCurrency" class="inline-input" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">${currencyOpts}</select>
                        </div>
                        <div style="flex: 1.5;">
                            <label for="accEditBalance" style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_th_initial_balance')}</label>
                            <input type="number" id="accEditBalance" class="inline-input" value="${acc.initial_balance}" step="0.01" placeholder="0,00" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                        </div>
                    </div>
${realignBox}
                    <!-- Encart Taux & Paramètres Financiers Dynamiques -->
                    <div id="accEditFinancialBox" style="background: var(--bg-hover, rgba(255,255,255,0.03)); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px;">
                        <div id="accEditFinancialTitle" style="font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 8px; text-transform: uppercase;">
                            📊 ${window.i18n.t('acc_section_savings_rate') || 'Rendement & Taux annuel'}
                        </div>
                        <div id="accEditFinancialGrid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                            <div id="accEditRateCol">
                                <label style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 2px;">${window.i18n.t('acc_interest_rate') || 'Taux annuel (%)'}</label>
                                <input type="number" step="0.01" id="accEditRate" class="inline-input" value="${acc.interest_rate !== null && acc.interest_rate !== undefined ? acc.interest_rate : ''}" placeholder="Ex: 3.0" style="width:100%;border:1px solid var(--border-color);padding:6px;border-radius:6px;font-size:12px;">
                            </div>
                            <div id="accEditMonthlyCol">
                                <label style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 2px;">${window.i18n.t('acc_monthly_payment') || 'Mensualité (€)'}</label>
                                <input type="number" step="0.01" id="accEditMonthly" class="inline-input" value="${acc.monthly_payment !== null && acc.monthly_payment !== undefined ? acc.monthly_payment : ''}" placeholder="Ex: 650.0" style="width:100%;border:1px solid var(--border-color);padding:6px;border-radius:6px;font-size:12px;">
                            </div>
                            <div id="accEditBorrowedCol">
                                <label style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 2px;">${window.i18n.t('acc_borrowed_amount') || 'Montant initial emprunté'}</label>
                                <input type="number" step="0.01" id="accEditBorrowed" class="inline-input" value="${acc.borrowed_amount !== null && acc.borrowed_amount !== undefined ? acc.borrowed_amount : ''}" placeholder="Ex: 120000" style="width:100%;border:1px solid var(--border-color);padding:6px;border-radius:6px;font-size:12px;">
                            </div>
                            <div id="accEditInsuranceCol">
                                <label style="font-size: 12px; color: var(--text-muted); display: block; margin-bottom: 2px;">${window.i18n.t('acc_loan_insurance') || 'Assurance (€/mois)'}</label>
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
                <div class="modal-footer-pinned">
                    <button type="button" class="btn btn-secondary" onclick="window.AccountsView._closeEditModal()">${window.i18n.t('btn_cancel')}</button>
                    <button type="button" class="btn btn-primary" onclick="${saveAction}">${saveLabel}</button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this._updateEditModalFields();
        if (isNew) {
            const nameInput = document.getElementById('accEditName');
            if (nameInput) nameInput.focus();
        }
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

    /** Reads the shared fields of the account window; returns null (after a message) when invalid. */
    async _readEditForm(isNew = false) {
        const name = document.getElementById('accEditName').value.trim();
        if (!name) { await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_name_required')); return null; }

        const typeSelect = document.getElementById('accEditType').value;
        const typeCustom = document.getElementById('accEditTypeCustom').value.trim();
        const type = typeSelect === '__other__' ? (typeCustom || window.i18n.t('default_account_type')) : typeSelect;

        const currency = document.getElementById('accEditCurrency').value;

        const balanceStr = document.getElementById('accEditBalance').value.trim();
        // Un nouveau compte sans solde saisi part de 0, comme l'ancien formulaire d'ajout
        const balance = (isNew && balanceStr === '') ? 0 : parseFloat(balanceStr.replace(',', '.'));
        if (isNaN(balance)) { await showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_invalid_amount')); return null; }

        const color = document.getElementById('accEditColor').value || ACCOUNT_COLORS[0];

        const rateVal = parseFloat(document.getElementById('accEditRate')?.value);
        const monthlyVal = parseFloat(document.getElementById('accEditMonthly')?.value);
        const borrowedVal = parseFloat(document.getElementById('accEditBorrowed')?.value);
        const insuranceVal = parseFloat(document.getElementById('accEditInsurance')?.value);

        return {
            name: name,
            type: type,
            initial_balance: balance,
            color: color,
            currency: currency,
            interest_rate: !isNaN(rateVal) ? rateVal : null,
            monthly_payment: !isNaN(monthlyVal) ? monthlyVal : null,
            borrowed_amount: !isNaN(borrowedVal) ? borrowedVal : null,
            loan_insurance: !isNaN(insuranceVal) ? insuranceVal : null
        };
    },

    async _saveNew() {
        const data = await this._readEditForm(true);
        if (!data) return;
        try {
            const res = await API.post('/api/accounts/', { ...data, is_closed: false });
            this._closeEditModal();
            await this.loadData();
            window.app.refreshSidebar();
            showUndoToast(window.i18n.t('toast_acc_created') || 'Compte créé', res.action_id, () => this.loadData().then(() => window.app.refreshSidebar()));
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('acc_create_error'));
        }
    },

    async _saveEdit(id) {
        const acc = this.accounts.find(a => a.id === id);
        if (!acc) return;

        const data = await this._readEditForm();
        if (!data) return;

        try {
            const res = await API.put(`/api/accounts/${id}`, { ...data, is_closed: acc.is_closed });
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
        <div id="accInterestModal" class="modal-overlay" style="display:flex;z-index:10000;position:fixed;inset:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(6px);align-items:center;justify-content:center;overflow-y:auto;padding:clamp(12px,3vh,24px) clamp(8px,2vw,16px);box-sizing:border-box;" onclick="if(event.target===this) this.remove()">
            <div class="modal" role="dialog" aria-modal="true" style="width:100%;max-width:460px;min-width:0;max-height:calc(100dvh - 32px);overflow:hidden;box-sizing:border-box;background:var(--bg-surface);color:var(--text-main);border:1px solid var(--border-color);border-radius:14px;box-shadow:var(--shadow-md);padding:0;display:flex;flex-direction:column;animation:modalFadeIn 0.3s ease;">
                <div class="modal-header" style="background:linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.02) 100%), var(--bg-surface);">
                    <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
                        <div class="modal-header-icon-badge">
                            🎁
                        </div>
                        <div class="modal-header-info">
                            <h3 class="modal-header-title">${window.i18n.t('acc_modal_interest_title') || 'Comptabilisation des Intérêts'}</h3>
                            <div class="modal-header-desc">${accEsc(acc.name)} (${acc.currency || 'EUR'})</div>
                        </div>
                    </div>
                    <button type="button" class="modal-close-btn" onclick="document.getElementById('accInterestModal')?.remove()" aria-label="${window.i18n?.t('btn_close') || 'Fermer'}" title="${window.i18n?.t('btn_close') || 'Fermer'}">✕</button>
                </div>
                <div style="flex:1 1 auto;overflow-y:auto;padding:clamp(14px,3vw,20px) clamp(16px,3.5vw,24px);display:flex;flex-direction:column;gap:14px;scrollbar-width:thin;">
                    <p style="font-size:12px; color:var(--text-muted); margin:0;">
                        ${window.i18n.t('acc_modal_interest_desc') || "Ajustez le montant exact versé par votre banque pour l'année :"}
                    </p>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_interest_modal_account')}</label>
                        <input type="text" class="inline-input" value="${accEsc(acc.name)} (${acc.currency || 'EUR'})" disabled style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;opacity:0.75;">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_interest_modal_amount')}</label>
                        <input type="number" step="0.01" id="accInterestAmount" class="inline-input" value="${defaultAmount.toFixed(2)}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;font-size:14px;font-weight:700;color:var(--success);">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_interest_modal_date')}</label>
                        <input type="date" id="accInterestDate" class="inline-input" value="${defaultDate}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                    </div>
                    <div>
                        <label style="font-size:12px;font-weight:600;color:var(--text-muted);display:block;margin-bottom:4px;">${window.i18n.t('acc_interest_modal_desc_label')}</label>
                        <input type="text" id="accInterestDesc" class="inline-input" value="${window.i18n.tp('acc_interest_default_desc', { year: today.getFullYear() })}" style="width:100%;border:1px solid var(--border-color);padding:8px;border-radius:6px;">
                    </div>
                </div>
                <div class="modal-footer-pinned">
                    <button type="button" class="btn btn-secondary" onclick="document.getElementById('accInterestModal')?.remove()">${window.i18n.t('btn_cancel')}</button>
                    <button type="button" class="btn btn-primary" onclick="window.AccountsView.submitInterest(${accId})">${window.i18n.t('acc_interest_modal_submit')}</button>
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
