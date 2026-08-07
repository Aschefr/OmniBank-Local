"""
Test d'intégrité statique des handlers inline 'onclick="window.View.method()"' dans les fichiers frontend.
Permet d'intercepter immédiatement toute régression ou coquille sur les callbacks JS.
"""
import os
import re
import pytest

JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")

# Expression régulière pour extraire window.Objet.methode(...)
ONCLICK_PATTERN = re.compile(r'onclick=["\'](?:window\.)?([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\(')

def test_js_onclick_handlers_integrity():
    """Parcourt tous les fichiers JS et vérifie que chaque window.Objet.methode existe bien."""
    missing_methods = []

    # 1. Charger tout le code JS du dossier static/js
    js_files = []
    js_contents = {}
    for root, _, files in os.walk(JS_DIR):
        for file in files:
            if file.endswith(".js"):
                path = os.path.join(root, file)
                js_files.append(path)
                with open(path, "r", encoding="utf-8", errors="ignore") as f:
                    js_contents[file] = f.read()

    full_code_corpus = "\n".join(js_contents.values())

    # 2. Chercher toutes les occurrences d'appels inline
    for filepath, content in js_contents.items():
        matches = ONCLICK_PATTERN.findall(content)
        for obj_name, method_name in matches:
            # Ignorer les objets globaux natifs ou tiers (ex: MultiSelect, app, location, history)
            if obj_name in ("location", "history", "console", "document", "window"):
                continue
                
            # Vérifier si la méthode est définie dans le corpus JS (ex: 'method_name(' ou 'method_name:')
            # Exemple: '_showManagePinModal(' ou '_showManagePinModal:'
            pattern_def = re.compile(r'\b' + re.escape(method_name) + r'\s*[\(:]')
            if not pattern_def.search(full_code_corpus):
                missing_methods.append(f"{filepath}: window.{obj_name}.{method_name}() est indéfinie !")

    assert not missing_methods, f"Erreurs d'intégrité inline onclick trouvées :\n" + "\n".join(missing_methods)
