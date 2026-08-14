// static/js/views/config/config_org_users.js — Mode Organisation, Utilisateurs partagés & Licence
window.ConfigView = Object.assign(window.ConfigView || {}, {
    async _refreshOrgUsersPanel() {
        const panel = document.getElementById('configOrgUsersPanel');
        if (!panel) return;
        const isOrg = document.getElementById('conf_enable_org_mode')?.checked;
        panel.style.display = isOrg ? 'block' : 'none';
        if (!isOrg) return;

        // Ensure default user exists
        try { await API.post('/api/org_users/ensure_default'); } catch(e) {}

        let users = [];
        try { users = await API.get('/api/org_users/'); } catch(e) {}

        const list = document.getElementById('orgUsersList');
        if (!list) return;
        list.innerHTML = users.map(u => `
            <div class="org-user-row">
                <span style="font-size:18px;">👤</span>
                <span class="org-user-name" id="orgUserName_${u.id}">${u.name}</span>
                <span class="org-user-status ${u.is_active ? 'active' : 'inactive'}">${u.is_active ? window.i18n.t('label_active') : window.i18n.t('label_inactive')}</span>
                <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.ConfigView._renameOrgUser(${u.id},'${u.name.replace(/'/g, "\\'")}')" title="Renommer">✏️</button>
                ${u.is_active
                    ? `<button class="btn btn-danger" style="padding:3px 8px;font-size:11px;" onclick="window.ConfigView._toggleOrgUser(${u.id},false)">${window.i18n.t('btn_deactivate')}</button>`
                    : `<button class="btn btn-primary" style="padding:3px 8px;font-size:11px;" onclick="window.ConfigView._toggleOrgUser(${u.id},true)">${window.i18n.t('btn_reactivate')}</button>`
                }
            </div>
        `).join('');
    },

    async _addOrgUser() {
        const input = document.getElementById('newOrgUserName');
        const name = input?.value.trim();
        if (!name) return;
        try {
            await API.post('/api/org_users/', { name });
            input.value = '';
            showToast(window.i18n.t('toast_user_added'), 'success');
            this._refreshOrgUsersPanel();
        } catch(e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    async _renameOrgUser(id, currentName) {
        const newName = prompt(window.i18n.t('ph_user_name'), currentName);
        if (!newName || newName.trim() === '' || newName.trim() === currentName) return;
        try {
            await API.put(`/api/org_users/${id}`, { name: newName.trim() });
            showToast(window.i18n.t('toast_user_updated'), 'success');
            this._refreshOrgUsersPanel();
        } catch(e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    async _toggleOrgUser(id, activate) {
        try {
            await API.put(`/api/org_users/${id}`, { is_active: activate });
            showToast(activate ? window.i18n.t('toast_user_reactivated') : window.i18n.t('toast_user_deactivated'), 'success');
            this._refreshOrgUsersPanel();
        } catch(e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    // ── Phase 10: License-gated Org Mode ─────────────────────────────
    async _onOrgModeToggle() {
        const chk = document.getElementById('conf_enable_org_mode');
        if (!chk) return;

        if (chk.checked) {
            // Trying to enable org mode → check license first
            const status = await window.LicenseManager.getStatus();
            if (!status.active) {
                // No license → open license modal
                const activated = await window.LicenseManager.open();
                if (!activated) {
                    // User cancelled → uncheck
                    chk.checked = false;
                    return;
                }
            }
        }
        // License OK (or disabling) → proceed with save
        this.save();
        this._refreshLicenseStatus();
    },

    async _refreshLicenseStatus() {
        const el = document.getElementById('configLicenseStatus');
        if (!el) return;
        const status = await window.LicenseManager.getStatus();
        if (status.active) {
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.gap = '10px';
            el.innerHTML = `
                <span class="license-badge active">✅ ${window.i18n.t('license_active')} — ${status.email}</span>
                <button class="btn btn-danger" style="padding:3px 10px;font-size:11px;" onclick="window.ConfigView._deactivateLicense()">${window.i18n.t('license_btn_deactivate')}</button>
            `;
        } else {
            const isOrgOn = document.getElementById('conf_enable_org_mode')?.checked;
            el.style.display = isOrgOn ? 'block' : 'none';
            el.innerHTML = `<span class="license-badge inactive">❌ ${window.i18n.t('license_inactive')}</span>`;
        }
        // Also refresh shared mode panel (depends on license state)
        this._refreshSharedModePanel();
    },

    async _deactivateLicense() {
        await window.LicenseManager.deactivate();
        // Also uncheck org mode
        const chk = document.getElementById('conf_enable_org_mode');
        if (chk) chk.checked = false;
        this.save();
        this._refreshLicenseStatus();
    },

    // ── Improvement 03: Shared Mode ──────────────────────────────────
    async _refreshSharedModePanel() {
        const panel = document.getElementById('configSharedModePanel');
        const statusEl = document.getElementById('sharedModeStatus');
        const actionsEl = document.getElementById('sharedModeActions');
        if (!statusEl || !actionsEl) return;

        // Only show in Tauri desktop app — useless in Docker/browser
        if (!window.__TAURI__) {
            if (panel) panel.style.display = 'none';
            return;
        }

        // Only show if org license is active
        const license = await window.LicenseManager.getStatus();
        if (!license.active) {
            if (panel) panel.style.display = 'none';
            return;
        }
        if (panel) panel.style.display = '';

        try {
            const status = await API.get('/api/config/shared-mode');

            if (status.active) {
                const modeLabel = status.mode === 'custom' ? '📁' : '🖥️';
                statusEl.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span class="license-badge active">✅ ${window.i18n.t('config_shared_mode_active')}</span>
                        <span style="font-size: 12px; color: var(--text-muted);">${modeLabel} ${status.path}</span>
                    </div>
                `;
                actionsEl.innerHTML = `
                    <button class="btn btn-danger" style="padding: 6px 14px; font-size: 12px;" onclick="window.ConfigView._disableSharedMode()">
                        ${window.i18n.t('config_shared_mode_deactivate')}
                    </button>
                `;
            } else {
                statusEl.innerHTML = `
                    <span class="license-badge inactive">📴 ${window.i18n.t('config_shared_mode_inactive')}</span>
                `;
                actionsEl.innerHTML = `
                    <button class="btn btn-primary" style="padding: 6px 14px; font-size: 12px;" onclick="window.ConfigView._enableSharedMode('programdata')">
                        🖥️ ${window.i18n.t('config_shared_mode_default_btn')}
                    </button>
                    <button class="btn btn-secondary" style="padding: 6px 14px; font-size: 12px;" onclick="window.ConfigView._enableSharedModeCustom()">
                        📁 ${window.i18n.t('config_shared_mode_custom')}
                    </button>
                `;
            }
        } catch (e) {
            statusEl.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">—</span>';
            actionsEl.innerHTML = '';
        }
    },

    async _enableSharedMode(mode, customPath) {
        const msg = window.i18n.t('config_shared_mode_confirm');
        if (!confirm(msg)) return;

        try {
            const body = { mode };
            if (customPath) body.custom_path = customPath;
            const res = await API.post('/api/config/shared-mode', body);
            if (res.ok) {
                showToast(window.i18n.t('config_shared_mode_success'), 'success');
                this._refreshSharedModePanel();
            }
        } catch (e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    async _enableSharedModeCustom() {
        try {
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: window.i18n.t('config_shared_mode_choose_folder')
            });
            if (!selected) return; // User cancelled
            this._enableSharedMode('custom', selected);
        } catch (e) {
            // Fallback to prompt if Tauri dialog fails
            const path = prompt(window.i18n.t('config_shared_mode_choose_folder'), 'C:\\OmniBank-Shared');
            if (!path || !path.trim()) return;
            this._enableSharedMode('custom', path.trim());
        }
    },

    async _disableSharedMode() {
        const msg = window.i18n.t('config_shared_mode_confirm_disable');
        if (!confirm(msg)) return;

        try {
            const res = await API.del('/api/config/shared-mode');
            if (res.ok) {
                showToast(window.i18n.t('config_shared_mode_disabled'), 'success');
                this._refreshSharedModePanel();
            }
        } catch (e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    // ── Improvement 05: Auto Backup ─────────────────────────────────

});
