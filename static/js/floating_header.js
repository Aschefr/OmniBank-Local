// static/js/floating_header.js
// Floating (fixed) copy of a table / grid header, shown at the top of the page area while the content scrolls.
// position:sticky cannot work when the table sits in a horizontally scrolling box, so the header is cloned.
//
//   const cleanup = window.FloatingHeaders.attach([{ card, box, head }]);
//   - card: element the floating header is inserted into (removed with it)
//   - box:  the horizontally scrolling container of the content
//   - wrapClass: optional CSS class for the floating wrapper (to inherit table cell rules)
//   - head: a <thead> (cloned inside a copy of its <table>) or any element such as a CSS-grid header row
window.FloatingHeaders = {
    attach(specs) {
        const scroller = document.querySelector('.app-main');
        const items = (specs || []).filter(s => s && s.box && s.head && s.card);
        if (!scroller || !items.length) return () => {};

        const entries = items.map(spec => {
            const wrap = document.createElement('div');
            wrap.className = 'floating-head' + (spec.wrapClass ? ' ' + spec.wrapClass : '');
            wrap.style.cssText = 'display:none;position:fixed;overflow:hidden;z-index:40;pointer-events:none;box-shadow:0 4px 10px rgba(0,0,0,0.25);background:var(--bg-surface);';
            let clone = null;
            const isThead = spec.head.tagName === 'THEAD';
            if (isThead) {
                const table = spec.head.closest('table');
                clone = document.createElement('table');
                clone.className = table.className;
                clone.setAttribute('style', table.getAttribute('style') || '');
                clone.style.tableLayout = 'fixed';
                clone.style.margin = '0';
                clone.appendChild(spec.head.cloneNode(true));
                wrap.appendChild(clone);
            } else {
                clone = spec.head.cloneNode(true);
                clone.style.position = 'static';
                wrap.appendChild(clone);
            }
            spec.card.insertBefore(wrap, spec.card.firstChild);
            return { ...spec, wrap, clone, isThead, shown: false };
        });

        const update = () => {
            // The view's own sticky toolbar sits on top of the page area: the floating header goes right under it
            let top = scroller.getBoundingClientRect().top;
            const bar = scroller.querySelector('.view-header-bar');
            if (bar && getComputedStyle(bar).position === 'sticky') top = Math.max(top, bar.getBoundingClientRect().bottom);
            entries.forEach(it => {
                if (!it.head.isConnected || it.head.offsetHeight === 0) {
                    if (it.shown) { it.wrap.style.display = 'none'; it.shown = false; }
                    return;
                }
                const hr = it.head.getBoundingClientRect();
                const br = it.box.getBoundingClientRect();
                const visible = hr.top < top && br.bottom - hr.height > top && br.height > 0;
                if (!visible) {
                    if (it.shown) { it.wrap.style.display = 'none'; it.shown = false; }
                    return;
                }
                if (!it.shown) { it.wrap.style.display = 'block'; it.shown = true; }
                const full = it.isThead ? it.head.closest('table').offsetWidth : it.head.offsetWidth;
                if (it.isThead) {
                    it.clone.style.width = full + 'px';
                    const ths = it.head.querySelectorAll('th');
                    it.clone.querySelectorAll('th').forEach((c, i) => {
                        if (ths[i]) c.style.width = c.style.minWidth = c.style.maxWidth = ths[i].getBoundingClientRect().width + 'px';
                    });
                } else {
                    it.clone.style.width = full + 'px';
                    it.clone.style.minWidth = full + 'px';
                }
                it.wrap.style.left = br.left + 'px';
                it.wrap.style.width = br.width + 'px';
                it.wrap.style.top = top + 'px';
                it.wrap.scrollLeft = it.box.scrollLeft;
            });
        };

        let queued = false;
        const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; update(); }); } };
        scroller.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        entries.forEach(it => it.box.addEventListener('scroll', schedule, { passive: true }));
        schedule();
        return () => {
            scroller.removeEventListener('scroll', schedule);
            window.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            entries.forEach(it => it.wrap.remove());
        };
    }
};
