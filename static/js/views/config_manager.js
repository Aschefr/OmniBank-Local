// static/js/views/config_manager.js — Point d'entrée principal de la vue Configuration
// Assemble les sous-modules : config_ai.js, config_backups.js, config_org_users.js, config_profiles.js

window.ConfigView = Object.assign(window.ConfigView || {}, {
    render() {
        return `
            <div class="view-header-bar" style="position:relative;top:0;margin-top:0;padding-top:0;margin-bottom:18px;">
                <div class="view-header-title-group">
                    <h2 class="view-header-title">⚙️ <span data-i18n="nav_configuration">${window.i18n.t('nav_configuration')}</span></h2>
                </div>
            </div>
            
            <div class="config-card config-ai-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 15px;">
                    <h3 style="display:flex; align-items:center; gap:8px; margin:0;" data-i18n="config_ai_title">🤖 Configuration Ollama (Assistant IA)</h3>
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 600;">
                        <span class="toggle-switch">
                            <input type="checkbox" id="conf_enable_ai" onchange="window.ConfigView.toggleAI(this.checked); window.ConfigView.save();">
                            <span class="slider"></span>
                        </span>
                        <span data-i18n="config_ai_enable">${window.i18n.t('config_ai_enable')}</span>
                    </label>
                </div>
                
                <div id="ollamaSettings">
                    <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;">
                        ${window.i18n.t('config_ai_desc')}
                    </p>
                
                <div class="flex-row-mobile-col" style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <div style="flex: 1;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_ai_url">URL Ollama</label>
                        <input type="text" id="conf_ollama_url" class="inline-input" placeholder="http://127.0.0.1:11434" style="border: 1px solid var(--border-color); padding: 8px; margin-top: 5px;" onchange="window.ConfigView.save()">
                    </div>
                    <div style="display: flex; align-items: flex-end;">
                        <button class="btn btn-secondary" onclick="window.ConfigView.fetchModels()" style="height: 35px;" data-i18n="config_ai_test_btn">🔄 Tester & Récupérer Modèles</button>
                    </div>
                </div>

                <div class="flex-row-mobile-col" style="display: flex; gap: 10px; margin-bottom: 15px;">
                    <div style="flex: 1;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_ai_model">Modèle Sélectionné</label>
                        <select id="conf_ollama_model" class="inline-input" style="border: 1px solid var(--border-color); padding: 8px; margin-top: 5px;" onchange="window.ConfigView.save()">
                            <option value="" data-i18n="config_ai_no_model">${window.i18n.t('config_ai_no_model')}</option>
                        </select>
                        <p style="font-size: 10px; color: var(--color-expense); margin-top: 5px;" data-i18n="config_ai_model_warning">${window.i18n.t('config_ai_model_warning')}</p>
                    </div>
                </div>

                <div class="flex-row-mobile-col" style="display: flex; gap: 20px; margin-bottom: 15px;">
                    <div style="flex: 1;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_ai_temp">Température (Créativité)</label>
                        <div style="display: flex; align-items: center; gap: 10px; margin-top: 5px;">
                            <input type="range" id="conf_ollama_temp_slider" min="0" max="1" step="0.1" value="0.3" style="flex: 1;" oninput="document.getElementById('conf_ollama_temp').value = this.value" onchange="window.ConfigView.save()">
                            <input type="number" id="conf_ollama_temp" class="inline-input" min="0" max="1" step="0.1" value="0.3" style="width: 60px; border: 1px solid var(--border-color); padding: 5px; text-align: center;" oninput="document.getElementById('conf_ollama_temp_slider').value = this.value" onchange="window.ConfigView.save()">
                        </div>
                        <p style="font-size: 10px; color: var(--text-muted); margin-top: 5px;" data-i18n="config_ai_temp_hint">${window.i18n.t('config_ai_temp_hint')}</p>
                    </div>
                    <div style="flex: 1;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_ai_ctx">Taille du Contexte</label>
                        <div style="display: flex; flex-direction: column; gap: 5px; margin-top: 5px;">
                            <input type="number" id="conf_ollama_ctx" class="inline-input" value="4096" style="border: 1px solid var(--border-color); padding: 8px;" onchange="window.ConfigView.save()">
                            <div style="display: flex; gap: 5px;">
                                <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;" onclick="document.getElementById('conf_ollama_ctx').value='2048'; window.ConfigView.save()">2K</button>
                                <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;" onclick="document.getElementById('conf_ollama_ctx').value='4096'; window.ConfigView.save()">4K</button>
                                <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;" onclick="document.getElementById('conf_ollama_ctx').value='8192'; window.ConfigView.save()">8K</button>
                                <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;" onclick="document.getElementById('conf_ollama_ctx').value='16384'; window.ConfigView.save()">16K</button>
                                <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;" onclick="document.getElementById('conf_ollama_ctx').value='32768'; window.ConfigView.save()">32K</button>
                            </div>
                        </div>
                        <p style="font-size: 10px; color: var(--text-muted); margin-top: 5px;" data-i18n="config_ai_ctx_hint">${window.i18n.t('config_ai_ctx_hint')}</p>
                    </div>
                </div>

                <div style="margin-top: 10px; padding: 10px; border-radius: 8px; background: rgba(51, 102, 255, 0.05); border: 1px dashed var(--accent);">
                    <h5 style="margin: 0 0 5px 0; font-size: 11px; font-weight: bold; color: var(--accent);" data-i18n="config_ai_optimal_hint">${window.i18n.t('config_ai_optimal_hint')}</h5>
                    <ul style="margin: 0; padding-left: 15px; font-size: 10px; color: var(--text-muted); line-height: 1.4;">
                        <li data-i18n="config_ai_temp_hint_detail">${window.i18n.t('config_ai_temp_hint_detail')}</li>
                        <li style="margin-top: 4px;" data-i18n="config_ai_ctx_hint_detail">${window.i18n.t('config_ai_ctx_hint_detail')}</li>
                    </ul>
                </div>

                <hr style="border:none; border-top:1px solid var(--border-color); margin:18px 0;">

                <div style="margin-top: 15px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
                        <h4 style="margin:0; font-size: 13px;" data-i18n="settings_ai_reports_title">Bilans Périodiques Proactifs</h4>
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                            <div style="position: relative; width: 40px; height: 24px;">
                                <input type="checkbox" id="conf_ai_reports_enabled" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.toggleAIReports(this.checked); window.ConfigView.save()">
                                <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                                <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                            </div>
                            <span data-i18n="settings_ai_reports_enable">Activer les bilans de santé financière par l'IA</span>
                        </label>
                    </div>
                    <p style="color: var(--text-muted); font-size: 11px; margin-bottom: 12px;" data-i18n="settings_ai_reports_enable_desc">Génère périodiquement une courte notification analytique résumant votre état de santé financière.</p>
                    
                    <div id="aiReportsSubSettings" style="display: none;">
                        <div class="flex-row-mobile-col" style="display: flex; gap: 15px; align-items: flex-end; flex-wrap: wrap;">
                            <div style="flex: 1; min-width: 180px;">
                                <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="settings_ai_reports_freq">Fréquence des rapports</label>
                                <select id="conf_ai_reports_frequency" class="inline-input" style="border: 1px solid var(--border-color); padding: 8px; margin-top: 5px; width: 100%;" onchange="window.ConfigView.save()">
                                    <option value="daily" data-i18n="settings_ai_reports_freq_daily">Quotidien</option>
                                    <option value="weekly" data-i18n="settings_ai_reports_freq_weekly">Hebdomadaire (Recommandé)</option>
                                    <option value="monthly" data-i18n="settings_ai_reports_freq_monthly">Mensuel</option>
                                </select>
                            </div>
                            <div>
                                <button class="btn btn-secondary" id="btnTriggerAIReport" onclick="window.ConfigView.triggerAIReportGeneration()" style="display: flex; align-items: center; gap: 5px; white-space: nowrap;">
                                    ⚡ <span data-i18n="settings_ai_btn_generate_report">Générer un bilan maintenant</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                </div> <!-- End ollamaSettings -->
            </div>

            <div class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <h3 style="display:flex; align-items:center; gap:8px;" data-i18n="config_opt_title">${window.i18n.t('config_opt_title')}</h3>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;">
                    ${window.i18n.t('config_opt_desc')}
                </p>
                <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                        <div style="position: relative; width: 40px; height: 24px;">
                            <input type="checkbox" id="conf_enable_bimonthly" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.save()">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_opt_bimonthly">Activer la récurrence bi-mensuelle</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                        <div style="position: relative; width: 40px; height: 24px;">
                            <input type="checkbox" id="conf_enable_attachments" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.save()">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_opt_attachments">Activer les documents joints (Upload de fichiers)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                        <div style="position: relative; width: 40px; height: 24px;">
                            <input type="checkbox" id="conf_enable_check_slips" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.save()">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_opt_check_slips">Activer la saisie des numéros de bordereaux de chèques</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                        <div style="position: relative; width: 40px; height: 24px;">
                            <input type="checkbox" id="conf_enable_org_mode" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView._onOrgModeToggle()">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_opt_org_mode">Activer le mode Organisation (Association/CSE)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                        <div style="position: relative; width: 40px; height: 24px;">
                            <input type="checkbox" id="conf_enable_overview" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.save()">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_opt_overview">Activer la vue d'ensemble (page d'accueil simplifiée)</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                        <div style="position: relative; width: 40px; height: 24px;">
                            <input type="checkbox" id="conf_enable_simulator" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.save()">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_opt_simulator">Activer le simulateur de projets & What-If</span>
                    </label>
                </div>
                <div id="configLicenseStatus" style="margin-top: 8px; display: none;"></div>
                <style>
                    .global-toggle:checked ~ .slider { background-color: var(--accent) !important; }
                    .global-toggle:checked ~ .slider-knob { transform: translateX(16px) !important; }
                </style>
            </div>

            <div class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <h3 style="display:flex; align-items:center; gap:8px;" data-i18n="config_gen_settings_title">⚙️ ${window.i18n.t('config_gen_settings_title')}</h3>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;" data-i18n="config_gen_settings_desc">
                    ${window.i18n.t('config_gen_settings_desc')}
                </p>
                <div style="display: flex; align-items: center; gap: 12px; font-size: 13px; font-weight: 500;">
                    <input type="number" id="conf_recurrence_months" class="inline-input" min="1" max="36" value="12" style="width: 70px; text-align: center; border-radius: 6px; padding: 6px; border: 1px solid var(--border-color); background: var(--bg-input); font-size: 13px;" onchange="window.ConfigView.save()">
                    <span data-i18n="config_recurrence_months">Nombre de mois de récurrences à générer à l'avance</span>
                </div>
            </div>

            <!-- Phase 9: User management panel (org mode only) -->
            <div id="configOrgUsersPanel" class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); display: none;">
                <h3 style="display:flex; align-items:center; gap:8px;" data-i18n="config_org_users">👥 ${window.i18n.t('config_org_users')}</h3>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;" data-i18n="config_org_users_desc">${window.i18n.t('config_org_users_desc')}</p>
                <div id="orgUsersList" style="margin-bottom: 12px;"></div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" id="newOrgUserName" class="inline-input" data-i18n-placeholder="ph_user_name" placeholder="${window.i18n.t('ph_user_name')}" style="flex: 1; padding: 8px 12px; font-size: 13px;">
                    <button class="btn btn-primary" style="padding: 8px 16px; font-size: 13px; white-space: nowrap;" onclick="window.ConfigView._addOrgUser()" data-i18n="btn_add_user">+ ${window.i18n.t('btn_add_user')}</button>
                </div>
            </div>
            <!-- Section Profils Maîtres -->
            <div class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 15px;">
                    <h3 style="display:flex; align-items:center; gap:8px; margin:0;" data-i18n="profiles_title">👤 Profils Maîtres</h3>
                    <button class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;" onclick="window.ConfigView._showCreateProfileModal()">
                        ➕ <span data-i18n="profiles_create">Créer un profil</span>
                    </button>
                </div>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;" data-i18n="profiles_subtitle">
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
                    💡 En cas de perte du code PIN, ouvrez le fichier <code>profiles.json</code> situé dans votre dossier de données et supprimez les champs <code>pin_hash</code> et <code>pin_salt</code> du profil concerné.
                </p>
            </div>

            <!-- Improvement 03: Shared mode (multi-session Windows) -->
            <div id="configSharedModePanel" class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <h3 style="display:flex; align-items:center; gap:8px;">🖥️ <span data-i18n="config_shared_mode">${window.i18n.t('config_shared_mode')}</span></h3>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;" data-i18n="config_shared_mode_desc">${window.i18n.t('config_shared_mode_desc')}</p>
                <div id="sharedModeStatus" style="margin-bottom: 12px;"></div>
                <div id="sharedModeActions" style="display: flex; gap: 10px; flex-wrap: wrap;"></div>
            </div>
            <div class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <h3 style="display:flex; align-items:center; gap:8px;" data-i18n="config_data_mgmt">Gestion des données</h3>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;">
                    ${window.i18n.t('config_data_desc')}
                </p>
                
                <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                    <!-- Export -->
                    <button class="btn btn-secondary" onclick="window.ConfigView.exportCSV()" style="display: flex; align-items: center; gap: 5px;">
                        📥 <span data-i18n="btn_export_csv">Exporter les données (CSV)</span>
                    </button>
                    
                    <!-- Import vers DB -->
                    <input type="file" id="rawDbCsvInput" accept=".csv" style="display: none;" onchange="window.ConfigView.importRawCSV(event)">
                    <button class="btn btn-primary" onclick="document.getElementById('rawDbCsvInput').click()" style="display: flex; align-items: center; gap: 5px;">
                        📤 <span data-i18n="btn_import_csv_db">Import CSV vers DB</span>
                    </button>
                    
                    <!-- Backup -->
                    <button class="btn btn-secondary" onclick="window.ConfigView.downloadBackup()" style="display: flex; align-items: center; gap: 5px;">
                        💾 <span data-i18n="btn_download_backup">Télécharger Sauvegarde Complète (ZIP)</span>
                    </button>

                    <!-- Restore Backup -->
                    <input type="file" id="restoreBackupInput" accept=".zip" style="display: none;" onchange="window.ConfigView.restoreBackup(event)">
                    <button class="btn btn-warning" onclick="document.getElementById('restoreBackupInput').click()" style="display: flex; align-items: center; gap: 5px; background-color: var(--color-expense-fixed, #ff5630); color: #fff;">
                        📂 <span data-i18n="btn_restore_backup">Restaurer Sauvegarde (ZIP)</span>
                    </button>

                    <!-- Backup Global All Profiles -->
                    <button class="btn btn-secondary" onclick="window.ConfigView.downloadAllProfilesBackup()" style="display: flex; align-items: center; gap: 5px;" title="${window.i18n ? window.i18n.t('profiles_backup_all_tooltip') : 'Sauvegarder tous les profils maîtres dans une seule archive'}">
                        📦 <span data-i18n="profiles_backup_all">Sauvegarder tous les profils (ZIP)</span>
                    </button>

                    <!-- Restore Global All Profiles -->
                    <input type="file" id="restoreAllProfilesBackupInput" accept=".zip" style="display: none;" onchange="window.ConfigView.restoreAllProfilesBackup(event)">
                    <button class="btn btn-secondary" onclick="document.getElementById('restoreAllProfilesBackupInput').click()" style="display: flex; align-items: center; gap: 5px;" title="${window.i18n ? window.i18n.t('profiles_restore_all_tooltip') : 'Restaurer tous les profils maîtres depuis une archive globale'}">
                        📂 <span data-i18n="profiles_restore_all">Restaurer tous les profils (ZIP)</span>
                    </button>
                </div>

                <hr style="border:none; border-top:1px solid var(--border-color); margin:18px 0;">

                <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                    <!-- Re-launch Wizard -->
                    <button class="btn btn-secondary" onclick="window.SetupWizard.show()" style="display: flex; align-items: center; gap: 5px;">
                        🧙 <span data-i18n="btn_relaunch_wizard">${window.i18n.t('btn_relaunch_wizard')}</span>
                    </button>

                    <!-- Fix type mismatch -->
                    <button class="btn btn-secondary" id="btnFixTypeMismatch" onclick="window.ConfigView.fixTypeMismatch()" style="display: flex; align-items: center; gap: 5px; border-color: rgba(245,158,11,0.5); color: #f59e0b;">
                        🔧 <span data-i18n="maintenance_fix_types">${window.i18n.t('maintenance_fix_types') || 'Fix inconsistent types'}</span>
                    </button>

                    <!-- Orphan recurrence cleanup -->
                    <button class="btn btn-secondary" id="btnCleanOrphanRecurrences" onclick="window.ConfigView.cleanOrphanRecurrences()" style="display: flex; align-items: center; gap: 5px; border-color: rgba(239,68,68,0.5); color: #ef4444;">
                        🧹 <span data-i18n="maintenance_orphan_btn">${window.i18n.t('maintenance_orphan_btn') || 'Clean up orphan recurrences'}</span>
                    </button>

                    <!-- Convert zeroed to skipped -->
                    <button class="btn btn-secondary" id="btnConvertZeroedToSkipped" onclick="window.ConfigView.convertZeroedToSkipped()" style="display: flex; align-items: center; gap: 5px; border-color: rgba(99,102,241,0.5); color: var(--accent, #6366f1);">
                        🔄 <span data-i18n="maintenance_convert_zeroed_btn">${window.i18n.t('maintenance_convert_zeroed_btn') || 'Convert 0€ transactions to Skipped'}</span>
                    </button>

                    <!-- Clear DB -->
                    <button class="btn btn-danger" onclick="window.ConfigView.clearDB()" style="display: flex; align-items: center; gap: 5px; margin-left: auto;">
                        ⚠️ <span data-i18n="btn_clear_db">Vider la base de données</span>
                    </button>
                </div>
            </div>

            <!-- Server Connection Settings Card -->
            <div class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h3 style="display:flex; align-items:center; gap:8px; margin:0 0 4px 0;" data-i18n="config_server_title">📡 ${window.i18n ? window.i18n.t('config_server_title') : 'Connexion Serveur (Docker / Client Distant)'}</h3>
                        <p style="color: var(--text-muted); font-size: 12px; margin: 0;" data-i18n="config_server_desc">${window.i18n ? window.i18n.t('config_server_desc') : "Configurez l'adresse IP et le port du serveur backend auto-hébergé pour les accès distants ou mobiles."}</p>
                    </div>
                    <button class="btn btn-primary" onclick="window.ServerConfig.openModal()" style="display:flex; align-items:center; gap:6px;">
                        <span>⚙️</span> <span data-i18n="config_server_btn">${window.i18n ? window.i18n.t('config_server_btn') : 'Configurer le serveur'}</span>
                    </button>
                </div>
            </div>

            <!-- Improvement 05: Auto Backup -->
            <div class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 15px;">
                    <h3 style="display:flex; align-items:center; gap:8px; margin:0;" data-i18n="config_auto_backup_title">${window.i18n.t('config_auto_backup_title')}</h3>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                        <div style="position: relative; width: 40px; height: 24px;">
                            <input type="checkbox" id="conf_auto_backup_enabled" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.toggleAutoBackup(this.checked); window.ConfigView.save()">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_auto_backup_enable">${window.i18n.t('config_auto_backup_enable')}</span>
                    </label>
                </div>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;" data-i18n="config_auto_backup_desc">${window.i18n.t('config_auto_backup_desc')}</p>

                <div id="autoBackupSettings">
                    <div class="flex-row-mobile-col" style="display: flex; gap: 15px; margin-bottom: 15px; align-items: flex-end; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 150px;">
                            <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_auto_backup_frequency">${window.i18n.t('config_auto_backup_frequency')}</label>
                            <select id="conf_auto_backup_frequency" class="inline-input" style="border: 1px solid var(--border-color); padding: 8px; margin-top: 5px; width: 100%;" onchange="window.ConfigView.save()">
                                <option value="daily" data-i18n="config_auto_backup_freq_daily">${window.i18n.t('config_auto_backup_freq_daily')}</option>
                                <option value="weekly" data-i18n="config_auto_backup_freq_weekly">${window.i18n.t('config_auto_backup_freq_weekly')}</option>
                                <option value="monthly" data-i18n="config_auto_backup_freq_monthly">${window.i18n.t('config_auto_backup_freq_monthly')}</option>
                            </select>
                        </div>
                        <div style="flex: 1; min-width: 150px;">
                            <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_auto_backup_max_count">${window.i18n.t('config_auto_backup_max_count')}</label>
                            <select id="conf_auto_backup_max_count" class="inline-input" style="border: 1px solid var(--border-color); padding: 8px; margin-top: 5px; width: 100%;" onchange="window.ConfigView.save()">
                                <option value="3">3</option>
                                <option value="5" selected>5</option>
                                <option value="10">10</option>
                                <option value="20">20</option>
                            </select>
                        </div>
                        <div>
                            <button class="btn btn-secondary" id="btnTriggerAutoBackup" onclick="window.ConfigView.triggerAutoBackup()" style="display: flex; align-items: center; gap: 5px; white-space: nowrap;">
                                ▶️ <span data-i18n="config_auto_backup_trigger">${window.i18n.t('config_auto_backup_trigger')}</span>
                            </button>
                        </div>
                    </div>
                    <div id="autoBackupStatusPanel"></div>
                </div>
            </div>

            <!-- Multi-Currency & Exchange Rates Settings -->
            <div class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <h3 style="display:flex; align-items:center; gap:8px; margin:0 0 15px 0;" data-i18n="config_currency_title">💱 Devises & Taux de Change</h3>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;" data-i18n="config_currency_desc">Configurez la devise principale de l'application et les taux de conversion hors-ligne pour la valeur nette globale.</p>
                
                <div class="flex-row-mobile-col" style="display: flex; gap: 20px; margin-bottom: 20px; align-items: flex-end;">
                    <div style="flex: 1;">
                        <label style="font-size: 11px; font-weight: bold; color: var(--text-muted); text-transform: uppercase;" data-i18n="config_base_currency_label">Devise Principale Globale</label>
                        <select id="conf_base_currency" class="inline-input" style="border: 1px solid var(--border-color); padding: 8px; margin-top: 5px; width: 100%;" onchange="window.ConfigView.saveBaseCurrency()">
                            <option value="EUR">EUR (€) - Euro</option>
                            <option value="USD">USD ($) - Dollar US</option>
                            <option value="GBP">GBP (£) - Livre Sterling</option>
                            <option value="CHF">CHF (CHF) - Franc Suisse</option>
                            <option value="CAD">CAD (CA$) - Dollar Canadien</option>
                            <option value="JPY">JPY (¥) - Yen Japonais</option>
                        </select>
                    </div>
                </div>

                <div style="display:flex; align-items:center; justify-content:space-between; margin: 15px 0 10px 0;">
                    <h4 style="margin:0; font-size: 13px;" data-i18n="config_exchange_rates_title">Grille des Taux de Change (Hors-Ligne)</h4>
                    <span id="rateCountBadge" class="badge" style="background:rgba(99,102,241,0.1); color:var(--primary); font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px;">0 devises</span>
                </div>
                
                <div style="display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; align-items: center;">
                    <input type="text" id="rate_from" class="inline-input" placeholder="${window.i18n ? window.i18n.t('config_rate_from_placeholder') : 'De (ex: USD)'}" style="border: 1px solid var(--border-color); padding: 5px 8px; width: 100px; text-transform: uppercase; font-size: 12px;">
                    <input type="text" id="rate_to" class="inline-input" placeholder="${window.i18n ? window.i18n.t('config_rate_to_placeholder') : 'Vers (ex: EUR)'}" style="border: 1px solid var(--border-color); padding: 5px 8px; width: 100px; text-transform: uppercase; font-size: 12px;">
                    <input type="number" id="rate_value" class="inline-input" placeholder="${window.i18n ? window.i18n.t('config_rate_val_placeholder') : 'Taux (ex: 0.92)'}" step="0.0001" style="border: 1px solid var(--border-color); padding: 5px 8px; width: 120px; font-size: 12px;">
                    <button class="btn btn-secondary" onclick="window.ConfigView.addExchangeRate()" style="font-size:12px; padding:5px 10px;" data-i18n="config_btn_add_rate">➕ Ajouter</button>
                    <button class="btn btn-secondary" id="btnFetchOnlineRates" onclick="window.ConfigView.fetchOnlineRates()" style="margin-left: auto; font-size:12px; padding:5px 10px;" data-i18n="config_btn_fetch_online">🌐 Actualiser en ligne</button>
                </div>

                <div style="margin-bottom: 8px;">
                    <input type="text" id="rateSearchInput" class="inline-input" placeholder="${window.i18n ? window.i18n.t('config_rate_search_placeholder') : '🔍 Rechercher une devise (USD, GBP, CHF...)'}" style="width:100%; font-size:11px; padding:5px 10px; border:1px solid var(--border-color); border-radius:6px;" oninput="window.ConfigView.filterExchangeRates()">
                </div>

                <div style="max-height: 220px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-surface);">
                    <table class="data-table" style="width: 100%; margin: 0; font-size: 12px;">
                        <thead style="position: sticky; top: 0; background: var(--bg-surface); z-index: 2; border-bottom: 2px solid var(--border-color);">
                            <tr>
                                <th data-i18n="config_th_from">De</th>
                                <th data-i18n="config_th_to">Vers</th>
                                <th data-i18n="config_th_rate">Taux</th>
                                <th style="width: 60px; text-align: right;" data-i18n="acc_th_actions">Action</th>
                            </tr>
                        </thead>
                        <tbody id="exchangeRatesBody">
                            <!-- Rendered dynamically -->
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Theme & Appearance Management -->
            <div class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px;">
                    <h3 style="display:flex; align-items:center; gap:8px; margin:0;" data-i18n="theme_manager_title">🎨 ${window.i18n ? window.i18n.t('theme_manager_title') : 'Gestionnaire de Thèmes'}</h3>
                </div>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 16px;" data-i18n="theme_manager_desc">
                    ${window.i18n ? window.i18n.t('theme_manager_desc') : 'Personnalisez l\'apparence visuelle d\'OmniBank selon vos préférences.'}
                </p>

                <div class="theme-config-grid" id="themeConfigGrid">
                    ${(window.ThemeManager ? window.ThemeManager.getThemes() : []).map(t => {
                        const current = window.ThemeManager ? window.ThemeManager.currentThemeId : 'dark';
                        const isActive = t.id === current;
                        const name = window.i18n ? window.i18n.t(t.nameKey) : t.id;
                        const desc = window.i18n ? window.i18n.t(t.descKey) : '';
                        return `
                            <div class="theme-card ${isActive ? 'active' : ''}" onclick="window.ThemeManager.applyTheme('${t.id}'); window.ConfigView._refreshThemeCards();">
                                <div class="theme-card-header">
                                    <div class="theme-card-title">
                                        <span>${t.icon}</span>
                                        <span>${name}</span>
                                    </div>
                                    <div class="theme-swatch" style="background:${t.bg}; border-color:${t.accent};">
                                        <span class="theme-swatch-dot" style="background:${t.accent};"></span>
                                    </div>
                                </div>
                                <div class="theme-card-preview" style="background:${t.bg}; color:${t.type === 'dark' ? '#f3f4f6' : '#0f172a'};">
                                    <span style="font-size:11px; font-weight:700; color:${t.accent};">${t.type.toUpperCase()}</span>
                                    <span style="font-size:12px; font-weight:800; font-family:monospace;">8 592,36 €</span>
                                </div>
                                <p class="theme-card-desc">${desc}</p>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <!-- Smart Label Matching Rules -->
            ${window.ConfigSmartLabels ? window.ConfigSmartLabels.render() : ''}

            <!-- Diagnostics & Bug Reporting -->
            ${window.ConfigDiagnostics ? window.ConfigDiagnostics.render() : ''}
        `;
    },

    _refreshThemeCards() {
        const grid = document.getElementById('themeConfigGrid');
        if (!grid || !window.ThemeManager) return;
        const current = window.ThemeManager.currentThemeId;
        grid.querySelectorAll('.theme-card').forEach(card => {
            const isMatch = card.getAttribute('onclick')?.includes(`'${current}'`);
            card.classList.toggle('active', !!isMatch);
        });
    },

    async init() {
        await this.loadData();
        if (window.ConfigSmartLabels && typeof window.ConfigSmartLabels.init === 'function') {
            await window.ConfigSmartLabels.init();
        }
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
                document.getElementById('conf_ollama_ctx').value = this.configData.ollama_context;
            }
            
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
            if (this.configData.enable_overview === 'true') document.getElementById('conf_enable_overview').checked = true;
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
                enable_overview: document.getElementById('conf_enable_overview').checked ? 'true' : 'false',
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
                if (window.app.refreshSidebar) window.app.refreshSidebar();
                if (window.TimelineView && window.app.currentView === 'dashboard') {
                    // Update filters visibility without full refresh if possible, or just render
                    const main = document.getElementById('mainContent');
                    if (main) main.innerHTML = window.TimelineView.render();
                    window.TimelineView.init();
                }
                // Update nav button visibility for toggled features
                document.querySelectorAll('.nav-btn[data-view="chat"]').forEach(btn => {
                    btn.style.display = data.enable_ai === 'true' ? '' : 'none';
                });
                document.querySelectorAll('.nav-btn[data-view="overview"]').forEach(btn => {
                    btn.style.display = data.enable_overview === 'true' ? '' : 'none';
                });
                document.querySelectorAll('.nav-btn[data-view="simulator"]').forEach(btn => {
                    btn.style.display = data.enable_simulator === 'true' ? '' : 'none';
                });
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
                if (!sessionStorage.getItem('omni_current_user')) {
                    try {
                        const defaultUser = await API.post('/api/org_users/ensure_default');
                        if (defaultUser && defaultUser.name) {
                            sessionStorage.setItem('omni_current_user', defaultUser.name);
                            if (window.app) window.app.currentUser = defaultUser.name;
                        }
                    } catch(e) {}
                }
                // Update header label
                const label = document.getElementById('currentUserLabel');
                const userName = sessionStorage.getItem('omni_current_user');
                if (label && userName) label.textContent = userName;
            } else {
                sessionStorage.removeItem('omni_current_user');
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
