// static/js/views/config/config_smart_labels.js
/**
 * Configuration sub-module: Smart Label Engine (Bank Label Matching & Auto-Learning).
 * Allows users to inspect, create, edit, toggle, and delete learned label mapping rules.
 * Supports instant bidirectional undo, manual rule protection, and multi-category mode.
 */

window.ConfigSmartLabels = {
    mappings: [],
    _editingMappingId: null,

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
                    <select id="smart_label_action_select" class="inline-input" style="min-width: 170px; font-size: 12px; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 6px; font-weight: 600;" onchange="window.ConfigSmartLabels.toggleActionType()">
                        <option value="map">${window.i18n?.t('smart_label_action_map') || '🏷️ Associer (Nom & Catégorie)'}</option>
                        <option value="multi">${window.i18n?.t('smart_label_action_multi') || '🔀 Multi-catégories (Nom seul)'}</option>
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
                <div style="max-height: 320px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-surface);">
                    <table class="data-table" style="width: 100%; margin: 0; font-size: 12px; table-layout: fixed;">
                        <colgroup>
                            <col style="width: 26%;">
                            <col style="width: 27%;">
                            <col style="width: 24%;">
                            <col style="width: 85px;">
                            <col style="width: 155px;">
                        </colgroup>
                        <thead style="position: sticky; top: 0; background: var(--bg-surface); z-index: 2; border-bottom: 2px solid var(--border-color);">
                            <tr>
                                <th style="padding: 8px 12px;" data-i18n="smart_label_raw_pattern">${window.i18n?.t('smart_label_raw_pattern') || 'Motif bancaire'}</th>
                                <th style="padding: 8px 12px;" data-i18n="smart_label_clean_desc">${window.i18n?.t('smart_label_clean_desc') || 'Nom personnalisé'}</th>
                                <th style="padding: 8px 12px;" data-i18n="smart_label_category">${window.i18n?.t('smart_label_category') || 'Catégorie'}</th>
                                <th style="padding: 8px 6px; text-align: center;" data-i18n="smart_label_usage_count">${window.i18n?.t('smart_label_usage_count') || 'Utilisations'}</th>
                                <th class="col-actions" style="padding: 8px 12px; text-align: right;" data-i18n="acc_th_actions">${window.i18n?.t('acc_th_actions') || 'Actions'}</th>
                            </tr>
                        </thead>
                        <tbody id="smartLabelsTableBody">
                            <tr><td colspan="5" style="text-align:center; padding: 20px; color: var(--text-muted);" data-i18n="smart_label_loading">${window.i18n?.t('smart_label_loading') || 'Chargement des règles...'}</td></tr>
                        </tbody>
                    </table>
                </div>

                <!-- Modal d'édition d'une règle de correspondance -->
                <div id="smartLabelEditModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 10000; align-items: center; justify-content: center; backdrop-filter: blur(4px);" onclick="if(event.target === this) window.ConfigSmartLabels.closeEditModal()">
                    <div class="modal-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; width: 480px; max-width: 92vw; padding: 22px; box-shadow: var(--shadow-lg);">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                            <h3 style="margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                                <span>✏️</span> <span>${window.i18n?.t('smart_label_edit_title') || 'Modifier la règle de correspondance'}</span>
                            </h3>
                            <button type="button" class="btn-action-del" onclick="window.ConfigSmartLabels.closeEditModal()" style="font-size: 16px; cursor: pointer; border: none; background: transparent; color: var(--text-muted);">✕</button>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <label style="display: block; font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">${window.i18n?.t('smart_label_edit_raw') || 'Motif bancaire d\'origine'}</label>
                            <div id="smartLabelEditRaw" style="font-family: monospace; font-size: 12px; font-weight: 700; padding: 8px 12px; background: var(--bg-base); border-radius: 6px; border: 1px solid var(--border-color); color: var(--text-main); word-break: break-all;"></div>
                        </div>

                        <div style="margin-bottom: 12px;">
                            <label style="display: block; font-size: 11px; font-weight: 700; color: var(--text-muted); margin-bottom: 4px; text-transform: uppercase;">${window.i18n?.t('smart_label_edit_clean') || 'Nom personnalisé propre'}</label>
                            <input type="text" id="smartLabelEditClean" class="inline-input" style="width: 100%; font-size: 13px; padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color);" placeholder="Nom propre (ex: Auchan)">
                        </div>

                        <div style="margin-bottom: 14px;">
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--text-main); margin-bottom: 8px;">
                                <input type="checkbox" id="smartLabelEditIsMulti" onchange="window.ConfigSmartLabels.onEditMultiToggle(this.checked)" style="transform: scale(1.15); cursor: pointer;">
                                <span>${window.i18n?.t('smart_label_edit_multi') || '🔀 Mode Multi-catégories (Nom seul, sans catégorie imposée)'}</span>
                            </label>
                            <div id="smartLabelEditCatWrap" style="transition: opacity 0.2s ease;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <label style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">${window.i18n?.t('smart_label_edit_cat') || 'Catégorie associée'}</label>
                                    <span id="smartLabelEditCatBadge" style="font-size: 10px; font-weight: 600; color: var(--text-muted);"></span>
                                </div>

                                <!-- Champ de recherche rapide permissif (insensible aux accents et à la casse) -->
                                <div style="position: relative; margin-bottom: 6px;">
                                    <input type="text" 
                                           id="smartLabelEditCatSearch" 
                                           class="inline-input" 
                                           style="width: 100%; font-size: 12px; padding: 6px 26px 6px 28px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base);" 
                                           placeholder="${window.i18n?.t('smart_label_edit_cat_search_ph') || 'Filtrer les catégories (ex: alim, rest, elec...)'}" 
                                           oninput="window.ConfigSmartLabels.filterEditCategories(this.value)"
                                           onkeydown="window.ConfigSmartLabels.onCatSearchKeydown(event)">
                                    <span style="position: absolute; left: 8px; top: 50%; transform: translateY(-50%); font-size: 11px; color: var(--text-muted); pointer-events: none;">🔍</span>
                                    <button type="button" 
                                            id="smartLabelEditCatSearchClear" 
                                            onclick="window.ConfigSmartLabels.clearEditCatSearch()" 
                                            style="display: none; position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 12px; padding: 0 4px;" 
                                            title="Effacer">✕</button>
                                </div>

                                <!-- Sélecteur filtré avec scroll -->
                                <select id="smartLabelEditCat" 
                                        size="5" 
                                        class="inline-input" 
                                        style="width: 100%; font-size: 12px; padding: 4px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-input); height: 110px; overflow-y: auto;"
                                        onchange="window.ConfigSmartLabels.onCatSelectChange(this.value)"
                                        ondblclick="window.ConfigSmartLabels.saveEditModal()">
                                </select>

                                <!-- Indicateur de sélection actuelle & bouton de remise à zéro -->
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 5px;">
                                    <div id="smartLabelEditCatCurrent" style="font-size: 11px; font-weight: 600;"></div>
                                    <button type="button" 
                                            onclick="window.ConfigSmartLabels.selectNoCategory()" 
                                            style="font-size: 10px; color: var(--text-muted); text-decoration: underline; background: none; border: none; cursor: pointer; padding: 0;">
                                        ${window.i18n?.t('smart_label_edit_cat_clear_btn') || '-- Sans catégorie --'}
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div style="margin-bottom: 18px; padding-top: 10px; border-top: 1px solid var(--border-color);">
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; cursor: pointer; color: var(--text-main);">
                                <input type="checkbox" id="smartLabelEditIsManual" style="transform: scale(1.15); cursor: pointer;">
                                <span>${window.i18n?.t('smart_label_edit_manual') || '🛡️ Sanctuariser en règle manuelle (protégée contre l\'auto-apprentissage)'}</span>
                            </label>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px;">
                            <button type="button" class="btn btn-secondary" onclick="window.ConfigSmartLabels.closeEditModal()" style="padding: 6px 14px; font-size: 12px; border-radius: 6px;">Annuler</button>
                            <button type="button" class="btn btn-primary" onclick="window.ConfigSmartLabels.saveEditModal()" style="padding: 6px 16px; font-size: 12px; border-radius: 6px; font-weight: 700;">Enregistrer</button>
                        </div>
                    </div>
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
        } else if (action === 'multi') {
            if (cleanInput) {
                cleanInput.disabled = false;
                cleanInput.style.opacity = '1';
                cleanInput.placeholder = window.i18n?.t('smart_label_clean_placeholder') || 'Nom personnalisé (ex: Carrefour, Amazon)';
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
            window.app = window.app || {};
            window.app.categoriesList = categories;
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
                            <div style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px;">
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

            const originBadge = m.is_manual
                ? `<button type="button" class="badge" onclick="window.ConfigSmartLabels.toggleManual(${m.id})" title="${window.i18n?.t('smart_label_btn_demote_tip') || 'Règle sanctuarisée (cliquer pour repasser en auto)'}" style="cursor: pointer; border: 1px solid rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 700; font-size: 10px; padding: 2px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; transition: transform 0.1s ease;">${window.i18n?.t('smart_label_badge_manual') || '🛡️ Manuelle'}</button>`
                : `<button type="button" class="badge" onclick="window.ConfigSmartLabels.toggleManual(${m.id})" title="${window.i18n?.t('smart_label_btn_promote_tip') || 'Règle auto-apprise (cliquer pour sanctuariser en manuelle)'}" style="cursor: pointer; border: 1px solid rgba(99, 102, 241, 0.35); background: rgba(99, 102, 241, 0.12); color: var(--accent); font-weight: 600; font-size: 10px; padding: 2px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 2px; transition: transform 0.1s ease;">${window.i18n?.t('smart_label_badge_auto') || '🤖 Auto'}</button>`;

            let catDisplay = '';
            if (m.is_multi_category) {
                catDisplay = `<button type="button" class="badge" onclick="window.ConfigSmartLabels.openEditModal(${m.id})" style="cursor: pointer; border: 1px solid rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.15); color: #f59e0b; padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; transition: transform 0.1s ease;" title="${window.i18n?.t('smart_label_multi_click_tip') || 'Marchand multi-catégories (cliquer pour modifier ou assigner une catégorie)'}">${window.i18n?.t('smart_label_badge_multi') || '🔀 Multi'}</span></button> ${originBadge}`;
            } else if (m.category) {
                catDisplay = `<button type="button" class="badge" onclick="window.ConfigSmartLabels.openEditModal(${m.id})" style="cursor: pointer; border: 1px solid rgba(99, 102, 241, 0.3); background: rgba(99, 102, 241, 0.12); color: var(--accent); padding: 2px 8px; border-radius: 6px; font-weight: 600; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; transition: transform 0.1s ease;" title="${window.i18n?.t('smart_label_cat_click_tip') || 'Cliquer pour modifier la catégorie ou le nom'}">🏷️ ${window.escapeHtml ? window.escapeHtml(m.category) : m.category}</button> ${originBadge}`;
            } else {
                catDisplay = `<button type="button" class="badge" onclick="window.ConfigSmartLabels.openEditModal(${m.id})" style="cursor: pointer; border: 1px dashed var(--border-color); background: transparent; color: var(--text-muted); padding: 2px 8px; border-radius: 6px; font-style: italic; font-size: 11px;" title="${window.i18n?.t('smart_label_cat_click_tip') || 'Cliquer pour assigner une catégorie'}">—</button> ${originBadge}`;
            }

            const promoteBtn = (!m.is_ignored)
                ? `<button class="btn btn-secondary" onclick="window.ConfigSmartLabels.toggleManual(${m.id})" title="${m.is_manual ? (window.i18n?.t('smart_label_btn_demote_tip') || 'Règle sanctuarisée (cliquer pour repasser en auto)') : (window.i18n?.t('smart_label_btn_promote_tip') || 'Sanctuariser cette règle')}" style="padding: 2px 6px; font-size: 10px; height: 26px; color: ${m.is_manual ? '#10b981' : 'var(--text-muted)'}; border-color: ${m.is_manual ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-color)'}; background: ${m.is_manual ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.04)'}; display: inline-flex; align-items: center; border-radius: 6px; font-weight: 700; cursor: pointer;">
                    🛡️
                </button>`
                : '';

            const toggleMultiBtn = (!m.is_ignored)
                ? `<button class="btn btn-secondary" onclick="window.ConfigSmartLabels.toggleMultiMapping(${m.id})" title="${m.is_multi_category ? (window.i18n?.t('smart_label_btn_unmulti_tip') || 'Mode multi-catégories actif (cliquer pour rétablir une catégorie)') : (window.i18n?.t('smart_label_btn_multi_tip') || 'Bascule Multi-catégories')}" style="padding: 2px 6px; font-size: 10px; height: 26px; color: ${m.is_multi_category ? '#f59e0b' : 'var(--text-muted)'}; border-color: ${m.is_multi_category ? 'rgba(245, 158, 11, 0.4)' : 'var(--border-color)'}; background: ${m.is_multi_category ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.04)'}; display: inline-flex; align-items: center; border-radius: 6px; font-weight: 700; cursor: pointer;">
                    🔀
                </button>`
                : '';

            const editBtn = (!m.is_ignored)
                ? `<button class="btn btn-secondary" onclick="window.ConfigSmartLabels.openEditModal(${m.id})" title="${window.i18n?.t('smart_label_btn_edit_tip') || 'Modifier cette règle'}" style="padding: 2px 6px; font-size: 10px; height: 26px; color: var(--accent); border-color: rgba(99, 102, 241, 0.3); background: rgba(99, 102, 241, 0.08); display: inline-flex; align-items: center; border-radius: 6px; font-weight: 600; cursor: pointer;">
                    ✏️
                </button>`
                : '';

            return `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 8px 12px; font-family: monospace; font-size: 11px; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${window.escapeHtml ? window.escapeHtml(m.raw_pattern) : m.raw_pattern}">
                        ${window.escapeHtml ? window.escapeHtml(m.raw_pattern) : m.raw_pattern}
                    </td>
                    <td style="padding: 8px 12px; font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;" title="Double-cliquer pour modifier" ondblclick="window.ConfigSmartLabels.openEditModal(${m.id})">
                        ${window.escapeHtml ? window.escapeHtml(m.clean_description) : m.clean_description}
                    </td>
                    <td style="padding: 8px 12px;">
                        ${catDisplay}
                    </td>
                    <td style="padding: 8px 6px; text-align: center;">
                        <span class="badge" style="background: rgba(16, 185, 129, 0.12); color: #10b981; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 6px;">
                            ${m.match_count || 1}
                        </span>
                    </td>
                    <td class="col-actions" style="padding: 8px 12px; text-align: right; overflow: visible;">
                        <div style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px;">
                            ${promoteBtn}
                            ${toggleMultiBtn}
                            ${editBtn}
                            <button class="btn btn-secondary" onclick="window.ConfigSmartLabels.toggleMappingStatus(${m.id})" title="${window.i18n?.t('smart_label_toggle_to_ignore') || 'Passer en statut Ignoré'}" style="padding: 2px 6px; font-size: 11px; height: 26px; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); background: rgba(239, 68, 68, 0.08); display: inline-flex; align-items: center; border-radius: 6px; font-weight: 600; cursor: pointer;">
                                🚫
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
        const query = (document.getElementById('smartLabelSearchInput')?.value || '').trim();
        if (!query) {
            this.renderMappings(this.mappings);
            return;
        }

        const filtered = this.mappings.filter(m => {
            const statusLabel = m.is_ignored ? 'Ignoré' : (m.is_multi_category ? 'Multi' : (m.is_manual ? 'Manuelle' : 'Auto'));
            const fields = [
                m.raw_pattern,
                m.clean_description,
                m.category,
                statusLabel
            ];
            return window.permissiveMatch(fields, query);
        });
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
                    showToast(window.i18n?.t('smart_label_status_mapped_toast') || 'Règle de correspondance réactivée', 'success', 4000, {
                        action: {
                            text: '↩️ Annuler',
                            callback: () => this.toggleMappingStatus(id)
                        }
                    });
                }
            } else {
                // Passer d'Associé -> Ignoré
                await API.post(`/api/smart-labels/mappings/${id}/toggle`, {});

                if (typeof showToast === 'function') {
                    showToast(window.i18n?.t('smart_label_status_ignored_toast') || 'Motif exclu des suggestions automatiques', 'info', 4000, {
                        action: {
                            text: '↩️ Annuler',
                            callback: () => this.toggleMappingStatus(id)
                        }
                    });
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
        const isMulti = action === 'multi';

        if (!raw) {
            if (typeof showInlineMessage === 'function') {
                showInlineMessage(window.i18n?.t('title_info') || 'Information', 'Veuillez saisir un motif bancaire.');
            }
            return;
        }

        try {
            const res = await API.post('/api/smart-labels/mappings', {
                raw_pattern: raw,
                clean_description: clean,
                category: cat,
                is_ignored: isIgnored,
                is_manual: true,
                is_multi_category: isMulti
            });

            if (res && res.ok) {
                if (rawInput) rawInput.value = '';
                if (cleanInput) cleanInput.value = '';
                if (catSelect) catSelect.value = '';
                await this.loadMappings();

                if (typeof showToast === 'function') {
                    showToast(window.i18n?.t('toast_config_saved') || 'Règle enregistrée avec succès', 'success', 4000, {
                        action: {
                            text: '↩️ Annuler',
                            callback: async () => {
                                if (res.id) {
                                    await API.delete(`/api/smart-labels/mappings/${res.id}`);
                                    await this.loadMappings();
                                    showToast('Création de la règle annulée', 'info');
                                }
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.error('[SmartLabels] Erreur ajout règle:', e);
            if (typeof showInlineMessage === 'function') {
                showInlineMessage('Erreur', e.detail || e.message || 'Impossible d\'enregistrer la règle');
            }
        }
    },

    async toggleManual(id) {
        const m = this.mappings.find(x => x.id === id);
        if (!m) return;
        const wasManual = !!m.is_manual;

        try {
            const res = await API.post(`/api/smart-labels/mappings/${id}/toggle-manual`, {});
            await this.loadMappings();

            const toastMsg = wasManual 
                ? (window.i18n?.t('smart_label_toast_demoted') || 'Règle rétablie en auto-apprentissage 🤖')
                : (window.i18n?.t('smart_label_toast_promoted') || 'Règle sanctuarisée en manuelle 🛡️');

            if (typeof showToast === 'function') {
                showToast(toastMsg, wasManual ? 'info' : 'success', 4000, {
                    action: {
                        text: '↩️ Annuler',
                        callback: () => this.toggleManual(id)
                    }
                });
            }
        } catch (e) {
            console.error('[SmartLabels] Erreur toggle manual:', e);
            if (typeof showToast === 'function') showToast('Erreur: ' + (e.detail || e.message), 'error');
        }
    },

    async promoteMapping(id) {
        return this.toggleManual(id);
    },

    async toggleMultiMapping(id) {
        const m = this.mappings.find(x => x.id === id);
        if (!m) return;
        const wasMulti = !!m.is_multi_category;

        try {
            const res = await API.post(`/api/smart-labels/mappings/${id}/toggle-multi`, {});
            await this.loadMappings();

            const toastMsg = wasMulti
                ? (res.category 
                    ? `Mode multi-catégories désactivé (Catégorie : ${res.category})` 
                    : (window.i18n?.t('smart_label_toast_multi_off') || 'Mode multi-catégories désactivé'))
                : (window.i18n?.t('smart_label_toast_multi_on') || 'Mode multi-catégories activé 🔀');

            if (typeof showToast === 'function') {
                showToast(toastMsg, 'info', 4000, {
                    action: {
                        text: '↩️ Annuler',
                        callback: () => this.toggleMultiMapping(id)
                    }
                });
            }
        } catch (e) {
            console.error('[SmartLabels] Erreur toggle multi:', e);
            if (typeof showToast === 'function') showToast('Erreur: ' + (e.detail || e.message), 'error');
        }
    },

    openEditModal(id) {
        const m = this.mappings.find(x => x.id === id);
        if (!m) return;
        this._editingMappingId = id;
        this._currentEditSelectedCat = m.category || '';

        const modal = document.getElementById('smartLabelEditModal');
        const rawEl = document.getElementById('smartLabelEditRaw');
        const cleanEl = document.getElementById('smartLabelEditClean');
        const isMultiEl = document.getElementById('smartLabelEditIsMulti');
        const catWrapEl = document.getElementById('smartLabelEditCatWrap');
        const searchInput = document.getElementById('smartLabelEditCatSearch');
        const isManualEl = document.getElementById('smartLabelEditIsManual');

        if (!modal) return;

        if (rawEl) rawEl.textContent = m.raw_pattern || '';
        if (cleanEl) cleanEl.value = m.clean_description || '';
        if (isMultiEl) isMultiEl.checked = !!m.is_multi_category;
        if (isManualEl) isManualEl.checked = !!m.is_manual;

        if (searchInput) searchInput.value = '';
        this.filterEditCategories('');

        if (catWrapEl) {
            catWrapEl.style.display = m.is_multi_category ? 'none' : 'block';
        }

        modal.style.display = 'flex';
        setTimeout(() => { if (cleanEl) cleanEl.focus(); }, 100);
    },

    filterEditCategories(query) {
        const catSelect = document.getElementById('smartLabelEditCat');
        const clearBtn = document.getElementById('smartLabelEditCatSearchClear');
        const badgeEl = document.getElementById('smartLabelEditCatBadge');
        if (!catSelect) return;

        const q = (query || '').trim();
        if (clearBtn) {
            clearBtn.style.display = q ? 'block' : 'none';
        }

        const categories = (window.app?.categoriesList || []).filter(c => !c.is_closed);

        let matched = categories;
        if (q) {
            matched = categories.filter(c => window.permissiveMatch ? window.permissiveMatch(c.name, q) : c.name.toLowerCase().includes(q.toLowerCase()));
        }

        if (badgeEl) {
            if (q) {
                const countTpl = window.i18n?.t('smart_label_edit_cat_matches') || '{count} catégorie(s)';
                badgeEl.textContent = countTpl.replace('{count}', matched.length);
                badgeEl.style.color = matched.length === 0 ? 'var(--danger-color, #ef4444)' : 'var(--text-muted)';
            } else {
                badgeEl.textContent = `${categories.length} catégories`;
                badgeEl.style.color = 'var(--text-muted)';
            }
        }

        const selectedVal = this._currentEditSelectedCat;
        const noCatText = window.i18n?.t('smart_label_no_cat') || '-- Sans catégorie --';

        let html = '';
        const matchPermissive = window.permissiveMatch || ((hay, needle) => (hay || '').toLowerCase().includes((needle || '').toLowerCase()));
        if (!q || matchPermissive(noCatText, q) || matchPermissive('sans categorie', q)) {
            html += `<option value="" ${!selectedVal ? 'selected' : ''}>${noCatText}</option>`;
        }

        matched.forEach(c => {
            const isSel = (c.name === selectedVal);
            html += `<option value="${c.name.replace(/"/g, '&quot;')}" ${isSel ? 'selected' : ''}>🏷️ ${c.name}</option>`;
        });

        if (matched.length === 0 && !html) {
            const noMatchText = window.i18n?.t('smart_label_edit_cat_no_match') || 'Aucune catégorie trouvée';
            html = `<option value="" disabled style="color: var(--text-muted); font-style: italic;">⚠️ ${noMatchText}</option>`;
        }

        catSelect.innerHTML = html;

        // Si l'utilisateur tape une recherche et qu'un seul résultat ressort, on le pré-sélectionne
        if (q && matched.length === 1) {
            this._currentEditSelectedCat = matched[0].name;
            catSelect.value = matched[0].name;
        } else if (matched.some(c => c.name === selectedVal)) {
            catSelect.value = selectedVal;
        } else if (!selectedVal) {
            catSelect.value = '';
        }

        this.updateSelectedCatLabel();
    },

    clearEditCatSearch() {
        const searchInput = document.getElementById('smartLabelEditCatSearch');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
        this.filterEditCategories('');
    },

    selectNoCategory() {
        this._currentEditSelectedCat = '';
        const catSelect = document.getElementById('smartLabelEditCat');
        if (catSelect) catSelect.value = '';
        this.updateSelectedCatLabel();
    },

    onCatSelectChange(val) {
        this._currentEditSelectedCat = val || '';
        this.updateSelectedCatLabel();
    },

    onCatSearchKeydown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const catSelect = document.getElementById('smartLabelEditCat');
            if (catSelect) catSelect.focus();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const catSelect = document.getElementById('smartLabelEditCat');
            if (catSelect && catSelect.options.length > 0) {
                const firstValid = Array.from(catSelect.options).find(opt => !opt.disabled);
                if (firstValid && !this._currentEditSelectedCat) {
                    this._currentEditSelectedCat = firstValid.value;
                    catSelect.value = firstValid.value;
                    this.updateSelectedCatLabel();
                }
            }
            this.saveEditModal();
        } else if (e.key === 'Escape') {
            e.stopPropagation();
            if (e.target.value) {
                this.clearEditCatSearch();
            } else {
                this.closeEditModal();
            }
        }
    },

    updateSelectedCatLabel() {
        const currentEl = document.getElementById('smartLabelEditCatCurrent');
        if (!currentEl) return;
        const prefix = window.i18n?.t('smart_label_edit_cat_selection') || 'Sélection :';
        if (this._currentEditSelectedCat) {
            currentEl.innerHTML = `<span style="color: var(--text-muted);">${prefix}</span> <span style="font-weight: 700; color: var(--primary-color, #3b82f6); background: rgba(59, 130, 246, 0.12); padding: 2px 6px; border-radius: 4px;">🏷️ ${this._currentEditSelectedCat}</span>`;
        } else {
            const noneText = window.i18n?.t('smart_label_no_cat') || '-- Sans catégorie --';
            currentEl.innerHTML = `<span style="color: var(--text-muted);">${prefix}</span> <span style="color: var(--text-muted); font-style: italic;">${noneText}</span>`;
        }
    },

    onEditMultiToggle(isChecked) {
        const catWrapEl = document.getElementById('smartLabelEditCatWrap');
        if (catWrapEl) {
            catWrapEl.style.display = isChecked ? 'none' : 'block';
        }
    },

    closeEditModal() {
        const modal = document.getElementById('smartLabelEditModal');
        if (modal) modal.style.display = 'none';
        this._editingMappingId = null;
        this._currentEditSelectedCat = null;
    },

    async saveEditModal() {
        const id = this._editingMappingId;
        if (!id) return;
        const m = this.mappings.find(x => x.id === id);
        if (!m) return;

        const cleanDesc = document.getElementById('smartLabelEditClean')?.value?.trim() || null;
        const isMulti = !!document.getElementById('smartLabelEditIsMulti')?.checked;
        const catSelect = document.getElementById('smartLabelEditCat');
        const category = isMulti ? null : (this._currentEditSelectedCat || catSelect?.value?.trim() || null);
        const isManual = !!document.getElementById('smartLabelEditIsManual')?.checked;

        const prevSnapshot = {
            clean_description: m.clean_description,
            category: m.category,
            is_multi_category: m.is_multi_category,
            is_manual: m.is_manual
        };

        try {
            await API.put(`/api/smart-labels/mappings/${id}`, {
                clean_description: cleanDesc,
                category: category,
                is_multi_category: isMulti,
                is_manual: isManual
            });

            this.closeEditModal();
            await this.loadMappings();

            if (typeof showToast === 'function') {
                showToast(window.i18n?.t('toast_config_saved') || 'Règle mise à jour avec succès', 'success', 4000, {
                    action: {
                        text: '↩️ Annuler',
                        callback: async () => {
                            try {
                                await API.put(`/api/smart-labels/mappings/${id}`, prevSnapshot);
                                await this.loadMappings();
                                showToast('Modification annulée', 'info');
                            } catch (_) {}
                        }
                    }
                });
            }
        } catch (e) {
            console.error('[SmartLabels] Erreur sauvegarde édition règle:', e);
            if (typeof showToast === 'function') showToast('Erreur: ' + (e.detail || e.message), 'error');
        }
    },

    async deleteMapping(id) {
        const m = this.mappings.find(x => x.id === id);
        const confirmMsg = window.i18n?.t('smart_label_delete_confirm') || 'Supprimer cette règle de correspondance ?';
        const ok = await showInlineConfirm('Suppression', confirmMsg);
        if (!ok) return;

        const prevSnapshot = m ? {
            raw_pattern: m.raw_pattern,
            clean_description: m.clean_description,
            category: m.category,
            is_ignored: m.is_ignored,
            is_manual: m.is_manual,
            is_multi_category: m.is_multi_category
        } : null;

        try {
            await API.delete(`/api/smart-labels/mappings/${id}`);
            await this.loadMappings();

            if (typeof showToast === 'function') {
                showToast('Règle supprimée', 'info', 4000, {
                    action: prevSnapshot ? {
                        text: '↩️ Annuler',
                        callback: async () => {
                            try {
                                await API.post('/api/smart-labels/mappings', prevSnapshot);
                                await this.loadMappings();
                                showToast('Suppression annulée : règle restaurée', 'success');
                            } catch (_) {}
                        }
                    } : null
                });
            }
        } catch (e) {
            console.error('[SmartLabels] Erreur suppression règle:', e);
            if (typeof showInlineMessage === 'function') {
                showInlineMessage('Erreur', e.detail || e.message || 'Impossible de supprimer la règle');
            }
        }
    }
};
