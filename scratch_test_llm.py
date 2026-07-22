import json
from app.database import SessionLocal
from app.routers.budgets import _compute_monthly_averages_for_ai
from app.routers.chat import call_ollama_sync, get_ollama_config

from datetime import date

db = SessionLocal()
cfg = get_ollama_config(db)
window_months = 3
cat_data = _compute_monthly_averages_for_ai(db, set(), date.today(), window_months)

type_groups = {}
type_labels = {
    'expense_fixed': 'Charges Fixes Contractuelles (Factures, loyer, abonnements, prêts)',
    'expense_variable': 'Dépenses Courantes Variables (Courses, transports, loisirs, sorties, achats)',
}
for cat, info in cat_data.items():
    t = info['type']
    label = type_labels.get(t, t)
    if label not in type_groups:
        type_groups[label] = []
    desc_str = f" (Exemples : {', '.join(info['top_descs'])})" if info['top_descs'] else ''
    period_str = ' [CHARGE ANNUELLE/BI-ANNUELLE]' if info.get('suggested_period') == 'yearly' else ' [MENSUEL]'
    fix_str = ' [FIXE CONTRACTUEL]' if info['is_fixed'] else ''
    proj_str = ' [PROJET EXCEPTIONNEL]' if info['is_exceptional'] else ''
    type_groups[label].append(f"  - {cat}: {info['avg']:.2f}€/mois{period_str}{fix_str}{proj_str}{desc_str}")

avg_lines_parts = []
for group_label, lines in type_groups.items():
    avg_lines_parts.append(f"\n### {group_label}")
    avg_lines_parts.extend(lines)
avg_lines = "\n".join(avg_lines_parts)

nb_cats = len(cat_data)
cat_lines = []
for cat, info in sorted(cat_data.items(), key=lambda x: -x[1]["avg"]):
    period_str = "[ANNUEL]" if info.get("suggested_period") == "yearly" else "[MENSUEL]"
    fix_str = "[FIXE]" if info["is_fixed"] else "[VARIABLE]"
    desc_str = f" ({', '.join(info['top_descs'][:3])})" if info["top_descs"] else ""
    cat_lines.append(f"- {cat} {period_str} {fix_str}{desc_str}")
formatted_cats = "\n".join(cat_lines)

prompt = f"""Tu es un conseiller financier personnel expert. Analyse ces {nb_cats} catégories financières et leurs exemples de dépenses :

{formatted_cats}

MISSION OBLIGATOIRE : Crée EXACTEMENT 6 à 8 enveloppes budgétaires thématiques très précises et créatives.

EXEMPLES D'ENVELOPPES RECHERCHÉES (Adapte les noms au contenu réel des dépenses) :
- "Abonnements & Services Cloud" (ex: OVH, Distrokid, Google, IA, Sosh, Free)
- "Loisirs, Culture & Sorties" (ex: Cinéma, Restaurant, Airsoft, Steam, Jeux)
- "Transports & Automobile" (ex: Automobile, Essence, Parkings, Péages)
- "Achats Tech & Équipement" (ex: Amazon, Informatique, Électronique, Bricolage)
- "Vie Quotidienne & Alimentation" (ex: Courses, Boulangerie, Habillement)
- "Santé & Soins Personnels" (ex: Pharmacie, Médecin, Coiffure)
- "Charges Foyer & Assurances" (ex: Énergie, Impôts, Assurances)
- "Prêts & Engagements Financiers" (ex: Prêts, Prêt Conso)

INTERDICTION ABSOLUE :
- INTERDIT de créer de gros blocs génériques comme "Charges Fixes & Abonnements" ou "Dépenses Courantes & Vie Quotidienne" qui regroupent 10+ catégories !
- INTERDIT d'associer une catégorie [ANNUEL] avec une catégorie [MENSUEL] dans la même enveloppe.
- CHAQUE catégorie de la liste ci-dessus doit apparaître dans une enveloppe.

Format de réponse (Tableau JSON d'objets uniquement) :
[
  {{"name": "Nom Créatif de l'Enveloppe", "categories": ["NomExactCat1", "NomExactCat2"], "reason": "Court motif"}},
  ...
]"""

raw = call_ollama_sync(prompt, cfg, extra_options={"num_predict": 4096, "format": "json"})
print("--- RAW LLM OUTPUT ---")
print(raw.encode('utf-8', errors='replace').decode('latin-1'))
