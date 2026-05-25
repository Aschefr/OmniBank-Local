// multi-select.js — Reusable multi-select dropdown with checkboxes
// Usage: MultiSelect.create(containerId, { allLabel, searchPlaceholder, onChange })
//        MultiSelect.populate(containerId, items[])
//        MultiSelect.getSelected(containerId) → string[]
//        MultiSelect.setSelected(containerId, values[])
//        MultiSelect.reset(containerId)

window.MultiSelect = {
    _instances: {},

    /**
     * Create a multi-select dropdown inside the given container.
     * @param {string} id - Container element ID
     * @param {object} opts - { allLabel, searchPlaceholder, onChange }
     */
    create(id, opts = {}) {
        const container = document.getElementById(id);
        if (!container) return;

        const allLabel = opts.allLabel || window.i18n.t('filter_all_categories');
        const searchPh = opts.searchPlaceholder || window.i18n.t('ph_search') || 'Rechercher...';

        container.className = 'multi-select';
        container.innerHTML = `
            <div class="multi-select-trigger" onclick="window.MultiSelect.toggle('${id}')">
                <span class="ms-label">${allLabel}</span>
                <span class="ms-badge" style="display:none;"></span>
                <span class="ms-arrow">▼</span>
            </div>
            <div class="multi-select-dropdown">
                <input type="text" class="ms-search" placeholder="${searchPh}" oninput="window.MultiSelect._filter('${id}', this.value)">
                <div class="ms-items"></div>
            </div>
        `;

        this._instances[id] = {
            items: [],
            selected: new Set(),
            allLabel,
            onChange: opts.onChange || (() => {}),
        };
    },

    /**
     * Populate the dropdown with category items.
     * Preserves current selection where possible.
     */
    populate(id, items) {
        const inst = this._instances[id];
        if (!inst) return;

        // Preserve existing selection
        const prev = new Set(inst.selected);
        inst.items = items;
        inst.selected = new Set([...prev].filter(v => items.includes(v)));

        this._renderItems(id);
        this._updateTrigger(id);
    },

    getSelected(id) {
        const inst = this._instances[id];
        if (!inst) return [];
        return [...inst.selected];
    },

    setSelected(id, values) {
        const inst = this._instances[id];
        if (!inst) return;
        inst.selected = new Set(values);
        this._renderItems(id);
        this._updateTrigger(id);
    },

    reset(id) {
        const inst = this._instances[id];
        if (!inst) return;
        inst.selected.clear();
        this._renderItems(id);
        this._updateTrigger(id);
        inst.onChange();
    },

    toggle(id) {
        const el = document.getElementById(id);
        if (!el) return;
        const wasOpen = el.classList.contains('open');
        // Close all other multi-selects first
        document.querySelectorAll('.multi-select.open').forEach(ms => ms.classList.remove('open'));
        if (!wasOpen) {
            el.classList.add('open');
            const search = el.querySelector('.ms-search');
            if (search) { search.value = ''; this._filter(id, ''); search.focus(); }
        }
    },

    _filter(id, query) {
        const container = document.getElementById(id);
        if (!container) return;
        const q = query.toLowerCase();
        container.querySelectorAll('.ms-item:not(.ms-all)').forEach(item => {
            const label = item.querySelector('span')?.textContent?.toLowerCase() || '';
            item.style.display = label.includes(q) ? 'flex' : 'none';
        });
    },

    _renderItems(id) {
        const inst = this._instances[id];
        const container = document.getElementById(id);
        if (!inst || !container) return;

        const itemsDiv = container.querySelector('.ms-items');
        const allChecked = inst.selected.size === 0;

        let html = `<label class="ms-item ms-all">
            <input type="checkbox" ${allChecked ? 'checked' : ''} onchange="window.MultiSelect._toggleAll('${id}', this.checked)">
            <span>${inst.allLabel}</span>
        </label>`;

        for (const item of inst.items) {
            const checked = inst.selected.has(item) ? 'checked' : '';
            const escaped = item.replace(/"/g, '&quot;');
            html += `<label class="ms-item">
                <input type="checkbox" value="${escaped}" ${checked} onchange="window.MultiSelect._toggleItem('${id}', '${escaped}', this.checked)">
                <span>${item}</span>
            </label>`;
        }

        itemsDiv.innerHTML = html;
    },

    _toggleAll(id, checked) {
        const inst = this._instances[id];
        if (!inst) return;
        inst.selected.clear();
        this._renderItems(id);
        this._updateTrigger(id);
        inst.onChange();
    },

    _toggleItem(id, value, checked) {
        const inst = this._instances[id];
        if (!inst) return;
        if (checked) {
            inst.selected.add(value);
        } else {
            inst.selected.delete(value);
        }
        this._renderItems(id);
        this._updateTrigger(id);
        inst.onChange();
    },

    _updateTrigger(id) {
        const inst = this._instances[id];
        const container = document.getElementById(id);
        if (!inst || !container) return;

        const label = container.querySelector('.ms-label');
        const badge = container.querySelector('.ms-badge');

        if (inst.selected.size === 0) {
            label.textContent = inst.allLabel;
            badge.style.display = 'none';
        } else if (inst.selected.size === 1) {
            label.textContent = [...inst.selected][0];
            badge.style.display = 'none';
        } else {
            label.textContent = `${inst.selected.size} ${window.i18n.t('filter_categories_count') || 'catégories'}`;
            badge.textContent = inst.selected.size;
            badge.style.display = 'inline-block';
        }
    },
};

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.multi-select')) {
        document.querySelectorAll('.multi-select.open').forEach(ms => ms.classList.remove('open'));
    }
});
