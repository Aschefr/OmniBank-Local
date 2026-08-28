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
                this.setButtonsState('success');
                setTimeout(() => this.setButtonsState('idle'), 3000);
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
                    this.setButtonsState('success');
                    setTimeout(() => this.setButtonsState('idle'), 3000);
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
        }

        // Lancer l'animation de progression sur le fond du bouton
        this.setButtonsState('syncing');

        const payload = {};
        if (token) payload.vault_token = token;
        if (pw && pw !== "__USE_VAULT_TOKEN__") payload.master_password = pw;

        try {
            const res = await API.post('/api/bank-sync/trigger-auto-sync', payload);
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
                const connAccounts = data.accounts.filter(a => !a.connection_id || a.connection_id === connId);
                const accountsToUse = connAccounts.length > 0 ? connAccounts : data.accounts;
                const preview = {
                    connection_id: connId,
                    accounts: accountsToUse
                };
                this.saveCachedPreview(connId, preview);
                await this.openReviewModal(connId, preview);
                return;
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

});
