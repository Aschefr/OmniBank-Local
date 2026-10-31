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
