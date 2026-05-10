// setup_wizard.js — Phase 8: Initial Setup Wizard
window.SetupWizard = {
    currentStep: 0,
    totalSteps: 6,
    createdAccounts: [],
    _mainAccountId: null,
    overlay: null,

    async checkAndShow() {
        try {
            const data = await API.get('/api/setup/status');
            if (data.needs_setup) {
                this.show();
                return true;
            }
        } catch (e) {
            console.error('[SetupWizard] Echec de verification du statut', e);
        }
        return false;
    },

    async show() {
        this.currentStep = 0;
        // Pre-load existing accounts so re-launch doesn't start empty
        try {
            const accounts = await API.get('/api/accounts/');
            this.createdAccounts = (accounts || []).filter(a => !a.is_closed);
        } catch (e) {
            this.createdAccounts = [];
        }
        // Sync org mode from existing config
        const cfg = window.app?.config || {};
        this._orgMode = cfg.enable_org_mode === 'true';
        // Pre-load main account
        try {
            const mainAcc = await API.get('/api/stats/main_account');
            this._mainAccountId = mainAcc?.id || null;
        } catch (e) { this._mainAccountId = null; }
        this._buildOverlay();
        this._renderStep();
    },

    dismiss() {
        if (this.overlay) {
            this.overlay.classList.add('wizard-fade-out');
            setTimeout(() => {
                this.overlay.remove();
                this.overlay = null;
                // Reload app state
                if (window.app && typeof window.app._initUI === 'function' && !window.app._uiInitialized) {
                    window.app._initUI();
                } else if (window.app) {
                    window.app.refreshSidebar();
                    window.app.loadView('dashboard');
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

        // Force reflow then animate in
        requestAnimationFrame(() => el.classList.add('wizard-visible'));
    },

    _renderProgress() {
        const bar = document.getElementById('wizardProgress');
        if (!bar) return;
        const icons = ['👋', '🏦', '💰', '📝', '🤖', '🚀'];
        bar.innerHTML = icons.map((ic, i) => {
            if (this._orgMode && i === 2) return '';
            const adjustedStep = (this._orgMode && this.currentStep > 2) ? this.currentStep : this.currentStep;
            return `
            <div class="wizard-step-dot ${i < this.currentStep ? 'done' : ''} ${i === this.currentStep ? 'active' : ''}">
                <span class="wizard-dot-icon">${ic}</span>
                <span class="wizard-dot-line"></span>
            </div>`;
        }).join('');
    },

    _renderStep() {
        this._renderProgress();
        const body = document.getElementById('wizardBody');
        if (!body) return;

        body.classList.remove('wizard-step-enter');
        void body.offsetWidth; // force reflow
        body.classList.add('wizard-step-enter');

        switch (this.currentStep) {
            case 0: this._stepWelcome(body); break;
            case 1: this._stepAccounts(body); break;
            case 2: this._stepPayDay(body); break;
            case 3: this._stepGuide(body); break;
            case 4: this._stepAI(body); break;
            case 5: this._stepConfirm(body); break;
        }

        window.i18n.translateDOM(body);
    },

    _nav(direction) {
        this.currentStep = Math.max(0, Math.min(this.totalSteps - 1, this.currentStep + direction));
        // Skip pay day step in org mode
        if (this._orgMode && this.currentStep === 2) {
            this.currentStep += direction > 0 ? 1 : -1;
        }
        this._renderStep();
    },

    // ── Step 0: Welcome ──────────────────────────────────
    _stepWelcome(body) {
        const isOrg = this._orgMode || false;
        body.innerHTML = `
            <div class="wizard-step-content wizard-center">
                <div class="wizard-logo-anim">🏦</div>
                <h1 class="wizard-title" data-i18n="wizard_welcome_title">${window.i18n.t('wizard_welcome_title')}</h1>
                <p class="wizard-subtitle" data-i18n="wizard_welcome_desc">${window.i18n.t('wizard_welcome_desc')}</p>

                <div class="wizard-lang-picker">
                    <button class="wizard-lang-btn ${window.i18n.lang === 'fr' ? 'active' : ''}" onclick="window.SetupWizard._setLang('fr')">
                        <span class="fi fi-fr"></span> Français
                    </button>
                    <button class="wizard-lang-btn ${window.i18n.lang === 'en' ? 'active' : ''}" onclick="window.SetupWizard._setLang('en')">
                        <span class="fi fi-gb"></span> English
                    </button>
                </div>

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

                <button class="wizard-btn-primary" onclick="window.SetupWizard._saveOrgMode()">
                    ${window.i18n.t('wizard_btn_start')} →
                </button>
            </div>
        `;
    },

    async _saveOrgMode() {
        this._orgMode = document.getElementById('wizOrgToggle')?.checked || false;
        try {
            const val = this._orgMode ? 'true' : 'false';
            await API.post('/api/config/', { enable_org_mode: val });
            if (window.app) {
                if (!window.app.config) window.app.config = {};
                window.app.config.enable_org_mode = val;
            }
        } catch (e) {
            console.error('[SetupWizard] Erreur sauvegarde mode org', e);
        }
        this._nav(1);
    },

    async _setLang(lang) {
        await window.i18n.setLang(lang);
        // Update header flag
        const flag = document.getElementById('currentLangFlag');
        if (flag) flag.className = `fi fi-${lang === 'en' ? 'gb' : 'fr'}`;
        this._renderStep();
    },

    // ── Step 1: Accounts ─────────────────────────────────
    _stepAccounts(body) {
        body.innerHTML = `
            <div class="wizard-step-content">
                <h2 class="wizard-step-title">🏦 ${window.i18n.t('wizard_accounts_title')}</h2>
                <p class="wizard-step-desc" data-i18n="wizard_accounts_desc">${window.i18n.t('wizard_accounts_desc')}</p>

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

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._goFromAccounts()" ${this.createdAccounts.length === 0 ? 'disabled' : ''}>
                        ${window.i18n.t('wizard_btn_next')} →
                    </button>
                </div>
            </div>
        `;
        // Auto-focus name
        setTimeout(() => {
            const el = document.getElementById('wizAccName');
            if (el) el.focus();
        }, 100);
    },

    _renderAccountsList() {
        if (this.createdAccounts.length === 0) {
            return `<p class="wizard-empty-hint" data-i18n="wizard_no_accounts">${window.i18n.t('wizard_no_accounts')}</p>`;
        }
        return this.createdAccounts.map((acc, i) => {
            const isMain = acc.id === this._mainAccountId;
            return `
            <div class="wizard-account-card">
                <button class="wizard-star-btn ${isMain ? 'active' : ''}" onclick="window.SetupWizard._setMainAccount(${acc.id})" title="${window.i18n.t('acc_set_main')}">${isMain ? '⭐' : '☆'}</button>
                <div class="wizard-account-info">
                    <strong>${acc.name}</strong>
                    <span class="wizard-account-type">${acc.type}</span>
                </div>
                <div class="wizard-account-balance">${formatCurrency(acc.initial_balance)}</div>
                <button class="wizard-btn-remove" onclick="window.SetupWizard._removeAccount(${i})">✕</button>
            </div>
        `;
        }).join('');
    },

    async _addAccount() {
        const name = document.getElementById('wizAccName').value.trim();
        const type = document.getElementById('wizAccType').value;
        const balance = parseFloat(document.getElementById('wizAccBalance').value) || 0;

        if (!name) {
            showToast(window.i18n.t('wizard_toast_name_required'), 'error');
            return;
        }
        // Check duplicate
        if (this.createdAccounts.some(a => a.name.toLowerCase() === name.toLowerCase())) {
            showToast(window.i18n.t('wizard_toast_duplicate'), 'error');
            return;
        }

        try {
            // Auto-assign color from palette (uses ACCOUNT_COLORS from accounts_manager.js)
            const palette = (typeof ACCOUNT_COLORS !== 'undefined') ? ACCOUNT_COLORS : ['#3366ff','#36b37e','#ff5630','#ffab00','#00b8d9','#6554c0','#ff8a65','#e91e8a','#8bc34a','#795548'];
            const usedColors = this.createdAccounts.map(a => a.color).filter(Boolean);
            let color = palette.find(c => !usedColors.includes(c)) || palette[this.createdAccounts.length % palette.length];
            const created = await API.post('/api/accounts/', { name, type, initial_balance: balance, is_closed: false, color });
            this.createdAccounts.push(created);
            // Re-render accounts list + clear fields
            document.getElementById('wizAccountsList').innerHTML = this._renderAccountsList();
            document.getElementById('wizAccName').value = '';
            document.getElementById('wizAccBalance').value = '';
            document.getElementById('wizAccName').focus();
            // Enable next button
            const nextBtn = document.querySelector('.wizard-nav .wizard-btn-primary');
            if (nextBtn) nextBtn.disabled = false;
            // Auto-set first account as main
            if (this.createdAccounts.length === 1 && !this._mainAccountId) {
                this._setMainAccount(created.id);
            }
            showToast(window.i18n.t('wizard_toast_account_added'), 'success');
        } catch (e) {
            console.error('[SetupWizard] Erreur creation du compte', e);
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
            if (nextBtn) nextBtn.disabled = this.createdAccounts.length === 0;
        } catch (e) {
            console.error('[SetupWizard] Erreur suppression du compte', e);
        }
    },

    _goFromAccounts() {
        if (this.createdAccounts.length === 0) {
            showToast(window.i18n.t('wizard_toast_need_account'), 'error');
            return;
        }
        this._nav(1);
    },

    async _setMainAccount(id) {
        try {
            await API.post(`/api/stats/main_account/${id}`);
            this._mainAccountId = id;
            document.getElementById('wizAccountsList').innerHTML = this._renderAccountsList();
        } catch (e) {
            console.error('[SetupWizard] Erreur définition compte principal', e);
        }
    },

    // ── Step 2: Pay Day ──────────────────────────────────
    _stepPayDay(body) {
        body.innerHTML = `
            <div class="wizard-step-content wizard-center">
                <h2 class="wizard-step-title">💰 ${window.i18n.t('wizard_pay_title')}</h2>
                <p class="wizard-step-desc" data-i18n="wizard_pay_desc">${window.i18n.t('wizard_pay_desc')}</p>

                <div class="wizard-pay-input-group">
                    <label data-i18n="wizard_pay_day_label">${window.i18n.t('wizard_pay_day_label')}</label>
                    <input type="number" id="wizPayDay" class="wizard-input wizard-pay-input" min="1" max="31" placeholder="ex: 25">
                </div>

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

                <p class="wizard-hint" data-i18n="wizard_pay_hint">${window.i18n.t('wizard_pay_hint')}</p>

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(1)" data-i18n="wizard_btn_skip_step">${window.i18n.t('wizard_btn_skip_step')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._savePayDay()">
                        ${window.i18n.t('wizard_btn_next')} →
                    </button>
                </div>
            </div>
        `;
        // Pre-fill from existing config
        const cfg = window.app?.config || {};
        if (cfg.base_pay_day) {
            const el = document.getElementById('wizPayDay');
            if (el) el.value = cfg.base_pay_day;
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
        const day = document.getElementById('wizPayDay').value;
        const isBimonthly = document.getElementById('wizBimonthlyToggle')?.checked;
        const day2 = document.getElementById('wizPayDay2')?.value;

        if (day) {
            const configData = {
                base_pay_day: day.toString(),
                base_pay_type: isBimonthly ? 'bimonthly' : 'monthly'
            };
            if (isBimonthly && day2) {
                configData.base_pay_day_2 = day2.toString();
            }
            try {
                await API.post('/api/config/', configData);
            } catch (e) {
                console.error('[SetupWizard] Erreur sauvegarde jour de paie', e);
            }
        }
        this._nav(1);
    },

    // ── Step 3: Guide Operations ─────────────────────────
    _stepGuide(body) {
        body.innerHTML = `
            <div class="wizard-step-content">
                <h2 class="wizard-step-title">📝 ${window.i18n.t('wizard_guide_title')}</h2>
                <p class="wizard-step-desc">${window.i18n.t('wizard_guide_desc')}</p>

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

                <div class="wizard-guide-types">
                    <p>${window.i18n.t('wizard_guide_types_intro')}</p>
                    <div class="wizard-type-tags">
                        <span class="wizard-type-tag expense-fixed">🔒 ${window.i18n.t('wizard_type_fixed')}</span>
                        <span class="wizard-type-tag expense-var">🛒 ${window.i18n.t('wizard_type_variable')}</span>
                        <span class="wizard-type-tag income-tag">💵 ${window.i18n.t('wizard_type_income')}</span>
                        <span class="wizard-type-tag transfer-tag">🔄 ${window.i18n.t('wizard_type_transfer_tag')}</span>
                        <span class="wizard-type-tag neutral-tag">📋 ${window.i18n.t('wizard_type_neutral_tag')}</span>
                    </div>
                </div>

                <div class="wizard-try-section">
                    <button class="wizard-btn-secondary wizard-try-btn" onclick="window.FormView.open()">
                        ✏️ ${window.i18n.t('wizard_btn_try_transaction')}
                    </button>
                    <p class="wizard-hint">${window.i18n.t('wizard_try_hint')}</p>
                </div>

                <div class="wizard-recon-section">
                    <h3 class="wizard-subsection-title">✅ ${window.i18n.t('wizard_recon_title')}</h3>
                    <p class="wizard-step-desc" style="margin-bottom:12px;">${window.i18n.t('wizard_recon_desc')}</p>
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
                        <div class="wizard-recon-badge">
                            <span class="wizard-recon-badge-icon" style="background:rgba(51,102,255,0.15);color:var(--accent);">💳</span>
                            <div>
                                <strong>${window.i18n.t('wizard_badge_next_pay')}</strong>
                                <p>${window.i18n.t('wizard_badge_next_pay_desc')}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="wizard-import-hint">
                    <div class="wizard-import-icon">📂</div>
                    <div>
                        <strong>${window.i18n.t('wizard_import_title')}</strong>
                        <p>${window.i18n.t('wizard_import_desc')}</p>
                    </div>
                </div>

                <div class="wizard-nav">
                    <button class="wizard-btn-ghost" onclick="window.SetupWizard._nav(-1)">← ${window.i18n.t('wizard_btn_back')}</button>
                    <button class="wizard-btn-primary" onclick="window.SetupWizard._nav(1)">
                        ${window.i18n.t('wizard_btn_understood')} →
                    </button>
                </div>
            </div>
        `;
    },

    // ── Step 4: AI / Ollama ──────────────────────────────
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
        // Pre-fill from existing config
        const cfg = window.app?.config || {};
        if (cfg.enable_ai === 'true') {
            const toggle = document.getElementById('wizAIToggle');
            if (toggle) { toggle.checked = true; this._toggleAIFields(); }
            if (cfg.ollama_url) {
                const urlEl = document.getElementById('wizAIUrl');
                if (urlEl) urlEl.value = cfg.ollama_url;
            }
            // Auto-fetch models to populate the dropdown
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
    },

    async _testOllama() {
        const url = document.getElementById('wizAIUrl').value.trim();
        const status = document.getElementById('wizAIStatus');
        const btn = document.getElementById('wizTestBtn');

        if (!url) {
            status.innerHTML = `<span class="wizard-status-error">❌ ${window.i18n.t('wizard_ai_url_empty')}</span>`;
            return;
        }

        btn.disabled = true;
        btn.textContent = '⏳ ...';
        status.innerHTML = `<span class="wizard-status-loading">⏳ ${window.i18n.t('wizard_ai_testing')}</span>`;

        try {
            // Save URL temporarily
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
            } else {
                status.innerHTML = `<span class="wizard-status-error">⚠️ ${window.i18n.t('wizard_ai_no_models')}</span>`;
            }
        } catch (e) {
            status.innerHTML = `<span class="wizard-status-error">❌ ${window.i18n.t('wizard_ai_connect_error')}</span>`;
        }

        btn.disabled = false;
        btn.textContent = `🔄 ${window.i18n.t('wizard_ai_test')}`;
    },

    async _saveAI() {
        const enabled = document.getElementById('wizAIToggle')?.checked;
        if (enabled) {
            const url = document.getElementById('wizAIUrl').value.trim();
            const model = document.getElementById('wizAIModel')?.value || '';
            try {
                await API.post('/api/config/', {
                    enable_ai: 'true',
                    ollama_url: url,
                    ollama_model: model
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

    // ── Step 5: Confirmation ─────────────────────────────
    _stepConfirm(body) {
        const aiEnabled = document.getElementById('wizAIToggle')?.checked;

        const accountsHtml = this.createdAccounts.map(a =>
            `<div class="wizard-recap-item">
                <span>🏦 <strong>${a.name}</strong> <em>(${a.type})</em></span>
                <span>${formatCurrency(a.initial_balance)}</span>
            </div>`
        ).join('');

        body.innerHTML = `
            <div class="wizard-step-content wizard-center">
                <div class="wizard-logo-anim wizard-logo-final">🚀</div>
                <h2 class="wizard-step-title" data-i18n="wizard_confirm_title">${window.i18n.t('wizard_confirm_title')}</h2>
                <p class="wizard-step-desc" data-i18n="wizard_confirm_desc">${window.i18n.t('wizard_confirm_desc')}</p>

                <div class="wizard-recap">
                    <div class="wizard-recap-section">
                        <h4>🏦 ${window.i18n.t('wizard_recap_accounts')}</h4>
                        ${accountsHtml || `<p style="color:var(--text-muted);">${window.i18n.t('wizard_no_accounts')}</p>`}
                    </div>
                    <div class="wizard-recap-section">
                        <h4>🤖 ${window.i18n.t('wizard_recap_ai')}</h4>
                        <p>${aiEnabled ? '✅ ' + window.i18n.t('wizard_recap_ai_on') : '⏭️ ' + window.i18n.t('wizard_recap_ai_off')}</p>
                    </div>
                </div>

                <button class="wizard-btn-launch" onclick="window.SetupWizard.dismiss()">
                    🚀 ${window.i18n.t('wizard_btn_launch')}
                </button>
            </div>
        `;
    }
};
