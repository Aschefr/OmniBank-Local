// static/js/views/bank_sync_sync.js — Synchronisation SSE & 2FA
// Enrichit window.BankSyncView via Object.assign()

Object.assign(window.BankSyncView, {

    _syncState: 'idle',
    _syncStateHtml: null,
    _syncPollingTimer: null,

    _syncProgressPct: 4,

    // Calcule le remplissage du bouton à partir de l'avancement réel renvoyé par /status :
    // connexions terminées + estimation douce (asymptotique) pour la connexion en cours.
    _updateSyncProgress(progress) {
        if (!progress || !progress.total) return;
        const within = 0.9 * (1 - Math.exp(-(progress.current_elapsed || 0) / 10));
        const pct = ((progress.done + within) / progress.total) * 100;
        this._syncProgressPct = Math.max(this._syncProgressPct, Math.min(97, Math.max(4, pct)));
        this._paintSyncProgress();
        const label = this._syncPhaseLabel(progress);
        if (label && this._syncState === 'syncing' && label !== this._syncStateHtml) this.setButtonsState('syncing', label);
    },

    // « Crédit Agricole · Livret A… » : ce que le relevé est en train de faire
    _syncPhaseLabel(progress) {
        if (!progress.current) return null;
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const phase = {
            connect: t('bank_sync_phase_connect', 'connexion…'),
            account: progress.account ? `${progress.account}…` : null,
            classify: t('bank_sync_phase_classify', 'classement…'),
        }[progress.phase];
        return phase ? `${esc(progress.current)} · ${esc(phase)}` : esc(progress.current);
    },

    _paintSyncProgress() {
        document.querySelectorAll('.overview-bank-sync-btn.is-syncing, #btnTriggerAutoSync.is-syncing, #btnTimelineBgSync.is-syncing, #btnHeaderBgSync.is-syncing, #btnHistoryBgSync.is-syncing')
            .forEach(btn => btn.style.setProperty('--sync-progress', this._syncProgressPct + '%'));
    },

    setButtonsState(state, customHtml = null) {
        if (state === 'syncing' && this._syncState !== 'syncing') this._syncProgressPct = 4;
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
                btn.style.setProperty('--sync-progress', this._syncProgressPct + '%');
                btn.innerHTML = `<span>⚡</span> <span>${customHtml || (window.i18n ? window.i18n.t('bank_sync_progress_loading') || 'Relevé en cours...' : 'Relevé en cours...')}</span>`;
            } else if (state === 'success') {
                btn.classList.add('is-success');
                btn.disabled = false;
                btn.innerHTML = `<span>✅</span> <span>${customHtml || (window.i18n ? window.i18n.t('bank_sync_progress_done') || 'Relevé terminé !' : 'Relevé terminé !')}</span>`;
            } else if (state === 'error') {
                btn.classList.add('is-error');
                btn.disabled = false;
                btn.innerHTML = `<span>⚠️</span> <span>${customHtml || (window.i18n ? window.i18n.t('bank_sync_progress_error') || 'Erreur relevé' : 'Erreur relevé')}</span>`;
            } else if (this._labelsRefining) {
                // Le relevé est fini et le bouton reste utilisable : seule l'analyse IA tourne encore
                btn.disabled = false;
                btn.innerHTML = `<span>✨</span> <span>${window.i18n ? window.i18n.t('bank_sync_refining') || 'Analyse IA des libellés…' : 'Analyse IA des libellés…'}</span>`;
            } else {
                btn.disabled = false;
                btn.innerHTML = `<span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n ? window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne' : 'Relever en ligne'}</span>`;
            }
        });
        this.updateSyncButtonsVisibility();
    },

    updateSyncButtonsVisibility() {
        const hasActiveConns = Array.isArray(this.connections) && this.connections.some(c => c.is_active);
        const syncButtons = document.querySelectorAll('.overview-bank-sync-btn, #btnTriggerAutoSync, #btnTimelineBgSync, #btnHeaderBgSync, #btnHistoryBgSync');
        syncButtons.forEach(btn => {
            btn.style.display = hasActiveConns ? '' : 'none';
        });
    },

    async ensureSyncButtonsVisibility(force = false) {
        if (this._connectionsPromise) {
            await this._connectionsPromise;
            this.updateSyncButtonsVisibility();
            return;
        }
        if (!this._connectionsLoaded || force) {
            this._connectionsPromise = (async () => {
                try {
                    const conns = await API.get('/api/bank-sync/connections', { silent: true });
                    this.connections = Array.isArray(conns) ? conns : [];
                    this._connectionsLoaded = true;
                } catch (_) {
                    this.connections = [];
                } finally {
                    this._connectionsPromise = null;
                }
            })();
            await this._connectionsPromise;
        }
        this.updateSyncButtonsVisibility();
    },

    async checkBackgroundSyncStatus() {
        try {
            const statusRes = await API.get('/api/bank-sync/status', { silent: true });
            const isRunning = Boolean(statusRes && statusRes.is_running);
            
            if (isRunning) {
                // Dans cet ordre : setButtonsState repart de 4 %, l'avancement réel (après un F5) passe ensuite
                if (this._syncState !== 'syncing') {
                    this.setButtonsState('syncing');
                    this._startSyncPollingTracker();
                }
                this._updateSyncProgress(statusRes.progress);
            } else if (this._syncState === 'syncing' && !this._syncFinishing) {
                await this._onSyncFinished();
            } else if (statusRes && statusRes.refining) {
                this._watchLabelRefinement();
            }
        } catch (_) {}
    },

    // L'IA complète les libellés après le relevé : le bouton le dit, puis la page reprend les opérations complétées
    _watchLabelRefinement() {
        if (this._labelsRefiningTimer) return;
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const poll = async () => {
            let statusRes = null;
            try {
                statusRes = await API.get('/api/bank-sync/status', { silent: true });
            } catch (_) {
                this._labelsRefiningTimer = setTimeout(poll, 4000);
                return;
            }
            if (statusRes && statusRes.refining) {
                if (!this._labelsRefining) {
                    this._labelsRefining = true;
                    this.applySyncButtonsState();
                }
                this._labelsRefiningTimer = setTimeout(poll, 2500);
                return;
            }
            this._labelsRefiningTimer = null;
            const wasRefining = this._labelsRefining;
            this._labelsRefining = false;
            this.applySyncButtonsState();
            const count = (statusRes && statusRes.refined_count) || 0;
            if (wasRefining && count > 0) {
                this.showToast((count > 1 ? t('bank_sync_refined_many', "{n} opérations complétées par l'IA") : t('bank_sync_refined_one', "1 opération complétée par l'IA")).replace('{n}', count), 'success');
                try {
                    await this.refreshActiveViews();
                } catch (_) {}
            }
        };
        this._labelsRefiningTimer = setTimeout(poll, 400);
    },

    // La barre va au bout pendant que les vues et les notifications se mettent à jour ; le bouton ne
    // passe à « terminé » qu'une fois les nouvelles données affichées. Un échec partiel reste un succès,
    // nommé comme tel : une banque mal configurée ne doit pas faire passer tout le relevé pour une erreur.
    async _onSyncFinished() {
        this._syncFinishing = true;
        this._stopSyncPollingTracker();
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        this._syncProgressPct = 100;
        this.setButtonsState('syncing', t('bank_sync_progress_processing', 'Mise à jour des données…'));
        const shownAt = Date.now();

        let conn2FA = null, active = 0, failed = 0;
        try {
            const connsRes = await API.get('/api/bank-sync/connections', { silent: true });
            if (Array.isArray(connsRes)) {
                this.connections = connsRes;
                const actives = connsRes.filter(c => c.is_active);
                active = actives.length;
                conn2FA = actives.find(c => c.last_sync_status === '2fa_required' || (c.last_error && c.last_error.toLowerCase().includes('2fa')));
                failed = actives.filter(c => c.last_sync_status === 'auto_error' || c.last_sync_status === 'error').length;
            }
        } catch (_) {}
        if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
            window.app.setFastNotificationsPolling(false);
        }

        try {
            await Promise.all([
                (window.app && typeof window.app.loadNotifications === 'function') ? window.app.loadNotifications(true) : Promise.resolve(),
                this.refreshActiveViews(),
                (this.connections && this.connections.length > 0) ? this.loadConnections() : Promise.resolve(),
            ]);
        } catch (_) {}
        window.dispatchEvent(new CustomEvent('bank_sync_completed'));
        window.dispatchEvent(new CustomEvent('autopilot_updated'));
        window.dispatchEvent(new CustomEvent('transactions_updated'));

        // Laisser à la barre le temps d'atteindre le bout avant de passer à l'état final
        const wait = 900 - (Date.now() - shownAt);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        this._syncFinishing = false;

        if (conn2FA) {
            this.setButtonsState('idle');
            await this.promptAndSync(conn2FA.id);
            return;
        }
        const allFailed = failed > 0 && failed >= active;
        const state = allFailed ? 'error' : 'success';
        const label = !allFailed && failed > 0
            ? (failed > 1
                ? t('bank_sync_progress_done_partial_many', 'Relevé terminé · {n} banques en échec').replace('{n}', failed)
                : t('bank_sync_progress_done_partial_one', 'Relevé terminé · 1 banque en échec'))
            : null;
        this.setButtonsState(state, label);
        setTimeout(() => { if (this._syncState === state) this.setButtonsState('idle'); }, 4500);
        this._watchLabelRefinement();
    },

    _startSyncPollingTracker() {
        if (this._syncPollingTimer) return;
        const poll = async () => {
            try {
                const statusRes = await API.get('/api/bank-sync/status', { silent: true });
                const isRunning = Boolean(statusRes && statusRes.is_running);
                if (isRunning) this._updateSyncProgress(statusRes.progress);
                if (!isRunning) {
                    if (!this._syncFinishing) await this._onSyncFinished();
                    return;
                }
            } catch (e) {
                console.warn('[BankSync] Erreur polling statut sync:', e);
            }
            this._syncPollingTimer = setTimeout(poll, 1200);
        };
        this._syncPollingTimer = setTimeout(poll, 1200);
    },

    _stopSyncPollingTracker() {
        if (this._syncPollingTimer) {
            clearTimeout(this._syncPollingTimer);
            this._syncPollingTimer = null;
        }
    },

    async triggerBackgroundSyncNow() {
        this.ensureModalsExist();

        // 0. Vérification préalable absolue : existence de connexions bancaires actives
        try {
            if (!this.connections || this.connections.length === 0) {
                this.connections = await API.get('/api/bank-sync/connections');
            }
        } catch (_) {}

        const activeConns = Array.isArray(this.connections) ? this.connections.filter(c => c.is_active) : [];
        if (activeConns.length === 0) {
            this.setButtonsState('idle');
            this.updateSyncButtonsVisibility();
            this.showToast(
                window.i18n ? window.i18n.t('bank_sync_no_connections') || 'Aucune connexion bancaire configurée pour ce profil.' : 'Aucune connexion bancaire configurée pour ce profil.',
                'warning'
            );
            return;
        }

        // 1. Vérifier l'état temps réel du coffre auprès du serveur
        await this.loadVaultStatus();

        let token = this.getVaultToken();
        const isClientUnlocked = Boolean(this.vaultStatus && this.vaultStatus.is_unlocked && token);
        let pw = null;

        // Si ce navigateur n'est pas déverrouillé/autorisé (coffre verrouillé OU session active sur le serveur sans jeton local)
        if (!isClientUnlocked) {
            pw = await this.promptMasterPassword(
                window.i18n ? window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne' : 'Relever en ligne',
                window.i18n ? window.i18n.t('bank_sync_vault_prompt_msg') || 'Entrez votre mot de passe maître pour autoriser le relevé en tâche de fond :' : 'Entrez votre mot de passe maître pour autoriser le relevé en tâche de fond :',
                { forSync: true, forcePrompt: true }
            );

            if (!pw) {
                this.setButtonsState('idle');
                return;
            }
            token = this.getVaultToken();
        }

        // Vérification préalable : si une connexion active est déjà en attente d'un 2FA smartphone
        const pending2FAConn = activeConns.find(c => c.is_active && (c.last_sync_status === '2fa_required' || (c.last_error && c.last_error.toLowerCase().includes('2fa'))));

        if (pending2FAConn) {
            this.setButtonsState('idle');
            await this.promptAndSync(pending2FAConn.id);
            return;
        }

        // Lancer l'animation de progression sur le fond du bouton
        this.setButtonsState('syncing');

        const currentToken = this.getVaultToken();
        const payload = {
            force: true,
            trigger_source: 'manual'
        };
        if (currentToken) payload.vault_token = currentToken;
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
            const is401 = err.status === 401 || (err.message && err.message.toLowerCase().includes('verrouill')) || (err.detail && err.detail.toLowerCase().includes('verrouill'));
            if (is401) {
                this.clearVaultToken();
                this.vaultStatus = { is_unlocked: false, server_unlocked: false, remaining_days: 0 };
                this.renderVaultStatusBar();
                this.setButtonsState('idle');
                this.showToast(err.detail || err.message || (window.i18n ? window.i18n.t('bank_sync_toast_session_expired') : 'Session expirée. Veuillez ressaisir votre mot de passe maître.'), 'info');
                const retryPw = await this.promptMasterPassword(
                    window.i18n ? window.i18n.t('bank_sync_run_background_btn') : 'Relevé en arrière-plan',
                    window.i18n ? window.i18n.t('bank_sync_vault_prompt_msg') : 'Veuillez déverrouiller le coffre avec votre mot de passe maître :',
                    { forSync: true, forcePrompt: true }
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
                window.i18n ? window.i18n.t('bank_sync_master_pw_modal_msg') : 'Entrez votre mot de passe maître pour synchroniser vos comptes :',
                { forSync: true } // ce relevé part juste après : pas un second en même temps
            );
        }
        if (!pw) return;

        this.activeConnId = connId;
        this.startSyncStream(connId, pw !== "__USE_VAULT_TOKEN__" ? pw : null);
    },

    startSyncStream(connId, masterPassword) {
        const progressModal = document.getElementById('syncProgressModal');
        const progressTitle = document.getElementById('syncProgressTitle');
        const progressMsg = document.getElementById('syncProgressMsg');
        const progressBar = document.getElementById('syncProgressBar');

        progressModal.style.display = 'flex';
        progressTitle.innerText = 'Connexion à la banque en cours...';
        progressMsg.innerText = 'Établissement du canal sécurisé...';
        progressBar.style.width = '25%';

        const url = `/api/bank-sync/connections/${connId}/sync-stream?since_days=90`;

        const es = new EventSource(window.API ? window.API.withSession(window.API.fullUrl(url)) : url);
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
            this.refreshActiveViews().then(() => {
                window.dispatchEvent(new CustomEvent('bank_sync_completed'));
            });
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
