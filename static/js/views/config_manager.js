window.ConfigView = {
    configData: {},
    models: [],

    render() {
        return `
            <div class="view-header" style="display:flex; justify-content:space-between; margin-bottom:15px;">
                <h2>⚙️ <span data-i18n="nav_configuration">Configuration</span></h2>
            </div>
            
            <div style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 15px;">
                    <h3 style="display:flex; align-items:center; gap:8px; margin:0;" data-i18n="config_ai_title">🤖 Configuration Ollama (Assistant IA)</h3>
                    <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; font-weight: 500;">
                        <div style="position: relative; width: 40px; height: 24px;">
                            <input type="checkbox" id="conf_enable_ai" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.toggleAI(this.checked); window.ConfigView.save();">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_ai_enable">Activer l'IA</span>
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
                                <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;" onclick="document.getElementById('conf_ollama_ctx').value='32768'; window.ConfigView.save()">32K</button>
                            </div>
                        </div>
                        <p style="font-size: 10px; color: var(--text-muted); margin-top: 5px;" data-i18n="config_ai_ctx_hint">${window.i18n.t('config_ai_ctx_hint')}</p>
                    </div>
                </div>

                </div> <!-- End ollamaSettings -->
            </div>

            <div style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
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
                    <div id="configLicenseStatus" style="margin-top: 8px; display: none;"></div>
                </div>
                <style>
                    .global-toggle:checked ~ .slider { background-color: var(--accent) !important; }
                    .global-toggle:checked ~ .slider-knob { transform: translateX(16px) !important; }
                </style>
            </div>

            <!-- Phase 9: User management panel (org mode only) -->
            <div id="configOrgUsersPanel" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm); display: none;">
                <h3 style="display:flex; align-items:center; gap:8px;" data-i18n="config_org_users">👥 ${window.i18n.t('config_org_users')}</h3>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;" data-i18n="config_org_users_desc">${window.i18n.t('config_org_users_desc')}</p>
                <div id="orgUsersList" style="margin-bottom: 12px;"></div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <input type="text" id="newOrgUserName" class="inline-input" data-i18n-placeholder="ph_user_name" placeholder="${window.i18n.t('ph_user_name')}" style="flex: 1; padding: 8px 12px; font-size: 13px;">
                    <button class="btn btn-primary" style="padding: 8px 16px; font-size: 13px; white-space: nowrap;" onclick="window.ConfigView._addOrgUser()" data-i18n="btn_add_user">+ ${window.i18n.t('btn_add_user')}</button>
                </div>
            </div>
            <!-- Improvement 03: Shared mode (multi-session Windows) -->
            <div id="configSharedModePanel" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <h3 style="display:flex; align-items:center; gap:8px;">🖥️ <span data-i18n="config_shared_mode">${window.i18n.t('config_shared_mode')}</span></h3>
                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px;" data-i18n="config_shared_mode_desc">${window.i18n.t('config_shared_mode_desc')}</p>
                <div id="sharedModeStatus" style="margin-bottom: 12px;"></div>
                <div id="sharedModeActions" style="display: flex; gap: 10px; flex-wrap: wrap;"></div>
            </div>
            <div style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
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
                </div>

                <hr style="border:none; border-top:1px solid var(--border-color); margin:18px 0;">

                <div style="display: flex; gap: 15px; align-items: center; flex-wrap: wrap;">
                    <!-- Re-launch Wizard -->
                    <button class="btn btn-secondary" onclick="window.SetupWizard.show()" style="display: flex; align-items: center; gap: 5px;">
                        🧙 <span data-i18n="btn_relaunch_wizard">${window.i18n.t('btn_relaunch_wizard')}</span>
                    </button>

                    <!-- Fix type mismatch -->
                    <button class="btn btn-secondary" id="btnFixTypeMismatch" onclick="window.ConfigView.fixTypeMismatch()" style="display: flex; align-items: center; gap: 5px; border-color: rgba(245,158,11,0.5); color: #f59e0b;">
                        🔧 <span data-i18n="maintenance_fix_types">${window.i18n.t('maintenance_fix_types') || 'Corriger les types incohérents'}</span>
                    </button>

                    <!-- Orphan recurrence cleanup -->
                    <button class="btn btn-secondary" id="btnCleanOrphanRecurrences" onclick="window.ConfigView.cleanOrphanRecurrences()" style="display: flex; align-items: center; gap: 5px; border-color: rgba(239,68,68,0.5); color: #ef4444;">
                        🧹 <span data-i18n="maintenance_orphan_btn">${window.i18n.t('maintenance_orphan_btn') || 'Nettoyer les récurrences orphelines'}</span>
                    </button>

                    <!-- Clear DB -->
                    <button class="btn btn-danger" onclick="window.ConfigView.clearDB()" style="display: flex; align-items: center; gap: 5px; margin-left: auto;">
                        ⚠️ <span data-i18n="btn_clear_db">Vider la base de données</span>
                    </button>
                </div>
            </div>

            <!-- Improvement 05: Auto Backup -->
            <div style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
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
        `;
    },

    async init() {
        await this.loadData();
    },

    async loadData() {
        try {
            this.configData = await API.get('/api/config/');
            
            if (this.configData.ollama_url) {
                document.getElementById('conf_ollama_url').value = this.configData.ollama_url;
                // If URL is present, try to fetch models immediately
                await this.fetchModels(true);
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
            
            // Phase 9: Show org users panel if enabled
            this._refreshOrgUsersPanel();
            // Phase 10: Show license status badge
            this._refreshLicenseStatus();
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
        } catch (e) {
            console.error("Failed to load config", e);
        }
    },

    toggleAI(enabled) {
        // Toggle settings visibility
        const settings = document.getElementById('ollamaSettings');
        if (settings) {
            settings.style.display = enabled ? 'block' : 'none';
        }
        
        // Toggle Chat Nav Button instantly
        document.querySelectorAll('.nav-btn[data-view="chat"]').forEach(btn => {
            btn.style.display = enabled ? '' : 'none';
        });
        
        // Ensure app.config is synced so other views know
        if (window.app && window.app.config) {
            window.app.config.enable_ai = enabled ? 'true' : 'false';
        }
    },

    toggleAutoBackup(enabled) {
        const settings = document.getElementById('autoBackupSettings');
        if (settings) {
            settings.style.display = enabled ? 'block' : 'none';
        }
    },

    async fetchModels(silent = false) {
        const url = document.getElementById('conf_ollama_url').value;
        if (!url) {
            if (!silent) showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_ollama_url_invalid'));
            return;
        }

        // Save URL temporarily to allow backend to proxy
        await API.post('/api/config/', { ollama_url: url });

        try {
            const data = await API.get('/api/config/ollama/models');
            if (data.models && data.models.length > 0) {
                this.models = data.models;
                const select = document.getElementById('conf_ollama_model');
                
                select.innerHTML = this.models.map(m => `<option value="${m.name}">${m.name} (${(m.size / 1024 / 1024 / 1024).toFixed(1)} GB)</option>`).join('');
                
                // Select previously saved model if exists
                if (this.configData.ollama_model) {
                    select.value = this.configData.ollama_model;
                }
                if (!silent) showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_ollama_models_ok'));
            } else {
                if (!silent) showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_ollama_no_models'));
            }
        } catch (e) {
            console.error(e);
            if (!silent) showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_ollama_connect_error'));
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
                auto_backup_enabled: document.getElementById('conf_auto_backup_enabled').checked ? 'true' : 'false',
                auto_backup_frequency: document.getElementById('conf_auto_backup_frequency').value,
                auto_backup_max_count: document.getElementById('conf_auto_backup_max_count').value
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
            }
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error'));
        }
    },

    async exportCSV() {
        const columns = [
            "Date de saisie", "Date opération", "Description", "Montant", "Type", "Catégorie", 
            "Date de rapprochement", "Répétition mensuelle", "Répétition annuelle", 
            "Répétition bi-mensuelle", "Jour de récurrence 1", "Jour de récurrence 2",
            "Documents joints", "Bordereau de chèque", "Depuis", "Vers", "ID"
        ];
        
        const container = document.getElementById('exportColumnsContainer');
        if (container) {
            container.innerHTML = columns.map(col => `
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="checkbox" class="export-col-cb" value="${col}" checked>
                    ${col}
                </label>
            `).join('');
            document.getElementById('exportConfigModal').style.display = 'flex';
        } else {
            this._downloadCSV('/api/csv/export');
        }
    },
    
    confirmExportCSV() {
        const checkboxes = document.querySelectorAll('.export-col-cb:checked');
        const selectedCols = Array.from(checkboxes).map(cb => cb.value).join(',');
        
        if (!selectedCols) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_select_columns'));
            return;
        }
        
        document.getElementById('exportConfigModal').style.display = 'none';
        this._downloadCSV('/api/csv/export?cols=' + encodeURIComponent(selectedCols));
    },

    async _downloadCSV(endpoint) {
        const downloadUrl = `${window.location.origin}${endpoint}`;

        // In Tauri WebView, blob downloads don't work — open in system browser
        if (window.__TAURI_INTERNALS__) {
            showToast(window.i18n.t('msg_backup_browser') || 'Le téléchargement s\'ouvre dans votre navigateur...', 'info', 4000);
            try {
                await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: downloadUrl });
            } catch (e) {
                console.error(e);
            }
            return;
        }

        // Fallback for regular browser (dev mode)
        window.open(endpoint, '_blank');
    },

    async importRawCSV(event) {
        const file = event.target.files[0];
        if (!file) return;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/csv/import', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Upload failed");
            }
            
            const data = await res.json();
            
            if (data.attachments_needed && data.attachments_needed.length > 0) {
                // Create a manual trigger modal to bypass browser async popup blockers
                const overlay = document.createElement('div');
                overlay.style.position = 'fixed';
                overlay.style.top = '0'; overlay.style.left = '0'; overlay.style.width = '100vw'; overlay.style.height = '100vh';
                overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
                overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
                overlay.style.zIndex = '9999';
                
                const modal = document.createElement('div');
                modal.style.background = 'var(--bg-surface)';
                modal.style.padding = '20px';
                modal.style.borderRadius = '8px';
                modal.style.maxWidth = '500px';
                modal.style.textAlign = 'center';
                modal.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
                
                const title = document.createElement('h3');
                title.textContent = window.i18n.t('title_missing_attachments');
                title.style.marginTop = '0';
                
                const text = document.createElement('p');
                text.textContent = window.i18n.tp('msg_attachments_needed', {count: data.attachments_needed.length});
                
                const btnContainer = document.createElement('div');
                btnContainer.style.marginTop = '20px';
                btnContainer.style.display = 'flex';
                btnContainer.style.justifyContent = 'center';
                btnContainer.style.gap = '10px';
                
                const btnCancel = document.createElement('button');
                btnCancel.className = 'btn btn-secondary';
                btnCancel.textContent = window.i18n.t('btn_ignore');
                btnCancel.onclick = () => {
                    document.body.removeChild(overlay);
                    showInlineMessage(window.i18n.t('title_success'), window.i18n.tp('msg_import_success_no_attach', {count: data.imported}));
                    setTimeout(() => window.location.reload(), 2000);
                };
                
                const label = document.createElement('label');
                label.className = 'btn btn-primary';
                label.style.cursor = 'pointer';
                label.textContent = window.i18n.t('btn_select_folder');
                
                const input = document.createElement('input');
                input.type = 'file';
                input.webkitdirectory = true;
                input.style.display = 'none';
                
                label.appendChild(input);
                btnContainer.appendChild(btnCancel);
                btnContainer.appendChild(label);
                
                modal.appendChild(title);
                modal.appendChild(text);
                modal.appendChild(btnContainer);
                overlay.appendChild(modal);
                document.body.appendChild(overlay);

                input.onchange = async (e) => {
                    label.textContent = window.i18n.t('label_loading');
                    label.style.pointerEvents = "none";
                    btnCancel.disabled = true;
                    
                    if (!e.target.files.length) {
                        document.body.removeChild(overlay);
                        showInlineMessage(window.i18n.t('title_success'), window.i18n.tp('msg_import_success_no_attach', {count: data.imported}));
                        setTimeout(() => window.location.reload(), 2000);
                        return;
                    }
                    
                    const files = Array.from(e.target.files);
                    const formDataUpload = new FormData();
                    const paths = [];
                    
                    for (const att of data.attachments_needed) {
                        const expectedName = att.replace(/\\/g, '/').split('/').pop();
                        const matchedFile = files.find(f => f.name === expectedName || f.webkitRelativePath.endsWith(expectedName));
                        if (matchedFile) {
                            formDataUpload.append("files", matchedFile);
                            paths.push(att);
                        }
                    }
                    
                    if (paths.length > 0) {
                        formDataUpload.append("relative_paths", JSON.stringify(paths));
                        try {
                            const upRes = await fetch('/api/csv/upload_attachments', {
                                method: 'POST',
                                body: formDataUpload
                            });
                            const upData = await upRes.json();
                            if (upData.saved) {
                                await fetch('/api/csv/update_imported_attachments', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ mapping: upData.saved })
                                });
                            }
                        } catch(err) {
                            console.error("Erreur upload attachments", err);
                        }
                    }
                    
                    document.body.removeChild(overlay);
                    showInlineMessage(window.i18n.t('title_success'), window.i18n.tp('msg_import_success_with_attach', {count: data.imported}));
                    setTimeout(() => window.location.reload(), 2000);
                };
            } else {
                showInlineMessage(window.i18n.t('title_success'), window.i18n.tp('msg_import_success_skipped', {count: data.imported, skipped: data.skipped}));
                setTimeout(() => window.location.reload(), 2000);
            }
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_import_failed', {error: e.message}));
        } finally {
            event.target.value = '';
        }
    },

    async clearDB() {
        const i18nMsg = (window.i18n && window.i18n.t) ? window.i18n.t('alert_clear_db') : window.i18n.t('alert_clear_db');
        if (await showInlineConfirm(window.i18n.t('title_confirmation'), i18nMsg)) {
            try {
                await API.del('/api/transactions/all/clear');
                showToast(window.i18n.t('msg_db_cleared'), 'success');
                // Trigger setup wizard instead of full reload
                if (window.SetupWizard) {
                    window.SetupWizard.show();
                } else {
                    window.location.reload();
                }
            } catch (e) {
                console.error(e);
                showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_db_clear_error'));
            }
        }
    },

    async restoreBackup(event) {
        const file = event.target.files[0];
        if (!file) return;

        const confirmMsg = (window.i18n && window.i18n.t) ? window.i18n.t('alert_restore_backup') : window.i18n.t('alert_restore_backup');
        if (!await showInlineConfirm(window.i18n.t('title_restore_critical'), confirmMsg)) {
            event.target.value = '';
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await fetch('/api/backup/upload', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || "Upload failed");
            }

            showInlineMessage(window.i18n.t('title_success'), window.i18n.t('msg_restore_success'));
            setTimeout(() => window.location.reload(), 1500);
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_restore_failed', {error: e.message}));
        } finally {
            event.target.value = '';
        }
    },

    async downloadBackup() {
        try {
            const downloadUrl = `${window.location.origin}/api/backup/download`;

            // In Tauri WebView, blob downloads don't work — open in system browser
            if (window.__TAURI_INTERNALS__) {
                showToast(window.i18n.t('msg_backup_browser') || 'Le téléchargement s\'ouvre dans votre navigateur...', 'info', 4000);
                await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: downloadUrl });
                return;
            }

            // Fallback for regular browser (dev mode)
            showToast(window.i18n.t('label_loading') || 'Préparation...', 'info', 5000);
            const resp = await fetch('/api/backup/download');
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            const blob = await resp.blob();
            const filename = resp.headers.get('content-disposition')?.match(/filename="?([^"]+)"?/)?.[1]
                || `omnibank_backup_${new Date().toISOString().slice(0,10)}.zip`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error(e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_error_generic', {error: e.message || e}));
        }
    },

    async fixTypeMismatch() {
        const btn = document.getElementById('btnFixTypeMismatch');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyse...'; }
        try {
            const preview = await API.get('/api/maintenance/fix_type_mismatch/preview');
            if (btn) { btn.disabled = false; btn.innerHTML = '🔧 ' + (window.i18n.t('maintenance_fix_types') || 'Corriger les types incohérents'); }

            if (preview.count === 0) {
                showInlineMessage('✅', window.i18n.t('maintenance_no_fix_needed') || 'Aucune incohérence détectée. Tout est en ordre !');
                return;
            }

            // Build a clear, user-friendly preview
            const sharedCats = preview.affected_categories.filter(c => c.shared);
            const nonSharedCats = preview.affected_categories.filter(c => !c.shared);

            // Summary section
            let summaryHtml = `
                <div style="background:var(--bg-surface);border-radius:10px;padding:14px;margin-bottom:14px;border:1px solid var(--border-color);">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                        <span style="font-size:20px;">🔍</span>
                        <strong style="font-size:14px;">${window.i18n.t('maintenance_summary') || "Résumé de l'analyse"}</strong>
                    </div>
                    <p style="margin:0;font-size:13px;color:var(--text-muted);line-height:1.5;">
                        <strong style="color:var(--text-main);">${preview.count}</strong>
                        ${window.i18n.t('maintenance_summary_desc') || "opération(s) récurrentes sont classées comme « Dépense variable » alors qu'elles devraient être en « Charge fixe ». Cette correction mettra à jour leur type automatiquement."}
                    </p>
                </div>`;

            // Sample transactions table
            let sampleHtml = '';
            if (preview.sample && preview.sample.length > 0) {
                const rows = preview.sample.slice(0, 5).map(tx => `
                    <tr>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;">${tx.date_operation || '-'}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;">${tx.description || '-'}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;">${tx.category || '-'}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;text-align:right;">${formatCurrency(tx.amount)}</td>
                        <td style="padding:6px 8px;border-bottom:1px solid var(--border-color);font-size:12px;color:var(--color-expense);">variable → <span style="color:#10b981;">fixe</span></td>
                    </tr>
                `).join('');

                sampleHtml = `
                <div style="margin-bottom:14px;">
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;font-weight:600;text-transform:uppercase;">
                        ${window.i18n.t('maintenance_sample') || "Exemples d'opérations concernées"}
                        ${preview.count > 5 ? '<span style="font-weight:400;text-transform:none;"> (5 sur ' + preview.count + ')</span>' : ''}
                    </div>
                    <div style="overflow-x:auto;border-radius:8px;border:1px solid var(--border-color);">
                        <table style="width:100%;border-collapse:collapse;">
                            <thead><tr style="background:var(--bg-surface);">
                                <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);">${window.i18n.t('col_date_op') || 'Date'}</th>
                                <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);">${window.i18n.t('col_description') || 'Description'}</th>
                                <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);">${window.i18n.t('col_category') || 'Catégorie'}</th>
                                <th style="padding:6px 8px;text-align:right;font-size:11px;color:var(--text-muted);">${window.i18n.t('col_amount') || 'Montant'}</th>
                                <th style="padding:6px 8px;text-align:left;font-size:11px;color:var(--text-muted);">${window.i18n.t('maintenance_correction') || 'Correction'}</th>
                            </tr></thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>`;
            }

            // Category choices (shared categories need user decision)
            let catChoicesHtml = '';
            if (sharedCats.length > 0) {
                catChoicesHtml = `
                <div style="padding:12px;background:rgba(245,158,11,0.06);border-radius:10px;border:1px solid rgba(245,158,11,0.25);margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                        <span style="font-size:16px;">⚠️</span>
                        <strong style="font-size:13px;color:#f59e0b;">${window.i18n.t('maintenance_cat_choice') || 'Catégories partagées'}</strong>
                    </div>
                    <p style="font-size:12px;color:var(--text-muted);margin:0 0 10px;line-height:1.4;">
                        ${window.i18n.t('maintenance_cat_choice_desc') || "Ces catégories sont utilisées par des opérations récurrentes ET des dépenses variables ponctuelles. Choisissez l'action pour chaque :"}
                    </p>
                    ${sharedCats.map(c => `
                        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:4px;background:var(--bg-surface);border-radius:8px;">
                            <span style="flex:1;font-weight:600;font-size:13px;">${c.name}</span>
                            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);">
                                <input type="radio" name="cat_${c.name}" value="move" checked> ${window.i18n.t('maintenance_cat_move') || 'Déplacer vers Charges fixes'}
                            </label>
                            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.3);">
                                <input type="radio" name="cat_${c.name}" value="keep"> ${window.i18n.t('maintenance_cat_keep') || 'Conserver en Variables'}
                            </label>
                        </div>`).join('')}
                </div>`;
            }

            // Auto-moved categories (informational)
            let autoMovedHtml = '';
            if (nonSharedCats.length > 0) {
                autoMovedHtml = `
                <div style="padding:10px;background:rgba(16,185,129,0.06);border-radius:8px;border:1px solid rgba(16,185,129,0.25);">
                    <div style="font-size:12px;color:#10b981;margin-bottom:4px;font-weight:600;">✅ ${window.i18n.t('maintenance_auto_move') || 'Catégories déplacées automatiquement'}</div>
                    <p style="font-size:11px;color:var(--text-muted);margin:0;">
                        ${nonSharedCats.map(c => '<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;margin-right:4px;font-weight:500;">' + c.name + '</span>').join('')}
                    </p>
                </div>`;
            }

            const msgHtml = '<div style="max-height:60vh;overflow-y:auto;">' + summaryHtml + sampleHtml + catChoicesHtml + autoMovedHtml + '</div>';

            const ok = await showInlineConfirm(
                window.i18n.t('maintenance_fix_preview') || 'Aper\u00e7u de la correction',
                msgHtml
            );
            if (!ok) return;

            // Gather cat_moves decisions
            const toMove = sharedCats
                .filter(c => {
                    const radio = document.querySelector(`input[name="cat_${c.name}"][value="move"]`);
                    return radio && radio.checked;
                })
                .map(c => c.name);
            const allMoves = [...nonSharedCats.map(c => c.name), ...toMove];

            const result = await API.post(`/api/maintenance/fix_type_mismatch/apply?cat_moves=${encodeURIComponent(allMoves.join(','))}`);
            showToast(
                (window.i18n.t('maintenance_fix_result') || 'Migration terminée : {tx} opérations, {cat} catégories corrigées.')
                    .replace('{tx}', result.tx_fixed)
                    .replace('{cat}', result.cat_fixed),
                'success', 4000
            );
        } catch(e) {
            console.error(e);
            if (btn) { btn.disabled = false; }
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async cleanOrphanRecurrences() {
        const btn = document.getElementById('btnCleanOrphanRecurrences');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Analyse...'; }
        try {
            const preview = await API.get('/api/maintenance/orphan_recurrences/preview');
            if (btn) { btn.disabled = false; btn.innerHTML = '🧹 ' + (window.i18n.t('maintenance_orphan_btn') || 'Nettoyer les récurrences orphelines'); }

            if (preview.count === 0) {
                showInlineMessage('✅', window.i18n.t('maintenance_orphan_none') || 'Aucune récurrence orpheline détectée. Tout est en ordre !');
                return;
            }

            // Build per-transaction review modal with checkboxes
            let contentHtml = `
                <div style="max-height:60vh;overflow-y:auto;">
                    <div style="background:var(--bg-surface);border-radius:10px;padding:14px;margin-bottom:14px;border:1px solid var(--border-color);">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                            <span style="font-size:20px;">🔍</span>
                            <strong style="font-size:14px;">${window.i18n.t('maintenance_orphan_summary') || "Résumé de l'analyse"}</strong>
                        </div>
                        <p style="margin:0;font-size:13px;color:var(--text-muted);line-height:1.5;">
                            <strong style="color:var(--text-main);">${preview.count}</strong>
                            ${window.i18n.t('maintenance_orphan_summary_desc') || "opération(s) générées automatiquement pour des récurrences qui n'ont aucune transaction rapprochée la même année. Ces opérations ont probablement été créées par erreur."}
                        </p>
                    </div>

                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <span style="font-size:12px;font-weight:600;color:var(--text-muted);text-transform:uppercase;">
                            ${window.i18n.t('maintenance_orphan_select_label') || 'Sélectionnez les opérations à supprimer'}
                        </span>
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;font-weight:600;color:var(--primary-color);">
                            <input type="checkbox" id="orphanSelectAll" checked onchange="document.querySelectorAll('.orphan-tx-cb').forEach(cb => { cb.checked = this.checked; })">
                            ${window.i18n.t('wizard_tooltip_select_all') || 'Tout sélectionner'}
                        </label>
                    </div>`;

            preview.groups.forEach(group => {
                const closedBadge = group.is_closed
                    ? `<span style="background:rgba(239,68,68,0.15);color:#ef4444;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;margin-left:8px;">${window.i18n.t('badge_closed') || 'Fermé'}</span>`
                    : '';

                contentHtml += `
                    <div style="margin-bottom:12px;border:1px solid var(--border-color);border-radius:10px;overflow:hidden;">
                        <div style="padding:10px 14px;background:var(--bg-surface);border-bottom:1px solid var(--border-color);display:flex;align-items:center;gap:8px;">
                            <span style="font-size:14px;">🔄</span>
                            <strong style="font-size:13px;">${group.template_description}</strong>
                            ${closedBadge}
                            <span style="margin-left:auto;font-size:11px;color:var(--text-muted);">${group.transactions.length} op.</span>
                        </div>
                        <div style="padding:0;">`;

                group.transactions.forEach(tx => {
                    const dateStr = tx.date_operation.split('T')[0];
                    contentHtml += `
                            <label style="display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--border-color);cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='rgba(239,68,68,0.04)'" onmouseout="this.style.background=''">
                                <input type="checkbox" class="orphan-tx-cb" value="${tx.id}" checked style="width:16px;height:16px;flex-shrink:0;">
                                <span style="flex:1;font-size:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                                    <span style="color:var(--text-muted);min-width:85px;">${dateStr}</span>
                                    <span style="font-weight:500;flex:1;min-width:120px;">${tx.description}</span>
                                    <span style="color:var(--text-muted);font-size:11px;">${tx.category || ''}</span>
                                    <span style="font-weight:700;min-width:80px;text-align:right;">${formatCurrency(tx.amount)}</span>
                                </span>
                            </label>`;
                });

                contentHtml += `
                        </div>
                    </div>`;
            });

            contentHtml += `
                    <div style="padding:10px;background:rgba(239,68,68,0.06);border-radius:8px;border:1px solid rgba(239,68,68,0.2);margin-top:8px;">
                        <p style="font-size:12px;color:#ef4444;margin:0;font-weight:500;">
                            ⚠️ ${window.i18n.t('maintenance_orphan_warning') || 'Les opérations cochées seront définitivement supprimées. Les opérations rapprochées ne peuvent jamais être supprimées.'}
                        </p>
                    </div>
                </div>`;

            const ok = await showInlineConfirm(
                window.i18n.t('maintenance_orphan_preview_title') || 'Nettoyage des récurrences orphelines',
                contentHtml
            );
            if (!ok) return;

            // Gather selected IDs
            const selectedIds = Array.from(document.querySelectorAll('.orphan-tx-cb:checked')).map(cb => parseInt(cb.value));

            if (selectedIds.length === 0) {
                showToast(window.i18n.t('maintenance_orphan_none_selected') || 'Aucune opération sélectionnée.', 'info');
                return;
            }

            const result = await API.post('/api/maintenance/orphan_recurrences/cleanup', selectedIds);
            showToast(
                (window.i18n.t('maintenance_orphan_result') || '{count} opération(s) supprimée(s).')
                    .replace('{count}', result.deleted),
                'success', 4000
            );

            // Refresh sidebar to update balances
            if (window.app && window.app.refreshSidebar) window.app.refreshSidebar();

        } catch(e) {
            console.error(e);
            if (btn) { btn.disabled = false; }
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    // ── Phase 9: Org Users CRUD ──────────────────────────────────
    async _refreshOrgUsersPanel() {
        const panel = document.getElementById('configOrgUsersPanel');
        if (!panel) return;
        const isOrg = document.getElementById('conf_enable_org_mode')?.checked;
        panel.style.display = isOrg ? 'block' : 'none';
        if (!isOrg) return;

        // Ensure default user exists
        try { await API.post('/api/org_users/ensure_default'); } catch(e) {}

        let users = [];
        try { users = await API.get('/api/org_users/'); } catch(e) {}

        const list = document.getElementById('orgUsersList');
        if (!list) return;
        list.innerHTML = users.map(u => `
            <div class="org-user-row">
                <span style="font-size:18px;">👤</span>
                <span class="org-user-name" id="orgUserName_${u.id}">${u.name}</span>
                <span class="org-user-status ${u.is_active ? 'active' : 'inactive'}">${u.is_active ? window.i18n.t('label_active') : window.i18n.t('label_inactive')}</span>
                <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.ConfigView._renameOrgUser(${u.id},'${u.name.replace(/'/g, "\\'")}')" title="Renommer">✏️</button>
                ${u.is_active
                    ? `<button class="btn btn-danger" style="padding:3px 8px;font-size:11px;" onclick="window.ConfigView._toggleOrgUser(${u.id},false)">${window.i18n.t('btn_deactivate')}</button>`
                    : `<button class="btn btn-primary" style="padding:3px 8px;font-size:11px;" onclick="window.ConfigView._toggleOrgUser(${u.id},true)">${window.i18n.t('btn_reactivate')}</button>`
                }
            </div>
        `).join('');
    },

    async _addOrgUser() {
        const input = document.getElementById('newOrgUserName');
        const name = input?.value.trim();
        if (!name) return;
        try {
            await API.post('/api/org_users/', { name });
            input.value = '';
            showToast(window.i18n.t('toast_user_added'), 'success');
            this._refreshOrgUsersPanel();
        } catch(e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    async _renameOrgUser(id, currentName) {
        const newName = prompt(window.i18n.t('ph_user_name'), currentName);
        if (!newName || newName.trim() === '' || newName.trim() === currentName) return;
        try {
            await API.put(`/api/org_users/${id}`, { name: newName.trim() });
            showToast(window.i18n.t('toast_user_updated'), 'success');
            this._refreshOrgUsersPanel();
        } catch(e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    async _toggleOrgUser(id, activate) {
        try {
            await API.put(`/api/org_users/${id}`, { is_active: activate });
            showToast(activate ? window.i18n.t('toast_user_reactivated') : window.i18n.t('toast_user_deactivated'), 'success');
            this._refreshOrgUsersPanel();
        } catch(e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    // ── Phase 10: License-gated Org Mode ─────────────────────────────
    async _onOrgModeToggle() {
        const chk = document.getElementById('conf_enable_org_mode');
        if (!chk) return;

        if (chk.checked) {
            // Trying to enable org mode → check license first
            const status = await window.LicenseManager.getStatus();
            if (!status.active) {
                // No license → open license modal
                const activated = await window.LicenseManager.open();
                if (!activated) {
                    // User cancelled → uncheck
                    chk.checked = false;
                    return;
                }
            }
        }
        // License OK (or disabling) → proceed with save
        this.save();
        this._refreshLicenseStatus();
    },

    async _refreshLicenseStatus() {
        const el = document.getElementById('configLicenseStatus');
        if (!el) return;
        const status = await window.LicenseManager.getStatus();
        if (status.active) {
            el.style.display = 'flex';
            el.style.alignItems = 'center';
            el.style.gap = '10px';
            el.innerHTML = `
                <span class="license-badge active">✅ ${window.i18n.t('license_active')} — ${status.email}</span>
                <button class="btn btn-danger" style="padding:3px 10px;font-size:11px;" onclick="window.ConfigView._deactivateLicense()">${window.i18n.t('license_btn_deactivate')}</button>
            `;
        } else {
            const isOrgOn = document.getElementById('conf_enable_org_mode')?.checked;
            el.style.display = isOrgOn ? 'block' : 'none';
            el.innerHTML = `<span class="license-badge inactive">❌ ${window.i18n.t('license_inactive')}</span>`;
        }
        // Also refresh shared mode panel (depends on license state)
        this._refreshSharedModePanel();
    },

    async _deactivateLicense() {
        await window.LicenseManager.deactivate();
        // Also uncheck org mode
        const chk = document.getElementById('conf_enable_org_mode');
        if (chk) chk.checked = false;
        this.save();
        this._refreshLicenseStatus();
    },

    // ── Improvement 03: Shared Mode ──────────────────────────────────
    async _refreshSharedModePanel() {
        const panel = document.getElementById('configSharedModePanel');
        const statusEl = document.getElementById('sharedModeStatus');
        const actionsEl = document.getElementById('sharedModeActions');
        if (!statusEl || !actionsEl) return;

        // Only show in Tauri desktop app — useless in Docker/browser
        if (!window.__TAURI__) {
            if (panel) panel.style.display = 'none';
            return;
        }

        // Only show if org license is active
        const license = await window.LicenseManager.getStatus();
        if (!license.active) {
            if (panel) panel.style.display = 'none';
            return;
        }
        if (panel) panel.style.display = '';

        try {
            const status = await API.get('/api/config/shared-mode');

            if (status.active) {
                const modeLabel = status.mode === 'custom' ? '📁' : '🖥️';
                statusEl.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <span class="license-badge active">✅ ${window.i18n.t('config_shared_mode_active')}</span>
                        <span style="font-size: 12px; color: var(--text-muted);">${modeLabel} ${status.path}</span>
                    </div>
                `;
                actionsEl.innerHTML = `
                    <button class="btn btn-danger" style="padding: 6px 14px; font-size: 12px;" onclick="window.ConfigView._disableSharedMode()">
                        ${window.i18n.t('config_shared_mode_deactivate')}
                    </button>
                `;
            } else {
                statusEl.innerHTML = `
                    <span class="license-badge inactive">📴 ${window.i18n.t('config_shared_mode_inactive')}</span>
                `;
                actionsEl.innerHTML = `
                    <button class="btn btn-primary" style="padding: 6px 14px; font-size: 12px;" onclick="window.ConfigView._enableSharedMode('programdata')">
                        🖥️ ${window.i18n.t('config_shared_mode_default_btn')}
                    </button>
                    <button class="btn btn-secondary" style="padding: 6px 14px; font-size: 12px;" onclick="window.ConfigView._enableSharedModeCustom()">
                        📁 ${window.i18n.t('config_shared_mode_custom')}
                    </button>
                `;
            }
        } catch (e) {
            statusEl.innerHTML = '<span style="color: var(--text-muted); font-size: 12px;">—</span>';
            actionsEl.innerHTML = '';
        }
    },

    async _enableSharedMode(mode, customPath) {
        const msg = window.i18n.t('config_shared_mode_confirm');
        if (!confirm(msg)) return;

        try {
            const body = { mode };
            if (customPath) body.custom_path = customPath;
            const res = await API.post('/api/config/shared-mode', body);
            if (res.ok) {
                showToast(window.i18n.t('config_shared_mode_success'), 'success');
                this._refreshSharedModePanel();
            }
        } catch (e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    async _enableSharedModeCustom() {
        try {
            const selected = await window.__TAURI__.dialog.open({
                directory: true,
                multiple: false,
                title: window.i18n.t('config_shared_mode_choose_folder')
            });
            if (!selected) return; // User cancelled
            this._enableSharedMode('custom', selected);
        } catch (e) {
            // Fallback to prompt if Tauri dialog fails
            const path = prompt(window.i18n.t('config_shared_mode_choose_folder'), 'C:\\OmniBank-Shared');
            if (!path || !path.trim()) return;
            this._enableSharedMode('custom', path.trim());
        }
    },

    async _disableSharedMode() {
        const msg = window.i18n.t('config_shared_mode_confirm_disable');
        if (!confirm(msg)) return;

        try {
            const res = await API.del('/api/config/shared-mode');
            if (res.ok) {
                showToast(window.i18n.t('config_shared_mode_disabled'), 'success');
                this._refreshSharedModePanel();
            }
        } catch (e) {
            showToast(e.message || 'Error', 'error');
        }
    },

    // ── Improvement 05: Auto Backup ─────────────────────────────────
    async _refreshAutoBackupStatus() {
        const panel = document.getElementById('autoBackupStatusPanel');
        if (!panel) return;

        try {
            const data = await API.get('/api/backup/auto/status');
            const status = data.status;
            const files = data.files || [];
            const dir = data.backups_dir || '';

            if (!status && files.length === 0) {
                panel.innerHTML = `<p style="color: var(--text-muted); font-size: 12px; font-style: italic;" data-i18n="config_auto_backup_none_yet">${window.i18n.t('config_auto_backup_none_yet')}</p>`;
                return;
            }

            let html = '';

            // Last backup status
            if (status) {
                const dateStr = status.last_date ? new Date(status.last_date).toLocaleString() : '-';
                const sizeStr = status.last_size_bytes ? (status.last_size_bytes / 1024 / 1024).toFixed(2) + ' MB' : '-';
                const statusIcon = status.success ? '✅' : '❌';
                const statusLabel = status.success
                    ? window.i18n.t('config_auto_backup_success')
                    : (window.i18n.t('config_auto_backup_failed') + (status.error ? ': ' + status.error : ''));

                html += `
                <div style="background: var(--bg-main); border-radius: 8px; padding: 12px; margin-bottom: 12px; border: 1px solid var(--border-color);">
                    <div style="display: flex; gap: 20px; flex-wrap: wrap; font-size: 12px;">
                        <div>📅 <strong>${window.i18n.t('config_auto_backup_last')} :</strong> ${dateStr} — ${sizeStr}</div>
                        <div>${statusIcon} ${statusLabel}</div>
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 8px;">
                        📂 <strong>${window.i18n.t('config_auto_backup_path')} :</strong>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                        <input type="text" readonly value="${dir}" id="autoBackupPathInput" style="flex: 1; font-size: 11px; font-family: monospace; padding: 4px 8px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-main); cursor: text; min-width: 0;" onclick="this.select()">
                        <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 10px; white-space: nowrap;" onclick="navigator.clipboard.writeText(document.getElementById('autoBackupPathInput').value).then(()=>showToast(window.i18n.t('config_auto_backup_copied'),'success',2000))" title="${window.i18n.t('config_auto_backup_copy_path')}">📋 ${window.i18n.t('config_auto_backup_copy_path')}</button>
                    </div>
                    <div style="font-size: 10px; color: var(--text-muted); margin-top: 5px; font-style: italic;">
                        🔒 ${window.i18n.t('config_auto_backup_path_hint')}
                    </div>
                </div>`;
            }

            // List available backups
            if (files.length > 0) {
                html += `<div style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;" data-i18n="config_auto_backup_available">${window.i18n.t('config_auto_backup_available')}</div>`;
                html += '<div style="display: flex; flex-direction: column; gap: 4px;">';
                for (const f of files) {
                    const fDate = new Date(f.created).toLocaleString();
                    const fSize = (f.size_bytes / 1024 / 1024).toFixed(2) + ' MB';
                    html += `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--bg-main); border-radius: 6px; border: 1px solid var(--border-color); font-size: 12px;">
                        <span>📦 ${f.filename} <span style="color: var(--text-muted);">(${fDate} — ${fSize})</span></span>
                        <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px;" onclick="window.ConfigView.downloadAutoBackup('${f.filename}')">💾</button>
                    </div>`;
                }
                html += '</div>';
            }

            panel.innerHTML = html;
        } catch (e) {
            console.error('[AutoBackup] Erreur chargement statut', e);
            panel.innerHTML = '';
        }
    },

    async triggerAutoBackup() {
        const btn = document.getElementById('btnTriggerAutoBackup');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ ' + window.i18n.t('config_auto_backup_triggered'); }

        try {
            const res = await fetch('/api/backup/auto/trigger', { method: 'POST' });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${res.status}`);
            }
            showToast(window.i18n.t('config_auto_backup_trigger_ok'), 'success', 3000);
            await this._refreshAutoBackupStatus();
        } catch (e) {
            console.error('[AutoBackup] Trigger failed', e);
            showToast(window.i18n.t('config_auto_backup_trigger_fail').replace('{error}', e.message), 'error', 4000);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '▶️ <span data-i18n="config_auto_backup_trigger">' + window.i18n.t('config_auto_backup_trigger') + '</span>';
            }
        }
    },

    async downloadAutoBackup(filename) {
        try {
            const downloadUrl = `${window.location.origin}/api/backup/auto/download/${encodeURIComponent(filename)}`;

            // Tauri workaround: blob downloads don't work in WebView
            if (window.__TAURI_INTERNALS__) {
                showToast(window.i18n.t('msg_backup_browser') || 'Download opening in your browser...', 'info', 4000);
                await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: downloadUrl });
                return;
            }

            // Regular browser download
            const resp = await fetch(`/api/backup/auto/download/${encodeURIComponent(filename)}`);
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || `HTTP ${resp.status}`);
            }
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[AutoBackup] Download failed', e);
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_error_generic', {error: e.message || e}));
        }
    }
};

