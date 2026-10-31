// static/js/app/nav_overflow.js
// Barre de navigation du haut : les onglets qui ne tiennent pas dans la largeur disponible
// passent dans un menu « Plus ▾ » (l'onglet actif reste toujours visible).

window.NavOverflow = {
    _nav: null,
    _moreBtn: null,
    _menu: null,
    _queued: false,

    init() {
        const nav = document.querySelector('.main-nav');
        if (!nav || this._nav) return;
        this._nav = nav;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'nav-btn nav-more-btn';
        btn.hidden = true;
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = '<span aria-hidden="true">⋯</span><span><span data-i18n="nav_more">Plus</span> ▾</span>';
        btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(); });
        nav.appendChild(btn);
        this._moreBtn = btn;

        const menu = document.createElement('div');
        menu.className = 'nav-more-menu';
        menu.hidden = true;
        document.body.appendChild(menu);
        this._menu = menu;

        document.addEventListener('click', (e) => {
            if (!menu.hidden && !menu.contains(e.target)) this.closeMenu();
        });
        window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeMenu(); });

        // Tout ce qui peut changer la place disponible ou la largeur des onglets
        const ro = new ResizeObserver(() => this.schedule());
        ro.observe(nav);
        ro.observe(document.querySelector('.app-header'));
        this._mo = new MutationObserver(() => this.schedule());
        this._mo.observe(nav, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
        window.addEventListener('resize', () => this.schedule());
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.schedule());
        this.schedule();
    },

    schedule() {
        if (this._queued) return;
        this._queued = true;
        requestAnimationFrame(() => { this._queued = false; this.update(); });
    },

    _items() {
        return [...this._nav.querySelectorAll('.nav-btn:not(.nav-more-btn)')]
            .filter(b => b.style.display !== 'none');
    },

    update() {
        const nav = this._nav;
        if (!nav || nav.offsetParent === null) return; // masquée (mode mobile)
        const items = this._items();
        const overflows = () => nav.scrollWidth > nav.clientWidth + 1;

        // On repart de « tout visible », puis on range les derniers onglets jusqu'à ce que ça tienne
        items.forEach(b => b.classList.remove('nav-overflowed'));
        this._moreBtn.hidden = true;
        if (overflows()) {
            this._moreBtn.hidden = false;
            for (let i = items.length - 1; i >= 0 && overflows(); i--) {
                if (items[i].classList.contains('active')) continue;
                items[i].classList.add('nav-overflowed');
            }
        }
        const hasHidden = items.some(b => b.classList.contains('nav-overflowed'));
        this._moreBtn.hidden = !hasHidden;
        if (!hasHidden) this.closeMenu();
        // Nos propres changements de classe ne doivent pas relancer un calcul
        this._mo.takeRecords();
    },

    toggleMenu() {
        if (this._menu.hidden) this.openMenu(); else this.closeMenu();
    },

    openMenu() {
        const menu = this._menu;
        menu.replaceChildren();
        this._items().filter(b => b.classList.contains('nav-overflowed')).forEach(src => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'nav-more-item';
            item.innerHTML = src.innerHTML;
            item.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
            item.addEventListener('click', () => { this.closeMenu(); src.click(); });
            menu.appendChild(item);
        });
        menu.hidden = false;
        const r = this._moreBtn.getBoundingClientRect();
        menu.style.top = (r.bottom + 6) + 'px';
        menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
        this._moreBtn.setAttribute('aria-expanded', 'true');
    },

    closeMenu() {
        if (!this._menu || this._menu.hidden) return;
        this._menu.hidden = true;
        this._moreBtn.setAttribute('aria-expanded', 'false');
    }
};

document.addEventListener('DOMContentLoaded', () => window.NavOverflow.init());
