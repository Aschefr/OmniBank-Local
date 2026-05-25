/**
 * VirtualTable — lightweight virtual scroll for <table> elements.
 *
 * Renders only visible rows + buffer. Keeps full <table> semantics intact.
 * Uses spacer <tr> rows (with colspan) to maintain correct scroll height.
 *
 * Usage:
 *   const vt = new VirtualTable({
 *       tbodyId: 'timelineBody',
 *       scrollContainerSelector: '.app-main',
 *       rowHeight: 38,          // estimated, auto-measured after 1st render
 *       bufferRows: 20,         // extra rows above/below viewport
 *       colCount: 15,           // number of columns for spacer colspan
 *       emptyHTML: '<tr>...</tr>'
 *   });
 *   vt.setData(filteredRows);   // array of raw HTML strings, one per <tr>
 *   vt.destroy();               // cleanup on view change
 */
window.VirtualTable = class VirtualTable {
    constructor(opts) {
        this.tbodyId = opts.tbodyId;
        this.scrollSelector = opts.scrollContainerSelector || '.app-main';
        this.rowHeight = opts.rowHeight || 38;
        this.bufferRows = opts.bufferRows || 20;
        this.colCount = opts.colCount || 15;
        this.emptyHTML = opts.emptyHTML || '';
        this._rows = [];
        this._lastStart = -1;
        this._lastEnd = -1;
        this._measured = false;
        this._scrollHandler = null;
        this._rafId = null;
        this._pendingScroll = null;
        this._mobileBreakpoint = 768;
    }

    /** @returns {boolean} true when viewport is in mobile card-layout mode */
    _isMobile() {
        return window.innerWidth <= this._mobileBreakpoint;
    }

    /**
     * Set full row data and kick off rendering.
     * @param {string[]} rows — array of HTML strings, each a full <tr>…</tr>
     * @param {object} opts — optional { scrollToIndex, scrollToId }
     */
    setData(rows, opts = {}) {
        this._rows = rows || [];
        this._lastStart = -1;
        this._lastEnd = -1;
        this._measured = false;

        const tbody = document.getElementById(this.tbodyId);
        if (!tbody) return;

        if (this._rows.length === 0) {
            tbody.innerHTML = this.emptyHTML;
            this._detachScroll();
            return;
        }

        // On mobile: render all rows directly, no virtual scrolling
        if (this._isMobile()) {
            this._detachScroll();
            tbody.innerHTML = this._rows.join('');
            if (opts.scrollToId) {
                requestAnimationFrame(() => {
                    const el = document.getElementById(opts.scrollToId);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
            }
            return;
        }

        this._attachScroll();
        this._render(true);

        // Auto-scroll to a specific row after rendering
        if (opts.scrollToId) {
            // For scrollToId we need the target row to actually be in DOM.
            // Calculate approximate index by searching the raw HTML strings.
            const targetId = opts.scrollToId;
            let targetIdx = this._rows.findIndex(r => r.includes(`id="${targetId}"`));
            if (targetIdx >= 0) {
                this._scrollToIndex(targetIdx);
            }
        } else if (typeof opts.scrollToIndex === 'number') {
            this._scrollToIndex(opts.scrollToIndex);
        }
    }

    _scrollToIndex(idx) {
        const scroller = document.querySelector(this.scrollSelector);
        const tbody = document.getElementById(this.tbodyId);
        if (!scroller || !tbody) return;

        // First render the area around the target so it's in DOM
        const rh = this.rowHeight;
        const tbodyOffset = tbody.offsetTop;
        const targetScrollTop = tbodyOffset + (idx * rh) - (scroller.clientHeight / 2) + (rh / 2);

        // Force render around target area
        this._lastStart = -1;
        const savedScroll = scroller.scrollTop;
        scroller.scrollTop = Math.max(0, targetScrollTop);
        this._render(true);

        // Now smooth-scroll to exact position
        requestAnimationFrame(() => {
            scroller.scrollTo({
                top: Math.max(0, targetScrollTop),
                behavior: 'smooth'
            });
        });
    }

    /** Force a re-render at current scroll position (e.g., after column toggle). */
    refresh() {
        if (this._isMobile()) {
            const tbody = document.getElementById(this.tbodyId);
            if (tbody) tbody.innerHTML = this._rows.join('');
            return;
        }
        this._lastStart = -1;
        this._lastEnd = -1;
        this._render(true);
    }

    /** Cleanup listeners. */
    destroy() {
        this._detachScroll();
        if (this._rafId) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    // ── Internal ──────────────────────────────────────────────────────────

    _attachScroll() {
        if (this._scrollHandler) return; // already attached
        const scroller = document.querySelector(this.scrollSelector);
        if (!scroller) return;

        this._scrollHandler = () => {
            if (this._rafId) return; // already scheduled
            this._rafId = requestAnimationFrame(() => {
                this._rafId = null;
                this._render(false);
            });
        };
        scroller.addEventListener('scroll', this._scrollHandler, { passive: true });
    }

    _detachScroll() {
        if (!this._scrollHandler) return;
        const scroller = document.querySelector(this.scrollSelector);
        if (scroller) {
            scroller.removeEventListener('scroll', this._scrollHandler);
        }
        this._scrollHandler = null;
    }

    _render(force) {
        const tbody = document.getElementById(this.tbodyId);
        const scroller = document.querySelector(this.scrollSelector);
        if (!tbody || !scroller) return;

        const total = this._rows.length;
        const rh = this.rowHeight;

        // Where is the tbody in the scroll container?
        const tbodyTop = tbody.offsetTop;
        const scrollTop = scroller.scrollTop;
        const viewH = scroller.clientHeight;

        // Visible range relative to tbody
        const relTop = scrollTop - tbodyTop;
        const relBot = relTop + viewH;

        let startIdx = Math.floor(relTop / rh) - this.bufferRows;
        let endIdx = Math.ceil(relBot / rh) + this.bufferRows;

        startIdx = Math.max(0, startIdx);
        endIdx = Math.min(total - 1, endIdx);

        // Skip if range unchanged
        if (!force && startIdx === this._lastStart && endIdx === this._lastEnd) return;

        this._lastStart = startIdx;
        this._lastEnd = endIdx;

        // Build spacer + visible rows + spacer
        const slice = this._rows.slice(startIdx, endIdx + 1);
        const padTopH = startIdx * rh;
        const padBotH = Math.max(0, (total - endIdx - 1) * rh);
        const cols = this.colCount;

        let html = '';

        // Top spacer row
        if (padTopH > 0) {
            html += `<tr class="vt-spacer" aria-hidden="true"><td colspan="${cols}" style="height:${padTopH}px;padding:0;border:none;"></td></tr>`;
        }

        // Visible rows
        html += slice.join('');

        // Bottom spacer row
        if (padBotH > 0) {
            html += `<tr class="vt-spacer" aria-hidden="true"><td colspan="${cols}" style="height:${padBotH}px;padding:0;border:none;"></td></tr>`;
        }

        tbody.innerHTML = html;

        // Measure actual row height after first real render
        if (!this._measured && tbody.rows.length > 1) {
            // Find the first non-spacer row
            for (let i = 0; i < tbody.rows.length; i++) {
                const row = tbody.rows[i];
                if (!row.classList.contains('vt-spacer')) {
                    const measured = row.offsetHeight;
                    if (measured > 0 && Math.abs(measured - this.rowHeight) > 2) {
                        this.rowHeight = measured;
                        this._measured = true;
                        // Re-render with corrected height
                        this._lastStart = -1;
                        this._render(true);
                        return;
                    }
                    this._measured = true;
                    break;
                }
            }
        }
    }
};

