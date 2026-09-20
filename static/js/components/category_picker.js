// category_picker.js — Reusable, searchable category picker with type restriction & direction awareness

window.CategoryPicker = {
    // Current open session state
    _current: null,

    /**
     * Find category object by name from window.app.categoriesList
     */
    _findCategory(name) {
        if (!name) return null;
        const cats = window.app?.categoriesList || [];
        return cats.find(c => (c.name || '').toLowerCase() === name.toLowerCase()) || null;
    },

    /**
     * Get or create the single floating popover element
     */
    _getPopover() {
        let popover = document.getElementById('categoryPickerPopover');
        if (!popover) {
            popover = document.createElement('div');
            popover.id = 'categoryPickerPopover';
            popover.style.display = 'none';
            document.body.appendChild(popover);

            // Close when clicking outside
            document.addEventListener('click', (e) => {
                if (!window.CategoryPicker._current) return;
                const pop = document.getElementById('categoryPickerPopover');
                const trigger = window.CategoryPicker._current.triggerEl;
                if (pop && !pop.contains(e.target) && trigger && !trigger.contains(e.target)) {
                    window.CategoryPicker.close();
                }
            });

            // Keyboard navigation
            document.addEventListener('keydown', (e) => {
                if (!window.CategoryPicker._current) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    window.CategoryPicker.close();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    window.CategoryPicker._navigateHighlight(1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    window.CategoryPicker._navigateHighlight(-1);
                } else if (e.key === 'Enter') {
                    const pop = document.getElementById('categoryPickerPopover');
                    const searchInput = pop?.querySelector('.cat-picker-search-input');
                    // Only intercept enter if popover is active
                    if (document.activeElement === searchInput || pop?.contains(document.activeElement)) {
                        e.preventDefault();
                        window.CategoryPicker._selectHighlighted();
                    }
                }
            });

            // Reposition or close on window scroll / resize
            window.addEventListener('resize', () => {
                if (window.CategoryPicker._current) {
                    window.CategoryPicker._updatePosition();
                }
            });
            window.addEventListener('scroll', () => {
                if (window.CategoryPicker._current) {
                    window.CategoryPicker._updatePosition();
                }
            }, true);
        }
        return popover;
    },

    /**
     * Helper to render trigger HTML
     * @param {Object} opts
     *   id: string
     *   value: string
     *   allowedTypes: string[] | string (e.g. ['expense_var', 'expense_fixed'])
     *   direction: 'debit' | 'credit' | 'transfer'
     *   inputClass: string (e.g. 'sync-cat', 'import-cat')
     *   placeholder: string
     *   disabled: boolean
     *   onChangeName: string (e.g. "window.BankSyncView.updateTxCat")
     *   extraDataAttrs: string (e.g. "data-csv-id='123'")
     */
    renderTriggerHtml(opts = {}) {
        const id = opts.id || ('cp_' + Math.random().toString(36).substring(2, 9));
        const val = opts.value || '';
        const placeholder = opts.placeholder || (window.i18n ? window.i18n.t('cat_picker_select') || '-- Catégorie --' : '-- Catégorie --');
        const inputClass = opts.inputClass || 'cat-picker-input';
        const allowedTypesStr = Array.isArray(opts.allowedTypes) ? opts.allowedTypes.join(',') : (opts.allowedTypes || '');
        const direction = opts.direction || '';

        const catObj = this._findCategory(val);
        const typeClass = catObj ? `type-${catObj.type}` : '';

        const escapedVal = (val || '').replace(/"/g, '&quot;');
        const labelText = val ? (window.escapeHtml ? window.escapeHtml(val) : val) : placeholder;
        const emptyClass = val ? '' : 'is-empty';

        return `
            <div class="category-picker-trigger ${opts.disabled ? 'is-disabled' : ''}" 
                 id="${id}_trigger" 
                 role="combobox"
                 aria-expanded="false"
                 data-target-id="${id}"
                 data-allowed-types="${allowedTypesStr}"
                 data-direction="${direction}"
                 ${opts.extraDataAttrs || ''}
                 onclick="window.CategoryPicker.open(this, { 
                     currentValue: document.getElementById('${id}').value, 
                     allowedTypes: '${allowedTypesStr}'.split(',').filter(Boolean),
                     direction: '${direction}',
                     targetId: '${id}',
                     onChange: ${opts.onChangeName ? opts.onChangeName : 'null'}
                 })">
                <span class="cat-picker-color-dot ${typeClass}" id="${id}_dot"></span>
                <span class="cat-picker-label ${emptyClass}" id="${id}_label">${labelText}</span>
                <span class="cat-picker-arrow">▾</span>
            </div>
            <input type="hidden" id="${id}" class="${inputClass}" value="${escapedVal}" data-cat-name="${escapedVal}">
        `;
    },

    /**
     * Open the picker popover attached to triggerEl
     */
    open(triggerEl, opts = {}) {
        if (!triggerEl) return;

        // If already open on the same trigger, close it
        if (this._current && this._current.triggerEl === triggerEl) {
            this.close();
            return;
        }

        // Close any currently open trigger
        if (this._current && this._current.triggerEl) {
            this._current.triggerEl.classList.remove('is-open');
        }

        triggerEl.classList.add('is-open');
        triggerEl.setAttribute('aria-expanded', 'true');

        const popover = this._getPopover();

        // Get categories list
        const allCats = window.app?.categoriesList || [];
        const allowedTypes = (opts.allowedTypes && opts.allowedTypes.length > 0) ? opts.allowedTypes : null;

        // Filter by allowedTypes
        let filteredCats = allCats.filter(c => !c.is_closed);
        if (allowedTypes) {
            filteredCats = filteredCats.filter(c => allowedTypes.includes(c.type));
        }

        const currentVal = opts.currentValue || (opts.targetId ? document.getElementById(opts.targetId)?.value : '') || '';

        // If currentVal is not in filteredCats, include it so user can see current selection
        if (currentVal && !filteredCats.some(c => c.name.toLowerCase() === currentVal.toLowerCase())) {
            const extra = allCats.find(c => c.name.toLowerCase() === currentVal.toLowerCase()) || { name: currentVal, type: 'neutral' };
            filteredCats.unshift(extra);
        }

        this._current = {
            triggerEl,
            opts,
            categories: filteredCats,
            allCats,
            allowedTypes,
            direction: opts.direction || triggerEl.dataset.direction || '',
            targetId: opts.targetId || triggerEl.dataset.targetId,
            currentVal,
            activeTab: 'all',
            searchQuery: '',
            highlightIndex: -1,
            onChange: opts.onChange || null
        };

        this._renderPopoverContent();
        this._updatePosition();
        popover.style.display = 'flex';

        // Focus search input
        const searchInput = popover.querySelector('.cat-picker-search-input');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
    },

    /**
     * Close the popover
     */
    close() {
        const popover = document.getElementById('categoryPickerPopover');
        if (popover) {
            popover.style.display = 'none';
        }
        if (this._current && this._current.triggerEl) {
            this._current.triggerEl.classList.remove('is-open');
            this._current.triggerEl.setAttribute('aria-expanded', 'false');
        }
        this._current = null;
    },

    /**
     * Programmatically update value of a picker trigger
     */
    setValue(targetIdOrTrigger, value, triggerChange = true) {
        let triggerEl, hiddenInput;
        if (typeof targetIdOrTrigger === 'string') {
            hiddenInput = document.getElementById(targetIdOrTrigger);
            triggerEl = document.getElementById(`${targetIdOrTrigger}_trigger`) || hiddenInput?.previousElementSibling;
        } else {
            triggerEl = targetIdOrTrigger;
            hiddenInput = triggerEl?.nextElementSibling;
        }

        if (hiddenInput) {
            hiddenInput.value = value || '';
            hiddenInput.setAttribute('data-cat-name', value || '');
        }

        if (triggerEl) {
            const labelEl = triggerEl.querySelector('.cat-picker-label');
            const dotEl = triggerEl.querySelector('.cat-picker-color-dot');
            const catObj = this._findCategory(value);

            if (labelEl) {
                const placeholder = window.i18n ? window.i18n.t('cat_picker_select') || '-- Catégorie --' : '-- Catégorie --';
                labelEl.textContent = value || placeholder;
                if (value) {
                    labelEl.classList.remove('is-empty');
                } else {
                    labelEl.classList.add('is-empty');
                }
            }

            if (dotEl) {
                dotEl.className = 'cat-picker-color-dot ' + (catObj ? `type-${catObj.type}` : '');
            }
        }

        if (triggerChange && hiddenInput) {
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
    },

    /**
     * Select a category and close
     */
    select(catName) {
        if (!this._current) return;
        const { targetId, triggerEl, onChange } = this._current;

        this.setValue(targetId || triggerEl, catName, true);

        if (typeof onChange === 'function') {
            const catObj = this._findCategory(catName);
            onChange(catName, catObj);
        }

        this.close();
    },

    /**
     * Clear category selection
     */
    clearSelection() {
        this.select('');
    },

    /**
     * Quick category creation within popover
     */
    async promptCreateCategory() {
        if (!this._current) return;
        const { allowedTypes, direction } = this._current;
        
        let targetType = 'expense_var';
        if (allowedTypes && allowedTypes.length === 1) {
            targetType = allowedTypes[0];
        } else if (allowedTypes && allowedTypes.includes('expense_fixed') && !allowedTypes.includes('expense_var')) {
            targetType = 'expense_fixed';
        } else if (allowedTypes && allowedTypes.includes('income')) {
            targetType = 'income';
        } else if (direction === 'credit') {
            targetType = 'income';
        } else if (this._current.activeTab === 'expense_fixed') {
            targetType = 'expense_fixed';
        }

        const promptTitle = window.i18n ? window.i18n.t('cat_picker_prompt_name') || 'Nom de la nouvelle catégorie :' : 'Nom de la nouvelle catégorie :';
        let name = null;
        if (typeof showInlinePrompt === 'function') {
            name = await showInlinePrompt(promptTitle);
        } else {
            name = prompt(promptTitle);
        }

        if (name && name.trim()) {
            try {
                const newCat = await API.post('/api/categories/', { name: name.trim(), type: targetType });
                // Refresh categories in app
                const categories = await API.get('/api/categories/');
                window.app = window.app || {};
                window.app.categoriesList = categories;

                if (typeof showToast === 'function') {
                    showToast(window.i18n ? window.i18n.t('cat_picker_created_success') || 'Catégorie créée avec succès' : 'Catégorie créée avec succès', 'success');
                }

                // Select the newly created category
                this.select(newCat.name);
            } catch (e) {
                console.error("Erreur création catégorie", e);
                if (typeof showInlineMessage === 'function') {
                    showInlineMessage('Erreur', e.message || 'Impossible de créer la catégorie');
                } else {
                    alert(e.message || 'Impossible de créer la catégorie');
                }
            }
        }
    },

    // ── Internal Helpers ─────────────────────────────────────────────

    _updatePosition() {
        if (!this._current || !this._current.triggerEl) return;
        const popover = document.getElementById('categoryPickerPopover');
        if (!popover) return;

        const rect = this._current.triggerEl.getBoundingClientRect();
        const popWidth = Math.max(260, Math.min(320, rect.width));
        popover.style.width = `${popWidth}px`;

        // Check horizontal space
        let left = rect.left;
        if (left + popWidth > window.innerWidth - 10) {
            left = window.innerWidth - popWidth - 10;
        }
        if (left < 10) left = 10;

        // Check vertical space (flip above if overflowing viewport bottom)
        const popHeight = 320; // Estimated max height
        let top = rect.bottom + 4;
        if (top + popHeight > window.innerHeight && rect.top - popHeight > 10) {
            top = rect.top - popHeight - 4;
        }

        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    },

    _renderPopoverContent() {
        const popover = document.getElementById('categoryPickerPopover');
        if (!popover || !this._current) return;

        const { allowedTypes, direction, categories } = this._current;

        // 1. Direction / Type banner
        let directionHtml = '';
        if (direction === 'debit' || (allowedTypes && (allowedTypes.includes('expense_var') || allowedTypes.includes('expense_fixed')) && !allowedTypes.includes('income'))) {
            directionHtml = `<span class="direction-pill direction-debit">🔴 ${window.i18n ? window.i18n.t('cat_direction_debit') || 'Sortie (Débit)' : 'Sortie (Débit)'}</span>`;
        } else if (direction === 'credit' || (allowedTypes && allowedTypes.includes('income') && !allowedTypes.includes('expense_var'))) {
            directionHtml = `<span class="direction-pill direction-credit">🟢 ${window.i18n ? window.i18n.t('cat_direction_credit') || 'Entrée (Crédit)' : 'Entrée (Crédit)'}</span>`;
        } else if (direction === 'transfer' || (allowedTypes && allowedTypes.includes('transfer'))) {
            directionHtml = `<span class="direction-pill direction-transfer">🔵 ${window.i18n ? window.i18n.t('cat_direction_transfer') || 'Virement' : 'Virement'}</span>`;
        }

        // 2. Segmented tabs if both expense_var and expense_fixed are allowed
        let tabsHtml = '';
        const hasVar = allowedTypes ? allowedTypes.includes('expense_var') : true;
        const hasFixed = allowedTypes ? allowedTypes.includes('expense_fixed') : true;
        if (hasVar && hasFixed && (!allowedTypes || !allowedTypes.includes('income'))) {
            const varCount = categories.filter(c => c.type === 'expense_var').length;
            const fixedCount = categories.filter(c => c.type === 'expense_fixed').length;
            const allCount = categories.length;

            const tAll = window.i18n ? window.i18n.t('cat_picker_all_types') || 'Tout' : 'Tout';
            const tVar = window.i18n ? window.i18n.t('cat_picker_variable') || 'Variables' : 'Variables';
            const tFixed = window.i18n ? window.i18n.t('cat_picker_fixed') || 'Fixes' : 'Fixes';

            tabsHtml = `
                <div class="cat-picker-type-tabs">
                    <button class="cat-picker-tab-btn ${this._current.activeTab === 'all' ? 'active' : ''}" onclick="window.CategoryPicker._setTab('all')">${tAll} (${allCount})</button>
                    <button class="cat-picker-tab-btn ${this._current.activeTab === 'expense_var' ? 'active' : ''}" onclick="window.CategoryPicker._setTab('expense_var')">${tVar} (${varCount})</button>
                    <button class="cat-picker-tab-btn ${this._current.activeTab === 'expense_fixed' ? 'active' : ''}" onclick="window.CategoryPicker._setTab('expense_fixed')">${tFixed} (${fixedCount})</button>
                </div>
            `;
        }

        const phSearch = window.i18n ? window.i18n.t('cat_picker_search_placeholder') || 'Rechercher une catégorie...' : 'Rechercher une catégorie...';
        const lblNoCat = window.i18n ? window.i18n.t('cat_picker_no_category') || 'Sans catégorie' : 'Sans catégorie';
        const lblNewCat = window.i18n ? window.i18n.t('cat_picker_new_category') || '+ Nouvelle catégorie...' : '+ Nouvelle catégorie...';

        popover.innerHTML = `
            <div class="cat-picker-header">
                <div class="cat-picker-direction-banner">
                    ${directionHtml}
                    <button class="cat-picker-clear-btn" onclick="window.CategoryPicker.clearSelection()" title="Désélectionner">✕ ${lblNoCat}</button>
                </div>
                ${tabsHtml}
            </div>
            <div class="cat-picker-search-wrap">
                <span class="cat-picker-search-icon">🔍</span>
                <input type="text" class="cat-picker-search-input" placeholder="${phSearch}" oninput="window.CategoryPicker._onSearch(this.value)">
                <button class="cat-picker-search-clear" onclick="window.CategoryPicker._clearSearch()" style="display:none;">✕</button>
            </div>
            <div class="cat-picker-list" id="categoryPickerList"></div>
            <div class="cat-picker-footer">
                <button class="cat-picker-new-btn" onclick="window.CategoryPicker.promptCreateCategory()">
                    <span>➕</span> <span>${lblNewCat}</span>
                </button>
            </div>
        `;

        this._filterAndRenderItems();
    },

    _setTab(tab) {
        if (!this._current) return;
        this._current.activeTab = tab;
        this._current.highlightIndex = -1;

        const popover = document.getElementById('categoryPickerPopover');
        popover?.querySelectorAll('.cat-picker-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(`'${tab}'`));
        });

        this._filterAndRenderItems();
    },

    _onSearch(query) {
        if (!this._current) return;
        this._current.searchQuery = query || '';
        this._current.highlightIndex = -1;

        const popover = document.getElementById('categoryPickerPopover');
        const clearBtn = popover?.querySelector('.cat-picker-search-clear');
        if (clearBtn) {
            clearBtn.style.display = query ? 'block' : 'none';
        }

        this._filterAndRenderItems();
    },

    _clearSearch() {
        const popover = document.getElementById('categoryPickerPopover');
        const searchInput = popover?.querySelector('.cat-picker-search-input');
        if (searchInput) {
            searchInput.value = '';
            searchInput.focus();
        }
        this._onSearch('');
    },

    _filterAndRenderItems() {
        if (!this._current) return;
        const listEl = document.getElementById('categoryPickerList');
        if (!listEl) return;

        const { categories, activeTab, searchQuery, currentVal } = this._current;

        let visible = categories;

        // Filter by tab
        if (activeTab !== 'all') {
            visible = visible.filter(c => c.type === activeTab);
        }

        // Filter by search query (accent & case insensitive)
        if (searchQuery && searchQuery.trim()) {
            visible = visible.filter(c => {
                if (typeof window.permissiveMatch === 'function') {
                    return window.permissiveMatch(c.name, searchQuery);
                }
                return (c.name || '').toLowerCase().includes(searchQuery.toLowerCase());
            });
        }

        if (visible.length === 0) {
            const emptyText = window.i18n ? window.i18n.t('cat_picker_no_results') || 'Aucune catégorie trouvée' : 'Aucune catégorie trouvée';
            listEl.innerHTML = `<div class="cat-picker-empty-state">${emptyText}</div>`;
            this._current.visibleItems = [];
            return;
        }

        this._current.visibleItems = visible;

        const typeLabels = {
            'expense_var': window.i18n ? window.i18n.t('cat_picker_variable') || 'Variable' : 'Variable',
            'expense_fixed': window.i18n ? window.i18n.t('cat_picker_fixed') || 'Fixe' : 'Fixe',
            'income': window.i18n ? window.i18n.t('cat_picker_income') || 'Recette' : 'Recette',
            'transfer': window.i18n ? window.i18n.t('cat_picker_transfer') || 'Virement' : 'Virement'
        };

        listEl.innerHTML = visible.map((c, idx) => {
            const isSelected = (c.name || '').toLowerCase() === (currentVal || '').toLowerCase();
            const typeLabel = typeLabels[c.type] || c.type;
            const escapedName = (c.name || '').replace(/"/g, '&quot;');
            const safeName = window.escapeHtml ? window.escapeHtml(c.name) : c.name;

            return `
                <div class="cat-picker-item ${isSelected ? 'is-selected' : ''}" 
                     data-index="${idx}"
                     data-name="${escapedName}"
                     onclick="window.CategoryPicker.select('${escapedName}')">
                    <span class="cat-picker-color-dot type-${c.type}"></span>
                    <span class="cat-picker-item-name">${safeName}</span>
                    <span class="cat-picker-item-type-badge type-${c.type}">${typeLabel}</span>
                    ${isSelected ? '<span class="cat-picker-item-check">✓</span>' : ''}
                </div>
            `;
        }).join('');
    },

    _navigateHighlight(direction) {
        if (!this._current || !this._current.visibleItems || this._current.visibleItems.length === 0) return;
        const total = this._current.visibleItems.length;
        let nextIndex = this._current.highlightIndex + direction;

        if (nextIndex < 0) nextIndex = total - 1;
        if (nextIndex >= total) nextIndex = 0;

        this._current.highlightIndex = nextIndex;

        const listEl = document.getElementById('categoryPickerList');
        if (!listEl) return;

        const items = listEl.querySelectorAll('.cat-picker-item');
        items.forEach((it, idx) => {
            if (idx === nextIndex) {
                it.classList.add('is-highlighted');
                it.scrollIntoView({ block: 'nearest' });
            } else {
                it.classList.remove('is-highlighted');
            }
        });
    },

    _selectHighlighted() {
        if (!this._current || !this._current.visibleItems) return;
        const { highlightIndex, visibleItems } = this._current;
        if (highlightIndex >= 0 && highlightIndex < visibleItems.length) {
            this.select(visibleItems[highlightIndex].name);
        } else if (visibleItems.length === 1) {
            // If only one match in search, enter selects it
            this.select(visibleItems[0].name);
        }
    }
};
