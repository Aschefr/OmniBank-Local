"""
Add Improvement_01 i18n keys to fr.json and en.json.
MUST use encoding='utf-8-sig' (BOM) for both files.
"""
import json, os

BASE = os.path.join(os.path.dirname(__file__), '..', 'static', 'i18n')

KEYS_FR = {
    "form_keep_open_toggle":    "Garder ouvert",
    "form_undo_last":           "\u21a9 Supprimer le dernier ajout",
    "form_undo_done":           "Derni\u00e8re saisie supprim\u00e9e",
    "budget_cat_search_placeholder": "Rechercher une cat\u00e9gorie...",
    "budget_custom_period":     "P\u00e9riode personnalis\u00e9e",
    "export_custom_period":     "P\u00e9riode personnalis\u00e9e (export)",
    "maintenance_fix_types":    "Corriger les types incoh\u00e9rents",
    "maintenance_fix_preview":  "Aper\u00e7u de la correction",
    "maintenance_fix_apply":    "Appliquer la correction",
    "maintenance_fix_confirm":  "{count} op\u00e9rations seront corrig\u00e9es. Continuer\u00a0?",
    "maintenance_fix_done":     "Migration termin\u00e9e : {count} op\u00e9rations corrig\u00e9es.",
    "maintenance_cat_choice":   "Que faire de la cat\u00e9gorie\u00a0?",
    "maintenance_cat_move":     "D\u00e9placer vers Charges fixes",
    "maintenance_cat_keep":     "Conserver en Charges variables",
}

KEYS_EN = {
    "form_keep_open_toggle":    "Keep open",
    "form_undo_last":           "\u21a9 Delete last entry",
    "form_undo_done":           "Last entry deleted",
    "budget_cat_search_placeholder": "Search category...",
    "budget_custom_period":     "Custom period",
    "export_custom_period":     "Custom period (export)",
    "maintenance_fix_types":    "Fix inconsistent types",
    "maintenance_fix_preview":  "Preview fix",
    "maintenance_fix_apply":    "Apply fix",
    "maintenance_fix_confirm":  "{count} operations will be fixed. Continue?",
    "maintenance_fix_done":     "Migration complete: {count} operations fixed.",
    "maintenance_cat_choice":   "What to do with this category?",
    "maintenance_cat_move":     "Move to Fixed expenses",
    "maintenance_cat_keep":     "Keep in Variable expenses",
}

def patch(filename, keys):
    path = os.path.join(BASE, filename)
    with open(path, encoding='utf-8-sig') as f:
        data = json.load(f)
    added = 0
    for k, v in keys.items():
        if k not in data:
            data[k] = v
            added += 1
            print(f"  [{filename}] + {k}")
        else:
            print(f"  [{filename}] = {k} (already present)")
    with open(path, 'w', encoding='utf-8-sig', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  -> {added} keys added to {filename}")

print("Patching fr.json ...")
patch('fr.json', KEYS_FR)
print("Patching en.json ...")
patch('en.json', KEYS_EN)
print("Done.")
