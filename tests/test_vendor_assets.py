"""
Tests de non-régression pour les dépendances vendor locales (Zero-Cloud / 100% Offline).
Vérifie la présence physique, la distribution via FastAPI et l'absence de liens CDN externes résiduels.
"""

import os
import re
from fastapi.testclient import TestClient
from app.main import app

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
VENDOR_DIR = os.path.join(STATIC_DIR, "vendor")

CRITICAL_VENDOR_PATHS = [
    # Inter font
    "inter/inter.css",
    "inter/files/inter-latin-400-normal.woff2",
    "inter/files/inter-latin-500-normal.woff2",
    "inter/files/inter-latin-600-normal.woff2",
    "inter/files/inter-latin-700-normal.woff2",
    "inter/files/inter-latin-800-normal.woff2",
    # Flag icons
    "flag-icons/css/flag-icons.min.css",
    "flag-icons/flags/4x3/fr.svg",
    "flag-icons/flags/4x3/gb.svg",
    "flag-icons/flags/1x1/fr.svg",
    "flag-icons/flags/1x1/gb.svg",
    # Marked & DOMPurify
    "marked/marked.min.js",
    "dompurify/purify.min.js",
    # KaTeX
    "katex/katex.min.css",
    "katex/katex.min.js",
    "katex/contrib/auto-render.min.js",
    "katex/fonts/KaTeX_Main-Regular.woff2",
    "katex/fonts/KaTeX_Math-Italic.woff2",
    # Chart.js & plugins
    "chartjs/chart.umd.js",
    "hammerjs/hammer.min.js",
    "chartjs-plugin-zoom/chartjs-plugin-zoom.min.js",
]


def test_vendor_files_exist_on_disk():
    """Vérifie que tous les fichiers vendor indispensables existent physiquement et sont non-vides."""
    for rel_path in CRITICAL_VENDOR_PATHS:
        full_path = os.path.join(VENDOR_DIR, rel_path)
        assert os.path.exists(full_path), f"Fichier vendor manquant : {rel_path}"
        assert os.path.getsize(full_path) > 0, f"Fichier vendor vide : {rel_path}"


def test_vendor_files_served_by_fastapi():
    """Vérifie que FastAPI sert chaque ressource vendor avec un code HTTP 200."""
    client = TestClient(app)
    for rel_path in CRITICAL_VENDOR_PATHS:
        url = f"/static/vendor/{rel_path}"
        response = client.get(url)
        assert response.status_code == 200, f"Échec de chargement HTTP ({response.status_code}) pour {url}"
        assert len(response.content) > 0, f"Contenu vide reçu pour {url}"


def test_no_external_cdn_in_html_files():
    """Garantit l'absence totale de liens CDN externes dans les pages HTML principales."""
    forbidden_cdn_patterns = [
        r"fonts\.googleapis\.com",
        r"fonts\.gstatic\.com",
        r"cdn\.jsdelivr\.net",
        r"cdnjs\.cloudflare\.com",
        r"unpkg\.com"
    ]
    html_files = ["index.html", "loading.html", "preview_overview.html"]
    
    for filename in html_files:
        filepath = os.path.join(STATIC_DIR, filename)
        if not os.path.exists(filepath):
            continue
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        for pattern in forbidden_cdn_patterns:
            matches = re.findall(pattern, content)
            assert len(matches) == 0, f"Lien CDN interdit '{pattern}' détecté dans {filename}"
