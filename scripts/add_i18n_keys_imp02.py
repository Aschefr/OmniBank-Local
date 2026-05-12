#!/usr/bin/env python3
"""Add Improvement_02 i18n keys to fr.json and en.json (UTF-8-BOM safe)."""
import json, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'static', 'i18n')

KEYS_FR = {
    "analytics_custom_range_toggle": "Période personnalisée",
    "analytics_custom_start": "Début",
    "analytics_custom_end": "Fin",
    "stat_budgets_monthly": "🎯 Budgets (Mensuel)",
    "stat_budgets_yearly": "🎯 Budgets (Annuel)",
    "stat_budgets_indefinite": "🎯 Budgets (Indéfini)",
}

KEYS_EN = {
    "analytics_custom_range_toggle": "Custom period",
    "analytics_custom_start": "Start",
    "analytics_custom_end": "End",
    "stat_budgets_monthly": "🎯 Budgets (Monthly)",
    "stat_budgets_yearly": "🎯 Budgets (Yearly)",
    "stat_budgets_indefinite": "🎯 Budgets (Indefinite)",
}

def patch(filename, new_keys):
    path = os.path.join(BASE, filename)
    with open(path, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)
    added = 0
    for k, v in new_keys.items():
        if k not in data:
            data[k] = v
            added += 1
            print(f"  + {k}")
        else:
            print(f"  = {k} (exists)")
    with open(path, 'w', encoding='utf-8-sig') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f"  -> {added} keys added to {filename}")

if __name__ == '__main__':
    print("Patching fr.json...")
    patch('fr.json', KEYS_FR)
    print("Patching en.json...")
    patch('en.json', KEYS_EN)
    print("Done!")
