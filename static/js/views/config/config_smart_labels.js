// static/js/views/config/config_smart_labels.js
/**
 * Configuration sub-module: Smart Label Engine (Bank Label Matching & Auto-Learning).
 * Allows users to inspect, create, and delete learned label mapping rules (including negative/ignored rules).
 */

window.ConfigSmartLabels = {
    mappings: [],

    render() {
        return `
            <div id="configSmartLabelsCard" class="config-card" style="margin-bottom: 20px; background: var(--bg-surface); padding: 20px; border-radius: 12px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                    <h3 style="display: flex; align-items: center; gap: 8px; margin: 0;" data-i18n="smart_label_section_title">
                        🏷️ ${window.i18n?.t('smart_label_section_title') || 'Règles de correspondance bancaire'}
                    </h3>
                    <span id="smartLabelsCountBadge" class="badge" style="background: rgba(99, 102, 241, 0.12); color: var(--accent); font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px;">
                        0 règle
                    </span>
                </div>

                <p style="color: var(--text-muted); font-size: 12px; margin-bottom: 15px; line-height: 1.4;" data-i18n="smart_label_section_desc">
                    ${window.i18n?.t('smart_label_section_desc') || 'OmniBank apprend automatiquement vos habitudes de nommage et vos catégories à chaque fois que vous enregistrez une opération bancaire. Vous pouvez consulter, ajouter ou supprimer vos correspondances ci-dessous.'}
                </p>

                <!-- Formulaire d'ajout rapide -->
                <div style="display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; background: var(--bg-base); padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                    <select id="smart_label_action_select" class="inline-input" style="min-width: 150px; font-size: 12px; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px; font-weight: 600;" onchange="window.ConfigSmartLabels.toggleActionType()">
                        <option value="map">${window.i18n?.t('smart_label_action_map') || '🏷️ Associer (Nom & Catégorie)'}</option>
                        <option value="ignore">${window.i18n?.t('smart_label_action_ignore') || '🚫 Ignorer (Ne jamais suggérer)'}</option>
                    </select>
                    <input type="text" id="smart_label_raw_input" class="inline-input" placeholder="${window.i18n?.t('smart_label_raw_placeholder') || 'Motif brut (ex: FULLI, PAYPAL...)'}" style="flex: 1; min-width: 140px; font-size: 12px; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px;" />
                    <input type="text" id="smart_label_clean_input" class="inline-input" placeholder="${window.i18n?.t('smart_label_clean_placeholder') || 'Nom personnalisé (ex: Fulli - Péages)'}" style="flex: 1; min-width: 160px; font-size: 12px; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px;" />
                    <select id="smart_label_cat_select" class="inline-input" style="flex: 1; min-width: 130px; font-size: 12px; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px;">
                        <option value="">${window.i18n?.t('smart_label_no_cat') || '-- Sans catégorie --'}</option>
                    </select>
                    <button class="btn btn-primary" onclick="window.ConfigSmartLabels.addMapping()" style="font-size: 12px; padding: 6px 14px; border-radius: 6px; font-weight: 700; white-space: nowrap;">
                        ➕ <span data-i18n="smart_label_add_rule">${window.i18n?.t('smart_label_add_rule') || 'Ajouter'}</span>
                    </button>
                </div>

                <!-- Recherche / Filtre -->
                <div style="margin-bottom: 8px;">
                    <input type="text" id="smartLabelSearchInput" class="inline-input" placeholder="${window.i18n?.t('smart_label_search_placeholder') || '🔍 Rechercher une règle de correspondance...'}" style="width: 100%; font-size: 11px; padding: 5px 10px; border: 1px solid var(--border-color); border-radius: 6px;" oninput="window.ConfigSmartLabels.filterMappings()" />
                </div>

                <!-- Tableau des règles réagencé -->
                <div style="max-height: 280px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-surface);">
                    <table class="data-table" style="width: 100%; margin: 0; font-size: 12px; table-layout: fixed;">
                        <colgroup>
                            <col style="width: 27%;">
                            <col style="width: 31%;">
                            <col style="width: 20%;">
                            <col style="width: 105px;">
                            <col style="width: 125px;">
                        </colgroup>
                        <thead style="position: sticky; top: 0; background: var(--bg-surface); z-index: 2; border-bottom: 2px solid var(--border-color);">
                            <tr>
                                <th style="padding: 8px 12px;" data-i18n="smart_label_raw_pattern">${window.i18n?.t('smart_label_raw_pattern') || 'Motif bancaire'}</th>
                                <th style="padding: 8px 12px;" data-i18n="smart_label_clean_desc">${window.i18n?.t('smart_label_clean_desc') || 'Nom personnalisé'}</th>
                                <th style="padding: 8px 12px;" data-i18n="smart_label_category">${window.i18n?.t('smart_label_category') || 'Catégorie'}</th>
                                <th style="padding: 8px 6px; text-align: center; overflow: visible; text-overflow: clip;" data-i18n="smart_label_usage_count">${window.i18n?.t('smart_label_usage_count') || 'Utilisations'}</th>
                                <th class="col-actions" style="padding: 8px 12px; text-align: right; overflow: visible; text-overflow: clip;" data-i18n="acc_th_actions">${window.i18n?.t('acc_th_actions') || 'Actions'}</th>
                            </tr>
                        </thead>
                        <tbody id="smartLabelsTableBody">
                            <tr><td colspan="5" style="text-align:center; padding: 20px; color: var(--text-muted);" data-i18n="smart_label_loading">${window.i18n?.t('smart_label_loading') || 'Chargement des règles...'}</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    },

    toggleActionType() {
        const action = document.getElementById('smart_label_action_select')?.value;
        const cleanInput = document.getElementById('smart_label_clean_input');
        const catSelect = document.getElementById('smart_label_cat_select');

        if (action === 'ignore') {
            if (cleanInput) {
                cleanInput.value = '';
                cleanInput.disabled = true;
                cleanInput.style.opacity = '0.5';
                cleanInput.placeholder = window.i18n?.t('smart_label_ignored_placeholder') || 'Ignoré (Pas d\'auto-suggestion)';
            }
            if (catSelect) {
                catSelect.value = '';
                catSelect.disabled = true;
                catSelect.style.opacity = '0.5';
            }
        } else {
            if (cleanInput) {
                cleanInput.disabled = false;
                cleanInput.style.opacity = '1';
                cleanInput.placeholder = window.i18n?.t('smart_label_clean_placeholder') || 'Nom personnalisé (ex: Fulli - Péages)';
            }
            if (catSelect) {
                catSelect.disabled = false;
                catSelect.style.opacity = '1';
            }
        }
    },

    async init() {
        await this.loadCategories();
        await this.loadMappings();
    },

    async loadCategories() {
        try {
            const categories = await API.get('/api/categories/');
            const sel = document.getElementById('smart_label_cat_select');
            if (sel) {
                const noCatText = window.i18n?.t('smart_label_no_cat') || '-- Sans catégorie --';
                sel.innerHTML = `<option value="">${noCatText}</option>` +
                    categories.filter(c => !c.is_closed).map(c =>
                        `<option value="${window.escapeHtml ? window.escapeHtml(c.name) : c.name}">${window.escapeHtml ? window.escapeHtml(c.name) : c.name}</option>`
                    ).join('');
            }
        } catch (e) {
            console.warn('[SmartLabels] Erreur chargement catégories:', e);
        }
    },

    async loadMappings() {
        try {
            this.mappings = await API.get('/api/smart-labels/mappings') || [];
            this.renderMappings(this.mappings);
        } catch (e) {
            console.warn('[SmartLabels] Erreur chargement des règles:', e);
            const tbody = document.getElementById('smartLabelsTableBody');
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; color: var(--text-muted);" data-i18n="smart_label_load_error">${window.i18n?.t('smart_label_load_error') || 'Erreur de chargement.'}</td></tr>`;
            }
        }
    },

    renderMappings(list) {
        const tbody = document.getElementById('smartLabelsTableBody');
        const badge = document.getElementById('smartLabelsCountBadge');
        if (badge) {
            const ruleWord = this.mappings.length > 1 ? (window.i18n?.t('smart_label_rules_plural') || 'règles') : (window.i18n?.t('smart_label_rules_singular') || 'règle');
            badge.textContent = `${this.mappings.length} ${ruleWord}`;
        }
        if (!tbody) return;

        if (!list || list.length === 0) {
            const emptyMsg = window.i18n?.t('smart_label_no_rules') || 'Aucune règle de correspondance. Elles s\'ajouteront automatiquement au fil de vos validations.';
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 25px; color: var(--text-muted); font-style: italic;">${emptyMsg}</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(m => {
            if (m.is_ignored) {
                const customDesc = m.clean_description
                    ? `<span style="color: var(--text-muted); font-style: italic; font-size: 11px; text-decoration: line-through 1px rgba(239, 68, 68, 0.4);">${window.escapeHtml ? window.escapeHtml(m.clean_description) : m.clean_description}</span> <span style="font-size: 10px; color: #ef4444; opacity: 0.8;">(${window.i18n?.t('smart_label_ignored_badge') || '🚫 Ignoré'})</span>`
                    : `<span style="color: var(--text-muted); font-style: italic; font-size: 11px;">${window.i18n?.t('smart_label_ignored_desc') || 'Ne jamais faire de suggestion automatique'}</span>`;

                return `
                    <tr style="border-bottom: 1px solid var(--border-color); background: rgba(239, 68, 68, 0.025);">
                        <td style="padding: 8px 12px; font-family: monospace; font-size: 11px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${window.escapeHtml ? window.escapeHtml(m.raw_pattern) : m.raw_pattern}">
                            ${window.escapeHtml ? window.escapeHtml(m.raw_pattern) : m.raw_pattern}
                        </td>
                        <td style="padding: 8px 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${customDesc}
                        </td>
                        <td style="padding: 8px 12px;">
                            <button type="button" onclick="window.ConfigSmartLabels.toggleMappingStatus(${m.id})" title="${window.i18n?.t('smart_label_toggle_to_map') || 'Cliquer pour basculer en statut Associé'}" style="cursor: pointer; border: 1px solid rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.12); color: #ef4444; padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 11px; transition: transform 0.1s, background 0.15s; display: inline-flex; align-items: center; gap: 4px;">
                                ${window.i18n?.t('smart_label_ignored_badge') || '🚫 Ignoré'}
                            </button>
                        </td>
                        <td style="padding: 8px 6px; text-align: center;">
                            <span class="badge" style="background: rgba(148, 163, 184, 0.15); color: var(--text-muted); font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 6px;">
                                ${m.match_count || 1}
                            </span>
                        </td>
                        <td class="col-actions" style="padding: 8px 12px; text-align: right; overflow: visible;">
                            <div style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px;">
                                <button class="btn btn-secondary" onclick="window.ConfigSmartLabels.toggleMappingStatus(${m.id})" title="${window.i18n?.t('smart_label_toggle_to_map') || 'Passer en statut Associé'}" style="padding: 2px 8px; font-size: 11px; height: 26px; color: #10b981; border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.08); display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; font-weight: 600; cursor: pointer;">
                                    🏷️ <span style="font-size: 11px;">${window.i18n?.t('smart_label_btn_map') || 'Associer'}</span>
                                </button>
                                <button class="btn btn-secondary" onclick="window.ConfigSmartLabels.deleteMapping(${m.id})" title="${window.i18n?.t('btn_delete') || 'Supprimer'}" style="padding: 2px 6px; font-size: 11px; height: 26px; color: var(--text-muted); border-radius: 6px; cursor: pointer;">
                                    ✕
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }

            const catBadge = m.category 
                ? `<span style="background: rgba(99, 102, 241, 0.12); color: var(--accent); padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">🏷️ ${window.escapeHtml ? window.escapeHtml(m.category) : m.category}</span>`
                : `<span style="color: var(--text-muted); font-style: italic; font-size: 11px;">—</span>`;

            return `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 8px 12px; font-family: monospace; font-size: 11px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${window.escapeHtml ? window.escapeHtml(m.raw_pattern) : m.raw_pattern}">
                        ${window.escapeHtml ? window.escapeHtml(m.raw_pattern) : m.raw_pattern}
                    </td>
                    <td style="padding: 8px 12px; font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${window.escapeHtml ? window.escapeHtml(m.clean_description) : m.clean_description}">
                        ${window.escapeHtml ? window.escapeHtml(m.clean_description) : m.clean_description}
                    </td>
                    <td style="padding: 8px 12px;">
                        ${catBadge}
                    </td>
                    <td style="padding: 8px 6px; text-align: center;">
                        <span class="badge" style="background: rgba(16, 185, 129, 0.12); color: #10b981; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 6px;">
                            ${m.match_count || 1}
                        </span>
                    </td>
                    <td class="col-actions" style="padding: 8px 12px; text-align: right; overflow: visible;">
                        <div style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px;">
                            <button class="btn btn-secondary" onclick="window.ConfigSmartLabels.toggleMappingStatus(${m.id})" title="${window.i18n?.t('smart_label_toggle_to_ignore') || 'Passer en statut Ignoré'}" style="padding: 2px 8px; font-size: 11px; height: 26px; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.08); display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; font-weight: 600; cursor: pointer;">
                                🚫 <span style="font-size: 11px;">${window.i18n?.t('smart_label_btn_ignore') || 'Ignorer'}</span>
                            </button>
                            <button class="btn btn-secondary" onclick="window.ConfigSmartLabels.deleteMapping(${m.id})" title="${window.i18n?.t('btn_delete') || 'Supprimer'}" style="padding: 2px 6px; font-size: 11px; height: 26px; color: var(--text-muted); border-radius: 6px; cursor: pointer;">
                                ✕
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    filterMappings() {
        const query = (document.getElementById('smartLabelSearchInput')?.value || '').toLowerCase().trim();
        if (!query) {
            this.renderMappings(this.mappings);
            return;
        }
        const filtered = this.mappings.filter(m =>
            (m.raw_pattern || '').toLowerCase().includes(query) ||
            (m.clean_description || '').toLowerCase().includes(query) ||
            (m.category || '').toLowerCase().includes(query) ||
            (m.is_ignored && ('ignoré'.includes(query) || 'ignored'.includes(query) || query.includes('igno'))) ||
            (!m.is_ignored && ('associé'.includes(query) || 'associe'.includes(query) || 'mapped'.includes(query)))
        );
        this.renderMappings(filtered);
    },

    async toggleMappingStatus(id) {
        const m = this.mappings.find(x => x.id === id);
        if (!m) return;

        try {
            if (m.is_ignored) {
                // Passer d'Ignoré -> Associé
                let cleanDesc = m.clean_description;
                if (!cleanDesc || cleanDesc.trim() === '') {
                    const defaultName = m.raw_pattern ? m.raw_pattern.charAt(0).toUpperCase() + m.raw_pattern.slice(1).toLowerCase() : '';
                    const promptTitle = window.i18n?.t('smart_label_prompt_clean_name') || 'Nom personnalisé pour ce motif :';
                    const inputName = typeof showInlinePrompt === 'function' 
                        ? await showInlinePrompt(promptTitle, defaultName)
                        : prompt(promptTitle, defaultName);
                    
                    if (inputName === null || inputName === undefined) {
                        return; // Annulation utilisateur
                    }
                    cleanDesc = inputName.trim() || defaultName;
                }

                await API.post(`/api/smart-labels/mappings/${id}/toggle`, {
                    clean_description: cleanDesc,
                    category: m.category || null
                });

                if (typeof showToast === 'function') {
                    showToast(window.i18n?.t('smart_label_status_mapped_toast') || 'Règle de correspondance réactivée', 'success');
                }
            } else {
                // Passer d'Associé -> Ignoré
                await API.post(`/api/smart-labels/mappings/${id}/toggle`, {});

                if (typeof showToast === 'function') {
                    showToast(window.i18n?.t('smart_label_status_ignored_toast') || 'Motif exclu des suggestions automatiques', 'info');
                }
            }

            await this.loadMappings();
            const searchInput = document.getElementById('smartLabelSearchInput');
            if (searchInput && searchInput.value.trim()) {
                this.filterMappings();
            }
        } catch (e) {
            console.error('[SmartLabels] Erreur lors de la bascule de statut:', e);
            if (typeof showInlineMessage === 'function') {
                showInlineMessage('Erreur', e.detail || e.message || 'Impossible de modifier le statut de la règle');
            }
        }
    },

    async addMapping() {
        const action = document.getElementById('smart_label_action_select')?.value || 'map';
        const rawInput = document.getElementById('smart_label_raw_input');
        const cleanInput = document.getElementById('smart_label_clean_input');
        const catSelect = document.getElementById('smart_label_cat_select');

        const raw = rawInput?.value?.trim();
        const clean = cleanInput?.value?.trim();
        const cat = catSelect?.value?.trim() || null;
        const isIgnored = action === 'ignore';

        if (!raw) {
            if (typeof showInlineMessage === 'function') {
                showInlineMessage(window.i18n?.t('title_info') || 'Information', 'Veuillez saisir un motif bancaire.');
            }
            return;
        }

        if (!isIgnored && !clean) {
            if (typeof showInlineMessage === 'function') {
                showInlineMessage(window.i18n?.t('title_info') || 'Information', 'Veuillez saisir un nom personnalisé.');
            }
            return;
        }

        try {
            await API.post('/api/smart-labels/mappings', {
                raw_pattern: raw,
                clean_description: isIgnored ? null : clean,
                category: isIgnored ? null : cat,
                is_ignored: isIgnored
            });

            if (rawInput) rawInput.value = '';
            if (cleanInput) cleanInput.value = '';
            if (catSelect) catSelect.value = '';

            await this.loadMappings();
            if (typeof showToast === 'function') {
                showToast(isIgnored ? 'Motif exclu des suggestions automatiques' : 'Règle de correspondance enregistrée', 'success');
            }
        } catch (e) {
            console.error('[SmartLabels] Erreur ajout règle:', e);
            if (typeof showInlineMessage === 'function') {
                showInlineMessage('Erreur', e.detail || e.message || 'Impossible d\'enregistrer la règle');
            }
        }
    },

    async deleteMapping(id) {
        const confirmMsg = window.i18n?.t('smart_label_delete_confirm') || 'Supprimer cette règle de correspondance ?';
        const ok = await showInlineConfirm('Suppression', confirmMsg);
        if (!ok) return;

        try {
            await API.delete(`/api/smart-labels/mappings/${id}`);
            await this.loadMappings();
            if (typeof showToast === 'function') {
                showToast('Règle supprimée', 'info');
            }
        } catch (e) {
            console.error('[SmartLabels] Erreur suppression règle:', e);
            if (typeof showInlineMessage === 'function') {
                showInlineMessage('Erreur', e.detail || e.message || 'Impossible de supprimer la règle');
            }
        }
    }
};

