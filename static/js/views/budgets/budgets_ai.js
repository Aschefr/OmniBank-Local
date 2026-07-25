// static/js/views/budgets/budgets_ai.js
// Enveloppes Budgétaires v2 — AI Suggestions, Ollama Streaming & Impact Simulator

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    openAiWindowModal() {
        const modal = document.getElementById('aiWindowSelectionModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    },

    closeAiWindowModal() {
        const modal = document.getElementById('aiWindowSelectionModal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    selectModalAiWindow(months, element) {
        const radio = element.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        const labels = document.querySelectorAll('#aiWindowSelectionModal label');
        labels.forEach(lbl => {
            lbl.style.border = '1px solid var(--border-color)';
        });
        element.style.border = '2px solid var(--accent)';
    },

    confirmAiWindowSelection() {
        const selectedRadio = document.querySelector('input[name="modalAiWindowOption"]:checked');
        const months = selectedRadio ? parseInt(selectedRadio.value) : 3;
        this.closeAiWindowModal();
        this.requestAiSuggestions(months);
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

    async updateOutlierSensitivity(val) {
        const level = parseInt(val) || 2;
        this.currentOutlierSensitivity = level;

        const sliderHeader = document.getElementById('aiOutlierSensitivitySlider');
        const labelHeader = document.getElementById('aiOutlierSensitivityLabel');
        if (sliderHeader) sliderHeader.value = level;
        if (labelHeader) labelHeader.textContent = this.getOutlierSensitivityLabel(level);

        const sliderWiz = document.getElementById('wizOutlierSensitivitySlider');
        const labelWiz = document.getElementById('wizOutlierSensitivityLabel');
        if (sliderWiz) sliderWiz.value = level;
        if (labelWiz) labelWiz.textContent = this.getOutlierSensitivityLabel(level);

        await this.recalculateAiProposalsAmounts(level);
    },

    async recalculateAiProposalsAmounts(outlierSensitivity = 2) {
        if (!this.aiProposals || !this.aiProposals.length) return;

        try {
            const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.requested_window_months) ? this.aiSuggestMeta.requested_window_months : 3;
            const formattedUnclassified = (this.unclassifiedCategories || []).map(u => {
                if (typeof u === 'string') return { name: u };
                return { name: u.name || String(u) };
            });

            const formattedProposals = (this.aiProposals || []).map(p => ({
                name: p.name || '',
                categories: p.categories || [],
                cat_amounts: p.cat_amounts || {},
                cat_details: p.cat_details || {},
                suggested_amount: p.suggested_amount || 0,
                historical_actual_amount: p.historical_actual_amount !== undefined ? p.historical_actual_amount : p.suggested_amount,
                suggested_period: p.suggested_period || p.period || 'monthly',
                is_fixed: !!p.is_fixed,
                justification: p.justification || p.reason || ''
            }));

            const res = await API.post('/api/budgets/ai_suggest/recalculate', {
                window_months: windowMonths,
                outlier_sensitivity: outlierSensitivity,
                existing_proposals: formattedProposals,
                unclassified_categories: formattedUnclassified
            });

            if (res && res.proposals) {
                this.aiProposals = res.proposals;
                if (res.unclassified_categories) {
                    this.unclassifiedCategories = res.unclassified_categories;
                }
                this.renderAiProposalsList();
                if (this.wizardState && this.wizardState.currentStep) {
                    this.renderWizardStep();
                }
            }
        } catch(e) {
            console.error('[AI Budget] Recalculation error:', e);
        }
    },

    async requestAiSuggestions(windowMonths = 3, outlierSensitivity = null) {
        sessionStorage.removeItem('budget_ai_panel_closed');
        const sensitivity = outlierSensitivity !== null ? outlierSensitivity : (this.currentOutlierSensitivity || 2);
        this.currentOutlierSensitivity = sensitivity;

        const btn = document.getElementById('budgetAiBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg> ${window.i18n.t('budget_ai_analyzing')}`;
        }
        
        this.updateAiWindowButtonsState(windowMonths);

        const panel = document.getElementById('budgetAiPanel');
        const container = document.getElementById('budgetAiProposals');
        const overlay = document.getElementById('aiLoadingOverlay');
        const simulator = document.getElementById('aiBudgetSimulator') || document.getElementById('aiImpactSimulator');
        const alertBanner = document.getElementById('aiSimHistoricalComparisonAlert');
        const stickyBar = document.getElementById('aiStickyBar');

        this.aiProposals = [];
        this.unclassifiedCategories = [];

        if (simulator) simulator.style.display = 'none';
        if (alertBanner) alertBanner.style.display = 'none';
        if (stickyBar) stickyBar.style.display = 'none';
        if (container) {
            container.innerHTML = '';
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }

        if (panel) {
            panel.style.display = 'block';
        }
        if (overlay) {
            overlay.style.display = 'flex';
        }
        if (container) {
            container.style.opacity = '0.3';
            container.style.pointerEvents = 'none';
        }

        if (this.currentAiSuggestAbortController) {
            try { 
                this.currentAiSuggestAbortController.abort();
                await API.post('/api/budgets/ai_suggest/cancel');
            } catch(e) {}
        }
        this.currentAiSuggestAbortController = new AbortController();

        if (this.aiPollTimer) clearInterval(this.aiPollTimer);
        this.aiPollTimer = setInterval(async () => {
            try {
                const status = await API.get('/api/budgets/ai_suggest/status');
                if (status && status.state) {
                    if (status.state === 'ERROR' || status.state === 'IDLE') {
                        this.resetAiBtnAndOverlay();
                    } else {
                        this.updateAiPipelineStatusUI(status);
                        if (window.app && window.app.updateAiNavBadge) {
                            window.app.updateAiNavBadge(status);
                        }
                    }
                }
            } catch (e) {}
        }, 1000);

        try {
            const currentLang = (window.i18n && window.i18n.currentLang) ? window.i18n.currentLang : 'fr';
            const result = await API.post('/api/budgets/ai_suggest', {
                window_months: windowMonths,
                lang: currentLang,
                outlier_sensitivity: sensitivity
            }, { signal: this.currentAiSuggestAbortController.signal });
            await this.playParsingAnimation();
            this.aiSuggestMeta = result;
            const effWin = result.effective_window_months || result.window_months || windowMonths;
            this.updateAiWindowButtonsState(windowMonths, effWin);
            this.renderAiProposals(result.proposals || []);
            if (localStorage.getItem('budget_ai_wizard_enabled') !== 'false') {
                this.startAiWizard();
            } else {
                this.triggerAiCreateBtnPulse();
            }
        } catch(e) {
            if (e.name === 'AbortError') {
                return;
            }
            let msg = '';
            if (typeof e.detail === 'string') msg = e.detail;
            else if (typeof e.message === 'string') msg = e.message;
            else msg = String(e || '');

            if (panel && (!this.aiProposals || !this.aiProposals.length)) {
                panel.style.display = 'none';
            }
            const isInfoMsg = msg.includes('non activ') || msg.includes('déjà couvertes') || msg.includes('400');
            if (!isInfoMsg && (msg.includes('Internal Server Error') || !msg.trim() || msg.startsWith('<'))) {
                msg = (window.i18n && window.i18n.t) ? window.i18n.t('budget_ai_error') : "Impossible de contacter Ollama. Vérifiez l'adresse et le port dans les paramètres.";
            }
            if (isInfoMsg) {
                showInlineMessage(window.i18n.t('title_info'), msg);
            } else {
                showInlineMessage(window.i18n.t('title_error'), msg);
            }
        } finally {
            this.resetAiBtnAndOverlay();
        }
    },

    updateAiWindowButtonsState(activeWindow, effectiveWindow = null) {
        const wins = [3, 6, 12];
        const targetWin = effectiveWindow || activeWindow;

        wins.forEach(w => {
            const btn = document.getElementById(`btnAiWindow_${w}`) || document.getElementById(`aiWinBtn${w}`);
            if (btn) {
                if (w === targetWin) {
                    btn.className = 'btn btn-primary';
                    btn.style.opacity = '1';
                    btn.style.pointerEvents = 'auto';
                    btn.disabled = false;
                } else if (effectiveWindow && w < effectiveWindow) {
                    btn.className = 'btn btn-secondary';
                    btn.style.opacity = '0.35';
                    btn.style.cursor = 'not-allowed';
                    btn.disabled = true;
                    btn.title = window.i18n.t('ai_budget_window_auto_extended') || `Aucune dépense sur ${w} mois — analyse étendue à ${effectiveWindow} mois`;
                } else {
                    btn.className = 'btn btn-secondary';
                    btn.style.opacity = '1';
                    btn.style.pointerEvents = 'auto';
                    btn.disabled = false;
                    btn.title = '';
                }
            }
        });
    },

    async cancelAiSuggestions() {
        if (this.currentAiSuggestAbortController) {
            try { this.currentAiSuggestAbortController.abort(); } catch(e) {}
            this.currentAiSuggestAbortController = null;
        }
        try {
            await API.post('/api/budgets/ai_suggest/cancel');
        } catch(e) {}
        this.resetAiBtnAndOverlay();
    },

    resetAiBtnAndOverlay() {
        if (this.aiPollTimer) {
            clearInterval(this.aiPollTimer);
            this.aiPollTimer = null;
        }
        if (this._aiPollTimer) {
            clearInterval(this._aiPollTimer);
            this._aiPollTimer = null;
        }
        const btn = document.getElementById('budgetAiBtn');
        const overlay = document.getElementById('aiLoadingOverlay');
        const container = document.getElementById('budgetAiProposals');

        if (btn) {
            btn.disabled = false;
            btn.textContent = window.i18n.t('budget_btn_suggestions') || '✨ Suggestions IA';
        }
        if (overlay) overlay.style.display = 'none';
        if (container) {
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }
        if (window.app && window.app.updateAiNavBadge) {
            window.app.updateAiNavBadge(null);
        }
    },

    async playParsingAnimation() {
        this.isPlayingParsingAnimation = true;
        const pContainer = document.getElementById('aiParsingProgressBarContainer');
        const pBar = document.getElementById('aiParsingProgressBar');
        const loadingText = document.getElementById('aiLoadingText');

        const steps = ['PREPARING', 'SENDING', 'THINKING', 'PARSING'];
        steps.forEach((st) => {
            const el = document.getElementById(`aiStep_${st}`);
            if (el) {
                if (st === 'PARSING') {
                    el.style.background = 'rgba(139,92,246,0.35)';
                    el.style.borderColor = '#c084fc';
                    el.style.color = '#ffffff';
                    el.style.fontWeight = 'bold';
                } else {
                    el.style.background = 'rgba(34,197,94,0.15)';
                    el.style.borderColor = '#22c55e';
                    el.style.color = '#4ade80';
                    el.style.fontWeight = 'normal';
                }
            }
        });

        if (loadingText) {
            loadingText.textContent = (window.i18n && window.i18n.t) ? (window.i18n.t('ai_step_parsing') || 'Structuration des enveloppes...') : 'Structuration des enveloppes...';
        }

        if (pContainer && pBar) {
            pContainer.style.display = 'block';
            pBar.style.width = '0%';
            void pBar.offsetWidth;
            pBar.style.width = '100%';
            await new Promise(resolve => setTimeout(resolve, 2000));
            pContainer.style.display = 'none';
            pBar.style.width = '0%';
        }
        this.isPlayingParsingAnimation = false;
    },

    updateAiPipelineStatusUI(status) {
        if (this.isPlayingParsingAnimation) return;

        if (!status || status.state === 'ERROR' || status.state === 'IDLE') {
            this.resetAiBtnAndOverlay();
            return;
        }

        const btn = document.getElementById('budgetAiBtn');
        const loadingText = document.getElementById('aiLoadingText');
        const timerBadge = document.getElementById('aiTimerBadge');

        const stepText = (window.i18n && window.i18n.t && status.step_key) ? (window.i18n.t(status.step_key) || status.step_key) : status.step_key;
        const elapsed = status.elapsed_seconds || 0;

        let activeState = status.state;
        if (activeState === 'SENDING' && elapsed >= 3) {
            activeState = 'THINKING';
        }

        if (btn && status.state && status.state !== 'IDLE' && status.state !== 'SUCCESS' && status.state !== 'ERROR') {
            btn.disabled = false;
            btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;"><svg class="animate-spin" style="width:14px;height:14px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg> ${stepText} (${elapsed}s) <button onclick="event.stopPropagation(); window.BudgetsView.cancelAiSuggestions()" style="background:#ef4444;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:bold;cursor:pointer;margin-left:4px;" title="Arrêter l'analyse IA">⛔ ${window.i18n.t('btn_stop') || 'Arrêter'}</button></span>`;
        }

        if (loadingText && status.step_key) {
            loadingText.textContent = stepText;
        }
        if (timerBadge) {
            timerBadge.textContent = `⏱️ ${elapsed}s / ${status.max_seconds || 300}s max`;
        }

        const steps = ['PREPARING', 'SENDING', 'THINKING', 'PARSING'];
        steps.forEach((st) => {
            const el = document.getElementById(`aiStep_${st}`);
            if (el) {
                if (st === activeState) {
                    el.style.background = 'rgba(139,92,246,0.35)';
                    el.style.borderColor = '#c084fc';
                    el.style.color = '#ffffff';
                    el.style.fontWeight = 'bold';
                } else if (steps.indexOf(st) < steps.indexOf(activeState)) {
                    el.style.background = 'rgba(34,197,94,0.15)';
                    el.style.borderColor = '#22c55e';
                    el.style.color = '#4ade80';
                    el.style.fontWeight = 'normal';
                } else {
                    el.style.background = 'var(--bg-surface)';
                    el.style.borderColor = 'var(--border-color)';
                    el.style.color = 'var(--text-muted)';
                    el.style.fontWeight = 'normal';
                }
            }
        });
    },

    saveAiStateToSession() {
        try {
            if (this.aiProposals !== undefined && this.aiProposals !== null) {
                const data = {
                    proposals: this.aiProposals,
                    unclassified: this.unclassifiedCategories || [],
                    meta: this.aiSuggestMeta || null,
                    customSalaryOverride: this.customSalaryOverride || null,
                    customYearlySalaryOverride: this.customYearlySalaryOverride || null,
                    wizardState: this.wizardState || null
                };
                sessionStorage.setItem('omni_ai_proposals_state', JSON.stringify(data));
            }
        } catch (e) {}
    },

    loadAiStateFromSession() {
        try {
            const raw = sessionStorage.getItem('omni_ai_proposals_state');
            if (raw) {
                const data = JSON.parse(raw);
                if (data && Array.isArray(data.proposals)) {
                    this.aiSuggestMeta = data.meta;
                    this.unclassifiedCategories = data.unclassified || [];
                    this.aiProposals = data.proposals;
                    if (data.customSalaryOverride !== undefined && data.customSalaryOverride !== null) {
                        this.customSalaryOverride = data.customSalaryOverride;
                    }
                    if (data.customYearlySalaryOverride !== undefined && data.customYearlySalaryOverride !== null) {
                        this.customYearlySalaryOverride = data.customYearlySalaryOverride;
                    }
                    if (data.wizardState) {
                        this.wizardState = data.wizardState;
                    }
                    return true;
                }
            }
        } catch (e) {}
        return false;
    },

    clearAiStateFromSession() {
        sessionStorage.removeItem('omni_ai_proposals_state');
    },

    async checkAiTaskStatusOnMount() {
        if (sessionStorage.getItem('budget_ai_panel_closed') === 'true') return;

        if (this.loadAiStateFromSession() && this.aiProposals) {
            this.renderAiProposalsList();
            return;
        }

        try {
            const status = await API.get('/api/budgets/ai_suggest/status');
            if (status && status.state) {
                if (['PREPARING', 'SENDING', 'THINKING', 'PARSING'].includes(status.state)) {
                    const panel = document.getElementById('budgetAiPanel');
                    const overlay = document.getElementById('aiLoadingOverlay');
                    const container = document.getElementById('budgetAiProposals');
                    const simulator = document.getElementById('aiBudgetSimulator') || document.getElementById('aiImpactSimulator');
                    const alertBanner = document.getElementById('aiSimHistoricalComparisonAlert');
                    const stickyBar = document.getElementById('aiStickyBar');

                    if (panel) panel.style.display = 'block';
                    if (simulator) simulator.style.display = 'none';
                    if (alertBanner) alertBanner.style.display = 'none';
                    if (stickyBar) stickyBar.style.display = 'none';

                    if (overlay) overlay.style.display = 'flex';
                    if (container) {
                        container.style.opacity = '0.3';
                        container.style.pointerEvents = 'none';
                    }
                    this.updateAiPipelineStatusUI(status);

                    if (this._aiPollTimer) clearInterval(this._aiPollTimer);
                    this._aiPollTimer = setInterval(async () => {
                        try {
                            const curStatus = await API.get('/api/budgets/ai_suggest/status');
                            if (curStatus && curStatus.state) {
                                this.updateAiPipelineStatusUI(curStatus);
                                if (curStatus.state === 'SUCCESS' && curStatus.result) {
                                    clearInterval(this._aiPollTimer);
                                    await this.playParsingAnimation();
                                    if (overlay) overlay.style.display = 'none';
                                    if (container) {
                                        container.style.opacity = '1';
                                        container.style.pointerEvents = 'auto';
                                    }
                                    const btn = document.getElementById('budgetAiBtn');
                                    if (btn) {
                                        btn.disabled = false;
                                        btn.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('budget_btn_suggestions') : 'Suggestions IA';
                                    }
                                    this.aiSuggestMeta = curStatus.result;
                                    this.renderAiProposals(curStatus.result.proposals || []);
                                } else if (curStatus.state === 'ERROR') {
                                    clearInterval(this._aiPollTimer);
                                    if (overlay) overlay.style.display = 'none';
                                    if (container) {
                                        container.style.opacity = '1';
                                        container.style.pointerEvents = 'auto';
                                    }
                                    const btn = document.getElementById('budgetAiBtn');
                                    if (btn) {
                                        btn.disabled = false;
                                        btn.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('budget_btn_suggestions') : 'Suggestions IA';
                                    }
                                }
                            }
                        } catch (e) {}
                    }, 1000);
                } else if (status.state === 'SUCCESS' && status.result && !this.aiProposals) {
                    this.aiSuggestMeta = status.result;
                    this.renderAiProposals(status.result.proposals || []);
                }
            }
        } catch (e) {}
    },

    renderAiProposals(proposals) {
        this.allCatDetails = {};
        if (this.aiSuggestMeta) {
            if (this.aiSuggestMeta.cat_details) {
                Object.assign(this.allCatDetails, this.aiSuggestMeta.cat_details);
            }
            if (this.aiSuggestMeta.unclassified_details) {
                Object.assign(this.allCatDetails, this.aiSuggestMeta.unclassified_details);
            }
        }

        this.aiProposals = proposals.map(p => {
            const cat_amounts = { ...(p.cat_amounts || {}) };
            if (p.cat_details) {
                for (const [c, details] of Object.entries(p.cat_details)) {
                    if (details) {
                        this.allCatDetails[c] = details;
                        if (details.amount !== undefined) {
                            cat_amounts[c] = details.amount;
                        }
                    }
                }
            }
            return {
                ...p,
                cat_amounts,
                original_amount: p.suggested_amount,
                period: p.suggested_period || 'monthly',
                selected: true
            };
        });
        this.unclassifiedCategories = (this.aiSuggestMeta && this.aiSuggestMeta.unclassified_categories) || [];
        this.renderAiProposalsList();
    },

    toggleAiOptionsDropdown(e) {
        if (e) e.stopPropagation();
        const menu = document.getElementById('aiOptionsDropdownMenu');
        if (!menu) return;

        const isVisible = menu.style.display === 'flex';
        menu.style.display = isVisible ? 'none' : 'flex';

        if (!isVisible && !this._aiDropdownOutsideListener) {
            this._aiDropdownOutsideListener = (evt) => {
                const container = document.getElementById('btnAiOptionsDropdown');
                if (menu && !menu.contains(evt.target) && container && !container.contains(evt.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', this._aiDropdownOutsideListener);
                    this._aiDropdownOutsideListener = null;
                }
            };
            setTimeout(() => {
                document.addEventListener('click', this._aiDropdownOutsideListener);
            }, 10);
        }
    },

    adjustAiProposals(multiplier, isAbsoluteReset = false) {
        if (!this.aiProposals) return;
        this.aiProposals.forEach((p, i) => {
            if (p.is_fixed) return;

            if (isAbsoluteReset) {
                p.suggested_amount = p.original_amount;
            } else if (p.has_fixed_mix && p.fixed_sum > 0) {
                const variablePart = Math.max(0, p.suggested_amount - p.fixed_sum);
                const adjustedVar = Math.round(variablePart * multiplier * 100) / 100;
                p.suggested_amount = Math.round((p.fixed_sum + adjustedVar) * 100) / 100;
            } else {
                p.suggested_amount = Math.max(0, Math.round(p.suggested_amount * multiplier * 100) / 100);
            }

            const input = document.getElementById(`aiProposalAmount_${i}`);
            if (input) input.value = p.suggested_amount;
        });
        this.renderAiProposalsList();
    },

    alignAiProposalsToRealSpending() {
        if (!this.aiProposals) return;
        this.aiProposals.forEach((p, i) => {
            if (p.is_fixed && !p.unlocked) return;

            const isYearly = (p.period || p.suggested_period) === 'yearly';
            const paceAvgSum = (p.categories || []).reduce((sum, c) => {
                let val = 0;
                if (p.cat_amounts && p.cat_amounts[c] !== undefined) {
                    val = p.cat_amounts[c];
                } else if (p.cat_details && p.cat_details[c] && p.cat_details[c].amount !== undefined) {
                    val = p.cat_details[c].amount;
                } else if (this.aiSuggestMeta && this.aiSuggestMeta.cat_averages && this.aiSuggestMeta.cat_averages[c] !== undefined) {
                    const monthlyAvg = Math.abs(this.aiSuggestMeta.cat_averages[c]);
                    val = isYearly ? (monthlyAvg * 12.0) : monthlyAvg;
                } else if (this.catAverages && this.catAverages[c] !== undefined) {
                    const monthlyAvg = Math.abs(this.catAverages[c]);
                    val = isYearly ? (monthlyAvg * 12.0) : monthlyAvg;
                }
                const parsed = parseFloat(val);
                return sum + (isNaN(parsed) ? 0 : parsed);
            }, 0);

            const targetAmt = Math.round(paceAvgSum * 100) / 100;
            p.suggested_amount = targetAmt;
            const input = document.getElementById(`aiProposalAmount_${i}`);
            if (input) input.value = p.suggested_amount;
        });
        this.renderAiProposalsList();
    },

    alignAiProposalsToCurrentMonth() {
        if (!this.aiProposals) return;
        this.aiProposals.forEach((p, i) => {
            if (p.is_fixed && !p.unlocked) return;

            const isYearly = (p.period || p.suggested_period) === 'yearly';
            const curSpentSum = (p.categories || []).reduce((sum, c) => {
                let val = 0;
                if (p.cat_details && p.cat_details[c] && p.cat_details[c].current_month_spent !== undefined) {
                    val = p.cat_details[c].current_month_spent;
                } else if (this.allCatDetails && this.allCatDetails[c] && this.allCatDetails[c].current_month_spent !== undefined) {
                    val = this.allCatDetails[c].current_month_spent;
                }
                const parsed = parseFloat(val);
                return sum + (isNaN(parsed) ? 0 : parsed);
            }, 0);

            const targetAmt = isYearly ? Math.round(curSpentSum * 12.0 * 100) / 100 : Math.round(curSpentSum * 100) / 100;
            p.suggested_amount = targetAmt;
            const input = document.getElementById(`aiProposalAmount_${i}`);
            if (input) input.value = p.suggested_amount;
        });
        this.renderAiProposalsList();
    },

    resetAiProposalsToOriginal() {
        if (!this.aiProposals) return;
        this.aiProposals.forEach((p, i) => {
            if (p.is_fixed && !p.unlocked) return;

            const orig = p.original_amount !== undefined ? p.original_amount : p.suggested_amount;
            p.suggested_amount = Math.round(orig * 100) / 100;
            const input = document.getElementById(`aiProposalAmount_${i}`);
            if (input) input.value = p.suggested_amount;
        });
        this.renderAiProposalsList();
    },

    alignAiProposalsToIncome() {
        if (!this.aiProposals) return;
        
        const salaryInput = document.getElementById('aiSimSalaryInput');
        let regularSalary = salaryInput ? parseFloat(salaryInput.value) : 0;
        if (isNaN(regularSalary) || regularSalary <= 0) {
            regularSalary = this.customSalaryOverride || 0;
        }
        if (regularSalary <= 0) {
            regularSalary = (this.aiSuggestMeta && this.aiSuggestMeta.regular_salary) ? this.aiSuggestMeta.regular_salary : 0;
        }
        if (regularSalary <= 0) {
            regularSalary = (this.capacityData && this.capacityData.monthly) ? (this.capacityData.monthly.average_income || this.capacityData.monthly.income_ref || 0) : 0;
        }
        if (regularSalary <= 0) return;

        const currentMonthlyCapacity = (this.aiSuggestMeta && this.aiSuggestMeta.already_engaged_monthly !== undefined)
            ? this.aiSuggestMeta.already_engaged_monthly
            : ((this.capacityData && this.capacityData.monthly) ? (this.capacityData.monthly.budgeted || 0) : 0);
        const availableForNewEnvelopes = Math.max(0, regularSalary - currentMonthlyCapacity);

        let fixedTotal = 0;
        let variableTotal = 0;
        const activeVariableProposals = [];

        this.aiProposals.forEach(p => {
            if (p.selected === false) return;
            const pPeriod = p.period || p.suggested_period || 'monthly';
            const currentMonthlyAmt = pPeriod === 'yearly' ? (p.suggested_amount / 12.0) : p.suggested_amount;

            if (p.is_fixed && !p.unlocked) {
                fixedTotal += currentMonthlyAmt;
            } else {
                // Utiliser la base d'origine stable (original_amount ou historical_actual_amount)
                const origVal = p.original_amount !== undefined ? p.original_amount : (p.historical_actual_amount !== undefined ? p.historical_actual_amount : p.suggested_amount);
                let baseVal = pPeriod === 'yearly' ? (origVal / 12.0) : origVal;
                if (baseVal <= 0) {
                    baseVal = currentMonthlyAmt > 0 ? currentMonthlyAmt : 10;
                }
                variableTotal += baseVal;
                activeVariableProposals.push({ p, baseVal, pPeriod });
            }
        });

        const remainingForVariables = Math.max(0, availableForNewEnvelopes - fixedTotal);
        if (variableTotal > 0 && activeVariableProposals.length > 0) {
            const ratio = remainingForVariables / variableTotal;
            let computedVariableTotal = 0;

            activeVariableProposals.forEach(({ p, baseVal, pPeriod }) => {
                const newMonthly = baseVal * ratio;
                p.suggested_amount = pPeriod === 'yearly' ? Math.round(newMonthly * 12.0 * 100) / 100 : Math.round(newMonthly * 100) / 100;
                const finalMonthly = pPeriod === 'yearly' ? (p.suggested_amount / 12.0) : p.suggested_amount;
                computedVariableTotal += finalMonthly;
            });

            const diff = Math.round((remainingForVariables - computedVariableTotal) * 100) / 100;
            if (Math.abs(diff) >= 0.01) {
                const lastObj = activeVariableProposals[activeVariableProposals.length - 1];
                if (lastObj) {
                    const { p: lastP, pPeriod: lastPeriod } = lastObj;
                    const lastMonthly = lastPeriod === 'yearly' ? (lastP.suggested_amount / 12.0) : lastP.suggested_amount;
                    const adjustedMonthly = Math.max(0, lastMonthly + diff);
                    lastP.suggested_amount = lastPeriod === 'yearly' ? Math.round(adjustedMonthly * 12.0 * 100) / 100 : Math.round(adjustedMonthly * 100) / 100;
                }
            }
        }
        this.renderAiProposalsList();
    },

    toggleAllAiProposals(checked) {
        if (!this.aiProposals) return;
        this.aiProposals.forEach(p => p.selected = checked);
        const checkboxes = document.querySelectorAll('.ai-proposal-checkbox');
        checkboxes.forEach(cb => cb.checked = checked);
        this.updateAiImpactSimulation();
    },

    updateAiProposalAmount(index, val) {
        if (this.aiProposals && this.aiProposals[index]) {
            const parsed = parseFloat(val);
            this.aiProposals[index].suggested_amount = isNaN(parsed) ? 0 : parsed;
            const p = this.aiProposals[index];
            const isYearly = (p.period || p.suggested_period) === 'yearly';

            const smoothedEl = document.getElementById(`aiProposalSmoothed_${index}`);
            if (smoothedEl && isYearly) {
                smoothedEl.textContent = `(${formatCurrency(p.suggested_amount / 12.0)} €/m)`;
            }

            this.updateAiImpactSimulation();
        }
    },

    toggleAiProposal(index, checked) {
        if (this.aiProposals && this.aiProposals[index]) {
            this.aiProposals[index].selected = checked;
            this.updateAiImpactSimulation();
        }
    },

    updateAiProposalPeriod(index, period) {
        if (this.aiProposals && this.aiProposals[index]) {
            this.aiProposals[index].period = period;
            const unitSpan = document.getElementById(`aiProposalUnit_${index}`);
            if (unitSpan) unitSpan.textContent = (period === 'yearly' ? (window.i18n.t('budget_unit_yearly') || '€/an') : (window.i18n.t('budget_unit_monthly') || '€/mois'));
            this.renderAiProposalsList();
        }
    },

    updateAiProposalAmount(index, val) {
        const num = parseFloat(val);
        if (this.aiProposals && this.aiProposals[index] && !isNaN(num) && num >= 0) {
            this.aiProposals[index].suggested_amount = num;
            this.renderAiProposalsList();
        }
    },

    setSimMode(mode) {
        this.aiSimMode = mode;
        const btnIncome = document.getElementById('btnAiSimModeIncome');
        const btnSpending = document.getElementById('btnAiSimModeSpending');
        if (btnIncome && btnSpending) {
            if (mode === 'income') {
                btnIncome.style.background = 'var(--accent)';
                btnIncome.style.color = '#fff';
                btnSpending.style.background = 'transparent';
                btnSpending.style.color = 'var(--text-muted)';
            } else {
                btnSpending.style.background = 'var(--accent)';
                btnSpending.style.color = '#fff';
                btnIncome.style.background = 'transparent';
                btnIncome.style.color = 'var(--text-muted)';
            }
        }
        this.updateAiImpactSimulation();
    },

    updateAiImpactSimulation() {
        const proposals = this.aiProposals || [];
        const selected = proposals.filter(p => p.selected);

        let regularSalary = this.customSalaryOverride;
        if (regularSalary === undefined || regularSalary === null) {
            regularSalary = (this.aiSuggestMeta && this.aiSuggestMeta.regular_salary > 0) 
                ? this.aiSuggestMeta.regular_salary 
                : ((this.capacityData && this.capacityData.monthly) ? (this.capacityData.monthly.income || 0) : 0);
        }

        let currentMonthlyCapacity = 0;
        if (this.aiSuggestMeta && this.aiSuggestMeta.already_engaged_monthly !== undefined) {
            currentMonthlyCapacity = this.aiSuggestMeta.already_engaged_monthly;
        } else if (this.capacityData && this.capacityData.monthly && !this.capacityData.monthly.is_fallback) {
            currentMonthlyCapacity = this.capacityData.monthly.budgeted || 0;
        }

        let impactMonthly = 0;
        let impactYearlyOnly = 0;

        selected.forEach(p => {
            const pPeriod = p.suggested_period || p.period || 'monthly';
            if (pPeriod === 'yearly') {
                impactMonthly += (p.suggested_amount / 12.0);
                impactYearlyOnly += p.suggested_amount;
            } else {
                impactMonthly += p.suggested_amount;
            }
        });

        const totalProjectedMonthly = currentMonthlyCapacity + impactMonthly;
        const baselineSalaryMonthly = regularSalary > 0 ? regularSalary : 1;

        let regularYearlySalary = this.customYearlySalaryOverride;
        if (regularYearlySalary === undefined || regularYearlySalary === null) {
            regularYearlySalary = regularSalary > 0 ? (regularSalary * 12.0) : 0;
        }

        let currentYearlyCapacity = 0;
        if (this.capacityData && this.capacityData.yearly && !this.capacityData.yearly.is_fallback) {
            currentYearlyCapacity = this.capacityData.yearly.budgeted || 0;
        }
        const baselineSalaryYearly = regularYearlySalary > 0 ? regularYearlySalary : 1;
        const totalProjectedYearly = currentYearlyCapacity + impactYearlyOnly;
        const isExceededYearly = (regularYearlySalary > 0 && totalProjectedYearly > regularYearlySalary);

        const currentPctYearly = Math.min(100, Math.round((currentYearlyCapacity / baselineSalaryYearly) * 100));
        const totalPctYearly = Math.min(100, Math.round((totalProjectedYearly / baselineSalaryYearly) * 100));

        const salaryInput = document.getElementById('aiSimSalaryInput');
        if (salaryInput && document.activeElement !== salaryInput) {
            salaryInput.value = regularSalary.toFixed(2);
        }

        const countText = (window.i18n && window.i18n.t) 
            ? (window.i18n.t('ai_budget_selected_format') || '{selected} / {total} sélectionnées').replace('{selected}', selected.length).replace('{total}', proposals.length)
            : `${selected.length} / ${proposals.length} sélectionnées`;

        const countSpan = document.getElementById('aiSimSelectedCount');
        if (countSpan) countSpan.textContent = countText;

        const stickyBar = document.getElementById('aiStickyBar');
        const stickyCount = document.getElementById('aiStickyCount');
        if (stickyBar) stickyBar.style.display = proposals.length > 0 ? 'flex' : 'none';
        if (stickyCount) stickyCount.textContent = countText;

        let impactMonthlyStrict = 0;
        let impactYearlyStrict = 0;
        let impactCombinedMonthly = 0;

        let estimatedMonthlyStrict = 0;
        let estimatedYearlyStrict = 0;
        let estimatedCombinedMonthly = 0;

        selected.forEach(p => {
            const pPeriod = p.suggested_period || p.period || 'monthly';
            const histAmt = p.historical_actual_amount !== undefined 
                ? p.historical_actual_amount 
                : (p.recent_3m_avg !== undefined ? p.recent_3m_avg : p.suggested_amount);

            if (pPeriod === 'yearly') {
                impactYearlyStrict += p.suggested_amount;
                impactCombinedMonthly += (p.suggested_amount / 12.0);

                estimatedYearlyStrict += histAmt;
                estimatedCombinedMonthly += (histAmt / 12.0);
            } else {
                impactMonthlyStrict += p.suggested_amount;
                impactCombinedMonthly += p.suggested_amount;

                estimatedMonthlyStrict += histAmt;
                estimatedCombinedMonthly += histAmt;
            }
        });

        // ── HELPER DE RENDU D'UNE BARRE D'AFFICHAGE SUPERPOSÉE STANDARD ─────────
        const renderSuperimposedGauge = (containerId, envelopeAmount, salaryRef, estimatedAmount, isYearly = false) => {
            const container = document.getElementById(containerId);
            if (!container) return;

            const unit = isYearly ? '€/an' : '€/m';
            // Echelle fixe entre 0 et Max€ (Cas le plus haut + 5% de marge visuelle)
            const maxVal = Math.max(envelopeAmount, salaryRef, estimatedAmount, 100) * 1.05;

            const envPct = Math.min(100, Math.max(0, (envelopeAmount / maxVal) * 100));
            const salaryPct = salaryRef > 0 ? Math.min(100, Math.max(0, (salaryRef / maxVal) * 100)) : null;
            const estimatedPct = estimatedAmount > 0 ? Math.min(100, Math.max(0, (estimatedAmount / maxVal) * 100)) : null;

            // Graduation Marks
            const step = maxVal >= 6000 ? 2000 : (maxVal >= 3000 ? 1000 : (maxVal >= 1000 ? 500 : 200));
            const ticks = [];
            for (let v = 0; v <= maxVal; v += step) {
                ticks.push(v);
            }

            container.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">
                    <!-- Barre d'affichage superposée fine -->
                    <div style="position:relative;height:8px;background:var(--bg-base);border:1px solid var(--border-color);border-radius:4px;overflow:visible;margin-top:14px;margin-bottom:14px;">
                        <!-- Barre Bleue (Montant des enveloppes) -->
                        <div style="position:absolute;top:0;left:0;bottom:0;width:${envPct}%;background:linear-gradient(90deg, #3b82f6, #6366f1);border-radius:4px;transition:width 0.4s ease;max-width:100%;" title="Montant des enveloppes: ${formatCurrency(envelopeAmount)} ${unit}"></div>
                        
                        <!-- Repère Jaune (Montant des dépenses estimées) -->
                        ${estimatedPct !== null ? `
                            <div style="position:absolute;top:-4px;bottom:-4px;left:${estimatedPct}%;width:3px;background:#eab308;box-shadow:0 0 6px #eab308;z-index:3;" title="Dépenses estimées: ${formatCurrency(estimatedAmount)} ${unit}">
                                <div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:2px;background:#eab308;color:#000000;font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);">
                                    🟨 Est. lissée ${formatCurrency(estimatedAmount)}
                                </div>
                            </div>
                        ` : ''}

                        <!-- Repère Violet (Salaire repère) -->
                        ${salaryPct !== null ? `
                            <div style="position:absolute;top:-6px;bottom:-6px;left:${salaryPct}%;width:3px;background:#c084fc;box-shadow:0 0 6px #c084fc;z-index:4;" title="Revenus repère: ${formatCurrency(salaryRef)} ${unit}">
                                <div style="position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:2px;background:#c084fc;color:#ffffff;font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);">
                                    💼 Salaire: ${formatCurrency(salaryRef)}
                                </div>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Échelle fixe graduée -->
                    <div style="position:relative;height:14px;margin-top:-10px;display:flex;justify-content:space-between;font-size:9.5px;color:var(--text-muted);font-weight:600;">
                        ${ticks.map(val => `<span>${val}€</span>`).join('')}
                    </div>
                </div>
            `;
        };

        // Mise à jour des badges de chaque carte
        const card1Badge = document.getElementById('aiSimCard1Badge');
        if (card1Badge) card1Badge.textContent = `${formatCurrency(impactCombinedMonthly)} €/m`;

        const card2Badge = document.getElementById('aiSimCard2Badge');
        if (card2Badge) card2Badge.textContent = `${formatCurrency(impactMonthlyStrict)} €/m`;

        const card3Badge = document.getElementById('aiSimCard3Badge');
        if (card3Badge) {
            const smoothedMonthly = impactYearlyStrict / 12.0;
            card3Badge.innerHTML = `${formatCurrency(impactYearlyStrict)} €/an <span style="font-size:10px;font-weight:600;color:var(--text-muted);margin-left:4px;">(${formatCurrency(smoothedMonthly)} €/m)</span>`;
        }

        // Rendu des 3 gauges
        const yearlySalary = regularSalary > 0 ? (regularSalary * 12.0) : 0;
        renderSuperimposedGauge('aiSimGaugeCard1', impactCombinedMonthly, regularSalary, estimatedCombinedMonthly, false);
        renderSuperimposedGauge('aiSimGaugeCard2', impactMonthlyStrict, regularSalary, estimatedMonthlyStrict, false);
        renderSuperimposedGauge('aiSimGaugeCard3', impactYearlyStrict, yearlySalary, estimatedYearlyStrict, true);

        const renderScaleTicks = (containerId) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            const step = maxScale <= 2500 ? 500 : 1000;
            let html = '';
            for (let val = 0; val <= maxScale; val += step) {
                const pos = (val / maxScale) * 100;
                const label = val === 0 ? '0 €' : `${val} €`;
                const alignStyle = pos === 0 ? 'left:0;' : (pos >= 98 ? 'right:0;' : `left:${pos}%;transform:translateX(-50%);`);
                html += `<div style="position:absolute;${alignStyle}display:flex;flex-direction:column;align-items:center;">
                    <div style="width:1px;height:4px;background:var(--text-muted);opacity:0.4;"></div>
                    <span style="font-size:9px;color:var(--text-muted);opacity:0.75;margin-top:1px;font-weight:600;font-family:sans-serif;">${label}</span>
                </div>`;
            }
            container.innerHTML = html;
        };

        renderScaleTicks('aiSimScaleTicks1');
        renderScaleTicks('aiSimScaleTicks2');

        const alertBanner = document.getElementById('aiSimHistoricalComparisonAlert');
        if (alertBanner) {
            const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) ? this.aiSuggestMeta.window_months : 3;

            // 3 Variables clés mensualisées
            const ENV = impactCombinedMonthly;
            const SAL = regularSalary;
            const EST = estimatedCombinedMonthly;

            // Tolérances et tampons (Friction)
            const tolerance = Math.max(10, SAL * 0.01);
            const isEnvEqEst = Math.abs(ENV - EST) <= tolerance;
            const isEnvEqSal = Math.abs(ENV - SAL) <= tolerance;
            const isEstEqSal = Math.abs(EST - SAL) <= tolerance;

            let bannerBg = 'rgba(59, 130, 246, 0.1)';
            let bannerBorder = 'rgba(59, 130, 246, 0.3)';
            let bannerColor = '#60a5fa';
            let msgKey = '';
            let defaultMsg = '';

            if (isEnvEqEst && isEnvEqSal && isEstEqSal) {
                // Case 6: ENV ≈ SAL ≈ EST (Zero-Based Balance)
                bannerBg = 'rgba(16, 185, 129, 0.1)';
                bannerBorder = 'rgba(16, 185, 129, 0.3)';
                bannerColor = '#34d399';
                msgKey = 'ai_sim_matrix_case6';
                defaultMsg = `💡 <strong>Équilibre parfait des flux :</strong> Vos enveloppes ({env}), vos dépenses réelles ({est}) et votre salaire ({sal}) sont parfaitement alignés.`;

            } else if ((ENV <= SAL || isEnvEqSal) && EST > (ENV + tolerance)) {
                // SITUATION : ENV <= SAL (y compris égalité) mais Dépenses réelles EST > ENV
                if (EST > (SAL + tolerance)) {
                    // Dépenses réelles dépassent le salaire ET l'enveloppe cible est égale ou inférieure au salaire
                    bannerBg = 'rgba(245, 158, 11, 0.12)';
                    bannerBorder = 'rgba(245, 158, 11, 0.35)';
                    bannerColor = '#fbbf24';
                    msgKey = 'ai_sim_matrix_case_effort_exceeded';
                    defaultMsg = `📊 <strong>Objectif d'épargne avec risque de dépassement :</strong> Vos enveloppes ({env}) ciblent un équilibre sur vos revenus ({sal}). Cependant, vos dépenses constatées ({est}) dépassent votre cible de +{gap}. Sans réduction effective de vos dépenses réelles, vos enveloppes risquent d'être systématiquement dépassées.`;
                } else {
                    // Dépenses réelles < SAL mais EST > ENV (Intention d'économie réaliste)
                    bannerBg = 'rgba(59, 130, 246, 0.1)';
                    bannerBorder = 'rgba(59, 130, 246, 0.3)';
                    bannerColor = '#60a5fa';
                    msgKey = 'ai_sim_matrix_case_effort_ok';
                    defaultMsg = `📊 <strong>Objectif d'épargne proactive :</strong> Vos enveloppes prévisionnelles ({env}) s'inscrivent -{gap} sous votre rythme de dépenses historique ({est}). Vous visez une économie réelle tout en gardant une capacité d'épargne estimée à +{savings} ({savingsPct}% des revenus).`;
                }

            } else if (EST <= ENV && (ENV <= SAL || isEnvEqSal)) {
                // Case 2: EST <= ENV <= SAL (Full Coverage & Safety margin)
                bannerBg = 'rgba(16, 185, 129, 0.1)';
                bannerBorder = 'rgba(16, 185, 129, 0.3)';
                bannerColor = '#34d399';
                msgKey = 'ai_sim_matrix_case2';
                defaultMsg = `✨ <strong>Structure budgétaire équilibrée :</strong> Vos enveloppes ({env}) couvrent vos dépenses historiques ({est}) tout en préservant une marge nette d'épargne de +{savings} ({savingsPct}% des revenus).`;

            } else if (EST < SAL && ENV > (SAL + tolerance)) {
                // Case 3: EST < SAL < ENV (Theoretical Over-allocation)
                const isHighOver = (ENV / Math.max(1, SAL)) > 1.15;
                bannerBg = isHighOver ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)';
                bannerBorder = isHighOver ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)';
                bannerColor = isHighOver ? '#f87171' : '#fbbf24';
                msgKey = 'ai_sim_matrix_case3';
                defaultMsg = `⚠️ <strong>Sur-allocation prévisionnelle :</strong> Le total de vos enveloppes ({env}) excède vos revenus de +{diff}. <em>Vos dépenses réelles historiques ({est}) restent sous votre salaire ({sal}).</em>`;

            } else if (SAL < ENV && ENV <= EST) {
                // Case 4: SAL < ENV <= EST (Deficit & Savings drawn)
                bannerBg = 'rgba(239, 68, 68, 0.12)';
                bannerBorder = 'rgba(239, 68, 68, 0.35)';
                bannerColor = '#f87171';
                msgKey = 'ai_sim_matrix_case4';
                defaultMsg = `🚨 <strong>Vigilance trésorerie & Épargne sollicitée :</strong> Vos enveloppes ({env}) et vos dépenses constatées ({est}) dépassent vos revenus repères ({sal}) de +{diff}. Sans ajustement de votre rythme réel, ce déficit nécessitera un prélèvement mensuel sur votre épargne.`;

            } else if (SAL < EST && EST < ENV) {
                // Case 5: SAL < EST < ENV (Amplified Deficit)
                bannerBg = 'rgba(239, 68, 68, 0.15)';
                bannerBorder = 'rgba(239, 68, 68, 0.4)';
                bannerColor = '#f87171';
                msgKey = 'ai_sim_matrix_case5';
                defaultMsg = `🚨 <strong>Tension sur les flux d'épargne :</strong> Vos dépenses réelles historiques ({est}) dépassent votre salaire de +{gapSal}. Vos enveloppes prévisionnelles ({env}) amplifient cet écart.`;

            } else {
                bannerBg = 'rgba(59, 130, 246, 0.1)';
                bannerBorder = 'rgba(59, 130, 246, 0.3)';
                bannerColor = '#60a5fa';
                msgKey = 'ai_sim_matrix_case2';
                defaultMsg = `✨ <strong>Structure budgétaire prévisionnelle :</strong> Vos enveloppes s'élèvent à {env} pour un salaire repère de {sal}.`;
            }

            const savings = Math.max(0, SAL - ENV);
            const savingsPct = SAL > 0 ? Math.round((savings / SAL) * 100) : 0;
            const diff = Math.abs(ENV - SAL);
            const gap = Math.abs(EST - ENV);
            const gapSal = Math.abs(EST - SAL);

            const msgText = (window.i18n.t(msgKey) || defaultMsg)
                .replace('{env}', `${formatCurrency(ENV)} €/m`)
                .replace('{sal}', `${formatCurrency(SAL)} €/m`)
                .replace('{est}', `${formatCurrency(EST)} €/m`)
                .replace('{diff}', `${formatCurrency(diff)} €/m`)
                .replace('{gap}', `${formatCurrency(gap)} €/m`)
                .replace('{gapSal}', `${formatCurrency(gapSal)} €/m`)
                .replace('{savings}', `${formatCurrency(savings)} €/m`)
                .replace('{savingsPct}', savingsPct)
                .replace('{months}', windowMonths);

            alertBanner.style.display = 'flex';
            alertBanner.style.alignItems = 'center';
            alertBanner.style.padding = '10px 14px';
            alertBanner.style.background = bannerBg;
            alertBanner.style.border = `1px solid ${bannerBorder}`;
            alertBanner.style.color = bannerColor;
            alertBanner.innerHTML = `<div style="font-size:12px;line-height:1.4;">${msgText}</div>`;
        }

        const yearlySalaryInput = document.getElementById('aiSimYearlySalaryInput');
        if (yearlySalaryInput && document.activeElement !== yearlySalaryInput) {
            yearlySalaryInput.value = regularYearlySalary.toFixed(2);
        }

        const yrCurValEl = document.getElementById('aiSimYearlyCurrentVal');
        if (yrCurValEl) yrCurValEl.textContent = `${formatCurrency(currentYearlyCapacity)}/an`;

        const yrImpValEl = document.getElementById('aiSimYearlyImpactVal');
        if (yrImpValEl) yrImpValEl.textContent = `+${formatCurrency(impactYearlyOnly)}/an`;

        const yrTotValEl = document.getElementById('aiSimYearlyTotalVal');
        if (yrTotValEl) {
            yrTotValEl.textContent = `${formatCurrency(totalProjectedYearly)}/an`;
            yrTotValEl.style.color = isExceededYearly ? '#ef4444' : '#c084fc';
        }

        const yrBarCur = document.getElementById('aiSimProgressBarYearlyCurrent');
        if (yrBarCur) {
            yrBarCur.style.width = `${currentPctYearly}%`;
            yrBarCur.style.background = isExceededYearly ? '#ef4444' : '#8b5cf6';
        }

        const yrBarImp = document.getElementById('aiSimProgressBarYearlyImpact');
        if (yrBarImp) {
            yrBarImp.style.left = `${currentPctYearly}%`;
            yrBarImp.style.width = `${Math.max(0, totalPctYearly - currentPctYearly)}%`;
            yrBarImp.style.background = isExceededYearly ? '#dc2626' : '#c084fc';
        }
    },

    updateCustomSalary(val) {
        const num = parseFloat(val);
        if (!isNaN(num) && num >= 0) {
            this.customSalaryOverride = num;
            this.customYearlySalaryOverride = num * 12.0;
            if (this.aiSuggestMeta) {
                this.aiSuggestMeta.regular_salary = num;
            }
            this.updateAiImpactSimulation();
            this.saveAiStateToSession();
        }
    },

    updateCustomYearlySalary(val) {
        const num = parseFloat(val);
        if (!isNaN(num) && num >= 0) {
            this.customYearlySalaryOverride = num;
            this.updateAiImpactSimulation();
            this.saveAiStateToSession();
        }
    },

    applyBadgeAmountToAiProposal(i, val) {
        if (!this.aiProposals || !this.aiProposals[i]) return;
        const p = this.aiProposals[i];
        const num = parseFloat(val);
        if (isNaN(num) || num < 0) return;

        if (p.is_fixed && !p.unlocked) {
            p.unlocked = true;
        }

        p.suggested_amount = Math.round(num * 100) / 100;

        const input = document.getElementById(`aiProposalAmount_${i}`);
        if (input) {
            input.value = p.suggested_amount.toFixed(2);
            input.disabled = false;
            input.style.opacity = '1';
        }

        this.updateAiImpactSimulation();
        this.renderAiProposalsList();
    },

    toggleUnlockFixedProposal(i) {
        if (!this.aiProposals || !this.aiProposals[i]) return;
        this.aiProposals[i].unlocked = !this.aiProposals[i].unlocked;
        const input = document.getElementById(`aiProposalAmount_${i}`);
        if (input) {
            if (this.aiProposals[i].unlocked) {
                input.disabled = false;
                input.style.opacity = '1';
                input.style.cursor = 'text';
                input.focus();
                input.select();
            } else {
                input.disabled = true;
                input.style.opacity = '0.65';
                input.style.cursor = 'not-allowed';
            }
        }
        this.renderAiProposalsList();
    },

    removeAiProposal(proposalIndex) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex]) return;
        const p = this.aiProposals[proposalIndex];

        if (!this.unclassifiedCategories) this.unclassifiedCategories = [];

        (p.categories || []).forEach(catName => {
            const exists = this.unclassifiedCategories.some(u => (typeof u === 'string' ? u : u.name) === catName);
            if (!exists) {
                this.unclassifiedCategories.push(catName);
            }
        });

        this.aiProposals.splice(proposalIndex, 1);
        this.renderAiProposalsList();
    },

    getCategoryHistMonthlyAmount(c, p) {
        let val = 0;
        const isYearly = p && (p.period === 'yearly' || p.suggested_period === 'yearly');
        if (p && p.cat_details && p.cat_details[c] && p.cat_details[c].amount !== undefined) {
            val = parseFloat(p.cat_details[c].amount) || 0;
            if (isYearly) val = val / 12.0; // ramener en mensuel si stocké en annuel
        } else if (p && p.cat_amounts && p.cat_amounts[c] !== undefined) {
            val = parseFloat(p.cat_amounts[c]) || 0;
        } else if (this.aiSuggestMeta && this.aiSuggestMeta.cat_averages && this.aiSuggestMeta.cat_averages[c] !== undefined) {
            val = Math.abs(this.aiSuggestMeta.cat_averages[c]) || 0;
        } else if (this.catAverages && this.catAverages[c] !== undefined) {
            val = Math.abs(this.catAverages[c]) || 0;
        }
        return val;
    },

    addCategoryToAiProposal(proposalIndex, categoryName) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex] || !categoryName) return;
        const p = this.aiProposals[proposalIndex];
        if (!p.categories) p.categories = [];
        if (p.categories.includes(categoryName)) return;

        const isYearly = (p.period || p.suggested_period) === 'yearly';

        // Somme des moyennes historiques des catégories qui ÉTAIENT présentes dans l'enveloppe
        const prevHistSum = p.categories.reduce((sum, c) => sum + this.getCategoryHistMonthlyAmount(c, p), 0);
        
        // Ratio d'ajustement actuel de l'IA (S_tot / H_tot)
        const ratio = prevHistSum > 0 ? (p.suggested_amount / (isYearly ? prevHistSum * 12.0 : prevHistSum)) : 1.0;

        p.categories.push(categoryName);

        // Valeur de la catégorie à ajouter
        const catHistVal = this.getCategoryHistMonthlyAmount(categoryName, p);
        const catValInPeriod = isYearly ? (catHistVal * 12.0) : catHistVal;

        // Déduction / Ajout au prorata de l'ajustement IA (Option 1)
        const addedVal = Math.round(catValInPeriod * ratio * 100) / 100;

        if (addedVal > 0 || p.suggested_amount === 0) {
            p.suggested_amount = Math.round((p.suggested_amount + (addedVal > 0 ? addedVal : catValInPeriod)) * 100) / 100;
            p.original_amount = Math.round(((p.original_amount || 0) + (addedVal > 0 ? addedVal : catValInPeriod)) * 100) / 100;
            if (!p.cat_amounts) p.cat_amounts = {};
            p.cat_amounts[categoryName] = catValInPeriod;
        }

        // Recalculer l'estimation historique lissée totale de l'enveloppe
        // getCategoryHistMonthlyAmount renvoie TOUJOURS une valeur mensuelle (en €/mois)
        const newHistMonthlySum = p.categories.reduce((sum, c) => sum + this.getCategoryHistMonthlyAmount(c, p), 0);
        p.historical_actual_amount = isYearly ? (newHistMonthlySum * 12.0) : newHistMonthlySum;

        if (this.unclassifiedCategories) {
            this.unclassifiedCategories = this.unclassifiedCategories.filter(c => (typeof c === 'string' ? c : c.name) !== categoryName);
        }

        if (this.wizardState && Array.isArray(this.wizardState.pendingCategories)) {
            this.wizardState.pendingCategories = this.wizardState.pendingCategories.filter(c => c !== categoryName);
        }

        this.renderAiProposalsList();
    },

    removeCategoryFromAiProposal(proposalIndex, categoryName) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex]) return;
        const p = this.aiProposals[proposalIndex];
        const isYearly = (p.period || p.suggested_period) === 'yearly';
        
        // Somme des moyennes historiques de toutes les catégories de l'enveloppe avant suppression
        const totalHistSum = (p.categories || []).reduce((sum, c) => sum + this.getCategoryHistMonthlyAmount(c, p), 0);

        p.categories = (p.categories || []).filter(c => c !== categoryName);
        
        if (!this.unclassifiedCategories) this.unclassifiedCategories = [];
        const exists = this.unclassifiedCategories.some(u => (typeof u === 'string' ? u : u.name) === categoryName);
        if (!exists) {
            this.unclassifiedCategories.push(categoryName);
        }

        if (this.wizardState && Array.isArray(this.wizardState.pendingCategories)) {
            if (!this.wizardState.pendingCategories.includes(categoryName)) {
                this.wizardState.pendingCategories.push(categoryName);
            }
        }

        const catHistVal = this.getCategoryHistMonthlyAmount(categoryName, p);
        const catValInPeriod = isYearly ? (catHistVal * 12.0) : catHistVal;

        let removedVal = 0;
        if (totalHistSum > 0 && p.suggested_amount > 0) {
            // Ratio au prorata (Option 1)
            const ratio = p.suggested_amount / (isYearly ? totalHistSum * 12.0 : totalHistSum);
            removedVal = Math.round(catValInPeriod * ratio * 100) / 100;
        } else if (p.categories.length > 0) {
            const oldLen = p.categories.length + 1;
            removedVal = p.suggested_amount / oldLen;
        } else {
            removedVal = p.suggested_amount;
        }

        if (removedVal > 0) {
            p.suggested_amount = Math.max(0, Math.round((p.suggested_amount - removedVal) * 100) / 100);
            p.original_amount = Math.max(0, Math.round(((p.original_amount || 0) - removedVal) * 100) / 100);
        }

        if (p.categories.length === 0) {
            p.suggested_amount = 0;
            p.historical_actual_amount = 0;
            p.selected = false;
        } else {
            const newHistSum = p.categories.reduce((sum, c) => sum + this.getCategoryHistMonthlyAmount(c, p), 0);
            p.historical_actual_amount = isYearly ? (newHistSum * 12.0) : newHistSum;
        }

        this.renderAiProposalsList();
    },

    renderAiProposalsList() {
        const panel = document.getElementById('budgetAiPanel');
        const container = document.getElementById('budgetAiProposals');
        const simulator = document.getElementById('aiBudgetSimulator');

        const proposals = this.aiProposals || [];
        const unclassified = this.unclassifiedCategories || [];

        if (sessionStorage.getItem('budget_ai_panel_closed') === 'true' || (!proposals.length && !unclassified.length)) {
            if (panel) panel.style.display = 'none';
            return;
        }
        if (panel) panel.style.display = 'block';

        const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) || 3;
        this.updateAiWindowButtonsState(windowMonths);

        if (simulator) {
            simulator.style.display = (proposals.length || unclassified.length) ? 'block' : 'none';
        }

        if (!proposals.length && !unclassified.length) {
            container.innerHTML = `<p style="color:var(--text-muted);padding:10px;">${window.i18n.t('budget_ai_no_proposals') || 'Aucune nouvelle proposition.'}</p>`;
            return;
        }

        const allUsedProposalCats = new Set();
        proposals.forEach(prop => {
            (prop.categories || []).forEach(c => allUsedProposalCats.add(c));
        });

        const existingBudgetCats = new Set();
        (this.budgets || []).forEach(b => {
            if (!b.is_closed) {
                (b.categories || []).forEach(c => existingBudgetCats.add(c));
            }
        });

        proposals.forEach(p => {
            if (p.selected === undefined) p.selected = true;
        });

        const monthlyProposals = proposals.map((p, origIndex) => ({ ...p, origIndex })).filter(p => (p.period || p.suggested_period || 'monthly') === 'monthly');
        const yearlyProposals = proposals.map((p, origIndex) => ({ ...p, origIndex })).filter(p => (p.period || p.suggested_period) === 'yearly');

        const renderProposalCard = (p, i) => {
            const proposalRealIndex = p.origIndex !== undefined ? p.origIndex : i;
            const isYearly = (p.period || p.suggested_period) === 'yearly';
            
            // Vérifier si toutes les catégories actuelles sont réellement fixes
            if (p.categories && p.categories.length > 0) {
                const allCatsFixed = p.categories.every(c => {
                    const dt = p.cat_details ? p.cat_details[c] : null;
                    if (dt && dt.is_fixed !== undefined) return dt.is_fixed;
                    if (this.allCatDetails && this.allCatDetails[c] && this.allCatDetails[c].is_fixed !== undefined) return this.allCatDetails[c].is_fixed;
                    return false;
                });
                p.is_fixed = allCatsFixed;
            }

            const bgTint = isYearly ? 'background:rgba(139, 92, 246, 0.04);border:1px solid rgba(139, 92, 246, 0.25);' : 'background:var(--bg-body);border:1px solid var(--border-color);';
            const periodBadge = isYearly 
                ? `<span style="font-size:10px;background:rgba(139, 92, 246, 0.15);color:#c084fc;padding:1px 6px;border-radius:4px;border:1px solid rgba(139, 92, 246, 0.4);font-weight:600;">📅 Annuelle</span>`
                : `<span style="font-size:10px;background:rgba(59, 130, 246, 0.15);color:#60a5fa;padding:1px 6px;border-radius:4px;border:1px solid rgba(59, 130, 246, 0.4);font-weight:600;">⚡ Mensuelle</span>`;

            const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#6366f1', '#a855f7', '#84cc16', '#f97316'];
            const catList = (p.categories || []).map(c => {
                let amt = 0;
                if (p.cat_details && p.cat_details[c] && p.cat_details[c].amount !== undefined) {
                    amt = parseFloat(p.cat_details[c].amount) || 0;
                } else if (p.cat_amounts && p.cat_amounts[c] !== undefined) {
                    amt = parseFloat(p.cat_amounts[c]) || 0;
                } else if (this.catAverages && this.catAverages[c] !== undefined) {
                    amt = Math.abs(this.catAverages[c]) || 0;
                }
                return { name: c, amount: amt };
            });
            catList.sort((a, b) => b.amount - a.amount);
            const colorMap = {};
            catList.forEach((item, idx) => {
                colorMap[item.name] = palette[idx % palette.length];
            });

            // Badges triés par montant décroissant (même ordre que la barre segmentée)
            const categoryBadgesHtml = catList.map((item, catIndex) => {
                const c = item.name;
                const details = (p.cat_details && p.cat_details[c]) ? p.cat_details[c] : null;
                let tooltipText = c;
                let catAmtStr = item.amount > 0 ? ` (${formatCurrency(item.amount)})` : '';
                if (details) {
                    const unitStr = p.period === 'yearly' ? '€/an' : '€/mois';
                    const merchantsLabel = window.i18n.t('ai_budget_tooltip_merchants') || "Exemples d'opérations :";
                    const merchantsStr = details.top_descs && details.top_descs.length ? `\n${merchantsLabel} ${details.top_descs.join(', ')}` : '';
                    tooltipText = `📊 ${c} : ${formatCurrency(item.amount)} ${unitStr}${merchantsStr}`;
                } else if (item.amount > 0) {
                    tooltipText = `📊 ${c} : ${formatCurrency(item.amount)}`;
                }
                const activeColor = colorMap[c] || '#3b82f6';

                return `
                    <span id="aiBadge_${proposalRealIndex}_${catIndex}"
                          class="ai-cat-badge" 
                          data-proposal-idx="${proposalRealIndex}" 
                          data-cat-idx="${catIndex}"
                          title="${tooltipText.replace(/"/g, '&quot;')}" 
                          style="background:var(--bg-surface);border:1px solid var(--border-color);padding:3px 9px;border-radius:12px;font-size:11px;color:var(--text-main);display:inline-flex;align-items:center;gap:6px;cursor:help;transition:all 0.25s ease;"
                          onmouseenter="window.BudgetsView.highlightAiCategory(${proposalRealIndex}, ${catIndex}, '${activeColor}')"
                          onmouseleave="window.BudgetsView.unhighlightAiCategory(${proposalRealIndex}, ${catIndex})">
                        <span class="ai-cat-dot" style="width:7px;height:7px;border-radius:50%;background:rgba(145,158,171,0.5);display:inline-block;flex-shrink:0;transition:all 0.25s ease;"></span>
                        <span>${c}</span>
                        <strong style="color:var(--text-muted);font-size:10.5px;font-weight:600;">${catAmtStr}</strong>
                        <button onclick="event.stopPropagation(); window.BudgetsView.removeCategoryFromAiProposal(${proposalRealIndex}, '${c.replace(/'/g, "\\'")}')" aria-label="Retirer la catégorie ${c.replace(/"/g, '')}" style="cursor:pointer;color:#ef4444;font-weight:bold;margin-left:2px;font-size:11px;background:none;border:none;padding:0;line-height:1;">✕</button>
                    </span>
                `;
            }).join('');

            const currentCats = p.categories || [];
            const availableCats = (this.categories || []).filter(c => {
                const isExcludedType = c.type === 'income' || c.type === 'neutral' || c.type === 'transfer' || c.type === 'Recettes' || c.type === 'Transfert' || c.type === 'Neutre';
                const isUsedInAnyProposal = allUsedProposalCats.has(c.name);
                const isUsedInActiveBudget = existingBudgetCats.has(c.name);
                const hasSpending = (this.catAverages && this.catAverages[c.name] && Math.abs(this.catAverages[c.name]) > 0.01);
                return !isExcludedType && !isUsedInAnyProposal && !isUsedInActiveBudget && !currentCats.includes(c.name) && hasSpending;
            });

            let addCatSelectHtml = '';
            if (availableCats.length > 0) {
                const addCatLabel = window.i18n.t('ai_budget_add_category') || '➕ Catégorie';
                addCatSelectHtml = `
                    <select onchange="if(this.value){ window.BudgetsView.addCategoryToAiProposal(${proposalRealIndex}, this.value); }" 
                            style="background:var(--bg-surface);border:1px dashed var(--accent);color:var(--accent);padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;outline:none;max-width:160px;text-overflow:ellipsis;"
                            title="${window.i18n.t('ai_budget_add_category') || 'Ajouter une catégorie inutilisée'}">
                        <option value="" disabled selected>${addCatLabel}</option>
                        ${availableCats.map(c => {
                            const avg = (this.catAverages && this.catAverages[c.name]) ? Math.abs(this.catAverages[c.name]) : 0;
                            const avgStr = avg > 0 ? ` (${formatCurrency(avg)})` : '';
                            return `<option value="${c.name.replace(/"/g, '&quot;')}">${c.name}${avgStr}</option>`;
                        }).join('')}
                    </select>
                `;
            }

            return `
                <div id="aiProposal_${proposalRealIndex}" style="${bgTint}border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:6px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:240px;">
                            <input type="checkbox" class="ai-proposal-checkbox" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent);" ${p.selected ? 'checked' : ''} onchange="window.BudgetsView.toggleAiProposal(${proposalRealIndex}, this.checked)">
                            
                            <div style="display:flex;flex-direction:column;gap:2px;">
                                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                    <input type="text" 
                                           value="${p.name.replace(/"/g, '&quot;')}" 
                                           style="font-size:13px;font-weight:700;color:var(--text-main);background:transparent;border:1px solid transparent;border-radius:4px;padding:1px 4px;outline:none;transition:all 0.2s ease;max-width:280px;" 
                                           onfocus="this.style.background='var(--bg-surface)'; this.style.borderColor='var(--accent)';"
                                           onblur="this.style.background='transparent'; this.style.borderColor='transparent';"
                                           onchange="window.BudgetsView.updateAiProposalName(${proposalRealIndex}, this.value)"
                                           title="Cliquer pour modifier le nom de l'enveloppe">
                                    ${periodBadge}
                                    ${p.is_fixed ? `<span style="font-size:10px;background:#1e293b;color:#38bdf8;padding:1px 6px;border-radius:4px;border:1px solid #0284c7;" title="Charge fixe contractuelle non modifiable">${window.i18n.t('ai_budget_fixed_badge') || 'Fixe'}</span>` : ''}
                                    ${p.has_fixed_mix ? `<span style="font-size:10px;background:#1e293b;color:#38bdf8;padding:1px 6px;border-radius:4px;border:1px solid #0284c7;" title="Inclut ${p.fixed_sum}€/mois de charges fixes contractuelles">Inclut ${p.fixed_sum}€ fixe</span>` : ''}
                                    ${p.is_exceptional ? `<span style="font-size:10px;background:#312e81;color:#a5b4fc;padding:1px 6px;border-radius:4px;border:1px solid #4338ca;" title="Dépense ponctuelle / projet">${window.i18n.t('ai_budget_project_badge') || 'Projet'}</span>` : ''}
                                </div>
                            </div>
                        </div>

                        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;">
                            ${(() => {
                                const envLimit = p.suggested_amount;
                                
                                const curSpentSum = (p.categories || []).reduce((sum, c) => {
                                    let val = 0;
                                    if (p.cat_details && p.cat_details[c] && p.cat_details[c].current_month_spent !== undefined) {
                                        val = p.cat_details[c].current_month_spent;
                                    } else if (this.allCatDetails && this.allCatDetails[c] && this.allCatDetails[c].current_month_spent !== undefined) {
                                        val = this.allCatDetails[c].current_month_spent;
                                    }
                                    const parsed = parseFloat(val);
                                    return sum + (isNaN(parsed) ? 0 : parsed);
                                }, 0);

                                const paceAvgSum = (p.categories || []).reduce((sum, c) => {
                                    let val = 0;
                                    if (p.cat_amounts && p.cat_amounts[c] !== undefined) {
                                        val = p.cat_amounts[c];
                                    } else if (this.aiSuggestMeta && this.aiSuggestMeta.cat_averages && this.aiSuggestMeta.cat_averages[c] !== undefined) {
                                        const monthlyAvg = Math.abs(this.aiSuggestMeta.cat_averages[c]);
                                        val = isYearly ? (monthlyAvg * 12.0) : monthlyAvg;
                                    } else if (this.catAverages && this.catAverages[c] !== undefined) {
                                        const monthlyAvg = Math.abs(this.catAverages[c]);
                                        val = isYearly ? (monthlyAvg * 12.0) : monthlyAvg;
                                    }
                                    const parsed = parseFloat(val);
                                    return sum + (isNaN(parsed) ? 0 : parsed);
                                }, 0);

                                const valCur = isYearly ? (curSpentSum * 12.0) : curSpentSum;
                                const valPace = paceAvgSum;

                                const isCurrentExceeded = (valCur - envLimit) > 0.05;
                                const isPaceExceeded = (valPace - envLimit) > 0.05;

                                const labelCur = isYearly 
                                    ? (window.i18n.t('budget_spent_this_year') || 'Constaté (an) :')
                                    : (window.i18n.t('budget_spent_this_month') || 'Constaté ce mois :');

                                const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) ? this.aiSuggestMeta.window_months : 3;
                                const labelPaceKey = isYearly ? 'budget_pace_yearly' : `budget_pace_${windowMonths}m`;
                                const labelPace = isYearly
                                    ? window.i18n.t('budget_pace_yearly', 'Moyenne annuelle :')
                                    : window.i18n.t(labelPaceKey, `Moyenne (${windowMonths}m) :`);

                                const applyTitleCur = (window.i18n.t('ai_budget_badge_click_apply') || 'Cliquer pour utiliser le montant {amount} pour cette enveloppe').replace('{amount}', formatCurrency(valCur));
                                const applyTitlePace = (window.i18n.t('ai_budget_badge_click_apply') || 'Cliquer pour utiliser le montant {amount} pour cette enveloppe').replace('{amount}', formatCurrency(valPace));

                                const badgeCurrentHtml = `
                                    <span onclick="window.BudgetsView.applyBadgeAmountToAiProposal(${proposalRealIndex}, ${valCur})" style="cursor:pointer;font-size:11px;background:var(--bg-base);padding:3px 8px;border-radius:6px;border:1px solid ${isCurrentExceeded ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-color)'};color:${isCurrentExceeded ? '#f87171' : 'var(--text-muted)'};transition:all 0.15s ease;" title="${applyTitleCur}">
                                        ${labelCur} <strong style="text-decoration:underline;text-decoration-style:dotted;">${formatCurrency(valCur)}</strong>
                                    </span>
                                `;

                                const badgePaceHtml = `
                                    <span onclick="window.BudgetsView.applyBadgeAmountToAiProposal(${proposalRealIndex}, ${valPace})" style="cursor:pointer;font-size:11px;background:var(--bg-base);padding:3px 8px;border-radius:6px;border:1px solid ${isPaceExceeded ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-color)'};color:${isPaceExceeded ? '#f87171' : 'var(--text-muted)'};transition:all 0.15s ease;" title="${applyTitlePace}">
                                        ${labelPace} <strong style="text-decoration:underline;text-decoration-style:dotted;">${formatCurrency(valPace)}</strong>
                                    </span>
                                `;

                                return badgeCurrentHtml + badgePaceHtml;
                            })()}
                            <div style="display:flex;flex-direction:column;align-items:flex-end;">
                                <input id="aiProposalAmount_${proposalRealIndex}" type="number" step="0.01" value="${p.suggested_amount.toFixed(2)}" ${(p.is_fixed && !p.unlocked) ? `disabled title="${window.i18n.t('ai_budget_unlock_fixed_help') || 'Charge fixe contractuelle. Cliquez sur le crayon ✏️ pour autoriser la modification manuelle.'}"` : ''} style="width:95px;text-align:right;font-size:13px;font-weight:700;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:${(p.is_fixed && !p.unlocked) ? 'var(--bg-base)' : 'var(--bg-surface)'};color:${isYearly ? '#c084fc' : 'var(--accent)'}; ${(p.is_fixed && !p.unlocked) ? 'opacity:0.65;cursor:not-allowed;' : ''}" oninput="window.BudgetsView.updateAiProposalAmount(${proposalRealIndex}, this.value)">
                                ${isYearly ? `
                                    <span id="aiProposalSmoothed_${proposalRealIndex}" style="font-size:10px;color:var(--text-muted);font-weight:600;margin-top:1px;">
                                        (${formatCurrency(p.suggested_amount / 12.0)} €/m)
                                    </span>
                                ` : ''}
                            </div>
                            ${p.is_fixed ? `
                                <button type="button" class="btn btn-secondary" onclick="window.BudgetsView.toggleUnlockFixedProposal(${proposalRealIndex})" style="padding:3px 6px;font-size:11px;background:transparent;border:1px solid ${p.unlocked ? 'rgba(54,179,126,0.4)' : 'rgba(56,189,248,0.4)'};color:${p.unlocked ? '#36b37e' : '#38bdf8'};cursor:pointer;margin-left:2px;" title="${p.unlocked ? 'Verrouiller le montant fixe' : (window.i18n.t('ai_budget_unlock_fixed_help') || 'Charge fixe contractuelle. Cliquez sur le crayon pour autoriser la modification manuelle.')}">
                                    ${p.unlocked ? '🔓' : '✏️'}
                                </button>
                            ` : ''}
                            <span id="aiProposalUnit_${proposalRealIndex}" style="font-size:12px;color:${isYearly ? '#c084fc' : 'var(--text-muted)'};font-weight:600;">${isYearly ? (window.i18n.t('budget_unit_yearly') || '€/an') : (window.i18n.t('budget_unit_monthly') || '€/mois')}</span>
                            <button class="btn btn-secondary" onclick="window.BudgetsView.removeAiProposal(${proposalRealIndex})" style="padding:3px 7px;font-size:11px;color:#ef4444;border-color:rgba(239,68,68,0.3);background:transparent;margin-left:4px;" title="${window.i18n.t('ai_budget_delete_proposal') || 'Supprimer la suggestion'}">✕</button>
                        </div>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--text-muted);padding-top:4px;border-top:1px dashed var(--border-color);">
                        ${(p.justification || p.reason) ? `
                            <div style="display:flex;align-items:flex-start;gap:4px;">
                                <span style="flex-shrink:0;margin-top:1px;">ℹ️</span> <span>${p.justification || p.reason}</span>
                            </div>
                        ` : ''}

                        <!-- Barre Multi-couleurs Segmentée par Catégorie (triée décroissante) -->
                        ${(() => {
                            const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#6366f1', '#a855f7', '#84cc16', '#f97316'];
                            const catList = (p.categories || []).map(c => {
                                let amt = 0;
                                if (p.cat_details && p.cat_details[c] && p.cat_details[c].amount !== undefined) {
                                    amt = parseFloat(p.cat_details[c].amount) || 0;
                                } else if (p.cat_amounts && p.cat_amounts[c] !== undefined) {
                                    amt = parseFloat(p.cat_amounts[c]) || 0;
                                } else if (this.catAverages && this.catAverages[c] !== undefined) {
                                    amt = Math.abs(this.catAverages[c]) || 0;
                                }
                                return { name: c, amount: amt };
                            });

                            catList.sort((a, b) => b.amount - a.amount);
                            const totalSpent = catList.reduce((sum, item) => sum + item.amount, 0);
                            const maxRef = Math.max(p.suggested_amount, totalSpent, 0.01);

                            if (!catList.length) return '';

                            return `
                                <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px;margin-bottom:6px;">
                                    <div style="position:relative;height:10px;width:100%;background:rgba(255,255,255,0.06);border-radius:6px;overflow:hidden;display:flex;gap:1.5px;border:1px solid var(--border-color);" title="Répartition des catégories (de la plus grande à la plus petite)">
                                        ${catList.map((item, idx) => {
                                            const pct = (item.amount / maxRef) * 100;
                                            if (pct <= 0) return '';
                                            const color = palette[idx % palette.length];
                                            const details = (p.cat_details && p.cat_details[item.name]) ? p.cat_details[item.name] : null;
                                            let tooltipText = `${item.name} : ${item.amount.toFixed(2)}€ (${pct.toFixed(1)}%)`;
                                            if (details && details.outlier_excess > 0) {
                                                const outlierMsg = (window.i18n && window.i18n.t)
                                                    ? window.i18n.t('ai_budget_tooltip_outlier_excess', "📌 Écrêtage appliqué: +{amount}€ de dépenses ponctuelles d'exception isolées").replace('{amount}', details.outlier_excess.toFixed(2))
                                                    : `\n📌 Écrêtage appliqué: +${details.outlier_excess.toFixed(2)}€ de dépenses ponctuelles d'exception isolées`;
                                                tooltipText += `\n${outlierMsg}`;
                                            }
                                            if (details && details.top_descs && details.top_descs.length) {
                                                tooltipText += `\nExemples: ${details.top_descs.join(', ')}`;
                                            }

                                            const amtFormatted = `${item.amount.toFixed(0)}€`;
                                            const fitsInside = pct >= 5;
                                            const labelHtml = fitsInside ? `<span style="font-size:9.5px;font-weight:700;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 3px;text-shadow:0 1px 2px rgba(0,0,0,0.7);">${item.name} (${amtFormatted})</span>` : '';

                                            return `
                                                <div id="aiSeg_${proposalRealIndex}_${idx}"
                                                     class="ai-seg-item ai-seg-muted"
                                                     data-color="${color}"
                                                     style="position:relative;width:${pct}%;height:100%;background:rgba(145,158,171,0.25);border-radius:3px;display:flex;align-items:center;justify-content:center;transition:all 0.25s ease;cursor:help;opacity:0.75;" 
                                                     title="${tooltipText.replace(/"/g, '&quot;')}"
                                                     onmouseenter="window.BudgetsView.highlightAiCategory(${proposalRealIndex}, ${idx}, '${color}')"
                                                     onmouseleave="window.BudgetsView.unhighlightAiCategory(${proposalRealIndex}, ${idx})">
                                                     ${labelHtml}
                                                 </div>
                                             `;
                                        }).join('')}
                                    </div>
                                </div>
                            `;
                        })()}

                        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:2px;">
                            ${categoryBadgesHtml}
                            ${addCatSelectHtml}
                        </div>
                    </div>
                </div>
            `;
        };

        let html = '';

        if (monthlyProposals.length > 0) {
            html += `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#60a5fa;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(59, 130, 246, 0.3);">
                        <span data-i18n="ai_budget_section_monthly">${window.i18n.t('ai_budget_section_monthly') || '⚡ Enveloppes Mensuelles'}</span> <span>(${monthlyProposals.length})</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${monthlyProposals.map(renderProposalCard).join('')}
                    </div>
                </div>
            `;
        }

        if (yearlyProposals.length > 0) {
            html += `
                <div style="margin-top:16px;margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#c084fc;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(139, 92, 246, 0.3);">
                        <span data-i18n="ai_budget_section_yearly">${window.i18n.t('ai_budget_section_yearly') || '📅 Enveloppes Annuelles'}</span> <span>(${yearlyProposals.length})</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${yearlyProposals.map(renderProposalCard).join('')}
                    </div>
                </div>
            `;
        }

        html += this.renderAiUnclassifiedPanelHtml();

        container.innerHTML = html;

        this.updateAiImpactSimulation();
        this.saveAiStateToSession();
    },

    renderAiUnclassifiedPanelHtml() {
        const unclassified = this.unclassifiedCategories || [];
        if (!unclassified.length) return '';

        const proposals = this.aiProposals || [];

        const unclassifiedBadges = unclassified.map((uItem) => {
            const name = typeof uItem === 'string' ? uItem : uItem.name;
            const avg = typeof uItem === 'object' && uItem.avg ? uItem.avg : (this.catAverages && this.catAverages[name] ? Math.abs(this.catAverages[name]) : 0);
            const avgStr = avg > 0 ? ` (${formatCurrency(avg)}/mois)` : '';

            let tooltipText = name;
            const details = (this.allCatDetails && this.allCatDetails[name])
                ? this.allCatDetails[name]
                : ((this.aiSuggestMeta && this.aiSuggestMeta.unclassified_details && this.aiSuggestMeta.unclassified_details[name]) 
                    ? this.aiSuggestMeta.unclassified_details[name] 
                    : ((this.aiSuggestMeta && this.aiSuggestMeta.cat_details && this.aiSuggestMeta.cat_details[name]) ? this.aiSuggestMeta.cat_details[name] : null));

            if (details) {
                const amountVal = (details.amount !== undefined) ? formatCurrency(details.amount) : (avg > 0 ? formatCurrency(avg) : '0,00 €');
                const merchantsLabel = window.i18n.t('ai_budget_tooltip_merchants') || "Exemples d'opérations :";
                const merchantsStr = details.top_descs && details.top_descs.length ? `\n${merchantsLabel} ${details.top_descs.join(', ')}` : '';
                tooltipText = `📊 ${name} : ${amountVal}/mois${merchantsStr}`;
            } else if (avg > 0) {
                tooltipText = `📊 ${name} : ${formatCurrency(avg)}/mois`;
            }

            let assignOptions = proposals.map((p, pIdx) => `<option value="${pIdx}">${p.name}</option>`).join('');

            return `
                <div style="background:var(--bg-surface);border:1px solid var(--border-color);padding:8px 12px;border-radius:8px;display:flex;align-items:center;gap:10px;font-size:12px;"
                     title="${tooltipText.replace(/"/g, '&quot;')}" style="cursor:help;">
                    <span style="font-weight:600;color:var(--text-main);cursor:help;" title="${tooltipText.replace(/"/g, '&quot;')}">📌 ${name}${avgStr}</span>
                    <select onchange="if(this.value!==''){ window.BudgetsView.assignUnclassifiedCategory('${name.replace(/'/g, "\\'")}', parseInt(this.value)); }" 
                            style="background:var(--bg-base);border:1px solid var(--border-color);color:var(--accent);padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;outline:none;max-width:220px;"
                            title="${window.i18n.t('ai_budget_assign_to') || 'Ajouter à une enveloppe...'}">
                        <option value="" disabled selected>${window.i18n.t('ai_budget_assign_to') || 'Ajouter à une enveloppe...'}</option>
                        ${assignOptions}
                    </select>
                </div>
            `;
        }).join('');

        return `
            <div id="aiUnclassifiedPanel" style="background:var(--bg-base);border:1px dashed var(--accent);border-radius:10px;padding:14px 16px;margin-top:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                    <strong style="color:var(--accent);font-size:13px;">
                        ${(window.i18n.t('ai_budget_unclassified_title') || '📌 Catégories non classées')} (${unclassified.length})
                    </strong>
                    <button id="btnAiRefine" class="btn btn-secondary" onclick="window.BudgetsView.refineUnclassifiedWithAi()" style="padding:4px 12px;font-size:12px;font-weight:600;color:var(--accent);border-color:var(--accent);background:var(--bg-surface);">
                        ${window.i18n.t('ai_budget_btn_refine') || '🪄 Affiner les omises avec l\'IA'}
                    </button>
                </div>
                <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px 0;">
                    ${window.i18n.t('ai_budget_unclassified_subtitle') || 'Ces catégories contiennent des dépenses réelles mais n\'ont pas été incluses dans les enveloppes proposées par l\'IA.'}
                </p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    ${unclassifiedBadges}
                </div>
            </div>
        `;
    },

    assignUnclassifiedCategory(catName, proposalIndex) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex]) return;
        this.addCategoryToAiProposal(proposalIndex, catName);
        this.unclassifiedCategories = (this.unclassifiedCategories || []).filter(u => (typeof u === 'string' ? u : u.name) !== catName);
        this.renderAiProposalsList();
    },

    async refineUnclassifiedWithAi() {
        if (!this.unclassifiedCategories || !this.unclassifiedCategories.length) return;
        const btn = document.getElementById('btnAiRefine');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:13px;height:13px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('ai_budget_refining') || 'Affinage IA en cours...'}`;
        }

        try {
            const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) ? this.aiSuggestMeta.window_months : 3;
            const formattedUnclassified = (this.unclassifiedCategories || []).map(u => {
                if (typeof u === 'string') {
                    const name = u;
                    const avg = (this.catAverages && this.catAverages[name]) ? Math.abs(this.catAverages[name]) : 0;
                    return { name: name, avg: avg };
                }
                return { name: u.name || String(u), avg: u.avg || 0 };
            });

            const formattedProposals = (this.aiProposals || []).map(p => ({
                name: p.name || '',
                categories: p.categories || [],
                cat_amounts: p.cat_amounts || {},
                cat_details: p.cat_details || {},
                suggested_amount: p.suggested_amount || 0,
                historical_actual_amount: p.historical_actual_amount !== undefined ? p.historical_actual_amount : p.suggested_amount,
                original_amount: p.original_amount !== undefined ? p.original_amount : p.suggested_amount,
                suggested_period: p.suggested_period || p.period || 'monthly',
                is_fixed: !!p.is_fixed,
                justification: p.justification || p.reason || '',
                reason: p.justification || p.reason || ''
            }));

            const currentLang = (window.i18n && window.i18n.currentLang) ? window.i18n.currentLang : 'fr';
            const sensitivity = this.currentOutlierSensitivity || 2;
            const res = await API.post('/api/budgets/ai_suggest/refine', {
                window_months: windowMonths,
                lang: currentLang,
                outlier_sensitivity: sensitivity,
                existing_proposals: formattedProposals,
                unclassified_categories: formattedUnclassified
            });

            if (res && res.proposals) {
                this.aiProposals = res.proposals.map(p => {
                    const pPeriod = p.suggested_period || p.period || 'monthly';
                    const isYearly = pPeriod === 'yearly';
                    const monthlySum = (p.categories || []).reduce((sum, c) => sum + this.getCategoryHistMonthlyAmount(c, p), 0);
                    const calcHistAmt = isYearly ? (monthlySum * 12.0) : monthlySum;
                    return {
                        ...p,
                        cat_amounts: p.cat_amounts || {},
                        original_amount: p.original_amount !== undefined ? p.original_amount : p.suggested_amount,
                        historical_actual_amount: calcHistAmt > 0 ? (Math.round(calcHistAmt * 100) / 100) : (p.historical_actual_amount !== undefined ? p.historical_actual_amount : p.suggested_amount),
                        justification: p.justification || p.reason || '',
                        period: pPeriod,
                        selected: true
                    };
                });
                this.unclassifiedCategories = res.unclassified_categories || [];
                this.renderAiProposalsList();
            }
        } catch(e) {
            const msg = (e.message && e.message !== 'Internal Server Error') ? e.message : 'Une erreur serveur est survenue lors de l\'affinage IA. Veuillez réessayer.';
            showInlineMessage(window.i18n.t('title_error'), msg);
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    highlightAiCategory(proposalIdx, catIdx, activeColor, isWizard = false) {
        const prefix = isWizard ? 'wiz' : 'ai';
        const seg = document.getElementById(`${prefix}Seg_${proposalIdx}_${catIdx}`);
        const badge = document.getElementById(`${prefix}Badge_${proposalIdx}_${catIdx}`);

        if (seg) {
            seg.classList.remove('ai-seg-muted');
            seg.classList.add('ai-seg-active');
            seg.style.background = activeColor;
            seg.style.color = activeColor;
            seg.style.opacity = '1';
        }

        if (badge) {
            badge.style.borderColor = activeColor;
            badge.style.boxShadow = `0 0 8px ${activeColor}40`;
            const dot = badge.querySelector('.ai-cat-dot');
            if (dot) {
                dot.style.background = activeColor;
                dot.style.boxShadow = `0 0 6px ${activeColor}`;
            }
        }
    },

    unhighlightAiCategory(proposalIdx, catIdx, isWizard = false) {
        const prefix = isWizard ? 'wiz' : 'ai';
        const seg = document.getElementById(`${prefix}Seg_${proposalIdx}_${catIdx}`);
        const badge = document.getElementById(`${prefix}Badge_${proposalIdx}_${catIdx}`);

        if (seg) {
            seg.classList.add('ai-seg-muted');
            seg.classList.remove('ai-seg-active');
            seg.style.background = 'rgba(145,158,171,0.25)';
            seg.style.color = '';
            seg.style.opacity = '0.75';
        }

        if (badge) {
            badge.style.borderColor = 'var(--border-color)';
            badge.style.boxShadow = 'none';
            const dot = badge.querySelector('.ai-cat-dot');
            if (dot) {
                dot.style.background = 'rgba(145,158,171,0.5)';
                dot.style.boxShadow = 'none';
            }
        }
    },

    async acceptSelectedProposals() {
        const btn = document.getElementById('budgetAiAcceptSelectedBtn');
        const proposals = (this.aiProposals || []).filter(p => p.selected);

        if (!proposals.length) {
            showInlineMessage(window.i18n.t('title_info'), 'Veuillez cocher au moins une enveloppe à créer.');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('budget_ai_accepting_all') || 'Création...'}`;
        }

        let count = 0;
        const createdNames = new Set();
        try {
            for (const p of proposals) {
                await API.post('/api/budgets/', {
                    name: p.name,
                    monthly_amount: p.suggested_amount,
                    period: p.period || 'monthly',
                    is_project: false,
                    categories: p.categories || [],
                });
                count++;
                createdNames.add(p.name);
            }

            this.aiProposals = (this.aiProposals || []).filter(p => !createdNames.has(p.name));
            if (!this.aiProposals.length) {
                this.closeAiPanel();
            } else {
                this.renderAiProposalsList();
            }

            await this.loadBudgets();
            await this.loadAllStatuses();
            window.app.refreshSidebar();
            showInlineMessage(window.i18n.t('title_info'), `${count} enveloppe(s) créée(s) avec succès !`);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message || 'Erreur lors de la création des enveloppes.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = window.i18n.t('ai_budget_accept_selected') || '✨ Créer les enveloppes sélectionnées';
            }
        }
    },

    async acceptProposal(idx, proposal) {
        const btn = document.querySelector(`#aiProposal_${idx} button.btn-primary`);
        if(btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('budget_ai_creating')}`;
        }

        try {
            await API.post('/api/budgets/', {
                name: proposal.name,
                monthly_amount: proposal.suggested_amount,
                period: proposal.period || 'monthly',
                is_project: false,
                categories: proposal.categories || [],
            });
            
            this._pendingHighlightName = proposal.name;

            if (this.aiProposals) {
                this.aiProposals = this.aiProposals.filter(p => p.name !== proposal.name);
            }

            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();

            if (!this.aiProposals || !this.aiProposals.length) {
                this.closeAiPanel();
            } else {
                this.renderAiProposalsList();
            }
            
            if(btn) {
                btn.innerHTML = window.i18n.t('msg_envelope_created_badge');
                btn.style.backgroundColor = '#10b981';
                btn.style.borderColor = '#10b981';
                btn.style.color = 'white';
            }
            
            setTimeout(() => {
                const card = document.getElementById(`aiProposal_${idx}`);
                if (card) {
                    card.style.transition = 'opacity 0.4s ease';
                    card.style.opacity = '0';
                    setTimeout(() => card.style.display = 'none', 400);
                }
            }, 2000);
            
        } catch(e) {
            if(btn) {
                btn.disabled = false;
                btn.innerHTML = window.i18n.t('budget_ai_create_error');
            }
            showInlineMessage(window.i18n.t('title_error'), e.message || window.i18n.t('budget_ai_create_fail'));
        }
    },

    closeAiPanel() {
        sessionStorage.setItem('budget_ai_panel_closed', 'true');
        this.clearAiStateFromSession();
        this.aiProposals = [];
        this.unclassifiedCategories = [];
        const panel = document.getElementById('budgetAiPanel');
        if (panel) panel.style.display = 'none';
    },

    // ── WIZARD DE CONFIGURATION DES SUGGESTIONS IA ──────────────────
    wizardState: {
        currentStep: 1,
        currentProposalIndex: 0,
        pendingCategories: []
    },

    startAiWizard() {
        if (!this.aiProposals || !this.aiProposals.length) return;
        this.wizardState.currentStep = 1;
        this.wizardState.currentProposalIndex = 0;
        this.wizardState.pendingCategories = (this.unclassifiedCategories || []).map(u => (typeof u === 'object' && u !== null ? u.name : u));
        
        const modal = document.getElementById('aiBudgetWizardModal');
        if (modal) {
            modal.style.display = 'flex';
            this.renderWizardStep();
        }
    },

    skipWizard() {
        const modal = document.getElementById('aiBudgetWizardModal');
        if (modal) modal.style.display = 'none';
        this.triggerAiCreateBtnPulse();
    },

    triggerAiCreateBtnPulse() {
        const btn = document.getElementById('btnAcceptAiProposals');
        if (btn) {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            btn.classList.add('ai-create-btn-pulse');
            setTimeout(() => {
                btn.classList.remove('ai-create-btn-pulse');
            }, 6000);
        }
    },

    renderWizardStep() {
        if (this.wizardState.currentStep === 1) {
            this.renderWizardStep1();
        } else if (this.wizardState.currentStep === 2) {
            this.renderWizardStep2();
        } else if (this.wizardState.currentStep === 3) {
            this.renderWizardStep3();
        }
    },

    renderWizardStep1() {
        const titleEl = document.getElementById('aiWizardTitle');
        const contentEl = document.getElementById('aiWizardContent');
        const footerEl = document.getElementById('aiWizardFooter');
        if (!contentEl) return;

        const suggestedCount = this.aiProposals.length;
        const omittedCount = (this.unclassifiedCategories || []).length;
        const t = (k, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fallback;

        if (titleEl) titleEl.innerHTML = `<span>${t('ai_wizard_step1_title', '🔮 Suggestions IA prêtes')}</span>`;

        let msgText = t('ai_wizard_step1_msg', '{suggested_count} enveloppes ont été suggérées et {omitted_count} catégorie(s) de dépenses ont été omises.')
            .replace('{suggested_count}', suggestedCount)
            .replace('{omitted_count}', omittedCount);

        const isFallback = (this.aiSuggestMeta && this.aiSuggestMeta.is_fallback);

        contentEl.innerHTML = `
            ${isFallback ? `
                <div style="background:rgba(245,158,11,0.12);border:1px solid #f59e0b;border-radius:12px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <div style="font-size:13px;color:var(--text-main);line-height:1.4;" data-i18n="ai_wizard_fallback_notice">
                        ${t('ai_wizard_fallback_notice', '⚠️ L\'IA n\'a pas renvoyé le format de données attendu. Des enveloppes de secours déterministes ont été créées sur vos données réelles. Vous pouvez relancer le processus complet avec l\'IA.')}
                    </div>
                    <button class="btn btn-secondary" onclick="window.BudgetsView.wizardRetryFullProcess()" style="white-space:nowrap;background:rgba(245,158,11,0.2);color:#f59e0b;border-color:#f59e0b;font-weight:700;padding:6px 12px;" data-i18n="ai_wizard_btn_retry_llm">
                        ${t('ai_wizard_btn_retry_llm', '🔄 Ré-essayer avec l\'IA')}
                    </button>
                </div>
            ` : ''}
            <div style="background:var(--bg-base);border:1px solid var(--border-color);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:14px;">
                <p style="font-size:14px;color:var(--text-main);margin:0;line-height:1.5;">${msgText}</p>
                ${omittedCount > 0 ? `
                    <div style="font-size:13px;font-weight:600;color:var(--accent);" data-i18n="ai_wizard_step1_question">
                        ${t('ai_wizard_step1_question', 'Voulez-vous demander à l\'IA d\'inclure ces catégories dans les enveloppes suggérées ou d\'en créer de nouvelles ?')}
                    </div>
                ` : `
                    <div style="font-size:13px;font-weight:600;color:var(--success);" data-i18n="ai_wizard_step1_all_classified">
                        ✨ ${t('ai_wizard_step1_all_classified', 'Toutes vos catégories de dépenses ont été classées avec succès dans les enveloppes proposées !')}
                    </div>
                `}
            </div>
        `;

        footerEl.innerHTML = `
            <div>
                ${omittedCount > 0 ? `
                    <button class="btn btn-secondary" onclick="window.BudgetsView.wizardActionRefineUnclassified()" style="background:rgba(32,101,209,0.1);color:var(--accent);border-color:var(--accent);font-weight:600;">
                        ${t('ai_wizard_step1_btn_refine', '🪄 Refiner avec l\'IA')}
                    </button>
                ` : ''}
            </div>
            <button class="btn btn-primary" onclick="window.BudgetsView.wizardNextStep(2)" style="font-weight:700;">
                ${t('ai_wizard_step1_btn_next', 'Passer à l\'étape suivante ➔')}
            </button>
        `;
    },

    async wizardActionRefineUnclassified() {
        const titleEl = document.getElementById('aiWizardTitle');
        const contentEl = document.getElementById('aiWizardContent');
        const footerEl = document.getElementById('aiWizardFooter');
        const t = (k, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fallback;

        if (contentEl) {
            contentEl.innerHTML = `
                <div style="background:var(--bg-base);border:1px solid var(--border-color);border-radius:12px;padding:30px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
                    <svg class="animate-spin" style="width:32px;height:32px;color:var(--accent);" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span style="font-size:14px;font-weight:600;color:var(--text-main);">${t('ai_budget_refining', 'Affinage IA en cours...')}</span>
                </div>
            `;
        }
        if (footerEl) footerEl.innerHTML = '';

        try {
            await this.refineUnclassifiedWithAi();
            if (this.wizardState) {
                this.wizardState.pendingCategories = (this.unclassifiedCategories || []).map(u => (typeof u === 'object' && u !== null ? (u.name || String(u)) : String(u)));
            }
            this.wizardNextStep(2);
        } catch(e) {
            this.renderWizardStep1();
        }
    },

    async wizardRetryFullProcess() {
        const titleEl = document.getElementById('aiWizardTitle');
        const contentEl = document.getElementById('aiWizardContent');
        const footerEl = document.getElementById('aiWizardFooter');
        const t = (k, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fallback;

        if (contentEl) {
            contentEl.innerHTML = `
                <div style="background:var(--bg-base);border:1px solid var(--border-color);border-radius:12px;padding:30px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
                    <svg class="animate-spin" style="width:32px;height:32px;color:var(--accent);" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span style="font-size:14px;font-weight:600;color:var(--text-main);">${t('budget_ai_analyzing', 'Analyse IA en cours...')}</span>
                </div>
            `;
        }
        if (footerEl) footerEl.innerHTML = '';

        const months = (this.aiSuggestMeta && this.aiSuggestMeta.requested_window_months) ? this.aiSuggestMeta.requested_window_months : 3;
        await this.requestAiSuggestions(months);
    },

    renderWizardStep2() {
        try {
            const titleEl = document.getElementById('aiWizardTitle');
            const contentEl = document.getElementById('aiWizardContent');
            const footerEl = document.getElementById('aiWizardFooter');
            if (!contentEl) return;

            const t = (k, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fallback;

            if (titleEl) titleEl.innerHTML = `<span>${t('ai_wizard_step2_title', '📊 Équilibre Budgétaire & Repère')}</span>`;

        let monthlyCount = 0;
        let yearlyCount = 0;
        let totalMonthlyAvg = 0;

        (this.aiProposals || []).forEach(p => {
            const period = p.period || p.suggested_period || 'monthly';
            if (period === 'yearly') {
                yearlyCount++;
                totalMonthlyAvg += (p.suggested_amount / 12.0);
            } else {
                monthlyCount++;
                totalMonthlyAvg += p.suggested_amount;
            }
        });

        const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.effective_window_months) ? this.aiSuggestMeta.effective_window_months : 3;
        let refSalary = this.customSalaryOverride;
        if (refSalary === undefined || refSalary === null) {
            const rawIncome = this.aiSuggestMeta ? (this.aiSuggestMeta.monthly_income_reference || this.aiSuggestMeta.regular_salary) : 0;
            refSalary = (parseFloat(rawIncome) > 0) ? parseFloat(rawIncome) : 2500;
        }

        const gaugeLabel = t('ai_wizard_step2_gauge_label', 'Moyenne de dépenses ({months}m) :').replace('{months}', windowMonths);
        const summaryText = t('ai_wizard_step2_summary', '{monthly_count} enveloppe(s) mensuelle(s) et {yearly_count} enveloppe(s) annuelle(s) ont été suggérées.')
            .replace('{monthly_count}', monthlyCount)
            .replace('{yearly_count}', yearlyCount);

        let totalEstimatedMonthly = 0;
        (this.aiProposals || []).forEach(p => {
            const histAmt = p.historical_actual_amount !== undefined 
                ? p.historical_actual_amount 
                : (p.recent_3m_avg !== undefined ? p.recent_3m_avg : p.suggested_amount);
            const period = p.period || p.suggested_period || 'monthly';
            totalEstimatedMonthly += (period === 'yearly' ? (histAmt / 12.0) : histAmt);
        });

        // Echelle fixe avec +5% de marge visuelle
        const maxScale = Math.max(totalMonthlyAvg, refSalary, totalEstimatedMonthly, 100) * 1.05;
        const spendingPct = Math.min(100, Math.max(0, (totalMonthlyAvg / maxScale) * 100));
        const salaryPct = refSalary > 0 ? Math.min(100, Math.max(0, (refSalary / maxScale) * 100)) : null;
        const estimatedPct = totalEstimatedMonthly > 0 ? Math.min(100, Math.max(0, (totalEstimatedMonthly / maxScale) * 100)) : null;

        // Graduation Marks (0, 1000, 2000, 3000...)
        const step = maxScale >= 6000 ? 2000 : (maxScale >= 3000 ? 1000 : (maxScale >= 1000 ? 500 : 200));
        const ticks = [];
        for (let v = 0; v <= maxScale; v += step) {
            ticks.push(v);
        }

        const diffVal = totalMonthlyAvg - refSalary;
        const isOverSalary = diffVal > 0.01;
        const diffAmt = Math.abs(diffVal).toFixed(2);

        let adviceHtml = '';
        const isEffortExceeded = !isOverSalary && (totalEstimatedMonthly - refSalary) > 0.05;

        if (isOverSalary) {
            adviceHtml = t('ai_wizard_step2_advice_over', '🚨 <strong>Attention au dépassement :</strong> Vos enveloppes ({spending}€/m) dépassent votre salaire repère ({salary}€/m) de +{diff}€/m. Utilisez les boutons d\'ajustement ci-dessous pour équilibrer.')
                .replace('{spending}', totalMonthlyAvg.toFixed(2))
                .replace('{salary}', refSalary.toFixed(2))
                .replace('{diff}', diffAmt)
                .replace('{est}', totalEstimatedMonthly.toFixed(2));
        } else if (isEffortExceeded) {
            adviceHtml = `📊 <strong>Objectif d'épargne avec risque de dépassement :</strong> Vos enveloppes (${totalMonthlyAvg.toFixed(2)}€/m) s'inscrivent sous votre salaire repère (${refSalary.toFixed(2)}€/m), dégageant ${diffAmt}€/m d'épargne théorique. <em>Cependant, vos dépenses constatées (${totalEstimatedMonthly.toFixed(2)}€/m) dépassent cette cible ! Sans réduction effective de vos dépenses réelles, vos enveloppes risquent d'être dépassées.</em>`;
        } else {
            adviceHtml = t('ai_wizard_step2_advice_balanced', '✨ <strong>Budget idéalement équilibré :</strong> Vos enveloppes ({spending}€/m) s\'inscrivent parfaitement dans votre salaire repère ({salary}€/m), dégageant {diff}€/m de marge de sécurité.')
                .replace('{spending}', totalMonthlyAvg.toFixed(2))
                .replace('{salary}', refSalary.toFixed(2))
                .replace('{diff}', diffAmt)
                .replace('{est}', totalEstimatedMonthly.toFixed(2));
        }

        contentEl.innerHTML = `
            <div style="background:var(--bg-base);border:1px solid var(--border-color);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:18px;">
                <!-- Slider Filtre d'Écrêtage (Impact dynamique instantané sur la jauge jaune Est.) -->
                <div style="background:var(--bg-surface);border:1px solid var(--accent);border-radius:12px;padding:12px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <strong style="font-size:13px;color:var(--text-main);display:flex;align-items:center;gap:6px;" data-i18n="ai_outlier_slider_label">
                            <span>🎚️</span> ${t('ai_outlier_slider_label', 'Sensibilité aux dépenses exceptionnelles :')}
                        </strong>
                        <strong id="wizOutlierSensitivityLabel" style="font-size:13px;color:var(--accent);font-weight:700;">
                            ${this.getOutlierSensitivityLabel(this.currentOutlierSensitivity || 2)}
                        </strong>
                    </div>
                    <input id="wizOutlierSensitivitySlider" type="range" min="1" max="5" value="${this.currentOutlierSensitivity || 2}" step="1" style="width:100%;cursor:pointer;accent-color:var(--accent);height:6px;" onchange="window.BudgetsView.updateOutlierSensitivity(this.value)">
                </div>

                <!-- Jauge visuelle Dépenses vs Salaire Repère avec Badge & Échelle graduée -->
                <div style="display:flex;flex-direction:column;gap:6px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;">
                        <strong style="color:var(--text-main);">${gaugeLabel}</strong>
                        <span style="font-weight:700;color:var(--accent);font-size:15px;">${totalMonthlyAvg.toFixed(2)} €/m</span>
                    </div>
                    
                    <!-- Combined Scale Bar avec Badge Salaire Repère et Repère Jaune Est. -->
                    <div style="position:relative;height:32px;background:var(--bg-surface);border:1px solid var(--border-color);border-radius:12px;overflow:visible;margin-top:16px;margin-bottom:18px;">
                        <!-- Barre Bleue (Montant des enveloppes) -->
                        <div style="position:absolute;top:0;left:0;bottom:0;width:${spendingPct}%;background:linear-gradient(90deg, #3b82f6, #6366f1);border-radius:12px;transition:width 0.4s ease;max-width:100%;"></div>
                        
                        <!-- Repère Jaune (Montant des dépenses estimées) -->
                        ${estimatedPct !== null ? `
                            <div style="position:absolute;top:-2px;bottom:-2px;left:${estimatedPct}%;width:3px;background:#eab308;box-shadow:0 0 8px #eab308;z-index:3;" title="Dépenses estimées: ${totalEstimatedMonthly.toFixed(2)} €/m">
                                <div style="position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:4px;background:#eab308;color:#000000;font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:4px;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);">
                                    🟨 Est. lissée ${totalEstimatedMonthly.toFixed(0)}€
                                </div>
                            </div>
                        ` : ''}

                        <!-- Repère Violet (Salaire repère) -->
                        ${salaryPct !== null ? `
                            <div id="wizardSalaryMarker" style="position:absolute;top:-4px;bottom:-4px;left:${salaryPct}%;width:3px;background:#c084fc;box-shadow:0 0 8px #c084fc;z-index:4;" title="Revenus repère: ${refSalary.toFixed(2)} €/m">
                                <div id="wizardSalaryMarkerBadge" style="position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:4px;background:#c084fc;color:white;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 2px 4px rgba(0,0,0,0.3);">
                                    💼 Salaire: ${refSalary.toFixed(0)}€
                                </div>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Échelle de prix fixe (0, 1000€, 2000€...) -->
                    <div style="position:relative;height:16px;margin-top:-14px;display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);font-weight:600;">
                        ${ticks.map(val => `<span>${val}€</span>`).join('')}
                    </div>
                </div>

                <!-- Champ éditable Salaire Repère -->
                <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-surface);padding:10px 14px;border-radius:10px;border:1px solid var(--border-color);">
                    <label for="wizardSalaryInput" style="font-size:13px;font-weight:600;color:var(--text-main);" data-i18n="ai_wizard_step2_salary_label">
                        ${t('ai_wizard_step2_salary_label', '💼 Salaire repère :')}
                    </label>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <input id="wizardSalaryInput" type="number" step="50" value="${refSalary.toFixed(2)}" style="width:110px;text-align:right;font-weight:700;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-base);color:var(--text-main);" oninput="window.BudgetsView.updateWizardSalary(this.value)">
                        <span style="font-size:13px;font-weight:600;">€/m</span>
                    </div>
                </div>

                <!-- Bloc Information & Conseil Décisionnel -->
                <div id="wizardAdviceBox" style="background:${isOverSalary ? 'rgba(239,68,68,0.1)' : (isEffortExceeded ? 'rgba(245,158,11,0.1)' : 'rgba(54,179,126,0.1)')};border:1px solid ${isOverSalary ? '#ef4444' : (isEffortExceeded ? '#f59e0b' : '#36b37e')};border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:1.4;color:var(--text-main);">
                    ${adviceHtml}
                </div>

                <!-- Boutons Rapides d'Ajustement Global (Ensemble des 6 choix) -->
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <span style="font-size:12px;font-weight:600;color:var(--text-muted);">⚡ Modifier le montant des enveloppes pour les :</span>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
                        <button class="btn btn-secondary" onclick="window.BudgetsView.wizardApplyStrategy('frugal')" style="font-size:11px;padding:4px 8px;border-radius:8px;">
                            ✂️ Réduire de 10%
                        </button>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.wizardApplyStrategy('prudent')" style="font-size:11px;padding:4px 8px;border-radius:8px;">
                            🛡️ Augmenter de 10%
                        </button>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.wizardApplyStrategy('income')" style="font-size:11px;padding:4px 8px;border-radius:8px;color:#36b37e;">
                            ⚖️ Aligner sur les revenus
                        </button>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.wizardApplyStrategy('month')" style="font-size:11px;padding:4px 8px;border-radius:8px;">
                            📅 Aligner sur le mois
                        </button>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.wizardApplyStrategy('real')" style="font-size:11px;padding:4px 8px;border-radius:8px;color:#60a5fa;">
                            📊 Aligner sur la moyenne
                        </button>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.wizardApplyStrategy('reset')" style="font-size:11px;padding:4px 8px;border-radius:8px;color:#c084fc;" data-i18n="ai_wizard_btn_reset">
                            🤖 Aligner avec suggestions IA
                        </button>
                    </div>
                </div>

                <!-- Summary & Question -->
                <div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--border-color);padding-top:12px;">
                    <p style="font-size:13px;color:var(--text-muted);margin:0;">${summaryText}</p>
                    <strong style="font-size:14px;color:var(--text-main);" data-i18n="ai_wizard_step2_question">
                        ${t('ai_wizard_step2_question', 'Voulez-vous les passer en revue une par une ?')}
                    </strong>
                </div>
            </div>
        `;

        footerEl.innerHTML = `
            <button class="btn btn-secondary" onclick="window.BudgetsView.skipWizard()" style="font-weight:600;">
                ${t('ai_wizard_step2_btn_skip_review', 'Non, voir toutes les enveloppes 📋')}
            </button>
            <button class="btn btn-primary" onclick="window.BudgetsView.wizardNextStep(3)" style="font-weight:700;background:var(--accent);">
                ${t('ai_wizard_step2_btn_review', 'Oui, passer en revue 🔍')}
            </button>
        `;
        } catch (e) {
            console.error('[Wizard] Error in renderWizardStep2:', e);
        }
    },

    wizardApplyStrategy(type) {
        if (type === 'prudent') {
            this.adjustAiProposals(1.10);
        } else if (type === 'frugal') {
            this.adjustAiProposals(0.90);
        } else if (type === 'reset') {
            this.resetAiProposalsToOriginal();
        } else if (type === 'real') {
            this.alignAiProposalsToRealSpending();
        } else if (type === 'month') {
            this.alignAiProposalsToCurrentMonth();
        } else if (type === 'income') {
            this.alignAiProposalsToIncome();
        }
        this.renderWizardStep2();
    },

    updateWizardSalary(val) {
        const num = parseFloat(val) || 0;
        this.customSalaryOverride = num;
        if (this.aiSuggestMeta) {
            this.aiSuggestMeta.monthly_income_reference = num;
            this.aiSuggestMeta.regular_salary = num;
        }
        const salaryInputMain = document.getElementById('aiSimSalaryInput') || document.getElementById('aiRefSalaryInput');
        if (salaryInputMain) {
            salaryInputMain.value = num.toFixed(2);
        }

        // Si le champ du wizard a le focus, ne pas écraser tout son HTML pour garder le focus & curseur
        const wizardInput = document.getElementById('wizardSalaryInput');
        const activeEl = document.activeElement;

        this.saveAiStateToSession();
        if (wizardInput && activeEl === wizardInput) {
            // Mise à jour de la jauge principale du Wizard sans détruire le champ
            const totalMonthlyAvg = (this.aiProposals || []).reduce((acc, p) => {
                const period = p.period || p.suggested_period || 'monthly';
                return acc + (period === 'yearly' ? (p.suggested_amount / 12.0) : p.suggested_amount);
            }, 0);

            let totalEstimatedMonthly = 0;
            (this.aiProposals || []).forEach(p => {
                const histAmt = p.historical_actual_amount !== undefined 
                    ? p.historical_actual_amount 
                    : (p.recent_3m_avg !== undefined ? p.recent_3m_avg : p.suggested_amount);
                const period = p.period || p.suggested_period || 'monthly';
                totalEstimatedMonthly += (period === 'yearly' ? (histAmt / 12.0) : histAmt);
            });

            const maxScale = Math.max(totalMonthlyAvg, num, totalEstimatedMonthly, 100) * 1.05;
            const salaryPct = num > 0 ? Math.min(100, Math.max(0, (num / maxScale) * 100)) : 0;

            const wizardSalaryMarker = document.getElementById('wizardSalaryMarker');
            if (wizardSalaryMarker) {
                wizardSalaryMarker.style.left = `${salaryPct}%`;
                wizardSalaryMarker.style.display = num > 0 ? 'block' : 'none';
            }
            const wizardSalaryMarkerBadge = document.getElementById('wizardSalaryMarkerBadge');
            if (wizardSalaryMarkerBadge) {
                wizardSalaryMarkerBadge.textContent = `💼 Salaire: ${num.toFixed(0)}€`;
            }

            // Recalcul de l'alerte
            const wizardAdviceBox = document.getElementById('wizardAdviceBox');
            if (wizardAdviceBox) {
                const diffVal = totalMonthlyAvg - num;
                const isOverSalary = diffVal > 0.01;
                const isEffortExceeded = !isOverSalary && (totalEstimatedMonthly - num) > 0.05;
                const diffAmt = Math.abs(diffVal).toFixed(2);
                const t = (k, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fallback;
                let adviceHtml = '';
                if (isOverSalary) {
                    adviceHtml = t('ai_wizard_step2_advice_over', '🚨 <strong>Attention au dépassement :</strong> Vos enveloppes ({spending}€/m) dépassent votre salaire repère ({salary}€/m) de +{diff}€/m. Utilisez les boutons d\'ajustement ci-dessous pour équilibrer.')
                        .replace('{spending}', totalMonthlyAvg.toFixed(2))
                        .replace('{salary}', num.toFixed(2))
                        .replace('{diff}', diffAmt)
                        .replace('{est}', totalEstimatedMonthly.toFixed(2));
                    wizardAdviceBox.style.background = 'rgba(239,68,68,0.1)';
                    wizardAdviceBox.style.borderColor = '#ef4444';
                } else if (isEffortExceeded) {
                    adviceHtml = `📊 <strong>Objectif d'épargne avec risque de dépassement :</strong> Vos enveloppes (${totalMonthlyAvg.toFixed(2)}€/m) s'inscrivent sous votre salaire repère (${num.toFixed(2)}€/m), dégageant ${diffAmt}€/m d'épargne théorique. <em>Cependant, vos dépenses constatées (${totalEstimatedMonthly.toFixed(2)}€/m) dépassent cette cible ! Sans réduction effective de vos dépenses réelles, vos enveloppes risquent d'être dépassées.</em>`;
                    wizardAdviceBox.style.background = 'rgba(245,158,11,0.1)';
                    wizardAdviceBox.style.borderColor = '#f59e0b';
                } else {
                    adviceHtml = t('ai_wizard_step2_advice_balanced', '✨ <strong>Budget idéalement équilibré :</strong> Vos enveloppes ({spending}€/m) s\'inscrivent parfaitement dans votre salaire repère ({salary}€/m), dégageant {diff}€/m de marge de sécurité.')
                        .replace('{spending}', totalMonthlyAvg.toFixed(2))
                        .replace('{salary}', num.toFixed(2))
                        .replace('{diff}', diffAmt)
                        .replace('{est}', totalEstimatedMonthly.toFixed(2));
                    wizardAdviceBox.style.background = 'rgba(54,179,126,0.1)';
                    wizardAdviceBox.style.borderColor = '#36b37e';
                }
                wizardAdviceBox.innerHTML = adviceHtml;
            }
        } else {
            this.renderWizardStep2();
        }

        this.updateAiImpactSimulation();
    },

    renderWizardStep3() {
        const titleEl = document.getElementById('aiWizardTitle');
        const contentEl = document.getElementById('aiWizardContent');
        const footerEl = document.getElementById('aiWizardFooter');
        if (!contentEl) return;

        const t = (k, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fallback;
        const idx = this.wizardState.currentProposalIndex;
        const total = this.aiProposals.length;
        const p = this.aiProposals[idx];

        if (!p) {
            this.skipWizard();
            return;
        }

        // Recalculer le statut 100% Fixe en fonction des catégories présentes
        if (p.categories && p.categories.length > 0) {
            const allCatsFixed = p.categories.every(c => {
                const dt = p.cat_details ? p.cat_details[c] : null;
                if (dt && dt.is_fixed !== undefined) return dt.is_fixed;
                if (this.allCatDetails && this.allCatDetails[c] && this.allCatDetails[c].is_fixed !== undefined) return this.allCatDetails[c].is_fixed;
                return false;
            });
            p.is_fixed = allCatsFixed;
        }

        const titleText = t('ai_wizard_step3_title', '🔍 Revue de l\'enveloppe ({current}/{total})')
            .replace('{current}', idx + 1)
            .replace('{total}', total);

        if (titleEl) titleEl.innerHTML = `<span>${titleText}</span>`;

        const isYearly = (p.period || p.suggested_period) === 'yearly';

        contentEl.innerHTML = `
            <div style="background:var(--bg-base);border:1px solid var(--border-color);border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:16px;">
                <!-- Header Enveloppe en cours avec édition du titre et suppression -->
                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-color);padding-bottom:12px;gap:12px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:260px;">
                        <span style="font-size:22px;">${p.icon || '🏷️'}</span>
                        <div style="display:flex;flex-direction:column;gap:4px;flex:1;">
                            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <input type="text" 
                                       value="${p.name.replace(/"/g, '&quot;')}" 
                                       style="font-size:16px;font-weight:700;color:var(--text-main);background:transparent;border:1px solid transparent;border-radius:6px;padding:2px 6px;outline:none;transition:all 0.2s ease;width:100%;max-width:340px;" 
                                       onfocus="this.style.background='var(--bg-surface)'; this.style.borderColor='var(--accent)';"
                                       onblur="this.style.background='transparent'; this.style.borderColor='transparent';"
                                       onchange="window.BudgetsView.updateAiProposalName(${idx}, this.value)"
                                       title="Cliquer pour modifier le nom de cette enveloppe">
                                 ${p.is_fixed ? `<span style="font-size:10.5px;background:#1e293b;color:#38bdf8;padding:2px 8px;border-radius:6px;border:1px solid #0284c7;font-weight:700;" title="${t('ai_budget_fixed_badge', 'Charge fixe contractuelle non modifiable')}">🔒 100% Fixe</span>` : ''}
                                 ${p.has_fixed_mix && !p.is_fixed ? `<span style="font-size:10.5px;background:#1e293b;color:#38bdf8;padding:2px 8px;border-radius:6px;border:1px solid #0284c7;font-weight:700;">Inclut ${p.fixed_sum}€ fixe</span>` : ''}
                                 ${p.is_exceptional ? `<span style="font-size:10.5px;background:#312e81;color:#a5b4fc;padding:2px 8px;border-radius:6px;border:1px solid #4338ca;font-weight:700;">🚀 ${t('ai_budget_project_badge', 'Projet')}</span>` : ''}
                             </div>
                             ${p.is_fixed ? `
                                 <span style="font-size:11.5px;color:#38bdf8;font-weight:500;display:flex;align-items:center;gap:4px;margin-left:6px;">
                                     ${t('ai_wizard_step3_fixed_note', '📌 Cette enveloppe ne contient que des dépenses récurrentes identiques chaque mois.')}
                                 </span>
                             ` : ''}
                         </div>
                     </div>
                     <div style="display:flex;align-items:center;gap:10px;">
                         <button class="btn btn-secondary" 
                                 onclick="window.BudgetsView.wizardRemoveCurrentProposal(${idx})" 
                                 style="padding:5px 12px;font-size:12px;color:#ef4444;border-color:rgba(239,68,68,0.3);background:rgba(239,68,68,0.08);font-weight:600;" 
                                 title="${t('ai_budget_delete_proposal', 'Supprimer cette enveloppe du plan')}">
                             ${t('ai_wizard_step3_del_proposal', '🗑️ Supprimer l\'enveloppe')}
                         </button>
                        <div style="display:flex;flex-direction:column;align-items:flex-end;">
                            <span style="font-size:14px;font-weight:700;color:${isYearly ? '#c084fc' : 'var(--accent)'};background:var(--bg-surface);padding:4px 12px;border-radius:8px;border:1px solid var(--border-color);">
                                ${p.suggested_amount.toFixed(2)} € ${isYearly ? '/an' : '/mois'}
                            </span>
                            ${isYearly ? `
                                <span style="font-size:11px;color:var(--text-muted);font-weight:600;margin-top:2px;">
                                    (${formatCurrency(p.suggested_amount / 12.0)} €/m)
                                </span>
                            ` : ''}
                        </div>
                    </div>
                </div>

                <!-- Catégories incluses dans cette enveloppe -->
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:12px;font-weight:600;color:var(--text-muted);">Catégories incluses :</span>
                    </div>

                    <!-- Barre Multi-couleurs Segmentée par Catégorie avec Labels (Wizard Step 3) -->
                    <!-- Barre Multi-couleurs Segmentée par Catégorie (Clean Stacked Bar) -->
                    ${(() => {
                        const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#6366f1', '#a855f7', '#84cc16', '#f97316'];
                        const catList = (p.categories || []).map(c => {
                            let amt = 0;
                            if (p.cat_details && p.cat_details[c] && p.cat_details[c].amount !== undefined) {
                                amt = parseFloat(p.cat_details[c].amount) || 0;
                            } else if (p.cat_amounts && p.cat_amounts[c] !== undefined) {
                                amt = parseFloat(p.cat_amounts[c]) || 0;
                            } else if (this.catAverages && this.catAverages[c] !== undefined) {
                                amt = Math.abs(this.catAverages[c]) || 0;
                            }
                            return { name: c, amount: amt };
                        });

                        catList.sort((a, b) => b.amount - a.amount);
                        const totalSpent = catList.reduce((sum, item) => sum + item.amount, 0);
                        const maxRef = Math.max(p.suggested_amount, totalSpent, 0.01);
                        const colorMap = {};
                        catList.forEach((item, catIdx) => {
                            colorMap[item.name] = palette[catIdx % palette.length];
                        });

                        if (!catList.length) return '';

                        return `
                            <div style="position:relative;height:28px;width:100%;background:rgba(255,255,255,0.06);border-radius:10px;overflow:hidden;display:flex;gap:2px;border:1px solid var(--border-color);margin-top:4px;margin-bottom:8px;" title="Répartition des catégories (de la plus grande à la plus petite)">
                                ${catList.map((item, catIdx) => {
                                    const pct = (item.amount / maxRef) * 100;
                                    if (pct <= 0) return '';
                                    const color = palette[catIdx % palette.length];
                                    const details = (p.cat_details && p.cat_details[item.name]) ? p.cat_details[item.name] : null;
                                    let tooltipText = `${item.name} : ${item.amount.toFixed(2)}€ (${pct.toFixed(1)}%)`;
                                    if (details && details.top_descs && details.top_descs.length) {
                                        tooltipText += `\nExemples: ${details.top_descs.join(', ')}`;
                                    }

                                    const amtFormatted = `${item.amount.toFixed(0)}€`;
                                    const fitsInside = pct >= 4;
                                    const labelHtml = fitsInside ? `<span style="font-size:11px;font-weight:700;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 6px;text-shadow:0 1px 3px rgba(0,0,0,0.8);">${item.name} (${amtFormatted})</span>` : '';

                                    return `
                                        <div id="wizSeg_${idx}_${catIdx}"
                                             class="ai-seg-item ai-seg-muted"
                                             data-color="${color}"
                                             style="position:relative;width:${pct}%;height:100%;background:rgba(145,158,171,0.25);border-radius:6px;display:flex;align-items:center;justify-content:center;transition:all 0.25s ease;cursor:help;opacity:0.75;" 
                                             title="${tooltipText.replace(/"/g, '&quot;')}"
                                             onmouseenter="window.BudgetsView.highlightAiCategory(${idx}, ${catIdx}, '${color}', true)"
                                             onmouseleave="window.BudgetsView.unhighlightAiCategory(${idx}, ${catIdx}, true)">
                                            ${labelHtml}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    })()}

                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        ${(() => {
                            const palette = ['#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b', '#06b6d4', '#6366f1', '#a855f7', '#84cc16', '#f97316'];
                            const catList = (p.categories || []).map(c => {
                                let amt = 0;
                                if (p.cat_details && p.cat_details[c] && p.cat_details[c].amount !== undefined) {
                                    amt = parseFloat(p.cat_details[c].amount) || 0;
                                } else if (p.cat_amounts && p.cat_amounts[c] !== undefined) {
                                    amt = parseFloat(p.cat_amounts[c]) || 0;
                                } else if (this.catAverages && this.catAverages[c] !== undefined) {
                                    amt = Math.abs(this.catAverages[c]) || 0;
                                }
                                return { name: c, amount: amt };
                            });
                            catList.sort((a, b) => b.amount - a.amount);
                            const colorMap = {};
                            catList.forEach((item, catIdx) => {
                                colorMap[item.name] = palette[catIdx % palette.length];
                            });

                            return catList.map((item, catIdx) => {
                                const catName = item.name;
                                const originalIdx = (p.categories || []).indexOf(catName);
                                const details = (p.cat_details && p.cat_details[catName]) ? p.cat_details[catName] : null;
                                let tooltipText = catName;
                                let catAmtStr = item.amount > 0 ? ` (${formatCurrency(item.amount)})` : '';
                                if (details) {
                                    const unitStr = isYearly ? '€/an' : '€/mois';
                                    const merchantsLabel = window.i18n.t('ai_budget_tooltip_merchants') || "Exemples d'opérations :";
                                    const merchantsStr = details.top_descs && details.top_descs.length ? `\n${merchantsLabel} ${details.top_descs.join(', ')}` : '';
                                    tooltipText = `📊 ${catName} : ${details.amount} ${unitStr}${merchantsStr}`;
                                } else if (p.cat_amounts && p.cat_amounts[catName] !== undefined) {
                                    const unitStr = isYearly ? '€/an' : '€/mois';
                                    tooltipText = `📊 ${catName} : ${p.cat_amounts[catName]} ${unitStr}`;
                                }
                                const activeColor = colorMap[catName] || 'var(--accent)';

                                return `
                                    <span id="wizBadge_${idx}_${catIdx}"
                                          class="ai-cat-badge" 
                                          title="${tooltipText.replace(/"/g, '&quot;')}" 
                                          style="display:inline-flex;align-items:center;gap:6px;background:var(--bg-surface);border:1px solid var(--border-color);padding:4px 10px;border-radius:16px;font-size:12px;color:var(--text-main);cursor:help;transition:all 0.25s ease;"
                                          onmouseenter="window.BudgetsView.highlightAiCategory(${idx}, ${catIdx}, '${activeColor}', true)"
                                          onmouseleave="window.BudgetsView.unhighlightAiCategory(${idx}, ${catIdx}, true)">
                                        <span class="ai-cat-dot" style="width:7px;height:7px;border-radius:50%;background:rgba(145,158,171,0.5);display:inline-block;flex-shrink:0;transition:all 0.25s ease;"></span>
                                        <span>${catName}</span>
                                        <strong style="color:var(--text-muted);font-size:10.5px;font-weight:600;">${catAmtStr}</strong>
                                        ${p.categories.length > 1 ? `
                                            <button onclick="window.BudgetsView.wizardRemoveCategoryFromProposal(${idx}, ${originalIdx})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-weight:bold;padding:0 2px;margin-left:2px;" title="${t('ai_wizard_step3_remove_cat', 'Retirer de l\'enveloppe')}">✕</button>
                                        ` : ''}
                                    </span>
                                `;
                            }).join('');
                        })()}
                    </div>
                </div>

                <!-- Bac de dépôt des catégories retirées / en attente -->
                <div style="background:var(--bg-surface);border:1px dashed var(--border-color);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;margin-top:4px;">
                    <strong style="font-size:12px;color:var(--text-muted);" data-i18n="ai_wizard_step3_pending_cats">
                        ${t('ai_wizard_step3_pending_cats', '📥 Catégories en attente (cliquez pour ré-ajouter à cette enveloppe) :')}
                    </strong>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        ${this.wizardState.pendingCategories.length > 0 ? this.wizardState.pendingCategories.map((cItem, pIdx) => {
                            const catName = (typeof cItem === 'object' && cItem !== null) ? (cItem.name || cItem.category || String(cItem)) : String(cItem);
                            const details = (p.cat_details && p.cat_details[catName]) ? p.cat_details[catName] : null;
                            let tooltipText = catName;
                            if (details) {
                                const unitStr = isYearly ? '€/an' : '€/mois';
                                const merchantsLabel = window.i18n.t('ai_budget_tooltip_merchants') || "Exemples d'opérations :";
                                const merchantsStr = details.top_descs && details.top_descs.length ? `\n${merchantsLabel} ${details.top_descs.join(', ')}` : '';
                                tooltipText = `📊 ${catName} : ${details.amount} ${unitStr}${merchantsStr}`;
                            } else if (p.cat_amounts && p.cat_amounts[catName] !== undefined) {
                                const unitStr = isYearly ? '€/an' : '€/mois';
                                tooltipText = `📊 ${catName} : ${p.cat_amounts[catName]} ${unitStr}`;
                            }
                            return `
                                <button onclick="window.BudgetsView.wizardReaddPendingCategory(${pIdx})" title="${tooltipText.replace(/"/g, '&quot;')}" style="display:inline-flex;align-items:center;gap:4px;background:rgba(32,101,209,0.1);border:1px solid var(--accent);color:var(--accent);padding:4px 10px;border-radius:16px;font-size:12px;cursor:pointer;font-weight:600;">
                                    ➕ ${catName}
                                </button>
                            `;
                        }).join('') : `
                            <span style="font-size:12px;color:var(--text-muted);font-style:italic;" data-i18n="ai_wizard_step3_no_pending">
                                ${t('ai_wizard_step3_no_pending', 'Aucune catégorie en attente')}
                            </span>
                        `}
                    </div>
                </div>
            </div>
        `;

        footerEl.innerHTML = `
            <button class="btn btn-secondary" onclick="window.BudgetsView.wizardPrevProposal()" ${idx === 0 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>
                ${t('ai_wizard_step3_prev', '◄ Précédent')}
            </button>
            <button class="btn btn-primary" onclick="window.BudgetsView.wizardNextProposal()" style="font-weight:700;">
                ${idx === total - 1 ? t('ai_wizard_step3_finish', 'Terminer la revue ✓') : t('ai_wizard_step3_next', 'Suivant ►')}
            </button>
        `;
    },

    updateAiProposalName(proposalIdx, newName) {
        const p = (this.aiProposals || [])[proposalIdx];
        if (p && newName && newName.trim()) {
            p.name = newName.trim();
            this.renderAiProposalsList();
            if (this.wizardState.currentStep === 3) {
                this.renderWizardStep3();
            }
        }
    },

    wizardRemoveCurrentProposal(proposalIdx) {
        if (!this.aiProposals || !this.aiProposals[proposalIdx]) return;
        const p = this.aiProposals[proposalIdx];
        
        // Libérer les catégories vers les catégories en attente du Wizard
        if (p.categories && p.categories.length) {
            p.categories.forEach(c => {
                const cName = (typeof c === 'object' && c !== null) ? (c.name || c.category || String(c)) : String(c);
                if (!this.wizardState.pendingCategories.includes(cName)) {
                    this.wizardState.pendingCategories.push(cName);
                }
            });
        }

        // Supprimer la proposition de la liste
        this.aiProposals.splice(proposalIdx, 1);
        this.renderAiProposalsList();

        // Ré-ajuster l'index courant du Wizard si nécessaire
        if (!this.aiProposals.length) {
            this.skipWizard();
        } else {
            if (this.wizardState.currentProposalIndex >= this.aiProposals.length) {
                this.wizardState.currentProposalIndex = Math.max(0, this.aiProposals.length - 1);
            }
            this.renderWizardStep3();
        }
    },

    wizardRemoveCategoryFromProposal(proposalIdx, catIdx) {
        const p = this.aiProposals[proposalIdx];
        if (p && p.categories && p.categories[catIdx]) {
            const catName = p.categories[catIdx];
            this.removeCategoryFromAiProposal(proposalIdx, catName);
            if (!this.wizardState.pendingCategories.includes(catName)) {
                this.wizardState.pendingCategories.push(catName);
            }
            this.renderWizardStep3();
        }
    },

    wizardReaddPendingCategory(pendingIdx) {
        const catName = this.wizardState.pendingCategories[pendingIdx];
        if (catName && this.aiProposals) {
            this.addCategoryToAiProposal(this.wizardState.currentProposalIndex, catName);
            this.renderWizardStep3();
        }
    },

    wizardNextStep(stepNum) {
        console.log('[Wizard] Advancing to step:', stepNum);
        this.wizardState.currentStep = parseInt(stepNum, 10);
        const modal = document.getElementById('aiBudgetWizardModal');
        if (modal) modal.style.display = 'flex';
        this.renderWizardStep();
    },

    wizardPrevProposal() {
        if (this.wizardState.currentProposalIndex > 0) {
            this.wizardState.currentProposalIndex--;
            this.renderWizardStep3();
        }
    },

    wizardNextProposal() {
        if (this.wizardState.currentProposalIndex < this.aiProposals.length - 1) {
            this.wizardState.currentProposalIndex++;
            this.renderWizardStep3();
        } else {
            this.skipWizard();
        }
    }
});

