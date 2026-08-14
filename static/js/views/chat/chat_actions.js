// static/js/views/chat/chat_actions.js — Cartes d'action interactives (création/modification proposée par l'IA)
window.ChatView = Object.assign(window.ChatView || {}, {
    async openActionModal(txId) {
        const actionObj = this.pendingActions[txId];
        if (!actionObj) return;

        if (typeof txId === 'string' && txId.startsWith('act_')) {
            const descEl = document.getElementById('aiActionModalDesc');
            if (descEl) descEl.textContent = window.i18n.t('chat_modal_ai_desc_generic') || "L'IA propose d'exécuter l'action suivante. Veuillez vérifier les changements avant de valider.";
            
            const actionNames = {
                create_budget_envelope: window.i18n.t('tool_create_budget_envelope_title') || 'Création d\'une enveloppe de budget',
                update_budget_envelope: window.i18n.t('tool_update_budget_envelope_title') || 'Modification d\'une enveloppe de budget',
                delete_budget_envelope: window.i18n.t('tool_delete_budget_envelope_title') || 'Suppression d\'une enveloppe de budget',
                allocate_savings_funds: window.i18n.t('tool_allocate_savings_funds_title') || 'Alimentation / Retrait de tirelire',
                create_recurrence_template: window.i18n.t('tool_create_recurrence_template_title') || 'Création d\'une charge récurrente',
                update_recurrence_template: window.i18n.t('tool_update_recurrence_template_title') || 'Modification d\'une charge récurrente',
                delete_recurrence_template: window.i18n.t('tool_delete_recurrence_template_title') || 'Suppression d\'une charge récurrente',
                create_category: window.i18n.t('tool_create_category_title') || 'Création d\'une catégorie',
                delete_category: window.i18n.t('tool_delete_category_title') || 'Suppression d\'une catégorie',
                set_predicted_paycheck: window.i18n.t('tool_set_predicted_paycheck_title') || 'Définition du salaire prévisionnel',
                delete_transaction: window.i18n.t('tool_delete_transaction_title') || 'Suppression d\'une opération',
                store_financial_fact: window.i18n.t('tool_store_financial_fact_title') || 'Mémorisation d\'une information',
                forget_financial_fact: window.i18n.t('tool_forget_financial_fact_title') || 'Oubli d\'une information'
            };
            const friendlyName = actionNames[actionObj.action] || actionObj.action;
            
            // Try to resolve current state for update actions
            let currentEntityState = null;
            if (actionObj.action === 'update_budget_envelope' || actionObj.action === 'delete_budget_envelope' || actionObj.action === 'allocate_savings_funds') {
                try {
                    const r = await fetch('/api/budgets');
                    if (r.ok) {
                        const list = await r.json();
                        const bid = parseInt(actionObj.params.budget_id || actionObj.params.id);
                        currentEntityState = list.find(b => b.id === bid);
                    }
                } catch(e) {}
            } else if (actionObj.action === 'update_recurrence_template' || actionObj.action === 'delete_recurrence_template') {
                try {
                    const r = await fetch('/api/recurrences');
                    if (r.ok) {
                        const list = await r.json();
                        const tid = parseInt(actionObj.params.template_id || actionObj.params.id);
                        currentEntityState = list.find(tpl => tpl.id === tid);
                    }
                } catch(e) {}
            } else if (actionObj.action === 'delete_transaction') {
                try {
                    const tid = parseInt(actionObj.params.transaction_id || actionObj.params.id);
                    const r = await fetch(`/api/transactions/${tid}`);
                    if (r.ok) {
                        currentEntityState = await r.json();
                    }
                } catch(e) {}
            } else if (actionObj.action === 'set_predicted_paycheck') {
                try {
                    const r = await fetch('/api/config/');
                    if (r.ok) {
                        const cfg = await r.json();
                        currentEntityState = {
                            amount: parseFloat(cfg.override_paycheck_amount) || null,
                            day_of_month: parseInt(cfg.base_pay_day) || null,
                            date_override: cfg.override_paycheck_date || null
                        };
                    }
                } catch(e) {}
            }

            let subtitleHtml = '';
            if (currentEntityState) {
                const nameOrDesc = currentEntityState.name || currentEntityState.description || currentEntityState.category_name;
                if (nameOrDesc) {
                    subtitleHtml = ` — <span style="color: var(--accent); font-weight:600;">${window.escapeHtml(nameOrDesc)}</span>`;
                }
            } else if (actionObj.params && (actionObj.params.name || actionObj.params.description)) {
                const nameOrDesc = actionObj.params.name || actionObj.params.description;
                subtitleHtml = ` — <span style="color: var(--accent); font-weight:600;">${window.escapeHtml(nameOrDesc)}</span>`;
            }

            let detailsHtml = `<strong>${window.i18n.tp('chat_modal_recommended_action', { action: friendlyName })}${subtitleHtml}</strong>`;
            const showComparison = !!currentEntityState;

            detailsHtml += `<table style="width:100%; margin-top:12px; border-collapse:collapse; font-size:12px;">`;
            if (showComparison) {
                detailsHtml += `<thead><tr>
                    <th style="text-align:left; padding:4px 8px; color:var(--text-muted);">${window.i18n.t('chat_modal_parameter')}</th>
                    <th style="text-align:left; padding:4px 8px; color:var(--text-muted);">${window.i18n.t('chat_th_before') || 'Actuel'}</th>
                    <th style="text-align:left; padding:4px 8px; color:var(--text-muted);">${window.i18n.t('chat_th_after') || 'Proposé'}</th>
                </tr></thead><tbody>`;
            } else {
                detailsHtml += `<thead><tr>
                    <th style="text-align:left; padding:4px 8px; color:var(--text-muted);">${window.i18n.t('chat_modal_parameter')}</th>
                    <th style="text-align:left; padding:4px 8px; color:var(--text-muted);">${window.i18n.t('chat_modal_proposed_value')}</th>
                </tr></thead><tbody>`;
            }

            const paramLabels = {
                id: window.i18n.t('field_label_id') || 'Identifiant',
                budget_id: window.i18n.t('field_label_budget_id') || 'ID Enveloppe',
                template_id: window.i18n.t('field_label_template_id') || 'ID Récurrence',
                name: window.i18n.t('field_label_name') || 'Nom',
                monthly_amount: window.i18n.t('field_label_amount') || 'Montant mensuel',
                amount: window.i18n.t('field_label_amount') || 'Montant',
                period: window.i18n.t('field_label_period') || 'Période',
                categories: window.i18n.t('field_label_categories') || 'Catégories',
                is_project: window.i18n.t('field_label_is_project') || 'Est un projet',
                is_closed: window.i18n.t('field_label_is_closed') || 'Est clôturé',
                is_active: window.i18n.t('field_label_is_active') || 'Est actif',
                note: window.i18n.t('field_label_note') || 'Note / Description',
                description: window.i18n.t('field_label_description') || 'Description',
                frequency: window.i18n.t('field_label_frequency') || 'Fréquence',
                category: window.i18n.t('field_label_category') || 'Catégorie',
                type: window.i18n.t('field_label_type') || 'Type',
                day_of_month: window.i18n.t('field_label_day_of_month') || 'Jour du mois',
                date_override: window.i18n.t('field_label_date_override') || 'Date spécifique',
                new_limit: window.i18n.t('field_label_new_limit') || 'Nouvelle limite',
                transaction_id: window.i18n.t('field_label_transaction_id') || "ID de l'opération",
                key: window.i18n.t('field_label_key') || 'Clé de mémoire',
                value: window.i18n.t('field_label_value') || 'Valeur à mémoriser',
                private_to_session: window.i18n.t('field_label_private_to_session') || 'Privé à cette conversation'
            };

            const valueTranslations = {
                monthly: window.i18n.t('period_monthly') || 'Mensuel',
                weekly: window.i18n.t('period_weekly') || 'Hebdomadaire',
                bimonthly: window.i18n.t('period_bimonthly') || 'Bi-mensuel',
                indefinite: window.i18n.t('period_indefinite') || 'Indéterminé',
                true: window.i18n.t('val_true') || 'Oui',
                false: window.i18n.t('val_false') || 'Non',
                Monthly: window.i18n.t('rec_monthly') || 'Mensuelle',
                Weekly: window.i18n.t('rec_weekly') || 'Hebdomadaire',
                Bimonthly: window.i18n.t('rec_bimonthly') || 'Tous les 2 mois'
            };

            const translateVal = (v) => {
                if (v === null || v === undefined) return '—';
                const s = String(v);
                if (valueTranslations[s] !== undefined) return valueTranslations[s];
                if (valueTranslations[s.toLowerCase()] !== undefined) return valueTranslations[s.toLowerCase()];
                return s;
            };

            for (const [key, val] of Object.entries(actionObj.params || {})) {
                let displayVal = val;
                if (Array.isArray(val)) displayVal = val.join(', ');
                else if (typeof val === 'object' && val !== null) displayVal = JSON.stringify(val);
                displayVal = translateVal(displayVal);
                
                const label = paramLabels[key] || key;

                if (showComparison) {
                    let oldVal = currentEntityState[key];
                    if (oldVal === undefined && key === 'new_limit') oldVal = currentEntityState['monthly_amount']; // Fallback limit
                    if (Array.isArray(oldVal)) oldVal = oldVal.join(', ');
                    oldVal = translateVal(oldVal);
                    
                    const isIdKey = key === 'id' || key === 'budget_id' || key === 'template_id';
                    const hasChanged = String(oldVal) !== String(displayVal);
                    const strikeStyle = (isIdKey || !hasChanged) ? 'none' : 'line-through';
                    
                    detailsHtml += `<tr>
                        <td style="padding:6px 8px; font-weight:600; width:30%;">${label}</td>
                        <td style="padding:6px 8px; color:var(--text-muted); text-decoration:${strikeStyle}; width:35%;">${oldVal}</td>
                        <td style="padding:6px 8px; color:var(--accent); font-weight:600; width:35%;">${displayVal}</td>
                    </tr>`;
                } else {
                    detailsHtml += `<tr>
                        <td style="padding:6px 8px; font-weight:600; width:40%;">${label}</td>
                        <td style="padding:6px 8px; color:var(--accent); font-weight:600;">${displayVal}</td>
                    </tr>`;
                }
            }
            detailsHtml += `</tbody></table>`;

            document.getElementById('aiActionDetails').innerHTML = detailsHtml;
            document.getElementById('aiActionModal').style.display = 'flex';
            document.getElementById('aiActionConfirmBtn').onclick = () => this.applyGenericAiAction(txId, actionObj);
            return;
        }

        const descEl = document.getElementById('aiActionModalDesc');
        if (descEl) descEl.textContent = window.i18n.t('modal_ai_desc') || "L'IA propose de modifier la transaction suivante. Veuillez vérifier les changements avant d'appliquer.";

        let currentTx = null;
        try {
            const resp = await fetch(`/api/transactions/${txId}`);
            if (resp.ok) currentTx = await resp.json();
        } catch(e) {}

        const fieldLabels = { category: window.i18n.t('field_label_category'), description: window.i18n.t('field_label_description'), amount: window.i18n.t('field_label_amount'), date_operation: window.i18n.t('field_label_date') };

        let detailsHtml = `<strong>Transaction #${actionObj.id}</strong>`;
        if (currentTx?.description) detailsHtml += ` — <em>${currentTx.description}</em>`;
        detailsHtml += `<table style="width:100%; margin-top:12px; border-collapse:collapse; font-size:12px;">`;
        detailsHtml += `<thead><tr>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_field">${window.i18n.t('chat_th_field')}</th>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_before">${window.i18n.t('chat_th_before')}</th>
            <th style="text-align:left; padding:4px 8px; color:var(--text-muted);" data-i18n="chat_th_after">${window.i18n.t('chat_th_after')}</th>
        </tr></thead><tbody>`;

        for (const [key, newVal] of Object.entries(actionObj.updates || {})) {
            const label = fieldLabels[key] || key;
            const oldVal = currentTx ? (currentTx[key] ?? '<em>vide</em>') : '...';
            detailsHtml += `<tr>
                <td style="padding:6px 8px; font-weight:600;">${label}</td>
                <td style="padding:6px 8px; color:var(--text-muted); text-decoration:line-through;">${oldVal}</td>
                <td style="padding:6px 8px; color:var(--accent); font-weight:600;">${newVal}</td>
            </tr>`;
        }
        detailsHtml += `</tbody></table>`;

        document.getElementById('aiActionDetails').innerHTML = detailsHtml;
        document.getElementById('aiActionModal').style.display = 'flex';
        document.getElementById('aiActionConfirmBtn').onclick = () => this.applyAiAction(actionObj);
    },

    closeActionModal() {
        document.getElementById('aiActionModal').style.display = 'none';
    },

    async applyAiAction(actionObj) {
        const btn = document.getElementById('aiActionConfirmBtn');
        btn.disabled = true;
        btn.innerText = window.i18n.t('msg_applying');

        try {
            const response = await fetch(`/api/transactions/${actionObj.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(actionObj.updates)
            });

            if (!response.ok) throw new Error("Erreur API");

            this.closeActionModal();
            
            // Add a feedback message in DB and reload
            const successMsg = `✅ La transaction **#${actionObj.id}** a été mise à jour avec succès dans la base de données.`;
            await fetch(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: successMsg, lang: window.i18n.lang || 'fr' })
            });
            await this.loadMessages();

        } catch (error) {
            showInlineMessage(window.i18n.t('title_error'), window.i18n.tp('msg_edit_error', {error: error.message}));
        } finally {
            btn.disabled = false;
            btn.innerText = window.i18n.t('btn_validate_edit');
        }
    },

    async applyGenericAiAction(actionId, actionObj) {
        const btn = document.getElementById('aiActionConfirmBtn');
        btn.disabled = true;
        btn.innerText = window.i18n.t('msg_applying') || 'Application...';

        try {
            const response = await fetch('/api/chat/apply-action', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: actionObj.action,
                    params: actionObj.params
                })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || "Erreur de validation");
            }

            this.closeActionModal();
            
            // Add a feedback message in DB and reload
            const actionTitle = window.i18n.t(`tool_${actionObj.action}_title`) || window.i18n.t(`tool_${actionObj.action}`) || actionObj.action;
            const successMsg = `✅ L'action **${actionTitle}** a été exécutée et validée avec succès.`;
            await fetch(`/api/chat/sessions/${this.activeSessionId}/system-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: successMsg, lang: window.i18n.lang || 'fr' })
            });
            await this.loadMessages();
            
            // Refresh sidebar/views
            if (window.app && typeof window.app.refreshSidebar === 'function') {
                await window.app.refreshSidebar();
            }
            if (window.app && window.app.currentView && typeof window.app.currentView.loadData === 'function') {
                try { await window.app.currentView.loadData(); } catch(e) {}
            }

        } catch (error) {
            showInlineMessage(window.i18n.t('title_error') || 'Erreur', error.message);
        } finally {
            btn.disabled = false;
            btn.innerText = 'Valider';
        }
    },


});
