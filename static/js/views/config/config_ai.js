// static/js/views/config/config_ai.js — Configuration Ollama, Assistant IA & Multi-Devises
window.ConfigView = Object.assign(window.ConfigView || {}, {
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

    toggleAIReports(enabled) {
        const settings = document.getElementById('aiReportsSubSettings');
        if (settings) {
            settings.style.display = enabled ? 'block' : 'none';
        }
    },

    async triggerAIReportGeneration() {
        const btn = document.getElementById('btnTriggerAIReport');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Génération...'; }
        try {
            const res = await fetch('/api/notifications/generate-ai-report', { method: 'POST' });
            if (res.ok) {
                showToast("Bilan lancé en arrière-plan. Vérifiez la cloche de notifications d'ici quelques instants !", 'success', 4000);
                if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                    window.app.setFastNotificationsPolling(true);
                }
            } else {
                showToast("Erreur lors du lancement de la génération.", 'error', 3000);
            }
        } catch (e) {
            console.error(e);
            showToast("Erreur de connexion API.", 'error', 3000);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '⚡ <span data-i18n="settings_ai_btn_generate_report">Générer un bilan maintenant</span>';
            }
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
                
                if (this.configData.ollama_model && [...select.options].some(o => o.value === this.configData.ollama_model)) {
                    select.value = this.configData.ollama_model;
                } else if (select.options.length > 0) {
                    this.configData.ollama_model = select.value;
                    await API.post('/api/config/', { ollama_model: select.value });
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


    async saveBaseCurrency() {
        const val = document.getElementById('conf_base_currency').value;
        try {
            await API.post('/api/config/', { base_currency: val });
            window.appBaseCurrency = val;
            showToast(window.i18n.t('toast_config_saved') || 'Devise de référence enregistrée', 'success');
            if (window.app && window.app.refreshAll) {
                window.app.refreshAll();
            }
        } catch (e) {
            console.error(e);
            showToast('Erreur lors de la sauvegarde de la devise', 'error');
        }
    },

    ratesData: [],

    async loadExchangeRates() {
        const tbody = document.getElementById('exchangeRatesBody');
        if (!tbody) return;

        try {
            this.ratesData = await API.get('/api/config/exchange-rates') || [];
            this.filterExchangeRates();
        } catch (e) {
            console.error(e);
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--danger); padding:10px;">Erreur de chargement des taux de change</td></tr>`;
        }
    },

    filterExchangeRates() {
        const tbody = document.getElementById('exchangeRatesBody');
        const countBadge = document.getElementById('rateCountBadge');
        if (!tbody) return;

        const query = (document.getElementById('rateSearchInput')?.value || '').trim().toLowerCase();
        const filtered = this.ratesData.filter(r =>
            r.from_currency.toLowerCase().includes(query) ||
            r.to_currency.toLowerCase().includes(query)
        );

        if (countBadge) {
            countBadge.textContent = `${this.ratesData.length} devises`;
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:10px;">${this.ratesData.length === 0 ? 'Aucun taux de change enregistré' : 'Aucun résultat trouvé'}</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(r => `
            <tr>
                <td><strong style="color:var(--primary);">${r.from_currency}</strong></td>
                <td><strong>${r.to_currency}</strong></td>
                <td>1 ${r.from_currency} = <strong>${r.rate}</strong> ${r.to_currency}</td>
                <td style="text-align: right;">
                    <button class="btn btn-sm btn-danger" onclick="window.ConfigView.deleteExchangeRate(${r.id})" style="padding: 1px 5px; font-size: 10px;" title="Supprimer">✕</button>
                </td>
            </tr>
        `).join('');
    },

    async addExchangeRate() {
        const fromEl = document.getElementById('rate_from');
        const toEl = document.getElementById('rate_to');
        const valEl = document.getElementById('rate_value');

        const fromCurr = fromEl.value.trim().toUpperCase();
        const toCurr = toEl.value.trim().toUpperCase();
        const rate = parseFloat(valEl.value);

        if (!fromCurr || !toCurr || isNaN(rate) || rate <= 0) {
            return showToast('Veuillez saisir des devises valides et un taux positif', 'error');
        }

        try {
            await API.post('/api/config/exchange-rates', {
                from_currency: fromCurr,
                to_currency: toCurr,
                rate: rate
            });
            fromEl.value = '';
            toEl.value = '';
            valEl.value = '';
            showToast('Taux de change enregistré', 'success');
            await this.loadExchangeRates();
        } catch (e) {
            console.error(e);
            showToast(e.message || 'Erreur lors de l\'enregistrement du taux', 'error');
        }
    },

    async deleteExchangeRate(id) {
        try {
            await API.del(`/api/config/exchange-rates/${id}`);
            showToast('Taux de change supprimé', 'success');
            await this.loadExchangeRates();
        } catch (e) {
            console.error(e);
            showToast('Erreur lors de la suppression', 'error');
        }
    },

    async fetchOnlineRates() {
        const btn = document.getElementById('btnFetchOnlineRates');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Actualisation...'; }

        try {
            const res = await API.post('/api/config/exchange-rates/fetch-online', {});
            showToast(window.i18n.tp('config_toast_rates_updated', {count: res.updated}) || `${res.updated} taux de change mis à jour en ligne`, 'success');
            await this.loadExchangeRates();
        } catch (e) {
            console.error(e);
            showToast('Impossible d\'actualiser les taux (vérifiez votre connexion)', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🌐 Actualiser en ligne';
            }
        }
    },


});
