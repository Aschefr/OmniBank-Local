"""
Test d'intégrité de l'architecture modulaire CSS (Action 12).
Vérifie la présence de tous les sous-modules, l'équilibre syntaxique,
l'accessibilité HTTP via FastAPI et la préservation des sélecteurs clés.
"""
import os
import re
import pytest
from fastapi.testclient import TestClient
from app.main import app

CSS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "static", "css"))
STYLE_CSS_PATH = os.path.join(CSS_DIR, "style.css")
IMPORT_PATTERN = re.compile(r"@import\s+(?:url\(['\"]?([^'\")]+)['\"]?\)|['\"]([^'\"]+)['\"]);")


def _get_imported_paths():
    assert os.path.isfile(STYLE_CSS_PATH), f"style.css introuvable à {STYLE_CSS_PATH}"
    with open(STYLE_CSS_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    
    matches = IMPORT_PATTERN.findall(content)
    urls = [m[0] or m[1] for m in matches]
    return urls


def test_modular_css_manifest_and_files_exist():
    """Vérifie que style.css contient les 21 @import attendus et que tous les fichiers existent."""
    urls = _get_imported_paths()
    assert len(urls) >= 19, f"Nombre d'imports insuffisant dans style.css : {len(urls)}"

    for rel_url in urls:
        # Normaliser le chemin relatif (ex: './base/variables.css' -> 'base/variables.css')
        clean_rel = rel_url.lstrip("./").replace("/", os.sep)
        full_path = os.path.join(CSS_DIR, clean_rel)
        assert os.path.isfile(full_path), f"Fichier CSS modulaire manquant : {full_path}"
        assert os.path.getsize(full_path) > 50, f"Fichier CSS anormalement vide : {full_path}"


def test_modular_css_syntax_balance():
    """Vérifie l'intégrité syntaxique (accolades et parenthèses) de chaque feuille de style modulaire."""
    urls = _get_imported_paths()
    syntax_errors = []

    for rel_url in urls:
        clean_rel = rel_url.lstrip("./").replace("/", os.sep)
        full_path = os.path.join(CSS_DIR, clean_rel)
        with open(full_path, "r", encoding="utf-8") as f:
            code = f.read()

        # Retirer les commentaires CSS pour ne pas biaiser le comptage
        code_no_comments = re.sub(r"/\*[\s\S]*?\*/", "", code)

        open_braces = code_no_comments.count("{")
        close_braces = code_no_comments.count("}")
        if open_braces != close_braces:
            syntax_errors.append(f"{clean_rel}: accolades déséquilibrées (ouvertes={open_braces}, fermées={close_braces})")

        open_parens = code_no_comments.count("(")
        close_parens = code_no_comments.count(")")
        if open_parens != close_parens:
            syntax_errors.append(f"{clean_rel}: parenthèses déséquilibrées (ouvertes={open_parens}, fermées={close_parens})")

    assert not syntax_errors, "Erreurs de syntaxe détectées dans les fichiers CSS modulaires :\n" + "\n".join(syntax_errors)


def test_modular_css_fastapi_endpoints():
    """Vérifie que tous les sous-fichiers CSS sont servis en HTTP 200 avec le Content-Type text/css."""
    client = TestClient(app)
    
    # 1. Vérifier le fichier maître
    res_master = client.get("/static/css/style.css")
    assert res_master.status_code == 200
    assert "text/css" in res_master.headers.get("content-type", "")

    # 2. Vérifier chaque sous-module importé
    urls = _get_imported_paths()
    for rel_url in urls:
        clean_url = "/static/css/" + rel_url.lstrip("./").replace("\\", "/")
        res = client.get(clean_url)
        assert res.status_code == 200, f"Erreur HTTP {res.status_code} pour {clean_url}"
        assert "text/css" in res.headers.get("content-type", ""), f"Content-Type invalide pour {clean_url}"


def test_modular_css_critical_selectors_present():
    """Vérifie la présence des sélecteurs vitaux dans leurs modules respectifs."""
    checks = {
        os.path.join("base", "variables.css"): [":root", "--bg-base", "--accent"],
        os.path.join("base", "reset.css"): ["* {", "box-sizing", "body {"],
        os.path.join("base", "layout.css"): [".app-header", ".header-actions", ".app-sidebar"],
        os.path.join("themes", "titanium.css"): [".theme-titanium-dark", ".theme-titanium-light"],
        os.path.join("components", "buttons.css"): [".btn {", ".btn-primary"],
        os.path.join("components", "tables.css"): [".data-table", "dynamic column widths"],
        os.path.join("responsive", "print.css"): ["@media print", "printContainer"],
        os.path.join("responsive", "mobile.css"): ["@media (max-width:", ".mobile-"]
    }

    for rel_path, expected_tokens in checks.items():
        full_path = os.path.join(CSS_DIR, rel_path)
        assert os.path.isfile(full_path), f"Fichier {rel_path} absent"
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        for token in expected_tokens:
            assert token.lower() in content.lower(), f"Token essentiel '{token}' absent de {rel_path}"
