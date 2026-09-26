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

    getIntervalOptionsHtml(currentInterval) {
        const standard = [3, 5, 8, 12, 24, 36, 48];
        const val = parseInt(currentInterval) || 24;
        const list = standard.includes(val) ? standard : [...standard, val].sort((a, b) => a - b);
        return list.map(h => `<option value="${h}" ${val === h ? 'selected' : ''}>${h}h</option>`).join('');
    },

    updateVaultCountdownDisplay() {
        if (!this.vaultStatus?.is_unlocked) return;

        const timeStr = this.formatVaultRemaining(this.vaultStatus.remaining_seconds);
        const hasToken = !!this.getVaultToken();
        const unlockedLabel = window.i18n ? window.i18n.t('bank_sync_vault_unlocked') : 'Déverrouillé';
        const remoteLabel = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote') || 'Actif sur serveur' : 'Actif sur serveur';
        const label = hasToken ? unlockedLabel : remoteLabel;
        const fullText = `${label} (${timeStr})`;
        const tooltipTpl = hasToken
            ? (window.i18n ? window.i18n.t('bank_sync_vault_unlocked_tooltip') : 'Coffre-fort déverrouillé en mémoire (reverrouillage automatique dans {time}). Cliquez pour verrouiller immédiatement.')
            : (window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote_tooltip') : 'Le coffre-fort est déverrouillé sur le serveur (relevés automatiques opérationnels). Cliquez pour autoriser ce navigateur avec votre mot de passe maître.');
        const tooltip = tooltipTpl.replace('{time}', timeStr);

        document.querySelectorAll('.bank-sync-vault-pill-text, #bankSyncVaultPillText, #apVaultPillText').forEach(el => {
            el.textContent = fullText;
        });
        document.querySelectorAll('.bank-sync-vault-pill, #bankSyncVaultPillBtn, #apVaultPillBtn').forEach(el => {
            el.title = tooltip;
        });

        const inlineVaultStatus = document.getElementById('apVaultStatusInline');
        if (inlineVaultStatus) {
            inlineVaultStatus.innerHTML = hasToken
                ? `<span style="color: #10b981; font-weight: 700; cursor: pointer;" onclick="window.BankSyncView.lockVault()" title="Cliquez pour verrouiller">🔓 Déverrouillé (${timeStr})</span>`
                : `<span style="color: #6366f1; font-weight: 700; cursor: pointer;" onclick="window.BankSyncView.unlockVaultManually()" title="Cliquez pour autoriser ce navigateur">🌐 🔓 Actif serveur (${timeStr})</span>`;
        }
    },

    async loadVaultStatus() {
        try {
            const token = this.getVaultToken();
            const url = token ? `/api/bank-sync/vault/status?token=${encodeURIComponent(token)}` : '/api/bank-sync/vault/status';
            const data = await API.get(url);
            this.vaultStatus = data;
            if (data && data.is_unlocked && data.vault_token) {
                this.setVaultToken(data.vault_token);
            } else if (token && (!data || !data.is_unlocked)) {
                this.clearVaultToken();
            }
            this.renderVaultStatusBar();
            return data;
        } catch (e) {
            console.warn('[BankSync] Erreur lecture statut coffre:', e);
            this.clearVaultToken();
            this.vaultStatus = { is_unlocked: false, server_unlocked: false, remaining_days: 0, remaining_seconds: 0 };
            this.renderVaultStatusBar();
            return this.vaultStatus;
        }
    },

    renderVaultStatusBar() {
        const pills = document.querySelectorAll('#bankSyncVaultPill, #apVaultPill, .bank-sync-vault-wrapper');
        const autoSyncBoxes = document.querySelectorAll('#bankSyncAutoSyncCompact, #apAutoSyncCompact, .bank-sync-auto-sync-widget-slot');
        const headerBtn = document.getElementById('btnHeaderBgSync');

        const hasConnections = this.connections && this.connections.length > 0;

        const apBankGroup = document.getElementById('apBankSyncGroup');

        if (headerBtn) {
            headerBtn.style.display = hasConnections ? 'inline-flex' : 'none';
        }
        if (apBankGroup) {
            apBankGroup.style.display = hasConnections ? 'inline-flex' : 'none';
        }

        const hasToken = !!this.getVaultToken();
        const isClientUnlocked = !!(this.vaultStatus?.is_unlocked && hasToken);
        const isServerUnlocked = !!(this.vaultStatus?.server_unlocked || this.vaultStatus?.is_unlocked);
        const isAutoSyncEnabled = !!this.autoSyncSettings?.enabled;
        const interval = this.autoSyncSettings?.interval_hours || 24;
        const optionsHtml = this.getIntervalOptionsHtml(interval);

        // ── 1. GESTION DES BADGES D'ÉTAT DU COFFRE ──
        pills.forEach((pill) => {
            if (!hasConnections) {
                pill.innerHTML = '';
                pill.style.display = 'none';
            } else {
                pill.style.display = 'inline-flex';
                if (isClientUnlocked) {
                    const timeStr = this.formatVaultRemaining(this.vaultStatus?.remaining_seconds || 0);
                    const unlockedLabel = window.i18n ? window.i18n.t('bank_sync_vault_unlocked') : 'Déverrouillé';
                    const tooltipTpl = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_tooltip') : 'Coffre-fort déverrouillé en mémoire (reverrouillage automatique dans {time}). Cliquez pour verrouiller immédiatement.';
                    const lockNowTooltip = window.i18n ? window.i18n.t('bank_sync_vault_lock_now_tooltip') : 'Verrouiller immédiatement';
                    pill.innerHTML = `
                        <span class="bank-sync-vault-pill" style="font-size: 12px; font-weight: 600; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); height: 36px; padding: 0 12px; border-radius: 9px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; line-height: 1;" onclick="window.BankSyncView.lockVault()" title="${tooltipTpl.replace('{time}', timeStr)}">
                            <span>🔓</span> <span class="bank-sync-vault-pill-text">${unlockedLabel} (${timeStr})</span> <span style="font-size: 11px; opacity: 0.75;" title="${lockNowTooltip}">🔒</span>
                        </span>
                    `;
                } else if (isServerUnlocked && !isClientUnlocked) {
                    // Session active en RAM sur le serveur Docker, mais non encore authentifiée sur ce navigateur
                    const timeStr = this.formatVaultRemaining(this.vaultStatus?.remaining_seconds || 0);
                    const remoteLabel = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote') || 'Actif sur serveur' : 'Actif sur serveur';
                    const remoteAction = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote_action') || '(Autoriser ce poste)' : '(Autoriser ce poste)';
                    const remoteTooltip = window.i18n ? window.i18n.t('bank_sync_vault_unlocked_remote_tooltip') || 'Le coffre-fort est déverrouillé sur le serveur (relevés automatiques opérationnels). Cliquez pour autoriser ce navigateur avec votre mot de passe maître.' : 'Le coffre-fort est déverrouillé sur le serveur (relevés automatiques opérationnels). Cliquez pour autoriser ce navigateur avec votre mot de passe maître.';
                    pill.innerHTML = `
                        <span class="bank-sync-vault-pill" style="font-size: 12px; font-weight: 600; background: rgba(99, 102, 241, 0.12); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.3); height: 36px; padding: 0 12px; border-radius: 9px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; line-height: 1;" onclick="window.BankSyncView.unlockVaultManually()" title="${remoteTooltip}">
                            <span>🌐 🔓</span> <span class="bank-sync-vault-pill-text">${remoteLabel} (${timeStr})</span> <span style="font-size: 11px; text-decoration: underline; font-weight: 700;">${remoteAction}</span>
                        </span>
                    `;
                } else {
                    const lockedLabel = window.i18n ? window.i18n.t('bank_sync_vault_locked') : 'Coffre verrouillé';
                    const unlockAction = window.i18n ? window.i18n.t('bank_sync_vault_unlock_action') : '(Déverrouiller)';
                    const lockedTooltip = window.i18n ? window.i18n.t('bank_sync_vault_locked_tooltip') : 'Coffre verrouillé. Cliquez pour déverrouiller avec votre mot de passe maître.';
                    pill.innerHTML = `
                        <span class="bank-sync-vault-pill" style="font-size: 12px; font-weight: 600; background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); height: 36px; padding: 0 12px; border-radius: 9px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; line-height: 1;" onclick="window.BankSyncView.unlockVaultManually()" title="${lockedTooltip}">
                            <span>🔒</span> <span>${lockedLabel}</span> <span style="font-size: 11px; text-decoration: underline; font-weight: 700;">${unlockAction}</span>
                        </span>
                    `;
                }
            }
        });

        if (isClientUnlocked || isServerUnlocked) {
            this.startVaultCountdown();
        } else {
            this.stopVaultCountdown();
        }

        // Mise à jour de l'indicateur textuel coffre (ex: colonne gauche Auto-Pilote)
        const inlineVaultStatus = document.getElementById('apVaultStatusInline');
        if (inlineVaultStatus) {
            if (!hasConnections) {
                inlineVaultStatus.innerHTML = '<span style="color: var(--text-muted);">Aucune banque connectée</span>';
            } else if (isClientUnlocked) {
                const timeStr = this.formatVaultRemaining(this.vaultStatus?.remaining_seconds || 0);
                inlineVaultStatus.innerHTML = `<span style="color: #10b981; cursor: pointer; font-weight: 700;" onclick="window.BankSyncView.lockVault()" title="Cliquez pour verrouiller">🔓 Déverrouillé (${timeStr})</span>`;
            } else if (isServerUnlocked) {
                const timeStr = this.formatVaultRemaining(this.vaultStatus?.remaining_seconds || 0);
                inlineVaultStatus.innerHTML = `<span style="color: #6366f1; cursor: pointer; font-weight: 700;" onclick="window.BankSyncView.unlockVaultManually()" title="Cliquez pour autoriser ce navigateur">🌐 🔓 Actif serveur (${timeStr})</span>`;
            } else {
                inlineVaultStatus.innerHTML = `<span style="color: #f59e0b; cursor: pointer; font-weight: 700; text-decoration: underline;" onclick="window.BankSyncView.unlockVaultManually()" title="Cliquez pour déverrouiller">🔒 Verrouillé (Déverrouiller)</span>`;
            }
        }

        // ── 2. GESTION DES WIDGETS RELEVÉ AUTO ──
        autoSyncBoxes.forEach((autoSyncBox) => {
            if (!hasConnections) {
                autoSyncBox.innerHTML = '';
                autoSyncBox.style.display = 'none';
                return;
            }
            autoSyncBox.style.display = 'inline-flex';

            const isAutopilot = autoSyncBox.id === 'apAutoSyncCompact' || !!autoSyncBox.closest('#apBankSyncGroup') || !!autoSyncBox.closest('.autopilot-toolbar-group');
            const isAutopilotMasterEnabled = !!(window.AutopilotView && window.AutopilotView._status && window.AutopilotView._status.is_enabled);
            const isEffectiveAutoSyncActive = isAutopilot ? (isAutoSyncEnabled && isAutopilotMasterEnabled) : isAutoSyncEnabled;

            const boxHeight = isAutopilot ? '40px' : '36px';
            const boxRadius = '9px';
            const boxPadding = '0 12px';

            const autoSyncLabel = window.i18n ? window.i18n.t('bank_sync_auto_sync_label') : 'Relevé auto';
            const autoSyncActive = window.i18n ? window.i18n.t('bank_sync_auto_sync_active') : 'Actif';
            const unlockBtnText = window.i18n ? window.i18n.t('bank_sync_auto_sync_unlock_btn') : 'Déverrouiller';

            if (isEffectiveAutoSyncActive && !isServerUnlocked) {
                // ÉTAT ALERTE CRITIQUE : Relevé auto programmé mais Coffre verrouillé !
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-locked-warning';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: ${boxHeight};
                    align-items: center;
                    gap: 8px;
                    padding: ${boxPadding};
                    background: rgba(245, 158, 11, 0.12);
                    border: 1.5px dashed #f59e0b;
                    border-radius: ${boxRadius};
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
                        <input type="checkbox" checked onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: #f59e0b; width: 15px; height: 15px;">
                        <span style="display: inline-flex; align-items: center; gap: 4px;">
                            <span>⚠️</span> <strong style="color: #f59e0b;">${autoSyncLabel} :</strong>
                        </span>
                    </label>
                    <select class="input-styled" style="height: 26px; font-size: 11.5px; padding: 0 8px; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 6px; background: rgba(0,0,0,0.25); color: #f59e0b; font-weight: 700; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        ${optionsHtml}
                    </select>
                    <button type="button" class="btn" onclick="window.BankSyncView.unlockVaultManually()" style="height: 26px; padding: 0 10px; font-size: 11.5px; font-weight: 700; background: #f59e0b; color: #1e1e2d; border-radius: 6px; border: none; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" title="${window.i18n ? window.i18n.t('bank_sync_vault_locked_tooltip') : 'Déverrouiller le coffre pour autoriser les relevés automatiques'}">
                        <span>🔓</span> <span>${unlockBtnText}</span>
                    </button>
                `;
            } else if (isAutoSyncEnabled && isServerUnlocked) {
                // ÉTAT OPÉRATIONNEL : Coffre déverrouillé & Relevé auto actif
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-active';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: ${boxHeight};
                    align-items: center;
                    gap: 8px;
                    padding: ${boxPadding};
                    background: rgba(16, 185, 129, 0.08);
                    border: 1px solid rgba(16, 185, 129, 0.4);
                    border-radius: ${boxRadius};
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-main);
                    box-sizing: border-box;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
                    transition: all 0.25s ease;
                `;
                const activeTooltipTpl = window.i18n ? window.i18n.t('bank_sync_auto_sync_active_tooltip') : `Relevé automatique programmé toutes les {interval}h (coffre déverrouillé).`;
                const pillTooltipTpl = window.i18n ? window.i18n.t('bank_sync_auto_sync_active_pill_tooltip') : `Le planificateur exécute un relevé toutes les {interval} heures.`;
                autoSyncBox.title = activeTooltipTpl.replace('{interval}', interval);
                autoSyncBox.innerHTML = `
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap;">
                        <input type="checkbox" checked onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: #10b981; width: 15px; height: 15px;">
                        <span>⏰ <strong style="color: #10b981;">${autoSyncLabel}</strong></span>
                    </label>
                    <select class="input-styled" style="height: 26px; font-size: 11.5px; padding: 0 8px; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; background: rgba(0,0,0,0.15); color: var(--text-main); font-weight: 700; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        ${optionsHtml}
                    </select>
                    <span style="font-size: 11px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.16); padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px; height: 24px; box-sizing: border-box;" title="${pillTooltipTpl.replace('{interval}', interval)}">
                        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%; display: inline-block;"></span> ${autoSyncActive}
                    </span>
                `;
            } else {
                // ÉTAT INACTIF : Relevé auto décoché
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-disabled';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: ${boxHeight};
                    align-items: center;
                    gap: 8px;
                    padding: ${boxPadding};
                    background: var(--bg-card);
                    border: 1px solid var(--border-color);
                    border-radius: ${boxRadius};
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-muted);
                    box-sizing: border-box;
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
                    transition: all 0.25s ease;
                `;
                autoSyncBox.title = isServerUnlocked ? (window.i18n ? window.i18n.t('bank_sync_auto_sync_enable_tooltip') : "Activer le relevé automatique en arrière-plan.") : (window.i18n ? window.i18n.t('bank_sync_auto_sync_enable_locked_tooltip') : "Activer le relevé automatique (nécessite de déverrouiller le coffre).");
                autoSyncBox.innerHTML = `
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap;">
                        <input type="checkbox" onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: var(--accent); width: 15px; height: 15px;">
                        <span>⏰ <span>${autoSyncLabel}</span></span>
                    </label>
                    <select class="input-styled" style="height: 26px; font-size: 11.5px; padding: 0 8px; border: 1px solid var(--border-color); border-radius: 6px; background: transparent; color: var(--text-muted); font-weight: 600; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        ${optionsHtml}
                    </select>
                `;
            }
        });
    },

    async unlockVaultManually() {
        this._vaultUnlockToastShown = false;
        const pw = await this.promptMasterPassword(null, null, true);
        if (!pw) return;
        if (!this._vaultUnlockToastShown) {
            this.showToast(window.i18n ? window.i18n.t('bank_sync_toast_vault_unlocked', 'Coffre déverrouillé avec succès !') : 'Coffre déverrouillé avec succès !', 'success');
        }
        this._vaultUnlockToastShown = false;
        await this.loadVaultStatus();
        await this.loadPendingSync();
        await this.loadConnections();
        window.dispatchEvent(new CustomEvent('autopilot_updated'));
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
        this.showToast(window.i18n ? window.i18n.t('bank_sync_toast_vault_locked') : 'Coffre-fort verrouillé (mémoire purgée).', 'info');
        window.dispatchEvent(new CustomEvent('autopilot_updated'));
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
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
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
            this.autoSyncSettings = data || { enabled: false, interval_hours: 24, sync_on_vault_unlock: true };
            this.renderVaultStatusBar();
        } catch (e) {
            console.warn('[BankSync] Erreur settings auto-sync:', e);
        }
    },

    async toggleSyncOnVaultUnlock(enabled) {
        if (!this.autoSyncSettings) {
            this.autoSyncSettings = { enabled: false, interval_hours: 24, sync_on_vault_unlock: true };
        }
        this.autoSyncSettings.sync_on_vault_unlock = enabled;
        try {
            await API.post('/api/bank-sync/settings/auto-sync', {
                enabled: this.autoSyncSettings.enabled,
                interval_hours: this.autoSyncSettings.interval_hours,
                sync_on_vault_unlock: enabled
            });
        } catch (err) {
            console.warn('[BankSync] Erreur toggleSyncOnVaultUnlock:', err);
        }
    },

    async toggleAutoSync(enabled) {
        this.autoSyncSettings.enabled = enabled;
        this.renderVaultStatusBar();
        try {
            await API.post('/api/bank-sync/settings/auto-sync', {
                enabled: enabled,
                interval_hours: this.autoSyncSettings.interval_hours,
                sync_on_vault_unlock: this.autoSyncSettings.sync_on_vault_unlock !== false
            });
            if (enabled && !this.vaultStatus?.is_unlocked) {
                this.showToast(window.i18n ? window.i18n.t('bank_sync_toast_auto_sync_enabled_warn') : 'Relevé auto activé. Note : le coffre doit être déverrouillé pour fonctionner.', 'warning');
            } else {
                this.showToast(enabled ? (window.i18n ? window.i18n.t('bank_sync_toast_auto_sync_enabled') : 'Relevé automatique activé !') : (window.i18n ? window.i18n.t('bank_sync_toast_auto_sync_disabled') : 'Relevé automatique désactivé.'), 'info');
            }
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
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
                interval_hours: this.autoSyncSettings.interval_hours,
                sync_on_vault_unlock: this.autoSyncSettings.sync_on_vault_unlock !== false
            });
            const toastMsg = window.i18n ? window.i18n.tp('bank_sync_toast_interval_changed', { interval }) || `Fréquence ajustée : ${interval} heures.` : `Fréquence ajustée : ${interval} heures.`;
            this.showToast(toastMsg, 'info');
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },
});
