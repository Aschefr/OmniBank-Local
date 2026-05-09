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
                            <input type="checkbox" id="conf_enable_org_mode" class="global-toggle" style="opacity: 0; width: 0; height: 0; position: absolute;" onchange="window.ConfigView.save()">
                            <span class="slider" style="position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: var(--border-color); transition: .4s; border-radius: 34px;"></span>
                            <span class="slider-knob" style="position: absolute; height: 18px; width: 18px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%;"></span>
                        </div>
                        <span data-i18n="config_opt_org_mode">Activer le mode Organisation (Association/CSE)</span>
                    </label>
                </div>
                <style>
                    .global-toggle:checked ~ .slider { background-color: var(--accent) !important; }
                    .global-toggle:checked ~ .slider-knob { transform: translateX(16px) !important; }
                </style>
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
                    <button class="btn btn-warning" onclick="document.getElementById('restoreBackupInput').click()" style="display: flex; align-items: center; gap: 5px; background-color: var(--color-expense); color: white;">
                        📂 <span data-i18n="btn_restore_backup">Restaurer Sauvegarde (ZIP)</span>
                    </button>

                    <!-- Clear DB -->
                    <button class="btn btn-danger" onclick="window.ConfigView.clearDB()" style="display: flex; align-items: center; gap: 5px; margin-left: auto;">
                        ⚠️ <span data-i18n="btn_clear_db">Vider la base de données</span>
                    </button>
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
                enable_org_mode: document.getElementById('conf_enable_org_mode').checked ? 'true' : 'false'
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
            window.open('/api/csv/export', '_blank');
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
        window.open('/api/csv/export?cols=' + encodeURIComponent(selectedCols), '_blank');
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
                showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_db_cleared'));
                window.location.reload();
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
    }
};
