// static/js/views/config_manager.js — Point d'entrée principal de la vue Configuration
// Assemble les sous-modules : config_ai.js, config_backups.js, config_org_users.js, config_profiles.js

window.ConfigView = Object.assign(window.ConfigView || {}, {
    activeTab: 'general',

    render() {
        const activeTab = (function() {
            try {
                const saved = localStorage.getItem('omnibank_config_tab');
                if (saved === 'security') return 'profiles';
                if (['general', 'profiles', 'categorization', 'ai', 'data', 'advanced'].includes(saved)) return saved;
            } catch(e) {}
            return 'general';
        })();
        this.activeTab = activeTab;

        return `
            <div class="view-header-bar config-header-bar" style="position:relative;top:0;margin-top:0;padding-top:0;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
                <div class="view-header-title-group">
                    <h2 class="view-header-title"><span class="config-h-icon"><svg class="config-svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></span> <span data-i18n="nav_configuration">${window.i18n.t('nav_configuration')}</span></h2>
                </div>
                <div class="config-search-box">
                    <span class="config-search-icon"><svg class="config-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
                    <input type="text" id="configSearchInput" class="config-search-input" data-i18n-placeholder="config_search_placeholder" placeholder="${window.i18n ? window.i18n.t('config_search_placeholder') : 'Rechercher un paramètre...'}" oninput="window.ConfigView.filterSettings(this.value)">
                </div>
            </div>

            <!-- Tab Navigation Bar -->
            <div class="config-tabs-bar" id="configTabsBar" role="tablist">
                <button type="button" role="tab" class="config-tab-btn ${activeTab === 'general' ? 'active' : ''}" data-tab="general" onclick="window.ConfigView.switchTab('general')">
                    <span class="config-tab-icon"><svg class="config-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></span>
                    <span data-i18n="config_tab_general">${window.i18n ? window.i18n.t('config_tab_general') : 'Général'}</span>
                </button>
                <button type="button" role="tab" class="config-tab-btn ${activeTab === 'profiles' ? 'active' : ''}" data-tab="profiles" onclick="window.ConfigView.switchTab('profiles')">
                    <span class="config-tab-icon"><svg class="config-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
                    <span data-i18n="config_tab_profiles">${window.i18n ? window.i18n.t('config_tab_profiles') : 'Profils & accès'}</span>
                </button>
                <button type="button" role="tab" class="config-tab-btn ${activeTab === 'categorization' ? 'active' : ''}" data-tab="categorization" onclick="window.ConfigView.switchTab('categorization')">
                    <span class="config-tab-icon"><svg class="config-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span>
                    <span data-i18n="config_tab_categorization">${window.i18n ? window.i18n.t('config_tab_categorization') : 'Catégorisation'}</span>
                </button>
                <button type="button" role="tab" class="config-tab-btn ${activeTab === 'ai' ? 'active' : ''}" data-tab="ai" onclick="window.ConfigView.switchTab('ai')">
                    <span class="config-tab-icon"><svg class="config-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="16" y1="16" x2="16.01" y2="16"/></svg></span>
                    <span data-i18n="config_tab_ai">${window.i18n ? window.i18n.t('config_tab_ai') : 'Assistant IA'}</span>
                </button>
                <button type="button" role="tab" class="config-tab-btn ${activeTab === 'data' ? 'active' : ''}" data-tab="data" onclick="window.ConfigView.switchTab('data')">
                    <span class="config-tab-icon"><svg class="config-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg></span>
                    <span data-i18n="config_tab_data">${window.i18n ? window.i18n.t('config_tab_data') : 'Sauvegardes & données'}</span>
                </button>
                <button type="button" role="tab" class="config-tab-btn ${activeTab === 'advanced' ? 'active' : ''}" data-tab="advanced" onclick="window.ConfigView.switchTab('advanced')">
                    <span class="config-tab-icon"><svg class="config-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>
                    <span data-i18n="config_tab_advanced">${window.i18n ? window.i18n.t('config_tab_advanced') : 'Avancé'}</span>
                </button>
            </div>

            <div class="config-tab-pane" id="configPane_general" style="${activeTab === 'general' ? '' : 'display: none;'}">
                <!-- Theme & Appearance Management -->
                <div class="config-card" id="themeConfigCard" >
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
                        <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.04-.23-.29-.38-.63-.38-1.04 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9z"/></svg></span> <span data-i18n="theme_manager_title">${window.i18n ? window.i18n.t('theme_manager_title') : 'Gestionnaire de Thèmes'}</span></h3>
                    </div>
                    <p style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 16px;" data-i18n="theme_manager_desc">
                        ${window.i18n ? window.i18n.t('theme_manager_desc') : 'Personnalisez l\'apparence visuelle d\'OmniBank selon vos préférences.'}
                    </p>

                    <div class="theme-config-grid" id="themeConfigGrid">
                        ${(window.ThemeManager ? window.ThemeManager.getThemes() : []).map(t => {
                            const current = window.ThemeManager ? window.ThemeManager.currentThemeId : 'dark';
                            const isActive = t.id === current;
                            const name = window.i18n ? window.i18n.t(t.nameKey) : t.id;
                            const desc = window.i18n ? window.i18n.t(t.descKey) : '';
                            return `
                                <div class="theme-card theme-card-${t.id} ${isActive ? 'active' : ''}" onclick="window.ThemeManager.applyTheme('${t.id}'); window.ConfigView._refreshThemeCards();">
                                    <div class="theme-card-header">
                                        <div class="theme-card-title">
                                            <span class="theme-card-icon">${t.icon}</span>
                                            <span>${name}</span>
                                        </div>
                                        <div class="theme-card-radio ${isActive ? 'active' : ''}">
                                            <span class="theme-card-radio-dot"></span>
                                        </div>
                                    </div>

                                    <!-- Mini UI Mockup Preview -->
                                    <div class="theme-card-ui-mockup theme-mockup-${t.id}">
                                        <div class="theme-mockup-header">
                                            <div class="theme-mockup-dots">
                                                <span style="background: #ef4444;"></span>
                                                <span style="background: #f59e0b;"></span>
                                                <span style="background: #10b981;"></span>
                                            </div>
                                            <span class="theme-mockup-badge">${t.type.toUpperCase()}</span>
                                        </div>
                                        <div class="theme-mockup-body">
                                            <div class="theme-mockup-sidebar">
                                                <div class="theme-mockup-nav-item active"></div>
                                                <div class="theme-mockup-nav-item"></div>
                                                <div class="theme-mockup-nav-item"></div>
                                            </div>
                                            <div class="theme-mockup-main">
                                                <div class="theme-mockup-card">
                                                    <div class="theme-mockup-card-label">Solde global</div>
                                                    <div class="theme-mockup-card-val">8 592,36 €</div>
                                                    <div class="theme-mockup-card-sub">
                                                        <span class="theme-mockup-pill">+287,50 €</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <p class="theme-card-desc">${desc}</p>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <!-- Optional Features / Modules -->
                <div class="config-card" id="configFeaturesCard" >
                    <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1" y="5" width="22" height="14" rx="7"/><circle cx="16" cy="12" r="3"/></svg></span> <span data-i18n="config_opt_title">${window.i18n.t('config_opt_title')}</span></h3>
                    <p style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 15px;">
                        ${window.i18n.t('config_opt_desc')}
                    </p>
                    <div class="config-toggle-list">
                        <label class="config-toggle-row">
                            <span class="toggle-switch">
                                <input type="checkbox" id="conf_enable_bimonthly" onchange="window.ConfigView.save()">
                                <span class="slider"></span>
                            </span>
                            <span data-i18n="config_opt_bimonthly">Activer la récurrence bi-mensuelle</span>
                        </label>
                        <label class="config-toggle-row">
                            <span class="toggle-switch">
                                <input type="checkbox" id="conf_enable_attachments" onchange="window.ConfigView.save()">
                                <span class="slider"></span>
                            </span>
                            <span data-i18n="config_opt_attachments">Activer les documents joints (Upload de fichiers)</span>
                        </label>
                        <label class="config-toggle-row">
                            <span class="toggle-switch">
                                <input type="checkbox" id="conf_enable_check_slips" onchange="window.ConfigView.save()">
                                <span class="slider"></span>
                            </span>
                            <span data-i18n="config_opt_check_slips">Activer la saisie des numéros de bordereaux de chèques</span>
                        </label>
                        <label class="config-toggle-row">
                            <span class="toggle-switch">
                                <input type="checkbox" id="conf_enable_org_mode" onchange="window.ConfigView._onOrgModeToggle()">
                                <span class="slider"></span>
                            </span>
                            <span data-i18n="config_opt_org_mode">Activer le mode Organisation (Association/CSE)</span>
                        </label>
                        <label class="config-toggle-row">
                            <span class="toggle-switch">
                                <input type="checkbox" id="conf_enable_simulator" onchange="window.ConfigView.save()">
                                <span class="slider"></span>
                            </span>
                            <span data-i18n="config_opt_simulator">Activer le simulateur de projets & What-If</span>
                        </label>
                    </div>
                    <div id="configLicenseStatus" style="margin-top: 8px; display: none;"></div>
                </div>

                <!-- General Settings (Recurrences) -->
                <div class="config-card" id="configGenSettingsCard" >
                    <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg></span> <span data-i18n="config_gen_settings_title">${window.i18n.t('config_gen_settings_title')}</span></h3>
                    <p style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 15px;" data-i18n="config_gen_settings_desc">
                        ${window.i18n.t('config_gen_settings_desc')}
                    </p>
                    <div style="display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 500;">
                        <input type="number" id="conf_recurrence_months" class="inline-input" min="1" max="36" value="12" style="width: 70px; text-align: center; border-radius: 6px; padding: 6px; border: 1px solid var(--border-color); background: var(--bg-input); font-size: 13px;" onchange="window.ConfigView.save()">
                        <span data-i18n="config_recurrence_months">Nombre de mois de récurrences à générer à l'avance</span>
                    </div>
                </div>
            </div>

            <div class="config-tab-pane" id="configPane_profiles" style="${activeTab === 'profiles' ? '' : 'display: none;'}">
                <!-- Master Profiles & PIN Lock -->
                <div class="config-card" id="configProfilesCard" >
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 15px;">
                        <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span> <span data-i18n="profiles_title">Profils Maîtres</span></h3>
                        <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;" onclick="window.ConfigView._showCreateProfileModal()">
                            ➕ <span data-i18n="profiles_create">Créer un profil</span>
                        </button>
                    </div>
                    <p style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 15px;" data-i18n="profiles_subtitle">
                        Gérez plusieurs espaces de comptes indépendants sur cette même installation. Chaque profil maître possède sa propre base de données et ses propres pièces jointes isolées.
                    </p>
                    <div id="profilesListContainer" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;"></div>
                    <div style="margin-top: 15px; padding-top: 12px; border-top: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
                        <div>
                            <label style="font-weight: 600; font-size: 12px; color: var(--text-main);" data-i18n="profiles_autolock_label">Verrouillage automatique (inactivité)</label>
                            <div style="font-size: 11px; color: var(--text-muted);" data-i18n="profiles_autolock_hint">${window.i18n ? window.i18n.t('profiles_autolock_hint') : 'Actif si un code PIN de protection est configuré sur le profil'}</div>
                        </div>
                        <select id="autoLockMinutesSelect" class="inline-input" style="min-width: 180px;" onchange="if(window.ProfileStorage){ window.ProfileStorage.set('omni_autolock_minutes', this.value); if(window.app && window.app.initAutoLock) window.app.initAutoLock(); } showToast(window.i18n ? window.i18n.t('profiles_autolock_saved') : 'Réglage de verrouillage sauvegardé', 'success');">
                            <option value="5" data-i18n="profiles_autolock_5m">Après 5 minutes (Recommandé)</option>
                            <option value="1" data-i18n="profiles_autolock_1m">Après 1 minute</option>
                            <option value="15" data-i18n="profiles_autolock_15m">Après 15 minutes</option>
                            <option value="30" data-i18n="profiles_autolock_30m">Après 30 minutes</option>
                            <option value="off" data-i18n="profiles_autolock_off">Désactivé</option>
                        </select>
                    </div>
                    <p style="font-size: 11px; color: var(--text-muted); margin-top: 15px; font-style: italic; background: rgba(99,102,241,0.05); padding: 8px 12px; border-radius: 8px; border: 1px dashed rgba(99,102,241,0.3);" data-i18n="profiles_pin_recovery_hint">
                        💡 Code PIN oublié ? Utilisez le code de récupération remis à la création du PIN. Si vous l'avez aussi perdu, exécutez <code>python -m app.reset_pin</code> sur la machine qui héberge OmniBank (Docker : <code>docker exec -it &lt;conteneur&gt; python -m app.reset_pin</code>).
                    </p>
                </div>

                <!-- Org Users Panel (org mode only) -->
                <div id="configOrgUsersPanel" class="config-card" style="display: none;">
                    <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span> <span data-i18n="config_org_users">${window.i18n.t('config_org_users')}</span></h3>
                    <p style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 15px;" data-i18n="config_org_users_desc">${window.i18n.t('config_org_users_desc')}</p>
                    <div id="orgUsersList" style="margin-bottom: 12px;"></div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <input type="text" id="newOrgUserName" class="inline-input" data-i18n-placeholder="ph_user_name" placeholder="${window.i18n.t('ph_user_name')}" style="flex: 1; padding: 8px 12px; font-size: 13px;">
                        <button class="btn btn-primary" style="padding: 8px 16px; font-size: 13px; white-space: nowrap;" onclick="window.ConfigView._addOrgUser()" data-i18n="btn_add_user">+ ${window.i18n.t('btn_add_user')}</button>
                    </div>
                </div>

                <!-- Shared Mode Panel (Multi-session Windows) -->
                <div id="configSharedModePanel" class="config-card" >
                    <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span> <span data-i18n="config_shared_mode">${window.i18n.t('config_shared_mode')}</span></h3>
                    <p style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 15px;" data-i18n="config_shared_mode_desc">${window.i18n.t('config_shared_mode_desc')}</p>
                    <div id="sharedModeStatus" style="margin-bottom: 12px;"></div>
                    <div id="sharedModeActions" style="display: flex; gap: 10px; flex-wrap: wrap;"></div>
                </div>

                <!-- Server Connection Settings Card -->
                <div class="config-card" id="configServerCard" >
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                        <div>
                            <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg></span> <span data-i18n="config_server_title">${window.i18n ? window.i18n.t('config_server_title') : 'Connexion Serveur (Docker / Client Distant)'}</span></h3>
                            <p style="color: var(--text-muted); font-size: 12.5px; margin: 0;" data-i18n="config_server_desc">${window.i18n ? window.i18n.t('config_server_desc') : "Configurez l'adresse IP et le port du serveur backend auto-hébergé pour les accès distants ou mobiles."}</p>
                        </div>
                        <button class="btn btn-primary" onclick="window.ServerConfig.openModal()" style="display:flex; align-items:center; gap:6px;">
                            <span>⚙️</span> <span data-i18n="config_server_btn">${window.i18n ? window.i18n.t('config_server_btn') : 'Configurer le serveur'}</span>
                        </button>
                    </div>
                </div>
            </div>

            <div class="config-tab-pane" id="configPane_categorization" style="${activeTab === 'categorization' ? '' : 'display: none;'}">
                <!-- Smart Label Matching Rules -->
                ${window.ConfigSmartLabels ? window.ConfigSmartLabels.render() : ''}
            </div>

            <div class="config-tab-pane" id="configPane_ai" style="${activeTab === 'ai' ? '' : 'display: none;'}">
                <!-- Ollama AI Settings -->
                <div class="config-card config-ai-card" id="configAiCard">
                    <div class="config-card-header">
                        <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="16" y1="16" x2="16.01" y2="16"/></svg></span> <span data-i18n="config_ai_title">${window.i18n.t('config_ai_title')}</span></h3>
                        <label>
                            <span class="toggle-switch">
                                <input type="checkbox" id="conf_enable_ai" onchange="window.ConfigView.toggleAI(this.checked); window.ConfigView.save();">
                                <span class="slider"></span>
                            </span>
                            <span data-i18n="config_ai_enable">${window.i18n.t('config_ai_enable')}</span>
                        </label>
                    </div>

                    <div id="ollamaSettings">
                        <p data-i18n="config_ai_desc">${window.i18n.t('config_ai_desc')}</p>

                        <h4 class="config-group-title" data-i18n="config_ai_group_connection">${window.i18n.t('config_ai_group_connection')}</h4>
                        <div class="flex-row-mobile-col config-field-row">
                            <div class="config-field">
                                <label class="config-label" for="conf_ollama_url" data-i18n="config_ai_url">URL Ollama</label>
                                <input type="text" id="conf_ollama_url" class="inline-input" placeholder="http://127.0.0.1:11434" onchange="window.ConfigView.save()">
                            </div>
                            <button class="btn btn-secondary config-field-action" onclick="window.ConfigView.fetchModels()" data-i18n="config_ai_test_btn">Tester la connexion</button>
                        </div>
                        <p id="aiConnStatus" class="config-status" role="status"></p>

                        <div class="config-field">
                            <label class="config-label" for="conf_ollama_model" data-i18n="config_ai_model">Modèle sélectionné</label>
                            <select id="conf_ollama_model" class="inline-input" onchange="window.ConfigView.save()">
                                <option value="" data-i18n="config_ai_no_model">${window.i18n.t('config_ai_no_model')}</option>
                            </select>
                            <p class="config-help" data-i18n="config_ai_model_warning">${window.i18n.t('config_ai_model_warning')}</p>
                        </div>

                        <details class="config-collapse">
                            <summary data-i18n="config_ai_advanced">${window.i18n.t('config_ai_advanced')}</summary>
                            <div class="flex-row-mobile-col config-field-row config-field-row-top">
                                <div class="config-field">
                                    <label class="config-label" for="conf_ollama_temp_slider" data-i18n="config_ai_temp">Température (Créativité)</label>
                                    <div class="config-slider-row">
                                        <input type="range" id="conf_ollama_temp_slider" min="0" max="1" step="0.1" value="0.3" oninput="document.getElementById('conf_ollama_temp').value = this.value" onchange="window.ConfigView.save()">
                                        <input type="number" id="conf_ollama_temp" class="inline-input" min="0" max="1" step="0.1" value="0.3" oninput="document.getElementById('conf_ollama_temp_slider').value = this.value" onchange="window.ConfigView.save()">
                                    </div>
                                    <p class="config-help" data-i18n="config_ai_temp_hint">${window.i18n.t('config_ai_temp_hint')}</p>
                                </div>
                                <div class="config-field">
                                    <label class="config-label" for="conf_ollama_ctx" data-i18n="config_ai_ctx">Taille du Contexte</label>
                                    <input type="number" id="conf_ollama_ctx" class="inline-input" value="32768" min="16384" step="1024" onchange="if (+this.value < 16384) this.value = '16384'; window.ConfigView.save()">
                                    <div class="config-chip-row">
                                        <button type="button" class="btn btn-secondary config-chip" onclick="document.getElementById('conf_ollama_ctx').value='16384'; window.ConfigView.save()">16K</button>
                                        <button type="button" class="btn btn-secondary config-chip" onclick="document.getElementById('conf_ollama_ctx').value='32768'; window.ConfigView.save()">32K</button>
                                        <button type="button" class="btn btn-secondary config-chip" onclick="document.getElementById('conf_ollama_ctx').value='65536'; window.ConfigView.save()">64K</button>
                                        <button type="button" class="btn btn-secondary config-chip" onclick="document.getElementById('conf_ollama_ctx').value='131072'; window.ConfigView.save()">128K</button>
                                    </div>
                                    <p class="config-help" data-i18n="config_ai_ctx_hint">${window.i18n.t('config_ai_ctx_hint')}</p>
                                </div>
                            </div>
                            <div class="config-tip">
                                <strong data-i18n="config_ai_optimal_hint">${window.i18n.t('config_ai_optimal_hint')}</strong>
                                <ul>
                                    <li data-i18n="config_ai_temp_hint_detail">${window.i18n.t('config_ai_temp_hint_detail')}</li>
                                    <li data-i18n="config_ai_ctx_hint_detail">${window.i18n.t('config_ai_ctx_hint_detail')}</li>
                                </ul>
                            </div>
                        </details>
                    </div> <!-- End ollamaSettings -->
                </div>

                <!-- Assistant behaviour: editable personality + final prompt preview -->
                <div class="config-card" id="configAiBehaviorCard">
                    <div class="config-card-header">
                        <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span> <span data-i18n="config_ai_behavior_title">${window.i18n.t('config_ai_behavior_title')}</span></h3>
                    </div>
                    <div class="config-field">
                        <label class="config-label" for="conf_ai_personality" data-i18n="config_ai_personality_label">${window.i18n.t('config_ai_personality_label')}</label>
                        <textarea id="conf_ai_personality" class="inline-input config-prompt-textarea" rows="9" spellcheck="false"></textarea>
                        <p class="config-help" data-i18n="config_ai_personality_help">${window.i18n.t('config_ai_personality_help')}</p>
                    </div>
                    <div class="config-chip-row">
                        <button type="button" class="btn btn-primary" onclick="window.ConfigView.saveAiText('personality')" data-i18n="config_ai_personality_save">${window.i18n.t('config_ai_personality_save')}</button>
                        <button type="button" class="btn btn-secondary" onclick="window.ConfigView.restoreAiText('personality')" data-i18n="config_ai_personality_restore">${window.i18n.t('config_ai_personality_restore')}</button>
                    </div>

                    <details class="config-collapse">
                        <summary data-i18n="config_ai_guide_label">${window.i18n.t('config_ai_guide_label')}</summary>
                        <div class="config-field">
                            <textarea id="conf_ai_guide" class="inline-input config-prompt-textarea" rows="12" spellcheck="false" aria-label="${window.i18n.t('config_ai_guide_label')}"></textarea>
                            <p class="config-help" data-i18n="config_ai_guide_help">${window.i18n.t('config_ai_guide_help')}</p>
                        </div>
                        <div class="config-chip-row">
                            <button type="button" class="btn btn-primary" onclick="window.ConfigView.saveAiText('guide')" data-i18n="config_ai_personality_save">${window.i18n.t('config_ai_personality_save')}</button>
                            <button type="button" class="btn btn-secondary" onclick="window.ConfigView.restoreAiText('guide')" data-i18n="config_ai_personality_restore">${window.i18n.t('config_ai_personality_restore')}</button>
                        </div>
                    </details>

                    <h4 class="config-group-title" data-i18n="config_ai_preview_title">${window.i18n.t('config_ai_preview_title')}</h4>
                    <p class="config-help" data-i18n="config_ai_preview_help">${window.i18n.t('config_ai_preview_help')}</p>
                    <div class="flex-row-mobile-col config-field-row">
                        <div class="config-field">
                            <label class="config-label" for="conf_ai_preview_role" data-i18n="config_ai_preview_role">${window.i18n.t('config_ai_preview_role')}</label>
                            <select id="conf_ai_preview_role" class="inline-input">
                                ${['advisor', 'simulator', 'alerts', 'optimizer', 'budget_planner', 'forecaster', 'auditor'].map(r => `<option value="${r}">${window.i18n.t('config_ai_role_' + r)}</option>`).join('')}
                            </select>
                        </div>
                        <button type="button" class="btn btn-secondary config-field-action" onclick="window.ConfigView.previewAiPrompt()" data-i18n="config_ai_preview_btn">${window.i18n.t('config_ai_preview_btn')}</button>
                    </div>
                    <div id="aiPromptPreview" class="config-prompt-preview"></div>
                </div>

                <!-- Proactive reports -->
                <div class="config-card" id="configAiReportsCard">
                    <div class="config-card-header">
                        <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></span> <span data-i18n="settings_ai_reports_title">Bilans périodiques</span></h3>
                        <label>
                            <span class="toggle-switch">
                                <input type="checkbox" id="conf_ai_reports_enabled" onchange="window.ConfigView.toggleAIReports(this.checked); window.ConfigView.save()">
                                <span class="slider"></span>
                            </span>
                            <span data-i18n="settings_ai_reports_enable">Activer les bilans</span>
                        </label>
                    </div>
                    <p data-i18n="settings_ai_reports_enable_desc">Génère périodiquement une courte notification analytique résumant votre état de santé financière.</p>
                    <div id="aiReportsSubSettings" style="display: none;">
                        <div class="flex-row-mobile-col config-field-row">
                            <div class="config-field">
                                <label class="config-label" for="conf_ai_reports_frequency" data-i18n="settings_ai_reports_freq">Fréquence des rapports</label>
                                <select id="conf_ai_reports_frequency" class="inline-input" onchange="window.ConfigView.save()">
                                    <option value="daily" data-i18n="settings_ai_reports_freq_daily">Quotidien</option>
                                    <option value="weekly" data-i18n="settings_ai_reports_freq_weekly">Hebdomadaire (Recommandé)</option>
                                    <option value="monthly" data-i18n="settings_ai_reports_freq_monthly">Mensuel</option>
                                </select>
                            </div>
                            <button class="btn btn-secondary config-field-action" id="btnTriggerAIReport" onclick="window.ConfigView.triggerAIReportGeneration()" data-i18n="settings_ai_btn_generate_report">Générer un bilan maintenant</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="config-tab-pane" id="configPane_data" style="${activeTab === 'data' ? '' : 'display: none;'}">
                <!-- Data Management & Backups -->
                <div class="config-card" id="configDataMgmtCard">
                    <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg></span> <span data-i18n="config_data_mgmt">${window.i18n.t('config_data_mgmt')}</span></h3>
                    <p data-i18n="config_data_desc">${window.i18n.t('config_data_desc')}</p>

                    <h4 class="config-group-title" data-i18n="config_group_export">${window.i18n ? window.i18n.t('config_group_export') : 'Exporter et sauvegarder'}</h4>
                    <div class="config-btn-row">
                        <button class="btn btn-primary" onclick="window.ConfigView.downloadBackup()">
                            <span data-i18n="btn_download_backup">Télécharger Sauvegarde Complète (ZIP)</span>
                        </button>
                        <button class="btn btn-secondary" onclick="window.ConfigView.downloadAllProfilesBackup()" title="${window.i18n ? window.i18n.t('profiles_backup_all_tooltip') : 'Sauvegarder tous les profils maîtres dans une seule archive'}">
                            <span data-i18n="profiles_backup_all">Sauvegarder tous les profils (ZIP)</span>
                        </button>
                        <button class="btn btn-secondary" onclick="window.ConfigView.exportCSV()">
                            <span data-i18n="btn_export_csv">Exporter les données (CSV)</span>
                        </button>
                    </div>
                    <p data-i18n="backup_global_info_html" class="config-help">${window.i18n ? window.i18n.t('backup_global_info_html') : ''}</p>

                    <h4 class="config-group-title" data-i18n="config_group_import">${window.i18n ? window.i18n.t('config_group_import') : 'Importer'}</h4>
                    <div class="config-btn-row">
                        <input type="file" id="rawDbCsvInput" accept=".csv" style="display: none;" onchange="window.ConfigView.importRawCSV(event)">
                        <button class="btn btn-secondary" onclick="document.getElementById('rawDbCsvInput').click()">
                            <span data-i18n="btn_import_csv_db">Import CSV vers DB</span>
                        </button>
                    </div>
                </div>


                <!-- Auto Backup Card -->
                <div class="config-card" id="configAutoBackupCard" >
                    <div class="config-card-header">
                        <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span> <span data-i18n="config_auto_backup_title">${window.i18n.t('config_auto_backup_title')}</span></h3>
                        <label>
                            <span class="toggle-switch">
                                <input type="checkbox" id="conf_auto_backup_enabled" onchange="window.ConfigView.toggleAutoBackup(this.checked); window.ConfigView.save()">
                                <span class="slider"></span>
                            </span>
                            <span data-i18n="config_auto_backup_enable">${window.i18n.t('config_auto_backup_enable')}</span>
                        </label>
                    </div>
                    <p data-i18n="config_auto_backup_desc">${window.i18n.t('config_auto_backup_desc')}</p>

                    <div id="autoBackupSettings">
                        <div class="flex-row-mobile-col config-field-row">
                            <div class="config-field">
                                <label class="config-label" for="conf_auto_backup_frequency" data-i18n="config_auto_backup_frequency">${window.i18n.t('config_auto_backup_frequency')}</label>
                                <select id="conf_auto_backup_frequency" class="inline-input" onchange="window.ConfigView.save()">
                                    <option value="daily" data-i18n="config_auto_backup_freq_daily">${window.i18n.t('config_auto_backup_freq_daily')}</option>
                                    <option value="weekly" data-i18n="config_auto_backup_freq_weekly">${window.i18n.t('config_auto_backup_freq_weekly')}</option>
                                    <option value="monthly" data-i18n="config_auto_backup_freq_monthly">${window.i18n.t('config_auto_backup_freq_monthly')}</option>
                                </select>
                            </div>
                            <div class="config-field">
                                <label class="config-label" for="conf_auto_backup_max_count" data-i18n="config_auto_backup_max_count">${window.i18n.t('config_auto_backup_max_count')}</label>
                                <select id="conf_auto_backup_max_count" class="inline-input" onchange="window.ConfigView.save()">
                                    <option value="3">3</option>
                                    <option value="5" selected>5</option>
                                    <option value="10">10</option>
                                    <option value="20">20</option>
                                </select>
                            </div>
                            <button class="btn btn-secondary config-field-action" id="btnTriggerAutoBackup" onclick="window.ConfigView.triggerAutoBackup()">
                                <span data-i18n="config_auto_backup_trigger">${window.i18n.t('config_auto_backup_trigger')}</span>
                            </button>
                        </div>
                        <div id="autoBackupStatusPanel"></div>
                    </div>
                </div>

                <!-- Danger zone -->
                <details class="config-card config-danger" id="configDangerCard">
                    <summary>
                        <span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
                        <span class="config-danger-title" data-i18n="config_danger_title">${window.i18n ? window.i18n.t('config_danger_title') : 'Zone de danger'}</span>
                        <span class="config-danger-hint" data-i18n="config_danger_desc">${window.i18n ? window.i18n.t('config_danger_desc') : 'Ces actions remplacent ou effacent des données.'}</span>
                    </summary>
                    <div class="config-danger-row">
                        <div>
                            <strong data-i18n="btn_restore_backup">Restaurer Sauvegarde (ZIP)</strong>
                            <p data-i18n="config_danger_restore_desc">${window.i18n ? window.i18n.t('config_danger_restore_desc') : 'Remplace les données du profil actif par celles de l\'archive.'}</p>
                        </div>
                        <input type="file" id="restoreBackupInput" accept=".zip" style="display: none;" onchange="window.ConfigView.restoreBackup(event)">
                        <button class="btn btn-danger-outline" onclick="document.getElementById('restoreBackupInput').click()" data-i18n="config_danger_restore_btn">${window.i18n ? window.i18n.t('config_danger_restore_btn') : 'Restaurer'}</button>
                    </div>
                    <div class="config-danger-row">
                        <div>
                            <strong data-i18n="profiles_restore_all">Restaurer tous les profils (ZIP)</strong>
                            <p data-i18n="config_danger_restore_all_desc">${window.i18n ? window.i18n.t('config_danger_restore_all_desc') : 'Remplace tous les profils par ceux de l\'archive globale.'}</p>
                        </div>
                        <input type="file" id="restoreAllProfilesBackupInput" accept=".zip" style="display: none;" onchange="window.ConfigView.restoreAllProfilesBackup(event)">
                        <button class="btn btn-danger-outline" onclick="document.getElementById('restoreAllProfilesBackupInput').click()" title="${window.i18n ? window.i18n.t('profiles_restore_all_tooltip') : 'Restaurer tous les profils maîtres depuis une archive globale'}" data-i18n="config_danger_restore_btn">${window.i18n ? window.i18n.t('config_danger_restore_btn') : 'Restaurer'}</button>
                    </div>
                    <div class="config-danger-row">
                        <div>
                            <strong data-i18n="btn_clear_db">Vider la base de données</strong>
                            <p data-i18n="config_danger_clear_desc">${window.i18n ? window.i18n.t('config_danger_clear_desc') : 'Supprime toutes les données du profil actif. Irréversible.'}</p>
                        </div>
                        <button class="btn btn-danger" onclick="window.ConfigView.clearDB()" data-i18n="btn_clear_db">Vider la base de données</button>
                    </div>
                </details>

            </div>

            <div class="config-tab-pane" id="configPane_advanced" style="${activeTab === 'advanced' ? '' : 'display: none;'}">
                <!-- Multi-Currency & Exchange Rates Settings -->
                <div class="config-card" id="configCurrenciesCard" >
                    <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/></svg></span> <span data-i18n="config_currency_title">Devises & Taux de Change</span></h3>
                    <p style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 15px;" data-i18n="config_currency_desc">Configurez la devise principale de l'application et les taux de conversion hors-ligne pour la valeur nette globale.</p>
                    
                    <div style="margin-bottom: 18px; max-width: 320px;">
                        <label style="display: block; font-size: 11.5px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;" data-i18n="config_base_currency_label">Devise Principale Globale</label>
                        <select id="conf_base_currency" class="inline-input" style="border: 1px solid var(--border-color); padding: 8px 12px; width: 100%; font-size: 13.5px;" onchange="window.ConfigView.saveBaseCurrency()">
                            <option value="EUR">EUR (€) - Euro</option>
                            <option value="USD">USD ($) - Dollar US</option>
                            <option value="GBP">GBP (£) - Livre Sterling</option>
                            <option value="CHF">CHF (CHF) - Franc Suisse</option>
                            <option value="CAD">CAD (CA$) - Dollar Canadien</option>
                            <option value="JPY">JPY (¥) - Yen Japonais</option>
                        </select>
                    </div>

                    <details class="config-collapse" id="configRatesDetails">
                        <summary data-i18n="config_rates_summary">${window.i18n.t('config_rates_summary')}</summary>
                    <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap: wrap; gap: 8px; margin: 18px 0 10px 0;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <h4 style="margin:0; font-size: 13.5px; font-weight: 600;" data-i18n="config_exchange_rates_title">Grille des Taux de Change (Hors-Ligne)</h4>
                            <span id="rateCountBadge" class="badge" style="background:rgba(99,102,241,0.1); color:var(--primary); font-size:11.5px; font-weight:600; padding:2px 8px; border-radius:12px;">0 devises</span>
                        </div>
                        <button class="btn btn-secondary btn-sm" id="btnFetchOnlineRates" onclick="window.ConfigView.fetchOnlineRates()" style="font-size:12px; padding:4px 10px; display:inline-flex; align-items:center; gap:5px;" data-i18n="config_btn_fetch_online">🌐 Actualiser en ligne</button>
                    </div>
                    
                    <div class="rate-add-container" style="background: var(--bg-base); padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color); margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px;">
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="text" id="rate_from" class="inline-input" placeholder="${window.i18n ? window.i18n.t('config_rate_from_placeholder') : 'De (ex: USD)'}" style="flex: 1; min-width: 80px; text-transform: uppercase; font-size: 13px; text-align: center; font-weight: 600;">
                            <span style="font-weight: 700; color: var(--text-muted); font-size: 13px;">➔</span>
                            <input type="text" id="rate_to" class="inline-input" placeholder="${window.i18n ? window.i18n.t('config_rate_to_placeholder') : 'Vers (ex: EUR)'}" style="flex: 1; min-width: 80px; text-transform: uppercase; font-size: 13px; text-align: center; font-weight: 600;">
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <input type="number" id="rate_value" class="inline-input" placeholder="${window.i18n ? window.i18n.t('config_rate_val_placeholder') : 'Taux (ex: 0.92)'}" step="0.0001" style="flex: 1; min-width: 100px; font-size: 13px;">
                            <button class="btn btn-primary btn-sm" onclick="window.ConfigView.addExchangeRate()" style="padding: 6px 14px; font-size: 13px; white-space: nowrap; font-weight: 600;" data-i18n="config_btn_add_rate">➕ Ajouter</button>
                        </div>
                    </div>

                    <div style="margin-bottom: 8px;">
                        <input type="text" id="rateSearchInput" class="inline-input" placeholder="${window.i18n ? window.i18n.t('config_rate_search_placeholder') : '🔍 Rechercher une devise (USD, GBP, CHF...)'}" style="width:100%; font-size:13px; padding:6px 10px; border:1px solid var(--border-color); border-radius:6px;" oninput="window.ConfigView.filterExchangeRates()">
                    </div>

                    <div style="max-height: 220px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-surface);">
                        <table class="data-table rates-table" style="width: 100%; margin: 0; font-size: 13px; border-collapse: collapse;">
                            <thead style="position: sticky; top: 0; background: var(--bg-surface); z-index: 2; border-bottom: 1px solid var(--border-color);">
                                <tr>
                                    <th style="padding: 8px 10px; text-align: left; font-size: 11.5px;" data-i18n="config_th_pair">Paire</th>
                                    <th style="padding: 8px 10px; text-align: left; font-size: 11.5px;" data-i18n="config_th_rate">Taux</th>
                                    <th style="width: 36px; text-align: center; padding: 8px 4px;"></th>
                                </tr>
                            </thead>
                            <tbody id="exchangeRatesBody">
                                <!-- Rendered dynamically -->
                            </tbody>
                        </table>
                    </div>
                    </details>
                </div>

                <!-- Maintenance -->
                <div class="config-card" id="configMaintenanceCard">
                    <h3><span class="config-h-icon"><svg class="config-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span> <span data-i18n="config_maintenance_title">${window.i18n ? window.i18n.t('config_maintenance_title') : 'Maintenance'}</span></h3>
                    <p data-i18n="config_maintenance_desc">${window.i18n ? window.i18n.t('config_maintenance_desc') : ''}</p>
                    <div class="config-btn-row">
                        <button class="btn btn-secondary" onclick="window.SetupWizard.show()">
                            <span data-i18n="btn_relaunch_wizard">${window.i18n.t('btn_relaunch_wizard')}</span>
                        </button>
                        <button class="btn btn-secondary" id="btnOpenDataCleanupModal" onclick="window.ConfigView.openDataCleanupModal()">
                            <span data-i18n="maintenance_cleanup_modal_btn">${(window.i18n && window.i18n.t) ? window.i18n.t('maintenance_cleanup_modal_btn') || "Boîte à Outils d'Assainissement des Données" : "Boîte à Outils d'Assainissement des Données"}</span>
                            <span id="cleanupModalTriggerBadge" class="cleanup-badge cleanup-badge-warning" style="display:none;"></span>
                        </button>
                    </div>
                </div>


                <!-- Diagnostics & Bug Reporting -->
                ${window.ConfigDiagnostics ? window.ConfigDiagnostics.render() : ''}
            </div>
        `;
    },

    switchTab(tabId) {
        if (tabId === 'security') tabId = 'profiles';
        if (!['general', 'profiles', 'categorization', 'ai', 'data', 'advanced'].includes(tabId)) {
            tabId = 'general';
        }
        this.activeTab = tabId;
        try {
            localStorage.setItem('omnibank_config_tab', tabId);
        } catch (e) {}

        const searchInput = document.getElementById('configSearchInput');
        if (searchInput && searchInput.value.trim() !== '') {
            searchInput.value = '';
        }

        const tabsBar = document.getElementById('configTabsBar');
        if (tabsBar) {
            tabsBar.querySelectorAll('.config-tab-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
            });
        }

        const panes = document.querySelectorAll('.config-tab-pane');
        panes.forEach(pane => {
            const isTarget = pane.id === `configPane_${tabId}`;
            pane.style.display = isTarget ? 'block' : 'none';
        });

        document.querySelectorAll('.config-card').forEach(card => {
            card.classList.remove('config-card-hidden');
        });

        if (tabId === 'profiles') {
            this._refreshOrgUsersPanel();
        }
    },

    filterSettings(query) {
        const q = (query || '').trim();
        const panes = document.querySelectorAll('.config-tab-pane');
        const cards = document.querySelectorAll('.config-card');

        if (!q) {
            this.switchTab(this.activeTab || 'general');
            return;
        }

        panes.forEach(pane => {
            pane.style.display = 'block';
        });

        const isOrg = document.getElementById('conf_enable_org_mode')?.checked;

        cards.forEach(card => {
            if (card.id === 'configOrgUsersPanel' && !isOrg) {
                card.classList.add('config-card-hidden');
                return;
            }
            const text = card.innerText || card.textContent || '';
            const matches = window.permissiveMatch(text, q);
            card.classList.toggle('config-card-hidden', !matches);
        });

        panes.forEach(pane => {
            const visibleCards = pane.querySelectorAll('.config-card:not(.config-card-hidden)');
            pane.style.display = visibleCards.length > 0 ? 'block' : 'none';
        });
    },

    _refreshThemeCards() {
        const grid = document.getElementById('themeConfigGrid');
        if (!grid || !window.ThemeManager) return;
        const current = window.ThemeManager.currentThemeId;
        grid.querySelectorAll('.theme-card').forEach(card => {
            const isMatch = card.getAttribute('onclick')?.includes(`'${current}'`);
            card.classList.toggle('active', !!isMatch);
            const radio = card.querySelector('.theme-card-radio');
            if (radio) {
                radio.classList.toggle('active', !!isMatch);
            }
        });
    },

    async init() {
        await this.loadData();
        if (window.ConfigSmartLabels && typeof window.ConfigSmartLabels.init === 'function') {
            await window.ConfigSmartLabels.init();
        }
        const tab = this.activeTab || (function() {
            try {
                const saved = localStorage.getItem('omnibank_config_tab');
                if (saved === 'security') return 'profiles';
                if (['general', 'profiles', 'categorization', 'ai', 'data', 'advanced'].includes(saved)) return saved;
            } catch(e) {}
            return 'general';
        })();
        this.switchTab(tab);
    },

    async loadData() {
        try {
            this.configData = await API.get('/api/config/');
            
            if (this.configData.ollama_url) {
                document.getElementById('conf_ollama_url').value = this.configData.ollama_url;
                // If URL is present, fetch models in background without blocking local config UI
                this.fetchModels(true);
            }
            
            if (this.configData.ollama_temperature) {
                document.getElementById('conf_ollama_temp').value = this.configData.ollama_temperature;
                document.getElementById('conf_ollama_temp_slider').value = this.configData.ollama_temperature;
            }
            if (this.configData.ollama_context) {
                // Le serveur n'utilise jamais moins de 16K (consignes + outils de l'assistant)
                document.getElementById('conf_ollama_ctx').value = Math.max(16384, parseInt(this.configData.ollama_context, 10) || 32768);
            }
            
            this.loadAiPersonality();

            if (this.configData.enable_ai === 'true') {
                document.getElementById('conf_enable_ai').checked = true;
                this.toggleAI(true);
            } else {
                this.toggleAI(false);
            }
            if (this.configData.enable_bimonthly === 'true') document.getElementById('conf_enable_bimonthly').checked = true;
            if (this.configData.enable_attachments === 'true') document.getElementById('conf_enable_attachments').checked = true;
            if (this.configData.enable_check_slips === 'true') document.getElementById('conf_enable_check_slips').checked = true;
            if (this.configData.enable_org_mode === 'true') document.getElementById('conf_enable_org_mode').checked = true;
            if (document.getElementById('conf_enable_simulator')) {
                document.getElementById('conf_enable_simulator').checked = (this.configData.enable_simulator !== 'false');
            }
            if (this.configData.recurrence_generation_months) {
                document.getElementById('conf_recurrence_months').value = this.configData.recurrence_generation_months;
            } else {
                document.getElementById('conf_recurrence_months').value = "12";
            }
            
            // Phase 9: Show org users panel if enabled
            this._refreshOrgUsersPanel();
            // Phase 10: Show license status badge
            this._refreshLicenseStatus();
            // Master Profiles panel
            this._refreshProfilesPanel();
            // Improvement 03: Show shared mode status
            this._refreshSharedModePanel();
            // Improvement 05: Auto backup status
            const autoBackupToggle = document.getElementById('conf_auto_backup_enabled');
            if (autoBackupToggle) {
                // Default to true if key not set
                const isEnabled = (this.configData.auto_backup_enabled || 'true') === 'true';
                autoBackupToggle.checked = isEnabled;
                this.toggleAutoBackup(isEnabled);
            }
            const freqSel = document.getElementById('conf_auto_backup_frequency');
            if (freqSel && this.configData.auto_backup_frequency) {
                freqSel.value = this.configData.auto_backup_frequency;
            }
            const maxSel = document.getElementById('conf_auto_backup_max_count');
            if (maxSel && this.configData.auto_backup_max_count) {
                maxSel.value = this.configData.auto_backup_max_count;
            }
            this._refreshAutoBackupStatus();

            // Multi-Currency
            const baseCurrSel = document.getElementById('conf_base_currency');
            if (baseCurrSel && this.configData.base_currency) {
                baseCurrSel.value = this.configData.base_currency;
            }
            this.loadExchangeRates();

            // AI reports configuration loading
            const aiReportsToggle = document.getElementById('conf_ai_reports_enabled');
            if (aiReportsToggle) {
                const isReportsEnabled = (this.configData.ai_reports_enabled || 'false') === 'true';
                aiReportsToggle.checked = isReportsEnabled;
                this.toggleAIReports(isReportsEnabled);
            }
            const aiReportsFreqSel = document.getElementById('conf_ai_reports_frequency');
            if (aiReportsFreqSel && this.configData.ai_reports_frequency) {
                aiReportsFreqSel.value = this.configData.ai_reports_frequency;
            }

        } catch (e) {
            console.error("Failed to load config", e);
        }
    },

    toggleAutoBackup(enabled) {
        const settings = document.getElementById('autoBackupSettings');
        if (settings) {
            settings.style.display = enabled ? 'block' : 'none';
        }
    },

    async save(btn) {
        try {
            const data = {
                ollama_url: document.getElementById('conf_ollama_url').value,
                ollama_model: document.getElementById('conf_ollama_model').value,
                ollama_temperature: document.getElementById('conf_ollama_temp').value,
                ollama_context: document.getElementById('conf_ollama_ctx').value,
                enable_ai: document.getElementById('conf_enable_ai').checked ? 'true' : 'false',
                enable_bimonthly: document.getElementById('conf_enable_bimonthly').checked ? 'true' : 'false',
                enable_attachments: document.getElementById('conf_enable_attachments').checked ? 'true' : 'false',
                enable_check_slips: document.getElementById('conf_enable_check_slips').checked ? 'true' : 'false',
                enable_org_mode: document.getElementById('conf_enable_org_mode').checked ? 'true' : 'false',
                enable_simulator: document.getElementById('conf_enable_simulator') ? (document.getElementById('conf_enable_simulator').checked ? 'true' : 'false') : 'true',
                auto_backup_enabled: document.getElementById('conf_auto_backup_enabled').checked ? 'true' : 'false',
                auto_backup_frequency: document.getElementById('conf_auto_backup_frequency').value,
                auto_backup_max_count: document.getElementById('conf_auto_backup_max_count').value,
                ai_reports_enabled: document.getElementById('conf_ai_reports_enabled').checked ? 'true' : 'false',
                ai_reports_frequency: document.getElementById('conf_ai_reports_frequency').value,
                recurrence_generation_months: document.getElementById('conf_recurrence_months').value || "12"
            };
            
            // Sync to window.app.config immediately
            if (window.app) {
                window.app.config = { ...window.app.config, ...data };
                if (window.app.updateNavToggles) {
                    window.app.updateNavToggles();
                } else {
                    const isAiEnabled = (data.enable_ai === 'true' || data.enable_ai === true);
                    document.querySelectorAll('.nav-btn[data-view="chat"]').forEach(btn => {
                        btn.style.display = isAiEnabled ? '' : 'none';
                        btn.classList.toggle('is-hidden', !isAiEnabled);
                    });
                    const isSimEnabled = (data.enable_simulator !== 'false' && data.enable_simulator !== false);
                    document.querySelectorAll('.nav-btn[data-view="simulator"]').forEach(btn => {
                        btn.style.display = isSimEnabled ? '' : 'none';
                        btn.classList.toggle('is-hidden', !isSimEnabled);
                    });
                }
                if (window.app.refreshSidebar) window.app.refreshSidebar();
                if (window.TimelineView && window.app.currentView === 'dashboard') {
                    // Update filters visibility without full refresh if possible, or just render
                    const main = document.getElementById('mainContent');
                    if (main) main.innerHTML = window.TimelineView.render();
                    window.TimelineView.init();
                }
            }
            
            await API.post('/api/config/', data);
            
            // Phase 9: Refresh org users panel + header switcher visibility
            this._refreshOrgUsersPanel();
            const switcher = document.getElementById('userSwitcher');
            if (switcher) {
                switcher.style.display = data.enable_org_mode === 'true' ? 'block' : 'none';
            }
            if (data.enable_org_mode === 'true') {
                // Ensure default user exists and set it as current if none selected
                const curUser = window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('omni_current_user') : sessionStorage.getItem('omni_current_user');
                if (!curUser) {
                    try {
                        const defaultUser = await API.post('/api/org_users/ensure_default');
                        if (defaultUser && defaultUser.name) {
                            if (window.ProfileSessionStorage) window.ProfileSessionStorage.setItem('omni_current_user', defaultUser.name);
                            else sessionStorage.setItem('omni_current_user', defaultUser.name);
                            if (window.app) window.app.currentUser = defaultUser.name;
                        }
                    } catch(e) {}
                }
                // Update header label
                const label = document.getElementById('currentUserLabel');
                const userName = window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('omni_current_user') : sessionStorage.getItem('omni_current_user');
                if (label && userName) label.textContent = userName;
            } else {
                if (window.ProfileSessionStorage) window.ProfileSessionStorage.removeItem('omni_current_user');
                else sessionStorage.removeItem('omni_current_user');
                if (window.app) window.app.currentUser = null;
            }
            
            if (btn) {
                const originalText = btn.textContent;
                const originalBg = btn.style.backgroundColor;
                btn.textContent = window.i18n.t('btn_saved');
                btn.style.backgroundColor = "var(--color-income)";
                btn.style.transition = "all 0.3s";
                
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.backgroundColor = originalBg;
                }, 2000);
            } else {
                showToast(window.i18n.t('btn_saved') || 'Enregistré avec succès !', 'success', 2000);
            }
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error'));
        }
    },


});
