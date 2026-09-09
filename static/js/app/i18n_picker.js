// static/js/app/i18n_picker.js
// Sélecteur de langue desktop/mobile et synchronisation i18n de l'interface

window.AppModules = window.AppModules || {};

window.AppModules.i18nPicker = {
    populateLangDropdown() {
        const langMenu = document.getElementById('langMenu');
        if (!langMenu || !window.i18n) return;
        
        const escape = window.escapeHtml || (str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
        const langs = window.i18n.availableLangs || [];
        const currentLang = window.i18n.lang || 'fr';
        let html = '';
        for (const l of langs) {
            const isActive = l.code === currentLang;
            html += `
                <div class="lang-option ${isActive ? 'active' : ''}" data-lang="${l.code}">
                    <div class="lang-option-left">
                        <span class="fi fi-${l.flag}"></span>
                        <span>${escape(l.label)}</span>
                    </div>
                    ${isActive ? '<span class="lang-check">✓</span>' : ''}
                </div>
            `;
        }
        langMenu.innerHTML = html;

        langMenu.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', async (e) => {
                const l = e.currentTarget.getAttribute('data-lang');
                langMenu.style.display = 'none';
                await this.setLanguage(l);
            });
        });
    },

    renderMobileLangList() {
        const container = document.getElementById('mobileLangList');
        if (!container || !window.i18n) return;

        const escapeHtml = window.escapeHtml || (str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])));
        const langs = window.i18n.availableLangs || [];
        const current = window.i18n.lang;
        let html = '';

        for (const l of langs) {
            const isActive = l.code === current;
            html += `
                <button class="mobile-lang-item ${isActive ? 'active' : ''}" onclick="window.app.setLanguage('${l.code}')">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="fi fi-${l.flag}"></span>
                        <span>${escapeHtml(l.label)}</span>
                    </div>
                    ${isActive ? '<span class="mobile-lang-check">✓</span>' : ''}
                </button>
            `;
        }

        container.innerHTML = html;
    },

    async setLanguage(langCode) {
        if (!window.i18n) return;
        await window.i18n.setLang(langCode);
        this.updateMobileLangUI();
        this.updateDesktopLangUI();
        await this.refreshSidebar();
        this.loadView(this.currentView);
        this.updateHeaderHistoryState();
    },

    updateMobileLangUI() {
        this.renderMobileLangList();
        if (window.ThemeManager) {
            window.ThemeManager.renderMobileThemeList();
        }
    },

    updateDesktopLangUI() {
        const currentLangFlag = document.getElementById('currentLangFlag');
        if (!window.i18n) return;
        const info = window.i18n.getLangInfo();
        if (currentLangFlag) currentLangFlag.className = `fi fi-${info.flag}`;
        this.populateLangDropdown();
    }
};

if (window.App) {
    Object.assign(window.App.prototype, window.AppModules.i18nPicker);
}
