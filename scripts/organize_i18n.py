#!/usr/bin/env python3
"""Organize i18n files by sorting keys alphabetically (UTF-8-BOM safe)."""
import json
import os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'static', 'i18n')

def organize_file(filename):
    path = os.path.join(BASE, filename)
    if not os.path.exists(path):
        print(f"File not found: {path}")
        return

    # Read file with UTF-8-BOM encoding
    with open(path, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)

    # Sort dictionary keys alphabetically
    sorted_data = {k: data[k] for k in sorted(data.keys())}

    # Write sorted dictionary back with UTF-8-BOM encoding
    with open(path, 'w', encoding='utf-8-sig') as f:
        json.dump(sorted_data, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f"Organized {filename} : {len(sorted_data)} keys sorted.")

if __name__ == '__main__':
    print("Sorting i18n files...")
    organize_file('fr.json')
    organize_file('en.json')
    print("Done!")
