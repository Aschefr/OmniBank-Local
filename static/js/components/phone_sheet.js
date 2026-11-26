// static/js/components/phone_sheet.js — Feuille d'actions du téléphone (ouverte par « ⋯ » sur une ligne de liste)
// Même présentation que le menu des Comptes (classes acc-sheet de accounts.css) : un en-tête qui décrit l'élément,
// puis une action par ligne. Fermeture : toucher à côté, Échap, ou choisir une action.
window.PhoneSheet = {
    _trigger: null,
    _onKey: null,

    /**
     * @param {string} headHtml   en-tête déjà échappé
     * @param {Array<{icon: string, label: string, danger?: boolean, onClick: Function}>} items
     * @param {HTMLElement} [trigger] bouton qui a ouvert la feuille (le focus y revient)
     * @param {string} [extraClass] classe ajoutée à la feuille, pour le style propre à une vue
     */
    open(headHtml, items, trigger, extraClass = '') {
        this.close();
        const backdrop = document.createElement('div');
        backdrop.className = 'acc-sheet-backdrop phone-sheet-backdrop';
        backdrop.innerHTML = `
            <div class="acc-sheet phone-sheet ${extraClass}" role="menu">
                <div class="acc-sheet-grab"></div>
                <div class="acc-sheet-head">${headHtml}</div>
            </div>`;
        const sheet = backdrop.querySelector('.phone-sheet');
        items.forEach(it => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'acc-menu-item' + (it.danger ? ' is-danger' : '');
            item.setAttribute('role', 'menuitem');
            item.innerHTML = `${it.icon || ''}<span></span>`;
            item.querySelector('span').textContent = it.label;
            item.onclick = () => { this.close(); it.onClick(); };
            sheet.appendChild(item);
        });
        backdrop.onclick = (e) => { if (e.target === backdrop) this.close(true); };
        this._trigger = trigger || null;
        this._onKey = (e) => { if (e.key === 'Escape') this.close(true); };
        document.addEventListener('keydown', this._onKey);
        document.body.appendChild(backdrop);
        const first = sheet.querySelector('.acc-menu-item');
        if (first) first.focus({ preventScroll: true });
    },

    close(restoreFocus = false) {
        document.querySelectorAll('.phone-sheet-backdrop').forEach(el => el.remove());
        if (this._onKey) document.removeEventListener('keydown', this._onKey);
        this._onKey = null;
        if (restoreFocus && this._trigger && document.body.contains(this._trigger)) {
            this._trigger.focus({ preventScroll: true });
        }
        this._trigger = null;
    },

    // Icônes communes des lignes de liste (traits, couleur du texte)
    icons: {
        dots: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg>`,
        search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>`,
        undo: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`,
        restore: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path></svg>`,
    },
};
