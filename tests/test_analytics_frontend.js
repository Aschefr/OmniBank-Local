/**
 * Test unitaire frontend Node.js pour AnalyticsView & Générateur d'impression PDF
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// 1. Charger analytics.js et simuler un environnement global minimal
const analyticsCode = fs.readFileSync(path.join(__dirname, '../static/js/views/analytics.js'), 'utf8');

// Mock localStorage
const localStorageMap = {};
global.localStorage = {
    getItem: (key) => localStorageMap[key] || null,
    setItem: (key, val) => { localStorageMap[key] = str(val); },
    removeItem: (key) => { delete localStorageMap[key]; }
};
function str(v) { return typeof v === 'string' ? v : JSON.stringify(v); }

// Mock window & helpers
global.formatCurrency = (n) => `${(n || 0).toFixed(2).replace('.', ',')} €`;
global.window = {
    formatCurrency: global.formatCurrency,
    i18n: {
        t: (k) => k,
        tp: (k, params) => k
    },
    app: {
        getTypeLabel: (t) => t,
        config: { enable_org_mode: 'true' }
    }
};

// Exécuter analytics.js dans le contexte global
eval(analyticsCode);

const AnalyticsView = global.window.AnalyticsView;
assert.ok(AnalyticsView, "AnalyticsView doit être défini sur window");

console.log("✔ AnalyticsView chargé avec succès");

// 2. Test du générateur de Pie Chart SVG
const samplePieData = [
    { name: "Alimentation", amount: 450.0 },
    { name: "Loisirs", amount: 150.0 },
    { name: "Transport", amount: 100.0 }
];

const pieSvg = AnalyticsView._generatePieChartSVG(samplePieData);
assert.ok(typeof pieSvg === 'string', "Le retour de _generatePieChartSVG doit être une chaîne");
assert.ok(pieSvg.includes('<svg'), "Le SVG doit contenir une balise <svg>");
assert.ok(pieSvg.includes('Alimentation'), "Le SVG doit inclure le nom de la catégorie");
assert.ok(pieSvg.includes('450,00 €'), "Le SVG doit afficher le montant formaté");

console.log("✔ Test _generatePieChartSVG validé");

// 3. Test du générateur de Bar Chart SVG
const sampleMonths = ["2026-01", "2026-02"];
const sampleIncome = { "2026-01": 2000.0, "2026-02": 2100.0 };
const sampleExpense = { "2026-01": 1500.0, "2026-02": 1800.0 };

const barSvg = AnalyticsView._generateBarChartSVG(sampleMonths, sampleIncome, sampleExpense);
assert.ok(typeof barSvg === 'string', "Le retour de _generateBarChartSVG doit être une chaîne");
assert.ok(barSvg.includes('<svg'), "Le SVG doit contenir une balise <svg>");
assert.ok(barSvg.includes('01') || barSvg.includes('Jan'), "Le SVG doit contenir les mois");
assert.ok(barSvg.includes('#10b981'), "Le SVG doit utiliser la couleur verte pour les recettes");
assert.ok(barSvg.includes('#ef4444'), "Le SVG doit utiliser la couleur rouge pour les dépenses");

console.log("✔ Test _generateBarChartSVG validé");

// 4. Test du générateur de Bloc de Signature
const sigHtml = AnalyticsView._generateSignatureBlockHTML();
assert.ok(typeof sigHtml === 'string', "Le bloc de signature doit être une chaîne HTML");
assert.ok(sigHtml.includes('SIGNATURE') || sigHtml.includes('Trésorier') || sigHtml.includes('Président'), "Le bloc de signature doit contenir les postes officiels");

console.log("✔ Test _generateSignatureBlockHTML validé");

console.log("✅ TOUS LES TESTS FRONTEND ANALYTICS SONT VALIDÉS AVEC SUCCÈS !");
