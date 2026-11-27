// static/js/components/gateway_hint.js — Paiement via un intermédiaire (PayPal, SumUp…) dans les fenêtres de correction.
// Le libellé de la banque ne dit pas qui a été payé : aucune règle n'est créée. La case « Mémoriser cette règle » laisse
// place à une explication ; le nom donné reste sur l'opération et sera proposé aux paiements suivants du même montant.
window.GatewayHint = {
    _cache: {},

    async isGateway(rawLabel) {
        const raw = (rawLabel || '').trim();
        if (!raw) return false;
        if (!(raw in this._cache)) {
            try {
                const res = await API.post('/api/smart-labels/simulate', { raw_label: raw, use_ai_fallback: false });
                this._cache[raw] = Boolean(res && res.is_gateway);
            } catch (e) {
                return false;
            }
        }
        return this._cache[raw];
    },

    noteHtml() {
        const t = (k, f) => (window.i18n ? window.i18n.t(k, f) : f);
        return `${window.Icon ? window.Icon('info', 15) : ''}<div>
            <div class="gw-note-title">${escapeHtml(t('gateway_learn_title', 'Paiement via un intermédiaire (PayPal, SumUp…)'))}</div>
            <div class="gw-note-text">${escapeHtml(t('gateway_learn_text', "Ce libellé ne dit pas qui a été payé : aucune règle n'est créée. Ce nom sera proposé aux prochains paiements du même montant, vers le même jour du mois."))}</div>
        </div>`;
    },

    // card : la carte de la case à cocher ; note : l'emplacement de l'explication, masqué par défaut
    async apply(rawLabel, checkbox, card, note) {
        if (!card || !note) return;
        // L'affichage d'origine de la carte (souvent « flex » en ligne) est rétabli tel quel
        if (card.dataset.gwDisplay === undefined) card.dataset.gwDisplay = card.style.display || '';
        card.style.display = card.dataset.gwDisplay;
        note.style.display = 'none';
        const gateway = await this.isGateway(rawLabel);
        if (!gateway) return;
        if (checkbox) checkbox.checked = false;
        note.innerHTML = this.noteHtml();
        card.style.display = 'none';
        note.style.display = '';
    }
};
