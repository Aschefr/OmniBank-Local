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
    _liveDebounceTimer: null,

    async init() {
        this.horizonMonths = parseInt(ProfileStorage.get('sim_horizon') || '36');
        const savedAcc = ProfileStorage.get('sim_account');
        this.accountId = savedAcc && savedAcc !== 'null' && savedAcc !== '' ? parseInt(savedAcc) : null;
        const savedScId = ProfileStorage.get('sim_active_scenario');
        this.activeScenarioId = savedScId && savedScId !== 'null' && savedScId !== '' ? parseInt(savedScId) : null;
        this.incomeMode = ProfileStorage.get('sim_income_mode') || 'historical_n1';
        const savedCustom = ProfileStorage.get('sim_custom_income');
        this.customIncomeAmount = savedCustom && savedCustom !== 'null' && savedCustom !== '' ? parseFloat(savedCustom) : null;
        const savedInflation = ProfileStorage.get('sim_inflation_rate');
        this.inflationRate = savedInflation && savedInflation !== 'null' && savedInflation !== '' ? parseFloat(savedInflation) : 0.0;
        const savedVarAdj = ProfileStorage.get('sim_var_expense_adj');
        this.varExpenseAdjustmentPct = savedVarAdj && savedVarAdj !== 'null' && savedVarAdj !== '' ? parseFloat(savedVarAdj) : 0.0;
        
        const savedWeight = ProfileStorage.get('sim_conservative_weight');
        if (savedWeight !== null && savedWeight !== undefined && savedWeight !== '') {
            this.conservativeWeight = parseFloat(savedWeight);
        } else {
            const savedProf = ProfileStorage.get('sim_projection_profile');
            this.conservativeWeight = (savedProf === 'conservative') ? 1.0 : ((savedProf === 'realistic') ? 0.0 : 0.20);
        }

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
                    ProfileStorage.set('sim_active_scenario', this.activeScenarioId);
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
            this.render();
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
                conservative_weight: (typeof this.conservativeWeight === 'number') ? this.conservativeWeight : 0.0
            };
            const result = await API.post('/api/simulator/run', payload);
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
            ? 'Année passée'
            : (this.incomeMode === 'average' ? `Moyenne${avgIncome > 0 ? ` (~${avgIncome.toLocaleString('fr-FR')} €)` : ''}` : (this.incomeMode === 'custom' ? `${(this.customIncomeAmount || 0).toLocaleString('fr-FR')} €` : 'Zéro salaire'));
        compactSummaryParts.push(`💼 ${incomeBadge}`);
        if (this.inflationRate > 0) compactSummaryParts.push(`📈 ${(this.inflationRate * 100).toFixed(1)}%`);
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
                    grid-template-columns: 1.25fr 1fr;
                    gap: 20px;
                    align-items: center;
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
                    <div class="sim-sliders-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start;">
                        <!-- Colonne 1 : Curseur de Prudence & Réalisme -->
                        <div style="display:flex;flex-direction:column;gap:6px;">
                            <div style="display:flex;justify-content:space-between;align-items:center;">
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
                            <div style="display:flex;justify-content:space-between;align-items:center;">
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
        if (data.has_seasonality) {
            items.push(`<span style="display:flex;align-items:center;gap:4px;">📅 ${t('sim_transparency_seasonality').replace('{months}', data.seasonal_history_months)}</span>`);
        } else {
            items.push(`<span style="display:flex;align-items:center;gap:4px;">📅 ${t('sim_transparency_no_seasonality')}</span>`);
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

        return `
            <table class="data-table" style="width:100%;font-size:12px;">
                <thead>
                    <tr>
                        <th style="text-align:left;" data-i18n="sim_th_month">${window.i18n.t('sim_th_month')}</th>
                        <th style="text-align:right;" data-i18n="sim_th_start_bal">${window.i18n.t('sim_th_start_bal')}</th>
                        <th style="text-align:right;" data-i18n="sim_th_baseline_net">${window.i18n.t('sim_th_baseline_net')}</th>
                        <th style="text-align:right;" data-i18n="sim_th_sim_impact">${window.i18n.t('sim_th_sim_impact')}</th>
                        <th style="text-align:right;" data-i18n="sim_th_end_bal">${window.i18n.t('sim_th_end_bal')}</th>
                        <th style="text-align:right;" data-i18n="sim_th_diff">${window.i18n.t('sim_th_diff')}</th>
                        <th style="text-align:left;" data-i18n="sim_th_events">${window.i18n.t('sim_th_events')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.monthly_data.map(m => {
                        const diffSign = m.difference > 0 ? '+' : '';
                        const impactSign = m.simulated_events_impact > 0 ? '+' : '';
                        const isNeg = m.simulated_end_balance < 0;

                        // Tooltip décomposant précisément Entrées / Fixe / Variable / Inflation
                        const inc = (m.baseline_income || 0).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                        const fix = (m.baseline_fixed || 0).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                        const vExp = (m.baseline_variable || 0).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                        const inf = (m.baseline_inflation_delta || 0).toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2});
                        const netStr = `${m.baseline_net > 0 ? '+' : ''}${m.baseline_net.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €`;
                        
                        const flowTooltip = `💼 ${window.i18n.t('sim_flow_tooltip_income')} : +${inc} €\n🏠 ${window.i18n.t('sim_flow_tooltip_fixed')} : -${fix} €\n🛒 ${window.i18n.t('sim_flow_tooltip_variable')} : -${vExp} €${m.baseline_inflation_delta > 0 ? `\n📈 ${window.i18n.t('sim_flow_tooltip_inflation')} : -${inf} €` : ''}\n─────────────────────\n➜ ${window.i18n.t('sim_flow_tooltip_net')} : ${netStr}`;

                        return `
                            <tr style="${isNeg ? 'background:rgba(239, 68, 68, 0.08);' : ''}">
                                <td style="font-weight:600;white-space:nowrap;vertical-align:middle;">
                                    ${escapeHtml(this.formatMonthLabel(m.month))}
                                    ${m.is_min_cash ? `<span class="sim-badge" style="background:rgba(99, 102, 241, 0.15);color:#818cf8;border:1px solid rgba(99, 102, 241, 0.3);font-size:9px;margin-left:6px;padding:1px 4px;vertical-align:middle;" title="${window.i18n.t('sim_kpi_min_cash')}">⚓ ${window.i18n.t('sim_badge_min_cash')}</span>` : ''}
                                    ${isNeg ? `<span class="sim-badge" style="background:rgba(239, 68, 68, 0.15);color:#ef4444;border:1px solid rgba(239, 68, 68, 0.3);font-size:9px;margin-left:6px;padding:1px 4px;vertical-align:middle;" title="${window.i18n.t('sim_kpi_overdraft_title')}">⚠️ ${window.i18n.t('sim_badge_overdraft')}</span>` : ''}
                                </td>
                                <td style="text-align:right;color:var(--text-muted);vertical-align:middle;">
                                    ${m.start_balance_simulated.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                                </td>
                                <td style="text-align:right;vertical-align:middle;cursor:help;" title="${flowTooltip}">
                                    <div style="font-weight:600;color:${m.baseline_net >= 0 ? '#10b981' : '#ef4444'};display:inline-flex;align-items:center;gap:3px;justify-content:flex-end;">
                                        <span>${m.baseline_net > 0 ? '+' : ''}${m.baseline_net.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €</span>
                                        <span style="font-size:10px;opacity:0.65;">ℹ️</span>
                                    </div>
                                    <div style="font-size:9.5px;color:var(--text-muted);opacity:0.75;font-weight:400;margin-top:1px;">
                                        +${Math.round(m.baseline_income || 0).toLocaleString('fr-FR')} / -${Math.round(m.baseline_expense || 0).toLocaleString('fr-FR')}
                                    </div>
                                </td>
                                <td style="text-align:right;font-weight:600;color:${m.simulated_events_impact > 0 ? '#10b981' : (m.simulated_events_impact < 0 ? '#ef4444' : 'var(--text-muted)')};vertical-align:middle;">
                                    ${m.simulated_events_impact !== 0 ? `${impactSign}${m.simulated_events_impact.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €` : '-'}
                                </td>
                                <td style="text-align:right;font-weight:700;color:${isNeg ? '#ef4444' : 'var(--text-main)'};vertical-align:middle;">
                                    ${m.simulated_end_balance.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €
                                </td>
                                <td style="text-align:right;font-weight:600;color:${m.difference > 0 ? '#10b981' : (m.difference < 0 ? '#ef4444' : 'var(--text-muted)')};vertical-align:middle;">
                                    ${m.difference !== 0 ? `${diffSign}${m.difference.toLocaleString('fr-FR', {minimumFractionDigits:2, maximumFractionDigits:2})} €` : '-'}
                                </td>
                                <td style="color:var(--text-muted);font-size:11px;vertical-align:middle;">
                                    ${m.events_applied.length > 0 ? m.events_applied.map(e => `<span class="sim-badge sim-badge-neutral" style="margin-right:4px;margin-bottom:2px;">${escapeHtml(e)}</span>`).join('') : '<span style="opacity:0.4;">-</span>'}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
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
                return `🎯 <strong>${t('sim_prudence_mode_neutral') || 'Recettes du modèle (0%)'}</strong> : Projection lissée basée sur vos recettes mensuelles moyennes (sans variation saisonnière).`;
            }
            if (pctCons === 100) {
                return `🛡️ <strong>${t('sim_prudence_mode_max') || 'Recettes minimales (100%)'}</strong> : ${t('sim_prudence_desc_100cons') || 'Scénario avec recettes au strict minimum (salaire de base garanti seul, charges fixes contractuelles maximales).'}`;
            }
            const hybridDesc = (t('sim_prudence_desc_blend') || 'Dosage équilibré entre vos recettes moyennes et une marge de sécurité ({pct}%).')
                .replace('{pct}', pctCons);
            const modeTitle = (t('sim_prudence_mode_moderate') || 'Prudence modérée ({pct}%)').replace('{pct}', pctCons);
            return `⚖️ <strong>${modeTitle}</strong> : ${hybridDesc}`;
        }

        // Mode historical_n1 / auto (saisonnier année passée)
        if (pctCons === 0) {
            return `🎯 <strong>${t('sim_prudence_mode_neutral') || 'Recettes du modèle (0%)'}</strong> : Projection basée sur l'historique réel de l'année passée (primes, bonus et saisonnalité inclus).`;
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
        ProfileStorage.set('sim_conservative_weight', this.conservativeWeight);
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
        ProfileStorage.set('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async onConservativeWeightChange(val) {
        const intVal = parseInt(val) || 0;
        this.conservativeWeight = intVal / 100.0;
        ProfileStorage.set('sim_conservative_weight', this.conservativeWeight);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    toggleSection(section) {
        if (section === 'advanced') {
            const body = document.getElementById('simAdvancedBody');
            const chevron = document.getElementById('simAdvancedChevron');
            if (body && chevron) {
                const isOpen = body.classList.toggle('open');
                chevron.classList.toggle('open', isOpen);
                ProfileStorage.set('sim_advanced_open', isOpen);
            }
        } else if (section === 'table') {
            const body = document.getElementById('simTableBody');
            const chevron = document.getElementById('simTableChevron');
            if (body && chevron) {
                const isOpen = body.classList.toggle('open');
                chevron.classList.toggle('open', isOpen);
                ProfileStorage.set('sim_table_open', isOpen);
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
            ProfileStorage.set('sim_sources_open', willBeOpen);
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
                ? 'Année passée'
                : (this.incomeMode === 'average' ? `Moyenne${avgIncome > 0 ? ` (~${avgIncome.toLocaleString('fr-FR')} €)` : ''}` : (this.incomeMode === 'custom' ? `${(this.customIncomeAmount || 0).toLocaleString('fr-FR')} €` : 'Zéro salaire'));
            compactSummaryParts.push(`💼 ${incomeBadge}`);
            if (this.inflationRate > 0) compactSummaryParts.push(`📈 ${(this.inflationRate * 100).toFixed(1)}%`);
            summaryEl.innerHTML = compactSummaryParts.join('  <span style="opacity:0.3;">│</span>  ');
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
        ProfileStorage.set('sim_income_mode', val);
        if (val === 'custom' && !this.customIncomeAmount) {
            const defaultAmt = (this.simulationData && this.simulationData.predicted_salary) ? this.simulationData.predicted_salary : 2500;
            this.customIncomeAmount = defaultAmt;
            ProfileStorage.set('sim_custom_income', defaultAmt);
        }
        await this.runSimulation();
        this.render();
    },

    async onCustomIncomeChange(val) {
        this.customIncomeAmount = parseFloat(val) || 0;
        ProfileStorage.set('sim_custom_income', this.customIncomeAmount);
        await this.runSimulation();
        this.render();
    },

    async onHorizonChange(val) {
        this.horizonMonths = parseInt(val);
        ProfileStorage.set('sim_horizon', this.horizonMonths);
        await this.runSimulation();
        this.render();
    },

    async onInflationChange(val) {
        this.inflationRate = (parseFloat(val) || 0) / 100;  // Convert from % to decimal
        ProfileStorage.set('sim_inflation_rate', this.inflationRate);
        await this.runSimulation();
        this.render();
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
        ProfileStorage.set('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        await this.runSimulation();
        this.updateLiveSimulationView(true);
    },

    async applyBreakEvenEffort(pct) {
        // Arrondi au pourcent supérieur (pas de 1%), plafonné à 100%
        let targetPct = Math.min(100, Math.ceil(pct));
        this.varExpenseAdjustmentPct = -(targetPct / 100.0);
        ProfileStorage.set('sim_var_expense_adj', this.varExpenseAdjustmentPct);
        await this.runSimulation();
        this.render();
        if (typeof showToast === 'function') {
            showToast(`${window.i18n.t('sim_btn_apply_break_even').replace('{pct}', targetPct)}`, "info");
        }
    },

    async resetEffort() {
        this.varExpenseAdjustmentPct = 0.0;
        ProfileStorage.set('sim_var_expense_adj', 0.0);
        await this.runSimulation();
        this.render();
    },


    async onAccountChange(val) {
        this.accountId = val ? parseInt(val) : null;
        ProfileStorage.set('sim_account', this.accountId);
        await this.runSimulation();
        this.render();
    },

    async onScenarioChange(val) {
        this.activeScenarioId = val ? parseInt(val) : null;
        ProfileStorage.set('sim_active_scenario', this.activeScenarioId);
        await this.runSimulation();
        this.render();
    },

    async toggleEvent(eventId, isActive) {
        try {
            await API.put(`/api/simulator/events/${eventId}`, { is_active: isActive });
            const scenario = this.scenarios.find(s => s.id === this.activeScenarioId);
            if (scenario && scenario.events) {
                const ev = scenario.events.find(e => e.id === eventId);
                if (ev) ev.is_active = isActive;
            }
            await this.runSimulation();
            this.render();
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
                const res = await API.put(`/api/simulator/scenarios/${this.editingScenario.id}`, { name, description, color });
                showToast(window.i18n.t('sim_toast_scenario_updated') || "Scénario mis à jour", "success");
            } else {
                const res = await API.post('/api/simulator/scenarios', { name, description, color, events: [] });
                this.activeScenarioId = res.id;
                ProfileStorage.set('sim_active_scenario', res.id);
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
                await API.del(`/api/simulator/scenarios/${scenarioId}`);
                showToast(window.i18n.t('sim_toast_scenario_deleted') || "Scénario supprimé", "info");
                if (this.activeScenarioId === scenarioId) {
                    this.activeScenarioId = null;
                    ProfileStorage.set('sim_active_scenario', null);
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
            const res = await API.post(`/api/simulator/scenarios/${scenarioId}/duplicate`);
            this.activeScenarioId = res.id;
            ProfileStorage.set('sim_active_scenario', res.id);
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
            });

            this.activeScenarioId = created.id;
            ProfileStorage.set('sim_active_scenario', created.id);
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
                await API.put(`/api/simulator/events/${this.editingEvent.id}`, payload);
                showToast(window.i18n.t('sim_toast_event_updated') || "Événement mis à jour", "success");
            } else {
                await API.post(`/api/simulator/scenarios/${this.activeScenarioId}/events`, payload);
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
                await API.del(`/api/simulator/events/${eventId}`);
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
