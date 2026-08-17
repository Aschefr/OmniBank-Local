// static/js/views/bank_sync.js — Synchronisation Bancaire Universelle (Woob)
// Conforme aux règles OmniBank : 100% Modales In-App, Toasts, Délai Anti-Spam, Session RAM Sécurisée, Relevé Auto en Arrière-Plan & IA Conditionnelle

window.BankSyncView = {
    connections: [],
    backends: [],
    localAccounts: [],
    selectedBackend: null,
    activeSessionId: null,
    eventSource: null,

    // Délai anti-spam recommandé entre deux requêtes vers la même banque (5 minutes)
    COOLDOWN_MS: 5 * 60 * 1000,

    // État de la prévisualisation / revue des opérations
    previewData: null,
    currentAccountIndex: 0,
    currentFilter: 'all',
    activeConnId: null,

    // Correspondances en attente pour pointage rapide depuis Dashboard & Historique
    pendingMatches: {},
    vaultStatus: { is_unlocked: false, remaining_days: 0, remaining_seconds: 0 },
    autoSyncSettings: { enabled: false, interval_hours: 24 },

    // Handlers de promesse pour les dialogues modaux personnalisés
    _pwResolve: null,
    _pwReject: null,
    _confirmResolve: null,

    // ── GESTION DU TOKEN DE SESSION COFFRE (RAM TTL BACKEND) ────────
    getVaultToken() {
        return localStorage.getItem('omnibank_vault_token') || null;
    },

    setVaultToken(token) {
        if (token) {
            localStorage.setItem('omnibank_vault_token', token);
        } else {
            localStorage.removeItem('omnibank_vault_token');
        }
    },

    clearVaultToken() {
        localStorage.removeItem('omnibank_vault_token');
    },

    isAIEnabled() {
        return Boolean(window.app && window.app.config && (window.app.config.enable_ai === 'true' || window.app.config.enable_ai === true));
    },

    // ── GESTION DU CACHE DU DERNIER APERÇU ──────────────────────────
    saveCachedPreview(connId, previewData) {
        try {
            const entry = {
                timestamp: Date.now(),
                data: previewData
            };
            sessionStorage.setItem(`omnibank_sync_preview_${connId}`, JSON.stringify(entry));
        } catch (e) {
            console.warn('[BankSync] Impossible de cacher l\'aperçu:', e);
        }
    },

    getCachedPreview(connId) {
        try {
            const raw = sessionStorage.getItem(`omnibank_sync_preview_${connId}`);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    },

    // ── CACHE DES COMPTES DISTANTS À ASSOCIER (MAPPING INSTANTANÉ) ────
    saveCachedRemoteAccounts(connId, accounts) {
        try {
            const entry = {
                timestamp: Date.now(),
                accounts: accounts
            };
            localStorage.setItem(`omnibank_remote_accounts_${connId}`, JSON.stringify(entry));
        } catch (e) {
            console.warn('[BankSync] Impossible de cacher les comptes distants:', e);
        }
    },

    getCachedRemoteAccounts(connId) {
        try {
            const raw = localStorage.getItem(`omnibank_remote_accounts_${connId}`);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            return entry.accounts || null;
        } catch (e) {
            return null;
        }
    },

    render() {
        this.ensureModalsExist();
        return `
        <div id="bankSyncRoot" style="margin-bottom: 15px;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 12px;">
                <div>
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                        <h3 style="font-size: 18px; font-weight: 700; margin: 0; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                            <span>⚡</span> <span data-i18n="bank_sync_title">${window.i18n.t('bank_sync_title')}</span>
                        </h3>
                        <span style="font-size: 10px; font-weight: 700; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 2px 8px; border-radius: 20px;" data-i18n="bank_sync_beta_badge">
                            ${window.i18n.t('bank_sync_beta_badge')}
                        </span>
                    </div>
                    <p style="margin: 0; color: var(--text-muted); font-size: 13px;" data-i18n="bank_sync_subtitle">
                        ${window.i18n.t('bank_sync_subtitle')}
                    </p>
                </div>
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                    <button id="btnHeaderBgSync" class="btn btn-secondary overview-bank-sync-btn" onclick="window.BankSyncView.triggerBackgroundSyncNow()" style="display: ${this.connections.length > 0 ? 'inline-flex' : 'none'}; height: 38px; align-items: center; gap: 6px; font-weight: 600; padding: 0 16px; border-radius: 10px; box-sizing: border-box; white-space: nowrap;" title="Interroger toutes vos banques en arrière-plan sans bloquer l'interface">
                        <span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n.t('bank_sync_run_background_btn')}</span>
                    </button>
                    <button class="btn btn-primary" onclick="window.BankSyncView.openAddModal()" style="display: inline-flex; height: 38px; align-items: center; gap: 6px; font-weight: 600; padding: 0 18px; border-radius: 10px; box-shadow: 0 4px 12px rgba(99,102,241,0.25); box-sizing: border-box; white-space: nowrap;">
                        <span>➕</span> <span data-i18n="bank_sync_add_btn">${window.i18n.t('bank_sync_add_btn')}</span>
                    </button>
                </div>
            </div>

            <!-- Barre de Statut du Coffre-Fort Sécurisé & Relevé Automatique -->
            <div id="bankVaultStatusBar" style="margin-bottom: 14px;"></div>

            <!-- Notice Sécurité & Confidentialité -->
            <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 14px; padding: 14px 18px; margin-bottom: 20px; display: flex; align-items: center; gap: 14px;">
                <span style="font-size: 22px;">🛡️</span>
                <div style="font-size: 13px; color: var(--text-main); line-height: 1.4;">
                    <span data-i18n="bank_sync_security_notice">${window.i18n.t('bank_sync_security_notice')}</span>
                </div>
            </div>

            <!-- Encart Opérations en attente (si détectées par le scheduler) -->
            <div id="bankPendingSyncBox" style="display: none; margin-bottom: 20px;"></div>

            <!-- Liste des Connexions -->
            <div id="bankConnectionsList" style="display: flex; flex-direction: column; gap: 14px;">
                <div style="text-align: center; padding: 30px; color: var(--text-muted);">
                    Chargement des connexions...
                </div>
            </div>
        </div>
        `;
    },

    async init() {
        await Promise.all([
            this.loadConnections(),
            this.loadBackends(),
            this.loadLocalAccounts(),
            this.loadVaultStatus(),
            this.loadAutoSyncSettings(),
            this.loadPendingSync()
        ]);
    },

    // ── TOAST NOTIFICATIONS (Custom in-app) ──────────────────────────
    showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        let container = document.getElementById('bankSyncToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'bankSyncToastContainer';
            container.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.style.pointerEvents = 'auto';

        const bg = type === 'success' ? '#10b981' : (type === 'error' ? '#ef4444' : '#6366f1');
        const icon = type === 'success' ? '✔' : (type === 'error' ? '⚠️' : 'ℹ️');

        toast.style.cssText = `
            background: var(--bg-card);
            border-left: 4px solid ${bg};
            border-top: 1px solid var(--border-color);
            border-right: 1px solid var(--border-color);
            border-bottom: 1px solid var(--border-color);
            color: var(--text-main);
            padding: 12px 18px;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 260px;
            max-width: 400px;
            animation: slideIn 0.3s ease;
        `;
        toast.innerHTML = `<span style="font-weight:700; color:${bg};">${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.4s ease';
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    },

    ensureModalsExist() {
        if (document.getElementById('bankSyncGlobalModalsContainer')) return;
        const aiEnabled = this.isAIEnabled();

        const container = document.createElement('div');
        container.id = 'bankSyncGlobalModalsContainer';
        container.innerHTML = `
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Ajouter une banque -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="addBankModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 1000; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 650px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.4); overflow: hidden;">
                <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        <span>🏦</span> <span data-i18n="bank_sync_modal_title">${window.i18n.t('bank_sync_modal_title')}</span>
                    </h3>
                    <button onclick="window.BankSyncView.closeAddModal()" style="background: none; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>

                <div id="addBankModalBody" style="padding: 24px; overflow-y: auto; flex: 1;">
                    <div id="stepSelectBank">
                        <label style="display: block; font-weight: 600; font-size: 14px; margin-bottom: 10px; color: var(--text-main);" data-i18n="bank_sync_select_bank">
                            ${window.i18n.t('bank_sync_select_bank')}
                        </label>
                        <div style="position: relative; margin-bottom: 14px;">
                            <input type="text" id="bankSearchInput" class="input-styled" placeholder="${window.i18n.t('bank_sync_search_placeholder')}" style="width: 100%; padding-left: 38px; border-radius: 10px;" oninput="window.BankSyncView.filterBackends(this.value)" />
                            <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); opacity: 0.5;">🔍</span>
                        </div>
                        <div id="backendsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; max-height: 240px; overflow-y: auto; padding: 4px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-base);"></div>
                    </div>

                    <div id="stepCredentials" style="display: none; margin-top: 10px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
                            <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_credentials_title">
                                2. Identifiants de connexion
                            </h4>
                            <button class="btn btn-secondary" onclick="window.BankSyncView.backToBankSelection()" style="padding: 5px 12px; font-size: 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;">
                                ↩ Changer de banque
                            </button>
                        </div>
                        <div id="selectedBankBanner" style="padding: 10px 14px; background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.25); border-radius: 10px; margin-bottom: 16px; font-size: 13px; font-weight: 600; color: var(--accent);"></div>
                        
                        <div style="margin-bottom: 14px;">
                            <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-main);" data-i18n="bank_sync_conn_label">
                                Nom de la connexion (ex: Mon Crédit Agricole)
                            </label>
                            <input type="text" id="connLabelInput" class="input-styled" placeholder="Ex: Mon Crédit Agricole" />
                        </div>

                        <div id="dynamicFormFields" style="display: flex; flex-direction: column; gap: 14px;"></div>

                        <div style="margin-top: 20px; padding-top: 18px; border-top: 1px dashed var(--border-color);">
                            <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;" data-i18n="bank_sync_master_pw_title">
                                🔐 3. Mot de passe maître (Chiffrement local)
                            </label>
                            <p style="font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;" data-i18n="bank_sync_master_pw_desc">
                                Ce mot de passe sert à chiffrer vos identifiants sur votre machine (Fernet AES). Il ne quitte jamais votre appareil.
                            </p>
                            <input type="password" id="connMasterPwInput" class="input-styled" placeholder="Entrez un mot de passe maître sécurisé" autocomplete="new-password" />
                        </div>
                        <div id="addBankErrorMsg" style="display:none; color:#ef4444; font-size:13px; margin-top:10px; padding:8px 12px; background:rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); border-radius:8px;"></div>
                    </div>
                </div>

                <div style="padding: 16px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 10px; background: var(--bg-card);">
                    <button class="btn btn-secondary" onclick="window.BankSyncView.closeAddModal()" data-i18n="bank_sync_cancel">
                        ${window.i18n.t('bank_sync_cancel')}
                    </button>
                    <button id="btnSaveConnection" class="btn btn-primary" onclick="window.BankSyncView.saveConnection()" style="display: none;" data-i18n="bank_sync_save_btn">
                        ${window.i18n.t('bank_sync_save_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Association des comptes (Mapping) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="mappingModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 1000; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 700px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.4); overflow: hidden;">
                <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-card);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_mapping_title">
                            🔗 ${window.i18n.t('bank_sync_mapping_title')}
                        </h3>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.openMappingModal(window.BankSyncView.activeConnId, true)" style="font-size: 12px; padding: 4px 10px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;" title="Actualiser la liste depuis votre banque">
                            <span>🔄</span> <span data-i18n="bank_sync_refresh_btn">Actualiser</span>
                        </button>
                    </div>
                    <button onclick="window.BankSyncView.closeMappingModal()" style="background: none; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>
                <div style="padding: 20px 24px; overflow-y: auto; flex: 1;">
                    <p style="font-size: 13px; color: var(--text-muted); margin: 0 0 16px 0;" data-i18n="bank_sync_mapping_desc">
                        ${window.i18n.t('bank_sync_mapping_desc')}
                    </p>
                    <div id="mappingRowsContainer" style="display: flex; flex-direction: column; gap: 12px;"></div>
                </div>
                <div style="padding: 16px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn btn-secondary" onclick="window.BankSyncView.closeMappingModal()" data-i18n="bank_sync_cancel">
                        ${window.i18n.t('bank_sync_cancel')}
                    </button>
                    <button class="btn btn-primary" onclick="window.BankSyncView.saveMapping()" data-i18n="bank_sync_save_mapping_btn">
                        ${window.i18n.t('bank_sync_save_mapping_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : 2FA Interactive (Smartphone / OTP) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="twoFAModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 1100; align-items: center; justify-content: center; backdrop-filter: blur(6px);">
            <div style="background: var(--bg-card); border: 2px solid var(--accent); border-radius: 20px; width: 95%; max-width: 480px; padding: 28px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div id="twoFAIcon" style="font-size: 48px; margin-bottom: 16px;">📱</div>
                <h3 id="twoFATitle" style="margin: 0 0 10px 0; font-size: 20px; font-weight: 800; color: var(--text-main);" data-i18n="bank_sync_2fa_title">
                    ${window.i18n.t('bank_sync_2fa_title')}
                </h3>
                <p id="twoFAMessage" style="font-size: 14px; color: var(--text-muted); line-height: 1.5; margin: 0 0 20px 0;" data-i18n="bank_sync_2fa_default_msg">
                    ${window.i18n.t('bank_sync_2fa_default_msg')}
                </p>

                <div id="twoFAOtpInputContainer" style="display: none; margin-bottom: 20px;">
                    <input type="text" id="twoFAOtpInput" class="input-styled" style="width: 100%; font-size: 20px; letter-spacing: 6px; text-align: center; padding: 12px;" placeholder="123456" />
                </div>

                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button class="btn btn-secondary" onclick="window.BankSyncView.cancel2FA()" style="flex: 1;" data-i18n="bank_sync_cancel">
                        ${window.i18n.t('bank_sync_cancel')}
                    </button>
                    <button id="twoFAConfirmBtn" class="btn btn-primary" onclick="window.BankSyncView.submit2FA()" style="flex: 1; font-weight: 700;" data-i18n="bank_sync_2fa_continue">
                        ${window.i18n.t('bank_sync_2fa_continue')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Synchronisation en cours (Progress SSE) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="syncProgressModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1050; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 500px; padding: 28px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
                <div style="font-size: 40px; margin-bottom: 14px; animation: spin 2s linear infinite;">🔄</div>
                <h3 id="syncProgressTitle" style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_progress_title">
                    ${window.i18n.t('bank_sync_progress_title')}
                </h3>
                <p id="syncProgressMsg" style="font-size: 13px; color: var(--text-muted); margin: 0 0 20px 0;" data-i18n="bank_sync_progress_msg">
                    ${window.i18n.t('bank_sync_progress_msg')}
                </p>
                <div style="width: 100%; height: 8px; background: var(--bg-base); border-radius: 4px; overflow: hidden; margin-bottom: 20px;">
                    <div id="syncProgressBar" style="width: 25%; height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); transition: width 0.3s ease;"></div>
                </div>
                <button class="btn btn-secondary" onclick="window.BankSyncView.abortSync()" style="font-size: 12px;" data-i18n="bank_sync_btn_cancel">
                    ${window.i18n.t('bank_sync_btn_cancel')}
                </button>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Revue & Validation des Opérations (Style Import Relevé) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="bankSyncReviewModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 1060; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 96%; max-width: 1100px; height: 92vh; display: flex; flex-direction: column; box-shadow: 0 25px 50px rgba(0,0,0,0.5); overflow: hidden;">
                <div style="padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-card);">
                    <div>
                        <h3 id="reviewModalTitle" style="margin: 0 0 4px 0; font-size: 18px; font-weight: 800; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                            <span>📥</span> <span data-i18n="bank_sync_review_title">${window.i18n.t('bank_sync_review_title')}</span>
                        </h3>
                        <p id="reviewModalSubtitle" style="margin: 0; font-size: 13px; color: var(--text-muted);" data-i18n="bank_sync_review_subtitle">
                            ${window.i18n.t('bank_sync_review_subtitle')}
                        </p>
                    </div>
                    <button onclick="window.BankSyncView.closeReviewModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>

                <div style="padding: 12px 24px; background: var(--bg-base); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div id="reviewAccountTabs" style="display: flex; gap: 8px; overflow-x: auto; max-width: 50%;"></div>
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <!-- Bouton IA visible UNIQUEMENT si l'IA locale est activée -->
                        <button class="btn btn-sm btn-secondary" id="btnSyncCategorizeAllAI" onclick="window.BankSyncView.categorizeAllNewAI()" style="display: ${aiEnabled ? 'inline-flex' : 'none'}; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--accent); background: rgba(99,102,241,0.1); color: var(--accent); font-weight: 600; align-items: center; gap: 6px;" title="${window.i18n.t('bank_categorize_ai_tooltip')}">
                            <span>✨</span> <span data-i18n="bank_categorize_all_ai">${window.i18n.t('bank_categorize_all_ai')}</span>
                        </button>

                        <span style="font-size: 12px; color: var(--text-muted); font-weight: 600; margin-left: 6px;" data-i18n="bank_sync_filter_label">${window.i18n.t('bank_sync_filter_label')}</span>
                        <button class="btn btn-sm" id="btnSyncFilterAll" onclick="window.BankSyncView.setReviewFilter('all')" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: white;" data-i18n="bank_sync_filter_all">${window.i18n.t('bank_sync_filter_all')}</button>
                        <button class="btn btn-sm" id="btnSyncFilterAdd" onclick="window.BankSyncView.setReviewFilter('add')" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted);" data-i18n="bank_sync_filter_add">${window.i18n.t('bank_sync_filter_add')}</button>
                        <button class="btn btn-sm" id="btnSyncFilterReconcile" onclick="window.BankSyncView.setReviewFilter('reconcile')" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted);" data-i18n="bank_sync_filter_reconcile">${window.i18n.t('bank_sync_filter_reconcile')}</button>
                        <button class="btn btn-sm" id="btnSyncFilterIgnored" onclick="window.BankSyncView.setReviewFilter('ignored')" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted);" data-i18n="bank_sync_filter_ignored">${window.i18n.t('bank_sync_filter_ignored')}</button>
                    </div>
                </div>

                <div style="flex: 1; overflow-y: auto; padding: 0;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                        <thead style="position: sticky; top: 0; background: var(--bg-card); z-index: 10; box-shadow: 0 1px 0 var(--border-color);">
                            <tr>
                                <th style="padding: 10px 14px; width: 130px; color: var(--text-muted);" data-i18n="bank_sync_th_date">${window.i18n.t('bank_sync_th_date')}</th>
                                <th style="padding: 10px 14px; color: var(--text-muted);" data-i18n="bank_sync_th_description">${window.i18n.t('bank_sync_th_description')}</th>
                                <th style="padding: 10px 14px; width: 230px; color: var(--text-muted);" data-i18n="bank_sync_th_category">${window.i18n.t('bank_sync_th_category')}</th>
                                <th style="padding: 10px 14px; width: 120px; text-align: right; color: var(--text-muted);" data-i18n="bank_sync_th_amount">${window.i18n.t('bank_sync_th_amount')}</th>
                                <th style="padding: 10px 14px; width: 130px; text-align: center; color: var(--text-muted);" data-i18n="bank_sync_th_status">${window.i18n.t('bank_sync_th_status')}</th>
                                <th style="padding: 10px 14px; width: 140px; text-align: right; color: var(--text-muted);" data-i18n="bank_sync_th_action">${window.i18n.t('bank_sync_th_action')}</th>
                            </tr>
                        </thead>
                        <tbody id="bankSyncReviewBody"></tbody>
                    </table>
                </div>

                <div style="padding: 14px 24px; border-top: 1px solid var(--border-color); background: var(--bg-card); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div id="reviewSummaryBox" style="font-size: 13px; color: var(--text-main); display: flex; gap: 16px;"></div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-secondary" onclick="window.BankSyncView.closeReviewModal()" data-i18n="bank_sync_btn_cancel">
                            ${window.i18n.t('bank_sync_btn_cancel')}
                        </button>
                        <button class="btn btn-primary" id="btnCommitSync" onclick="window.BankSyncView.commitSync()" style="font-weight: 700; padding: 8px 20px; border-radius: 10px; box-shadow: 0 4px 12px rgba(99,102,241,0.3);" data-i18n="bank_sync_btn_commit">
                            ${window.i18n.t('bank_sync_btn_commit')}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale In-App : Délai Anti-Spam & Réouverture de l'Aperçu Récent -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="bankSyncCooldownModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1150; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 480px; padding: 26px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div style="font-size: 42px; margin-bottom: 12px;">⏳</div>
                <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 800; color: var(--text-main);" data-i18n="bank_sync_cooldown_title">
                    ${window.i18n.t('bank_sync_cooldown_title')}
                </h3>
                <p id="cooldownModalMsg" style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin: 0 0 20px 0;" data-i18n="bank_sync_cooldown_msg">
                    ${window.i18n.t('bank_sync_cooldown_msg')}
                </p>

                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button id="btnReopenCachedPreview" class="btn btn-primary" style="display: none; font-weight: 700; padding: 10px; border-radius: 10px; justify-content: center;" onclick="window.BankSyncView.reopenCachedPreview()" data-i18n="bank_sync_reopen_cached_btn">
                        ${window.i18n.t('bank_sync_reopen_cached_btn')}
                    </button>
                    <button class="btn btn-secondary" style="font-size: 12px; padding: 8px; border-radius: 8px;" onclick="window.BankSyncView.forceSyncAnyway()" data-i18n="bank_sync_force_sync_btn">
                        ${window.i18n.t('bank_sync_force_sync_btn')}
                    </button>
                    <button class="btn btn-secondary" style="font-size: 12px; padding: 8px; border-radius: 8px; opacity: 0.8;" onclick="window.BankSyncView.closeCooldownModal()" data-i18n="bank_sync_close_btn">
                        ${window.i18n.t('bank_sync_close_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale In-App : Saisie du Mot de Passe Maître avec Option de Mémorisation -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="masterPasswordModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1200; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 440px; padding: 24px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div style="font-size: 40px; margin-bottom: 12px;">🔐</div>
                <h3 id="masterPwModalTitle" style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_master_pw_modal_title">
                    ${window.i18n.t('bank_sync_master_pw_modal_title')}
                </h3>
                <p id="masterPwModalMsg" style="font-size: 13px; color: var(--text-muted); line-height: 1.4; margin: 0 0 16px 0;" data-i18n="bank_sync_master_pw_modal_msg">
                    ${window.i18n.t('bank_sync_master_pw_modal_msg')}
                </p>
                <div style="margin-bottom: 14px;">
                    <input type="password" id="masterPwModalInput" class="input-styled" style="width: 100%; text-align: center; font-size: 16px; padding: 10px;" placeholder="${window.i18n.t('bank_sync_master_pw_modal_placeholder')}" onkeydown="if(event.key==='Enter') window.BankSyncView._submitMasterPw()" autocomplete="current-password" />
                </div>

                <!-- Option de Mémorisation en Mémoire (RAM TTL) -->
                <div style="margin-bottom: 18px; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 10px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; text-align: left;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: var(--text-main); margin: 0;">
                        <input type="checkbox" id="masterPwRememberCheck" checked />
                        <span data-i18n="bank_vault_remember_label">${window.i18n.t('bank_vault_remember_label')}</span>
                    </label>
                    <select id="masterPwRememberDays" class="input-styled" style="padding: 2px 6px; font-size: 11px; border-radius: 6px;">
                        <option value="3">${window.i18n.t('bank_vault_remember_days_3')}</option>
                        <option value="7" selected>${window.i18n.t('bank_vault_remember_days_7')}</option>
                        <option value="14">${window.i18n.t('bank_vault_remember_days_14')}</option>
                        <option value="30">${window.i18n.t('bank_vault_remember_days_30')}</option>
                    </select>
                </div>

                <div id="masterPwModalError" style="display: none; color: #ef4444; font-size: 12px; margin-bottom: 14px; background: rgba(239,68,68,0.1); padding: 8px; border-radius: 8px;"></div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" style="flex: 1;" onclick="window.BankSyncView._cancelMasterPw()" data-i18n="bank_sync_btn_cancel">
                        ${window.i18n.t('bank_sync_btn_cancel')}
                    </button>
                    <button class="btn btn-primary" style="flex: 1; font-weight: 700;" onclick="window.BankSyncView._submitMasterPw()" data-i18n="bank_sync_master_pw_unlock_btn">
                        ${window.i18n.t('bank_sync_master_pw_unlock_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale In-App : Confirmation de Suppression -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="confirmDeleteModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1200; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 440px; padding: 24px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div style="font-size: 40px; margin-bottom: 12px;">🗑️</div>
                <h3 id="confirmDeleteTitle" style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_delete_title">
                    ${window.i18n.t('bank_sync_delete_title')}
                </h3>
                <p id="confirmDeleteMsg" style="font-size: 13px; color: var(--text-muted); line-height: 1.4; margin: 0 0 20px 0;" data-i18n="bank_sync_delete_msg">
                    ${window.i18n.t('bank_sync_delete_msg')}
                </p>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" style="flex: 1;" onclick="window.BankSyncView._cancelConfirm()" data-i18n="bank_sync_btn_cancel">
                        ${window.i18n.t('bank_sync_btn_cancel')}
                    </button>
                    <button class="btn btn-danger" style="flex: 1; font-weight: 700; background: #ef4444; color: white;" onclick="window.BankSyncView._submitConfirm()" data-i18n="bank_sync_delete_confirm_btn">
                        ${window.i18n.t('bank_sync_delete_confirm_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- Conteneur Toast pour Notifications Flottantes -->
        <div id="bankSyncToastContainer" style="position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;"></div>
        `;
        document.body.appendChild(container);
    },

    // ── GESTION DU COFFRE & DÉVERROUILLAGE SÉCURISÉ ──────────────────
    async loadVaultStatus() {
        try {
            const token = this.getVaultToken();
            const url = token ? `/api/bank-sync/vault/status?token=${encodeURIComponent(token)}` : '/api/bank-sync/vault/status';
            const data = await API.get(url);
            this.vaultStatus = data;
            if (token && !data.is_unlocked) {
                this.clearVaultToken();
            }
            this.renderVaultStatusBar();
        } catch (e) {
            console.warn('[BankSync] Erreur lecture statut coffre:', e);
            this.clearVaultToken();
            this.vaultStatus = { is_unlocked: false, remaining_days: 0 };
            this.renderVaultStatusBar();
        }
    },

    renderVaultStatusBar() {
        const bar = document.getElementById('bankVaultStatusBar');
        if (!bar) return;

        // Si aucune connexion bancaire configurée, masquer complètement la barre
        if (!this.connections || this.connections.length === 0) {
            bar.innerHTML = '';
            bar.style.display = 'none';
            return;
        }
        bar.style.display = 'block';

        const isUnlocked = this.vaultStatus?.is_unlocked;
        const days = this.vaultStatus?.remaining_days || 0;
        const autoSync = this.autoSyncSettings;

        if (isUnlocked) {
            bar.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 14px; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 20px;">🔓</span>
                    <div>
                        <div style="font-size: 13px; font-weight: 700; color: #10b981;">
                            ${window.i18n.tp('bank_vault_unlocked_status', { days })}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted);">
                            <span data-i18n="bank_sync_security_unlocked_desc">${window.i18n.t('bank_sync_security_unlocked_desc')}</span>
                        </div>
                    </div>
                </div>

                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <!-- 1. Bouton déclenchement relevé auto en arrière-plan -->
                    <button class="btn btn-secondary overview-bank-sync-btn" onclick="window.BankSyncView.triggerBackgroundSyncNow()" style="height: 36px; padding: 0 14px; font-size: 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; white-space: nowrap; box-sizing: border-box;" title="Lancer un relevé en arrière-plan pour toutes vos banques maintenant">
                        <span>⚡</span> <span>${window.i18n.t('bank_sync_run_background_btn')}</span>
                    </button>

                    <!-- 2. Auto-Sync Toggle & Sélecteur d'intervalle -->
                    <div style="height: 36px; display: inline-flex; align-items: center; gap: 8px; padding: 0 10px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; font-size: 12px; white-space: nowrap; box-sizing: border-box;">
                        <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap; font-weight: 600; color: var(--text-main);">
                            <input type="checkbox" id="chkAutoSyncToggle" ${autoSync.enabled ? 'checked' : ''} onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: var(--accent);">
                            <span>⏰ <span data-i18n="bank_sync_auto_sync_label">${window.i18n.t('bank_sync_auto_sync_label')}</span></span>
                        </label>
                        <select id="selAutoSyncInterval" class="input-styled" style="height: 26px; padding: 0 6px; font-size: 11px; border-radius: 6px; width: auto; min-width: 58px;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                            <option value="12" ${autoSync.interval_hours === 12 ? 'selected' : ''}>12h</option>
                            <option value="24" ${autoSync.interval_hours === 24 ? 'selected' : ''}>24h</option>
                            <option value="48" ${autoSync.interval_hours === 48 ? 'selected' : ''}>48h</option>
                        </select>
                    </div>

                    <!-- 3. Bouton Verrouiller -->
                    <button class="btn btn-secondary" onclick="window.BankSyncView.lockVault()" style="height: 36px; padding: 0 14px; font-size: 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; white-space: nowrap; box-sizing: border-box;">
                        <span>🔒</span> <span data-i18n="bank_vault_lock_btn">${window.i18n.t('bank_vault_lock_btn')}</span>
                    </button>
                </div>
            </div>
            `;
        } else {
            bar.innerHTML = `
            <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 14px; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 20px;">🔒</span>
                    <div>
                        <div style="font-size: 13px; font-weight: 700; color: #f59e0b;" data-i18n="bank_vault_locked_status">
                            ${window.i18n.t('bank_vault_locked_status')}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted);">
                            <span data-i18n="bank_sync_security_locked_desc">${window.i18n.t('bank_sync_security_locked_desc')}</span>
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <button class="btn btn-secondary overview-bank-sync-btn" onclick="window.BankSyncView.triggerBackgroundSyncNow()" style="height: 36px; padding: 0 14px; font-size: 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-weight: 600; white-space: nowrap; box-sizing: border-box;" title="Déverrouille et lance le relevé en tâche de fond">
                        <span>⚡</span> <span>${window.i18n.t('bank_sync_run_background_btn')}</span>
                    </button>
                    <button class="btn btn-primary" onclick="window.BankSyncView.unlockVaultManually()" style="height: 36px; padding: 0 16px; font-size: 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; white-space: nowrap; box-sizing: border-box;">
                        <span>🔓</span> <span data-i18n="bank_vault_unlock_btn">${window.i18n.t('bank_vault_unlock_btn')}</span>
                    </button>
                </div>
            </div>
            `;
        }
    },

    async unlockVaultManually() {
        const pw = await this.promptMasterPassword(
            'Déverrouillage du coffre',
            'Entrez votre mot de passe maître pour déverrouiller le coffre en mémoire :'
        );
        if (!pw) return;
        this.showToast('Coffre déverrouillé avec succès !', 'success');
        await this.loadVaultStatus();
        await this.loadPendingSync();
    },

    async lockVault() {
        const token = this.getVaultToken();
        try {
            await API.post(`/api/bank-sync/vault/lock${token ? `?token=${encodeURIComponent(token)}` : ''}`);
        } catch (_) {}
        this.clearVaultToken();
        this.vaultStatus = { is_unlocked: false, remaining_days: 0 };
        this.renderVaultStatusBar();
        this.showToast('Coffre-fort verrouillé (mémoire purgée).', 'info');
    },

    async loadAutoSyncSettings() {
        try {
            const data = await API.get('/api/bank-sync/settings/auto-sync');
            this.autoSyncSettings = data || { enabled: false, interval_hours: 24 };
        } catch (e) {
            console.warn('[BankSync] Erreur settings auto-sync:', e);
        }
    },

    async toggleAutoSync(enabled) {
        this.autoSyncSettings.enabled = enabled;
        try {
            await API.post('/api/bank-sync/settings/auto-sync', {
                enabled: enabled,
                interval_hours: this.autoSyncSettings.interval_hours
            });
            this.showToast(enabled ? 'Relevé automatique activé !' : 'Relevé automatique désactivé.', 'info');
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    async changeAutoSyncInterval(interval) {
        this.autoSyncSettings.interval_hours = parseInt(interval) || 24;
        try {
            await API.post('/api/bank-sync/settings/auto-sync', {
                enabled: this.autoSyncSettings.enabled,
                interval_hours: this.autoSyncSettings.interval_hours
            });
            this.showToast(`Fréquence ajustée : ${interval} heures.`, 'info');
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── DÉCLENCHEMENT MANUEL DU RELEVÉ EN ARRIÈRE-PLAN ──────────────
    async triggerBackgroundSyncNow() {
        this.ensureModalsExist();

        const syncButtons = document.querySelectorAll('.overview-bank-sync-btn, #btnTriggerAutoSync');
        const setButtonsState = (state, customHtml) => {
            syncButtons.forEach(btn => {
                btn.classList.remove('is-syncing', 'is-success', 'is-error');
                if (state === 'syncing') {
                    btn.classList.add('is-syncing');
                    btn.disabled = true;
                    btn.innerHTML = `<span>⚡</span> <span>${window.i18n ? window.i18n.t('bank_sync_progress_loading') || 'Relevé en cours...' : 'Relevé en cours...'}</span>`;
                } else if (state === 'success') {
                    btn.classList.add('is-success');
                    btn.disabled = false;
                    btn.innerHTML = `<span>✅</span> <span>${customHtml || (window.i18n ? window.i18n.t('bank_sync_progress_done') || 'Relevé terminé !' : 'Relevé terminé !')}</span>`;
                } else if (state === 'error') {
                    btn.classList.add('is-error');
                    btn.disabled = false;
                    btn.innerHTML = `<span>⚠️</span> <span>${customHtml || (window.i18n ? window.i18n.t('bank_sync_progress_error') || 'Erreur relevé' : 'Erreur relevé')}</span>`;
                } else {
                    btn.disabled = false;
                    btn.innerHTML = `<span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n ? window.i18n.t('bank_sync_run_background_btn') || 'Relever en arrière-plan' : 'Relever en arrière-plan'}</span>`;
                }
            });
        };

        if (!this.vaultStatus || this.vaultStatus.remaining_seconds === undefined) {
            await this.loadVaultStatus();
        }

        let token = this.getVaultToken();
        let pw = null;

        // Si le coffre n'est pas déverrouillé, demander le mot de passe maître
        if (!token || !this.vaultStatus?.is_unlocked) {
            pw = await this.promptMasterPassword(
                window.i18n ? window.i18n.t('bank_sync_run_background_btn') || 'Relevé en arrière-plan' : 'Relevé en arrière-plan',
                window.i18n ? window.i18n.t('bank_sync_vault_prompt_msg') || 'Entrez votre mot de passe maître pour autoriser le relevé en tâche de fond :' : 'Entrez votre mot de passe maître pour autoriser le relevé en tâche de fond :'
            );
            if (!pw) {
                setButtonsState('idle');
                return;
            }
            token = this.getVaultToken();
        }

        // Lancer l'animation de progression sur le fond du bouton
        setButtonsState('syncing');

        const payload = {};
        if (token) payload.vault_token = token;
        if (pw && pw !== "__USE_VAULT_TOKEN__") payload.master_password = pw;

        try {
            const res = await API.post('/api/bank-sync/trigger-auto-sync', payload);
            this.showToast(window.i18n ? window.i18n.t('bank_sync_run_background_toast') || 'Relevé lancé en arrière-plan.' : 'Relevé lancé en arrière-plan.', 'success');

            if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                window.app.setFastNotificationsPolling(true);
            }

            // Rafraîchir les données et l'état
            const refreshAll = async () => {
                await this.refreshActiveViews();
                if (this.connections && this.connections.length > 0) this.loadConnections();
                if (window.app && window.app.loadNotifications) window.app.loadNotifications();
            };

            setTimeout(refreshAll, 3000);
            setTimeout(refreshAll, 8000);
            setTimeout(refreshAll, 14000);
            setTimeout(async () => {
                await refreshAll();
                setButtonsState('success');
                setTimeout(() => setButtonsState('idle'), 2500);
            }, 20000);
        } catch (err) {
            console.error('[BankSync] Erreur trigger-auto-sync:', err);
            if (err.status === 401 || (err.detail && err.detail.includes('verrouill'))) {
                this.clearVaultToken();
                this.vaultStatus = { is_unlocked: false, remaining_days: 0 };
                this.renderVaultStatusBar();
                setButtonsState('idle');
                this.showToast(err.detail || 'Session expirée. Veuillez ressaisir votre mot de passe maître.', 'info');
                const retryPw = await this.promptMasterPassword(
                    'Relevé en arrière-plan',
                    'Veuillez déverrouiller le coffre avec votre mot de passe maître :'
                );
                if (retryPw) {
                    return this.triggerBackgroundSyncNow();
                }
                return;
            }
            setButtonsState('error', err.detail || err.message);
            setTimeout(() => setButtonsState('idle'), 3500);
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── GESTION DES OPÉRATIONS EN ATTENTE (PENDING / SAS) ────────────
    async loadPendingSync() {
        try {
            const data = await API.get('/api/bank-sync/pending');
            this.pendingMatches = data?.matches_by_tx_id || {};
            this.renderPendingSyncBox(data);
            return data;
        } catch (e) {
            console.warn('[BankSync] Erreur chargement pending sync:', e);
            return null;
        }
    },

    async refreshActiveViews() {
        await this.loadPendingSync();
        if (window.OverviewView && document.getElementById('overviewRoot')) {
            if (typeof window.OverviewView.init === 'function') {
                await window.OverviewView.init();
            }
        }
        if (window.TimelineView && document.getElementById('timelineRoot')) {
            if (typeof window.TimelineView.loadData === 'function') {
                await window.TimelineView.loadData();
            }
        }
        if (window.AllOperationsView && document.getElementById('allOpsRoot')) {
            if (typeof window.AllOperationsView.loadData === 'function') {
                await window.AllOperationsView.loadData();
            }
        }
        if (window.AccountsView && document.getElementById('accountsBody')) {
            if (typeof window.AccountsView.loadData === 'function') {
                await window.AccountsView.loadData();
            }
        }
        if (window.app && window.app.refreshSidebar) {
            window.app.refreshSidebar();
        }
    },

    renderPendingSyncBox(data) {
        const box = document.getElementById('bankPendingSyncBox');
        if (!box) return;

        const totalMatches = data?.total_matches || 0;
        const totalNew = data?.total_new || 0;

        if (totalMatches === 0 && totalNew === 0) {
            box.style.display = 'none';
            return;
        }

        box.style.display = 'block';
        box.innerHTML = `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 14px; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 24px;">📥</span>
                <div>
                    <h4 style="margin: 0 0 2px 0; font-size: 14px; font-weight: 700; color: var(--text-main);">
                        ${window.i18n.t('bank_sync_pending_box_title')}
                    </h4>
                    <div style="font-size: 12px; color: var(--text-muted);">
                        ${totalMatches > 0 ? `<strong>${totalMatches}</strong> prête(s) à pointer ` : ''}
                        ${(totalMatches > 0 && totalNew > 0) ? '• ' : ''}
                        ${totalNew > 0 ? `<strong>${totalNew}</strong> nouvelle(s) opération(s)` : ''}
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 8px;">
                ${totalMatches > 0 ? `
                <button class="btn btn-primary" onclick="window.BankSyncView.reconcileAllPending()" style="font-size: 12px; padding: 6px 14px; border-radius: 8px; font-weight: 700;">
                    ⚡ ${window.i18n.t('bank_btn_reconcile_all')} (${totalMatches})
                </button>
                ` : ''}
                ${data.accounts && data.accounts.length > 0 ? `
                <button class="btn btn-secondary" onclick="window.BankSyncView.openPendingReviewModal()" style="font-size: 12px; padding: 6px 14px; border-radius: 8px; font-weight: 600;">
                    📋 ${window.i18n.t('bank_sync_pending_review_btn')}
                </button>
                ` : ''}
            </div>
        </div>
        `;
    },

    async openPendingReviewModal() {
        try {
            this.ensureModalsExist();
            const data = await API.get('/api/bank-sync/pending');
            if (data && data.accounts && data.accounts.length > 0) {
                const firstConnId = data.accounts[0]?.connection_id || (this.connections?.[0]?.id || 1);
                await this.openReviewModal(firstConnId, {
                    connection_id: firstConnId,
                    accounts: data.accounts
                });
            } else {
                this.showToast('Aucune opération en attente.', 'info');
            }
        } catch (e) {
            console.error('[BankSync] Erreur ouverture des opérations en attente:', e);
            this.showToast('Erreur ouverture des opérations en attente : ' + (e.message || e), 'error');
        }
    },

    // ── RAPPROCHEMENT EN 1 CLIC (Depuis Dashboard ou Historique) ─────
    async reconcileFast(txId) {
        try {
            const res = await API.post(`/api/bank-sync/reconcile-fast/${txId}`);
            this.showToast(window.i18n ? window.i18n.t('bank_sync_reconciled_success') || 'Opération pointée avec succès !' : 'Opération pointée avec succès !', 'success');

            // Retirer de pendingMatches localement
            if (this.pendingMatches && this.pendingMatches[txId]) {
                delete this.pendingMatches[txId];
            }

            await this.refreshActiveViews();
        } catch (err) {
            this.showToast('Erreur pointage : ' + (err.detail || err.message), 'error');
        }
    },

    async reconcileAllPending() {
        try {
            const res = await API.post('/api/bank-sync/reconcile-all-pending');
            const count = res?.reconciled_count || 0;
            this.showToast(`${count} opération(s) pointée(s) avec succès !`, 'success');
            this.pendingMatches = {};

            await this.refreshActiveViews();
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── PROMPT MASTER PASSWORD (Custom in-app modal) ────────────────
    promptMasterPassword(title = 'Déverrouillage sécurisé', message = 'Entrez votre mot de passe maître :') {
        this.ensureModalsExist();
        const token = this.getVaultToken();
        if (token && this.vaultStatus?.is_unlocked) {
            return Promise.resolve("__USE_VAULT_TOKEN__");
        }

        return new Promise((resolve) => {
            this._pwResolve = resolve;
            const modal = document.getElementById('masterPasswordModal');
            const titleEl = document.getElementById('masterPwModalTitle');
            const msgEl = document.getElementById('masterPwModalMsg');
            const input = document.getElementById('masterPwModalInput');
            const errEl = document.getElementById('masterPwModalError');

            if (titleEl) titleEl.innerText = title;
            if (msgEl) msgEl.innerText = message;
            if (input) input.value = '';
            if (errEl) errEl.style.display = 'none';

            if (modal) {
                modal.style.display = 'flex';
                setTimeout(() => input && input.focus(), 50);
            } else {
                resolve(null);
            }
        });
    },

    async _submitMasterPw() {
        const input = document.getElementById('masterPwModalInput');
        const val = input.value;
        const errEl = document.getElementById('masterPwModalError');
        if (!val) {
            errEl.innerText = 'Veuillez saisir votre mot de passe maître.';
            errEl.style.display = 'block';
            return;
        }

        const rememberCheck = document.getElementById('masterPwRememberCheck');
        const rememberDaysSel = document.getElementById('masterPwRememberDays');
        const shouldRemember = rememberCheck ? rememberCheck.checked : true;
        const days = shouldRemember ? (rememberDaysSel ? parseInt(rememberDaysSel.value) : 7) : 1;

        try {
            const res = await API.post('/api/bank-sync/vault/unlock', {
                master_password: val,
                remember_days: days
            });
            if (res.vault_token) {
                if (shouldRemember) {
                    this.setVaultToken(res.vault_token);
                }
                this.vaultStatus = res;
                this.renderVaultStatusBar();
            }
        } catch (unlockErr) {
            console.warn('[BankSync] Erreur validation mot de passe maître:', unlockErr);
            errEl.innerText = unlockErr.detail || unlockErr.message || 'Mot de passe maître incorrect.';
            errEl.style.display = 'block';
            return;
        }

        document.getElementById('masterPasswordModal').style.display = 'none';
        if (this._pwResolve) {
            this._pwResolve(val);
            this._pwResolve = null;
        }
    },

    _cancelMasterPw() {
        document.getElementById('masterPasswordModal').style.display = 'none';
        if (this._pwResolve) {
            this._pwResolve(null);
            this._pwResolve = null;
        }
    },

    // ── CONFIRM ACTION (Custom in-app modal) ────────────────────────
    confirmAction(title = 'Confirmer', message = 'Êtes-vous sûr ?') {
        return new Promise((resolve) => {
            this._confirmResolve = resolve;
            const modal = document.getElementById('confirmDeleteModal');
            document.getElementById('confirmDeleteTitle').innerText = title;
            document.getElementById('confirmDeleteMsg').innerText = message;
            modal.style.display = 'flex';
        });
    },

    _submitConfirm() {
        document.getElementById('confirmDeleteModal').style.display = 'none';
        if (this._confirmResolve) {
            this._confirmResolve(true);
            this._confirmResolve = null;
        }
    },

    _cancelConfirm() {
        document.getElementById('confirmDeleteModal').style.display = 'none';
        if (this._confirmResolve) {
            this._confirmResolve(false);
            this._confirmResolve = null;
        }
    },

    async loadConnections() {
        try {
            const conns = await API.get('/api/bank-sync/connections');
            this.connections = conns || [];
            const headerBtn = document.getElementById('btnHeaderBgSync');
            if (headerBtn) {
                headerBtn.style.display = this.connections.length > 0 ? 'flex' : 'none';
            }
            this.renderVaultStatusBar();
            this.renderConnectionsList();
        } catch (err) {
            console.error('Erreur chargement connexions:', err);
        }
    },

    async loadBackends() {
        try {
            const data = await API.get('/api/bank-sync/backends');
            this.backends = data || [];
        } catch (err) {
            console.error('Erreur chargement backends:', err);
        }
    },

    async loadLocalAccounts() {
        try {
            const accs = await API.get('/api/accounts/');
            this.localAccounts = (accs || []).filter(a => !a.is_closed);
        } catch (err) {
            console.error('Erreur chargement comptes locaux:', err);
        }
    },

    renderConnectionsList() {
        const container = document.getElementById('bankConnectionsList');
        if (!container) return;

        if (this.connections.length === 0) {
            container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: 16px;">
                <div style="font-size: 40px; margin-bottom: 12px;">🏦</div>
                <h4 style="font-size: 16px; font-weight: 700; margin: 0 0 6px 0; color: var(--text-main);" data-i18n="bank_sync_empty_state">
                    ${window.i18n.t('bank_sync_empty_state')}
                </h4>
                <p style="font-size: 13px; color: var(--text-muted); max-width: 420px; margin: 0 auto 16px auto;" data-i18n="bank_sync_empty_desc">
                    ${window.i18n.t('bank_sync_empty_desc')}
                </p>
                <button class="btn btn-primary" onclick="window.BankSyncView.openAddModal()" style="font-weight: 600; padding: 8px 18px; border-radius: 10px;">
                    ➕ <span data-i18n="bank_sync_add_btn">${window.i18n.t('bank_sync_add_btn')}</span>
                </button>
            </div>
            `;
            return;
        }

        container.innerHTML = this.connections.map(conn => {
            const lastSyncText = conn.last_sync_at 
                ? new Date(conn.last_sync_at).toLocaleString() 
                : window.i18n.t('bank_sync_never');
            
            const isError = conn.last_sync_status === 'error' || conn.last_sync_status === 'auto_error';
            const statusBadge = isError 
                ? `<span style="background: rgba(239,68,68,0.15); color: #ef4444; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px;">🔴 ${window.i18n.t('bank_sync_status_error')}</span>`
                : `<span style="background: rgba(16,185,129,0.15); color: #10b981; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px;">🟢 ${window.i18n.t('bank_sync_status_connected')}</span>`;

            const cachedPreview = this.getCachedPreview(conn.id);
            const cachedBtn = cachedPreview ? `
                <button class="btn btn-secondary" onclick="window.BankSyncView.openCachedPreviewDirectly(${conn.id})" style="padding: 7px 12px; border-radius: 8px; font-size: 13px;" title="${window.i18n.t('bank_sync_cached_preview_tooltip')}" data-i18n="bank_sync_cached_preview_btn">
                    ${window.i18n.t('bank_sync_cached_preview_btn')}
                </button>
            ` : '';

            return `
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 14px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; box-shadow: var(--shadow-sm);">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <div style="width: 44px; height: 44px; border-radius: 12px; background: var(--bg-base); border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; font-size: 22px;">
                        🏦
                    </div>
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 2px;">
                            <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-main);">${conn.label}</h4>
                            ${statusBadge}
                        </div>
                        <div style="font-size: 12px; color: var(--text-muted); display: flex; gap: 12px;">
                            <span><span data-i18n="bank_sync_bank_label">${window.i18n.t('bank_sync_bank_label')}</span> <strong>${conn.backend}</strong></span>
                            <span>${window.i18n.t('bank_sync_last_sync')} <strong>${lastSyncText}</strong></span>
                            ${conn.last_sync_count ? `<span>+${conn.last_sync_count} op.</span>` : ''}
                        </div>
                        ${conn.last_error ? `<div style="font-size: 11px; color: #ef4444; margin-top: 2px;">⚠️ ${conn.last_error}</div>` : ''}
                    </div>
                </div>

                <div style="display: flex; gap: 8px; align-items: center;">
                    ${cachedBtn}
                    <button class="btn btn-primary" onclick="window.BankSyncView.promptAndSync(${conn.id})" style="display: flex; align-items: center; gap: 6px; font-weight: 600; padding: 7px 14px; border-radius: 8px; font-size: 13px;">
                        <span>🔄</span> <span data-i18n="bank_sync_sync_btn">${window.i18n.t('bank_sync_sync_btn')}</span>
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.openMappingModal(${conn.id})" style="padding: 7px 12px; border-radius: 8px; font-size: 13px;" title="${window.i18n.t('bank_sync_edit_mapping_btn')}" data-i18n="bank_sync_mapping_btn">
                        ${window.i18n.t('bank_sync_mapping_btn')}
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.deleteConnection(${conn.id})" style="padding: 7px 10px; border-radius: 8px; color: #ef4444;" title="${window.i18n.t('bank_sync_delete_btn')}">
                        🗑️
                    </button>
                </div>
            </div>
            `;
        }).join('');
    },

    openAddModal() {
        this.selectedBackend = null;
        document.getElementById('addBankModal').style.display = 'flex';
        document.getElementById('stepSelectBank').style.display = 'block';
        document.getElementById('stepCredentials').style.display = 'none';
        document.getElementById('btnSaveConnection').style.display = 'none';
        this.renderBackendsGrid(this.backends);
    },

    closeAddModal() {
        document.getElementById('addBankModal').style.display = 'none';
    },

    filterBackends(query) {
        const q = query.toLowerCase().trim();
        const filtered = this.backends.filter(b => 
            b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q)
        );
        this.renderBackendsGrid(filtered);
    },

    renderBackendsGrid(backendsList) {
        const grid = document.getElementById('backendsGrid');
        if (!grid) return;

        if (backendsList.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_banks_found')}</div>`;
            return;
        }

        grid.innerHTML = backendsList.map(b => `
            <div class="backend-card" onclick="window.BankSyncView.selectBackend('${b.name}')" 
                 style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">🏦</span>
                <div style="font-size: 12px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${b.description || b.name}
                </div>
            </div>
        `).join('');
    },

    selectBackend(backendName) {
        const backend = this.backends.find(b => b.name === backendName);
        if (!backend) return;

        this.selectedBackend = backend;
        document.getElementById('stepSelectBank').style.display = 'none';
        document.getElementById('stepCredentials').style.display = 'block';
        document.getElementById('btnSaveConnection').style.display = 'inline-block';

        document.getElementById('selectedBankBanner').innerHTML = `
            🏦 <strong>${backend.description || backend.name}</strong> (${backend.name})
        `;
        document.getElementById('connLabelInput').value = backend.description || backend.name;

        this.renderDynamicFields(backend.fields || []);
    },

    backToBankSelection() {
        document.getElementById('stepSelectBank').style.display = 'block';
        document.getElementById('stepCredentials').style.display = 'none';
        document.getElementById('btnSaveConnection').style.display = 'none';
    },

    renderDynamicFields(fields) {
        const container = document.getElementById('dynamicFormFields');
        if (!container) return;

        if (fields.length === 0) {
            container.innerHTML = `
                <div>
                    <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">${window.i18n.t('bank_sync_login_field')}</label>
                    <input type="text" id="cred_login" class="input-styled" required />
                </div>
                <div>
                    <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">${window.i18n.t('bank_sync_password_field')}</label>
                    <input type="password" id="cred_password" class="input-styled" required />
                </div>
            `;
            return;
        }

        container.innerHTML = fields.map(f => {
            const reqMark = f.required ? '*' : '';
            const descHtml = f.description ? `<p style="font-size: 11px; color: var(--text-muted); margin: 2px 0 6px 0;">${f.description}</p>` : '';
            let inputHtml = '';

            if (f.type === 'select' && f.choices) {
                const options = Object.entries(f.choices).map(([val, label]) => 
                    `<option value="${val}" ${f.default === val ? 'selected' : ''}>${label}</option>`
                ).join('');
                inputHtml = `<select id="cred_${f.id}" class="input-styled">${options}</select>`;
            } else if (f.type === 'checkbox') {
                inputHtml = `<input type="checkbox" id="cred_${f.id}" ${f.default === 'true' ? 'checked' : ''} />`;
            } else {
                const inputType = f.type === 'password' ? 'password' : 'text';
                inputHtml = `<input type="${inputType}" id="cred_${f.id}" class="input-styled" value="${f.default || ''}" ${f.required ? 'required' : ''} />`;
            }

            return `
            <div>
                <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">
                    ${f.label} ${reqMark}
                </label>
                ${descHtml}
                ${inputHtml}
            </div>
            `;
        }).join('');
    },

    async saveConnection() {
        if (!this.selectedBackend) return;

        const label = document.getElementById('connLabelInput').value.trim();
        const masterPw = document.getElementById('connMasterPwInput').value;
        const errDiv = document.getElementById('addBankErrorMsg');
        errDiv.style.display = 'none';

        if (!label) {
            errDiv.innerText = 'Veuillez saisir un nom pour cette connexion.';
            errDiv.style.display = 'block';
            return;
        }
        if (!masterPw) {
            errDiv.innerText = 'Veuillez saisir un mot de passe maître pour chiffrer vos identifiants.';
            errDiv.style.display = 'block';
            return;
        }

        const credentials = {};
        const fields = this.selectedBackend.fields || [];
        if (fields.length === 0) {
            credentials.login = document.getElementById('cred_login')?.value?.trim();
            credentials.password = document.getElementById('cred_password')?.value;
        } else {
            fields.forEach(f => {
                const el = document.getElementById(`cred_${f.id}`);
                if (el) {
                    credentials[f.id] = f.type === 'checkbox' ? el.checked : el.value.trim();
                }
            });
        }

        const btn = document.getElementById('btnSaveConnection');
        btn.disabled = true;
        btn.innerText = 'Chiffrement & Sauvegarde...';

        try {
            const payload = {
                backend: this.selectedBackend.name,
                label: label,
                master_password: masterPw,
                credentials: credentials
            };
            const newConn = await API.post('/api/bank-sync/connections', payload);
            
            // Stocker automatiquement le mot de passe maître en session si demandé
            try {
                const unlockRes = await API.post('/api/bank-sync/vault/unlock', {
                    master_password: masterPw,
                    remember_days: 7
                });
                if (unlockRes.vault_token) {
                    this.setVaultToken(unlockRes.vault_token);
                    this.vaultStatus = unlockRes;
                    this.renderVaultStatusBar();
                }
            } catch (_) {}

            this.closeAddModal();
            await this.loadConnections();
            this.showToast('Connexion bancaire ajoutée et chiffrée avec succès !', 'success');

            // Ouvrir directement la modale de mapping
            setTimeout(() => this.openMappingModal(newConn.id), 400);

        } catch (err) {
            errDiv.innerText = err.detail || err.message || 'Erreur lors de la création de la connexion.';
            errDiv.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.innerText = window.i18n.t('bank_sync_save_btn');
        }
    },

    // ── MAPPING DES COMPTES ──────────────────────────────────────────
    async openMappingModal(connId, forceRefresh = false) {
        this.activeConnId = connId;
        const conn = this.connections.find(c => c.id === connId);
        if (!conn) return;

        const modal = document.getElementById('mappingModal');
        const container = document.getElementById('mappingRowsContainer');
        modal.style.display = 'flex';

        // 1. Vérifier si les comptes distants sont déjà en cache
        const cachedAccounts = this.getCachedRemoteAccounts(connId);
        if (cachedAccounts && cachedAccounts.length > 0 && !forceRefresh) {
            this.currentConnection = conn;
            this.currentRemoteAccounts = cachedAccounts;
            this.renderMappingRows(conn, cachedAccounts);
            return;
        }

        container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Récupération des comptes distants auprès de votre banque...</div>';

        // 2. Demander le mot de passe maître si le coffre n'est pas déverrouillé
        let pw = null;
        const token = this.getVaultToken();
        if (token && this.vaultStatus?.is_unlocked) {
            pw = "__USE_VAULT_TOKEN__";
        } else {
            pw = await this.promptMasterPassword(
                'Association des comptes',
                'Entrez votre mot de passe maître pour interroger votre banque :'
            );
        }

        if (!pw) {
            if (cachedAccounts && cachedAccounts.length > 0) {
                this.currentConnection = conn;
                this.currentRemoteAccounts = cachedAccounts;
                this.renderMappingRows(conn, cachedAccounts);
                return;
            }
            this.closeMappingModal();
            return;
        }

        try {
            const testReq = {
                master_password: pw !== "__USE_VAULT_TOKEN__" ? pw : null,
                vault_token: token
            };
            const remoteAccounts = await API.post(`/api/bank-sync/connections/${connId}/test`, testReq);
            this.currentConnection = conn;
            this.currentRemoteAccounts = remoteAccounts || [];
            this.saveCachedRemoteAccounts(connId, this.currentRemoteAccounts);
            this.renderMappingRows(conn, this.currentRemoteAccounts);
        } catch (err) {
            if (cachedAccounts && cachedAccounts.length > 0) {
                this.currentConnection = conn;
                this.currentRemoteAccounts = cachedAccounts;
                this.renderMappingRows(conn, cachedAccounts);
                this.showToast('Actualisation échouée, affichage des comptes en cache : ' + (err.detail || err.message), 'info');
                return;
            }
            container.innerHTML = `
                <div style="padding: 16px; background: rgba(239,68,68,0.1); border-radius: 10px; color: #ef4444; font-size: 13px;">
                    ⚠️ Impossible de récupérer les comptes distants : ${err.detail || err.message}
                </div>
            `;
        }
    },

    closeMappingModal() {
        document.getElementById('mappingModal').style.display = 'none';
    },

    renderMappingRows(connection, remoteAccounts) {
        const container = document.getElementById('mappingRowsContainer');
        if (!container) return;

        if (remoteAccounts.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Aucun compte trouvé sur votre banque.</div>';
            return;
        }

        let currentMapping = {};
        if (connection.account_mapping) {
            try {
                currentMapping = typeof connection.account_mapping === 'string' 
                    ? JSON.parse(connection.account_mapping) 
                    : connection.account_mapping;
            } catch (_) {
                currentMapping = {};
            }
        }

        const localAccOptions = '<option value="">-- Ne pas synchroniser --</option>' + 
            this.localAccounts.map(a => `<option value="${a.id}">${a.name} (${a.type})</option>`).join('');

        const detectType = (r) => {
            const rawLower = (r.type || '').toLowerCase();
            const nameLower = (r.label || '').toLowerCase();
            if (rawLower.includes('prêt') || rawLower.includes('pret') || rawLower.includes('emprunt') || rawLower.includes('loan') || rawLower.includes('crédit') || rawLower.includes('credit') || nameLower.includes('prêt') || nameLower.includes('pret') || nameLower.includes('emprunt')) {
                return 'Prêt / Emprunt';
            }
            if (rawLower.includes('livret') || rawLower.includes('saving') || rawLower.includes('epargne') || rawLower.includes('épargne')) {
                return 'Livret';
            }
            if (rawLower.includes('pea')) {
                return 'PEA';
            }
            if (rawLower.includes('assurance')) {
                return 'Assurance Vie';
            }
            if (rawLower.includes('per')) {
                return 'PER';
            }
            return 'Compte courant';
        };

        container.innerHTML = remoteAccounts.map(r => {
            const mappedLocalId = currentMapping[r.id] || '';
            const balStr = `${r.balance >= 0 ? '+' : ''}${r.balance.toFixed(2)} ${r.currency || '€'}`;
            const balColor = r.balance < 0 ? '#ef4444' : '#10b981';
            const detectedType = detectType(r);

            return `
            <div style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <div style="font-weight: 700; font-size: 14px; color: var(--text-main);">${r.label}</div>
                        <div style="font-size: 12px; color: var(--text-muted); display: flex; gap: 10px; margin-top: 2px;">
                            <span>Type: <strong>${r.type}</strong></span>
                            <span>N°: <strong>${r.id}</strong></span>
                            <span>Solde: <strong style="color: ${balColor};">${balStr}</strong></span>
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Lié à :</span>
                        <select class="input-styled mapping-select" data-remote-id="${r.id}" style="min-width: 200px; padding: 6px 10px;">
                            ${localAccOptions}
                        </select>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.toggleQuickCreateForm('${r.id}')" style="font-size: 11px; padding: 6px 10px; border-radius: 8px; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" title="Personnaliser et créer ce compte dans OmniBank">
                            <span>➕</span> <span>Créer dans OmniBank</span>
                        </button>
                    </div>
                </div>

                <!-- Mini-formulaire in-line de création personnalisée -->
                <div id="qcBox_${r.id}" style="display: none; padding: 12px 14px; background: var(--bg-card); border: 1px dashed var(--accent-border, var(--border-color)); border-radius: 10px; margin-top: 4px;">
                    <div style="font-size: 11px; font-weight: 700; color: var(--accent); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <span>✨</span> <span data-i18n="bank_sync_custom_create_title">${window.i18n.t('bank_sync_custom_create_title')}</span>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end;">
                        <div style="flex: 2; min-width: 150px;">
                            <label style="font-size: 10px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;" data-i18n="bank_sync_custom_create_name">${window.i18n.t('bank_sync_custom_create_name')}</label>
                            <input type="text" id="qcName_${r.id}" class="input-styled" value="${r.label.replace(/"/g, '&quot;')}" style="width: 100%; height: 32px; padding: 0 8px; font-size: 12px;">
                        </div>
                        <div style="flex: 1.5; min-width: 130px;">
                            <label style="font-size: 10px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;" data-i18n="bank_sync_custom_create_type">${window.i18n.t('bank_sync_custom_create_type')}</label>
                            <select id="qcType_${r.id}" class="input-styled" style="width: 100%; height: 32px; padding: 0 8px; font-size: 12px;">
                                <option value="Compte courant" ${detectedType === 'Compte courant' ? 'selected' : ''}>${window.i18n.t('wizard_type_checking')}</option>
                                <option value="Livret" ${detectedType === 'Livret' ? 'selected' : ''}>${window.i18n.t('wizard_type_savings')}</option>
                                <option value="PEA" ${detectedType === 'PEA' ? 'selected' : ''}>${window.i18n.t('wizard_type_pea')}</option>
                                <option value="Assurance Vie" ${detectedType === 'Assurance Vie' ? 'selected' : ''}>${window.i18n.t('wizard_type_life_ins')}</option>
                                <option value="PER" ${detectedType === 'PER' ? 'selected' : ''}>${window.i18n.t('wizard_type_per')}</option>
                                <option value="Prêt / Emprunt" ${detectedType === 'Prêt / Emprunt' ? 'selected' : ''}>${window.i18n.t('wizard_type_loan') || 'Prêt / Emprunt'}</option>
                            </select>
                        </div>
                        <div style="flex: 1; min-width: 100px;">
                            <label style="font-size: 10px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;" data-i18n="bank_sync_custom_create_balance">${window.i18n.t('bank_sync_custom_create_balance')}</label>
                            <input type="number" step="0.01" id="qcBal_${r.id}" class="input-styled" value="${r.balance || 0}" style="width: 100%; height: 32px; padding: 0 8px; font-size: 12px;">
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn btn-primary" onclick="window.BankSyncView.submitQuickCreate('${r.id}', '${r.currency || 'EUR'}')" style="height: 32px; padding: 0 12px; font-size: 11px; font-weight: 700; white-space: nowrap; border-radius: 6px;">
                                <span data-i18n="bank_sync_custom_create_submit">${window.i18n.t('bank_sync_custom_create_submit')}</span>
                            </button>
                            <button class="btn btn-secondary" onclick="window.BankSyncView.toggleQuickCreateForm('${r.id}')" style="height: 32px; padding: 0 10px; font-size: 11px; white-space: nowrap; border-radius: 6px;">
                                <span data-i18n="bank_sync_custom_create_cancel">${window.i18n.t('bank_sync_custom_create_cancel')}</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
            `;
        }).join('');

        // Pré-sélectionner les options
        container.querySelectorAll('.mapping-select').forEach(sel => {
            const remId = sel.getAttribute('data-remote-id');
            if (currentMapping[remId]) {
                sel.value = currentMapping[remId];
            }
        });
    },

    toggleQuickCreateForm(remoteId) {
        const box = document.getElementById(`qcBox_${remoteId}`);
        if (!box) return;
        const isHidden = box.style.display === 'none';
        box.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            const nameInput = document.getElementById(`qcName_${remoteId}`);
            if (nameInput) nameInput.focus();
        }
    },

    async submitQuickCreate(remoteId, currency = 'EUR') {
        const nameInput = document.getElementById(`qcName_${remoteId}`);
        const typeSelect = document.getElementById(`qcType_${remoteId}`);
        const balInput = document.getElementById(`qcBal_${remoteId}`);

        const finalName = nameInput ? nameInput.value.trim() : '';
        const finalType = typeSelect ? typeSelect.value : 'Compte courant';
        const finalBal = balInput ? parseFloat(balInput.value) || 0.0 : 0.0;

        if (!finalName) {
            this.showToast('Veuillez indiquer un nom de compte.', 'warning');
            return;
        }

        try {
            const newAcc = await API.post('/api/accounts/', {
                name: finalName,
                type: finalType,
                initial_balance: finalBal,
                currency: currency || 'EUR'
            });

            await this.loadLocalAccounts();
            if (window.app && window.app.refreshSidebar) {
                window.app.refreshSidebar();
            }
            if (window.AccountsView && typeof window.AccountsView.loadData === 'function') {
                window.AccountsView.loadData();
            }

            // Récupérer le mapping courant depuis le DOM
            const currentMapping = {};
            document.querySelectorAll('.mapping-select').forEach(sel => {
                const remId = sel.getAttribute('data-remote-id');
                if (sel.value) currentMapping[remId] = parseInt(sel.value);
            });
            currentMapping[remoteId] = newAcc.id;

            const conn = this.connections.find(c => c.id === this.activeConnId);
            if (conn) {
                conn.account_mapping = JSON.stringify(currentMapping);
            }

            this.renderMappingRows(conn, this.currentRemoteAccounts || []);
            this.showToast(`Compte "${newAcc.name}" (${finalType}) créé et associé avec succès !`, 'success');
        } catch (err) {
            this.showToast('Erreur création compte : ' + (err.detail || err.message), 'error');
        }
    },

    async saveMapping() {
        const connId = this.activeConnId;
        if (!connId) return;

        const mapping = {};
        document.querySelectorAll('.mapping-select').forEach(sel => {
            const remoteId = sel.getAttribute('data-remote-id');
            const localId = parseInt(sel.value);
            if (remoteId && localId) {
                mapping[remoteId] = localId;
            }
        });

        try {
            await API.put(`/api/bank-sync/connections/${connId}`, {
                account_mapping: mapping
            });
            this.closeMappingModal();
            await this.loadConnections();
            this.showToast('Association des comptes enregistrée !', 'success');
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── GESTION ANTI-SPAM & COOLDOWN ─────────────────────────────────
    async openCachedPreviewDirectly(connId) {
        const cached = this.getCachedPreview(connId);
        if (cached && cached.data) {
            this.openReviewModal(connId, cached.data);
            return;
        }

        // Récupérer depuis les opérations en attente (du relevé en arrière-plan)
        try {
            const data = await API.get('/api/bank-sync/pending');
            if (data && data.accounts && data.accounts.length > 0) {
                const connAccounts = data.accounts.filter(a => !a.connection_id || a.connection_id === connId);
                const accountsToUse = connAccounts.length > 0 ? connAccounts : data.accounts;
                const preview = {
                    connection_id: connId,
                    accounts: accountsToUse
                };
                this.saveCachedPreview(connId, preview);
                this.openReviewModal(connId, preview);
                return;
            }
        } catch (_) {}

        this.showToast('Aucun aperçu récent disponible pour cette connexion.', 'info');
    },

    async promptAndSync(connId) {
        this.activeConnId = connId;
        const conn = this.connections.find(c => c.id === connId);
        const cached = this.getCachedPreview(connId);

        let lastTime = 0;
        if (cached && cached.timestamp) {
            lastTime = cached.timestamp;
        } else if (conn && conn.last_sync_at) {
            lastTime = new Date(conn.last_sync_at).getTime();
        }

        const elapsedMs = Date.now() - lastTime;

        // Si la dernière synchronisation a eu lieu il y a moins de 5 minutes :
        if (lastTime > 0 && elapsedMs < this.COOLDOWN_MS) {
            this.showCooldownModal(connId, elapsedMs, cached);
            return;
        }

        // Sinon : déroulement normal
        await this._startFreshSync(connId);
    },

    showCooldownModal(connId, elapsedMs, cached) {
        const modal = document.getElementById('bankSyncCooldownModal');
        const msgEl = document.getElementById('cooldownModalMsg');
        const btnReopen = document.getElementById('btnReopenCachedPreview');

        const elapsedSec = Math.floor(elapsedMs / 1000);
        const elapsedMin = Math.floor(elapsedSec / 60);
        const remainingSec = Math.floor((this.COOLDOWN_MS - elapsedMs) / 1000);
        const remainingMin = Math.ceil(remainingSec / 60);

        const timeAgoStr = elapsedMin > 0 ? `${elapsedMin} min` : `${elapsedSec} sec`;

        msgEl.innerHTML = `
            Une synchronisation a déjà été effectuée il y a <strong>${timeAgoStr}</strong> (délai de sécurité conseillé : <strong>5 min</strong> — reste ~${remainingMin} min).<br><br>
            Pour préserver l'accès à votre banque et éviter tout blocage ou demande de code 2FA répétée, vous pouvez consulter directement le dernier relevé obtenu sans réinterroger les serveurs de la banque.
        `;

        if (cached && cached.data) {
            let totalOps = 0;
            (cached.data.accounts || []).forEach(a => totalOps += (a.transactions || []).length);
            btnReopen.innerHTML = `📋 Rouvrir le dernier aperçu (${totalOps} opérations)`;
            btnReopen.style.display = 'flex';
        } else {
            btnReopen.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    reopenCachedPreview() {
        this.closeCooldownModal();
        if (this.activeConnId) {
            const cached = this.getCachedPreview(this.activeConnId);
            if (cached && cached.data) {
                this.openReviewModal(this.activeConnId, cached.data);
            }
        }
    },

    async forceSyncAnyway() {
        this.closeCooldownModal();
        if (this.activeConnId) {
            await this._startFreshSync(this.activeConnId);
        }
    },

    closeCooldownModal() {
        document.getElementById('bankSyncCooldownModal').style.display = 'none';
    },

    async _startFreshSync(connId) {
        let pw = null;
        const token = this.getVaultToken();
        if (token && this.vaultStatus?.is_unlocked) {
            pw = "__USE_VAULT_TOKEN__";
        } else {
            pw = await this.promptMasterPassword(
                'Synchronisation bancaire',
                'Entrez votre mot de passe maître pour synchroniser vos comptes :'
            );
        }
        if (!pw) return;

        this.activeConnId = connId;
        this.startSyncStream(connId, pw !== "__USE_VAULT_TOKEN__" ? pw : null, token);
    },

    startSyncStream(connId, masterPassword, vaultToken) {
        const progressModal = document.getElementById('syncProgressModal');
        const progressTitle = document.getElementById('syncProgressTitle');
        const progressMsg = document.getElementById('syncProgressMsg');
        const progressBar = document.getElementById('syncProgressBar');

        progressModal.style.display = 'flex';
        progressTitle.innerText = 'Connexion à la banque en cours...';
        progressMsg.innerText = 'Établissement du canal sécurisé...';
        progressBar.style.width = '25%';

        let url = `/api/bank-sync/connections/${connId}/sync-stream?since_days=90`;
        if (masterPassword) url += `&master_password=${encodeURIComponent(masterPassword)}`;
        if (vaultToken) url += `&vault_token=${encodeURIComponent(vaultToken)}`;

        const es = new EventSource(url);
        this.eventSource = es;

        es.addEventListener('progress', (e) => {
            const data = JSON.parse(e.data);
            progressMsg.innerText = data.message || 'Synchronisation...';
            if (data.step === 'auth') progressBar.style.width = '45%';
            if (data.step === 'sync_account') progressBar.style.width = '75%';
        });

        es.addEventListener('2fa_required', (e) => {
            const data = JSON.parse(e.data);
            this.activeSessionId = data.session_id;
            this.show2FAModal(data.type, data.message);
        });

        es.addEventListener('preview_ready', (e) => {
            const previewData = JSON.parse(e.data);
            this.saveCachedPreview(connId, previewData);
            progressBar.style.width = '100%';
            es.close();
            this.eventSource = null;
            this.refreshActiveViews();
            setTimeout(() => {
                progressModal.style.display = 'none';
                this.openReviewModal(connId, previewData);
                this.renderConnectionsList();
            }, 500);
        });

        es.addEventListener('done', (e) => {
            const data = JSON.parse(e.data);
            progressBar.style.width = '100%';
            es.close();
            this.eventSource = null;
            setTimeout(() => {
                progressModal.style.display = 'none';
                if (data.accounts) {
                    this.saveCachedPreview(connId, data);
                    this.openReviewModal(connId, data);
                    this.renderConnectionsList();
                } else {
                    this.loadConnections();
                }
            }, 500);
        });

        es.addEventListener('error', (e) => {
            let msg = 'Erreur lors de la synchronisation.';
            try {
                if (e.data) {
                    const data = JSON.parse(e.data);
                    msg = data.message || msg;
                }
            } catch (_) {}
            es.close();
            this.eventSource = null;
            progressModal.style.display = 'none';
            this.showToast('Échec de la synchronisation : ' + msg, 'error');
            this.loadConnections();
        });
    },

    // ── REVUE DES OPÉRATIONS (STYLE IMPORT CSV & IA CONDITIONNELLE) ──
    async openReviewModal(connId, previewData) {
        this.ensureModalsExist();
        if (!window.app?.categoriesList || window.app.categoriesList.length === 0) {
            try {
                window.app.categoriesList = await API.get('/api/categories/');
            } catch (_) {
                window.app.categoriesList = [];
            }
        }
        this.activeConnId = connId;
        this.previewData = previewData;
        this.currentAccountIndex = 0;
        this.currentFilter = 'all';

        const modal = document.getElementById('bankSyncReviewModal');
        if (modal) modal.style.display = 'flex';

        // Adapter la visibilité du bouton IA global selon paramètre enable_ai
        const aiBtn = document.getElementById('btnSyncCategorizeAllAI');
        if (aiBtn) {
            aiBtn.style.display = this.isAIEnabled() ? 'inline-flex' : 'none';
        }

        this.renderAccountTabs();
        this.renderReviewTable();
    },

    closeReviewModal() {
        document.getElementById('bankSyncReviewModal').style.display = 'none';
        this.previewData = null;
    },

    renderAccountTabs() {
        const container = document.getElementById('reviewAccountTabs');
        if (!container || !this.previewData || !this.previewData.accounts) return;

        const accs = this.previewData.accounts;
        if (accs.length <= 1) {
            container.innerHTML = `<span style="font-weight: 700; font-size: 13px; color: var(--text-main);">${accs[0]?.account_name || 'Compte'}</span>`;
            return;
        }

        container.innerHTML = accs.map((acc, idx) => `
            <button class="btn btn-sm ${idx === this.currentAccountIndex ? 'btn-primary' : 'btn-secondary'}" 
                    onclick="window.BankSyncView.switchAccountTab(${idx})" 
                    style="padding: 4px 12px; font-size: 12px; border-radius: 8px;">
                ${acc.account_name} (${acc.transactions?.length || 0})
            </button>
        `).join('');
    },

    switchAccountTab(idx) {
        this.currentAccountIndex = idx;
        this.renderAccountTabs();
        this.renderReviewTable();
    },

    setReviewFilter(filter) {
        this.currentFilter = filter;

        ['btnSyncFilterAll', 'btnSyncFilterAdd', 'btnSyncFilterReconcile', 'btnSyncFilterIgnored'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.background = 'transparent';
                btn.style.borderColor = 'var(--border-color)';
                btn.style.color = 'var(--text-muted)';
            }
        });

        const activeMap = {
            'all': 'btnSyncFilterAll',
            'add': 'btnSyncFilterAdd',
            'reconcile': 'btnSyncFilterReconcile',
            'ignored': 'btnSyncFilterIgnored'
        };
        const activeBtn = document.getElementById(activeMap[filter]);
        if (activeBtn) {
            activeBtn.style.background = 'var(--accent)';
            activeBtn.style.borderColor = 'var(--accent)';
            activeBtn.style.color = 'white';
        }

        this.renderReviewTable();
    },

    renderReviewTable() {
        const tbody = document.getElementById('bankSyncReviewBody');
        if (!tbody || !this.previewData || !this.previewData.accounts) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_transactions')}</td></tr>`;
            return;
        }

        const txs = currentAcc.transactions;
        const categories = window.app?.categoriesList || [];
        const aiEnabled = this.isAIEnabled();

        let visibleTxs = txs.filter(tx => {
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'ignored') return tx.is_reconciled && tx.already_reconciled;
            if (this.currentFilter === 'reconcile') return tx.is_reconciled && !tx.already_reconciled;
            if (this.currentFilter === 'add') return !tx.is_reconciled;
            return true;
        });

        if (visibleTxs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_transactions_filter')}</td></tr>`;
            this.updateReviewSummary();
            return;
        }

        const lblInDb = window.i18n.t('bank_sync_in_db') || 'En base :';
        const lblAutoCat = window.i18n.t('bank_sync_auto_cat') || '(Automatique)';
        const lblSelectCat = window.i18n.t('bank_sync_select_category') || '-- Catégorie --';
        const lblIgnoreRow = window.i18n.t('bank_sync_ignore_row_tooltip') || 'Ignorer cette ligne';

        tbody.innerHTML = visibleTxs.map((tx) => {
            const isRec = tx.is_reconciled;
            const alreadyRec = tx.already_reconciled;

            let statusBadge = '';
            let actionText = '';
            let actionColor = '';

            if (isRec && alreadyRec) {
                if (tx.is_mirror_transfer) {
                    const badgeLabel = window.i18n.t('bank_sync_mirror_transfer_badge') || 'Virement miroir';
                    const badgeTip = (window.i18n.t('bank_sync_mirror_transfer_tooltip') || 'Écriture miroir d\'un virement interne déjà enregistré.').replace(/"/g, '&quot;');
                    statusBadge = `<span class="badge" style="background:rgba(99,102,241,0.12); color:var(--accent); border:1px solid rgba(99,102,241,0.3); cursor:help; display:inline-flex; align-items:center; gap:4px;" title="${badgeTip}"><span>${badgeLabel}</span> <span style="font-size:11px; opacity:0.8;">ℹ️</span></span>`;
                    actionText = window.i18n.t('bank_sync_mirror_transfer_action') || 'Ignorée (miroir de virement)';
                    actionColor = `color: var(--text-muted);`;
                } else {
                    statusBadge = `<span class="badge" style="background:var(--bg-surface); color:var(--text-muted); border:1px solid var(--border-color);">${window.i18n.t('bank_sync_status_already_processed')}</span>`;
                    actionText = window.i18n.t('bank_sync_action_ignored_duplicate') || 'Ignorée (doublon)';
                    actionColor = `color: var(--text-muted);`;
                }
            } else if (isRec && !alreadyRec) {
                statusBadge = `<span class="badge" style="background:var(--color-income, #10b981); color:white;">${window.i18n.t('bank_sync_status_to_reconcile')}</span>`;
                actionText = window.i18n.t('bank_sync_action_will_reconcile') || 'Sera pointée';
                actionColor = `color: var(--color-income, #10b981);`;
            } else {
                statusBadge = `<span class="badge" style="background:var(--color-expense, #6366f1); color:white;">${window.i18n.t('bank_sync_status_to_add')}</span>`;
                actionText = window.i18n.t('bank_sync_action_new_operation') || 'Nouvelle opération';
                actionColor = `color: var(--color-expense, #6366f1);`;
            }

            const rawDesc = tx.db_description ? `<div style="font-size: 10px; color: var(--text-muted); margin-bottom: 2px;">${lblInDb} ${tx.db_description}</div>` : '';
            const descInput = isRec 
                ? `${rawDesc}<input type="text" class="sync-desc input-styled" value="${tx.description.replace(/"/g, '&quot;')}" style="width: 100%; border: 1px solid transparent; background: transparent; padding: 4px; color: var(--text-muted);" readonly>` 
                : `${rawDesc}<input type="text" class="sync-desc input-styled" value="${tx.description.replace(/"/g, '&quot;')}" style="width: 100%; padding: 4px;" onchange="window.BankSyncView.updateTxDesc(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">`;

            const catOptions = `<option value="">${lblSelectCat}</option>` + categories.filter(c => !c.is_closed).map(c => 
                `<option value="${c.name.replace(/"/g, '&quot;')}" ${tx.category === c.name ? 'selected' : ''}>${c.name}</option>`
            ).join('');

            const aiButtonHtml = (!isRec && aiEnabled) ? `
                <button class="btn btn-secondary" style="padding: 3px 6px; font-size: 11px; border-radius: 6px;" onclick="window.BankSyncView.categorizeRowAI('${tx.csv_id}', this)" title="${window.i18n.t('bank_categorize_ai_tooltip')}">🧠</button>
            ` : '';

            const catSelect = isRec 
                ? `<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">${lblAutoCat}</span>`
                : `
                <div style="display: flex; gap: 4px; align-items: center;">
                    <select class="input-styled sync-cat" id="catSel_${tx.csv_id}" style="flex: 1; padding: 4px;" onchange="window.BankSyncView.updateTxCat(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">
                        ${catOptions}
                    </select>
                    ${aiButtonHtml}
                </div>
                `;

            const amountColor = (tx.raw_amount < 0) ? '#ef4444' : '#10b981';
            const amountInput = isRec 
                ? `<span style="font-weight: 700; color: ${amountColor};">${(tx.raw_amount < 0 ? '-' : '+')} ${tx.amount.toFixed(2)} €</span>`
                : `<input type="number" step="0.01" class="input-styled" value="${tx.amount.toFixed(2)}" style="width: 80px; text-align: right; padding: 4px; font-weight: 700; color: ${amountColor};" onchange="window.BankSyncView.updateTxAmount(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">`;

            return `
            <tr id="syncRow_${tx.csv_id}" style="border-bottom: 1px solid var(--border-color); ${alreadyRec ? 'opacity: 0.6;' : ''}">
                <td style="padding: 10px 14px;">
                    <input type="date" class="input-styled sync-date" value="${tx.date_operation}" style="width: 120px; padding: 4px;" ${isRec ? 'disabled' : ''} onchange="window.BankSyncView.updateTxDate(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">
                </td>
                <td style="padding: 10px 14px;">${descInput}</td>
                <td style="padding: 10px 14px;">${catSelect}</td>
                <td style="padding: 10px 14px; text-align: right;">
                    ${amountInput}
                </td>
                <td style="padding: 10px 14px; text-align: center;">${statusBadge}</td>
                <td style="padding: 10px 14px;">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px;">
                        <span style="font-size: 11px; ${actionColor}">${actionText}</span>
                        <button class="btn btn-secondary" style="padding: 4px 8px; color: #ef4444; border: 1px solid var(--border-color); border-radius: 6px;" onclick="window.BankSyncView.removeTxRow('${tx.csv_id}')" title="${lblIgnoreRow}">✕</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        this.updateReviewSummary();
    },

    updateTxDesc(accIdx, csvId, newDesc) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.description = newDesc;
    },

    updateTxCat(accIdx, csvId, newCat) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.category = newCat || null;
    },

    updateTxDate(accIdx, csvId, newDate) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.date_operation = newDate;
    },

    updateTxAmount(accIdx, csvId, newAmt) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) {
            const val = parseFloat(newAmt) || 0;
            tx.amount = Math.abs(val);
            tx.raw_amount = tx.raw_amount < 0 ? -Math.abs(val) : Math.abs(val);
        }
    },

    removeTxRow(csvId) {
        if (!this.previewData) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (currentAcc) {
            currentAcc.transactions = currentAcc.transactions.filter(t => t.csv_id !== csvId);
            this.renderReviewTable();
        }
    },

    // ── AUTO-CATÉGORISATION IA (Conditionnelle) ──────────────────────
    async categorizeRowAI(csvId, btnEl) {
        if (!this.isAIEnabled()) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        const tx = currentAcc?.transactions.find(t => t.csv_id === csvId);
        if (!tx) return;

        const originalText = btnEl.innerText;
        btnEl.innerText = '⏳';
        btnEl.disabled = true;

        try {
            const res = await API.post('/api/ai/categorize', { description: tx.description });
            if (res && res.category) {
                tx.category = res.category;
                const sel = document.getElementById(`catSel_${csvId}`);
                if (sel) sel.value = res.category;
                this.showToast(`Catégorie suggérée : ${res.category}`, 'success');
            }
        } catch (err) {
            this.showToast('Erreur IA : ' + (err.detail || err.message), 'error');
        } finally {
            btnEl.innerText = originalText;
            btnEl.disabled = false;
        }
    },

    async categorizeAllNewAI() {
        if (!this.isAIEnabled() || !this.previewData) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) return;

        const uncatTxs = currentAcc.transactions.filter(t => !t.is_reconciled && !t.category);
        if (uncatTxs.length === 0) {
            this.showToast('Toutes les nouvelles opérations sont déjà catégorisées.', 'info');
            return;
        }

        const btn = document.getElementById('btnSyncCategorizeAllAI');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> <span>Catégorisation IA en cours...</span>';
        }

        try {
            const descriptions = uncatTxs.map(t => t.description);
            const res = await API.post('/api/ai/categorize_batch', { descriptions });
            if (res && res.categories) {
                uncatTxs.forEach((tx, idx) => {
                    const assigned = res.categories[idx];
                    if (assigned) {
                        tx.category = assigned;
                    }
                });
                this.renderReviewTable();
                this.showToast(`${uncatTxs.length} opération(s) catégorisée(s) par l'IA !`, 'success');
            }
        } catch (err) {
            this.showToast('Erreur catégorisation IA en lot : ' + (err.detail || err.message), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>✨</span> <span>${window.i18n.t('bank_categorize_all_ai')}</span>`;
            }
        }
    },

    updateReviewSummary() {
        const box = document.getElementById('reviewSummaryBox');
        if (!box || !this.previewData || !this.previewData.accounts) return;

        let totalNew = 0;
        let totalReconciled = 0;
        let totalIgnored = 0;

        this.previewData.accounts.forEach(acc => {
            (acc.transactions || []).forEach(tx => {
                if (tx.is_reconciled && tx.already_reconciled) {
                    totalIgnored++;
                } else if (tx.is_reconciled) {
                    totalReconciled++;
                } else {
                    totalNew++;
                }
            });
        });

        const toAddStr = window.i18n.tp('bank_sync_summary_to_add', { count: totalNew });
        const toRecStr = window.i18n.tp('bank_sync_summary_to_reconcile', { count: totalReconciled });
        const ignoredStr = window.i18n.tp('bank_sync_summary_ignored', { count: totalIgnored });

        box.innerHTML = `
            <span>🟢 <strong>${toAddStr}</strong></span>
            <span>🔵 <strong>${toRecStr}</strong></span>
            <span style="color: var(--text-muted);">⚪ <strong>${ignoredStr}</strong></span>
        `;
    },

    async commitSync() {
        if (!this.previewData || !this.activeConnId) return;

        const allTxs = [];
        this.previewData.accounts.forEach(acc => {
            (acc.transactions || []).forEach(tx => {
                allTxs.push({
                    account_id: acc.account_id,
                    date_operation: tx.date_operation,
                    description: tx.description,
                    amount: tx.amount,
                    raw_amount: tx.raw_amount,
                    category: tx.category,
                    csv_id: tx.csv_id,
                    is_reconciled: tx.is_reconciled,
                    already_reconciled: tx.already_reconciled,
                    matched_db_id: tx.matched_db_id
                });
            });
        });

        try {
            const res = await API.post(`/api/bank-sync/connections/${this.activeConnId}/commit`, {
                transactions: allTxs
            });

            this.closeReviewModal();
            this.showToast(`Synchronisation validée : +${res.imported} ajoutée(s), ✔ ${res.reconciled} pointée(s)`, 'success');
            await this.loadConnections();
            await this.loadPendingSync();

            if (window.OverviewView && window.OverviewView.init) {
                window.OverviewView.init();
            }
            if (window.AccountsView && window.AccountsView.loadData) {
                window.AccountsView.loadData();
            }
            if (window.TimelineView && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
            if (window.AllOperationsView && window.AllOperationsView.loadData) {
                window.AllOperationsView.loadData();
            }
            if (window.app && window.app.refreshSidebar) {
                window.app.refreshSidebar();
            }
        } catch (err) {
            this.showToast('Erreur lors de la validation : ' + (err.detail || err.message), 'error');
        }
    },

    show2FAModal(type, message) {
        const modal = document.getElementById('twoFAModal');
        const icon = document.getElementById('twoFAIcon');
        const title = document.getElementById('twoFATitle');
        const msg = document.getElementById('twoFAMessage');
        const otpContainer = document.getElementById('twoFAOtpInputContainer');
        const confirmBtn = document.getElementById('twoFAConfirmBtn');

        modal.style.display = 'flex';
        msg.innerText = message || '';

        if (type === 'app_validation') {
            icon.innerText = '📱';
            title.innerText = window.i18n.t('bank_sync_2fa_app_title');
            otpContainer.style.display = 'none';
            confirmBtn.innerText = window.i18n.t('bank_sync_2fa_app_confirm_btn');
        } else {
            icon.innerText = '🔑';
            title.innerText = window.i18n.t('bank_sync_2fa_otp_title');
            otpContainer.style.display = 'block';
            document.getElementById('twoFAOtpInput').value = '';
            confirmBtn.innerText = window.i18n.t('bank_sync_2fa_send_btn');
        }
    },

    async submit2FA() {
        if (!this.activeSessionId) return;

        const otpInput = document.getElementById('twoFAOtpInput');
        const isOtp = document.getElementById('twoFAOtpInputContainer').style.display !== 'none';
        const value = isOtp ? otpInput.value.trim() : null;

        try {
            await API.post('/api/bank-sync/2fa/respond', {
                session_id: this.activeSessionId,
                response_type: isOtp ? 'otp_code' : 'app_validated',
                value: value
            });
            document.getElementById('twoFAModal').style.display = 'none';
        } catch (err) {
            this.showToast('Erreur validation 2FA : ' + (err.detail || err.message), 'error');
        }
    },

    async cancel2FA() {
        if (this.activeSessionId) {
            try {
                await API.post('/api/bank-sync/2fa/respond', {
                    session_id: this.activeSessionId,
                    response_type: 'cancel'
                });
            } catch (_) {}
        }
        document.getElementById('twoFAModal').style.display = 'none';
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        document.getElementById('syncProgressModal').style.display = 'none';
    },

    abortSync() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        document.getElementById('syncProgressModal').style.display = 'none';
    },

    async deleteConnection(connId) {
        const confirmed = await this.confirmAction(
            'Supprimer la connexion',
            'Voulez-vous vraiment supprimer cette connexion bancaire et ses identifiants chiffrés ?'
        );
        if (!confirmed) return;

        try {
            await API.del(`/api/bank-sync/connections/${connId}`);
            sessionStorage.removeItem(`omnibank_sync_preview_${connId}`);
            await this.loadConnections();
            this.showToast('Connexion bancaire supprimée.', 'info');
        } catch (err) {
            this.showToast('Erreur suppression : ' + (err.detail || err.message), 'error');
        }
    }
};
