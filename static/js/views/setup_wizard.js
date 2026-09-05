// static/js/views/setup_wizard.js — Assistant de démarrage moderne (OmniBank Local v1.1.0+)
// Intègre : Thèmes Bento instantanés, Profil Maître & PIN, Modes d'entrée, Cold-Start Salaire & Reste à Vivre, Sauvegarde auto, Détection IA & Démo

window.SetupWizard = {
    currentStep: 0,
    totalSteps: 7,
    createdAccounts: [],
    _mainAccountId: null,
    _orgUsers: [],
    _orgMode: false,
    entryMode: 'manual',      // 'manual' | 'import' | 'sync'
    preferredHome: 'dashboard',// 'dashboard' | 'overview'
    _selectedTheme: 'dark',
    _activeProfileId: 'default',
    _activeProfileName: '',
    overlay: null,

    async checkAndShow() {
        try {
            const data = await API.get('/api/setup/status');
            if (data.needs_setup) {
                await this.show();
                return true;
            }
        } catch (e) {
            console.error('[SetupWizard] Échec de vérification du statut', e);
        }
        return false;
    },

    async show() {
        this.currentStep = 0;
        this.entryMode = 'manual';
        this.preferredHome = 'dashboard';

        // 1. Charger les comptes existants pour ne pas écraser si re-lancement
        try {
            const accounts = await API.get('/api/accounts/');
            this.createdAccounts = (accounts || []).filter(a => !a.is_closed);
        } catch (e) {
            this.createdAccounts = [];
        }

        // 2. Récupérer le mode organisation et la config
        const cfg = window.app?.config || {};
        this._orgMode = cfg.enable_org_mode === 'true';
        this.preferredHome = cfg.enable_overview === 'true' ? 'overview' : 'dashboard';

        // 3. Récupérer le compte principal
        try {
            const mainAcc = await API.get('/api/stats/main_account');
            this._mainAccountId = mainAcc?.id || null;
        } catch (e) {
            this._mainAccountId = null;
        }

        // 4. Récupérer le profil maître actif
        try {
            const pData = await API.get('/api/profiles/');
            this._activeProfileId = pData.active_profile_id || 'default';
            const prof = (pData.profiles || []).find(p => p.id === this._activeProfileId);
            this._activeProfileName = prof ? prof.name : 'Finances Personnelles';
        } catch (e) {
            this._activeProfileId = 'default';
            this._activeProfileName = 'Finances Personnelles';
        }

        // 5. Thème actuel
        if (window.ThemeManager) {
            this._selectedTheme = window.ThemeManager.currentThemeId || 'dark';
        }

        this._buildOverlay();
        this._renderStep();
    },

    dismiss() {
        if (this.overlay) {
            this.overlay.classList.add('wizard-fade-out');
            setTimeout(() => {
                this.overlay.remove();
                this.overlay = null;

                // Rediriger selon le mode d'entrée choisi lors du wizard
                if (window.app && typeof window.app._initUI === 'function' && !window.app._uiInitialized) {
                    window.app._initUI();
                } else if (window.app) {
                    window.app.refreshSidebar();
                    if (this.entryMode === 'import' && window.BankSyncView && typeof window.BankSyncView.openReviewModal === 'function') {
                        window.app.loadView(this.preferredHome);
                        setTimeout(() => {
                            const btnImport = document.getElementById('btnImportStatement') || document.querySelector('button[onclick*="import"]');
                            if (btnImport) btnImport.click();
                        }, 250);
                    } else if (this.entryMode === 'sync') {
                        window.app.loadView('accounts');
                    } else {
                        window.app.loadView(this.preferredHome);
                    }
                }
            }, 350);
        }
    },

    _buildOverlay() {
        if (this.overlay) this.overlay.remove();

        const el = document.createElement('div');
        el.id = 'setupWizardOverlay';
        el.className = 'wizard-overlay';
        el.innerHTML = `
            <button id="wizardSkipBtn" class="wizard-skip-btn" onclick="window.SetupWizard.dismiss()">
                ✕ <span data-i18n="wizard_skip">${window.i18n.t('wizard_skip')}</span>
            </button>
            <div class="wizard-container">
                <div class="wizard-progress" id="wizardProgress"></div>
                <div class="wizard-body" id="wizardBody"></div>
            </div>
        `;
        document.body.appendChild(el);
        this.overlay = el;

        requestAnimationFrame(() => el.classList.add('wizard-visible'));
    },

    _renderProgress() {
        const bar = document.getElementById('wizardProgress');
        if (!bar) return;
        // 7 étapes symétriques (l'étape 3 est "Membres" en mode Org, ou "Salaire" en mode standard)
        const icons = this._orgMode
            ? ['👋', '🔒', '🏦', '👥', '📝', '🤖', '🚀']
            : ['👋', '🔒', '🏦', '💰', '📝', '🤖', '🚀'];

        bar.innerHTML = icons.map((ic, i) => `
            <div class="wizard-step-dot ${i < this.currentStep ? 'done' : ''} ${i === this.currentStep ? 'active' : ''}">
                <span class="wizard-dot-icon">${ic}</span>
                <span class="wizard-dot-line"></span>
            </div>
        `).join('');
    },

    _renderStep() {
        this._renderProgress();
        const body = document.getElementById('wizardBody');
        if (!body) return;

        body.classList.remove('wizard-step-enter');
        void body.offsetWidth; // Force reflow
        body.classList.add('wizard-step-enter');

        switch (this.currentStep) {
            case 0: this._stepWelcome(body); break;
            case 1: this._stepProfileSecurity(body); break;
            case 2: this._stepAccounts(body); break;
            case 3:
                if (this._orgMode) {
                    this._stepUsers(body);
                } else {
                    this._stepPayDay(body);
                }
                break;
            case 4: this._stepGuide(body); break;
            case 5: this._stepAI(body); break;
            case 6: this._stepConfirm(body); break;
        }

        window.i18n.translateDOM(body);
    },

    _nav(direction) {
        const maxStep = this.totalSteps - 1;
        this.currentStep = Math.max(0, Math.min(maxStep, this.currentStep + direction));
        this._renderStep();
    },

    // ── Étape 0 : Bienvenue, Langue & Thème ────────────────────────
    _stepWelcome(body) {
        const isOrg = this._orgMode || false;
        const themes = [
            { id: 'dark', icon: '🌙', nameKey: 'wizard_theme_dark', bg: '#161c24', accent: '#6366f1' },
            { id: 'light', icon: '☀️', nameKey: 'wizard_theme_light', bg: '#f4f6f8', accent: '#6366f1' },
            { id: 'titanium-dark', icon: '🌌', nameKey: 'wizard_theme_titanium_dark', bg: '#21252d', accent: '#60a5fa' },
            { id: 'titanium-light', icon: '❄️', nameKey: 'wizard_theme_titanium_light', bg: '#f7f5f0', accent: '#c25e00' }
        ];

        body.innerHTML = `
            <div class="wizard-step-content wizard-center">
                <div class="wizard-logo-anim">
                    <img src="/static/img/logo.png" alt="OmniBank Logo" style="width: 72px; height: 72px; border-radius: 18px; object-fit: cover; box-shadow: 0 4px 16px rgba(0,0,0,0.25);">
                </div>
                <h1 class="wizard-title" data-i18n="wizard_welcome_title">${window.i18n.t('wizard_welcome_title')}</h1>
                <p class="wizard-subtitle" data-i18n="wizard_welcome_desc">${window.i18n.t('wizard_welcome_desc')}</p>

                <!-- Langue -->
                <div class="wizard-lang-picker">
                    <button class="wizard-lang-btn ${window.i18n.lang === 'fr' ? 'active' : ''}" onclick="window.SetupWizard._setLang('fr')">
                        <span class="fi fi-fr"></span> Français
                    </button>
                    <button class="wizard-lang-btn ${window.i18n.lang === 'en' ? 'active' : ''}" onclick="window.SetupWizard._setLang('en')">
                        <span class="fi fi-gb"></span> English
                    </button>
                </div>

                <!-- Thème visuel interactif immédiat -->
                <div style="margin-top: 18px; width: 100%; max-width: 440px;">
                    <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="wizard_theme_title">
                        ${window.i18n.t('wizard_theme_title') || 'Thème d\'affichage'}
                    </label>
                    <div class="wizard-theme-picker">
                        ${themes.map(t => {
                            const isActive = this._selectedTheme === t.id;
                            const title = window.i18n.t(t.nameKey) || t.id;
                            return `
                                <div class="wizard-theme-card ${isActive ? 'active' : ''}" onclick="window.SetupWizard._selectTheme('${t.id}')">
                                    <span class="wizard-theme-icon">${t.icon}</span>
                                    <div class="wizard-theme-info">
                                        <span class="wizard-theme-name">${title}</span>
                                        <div class="wizard-theme-dots">
                                            <span class="wizard-theme-dot" style="background: ${t.bg};"></span>
                                            <span class="wizard-theme-dot" style="background: ${t.accent};"></span>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Devise Globale -->
                <div style="margin-top: 12px; text-align: center;">
                    <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_base_currency_label">
                        ${window.i18n.t('config_base_currency_label') || 'Devise Principale Globale'}
                    </label>
                    <select id="wizBaseCurrency" class="wizard-input" style="margin-top: 5px; text-align: center; max-width: 220px; margin-left: auto; margin-right: auto; display: block;">
                        <option value="EUR" ${(window.appBaseCurrency || 'EUR') === 'EUR' ? 'selected' : ''}>EUR (€) - Euro</option>
                        <option value="USD" ${window.appBaseCurrency === 'USD' ? 'selected' : ''}>USD ($) - Dollar US</option>
                        <option value="GBP" ${window.appBaseCurrency === 'GBP' ? 'selected' : ''}>GBP (£) - Livre Sterling</option>
                        <option value="CHF" ${window.appBaseCurrency === 'CHF' ? 'selected' : ''}>CHF - Franc Suisse</option>
                        <option value="CAD" ${window.appBaseCurrency === 'CAD' ? 'selected' : ''}>CAD (CA$) - Dollar Canadien</option>
                        <option value="JPY" ${window.appBaseCurrency === 'JPY' ? 'selected' : ''}>JPY (¥) - Yen Japonais</option>
                    </select>
                </div>

                <!-- Mode Organisation -->
                <div class="wizard-org-toggle">
                    <label class="wizard-ai-toggle-row" style="justify-content:center; gap:14px;">
                        <span>🏢</span>
                        <span data-i18n="wizard_org_mode">${window.i18n.t('wizard_org_mode')}</span>
                        <div class="wizard-toggle">
                            <input type="checkbox" id="wizOrgToggle" ${isOrg ? 'checked' : ''} onchange="window.SetupWizard._orgMode = this.checked">
                            <span class="wizard-toggle-slider"></span>
                        </div>
                    </label>
                    <p class="wizard-hint" data-i18n="wizard_org_mode_hint">${window.i18n.t('wizard_org_mode_hint')}</p>
                </div>

                <button class="wizard-btn-primary" onclick="window.SetupWizard._saveStepWelcome()">
                    ${window.i18n.t('wizard_btn_start')} →
                </button>
            </div>
        `;
    },

    _selectTheme(themeId) {
        this._selectedTheme = themeId;
        if (window.ThemeManager) {
            window.ThemeManager.applyTheme(themeId);
        }
        // Rafraîchir les cartes sans re-render complet pour conserver le scroll
        document.querySelectorAll('.wizard-theme-card').forEach((card, i) => {
            const themes = ['dark', 'light', 'titanium-dark', 'titanium-light'];
            card.classList.toggle('active', themes[i] === themeId);
        });
    },

    async _setLang(lang) {
        await window.i18n.setLang(lang);
        const flag = document.getElementById('currentLangFlag');
        if (flag) flag.className = `fi fi-${lang === 'en' ? 'gb' : 'fr'}`;
        this._renderStep();
    },

    async _saveStepWelcome() {
        this._orgMode = document.getElementById('wizOrgToggle')?.checked || false;
        const baseCurr = document.getElementById('wizBaseCurrency')?.value || 'EUR';

        // Contrôle de licence si mode organisation activé
        if (this._orgMode && window.LicenseManager) {
            const status = await window.LicenseManager.getStatus();
            if (!status.active) {
                const activated = await window.LicenseManager.open();
                if (!activated) {
                    this._orgMode = false;
                    const chk = document.getElementById('wizOrgToggle');
                    if (chk) chk.checked = false;
                    return;
                }
            }
        }

        try {
            const val = this._orgMode ? 'true' : 'false';
            await API.post('/api/config/', { enable_org_mode: val, base_currency: baseCurr });
            window.appBaseCurrency = baseCurr;
            if (window.app) {
                if (!window.app.config) window.app.config = {};
                window.app.config.enable_org_mode = val;
                window.app.config.base_currency = baseCurr;
            }
        } catch (e) {
            console.error('[SetupWizard] Erreur sauvegarde mode org & devise', e);
        }

        this._nav(1);
    },

    // ── Étape 1 : Profil Maître & Sécurité ─────────────────────────
    _stepProfileSecurity(body) {
        body.innerHTML = `
            <div class="wizard-step-content">
                <h2 class="wizard-step-title">🔒 ${window.i18n.t('wizard_profile_title') || 'Profil Maître & Sécurité'}</h2>
                <p class="wizard-step-desc">${window.i18n.t('wizard_profile_desc') || 'Nommez votre espace et protégez vos données financières locales.'}</p>

                <!-- Nom du profil -->
                <div class="wizard-profile-card">
                    <div class="wizard-form-field">
                        <label style="font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">
                            ${window.i18n.t('wizard_profile_name_label') || 'Nom du profil maître'}
                        </label>
                        <input type="text" id="wizProfileName" class="wizard-input" value="${this._activeProfileName || 'Finances Personnelles'}" placeholder="${window.i18n.t('wizard_profile_name_ph') || 'ex: Finances Personnelles, Foyer...'}">
                    </div>
                </div>

                <!-- Verrouillage PIN optionnel -->
                <div class="wizard-profile-card">
                    <label class="wizard-ai-toggle-row">
                        <span style="font-weight: 600; font-size: 13.5px;">🔑 ${window.i18n.t('wizard_profile_pin_enable') || 'Protéger ce profil par un code PIN'}</span>
                        <div class="wizard-toggle">
                            <input type="checkbox" id="wizPinToggle" onchange="document.getElementById('wizPinContainer').style.display = this.checked ? 'block' : 'none';">
                            <span class="wizard-toggle-slider"></span>
                        </div>
                    </label>

                    <div id="wizPinContainer" style="display: none; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                        <div class="wizard-pin-inputs">
                            <div class="wizard-pin-field">
                                <label>${window.i18n.t('wizard_profile_pin_label') || 'Code PIN (4 à 6 chiffres)'}</label>
                                <input type="password" id="wizPinInput" class="wizard-input" maxlength="6" placeholder="••••" style="text-align: center; letter-spacing: 4px; font-size: 16px;">
                            </div>
                            <div class="wizard-pin-field">
                                <label>${window.i18n.t('wizard_profile_pin_confirm_label') || 'Confirmer le code PIN'}</label>
                                <input type="password" id="wizPinConfirmInput" class="wizard-input" maxlength="6" placeholder="••••" style="text-align: center; letter-spacing: 4px; font-size: 16px;">
                            </div>
                        </div>
                        <p class="wizard-hint" style="margin-top: 8px;">
                            💡 En cas d'inactivité de plus de 5 minutes, OmniBank verrouillera l'écran pour protéger vos données.
                        </p>
                    </div>
                </div>

                <!-- Sauvegarde automatique locale -->
                <div class="wizard-profile-card">
                    <label class="wizard-ai-toggle-row">
                        <div>
                            <span style="font-weight: 600; font-size: 13.5px;">💾 ${window.i18n.t('wizard_autobackup_enable') || 'Sauvegarde automatique locale (recommandé)'}</span>
                            <p style="font-size: 11.5px; color: var(--text-muted); margin: 3px 0 0 0;">${window.i18n.t('wizard_autobackup_hint') || 'Crée des sauvegardes ZIP horodatées chaque semaine sur votre disque.'}</p>
                        </div>
                        <div class="wizard-toggle">
                            <input type="checkbox" id="wizAutoBackupToggle" checked>
                            <span class="wizard-toggle-slider"></span>
                        </div>
                    </label>
                </div>

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._saveProfileSecurity()">
                        ${window.i18n.t('wizard_btn_next')} →
                    </button>
                </div>
            </div>
        `;
    },

    async _saveProfileSecurity() {
        const name = document.getElementById('wizProfileName')?.value.trim();
        const pinEnabled = document.getElementById('wizPinToggle')?.checked;
        const pin = document.getElementById('wizPinInput')?.value.trim();
        const pinConfirm = document.getElementById('wizPinConfirmInput')?.value.trim();
        const autoBackup = document.getElementById('wizAutoBackupToggle')?.checked;

        // Validation PIN si activé
        if (pinEnabled) {
            if (!pin || pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
                showToast(window.i18n.t('wizard_profile_pin_len_error') || 'Le code PIN doit comporter entre 4 et 6 chiffres.', 'error');
                return;
            }
            if (pin !== pinConfirm) {
                showToast(window.i18n.t('wizard_profile_pin_mismatch') || 'Les deux codes PIN saisis ne correspondent pas.', 'error');
                return;
            }
        }

        // Sauvegarder le nom du profil
        if (name && name !== this._activeProfileName) {
            try {
                await API.put(`/api/profiles/${this._activeProfileId}`, { name });
                this._activeProfileName = name;
            } catch (e) {
                console.warn('[SetupWizard] Erreur mise à jour profil', e);
            }
        }

        // Sauvegarder le code PIN
        if (pinEnabled && pin) {
            try {
                await API.post(`/api/profiles/${this._activeProfileId}/pin`, { pin });
                showToast('Code PIN configuré avec succès', 'success');
            } catch (e) {
                console.warn('[SetupWizard] Erreur enregistrement PIN', e);
            }
        }

        // Sauvegarder l'auto-backup
        try {
            await API.post('/api/config/', {
                auto_backup_enabled: autoBackup ? 'true' : 'false',
                auto_backup_frequency: 'weekly',
                auto_backup_retention: '10'
            });
        } catch (e) {
            console.warn('[SetupWizard] Erreur auto backup', e);
        }

        this._nav(1);
    },

    // ── Étape 2 : Mode d'entrée & Comptes ──────────────────────────
    _stepAccounts(body) {
        const isManual = this.entryMode === 'manual';
        const isImport = this.entryMode === 'import';
        const isSync = this.entryMode === 'sync';

        body.innerHTML = `
            <div class="wizard-step-content">
                <h2 class="wizard-step-title">🏦 ${window.i18n.t('wizard_accounts_title')}</h2>
                <p class="wizard-step-desc">${window.i18n.t('wizard_accounts_desc')}</p>

                <!-- Choix du mode d'entrée -->
                <div class="wizard-entry-grid">
                    <div class="wizard-entry-tile ${isManual ? 'active' : ''}" onclick="window.SetupWizard._setEntryMode('manual')">
                        <div class="wizard-entry-icon">✍️</div>
                        <div class="wizard-entry-title">${window.i18n.t('wizard_entry_manual') || 'Saisie manuelle'}</div>
                        <div class="wizard-entry-desc">${window.i18n.t('wizard_entry_manual_desc') || 'Créez vos comptes un par un avec leur solde initial.'}</div>
                    </div>
                    <div class="wizard-entry-tile ${isImport ? 'active' : ''}" onclick="window.SetupWizard._setEntryMode('import')">
                        <div class="wizard-entry-icon">📥</div>
                        <div class="wizard-entry-title">${window.i18n.t('wizard_entry_import') || 'Importer un relevé'}</div>
                        <div class="wizard-entry-desc">${window.i18n.t('wizard_entry_import_desc') || 'Chargez directement votre premier fichier (CSV, Excel, OFX).'}</div>
                    </div>
                    <div class="wizard-entry-tile ${isSync ? 'active' : ''}" onclick="window.SetupWizard._setEntryMode('sync')">
                        <div class="wizard-entry-icon">⚡</div>
                        <div class="wizard-entry-title">${window.i18n.t('wizard_entry_sync') || 'Synchroniser en ligne'}</div>
                        <div class="wizard-entry-desc">${window.i18n.t('wizard_entry_sync_desc') || 'Connectez votre banque via le connecteur sécurisé.'}</div>
                    </div>
                </div>

                <!-- Formulaire manuel (si manual sélectionné) -->
                <div id="wizManualAccountSection" style="${isManual ? 'display:block;' : 'display:none;'}">
                    <div class="wizard-account-form">
                        <div class="wizard-form-row">
                            <div class="wizard-form-field" style="flex:2;">
                                <label data-i18n="wizard_acc_name">${window.i18n.t('wizard_acc_name')}</label>
                                <input type="text" id="wizAccName" class="wizard-input" placeholder="${window.i18n.t('wizard_acc_name_ph')}">
                            </div>
                            <div class="wizard-form-field" style="flex:1;">
                                <label data-i18n="wizard_acc_type">${window.i18n.t('wizard_acc_type')}</label>
                                <select id="wizAccType" class="wizard-input">
                                    <option value="Compte courant">${window.i18n.t('wizard_type_checking')}</option>
                                    <option value="Livret">${window.i18n.t('wizard_type_savings')}</option>
                                    <option value="PEA">${window.i18n.t('wizard_type_pea')}</option>
                                    <option value="Assurance Vie">${window.i18n.t('wizard_type_life_ins')}</option>
                                    <option value="PER">${window.i18n.t('wizard_type_per')}</option>
                                    <option value="Autre">${window.i18n.t('wizard_type_other')}</option>
                                </select>
                            </div>
                            <div class="wizard-form-field" style="flex:0.8;">
                                <label data-i18n="acc_th_currency">${window.i18n.t('acc_th_currency') || 'Devise'}</label>
                                <select id="wizAccCurrency" class="wizard-input">
                                    <option value="EUR" ${(window.appBaseCurrency || 'EUR') === 'EUR' ? 'selected' : ''}>EUR (€)</option>
                                    <option value="USD" ${window.appBaseCurrency === 'USD' ? 'selected' : ''}>USD ($)</option>
                                    <option value="GBP" ${window.appBaseCurrency === 'GBP' ? 'selected' : ''}>GBP (£)</option>
                                    <option value="CHF" ${window.appBaseCurrency === 'CHF' ? 'selected' : ''}>CHF</option>
                                    <option value="CAD" ${window.appBaseCurrency === 'CAD' ? 'selected' : ''}>CAD (CA$)</option>
                                    <option value="JPY" ${window.appBaseCurrency === 'JPY' ? 'selected' : ''}>JPY (¥)</option>
                                </select>
                            </div>
                            <div class="wizard-form-field" style="flex:1;">
                                <label data-i18n="wizard_acc_balance">${window.i18n.t('wizard_acc_balance')}</label>
                                <input type="number" id="wizAccBalance" class="wizard-input" step="0.01" placeholder="0.00">
                            </div>
                        </div>
                        <button class="wizard-btn-secondary" onclick="window.SetupWizard._addAccount()">
                            + ${window.i18n.t('wizard_btn_add_account')}
                        </button>
                    </div>

                    <div id="wizAccountsList" class="wizard-accounts-list">
                        ${this._renderAccountsList()}
                    </div>
                </div>

                <!-- Message d'information si Import ou Synchro -->
                <div id="wizAlternativeEntryNotice" style="${!isManual ? 'display:block;' : 'display:none;'}; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 12px; padding: 18px; margin: 16px 0; text-align: left;">
                    <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px; color: var(--accent);">
                        ${isImport ? '📄 Importation immédiate à la fin du wizard' : '🔒 Relevé automatique en ligne préparé'}
                    </div>
                    <p style="font-size: 12.5px; color: var(--text-muted); margin: 0; line-height: 1.5;">
                        ${isImport
                            ? 'Dès la fin de l\'assistant, le cockpit d\'importation s\'ouvrira pour charger votre fichier. Vos comptes seront détectés automatiquement à partir des lignes du relevé.'
                            : 'Dès la fin de l\'assistant, vous serez redirigé vers l\'espace de synchronisation pour configurer votre banque via le coffre-fort sécurisé.'}
                    </p>
                </div>

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._goFromAccounts()" ${isManual && this.createdAccounts.length === 0 ? 'disabled' : ''}>
                        ${window.i18n.t('wizard_btn_next')} →
                    </button>
                </div>
            </div>
        `;
    },

    _setEntryMode(mode) {
        this.entryMode = mode;
        const isManual = mode === 'manual';
        const manualSec = document.getElementById('wizManualAccountSection');
        const altNotice = document.getElementById('wizAlternativeEntryNotice');
        if (manualSec) manualSec.style.display = isManual ? 'block' : 'none';
        if (altNotice) {
            altNotice.style.display = !isManual ? 'block' : 'none';
            altNotice.innerHTML = `
                <div style="font-weight: 700; font-size: 14px; margin-bottom: 6px; color: var(--accent);">
                    ${mode === 'import' ? '📄 Importation immédiate à la fin du wizard' : '🔒 Relevé automatique en ligne préparé'}
                </div>
                <p style="font-size: 12.5px; color: var(--text-muted); margin: 0; line-height: 1.5;">
                    ${mode === 'import'
                        ? 'Dès la fin de l\'assistant, le cockpit d\'importation s\'ouvrira pour charger votre fichier. Vos comptes seront détectés automatiquement à partir des lignes du relevé.'
                        : 'Dès la fin de l\'assistant, vous serez redirigé vers l\'espace de synchronisation pour configurer votre banque via le coffre-fort sécurisé.'}
                </p>
            `;
        }

        document.querySelectorAll('.wizard-entry-tile').forEach(t => t.classList.remove('active'));
        event.currentTarget?.classList.add('active');

        // Mettre à jour le statut du bouton Suivant
        const nextBtn = document.querySelector('.wizard-nav .wizard-btn-primary');
        if (nextBtn) {
            nextBtn.disabled = isManual && this.createdAccounts.length === 0;
        }
    },

    _renderAccountsList() {
        if (this.createdAccounts.length === 0) {
            return `<p class="wizard-empty-hint" data-i18n="wizard_no_accounts">${window.i18n.t('wizard_no_accounts')}</p>`;
        }
        return this.createdAccounts.map((acc, i) => {
            const isMain = acc.id === this._mainAccountId;
            const curr = acc.currency || window.appBaseCurrency || 'EUR';
            return `
            <div class="wizard-account-card">
                <button class="wizard-star-btn ${isMain ? 'active' : ''}" onclick="window.SetupWizard._setMainAccount(${acc.id})" title="${window.i18n.t('acc_set_main')}">${isMain ? '⭐' : '☆'}</button>
                <div class="wizard-account-info">
                    <strong>${acc.name}</strong>
                    <span class="wizard-account-type">${acc.type} <small style="opacity:0.8;">(${curr})</small></span>
                </div>
                <div class="wizard-account-balance">${formatCurrency(acc.initial_balance, curr)}</div>
                <button class="wizard-btn-remove" onclick="window.SetupWizard._removeAccount(${i})">✕</button>
            </div>
            `;
        }).join('');
    },

    async _addAccount() {
        const name = document.getElementById('wizAccName').value.trim();
        const type = document.getElementById('wizAccType').value;
        const balance = parseFloat(document.getElementById('wizAccBalance').value) || 0;
        const currency = document.getElementById('wizAccCurrency')?.value || window.appBaseCurrency || 'EUR';

        if (!name) {
            showToast(window.i18n.t('wizard_toast_name_required'), 'error');
            return;
        }
        if (this.createdAccounts.some(a => a.name.toLowerCase() === name.toLowerCase())) {
            showToast(window.i18n.t('wizard_toast_duplicate'), 'error');
            return;
        }

        try {
            const palette = (typeof ACCOUNT_COLORS !== 'undefined') ? ACCOUNT_COLORS : ['#3366ff','#36b37e','#ff5630','#ffab00','#00b8d9','#6554c0','#ff8a65','#e91e8a','#8bc34a','#795548'];
            const usedColors = this.createdAccounts.map(a => a.color).filter(Boolean);
            let color = palette.find(c => !usedColors.includes(c)) || palette[this.createdAccounts.length % palette.length];
            const created = await API.post('/api/accounts/', { name, type, initial_balance: balance, is_closed: false, color, currency });
            this.createdAccounts.push(created);

            document.getElementById('wizAccountsList').innerHTML = this._renderAccountsList();
            document.getElementById('wizAccName').value = '';
            document.getElementById('wizAccBalance').value = '';
            document.getElementById('wizAccName').focus();

            const nextBtn = document.querySelector('.wizard-nav .wizard-btn-primary');
            if (nextBtn) nextBtn.disabled = false;

            if (this.createdAccounts.length === 1 && !this._mainAccountId) {
                await this._setMainAccount(created.id);
            }
            showToast(window.i18n.t('wizard_toast_account_added'), 'success');
        } catch (e) {
            console.error('[SetupWizard] Erreur création compte', e);
            showToast(window.i18n.t('wizard_toast_account_error'), 'error');
        }
    },

    async _removeAccount(index) {
        const acc = this.createdAccounts[index];
        try {
            await API.del(`/api/accounts/${acc.id}`);
            this.createdAccounts.splice(index, 1);
            document.getElementById('wizAccountsList').innerHTML = this._renderAccountsList();
            const nextBtn = document.querySelector('.wizard-nav .wizard-btn-primary');
            if (nextBtn && this.entryMode === 'manual') {
                nextBtn.disabled = this.createdAccounts.length === 0;
            }
        } catch (e) {
            console.error('[SetupWizard] Erreur suppression compte', e);
        }
    },

    async _setMainAccount(id) {
        try {
            await API.post(`/api/stats/main_account/${id}`);
            this._mainAccountId = id;
            document.getElementById('wizAccountsList').innerHTML = this._renderAccountsList();
        } catch (e) {
            console.error('[SetupWizard] Erreur compte principal', e);
        }
    },

    async _goFromAccounts() {
        // Si le mode est Import ou Synchro et qu'aucun compte n'a encore été créé manuellement,
        // on crée un compte courant par défaut transparent pour préparer le terrain
        if (this.entryMode !== 'manual' && this.createdAccounts.length === 0) {
            try {
                const defAcc = await API.post('/api/accounts/', {
                    name: 'Compte Courant',
                    type: 'Compte courant',
                    initial_balance: 0.0,
                    is_closed: false,
                    color: '#3366ff',
                    currency: window.appBaseCurrency || 'EUR'
                });
                this.createdAccounts.push(defAcc);
                await this._setMainAccount(defAcc.id);
            } catch (e) {
                console.warn('[SetupWizard] Erreur création compte courant par défaut', e);
            }
        }

        if (this.createdAccounts.length === 0 && this.entryMode === 'manual') {
            showToast(window.i18n.t('wizard_toast_need_account'), 'error');
            return;
        }

        this._nav(1);
    },

    // ── Étape 3 (Mode Org) : Utilisateurs ──────────────────────────
    async _stepUsers(body) {
        try { await API.post('/api/org_users/ensure_default'); } catch(e) {}
        try { this._orgUsers = await API.get('/api/org_users/'); } catch(e) { this._orgUsers = []; }

        body.innerHTML = `
            <div class="wizard-step-content">
                <h2 class="wizard-step-title">👥 ${window.i18n.t('wizard_users_title')}</h2>
                <p class="wizard-step-desc">${window.i18n.t('wizard_users_desc')}</p>

                <div class="wizard-account-form">
                    <div class="wizard-form-row">
                        <div class="wizard-form-field" style="flex:2;">
                            <label data-i18n="ph_user_name">${window.i18n.t('ph_user_name')}</label>
                            <input type="text" id="wizUserName" class="wizard-input" placeholder="${window.i18n.t('ph_user_name')}">
                        </div>
                    </div>
                    <button class="wizard-btn-secondary" onclick="window.SetupWizard._addWizUser()">
                        + ${window.i18n.t('btn_add_user')}
                    </button>
                </div>

                <div id="wizUsersList" class="wizard-accounts-list">
                    ${this._renderWizUsersList()}
                </div>

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._nav(1)">
                        ${window.i18n.t('wizard_btn_next')} →
                    </button>
                </div>
            </div>
        `;
        setTimeout(() => {
            const el = document.getElementById('wizUserName');
            if (el) el.focus();
        }, 100);
    },

    _renderWizUsersList() {
        if (!this._orgUsers || this._orgUsers.length === 0) {
            return '<p class="wizard-empty-hint">—</p>';
        }
        return this._orgUsers.filter(u => u.is_active).map(u => `
            <div class="wizard-account-card">
                <div class="wizard-account-info">
                    <strong>👤 ${u.name}</strong>
                </div>
                <button class="wizard-btn-remove" onclick="window.SetupWizard._removeWizUser(${u.id})">✕</button>
            </div>
        `).join('');
    },

    async _addWizUser() {
        const input = document.getElementById('wizUserName');
        const name = input?.value.trim();
        if (!name) { showToast(window.i18n.t('wizard_toast_name_required'), 'error'); return; }
        if (this._orgUsers.some(u => u.name.toLowerCase() === name.toLowerCase())) {
            showToast(window.i18n.t('wizard_toast_duplicate'), 'error'); return;
        }
        try {
            const created = await API.post('/api/org_users/', { name });
            this._orgUsers.push(created);
            document.getElementById('wizUsersList').innerHTML = this._renderWizUsersList();
            input.value = '';
            input.focus();
            showToast(window.i18n.t('toast_user_added'), 'success');
        } catch(e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    async _removeWizUser(id) {
        try {
            await API.put(`/api/org_users/${id}`, { is_active: false });
            this._orgUsers = this._orgUsers.filter(u => u.id !== id);
            document.getElementById('wizUsersList').innerHTML = this._renderWizUsersList();
            showToast(window.i18n.t('toast_user_deactivated'), 'success');
        } catch(e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    // ── Étape 3 (Mode Standard) : Salaire & Reste à Vivre Cold-Start ──
    _stepPayDay(body) {
        body.innerHTML = `
            <div class="wizard-step-content wizard-center">
                <h2 class="wizard-step-title">💰 ${window.i18n.t('wizard_pay_title')}</h2>
                <p class="wizard-step-desc" data-i18n="wizard_pay_desc">${window.i18n.t('wizard_pay_desc')}</p>

                <!-- Jour de paie -->
                <div class="wizard-pay-input-group">
                    <label data-i18n="wizard_pay_day_label">${window.i18n.t('wizard_pay_day_label')}</label>
                    <input type="number" id="wizPayDay" class="wizard-input wizard-pay-input" min="1" max="31" placeholder="ex: 28" value="28">
                </div>

                <!-- Montant net estimé (Cold-start Reste à Vivre) -->
                <div class="wizard-pay-input-group" style="margin-top: 14px;">
                    <label>${window.i18n.t('wizard_pay_amount_label') || 'Montant net mensuel estimé'}</label>
                    <input type="number" id="wizPayAmount" class="wizard-input wizard-pay-input" step="0.01" placeholder="${window.i18n.t('wizard_pay_amount_ph') || 'ex: 2500.00'}">
                    <p class="wizard-hint" style="margin-top: 5px; font-size: 11.5px;">
                        ${window.i18n.t('wizard_pay_amount_hint') || 'Initialise immédiatement votre Reste à Vivre et vos projections sans attendre le mois prochain.'}
                    </p>
                </div>

                <!-- Option bimensuelle -->
                <label class="wizard-bimonthly-toggle" style="display:flex; align-items:center; gap:10px; margin:16px 0; cursor:pointer; font-size:13px; font-weight:600;">
                    <div class="wizard-toggle">
                        <input type="checkbox" id="wizBimonthlyToggle" onchange="window.SetupWizard._toggleBimonthly()">
                        <span class="wizard-toggle-slider"></span>
                    </div>
                    <span data-i18n="wizard_pay_bimonthly">${window.i18n.t('wizard_pay_bimonthly')}</span>
                </label>

                <div id="wizPayDay2Group" class="wizard-pay-input-group" style="display:none;">
                    <label data-i18n="wizard_pay_day2_label">${window.i18n.t('wizard_pay_day2_label')}</label>
                    <input type="number" id="wizPayDay2" class="wizard-input wizard-pay-input" min="1" max="31" placeholder="ex: 10">
                </div>

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(1)" data-i18n="wizard_btn_skip_step">${window.i18n.t('wizard_btn_skip_step')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._savePayDay()">
                        ${window.i18n.t('wizard_btn_next')} →
                    </button>
                </div>
            </div>
        `;

        const cfg = window.app?.config || {};
        if (cfg.base_pay_day) {
            const el = document.getElementById('wizPayDay');
            if (el) el.value = cfg.base_pay_day;
        }
        if (cfg.base_pay_amount) {
            const elAmt = document.getElementById('wizPayAmount');
            if (elAmt) elAmt.value = cfg.base_pay_amount;
        }
        if (cfg.base_pay_type === 'bimonthly') {
            const toggle = document.getElementById('wizBimonthlyToggle');
            if (toggle) { toggle.checked = true; this._toggleBimonthly(); }
            if (cfg.base_pay_day_2) {
                const el2 = document.getElementById('wizPayDay2');
                if (el2) el2.value = cfg.base_pay_day_2;
            }
        }
    },

    _toggleBimonthly() {
        const checked = document.getElementById('wizBimonthlyToggle').checked;
        document.getElementById('wizPayDay2Group').style.display = checked ? 'flex' : 'none';
    },

    async _savePayDay() {
        const day = document.getElementById('wizPayDay')?.value;
        const amount = document.getElementById('wizPayAmount')?.value;
        const isBimonthly = document.getElementById('wizBimonthlyToggle')?.checked;
        const day2 = document.getElementById('wizPayDay2')?.value;

        const configData = {
            base_pay_day: (day || '28').toString(),
            base_pay_type: isBimonthly ? 'bimonthly' : 'monthly'
        };
        if (amount) {
            configData.base_pay_amount = parseFloat(amount).toFixed(2);
        }
        if (isBimonthly && day2) {
            configData.base_pay_day_2 = day2.toString();
        }

        try {
            await API.post('/api/config/', configData);
        } catch (e) {
            console.error('[SetupWizard] Erreur sauvegarde jour & montant paie', e);
        }
        this._nav(1);
    },

    // ── Étape 4 : Guide Opérations & Choix de l'Accueil ────────────
    _stepGuide(body) {
        const isOverview = this.preferredHome === 'overview';
        const isDashboard = this.preferredHome === 'dashboard';

        body.innerHTML = `
            <div class="wizard-step-content">
                <h2 class="wizard-step-title">📝 ${window.i18n.t('wizard_guide_title')}</h2>
                <p class="wizard-step-desc">${window.i18n.t('wizard_guide_desc')}</p>

                <!-- Choix de l'écran d'accueil préféré -->
                <div style="margin: 14px 0 20px 0;">
                    <label style="font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">
                        ${window.i18n.t('wizard_home_view_title') || 'Écran d\'accueil préféré'}
                    </label>
                    <div class="wizard-home-grid">
                        <div class="wizard-home-card ${isDashboard ? 'active' : ''}" onclick="window.SetupWizard._setHomeView('dashboard')">
                            <div class="wizard-home-icon">🏠</div>
                            <div class="wizard-home-name">${window.i18n.t('wizard_home_dashboard') || 'Journal des opérations classique'}</div>
                            <div class="wizard-home-desc">${window.i18n.t('wizard_home_dashboard_desc') || 'Tableau complet avec filtres par colonnes, rapprochement et calendrier.'}</div>
                        </div>
                        <div class="wizard-home-card ${isOverview ? 'active' : ''}" onclick="window.SetupWizard._setHomeView('overview')">
                            <div class="wizard-home-icon">📊</div>
                            <div class="wizard-home-name">${window.i18n.t('wizard_home_overview') || 'Vue d\'ensemble moderne (Bento)'}</div>
                            <div class="wizard-home-desc">${window.i18n.t('wizard_home_overview_desc') || 'Cartes synthétiques, rythme financier, Reste à Vivre et projection.'}</div>
                        </div>
                    </div>
                </div>

                <!-- Guide des 4 directions de flux -->
                <div class="wizard-guide-cards">
                    <div class="wizard-guide-card wizard-guide-expense">
                        <div class="wizard-guide-card-header">
                            <span class="wizard-guide-icon">📤</span>
                            <strong>${window.i18n.t('wizard_guide_expense')}</strong>
                        </div>
                        <div class="wizard-guide-schema">
                            <div class="wizard-schema-col"><span class="wizard-schema-label">${window.i18n.t('wizard_label_from')}</span><span class="wizard-schema-from">${window.i18n.t('wizard_guide_account')}</span></div>
                            <span class="wizard-schema-arrow">→</span>
                            <div class="wizard-schema-col"><span class="wizard-schema-label">${window.i18n.t('wizard_label_to')}</span><span class="wizard-schema-empty">${window.i18n.t('wizard_guide_empty')}</span></div>
                        </div>
                        <p class="wizard-guide-detail">${window.i18n.t('wizard_guide_expense_detail')}</p>
                    </div>

                    <div class="wizard-guide-card wizard-guide-income">
                        <div class="wizard-guide-card-header">
                            <span class="wizard-guide-icon">📥</span>
                            <strong>${window.i18n.t('wizard_guide_income')}</strong>
                        </div>
                        <div class="wizard-guide-schema">
                            <div class="wizard-schema-col"><span class="wizard-schema-label">${window.i18n.t('wizard_label_from')}</span><span class="wizard-schema-empty">${window.i18n.t('wizard_guide_empty')}</span></div>
                            <span class="wizard-schema-arrow">→</span>
                            <div class="wizard-schema-col"><span class="wizard-schema-label">${window.i18n.t('wizard_label_to')}</span><span class="wizard-schema-to">${window.i18n.t('wizard_guide_account')}</span></div>
                        </div>
                        <p class="wizard-guide-detail">${window.i18n.t('wizard_guide_income_detail')}</p>
                    </div>

                    <div class="wizard-guide-card wizard-guide-transfer">
                        <div class="wizard-guide-card-header">
                            <span class="wizard-guide-icon">🔄</span>
                            <strong>${window.i18n.t('wizard_guide_transfer')}</strong>
                        </div>
                        <div class="wizard-guide-schema">
                            <div class="wizard-schema-col"><span class="wizard-schema-label">${window.i18n.t('wizard_label_from')}</span><span class="wizard-schema-from">${window.i18n.t('wizard_guide_account')} A</span></div>
                            <span class="wizard-schema-arrow">→</span>
                            <div class="wizard-schema-col"><span class="wizard-schema-label">${window.i18n.t('wizard_label_to')}</span><span class="wizard-schema-to">${window.i18n.t('wizard_guide_account')} B</span></div>
                        </div>
                        <p class="wizard-guide-detail">${window.i18n.t('wizard_guide_transfer_detail')}</p>
                    </div>

                    <div class="wizard-guide-card wizard-guide-neutral">
                        <div class="wizard-guide-card-header">
                            <span class="wizard-guide-icon">📋</span>
                            <strong>${window.i18n.t('wizard_guide_neutral')}</strong>
                        </div>
                        <div class="wizard-guide-schema">
                            <div class="wizard-schema-col"><span class="wizard-schema-label">${window.i18n.t('wizard_label_from')}</span><span class="wizard-schema-empty">${window.i18n.t('wizard_guide_empty')}</span></div>
                            <span class="wizard-schema-arrow">→</span>
                            <div class="wizard-schema-col"><span class="wizard-schema-label">${window.i18n.t('wizard_label_to')}</span><span class="wizard-schema-empty">${window.i18n.t('wizard_guide_empty')}</span></div>
                        </div>
                        <p class="wizard-guide-detail">${window.i18n.t('wizard_guide_neutral_detail')}</p>
                    </div>
                </div>

                <!-- Badges de pointage -->
                <div class="wizard-recon-section">
                    <h3 class="wizard-subsection-title">✅ ${window.i18n.t('wizard_recon_title')}</h3>
                    <div class="wizard-recon-badges">
                        <div class="wizard-recon-badge">
                            <span class="wizard-recon-badge-icon" style="background:rgba(54,179,126,0.15);color:var(--success);">💰</span>
                            <div>
                                <strong>${window.i18n.t('wizard_badge_rest_to_live')}</strong>
                                <p>${window.i18n.t('wizard_badge_rest_to_live_desc')}</p>
                            </div>
                        </div>
                        <div class="wizard-recon-badge">
                            <span class="wizard-recon-badge-icon" style="background:rgba(255,86,48,0.15);color:var(--danger);">⚠️</span>
                            <div>
                                <strong>${window.i18n.t('wizard_badge_unreconciled')}</strong>
                                <p>${window.i18n.t('wizard_badge_unreconciled_desc')}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._saveHomeViewAndNav()">
                        ${window.i18n.t('wizard_btn_understood')} →
                    </button>
                </div>
            </div>
        `;
    },

    _setHomeView(view) {
        this.preferredHome = view;
        document.querySelectorAll('.wizard-home-card').forEach(c => c.classList.remove('active'));
        event.currentTarget?.classList.add('active');
    },

    async _saveHomeViewAndNav() {
        try {
            await API.post('/api/config/', {
                enable_overview: this.preferredHome === 'overview' ? 'true' : 'false'
            });
            if (window.app && window.app.config) {
                window.app.config.enable_overview = this.preferredHome === 'overview' ? 'true' : 'false';
            }
        } catch (e) {
            console.warn('[SetupWizard] Erreur enregistrement vue d\'accueil', e);
        }
        this._nav(1);
    },

    // ── Étape 5 : Assistant IA / Ollama ────────────────────────────
    _stepAI(body) {
        body.innerHTML = `
            <div class="wizard-step-content wizard-center">
                <h2 class="wizard-step-title">🤖 ${window.i18n.t('wizard_ai_title')}</h2>
                <p class="wizard-step-desc" data-i18n="wizard_ai_desc">${window.i18n.t('wizard_ai_desc')}</p>

                <div class="wizard-ai-features">
                    <div class="wizard-ai-feature"><span>💡</span> ${window.i18n.t('wizard_ai_feat_advice')}</div>
                    <div class="wizard-ai-feature"><span>🏷️</span> ${window.i18n.t('wizard_ai_feat_categorize')}</div>
                    <div class="wizard-ai-feature"><span>📈</span> ${window.i18n.t('wizard_ai_feat_trends')}</div>
                    <div class="wizard-ai-feature"><span>📂</span> ${window.i18n.t('wizard_ai_feat_import')}</div>
                </div>

                <div class="wizard-ai-setup">
                    <label class="wizard-ai-toggle-row">
                        <span data-i18n="wizard_ai_enable">${window.i18n.t('wizard_ai_enable')}</span>
                        <div class="wizard-toggle">
                            <input type="checkbox" id="wizAIToggle" onchange="window.SetupWizard._toggleAIFields()">
                            <span class="wizard-toggle-slider"></span>
                        </div>
                    </label>

                    <div id="wizAIFields" class="wizard-ai-fields" style="display:none;">
                        <div class="wizard-form-field">
                            <label data-i18n="wizard_ai_url">${window.i18n.t('wizard_ai_url')}</label>
                            <div class="wizard-ai-url-row">
                                <input type="text" id="wizAIUrl" class="wizard-input" value="http://127.0.0.1:11434" placeholder="http://127.0.0.1:11434">
                                <button class="wizard-btn-secondary" onclick="window.SetupWizard._testOllama()" id="wizTestBtn">
                                    🔄 ${window.i18n.t('wizard_ai_test')}
                                </button>
                            </div>
                        </div>
                        <div id="wizAIStatus" class="wizard-ai-status"></div>
                        <div id="wizAIModelContainer" class="wizard-form-field" style="display:none;">
                            <label data-i18n="wizard_ai_model">${window.i18n.t('wizard_ai_model')}</label>
                            <select id="wizAIModel" class="wizard-input"></select>
                        </div>
                        <div id="wizAIReportsRow" style="display:none; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-color);">
                            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:12.5px;">
                                <input type="checkbox" id="wizAIReportsToggle" checked style="accent-color:var(--accent);">
                                <span>${window.i18n.t('wizard_ai_reports_enable') || 'Activer les bilans de santé financière périodiques par l\'IA'}</span>
                            </label>
                        </div>
                    </div>
                </div>

                <p class="wizard-hint" data-i18n="wizard_ai_optional">${window.i18n.t('wizard_ai_optional')}</p>

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._skipAI()" data-i18n="wizard_btn_skip_ai">${window.i18n.t('wizard_btn_skip_ai')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._saveAI()">
                        ${window.i18n.t('wizard_btn_next')} →
                    </button>
                </div>
            </div>
        `;

        const cfg = window.app?.config || {};
        if (cfg.enable_ai === 'true') {
            const toggle = document.getElementById('wizAIToggle');
            if (toggle) { toggle.checked = true; this._toggleAIFields(); }
            if (cfg.ollama_url) {
                const urlEl = document.getElementById('wizAIUrl');
                if (urlEl) urlEl.value = cfg.ollama_url;
            }
            if (cfg.ollama_url) {
                this._testOllama().then(() => {
                    if (cfg.ollama_model) {
                        const sel = document.getElementById('wizAIModel');
                        if (sel) sel.value = cfg.ollama_model;
                    }
                });
            }
        }
    },

    _toggleAIFields() {
        const checked = document.getElementById('wizAIToggle').checked;
        document.getElementById('wizAIFields').style.display = checked ? 'flex' : 'none';
        if (checked) {
            this._testOllama();
        }
    },

    async _testOllama() {
        const url = document.getElementById('wizAIUrl').value.trim();
        const status = document.getElementById('wizAIStatus');
        const btn = document.getElementById('wizTestBtn');
        const repRow = document.getElementById('wizAIReportsRow');

        if (!url) {
            status.innerHTML = `<span class="wizard-status-error">❌ ${window.i18n.t('wizard_ai_url_empty')}</span>`;
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ ...';
        status.innerHTML = `<span class="wizard-status-loading">⏳ ${window.i18n.t('wizard_ai_testing')}</span>`;

        try {
            await API.post('/api/config/', { ollama_url: url });
            const data = await API.get('/api/config/ollama/models');

            if (data.models && data.models.length > 0) {
                status.innerHTML = `<span class="wizard-status-ok">✅ ${window.i18n.tp('wizard_ai_found_models', { count: data.models.length })}</span>`;
                const container = document.getElementById('wizAIModelContainer');
                const select = document.getElementById('wizAIModel');
                select.innerHTML = data.models.map(m =>
                    `<option value="${m.name}">${m.name} (${(m.size / 1024 / 1024 / 1024).toFixed(1)} GB)</option>`
                ).join('');
                container.style.display = 'block';
                if (repRow) repRow.style.display = 'block';
            } else {
                status.innerHTML = `<span class="wizard-status-error">⚠️ ${window.i18n.t('wizard_ai_no_models')}</span>`;
            }
        } catch (e) {
            status.innerHTML = `
                <div style="font-size:12px; color:var(--text-muted); line-height:1.4; padding:8px; background:rgba(255,86,48,0.08); border-radius:8px; border:1px solid rgba(255,86,48,0.2);">
                    <div style="color:var(--danger); font-weight:700; margin-bottom:4px;">❌ ${window.i18n.t('wizard_ai_ollama_not_found') || 'Ollama n\'est pas détecté en local.'}</div>
                    <div>${window.i18n.t('wizard_ai_install_hint') || 'Vous pouvez télécharger Ollama sur ollama.com et exécuter <code>ollama run gemma2</code> dans un terminal.'}</div>
                </div>
            `;
        }

        btn.disabled = false;
        btn.textContent = `🔄 ${window.i18n.t('wizard_ai_test')}`;
    },

    async _saveAI() {
        const enabled = document.getElementById('wizAIToggle')?.checked;
        if (enabled) {
            const url = document.getElementById('wizAIUrl').value.trim();
            const model = document.getElementById('wizAIModel')?.value || '';
            const reports = document.getElementById('wizAIReportsToggle')?.checked || false;
            try {
                await API.post('/api/config/', {
                    enable_ai: 'true',
                    ollama_url: url,
                    ollama_model: model,
                    ai_reports_enabled: reports ? 'true' : 'false'
                });
            } catch (e) {
                console.error('[SetupWizard] Erreur sauvegarde config IA', e);
            }
        }
        this._nav(1);
    },

    _skipAI() {
        this._nav(1);
    },

    // ── Étape 6 : Confirmation & Lancement ─────────────────────────
    _stepConfirm(body) {
        const aiEnabled = document.getElementById('wizAIToggle')?.checked;

        const accountsHtml = this.createdAccounts.map(a =>
            `<div class="wizard-recap-item">
                <span>🏦 <strong>${a.name}</strong> <em>(${a.type})</em></span>
                <span>${formatCurrency(a.initial_balance)}</span>
            </div>`
        ).join('');

        const themeNames = {
            'dark': 'Sombre Classique',
            'light': 'Clair Classique',
            'titanium-dark': 'Titanium Exécutif',
            'titanium-light': 'Albâtre Lumineux'
        };

        const homeName = this.preferredHome === 'overview'
            ? 'Vue d\'ensemble (Bento)'
            : 'Journal des opérations classique';

        body.innerHTML = `
            <div class="wizard-step-content wizard-center">
                <div class="wizard-logo-anim wizard-logo-final">🚀</div>
                <h2 class="wizard-step-title" data-i18n="wizard_confirm_title">${window.i18n.t('wizard_confirm_title')}</h2>
                <p class="wizard-step-desc" data-i18n="wizard_confirm_desc">${window.i18n.t('wizard_confirm_desc')}</p>

                <div class="wizard-recap">
                    <div class="wizard-recap-section">
                        <h4>🎨 ${window.i18n.t('wizard_theme_title') || 'Apparence & Accueil'}</h4>
                        <div class="wizard-recap-item">
                            <span>Thème visuel</span>
                            <strong>${themeNames[this._selectedTheme] || this._selectedTheme}</strong>
                        </div>
                        <div class="wizard-recap-item">
                            <span>Écran d'accueil</span>
                            <strong>${homeName}</strong>
                        </div>
                    </div>

                    <div class="wizard-recap-section">
                        <h4>🏦 ${window.i18n.t('wizard_recap_accounts')}</h4>
                        ${accountsHtml || `<p style="color:var(--text-muted);">${window.i18n.t('wizard_no_accounts')}</p>`}
                    </div>

                    <div class="wizard-recap-section">
                        <h4>🤖 ${window.i18n.t('wizard_recap_ai')}</h4>
                        <p>${aiEnabled ? '✅ ' + window.i18n.t('wizard_recap_ai_on') : '⏭️ ' + window.i18n.t('wizard_recap_ai_off')}</p>
                    </div>
                </div>

                <div style="display:flex; flex-direction:column; align-items:center; gap:10px; width:100%; max-width:440px; margin: 0 auto;">
                    <button class="wizard-btn-launch" style="width:100%;" onclick="window.SetupWizard.dismiss()">
                        🚀 ${window.i18n.t('wizard_btn_launch')}
                    </button>

                    <button class="wizard-btn-demo" onclick="window.SetupWizard._seedDemoAndLaunch()">
                        ${window.i18n.t('wizard_btn_demo') || '🧪 Découvrir avec des données de démonstration'}
                    </button>
                </div>
            </div>
        `;
    },

    async _seedDemoAndLaunch() {
        try {
            const res = await API.post('/api/setup/seed-demo');
            if (res.ok) {
                showToast(window.i18n.t('wizard_toast_demo_success') || 'Données de démonstration chargées !', 'success');
                this.dismiss();
            }
        } catch (e) {
            console.error('[SetupWizard] Erreur chargement démo', e);
            showToast('Erreur lors du chargement des données de démo', 'error');
        }
    }
};
