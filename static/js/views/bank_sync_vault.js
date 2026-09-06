// static/js/views/bank_sync_vault.js — Gestion du coffre-fort & relevé automatique
// Enrichit window.BankSyncView via Object.assign()

Object.assign(window.BankSyncView, {

    // ── GESTION DU TOKEN DE SESSION COFFRE (RAM TTL BACKEND) ────────
    getVaultToken() {
        if (window.ProfileStorage) {
            return window.ProfileStorage.get('vault_token') || null;
        }
        return null;
    },

    setVaultToken(token) {
        if (window.ProfileStorage) {
            if (token) {
                window.ProfileStorage.set('vault_token', token);
            } else {
                window.ProfileStorage.remove('vault_token');
            }
        }
        // Purger également toute clé globale résiduelle
        try { localStorage.removeItem('omnibank_vault_token'); } catch (_) {}
    },

    clearVaultToken() {
        if (window.ProfileStorage) {
            window.ProfileStorage.remove('vault_token');
        }
        try { localStorage.removeItem('omnibank_vault_token'); } catch (_) {}
    },

    // ── GESTION DU COFFRE & DÉVERROUILLAGE SÉCURISÉ ──────────────────
    formatVaultRemaining(sec) {
        if (!sec || sec <= 0) return '0s';
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        const dUnit = (window.i18n && window.i18n.lang === 'en') ? 'd' : 'j';
        if (d > 0) return `${d}${dUnit} ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    },

    startVaultCountdown() {
        this.stopVaultCountdown();
        if (!this.vaultStatus?.is_unlocked || !this.vaultStatus?.remaining_seconds) return;

        this._vaultCountdownInterval = setInterval(() => {
            if (!this.vaultStatus || !this.vaultStatus.is_unlocked) {
                this.stopVaultCountdown();
                return;
            }
            this.vaultStatus.remaining_seconds = Math.max(0, this.vaultStatus.remaining_seconds - 1);
            if (this.vaultStatus.remaining_seconds <= 0) {
                this.stopVaultCountdown();
                this.loadVaultStatus();
                return;
            }
            this.updateVaultCountdownDisplay();
        }, 1000);
    },

    stopVaultCountdown() {
        if (this._vaultCountdownInterval) {
            clearInterval(this._vaultCountdownInterval);
            this._vaultCountdownInterval = null;
        }
    },

    updateVaultCountdownDisplay() {
        const pillText = document.getElementById('bankSyncVaultPillText');
        const pillSpan = document.getElementById('bankSyncVaultPillBtn');
        if (!pillText || !this.vaultStatus?.is_unlocked) return;

        const timeStr = this.formatVaultRemaining(this.vaultStatus.remaining_seconds);
        const hasToken = !!this.getVaultToken();
        if (hasToken) {
            const unlockedLabel = window.i18n ? window.i18n.t('bank_sync_vault_unlocked') : 'Déverrouillé';
            pillText.textContent = `${unlockedLabel} (${timeStr})`;
            if (pillSpan) {
                const tooltipTpl = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_tooltip') : 'Coffre-fort déverrouillé en mémoire (reverrouillage automatique dans {time}). Cliquez pour verrouiller immédiatement.';
                pillSpan.title = tooltipTpl.replace('{time}', timeStr);
            }
        } else {
            const remoteLabel = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote') || 'Actif sur serveur' : 'Actif sur serveur';
            pillText.textContent = `${remoteLabel} (${timeStr})`;
            if (pillSpan) {
                const remoteTooltip = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote_tooltip') || 'Le coffre-fort est déverrouillé sur le serveur (relevés automatiques opérationnels). Cliquez pour autoriser ce navigateur avec votre mot de passe maître.' : 'Le coffre-fort est déverrouillé sur le serveur (relevés automatiques opérationnels). Cliquez pour autoriser ce navigateur avec votre mot de passe maître.';
                pillSpan.title = remoteTooltip;
            }
        }
    },

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
            this.vaultStatus = { is_unlocked: false, remaining_days: 0, remaining_seconds: 0 };
            this.renderVaultStatusBar();
        }
    },

    renderVaultStatusBar() {
        const pill = document.getElementById('bankSyncVaultPill');
        const autoSyncBox = document.getElementById('bankSyncAutoSyncCompact');
        const headerBtn = document.getElementById('btnHeaderBgSync');

        if (headerBtn) {
            headerBtn.style.display = this.connections && this.connections.length > 0 ? 'inline-flex' : 'none';
        }
        if (autoSyncBox) {
            autoSyncBox.style.display = this.connections && this.connections.length > 0 ? 'inline-flex' : 'none';
        }

        const isUnlocked = !!this.vaultStatus?.is_unlocked;
        const hasToken = !!this.getVaultToken();
        const isAutoSyncEnabled = !!this.autoSyncSettings?.enabled;
        const interval = this.autoSyncSettings?.interval_hours || 24;

        // ── 1. GESTION DU BADGE D'ÉTAT DU COFFRE ──
        if (pill) {
            if (!this.connections || this.connections.length === 0) {
                pill.innerHTML = '';
                pill.style.display = 'none';
                this.stopVaultCountdown();
            } else {
                pill.style.display = 'inline-flex';
                if (isUnlocked && hasToken) {
                    const timeStr = this.formatVaultRemaining(this.vaultStatus?.remaining_seconds || 0);
                    const unlockedLabel = window.i18n ? window.i18n.t('bank_sync_vault_unlocked') : 'Déverrouillé';
                    const tooltipTpl = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_tooltip') : 'Coffre-fort déverrouillé en mémoire (reverrouillage automatique dans {time}). Cliquez pour verrouiller immédiatement.';
                    const lockNowTooltip = window.i18n ? window.i18n.t('bank_sync_vault_lock_now_tooltip') : 'Verrouiller immédiatement';
                    pill.innerHTML = `
                        <span id="bankSyncVaultPillBtn" class="bank-sync-vault-pill" style="font-size: 11.5px; font-weight: 600; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); height: 26px; padding: 0 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; line-height: 1;" onclick="window.BankSyncView.lockVault()" title="${tooltipTpl.replace('{time}', timeStr)}">
                            <span>🔓</span> <span id="bankSyncVaultPillText">${unlockedLabel} (${timeStr})</span> <span style="font-size: 11px; opacity: 0.75;" title="${lockNowTooltip}">🔒</span>
                        </span>
                    `;
                    this.startVaultCountdown();
                } else if (isUnlocked && !hasToken) {
                    // Session active en RAM sur le serveur Docker, mais non encore authentifiée sur ce navigateur
                    const timeStr = this.formatVaultRemaining(this.vaultStatus?.remaining_seconds || 0);
                    const remoteLabel = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote') || 'Actif sur serveur' : 'Actif sur serveur';
                    const remoteAction = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote_action') || '(Autoriser ce poste)' : '(Autoriser ce poste)';
                    const remoteTooltip = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote_tooltip') || 'Le coffre-fort est déverrouillé sur le serveur (relevés automatiques opérationnels). Cliquez pour autoriser ce navigateur avec votre mot de passe maître.' : 'Le coffre-fort est déverrouillé sur le serveur (relevés automatiques opérationnels). Cliquez pour autoriser ce navigateur avec votre mot de passe maître.';
                    pill.innerHTML = `
                        <span id="bankSyncVaultPillBtn" class="bank-sync-vault-pill" style="font-size: 11.5px; font-weight: 600; background: rgba(99, 102, 241, 0.12); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.3); height: 26px; padding: 0 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; line-height: 1;" onclick="window.BankSyncView.unlockVaultManually()" title="${remoteTooltip}">
                            <span>🌐 🔓</span> <span id="bankSyncVaultPillText">${remoteLabel} (${timeStr})</span> <span style="font-size: 11px; text-decoration: underline; font-weight: 700;">${remoteAction}</span>
                        </span>
                    `;
                    this.startVaultCountdown();
                } else {
                    this.stopVaultCountdown();
                    const lockedLabel = window.i18n ? window.i18n.t('bank_sync_vault_locked') : 'Coffre verrouillé';
                    const unlockAction = window.i18n ? window.i18n.t('bank_sync_vault_unlock_action') : '(Déverrouiller)';
                    const lockedTooltip = window.i18n ? window.i18n.t('bank_sync_vault_locked_tooltip') : 'Coffre verrouillé. Cliquez pour déverrouiller avec votre mot de passe maître.';
                    pill.innerHTML = `
                        <span id="bankSyncVaultLockedPill" class="bank-sync-vault-pill" style="font-size: 11.5px; font-weight: 600; background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); height: 26px; padding: 0 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; line-height: 1;" onclick="window.BankSyncView.unlockVaultManually()" title="${lockedTooltip}">
                            <span>🔒</span> <span>${lockedLabel}</span> <span style="font-size: 11px; text-decoration: underline; font-weight: 700;">${unlockAction}</span>
                        </span>
                    `;
                }
            }
        }

        // ── 2. GESTION DU WIDGET RELEVÉ AUTO ──
        if (autoSyncBox) {
            const autoSyncLabel = window.i18n ? window.i18n.t('bank_sync_auto_sync_label') : 'Relevé auto';
            const autoSyncActive = window.i18n ? window.i18n.t('bank_sync_auto_sync_active') : 'Actif';
            const unlockBtnText = window.i18n ? window.i18n.t('bank_sync_auto_sync_unlock_btn') : 'Déverrouiller';

            if (isAutoSyncEnabled && !isUnlocked) {
                // ÉTAT ALERTE CRITIQUE : Relevé auto programmé mais Coffre verrouillé !
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-locked-warning';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: 36px;
                    align-items: center;
                    gap: 8px;
                    padding: 0 12px;
                    background: rgba(245, 158, 11, 0.12);
                    border: 1.5px dashed #f59e0b;
                    border-radius: 10px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #f59e0b;
                    box-sizing: border-box;
                    box-shadow: 0 0 12px rgba(245, 158, 11, 0.15);
                    transition: all 0.25s ease;
                `;
                autoSyncBox.title = window.i18n ? window.i18n.t('bank_sync_auto_sync_warning_tooltip') : "Le relevé automatique est programmé mais NE FONCTIONNE PAS car le coffre est verrouillé ! Cliquez pour déverrouiller.";
                autoSyncBox.innerHTML = `
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap;">
                        <input type="checkbox" id="chkAutoSyncToggle" checked onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: #f59e0b; width: 15px; height: 15px;">
                        <span style="display: inline-flex; align-items: center; gap: 4px;">
                            <span>⚠️</span> <strong style="color: #f59e0b;">${autoSyncLabel} :</strong>
                        </span>
                    </label>
                    <select id="selAutoSyncInterval" class="input-styled" style="height: 24px; font-size: 11px; padding: 0 6px; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 6px; background: rgba(0,0,0,0.25); color: #f59e0b; font-weight: 700; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        <option value="12" ${interval === 12 ? 'selected' : ''}>12h</option>
                        <option value="24" ${interval === 24 ? 'selected' : ''}>24h</option>
                        <option value="48" ${interval === 48 ? 'selected' : ''}>48h</option>
                    </select>
                    <button type="button" class="btn" onclick="window.BankSyncView.unlockVaultManually()" style="height: 24px; padding: 0 8px; font-size: 11px; font-weight: 700; background: #f59e0b; color: #1e1e2d; border-radius: 6px; border: none; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;" title="${window.i18n ? window.i18n.t('bank_sync_vault_locked_tooltip') : 'Déverrouiller le coffre pour autoriser les relevés automatiques'}">
                        <span>🔓</span> <span>${unlockBtnText}</span>
                    </button>
                `;
            } else if (isAutoSyncEnabled && isUnlocked) {
                // ÉTAT OPÉRATIONNEL : Coffre déverrouillé & Relevé auto actif
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-active';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: 36px;
                    align-items: center;
                    gap: 8px;
                    padding: 0 12px;
                    background: rgba(16, 185, 129, 0.08);
                    border: 1px solid rgba(16, 185, 129, 0.4);
                    border-radius: 10px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-main);
                    box-sizing: border-box;
                    transition: all 0.25s ease;
                `;
                const activeTooltipTpl = window.i18n ? window.i18n.t('bank_sync_auto_sync_active_tooltip') : `Relevé automatique programmé toutes les {interval}h (coffre déverrouillé).`;
                const pillTooltipTpl = window.i18n ? window.i18n.t('bank_sync_auto_sync_active_pill_tooltip') : `Le planificateur exécute un relevé toutes les {interval} heures.`;
                autoSyncBox.title = activeTooltipTpl.replace('{interval}', interval);
                autoSyncBox.innerHTML = `
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap;">
                        <input type="checkbox" id="chkAutoSyncToggle" checked onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: #10b981; width: 15px; height: 15px;">
                        <span>⏰ <strong style="color: #10b981;">${autoSyncLabel}</strong></span>
                    </label>
                    <select id="selAutoSyncInterval" class="input-styled" style="height: 24px; font-size: 11px; padding: 0 6px; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; background: rgba(0,0,0,0.15); color: var(--text-main); font-weight: 700; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        <option value="12" ${interval === 12 ? 'selected' : ''}>12h</option>
                        <option value="24" ${interval === 24 ? 'selected' : ''}>24h</option>
                        <option value="48" ${interval === 48 ? 'selected' : ''}>48h</option>
                    </select>
                    <span style="font-size: 10px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.16); padding: 2px 7px; border-radius: 10px; display: inline-flex; align-items: center; gap: 4px;" title="${pillTooltipTpl.replace('{interval}', interval)}">
                        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%; display: inline-block;"></span> ${autoSyncActive}
                    </span>
                `;
            } else {
                // ÉTAT INACTIF : Relevé auto décoché
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-disabled';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: 36px;
                    align-items: center;
                    gap: 8px;
                    padding: 0 12px;
                    background: var(--bg-card);
                    border: 1px solid var(--border-color);
                    border-radius: 10px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-muted);
                    box-sizing: border-box;
                    transition: all 0.25s ease;
                `;
                autoSyncBox.title = isUnlocked ? (window.i18n ? window.i18n.t('bank_sync_auto_sync_enable_tooltip') : "Activer le relevé automatique en arrière-plan.") : (window.i18n ? window.i18n.t('bank_sync_auto_sync_enable_locked_tooltip') : "Activer le relevé automatique (nécessite de déverrouiller le coffre).");
                autoSyncBox.innerHTML = `
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap;">
                        <input type="checkbox" id="chkAutoSyncToggle" onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: var(--accent); width: 15px; height: 15px;">
                        <span>⏰ <span>${autoSyncLabel}</span></span>
                    </label>
                    <select id="selAutoSyncInterval" class="input-styled" style="height: 24px; font-size: 11px; padding: 0 6px; border: 1px solid var(--border-color); border-radius: 6px; background: transparent; color: var(--text-muted); font-weight: 600; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        <option value="12" ${interval === 12 ? 'selected' : ''}>12h</option>
                        <option value="24" ${interval === 24 ? 'selected' : ''}>24h</option>
                        <option value="48" ${interval === 48 ? 'selected' : ''}>48h</option>
                    </select>
                `;
            }
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
        await this.loadConnections();
    },

    async lockVault() {
        const token = this.getVaultToken();
        try {
            await API.post(`/api/bank-sync/vault/lock${token ? `?token=${encodeURIComponent(token)}` : ''}`);
        } catch (_) {}
        this.clearVaultToken();
        this.stopVaultCountdown();
        this.vaultStatus = { is_unlocked: false, remaining_days: 0, remaining_seconds: 0 };
        this.renderVaultStatusBar();
        await this.loadConnections();
        this.showToast('Coffre-fort verrouillé (mémoire purgée).', 'info');
    },

    async resetVault() {
        const count = this.connections ? this.connections.length : 0;
        let confirmText = '';
        if (count > 0) {
            confirmText = window.i18n.tp('bank_sync_reset_vault_confirm_conns', { count });
        } else {
            confirmText = window.i18n.t('bank_sync_reset_vault_confirm_empty');
        }

        const confirmed = await this.confirmAction(
            window.i18n.t('bank_sync_reset_vault_title'),
            confirmText
        );
        if (!confirmed) return;

        try {
            await API.post('/api/bank-sync/vault/reset');
            this.clearVaultToken();
            this.clearAllCachedData();
            this.vaultStatus = { is_unlocked: false, remaining_days: 0, remaining_seconds: 0 };
            await this.loadVaultStatus();
            await this.loadConnections();
            this.showToast(window.i18n.t('bank_sync_reset_vault_success'), 'success');
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    clearAllCachedData() {
        try {
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('omnibank_remote_accounts_') || k.startsWith('omnibank_sync_') || k.includes('_sync_preview_') || k.includes('_sync_rejected_') || k.includes('_sync_forced_')) {
                    localStorage.removeItem(k);
                }
            });
            Object.keys(sessionStorage).forEach(k => {
                if (k.startsWith('omnibank_sync_') || k.includes('_sync_preview_') || k.includes('_sync_rejected_') || k.includes('_sync_forced_')) {
                    sessionStorage.removeItem(k);
                }
            });
        } catch (_) {}
    },

    async loadAutoSyncSettings() {
        try {
            const data = await API.get('/api/bank-sync/settings/auto-sync');
            this.autoSyncSettings = data || { enabled: false, interval_hours: 24 };
            this.renderVaultStatusBar();
        } catch (e) {
            console.warn('[BankSync] Erreur settings auto-sync:', e);
        }
    },

    async toggleAutoSync(enabled) {
        this.autoSyncSettings.enabled = enabled;
        this.renderVaultStatusBar();
        try {
            await API.post('/api/bank-sync/settings/auto-sync', {
                enabled: enabled,
                interval_hours: this.autoSyncSettings.interval_hours
            });
            if (enabled && !this.vaultStatus?.is_unlocked) {
                this.showToast('Relevé auto activé. Note : le coffre doit être déverrouillé pour fonctionner.', 'warning');
            } else {
                this.showToast(enabled ? 'Relevé automatique activé !' : 'Relevé automatique désactivé.', 'info');
            }
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    async changeAutoSyncInterval(interval) {
        this.autoSyncSettings.interval_hours = parseInt(interval) || 24;
        this.renderVaultStatusBar();
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
});
