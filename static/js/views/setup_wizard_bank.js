// static/js/views/setup_wizard_bank.js — Assistant de démarrage : connexion bancaire guidée.
// Coffre-fort et identifiants, puis comptes détectés à créer ou associer, dans l'assistant ; le premier relevé
// part à la fin, une fois l'Auto-Pilote et l'IA réglés, pour que ses opérations soient traitées avec ces réglages.
// Réutilise les fenêtres de la synchronisation bancaire (BankSyncView) plutôt que d'en dupliquer le parcours.

Object.assign(window.SetupWizard, {
    _bankConns: [],
    _bankLoaded: false,
    _runFirstStatement: false,

    _linkedCount(conn) {
        let m = conn && conn.account_mapping;
        if (typeof m === 'string') {
            try { m = JSON.parse(m); } catch (e) { m = {}; }
        }
        return Object.values(m || {}).filter(Boolean).length;
    },

    _hasLinkedBank() {
        return this._bankConns.some(c => c.is_active !== false && this._linkedCount(c) > 0);
    },

    async _loadBankState() {
        try {
            this._bankConns = (await API.get('/api/bank-sync/connections')) || [];
        } catch (e) {
            this._bankConns = [];
        }
        this._bankLoaded = true;
    },

    _bankPanelHtml() {
        const t = (k, fb) => this._t(k, fb);
        const conns = this._bankConns;
        const hasConn = conns.length > 0;
        const linked = this._hasLinkedBank();
        const step = (done, text) => `
            <li style="display:flex; gap:8px; align-items:flex-start; margin:4px 0; color:${done ? 'var(--text-main)' : 'var(--text-muted)'};">
                <span aria-hidden="true">${done ? '✅' : '○'}</span><span>${text}</span>
            </li>`;
        const connRows = conns.map(c => {
            const n = this._linkedCount(c);
            const label = window.escapeHtml ? window.escapeHtml(c.label || c.backend) : (c.label || c.backend);
            return `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 10px; margin-top:8px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:10px; flex-wrap:wrap;">
                    <span style="font-size:13px;">🏦 <strong>${label}</strong> · ${t('wizard_bank_linked_count', 'comptes associés')} : ${n}</span>
                    <button class="wizard-btn-secondary" style="padding:6px 12px; font-size:12px;" onclick="window.SetupWizard._openBankMapping(${c.id})">
                        ${n ? t('wizard_bank_edit_mapping', 'Modifier') : t('wizard_bank_map_btn', 'Associer les comptes')}
                    </button>
                </div>`;
        }).join('');
        const mainBtn = !hasConn
            ? `<button class="wizard-btn-primary" style="margin-top:12px;" onclick="window.SetupWizard._openBankConnect()">🔗 ${t('wizard_bank_connect_btn', 'Connecter ma banque')}</button>`
            : `<button class="wizard-btn-ghost" style="margin-top:10px;" onclick="window.SetupWizard._openBankConnect()">➕ ${t('wizard_bank_add_another', 'Ajouter une autre banque')}</button>`;
        return `
            <div style="font-weight:700; font-size:14px; margin-bottom:6px; color:var(--accent);">⚡ ${t('wizard_bank_title', 'Connecter votre banque')}</div>
            <p style="font-size:12.5px; color:var(--text-muted); margin:0; line-height:1.5;">${t('wizard_bank_desc', 'Vos identifiants sont chiffrés dans un coffre-fort local, avec un mot de passe maître que vous choisissez. OmniBank lit vos comptes et ne peut jamais effectuer de paiement.')}</p>
            <ol style="list-style:none; padding:0; margin:10px 0 0; font-size:12.5px; line-height:1.45;">
                ${step(hasConn, t('wizard_bank_step1', 'Mot de passe maître et identifiants de la banque'))}
                ${step(linked, t('wizard_bank_step2', 'Comptes détectés en ligne, à créer dans OmniBank ou à associer'))}
                ${step(false, t('wizard_bank_step3', 'Premier relevé, lancé à la fin de l\'assistant avec vos réglages d\'Auto-Pilote et d\'IA'))}
            </ol>
            ${connRows}
            ${mainBtn}`;
    },

    async _refreshBankPanel() {
        await this._loadBankState();
        const box = document.getElementById('wizAlternativeEntryNotice');
        if (box && this.entryMode === 'sync') box.innerHTML = this._bankPanelHtml();
    },

    async _prepareBankViews() {
        const bs = window.BankSyncView;
        if (!bs) return null;
        bs.ensureModalsExist();
        // Les fenêtres de la synchronisation ont le même z-index que l'assistant : placées après lui, elles passent devant
        const modals = document.getElementById('bankSyncGlobalModalsContainer');
        if (modals) document.body.appendChild(modals);
        await Promise.all([bs.loadBackends(), bs.loadConnections(), bs.loadLocalAccounts(true), bs.loadVaultStatus()]);
        return bs;
    },

    async _openBankConnect() {
        const bs = await this._prepareBankViews();
        if (!bs) return;
        bs.openAddModal();
        bs.chooseAddMethod('online');
    },

    async _openBankMapping(connId) {
        const bs = await this._prepareBankViews();
        if (bs) bs.openMappingModal(connId, true);
    },

    // Appelé par BankSyncView après chaque changement de connexion ou d'association
    async _onBankChanged() {
        if (!this.overlay || this.entryMode !== 'sync') return;
        try {
            const accounts = await API.get('/api/accounts/');
            this.createdAccounts = (accounts || []).filter(a => !a.is_closed);
        } catch (e) { /* non bloquant */ }
        if (!this._mainAccountId && this.createdAccounts.length) {
            const main = this.createdAccounts.find(a => a.type === 'Compte courant') || this.createdAccounts[0];
            try {
                await API.post(`/api/stats/main_account/${main.id}`);
                this._mainAccountId = main.id;
            } catch (e) { /* non bloquant */ }
        }
        await this._refreshBankPanel();
    },

    _firstStatementRecapHtml() {
        if (this.entryMode !== 'sync') return '';
        const t = (k, fb) => this._t(k, fb);
        const text = this._hasLinkedBank()
            ? t('wizard_first_sync_ready', 'Il démarre dès que vous lancez OmniBank. L\'Auto-Pilote et l\'IA traitent ses opérations avec les réglages choisis ; suivez-le depuis Comptes.')
            : t('wizard_first_sync_none', 'Aucun compte bancaire n\'est encore associé. Vous pourrez connecter votre banque depuis Comptes.');
        return `
            <div class="wizard-recap-section">
                <h4>⚡ ${t('wizard_first_sync_title', 'Premier relevé')}</h4>
                <p style="font-size:12.5px; color:var(--text-muted); line-height:1.5; margin:0;">${text}</p>
            </div>`;
    },

    _launchButtonHtml() {
        if (this.entryMode === 'sync' && this._hasLinkedBank()) {
            return `<button class="wizard-btn-launch" style="width:100%;" onclick="window.SetupWizard._launchWithFirstStatement()">
                        🚀 ${this._t('wizard_btn_launch_sync', 'Lancer OmniBank et le premier relevé')}
                    </button>`;
        }
        return `<button class="wizard-btn-launch" style="width:100%;" onclick="window.SetupWizard.dismiss()">
                    🚀 ${window.i18n.t('wizard_btn_launch')}
                </button>`;
    },

    _launchWithFirstStatement() {
        this._runFirstStatement = true;
        this.dismiss();
    },

    // Après la fermeture : la page Comptes, puis le relevé s'il a été demandé
    _afterSyncDismiss() {
        window.app.loadView('accounts');
        if (!this._runFirstStatement) return;
        this._runFirstStatement = false;
        setTimeout(() => {
            if (window.BankSyncView && typeof window.BankSyncView.triggerBackgroundSyncNow === 'function') {
                window.BankSyncView.triggerBackgroundSyncNow();
            }
        }, 600);
    }
});
