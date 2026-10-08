"""
app/services/chat/knowledge_service.py — Service de base de connaissances applicatives pour l'IA locale.
Gère l'indexation, la recherche sémantique/par mots-clés et l'injection cognitive des règles de gestion d'OmniBank.
"""
import os
import re
import unicodedata
import logging
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

KNOWLEDGE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "knowledge"))

TOPIC_METADATA = {
    "reste_a_vivre": {
        "file": "reste_a_vivre_et_cycles.md",
        "title": "Reste à Vivre, Cycles de Paie et Cadence Journalière",
        "keywords": [
            "reste a vivre", "reste à vivre", "reste-a-vivre", "left to live", "left-to-live",
            "cycle de paie", "cycle financier", "pay cycle", "date de paie", "paycheck date",
            "cadence", "cadence journaliere", "cadence journalière", "€/j", "euros par jour",
            "euros/jour", "dépense par jour", "dépenses par jour", "daily spend", "daily pace",
            "jauge", "jauge analogique", "aiguille", "gauge", "outlier", "outliers",
            "dépense exceptionnelle", "dépenses exceptionnelles", "calcul du reste", "formule"
        ],
        "intent_patterns": [
            r"comment (est|sont) calcul(é|ee|es)? (mon|le) reste",
            r"pourquoi mon reste .*(baisse|diminue|augmente)",
            r"c['’]est quoi (la )?cadence",
            r"combien je peux d[ée]penser par jour",
            r"c['’]est quoi un outlier",
        ]
    },
    "autopilot": {
        "file": "autopilot_et_rapprochement.md",
        "title": "Auto-Pilote, Rapprochement Bancaire et Traçabilité",
        "keywords": [
            "autopilot", "auto-pilote", "auto pilote", "autopilote", "rapprochement",
            "rapprochement bancaire", "reconciliation", "reconcile", "sas", "sas de revue",
            "c'est ok", "c est ok", "linked_coming", "linked coming", "auto_commit", "auto commit",
            "opération à venir liée", "operation a venir liee", "rapprochement confirmé",
            "rapprochement confirme", "upcoming debit", "certitude", "certainty", "seuil",
            "tolerance", "tolérance", "rollback", "reversibilite", "réversibilité", "annuler action",
            "undo", "statement overlap", "chevauchement", "anti inversion"
        ],
        "intent_patterns": [
            r"comment fonctionne l['’]auto[- ]?pilote",
            r"pourquoi .* sas",
            r"que veut dire linked_coming",
            r"que signifie auto_commit",
            r"comment annuler une action de l['’]auto[- ]?pilote",
            r"c['’]est quoi la tol[ée]rance",
        ]
    },
    "budgets": {
        "file": "budgets_et_enveloppes.md",
        "title": "Enveloppes Budgétaires et Recalibrage Dynamique",
        "keywords": [
            "budget", "budgets", "enveloppe", "enveloppes", "envelope", "envelopes",
            "recalibrage", "recalibration", "dynamique", "moyenne mobile", "ema",
            "plafond", "plafonds", "dépassement", "depassement", "surconsommation",
            "alerte budget", "code couleur", "garde-fous", "projet d'épargne",
            "enveloppe projet", "limite de budget"
        ],
        "intent_patterns": [
            r"comment (fonctionnent|marchent) les enveloppes",
            r"comment est recalcul[ée] (mon|le) budget",
            r"pourquoi mon budget (a chang[ée]|a augment[ée]|a diminu[ée])",
            r"c['’]est quoi une enveloppe dynamique",
            r"que signifie l['’]alerte rouge sur mon budget",
        ]
    },
    "simulateur": {
        "file": "simulateur_what_if.md",
        "title": "Simulateur What-If et Projections Prévisionnelles",
        "keywords": [
            "simulateur", "simulator", "what-if", "what if", "simulation", "simuler",
            "projet", "projections", "forecast", "trajectoire", "cône de confiance",
            "cone de confiance", "brownien", "incertitude", "saisonnalite", "saisonnalité",
            "prudence", "curseur de prudence", "achat immobilier", "achat vehicule",
            "achat véhicule", "emprunt", "prêt", "taux d'endettement", "33%",
            "prévision 3 mois", "prévisions cockpit", "horizon 7 jours"
        ],
        "intent_patterns": [
            r"comment fonctionne le simulateur",
            r"comment simuler (un achat|un projet|un prêt|un credit)",
            r"c['’]est quoi (le )?c[ôo]ne de confiance",
            r"comment sont calcul[ée]es les pr[ée]visions",
            r"que veut dire le curseur de prudence",
        ]
    },
    "comptes_imports": {
        "file": "comptes_et_imports.md",
        "title": "Comptes Bancaires, Imports et Synchronisation",
        "keywords": [
            "compte", "comptes", "checking", "savings", "livret a", "livrets",
            "import", "importation", "csv", "xlsx", "excel", "relevé", "releve",
            "woob", "weboob", "synchro bancaire", "synchronisation directe",
            "banque en ligne", "coffre-fort", "coffre fort", "vault", "chiffrement",
            "aes", "pbkdf2", "mot de passe maître", "virement interne", "virements internes",
            "doublons", "anti-doublons"
        ],
        "intent_patterns": [
            r"comment importer (mon|mes|un) relev[ée]",
            r"comment synchroniser ma banque",
            r"mes mots de passe sont-ils (chiffr[ée]s|s[ée]curis[ée]s)",
            r"comment sont g[ée]r[ée]s les virements internes",
            r"est-ce que woob est s[ée]curis[ée]",
        ]
    },
    "confidentialite_modes": {
        "file": "modes_et_confidentialite.md",
        "title": "Souveraineté, Modes de Fonctionnement et Confidentialité",
        "keywords": [
            "confidentialite", "confidentialité", "privacy", "mode privé", "mode prive",
            "flou", "blur", "privacy-blur", "souverainete", "souveraineté", "offline",
            "local-first", "zero-cloud", "zéro cloud", "zero cloud", "telemetrie",
            "télémétrie", "ollama local", "mode personnel", "mode organisation",
            "licence", "cse", "association", "roles ia", "rôles ia"
        ],
        "intent_patterns": [
            r"mes donn[ée]es partent-elles dans le cloud",
            r"comment fonctionne le mode priv[ée]",
            r"quelle diff[ée]rence entre mode personnel et organisation",
            r"est-ce que omnibank est s[ée]curis[ée]",
        ]
    }
}

