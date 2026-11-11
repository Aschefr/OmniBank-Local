// static/js/views/ai_model_study.js — Banc des modèles derrière « Comment ces modèles ont été choisis » :
// les mesures et les règles qui en tirent la note, les étiquettes et le modèle conseillé par carte graphique.
// Méthode commune aux applis (ai-bench/BENCH_PLAN.md), validée avec l'utilisateur le 2026-11-09.
// tests/test_ai_model_study.py vérifie que ces règles retrouvent les modèles du catalogue (ai_model_catalog.py).

(function (root) {
    // Campagne commune du 2026-11-09 au 11 (ai-bench/CAMPAGNE_2026-11.md) : trois passages par tâche, dans l'ordre.
    // Vrai relevé /120 libellés, libellés /45, enveloppes /97 contrôles sur 13 situations, conseiller /20 questions.
    // seconds : temps médian du conseiller ; quant : version par défaut d'Ollama ; gemma4:e4b et gemma4:31b dans leur
    // version du registre du 2026-11-10 (dc35e8d9c606, 17ba34c06c80).
    // vram : mémoire de la carte une fois chargé seul à 32K, lue par nvidia-smi moins la carte à vide, en Gio
    // (l'unité des « 24 Go » d'une carte). /api/ps la sous-estime. ai-bench/VRAM.md.
    // Les 7 autres modèles du premier banc (2026-11-06), tous écartés, n'ont pas été remesurés.
    const MODELS = [
        { name: 'gemma4:31b', real: [87, 87, 87], labels: [44, 44, 44], grouping: [95, 95, 95], chat: [20, 20, 20], seconds: 13.8, vram: 22.2, quant: 'Q4' },
        { name: 'qwen3.8:27b', real: [80, 82, 77], labels: [44, 44, 44], grouping: [92, 92, 93], chat: [20, 20, 20], seconds: 11.4, vram: 18.7, quant: 'Q4' },
        { name: 'bonsai-2:27b', real: [71, 72, 71], labels: [42, 42, 42], grouping: [93, 94, 94], chat: [20, 20, 20], seconds: 14.6, vram: 9.5, quant: 'Q2' },
        { name: 'gemma4:12b', real: [75, 76, 76], labels: [44, 44, 44], grouping: [91, 92, 92], chat: [17, 17, 18], seconds: 6.4, vram: 9.1, quant: 'Q4' },
        { name: 'gemma4:e4b', real: [69, 67, 68], labels: [42, 42, 42], grouping: [90, 90, 90], chat: [16, 18, 19], seconds: 3.4, vram: 5.4, quant: 'Q4' },
        { name: 'nemotron-3.5-bolt:e4b', real: [68, 70, 70], labels: [41, 41, 41], grouping: [89, 89, 88], chat: [19, 18, 16], seconds: 5.2, vram: 7.9, quant: 'Q4' },
        { name: 'mimo-v2.6:9b', real: [69, 69, 69], labels: [40, 40, 40], grouping: [82, 86, 82], chat: [17, 17, 18], seconds: 6.5, vram: 7.0, quant: 'Q4' },
        { name: 'qwen3.5:9b', real: [58, 63, 57], labels: [37, 36, 37], grouping: [87, 85, 86], chat: [17, 19, 18], seconds: 6.4, vram: 7.0, quant: 'Q4' },
        { name: 'qwen3.5:4b', real: [58, 59, 57], labels: [38, 38, 38], grouping: [77, 74, 74], chat: [18, 17, 18], seconds: 5.2, vram: 4.5, quant: 'Q4' },
    ];
    const TOTALS = { chat: 20, real: 120, labels: 45, grouping: 97 };
    // Poids de la note : le travail de tous les jours (relevé, libellés, enveloppes) d'abord. Le conseiller pèse peu
    // dans la note mais reste une condition (chatMin) : un conseiller qui se trompe invente des chiffres. Choix du 2026-11-09.
    const WEIGHTS = { real: 0.35, labels: 0.25, grouping: 0.25, chat: 0.15 };
    const RULES = {
        chatMin: 0.75,       // sous 75 % au conseiller sur un passage : Non retenu
        halfMin: 0.5,        // une tâche sous la moitié de son score sur un passage : Non retenu
        maxSeconds: 20,      // Top qualité et modèle conseillé par carte : réponse en moins de 20 s
        tieQuestions: 4,     // égalité : note à 4 questions les plus lourdes au plus, et chaque tâche à 4 de ses questions au plus
        cards: [8, 12, 16, 24],
        cardMarginGb: 1,     // un modèle tient sur une carte si sa mémoire est au plus la carte moins 1 Gio
    };

    const mean = passes => passes.reduce((a, b) => a + b, 0) / passes.length;
    const worst = passes => Math.min(...passes);
    const score = m => 10 * Object.keys(WEIGHTS).reduce((s, k) => s + WEIGHTS[k] * mean(m[k]) / TOTALS[k], 0);
    const note = m => Math.round(score(m) * 10) / 10;

    // Tâche qui écarte le modèle (la plus grave d'abord), ou null
    const exclusion = m => {
        if (worst(m.chat) < TOTALS.chat * RULES.chatMin) return 'chat';
        return ['real', 'labels', 'grouping'].find(k => worst(m[k]) < TOTALS[k] * RULES.halfMin) || null;
    };

    // Valeur d'une question dans la note sur 10, et marge d'égalité de la note (règle commune aux 3 applis, choisie
    // par l'utilisateur le 2026-11-09 : « Note et chaque tâche »)
    const questionPoints = k => 10 * WEIGHTS[k] / TOTALS[k];
    const heaviestQuestion = () => Math.max(...Object.keys(WEIGHTS).map(questionPoints));
    const tieNote = () => RULES.tieQuestions * heaviestQuestion();
    // À égalité : écart de note au plus tieNote, et chaque tâche (moyenne par passage) à tieQuestions questions au plus
    const tied = (a, b) => Math.abs(score(a) - score(b)) <= tieNote() + 1e-9
        && Object.keys(WEIGHTS).every(k => Math.abs(mean(a[k]) - mean(b[k])) <= RULES.tieQuestions + 1e-9);

    // Plus petite carte du palier sur laquelle le modèle tient, ou null (mémoire inconnue)
    const minCard = m => m.vram == null ? null
        : (RULES.cards.find(c => m.vram <= c - RULES.cardMarginGb) || RULES.cards[RULES.cards.length - 1]);

    function rank() {
        const rows = MODELS.map(m => Object.assign({}, m, { note: note(m), score: score(m), excluded: exclusion(m), card: minCard(m) }));
        const kept = rows.filter(r => !r.excluded);
        const fast = kept.filter(r => r.seconds < RULES.maxSeconds);
        // Meilleur : note non arrondie, pour ne pas dépendre de l'ordre de la liste quand deux notes affichées sont égales
        const best = list => list.reduce((a, b) => (b.score > a.score ? b : a), list[0]);
        // Par carte : meilleure note parmi ce qui tient, puis le plus léger parmi ceux à égalité avec elle
        const perCard = RULES.cards.map(card => {
            const fits = fast.filter(r => r.vram != null && r.vram <= card - RULES.cardMarginGb);
            if (!fits.length) return { card, model: null };
            const top = best(fits);
            const close = fits.filter(r => r === top || tied(r, top));
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
        rows.sort((a, b) => b.score - a.score);
        const precision = { question: Math.round(heaviestQuestion() * 1000) / 1000, note: Math.round(tieNote() * 100) / 100 };
        return { rows, perCard, tiers, precision };
    }

    root.AiModelStudy = { MODELS, TOTALS, WEIGHTS, RULES, rank, tied, mean, worst };
    if (typeof module !== 'undefined') module.exports = root.AiModelStudy;
})(typeof window !== 'undefined' ? window : globalThis);
