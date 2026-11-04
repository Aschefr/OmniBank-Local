// static/js/views/simulator.js — Simulateur de Projets & Scénarios What-If (Sandbox)
window.SimulatorView = {
    scenarios: [],
    activeScenarioId: null,
    presets: [],
    horizonMonths: 36,
    accountId: null,
    accounts: [],
    simulationData: null,
    chart: null,
    isLoading: false,
    editingScenario: null,
    editingEvent: null,

    incomeMode: 'historical_n1',
    customIncomeAmount: null,
    inflationRate: 0.0,
    varExpenseAdjustmentPct: 0.0,
    scenarioLevel: 0.0,
    outlierSensitivity: 2,
    seasonalityMode: 'disabled',
    _liveDebounceTimer: null,
    _configSyncTimer: null,
    _pendingConfigUpdates: {},

    _saveParam(key, val) {
        ProfileStorage.set(key, val);
        const strVal = (val !== null && val !== undefined) ? String(val) : '';
        this._queueSyncConfig({ [key]: strVal });
    },

    _batchSaveParams(map) {
        for (const [k, v] of Object.entries(map)) {
            ProfileStorage.set(k, v);
        }
        this._queueSyncConfig(map);
    },

    _queueSyncConfig(updates) {
        if (!this._pendingConfigUpdates) this._pendingConfigUpdates = {};
        Object.assign(this._pendingConfigUpdates, updates);
        if (this._configSyncTimer) clearTimeout(this._configSyncTimer);
        this._configSyncTimer = setTimeout(async () => {
            const payload = { ...this._pendingConfigUpdates };
            this._pendingConfigUpdates = {};
            try {
                await API.post('/api/config/', payload, { skipMutateEvent: true });
                if (window.app && window.app.config) {
                    Object.assign(window.app.config, payload);
                }
            } catch (err) {
                console.warn('[SimulatorView] Synchronisation de la configuration avec la base SQLite échouée:', err);
            }
        }, 350);
    },

    async init() {
        // Chargement de la configuration serveur (SQLite) pour persistance multi-appareils
        let serverConfig = (window.app && window.app.config) ? window.app.config : null;
        try {
            const freshConfig = await API.get('/api/config/');
            if (freshConfig) {
                serverConfig = freshConfig;
                if (window.app) window.app.config = freshConfig;
            }
        } catch (e) {
            console.warn('[SimulatorView] Récupération config distante impossible, repli local:', e);
        }

        const getSetting = (key, fallback) => {
            if (serverConfig && serverConfig[key] !== undefined && serverConfig[key] !== null && serverConfig[key] !== '') {
                return serverConfig[key];
            }
            const local = ProfileStorage.get(key);
            if (local !== null && local !== undefined && local !== '') {
                return local;
            }
            return fallback;
        };

        this.horizonMonths = parseInt(getSetting('sim_horizon', '36')) || 36;
        const savedAcc = getSetting('sim_account', null);
        this.accountId = savedAcc && savedAcc !== 'null' && savedAcc !== '' ? parseInt(savedAcc) : null;
        const savedScId = getSetting('sim_active_scenario', null);
        this.activeScenarioId = savedScId && savedScId !== 'null' && savedScId !== '' ? parseInt(savedScId) : null;
        const rawSimMode = getSetting('sim_mode', 'recommended');
        this.simMode = (rawSimMode === 'advanced' || rawSimMode === 'custom') ? 'advanced' : 'recommended';

        // Réglages du mode avancé. Ils partent du mode conseillé : ceux de l'ancien panneau ne sont pas repris.
        const hasNewPanelSettings = getSetting('sim_custom_scenario_level', null) !== null;
        const customSetting = (key, fallback) => hasNewPanelSettings ? getSetting(key, fallback) : fallback;
        const customLevel = parseFloat(customSetting('sim_custom_scenario_level', '0'));
        const customIncomeMode = customSetting('sim_custom_income_mode', 'auto');
        const savedCustom = customSetting('sim_custom_income', null);
        const customIncomeAmt = (savedCustom && savedCustom !== 'null' && savedCustom !== '') ? parseFloat(savedCustom) : null;
        const customInflation = parseFloat(customSetting('sim_custom_inflation_rate', '0.0')) || 0.0;
        const customVarAdj = parseFloat(customSetting('sim_custom_var_expense_adj', '0.0')) || 0.0;
        const customOutlierSens = parseInt(customSetting('sim_custom_outlier_sensitivity', '4')) || 4;
        const customSeasonality = customSetting('sim_custom_seasonality_mode', 'disabled') === 'historical' ? 'historical' : 'disabled';

        if (this.simMode === 'recommended') {
            this.scenarioLevel = 0.0;
            this.incomeMode = 'auto';
            this.customIncomeAmount = null;
            this.inflationRate = 0.0;
            this.varExpenseAdjustmentPct = 0.0;
            this.outlierSensitivity = 4;
            this.seasonalityMode = 'disabled';
            // Le Cockpit lit ce réglage côté serveur : il suit le mode conseillé
            if (getSetting('sim_outlier_sensitivity', '4') !== '4') this._batchSaveParams({ sim_outlier_sensitivity: '4' });
        } else {
            this.scenarioLevel = isNaN(customLevel) ? 0.0 : customLevel;
            this.incomeMode = customIncomeMode === 'historical_n1' ? 'auto' : customIncomeMode;
            this.customIncomeAmount = customIncomeAmt;
            this.inflationRate = customInflation;
            this.varExpenseAdjustmentPct = customVarAdj;
            this.outlierSensitivity = customOutlierSens;
            this.seasonalityMode = customSeasonality;
        }

        // Synchronisation du ProfileStorage local avec les valeurs résolues
        ProfileStorage.set('sim_mode', this.simMode);
        ProfileStorage.set('sim_horizon', this.horizonMonths);
        if (this.accountId !== null) ProfileStorage.set('sim_account', this.accountId);
        if (this.activeScenarioId !== null) ProfileStorage.set('sim_active_scenario', this.activeScenarioId);
        ProfileStorage.set('sim_income_mode', this.incomeMode);
        ProfileStorage.set('sim_custom_income', this.customIncomeAmount !== null ? this.customIncomeAmount : '');
        ProfileStorage.set('sim_inflation_rate', this.inflationRate);
        ProfileStorage.set('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        ProfileStorage.set('sim_outlier_sensitivity', this.outlierSensitivity);
        ProfileStorage.set('sim_seasonality_mode', this.seasonalityMode);
        ProfileStorage.set('sim_scenario_level', this.scenarioLevel);
        ProfileStorage.set('sim_table_open', getSetting('sim_table_open', 'false') === 'true');
        ProfileStorage.set('sim_sources_open', getSetting('sim_sources_open', 'false') === 'true');

        // SWR : Rendu instantané si une simulation est déjà en mémoire de session (0 ms)
        if (this.scenarios && this.scenarios.length > 0 && this.simulationData) {
            const root = document.getElementById('simulatorRoot');
            if (root) {
                this.updateHeaderControls();
                this.updateLiveSimulationView(true);
            }
        }

        await this.loadData();
    },

    async loadData() {
        this.isLoading = true;
        try {
            const [scenariosRes, presetsRes, accountsRes] = await Promise.all([
                API.get('/api/simulator/scenarios'),
                API.get('/api/simulator/presets'),
                (window.app && window.app.accounts && window.app.accounts.length > 0)
                    ? window.app.accounts
                    : API.get('/api/accounts/')
            ]);

            this.scenarios = scenariosRes || [];
            this.presets = presetsRes || [];
            this.accounts = (accountsRes || []).filter(a => !a.is_closed);

            // Auto-select first scenario if saved activeScenarioId doesn't exist
            if (this.scenarios.length > 0) {
                const exists = this.scenarios.some(s => s.id === this.activeScenarioId);
                if (!exists) {
                    this.activeScenarioId = this.scenarios[0].id;
                    this._saveParam('sim_active_scenario', this.activeScenarioId);
                }
            } else {
                this.activeScenarioId = null;
            }

            await this.runSimulation();
        } catch (err) {
            console.error("[SimulatorView] Erreur lors du chargement des données:", err);
            showToast(window.i18n.t('error_loading_data') || "Erreur de chargement", "error");
        } finally {
            this.isLoading = false;
            const root = document.getElementById('simulatorRoot');
            if (root) {
                this.updateHeaderControls();
                this.updateLiveSimulationView(true);
            } else {
                this.render();
            }
        }
    },

    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    },

    updateHeaderControls() {
        const activeScenario = this.scenarios.find(s => s.id === this.activeScenarioId);

        // Update Scenario Selector
        const scSelect = document.getElementById('simActiveScenarioSelect');
        if (scSelect) {
            let optionsHtml = '';
            if (this.scenarios.length === 0) {
                optionsHtml = `<option value="">${window.i18n.t('sim_no_scenario_created') || '(Aucun scénario créé)'}</option>`;
            } else {
                optionsHtml = this.scenarios.map(s => {
                    const activeEvCount = s.events ? s.events.filter(e => e.is_active).length : 0;
                    const evSuffix = window.i18n.t('sim_events_count_suffix') || 'événements';
                    return `<option value="${s.id}" ${s.id === this.activeScenarioId ? 'selected' : ''}>${escapeHtml(s.name)} (${activeEvCount} ${evSuffix})</option>`;
                }).join('');
            }
            scSelect.innerHTML = optionsHtml;
            const pill = scSelect.closest('.filter-pill');
            if (pill) {
                pill.style.borderColor = activeScenario ? activeScenario.color : 'var(--border-color)';
            }
        }

        // Update Scenario Actions Menu
        const menuContainer = document.querySelector('.sim-scenario-menu');
        if (menuContainer && activeScenario) {
            menuContainer.innerHTML = `
                <button class="btn btn-ghost btn-xs" onclick="this.nextElementSibling.classList.toggle('open');event.stopPropagation();" style="font-size:16px;padding:2px 6px;line-height:1;" title="${window.i18n.t('sim_scenario_actions')}">⋮</button>
                <div class="sim-scenario-dropdown" onclick="this.classList.remove('open');">
                    <button onclick="window.SimulatorView.duplicateScenario(${activeScenario.id})">📋 ${window.i18n.t('sim_btn_duplicate')}</button>
                    <button onclick="window.SimulatorView.openEditScenarioModal(${activeScenario.id})">✏️ ${window.i18n.t('sim_btn_edit')}</button>
                    <button onclick="window.SimulatorView.deleteScenario(${activeScenario.id})" style="color:#ef4444;">🗑️ ${window.i18n.t('sim_btn_delete')}</button>
                </div>
            `;
        }

        // Update Account Selector
        const accSelect = document.getElementById('simAccountSelect');
        if (accSelect && this.accounts.length > 0) {
            accSelect.innerHTML = `<option value="" ${this.accountId === null ? 'selected' : ''} data-i18n="sim_all_liquid_accounts">${window.i18n.t('sim_all_liquid_accounts')}</option>` +
                this.accounts.map(a => `<option value="${a.id}" ${this.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('');
        }

        // Update Horizon Selector
        const horizonSelect = document.getElementById('simHorizonSelect');
        if (horizonSelect) {
            horizonSelect.value = String(this.horizonMonths);
        }

        // Update Events List
        const eventsContainer = document.getElementById('simEventsContainer');
        if (eventsContainer) {
            eventsContainer.innerHTML = this.renderEventsList(activeScenario);
        }

        // Update Add Event button visibility in card header
        const cardTitle = document.querySelector('.sim-events-card .sim-card-title');
        if (cardTitle) {
            cardTitle.innerHTML = `
                <span data-i18n="sim_events_title">${window.i18n.t('sim_events_title')}</span>
                ${activeScenario ? `
                    <button class="btn btn-primary btn-xs" onclick="window.SimulatorView.openAddEventModal()">
                        ➕ <span data-i18n="sim_btn_add_event">${window.i18n.t('sim_btn_add_event')}</span>
                    </button>
                ` : ''}
            `;
        }
    },

    async runSimulation() {
        this._simSeq = (this._simSeq || 0) + 1;
        const currentSeq = this._simSeq;
        try {
            const payload = {
                scenario_id: this.activeScenarioId,
                horizon_months: this.horizonMonths,
                account_id: this.accountId,
                projection_profile: 'recommended',
                scenario_level: this.simMode === 'advanced' ? (this.scenarioLevel || 0) : 0,
                income_mode: this.incomeMode,
                custom_income_amount: this.customIncomeAmount,
                inflation_rate: this.inflationRate || 0.0,
                variable_expense_adjustment_pct: this.varExpenseAdjustmentPct || 0.0,
                outlier_sensitivity: this.outlierSensitivity || 4,
                seasonality_mode: this.seasonalityMode || 'disabled',
            };
            const result = await API.post('/api/simulator/run', payload, { skipMutateEvent: true });
            if (this._simSeq === currentSeq) {
                this.simulationData = result;
            }
        } catch (err) {
            if (this._simSeq === currentSeq) {
                console.error("[SimulatorView] Erreur lors de la simulation:", err);
                this.simulationData = null;
            }
        }
    },

    render() {
        const root = document.getElementById('mainContent');
        if (!root) return '';

        const activeScenario = this.scenarios.find(s => s.id === this.activeScenarioId);
        const data = this.simulationData;
        const tableOpen = ProfileStorage.get('sim_table_open') === 'true';
        const sourcesOpen = ProfileStorage.get('sim_sources_open') === 'true';

        const html = `
        <div id="simulatorRoot" class="view-root" style="padding-bottom:40px;">
            <style>
                .sim-kpi-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 14px;
                    margin-bottom: 18px;
                }
                .sim-card {
                    background: var(--bg-surface);
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                    padding: 14px 16px;
                    box-shadow: var(--shadow-sm);
                    position: relative;
                    min-width: 0 !important;
                    box-sizing: border-box;
                }
                .sim-card-title {
                    font-size: 11px;
                    color: var(--text-muted);
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.4px;
                    margin-bottom: 6px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-wrap: wrap;
                    gap: 6px;
                }
                .sim-card-val {
                    font-size: 22px;
                    font-weight: 700;
                    color: var(--text-main);
                    line-height: 1.2;
                    word-break: break-word;
                }
                .sim-card-sub {
                    font-size: 11px;
                    color: var(--text-muted);
                    margin-top: 5px;
                    word-break: break-word;
                }
                .sim-badge {
                    display: inline-flex;
                    align-items: center;
                    padding: 2px 7px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: 600;
                    white-space: normal;
                }
                .sim-badge-positive { background: rgba(16, 185, 129, 0.15); color: #10b981; }
                .sim-badge-negative { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
                .sim-badge-neutral { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
                .sim-events-table th, .sim-events-table td {
                    padding: 8px 10px;
                    font-size: 12px;
                    border-bottom: 1px solid var(--border-color);
                }
                .sim-events-table tr:hover {
                    background: var(--bg-hover);
                }
                .sim-switch {
                    position: relative;
                    display: inline-block;
                    width: 32px;
                    height: 18px;
                    vertical-align: middle;
                    flex-shrink: 0;
                }
                .sim-switch input { opacity: 0; width: 0; height: 0; }
                .sim-slider {
                    position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
                    background-color: var(--border-color);
                    transition: .2s;
                    border-radius: 18px;
                }
                .sim-slider:before {
                    position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px;
                    background-color: white;
                    transition: .2s;
                    border-radius: 50%;
                }
                input:checked + .sim-slider { background-color: var(--accent, #6366f1); }
                input:checked + .sim-slider:before { transform: translateX(14px); }
                .sim-main-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 14px;
                    margin-bottom: 20px;
                    align-items: start;
                }
                .sim-chart-card {
                    grid-column: span 2;
                }
                .sim-events-card {
                    grid-column: span 1;
                }
                .sim-break-even-container {
                    border-radius: 10px;
                    padding: 10px 16px;
                    margin-bottom: 16px;
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    flex-wrap: wrap;
                }
                .sim-break-even-btn {
                    white-space: normal !important;
                    word-break: break-word !important;
                    text-align: center;
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                }
                .sim-adv {
                    padding: 12px 16px;
                }
                .sim-adv-main {
                    display: grid;
                    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
                    gap: 8px 32px;
                    align-items: start;
                }
                .sim-adv-head {
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                    flex-wrap: wrap;
                    gap: 0 10px;
                    font-size: 13px;
                }
                .sim-adv-title {
                    font-size: 13px !important;
                    font-weight: 700;
                    color: var(--text-main);
                    margin: 0 !important;
                    text-transform: none !important;
                    letter-spacing: 0 !important;
                }
                .sim-adv-level {
                    font-weight: 700;
                    color: var(--accent, #6366f1);
                    font-variant-numeric: tabular-nums;
                    white-space: nowrap;
                }
                .sim-adv-slider-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    margin: 2px 0;
                }
                .sim-adv-stop {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-muted);
                    background: transparent;
                    border: none;
                    padding: 4px 0;
                    cursor: pointer;
                    white-space: nowrap;
                    font-variant-numeric: tabular-nums;
                    flex-shrink: 0;
                }
                button.sim-adv-stop:hover,
                button.sim-adv-stop:focus-visible {
                    color: var(--text-main);
                }
                span.sim-adv-stop {
                    cursor: default;
                }
                .sim-adv-track {
                    position: relative;
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    align-items: center;
                }
                .sim-adv-track.two-sided::after {
                    content: '';
                    position: absolute;
                    left: 50%;
                    top: -2px;
                    bottom: -2px;
                    width: 2px;
                    margin-left: -1px;
                    background: var(--text-muted);
                    opacity: 0.6;
                    pointer-events: none;
                }
                .sim-adv-readout {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0 16px;
                    margin: 0;
                    font-size: 12px;
                    line-height: 1.5;
                }
                .sim-adv-readout > div {
                    display: flex;
                    gap: 5px;
                    white-space: nowrap;
                }
                .sim-adv-readout dt {
                    color: var(--text-muted);
                    font-weight: 500;
                }
                .sim-adv-readout dd {
                    margin: 0;
                    color: var(--text-main);
                    font-weight: 600;
                    font-variant-numeric: tabular-nums;
                }
                .sim-adv-note {
                    font-size: 12px;
                    color: var(--text-muted);
                    margin: 0;
                    line-height: 1.5;
                }
                .sim-adv-result {
                    display: flex;
                    flex-wrap: wrap;
                    align-items: baseline;
                    gap: 0 8px;
                    font-size: 12px;
                    line-height: 1.5;
                    color: var(--text-muted);
                }
                .sim-adv-result-value {
                    font-size: 14px;
                    font-weight: 800;
                    color: var(--text-main);
                    font-variant-numeric: tabular-nums;
                }
                .sim-adv-result-value.is-negative {
                    color: #ef4444;
                }
                .sim-adv-effort-value {
                    font-weight: 700;
                    color: var(--text-main);
                    font-variant-numeric: tabular-nums;
                    white-space: nowrap;
                }
                .sim-adv-bottom {
                    position: relative;
                    border-top: 1px solid var(--border-color);
                    margin-top: 8px;
                    padding-top: 6px;
                }
                .sim-adv-details summary {
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-muted);
                    cursor: pointer;
                    line-height: 28px;
                    width: fit-content;
                }
                .sim-adv-details summary:hover,
                .sim-adv-details summary:focus-visible {
                    color: var(--text-main);
                }
                .sim-adv-reset {
                    position: absolute;
                    right: 0;
                    top: 6px;
                    height: 28px;
                    padding: 0 2px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--accent, #6366f1);
                    background: transparent;
                    border: none;
                    cursor: pointer;
                }
                .sim-adv-reset:hover,
                .sim-adv-reset:focus-visible {
                    text-decoration: underline;
                }
                .sim-adv-fields {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
                    gap: 8px 16px;
                    margin: 4px 0;
                }
                .sim-adv-field {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    min-width: 0;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-muted);
                }
                .sim-adv-field select,
                .sim-adv-field input {
                    width: 100%;
                    min-width: 0;
                    box-sizing: border-box;
                    height: 32px;
                    padding: 2px 8px;
                    font-size: 13px;
                    font-weight: 500;
                    color: var(--text-main);
                    background: var(--bg-input);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                }
                .sim-adv-field-hint {
                    font-weight: 500;
                    line-height: 1.3;
                }
                @media (max-width: 900px) {
                    .sim-adv-main {
                        grid-template-columns: minmax(0, 1fr);
                    }
                    .sim-adv-effort {
                        border-top: 1px solid var(--border-color);
                        padding-top: 8px;
                    }
                }
                .sim-range-input {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 100%;
                    height: 8px;
                    background: var(--border-color);
                    border-radius: 6px;
                    outline: none;
                    transition: background .15s ease-in-out;
                }
                .sim-range-input::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: var(--accent, #6366f1);
                    cursor: pointer;
                    border: 2px solid #ffffff;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
                    transition: transform 0.1s ease;
                }
                .sim-range-input::-webkit-slider-thumb:hover, .sim-range-input::-webkit-slider-thumb:active {
                    transform: scale(1.2);
                }
                .sim-range-input::-moz-range-thumb {
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    background: var(--accent, #6366f1);
                    cursor: pointer;
                    border: 2px solid #ffffff;
                    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
                }

                /* Collapsible sections */
                .sim-collapsible-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: pointer;
                    user-select: none;
                    padding: 10px 16px;
                    border-radius: 10px;
                    transition: background 0.15s ease;
                }
                .sim-collapsible-header:hover {
                    background: var(--bg-hover);
                }
                .sim-collapsible-chevron {
                    transition: transform 0.25s ease;
                    font-size: 12px;
                    color: var(--text-muted);
                }
                .sim-collapsible-chevron.open {
                    transform: rotate(90deg);
                }
                .sim-collapsible-body {
                    overflow: hidden;
                    max-height: 0;
                    opacity: 0;
                    transition: max-height 0.3s ease, opacity 0.25s ease, padding 0.25s ease;
                    padding: 0 16px;
                }
                .sim-collapsible-body.open {
                    max-height: 2000px;
                    opacity: 1;
                    padding: 12px 16px 14px;
                }

                /* Scenario dropdown menu */
                .sim-scenario-menu {
                    position: relative;
                    display: inline-block;
                }
                .sim-scenario-dropdown {
                    display: none;
                    position: absolute;
                    right: 0;
                    top: 100%;
                    z-index: 20;
                    background: var(--bg-surface);
                    border: 1px solid var(--border-color);
                    border-radius: 8px;
                    box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.15));
                    min-width: 140px;
                    padding: 4px 0;
                }
                .sim-scenario-dropdown.open {
                    display: block;
                }
                .sim-scenario-dropdown button {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    width: 100%;
                    padding: 7px 12px;
                    font-size: 12px;
                    font-weight: 500;
                    background: none;
                    border: none;
                    color: var(--text-main);
                    cursor: pointer;
                    text-align: left;
                }
                .sim-scenario-dropdown button:hover {
                    background: var(--bg-hover);
                }

                @media (max-width: 992px) {
                    .sim-main-grid {
                        grid-template-columns: 1fr !important;
                    }
                    .sim-chart-card,
                    .sim-events-card {
                        grid-column: span 1 !important;
                    }
                    .sim-kpi-grid {
                        grid-template-columns: 1fr !important;
                    }
                }
                @media (max-width: 600px) {
                    #simulatorRoot {
                        padding-left: 0;
                        padding-right: 0;
                    }
                    .view-header {
                        padding: 10px 10px 8px !important;
                        margin: -12px -10px 10px -10px !important;
                        gap: 8px !important;
                        box-sizing: border-box !important;
                    }
                    .view-header h2 {
                        font-size: 15px !important;
                    }
                    .view-header .btn {
                        font-size: 12.5px !important;
                        font-weight: 600 !important;
                        padding: 6px 12px !important;
                        min-height: 32px !important;
                        flex: 1 1 auto;
                        justify-content: center;
                    }
                    .view-header .btn-primary {
                        font-size: 13px !important;
                    }
                    #simActiveScenarioSelect {
                        min-width: 0 !important;
                        width: 100% !important;
                        font-size: 12.5px !important;
                        padding: 5px 8px !important;
                    }
                    #simAccountSelect, #simHorizonSelect {
                        font-size: 12px !important;
                        padding: 4px 8px !important;
                    }
                    .sim-card {
                        padding: 12px 14px !important;
                        border-radius: 10px !important;
                    }
                    .sim-kpi-grid {
                        grid-template-columns: 1fr !important;
                        gap: 8px !important;
                        margin-bottom: 12px !important;
                    }
                    .sim-card-title {
                        font-size: 11px !important;
                        font-weight: 700 !important;
                        letter-spacing: 0.4px !important;
                        margin-bottom: 5px !important;
                        display: flex !important;
                        flex-direction: row !important;
                        justify-content: space-between !important;
                        align-items: center !important;
                        gap: 6px !important;
                    }
                    .sim-card-title .btn {
                        font-size: 11.5px !important;
                        padding: 3px 8px !important;
                    }
                    .sim-card-val {
                        font-size: 18.5px !important;
                        font-weight: 700 !important;
                        line-height: 1.2 !important;
                    }
                    .sim-card-sub {
                        font-size: 11px !important;
                        margin-top: 4px !important;
                        line-height: 1.35 !important;
                    }
                    .sim-badge {
                        font-size: 10.5px !important;
                        padding: 2px 6px !important;
                    }
                    .sim-collapsible-header {
                        padding: 9px 12px !important;
                    }
                    .sim-break-even-container {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        padding: 9px 12px !important;
                        gap: 6px !important;
                        margin-bottom: 10px !important;
                    }
                    .sim-break-even-btn {
                        width: 100% !important;
                        justify-content: center !important;
                        padding: 7px 12px !important;
                        font-size: 12px !important;
                        font-weight: 600 !important;
                    }
                    .sim-chart-legend {
                        font-size: 10px !important;
                        gap: 6px 12px !important;
                    }
                    .sim-events-table th, .sim-events-table td {
                        padding: 7px 6px !important;
                        font-size: 11.5px !important;
                    }
                    .data-table th, .data-table td {
                        padding: 6px 5px !important;
                        font-size: 11px !important;
                    }
                    .view-header-bar {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 10px !important;
                    }
                    /* Bandeau trop haut pour rester collé : il couvrirait un tiers de l'écran et son titre passe sous l'en-tête */
                    #simulatorRoot .view-header-bar {
                        position: static !important;
                        margin-top: 0 !important;
                    }
                    #simulatorRoot .view-header-title {
                        white-space: normal !important;
                        flex-shrink: 1 !important;
                    }
                    #simRecommendedStrip {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 8px !important;
                    }
                    #simRecommendedStrip button {
                        height: auto !important;
                        line-height: 1.3 !important;
                        white-space: normal !important;
                        justify-content: center !important;
                        margin-left: 0 !important;
                    }
                    #simRecommendedStrip [data-i18n="sim_recommended_mode_banner_desc"] {
                        display: block;
                        margin-left: 0 !important;
                        margin-top: 2px;
                    }
                    .view-header-title-group {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        width: 100% !important;
                        gap: 8px !important;
                    }
                    .view-header-title-group .filter-pill {
                        width: 100% !important;
                        box-sizing: border-box !important;
                    }
                    #simActiveScenarioSelect {
                        min-width: 0 !important;
                        width: 100% !important;
                        font-size: 12px !important;
                        text-overflow: ellipsis !important;
                    }
                    .view-header-toolbar {
                        display: flex !important;
                        flex-direction: column !important;
                        align-items: stretch !important;
                        width: 100% !important;
                        gap: 8px !important;
                    }
                    .view-header-toolbar .filter-pill {
                        width: 100% !important;
                        justify-content: space-between !important;
                        box-sizing: border-box !important;
                    }
                    .view-header-toolbar .filter-pill select {
                        flex: 1 !important;
                        min-width: 0 !important;
                    }
                    .view-header-toolbar .toolbar-btn {
                        width: 100% !important;
                        justify-content: center !important;
                        min-height: 38px !important;
                        font-size: 13px !important;
                        white-space: normal !important;
                        text-align: center !important;
                        line-height: 1.25 !important;
                    }
                }
                @media (max-width: 420px) {
                    .sim-kpi-grid {
                        grid-template-columns: 1fr;
                    }
                    .sim-ev-grid {
                        grid-template-columns: 1fr !important;
                    }
                    .view-header h2 span:last-child {
                        font-size: 13px !important;
                    }
                }
            </style>

            <!-- ═══ Unified Header: Title + Scenario + Account + Horizon ═══ -->
            <div class="view-header-bar">
                <div class="view-header-title-group">
                    <h2 class="view-header-title">
                        <span>🔮</span>
                        <span data-i18n="sim_title">${window.i18n.t('sim_title')}</span>
                    </h2>
                    <!-- Scenario Selector Pill -->
                    <div class="filter-pill" style="border-color:${activeScenario ? activeScenario.color : 'var(--border-color)'};">
                        <span class="filter-pill-label">🎬</span>
                        <select id="simActiveScenarioSelect" class="filter-pill-select" style="min-width:180px; font-weight:700;" onchange="window.SimulatorView.onScenarioChange(this.value)">
                            ${this.scenarios.length === 0 ? `<option value="">${window.i18n.t('sim_no_scenario_created') || '(Aucun scénario créé)'}</option>` : ''}
                            ${this.scenarios.map(s => {
                                const activeEvCount = s.events ? s.events.filter(e => e.is_active).length : 0;
                                const evSuffix = window.i18n.t('sim_events_count_suffix') || 'événements';
                                return `<option value="${s.id}" ${s.id === this.activeScenarioId ? 'selected' : ''}>${escapeHtml(s.name)} (${activeEvCount} ${evSuffix})</option>`;
                            }).join('')}
                        </select>
                        ${activeScenario ? `
                        <div class="sim-scenario-menu">
                            <button class="btn btn-ghost btn-xs" onclick="this.nextElementSibling.classList.toggle('open');event.stopPropagation();" style="font-size:16px;padding:2px 6px;line-height:1;" title="${window.i18n.t('sim_scenario_actions')}">⋮</button>
                            <div class="sim-scenario-dropdown" onclick="this.classList.remove('open');">
                                <button onclick="window.SimulatorView.duplicateScenario(${activeScenario.id})">📋 ${window.i18n.t('sim_btn_duplicate')}</button>
                                <button onclick="window.SimulatorView.openEditScenarioModal(${activeScenario.id})">✏️ ${window.i18n.t('sim_btn_edit')}</button>
                                <button onclick="window.SimulatorView.deleteScenario(${activeScenario.id})" style="color:#ef4444;">🗑️ ${window.i18n.t('sim_btn_delete')}</button>
                            </div>
                        </div>
                        ` : ''}
                    </div>
                </div>

                <div class="view-header-toolbar">
                    <!-- Mode Toggle: Conseillé vs Avancé -->
                    <div class="sim-mode-toggle-group" id="simModeToggleGroup" style="display:inline-flex;background:var(--bg-base);border:1px solid var(--border-color);border-radius:20px;padding:2px;gap:2px;align-items:center;">
                        <button type="button" id="simModeRecommendedBtn" class="btn btn-xs ${this.simMode === 'recommended' ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:3px 12px;border-radius:16px;display:inline-flex;align-items:center;gap:5px;font-weight:${this.simMode === 'recommended' ? '700' : '500'};" onclick="window.SimulatorView.setSimMode('recommended')" title="${window.i18n.t('sim_mode_recommended_tooltip') || 'Paramètres conseillés (100% socle garanti, charges certaines, lissée)'}">
                            <span>🎯</span> <span data-i18n="sim_mode_recommended">${window.i18n.t('sim_mode_recommended') || 'Conseillé'}</span>
                        </button>
                        <button type="button" id="simModeAdvancedBtn" class="btn btn-xs ${this.simMode === 'advanced' ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:3px 12px;border-radius:16px;display:inline-flex;align-items:center;gap:5px;font-weight:${this.simMode === 'advanced' ? '700' : '500'};" onclick="window.SimulatorView.setSimMode('advanced')" title="${window.i18n.t('sim_mode_advanced_tooltip') || 'Personnaliser les curseurs de projection'}">
                            <span>⚙️</span> <span data-i18n="sim_mode_advanced">${window.i18n.t('sim_mode_advanced') || 'Avancé'}</span>
                        </button>
                    </div>
                    <div class="filter-pill">
                        <span class="filter-pill-label">🏦 <span data-i18n="sim_account_label">${window.i18n.t('sim_account_label')}</span></span>
                        <select id="simAccountSelect" class="filter-pill-select" style="min-width:140px;" onchange="window.SimulatorView.onAccountChange(this.value)">
                            <option value="" ${this.accountId === null ? 'selected' : ''} data-i18n="sim_all_liquid_accounts">${window.i18n.t('sim_all_liquid_accounts')}</option>
                            ${this.accounts.map(a => `<option value="${a.id}" ${this.accountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                        </select>
                    </div>

                    <div class="filter-pill">
                        <span class="filter-pill-label">⏳ <span data-i18n="sim_horizon_label">${window.i18n.t('sim_horizon_label')}</span></span>
                        <select id="simHorizonSelect" class="filter-pill-select" style="min-width:85px;" onchange="window.SimulatorView.onHorizonChange(this.value)">
                            <option value="6" ${this.horizonMonths === 6 ? 'selected' : ''}>${window.i18n.t('sim_horizon_6m')}</option>
                            <option value="12" ${this.horizonMonths === 12 ? 'selected' : ''}>${window.i18n.t('sim_horizon_12m')}</option>
                            <option value="18" ${this.horizonMonths === 18 ? 'selected' : ''}>${window.i18n.t('sim_horizon_18m')}</option>
                            <option value="24" ${this.horizonMonths === 24 ? 'selected' : ''}>${window.i18n.t('sim_horizon_24m')}</option>
                            <option value="36" ${this.horizonMonths === 36 ? 'selected' : ''}>${window.i18n.t('sim_horizon_36m')}</option>
                            <option value="60" ${this.horizonMonths === 60 ? 'selected' : ''}>${window.i18n.t('sim_horizon_5y')}</option>
                            <option value="120" ${this.horizonMonths === 120 ? 'selected' : ''}>${window.i18n.t('sim_horizon_10y')}</option>
                            <option value="180" ${this.horizonMonths === 180 ? 'selected' : ''}>${window.i18n.t('sim_horizon_15y')}</option>
                            <option value="240" ${this.horizonMonths === 240 ? 'selected' : ''}>${window.i18n.t('sim_horizon_20y')}</option>
                            <option value="300" ${this.horizonMonths === 300 ? 'selected' : ''}>${window.i18n.t('sim_horizon_25y')}</option>
                        </select>
                    </div>

                    <button class="btn btn-secondary toolbar-btn" onclick="window.SimulatorView.openPresetsModal()">
                        <span>✨</span> <span data-i18n="sim_btn_presets">${window.i18n.t('sim_btn_presets')}</span>
                    </button>
                    <button class="btn btn-primary toolbar-btn" onclick="window.SimulatorView.openNewScenarioModal()">
                        <span>➕</span> <span data-i18n="sim_btn_new_scenario">${window.i18n.t('sim_btn_new_scenario')}</span>
                    </button>
                </div>
            </div>

            <!-- ═══ Mode Conseillé : Bandeau discret (réglages personnalisés masqués) ═══ -->
            <div id="simRecommendedStrip" class="sim-card" style="margin-bottom:16px;padding:10px 16px;display:${this.simMode === 'recommended' ? 'flex' : 'none'};align-items:center;justify-content:space-between;background:rgba(99, 102, 241, 0.06);border:1px solid rgba(99, 102, 241, 0.2);border-radius:10px;gap:12px;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:16px;">🎯</span>
                    <div>
                        <strong style="font-size:12px;color:var(--text-main);" data-i18n="sim_recommended_mode_banner_title">${window.i18n.t('sim_recommended_mode_banner_title') || 'Paramètres conseillés actifs'}</strong>
                        <span style="font-size:11px;color:var(--text-muted);margin-left:8px;" data-i18n="sim_recommended_mode_banner_desc">${window.i18n.t('sim_recommended_mode_banner_desc') || 'Projection basée sur vos rentrées et charges certaines (100% socle garanti, lissée).'}</span>
                    </div>
                </div>
                <button type="button" class="btn btn-secondary btn-xs" onclick="window.SimulatorView.setSimMode('advanced')" style="font-size:11px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;">
                    <span>⚙️</span> <span data-i18n="sim_btn_switch_advanced">${window.i18n.t('sim_btn_switch_advanced') || 'Afficher les paramètres avancés'}</span>
                </button>
            </div>

            <!-- ═══ Mode Avancé : scénario de l'année et réglages ═══ -->
            <div class="sim-card" id="simAdvancedCard" style="margin-bottom:16px;padding:0;overflow:hidden;display:${this.simMode === 'advanced' ? 'block' : 'none'};">
                <div id="simAdvancedPanelContainer" data-shape="${this._advancedPanelShape(data)}">${this.renderAdvancedPanel(data)}</div>
            </div>

            <!-- ═══ KPI Cards (3 fused) ═══ -->
            <div id="simKpiGridContainer">${this.renderKPIs(data)}</div>

            <!-- ═══ Break-Even Advice Banner ═══ -->
            <div id="simBreakEvenBannerContainer">${this.renderBreakEvenBanner(data)}</div>

            <!-- ═══ Chart & Events Layout (2fr / 1fr aligned to 3-col KPI grid) ═══ -->
            <div class="sim-main-grid">
                <!-- Dual Curve Chart -->
                <div class="sim-card sim-chart-card" style="min-height:340px;display:flex;flex-direction:column;">
                    <div class="sim-card-title">
                        <span data-i18n="sim_chart_title">${window.i18n.t('sim_chart_title')}</span>
                        <div class="sim-chart-legend" style="display:flex;gap:12px;font-size:11px;text-transform:none;font-weight:normal;flex-wrap:wrap;">
                            <span style="display:flex;align-items:center;gap:4px;">
                                <span style="display:inline-block;width:10px;height:3px;background:#8b5cf6;border-radius:2px;"></span>
                                <span data-i18n="sim_chart_legend_simulated">${window.i18n.t('sim_chart_legend_simulated')}</span>
                            </span>
                            <span style="display:flex;align-items:center;gap:4px;">
                                <span style="display:inline-block;width:10px;height:3px;background:#94a3b8;border-radius:2px;border-top:1px dashed #94a3b8;"></span>
                                <span data-i18n="sim_chart_legend_baseline">${window.i18n.t('sim_chart_legend_baseline')}</span>
                            </span>
                            ${(data && data.variable_expense_stddev > 0) ? `
                            <span style="display:flex;align-items:center;gap:4px;">
                                <span style="display:inline-block;width:10px;height:8px;background:rgba(139, 92, 246, 0.15);border-radius:2px;border:1px solid rgba(139, 92, 246, 0.3);"></span>
                                <span data-i18n="sim_chart_legend_confidence">${window.i18n.t('sim_chart_legend_confidence')}</span>
                            </span>
                            ` : ''}
                        </div>
                    </div>
                    <div style="flex:1;position:relative;width:100%;height:280px;">
                        <canvas id="simChartCanvas"></canvas>
                    </div>
                </div>

                <!-- Scenario Events Builder -->
                <div class="sim-card sim-events-card" style="min-height:340px;display:flex;flex-direction:column;">
                    <div class="sim-card-title">
                        <span data-i18n="sim_events_title">${window.i18n.t('sim_events_title')}</span>
                        ${activeScenario ? `
                            <button class="btn btn-primary btn-xs" onclick="window.SimulatorView.openAddEventModal()">
                                ➕ <span data-i18n="sim_btn_add_event">${window.i18n.t('sim_btn_add_event')}</span>
                            </button>
                        ` : ''}
                    </div>
                    <div style="flex:1;overflow-y:auto;max-height:280px;" id="simEventsContainer">
                        ${this.renderEventsList(activeScenario)}
                    </div>
                </div>
            </div>

            <!-- ═══ Transparency Sources (discreet toggle) ═══ -->
            <div id="simTransparencyContainer">${this.renderTransparencyBar(data)}</div>

            <!-- ═══ Monthly Table (collapsed by default) ═══ -->
            <div class="sim-card" style="padding:0;overflow:hidden;">
                <div class="sim-collapsible-header" onclick="window.SimulatorView.toggleSection('table')">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:13px;">📋</span>
                        <span style="font-size:12px;font-weight:700;color:var(--text-main);" data-i18n="sim_table_toggle">${window.i18n.t('sim_table_toggle')}</span>
                        ${data && data.monthly_data ? `<span style="font-size:11px;color:var(--text-muted);">(${data.monthly_data.length} mois)</span>` : ''}
                    </div>
                    <span class="sim-collapsible-chevron ${tableOpen ? 'open' : ''}" id="simTableChevron">▸</span>
                </div>
                <div class="sim-collapsible-body ${tableOpen ? 'open' : ''}" id="simTableBody" style="padding-left:0;padding-right:0;">
                    <div id="simMonthlyTableContainer" style="overflow-x:auto;">
                        ${tableOpen ? this.renderMonthlyTable(data) : ''}
                    </div>
                </div>
            </div>

            <!-- Modals Container -->
            <div id="simModalsContainer"></div>
        </div>
        `;

        root.innerHTML = html;
        setTimeout(() => this.renderChart(), 50);

        // Close scenario dropdown when clicking outside
        document.addEventListener('click', (e) => {
            const dropdown = document.querySelector('.sim-scenario-dropdown.open');
            if (dropdown && !dropdown.parentElement.contains(e.target)) {
                dropdown.classList.remove('open');
            }
        }, { once: true });

        return html;
    },

    renderKPIs(data) {
        if (!data) {
            return `
                <div class="sim-kpi-grid">
                    <div class="sim-card"><div class="sim-card-val">-- €</div></div>
                    <div class="sim-card"><div class="sim-card-val">-- €</div></div>
                    <div class="sim-card"><div class="sim-card-val">-- €</div></div>
                </div>
            `;
        }

        const diff = data.total_difference;
        const diffSign = diff > 0 ? '+' : '';
        const diffBadgeClass = diff > 0 ? 'sim-badge-positive' : (diff < 0 ? 'sim-badge-negative' : 'sim-badge-neutral');

        const isOverdraft = data.is_overdraft_risk;

        return `
            <div class="sim-kpi-grid">
                <!-- Solde Final Projeté -->
                <div class="sim-card">
                    <div class="sim-card-title">
                        <span data-i18n="sim_kpi_final_balance">${window.i18n.t('sim_kpi_final_balance')}</span>
                        <span class="sim-badge ${diffBadgeClass}">${diffSign}${diff.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} € (${diffSign}${data.percentage_difference}%)</span>
                    </div>
                    <div class="sim-card-val" style="color:${data.simulated_final_balance < 0 ? '#ef4444' : 'var(--text-main)'};">
                        ${data.simulated_final_balance.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                    </div>
                    <div class="sim-card-sub">
                        <span data-i18n="sim_kpi_baseline">${window.i18n.t('sim_kpi_baseline')}</span> 
                        <strong>${data.baseline_final_balance.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €</strong>
                    </div>
                </div>

                <!-- Trésorerie Minimale & Risque (fused) -->
                <div class="sim-card" style="border-left:3px solid ${isOverdraft ? '#ef4444' : '#10b981'};">
                    <div class="sim-card-title">
                        <span data-i18n="sim_kpi_min_cash_overdraft">${window.i18n.t('sim_kpi_min_cash_overdraft')}</span>
                        ${isOverdraft 
                            ? `<span class="sim-badge sim-badge-negative">🚨 ${(window.i18n.t('sim_kpi_overdraft_detected') || 'Découvert dès {date}').replace('{date}', data.first_overdraft_date)}</span>`
                            : `<span class="sim-badge sim-badge-positive">✅ ${window.i18n.t('sim_kpi_overdraft_safe') || 'OK'}</span>`}
                    </div>
                    <div class="sim-card-val" style="color:${data.min_simulated_balance < 0 ? '#ef4444' : 'var(--text-main)'};">
                        ${data.min_simulated_balance.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                    </div>
                    <div class="sim-card-sub">
                        <span data-i18n="sim_kpi_min_date">${window.i18n.t('sim_kpi_min_date')}</span> 
                        <strong>${data.min_simulated_date || '--'}</strong>
                        ${isOverdraft && data.max_overdraft_amount 
                            ? ` · ${window.i18n.t('sim_kpi_max_overdraft_prefix') || 'Max :'} <strong>-${data.max_overdraft_amount.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €</strong>`
                            : ''}
                    </div>
                </div>

                <!-- Reste à Vivre Moyen -->
                <div class="sim-card">
                    <div class="sim-card-title">
                        <span data-i18n="sim_kpi_avg_rest">${window.i18n.t('sim_kpi_avg_rest')}</span>
                    </div>
                    <div class="sim-card-val" style="color:${data.avg_simulated_net < 0 ? '#ef4444' : 'var(--text-main)'};">
                        ${data.avg_simulated_net > 0 ? '+' : ''}${data.avg_simulated_net.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €/mois
                    </div>
                    <div class="sim-card-sub">
                        <span data-i18n="sim_kpi_baseline">${window.i18n.t('sim_kpi_baseline')}</span> 
                        <strong>${data.avg_baseline_net > 0 ? '+' : ''}${data.avg_baseline_net.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €/mois</strong>
                    </div>
                </div>
            </div>
        `;
    },

    renderTransparencyBar(data) {
        if (!data) return '';

        const items = [];
        const t = window.i18n.t.bind(window.i18n);
        const sourcesOpen = ProfileStorage.get('sim_sources_open') === 'true';

        // Active Profile / Prudence Weight info
        const w = (typeof data.conservative_weight === 'number') ? data.conservative_weight : 0.0;
        const pctCons = Math.round(w * 100);
        const pctReal = 100 - pctCons;

        if (data.projection_profile === 'recommended') {
            const other = Math.round(data.other_income_avg || 0).toLocaleString('fr-FR');
            const text = data.other_income_avg > 0
                ? t('sim_transparency_recommended').replace('{other}', other)
                : t('sim_transparency_recommended_no_other');
            items.push(`<span style="display:flex;align-items:center;gap:4px;color:#10b981;font-weight:700;">🎯 ${text}</span>`);
            if (data.scenario && data.scenario.level) {
                items.push(`<span style="display:flex;align-items:center;gap:4px;font-weight:700;">${t('sim_adv_transparency_scenario').replace('{label}', this.getScenarioLabel(data.scenario.level))}</span>`);
            }
        } else if (pctCons === 0) {
            const inc = Math.round(data.historical_real_income_avg || data.predicted_salary || 0).toLocaleString('fr-FR');
            const fix = Math.round(data.historical_real_fixed_avg || 0).toLocaleString('fr-FR');
            const net = Math.round(data.historical_real_net_avg || 0).toLocaleString('fr-FR');
            items.push(`<span style="display:flex;align-items:center;gap:4px;color:#10b981;font-weight:700;">🎯 <strong>${t('sim_prudence_badge_100real')} :</strong> ${t('sim_transparency_real_profile').replace('{income}', inc).replace('{fixed}', fix).replace('{net}', net)}</span>`);
        } else if (pctCons === 100) {
            const sal = Math.round(data.predicted_salary || 0).toLocaleString('fr-FR');
            const profileText = data.predicted_salary > 0
                ? t('sim_transparency_conservative_profile').replace('{salary}', sal)
                : t('sim_transparency_conservative_no_salary');
            items.push(`<span style="display:flex;align-items:center;gap:4px;color:#ef4444;font-weight:700;">🛡️ <strong>${t('sim_prudence_badge_100cons')} :</strong> ${profileText}</span>`);
        } else {
            const realInc = data.historical_real_income_avg || data.predicted_salary || 0;
            const consInc = data.predicted_salary || 0;
            const blendInc = Math.round((1 - w) * realInc + w * consInc).toLocaleString('fr-FR');

            const realFix = data.historical_real_fixed_avg || 0;
            const consFix = (data.monthly_data && data.monthly_data.length > 0) ? (data.monthly_data[0].baseline_expense || 0) : 0;
            const blendFix = Math.round((1 - w) * realFix + w * consFix).toLocaleString('fr-FR');

            items.push(`<span style="display:flex;align-items:center;gap:4px;color:var(--accent, #6366f1);font-weight:700;">⚖️ <strong>${t('sim_transparency_blend_profile').replace('{real}', pctReal).replace('{cons}', pctCons).replace('{income}', blendInc).replace('{fixed}', blendFix)}</strong></span>`);
        }

        // Variable expenses info
        if (data.avg_variable_expense > 0) {
            items.push(`<span style="display:flex;align-items:center;gap:4px;">📊 ${t('sim_transparency_var_avg')} : <strong>${data.avg_variable_expense.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €/mois</strong> (${data.variable_expense_history_months} mois)</span>`);
        } else {
            items.push(`<span style="display:flex;align-items:center;gap:4px;">📊 ${t('sim_transparency_no_var_data')}</span>`);
        }

        // Seasonality info
        if (data.seasonality_mode === 'historical') {
            const intPct = Math.round((data.seasonality_intensity || 1.0) * 100);
            const mCount = data.seasonal_history_months || 0;
            items.push(`<span style="display:flex;align-items:center;gap:4px;color:#f59e0b;font-weight:600;">🍂 <strong>${t('sim_seasonality_mode_historical')} :</strong> ${mCount} mois analysés (${intPct}%)</span>`);
        } else if (data.seasonality_mode === 'preset_standard') {
            const intPct = Math.round((data.seasonality_intensity || 1.0) * 100);
            items.push(`<span style="display:flex;align-items:center;gap:4px;color:#f59e0b;font-weight:600;">🏖️ <strong>${t('sim_seasonality_mode_preset')} :</strong> ${intPct}% d'amplitude</span>`);
        } else {
            items.push(`<span style="display:flex;align-items:center;gap:4px;color:var(--text-muted);">🍂 <strong>${t('sim_seasonality_title')} :</strong> ${t('sim_seasonality_mode_disabled')}</span>`);
        }

        // Inflation info
        if (data.inflation_rate > 0) {
            const pct = (data.inflation_rate * 100).toFixed(1);
            items.push(`<span style="display:flex;align-items:center;gap:4px;">📈 ${t('sim_transparency_inflation').replace('{rate}', pct)}</span>`);
        }

        // Outlier exclusion info (expenses & incomes)
        if (data.recent_history) {
            items.push(`<span style="display:flex;align-items:center;gap:4px;">🌱 ${t('sim_transparency_recent_history')}</span>`);
        }
        if (data.excluded_outliers_count > 0) {
            items.push(`<span style="display:flex;align-items:center;gap:4px;">⚡ ${t('sim_transparency_outliers').replace('{count}', data.excluded_outliers_count).replace('{total}', data.excluded_outliers_total.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}))}</span>`);
        }
        if (data.excluded_income_outliers_count > 0) {
            items.push(`<span style="display:flex;align-items:center;gap:4px;">💰 ${t('sim_transparency_income_outliers').replace('{count}', data.excluded_income_outliers_count).replace('{total}', data.excluded_income_outliers_total.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}))}</span>`);
        }

        // Confidence band info
        if (data.variable_expense_stddev > 0) {
            items.push(`<span style="display:flex;align-items:center;gap:4px;">📐 ${t('sim_transparency_confidence')} (±${data.variable_expense_stddev.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €)</span>`);
        }

        return `
            <div style="margin-bottom:14px;">
                <button onclick="window.SimulatorView.toggleSection('sources')" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--text-muted);padding:4px 8px;border-radius:6px;display:flex;align-items:center;gap:5px;transition:color 0.15s ease;" onmouseover="this.style.color='var(--accent, #6366f1)'" onmouseout="this.style.color='var(--text-muted)'">
                    <span class="sim-collapsible-chevron ${sourcesOpen ? 'open' : ''}" id="simSourcesChevron" style="font-size:10px;">▸</span>
                    <span>ℹ️</span>
                    <span data-i18n="${sourcesOpen ? 'sim_hide_details' : 'sim_show_details'}">${sourcesOpen ? t('sim_hide_details') : t('sim_show_details')}</span>
                </button>
                <div id="simSourcesBody" style="overflow:hidden;max-height:${sourcesOpen ? '500px' : '0'};opacity:${sourcesOpen ? '1' : '0'};transition:max-height 0.3s ease, opacity 0.25s ease;margin-top:${sourcesOpen ? '6px' : '0'};">
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:8px 14px;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11px;color:var(--text-muted);">
                        ${items.join('')}
                    </div>
                </div>
            </div>
        `;
    },

    renderBreakEvenBanner(data) {
        if (!data) return '';
        const t = window.i18n.t.bind(window.i18n);

        // Sans dépense variable sur ce compte, aucun effort à proposer
        if (data.is_overdraft_risk && data.break_even_monthly_saving > 0 && data.avg_variable_expense > 0) {
            if (data.is_fixed_expenses_deficit) {
                const fixedAmt = data.fixed_deficit_monthly ? data.fixed_deficit_monthly.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}) : data.break_even_monthly_saving.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                return `
                    <div class="sim-break-even-container" style="background:rgba(239, 68, 68, 0.08);border:1px solid rgba(239, 68, 68, 0.3);">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span style="font-size:18px;">⚠️</span>
                            <div>
                                <div style="font-size:12px;font-weight:700;color:#ef4444;" data-i18n="sim_break_even_title">${t('sim_break_even_title')}</div>
                                <div style="font-size:12px;color:var(--text-main);margin-top:2px;">
                                    ${t('sim_break_even_fixed_warning').replace('{amount}', fixedAmt)}
                                </div>
                            </div>
                        </div>
                        <button class="btn btn-secondary btn-xs sim-break-even-btn" onclick="window.SimulatorView.applyBreakEvenEffort(100)">
                            <span>⚡</span> <span>${t('sim_btn_apply_max_effort')}</span>
                        </button>
                    </div>
                `;
            } else {
                const savingAmt = data.break_even_monthly_saving.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                const recPct = data.break_even_var_reduction_pct;
                const targetPct = Math.min(100, Math.ceil(recPct));
                const currentEffortPct = Math.round(this.varExpenseAdjustmentPct * 100);

                let adviceText = '';
                if (currentEffortPct !== 0) {
                    adviceText = t('sim_break_even_advice_current')
                        .replace('{months}', data.horizon_months)
                        .replace('{amount}', savingAmt)
                        .replace('{pct}', targetPct)
                        .replace('{current}', (currentEffortPct > 0 ? '+' : '') + currentEffortPct);
                } else {
                    adviceText = t('sim_break_even_advice')
                        .replace('{months}', data.horizon_months)
                        .replace('{amount}', savingAmt)
                        .replace('{pct}', targetPct);
                }

                return `
                    <div class="sim-break-even-container" style="background:rgba(139, 92, 246, 0.08);border:1px solid rgba(139, 92, 246, 0.3);">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span style="font-size:18px;">💡</span>
                            <div>
                                <div style="font-size:12px;font-weight:700;color:#8b5cf6;" data-i18n="sim_break_even_title">${t('sim_break_even_title')}</div>
                                <div style="font-size:12px;color:var(--text-main);margin-top:2px;">
                                    ${adviceText}
                                </div>
                            </div>
                        </div>
                        <button class="btn btn-primary btn-xs sim-break-even-btn" onclick="window.SimulatorView.applyBreakEvenEffort(${targetPct})">
                            <span>✨</span> <span>${t('sim_btn_apply_break_even').replace('{pct}', targetPct).replace('{amount}', savingAmt)}</span>
                        </button>
                    </div>
                `;
            }
        } else if (!data.is_overdraft_risk && this.varExpenseAdjustmentPct < 0) {
            const appliedPct = Math.round(Math.abs(this.varExpenseAdjustmentPct) * 100);
            const finalBal = data.simulated_final_balance.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
            const eurosDelta = Math.abs(Math.round((data.avg_variable_expense || 0) * this.varExpenseAdjustmentPct)).toLocaleString('fr-FR');
            return `
                <div class="sim-break-even-container" style="background:rgba(16, 185, 129, 0.08);border:1px solid rgba(16, 185, 129, 0.3);">
                    <div style="display:flex;align-items:center;gap:10px;">
                        <span style="font-size:18px;">✅</span>
                        <div style="font-size:12px;color:var(--text-main);font-weight:600;">
                            ${t('sim_break_even_success').replace('{pct}', appliedPct).replace('{euros}', eurosDelta).replace('{bal}', finalBal)}
                        </div>
                    </div>
                    <button class="btn btn-ghost btn-xs text-muted sim-break-even-btn" onclick="window.SimulatorView.resetEffort()">
                        ↺ ${t('sim_btn_reset_effort')}
                    </button>
                </div>
            `;
        }
        return '';
    },

    _eventAccountSuffix(ev) {
        const account = ev.account_id ? this.accounts.find(a => a.id === ev.account_id) : null;
        return account ? ` • ${escapeHtml(account.name)}` : '';
    },

    renderEventsList(scenario) {
        if (!scenario) {
            return `
                <div style="padding:32px 16px;text-align:center;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:220px;">
                    <div style="font-size:28px;opacity:0.8;">🔮</div>
                    <div style="font-size:12px;line-height:1.5;max-width:280px;" data-i18n="sim_no_scenario_selected">
                        ${window.i18n.t('sim_no_scenario_selected')}
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;margin-top:4px;">
                        <button class="btn btn-primary btn-xs" onclick="window.SimulatorView.openPresetsModal()">
                            ✨ <span data-i18n="sim_empty_btn_presets">${window.i18n.t('sim_empty_btn_presets')}</span>
                        </button>
                        <button class="btn btn-secondary btn-xs" onclick="window.SimulatorView.openNewScenarioModal()">
                            ➕ <span data-i18n="sim_empty_btn_new_scenario">${window.i18n.t('sim_empty_btn_new_scenario')}</span>
                        </button>
                    </div>
                </div>
            `;
        }

        if (!scenario.events || scenario.events.length === 0) {
            return `
                <div style="padding:32px 16px;text-align:center;color:var(--text-muted);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:220px;">
                    <div style="font-size:28px;opacity:0.8;">📝</div>
                    <div style="font-size:12px;line-height:1.5;max-width:280px;" data-i18n="sim_no_events">
                        ${window.i18n.t('sim_no_events')}
                    </div>
                    <button class="btn btn-primary btn-xs" onclick="window.SimulatorView.openAddEventModal()" style="margin-top:4px;">
                        ➕ <span data-i18n="sim_btn_add_event">${window.i18n.t('sim_btn_add_event')}</span>
                    </button>
                </div>
            `;
        }

        const startsLabel = window.i18n.t('sim_event_starts_from') || 'Dès';
        const monthsSuffix = window.i18n.t('sim_months_suffix') || 'mois';
        const editTooltip = window.i18n.t('sim_btn_edit') || 'Modifier';
        const delTooltip = window.i18n.t('sim_btn_delete') || 'Supprimer';

        return `
            <table class="sim-events-table" style="width:100%;border-collapse:collapse;">
                <tbody>
                    ${scenario.events.map(ev => {
                        const isIncome = ev.event_type === 'one_off_income' || ev.event_type === 'recurring_income';
                        const isPct = ev.event_type === 'percentage_adjustment';
                        const sign = isIncome ? '+' : (isPct ? '' : '-');
                        const color = isIncome ? '#10b981' : (isPct ? '#f59e0b' : '#ef4444');
                        const unit = isPct ? '%' : ' €';
                        const typeLabel = window.i18n.t(`sim_event_type_${ev.event_type}`) || ev.event_type;

                        return `
                            <tr>
                                <td style="width:36px;vertical-align:middle;">
                                    <label class="sim-switch">
                                         <input type="checkbox" ${ev.is_active ? 'checked' : ''} onchange="window.SimulatorView.toggleEvent(${ev.id}, this.checked)">
                                        <span class="sim-slider"></span>
                                    </label>
                                </td>
                                <td style="vertical-align:middle;">
                                    <div style="font-weight:600;color:var(--text-main);${!ev.is_active ? 'opacity:0.5;text-decoration:line-through;' : ''}">
                                        ${escapeHtml(ev.label)}
                                    </div>
                                    <div style="font-size:10px;color:var(--text-muted);">
                                        ${typeLabel} • ${startsLabel} ${ev.start_date} ${ev.duration_months ? `(${ev.duration_months} ${monthsSuffix})` : ''}${this._eventAccountSuffix(ev)}
                                    </div>
                                </td>
                                <td style="text-align:right;white-space:nowrap;font-weight:700;color:${color};${!ev.is_active ? 'opacity:0.5;' : ''};vertical-align:middle;">
                                    ${sign}${ev.amount.toLocaleString('fr-FR', {minimumFractionDigits: isPct ? 1 : 2, maximumFractionDigits:2})}${unit}
                                </td>
                                <td style="width:50px;text-align:right;white-space:nowrap;vertical-align:middle;">
                                    <button class="btn btn-ghost btn-xs" onclick="window.SimulatorView.openEditEventModal(${ev.id})" title="${editTooltip}">✏️</button>
                                    <button class="btn btn-ghost btn-xs text-danger" onclick="window.SimulatorView.deleteEvent(${ev.id})" title="${delTooltip}">🗑️</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        `;
    },

    formatMonthLabel(monthStr) {
        if (!monthStr || !monthStr.includes('-')) return monthStr || '';
        const [y, m] = monthStr.split('-').map(Number);
        const dateObj = new Date(y, m - 1, 1);
        const isEn = window.i18n && window.i18n.lang === 'en';
        const monthName = dateObj.toLocaleDateString(isEn ? 'en-US' : 'fr-FR', { month: 'long' });
        const capitalized = monthName.charAt(0).toUpperCase() + monthName.slice(1);
        return `${capitalized} ${y}`;
    },

    renderMonthlyTable(data) {
        if (!data || !data.monthly_data || data.monthly_data.length === 0) {
            return `<div style="padding:16px;text-align:center;color:var(--text-muted);">${window.i18n.t('sim_no_data') || 'Aucune donnée disponible.'}</div>`;
        }

        const totalIncome = data.monthly_data.reduce((sum, m) => sum + (m.baseline_income || 0), 0);
        const totalFixed = data.monthly_data.reduce((sum, m) => sum + (m.baseline_fixed || 0), 0);
        const totalVariable = data.monthly_data.reduce((sum, m) => sum + (m.baseline_variable || 0), 0);
        const totalEvents = data.monthly_data.reduce((sum, m) => sum + (m.simulated_events_impact || 0), 0);
        const totalNet = data.monthly_data.reduce((sum, m) => sum + (m.simulated_net || 0), 0);
        const startBal = data.monthly_data[0].start_balance_simulated;
        const finalBal = data.monthly_data[data.monthly_data.length - 1].simulated_end_balance;
        const finalBaseBal = data.monthly_data[data.monthly_data.length - 1].baseline_end_balance;
        const totalDiff = Math.round((finalBal - finalBaseBal) * 100) / 100;

        return `
            <table class="data-table" style="width:100%;min-width:980px;font-size:12px;border-collapse:collapse;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border-color, rgba(255,255,255,0.1));">
                        <th style="text-align:left;white-space:nowrap;padding:10px 12px;" data-i18n="sim_th_month">${window.i18n.t('sim_th_month')}</th>
                        <th style="text-align:right;white-space:nowrap;padding:10px 8px;" title="${window.i18n.t('sim_th_start_bal_title')}" data-i18n="sim_th_start_bal">${window.i18n.t('sim_th_start_bal')}</th>
                        <th style="text-align:right;white-space:nowrap;padding:10px 8px;" title="${window.i18n.t('sim_th_income_title')}" data-i18n="sim_th_income">${window.i18n.t('sim_th_income')}</th>
                        <th style="text-align:right;white-space:nowrap;padding:10px 8px;" title="${window.i18n.t('sim_th_fixed_title')}" data-i18n="sim_th_fixed">${window.i18n.t('sim_th_fixed')}</th>
                        <th style="text-align:right;white-space:nowrap;padding:10px 8px;" title="${window.i18n.t('sim_th_variable_title')}" data-i18n="sim_th_variable">${window.i18n.t('sim_th_variable')}</th>
                        <th style="text-align:right;white-space:nowrap;padding:10px 8px;" title="${window.i18n.t('sim_th_sim_impact_title')}" data-i18n="sim_th_sim_impact">${window.i18n.t('sim_th_sim_impact')}</th>
                        <th style="text-align:right;white-space:nowrap;padding:10px 8px;" title="${window.i18n.t('sim_th_net_title')}" data-i18n="sim_th_net">${window.i18n.t('sim_th_net')}</th>
                        <th style="text-align:right;white-space:nowrap;padding:10px 8px;" title="${window.i18n.t('sim_th_end_bal_title')}" data-i18n="sim_th_end_bal">${window.i18n.t('sim_th_end_bal')}</th>
                        <th style="text-align:left;white-space:nowrap;padding:10px 12px;" data-i18n="sim_th_events">${window.i18n.t('sim_th_events')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.monthly_data.map(m => {
                        const isNeg = m.simulated_end_balance < 0;
                        const impactSign = m.simulated_events_impact > 0 ? '+' : '';
                        const netSign = m.simulated_net > 0 ? '+' : '';
                        const diffSign = m.difference > 0 ? '+' : '';

                        const incFormatted = (m.baseline_income || 0).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                        const fixFormatted = (m.baseline_fixed || 0).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                        const varFormatted = (m.baseline_variable || 0).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                        const incSign = m.baseline_income > 0 ? '+' : '';
                        const fixSign = m.baseline_fixed > 0 ? '-' : '';
                        const varSign = m.baseline_variable > 0 ? '-' : '';
                        const netFormatted = `${netSign}${m.simulated_net.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €`;

                        const seasFactor = m.seasonal_factor || 1.0;
                        const seasPct = m.seasonal_pct || 0;
                        let seasBadge = '';
                        if (seasPct !== 0) {
                            const seasIcon = m.seasonal_tag === 'holidays' ? '🎄' : (m.seasonal_tag === 'summer' ? '🏖️' : (m.seasonal_tag === 'back_to_school' ? '🎒' : (m.seasonal_tag === 'winter' ? '❄️' : '🍂')));
                            const seasColor = seasPct > 0 ? '#f59e0b' : '#10b981';
                            const seasTooltipText = window.i18n.tp ? window.i18n.tp('sim_seas_var_tooltip', { pct: `${seasPct > 0 ? '+' : ''}${seasPct}`, factor: seasFactor.toFixed(2) }) : `Variation saisonnière : ${seasPct > 0 ? '+' : ''}${seasPct}% (${seasFactor}x)`;
                            seasBadge = `<span class="sim-badge" style="background:${seasPct > 0 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(16, 185, 129, 0.12)'};color:${seasColor};border:1px solid ${seasPct > 0 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.25)'};font-size:9px;padding:1px 4px;margin-left:4px;vertical-align:middle;" title="${seasTooltipText}">${seasPct > 0 ? '+' : ''}${seasPct}% ${seasIcon}</span>`;
                        }

                        const seasSuffix = seasPct !== 0 ? (window.i18n.tp ? window.i18n.tp('sim_table_var_seasonality_suffix', { pct: `${seasPct > 0 ? '+' : ''}${seasPct}` }) : ` (Saisonnalité : ${seasPct > 0 ? '+' : ''}${seasPct}%)`) : '';
                        const inflDetail = m.baseline_inflation_delta >= 0.005 ? (window.i18n.tp ? window.i18n.tp('sim_inflation_detail', { amount: m.baseline_inflation_delta.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}) }) : `dont +${m.baseline_inflation_delta.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} € inflation`) : '';
                        const inflSuffix = inflDetail ? ` (${inflDetail})` : '';

                        const netTooltip = `💼 ${window.i18n.t('sim_th_income')} : ${incSign}${incFormatted} €\n🏠 ${window.i18n.t('sim_th_fixed')} : ${fixSign}${fixFormatted} €\n🛒 ${window.i18n.t('sim_th_variable')} : ${varSign}${varFormatted} €${seasSuffix}${inflSuffix}${m.simulated_events_impact !== 0 ? `\n🎯 ${window.i18n.t('sim_th_sim_impact')} : ${impactSign}${m.simulated_events_impact.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €` : ''}\n─────────────────────\n➜ ${window.i18n.t('sim_th_net')} : ${netFormatted}`;

                        const varCellTitle = (m.baseline_inflation_delta >= 0.005 || seasPct !== 0) ? `${window.i18n.tp ? window.i18n.tp('sim_table_var_tooltip', { amount: varFormatted }) : `Dépenses variables : ${varSign}${varFormatted} €`}${seasSuffix}${inflSuffix}` : '';

                        return `
                            <tr style="${isNeg ? 'background:rgba(239, 68, 68, 0.08);' : ''};border-bottom:1px solid var(--border-color, rgba(255,255,255,0.05));">
                                <td style="font-weight:600;white-space:nowrap;vertical-align:middle;padding:8px 12px;">
                                    ${escapeHtml(this.formatMonthLabel(m.month))}
                                    ${m.is_min_cash ? `<span class="sim-badge" style="background:rgba(99, 102, 241, 0.15);color:#818cf8;border:1px solid rgba(99, 102, 241, 0.3);font-size:9px;margin-left:6px;padding:1px 4px;vertical-align:middle;" title="${window.i18n.t('sim_kpi_min_cash')}">⚓ ${window.i18n.t('sim_badge_min_cash')}</span>` : ''}
                                    ${isNeg ? `<span class="sim-badge" style="background:rgba(239, 68, 68, 0.15);color:#ef4444;border:1px solid rgba(239, 68, 68, 0.3);font-size:9px;margin-left:6px;padding:1px 4px;vertical-align:middle;" title="${window.i18n.t('sim_kpi_overdraft_title')}">⚠️ ${window.i18n.t('sim_badge_overdraft')}</span>` : ''}
                                </td>
                                <td style="text-align:right;color:var(--text-muted);vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;">
                                    ${m.start_balance_simulated.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                                </td>
                                <td style="text-align:right;font-weight:600;color:#10b981;vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;">
                                    ${incSign}${incFormatted} €
                                </td>
                                <td style="text-align:right;font-weight:500;color:#ef4444;vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;">
                                    ${fixSign}${fixFormatted} €
                                </td>
                                <td style="text-align:right;font-weight:500;color:#f59e0b;vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;" ${varCellTitle ? `title="${varCellTitle}"` : ''}>
                                    <div style="display:flex;justify-content:flex-end;align-items:center;gap:2px;">
                                        <span>${varSign}${varFormatted} €</span>
                                        ${seasBadge}
                                    </div>
                                    ${m.baseline_inflation_delta >= 0.005 ? `<div style="font-size:9px;color:var(--text-muted);opacity:0.8;">(+${Math.round(m.baseline_inflation_delta)}€ infl.)</div>` : ''}
                                </td>
                                <td style="text-align:right;font-weight:600;color:${m.simulated_events_impact > 0 ? '#10b981' : (m.simulated_events_impact < 0 ? '#ef4444' : 'var(--text-muted)')};vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;">
                                    ${m.simulated_events_impact !== 0 ? `${impactSign}${m.simulated_events_impact.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €` : '<span style="opacity:0.35;">—</span>'}
                                </td>
                                <td style="text-align:right;font-weight:700;color:${m.simulated_net >= 0 ? '#10b981' : '#ef4444'};vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;cursor:help;" title="${netTooltip}">
                                    ${netFormatted}
                                </td>
                                <td style="text-align:right;font-weight:700;color:${isNeg ? '#ef4444' : 'var(--text-main)'};vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;">
                                    <div>${m.simulated_end_balance.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €</div>
                                    ${m.difference !== 0 ? `<div style="font-size:9.5px;font-weight:500;color:${m.difference > 0 ? '#10b981' : '#ef4444'};opacity:0.85;" title="${window.i18n.tp ? window.i18n.tp('sim_diff_vs_baseline_tooltip', { diff: `${diffSign}${m.difference.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})}` }) : `${diffSign}${m.difference.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} € vs base`}">${diffSign}${m.difference.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} € vs base</div>` : ''}
                                </td>
                                <td style="color:var(--text-muted);font-size:11px;vertical-align:middle;padding:8px 12px;">
                                    ${m.events_applied && m.events_applied.length > 0 ? m.events_applied.map(e => `<span class="sim-badge sim-badge-neutral" style="margin-right:4px;margin-bottom:2px;display:inline-block;">${escapeHtml(e)}</span>`).join('') : '<span style="opacity:0.35;">—</span>'}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
                <tfoot style="background:var(--bg-secondary, rgba(255,255,255,0.03));font-weight:700;border-top:2px solid var(--border-color, rgba(255,255,255,0.12));">
                    <tr>
                        <td style="padding:10px 12px;font-size:12px;white-space:nowrap;" data-i18n="sim_th_total">
                            📊 ${window.i18n.t('sim_th_total') || 'Total période'}
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:var(--text-muted);">
                            ${startBal.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:#10b981;">
                            ${totalIncome > 0 ? '+' : ''}${totalIncome.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:#ef4444;">
                            ${totalFixed > 0 ? '-' : ''}${totalFixed.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:#f59e0b;">
                            ${totalVariable > 0 ? '-' : ''}${totalVariable.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:${totalEvents > 0 ? '#10b981' : (totalEvents < 0 ? '#ef4444' : 'var(--text-muted)')};">
                            ${totalEvents !== 0 ? `${totalEvents > 0 ? '+' : ''}${totalEvents.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €` : '<span style="opacity:0.35;">—</span>'}
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:${totalNet >= 0 ? '#10b981' : '#ef4444'};">
                            ${totalNet > 0 ? '+' : ''}${totalNet.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:${finalBal < 0 ? '#ef4444' : 'var(--text-main)'};">
                            <div>${finalBal.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €</div>
                            ${totalDiff !== 0 ? `<div style="font-size:9.5px;font-weight:500;color:${totalDiff > 0 ? '#10b981' : '#ef4444'};opacity:0.85;" title="${window.i18n.tp ? window.i18n.tp('sim_diff_vs_baseline_tooltip', { diff: `${totalDiff > 0 ? '+' : ''}${totalDiff.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})}` }) : `${totalDiff > 0 ? '+' : ''}${totalDiff.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} € vs base`}">${totalDiff > 0 ? '+' : ''}${totalDiff.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} € vs base</div>` : ''}
                        </td>
                        <td style="padding:10px 12px;color:var(--text-muted);font-size:11px;">
                            <span style="opacity:0.35;">—</span>
                        </td>
                    </tr>
                </tfoot>
            </table>
        `;
    },

    renderChart() {
        const canvas = document.getElementById('simChartCanvas');
        if (!canvas || !this.simulationData || !this.simulationData.monthly_data) return;

        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }

        const data = this.simulationData.monthly_data;
        const labels = data.map(d => this.formatMonthLabel(d.month));
        const simData = data.map(d => d.simulated_end_balance);
        const baseData = data.map(d => d.baseline_end_balance);
        const optData = data.map(d => d.optimistic_end_balance);
        const pesData = data.map(d => d.pessimistic_end_balance);
        const hasConfidence = this.simulationData.variable_expense_stddev > 0;

        const isDark = document.body.classList.contains('theme-dark');
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
        const zeroGridColor = isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.22)';
        const textColor = isDark ? '#94a3b8' : '#64748b';

        const datasets = [];
        const pointRadius = this.horizonMonths > 60 ? (this.horizonMonths > 120 ? 0 : 1.5) : 4;
        const pointHoverRadius = this.horizonMonths > 60 ? 4 : 6;
        const baselinePointRadius = this.horizonMonths > 60 ? (this.horizonMonths > 120 ? 0 : 1) : 3;

        // Confidence band upper (optimistic) — must come before lower for fill between
        if (hasConfidence) {
            datasets.push({
                label: window.i18n.t('sim_tooltip_optimistic'),
                data: optData,
                borderColor: 'rgba(139, 92, 246, 0.25)',
                backgroundColor: 'rgba(139, 92, 246, 0.06)',
                borderWidth: 1,
                borderDash: [3, 3],
                fill: false,
                tension: 0.25,
                pointRadius: 0,
                pointHoverRadius: 3
            });
        }

        // Main simulated trajectory
        datasets.push({
            label: window.i18n.t('sim_chart_legend_simulated') || 'Trajectoire Simulée',
            data: simData,
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            borderWidth: 2.5,
            fill: false,
            tension: 0.25,
            pointBackgroundColor: simData.map(v => v < 0 ? '#ef4444' : '#8b5cf6'),
            pointBorderColor: '#fff',
            pointRadius: pointRadius,
            pointHoverRadius: pointHoverRadius
        });

        // Confidence band lower (pessimistic) — fill area between pessimistic and optimistic
        if (hasConfidence) {
            datasets.push({
                label: window.i18n.t('sim_tooltip_pessimistic'),
                data: pesData,
                borderColor: 'rgba(139, 92, 246, 0.25)',
                backgroundColor: 'rgba(139, 92, 246, 0.06)',
                borderWidth: 1,
                borderDash: [3, 3],
                fill: hasConfidence ? '-2' : false,  // Fill between this and 2 datasets back (optimistic)
                tension: 0.25,
                pointRadius: 0,
                pointHoverRadius: 3
            });
        }

        // Baseline trajectory
        datasets.push({
            label: window.i18n.t('sim_chart_legend_baseline') || 'Trajectoire Réelle',
            data: baseData,
            borderColor: '#94a3b8',
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            tension: 0.25,
            pointBackgroundColor: '#94a3b8',
            pointRadius: baselinePointRadius,
            pointHoverRadius: pointHoverRadius
        });

        const isMobile = window.innerWidth <= 600;
        const tickFontSize = isMobile ? 10 : 11;

        const ctx = canvas.getContext('2d');
        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 250,
                    easing: 'easeOutQuad'
                },
                interaction: {
                    intersect: false,
                    mode: 'index'
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                        titleColor: isDark ? '#fff' : '#0f172a',
                        bodyColor: isDark ? '#cbd5e1' : '#334155',
                        borderColor: isDark ? '#334155' : '#e2e8f0',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                label += context.parsed.y.toLocaleString('fr-FR', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' €';
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            color: gridColor,
                            borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)'
                        },
                        ticks: {
                            color: textColor,
                            font: { size: tickFontSize },
                            maxTicksLimit: isMobile ? 6 : 12,
                            maxRotation: isMobile ? 35 : 0
                        }
                    },
                    y: {
                        grace: '5%',
                        grid: {
                            color: (context) => {
                                if (context.tick && context.tick.value === 0) {
                                    return zeroGridColor;
                                }
                                return gridColor;
                            },
                            lineWidth: (context) => {
                                if (context.tick && context.tick.value === 0) {
                                    return 1.5;
                                }
                                return 1;
                            },
                            borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)'
                        },
                        ticks: {
                            color: textColor,
                            font: { size: tickFontSize },
                            maxTicksLimit: isMobile ? 5 : 8,
                            callback: function(value) {
                                if (isMobile && Math.abs(value) >= 1000) {
                                    return (value / 1000).toLocaleString('fr-FR', {maximumFractionDigits: 0}) + ' k€';
                                }
                                return value.toLocaleString('fr-FR') + ' €';
                            }
                        }
                    }
                }
            }
        });
    },

    // ── Handlers & Live Update ──
    _isOrgScenario(data) {
        return !!(data && data.scenario && data.scenario.uncertain_income_year !== null && data.scenario.uncertain_income_year !== undefined);
    },

    _formatEuro(value) {
        return `${Math.round(value || 0).toLocaleString((window.i18n && window.i18n.lang === 'en') ? 'en-US' : 'fr-FR')} €`;
    },

    getScenarioLabel(level) {
        const t = window.i18n.t.bind(window.i18n);
        if (level < 0) return t('sim_adv_level_favorable');
        if (level === 0) return t('sim_adv_level_recommended');
        if (level >= 1) return t('sim_adv_level_hard');
        return level < 0.5 ? t('sim_adv_level_difficult') : t('sim_adv_level_very_difficult');
    },

    _renderScenarioReadout(data) {
        const t = window.i18n.t.bind(window.i18n);
        const scenario = (data && data.scenario) || {};
        const rows = [];
        if (this._isOrgScenario(data)) {
            rows.push([t('sim_adv_org_income'), t('sim_adv_org_income_hint'), `${this._formatEuro(scenario.uncertain_income_year)}${t('sim_adv_per_year')}`]);
        } else if (!this.incomeMode || this.incomeMode === 'auto') {
            rows.push([t('sim_adv_other_income'), t('sim_adv_other_income_hint'), `${this._formatEuro(data && data.other_income_avg)}${t('sim_adv_per_month')}`]);
        }
        const factorPct = Math.round(((scenario.expense_factor || 1) - 1) * 100);
        const factorText = factorPct !== 0 ? ` (${factorPct > 0 ? '+' : '−'}${Math.abs(factorPct)} %)` : '';
        rows.push([t('sim_adv_expenses'), t('sim_adv_expenses_hint'), `${this._formatEuro(scenario.expense_month)}${t('sim_adv_per_month')}${factorText}`]);
        const inflation = ((scenario.inflation_rate || 0) * 100).toFixed(1).replace('.', (window.i18n && window.i18n.lang === 'en') ? '.' : ',');
        rows.push([t('sim_adv_inflation'), '', `${inflation} ${t('sim_adv_percent_per_year')}`]);
        return rows.map(([label, hint, value]) => `<div><dt${hint ? ` title="${escapeHtml(hint)}"` : ''}>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    },

    _scenarioResultNote(data) {
        const t = window.i18n.t.bind(window.i18n);
        const months = (data && data.monthly_data) || [];
        if (!months.length) return '';
        const firstNegative = months.find(m => m.simulated_end_balance < 0);
        if (firstNegative) return t('sim_adv_overdraft_from').replace('{month}', this.formatMonthLabel(firstNegative.month).toLowerCase());
        const lowest = months.reduce((low, m) => (m.simulated_end_balance < low.simulated_end_balance ? m : low));
        return t('sim_adv_no_overdraft').replace('{amount}', this._formatEuro(lowest.simulated_end_balance));
    },

    _effortLabel(data) {
        const pct = Math.round((this.varExpenseAdjustmentPct || 0) * 100);
        if (pct === 0) return '0 %';
        const base = (data && data.scenario && data.scenario.expense_month) || 0;
        const delta = Math.round(base * Math.abs(this.varExpenseAdjustmentPct));
        const sign = pct > 0 ? '+' : '−';
        return `${sign}${Math.abs(pct)} % (${sign}${delta.toLocaleString('fr-FR')} €${window.i18n.t('sim_adv_per_month')})`;
    },

    _excludedPurchasesHint(data) {
        const t = window.i18n.t.bind(window.i18n);
        const count = (data && data.excluded_outliers_count) || 0;
        if (!count) return t('sim_adv_none_excluded');
        return t('sim_adv_excluded').replace('{count}', count).replace('{amount}', this._formatEuro(data.excluded_outliers_total));
    },

    renderAdvancedPanel(data) {
        const t = window.i18n.t.bind(window.i18n);
        const scenario = (data && data.scenario) || {};
        const twoSided = !!scenario.favorable_available;
        const levelPct = Math.round((this.scenarioLevel || 0) * 100);
        const effortPct = Math.round((this.varExpenseAdjustmentPct || 0) * 100);
        const final = data ? data.simulated_final_balance : 0;
        const detailsOpen = ProfileStorage.get('sim_adv_details_open') === 'true';
        const income = this.incomeMode || 'auto';
        const option = (value, current, label) => `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;

        return `
            <div class="sim-adv">
                <div class="sim-adv-main">
                    <div class="sim-adv-scenario">
                        <div class="sim-adv-head">
                            <h3 class="sim-adv-title" id="simScenarioTitle">${t('sim_adv_scenario_title')}</h3>
                            <span class="sim-adv-level" id="simScenarioLabel">${escapeHtml(this.getScenarioLabel(this.scenarioLevel || 0))}</span>
                        </div>
                        <div class="sim-adv-slider-row">
                            <button type="button" class="sim-adv-stop" onclick="window.SimulatorView.setScenarioLevel(${twoSided ? -1 : 0})">${twoSided ? t('sim_adv_stop_favorable') : t('sim_adv_level_recommended')}</button>
                            <div class="sim-adv-track ${twoSided ? 'two-sided' : ''}" ${twoSided ? `title="${escapeHtml(t('sim_adv_level_recommended'))}"` : ''}>
                                <input type="range" id="simScenarioSlider" class="sim-range-input" min="${twoSided ? -100 : 0}" max="100" step="5" value="${levelPct}"
                                    aria-labelledby="simScenarioTitle" aria-valuetext="${escapeHtml(this.getScenarioLabel(this.scenarioLevel || 0))}"
                                    oninput="window.SimulatorView.onScenarioInput(this.value)">
                            </div>
                            <button type="button" class="sim-adv-stop" onclick="window.SimulatorView.setScenarioLevel(1)">${t('sim_adv_level_hard')}</button>
                        </div>
                        <dl class="sim-adv-readout" id="simScenarioReadout">${this._renderScenarioReadout(data)}</dl>
                        ${twoSided ? '' : `<p class="sim-adv-note">${t('sim_adv_favorable_unavailable')}</p>`}
                    </div>
                    <div class="sim-adv-effort">
                        <div class="sim-adv-head">
                            <label class="sim-adv-title" for="simVarAdjSlider">${t('sim_adv_effort_title')}</label>
                            <span class="sim-adv-effort-value" id="simVarAdjBadge">${escapeHtml(this._effortLabel(data))}</span>
                        </div>
                        <div class="sim-adv-slider-row">
                            <span class="sim-adv-stop">−50 %</span>
                            <div class="sim-adv-track">
                                <input type="range" id="simVarAdjSlider" class="sim-range-input" min="${Math.min(-50, effortPct)}" max="30" step="5" value="${effortPct}"
                                    oninput="window.SimulatorView.onVarExpenseAdjustmentInput(this.value)">
                            </div>
                            <span class="sim-adv-stop">+30 %</span>
                        </div>
                        <div class="sim-adv-result">
                            <span>${t('sim_adv_result_label').replace('{months}', this.horizonMonths)}</span>
                            <span class="sim-adv-result-value ${final < 0 ? 'is-negative' : ''}" id="simAdvResultValue">${this._formatEuro(final)}</span>
                            <span id="simAdvResultNote">${escapeHtml(this._scenarioResultNote(data))}</span>
                        </div>
                    </div>
                </div>
                <div class="sim-adv-bottom">
                    <details class="sim-adv-details" ${detailsOpen ? 'open' : ''} ontoggle="window.SimulatorView.onAdvancedDetailsToggle(this.open)">
                        <summary>${t('sim_adv_more_settings')}</summary>
                        <div class="sim-adv-fields">
                            ${this._isOrgScenario(data) ? '' : `
                            <label class="sim-adv-field">
                                ${t('sim_adv_purchases_label')}
                                <select id="simOutlierSelect" onchange="window.SimulatorView.onOutlierChoice(this.value)">
                                    ${option(4, this.outlierSensitivity, t('sim_adv_purchases_exceptional'))}
                                    ${option(2, this.outlierSensitivity, t('sim_adv_purchases_unusual'))}
                                    ${option(5, this.outlierSensitivity, t('sim_adv_purchases_keep'))}
                                </select>
                                <span class="sim-adv-field-hint" id="simOutlierHint">${escapeHtml(this._excludedPurchasesHint(data))}</span>
                            </label>`}
                            <label class="sim-adv-field">
                                ${t('sim_adv_income_label')}
                                <select id="simIncomeModeSelect" onchange="window.SimulatorView.onIncomeModeChange(this.value)">
                                    ${option('auto', income, t('sim_adv_income_auto'))}
                                    ${option('average', income, t('sim_adv_income_average'))}
                                    ${option('custom', income, t('sim_adv_income_custom'))}
                                    ${option('none', income, t('sim_adv_income_none'))}
                                </select>
                                ${income === 'custom' ? `<input type="number" step="50" min="0" id="simCustomIncomeInput" aria-label="${t('sim_adv_income_custom')}" value="${this.customIncomeAmount || 0}" onchange="window.SimulatorView.onCustomIncomeChange(this.value)">` : ''}
                            </label>
                            <label class="sim-adv-field">
                                ${t('sim_adv_rhythm_label')}
                                <select id="simSeasonalitySelect" onchange="window.SimulatorView.setSeasonalityMode(this.value)">
                                    ${option('disabled', this.seasonalityMode, t('sim_adv_rhythm_smooth'))}
                                    ${option('historical', this.seasonalityMode, t('sim_adv_rhythm_last_year'))}
                                </select>
                            </label>
                            <label class="sim-adv-field">
                                ${t('sim_adv_extra_inflation')}
                                <input type="number" step="0.5" min="0" max="20" id="simInflationInput" value="${((this.inflationRate || 0) * 100).toFixed(1)}" onchange="window.SimulatorView.onInflationChange(this.value)">
                            </label>
                        </div>
                    </details>
                    <button type="button" class="sim-adv-reset" onclick="window.SimulatorView.setSimMode('recommended')">${t('sim_adv_back_to_recommended')}</button>
                </div>
            </div>
        `;
    },

    /** Ce qui change la structure du panneau, et pas seulement ses valeurs. */
    _advancedPanelShape(data) {
        const scenario = (data && data.scenario) || {};
        return [!!scenario.favorable_available, this._isOrgScenario(data), this.horizonMonths, this.incomeMode].join('|');
    },

    _syncAdvancedPanel(data) {
        // Le premier affichage peut précéder le premier calcul : le panneau se recompose dès que sa forme change
        const container = document.getElementById('simAdvancedPanelContainer');
        if (container && container.dataset.shape !== this._advancedPanelShape(data)) {
            container.dataset.shape = this._advancedPanelShape(data);
            container.innerHTML = this.renderAdvancedPanel(data);
            return;
        }
        const label = this.getScenarioLabel(this.scenarioLevel || 0);
        const labelEl = document.getElementById('simScenarioLabel');
        if (labelEl) labelEl.textContent = label;
        const slider = document.getElementById('simScenarioSlider');
        if (slider) {
            slider.setAttribute('aria-valuetext', label);
            if (document.activeElement !== slider) slider.value = Math.round((this.scenarioLevel || 0) * 100);
        }
        const readout = document.getElementById('simScenarioReadout');
        if (readout) readout.innerHTML = this._renderScenarioReadout(data);
        const value = document.getElementById('simAdvResultValue');
        if (value) {
            value.textContent = this._formatEuro(data.simulated_final_balance);
            value.classList.toggle('is-negative', data.simulated_final_balance < 0);
        }
        const note = document.getElementById('simAdvResultNote');
        if (note) note.textContent = this._scenarioResultNote(data);
        const effort = document.getElementById('simVarAdjBadge');
        if (effort) effort.textContent = this._effortLabel(data);
        const effortSlider = document.getElementById('simVarAdjSlider');
        if (effortSlider && document.activeElement !== effortSlider) effortSlider.value = Math.round((this.varExpenseAdjustmentPct || 0) * 100);
        const hint = document.getElementById('simOutlierHint');
        if (hint) hint.textContent = this._excludedPurchasesHint(data);
    },

    _refreshTableSoon() {
        clearTimeout(this._tableDebounceTimer);
        this._tableDebounceTimer = setTimeout(() => {
            if (this.simulationData) {
                const tableContainer = document.getElementById('simMonthlyTableContainer');
                if (tableContainer) tableContainer.innerHTML = this.renderMonthlyTable(this.simulationData);
            }
        }, 150);
    },

    onScenarioInput(val) {
        this.scenarioLevel = (parseInt(val) || 0) / 100;
        const labelEl = document.getElementById('simScenarioLabel');
        if (labelEl) labelEl.textContent = this.getScenarioLabel(this.scenarioLevel);
        this._onCustomParamTouch();
        this._saveParam('sim_scenario_level', this.scenarioLevel);
        this._triggerLiveSimulation();
        this._refreshTableSoon();
    },

    async setScenarioLevel(level) {
        this.scenarioLevel = level;
        this._onCustomParamTouch();
        this._saveParam('sim_scenario_level', level);
        const slider = document.getElementById('simScenarioSlider');
        if (slider) slider.value = Math.round(level * 100);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async onOutlierChoice(val) {
        this.outlierSensitivity = parseInt(val) || 4;
        this._onCustomParamTouch();
        this._saveParam('sim_outlier_sensitivity', this.outlierSensitivity);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    onAdvancedDetailsToggle(isOpen) {
        this._saveParam('sim_adv_details_open', isOpen);
    },

    _triggerLiveSimulation() {
        if (!this._isSimulating) {
            this._runLiveSimulationLoop();
        } else {
            this._simNeedsRerun = true;
        }
    },

    async _runLiveSimulationLoop() {
        this._isSimulating = true;
        while (true) {
            this._simNeedsRerun = false;
            await this.runSimulation();
            this.updateLiveSimulationView(false); // Mise à jour instantanée du graphique & KPIs
            if (!this._simNeedsRerun) {
                break;
            }
            await new Promise(r => setTimeout(r, 20));
        }
        this._isSimulating = false;
    },

    async setSeasonalityMode(mode) {
        this.seasonalityMode = mode === 'historical' ? 'historical' : 'disabled';
        this._onCustomParamTouch();
        this._saveParam('sim_seasonality_mode', this.seasonalityMode);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async setSimMode(mode) {
        const targetMode = (mode === 'advanced' || mode === 'custom') ? 'advanced' : 'recommended';
        if (targetMode === this.simMode) return;
        this.simMode = targetMode;
        this._saveParam('sim_mode', targetMode);

        if (targetMode === 'recommended') {
            this.scenarioLevel = 0.0;
            this.incomeMode = 'auto';
            this.customIncomeAmount = null;
            this.varExpenseAdjustmentPct = 0.0;
            this.inflationRate = 0.0;
            this.seasonalityMode = 'disabled';
            this.outlierSensitivity = 4;

            this._batchSaveParams({
                sim_scenario_level: '0',
                sim_income_mode: 'auto',
                sim_custom_income: '',
                sim_var_expense_adj: '0.0',
                sim_inflation_rate: '0.0',
                sim_seasonality_mode: 'disabled',
                sim_outlier_sensitivity: '4'
            });

            await this.runSimulation();
            this.render();
            if (typeof showToast === 'function') {
                showToast(window.i18n.t('sim_toast_mode_recommended_activated') || 'Paramètres conseillés activés : projection sur socle garanti', 'info');
            }
        } else {
            // Restore custom / advanced settings
            const getSetting = (k, fb) => {
                const s = ProfileStorage.get(k);
                return (s !== null && s !== undefined && s !== '') ? s : fb;
            };
            // Sans réglage propre au nouveau panneau, le mode avancé part du mode conseillé
            const hasNewPanelSettings = getSetting('sim_custom_scenario_level', null) !== null;
            const customSetting = (key, fallback) => hasNewPanelSettings ? getSetting(key, fallback) : fallback;
            this.scenarioLevel = parseFloat(customSetting('sim_custom_scenario_level', '0')) || 0.0;
            const customIncomeMode = customSetting('sim_custom_income_mode', 'auto');
            this.incomeMode = customIncomeMode === 'historical_n1' ? 'auto' : customIncomeMode;
            const customInc = customSetting('sim_custom_income', null);
            this.customIncomeAmount = (customInc && customInc !== 'null' && customInc !== '') ? parseFloat(customInc) : null;
            this.varExpenseAdjustmentPct = parseFloat(customSetting('sim_custom_var_expense_adj', '0.0')) || 0.0;
            this.inflationRate = parseFloat(customSetting('sim_custom_inflation_rate', '0.0')) || 0.0;
            this.seasonalityMode = customSetting('sim_custom_seasonality_mode', 'disabled') === 'historical' ? 'historical' : 'disabled';
            this.outlierSensitivity = parseInt(customSetting('sim_custom_outlier_sensitivity', '4')) || 4;

            this._batchSaveParams({
                sim_scenario_level: String(this.scenarioLevel),
                sim_income_mode: String(this.incomeMode),
                sim_custom_income: this.customIncomeAmount !== null ? String(this.customIncomeAmount) : '',
                sim_var_expense_adj: String(this.varExpenseAdjustmentPct),
                sim_inflation_rate: String(this.inflationRate),
                sim_seasonality_mode: String(this.seasonalityMode),
                sim_outlier_sensitivity: String(this.outlierSensitivity)
            });

            await this.runSimulation();
            this.render();
            if (typeof showToast === 'function') {
                showToast(window.i18n.t('sim_toast_mode_advanced_activated') || 'Paramètres avancés activés', 'info');
            }
        }
    },

    _onCustomParamTouch() {
        if (this.simMode === 'recommended') {
            this.simMode = 'advanced';
            this._saveParam('sim_mode', 'advanced');
            this.updateModeToggleUI();
        }
        this._saveCustomParams();
    },

    _saveCustomParams() {
        this._batchSaveParams({
            sim_custom_scenario_level: String(this.scenarioLevel || 0),
            sim_custom_income_mode: String(this.incomeMode),
            sim_custom_income: this.customIncomeAmount !== null ? String(this.customIncomeAmount) : '',
            sim_custom_var_expense_adj: String(this.varExpenseAdjustmentPct),
            sim_custom_inflation_rate: String(this.inflationRate),
            sim_custom_seasonality_mode: String(this.seasonalityMode),
            sim_custom_outlier_sensitivity: String(this.outlierSensitivity)
        });
    },

    updateModeToggleUI() {
        const recBtn = document.getElementById('simModeRecommendedBtn') || document.getElementById('simModeCockpitBtn');
        const advBtn = document.getElementById('simModeAdvancedBtn') || document.getElementById('simModeCustomBtn');
        if (recBtn && advBtn) {
            if (this.simMode === 'recommended') {
                recBtn.className = 'btn btn-xs btn-primary';
                recBtn.style.fontWeight = '700';
                advBtn.className = 'btn btn-xs btn-ghost';
                advBtn.style.fontWeight = '500';
            } else {
                recBtn.className = 'btn btn-xs btn-ghost';
                recBtn.style.fontWeight = '500';
                advBtn.className = 'btn btn-xs btn-primary';
                advBtn.style.fontWeight = '700';
            }
        }
        const recStrip = document.getElementById('simRecommendedStrip');
        if (recStrip) {
            recStrip.style.display = this.simMode === 'recommended' ? 'flex' : 'none';
        }
        const advCard = document.getElementById('simAdvancedCard');
        if (advCard) {
            advCard.style.display = this.simMode === 'advanced' ? 'block' : 'none';
        }
    },

    toggleSection(section) {
        if (section === 'table') {
            const body = document.getElementById('simTableBody');
            const chevron = document.getElementById('simTableChevron');
            if (body && chevron) {
                const isOpen = body.classList.toggle('open');
                chevron.classList.toggle('open', isOpen);
                this._saveParam('sim_table_open', isOpen);
                if (isOpen && this.simulationData) {
                    const tableContainer = document.getElementById('simMonthlyTableContainer');
                    if (tableContainer && (!tableContainer.innerHTML || !tableContainer.innerHTML.trim())) {
                        tableContainer.innerHTML = this.renderMonthlyTable(this.simulationData);
                    }
                }
            }
        } else if (section === 'sources') {
            const body = document.getElementById('simSourcesBody');
            const chevron = document.getElementById('simSourcesChevron');
            const isCurrentlyOpen = ProfileStorage.get('sim_sources_open') === 'true';
            const willBeOpen = !isCurrentlyOpen;
            this._saveParam('sim_sources_open', willBeOpen);
            if (body) {
                body.style.maxHeight = willBeOpen ? '500px' : '0';
                body.style.opacity = willBeOpen ? '1' : '0';
                body.style.marginTop = willBeOpen ? '6px' : '0';
            }
            if (chevron) {
                chevron.classList.toggle('open', willBeOpen);
            }
            const btnText = document.querySelector('#simTransparencyContainer [data-i18n]');
            if (btnText && window.i18n) {
                const key = willBeOpen ? 'sim_hide_details' : 'sim_show_details';
                btnText.setAttribute('data-i18n', key);
                btnText.textContent = window.i18n.t(key);
            }
        }
    },

    updateLiveSimulationView(updateTable = false) {
        const data = this.simulationData;
        if (!data) return;

        // 1. Live Chart morphing with exact data keys
        // Le nombre de courbes dépend des bandes de confiance : s'il change, on reconstruit le graphique
        const hasConfidence = data.variable_expense_stddev > 0;
        if (this.chart && data.monthly_data && this.chart.data.datasets.length === (hasConfidence ? 4 : 2)) {
            const mData = data.monthly_data;
            const labels = mData.map(d => this.formatMonthLabel(d.month));
            const simData = mData.map(d => d.simulated_end_balance);
            const baseData = mData.map(d => d.baseline_end_balance);
            const optData = mData.map(d => d.optimistic_end_balance);
            const pesData = mData.map(d => d.pessimistic_end_balance);

            this.chart.data.labels = labels;

            if (hasConfidence) {
                if (this.chart.data.datasets[0]) this.chart.data.datasets[0].data = optData;
                if (this.chart.data.datasets[1]) {
                    this.chart.data.datasets[1].data = simData;
                    this.chart.data.datasets[1].pointBackgroundColor = simData.map(v => v < 0 ? '#ef4444' : '#8b5cf6');
                }
                if (this.chart.data.datasets[2]) this.chart.data.datasets[2].data = pesData;
                if (this.chart.data.datasets[3]) this.chart.data.datasets[3].data = baseData;
            } else {
                if (this.chart.data.datasets[0]) {
                    this.chart.data.datasets[0].data = simData;
                    this.chart.data.datasets[0].pointBackgroundColor = simData.map(v => v < 0 ? '#ef4444' : '#8b5cf6');
                }
                if (this.chart.data.datasets[1]) this.chart.data.datasets[1].data = baseData;
            }
            this.chart.update();
        } else {
            this.renderChart();
        }

        // 2. Update KPI container
        const kpiContainer = document.getElementById('simKpiGridContainer');
        if (kpiContainer) {
            kpiContainer.innerHTML = this.renderKPIs(data);
        }

        // 3. Update Transparency bar
        const transContainer = document.getElementById('simTransparencyContainer');
        if (transContainer) {
            transContainer.innerHTML = this.renderTransparencyBar(data);
        }

        // 4. Update Break-Even Banner
        const breakEvenContainer = document.getElementById('simBreakEvenBannerContainer');
        if (breakEvenContainer) {
            breakEvenContainer.innerHTML = this.renderBreakEvenBanner(data);
        }

        // 5. Update Advanced Panel & Mode Controls
        this.updateModeToggleUI();
        this._syncAdvancedPanel(data);

        // 6. Update Monthly Table (only on demand or settled pause)
        if (updateTable) {
            const tableContainer = document.getElementById('simMonthlyTableContainer');
            if (tableContainer) {
                tableContainer.innerHTML = this.renderMonthlyTable(data);
            }
        }
    },

    async onIncomeModeChange(val) {
        this.incomeMode = val;
        this._onCustomParamTouch();
        this._saveParam('sim_income_mode', val);
        if (val === 'custom' && !this.customIncomeAmount) {
            const defaultAmt = (this.simulationData && this.simulationData.predicted_salary) ? this.simulationData.predicted_salary : 2500;
            this.customIncomeAmount = defaultAmt;
            this._saveParam('sim_custom_income', defaultAmt);
        }
        await this.runSimulation();
        this.render();
    },

    async onCustomIncomeChange(val) {
        this.customIncomeAmount = parseFloat(val) || 0;
        this._onCustomParamTouch();
        this._saveParam('sim_custom_income', this.customIncomeAmount);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async onHorizonChange(val) {
        this.horizonMonths = parseInt(val);
        this._saveParam('sim_horizon', this.horizonMonths);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async onInflationChange(val) {
        this.inflationRate = (parseFloat(val) || 0) / 100;
        this._onCustomParamTouch();  // Convert from % to decimal
        this._saveParam('sim_inflation_rate', this.inflationRate);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    onVarExpenseAdjustmentInput(val) {
        this.varExpenseAdjustmentPct = (parseInt(val) || 0) / 100.0;
        this._onCustomParamTouch();
        const badge = document.getElementById('simVarAdjBadge');
        if (badge) badge.textContent = this._effortLabel(this.simulationData);
        this._saveParam('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        this._triggerLiveSimulation();
        this._refreshTableSoon();
    },

    async applyBreakEvenEffort(pct) {
        this._onCustomParamTouch();
        // Arrondi au pourcent supérieur (pas de 1%), plafonné à 100%
        let targetPct = Math.min(100, Math.ceil(pct));
        this.varExpenseAdjustmentPct = -(targetPct / 100.0);
        this._saveParam('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        const slider = document.getElementById('simVarAdjSlider');
        if (slider) {
            slider.min = Math.min(-50, -targetPct);
            slider.value = -targetPct;
        }
        await this.runSimulation();
        this.updateLiveSimulationView(true);
        if (typeof showToast === 'function') {
            showToast(`${window.i18n.t('sim_btn_apply_break_even').replace('{pct}', targetPct)}`, "info");
        }
    },

    async resetEffort() {
        this.varExpenseAdjustmentPct = 0.0;
        this._onCustomParamTouch();
        this._saveParam('sim_var_expense_adj', 0.0);
        const slider = document.getElementById('simVarAdjSlider');
        if (slider) slider.value = 0;
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async onAccountChange(val) {
        this.accountId = val ? parseInt(val) : null;
        this._saveParam('sim_account', this.accountId);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async onScenarioChange(val) {
        this.activeScenarioId = val ? parseInt(val) : null;
        this._saveParam('sim_active_scenario', this.activeScenarioId);
        await this.runSimulation();
        this.updateHeaderControls();
        this.updateLiveSimulationView(true);
    },

    async toggleEvent(eventId, isActive) {
        try {
            await API.put(`/api/simulator/events/${eventId}`, { is_active: isActive }, { skipMutateEvent: true });
            const scenario = this.scenarios.find(s => s.id === this.activeScenarioId);
            if (scenario && scenario.events) {
                const ev = scenario.events.find(e => e.id === eventId);
                if (ev) ev.is_active = isActive;
            }
            await this.runSimulation();
            this.updateHeaderControls();
            this.updateLiveSimulationView(true);
        } catch (err) {
            console.error("[SimulatorView] Erreur toggle event:", err);
            showToast("Erreur lors de l'activation/désactivation de l'événement", "error");
        }
    },

    // ── Scenario CRUD Modals ──
    openNewScenarioModal() {
        this.editingScenario = null;
        this.renderScenarioModal("sim_modal_scenario_title");
    },

    openEditScenarioModal(scenarioId) {
        const sc = this.scenarios.find(s => s.id === scenarioId);
        if (!sc) return;
        this.editingScenario = sc;
        this.renderScenarioModal("sim_modal_scenario_edit_title");
    },

    renderScenarioModal(titleKey) {
        const sc = this.editingScenario || { name: '', description: '', color: '#8b5cf6' };
        const modalHtml = `
            <div class="modal-overlay" id="simScenarioModal" style="display:flex;">
                <div class="modal" style="width: min(500px, calc(100vw - 24px)); max-width: 95vw; max-height: 90vh; border-radius: 14px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6); padding: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--bg-surface);">
                    <div class="modal-header">
                        <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                            <div class="modal-header-icon-badge">🔮</div>
                            <div class="modal-header-info">
                                <h3 class="modal-header-title" data-i18n="${titleKey}">${window.i18n.t(titleKey)}</h3>
                                <div class="modal-header-desc" data-i18n="sim_modal_scenario_desc">Paramètres du scénario prévisionnel</div>
                            </div>
                        </div>
                        <button type="button" class="modal-close-btn" onclick="window.SimulatorView.closeModal('simScenarioModal')" aria-label="Fermer" title="Fermer">✕</button>
                    </div>
                    <form onsubmit="event.preventDefault(); window.SimulatorView.saveScenarioModal();" style="display: flex; flex-direction: column; flex: 1; overflow: hidden; margin: 0;">
                        <div style="padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 16px;">
                            <div>
                                <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:6px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_name">
                                    ${window.i18n.t('sim_field_name')} *
                                </label>
                                <input type="text" id="simScName" class="inline-input" required value="${escapeHtml(sc.name)}" placeholder="${window.i18n.t('sim_ph_scenario_name') || 'ex: Achat Véhicule, Travaux Cuisine'}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                            </div>
                            <div>
                                <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:6px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_description">
                                    ${window.i18n.t('sim_field_description')}
                                </label>
                                <textarea id="simScDesc" class="inline-input" rows="2" placeholder="${window.i18n.t('sim_ph_scenario_desc') || 'Notes optionnelles...'}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main); resize: vertical;">${escapeHtml(sc.description || '')}</textarea>
                            </div>
                            <div>
                                <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:6px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_color">
                                    ${window.i18n.t('sim_field_color')}
                                </label>
                                <div style="display:flex;gap:10px;align-items:center;">
                                    <input type="color" id="simScColor" value="${sc.color || '#8b5cf6'}" style="width:44px;height:34px;border:none;border-radius:6px;cursor:pointer;background:none;padding:0;">
                                    <span style="font-size:12px;color:var(--text-muted);">${window.i18n.t('sim_color_hint') || 'Couleur visuelle du scénario'}</span>
                                </div>
                            </div>
                        </div>
                        <div class="modal-footer-pinned">
                            <button type="button" class="btn btn-secondary" onclick="window.SimulatorView.closeModal('simScenarioModal')">${window.i18n.t('btn_cancel') || 'Annuler'}</button>
                            <button type="submit" class="btn btn-primary">${window.i18n.t('btn_save') || 'Enregistrer'}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.getElementById('simModalsContainer').innerHTML = modalHtml;
    },

    async saveScenarioModal() {
        const name = document.getElementById('simScName').value.trim();
        const description = document.getElementById('simScDesc').value.trim();
        const color = document.getElementById('simScColor').value;

        if (!name) return;

        try {
            if (this.editingScenario) {
                const res = await API.put(`/api/simulator/scenarios/${this.editingScenario.id}`, { name, description, color }, { skipMutateEvent: true });
                showToast(window.i18n.t('sim_toast_scenario_updated') || "Scénario mis à jour", "success");
            } else {
                const res = await API.post('/api/simulator/scenarios', { name, description, color, events: [] }, { skipMutateEvent: true });
                this.activeScenarioId = res.id;
                this._saveParam('sim_active_scenario', res.id);
                showToast(window.i18n.t('sim_toast_scenario_created') || "Nouveau scénario créé", "success");
            }
            this.closeModal('simScenarioModal');
            await this.loadData();
        } catch (err) {
            console.error("[SimulatorView] Erreur sauvegarde scénario:", err);
            showToast("Erreur lors de l'enregistrement", "error");
        }
    },

    async deleteScenario(scenarioId) {
        if (await showInlineConfirm(window.i18n.t('title_confirmation') || "Confirmation", window.i18n.t('sim_confirm_delete_scenario') || "Supprimer définitivement ce scénario et tous ses événements ?")) {
            try {
                await API.del(`/api/simulator/scenarios/${scenarioId}`, null, null, { skipMutateEvent: true });
                showToast(window.i18n.t('sim_toast_scenario_deleted') || "Scénario supprimé", "info");
                if (this.activeScenarioId === scenarioId) {
                    this.activeScenarioId = null;
                    this._saveParam('sim_active_scenario', null);
                }
                await this.loadData();
            } catch (err) {
                console.error("[SimulatorView] Erreur suppression scénario:", err);
                showToast("Erreur lors de la suppression", "error");
            }
        }
    },

    async duplicateScenario(scenarioId) {
        try {
            const res = await API.post(`/api/simulator/scenarios/${scenarioId}/duplicate`, {}, { skipMutateEvent: true });
            this.activeScenarioId = res.id;
            this._saveParam('sim_active_scenario', res.id);
            showToast(window.i18n.t('sim_toast_scenario_duplicated') || "Scénario dupliqué", "success");
            await this.loadData();
        } catch (err) {
            console.error("[SimulatorView] Erreur duplication:", err);
            showToast("Erreur lors de la duplication", "error");
        }
    },

    // ── Presets Modal ──
    openPresetsModal() {
        const isEn = window.i18n && window.i18n.lang === 'en';
        const modalHtml = `
            <div class="modal-overlay" id="simPresetsModal" style="display:flex;">
                <div class="modal" style="width: min(600px, calc(100vw - 24px)); max-width: 95vw; max-height: 90vh; border-radius: 14px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6); padding: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--bg-surface);">
                    <div class="modal-header">
                        <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                            <div class="modal-header-icon-badge">✨</div>
                            <div class="modal-header-info">
                                <h3 class="modal-header-title" data-i18n="sim_modal_presets_title">${window.i18n.t('sim_modal_presets_title')}</h3>
                                <div class="modal-header-desc" data-i18n="sim_modal_presets_desc">Modèles de projets types préconfigurés</div>
                            </div>
                        </div>
                        <button type="button" class="modal-close-btn" onclick="window.SimulatorView.closeModal('simPresetsModal')" aria-label="Fermer" title="Fermer">✕</button>
                    </div>
                    <div style="padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px;">
                        ${this.presets.filter(p => !p.personal_only || !this._isOrgScenario(this.simulationData)).map(p => {
                            const pName = isEn ? (p.name_en || window.i18n.t(p.i18n_key) || p.name) : (p.name_fr || window.i18n.t(p.i18n_key) || p.name);
                            const pDesc = isEn ? (p.desc_en || window.i18n.t(`${p.i18n_key}_desc`) || p.description) : (p.desc_fr || window.i18n.t(`${p.i18n_key}_desc`) || p.description);

                            return `
                                <div style="background:var(--bg-base);border:1px solid var(--border-color);border-radius:10px;padding:14px;display:flex;justify-content:space-between;align-items:center;gap:16px;cursor:pointer;transition:all 0.2s;" class="preset-card" onclick="window.SimulatorView.applyPreset('${p.id}')">
                                    <div>
                                        <div style="font-weight:700;font-size:13px;color:var(--text-main);display:flex;align-items:center;gap:8px;">
                                            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color};"></span>
                                            ${escapeHtml(pName)}
                                        </div>
                                        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;line-height:1.3;">
                                            ${escapeHtml(pDesc)}
                                        </div>
                                    </div>
                                    <button class="btn btn-primary btn-xs" style="white-space:nowrap;">
                                        ${window.i18n.t('sim_btn_use_preset')} →
                                    </button>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="modal-footer-pinned">
                        <button type="button" class="btn btn-secondary" onclick="window.SimulatorView.closeModal('simPresetsModal')">${window.i18n.t('btn_close') || 'Fermer'}</button>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('simModalsContainer').innerHTML = modalHtml;
    },

    async applyPreset(presetId) {
        const preset = this.presets.find(p => p.id === presetId);
        if (!preset) return;

        const isEn = window.i18n && window.i18n.lang === 'en';
        const todayStr = new Date().toISOString().split('T')[0];
        const pName = isEn ? (preset.name_en || preset.name) : (preset.name_fr || preset.name);
        const pDesc = isEn ? (preset.desc_en || preset.description) : (preset.desc_fr || preset.description);

        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
        const pad = n => String(n).padStart(2, '0');
        const startDate = preset.start_next_month ? `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-01` : todayStr;

        const eventsPayload = preset.events.map(ev => ({
            label: isEn ? (ev.label_en || ev.label) : (ev.label_fr || ev.label),
            event_type: ev.event_type,
            amount: ev.amount,
            start_date: startDate,
            duration_months: ev.duration_months,
            is_active: true,
            notes: isEn ? (ev.notes_en || ev.notes) : (ev.notes_fr || ev.notes)
        }));

        try {
            const created = await API.post('/api/simulator/scenarios', {
                name: pName,
                description: pDesc,
                color: preset.color,
                is_active: true,
                events: eventsPayload
            }, { skipMutateEvent: true });

            this.activeScenarioId = created.id;
            this._saveParam('sim_active_scenario', created.id);
            this.closeModal('simPresetsModal');
            const toastMsg = (window.i18n.t('sim_toast_preset_applied') || 'Modèle "{name}" appliqué').replace('{name}', pName);
            showToast(toastMsg, "success");
            await this.loadData();
            if (preset.edit_after_apply) {
                const scenario = this.scenarios.find(s => s.id === created.id);
                if (scenario && scenario.events && scenario.events[0]) this.openEditEventModal(scenario.events[0].id);
            }
        } catch (err) {
            console.error("[SimulatorView] Erreur application preset:", err);
            showToast("Erreur lors de l'application du modèle", "error");
        }
    },

    // ── Events CRUD Modal ──
    openAddEventModal() {
        this.editingEvent = null;
        this.renderEventModal("sim_modal_event_title");
    },

    openEditEventModal(eventId) {
        const scenario = this.scenarios.find(s => s.id === this.activeScenarioId);
        if (!scenario || !scenario.events) return;
        const ev = scenario.events.find(e => e.id === eventId);
        if (!ev) return;
        this.editingEvent = ev;
        this.renderEventModal("sim_modal_event_edit_title");
    },

    renderEventModal(titleKey) {
        const todayStr = new Date().toISOString().split('T')[0];
        const ev = this.editingEvent || {
            label: '',
            event_type: 'one_off_expense',
            amount: 1000,
            start_date: todayStr,
            duration_months: 1,
            notes: ''
        };

        const modalHtml = `
            <div class="modal-overlay" id="simEventModal" style="display:flex;">
                <div class="modal" style="width: min(520px, calc(100vw - 24px)); max-width: 95vw; max-height: 90vh; border-radius: 14px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6); padding: 0; overflow: hidden; display: flex; flex-direction: column; background: var(--bg-surface);">
                    <div class="modal-header">
                        <div style="display:flex; align-items:center; gap:12px; flex:1; min-width:0;">
                            <div class="modal-header-icon-badge">➕</div>
                            <div class="modal-header-info">
                                <h3 class="modal-header-title" data-i18n="${titleKey}">${window.i18n.t(titleKey)}</h3>
                                <div class="modal-header-desc" data-i18n="sim_modal_event_desc">Flux de trésorerie prévisionnel</div>
                            </div>
                        </div>
                        <button type="button" class="modal-close-btn" onclick="window.SimulatorView.closeModal('simEventModal')" aria-label="Fermer" title="Fermer">✕</button>
                    </div>
                    <form onsubmit="event.preventDefault(); window.SimulatorView.saveEventModal();" style="display: flex; flex-direction: column; flex: 1; overflow: hidden; margin: 0;">
                        <div style="padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px;">
                            <div>
                                <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_label">
                                    ${window.i18n.t('sim_field_label')} *
                                </label>
                                <input type="text" id="simEvLabel" class="inline-input" required value="${escapeHtml(ev.label)}" placeholder="${window.i18n.t('sim_ph_event_label') || 'ex: Apport personnel, Mensualité crédit'}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                            </div>

                            <div class="sim-ev-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                                <div>
                                    <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_type">
                                        ${window.i18n.t('sim_field_type')}
                                    </label>
                                    <select id="simEvType" class="inline-input" onchange="window.SimulatorView.onEventTypeChange(this.value)" style="width: 100%; box-sizing: border-box; font-size: 12px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                                        <option value="one_off_expense" ${ev.event_type === 'one_off_expense' ? 'selected' : ''}>${window.i18n.t('sim_event_type_one_off_expense')}</option>
                                        <option value="one_off_income" ${ev.event_type === 'one_off_income' ? 'selected' : ''}>${window.i18n.t('sim_event_type_one_off_income')}</option>
                                        <option value="recurring_expense" ${ev.event_type === 'recurring_expense' ? 'selected' : ''}>${window.i18n.t('sim_event_type_recurring_expense')}</option>
                                        <option value="recurring_income" ${ev.event_type === 'recurring_income' ? 'selected' : ''}>${window.i18n.t('sim_event_type_recurring_income')}</option>
                                        <option value="percentage_adjustment" ${ev.event_type === 'percentage_adjustment' ? 'selected' : ''}>${window.i18n.t('sim_event_type_percentage_adjustment')}</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_amount">
                                        ${window.i18n.t('sim_field_amount')} *
                                    </label>
                                    <input type="number" step="0.01" id="simEvAmount" class="inline-input" required value="${ev.amount || 0}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                                </div>
                            </div>

                            <div class="sim-ev-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                                <div>
                                    <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_start_date">
                                        ${window.i18n.t('sim_field_start_date')} *
                                    </label>
                                    <input type="date" id="simEvStartDate" class="inline-input" required value="${ev.start_date || todayStr}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                                </div>
                                <div id="simEvDurationGroup">
                                    <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_duration">
                                        ${window.i18n.t('sim_field_duration')}
                                    </label>
                                    <input type="number" id="simEvDuration" class="inline-input" min="1" max="36" value="${ev.duration_months || 1}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                                </div>
                            </div>

                            <div>
                                <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_account">
                                    ${window.i18n.t('sim_field_account')}
                                </label>
                                <select id="simEvAccount" class="inline-input" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                                    <option value="">${window.i18n.t('sim_event_account_projected')}</option>
                                    ${this.accounts.map(a => `<option value="${a.id}" ${ev.account_id === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
                                </select>
                            </div>

                            <div>
                                <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_description">
                                    ${window.i18n.t('sim_field_description')}
                                </label>
                                <input type="text" id="simEvNotes" class="inline-input" value="${escapeHtml(ev.notes || '')}" placeholder="${window.i18n.t('sim_ph_event_notes') || 'Notes contextuelles...'}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                            </div>
                        </div>

                        <div class="modal-footer-pinned">
                            <button type="button" class="btn btn-secondary" onclick="window.SimulatorView.closeModal('simEventModal')">${window.i18n.t('btn_cancel') || 'Annuler'}</button>
                            <button type="submit" class="btn btn-primary">${window.i18n.t('btn_save') || 'Enregistrer'}</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.getElementById('simModalsContainer').innerHTML = modalHtml;
    },

    onEventTypeChange(type) {
        const durGroup = document.getElementById('simEvDurationGroup');
        if (!durGroup) return;
        if (type === 'one_off_expense' || type === 'one_off_income') {
            document.getElementById('simEvDuration').value = 1;
            durGroup.style.opacity = '0.4';
        } else {
            durGroup.style.opacity = '1';
        }
    },

    async saveEventModal() {
        if (!this.activeScenarioId) {
            showToast("Veuillez d'abord sélectionner ou créer un scénario", "warning");
            return;
        }

        const label = document.getElementById('simEvLabel').value.trim();
        const event_type = document.getElementById('simEvType').value;
        const amount = parseFloat(document.getElementById('simEvAmount').value) || 0;
        const start_date = document.getElementById('simEvStartDate').value;
        const duration_months = parseInt(document.getElementById('simEvDuration').value) || 1;
        const notes = document.getElementById('simEvNotes').value.trim();
        const accountValue = document.getElementById('simEvAccount').value;

        if (!label || !start_date) return;

        const payload = {
            label,
            event_type,
            amount,
            account_id: accountValue ? parseInt(accountValue) : null,
            start_date,
            duration_months,
            notes,
            is_active: true
        };

        try {
            if (this.editingEvent) {
                await API.put(`/api/simulator/events/${this.editingEvent.id}`, payload, { skipMutateEvent: true });
                showToast(window.i18n.t('sim_toast_event_updated') || "Événement mis à jour", "success");
            } else {
                await API.post(`/api/simulator/scenarios/${this.activeScenarioId}/events`, payload, { skipMutateEvent: true });
                showToast(window.i18n.t('sim_toast_event_added') || "Événement ajouté au scénario", "success");
            }
            this.closeModal('simEventModal');
            await this.loadData();
        } catch (err) {
            console.error("[SimulatorView] Erreur sauvegarde événement:", err);
            showToast("Erreur lors de l'enregistrement de l'événement", "error");
        }
    },

    async deleteEvent(eventId) {
        if (await showInlineConfirm(window.i18n.t('title_confirmation') || "Confirmation", window.i18n.t('sim_confirm_delete_event') || "Supprimer cet événement simulé ?")) {
            try {
                await API.del(`/api/simulator/events/${eventId}`, null, null, { skipMutateEvent: true });
                showToast(window.i18n.t('sim_toast_event_deleted') || "Événement supprimé", "info");
                await this.loadData();
            } catch (err) {
                console.error("[SimulatorView] Erreur suppression événement:", err);
                showToast("Erreur lors de la suppression", "error");
            }
        }
    },

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('active');
            modal.remove();
        }
    }
};
