// static/js/views/recurrences/recurrences_modals.js — Modales d'ajout, édition, clôture mid-year et réouverture
window.RecurrenceView = Object.assign(window.RecurrenceView || {}, {
    async showCloseModal(templateId) {
        const tpl = (this.templates || []).find(t => t.id === templateId);
        if (!tpl) {
            showToast("Récurrence introuvable", "error");
            return;
        }

        const todayStr = new Date().toISOString().substring(0, 10);
        
        const now = new Date();
        const lastDayObj = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const endOfMonthStr = lastDayObj.toISOString().substring(0, 10);

        const modal = document.createElement('div');
        modal.id = 'closeSubscriptionModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1000';

        const title = window.i18n.t('rec_close_title') || "Clôturer l'abonnement";
        const explanation = window.i18n.t('rec_close_explanation') || "L'abonnement sera marqué comme clôturé et conservé dans vos archives. Les échéances futures non rapprochées strictement après la date choisie seront automatiquement supprimées.";
        const dateLabel = window.i18n.t('rec_close_date_label') || "Date d'effet de la clôture";
        const optToday = (window.i18n.t('rec_close_option_today') || "Aujourd'hui ({date})").replace('{date}', todayStr);
        const optEndMonth = (window.i18n.t('rec_close_option_end_month') || "Fin du mois en cours ({date})").replace('{date}', endOfMonthStr);
        const optCustom = window.i18n.t('rec_close_option_custom') || "Date personnalisée";
        const confirmBtnText = window.i18n.t('rec_close_confirm_btn') || "Clôturer l'abonnement";

        modal.innerHTML = `
            <div class="modal" style="width: 90%; max-width: 520px; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); padding: 25px; display: flex; flex-direction: column; gap: 20px; animation: modalFadeIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
                    <div>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px;">🛑 ${title}</h3>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${tpl.description} (${formatCurrency(tpl.displayAmount || tpl.amount)})</div>
                    </div>
                    <button style="background: transparent; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted);" onclick="document.getElementById('closeSubscriptionModal').remove()">×</button>
                </div>
                
                <div style="font-size: 13px; color: var(--text-main); line-height: 1.5; background: rgba(245, 158, 11, 0.08); border-left: 4px solid #f59e0b; padding: 12px; border-radius: 6px;">
                    ${explanation}
                </div>

                <form id="closeSubscriptionForm" style="display: flex; flex-direction: column; gap: 15px;" onsubmit="event.preventDefault(); window.RecurrenceView.submitCloseModal(${tpl.id})">
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${dateLabel}</label>
                        
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base);">
                            <input type="radio" name="close_date_type" value="today" checked onchange="window.RecurrenceView.toggleCloseCustomDate(false)">
                            <span>${optToday}</span>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base);">
                            <input type="radio" name="close_date_type" value="end_month" onchange="window.RecurrenceView.toggleCloseCustomDate(false)">
                            <span>${optEndMonth}</span>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base);">
                            <input type="radio" name="close_date_type" value="custom" onchange="window.RecurrenceView.toggleCloseCustomDate(true)">
                            <span>${optCustom}</span>
                        </label>

                        <div id="close_custom_date_container" style="display: none; margin-top: 5px; padding-left: 28px;">
                            <input type="date" id="close_custom_date_input" value="${todayStr}" class="inline-input" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; width: 100%;">
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 10px;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('closeSubscriptionModal').remove()" style="padding: 8px 16px;">${window.i18n.t('btn_cancel') || 'Annuler'}</button>
                        <button type="submit" class="btn btn-danger" style="padding: 8px 16px; background: var(--danger, #ff5630); color: #ffffff;">${confirmBtnText}</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
    },

    toggleCloseCustomDate(showCustom) {
        const container = document.getElementById('close_custom_date_container');
        if (container) {
            container.style.display = showCustom ? 'block' : 'none';
        }
    },

    async submitCloseModal(templateId) {
        const selectedType = document.querySelector('input[name="close_date_type"]:checked')?.value || 'today';
        let closureDate = new Date().toISOString().substring(0, 10);
        
        if (selectedType === 'end_month') {
            const now = new Date();
            const lastDayObj = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            closureDate = lastDayObj.toISOString().substring(0, 10);
        } else if (selectedType === 'custom') {
            closureDate = document.getElementById('close_custom_date_input')?.value || closureDate;
        }

        const formBtn = document.querySelector('#closeSubscriptionForm button[type="submit"]');
        const originalText = formBtn ? formBtn.textContent : '';

        try {
            if (formBtn) {
                formBtn.disabled = true;
                formBtn.textContent = '⏳ ...';
            }

            const res = await API.post(`/api/recurrences/${templateId}/close`, { closure_date: closureDate });
            
            document.getElementById('closeSubscriptionModal')?.remove();

            await window.app.refreshSidebar();
            await this.loadData();
            showUndoToast(window.i18n.t('rec_closed_success') || 'Abonnement clôturé avec succès !', res.action_id, () => this.loadData());
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la clôture de l'abonnement", "error");
            if (formBtn) {
                formBtn.disabled = false;
                formBtn.textContent = originalText;
            }
        }
    },

    async reopenTemplate(templateId) {
        const confirmed = await showInlineConfirm(
            window.i18n.t('rec_reopen_confirm_title') || "Rouvrir l'abonnement",
            window.i18n.t('rec_reopen_confirm_msg') || "Voulez-vous rouvrir cet abonnement ? Les échéances futures récurrentes seront régénérées."
        );
        if (!confirmed) return;

        try {
            const res = await API.post(`/api/recurrences/${templateId}/reopen`);
            await window.app.refreshSidebar();
            await this.loadData();
            showUndoToast(window.i18n.t('rec_reopened_success') || 'Abonnement rouvert avec succès !', res.action_id, () => this.loadData());
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la réouverture de l'abonnement", "error");
        }
    },
    

    async openEditModal(templateId, forceIsClosedState = undefined) {
        if (!this.templates || this.templates.length === 0 || !this.allTransactions || this.allTransactions.length === 0) {
            try {
                this.templates = await API.get('/api/recurrences/?include_closed=true');
                this.categories = await API.get('/api/categories/');
                this.allTransactions = await API.get('/api/transactions/?limit=10000');
            } catch (e) {
                console.error("Failed to load dependency data for edit modal", e);
            }
        }
        const tpl = (this.templates || []).find(t => t.id === templateId);
        if (!tpl) {
            showToast("Récurrence introuvable", "error");
            return;
        }

        const initialIsClosed = (forceIsClosedState !== undefined) ? forceIsClosedState : (tpl.is_closed || false);

        // Auto-infer month_of_year from existing transactions if not set
        if (tpl.month_of_year == null && ['Yearly', 'Semi-Annually'].includes(tpl.frequency)) {
            const tplTxs = (this.allTransactions || []).filter(tx => tx.recurrence_id === templateId && tx.date_operation);
            if (tplTxs.length > 0) {
                // Use the month from the most recent transaction
                const sorted = tplTxs.sort((a, b) => b.date_operation.localeCompare(a.date_operation));
                const dateStr = sorted[0].date_operation;
                const inferredMonth = parseInt(dateStr.substring(5, 7)); // 1-12
                tpl.month_of_year = inferredMonth;
            }
        }

        // Fetch accounts
        let accounts = [];
        try {
            accounts = await API.get('/api/accounts/');
        } catch (e) {
            console.error("Failed to load accounts", e);
        }

        // Create modal element
        const modal = document.createElement('div');
        modal.id = 'editRecurrenceModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1000';

        const categoryOptions = (this.categories || [])
            .map(c => `<option value="${c.name}" ${tpl.category === c.name ? 'selected' : ''}>${c.name}</option>`)
            .join('');

        const freqOptions = [
            ['Weekly', 'rec_weekly', 'Hebdomadaire'],
            ['Monthly', 'rec_monthly', 'Mensuelle'],
            ['Quarterly', 'rec_quarterly', 'Trimestrielle'],
            ['Semi-Annually', 'rec_semi-annually', 'Semestrielle'],
            ['Yearly', 'rec_yearly', 'Annuelle'],
            ['Bi-Weekly', 'rec_biweekly', 'Toutes les 2 semaines'],
            ['Bi-Monthly', 'rec_bimonthly', 'Tous les 2 mois']
        ].map(([val, key, fallback]) => `<option value="${val}" ${tpl.frequency === val ? 'selected' : ''}>${window.i18n.t(key) || fallback}</option>`).join('');

        const fromAccOptions = `<option value="">-- Aucun --</option>` + accounts.map(a => `<option value="${a.id}" ${tpl.from_account_id === a.id ? 'selected' : ''}>${a.name}</option>`).join('');
        const toAccOptions = `<option value="">-- Aucun --</option>` + accounts.map(a => `<option value="${a.id}" ${tpl.to_account_id === a.id ? 'selected' : ''}>${a.name}</option>`).join('');

        const monthOptions = Array.from({length: 12}, (_, i) => i + 1)
            .map(m => `<option value="${m}" ${tpl.month_of_year == m ? 'selected' : ''}>${new Date(2000, m - 1, 1).toLocaleDateString('fr-FR', {month: 'long'})}</option>`)
            .join('');

        modal.innerHTML = `
            <div class="modal" style="width: 90%; max-width: 650px; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); padding: 25px; display: flex; flex-direction: column; gap: 20px; animation: modalFadeIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
                    <h3 style="margin: 0; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px;">✏️ ${window.i18n.t('edit_recurrence_title') || 'Modifier la récurrence'}</h3>
                    <button style="background: transparent; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted);" onclick="document.getElementById('editRecurrenceModal').remove()">×</button>
                </div>
                
                <form id="editRecurrenceForm" style="display: flex; flex-direction: column; gap: 15px;" onsubmit="event.preventDefault(); window.RecurrenceView.saveEditModal(${tpl.id})">
                    <!-- Line 1: Description & Montant -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_description')}</label>
                            <input type="text" id="edit_desc" class="inline-input" value="${tpl.description || ''}" required style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit;">
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_amount')}</label>
                            <input type="number" id="edit_amount" class="inline-input" value="${tpl.amount || 0}" step="0.01" required style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit;">
                            <span style="font-size: 11px; color: var(--text-muted); font-style: italic;">${window.i18n.t('edit_amount_hint') || 'Le nouveau montant sera appliqué pour toutes les futures occurrences.'}</span>
                        </div>
                    </div>

                    <!-- Line 2: Type & Catégorie -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_type') || "Type d'opération"}</label>
                            <select id="edit_type" class="inline-input" onchange="window.RecurrenceView.onEditTypeChange()" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                <option value="expense_fixed" ${tpl.type === 'expense_fixed' ? 'selected' : ''}>${window.i18n.t('edit_type_option_expense_fixed') || 'Dépense fixe'}</option>
                                <option value="expense_var" ${tpl.type === 'expense_var' ? 'selected' : ''}>${window.i18n.t('edit_type_option_expense_var') || 'Dépense variable'}</option>
                                <option value="income" ${tpl.type === 'income' ? 'selected' : ''}>${window.i18n.t('edit_type_option_income') || 'Revenu'}</option>
                                <option value="transfer" ${tpl.type === 'transfer' ? 'selected' : ''}>${window.i18n.t('edit_type_option_transfer') || 'Virement'}</option>
                            </select>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_category')}</label>
                            <select id="edit_category" class="inline-input" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                <option value="">${window.i18n.t('edit_category_option_none') || '-- Sans catégorie --'}</option>
                                ${categoryOptions}
                            </select>
                        </div>
                    </div>

                    <!-- Line 3: Fréquence & Jour du mois -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('wizard_th_frequency') || 'Fréquence'}</label>
                            <select id="edit_freq" class="inline-input" onchange="window.RecurrenceView.onEditFreqChange()" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                ${freqOptions}
                            </select>
                            <span style="font-size: 11px; color: #ff5630; font-weight: 500;">${window.i18n.t('edit_freq_hint') || "Changer la fréquence régénérera toutes les occurrences futures non rapprochées de l'année."}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('wizard_th_day') || 'Jour du mois'}</label>
                            <input type="number" id="edit_day" class="inline-input" value="${tpl.day_of_month || 1}" min="1" max="31" required style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit;">
                            <span style="font-size: 11px; color: #ff5630; font-weight: 500;">${window.i18n.t('edit_day_hint') || "Changer le jour régénérera également les dates des futures occurrences."}</span>
                        </div>
                    </div>

                    <!-- Line 4: Mois de l'année (only active if Yearly or Semi-Annually) & Max Occurrences -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div id="edit_month_container" style="display: flex; flex-direction: column; gap: 5px; opacity: ${['Yearly', 'Semi-Annually'].includes(tpl.frequency) ? '1' : '0.5'};">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_month_of_year') || "Mois de l'année"}</label>
                            <select id="edit_month" class="inline-input" ${['Yearly', 'Semi-Annually'].includes(tpl.frequency) ? '' : 'disabled'} style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                <option value="">${window.i18n.t('edit_month_option_none') || '-- Aucun --'}</option>
                                ${monthOptions}
                            </select>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_max_occurrences') || 'Occurrences Max (Optionnel)'}</label>
                            <input type="number" id="edit_max_occurrences" class="inline-input" value="${tpl.max_occurrences || ''}" min="1" placeholder="${window.i18n ? window.i18n.t('recurrence_unlimited') : 'Illimité'}" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit;">
                        </div>
                    </div>

                    <!-- Line 5: Depuis & Vers -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div id="edit_from_acc_container" style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('label_from') || 'Depuis'}</label>
                            <select id="edit_from_acc" class="inline-input" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                ${fromAccOptions}
                            </select>
                        </div>
                        <div id="edit_to_acc_container" style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('label_to') || 'Vers'}</label>
                            <select id="edit_to_acc" class="inline-input" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                ${toAccOptions}
                            </select>
                        </div>
                    </div>

                    <!-- Line 6: Closed Switch -->
                    <label style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 5px; cursor: pointer; user-select: none;">
                        <div style="display: flex; flex-direction: column; gap: 3px; max-width: 80%;">
                            <span style="font-size: 14px; font-weight: 600; color: var(--text-main);">${window.i18n.t('edit_close_recurrence_label') || "Clôturer l'abonnement / récurrence"}</span>
                            <span style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">${window.i18n.t('edit_close_recurrence_hint') || 'Activer cette option désactive définitivement la génération future de cette récurrence. Les transactions existantes seront conservées.'}</span>
                        </div>
                        <input type="checkbox" id="edit_is_closed" ${initialIsClosed ? 'checked' : ''} style="width: 22px; height: 22px; cursor: pointer;">
                    </label>

                    <!-- Real-time Preview Container -->
                    <div id="edit_preview_dates_container" style="display: flex; flex-direction: column; gap: 8px; margin-top: 5px; padding: 12px; background: rgba(99, 102, 241, 0.05); border-radius: 8px; border: 1px solid var(--border-color);">
                        <span id="edit_preview_dates_title" style="font-size: 13px; font-weight: 600; color: var(--text-muted);" data-i18n="recurrence_preview_dates_title">${window.i18n.t('recurrence_preview_dates_title') || 'Aperçu des 6 prochaines dates :'}</span>
                        <div id="edit_preview_dates_list" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 13px; font-weight: 500; text-align: center;"></div>
                    </div>

                    <!-- Form Actions -->
                    <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 10px;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('editRecurrenceModal').remove()" style="padding: 8px 16px;">${window.i18n.t('btn_cancel') || 'Annuler'}</button>
                        <button type="submit" class="btn btn-primary" style="padding: 8px 16px; background: var(--primary-color, #6366f1); color: #ffffff;">${window.i18n.t('btn_save') || 'Enregistrer'}</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
        window.RecurrenceView.onEditTypeChange(); // align accounts field on start

        // Bind preview listeners
        document.getElementById('edit_freq').addEventListener('change', () => {
            window.RecurrenceView.onEditFreqChange();
            window.RecurrenceView.updateEditPreviewDates();
        });
        document.getElementById('edit_day').addEventListener('input', () => window.RecurrenceView.updateEditPreviewDates());
        document.getElementById('edit_month').addEventListener('change', () => window.RecurrenceView.updateEditPreviewDates());
        document.getElementById('edit_amount').addEventListener('input', () => window.RecurrenceView.updateEditPreviewDates());
        document.getElementById('edit_is_closed').addEventListener('change', (e) => {
            const container = document.getElementById('edit_preview_dates_container');
            if (container) {
                container.style.display = e.target.checked ? 'none' : 'flex';
            }
        });

        const isClosed = document.getElementById('edit_is_closed').checked;
        document.getElementById('edit_preview_dates_container').style.display = isClosed ? 'none' : 'flex';

        window.RecurrenceView.updateEditPreviewDates(); // initial preview draw
    },

    onEditFreqChange() {
        const freq = document.getElementById('edit_freq').value;
        const monthContainer = document.getElementById('edit_month_container');
        const monthSelect = document.getElementById('edit_month');
        if (['Yearly', 'Semi-Annually'].includes(freq)) {
            monthContainer.style.opacity = '1';
            monthSelect.disabled = false;
        } else {
            monthContainer.style.opacity = '0.5';
            monthSelect.disabled = true;
            monthSelect.value = '';
        }
    },

    onEditTypeChange() {
        // Both account fields are always available — no disabling.
        // The user can freely assign Depuis/Vers regardless of type.
    },

    async saveEditModal(templateId) {
        const desc = document.getElementById('edit_desc').value.trim();
        const amount = parseFloat(document.getElementById('edit_amount').value) || 0;
        const type = document.getElementById('edit_type').value;
        const category = document.getElementById('edit_category').value || null;
        const frequency = document.getElementById('edit_freq').value;
        const day_of_month = parseInt(document.getElementById('edit_day').value) || 1;
        const month_val = document.getElementById('edit_month').value;
        const month_of_year = month_val ? parseInt(month_val) : null;
        const max_occ_val = document.getElementById('edit_max_occurrences').value;
        const max_occurrences = max_occ_val ? parseInt(max_occ_val) : null;
        const from_acc_val = document.getElementById('edit_from_acc').value;
        const from_account_id = from_acc_val ? parseInt(from_acc_val) : null;
        const to_acc_val = document.getElementById('edit_to_acc').value;
        const to_account_id = to_acc_val ? parseInt(to_acc_val) : null;
        const is_closed = document.getElementById('edit_is_closed').checked;

        const payload = {
            description: desc,
            amount: amount,
            type: type,
            category: category,
            frequency: frequency,
            day_of_month: day_of_month,
            month_of_year: month_of_year,
            max_occurrences: max_occurrences,
            from_account_id: from_account_id,
            to_account_id: to_account_id,
            is_closed: is_closed
        };

        const formBtn = document.querySelector('#editRecurrenceForm button[type="submit"]');
        const originalText = formBtn ? formBtn.textContent : '';

        try {
            if (formBtn) {
                formBtn.disabled = true;
                formBtn.textContent = '⏳ ...';
            }

            // 1. Put updates to DB
            const res = await API.put(`/api/recurrences/${templateId}`, payload);

            // 2. Trigger automatic recurrence generation to regenerate future instances
            await API.post('/api/recurrences/generate_to_end_of_year');

            // Remove modal
            document.getElementById('editRecurrenceModal').remove();

            // Refresh UI
            window.app.refreshSidebar();
            await this.loadData();
            showUndoToast(window.i18n.t('msg_saved') || 'Enregistré avec succès !', res.action_id, () => this.loadData());
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la mise à jour de la récurrence", "error");
            if (formBtn) {
                formBtn.disabled = false;
                formBtn.textContent = originalText;
            }
        }
    },

    updateEditPreviewDates() {
        const freq = document.getElementById('edit_freq').value;
        const day = parseInt(document.getElementById('edit_day').value) || 1;
        const monthVal = document.getElementById('edit_month').value;
        const month = monthVal ? parseInt(monthVal) - 1 : null;
        
        const list = document.getElementById('edit_preview_dates_list');
        if (!list) return;

        // Show active amount in the preview header
        const amountEl = document.getElementById('edit_amount');
        const amountVal = amountEl ? parseFloat(amountEl.value) || 0 : 0;
        const titleEl = document.getElementById('edit_preview_dates_title');
        if (titleEl) {
            const formattedAmt = `<span style="color: var(--accent, #6366f1); font-weight: 700;">${amountVal.toFixed(2).replace('.', ',')} €</span>`;
            titleEl.innerHTML = (window.i18n.t('edit_preview_title') || 'Aperçu des 6 prochaines échéances (Montant : {amount}) :')
                .replace('{amount}', formattedAmt);
        }
        
        const dates = [];
        let base = new Date();
        
        if (freq === 'Monthly') {
            let y = base.getFullYear();
            let m = base.getMonth();
            if (base.getDate() > day) {
                m++;
            }
            for (let i = 0; i < 6; i++) {
                let d = new Date(y, m + i, day);
                dates.push(d);
            }
        } else if (freq === 'Yearly') {
            let y = base.getFullYear();
            let targetM = month !== null ? month : 0;
            if (base.getMonth() > targetM || (base.getMonth() === targetM && base.getDate() > day)) {
                y++;
            }
            for (let i = 0; i < 6; i++) {
                let d = new Date(y + i, targetM, day);
                dates.push(d);
            }
        } else if (freq === 'Weekly') {
            for (let i = 0; i < 6; i++) {
                let temp = new Date();
                temp.setDate(base.getDate() + (i + 1) * 7);
                dates.push(temp);
            }
        } else if (freq === 'Quarterly') {
            let y = base.getFullYear();
            let m = base.getMonth();
            if (base.getDate() > day) {
                m++;
            }
            for (let i = 0; i < 6; i++) {
                let d = new Date(y, m + i * 3, day);
                dates.push(d);
            }
        } else if (freq === 'Semi-Annually') {
            let y = base.getFullYear();
            let startMonth = month !== null ? month : base.getMonth();
            // Determine starting point based on startMonth and startMonth + 6
            let m1 = startMonth;
            let m2 = (startMonth + 6) % 12;
            
            // Put in order relative to current year
            let d1 = new Date(y, m1, day);
            let d2 = new Date(y, m2, day);
            if (m2 < m1) {
                // if second month wrapped around, it belongs to the next year visually if sorting,
                // but let's just find the first occurrence >= base date
            }
            
            let possibleDates = [];
            for (let i = -1; i < 4; i++) {
                possibleDates.push(new Date(y + i, m1, day));
                possibleDates.push(new Date(y + i, m2, day));
            }
            // Filter future dates (including today if base.getDate() <= day)
            let future = possibleDates.filter(d => {
                const compDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
                return d >= compDate;
            });
            // Sort
            future.sort((a, b) => a - b);
            for (let i = 0; i < 6; i++) {
                dates.push(future[i] || new Date());
            }
        } else if (freq === 'Bi-Weekly') {
            for (let i = 0; i < 6; i++) {
                let temp = new Date();
                temp.setDate(base.getDate() + (i + 1) * 14);
                dates.push(temp);
            }
        } else if (freq === 'Bi-Monthly') {
            let y = base.getFullYear();
            let m = base.getMonth();
            if (base.getDate() > day) {
                m++;
            }
            for (let i = 0; i < 6; i++) {
                let d = new Date(y, m + i * 2, day);
                dates.push(d);
            }
        }
        
        list.innerHTML = dates.map(d => {
            const formatted = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
            return `<div style="padding: 6px; background: rgba(99, 102, 241, 0.08); color: var(--accent, #6366f1); border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.15); font-weight: 600;">${formatted}</div>`;
        }).join('');
    },


});
