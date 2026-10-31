// Mobile Journal / Historique header: secondary actions behind "⋯", filters behind "Filtres".
// Desktop ignores these classes (mobile.css only).
window.MobileHeader = {
    toggleActions(btn) {
        const header = btn.closest('.view-header-sticky-container');
        const open = !header.classList.contains('mobile-actions-open');
        header.classList.toggle('mobile-actions-open', open);
        btn.setAttribute('aria-expanded', open);
        if (open) {
            const close = (e) => {
                if (btn.contains(e.target)) return;
                header.classList.remove('mobile-actions-open');
                btn.setAttribute('aria-expanded', 'false');
                document.removeEventListener('click', close, true);
            };
            setTimeout(() => document.addEventListener('click', close, true), 0);
        }
    },

    toggleFilters(btn) {
        const bar = btn.closest('.view-filter-bar');
        const open = !bar.classList.contains('mobile-filters-open');
        bar.classList.toggle('mobile-filters-open', open);
        btn.setAttribute('aria-expanded', open);
    },

    // Counts the filters that differ from their default value and shows it on the button
    bindFilterCount(barId) {
        const bar = document.getElementById(barId);
        if (!bar) return;
        const update = () => {
            let n = 0;
            bar.querySelectorAll('.view-filter-group select, .view-filter-toggles input[type="checkbox"]').forEach(el => {
                if (el.closest('[style*="display: none"], [style*="display:none"]')) return;
                if (el.type === 'checkbox') { if (el.checked) n++; return; }
                const def = el.options[0] ? el.options[0].value : '';
                if (el.value !== def) n++;
            });
            bar.querySelectorAll('.view-filter-group .multi-select[id]').forEach(ms => {
                if (window.MultiSelect && window.MultiSelect.getSelected(ms.id).length) n++;
            });
            const badge = bar.querySelector('.mobile-filters-count');
            if (badge) { badge.textContent = n; badge.hidden = n === 0; }
        };
        bar.addEventListener('change', update);
        bar.addEventListener('click', () => setTimeout(update, 0));
        // Saved filters are restored without a change event
        setTimeout(update, 1500);
        update();
    }
};

// Mobile operation cards: tapping the card opens the edit form (row actions are hidden)
document.addEventListener('click', (e) => {
    if (!window.matchMedia('(max-width: 768px)').matches) return;
    const row = e.target.closest('.timeline-table.mobile-card-table tbody tr[data-id]');
    if (!row || e.target.closest('button, a, input, select, label, [onclick]')) return;
    const editBtn = row.querySelector('.btn-action-edit');
    if (editBtn) editBtn.click();
});

// Operation form on mobile: full-screen sheet, compact pickers, advanced fields folded,
// secondary actions (duplicate, skip, delete) in the header "⋯" menu.
window.MobileOpForm = {
    // Footer buttons mirrored in the "⋯" menu; their own logic and labels stay the source of truth
    _menuSources: ['op_autopilot_toggle_btn', 'op_dup_btn', 'op_skip_btn', 'op_undo_last_btn'],

    isMobile() {
        return window.matchMedia('(max-width: 768px)').matches;
    },

    apply() {
        const modal = document.getElementById('operationModal');
        if (!modal || !this.isMobile()) return;
        // Account and category lists become native dropdowns
        // (the "no account" option is added by FormView.renderAccountsDropdowns)
        ['op_from_account', 'op_to_account', 'op_category'].forEach(id => {
            const sel = document.getElementById(id);
            if (sel) sel.removeAttribute('size');
        });
        // Advanced block opens by itself when the operation already uses one of its fields
        const val = id => (document.getElementById(id) || {}).value;
        const checked = id => !!(document.getElementById(id) || {}).checked;
        const used = checked('op_is_recurrent') || checked('op_is_salary') || checked('op_keep_open') ||
            !!val('op_budget_id') || !!val('op_recon_date') || !!val('op_check_slip') || !!val('op_attachments');
        this.setAdvanced(used);
        this.closeMenu();
        this._syncMoreButton();
    },

    setAdvanced(open) {
        const modal = document.getElementById('operationModal');
        modal.classList.toggle('op-m-adv-open', open);
        const btn = document.getElementById('op_m_adv_toggle');
        if (btn) btn.setAttribute('aria-expanded', open);
    },

    toggleAdvanced() {
        this.setAdvanced(!document.getElementById('operationModal').classList.contains('op-m-adv-open'));
    },

    _visibleSources() {
        return this._menuSources.map(id => document.getElementById(id))
            .filter(b => b && b.style.display !== 'none');
    },

    _syncMoreButton() {
        const more = document.getElementById('op_m_more');
        if (more) more.hidden = this._visibleSources().length === 0;
    },

    _renderMenu() {
        const menu = document.getElementById('op_m_menu');
        menu.innerHTML = '';
        this._visibleSources().forEach(src => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'op-m-menu-item' + (src.id === 'op_undo_last_btn' ? ' is-danger' : '');
            item.textContent = [...src.childNodes].map(n => n.textContent.trim()).filter(Boolean).join(' ');
            item.onclick = (e) => {
                e.stopPropagation();
                src.click();
                // Delete asks for a second tap and skip toggles its label: refresh in place
                setTimeout(() => {
                    if (document.getElementById('operationModal').style.display === 'none') return this.closeMenu();
                    this._renderMenu();
                    this._syncMoreButton();
                }, 50);
            };
            menu.appendChild(item);
        });
    },

    toggleMenu() {
        const menu = document.getElementById('op_m_menu');
        if (menu.hidden) {
            this._renderMenu();
            menu.hidden = false;
            document.getElementById('op_m_more').setAttribute('aria-expanded', 'true');
            const close = (e) => {
                if (menu.contains(e.target) || e.target.id === 'op_m_more') return;
                this.closeMenu();
                document.removeEventListener('click', close, true);
            };
            setTimeout(() => document.addEventListener('click', close, true), 0);
        } else {
            this.closeMenu();
        }
    },

    closeMenu() {
        const menu = document.getElementById('op_m_menu');
        if (menu) menu.hidden = true;
        const more = document.getElementById('op_m_more');
        if (more) more.setAttribute('aria-expanded', 'false');
    }
};

// Every open path (new, edit, duplicate, bank operation) ends by showing the modal
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('operationModal');
    if (!modal) return;
    let wasOpen = false;
    new MutationObserver(() => {
        const open = modal.style.display === 'flex';
        if (open && !wasOpen) setTimeout(() => window.MobileOpForm.apply(), 0);
        wasOpen = open;
    }).observe(modal, { attributes: true, attributeFilter: ['style'] });
});