_KNOWLEDGE_CACHE: Dict[str, str] = {}


def _normalize_text(text: str) -> str:
    """Supprime les accents et met en minuscules pour faciliter le matching."""
    if not text:
        return ""
    text = text.lower()
    text = unicodedata.normalize('NFKD', text).encode('ASCII', 'ignore').decode('utf-8')
    return text


def load_knowledge_doc(topic_id: str) -> Optional[str]:
    """Charge le contenu Markdown d'une fiche de connaissances."""
    if topic_id in _KNOWLEDGE_CACHE:
        return _KNOWLEDGE_CACHE[topic_id]

    meta = TOPIC_METADATA.get(topic_id)
    if not meta:
        return None

    file_path = os.path.join(KNOWLEDGE_DIR, meta["file"])
    try:
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                content = f.read()
                _KNOWLEDGE_CACHE[topic_id] = content
                return content
    except Exception as e:
        logger.warning(f"[Knowledge] Impossible de charger le document {file_path}: {e}")

    return None


def resolve_relevant_knowledge(query: str, max_topics: int = 2) -> Optional[str]:
    """
    Analyse la requête de l'utilisateur et extrait les fiches de connaissances
    OmniBank les plus pertinentes pour enrichir le prompt système.
    """
    if not query or len(query.strip()) < 3:
        return None

    norm_query = _normalize_text(query)
    scores: Dict[str, float] = {}

    for topic_id, meta in TOPIC_METADATA.items():
        score = 0.0

        # Test des patterns d'intention regex
        for pattern in meta.get("intent_patterns", []):
            if re.search(pattern, norm_query, re.IGNORECASE):
                score += 5.0

        # Test des mots-clés
        for kw in meta.get("keywords", []):
            norm_kw = _normalize_text(kw)
            if " " in norm_kw:
                # Expression multi-mots
                if norm_kw in norm_query:
                    score += 3.0
            else:
                # Mot simple
                pattern = r'\b' + re.escape(norm_kw) + r'\b'
                if re.search(pattern, norm_query, re.IGNORECASE):
                    score += 1.0

        if score > 0:
            scores[topic_id] = score

    if not scores:
        return None

    # Sélectionner les N meilleurs topics au-dessus du seuil minimum
    sorted_topics = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    selected_topics = [t[0] for t in sorted_topics[:max_topics] if t[1] >= 1.5]

    if not selected_topics:
        return None

    output_blocks = []
    for topic_id in selected_topics:
        content = load_knowledge_doc(topic_id)
        if content:
            meta = TOPIC_METADATA[topic_id]
            output_blocks.append(f"### [OMNIBANK KNOWLEDGE: {meta['title'].upper()}]\n{content}")

    if not output_blocks:
        return None

    header = (
        "=== AUTHORITATIVE OMNIBANK APPLICATION RULES & CALCULATION REFERENCE ===\n"
        "The following documentation describes the exact formulas, thresholds, and operational rules "
        "implemented in OmniBank. Use these authoritative specifications to accurately answer the user's questions "
        "about application calculations, Auto-Pilot states, envelopes, simulations, and features.\n\n"
    )
    return header + "\n\n---\n\n".join(output_blocks)


def get_application_knowledge(topic: Optional[str] = None) -> Dict[str, Any]:
    """
    Outil d'interrogation documentaire callable par le modèle ou le contrôleur.
    """
    if topic:
        norm_topic = _normalize_text(topic)
        matched_id = None
        for tid, meta in TOPIC_METADATA.items():
            if tid in norm_topic or _normalize_text(meta["title"]) in norm_topic:
                matched_id = tid
                break
            for kw in meta.get("keywords", []):
                if _normalize_text(kw) == norm_topic:
                    matched_id = tid
                    break
            if matched_id:
                break

        if matched_id:
            content = load_knowledge_doc(matched_id)
            return {
                "found": True,
                "topic_id": matched_id,
                "title": TOPIC_METADATA[matched_id]["title"],
                "content": content
            }

        # Essayer via recherche sémantique / mots-clés
        resolved = resolve_relevant_knowledge(topic, max_topics=1)
        if resolved:
            return {
                "found": True,
                "query": topic,
                "content": resolved
            }

        return {
            "found": False,
            "message": f"Aucun article trouvé pour le sujet '{topic}'.",
            "available_topics": [
                {"id": tid, "title": m["title"]} for tid, m in TOPIC_METADATA.items()
            ]
        }

    # Liste tous les topics
    return {
        "found": True,
        "available_topics": [
            {"id": tid, "title": m["title"]} for tid, m in TOPIC_METADATA.items()
        ]
    }
