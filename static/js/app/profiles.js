// static/js/app/profiles.js
// Gestion des profils utilisateurs, sélecteur, PIN de sécurité, auto-lock overlay et mode organisation

window.AppModules = window.AppModules || {};

window.AppModules.profiles = {
    // ── Phase 9: User Picker (full-page splash) ──────────────────
    async _showUserPicker() {
        window.hideAppInitLoader();
        const overlay = document.getElementById('userPickerOverlay');
        if (!overlay) return;

        // Translate overlay
        window.i18n.translateDOM(overlay);

        let users = [];
        try {
            users = await API.get('/api/org_users/');
            users = users.filter(u => u.is_active);
        } catch (e) {
            console.error('[Phase9] Erreur chargement utilisateurs', e);
        }

        const badges = document.getElementById('userPickerBadges');
        badges.innerHTML = users.map(u => `
            <div class="user-picker-badge" data-user="${u.name}">
                <div class="user-picker-badge-avatar">👤</div>
                <div class="user-picker-badge-name">${u.name}</div>
            </div>
        `).join('');

        overlay.style.display = 'flex';

        return new Promise(resolve => {
            badges.querySelectorAll('.user-picker-badge').forEach(badge => {
                badge.addEventListener('click', () => {
                    const name = badge.getAttribute('data-user');
                    this.currentUser = name;
                    sessionStorage.setItem('omni_current_user', name);

                    // Fade out overlay
                    overlay.style.transition = 'opacity 0.3s';
                    overlay.style.opacity = '0';
                    setTimeout(async () => {
                        overlay.style.display = 'none';
                        overlay.style.opacity = '1';
                        await this._initUI();
                        resolve();
                    }, 300);
                });
            });
        });
    },

    async _initUserSwitcher() {
        const isOrg = this.config && this.config.enable_org_mode === 'true';
        const switcher = document.getElementById('userSwitcher');
        if (!switcher) return;

        if (!isOrg) {
            switcher.style.display = 'none';
            return;
        }

        switcher.style.display = 'block';

        // Set current user label
        const label = document.getElementById('currentUserLabel');
        if (label) label.textContent = this.currentUser || '—';

        // Toggle menu
        const btn = document.getElementById('userSwitcherBtn');
        const menu = document.getElementById('userSwitcherMenu');

        btn.onclick = async (e) => {
            e.stopPropagation();
            if (menu.style.display === 'none') {
                // Fetch users and populate
                let users = [];
                try {
                    users = await API.get('/api/org_users/');
                    users = users.filter(u => u.is_active);
                } catch (e) { console.error(e); }

                menu.innerHTML = users.map(u => `
                    <div class="user-switcher-item ${u.name === this.currentUser ? 'active' : ''}" data-user="${u.name}">
                        ${u.name === this.currentUser ? '<span class="user-item-dot"></span>' : '<span style="width:8px"></span>'}
                        <span>👤 ${u.name}</span>
                    </div>
                `).join('');

                menu.querySelectorAll('.user-switcher-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const name = item.getAttribute('data-user');
                        this.currentUser = name;
                        sessionStorage.setItem('omni_current_user', name);
                        label.textContent = name;
                        menu.style.display = 'none';
                        if (this.currentView === 'configuration' && window.ConfigView && typeof window.ConfigView.fetchFacts === 'function') {
                            window.ConfigView.fetchFacts();
                        }
                    });
                });

                menu.style.display = 'block';
            } else {
                menu.style.display = 'none';
            }
        };

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!switcher.contains(e.target)) {
                menu.style.display = 'none';
            }
        });
    },

    editCurrentProfile() {
        const activeProf = this.profiles ? this.profiles.find(p => p.id === this.activeProfileId) : null;
        if (!activeProf) return;

        const dropdown = document.getElementById('profileDropdown');
        if (dropdown) dropdown.style.display = 'none';

        if (window.ConfigView && typeof window.ConfigView._showEditProfileModal === 'function') {
            window.ConfigView._showEditProfileModal(activeProf.id, activeProf.name, activeProf.color, activeProf.icon, activeProf.currency, activeProf.pay_cycle_day, activeProf.date_format);
        } else {
            this.loadView('config');
            setTimeout(() => {
                if (window.ConfigView && window.ConfigView._showEditProfileModal) {
                    window.ConfigView._showEditProfileModal(activeProf.id, activeProf.name, activeProf.color, activeProf.icon, activeProf.currency, activeProf.pay_cycle_day, activeProf.date_format);
                }
            }, 250);
        }
    },

    _renderProfileSelector() {
        const container = document.getElementById('profileSelector');
        const btn = document.getElementById('profileBtn');
        const dot = document.getElementById('profileDot');
        const nameEl = document.getElementById('profileName');
        const dropdown = document.getElementById('profileDropdown');

        if (!container || !this.profiles) return;

        container.style.display = 'inline-block';

        const active = this.profiles.find(p => p.id === this.activeProfileId) || this.profiles[0] || { name: 'Mon Profil', color: '#6366f1', icon: '👤' };
        if (dot) dot.style.backgroundColor = active.color || '#6366f1';
        if (nameEl) nameEl.textContent = (active.icon ? active.icon + ' ' : '') + (active.name || 'Mon Profil');

        let html = '';
        this.profiles.forEach(p => {
            const isActive = p.id === this.activeProfileId;
            const lockIcon = p.has_pin ? '<span style="font-size:11px; opacity:0.7;">🔒</span>' : '';
            const activeBadge = isActive ? '<span style="font-size:10px; opacity:0.6; margin-left:4px;">✓</span>' : '';
            const safeName = window.escapeHtml ? window.escapeHtml(p.name) : p.name;
            const pIcon = p.icon || '👤';
            const editBtn = isActive ? `
                <button class="profile-hdr-edit-btn" title="Éditer le profil" style="background:var(--accent-subtle); border:1px solid var(--accent-border); color:var(--text-main); font-size:12px; padding:3px 6px; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s;" onclick="event.stopPropagation(); window.app.editCurrentProfile();">
                    ✏️
                </button>
            ` : '';

            html += `
                <div class="profile-dropdown-item ${isActive ? 'active' : ''}" data-profile-id="${p.id}" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                        <span class="profile-dot" style="background-color:${p.color || '#6366f1'};"></span>
                        <span style="font-size:13px;">${pIcon}</span>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeName}</span>
                        ${activeBadge}
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; margin-left:auto; flex-shrink:0;">
                        ${lockIcon}
                        ${editBtn}
                    </div>
                </div>
            `;
        });

        const addText = window.i18n ? window.i18n.t('profiles_create') : 'Créer un profil';
        html += `
            <div class="profile-dropdown-add" id="profileAddBtn">
                <span>➕</span>
                <span data-i18n="profiles_create">${addText}</span>
            </div>
        `;

        if (this.profiles && active && active.has_pin) {
            html += `
                <div class="profile-dropdown-add" id="profileLockBtn" style="border-top:1px solid var(--border-color); color:var(--text-muted); margin-top:2px;">
                    <span>🔒</span>
                    <span>Verrouiller la session</span>
                </div>
            `;
        }

        dropdown.innerHTML = html;

        btn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'block';
            dropdown.style.display = isOpen ? 'none' : 'block';
        };

        dropdown.querySelectorAll('.profile-dropdown-item').forEach(item => {
            item.onclick = async (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                const targetId = item.getAttribute('data-profile-id');
                if (targetId === this.activeProfileId) return;

                const targetProf = this.profiles.find(p => p.id === targetId);
                if (targetProf && targetProf.has_pin) {
                    this.openProfilePinModal(targetId);
                } else {
                    await this.switchProfile(targetId);
                }
            };
        });

        const addBtn = document.getElementById('profileAddBtn');
        if (addBtn) {
            addBtn.onclick = (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                this.loadView('config');
                setTimeout(() => {
                    if (window.ConfigView && window.ConfigView._showCreateProfileModal) {
                        window.ConfigView._showCreateProfileModal();
                    }
                }, 200);
            };
        }

        const lockBtn = document.getElementById('profileLockBtn');
        if (lockBtn) {
            lockBtn.onclick = (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                this.showLockScreen();
            };
        }

        if (!this._profileClickOutsideBound) {
            this._profileClickOutsideBound = true;
            document.addEventListener('click', () => {
                if (dropdown) dropdown.style.display = 'none';
            });
        }
    },

    // ── Auto-Lock & Lock Screen Manager ──
    initAutoLock() {
        if (!this.profiles || this.profiles.length === 0) return;

        const activeProf = this.profiles.find(p => p.id === this.activeProfileId);
        const activeHasPin = activeProf && activeProf.has_pin;

        // Pas d'auto-verrouillage si le profil actif n'a pas de PIN défini
        if (!activeHasPin) {
            if (this._autoLockTimeout) {
                clearTimeout(this._autoLockTimeout);
                this._autoLockTimeout = null;
            }
            sessionStorage.removeItem('omni_is_locked');
            const overlay = document.getElementById('appLockScreen');
            if (overlay) overlay.style.display = 'none';
            return;
        }

        const isLocked = sessionStorage.getItem('omni_is_locked') === 'true';
        if (isLocked) {
            this.showLockScreen();
        }

        const resetTimer = () => this._resetAutoLockTimer();
        ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
            window.removeEventListener(evt, resetTimer);
            window.addEventListener(evt, resetTimer, { passive: true });
        });
        this._resetAutoLockTimer();
    },

    _resetAutoLockTimer() {
        if (this._autoLockTimeout) clearTimeout(this._autoLockTimeout);
        if (!this.profiles || this.profiles.length === 0) return;

        const activeProf = this.profiles.find(p => p.id === this.activeProfileId);
        if (!activeProf || !activeProf.has_pin) return;

        const minutesStr = window.ProfileStorage ? window.ProfileStorage.get('omni_autolock_minutes') : '5';
        if (minutesStr === 'off') return;

        const minutes = parseInt(minutesStr || '5', 10);
        if (isNaN(minutes) || minutes <= 0) return;

        this._autoLockTimeout = setTimeout(() => {
            console.log(`[AutoLock] Inactivité détectée (${minutes} min). Verrouillage de l'application.`);
            this.showLockScreen();
        }, minutes * 60 * 1000);
    },

    showLockScreen() {
        if (!this.profiles || this.profiles.length === 0) return;

        const activeProf = this.profiles.find(p => p.id === this.activeProfileId);
        if (!activeProf || !activeProf.has_pin) {
            sessionStorage.removeItem('omni_is_locked');
            const overlay = document.getElementById('appLockScreen');
            if (overlay) overlay.style.display = 'none';
            return;
        }

        sessionStorage.setItem('omni_is_locked', 'true');

        const overlay = document.getElementById('appLockScreen');
        const list = document.getElementById('lockScreenProfilesList');
        const pinForm = document.getElementById('lockScreenPinForm');
        const errDiv = document.getElementById('lockScreenError');

        if (errDiv) errDiv.style.display = 'none';
        if (pinForm) pinForm.style.display = 'none';

        if (list) {
            let html = '';
            this.profiles.forEach(p => {
                const isActive = p.id === this.activeProfileId;
                const safeName = window.escapeHtml ? window.escapeHtml(p.name) : p.name;
                const lockBadge = p.has_pin ? '<span style="margin-left:auto; font-size:12px; opacity:0.8;">🔒 Protégé</span>' : '<span style="margin-left:auto; font-size:11px; opacity:0.5;">Accès libre</span>';
                const activeTag = isActive ? '<span style="font-size:11px; font-weight:700; background:rgba(99,102,241,0.2); color:var(--accent); padding:2px 8px; border-radius:12px; margin-left:6px;">Actif</span>' : '';

                html += `
                    <div class="lock-profile-card" data-profile-id="${p.id}" style="display:flex; align-items:center; gap:12px; padding:12px 16px; background:var(--bg-surface); border:1px solid ${isActive ? 'var(--accent)' : 'var(--border-color)'}; border-radius:12px; cursor:pointer; transition:all 0.2s;">
                        <span class="profile-dot" style="background-color:${p.color || '#6366f1'}; width:12px; height:12px; border-radius:50%; flex-shrink:0;"></span>
                        <div style="font-size:14px; font-weight:600; color:var(--text-main); display:flex; align-items:center;">
                            ${safeName} ${activeTag}
                        </div>
                        ${lockBadge}
                    </div>
                `;
            });
            list.innerHTML = html;

            list.querySelectorAll('.lock-profile-card').forEach(card => {
                card.onclick = () => {
                    const profId = card.getAttribute('data-profile-id');
                    this.selectLockProfile(profId);
                };
            });
        }

        if (overlay) overlay.style.display = 'flex';
    },

    selectLockProfile(profId) {
        const target = this.profiles.find(p => p.id === profId);
        if (!target) return;
        this._pendingLockProfileId = profId;

        const pinForm = document.getElementById('lockScreenPinForm');
        const pinInput = document.getElementById('lockScreenPinInput');
        const label = document.getElementById('lockScreenSelectedProfileName');
        const errDiv = document.getElementById('lockScreenError');

        if (errDiv) errDiv.style.display = 'none';

        if (target.has_pin) {
            if (label) label.textContent = `Déverrouiller « ${target.name} »`;
            if (pinInput) pinInput.value = '';
            if (pinForm) pinForm.style.display = 'block';
            setTimeout(() => { if (pinInput) pinInput.focus(); }, 100);
        } else {
            this.submitLockPin(null);
        }
    },

    cancelLockPinInput() {
        const pinForm = document.getElementById('lockScreenPinForm');
        const errDiv = document.getElementById('lockScreenError');
        if (pinForm) pinForm.style.display = 'none';
        if (errDiv) errDiv.style.display = 'none';
        this._pendingLockProfileId = null;
    },

    async submitLockPin(explicitPin = undefined) {
        const pinInput = document.getElementById('lockScreenPinInput');
        const errDiv = document.getElementById('lockScreenError');
        const pin = (explicitPin !== undefined) ? explicitPin : (pinInput ? pinInput.value.trim() : null);

        const targetId = this._pendingLockProfileId || this.activeProfileId;

        try {
            if (errDiv) errDiv.style.display = 'none';
            sessionStorage.removeItem('omni_is_locked');
            await this.switchProfile(targetId, pin);
            const overlay = document.getElementById('appLockScreen');
            if (overlay) overlay.style.display = 'none';
        } catch (e) {
            if (errDiv) {
                errDiv.textContent = e.message || (window.i18n ? window.i18n.t('profiles_pin_wrong') : 'Code PIN incorrect');
                errDiv.style.display = 'block';
            }
        }
    },

    async switchProfile(profileId, pin = null) {
        try {
            // Afficher immédiatement l'overlay de chargement
            const loader = document.getElementById('appInitLoader');
            if (loader) {
                const isEn = (window.i18n && window.i18n.currentLang === 'en') || (localStorage.getItem('site_lang') === 'en');
                const title = document.getElementById('appInitLoaderTitle');
                if (title) title.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('loader_switching_profile_title') : (isEn ? "Switching profile in progress..." : "Changement de profil en cours...");
                const sub = document.getElementById('appInitLoaderSub');
                if (sub) sub.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('loader_switching_profile_sub') : (isEn ? "Loading accounts and data, please wait." : "Chargement des comptes et des données en cours, veuillez patienter.");
                loader.style.display = 'flex';
                loader.style.opacity = '1';
            }
            try {
                sessionStorage.setItem('omni_switching_profile', 'true');
            } catch (_) {}

            const body = pin ? { pin } : {};
            const res = await API.post(`/api/profiles/${profileId}/activate`, body);
            sessionStorage.removeItem('omni_is_locked');
            if (res.ok) {
                // Purge intégrale de sessionStorage pour garantir une étanchéité absolue entre profils
                try {
                    sessionStorage.clear();
                    sessionStorage.setItem('omni_switching_profile', 'true');
                } catch (_) {}

                if (res.reload_required) {
                    window.location.reload();
                } else {
                    window.hideAppInitLoader();
                    const overlay = document.getElementById('appLockScreen');
                    if (overlay) overlay.style.display = 'none';
                }
            }
        } catch (e) {
            window.hideAppInitLoader();
            console.error("Failed to switch profile", e);
            throw e;
        }
    },

    openProfilePinModal(targetProfileId) {
        this._pendingSwitchProfileId = targetProfileId;
        const modal = document.getElementById('profilePinModal');
        const input = document.getElementById('profilePinInput');
        const err = document.getElementById('profilePinError');
        if (modal) {
            if (err) err.style.display = 'none';
            if (input) input.value = '';
            modal.style.display = 'flex';
            setTimeout(() => { if (input) input.focus(); }, 100);
        }
    },

    closeProfilePinModal() {
        this._pendingSwitchProfileId = null;
        const modal = document.getElementById('profilePinModal');
        if (modal) modal.style.display = 'none';
    },

    async submitProfilePin() {
        const input = document.getElementById('profilePinInput');
        const err = document.getElementById('profilePinError');
        const pin = input ? input.value : '';
        if (!pin) return;

        try {
            if (err) err.style.display = 'none';
            await this.switchProfile(this._pendingSwitchProfileId, pin);
        } catch (e) {
            if (err) {
                err.textContent = e.message || (window.i18n ? window.i18n.t('profiles_pin_wrong') : 'Code PIN incorrect');
                err.style.display = 'block';
            }
        }
    }
};

if (window.App) {
    Object.assign(window.App.prototype, window.AppModules.profiles);
}
