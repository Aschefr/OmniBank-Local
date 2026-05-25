/**
 * Phase 10 — License Manager
 * Handles license modal, activation, and status checks.
 */
window.LicenseManager = {
    _resolve: null,  // Promise resolve for modal flow

    /**
     * Opens the license modal and returns a Promise that resolves
     * to true if license was activated, false if cancelled.
     */
    open() {
        return new Promise(resolve => {
            this._resolve = resolve;
            const modal = document.getElementById('licenseModal');
            if (!modal) { resolve(false); return; }

            // Clear previous state
            document.getElementById('licenseEmail').value = '';
            document.getElementById('licenseKey').value = '';
            const err = document.getElementById('licenseError');
            if (err) { err.style.display = 'none'; err.textContent = ''; }

            window.i18n.translateDOM(modal);
            modal.style.display = 'flex';
            setTimeout(() => document.getElementById('licenseEmail')?.focus(), 100);
        });
    },

    close() {
        document.getElementById('licenseModal').style.display = 'none';
        if (this._resolve) {
            this._resolve(false);
            this._resolve = null;
        }
    },

    async activate() {
        const email = document.getElementById('licenseEmail')?.value.trim();
        const key = document.getElementById('licenseKey')?.value.trim();
        const err = document.getElementById('licenseError');

        if (!email || !key) {
            if (err) { err.textContent = window.i18n.t('license_invalid'); err.style.display = 'block'; }
            return;
        }

        const btn = document.getElementById('licenseActivateBtn');
        if (btn) btn.disabled = true;

        try {
            const res = await API.post('/api/license/activate', { email, key });
            if (res.active) {
                document.getElementById('licenseModal').style.display = 'none';
                showToast(window.i18n.t('license_activated'), 'success');
                if (this._resolve) {
                    this._resolve(true);
                    this._resolve = null;
                }
            }
        } catch (e) {
            if (err) {
                err.textContent = window.i18n.t('license_invalid');
                err.style.display = 'block';
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async getStatus() {
        try {
            return await API.get('/api/license/status');
        } catch (e) {
            return { active: false, email: null };
        }
    },

    async deactivate() {
        try {
            await API.post('/api/license/deactivate');
            showToast(window.i18n.t('license_deactivated'), 'success');
        } catch (e) {
            console.error(e);
        }
    }
};
