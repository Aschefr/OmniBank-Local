// static/js/views/bank_sync_connections.js — Gestion des connexions bancaires
// Enrichit window.BankSyncView via Object.assign()

Object.assign(window.BankSyncView, {

    promptMasterPassword(title = null, message = null) {
        this.ensureModalsExist();
        const token = this.getVaultToken();
        if (token && this.vaultStatus?.is_unlocked) {
            return Promise.resolve("__USE_VAULT_TOKEN__");
        }

        const isServerUnlockedWithoutToken = !!(this.vaultStatus?.is_unlocked && !token);
        const defaultTitle = isServerUnlockedWithoutToken
            ? (window.i18n ? window.i18n.t('bank_sync_auth_device_title') || 'Autoriser cet appareil' : 'Autoriser cet appareil')
            : (window.i18n ? window.i18n.t('bank_sync_master_pw_modal_title') || 'Déverrouillage sécurisé' : 'Déverrouillage sécurisé');
        const effectiveTitle = title || defaultTitle;
        const effectiveMessage = message || (window.i18n ? window.i18n.t('bank_sync_master_pw_modal_msg') : 'Entrez votre mot de passe maître :');

        return new Promise((resolve) => {
            this._pwResolve = resolve;
            const modal = document.getElementById('masterPasswordModal');
            const titleEl = document.getElementById('masterPwModalTitle');
            const msgEl = document.getElementById('masterPwModalMsg');
            const input = document.getElementById('masterPwModalInput');
            const errEl = document.getElementById('masterPwModalError');
            const noticeEl = document.getElementById('masterPwModalNotice');

            if (titleEl) titleEl.innerText = effectiveTitle;
            if (msgEl) msgEl.innerText = effectiveMessage;
            if (input) input.value = '';
            if (errEl) errEl.style.display = 'none';
            if (noticeEl) noticeEl.style.display = isServerUnlockedWithoutToken ? 'block' : 'none';

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
            errEl.innerText = window.i18n ? window.i18n.t('bank_sync_master_pw_required') : 'Veuillez saisir votre mot de passe maître.';
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
                await this.loadConnections();
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
    confirmAction(title = null, message = null) {
        const effectiveTitle = title || (window.i18n ? window.i18n.t('bank_sync_delete_title') : 'Confirmer');
        const effectiveMessage = message || (window.i18n ? window.i18n.t('bank_sync_delete_msg') : 'Êtes-vous sûr ?');
        return new Promise((resolve) => {
            this._confirmResolve = resolve;
            const modal = document.getElementById('confirmDeleteModal');
            document.getElementById('confirmDeleteTitle').innerText = effectiveTitle;
            document.getElementById('confirmDeleteMsg').innerText = effectiveMessage;
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
            <div style="text-align: center; padding: 24px 20px; background: var(--bg-base); border: 1px dashed var(--border-color); border-radius: 12px;">
                <div style="font-size: 32px; margin-bottom: 8px;">🏦</div>
                <h4 style="font-size: 14px; font-weight: 700; margin: 0 0 4px 0; color: var(--text-main);" data-i18n="bank_sync_empty_state">
                    ${window.i18n.t('bank_sync_empty_state')}
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); max-width: 480px; margin: 0 auto 14px auto;" data-i18n="bank_sync_empty_desc">
                    ${window.i18n.t('bank_sync_empty_desc')}
                </p>
                <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                    <button class="btn btn-primary" onclick="window.BankSyncView.openAddModal()" style="font-weight: 600; padding: 7px 16px; font-size: 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;">
                        <span>➕</span> <span data-i18n="bank_sync_add_btn">${window.i18n.t('bank_sync_add_btn')}</span>
                    </button>
                    <button class="btn btn-secondary" onclick="window.ImportWizard ? window.ImportWizard.open() : null" style="font-weight: 600; padding: 7px 16px; font-size: 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;">
                        <span>📥</span> <span data-i18n="btn_import_statement">${window.i18n.t('btn_import_statement') || 'Importer un relevé'}</span>
                    </button>
                </div>
            </div>
            `;
            return;
        }

        container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 14px;">
            ${this.connections.map(conn => {
                const lastSyncText = conn.last_sync_at 
                    ? new Date(conn.last_sync_at).toLocaleString() 
                    : window.i18n.t('bank_sync_never');
                
                const isVaultUnlocked = Boolean(this.vaultStatus && this.vaultStatus.is_unlocked);
                const isStalePasswordError = isVaultUnlocked && conn.last_error && (conn.last_error.toLowerCase().includes('mot de passe') || conn.last_error.toLowerCase().includes('coffre'));
                const effectiveError = isStalePasswordError ? null : (conn.last_error && conn.last_error.trim() ? conn.last_error.trim() : null);
                const isError = !isStalePasswordError && (conn.last_sync_status === 'error' || conn.last_sync_status === 'auto_error' || Boolean(effectiveError));
                const statusBadge = isError 
                    ? `<span class="bank-connection-status-badge" style="background: rgba(239,68,68,0.12); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0;"><span>🔴</span> <span>${window.i18n.t('bank_sync_status_error')}</span></span>`
                    : `<span class="bank-connection-status-badge" style="background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.25); font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0;"><span>🟢</span> <span>${window.i18n.t('bank_sync_status_connected')}</span></span>`;

                let localizedError = effectiveError;
                if (effectiveError && (effectiveError.includes('Erreur lors de la synchronisation') || effectiveError.includes('Erreur de synchronisation'))) {
                    localizedError = window.i18n.t('bank_sync_error_default');
                }
                const displayError = isError ? (localizedError || window.i18n.t('bank_sync_error_default')) : null;

                const cachedPreview = this.getCachedPreview(conn.id);
                const cachedBtn = cachedPreview ? `
                    <button class="btn btn-secondary" onclick="window.BankSyncView.openCachedPreviewDirectly(${conn.id})" style="padding: 0 10px; border-radius: 8px; font-size: 12px; height: 32px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;" title="${window.i18n.t('bank_sync_cached_preview_tooltip')}">
                        <span>📋</span> <span data-i18n="bank_sync_cached_preview_btn">${window.i18n.t('bank_sync_cached_preview_btn')}</span>
                    </button>
                ` : '';

                return `
                <div class="bank-connection-item" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 14px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; gap: 16px; box-shadow: var(--shadow-sm); transition: border-color 0.2s ease;">
                    <div style="display: flex; align-items: center; gap: 14px; min-width: 0;">
                        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;">
                            🏦
                        </div>
                        <div style="min-width: 0;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-main); white-space: nowrap;">${conn.label}</h4>
                                ${statusBadge}
                            </div>
                            <div style="font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span style="background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; color: var(--text-main); font-weight: 600;">${conn.backend}</span>
                                <span>•</span>
                                <span>${lastSyncText}</span>
                                ${conn.last_sync_count ? `<span class="bank-sync-count-tag" style="background: rgba(16,185,129,0.12); color: #10b981; font-weight: 700; padding: 1px 8px; border-radius: 6px; font-size: 11px;">+${conn.last_sync_count} op.</span>` : ''}
                            </div>
                            ${displayError ? `
                                <div style="font-size: 11px; color: #ef4444; margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <span>⚠️ ${displayError}</span>
                                    <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.copyReportToClipboard('Erreur connexion bancaire: ${conn.backend || conn.id} - ${displayError.replace(/'/g, "\\'")}');" style="font-size: 10px; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="${window.i18n.t('diag_btn_copy_tooltip')}">
                                        📋 ${window.i18n.t('diag_btn_copy')}
                                    </button>
                                    <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.openGitHubIssue('Erreur connexion bancaire: ${conn.backend || conn.id}');" style="font-size: 10px; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="${window.i18n.t('diag_btn_issue_tooltip')}">
                                        🐙 ${window.i18n.t('diag_btn_issue')}
                                    </button>
                                    <button class="btn btn-secondary" onclick="if(window.app && window.app.navigateToDiagnostics) { window.app.navigateToDiagnostics(); } else if(window.app && window.app.loadView) { window.app.loadView('config'); }" style="font-size: 10px; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="${window.i18n.t('diag_btn_diag_tooltip')}">
                                        ⚙️ ${window.i18n.t('diag_btn_diag')}
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                        ${cachedBtn}
                        <button class="btn btn-primary" onclick="window.BankSyncView.promptAndSync(${conn.id})" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; padding: 0 14px; border-radius: 8px; font-size: 12px; height: 32px; box-sizing: border-box;" title="${window.i18n.t('bank_sync_sync_btn_tooltip')}">
                            <span>🔄</span> <span data-i18n="bank_sync_sync_btn">${window.i18n.t('bank_sync_sync_btn')}</span>
                        </button>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.openMappingModal(${conn.id})" style="padding: 0 12px; border-radius: 8px; font-size: 12px; height: 32px; display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box; font-weight: 600;" title="${window.i18n.t('bank_sync_edit_mapping_btn')}">
                            <span>🔗</span> <span data-i18n="bank_sync_mapping_btn">${window.i18n.t('bank_sync_mapping_btn')}</span>
                        </button>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.deleteConnection(${conn.id})" style="padding: 0 10px; border-radius: 8px; color: #ef4444; height: 32px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;" title="${window.i18n.t('bank_sync_delete_btn')}">
                            🗑️
                        </button>
                    </div>
                </div>
                `;
            }).join('')}
        </div>
        `;
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
        const q = query || '';
        const filtered = this.backends.filter(b => 
            window.permissiveMatch([b.name, b.description, b.uuid, b.id], q)
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

        // Configuration dynamique du step 3 mot de passe maître
        const isUnlocked = this.vaultStatus?.is_unlocked;
        const hasConnections = this.connections && this.connections.length > 0;
        const masterPwContainer = document.getElementById('masterPwSection');
        
        if (masterPwContainer) {
            if (isUnlocked) {
                masterPwContainer.innerHTML = `
                    <div style="padding: 12px 14px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); border-radius: 10px; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 22px;">🔓</span>
                        <div style="font-size: 12px; color: var(--text-main); line-height: 1.4;">
                            <strong style="color: #10b981;" data-i18n="bank_vault_unlocked_status">${window.i18n.t('bank_vault_unlocked_status') || 'Coffre-fort déverrouillé'}</strong><br/>
                            <span style="color: var(--text-muted);" data-i18n="bank_sync_security_unlocked_desc">${window.i18n.t('bank_sync_security_unlocked_desc') || 'Vos identifiants seront automatiquement chiffrés avec votre mot de passe maître de coffre-fort.'}</span>
                        </div>
                    </div>
                    <input type="password" id="connMasterPwInput" style="display: none;" />
                `;
            } else if (hasConnections) {
                masterPwContainer.innerHTML = `
                    <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;" data-i18n="bank_sync_master_pw_title">
                        ${window.i18n.t('bank_sync_master_pw_title')}
                    </label>
                    <p style="font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
                        ${window.i18n.t('bank_sync_enter_master_pw')}
                    </p>
                    <input type="password" id="connMasterPwInput" class="input-styled" placeholder="${window.i18n.t('bank_sync_master_pw_field')}" autocomplete="current-password" />
                `;
            } else {
                masterPwContainer.innerHTML = `
                    <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;" data-i18n="bank_sync_master_pw_title">
                        ${window.i18n.t('bank_sync_master_pw_title')}
                    </label>
                    <p style="font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;" data-i18n="bank_sync_master_pw_desc">
                        ${window.i18n.t('bank_sync_master_pw_desc')}
                    </p>
                    <input type="password" id="connMasterPwInput" class="input-styled" placeholder="${window.i18n.t('bank_sync_master_pw_field')}" autocomplete="new-password" />
                `;
            }
        }

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
        const masterPw = document.getElementById('connMasterPwInput')?.value;
        const isUnlocked = this.vaultStatus?.is_unlocked;
        const token = this.getVaultToken();
        const errDiv = document.getElementById('addBankErrorMsg');
        errDiv.style.display = 'none';

        if (!label) {
            errDiv.innerText = window.i18n ? window.i18n.t('bank_sync_conn_name_required') : 'Veuillez saisir un nom pour cette connexion.';
            errDiv.style.display = 'block';
            return;
        }
        if (!masterPw && !isUnlocked) {
            errDiv.innerText = window.i18n ? window.i18n.t('bank_sync_master_pw_required') : 'Veuillez saisir le mot de passe maître pour chiffrer vos identifiants.';
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
        btn.innerText = window.i18n ? window.i18n.t('bank_sync_save_btn') || 'Chiffrement & Sauvegarde...' : 'Chiffrement & Sauvegarde...';

        try {
            const payload = {
                backend: this.selectedBackend.name,
                label: label,
                master_password: masterPw || null,
                vault_token: token || null,
                credentials: credentials
            };
            const newConn = await API.post('/api/bank-sync/connections', payload);
            
            // Stocker automatiquement le mot de passe maître en session si saisi
            if (masterPw) {
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
            }

            this.clearCachedRemoteAccounts(newConn);
            this.closeAddModal();
            await this.loadConnections();
            this.showToast(window.i18n ? window.i18n.t('bank_sync_toast_conn_saved') : 'Connexion bancaire ajoutée et chiffrée avec succès !', 'success');

            // Ouvrir directement la modale de mapping avec rafraîchissement obligatoire
            setTimeout(() => this.openMappingModal(newConn.id, true), 400);

        } catch (err) {
            const rawMsg = err.detail || err.message || 'Erreur lors de la création de la connexion.';
            errDiv.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                    <span style="font-weight: 700; color: #ef4444;">⚠️ Erreur :</span>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.closeAddModal(); if(window.app && window.app.navigateToDiagnostics) { window.app.navigateToDiagnostics(); } else if(window.app && window.app.loadView) { window.app.loadView('config'); }" style="font-size: 11px; padding: 2px 8px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px; color: var(--text-main); border: 1px solid var(--border-color); background: var(--bg-surface); cursor: pointer;">
                        ⚙️ Configuration & Diagnostics
                    </button>
                </div>
                <div style="margin-bottom: 8px; line-height: 1.4; color: var(--text-main); font-size: 12.5px;">${rawMsg}</div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding-top: 6px; border-top: 1px dashed rgba(239,68,68,0.2);">
                    <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.copyReportToClipboard('Erreur création connexion: ${this.selectedBackend?.name || ''} - ${rawMsg.replace(/'/g, "\\'")}');" style="font-size: 11px; padding: 3px 8px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;">
                        📋 Copier le rapport
                    </button>
                    <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.openGitHubIssue('Erreur création connexion: ${this.selectedBackend?.name || ''}');" style="font-size: 11px; padding: 3px 8px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;">
                        🐙 Créer une Issue GitHub
                    </button>
                </div>
            `;
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

        // 1. Vérifier si les comptes distants sont déjà en cache pour cette connexion exacte
        const cachedAccounts = forceRefresh ? null : this.getCachedRemoteAccounts(conn);
        if (cachedAccounts && cachedAccounts.length > 0 && !forceRefresh) {
            this.currentConnection = conn;
            this.currentRemoteAccounts = cachedAccounts;
            this.renderMappingRows(conn, cachedAccounts);
            return;
        }

        container.innerHTML = `
            <div style="text-align: center; padding: 30px 20px; color: var(--text-muted);">
                <div style="font-size: 28px; margin-bottom: 10px; animation: spin-reverse 1.5s linear infinite; display: inline-block;">🔄</div>
                <div id="mappingModalLoadingText" style="font-size: 13px; font-weight: 600; color: var(--text-main);">
                    Connexion sécurisée à votre banque...
                </div>
                <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 6px;">
                    Récupération de la liste de vos comptes distants
                </div>
            </div>
        `;

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

        // Fermer un éventuel flux précédent
        if (this.mappingEventSource) {
            this.mappingEventSource.close();
            this.mappingEventSource = null;
        }

        const queryParams = new URLSearchParams();
        if (token) {
            queryParams.set("vault_token", token);
        }

        const sseUrl = `/api/bank-sync/connections/${connId}/test-stream?${queryParams.toString()}`;
        const es = new EventSource(sseUrl);
        this.mappingEventSource = es;

        es.addEventListener('progress', (e) => {
            try {
                const d = JSON.parse(e.data);
                const txt = document.getElementById('mappingModalLoadingText');
                if (txt && d.message) txt.innerText = d.message;
            } catch (_) {}
        });

        es.addEventListener('2fa_required', (e) => {
            try {
                const d = JSON.parse(e.data);
                this.activeSessionId = d.session_id;
                this.show2FAModal(d.type, d.message);
            } catch (_) {}
        });

        es.addEventListener('accounts', (e) => {
            try {
                const d = JSON.parse(e.data);
                es.close();
                this.mappingEventSource = null;
                const twoFAModal = document.getElementById('twoFAModal');
                if (twoFAModal) twoFAModal.style.display = 'none';
                this.currentConnection = conn;
                this.currentRemoteAccounts = d.accounts || [];
                this.saveCachedRemoteAccounts(conn, this.currentRemoteAccounts);
                this.renderMappingRows(conn, this.currentRemoteAccounts);
                this.loadConnections();
            } catch (err) {
                console.error('Erreur traitement comptes SSE:', err);
            }
        });

        es.addEventListener('error', (e) => {
            let errorMsg = 'Erreur lors de la communication avec la banque.';
            const twoFAModal = document.getElementById('twoFAModal');
            if (twoFAModal) twoFAModal.style.display = 'none';
            try {
                if (e.data) {
                    const d = JSON.parse(e.data);
                    if (d.message) errorMsg = d.message;
                }
            } catch (_) {}
            es.close();
            this.mappingEventSource = null;

            if (cachedAccounts && cachedAccounts.length > 0) {
                this.currentConnection = conn;
                this.currentRemoteAccounts = cachedAccounts;
                this.renderMappingRows(conn, cachedAccounts);
                this.showToast('Actualisation échouée, affichage des comptes en cache : ' + errorMsg, 'info');
                return;
            }

            container.innerHTML = `
                <div style="padding: 16px 18px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); border-radius: 12px; font-size: 13px; margin: 10px 0;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
                        <div style="font-weight: 700; color: #ef4444; display: flex; align-items: center; gap: 6px;">
                            <span>⚠️</span> <span>${window.i18n.t('bank_sync_cannot_fetch_remote')}</span>
                        </div>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.closeMappingModal(); if(window.app && window.app.navigateToDiagnostics) { window.app.navigateToDiagnostics(); } else if(window.app && window.app.loadView) { window.app.loadView('config'); }" style="font-size: 11.5px; padding: 4px 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px; color: var(--text-main); border: 1px solid var(--border-color); background: var(--bg-surface); cursor: pointer;" title="${window.i18n.t('bank_sync_btn_config_diag')}">
                            ⚙️ ${window.i18n.t('bank_sync_btn_config_diag')}
                        </button>
                    </div>
                    <div style="color: var(--text-main); font-size: 12.5px; line-height: 1.4; margin-bottom: 14px;">
                        ${errorMsg}
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding-top: 10px; border-top: 1px dashed rgba(239,68,68,0.2);">
                        <button class="btn btn-primary" onclick="window.BankSyncView.openMappingModal(${connId}, true)" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 600;">
                            🔄 ${window.i18n.t('bank_sync_btn_retry')}
                        </button>
                        <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.copyReportToClipboard('Erreur synchro bancaire: ${conn.backend || connId} - ${errorMsg.replace(/'/g, "\\'")}');" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;" title="${window.i18n.t('bank_sync_btn_copy_report')}">
                            📋 ${window.i18n.t('bank_sync_btn_copy_report')}
                        </button>
                        <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.openGitHubIssue('Erreur synchro bancaire: ${conn.backend || connId}');" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;" title="${window.i18n.t('bank_sync_btn_github_issue')}">
                            🐙 ${window.i18n.t('bank_sync_btn_github_issue')}
                        </button>
                    </div>
                </div>
            `;
        });
    },

    closeMappingModal() {
        if (this.mappingEventSource) {
            this.mappingEventSource.close();
            this.mappingEventSource = null;
        }
        document.getElementById('mappingModal').style.display = 'none';
    },

    renderMappingRows(connection, remoteAccounts) {
        const container = document.getElementById('mappingRowsContainer');
        if (!container) return;

        if (remoteAccounts.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);" data-i18n="bank_sync_no_remote_accounts">${window.i18n.t('bank_sync_no_remote_accounts') || 'Aucun compte trouvé sur votre banque.'}</div>`;
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

        const doNotSyncText = window.i18n ? window.i18n.t('bank_sync_do_not_sync') || 'Ne pas synchroniser' : 'Ne pas synchroniser';
        const localAccOptions = `<option value="">-- ${doNotSyncText} --</option>` + 
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

        const lblType = window.i18n ? window.i18n.t('bank_sync_lbl_type') || 'Type' : 'Type';
        const lblNumber = window.i18n ? window.i18n.t('bank_sync_lbl_number') || 'N°' : 'N°';
        const lblBalance = window.i18n ? window.i18n.t('bank_sync_lbl_balance') || 'Solde' : 'Solde';
        const lblLinkedTo = window.i18n ? window.i18n.t('bank_sync_lbl_linked_to') || 'Lié à :' : 'Lié à :';
        const btnCreateTitle = window.i18n ? window.i18n.t('bank_sync_btn_create_account_tooltip') || 'Personnaliser et créer ce compte dans OmniBank' : 'Personnaliser et créer ce compte dans OmniBank';
        const btnCreateText = window.i18n ? window.i18n.t('bank_sync_btn_create_account') || 'Créer dans OmniBank' : 'Créer dans OmniBank';

        container.innerHTML = remoteAccounts.map(r => {
            const mappedLocalId = currentMapping[r.id] || '';
            const balStr = `${r.balance >= 0 ? '+' : ''}${r.balance.toFixed(2)} ${r.currency || '€'}`;
            const balColor = r.balance < 0 ? '#ef4444' : '#10b981';
            const detectedType = detectType(r);

            return `
            <div class="mapping-card-item" style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">
                <div class="mapping-card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div class="mapping-account-info">
                        <div style="font-weight: 700; font-size: 14px; color: var(--text-main);">${r.label}</div>
                        <div style="font-size: 12px; color: var(--text-muted); display: flex; gap: 10px; margin-top: 2px; flex-wrap: wrap;">
                            <span>${lblType}: <strong>${r.type}</strong></span>
                            <span>${lblNumber}: <strong>${r.id}</strong></span>
                            <span>${lblBalance}: <strong style="color: ${balColor};">${balStr}</strong></span>
                        </div>
                    </div>

                    <div class="mapping-card-controls" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span class="mapping-linked-label" style="font-size: 12px; color: var(--text-muted); font-weight: 600;">${lblLinkedTo}</span>
                        <select class="input-styled mapping-select" data-remote-id="${r.id}" style="min-width: 200px; padding: 6px 10px;">
                            ${localAccOptions}
                        </select>
                        <button class="btn btn-secondary mapping-create-btn" onclick="window.BankSyncView.toggleQuickCreateForm('${r.id}')" style="font-size: 11px; padding: 6px 10px; border-radius: 8px; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" title="${btnCreateTitle}">
                            <span>➕</span> <span>${btnCreateText}</span>
                        </button>
                    </div>
                </div>

                <!-- Mini-formulaire in-line de création personnalisée -->
                <div id="qcBox_${r.id}" class="mapping-quick-create-box" style="display: none; padding: 12px 14px; background: var(--bg-card); border: 1px dashed var(--accent-border, var(--border-color)); border-radius: 10px; margin-top: 4px;">
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
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            <button class="btn btn-primary" onclick="window.BankSyncView.submitQuickCreate('${r.id}', '${r.currency || 'EUR'}')" style="height: 32px; padding: 0 12px; font-size: 11px; font-weight: 700; white-space: nowrap; border-radius: 6px;">
                                <span data-i18n="bank_sync_custom_create_submit">${window.i18n.t('bank_sync_custom_create_submit')}</span>
                            </button>
                            <button class="btn btn-secondary" onclick="window.BankSyncView.toggleQuickCreateForm('${r.id}')" style="height: 32px; padding: 0 10px; font-size: 11px; white-space: nowrap; border-radius: 6px;">
                                <span data-i18n="bank_sync_custom_create_cancel">${window.i18n.t('bank_sync_custom_create_cancel')}</span>
                            </button>
                        </div>
                    </div>
                    <div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 6px; line-height: 1.3;" data-i18n="bank_sync_custom_create_bal_hint">
                        💡 ${window.i18n.t('bank_sync_custom_create_bal_hint')}
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
    async deleteConnection(connId) {
        const title = window.i18n ? window.i18n.t('bank_sync_delete_title') : 'Supprimer la connexion';
        const msg = window.i18n ? window.i18n.t('bank_sync_delete_confirm_msg') : 'Voulez-vous vraiment supprimer cette connexion bancaire et ses identifiants chiffrés ?';
        const confirmed = await this.confirmAction(title, msg);
        if (!confirmed) return;

        try {
            await API.del(`/api/bank-sync/connections/${connId}`);
            this.clearCachedRemoteAccounts(connId);
            await this.loadConnections();
            this.showToast(window.i18n ? (window.i18n.t('bank_sync_delete_success') || 'Connexion bancaire supprimée.') : 'Connexion bancaire supprimée.', 'info');
        } catch (err) {
            this.showToast('Erreur suppression : ' + (err.detail || err.message), 'error');
        }
    }

});
