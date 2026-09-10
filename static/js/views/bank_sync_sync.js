// static/js/views/bank_sync_sync.js — Synchronisation SSE & 2FA
// Enrichit window.BankSyncView via Object.assign()

Object.assign(window.BankSyncView, {

    _syncState: 'idle',
    _syncStateHtml: null,
    _syncPollingTimer: null,

    setButtonsState(state, customHtml = null) {
        this._syncState = state;
        this._syncStateHtml = customHtml;
        this.applySyncButtonsState();
    },

    applySyncButtonsState() {
        const state = this._syncState || 'idle';
        const customHtml = this._syncStateHtml;
        const syncButtons = document.querySelectorAll('.overview-bank-sync-btn, #btnTriggerAutoSync, #btnTimelineBgSync, #btnHeaderBgSync, #btnHistoryBgSync');
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
                btn.innerHTML = `<span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n ? window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne' : 'Relever en ligne'}</span>`;
            }
        });
    },

    async checkBackgroundSyncStatus() {
        try {
            const statusRes = await API.get('/api/bank-sync/status');
            const isRunning = Boolean(statusRes && statusRes.is_running);
            
            if (isRunning) {
                if (this._syncState !== 'syncing') {
                    this.setButtonsState('syncing');
                    this._startSyncPollingTracker();
                }
            } else if (this._syncState === 'syncing') {
                this._stopSyncPollingTracker();
                let hasError = false;
                let conn2FA = null;
                try {
                    const connsRes = await API.get('/api/bank-sync/connections');
                    if (Array.isArray(connsRes)) {
                        this.connections = connsRes;
                        conn2FA = connsRes.find(c => c.is_active && (c.last_sync_status === '2fa_required' || (c.last_error && c.last_error.toLowerCase().includes('2fa'))));
                        hasError = connsRes.some(c => c.is_active && (c.last_sync_status === 'auto_error' || c.last_sync_status === 'error'));
                    }
                } catch (_) {}

                if (conn2FA) {
                    this.setButtonsState('idle');
                    // Déclenchement automatique et direct de la modale 2FA pour cette banque
                    await this.promptAndSync(conn2FA.id);
                } else {
                    this.setButtonsState(hasError ? 'error' : 'success');
                    setTimeout(() => this.setButtonsState('idle'), 3500);
                }
                Promise.all([
                    (window.app && typeof window.app.loadNotifications === 'function') ? window.app.loadNotifications() : Promise.resolve(),
                    this.refreshActiveViews(),
                    (this.connections && this.connections.length > 0) ? this.loadConnections() : Promise.resolve()
                ]);
            }
        } catch (_) {}
    },

    _startSyncPollingTracker() {
        if (this._syncPollingTimer) return;
        const poll = async () => {
            try {
                const statusRes = await API.get('/api/bank-sync/status');
                const isRunning = Boolean(statusRes && statusRes.is_running);
                if (!isRunning) {
                    this._stopSyncPollingTracker();
                    let hasError = false;
                    let conn2FA = null;
                    try {
                        const connsRes = await API.get('/api/bank-sync/connections');
                        if (Array.isArray(connsRes)) {
                            this.connections = connsRes;
                            conn2FA = connsRes.find(c => c.is_active && (c.last_sync_status === '2fa_required' || (c.last_error && c.last_error.toLowerCase().includes('2fa'))));
                            hasError = connsRes.some(c => c.is_active && (c.last_sync_status === 'auto_error' || c.last_sync_status === 'error'));
                        }
                    } catch (_) {}

                    if (conn2FA) {
                        this.setButtonsState('idle');
                        // Déclenchement automatique et direct de la modale 2FA pour cette banque
                        await this.promptAndSync(conn2FA.id);
                    } else {
                        this.setButtonsState(hasError ? 'error' : 'success');
                        setTimeout(() => this.setButtonsState('idle'), 3500);
                    }

                    if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                        window.app.setFastNotificationsPolling(false);
                    }
                    Promise.all([
                        (window.app && typeof window.app.loadNotifications === 'function') ? window.app.loadNotifications() : Promise.resolve(),
                        this.refreshActiveViews(),
                        (this.connections && this.connections.length > 0) ? this.loadConnections() : Promise.resolve()
                    ]);
                    return;
                }
            } catch (e) {
                console.warn('[BankSync] Erreur polling statut sync:', e);
            }
            this._syncPollingTimer = setTimeout(poll, 2500);
        };
        this._syncPollingTimer = setTimeout(poll, 2500);
    },

    _stopSyncPollingTracker() {
        if (this._syncPollingTimer) {
            clearTimeout(this._syncPollingTimer);
            this._syncPollingTimer = null;
        }
    },

    async triggerBackgroundSyncNow() {
        this.ensureModalsExist();

        if (!this.vaultStatus || this.vaultStatus.remaining_seconds === undefined) {
            await this.loadVaultStatus();
        }

        let token = this.getVaultToken();
        let pw = null;

        // Si le coffre n'est pas déverrouillé, demander le mot de passe maître
        if (!token || !this.vaultStatus?.is_unlocked) {
            pw = await this.promptMasterPassword(
                window.i18n ? window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne' : 'Relever en ligne',
                window.i18n ? window.i18n.t('bank_sync_vault_prompt_msg') || 'Entrez votre mot de passe maître pour autoriser le relevé en tâche de fond :' : 'Entrez votre mot de passe maître pour autoriser le relevé en tâche de fond :'
            );

            if (!pw) {
                this.setButtonsState('idle');
                return;
            }
            token = this.getVaultToken();

            // Si le déverrouillage réactif vient déjà de lancer la synchronisation en tâche de fond,
            // ne pas déclencher un second relevé concurrent identique :
            if (this.vaultStatus?.reactive_sync?.ok && !this.vaultStatus.reactive_sync.skipped_passive_mode && !this.vaultStatus.reactive_sync.cooldown_active) {
                this.setButtonsState('syncing');
                if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                    window.app.setFastNotificationsPolling(true);
                }
                this._startSyncPollingTracker();
                return;
            }
        }

        // Vérification préalable : si une connexion active est déjà en attente d'un 2FA smartphone
        try {
            if (!this.connections || this.connections.length === 0) {
                this.connections = await API.get('/api/bank-sync/connections');
            }
        } catch (_) {}
        const pending2FAConn = Array.isArray(this.connections)
            ? this.connections.find(c => c.is_active && (c.last_sync_status === '2fa_required' || (c.last_error && c.last_error.toLowerCase().includes('2fa'))))
            : null;

        if (pending2FAConn) {
            this.setButtonsState('idle');
            await this.promptAndSync(pending2FAConn.id);
            return;
        }

        // Lancer l'animation de progression sur le fond du bouton
        this.setButtonsState('syncing');

        const payload = {
            force: true,
            trigger_source: 'manual'
        };
        if (token) payload.vault_token = token;
        if (pw && pw !== "__USE_VAULT_TOKEN__") payload.master_password = pw;

        try {
            const res = await API.post('/api/bank-sync/trigger-auto-sync', payload);
            if (res && res.cooldown_active) {
                this.setButtonsState('idle');
                this.showToast(res.message || 'Relevé ignoré : délai de sécurité actif.', 'info');
                return;
            }
            this.showToast(window.i18n ? window.i18n.t('bank_sync_run_background_toast') || 'Relevé lancé en arrière-plan.' : 'Relevé lancé en arrière-plan.', 'success');

            if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                window.app.setFastNotificationsPolling(true);
            }

            // Démarrer le suivi intelligent du relevé
            this._startSyncPollingTracker();
        } catch (err) {
            console.error('[BankSync] Erreur trigger-auto-sync:', err);
            this._stopSyncPollingTracker();
            if (err.status === 401 || (err.detail && err.detail.includes('verrouill'))) {
                this.clearVaultToken();
                this.vaultStatus = { is_unlocked: false, remaining_days: 0 };
                this.renderVaultStatusBar();
                this.setButtonsState('idle');
                this.showToast(err.detail || (window.i18n ? window.i18n.t('bank_sync_toast_session_expired') : 'Session expirée. Veuillez ressaisir votre mot de passe maître.'), 'info');
                const retryPw = await this.promptMasterPassword(
                    window.i18n ? window.i18n.t('bank_sync_run_background_btn') : 'Relevé en arrière-plan',
                    window.i18n ? window.i18n.t('bank_sync_vault_prompt_msg') : 'Veuillez déverrouiller le coffre avec votre mot de passe maître :'
                );
                if (retryPw) {
                    return this.triggerBackgroundSyncNow();
                }
                return;
            }
            this.setButtonsState('error', err.detail || err.message);
            setTimeout(() => this.setButtonsState('idle'), 3500);
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── GESTION DES OPÉRATIONS EN ATTENTE (PENDING / SAS) ────────────
    async openCachedPreviewDirectly(connId) {
        // Toujours interroger en priorité le sas unifié du serveur (/api/bank-sync/pending)
        try {
            const data = await API.get('/api/bank-sync/pending');
            if (data && data.accounts && data.accounts.length > 0) {
                const connAccounts = data.accounts.filter(a => a.connection_id === connId);
                if (connAccounts.length > 0) {
                    const preview = {
                        connection_id: connId,
                        accounts: connAccounts
                    };
                    this.saveCachedPreview(connId, preview);
                    await this.openReviewModal(connId, preview);
                    return;
                }
            }
        } catch (_) {}

        const cached = this.getCachedPreview(connId);
        if (cached && cached.data) {
            await this.openReviewModal(connId, cached.data);
            return;
        }

        this.showToast('Aucun aperçu récent disponible pour cette connexion.', 'info');
    },

    async promptAndSync(connId) {
        this.ensureModalsExist();
        this.activeConnId = connId;

        if (!this.connections || this.connections.length === 0) {
            try {
                this.connections = await API.get('/api/bank-sync/connections');
            } catch (_) {}
        }
        const conn = Array.isArray(this.connections) ? this.connections.find(c => c.id === connId) : null;
        const cached = this.getCachedPreview(connId);

        let lastTime = 0;
        if (cached && cached.timestamp) {
            lastTime = cached.timestamp;
        } else if (conn && conn.last_sync_at) {
            lastTime = new Date(conn.last_sync_at).getTime();
        }

        const elapsedMs = Date.now() - lastTime;
        const is2FA = conn && (conn.last_sync_status === '2fa_required' || (conn.last_error && conn.last_error.toLowerCase().includes('2fa')));

        // Si la dernière synchronisation a eu lieu il y a moins de 5 minutes (sauf si un 2FA est expressément requis) :
        if (!is2FA && lastTime > 0 && elapsedMs < this.COOLDOWN_MS) {
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

    async reopenCachedPreview() {
        this.closeCooldownModal();
        if (this.activeConnId) {
            const cached = this.getCachedPreview(this.activeConnId);
            if (cached && cached.data) {
                await this.openReviewModal(this.activeConnId, cached.data);
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
                window.i18n ? window.i18n.t('bank_sync_modal_title') : 'Synchronisation bancaire',
                window.i18n ? window.i18n.t('bank_sync_master_pw_modal_msg') : 'Entrez votre mot de passe maître pour synchroniser vos comptes :'
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
        if (vaultToken) url += `&vault_token=${encodeURIComponent(vaultToken)}`;

        const es = new EventSource(url);
        this.eventSource = es;

        es.addEventListener('progress', (e) => {
            const data = JSON.parse(e.data);
            progressMsg.innerText = data.message || 'Synchronisation...';
            if (data.step === 'auth') progressBar.style.width = '45%';
            if (data.step === '2fa_checking') progressBar.style.width = '60%';
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
            const twoFAModal = document.getElementById('twoFAModal');
            if (twoFAModal) twoFAModal.style.display = 'none';
            setTimeout(() => {
                progressModal.style.display = 'none';
                this.openReviewModal(connId, previewData);
                this.loadConnections();
            }, 500);
        });

        es.addEventListener('done', (e) => {
            const data = JSON.parse(e.data);
            progressBar.style.width = '100%';
            es.close();
            this.eventSource = null;
            const twoFAModal = document.getElementById('twoFAModal');
            if (twoFAModal) twoFAModal.style.display = 'none';
            setTimeout(() => {
                progressModal.style.display = 'none';
                if (data.accounts) {
                    this.saveCachedPreview(connId, data);
                    this.openReviewModal(connId, data);
                    this.loadConnections();
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
            const twoFAModal = document.getElementById('twoFAModal');
            if (twoFAModal) twoFAModal.style.display = 'none';
            this.showToast('Échec de la synchronisation : ' + msg, 'error');
            this.loadConnections();
        });
    },

    // ── REVUE DES OPÉRATIONS (STYLE IMPORT CSV & IA CONDITIONNELLE) ──
    show2FAModal(type, message) {
        const progressModal = document.getElementById('syncProgressModal');
        if (progressModal) progressModal.style.display = 'none';

        const modal = document.getElementById('twoFAModal');
        const icon = document.getElementById('twoFAIcon');
        const title = document.getElementById('twoFATitle');
        const msg = document.getElementById('twoFAMessage');
        const autoBanner = document.getElementById('twoFAAutoDetectBanner');
        const otpContainer = document.getElementById('twoFAOtpInputContainer');
        const confirmBtn = document.getElementById('twoFAConfirmBtn');

        modal.style.display = 'flex';
        msg.innerText = message || '';

        if (type === 'app_validation') {
            icon.innerText = '📱';
            title.innerText = window.i18n.t('bank_sync_2fa_app_title');
            if (autoBanner) autoBanner.style.display = 'flex';
            otpContainer.style.display = 'none';
            confirmBtn.innerText = window.i18n.t('bank_sync_2fa_app_confirm_btn');
            confirmBtn.disabled = false;
        } else {
            icon.innerText = '🔑';
            title.innerText = window.i18n.t('bank_sync_2fa_otp_title');
            if (autoBanner) autoBanner.style.display = 'none';
            otpContainer.style.display = 'block';
            document.getElementById('twoFAOtpInput').value = '';
            confirmBtn.innerText = window.i18n.t('bank_sync_2fa_send_btn');
            confirmBtn.disabled = false;
        }
    },

    async submit2FA() {
        if (!this.activeSessionId) return;

        const otpInput = document.getElementById('twoFAOtpInput');
        const isOtp = document.getElementById('twoFAOtpInputContainer').style.display !== 'none';
        const value = isOtp ? otpInput.value.trim() : null;
        const confirmBtn = document.getElementById('twoFAConfirmBtn');

        if (!isOtp && confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = `<span class="spinner-small" style="width:14px;height:14px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin 0.8s linear infinite;margin-right:6px;vertical-align:middle;"></span> Vérification...`;
        }

        try {
            await API.post('/api/bank-sync/2fa/respond', {
                session_id: this.activeSessionId,
                response_type: isOtp ? 'otp_code' : 'app_validated',
                value: value
            });
            if (isOtp) {
                document.getElementById('twoFAModal').style.display = 'none';
            }
        } catch (err) {
            if (confirmBtn) confirmBtn.disabled = false;
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

});
