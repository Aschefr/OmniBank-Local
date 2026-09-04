// static/js/theme_manager.js — Gestionnaire de Thèmes Multi-Palettes pour OmniBank
// Supporte les thèmes Classique (Sombre/Clair) et Executive Titanium/Albâtre

window.ThemeManager = {
    THEMES: [
        {
            id: 'dark',
            nameKey: 'theme_classic_dark',
            descKey: 'theme_classic_dark_desc',
            type: 'dark',
            icon: '🌙',
            bg: '#161c24',
            surface: '#212b36',
            accent: '#6366f1'
        },
        {
            id: 'light',
            nameKey: 'theme_classic_light',
            descKey: 'theme_classic_light_desc',
            type: 'light',
            icon: '☀️',
            bg: '#f4f6f8',
            surface: '#ffffff',
            accent: '#6366f1'
        },
        {
            id: 'titanium-dark',
            nameKey: 'theme_titanium_dark',
            descKey: 'theme_titanium_dark_desc',
            type: 'dark',
            icon: '🌌',
            bg: '#21252d',
            surface: '#2a2f39',
            accent: '#60a5fa'
        },
        {
            id: 'titanium-light',
            nameKey: 'theme_titanium_light',
            descKey: 'theme_titanium_light_desc',
            type: 'light',
            icon: '❄️',
            bg: '#f7f5f0',
            surface: '#ffffff',
            accent: '#c25e00'
        }
    ],

    currentThemeId: 'dark',

    init() {
        let savedTheme = null;
        try {
            if (window.ProfileStorage) {
                savedTheme = window.ProfileStorage.get('omni_theme');
            }
        } catch (e) {
            console.warn('[ThemeManager] ProfileStorage error', e);
        }

        if (!savedTheme) {
            savedTheme = localStorage.getItem('omni_theme') || 'dark';
        }

        // Backward compatibility: map legacy values
        if (savedTheme === 'true' || savedTheme === 'dark') savedTheme = 'dark';
        if (savedTheme === 'false' || savedTheme === 'light') savedTheme = 'light';

        this.applyTheme(savedTheme, false);
        this.renderMobileThemeList();

        // Close menu on click outside
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('themeMenu');
            const btn = document.getElementById('themeToggle');
            const mobileBtn = document.getElementById('mobileThemeBtn');
            if (menu && menu.style.display !== 'none' && !menu.contains(e.target) && (!btn || !btn.contains(e.target)) && (!mobileBtn || !mobileBtn.contains(e.target))) {
                menu.style.display = 'none';
            }
        });
    },

    getCurrentTheme() {
        return this.THEMES.find(t => t.id === this.currentThemeId) || this.THEMES[0];
    },

    getThemes() {
        return this.THEMES;
    },

    applyTheme(themeId, notify = true) {
        const theme = this.THEMES.find(t => t.id === themeId) || this.THEMES[0];
        this.currentThemeId = theme.id;

        // Clean previous theme classes
        document.body.classList.remove('theme-dark', 'theme-classic-dark', 'theme-classic-light', 'theme-titanium-dark', 'theme-titanium-light');

        if (theme.type === 'dark') {
            document.body.classList.add('theme-dark');
        }

        if (theme.id === 'dark') {
            document.body.classList.add('theme-classic-dark');
        } else if (theme.id === 'light') {
            document.body.classList.add('theme-classic-light');
        } else {
            document.body.classList.add(`theme-${theme.id}`);
        }

        // Persist theme
        try {
            if (window.ProfileStorage) {
                window.ProfileStorage.set('omni_theme', theme.id);
            }
            localStorage.setItem('omni_theme', theme.id);
        } catch (e) {
            console.warn('[ThemeManager] Save error', e);
        }

        // Update Theme Menu active checks and mobile list
        this.updateActiveIndicators();
        this.renderMobileThemeList();

        if (notify) {
            const isDark = theme.type === 'dark';
            window.dispatchEvent(new CustomEvent('themeChanged', { detail: { themeId: theme.id, isDark } }));

            if (window.SimulatorView && typeof window.SimulatorView.renderChart === 'function' && document.getElementById('simChartCanvas')) {
                window.SimulatorView.renderChart();
            }
        }
    },

    toggleMenu() {
        const menu = document.getElementById('themeMenu');
        if (!menu) return;
        const isVisible = menu.style.display === 'block';
        if (isVisible) {
            menu.style.display = 'none';
        } else {
            this.renderMenu();
            menu.style.display = 'block';
        }
    },

    cycleTheme() {
        const ids = this.THEMES.map(t => t.id);
        const currentIndex = ids.indexOf(this.currentThemeId);
        const nextIndex = (currentIndex + 1) % ids.length;
        const nextTheme = this.THEMES[nextIndex];
        this.applyTheme(nextTheme.id, true);
        if (window.app && typeof window.app.showToast === 'function') {
            const i18n = window.i18n || { t: k => k };
            const name = i18n.t(nextTheme.nameKey) || nextTheme.id;
            window.app.showToast(`${nextTheme.icon} ${name}`, 'info');
        }
    },

    renderMenu() {
        const menu = document.getElementById('themeMenu');
        if (!menu) return;

        const i18n = window.i18n || { t: k => k };

        menu.innerHTML = `
            <div class="theme-menu-header">
                <span class="theme-menu-title">${i18n.t('theme_manager_title') || 'Thèmes visuels'}</span>
            </div>
            <div class="theme-menu-list">
                ${this.THEMES.map(t => {
                    const isActive = t.id === this.currentThemeId;
                    const name = i18n.t(t.nameKey) || t.id;
                    return `
                        <div class="theme-menu-option ${isActive ? 'active' : ''}" onclick="window.ThemeManager.applyTheme('${t.id}'); window.ThemeManager.toggleMenu();">
                            <div class="theme-option-left">
                                <span class="theme-option-icon">${t.icon}</span>
                                <div class="theme-option-info">
                                    <span class="theme-option-name">${name}</span>
                                </div>
                            </div>
                            <div class="theme-option-right">
                                <div class="theme-swatch" style="background:${t.bg}; border-color:${t.accent};" title="${name}">
                                    <span class="theme-swatch-dot" style="background:${t.accent};"></span>
                                </div>
                                ${isActive ? '<span class="theme-check">✓</span>' : ''}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    renderMobileThemeList() {
        const container = document.getElementById('mobileThemeList');
        if (!container) return;

        const i18n = window.i18n || { t: k => k };
        const escapeHtml = str => String(str || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

        let html = '';
        for (const t of this.THEMES) {
            const isActive = t.id === this.currentThemeId;
            const name = i18n.t(t.nameKey) || t.id;
            html += `
                <button class="mobile-theme-item ${isActive ? 'active' : ''}" onclick="window.ThemeManager.applyTheme('${t.id}')">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>${t.icon}</span>
                        <span>${escapeHtml(name)}</span>
                    </div>
                    ${isActive ? '<span class="mobile-theme-check">✓</span>' : ''}
                </button>
            `;
        }
        container.innerHTML = html;
    },

    updateActiveIndicators() {
        const options = document.querySelectorAll('.theme-menu-option');
        options.forEach(opt => {
            const isTarget = opt.getAttribute('onclick')?.includes(`'${this.currentThemeId}'`);
            opt.classList.toggle('active', !!isTarget);
        });
    }
};
