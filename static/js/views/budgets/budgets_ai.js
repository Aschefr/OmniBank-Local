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

    async requestAiSuggestions(windowMonths = 3) {
        sessionStorage.removeItem('budget_ai_panel_closed');
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
        const simulator = document.getElementById('aiImpactSimulator');
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
            const result = await API.post('/api/budgets/ai_suggest', { window_months: windowMonths, lang: currentLang }, { signal: this.currentAiSuggestAbortController.signal });
            await this.playParsingAnimation();
            this.aiSuggestMeta = result;
            const effWin = result.effective_window_months || result.window_months || windowMonths;
            this.updateAiWindowButtonsState(windowMonths, effWin);
            this.renderAiProposals(result.proposals || []);
        } catch(e) {
            if (e.name === 'AbortError') {
                return;
            }
            let msg = e.message || '';
            if (panel && (!this.aiProposals || !this.aiProposals.length)) {
                panel.style.display = 'none';
            }
            if (msg.includes('Internal Server Error') || !msg.trim() || msg.startsWith('<')) {
                msg = (window.i18n && window.i18n.t) ? window.i18n.t('budget_ai_error') : "Impossible de contacter Ollama. Vérifiez l'adresse et le port dans les paramètres.";
            }
            if (msg.includes('non activ') || msg.includes('400')) {
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
                    meta: this.aiSuggestMeta || null
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
                    const simulator = document.getElementById('aiImpactSimulator');
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
            const monthlyAmt = pPeriod === 'yearly' ? (p.suggested_amount / 12.0) : p.suggested_amount;
            if (p.is_fixed && !p.unlocked) {
                fixedTotal += monthlyAmt;
            } else {
                let baseVal = monthlyAmt;
                if (baseVal <= 0) {
                    const orig = p.original_amount || p.historical_actual_amount || 0;
                    baseVal = pPeriod === 'yearly' ? (orig / 12.0) : orig;
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

        let totalRecent3mMonthly = 0;
        selected.forEach(p => {
            const pPeriod = p.suggested_period || p.period || 'monthly';
            const histAmt = p.historical_actual_amount !== undefined 
                ? p.historical_actual_amount 
                : (p.recent_3m_avg !== undefined ? p.recent_3m_avg : p.suggested_amount);
            totalRecent3mMonthly += (pPeriod === 'yearly' ? (histAmt / 12.0) : histAmt);
        });

        const maxScale = Math.max(1, regularSalary, totalProjectedMonthly, totalRecent3mMonthly);

        const barCur = document.getElementById('aiSimProgressBarCurrent');
        const barImp = document.getElementById('aiSimProgressBarImpact');

        const salaryPct = regularSalary > 0 ? (totalProjectedMonthly / regularSalary) * 100 : 0;
        const diffSalary = totalProjectedMonthly - regularSalary;
        let barColor = '#3b82f6';
        let badgeColor = 'var(--accent)';
        let statusBadgeText = '';

        if (regularSalary > 0 && diffSalary > 0.05) {
            if (salaryPct <= 115) {
                barColor = '#f59e0b';
                badgeColor = '#f59e0b';
                statusBadgeText = window.i18n.t('ai_sim_status_savings_drawn') || '📙 Sollicite l\'épargne';
            } else {
                barColor = '#ef4444';
                badgeColor = '#ef4444';
                statusBadgeText = window.i18n.t('ai_sim_status_overbudget') || '⚠️ Budget élevé';
            }
        } else if (regularSalary > 0 && Math.abs(diffSalary) <= 0.05) {
            barColor = 'var(--accent)';
            badgeColor = '#10b981';
            statusBadgeText = window.i18n.t('ai_sim_status_balanced') || '✨ Équilibré';
        }

        if (barCur && barImp) {
            const currentW = (currentMonthlyCapacity / maxScale) * 100;
            const impactW = (impactMonthly / maxScale) * 100;

            barCur.style.width = `${currentW}%`;
            barCur.style.background = 'var(--accent)';

            barImp.style.left = `${currentW}%`;
            barImp.style.width = `${impactW}%`;
            barImp.style.background = barColor;
        }

        const curValEl = document.getElementById('aiSimCurrentVal');
        if (curValEl) curValEl.textContent = `${formatCurrency(currentMonthlyCapacity)}/m`;

        const impValEl = document.getElementById('aiSimImpactVal');
        if (impValEl) impValEl.textContent = `+${formatCurrency(impactMonthly)}/m`;

        const pctBadge = document.getElementById('aiSimPercentBadge');
        if (pctBadge) {
            const pctVal = regularSalary > 0 ? Math.round((totalProjectedMonthly / regularSalary) * 100) : 0;
            const totalStr = `${formatCurrency(totalProjectedMonthly)}/m`;
            let fullText = '';
            if (statusBadgeText) {
                const tpl = window.i18n.t('ai_sim_total_format_status') || 'Budget de {total} ({pct}% de vos revenus repère — {status})';
                fullText = tpl.replace('{total}', totalStr).replace('{pct}', pctVal).replace('{status}', statusBadgeText);
            } else {
                const tpl = window.i18n.t('ai_sim_total_format') || 'Budget de {total} ({pct}% de vos revenus repère)';
                fullText = tpl.replace('{total}', totalStr).replace('{pct}', pctVal);
            }
            pctBadge.textContent = fullText;
            pctBadge.style.color = badgeColor;
        }

        const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) ? this.aiSuggestMeta.window_months : 3;
        const realPaceLabelEl = document.getElementById('aiSimRealPaceLabel');
        if (realPaceLabelEl) {
            const paceTpl = window.i18n.t('ai_sim_lbl_real_pace') || 'Moyenne de dépenses ({months}m) :';
            realPaceLabelEl.textContent = paceTpl.replace('{months}', windowMonths);
        }

        const realPaceEl = document.getElementById('aiSimRealPaceVal');
        if (realPaceEl) realPaceEl.textContent = `${formatCurrency(totalRecent3mMonthly)}/m`;

        const proposedEl = document.getElementById('aiSimProposedVal');
        if (proposedEl) proposedEl.textContent = `${formatCurrency(impactMonthly)}/m`;

        const gapEl = document.getElementById('aiSimGapVal');
        const gapVal = impactMonthly - totalRecent3mMonthly;

        if (gapEl) {
            const absGapStr = `${formatCurrency(Math.abs(gapVal))}/m`;
            if (gapVal <= 0) {
                const tplLower = window.i18n.t('ai_sim_gap_lower') || 'Propositions inférieures de {amount} à vos dépenses constatées (Effort d\'économie)';
                gapEl.textContent = tplLower.replace('{amount}', absGapStr);
                gapEl.style.color = '#36b37e';
            } else {
                const tplHigher = window.i18n.t('ai_sim_gap_higher') || 'Propositions supérieures de {amount} à vos dépenses constatées';
                gapEl.textContent = tplHigher.replace('{amount}', absGapStr);
                gapEl.style.color = Math.abs(gapVal) > (regularSalary * 0.15) ? '#ef4444' : '#f59e0b';
            }
        }

        const barRealCovered = document.getElementById('aiSimProgressBarRealCovered');
        const barRealUncovered = document.getElementById('aiSimProgressBarRealUncovered');

        if (barRealCovered && barRealUncovered) {
            const coveredAmt = Math.min(totalRecent3mMonthly, impactMonthly);
            const uncoveredAmt = Math.max(0, totalRecent3mMonthly - impactMonthly);

            const coveredW = (coveredAmt / maxScale) * 100;
            const uncoveredW = (uncoveredAmt / maxScale) * 100;

            barRealCovered.style.width = `${coveredW}%`;
            barRealUncovered.style.left = `${coveredW}%`;
            barRealUncovered.style.width = `${uncoveredW}%`;
            barRealUncovered.style.background = Math.abs(gapVal) > (regularSalary * 0.15) ? '#ef4444' : '#f59e0b';
        }

        const marker1 = document.getElementById('aiSimSalaryMarker1');
        const marker2 = document.getElementById('aiSimSalaryMarker2');
        const badge1 = document.getElementById('aiSimSalaryMarkerBadge1');
        const badge2 = document.getElementById('aiSimSalaryMarkerBadge2');
        const val1 = document.getElementById('aiSimSalaryMarkerVal1');
        const val2 = document.getElementById('aiSimSalaryMarkerVal2');

        const salaryStr = formatCurrency(regularSalary);

        if (regularSalary > 0) {
            const salaryPos = Math.min(100, Math.max(0, (regularSalary / maxScale) * 100));
            if (marker1) {
                marker1.style.display = 'block';
                marker1.style.left = `${salaryPos}%`;
            }
            if (marker2) {
                marker2.style.display = 'block';
                marker2.style.left = `${salaryPos}%`;
            }
            if (badge1) {
                badge1.style.display = 'block';
                badge1.style.left = `${salaryPos}%`;
                if (val1) val1.textContent = salaryStr;
            }
            if (badge2) {
                badge2.style.display = 'block';
                badge2.style.left = `${salaryPos}%`;
                if (val2) val2.textContent = salaryStr;
            }
        } else {
            if (marker1) marker1.style.display = 'none';
            if (marker2) marker2.style.display = 'none';
            if (badge1) badge1.style.display = 'none';
            if (badge2) badge2.style.display = 'none';
        }

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
            const diffSalary = totalProjectedMonthly - regularSalary;

            if (regularSalary > 0 && diffSalary > 1.0) {
                // Budget > Salary
                const isHighOverrun = salaryPct > 110;
                alertBanner.style.display = 'flex';
                alertBanner.style.alignItems = 'center';
                alertBanner.style.padding = '10px 14px';
                alertBanner.style.background = isHighOverrun ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)';
                alertBanner.style.border = `1px solid ${isHighOverrun ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`;
                alertBanner.style.color = isHighOverrun ? '#f87171' : '#fbbf24';

                const key = isHighOverrun ? 'ai_sim_advice_salary_exceeded_high' : 'ai_sim_advice_salary_exceeded_light';
                const defaultMsg = isHighOverrun
                    ? `🚨 <strong>Dépassement budgétaire important :</strong> Le budget prévisionnel ({total}) excède votre salaire repère ({salary}) de +{diff} ({pct}% de la paie). Pour éviter de solliciter votre épargne chaque mois, vous pouvez utiliser le bouton <em>⚖️ Aligner sur les revenus</em> ou réduire les enveloppes variables.`
                    : `⚠️ <strong>Budget légèrement supérieur aux revenus :</strong> Vos enveloppes prévoient un léger dépassement de +{diff} par rapport à votre salaire ({salary}). Un ajustement mineur sur vos dépenses variables permettra d'équilibrer parfaitement votre budget.`;

                const msgText = (window.i18n.t(key) || defaultMsg)
                    .replace('{total}', formatCurrency(totalProjectedMonthly))
                    .replace('{salary}', formatCurrency(regularSalary))
                    .replace('{diff}', formatCurrency(diffSalary))
                    .replace('{pct}', Math.round(salaryPct));

                alertBanner.innerHTML = `<div style="font-size:12px;line-height:1.4;">${msgText}</div>`;

            } else if (selected.length > 0 && totalRecent3mMonthly > 0 && (totalRecent3mMonthly - impactMonthly) > 50.0) {
                // Budget < Salary, but Historical Spending > Proposed Budget
                const gap = totalRecent3mMonthly - impactMonthly;
                alertBanner.style.display = 'flex';
                alertBanner.style.alignItems = 'center';
                alertBanner.style.padding = '10px 14px';
                alertBanner.style.background = 'rgba(59, 130, 246, 0.1)';
                alertBanner.style.border = '1px solid rgba(59, 130, 246, 0.3)';
                alertBanner.style.color = '#60a5fa';

                const defaultMsg = `📊 <strong>Budget sous le salaire avec effort de sobriété :</strong> Votre budget prévisionnel ({total}) est bien contenu sous votre salaire ({salary}), mais il exige un effort d'économie de {gap}/m par rapport à vos dépenses constatées sur {months} mois ({spending}/m).`;

                const msgText = (window.i18n.t('ai_sim_advice_effort_needed') || defaultMsg)
                    .replace('{total}', formatCurrency(totalProjectedMonthly))
                    .replace('{salary}', formatCurrency(regularSalary))
                    .replace('{gap}', formatCurrency(gap))
                    .replace('{months}', windowMonths)
                    .replace('{spending}', formatCurrency(totalRecent3mMonthly));

                alertBanner.innerHTML = `<div style="font-size:12px;line-height:1.4;">${msgText}</div>`;

            } else if (regularSalary > 0 && salaryPct <= 90) {
                // Budget <= 90% of Salary
                const savings = regularSalary - totalProjectedMonthly;
                const savingsPct = Math.round((savings / regularSalary) * 100);

                alertBanner.style.display = 'flex';
                alertBanner.style.alignItems = 'center';
                alertBanner.style.padding = '10px 14px';
                alertBanner.style.background = 'rgba(16, 185, 129, 0.1)';
                alertBanner.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                alertBanner.style.color = '#34d399';

                const defaultMsg = `✨ <strong>Budget sain avec capacité d'épargne :</strong> Votre budget prévisionnel ({total}) consomme {pct}% de votre salaire repère, dégageant une capacité d'épargne estimée à +{savings}/m ({savingsPct}% des revenus).`;

                const msgText = (window.i18n.t('ai_sim_advice_savings_capacity') || defaultMsg)
                    .replace('{total}', formatCurrency(totalProjectedMonthly))
                    .replace('{salary}', formatCurrency(regularSalary))
                    .replace('{pct}', Math.round(salaryPct))
                    .replace('{savings}', formatCurrency(savings))
                    .replace('{savingsPct}', savingsPct);

                alertBanner.innerHTML = `<div style="font-size:12px;line-height:1.4;">${msgText}</div>`;

            } else if (regularSalary > 0 && salaryPct <= 100) {
                // Budget 90% - 100% of Salary
                const remaining = regularSalary - totalProjectedMonthly;

                alertBanner.style.display = 'flex';
                alertBanner.style.alignItems = 'center';
                alertBanner.style.padding = '10px 14px';
                alertBanner.style.background = 'rgba(16, 185, 129, 0.1)';
                alertBanner.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                alertBanner.style.color = '#34d399';

                const defaultMsg = `💡 <strong>Budget idéalement équilibré :</strong> Vos enveloppes prévisionnelles ({total}) respectent votre revenu repère ({salary}), laissant {remaining}/m de marge de sécurité.`;

                const msgText = (window.i18n.t('ai_sim_advice_balanced_ideal') || defaultMsg)
                    .replace('{total}', formatCurrency(totalProjectedMonthly))
                    .replace('{salary}', formatCurrency(regularSalary))
                    .replace('{remaining}', formatCurrency(remaining));

                alertBanner.innerHTML = `<div style="font-size:12px;line-height:1.4;">${msgText}</div>`;

            } else {
                alertBanner.style.display = 'none';
            }
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
        }
    },

    updateCustomYearlySalary(val) {
        const num = parseFloat(val);
        if (!isNaN(num) && num >= 0) {
            this.customYearlySalaryOverride = num;
            this.updateAiImpactSimulation();
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

    addCategoryToAiProposal(proposalIndex, categoryName) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex] || !categoryName) return;
        const p = this.aiProposals[proposalIndex];
        if (!p.categories) p.categories = [];
        if (p.categories.includes(categoryName)) return;

        p.categories.push(categoryName);

        let addedVal = 0;
        if (p.cat_amounts && p.cat_amounts[categoryName] !== undefined) {
            addedVal = p.cat_amounts[categoryName];
        } else if (p.cat_details && p.cat_details[categoryName] && p.cat_details[categoryName].amount !== undefined) {
            addedVal = p.cat_details[categoryName].amount;
        } else if (this.catAverages && this.catAverages[categoryName] !== undefined) {
            const avg = Math.abs(this.catAverages[categoryName]);
            addedVal = p.period === 'yearly' ? avg * 12.0 : avg;
        } else if (p.suggested_amount > 0 && (p.categories.length - 1) > 0) {
            addedVal = Math.round((p.suggested_amount / (p.categories.length - 1)) * 100) / 100;
        }

        if (addedVal > 0) {
            p.suggested_amount = Math.round((p.suggested_amount + addedVal) * 100) / 100;
            p.original_amount = Math.round((p.original_amount + addedVal) * 100) / 100;
            if (!p.cat_amounts) p.cat_amounts = {};
            p.cat_amounts[categoryName] = addedVal;
        }

        if (this.unclassifiedCategories) {
            this.unclassifiedCategories = this.unclassifiedCategories.filter(c => c !== categoryName);
        }

        this.renderAiProposalsList();
    },

    removeCategoryFromAiProposal(proposalIndex, categoryName) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex]) return;
        const p = this.aiProposals[proposalIndex];
        
        p.categories = (p.categories || []).filter(c => c !== categoryName);
        
        if (!this.unclassifiedCategories) this.unclassifiedCategories = [];
        if (!this.unclassifiedCategories.includes(categoryName)) {
            this.unclassifiedCategories.push(categoryName);
        }
        
        let removedVal = 0;
        if (p.cat_amounts && p.cat_amounts[categoryName] !== undefined) {
            removedVal = p.cat_amounts[categoryName];
        } else if (p.cat_details && p.cat_details[categoryName] && p.cat_details[categoryName].amount !== undefined) {
            removedVal = p.cat_details[categoryName].amount;
        } else if (this.catAverages && this.catAverages[categoryName] !== undefined) {
            const avg = Math.abs(this.catAverages[categoryName]);
            removedVal = p.period === 'yearly' ? avg * 12.0 : avg;
        } else if (p.categories.length > 0) {
            const oldLen = p.categories.length + 1;
            removedVal = p.suggested_amount / oldLen;
        } else {
            removedVal = p.suggested_amount;
        }

        if (removedVal > 0) {
            p.suggested_amount = Math.max(0, Math.round((p.suggested_amount - removedVal) * 100) / 100);
            p.original_amount = Math.max(0, Math.round((p.original_amount - removedVal) * 100) / 100);
        }

        if (p.categories.length === 0) {
            p.suggested_amount = 0;
            p.selected = false;
        }

        this.renderAiProposalsList();
    },

    renderAiProposalsList() {
        const panel = document.getElementById('budgetAiPanel');
        const container = document.getElementById('budgetAiProposals');
        const simulator = document.getElementById('aiImpactSimulator');

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

        const monthlyProposals = proposals.map((p, origIndex) => ({ ...p, origIndex })).filter(p => p.period === 'monthly');
        const yearlyProposals = proposals.map((p, origIndex) => ({ ...p, origIndex })).filter(p => p.period === 'yearly');

        const renderProposalCard = (p) => {
            const i = p.origIndex;
            const isYearly = p.period === 'yearly';
            const bgTint = isYearly ? 'background:rgba(139, 92, 246, 0.04);border:1px solid rgba(139, 92, 246, 0.25);' : 'background:var(--bg-body);border:1px solid var(--border-color);';
            const periodBadge = isYearly 
                ? `<span style="font-size:10px;background:rgba(139, 92, 246, 0.15);color:#c084fc;padding:1px 6px;border-radius:4px;border:1px solid rgba(139, 92, 246, 0.4);font-weight:600;">📅 Annuelle</span>`
                : `<span style="font-size:10px;background:rgba(59, 130, 246, 0.15);color:#60a5fa;padding:1px 6px;border-radius:4px;border:1px solid rgba(59, 130, 246, 0.4);font-weight:600;">⚡ Mensuelle</span>`;

            const categoryBadgesHtml = (p.categories || []).map(c => {
                const details = (p.cat_details && p.cat_details[c]) ? p.cat_details[c] : null;
                let tooltipText = c;
                if (details) {
                    const unitStr = p.period === 'yearly' ? '€/an' : '€/mois';
                    const merchantsLabel = window.i18n.t('ai_budget_tooltip_merchants') || "Exemples d'opérations :";
                    const merchantsStr = details.top_descs && details.top_descs.length ? `\n${merchantsLabel} ${details.top_descs.join(', ')}` : '';
                    tooltipText = `📊 ${c} : ${details.amount} ${unitStr}${merchantsStr}`;
                } else if (p.cat_amounts && p.cat_amounts[c] !== undefined) {
                    const unitStr = p.period === 'yearly' ? '€/an' : '€/mois';
                    tooltipText = `📊 ${c} : ${p.cat_amounts[c]} ${unitStr}`;
                }

                return `
                    <span class="ai-cat-badge" title="${tooltipText.replace(/"/g, '&quot;')}" style="background:var(--bg-surface);border:1px solid var(--border-color);padding:2px 7px;border-radius:4px;font-size:10px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;cursor:help;">
                        ${c}
                        <button onclick="event.stopPropagation(); window.BudgetsView.removeCategoryFromAiProposal(${i}, '${c.replace(/'/g, "\\'")}')" aria-label="Retirer la catégorie ${c.replace(/"/g, '')}" style="cursor:pointer;color:#ef4444;font-weight:bold;margin-left:2px;font-size:10px;background:none;border:none;padding:0;line-height:1;">✕</button>
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
                    <select onchange="if(this.value){ window.BudgetsView.addCategoryToAiProposal(${i}, this.value); }" 
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
                <div id="aiProposal_${i}" style="${bgTint}border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:6px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:240px;">
                            <input type="checkbox" class="ai-proposal-checkbox" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent);" ${p.selected ? 'checked' : ''} onchange="window.BudgetsView.toggleAiProposal(${i}, this.checked)">
                            
                            <div style="display:flex;flex-direction:column;gap:2px;">
                                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                    <strong style="font-size:13px;color:var(--text-main);">${p.name}</strong>
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
                                    <span onclick="window.BudgetsView.applyBadgeAmountToAiProposal(${i}, ${valCur})" style="cursor:pointer;font-size:11px;background:var(--bg-base);padding:3px 8px;border-radius:6px;border:1px solid ${isCurrentExceeded ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-color)'};color:${isCurrentExceeded ? '#f87171' : 'var(--text-muted)'};transition:all 0.15s ease;" title="${applyTitleCur}">
                                        ${labelCur} <strong style="text-decoration:underline;text-decoration-style:dotted;">${formatCurrency(valCur)}</strong>
                                    </span>
                                `;

                                const badgePaceHtml = `
                                    <span onclick="window.BudgetsView.applyBadgeAmountToAiProposal(${i}, ${valPace})" style="cursor:pointer;font-size:11px;background:var(--bg-base);padding:3px 8px;border-radius:6px;border:1px solid ${isPaceExceeded ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-color)'};color:${isPaceExceeded ? '#f87171' : 'var(--text-muted)'};transition:all 0.15s ease;" title="${applyTitlePace}">
                                        ${labelPace} <strong style="text-decoration:underline;text-decoration-style:dotted;">${formatCurrency(valPace)}</strong>
                                    </span>
                                `;

                                return badgeCurrentHtml + badgePaceHtml;
                            })()}
                            <input id="aiProposalAmount_${i}" type="number" step="0.01" value="${p.suggested_amount.toFixed(2)}" ${(p.is_fixed && !p.unlocked) ? `disabled title="${window.i18n.t('ai_budget_unlock_fixed_help') || 'Charge fixe contractuelle. Cliquez sur le crayon ✏️ pour autoriser la modification manuelle.'}"` : ''} style="width:95px;text-align:right;font-size:13px;font-weight:700;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:${(p.is_fixed && !p.unlocked) ? 'var(--bg-base)' : 'var(--bg-surface)'};color:${isYearly ? '#c084fc' : 'var(--accent)'}; ${(p.is_fixed && !p.unlocked) ? 'opacity:0.65;cursor:not-allowed;' : ''}" oninput="window.BudgetsView.updateAiProposalAmount(${i}, this.value)">
                            ${p.is_fixed ? `
                                <button type="button" class="btn btn-secondary" onclick="window.BudgetsView.toggleUnlockFixedProposal(${i})" style="padding:3px 6px;font-size:11px;background:transparent;border:1px solid ${p.unlocked ? 'rgba(54,179,126,0.4)' : 'rgba(56,189,248,0.4)'};color:${p.unlocked ? '#36b37e' : '#38bdf8'};cursor:pointer;margin-left:2px;" title="${p.unlocked ? 'Verrouiller le montant fixe' : (window.i18n.t('ai_budget_unlock_fixed_help') || 'Charge fixe contractuelle. Cliquez sur le crayon pour autoriser la modification manuelle.')}">
                                    ${p.unlocked ? '🔓' : '✏️'}
                                </button>
                            ` : ''}
                            <span id="aiProposalUnit_${i}" style="font-size:12px;color:${isYearly ? '#c084fc' : 'var(--text-muted)'};font-weight:600;">${isYearly ? (window.i18n.t('budget_unit_yearly') || '€/an') : (window.i18n.t('budget_unit_monthly') || '€/mois')}</span>
                            <button class="btn btn-secondary" onclick="window.BudgetsView.removeAiProposal(${i})" style="padding:3px 7px;font-size:11px;color:#ef4444;border-color:rgba(239,68,68,0.3);background:transparent;margin-left:4px;" title="${window.i18n.t('ai_budget_delete_proposal') || 'Supprimer la suggestion'}">✕</button>
                        </div>
                    </div>

                    <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--text-muted);padding-top:4px;border-top:1px dashed var(--border-color);">
                        ${(p.justification || p.reason) ? `
                            <div style="display:flex;align-items:flex-start;gap:4px;">
                                <span style="flex-shrink:0;margin-top:1px;">ℹ️</span> <span>${p.justification || p.reason}</span>
                            </div>
                        ` : ''}
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
                    <div id="aiImpactSimulatorYearly" style="background:var(--bg-base);border:1px solid rgba(139, 92, 246, 0.3);border-radius:10px;padding:12px 16px;margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                            <strong style="color:#c084fc;font-size:13px;display:flex;align-items:center;gap:6px;">
                                <span>📅</span> <span data-i18n="ai_budget_sim_yearly_title">${window.i18n.t('ai_budget_sim_yearly_title') || '📅 Impact annuel prévisionnel'}</span>
                            </strong>
                            <div style="display:flex;gap:10px;align-items:center;">
                                <span id="aiSimYearlySalaryBadge" style="font-size:11px;background:var(--bg-surface);padding:3px 10px;border-radius:6px;border:1px solid rgba(139, 92, 246, 0.3);color:var(--text-muted);display:flex;align-items:center;gap:6px;">
                                    <span data-i18n="ai_budget_yearly_salary_ref">${window.i18n.t('ai_budget_yearly_salary_ref') || '💼 Revenu annuel repère :'}</span> 
                                    <input id="aiSimYearlySalaryInput" type="number" step="100" style="width:90px;text-align:right;font-size:12px;font-weight:700;padding:2px 4px;border-radius:4px;border:1px solid rgba(139, 92, 246, 0.4);background:var(--bg-base);color:#c084fc;" oninput="window.BudgetsView.updateCustomYearlySalary(this.value)"> €
                                </span>
                            </div>
                        </div>

                        <div style="width:100%;height:8px;background:var(--border-color);border-radius:4px;overflow:hidden;position:relative;margin-bottom:8px;">
                            <div id="aiSimProgressBarYearlyCurrent" style="height:100%;background:#8b5cf6;width:0%;position:absolute;top:0;left:0;transition:width 0.3s ease;" title="Engagé annuel actuel"></div>
                            <div id="aiSimProgressBarYearlyImpact" style="height:100%;background:#c084fc;width:0%;position:absolute;top:0;left:0;opacity:0.8;transition:all 0.3s ease;" title="Nouvel impact annuel"></div>
                        </div>

                        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);flex-wrap:wrap;gap:6px;">
                            <div>
                                <span data-i18n="ai_budget_sim_yearly_engaged">${window.i18n.t('ai_budget_sim_yearly_engaged') || 'Engagé annuel :'}</span>
                                <span title="${window.i18n.t('ai_budget_sim_tt_yearly_engaged') || 'Somme des enveloppes annuelles déjà existantes.'}" style="cursor:help;margin-right:4px;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                                <strong id="aiSimYearlyCurrentVal" style="color:var(--text-main);">0,00 €/an</strong>
                            </div>
                            <div>
                                <span data-i18n="ai_budget_sim_yearly_impact">${window.i18n.t('ai_budget_sim_yearly_impact') || 'Impact sélection :'}</span>
                                <span title="${window.i18n.t('ai_budget_sim_tt_yearly_impact') || 'Somme des propositions annuelles cochées ci-dessous.'}" style="cursor:help;margin-right:4px;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                                <strong id="aiSimYearlyImpactVal" style="color:#c084fc;">+0,00 €/an</strong>
                            </div>
                            <div>
                                <span data-i18n="ai_budget_sim_yearly_total">${window.i18n.t('ai_budget_sim_yearly_total') || 'Total prévisionnel :'}</span>
                                <span title="${window.i18n.t('ai_budget_sim_tt_yearly_total') || 'Total annuel prévisionnel après création.'}" style="cursor:help;margin-right:4px;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                                <strong id="aiSimYearlyTotalVal" style="color:#c084fc;">0,00 €/an</strong>
                            </div>
                        </div>
                    </div>

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
            const res = await API.post('/api/budgets/ai_suggest/refine', {
                window_months: windowMonths,
                lang: currentLang,
                existing_proposals: formattedProposals,
                unclassified_categories: formattedUnclassified
            });

            if (res && res.proposals) {
                this.aiProposals = res.proposals.map(p => ({
                    ...p,
                    cat_amounts: p.cat_amounts || {},
                    original_amount: p.original_amount !== undefined ? p.original_amount : p.suggested_amount,
                    historical_actual_amount: p.historical_actual_amount !== undefined ? p.historical_actual_amount : p.suggested_amount,
                    justification: p.justification || p.reason || '',
                    period: p.suggested_period || p.period || 'monthly',
                    selected: true
                }));
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
    }
});
