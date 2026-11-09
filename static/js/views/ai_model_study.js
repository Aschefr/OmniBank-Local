// static/js/views/ai_model_study.js — Banc des modèles derrière « Comment ces modèles ont été choisis » :
// les mesures et les règles qui en tirent la note, les étiquettes et le modèle conseillé par carte graphique.
// Méthode commune aux applis (ai-bench/LEARNINGS.md), validée avec l'utilisateur le 2026-11-09.
// tests/test_ai_model_study.py vérifie que ces règles retrouvent les modèles du catalogue (ai_model_catalog.py).

(function (root) {
    // Banc du 2026-11-06 : deux passes par tâche, [pire, meilleure].
    // seconds : temps médian du conseiller ; vram : mémoire une fois chargé à 32K (Go) ; quant : version par défaut d'Ollama.
    const MODELS = [
        { name: 'gemma4:31b', labels: [44, 44], real: [87, 87], grouping: [21, 21], chat: [12, 12], seconds: 23, vram: 19.9, quant: 'Q4' },
        { name: 'qwen3.8:27b', labels: [44, 44], real: [78, 80], grouping: [20, 20], chat: [12, 12], seconds: 13, vram: 17.5, quant: 'Q4' },
        { name: 'bonsai-2:27b', labels: [43, 43], real: [73, 74], grouping: [16, 20], chat: [12, 12], seconds: 16, vram: 9.2, quant: 'Q2' },
        { name: 'qwen3.6:27b', labels: [41, 41], real: [69, 69], grouping: [20, 21], chat: [11, 11], seconds: 40, vram: null, quant: null },
        { name: 'mimo-v2.6:9b', labels: [40, 40], real: [69, 70], grouping: [20, 21], chat: [9, 11], seconds: 7, vram: 6.3, quant: null },
        { name: 'qwen3.5:9b', labels: [38, 40], real: [59, 61], grouping: [20, 20], chat: [11, 11], seconds: 8, vram: 6.2, quant: null },
        { name: 'qwen3.5:4b', labels: [38, 38], real: [57, 58], grouping: [19, 20], chat: [11, 11], seconds: 6, vram: 3.8, quant: null },
        { name: 'gemma4:e4b', labels: [41, 42], real: [64, 66], grouping: [21, 21], chat: [9, 10], seconds: 5, vram: 3.5, quant: 'Q4' },
        { name: 'nemotron-3.5-bolt:e4b', labels: [41, 41], real: [68, 69], grouping: [22, 22], chat: [8, 10], seconds: 6, vram: 1.4, quant: null },
        { name: 'gemma4:12b', labels: [44, 44], real: [72, 74], grouping: [20, 20], chat: [7, 10], seconds: 10, vram: 8.1, quant: 'Q4' },
        { name: 'bonsai-2:9b', labels: [34, 35], real: [53, 53], grouping: [16, 20], chat: [10, 12], seconds: 7, vram: 3.5, quant: null },
        // gemma4:e2b : 0,5 Go relevé, chargement partiel probable ; mémoire non affichée
        { name: 'gemma4:e2b', labels: [42, 42], real: [54, 60], grouping: [18, 19], chat: [6, 8], seconds: 3.5, vram: null, quant: null },
        { name: 'ministral-3:14b', labels: [41, 41], real: [56, 57], grouping: [20, 22], chat: [6, 6], seconds: 5, vram: 11.1, quant: null },
        { name: 'ministral-3:8b', labels: [42, 42], real: [57, 59], grouping: [18, 18], chat: [6, 6], seconds: 2.2, vram: 7.7, quant: null },
        { name: 'lfm3:1.7b', labels: [23, 23], real: [0, 0], grouping: [10, 10], chat: [9, 10], seconds: 12, vram: 1.3, quant: null },
        { name: 'mistral-nemo', labels: [38, 38], real: [58, 58], grouping: [21, 21], chat: [0, 3], seconds: 1.4, vram: 9.9, quant: 'Q4' },
    ];
    const TOTALS = { chat: 12, real: 120, labels: 45, grouping: 22 };
    // Poids de la note : ce qui compte dans l'appli (le conseiller manipule vos chiffres, le vrai relevé est le quotidien)
    const WEIGHTS = { chat: 0.4, real: 0.3, labels: 0.15, grouping: 0.15 };
    const RULES = {
        chatMin: 9,          // sous 9/12 au conseiller sur une passe : Non retenu
        halfMin: 0.5,        // une tâche sous la moitié de son score sur une passe : Non retenu
        maxSeconds: 20,      // Top qualité et modèle conseillé par carte : réponse en moins de 20 s
        tieMargin: 0.3,      // à moins de 0,3 point (notes affichées), le modèle le plus léger l'emporte
        cards: [8, 12, 16, 24],
        cardMarginGb: 1,     // un modèle tient sur une carte si sa mémoire est au plus la carte moins 1 Go
    };

    const note = m => Math.round(10 * Object.keys(WEIGHTS)
        .reduce((s, k) => s + WEIGHTS[k] * ((m[k][0] + m[k][1]) / 2) / TOTALS[k], 0) * 10) / 10;

    // Tâche qui écarte le modèle (la plus grave d'abord), ou null
    const exclusion = m => {
        if (m.chat[0] < RULES.chatMin) return 'chat';
        return ['real', 'labels', 'grouping'].find(k => m[k][0] < TOTALS[k] * RULES.halfMin) || null;
    };

    // Plus petite carte du palier sur laquelle le modèle tient, ou null (mémoire inconnue)
    const minCard = m => m.vram == null ? null
        : (RULES.cards.find(c => m.vram <= c - RULES.cardMarginGb) || RULES.cards[RULES.cards.length - 1]);

    function rank() {
        const rows = MODELS.map(m => Object.assign({}, m, { note: note(m), excluded: exclusion(m), card: minCard(m) }));
        const kept = rows.filter(r => !r.excluded);
        const fast = kept.filter(r => r.seconds < RULES.maxSeconds);
        const best = list => list.reduce((a, b) => (b.note > a.note ? b : a), list[0]);
        // Par carte : meilleure note parmi ce qui tient, puis le plus léger à moins de tieMargin
        const perCard = RULES.cards.map(card => {
            const fits = fast.filter(r => r.vram != null && r.vram <= card - RULES.cardMarginGb);
            if (!fits.length) return { card, model: null };
            const top = best(fits).note;
            const close = fits.filter(r => top - r.note < RULES.tieMargin - 1e-9);
            return { card, model: close.reduce((a, b) => (b.vram < a.vram ? b : a)).name };
        });
        const tiers = {
            top: best(fast).name,
            alternative: best(kept).name,
            minimum: perCard[0].model,
        };
        const recommended = perCard.find(p => p.model && ![tiers.top, tiers.minimum].includes(p.model));
        if (recommended) tiers.recommended = recommended.model;
        rows.forEach(r => {
            r.tier = r.excluded ? 'rejected'
                : (Object.keys(tiers).find(t => tiers[t] === r.name && t !== 'alternative')
                    || (tiers.alternative === r.name && r.name !== tiers.top ? 'alternative' : null));
        });
        rows.sort((a, b) => b.note - a.note);
        return { rows, perCard, tiers };
    }

    root.AiModelStudy = { MODELS, TOTALS, WEIGHTS, RULES, rank };
    if (typeof module !== 'undefined') module.exports = root.AiModelStudy;
})(typeof window !== 'undefined' ? window : globalThis);
