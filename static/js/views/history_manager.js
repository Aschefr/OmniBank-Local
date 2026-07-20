window.HistoryView = {
    actions: [],
    limit: 50,
    offset: 0,
    hasMore: true,

    render() {
        return `
            <div class="view-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                <h2>🕓 <span data-i18n="history_title">Historique de l'Activité & Annulations</span></h2>
                <button class="btn btn-secondary" onclick="window.HistoryView.purge()" data-i18n="history_purge_btn">Purger l'historique</button>
            </div>

            <div style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; margin-bottom: 20px;">
                <table class="data-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.15);">
                            <th style="padding: 12px 15px;" data-i18n="history_col_date">Date / Heure</th>
                            <th style="padding: 12px 15px;" data-i18n="history_col_action">Action</th>
                            <th style="padding: 12px 15px;" data-i18n="history_col_entity">Entité</th>
                            <th style="padding: 12px 15px;" data-i18n="history_col_detail">Détail</th>
                            <th style="padding: 12px 15px;" data-i18n="history_col_user">Utilisateur</th>
                            <th style="padding: 12px 15px; text-align: right;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="historyTableBody">
                        <tr>
                            <td colspan="6" style="padding: 30px; text-align: center; color: var(--text-muted);" data-i18n="loading">Chargement...</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                <button id="btnPrevHistory" class="btn btn-secondary" onclick="window.HistoryView.prevPage()" style="padding: 6px 12px; font-size: 12px;">← Précédent</button>
                <span id="historyPageLabel" style="font-size: 12px; color: var(--text-muted);">Page 1</span>
                <button id="btnNextHistory" class="btn btn-secondary" onclick="window.HistoryView.nextPage()" style="padding: 6px 12px; font-size: 12px;">Suivant →</button>
            </div>
        `;
    },

    async init() {
        this.offset = 0;
        await this.loadActions();
    },

    async loadActions() {
        try {
            const data = await API.get(`/api/history?limit=${this.limit}&offset=${this.offset}`);
            this.actions = data;
            this.hasMore = data.length === this.limit;
            this.renderTable();
        } catch (e) {
            console.error("Failed to load actions", e);
            showToast("Failed to load action history", "error");
        }
    },

    renderTable() {
        const tbody = document.getElementById('historyTableBody');
        const pageLabel = document.getElementById('historyPageLabel');
        const btnPrev = document.getElementById('btnPrevHistory');
        const btnNext = document.getElementById('btnNextHistory');

        if (!tbody) return;

        if (this.actions.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="padding: 30px; text-align: center; color: var(--text-muted);" data-i18n="history_no_actions">Aucune action enregistrée.</td>
                </tr>
            `;
            if (pageLabel) pageLabel.textContent = `Page ${Math.floor(this.offset / this.limit) + 1}`;
            if (btnPrev) btnPrev.disabled = this.offset === 0;
            if (btnNext) btnNext.disabled = true;
            return;
        }

        const actionTypes = {
            "CREATE": { text: "history_action_create", class: "badge-success", color: "#10b981", bg: "rgba(16,185,129,0.15)" },
            "UPDATE": { text: "history_action_update", class: "badge-warning", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
            "DELETE": { text: "history_action_delete", class: "badge-danger", color: "#ff5630", bg: "rgba(255,86,48,0.15)" }
        };

        const entityTypes = {
            "transaction": "history_entity_transaction",
            "account": "history_entity_account",
            "category": "history_entity_category",
            "budget": "history_entity_budget",
            "budget_allocation": "history_entity_budget_allocation",
            "recurrence_template": "history_entity_recurrence_template",
            "org_user": "history_entity_org_user",
            "paycheck_override": "history_entity_paycheck_override"
        };

        tbody.innerHTML = this.actions.map(act => {
            const actConf = actionTypes[act.action_type] || { text: act.action_type, color: "var(--text-main)", bg: "var(--border-color)" };
            const entityI18n = entityTypes[act.entity_type] || act.entity_type;
            const actionText = window.i18n.t(actConf.text) || act.action_type;
            const entityText = window.i18n.t(entityI18n) || act.entity_type;

            // Details formulation
            let detail = "";
            try {
                const prev = act.previous_state ? JSON.parse(act.previous_state) : null;
                const next = act.new_state ? JSON.parse(act.new_state) : null;
                const state = next || prev;

                if (state) {
                    const name = state.name || state.description || state.category_name || state.label || state.category;
                    const amount = state.amount !== undefined && state.amount !== null ? state.amount : state.monthly_amount;
                    const amtStr = amount !== undefined && amount !== null ? ` (${parseFloat(amount).toFixed(2).replace('.', ',')} €)` : "";

                    if (act.entity_type === 'transaction') {
                        detail = `${name || 'Sans description'}${amtStr}`;
                    } else if (act.entity_type === 'paycheck_override') {
                        const period = state.override_paycheck_period || "";
                        const valStr = amount !== undefined && amount !== null ? `${parseFloat(amount).toFixed(2).replace('.', ',')} €` : "";
                        detail = `${valStr}${period ? ` (${period})` : ""}`;
                    } else if (act.entity_type === 'budget_allocation') {
                        detail = `${state.note || 'Allocation'}${amtStr}`;
                    } else if (act.entity_type === 'recurrence_template') {
                        detail = `${name || 'Modèle'}${amtStr}`;
                    } else if (act.entity_type === 'budget') {
                        detail = `${name || 'Sans nom'}${amtStr}`;
                    } else {
                        detail = `${name || 'ID: ' + act.entity_id}${amtStr}`;
                    }
                }
            } catch (err) {
                detail = `ID: ${act.entity_id}`;
            }

            const formattedDate = act.timestamp ? new Date(act.timestamp).toLocaleString() : "";
            
            // Check if action can be undone
            const canUndo = !act.is_undone;
            const undoBtn = act.is_undone 
                ? `<span style="color: var(--text-muted); font-size:11px;" data-i18n="history_undone">Annulée</span>`
                : `<button class="btn btn-secondary" onclick="window.HistoryView.triggerUndo(${act.id})" style="padding: 3px 8px; font-size: 11px;" data-i18n="history_undo_btn">↩ Annuler</button>`;

            return `
                <tr style="border-bottom: 1px solid var(--border-color); vertical-align: middle;">
                    <td style="padding: 10px 15px; color: var(--text-muted); white-space: nowrap;">${formattedDate}</td>
                    <td style="padding: 10px 15px; white-space: nowrap;">
                        <span class="badge" style="padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; color: ${actConf.color}; background: ${actConf.bg}; border: 1px solid ${actConf.color}">
                            ${actionText}
                        </span>
                    </td>
                    <td style="padding: 10px 15px; font-weight: 500; white-space: nowrap;">${entityText}</td>
                    <td style="padding: 10px 15px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${detail}</td>
                    <td style="padding: 10px 15px; color: var(--text-muted); white-space: nowrap;">${act.user_name || '-'}</td>
                    <td style="padding: 10px 15px; text-align: right; white-space: nowrap;">${undoBtn}</td>
                </tr>
            `;
        }).join('');

        if (pageLabel) pageLabel.textContent = `Page ${Math.floor(this.offset / this.limit) + 1}`;
        if (btnPrev) btnPrev.disabled = this.offset === 0;
        if (btnNext) btnNext.disabled = !this.hasMore;
    },

    async prevPage() {
        if (this.offset > 0) {
            this.offset -= this.limit;
            await this.loadActions();
        }
    },

    async nextPage() {
        if (this.hasMore) {
            this.offset += this.limit;
            await this.loadActions();
        }
    },

    async triggerUndo(actionId) {
        try {
            // 1. Vérification de sécurité des dépendances
            const check = await API.get(`/api/history/${actionId}/check`);

            if (!check.safe) {
                // Construire le message de blocage
                const reasonMessages = {
                    "already_undone": window.i18n.t('history_check_already_undone') || "Cette action a déjà été annulée.",
                    "account_has_transactions": window.i18n.t('history_check_account_has_tx') || "Impossible : des opérations existent sur ce compte.",
                    "account_has_recurrences": window.i18n.t('history_check_account_has_rec') || "Impossible : des charges récurrentes existent sur ce compte.",
                    "budget_has_categories": window.i18n.t('history_check_budget_has_cats') || "Impossible : des catégories sont liées à cette enveloppe.",
                    "budget_has_allocations": window.i18n.t('history_check_budget_has_allocs') || "Impossible : des alimentations existent sur cette enveloppe.",
                    "budget_has_transactions": window.i18n.t('history_check_budget_has_tx') || "Impossible : des opérations sont assignées à cette enveloppe.",
                    "category_has_transactions": window.i18n.t('history_check_cat_has_tx') || "Impossible : des opérations utilisent cette catégorie.",
                    "category_has_budgets": window.i18n.t('history_check_cat_has_budgets') || "Impossible : des enveloppes de budget utilisent cette catégorie.",
                    "recurrence_has_reconciled": window.i18n.t('history_check_rec_has_reconciled') || "Impossible : des opérations réconciliées sont liées à ce modèle.",
                    "update_state_conflict": window.i18n.t('history_check_update_conflict') || "Impossible : une modification plus récente existe sur cette entité.",
                    "pk_conflict": window.i18n.t('history_check_pk_conflict') || "Impossible : l'entité existe déjà avec cet identifiant."
                };

                const msg = reasonMessages[check.reason] || (window.i18n.t('history_check_generic_block') || "Annulation impossible en raison de dépendances existantes.");
                await showInlineMessage(
                    window.i18n.t('history_check_blocked_title') || "⛔ Annulation bloquée",
                    msg
                );
                return;
            }

            // 2. Confirmation inline avant exécution
            const confirmed = await showInlineConfirm(
                window.i18n.t('history_confirm_undo_title') || "Confirmer l'annulation",
                window.i18n.t('history_confirm_undo_msg') || "Êtes-vous sûr de vouloir annuler cette action ? Cette opération est elle-même irréversible."
            );
            if (!confirmed) return;

            // 3. Exécution de l'annulation
            const res = await API.post(`/api/history/${actionId}/undo`);
            if (res.ok) {
                const successMsg = window.i18n.t('history_undo_success') || 'Action successfully undone.';
                showToast(successMsg, 'success');
                
                if (res.warning) {
                    const warningMsg = window.i18n.t(`history_undo_warning_cascade`) || 'Warning: cascade entities modified.';
                    setTimeout(() => showToast(warningMsg, 'info', 6000), 1000);
                }
                
                if (window.app && window.app.updateHeaderHistoryState) {
                    window.app.updateHeaderHistoryState();
                }
                if (window.app && window.app.refreshSidebar) {
                    window.app.refreshSidebar();
                }
                await this.loadActions();
            } else {
                const failMsg = (window.i18n.t('history_undo_fail') || 'Failed to undo').replace('{error}', res.detail || '');
                showToast(failMsg, 'error');
            }
        } catch (e) {
            console.error("Undo failed", e);
            showToast("Failed to undo: " + (e.message || e), "error");
        }
    },

    async purge() {
        if (!confirm("Voulez-vous purger l'historique des actions de plus de 90 jours ?")) return;
        try {
            await API.delete('/api/history/purge?older_than_days=90');
            showToast("Historique purgé.", "success");
            if (window.app && window.app.updateHeaderHistoryState) {
                window.app.updateHeaderHistoryState();
            }
            await this.loadActions();
        } catch (e) {
            console.error("Purge failed", e);
            showToast("Failed to purge", "error");
        }
    }
};
