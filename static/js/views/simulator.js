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
    conservativeWeight: 0.20,
    outlierSensitivity: 2,
    seasonalityMode: 'disabled',
    seasonalityIntensity: 1.0,
    isSeasonalityProfileOpen: false,
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
        this.incomeMode = getSetting('sim_income_mode', 'historical_n1');
        const savedCustom = getSetting('sim_custom_income', null);
        this.customIncomeAmount = savedCustom && savedCustom !== 'null' && savedCustom !== '' ? parseFloat(savedCustom) : null;
        const savedInflation = getSetting('sim_inflation_rate', '0.0');
        this.inflationRate = savedInflation && savedInflation !== 'null' && savedInflation !== '' ? parseFloat(savedInflation) : 0.0;
        const savedVarAdj = getSetting('sim_var_expense_adj', '0.0');
        this.varExpenseAdjustmentPct = savedVarAdj && savedVarAdj !== 'null' && savedVarAdj !== '' ? parseFloat(savedVarAdj) : 0.0;
        const savedOutlierSens = getSetting('sim_outlier_sensitivity', '2');
        this.outlierSensitivity = savedOutlierSens && savedOutlierSens !== 'null' && savedOutlierSens !== '' ? parseInt(savedOutlierSens) : 2;
        const rawSeasonality = getSetting('sim_seasonality_mode', 'disabled');
        this.seasonalityMode = ['disabled', 'historical', 'preset_standard'].includes(rawSeasonality) ? rawSeasonality : 'disabled';
        const savedSeasIntensity = getSetting('sim_seasonality_intensity', '1.0');
        this.seasonalityIntensity = (savedSeasIntensity !== null && savedSeasIntensity !== undefined && savedSeasIntensity !== '') ? Math.max(0.0, Math.min(1.0, parseFloat(savedSeasIntensity))) : 1.0;
        if (isNaN(this.seasonalityIntensity)) this.seasonalityIntensity = 1.0;
        this.isSeasonalityProfileOpen = getSetting('sim_seasonality_profile_open', 'false') === 'true';
        
        const savedWeight = getSetting('sim_conservative_weight', null);
        if (savedWeight !== null && savedWeight !== undefined && savedWeight !== '') {
            this.conservativeWeight = parseFloat(savedWeight);
        } else {
            const savedProf = ProfileStorage.get('sim_projection_profile');
            this.conservativeWeight = (savedProf === 'conservative') ? 1.0 : ((savedProf === 'realistic') ? 0.0 : 0.20);
        }
        if (isNaN(this.conservativeWeight)) this.conservativeWeight = 0.20;

        // Synchronisation du ProfileStorage local avec les valeurs résolues
        ProfileStorage.set('sim_horizon', this.horizonMonths);
        if (this.accountId !== null) ProfileStorage.set('sim_account', this.accountId);
        if (this.activeScenarioId !== null) ProfileStorage.set('sim_active_scenario', this.activeScenarioId);
        ProfileStorage.set('sim_income_mode', this.incomeMode);
        ProfileStorage.set('sim_custom_income', this.customIncomeAmount !== null ? this.customIncomeAmount : '');
        ProfileStorage.set('sim_inflation_rate', this.inflationRate);
        ProfileStorage.set('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        ProfileStorage.set('sim_outlier_sensitivity', this.outlierSensitivity);
        ProfileStorage.set('sim_seasonality_mode', this.seasonalityMode);
        ProfileStorage.set('sim_seasonality_intensity', this.seasonalityIntensity);
        ProfileStorage.set('sim_seasonality_profile_open', this.isSeasonalityProfileOpen);
        ProfileStorage.set('sim_conservative_weight', this.conservativeWeight);
        ProfileStorage.set('sim_advanced_open', getSetting('sim_advanced_open', 'false') === 'true');
        ProfileStorage.set('sim_table_open', getSetting('sim_table_open', 'false') === 'true');
        ProfileStorage.set('sim_sources_open', getSetting('sim_sources_open', 'false') === 'true');

        await this.loadData();
    },

    async loadData() {
        this.isLoading = true;
        try {
            const [scenariosRes, presetsRes, accountsRes] = await Promise.all([
                API.get('/api/simulator/scenarios'),
                API.get('/api/simulator/presets'),
                API.get('/api/accounts/')
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
                income_mode: this.incomeMode,
                custom_income_amount: this.customIncomeAmount,
                inflation_rate: this.inflationRate || 0.0,
                variable_expense_adjustment_pct: this.varExpenseAdjustmentPct || 0.0,
                conservative_weight: (typeof this.conservativeWeight === 'number') ? this.conservativeWeight : 0.0,
                outlier_sensitivity: this.outlierSensitivity || 2,
                seasonality_mode: this.seasonalityMode || 'disabled',
                seasonality_intensity: (typeof this.seasonalityIntensity === 'number') ? this.seasonalityIntensity : 1.0
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
        const estSalary = (data && data.predicted_salary) ? Math.round(data.predicted_salary) : 0;
        const avgIncome = (data && data.historical_real_income_avg) ? Math.round(data.historical_real_income_avg) : estSalary;

        // Collapsible state from ProfileStorage
        const advancedOpen = ProfileStorage.get('sim_advanced_open') === 'true';
        const tableOpen = ProfileStorage.get('sim_table_open') === 'true';
        const sourcesOpen = ProfileStorage.get('sim_sources_open') === 'true';

        // Compact summary line for controls panel
        const prudencePct = Math.round((this.conservativeWeight || 0) * 100);
        const effortPct = Math.round((this.varExpenseAdjustmentPct || 0) * 100);
        const compactSummaryParts = [];
        compactSummaryParts.push(`🛡️ ${prudencePct === 0 ? (window.i18n.t('sim_prudence_badge_100real') || 'Recettes du modèle') : (prudencePct === 100 ? (window.i18n.t('sim_prudence_badge_100cons') || 'Recettes minimales') : `Prudence ${prudencePct}%`)}`);
        compactSummaryParts.push(`⚡ ${effortPct > 0 ? '+' : ''}${effortPct}%`);
        const incomeBadge = (!this.incomeMode || this.incomeMode === 'historical_n1' || this.incomeMode === 'auto')
            ? (window.i18n.t('sim_income_badge_historical_n1') || 'Année passée')
            : (this.incomeMode === 'average' ? `${window.i18n.t('sim_income_badge_average') || 'Moyenne'}${avgIncome > 0 ? ` (~${avgIncome.toLocaleString('fr-FR')} €)` : ''}` : (this.incomeMode === 'custom' ? `${(this.customIncomeAmount || 0).toLocaleString('fr-FR')} €` : (window.i18n.t('sim_income_badge_zero') || 'Zéro salaire')));
        compactSummaryParts.push(`💼 ${incomeBadge}`);
        if (this.inflationRate > 0) compactSummaryParts.push(`📈 ${(this.inflationRate * 100).toFixed(1)}%`);
        const outlierLevel = this.outlierSensitivity || 2;
        const outlierLabel = this.getOutlierSensitivityLabel(outlierLevel);
        const excCount = (data && data.excluded_outliers_count) ? data.excluded_outliers_count : 0;
        compactSummaryParts.push(`🧹 ${outlierLabel}${excCount > 0 ? ` (${excCount})` : ''}`);

        // Seasonality summary badge
        const currentSeasPct = this.getSeasonalityIntensityPct();
        if (this.seasonalityMode === 'historical') {
            const seasMonths = (data && data.seasonal_history_months) ? data.seasonal_history_months : 0;
            compactSummaryParts.push(`🍂 ${window.i18n.t('sim_seasonality_badge_historical') || 'Historique'} ${seasMonths}m (${currentSeasPct}%)`);
        } else if (this.seasonalityMode === 'preset_standard') {
            compactSummaryParts.push(`🏖️ ${window.i18n.t('sim_seasonality_badge_preset') || 'Vacances & Fêtes'} (${currentSeasPct}%)`);
        } else {
            compactSummaryParts.push(`🍂 ${window.i18n.t('sim_seasonality_badge_disabled') || 'Lissée'}`);
        }

        const compactSummary = compactSummaryParts.join('  <span style="opacity:0.3;">│</span>  ');

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
                .sim-sliders-grid {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 20px;
                    align-items: start;
                }
                @media (max-width: 1100px) {
                    .sim-sliders-grid {
                        grid-template-columns: 1fr;
                    }
                    .sim-secondary-controls {
                        border-left: none !important;
                        padding-left: 0 !important;
                        border-top: 1px solid var(--border-color);
                        padding-top: 14px;
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
                .sim-slider-label-btn {
                    font-size: 10px;
                    font-weight: 600;
                    color: var(--text-muted);
                    background: transparent;
                    border: none;
                    padding: 2px 4px;
                    cursor: pointer;
                    transition: color 0.15s ease, transform 0.15s ease;
                    white-space: nowrap;
                    line-height: 1.2;
                }
                .sim-slider-label-btn:hover {
                    color: var(--accent, #6366f1);
                    transform: scale(1.05);
                }
                .sim-slider-badge-btn {
                    font-size: 11px;
                    font-weight: 800;
                    padding: 2px 8px;
                    border-radius: 6px;
                    background: var(--bg-base);
                    border: 1px solid var(--border-color);
                    cursor: pointer;
                    transition: all 0.15s ease;
                    line-height: 1.2;
                }
                .sim-slider-badge-btn:hover {
                    border-color: var(--accent, #6366f1);
                    transform: scale(1.04);
                }
                .sim-seasonality-toggle-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    padding: 4px 10px;
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-muted);
                    background: var(--bg-base);
                    border: 1px solid var(--border-color);
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.15s ease;
                }
                .sim-seasonality-toggle-btn:hover {
                    color: var(--text-main);
                    border-color: var(--accent, #6366f1);
                    background: rgba(99, 102, 241, 0.05);
                }
                .sim-seasonality-toggle-btn.active {
                    color: var(--accent, #6366f1);
                    border-color: rgba(99, 102, 241, 0.4);
                    background: rgba(99, 102, 241, 0.1);
                    font-weight: 700;
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
                    .sim-sliders-grid {
                        grid-template-columns: 1fr !important;
                        gap: 16px !important;
                    }
                    .sim-secondary-controls {
                        border-left: none !important;
                        padding-left: 0 !important;
                        border-top: 1px solid var(--border-color);
                        padding-top: 14px !important;
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
                    #simAdvancedSummary {
                        font-size: 10.5px !important;
                        max-width: 155px !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        white-space: nowrap !important;
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
                    .sim-slider-header {
                        display: flex !important;
                        justify-content: space-between !important;
                        align-items: center !important;
                        flex-wrap: wrap !important;
                        gap: 6px !important;
                    }
                    .sim-slider-badge-btn {
                        white-space: normal !important;
                        max-width: 100% !important;
                        height: auto !important;
                        padding: 3px 8px !important;
                        text-align: right !important;
                        line-height: 1.25 !important;
                    }
                    .sim-seasonality-row {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        gap: 10px !important;
                    }
                    .sim-seasonality-mode-container {
                        flex-direction: column !important;
                        align-items: stretch !important;
                        width: 100% !important;
                        gap: 8px !important;
                    }
                    .sim-seasonality-btn-group {
                        display: flex !important;
                        flex-direction: column !important;
                        width: 100% !important;
                        gap: 4px !important;
                        background: transparent !important;
                        border: none !important;
                        padding: 0 !important;
                    }
                    .sim-seasonality-btn-group .btn {
                        width: 100% !important;
                        justify-content: flex-start !important;
                        padding: 8px 12px !important;
                        font-size: 12px !important;
                        height: auto !important;
                        min-height: 36px !important;
                        white-space: normal !important;
                        border-radius: 8px !important;
                        border: 1px solid var(--border-color) !important;
                    }
                    .sim-seasonality-toggle-btn {
                        width: 100% !important;
                        justify-content: center !important;
                        padding: 7px 12px !important;
                        margin-top: 4px !important;
                    }
                }
                @media (max-width: 420px) {
                    .sim-kpi-grid {
                        grid-template-columns: 1fr;
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

            <!-- ═══ Collapsible Advanced Controls Panel ═══ -->
            <div class="sim-card" style="margin-bottom:16px;padding:0;overflow:hidden;">
                <div class="sim-collapsible-header" onclick="window.SimulatorView.toggleSection('advanced')">
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:13px;">⚙️</span>
                        <span style="font-size:12px;font-weight:700;color:var(--text-main);" data-i18n="sim_advanced_params">${window.i18n.t('sim_advanced_params')}</span>
                        <span id="simAdvancedSummary" style="font-size:11px;color:var(--text-muted);margin-left:6px;">${compactSummary}</span>
                    </div>
                    <span class="sim-collapsible-chevron ${advancedOpen ? 'open' : ''}" id="simAdvancedChevron">▸</span>
                </div>
                <div class="sim-collapsible-body ${advancedOpen ? 'open' : ''}" id="simAdvancedBody">
                    <div class="sim-sliders-grid" style="gap:24px;align-items:start;">
                        <!-- Colonne 1 : Curseur de Prudence & Réalisme -->
                        <div style="display:flex;flex-direction:column;gap:6px;">
                            <div class="sim-slider-header" style="display:flex;justify-content:space-between;align-items:center;">
                                <label style="font-size:12px;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:6px;" title="${window.i18n.t('sim_prudence_slider_tooltip')}">
                                    <span style="font-size:14px;">🛡️</span>
                                    <span data-i18n="sim_prudence_title">${window.i18n.t('sim_prudence_title')}</span>
                                </label>
                                <button type="button" id="simPrudenceBadge" class="sim-slider-badge-btn" onclick="window.SimulatorView.setPrudenceWeight(0.5)" title="${window.i18n.t('sim_tooltip_click_blend')}" style="color:${(this.conservativeWeight || 0) === 0 ? '#10b981' : ((this.conservativeWeight || 0) >= 0.8 ? '#ef4444' : ((this.conservativeWeight || 0) >= 0.4 ? '#f59e0b' : 'var(--text-main)'))};">
                                    ${this.getPrudenceBadgeText(this.conservativeWeight || 0)}
                                </button>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;width:100%;margin:2px 0;">
                                <button type="button" class="sim-slider-label-btn" onclick="window.SimulatorView.setPrudenceWeight(0.0)" title="${window.i18n.t('sim_tooltip_click_100real')}">🎯 <span data-i18n="sim_prudence_badge_100real">${window.i18n.t('sim_prudence_badge_100real')}</span></button>
                                <input type="range" id="simPrudenceSlider" class="sim-range-input" min="0" max="100" step="1" value="${Math.round((this.conservativeWeight || 0) * 100)}" oninput="window.SimulatorView.onConservativeWeightInput(this.value)" onchange="window.SimulatorView.onConservativeWeightChange(this.value)">
                                <button type="button" class="sim-slider-label-btn" onclick="window.SimulatorView.setPrudenceWeight(1.0)" title="${window.i18n.t('sim_tooltip_click_100stress')}">🛡️ <span data-i18n="sim_prudence_badge_100cons">${window.i18n.t('sim_prudence_badge_100cons')}</span></button>
                            </div>
                            <div id="simPrudenceExplainer" style="font-size:11px;color:var(--text-muted);line-height:1.45;margin-top:4px;padding:6px 9px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border-color);">
                                ${this.getPrudenceExplainerText(this.conservativeWeight || 0)}
                            </div>
                        </div>

                        <!-- Colonne 2 : Curseur d'Effort Budgétaire -->
                        <div style="display:flex;flex-direction:column;gap:6px;border-left:1px solid var(--border-color);padding-left:24px;" class="sim-secondary-controls">
                            <div class="sim-slider-header" style="display:flex;justify-content:space-between;align-items:center;">
                                <label style="font-size:12px;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:6px;" title="${window.i18n.t('sim_var_adj_tooltip')}">
                                    <span style="font-size:14px;">⚡</span>
                                    <span data-i18n="sim_effort_title">${window.i18n.t('sim_effort_title')}</span>
                                </label>
                                <button type="button" id="simVarAdjBadge" class="sim-slider-badge-btn" onclick="window.SimulatorView.setVarExpenseAdjustment(0.0)" title="${window.i18n.t('sim_tooltip_click_reset_effort')}" style="color:${this.varExpenseAdjustmentPct < 0 ? '#10b981' : (this.varExpenseAdjustmentPct > 0 ? '#ef4444' : 'var(--text-main)')};">
                                    ${this.varExpenseAdjustmentPct > 0 ? '+' : ''}${Math.round(this.varExpenseAdjustmentPct * 100)}%${(data && data.avg_variable_expense && this.varExpenseAdjustmentPct !== 0) ? ` (${this.varExpenseAdjustmentPct > 0 ? '+' : ''}${Math.round(data.avg_variable_expense * this.varExpenseAdjustmentPct).toLocaleString('fr-FR')} €/m)` : ''}
                                </button>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;width:100%;margin:2px 0;">
                                <button type="button" class="sim-slider-label-btn" onclick="window.SimulatorView.setVarExpenseAdjustment(-1.0)" title="${window.i18n.t('sim_tooltip_click_min_effort')}">-100%</button>
                                <input type="range" id="simVarAdjSlider" class="sim-range-input" min="-100" max="20" step="1" value="${Math.round(this.varExpenseAdjustmentPct * 100)}" oninput="window.SimulatorView.onVarExpenseAdjustmentInput(this.value)" onchange="window.SimulatorView.onVarExpenseAdjustmentChange(this.value)">
                                <button type="button" class="sim-slider-label-btn" onclick="window.SimulatorView.setVarExpenseAdjustment(0.2)" title="${window.i18n.t('sim_tooltip_click_max_effort')}">+20%</button>
                            </div>
                            <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--text-muted);opacity:0.85;">
                                <span data-i18n="sim_effort_hint_left">${window.i18n.t('sim_effort_hint_left')}</span>
                                <span data-i18n="sim_effort_hint_right">${window.i18n.t('sim_effort_hint_right')}</span>
                            </div>
                        </div>

                        <!-- Colonne 3 : Curseur de Sensibilité Dépenses Exceptionnelles (Outliers 1-5) -->
                        <div style="display:flex;flex-direction:column;gap:6px;border-left:1px solid var(--border-color);padding-left:24px;" class="sim-secondary-controls">
                            <div class="sim-slider-header" style="display:flex;justify-content:space-between;align-items:center;">
                                <label style="font-size:12px;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:6px;" title="${window.i18n.t('sim_outlier_tooltip')}">
                                    <span style="font-size:14px;">🧹</span>
                                    <span data-i18n="sim_outlier_title">${window.i18n.t('sim_outlier_title')}</span>
                                </label>
                                <button type="button" id="simOutlierBadge" class="sim-slider-badge-btn" onclick="window.SimulatorView.setOutlierSensitivity(2)" title="${window.i18n.t('sim_outlier_desc_2')}" style="color:${(this.outlierSensitivity || 2) === 1 ? '#ef4444' : ((this.outlierSensitivity || 2) === 2 ? '#10b981' : ((this.outlierSensitivity || 2) === 3 ? '#3b82f6' : ((this.outlierSensitivity || 2) === 4 ? '#f59e0b' : 'var(--text-muted)')))};">
                                    ${this.getOutlierSensitivityLabel(this.outlierSensitivity || 2)}
                                </button>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;width:100%;margin:2px 0;">
                                <button type="button" class="sim-slider-label-btn" onclick="window.SimulatorView.setOutlierSensitivity(1)" title="${window.i18n.t('sim_outlier_desc_1')}">🧹 <span data-i18n="sim_outlier_badge_strict">${window.i18n.t('sim_outlier_badge_strict')}</span></button>
                                <input type="range" id="simOutlierSlider" class="sim-range-input" min="1" max="5" step="1" value="${this.outlierSensitivity || 2}" oninput="window.SimulatorView.onOutlierSensitivityInput(this.value)" onchange="window.SimulatorView.onOutlierSensitivityChange(this.value)">
                                <button type="button" class="sim-slider-label-btn" onclick="window.SimulatorView.setOutlierSensitivity(5)" title="${window.i18n.t('sim_outlier_desc_5')}">📦 <span data-i18n="sim_outlier_badge_full">${window.i18n.t('sim_outlier_badge_full')}</span></button>
                            </div>
                            <div id="simOutlierExplainer" style="font-size:11px;color:var(--text-muted);line-height:1.45;margin-top:4px;padding:6px 9px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border-color);">
                                ${this.getOutlierSensitivityExplainer(this.outlierSensitivity || 2, (data && data.excluded_outliers_count) || 0, (data && data.excluded_outliers_total) || 0)}
                            </div>
                        </div>
                    </div>

                    <!-- ═══ Seasonality Controls Row ═══ -->
                    <div style="border-top:1px solid var(--border-color);margin-top:14px;padding-top:12px;">
                        <div class="sim-seasonality-row" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                            <!-- Mode selector buttons -->
                            <div class="sim-seasonality-mode-container" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <label style="font-size:12px;font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:6px;" title="${window.i18n.t('sim_seasonality_tooltip')}">
                                    <span style="font-size:14px;">🍂</span>
                                    <span data-i18n="sim_seasonality_title">${window.i18n.t('sim_seasonality_title')} :</span>
                                </label>
                                <div class="sim-seasonality-btn-group" style="display:inline-flex;background:var(--bg-base);border:1px solid var(--border-color);border-radius:8px;padding:2px;gap:2px;">
                                    <button type="button" class="btn btn-xs ${this.seasonalityMode === 'disabled' ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:3px 8px;border-radius:6px;" onclick="window.SimulatorView.setSeasonalityMode('disabled')">
                                        🍂 <span data-i18n="sim_seasonality_mode_disabled">${window.i18n.t('sim_seasonality_mode_disabled')}</span>
                                    </button>
                                    <button type="button" class="btn btn-xs ${this.seasonalityMode === 'historical' ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:3px 8px;border-radius:6px;" onclick="window.SimulatorView.setSeasonalityMode('historical')">
                                        📊 <span data-i18n="sim_seasonality_mode_historical">${window.i18n.t('sim_seasonality_mode_historical')}</span>${(data && data.seasonal_history_months) ? ` (${data.seasonal_history_months}m)` : ''}
                                    </button>
                                    <button type="button" class="btn btn-xs ${this.seasonalityMode === 'preset_standard' ? 'btn-primary' : 'btn-ghost'}" style="font-size:11px;padding:3px 8px;border-radius:6px;" onclick="window.SimulatorView.setSeasonalityMode('preset_standard')">
                                        🏖️ <span data-i18n="sim_seasonality_mode_preset">${window.i18n.t('sim_seasonality_mode_preset')}</span>
                                    </button>
                                </div>
                            </div>

                            <!-- Intensity slider (visible when mode != 'disabled') -->
                            ${this.seasonalityMode !== 'disabled' ? `
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap;">
                                <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:flex;align-items:center;gap:4px;" title="${window.i18n.t('sim_seasonality_intensity_tooltip')}">
                                    <span data-i18n="sim_seasonality_intensity_label">${window.i18n.t('sim_seasonality_intensity_label')}</span>
                                </label>
                                <div style="display:flex;align-items:center;gap:6px;">
                                    <button type="button" class="sim-slider-label-btn" onclick="window.SimulatorView.setSeasonalityIntensity(0.0)" title="${window.i18n.t('sim_tooltip_click_seas_0')}">0%</button>
                                    <input type="range" id="simSeasonalityIntensitySlider" class="sim-range-input" style="width:85px;" min="0" max="100" step="5" value="${this.getSeasonalityIntensityPct()}" oninput="window.SimulatorView.onSeasonalityIntensityInput(this.value)" onchange="window.SimulatorView.onSeasonalityIntensityChange(this.value)">
                                    <button type="button" class="sim-slider-label-btn" onclick="window.SimulatorView.setSeasonalityIntensity(1.0)" title="${window.i18n.t('sim_tooltip_click_seas_100')}">100%</button>
                                    <button type="button" id="simSeasonalityIntensityBadge" class="sim-slider-badge-btn" onclick="window.SimulatorView.setSeasonalityIntensity(1.0)" title="${window.i18n.t('sim_tooltip_click_seas_rec')}" style="color:var(--accent, #6366f1);font-weight:700;">${this.getSeasonalityIntensityPct()}%</button>
                                </div>
                            </div>
                            ` : ''}

                            <!-- Toggle 12-Month Profile Preview Strip -->
                            <div>
                                <button type="button" class="sim-seasonality-toggle-btn ${this.isSeasonalityProfileOpen ? 'active' : ''}" onclick="window.SimulatorView.toggleSeasonalityProfile()">
                                    <span>${this.isSeasonalityProfileOpen ? '▲' : '▼'}</span>
                                    <span data-i18n="${this.isSeasonalityProfileOpen ? 'sim_seasonality_btn_hide_profile' : 'sim_seasonality_btn_view_profile'}">${this.isSeasonalityProfileOpen ? window.i18n.t('sim_seasonality_btn_hide_profile') : window.i18n.t('sim_seasonality_btn_view_profile')}</span>
                                </button>
                            </div>
                        </div>

                        <!-- Seasonality Explainer -->
                        <div id="simSeasonalityExplainer" style="font-size:11px;color:var(--text-muted);line-height:1.45;margin-top:6px;padding:6px 9px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid var(--border-color);">
                            ${this.getSeasonalityExplainer(data)}
                        </div>

                        <!-- 12-Month Profile Preview Strip -->
                        ${this.isSeasonalityProfileOpen ? `
                        <div id="simSeasonalityProfileStrip" style="margin-top:8px;padding:8px 10px;background:var(--bg-base);border-radius:8px;border:1px solid var(--border-color);overflow-x:auto;">
                            ${this.renderSeasonality12MonthsStrip(data)}
                        </div>
                        ` : ''}
                    </div>

                    <!-- Income & Inflation Row -->
                    <div style="border-top:1px solid var(--border-color);margin-top:12px;padding-top:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap;">
                            <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:flex;align-items:center;gap:5px;white-space:nowrap;">
                                <span>💼</span>
                                <span data-i18n="sim_income_mode_label">${window.i18n.t('sim_income_mode_label')}</span>
                            </label>
                            <select id="simIncomeModeSelect" class="inline-input" style="padding:3px 8px;font-size:12px;font-weight:500;border-radius:6px;width:auto;min-width:280px;" onchange="window.SimulatorView.onIncomeModeChange(this.value)">
                                <option value="historical_n1" ${(!this.incomeMode || this.incomeMode === 'historical_n1' || this.incomeMode === 'auto') ? 'selected' : ''}>${window.i18n.t('sim_income_mode_historical')}</option>
                                <option value="average" ${this.incomeMode === 'average' ? 'selected' : ''}>${window.i18n.t('sim_income_mode_average')}${avgIncome > 0 ? ` (~${avgIncome.toLocaleString('fr-FR')} €/m)` : ''}</option>
                                <option value="custom" ${this.incomeMode === 'custom' ? 'selected' : ''}>${window.i18n.t('sim_income_mode_custom')}</option>
                                <option value="none" ${this.incomeMode === 'none' ? 'selected' : ''}>${window.i18n.t('sim_income_mode_none')}</option>
                            </select>
                            ${this.incomeMode === 'custom' ? `
                                <div style="display:flex;align-items:center;gap:3px;background:var(--bg-input);padding:2px 6px;border-radius:6px;border:1px solid var(--border-color);">
                                    <input type="number" step="50" id="simCustomIncomeInput" class="inline-input" value="${this.customIncomeAmount || (estSalary || 2500)}" style="width:65px;padding:1px 2px;font-size:12px;font-weight:700;border:none;background:transparent;text-align:right;" onchange="window.SimulatorView.onCustomIncomeChange(this.value)">
                                    <span style="font-size:11px;color:var(--text-muted);font-weight:600;">€/m</span>
                                </div>
                            ` : ''}
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                            ${this.horizonMonths >= 12 ? `
                            <div style="display:flex;align-items:center;gap:6px;">
                                <label style="font-size:11px;font-weight:600;color:var(--text-muted);display:flex;align-items:center;gap:5px;">
                                    <span>📈</span>
                                    <span data-i18n="sim_inflation_label">${window.i18n.t('sim_inflation_label')} :</span>
                                </label>
                                <div style="display:flex;align-items:center;gap:3px;background:var(--bg-input);padding:2px 6px;border-radius:6px;border:1px solid var(--border-color);">
                                    <input type="number" step="0.5" min="0" max="20" id="simInflationInput" class="inline-input" value="${(this.inflationRate * 100).toFixed(1)}" style="width:42px;padding:1px 2px;font-size:12px;font-weight:700;border:none;background:transparent;text-align:right;" onchange="window.SimulatorView.onInflationChange(this.value)">
                                    <span style="font-size:11px;color:var(--text-muted);font-weight:600;" data-i18n="sim_inflation_suffix">${window.i18n.t('sim_inflation_suffix')}</span>
                                </div>
                            </div>
                            ` : ''}

                            <button type="button" class="sim-seasonality-toggle-btn" onclick="window.SimulatorView.resetToRecommendedSettings()" title="${window.i18n.t('sim_reset_defaults_tooltip')}" style="padding:4px 10px;gap:5px;">
                                <span>🔄</span>
                                <span data-i18n="sim_btn_reset_defaults">${window.i18n.t('sim_btn_reset_defaults')}</span>
                            </button>
                        </div>
                    </div>
                </div>
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

        if (pctCons === 0) {
            const inc = Math.round(data.historical_real_income_avg || data.predicted_salary || 0).toLocaleString('fr-FR');
            const fix = Math.round(data.historical_real_fixed_avg || 0).toLocaleString('fr-FR');
            const net = Math.round(data.historical_real_net_avg || 0).toLocaleString('fr-FR');
            items.push(`<span style="display:flex;align-items:center;gap:4px;color:#10b981;font-weight:700;">🎯 <strong>${t('sim_prudence_badge_100real')} :</strong> ${t('sim_transparency_real_profile').replace('{income}', inc).replace('{fixed}', fix).replace('{net}', net)}</span>`);
        } else if (pctCons === 100) {
            const sal = Math.round(data.predicted_salary || 0).toLocaleString('fr-FR');
            items.push(`<span style="display:flex;align-items:center;gap:4px;color:#ef4444;font-weight:700;">🛡️ <strong>${t('sim_prudence_badge_100cons')} :</strong> ${t('sim_transparency_conservative_profile').replace('{salary}', sal)}</span>`);
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

        if (data.is_overdraft_risk && data.break_even_monthly_saving > 0) {
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
                const targetPct = Math.min(100, Math.ceil(recPct / 5) * 5);
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
                                        ${typeLabel} • ${startsLabel} ${ev.start_date} ${ev.duration_months ? `(${ev.duration_months} ${monthsSuffix})` : ''}
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
                        const inflDetail = m.baseline_inflation_delta > 0 ? (window.i18n.tp ? window.i18n.tp('sim_inflation_detail', { amount: m.baseline_inflation_delta.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2}) }) : `dont +${m.baseline_inflation_delta.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} € inflation`) : '';
                        const inflSuffix = inflDetail ? ` (${inflDetail})` : '';

                        const netTooltip = `💼 ${window.i18n.t('sim_th_income')} : +${incFormatted} €\n🏠 ${window.i18n.t('sim_th_fixed')} : -${fixFormatted} €\n🛒 ${window.i18n.t('sim_th_variable')} : -${varFormatted} €${seasSuffix}${inflSuffix}${m.simulated_events_impact !== 0 ? `\n🎯 ${window.i18n.t('sim_th_sim_impact')} : ${impactSign}${m.simulated_events_impact.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €` : ''}\n─────────────────────\n➜ ${window.i18n.t('sim_th_net')} : ${netFormatted}`;

                        const varCellTitle = (m.baseline_inflation_delta > 0 || seasPct !== 0) ? `${window.i18n.tp ? window.i18n.tp('sim_table_var_tooltip', { amount: varFormatted }) : `Dépenses variables : -${varFormatted} €`}${seasSuffix}${inflSuffix}` : '';

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
                                    +${incFormatted} €
                                </td>
                                <td style="text-align:right;font-weight:500;color:#ef4444;vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;">
                                    -${fixFormatted} €
                                </td>
                                <td style="text-align:right;font-weight:500;color:#f59e0b;vertical-align:middle;padding:8px;font-variant-numeric:tabular-nums;" ${varCellTitle ? `title="${varCellTitle}"` : ''}>
                                    <div style="display:flex;justify-content:flex-end;align-items:center;gap:2px;">
                                        <span>-${varFormatted} €</span>
                                        ${seasBadge}
                                    </div>
                                    ${m.baseline_inflation_delta > 0 ? `<div style="font-size:9px;color:var(--text-muted);opacity:0.8;">(+${Math.round(m.baseline_inflation_delta)}€ infl.)</div>` : ''}
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
                            +${totalIncome.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:#ef4444;">
                            -${totalFixed.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                        </td>
                        <td style="text-align:right;padding:10px 8px;font-variant-numeric:tabular-nums;color:#f59e0b;">
                            -${totalVariable.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
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
    getPrudenceBadgeText(w) {
        const pctCons = Math.round(w * 100);
        const t = (k) => window.i18n ? window.i18n.t(k) : k;
        if (pctCons === 0) return `🎯 ${t('sim_prudence_badge_100real') || 'Recettes du modèle'}`;
        if (pctCons === 100) return `🛡️ ${t('sim_prudence_badge_100cons') || 'Recettes minimales'}`;
        const blendTemplate = t('sim_prudence_badge_blend') || 'Prudence {cons}%';
        return `⚖️ ${blendTemplate.replace('{cons}', pctCons)}`;
    },

    getPrudenceExplainerText(w) {
        const pctCons = Math.round(w * 100);
        const t = (k) => window.i18n ? window.i18n.t(k) : k;
        const mode = this.incomeMode || 'historical_n1';

        if (mode === 'custom') {
            const amountStr = `${(this.customIncomeAmount || 2500).toLocaleString('fr-FR')} €/m`;
            if (pctCons === 0) {
                const desc = (t('sim_prudence_desc_custom_100real') || 'Charges fixes basées sur vos prélèvements réels observés (Revenu fixé à {amount}).').replace('{amount}', amountStr);
                return `🎯 <strong>${t('sim_prudence_mode_neutral') || 'Recettes du modèle (0%)'}</strong> : ${desc}`;
            }
            if (pctCons === 100) {
                const desc = (t('sim_prudence_desc_custom_100cons') || 'Charges fixes calculées au plafond contractuel maximal (Revenu fixé à {amount}).').replace('{amount}', amountStr);
                return `🛡️ <strong>${t('sim_prudence_mode_max') || 'Recettes minimales (100%)'}</strong> : ${desc}`;
            }
            const desc = (t('sim_prudence_desc_custom_blend') || 'Marge de sécurité de {pct}% appliquée sur vos charges fixes (Revenu fixé à {amount}).')
                .replace('{pct}', pctCons)
                .replace('{amount}', amountStr);
            const modeTitle = (t('sim_prudence_mode_moderate') || 'Prudence modérée ({pct}%)').replace('{pct}', pctCons);
            return `⚖️ <strong>${modeTitle}</strong> : ${desc}`;
        }

        if (mode === 'none') {
            if (pctCons === 0) {
                const desc = t('sim_prudence_desc_none_100real') || 'Charges fixes basées sur vos prélèvements réels observés (Sans salaire projeté).';
                return `🎯 <strong>${t('sim_prudence_mode_neutral') || 'Recettes du modèle (0%)'}</strong> : ${desc}`;
            }
            if (pctCons === 100) {
                const desc = t('sim_prudence_desc_none_100cons') || 'Charges fixes calculées au plafond contractuel maximal (Sans salaire projeté).';
                return `🛡️ <strong>${t('sim_prudence_mode_max') || 'Recettes minimales (100%)'}</strong> : ${desc}`;
            }
            const desc = (t('sim_prudence_desc_none_blend') || 'Marge de sécurité de {pct}% appliquée sur vos charges fixes (Sans salaire projeté).')
                .replace('{pct}', pctCons);
            const modeTitle = (t('sim_prudence_mode_moderate') || 'Prudence modérée ({pct}%)').replace('{pct}', pctCons);
            return `⚖️ <strong>${modeTitle}</strong> : ${desc}`;
        }

        if (mode === 'average') {
            if (pctCons === 0) {
                return `🎯 <strong>${t('sim_prudence_mode_neutral') || 'Recettes du modèle (0%)'}</strong> : ${t('sim_prudence_desc_average_100real') || 'Projection lissée basée sur vos recettes mensuelles moyennes (sans variation saisonnière).'}`;
            }
            if (pctCons === 100) {
                return `🛡️ <strong>${t('sim_prudence_mode_max') || 'Recettes minimales (100%)'}</strong> : ${t('sim_prudence_desc_100cons') || 'Scénario avec recettes au strict minimum (salaire de base garanti seul, charges fixes contractuelles maximales).'}`;
            }
            const hybridDesc = (t('sim_prudence_desc_average_blend') || 'Dosage équilibré entre vos recettes moyennes et une marge de sécurité ({pct}%).')
                .replace('{pct}', pctCons);
            const modeTitle = (t('sim_prudence_mode_moderate') || 'Prudence modérée ({pct}%)').replace('{pct}', pctCons);
            return `⚖️ <strong>${modeTitle}</strong> : ${hybridDesc}`;
        }

        // Mode historical_n1 / auto (saisonnier année passée)
        if (pctCons === 0) {
            return `🎯 <strong>${t('sim_prudence_mode_neutral') || 'Recettes du modèle (0%)'}</strong> : ${t('sim_prudence_desc_100real') || "Projection basée sur l'historique réel de l'année passée (primes, bonus et saisonnalité inclus)."}`;
        }
        if (pctCons === 100) {
            return `🛡️ <strong>${t('sim_prudence_mode_max') || 'Recettes minimales (100%)'}</strong> : ${t('sim_prudence_desc_100cons') || 'Scénario avec recettes au strict minimum (salaire de base garanti seul, charges fixes contractuelles maximales).'}`;
        }
        const hybridDesc = (t('sim_prudence_desc_blend') || 'Dosage équilibré entre votre train de vie réel et une marge de sécurité ({pct}%).')
            .replace('{pct}', pctCons);
        const modeTitle = (t('sim_prudence_mode_moderate') || 'Prudence modérée ({pct}%)').replace('{pct}', pctCons);
        return `⚖️ <strong>${modeTitle}</strong> : ${hybridDesc}`;
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

    onConservativeWeightInput(val) {
        const intVal = parseInt(val) || 0;
        this.conservativeWeight = intVal / 100.0;
        const badge = document.getElementById('simPrudenceBadge');
        if (badge) {
            badge.textContent = this.getPrudenceBadgeText(this.conservativeWeight);
            badge.style.color = this.conservativeWeight === 0 ? '#10b981' : (this.conservativeWeight >= 0.8 ? '#ef4444' : (this.conservativeWeight >= 0.4 ? '#f59e0b' : 'var(--text-main)'));
        }

        const explainer = document.getElementById('simPrudenceExplainer');
        if (explainer) {
            explainer.innerHTML = this.getPrudenceExplainerText(this.conservativeWeight);
        }

        // Déclenchement temps réel fluide
        this._saveParam('sim_conservative_weight', this.conservativeWeight);
        this._triggerLiveSimulation();

        // Tableau mis à jour en différé pour maximiser les FPS du graphe
        clearTimeout(this._tableDebounceTimer);
        this._tableDebounceTimer = setTimeout(() => {
            if (this.simulationData) {
                const tableContainer = document.getElementById('simMonthlyTableContainer');
                if (tableContainer) {
                    tableContainer.innerHTML = this.renderMonthlyTable(this.simulationData);
                }
            }
        }, 150);
    },

    async setPrudenceWeight(val) {
        this.conservativeWeight = val;
        const slider = document.getElementById('simPrudenceSlider');
        if (slider) slider.value = Math.round(val * 100);
        const badge = document.getElementById('simPrudenceBadge');
        if (badge) {
            badge.textContent = this.getPrudenceBadgeText(this.conservativeWeight);
            badge.style.color = this.conservativeWeight === 0 ? '#10b981' : (this.conservativeWeight >= 0.8 ? '#ef4444' : ((this.conservativeWeight >= 0.4 ? '#f59e0b' : 'var(--text-main)')));
        }
        const explainer = document.getElementById('simPrudenceExplainer');
        if (explainer) {
            explainer.innerHTML = this.getPrudenceExplainerText(this.conservativeWeight);
        }
        this._saveParam('sim_conservative_weight', this.conservativeWeight);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async setVarExpenseAdjustment(val) {
        this.varExpenseAdjustmentPct = val;
        const slider = document.getElementById('simVarAdjSlider');
        if (slider) slider.value = Math.round(val * 100);
        const badge = document.getElementById('simVarAdjBadge');
        if (badge) {
            const intVal = Math.round(val * 100);
            const avgVar = (this.simulationData && this.simulationData.avg_variable_expense) ? this.simulationData.avg_variable_expense : 0;
            const euroDelta = Math.round(avgVar * val);
            const euroSuffix = (intVal !== 0 && avgVar > 0) ? ` (${intVal > 0 ? '+' : ''}${euroDelta.toLocaleString('fr-FR')} €/m)` : '';
            badge.textContent = `${intVal > 0 ? '+' : ''}${intVal}%${euroSuffix}`;
            badge.style.color = intVal < 0 ? '#10b981' : (intVal > 0 ? '#ef4444' : 'var(--text-main)');
        }
        this._saveParam('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async onConservativeWeightChange(val) {
        const intVal = parseInt(val) || 0;
        this.conservativeWeight = intVal / 100.0;
        this._saveParam('sim_conservative_weight', this.conservativeWeight);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    getOutlierSensitivityLabel(level) {
        const t = (k, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fallback;
        const map = {
            1: t('ai_outlier_level_1', 'Strict (Régulier pur)'),
            2: t('ai_outlier_level_2', 'Prudent (Équilibre)'),
            3: t('ai_outlier_level_3', 'Équilibré'),
            4: t('ai_outlier_level_4', 'Permissif'),
            5: t('ai_outlier_level_5', 'Intégral (Tout inclure)')
        };
        return map[level] || map[2];
    },

    getOutlierSensitivityExplainer(level, excludedCount = 0, excludedTotal = 0) {
        const t = (k, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fallback;
        const descMap = {
            1: t('sim_outlier_desc_1', 'Filtre maximal : écarte tout achat inhabituel ou imprévu même modéré (> 250 €).'),
            2: t('sim_outlier_desc_2', 'Recommandé : filtre les gros achats et imprévus majeurs (> 400 €) pour des dépenses régulières réalistes.'),
            3: t('sim_outlier_desc_3', 'Filtre IQR standard : écarte uniquement les anomalies statistiques évidentes (> 600 €).'),
            4: t('sim_outlier_desc_4', 'Permissif : ne filtre que les dépenses géantes hors norme (> 1 200 €).'),
            5: t('sim_outlier_desc_5', 'Intégral : conserve 100% des dépenses historiques sans aucun filtrage.')
        };
        const desc = descMap[level] || descMap[2];
        const isEn = (window.i18n && window.i18n.lang === 'en');
        const formattedTotal = Math.round(excludedTotal).toLocaleString(isEn ? 'en-US' : 'fr-FR');
        const badgeText = window.i18n.tp
            ? window.i18n.tp('sim_outlier_excluded_badge', { count: excludedCount, total: formattedTotal })
            : `${excludedCount} ${isEn ? 'expense(s) excluded' : 'dépense(s) exclue(s)'} (-${formattedTotal} €)`;
        const noOutlierText = t('sim_outlier_none_detected', isEn ? 'No abnormal purchases detected' : 'Aucun achat anormal détecté');
        const badgePart = excludedCount > 0
            ? `<div style="margin-top:4px;display:inline-flex;align-items:center;gap:4px;background:rgba(16,185,129,0.12);color:#10b981;font-weight:700;padding:2px 7px;border-radius:4px;font-size:10px;">⚡ ${badgeText}</div>`
            : `<div style="margin-top:4px;font-size:10px;color:var(--text-muted);opacity:0.75;">${noOutlierText}</div>`;
        return `<div>${desc}</div>${badgePart}`;
    },

    onOutlierSensitivityInput(val) {
        const intVal = Math.min(5, Math.max(1, parseInt(val) || 2));
        this.outlierSensitivity = intVal;
        const badge = document.getElementById('simOutlierBadge');
        if (badge) {
            badge.textContent = this.getOutlierSensitivityLabel(intVal);
            badge.style.color = intVal === 1 ? '#ef4444' : (intVal === 2 ? '#10b981' : (intVal === 3 ? '#3b82f6' : (intVal === 4 ? '#f59e0b' : 'var(--text-muted)')));
        }
        const explainer = document.getElementById('simOutlierExplainer');
        if (explainer) {
            const excCount = (this.simulationData && this.simulationData.excluded_outliers_count) || 0;
            const excTotal = (this.simulationData && this.simulationData.excluded_outliers_total) || 0;
            explainer.innerHTML = this.getOutlierSensitivityExplainer(intVal, excCount, excTotal);
        }
        this._saveParam('sim_outlier_sensitivity', this.outlierSensitivity);
        this._triggerLiveSimulation();

        clearTimeout(this._tableDebounceTimer);
        this._tableDebounceTimer = setTimeout(() => {
            if (this.simulationData) {
                const tableContainer = document.getElementById('simMonthlyTableContainer');
                if (tableContainer) {
                    tableContainer.innerHTML = this.renderMonthlyTable(this.simulationData);
                }
            }
        }, 150);
    },

    async setOutlierSensitivity(level) {
        const intVal = Math.min(5, Math.max(1, parseInt(level) || 2));
        this.outlierSensitivity = intVal;
        const slider = document.getElementById('simOutlierSlider');
        if (slider) slider.value = intVal;
        const badge = document.getElementById('simOutlierBadge');
        if (badge) {
            badge.textContent = this.getOutlierSensitivityLabel(intVal);
            badge.style.color = intVal === 1 ? '#ef4444' : (intVal === 2 ? '#10b981' : (intVal === 3 ? '#3b82f6' : (intVal === 4 ? '#f59e0b' : 'var(--text-muted)')));
        }
        this._saveParam('sim_outlier_sensitivity', this.outlierSensitivity);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async onOutlierSensitivityChange(val) {
        const intVal = Math.min(5, Math.max(1, parseInt(val) || 2));
        this.outlierSensitivity = intVal;
        this._saveParam('sim_outlier_sensitivity', this.outlierSensitivity);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    getSeasonalityIntensityPct() {
        return Math.round(((typeof this.seasonalityIntensity === 'number' && !isNaN(this.seasonalityIntensity)) ? this.seasonalityIntensity : 1.0) * 100);
    },

    getSeasonalityExplainer(data) {
        const t = (k) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : k;
        const mode = this.seasonalityMode || 'disabled';
        const intensity = this.getSeasonalityIntensityPct();

        if (mode === 'disabled') {
            return `🍂 <strong>${t('sim_seasonality_mode_disabled')}</strong> : ${t('sim_seasonality_desc_disabled')}`;
        }
        if (mode === 'historical') {
            const mCount = (data && data.seasonal_history_months) ? data.seasonal_history_months : 0;
            if (mCount >= 6) {
                const desc = (t('sim_seasonality_desc_historical') || '').replace('{months}', mCount);
                return `📊 <strong>${t('sim_seasonality_mode_historical')} (${intensity}%)</strong> : ${desc}`;
            } else {
                const desc = (t('sim_seasonality_desc_historical_insufficient') || '').replace('{months}', mCount);
                return `⚠️ <strong>${t('sim_seasonality_mode_historical')}</strong> : ${desc}`;
            }
        }
        if (mode === 'preset_standard') {
            return `🏖️ <strong>${t('sim_seasonality_mode_preset')} (${intensity}%)</strong> : ${t('sim_seasonality_desc_preset')}`;
        }
        return '';
    },

    renderSeasonality12MonthsStrip(data) {
        if (!data) return '';
        const coeffs = data.seasonal_expense_coefficients || {};
        const locale = (window.i18n && window.i18n.lang === 'en') ? 'en-US' : 'fr-FR';
        const monthNames = Array.from({length: 12}, (_, i) => {
            const raw = new Date(2026, i, 1).toLocaleDateString(locale, { month: 'short' });
            return raw.charAt(0).toUpperCase() + raw.slice(1).replace('.', '');
        });
        
        return `
            <div style="display:flex;gap:6px;min-width:780px;justify-content:space-between;">
                ${monthNames.map((name, idx) => {
                    const m = idx + 1;
                    const coeff = coeffs[m] !== undefined ? coeffs[m] : 1.0;
                    const pct = Math.round((coeff - 1.0) * 100);
                    const sign = pct > 0 ? '+' : '';
                    const color = pct > 0 ? (pct >= 25 ? '#ef4444' : '#f59e0b') : (pct < 0 ? '#10b981' : 'var(--text-muted)');
                    const bg = pct > 0 ? 'rgba(245, 158, 11, 0.08)' : (pct < 0 ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)');
                    const icon = m === 12 ? '🎄' : (m === 7 || m === 8 ? '🏖️' : (m === 9 ? '🎒' : (m === 1 || m === 2 ? '❄️' : '')));

                    return `
                        <div style="flex:1;min-width:56px;background:${bg};border:1px solid var(--border-color);border-radius:6px;padding:5px 4px;text-align:center;display:flex;flex-direction:column;gap:2px;">
                            <div style="font-size:10px;font-weight:700;color:var(--text-muted);display:flex;align-items:center;justify-content:center;gap:2px;">
                                <span>${name}</span>
                                ${icon ? `<span style="font-size:10px;">${icon}</span>` : ''}
                            </div>
                            <div style="font-size:11px;font-weight:800;color:${color};">
                                ${pct === 0 ? '0%' : `${sign}${pct}%`}
                            </div>
                            <div style="font-size:9.5px;color:var(--text-muted);opacity:0.8;">
                                ${coeff.toFixed(2)}x
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    },

    async setSeasonalityMode(mode) {
        this.seasonalityMode = mode;
        this._saveParam('sim_seasonality_mode', mode);
        await this.runSimulation();
        this.render();
    },

    onSeasonalityIntensityInput(val) {
        const parsed = parseInt(val, 10);
        const intVal = isNaN(parsed) ? 100 : Math.max(0, Math.min(100, parsed));
        this.seasonalityIntensity = intVal / 100.0;
        const badge = document.getElementById('simSeasonalityIntensityBadge');
        if (badge) badge.textContent = `${intVal}%`;
        const explainer = document.getElementById('simSeasonalityExplainer');
        if (explainer) explainer.innerHTML = this.getSeasonalityExplainer(this.simulationData);
        this._saveParam('sim_seasonality_intensity', this.seasonalityIntensity);
        this._triggerLiveSimulation();

        clearTimeout(this._tableDebounceTimer);
        this._tableDebounceTimer = setTimeout(() => {
            if (this.simulationData) {
                const tableContainer = document.getElementById('simMonthlyTableContainer');
                if (tableContainer) {
                    tableContainer.innerHTML = this.renderMonthlyTable(this.simulationData);
                }
            }
        }, 150);
    },

    async onSeasonalityIntensityChange(val) {
        const parsed = parseInt(val, 10);
        const intVal = isNaN(parsed) ? 100 : Math.max(0, Math.min(100, parsed));
        this.seasonalityIntensity = intVal / 100.0;
        this._saveParam('sim_seasonality_intensity', this.seasonalityIntensity);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async setSeasonalityIntensity(val) {
        const parsed = parseFloat(val);
        this.seasonalityIntensity = isNaN(parsed) ? 1.0 : Math.max(0.0, Math.min(1.0, parsed));
        this._saveParam('sim_seasonality_intensity', this.seasonalityIntensity);
        const slider = document.getElementById('simSeasonalityIntensitySlider');
        if (slider) slider.value = this.getSeasonalityIntensityPct();
        const badge = document.getElementById('simSeasonalityIntensityBadge');
        if (badge) badge.textContent = `${this.getSeasonalityIntensityPct()}%`;
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    toggleSeasonalityProfile() {
        this.isSeasonalityProfileOpen = !this.isSeasonalityProfileOpen;
        this._saveParam('sim_seasonality_profile_open', this.isSeasonalityProfileOpen);
        this.render();
    },

    async resetToRecommendedSettings() {
        this.conservativeWeight = 0.20;
        this.varExpenseAdjustmentPct = 0.0;
        this.outlierSensitivity = 2;
        this.seasonalityMode = 'disabled';
        this.seasonalityIntensity = 1.0;
        this.incomeMode = 'historical_n1';
        this.customIncomeAmount = null;
        this.inflationRate = 0.0;

        this._batchSaveParams({
            sim_conservative_weight: '0.20',
            sim_var_expense_adj: '0.0',
            sim_outlier_sensitivity: '2',
            sim_seasonality_mode: 'disabled',
            sim_seasonality_intensity: '1.0',
            sim_income_mode: 'historical_n1',
            sim_custom_income: '',
            sim_inflation_rate: '0.0'
        });

        await this.runSimulation();
        this.render();

        if (typeof showToast === 'function') {
            showToast(window.i18n.t('sim_toast_defaults_restored') || 'Paramètres recommandés restaurés avec succès', 'success');
        }
    },

    toggleSection(section) {
        if (section === 'advanced') {
            const body = document.getElementById('simAdvancedBody');
            const chevron = document.getElementById('simAdvancedChevron');
            if (body && chevron) {
                const isOpen = body.classList.toggle('open');
                chevron.classList.toggle('open', isOpen);
                this._saveParam('sim_advanced_open', isOpen);
            }
        } else if (section === 'table') {
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
        if (this.chart && data.monthly_data) {
            const mData = data.monthly_data;
            const labels = mData.map(d => this.formatMonthLabel(d.month));
            const simData = mData.map(d => d.simulated_end_balance);
            const baseData = mData.map(d => d.baseline_end_balance);
            const optData = mData.map(d => d.optimistic_end_balance);
            const pesData = mData.map(d => d.pessimistic_end_balance);
            const hasConfidence = data.variable_expense_stddev > 0;

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

        // 5. Update Advanced Summary
        const summaryEl = document.getElementById('simAdvancedSummary');
        if (summaryEl) {
            const estSalary = (data && data.predicted_salary) ? Math.round(data.predicted_salary) : 0;
            const avgIncome = (data && data.historical_real_income_avg) ? Math.round(data.historical_real_income_avg) : estSalary;
            const prudencePct = Math.round((this.conservativeWeight || 0) * 100);
            const effortPct = Math.round((this.varExpenseAdjustmentPct || 0) * 100);
            const compactSummaryParts = [];
            compactSummaryParts.push(`🛡️ ${prudencePct === 0 ? (window.i18n.t('sim_prudence_badge_100real') || 'Recettes du modèle') : (prudencePct === 100 ? (window.i18n.t('sim_prudence_badge_100cons') || 'Recettes minimales') : `Prudence ${prudencePct}%`)}`);
            compactSummaryParts.push(`⚡ ${effortPct > 0 ? '+' : ''}${effortPct}%`);
            const incomeBadge = (!this.incomeMode || this.incomeMode === 'historical_n1' || this.incomeMode === 'auto')
                ? (window.i18n.t('sim_income_badge_historical_n1') || 'Année passée')
                : (this.incomeMode === 'average' ? `${window.i18n.t('sim_income_badge_average') || 'Moyenne'}${avgIncome > 0 ? ` (~${avgIncome.toLocaleString('fr-FR')} €)` : ''}` : (this.incomeMode === 'custom' ? `${(this.customIncomeAmount || 0).toLocaleString('fr-FR')} €` : (window.i18n.t('sim_income_badge_zero') || 'Zéro salaire')));
            compactSummaryParts.push(`💼 ${incomeBadge}`);
            if (this.inflationRate > 0) compactSummaryParts.push(`📈 ${(this.inflationRate * 100).toFixed(1)}%`);
            const outlierLevel = this.outlierSensitivity || 2;
            const outlierLabel = this.getOutlierSensitivityLabel(outlierLevel);
            const excCount = (data && data.excluded_outliers_count) ? data.excluded_outliers_count : 0;
            compactSummaryParts.push(`🧹 ${outlierLabel}${excCount > 0 ? ` (${excCount})` : ''}`);

            // Seasonality summary badge
            const seasPct = this.getSeasonalityIntensityPct();
            if (this.seasonalityMode === 'historical') {
                const seasMonths = (data && data.seasonal_history_months) ? data.seasonal_history_months : 0;
                compactSummaryParts.push(`🍂 ${window.i18n.t('sim_seasonality_badge_historical') || 'Historique'} ${seasMonths}m (${seasPct}%)`);
            } else if (this.seasonalityMode === 'preset_standard') {
                compactSummaryParts.push(`🏖️ ${window.i18n.t('sim_seasonality_badge_preset') || 'Vacances & Fêtes'} (${seasPct}%)`);
            } else {
                compactSummaryParts.push(`🍂 ${window.i18n.t('sim_seasonality_badge_disabled') || 'Lissée'}`);
            }

            summaryEl.innerHTML = compactSummaryParts.join('  <span style="opacity:0.3;">│</span>  ');
        }

        // Update Outlier Explainer & Badge
        const outlierBadge = document.getElementById('simOutlierBadge');
        if (outlierBadge) {
            outlierBadge.textContent = this.getOutlierSensitivityLabel(this.outlierSensitivity || 2);
            outlierBadge.style.color = (this.outlierSensitivity || 2) === 1 ? '#ef4444' : ((this.outlierSensitivity || 2) === 2 ? '#10b981' : ((this.outlierSensitivity || 2) === 3 ? '#3b82f6' : ((this.outlierSensitivity || 2) === 4 ? '#f59e0b' : 'var(--text-muted)')));
        }
        const outlierExplainer = document.getElementById('simOutlierExplainer');
        if (outlierExplainer) {
            const excCount = (data && data.excluded_outliers_count) || 0;
            const excTotal = (data && data.excluded_outliers_total) || 0;
            outlierExplainer.innerHTML = this.getOutlierSensitivityExplainer(this.outlierSensitivity || 2, excCount, excTotal);
        }
        const outlierSlider = document.getElementById('simOutlierSlider');
        if (outlierSlider && document.activeElement !== outlierSlider) {
            outlierSlider.value = this.outlierSensitivity || 2;
        }

        // Update Seasonality Explainer, Badge & Slider
        const seasPct = this.getSeasonalityIntensityPct();
        const seasExplainer = document.getElementById('simSeasonalityExplainer');
        if (seasExplainer) {
            seasExplainer.innerHTML = this.getSeasonalityExplainer(data);
        }
        const seasBadge = document.getElementById('simSeasonalityIntensityBadge');
        if (seasBadge) {
            seasBadge.textContent = `${seasPct}%`;
        }
        const seasSlider = document.getElementById('simSeasonalityIntensitySlider');
        if (seasSlider && document.activeElement !== seasSlider) {
            seasSlider.value = seasPct;
        }
        const seasStrip = document.getElementById('simSeasonalityProfileStrip');
        if (seasStrip && this.isSeasonalityProfileOpen) {
            seasStrip.innerHTML = this.renderSeasonality12MonthsStrip(data);
        }

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
        this.inflationRate = (parseFloat(val) || 0) / 100;  // Convert from % to decimal
        this._saveParam('sim_inflation_rate', this.inflationRate);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    onVarExpenseAdjustmentInput(val) {
        const intVal = parseInt(val) || 0;
        this.varExpenseAdjustmentPct = intVal / 100.0;
        const badge = document.getElementById('simVarAdjBadge');
        if (badge) {
            const avgVar = (this.simulationData && this.simulationData.avg_variable_expense) ? this.simulationData.avg_variable_expense : 0;
            const euroDelta = Math.round(avgVar * (intVal / 100.0));
            const euroSuffix = (intVal !== 0 && avgVar > 0) ? ` (${intVal > 0 ? '+' : ''}${euroDelta.toLocaleString('fr-FR')} €/m)` : '';
            badge.textContent = `${intVal > 0 ? '+' : ''}${intVal}%${euroSuffix}`;
            badge.style.color = intVal < 0 ? '#10b981' : (intVal > 0 ? '#ef4444' : 'var(--text-main)');
        }

        // Déclenchement temps réel fluide
        this._saveParam('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        this._triggerLiveSimulation();

        // Tableau mis à jour en différé pour maximiser les FPS du graphe
        clearTimeout(this._tableDebounceTimer);
        this._tableDebounceTimer = setTimeout(() => {
            if (this.simulationData) {
                const tableContainer = document.getElementById('simMonthlyTableContainer');
                if (tableContainer) {
                    tableContainer.innerHTML = this.renderMonthlyTable(this.simulationData);
                }
            }
        }, 150);
    },

    async onVarExpenseAdjustmentChange(val) {
        const intVal = parseInt(val) || 0;
        this.varExpenseAdjustmentPct = intVal / 100.0;
        this._saveParam('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async applyBreakEvenEffort(pct) {
        // Arrondi au pourcent supérieur (pas de 1%), plafonné à 100%
        let targetPct = Math.min(100, Math.ceil(pct));
        this.varExpenseAdjustmentPct = -(targetPct / 100.0);
        this._saveParam('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        const slider = document.getElementById('simVarAdjSlider');
        if (slider) slider.value = Math.round(this.varExpenseAdjustmentPct * 100);
        const badge = document.getElementById('simVarAdjBadge');
        if (badge) {
            badge.textContent = `-${targetPct}%`;
            badge.style.color = '#10b981';
        }
        await this.runSimulation();
        this.updateLiveSimulationView(true);
        if (typeof showToast === 'function') {
            showToast(`${window.i18n.t('sim_btn_apply_break_even').replace('{pct}', targetPct)}`, "info");
        }
    },

    async resetEffort() {
        this.varExpenseAdjustmentPct = 0.0;
        this._saveParam('sim_var_expense_adj', 0.0);
        const slider = document.getElementById('simVarAdjSlider');
        if (slider) slider.value = 0;
        const badge = document.getElementById('simVarAdjBadge');
        if (badge) {
            badge.textContent = `0%`;
            badge.style.color = 'var(--text-main)';
        }
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
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid var(--border-color); background: var(--bg-surface); flex-shrink: 0;">
                        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main); display:flex; align-items:center; gap:8px;">
                            <span>🔮</span>
                            <span data-i18n="${titleKey}">${window.i18n.t(titleKey)}</span>
                        </h3>
                        <button type="button" class="btn btn-ghost btn-sm" onclick="window.SimulatorView.closeModal('simScenarioModal')" style="padding: 4px 8px; font-size: 16px; line-height: 1; border: none; background: none; color: var(--text-muted); cursor: pointer;">✕</button>
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
                        <div style="display: flex; justify-content: flex-end; gap: 10px; padding: 14px 24px; border-top: 1px solid var(--border-color); background: var(--bg-surface); flex-shrink: 0;">
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
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid var(--border-color); background: var(--bg-surface); flex-shrink: 0;">
                        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main); display:flex; align-items:center; gap:8px;">
                            <span>✨</span>
                            <span data-i18n="sim_modal_presets_title">${window.i18n.t('sim_modal_presets_title')}</span>
                        </h3>
                        <button type="button" class="btn btn-ghost btn-sm" onclick="window.SimulatorView.closeModal('simPresetsModal')" style="padding: 4px 8px; font-size: 16px; line-height: 1; border: none; background: none; color: var(--text-muted); cursor: pointer;">✕</button>
                    </div>
                    <div style="padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 12px;">
                        ${this.presets.map(p => {
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
                    <div style="display: flex; justify-content: flex-end; padding: 14px 24px; border-top: 1px solid var(--border-color); background: var(--bg-surface); flex-shrink: 0;">
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

        const eventsPayload = preset.events.map(ev => ({
            label: isEn ? (ev.label_en || ev.label) : (ev.label_fr || ev.label),
            event_type: ev.event_type,
            amount: ev.amount,
            start_date: todayStr,
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
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 18px 24px; border-bottom: 1px solid var(--border-color); background: var(--bg-surface); flex-shrink: 0;">
                        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main); display:flex; align-items:center; gap:8px;">
                            <span>➕</span>
                            <span data-i18n="${titleKey}">${window.i18n.t(titleKey)}</span>
                        </h3>
                        <button type="button" class="btn btn-ghost btn-sm" onclick="window.SimulatorView.closeModal('simEventModal')" style="padding: 4px 8px; font-size: 16px; line-height: 1; border: none; background: none; color: var(--text-muted); cursor: pointer;">✕</button>
                    </div>
                    <form onsubmit="event.preventDefault(); window.SimulatorView.saveEventModal();" style="display: flex; flex-direction: column; flex: 1; overflow: hidden; margin: 0;">
                        <div style="padding: 20px 24px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px;">
                            <div>
                                <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_label">
                                    ${window.i18n.t('sim_field_label')} *
                                </label>
                                <input type="text" id="simEvLabel" class="inline-input" required value="${escapeHtml(ev.label)}" placeholder="${window.i18n.t('sim_ph_event_label') || 'ex: Apport personnel, Mensualité crédit'}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                            </div>

                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
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

                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
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
                                <label class="input-label" style="display:block; font-size:11px; font-weight: 700; margin-bottom:5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="sim_field_description">
                                    ${window.i18n.t('sim_field_description')}
                                </label>
                                <input type="text" id="simEvNotes" class="inline-input" value="${escapeHtml(ev.notes || '')}" placeholder="${window.i18n.t('sim_ph_event_notes') || 'Notes contextuelles...'}" style="width: 100%; box-sizing: border-box; font-size: 13px; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background-color: var(--bg-input); color: var(--text-main);">
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px; padding: 14px 24px; border-top: 1px solid var(--border-color); background: var(--bg-surface); flex-shrink: 0;">
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

        if (!label || !start_date) return;

        const payload = {
            label,
            event_type,
            amount,
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
