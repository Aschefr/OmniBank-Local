// static/js/views/config/config_license.js — Carte « Mode Organisation et licence » de la Configuration
window.ConfigView = Object.assign(window.ConfigView || {}, {
    async _onOrgModeToggle() {
        const chk = document.getElementById('conf_enable_org_mode');
        if (!chk) return;

        if (chk.checked) {
            const status = await window.LicenseManager.getStatus();
            if (!status.active) {
                const activated = await window.LicenseManager.open();
                if (!activated) {
                    chk.checked = false;
                    return;
                }
            }
        }
        this.save();
        this._refreshLicenseStatus();
    },

    async _enterLicenseKey() {
        const activated = await window.LicenseManager.open();
        if (!activated) return;
        const chk = document.getElementById('conf_enable_org_mode');
        if (chk) chk.checked = true;
        this._onOrgModeToggle();
    },

    async _refreshLicenseStatus() {
        const el = document.getElementById('configLicenseStatus');
        if (!el) return;
        const status = await window.LicenseManager.getStatus();
        const t = key => window.i18n.t(key);

        if (status.active) {
            const details = [status.id, status.org, status.email].filter(Boolean).map(window.escapeHtml).join(' · ');
            el.innerHTML = `
                <div class="license-status-line">
                    <span class="license-badge active">${t('license_active')}</span>
                    <span class="license-details">${details}</span>
                </div>
                ${status.kind === 'legacy' ? `<p class="license-hint">${t('license_legacy_note')}</p>` : ''}
                <div class="license-actions">
                    <button class="btn btn-danger-outline" onclick="window.ConfigView._deactivateLicense()">${t('license_btn_deactivate')}</button>
                </div>`;
        } else {
            el.innerHTML = `
                ${status.org_mode_blocked ? `<p class="license-notice">${t('license_blocked_notice')}</p>` : ''}
                <div class="license-status-line">
                    <span class="license-badge inactive">${t('license_inactive')}</span>
                </div>
                <p class="license-hint">${t('license_off_sale')}</p>
                <div class="license-actions">
                    <button class="btn btn-primary" onclick="window.ConfigView._enterLicenseKey()">${t('license_btn_enter_key')}</button>
                </div>`;
        }
        // Le panneau du mode partagé dépend aussi de la licence
        this._refreshSharedModePanel();
    },

    async _deactivateLicense() {
        const status = await window.LicenseManager.getStatus();
        const question = window.i18n.t(status.kind === 'legacy' ? 'license_confirm_deactivate_legacy' : 'license_confirm_deactivate');
        if (!confirm(question)) return;
        await window.LicenseManager.deactivate();
        const chk = document.getElementById('conf_enable_org_mode');
        if (chk) chk.checked = false;
        this.save();
        this._refreshLicenseStatus();
    },
});
