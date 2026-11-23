"""Texte venu d'ailleurs (libellés de banque, fichiers importés, réponses de l'IA) affiché par le front.

Deux garde-fous : la politique de sécurité du contenu envoyée avec chaque page, et des tournures interdites dans les
gabarits HTML du front, qui laissaient un libellé casser un onclick (« Livret d'épargne ») ou y glisser du code.
"""
import os
import re

from fastapi.testclient import TestClient

from app.main import CONTENT_SECURITY_POLICY, app

STATIC_JS = os.path.join(os.path.dirname(__file__), "..", "static", "js")


def _js_files():
    for d, _, files in os.walk(STATIC_JS):
        if "vendor" in d:
            continue
        for f in files:
            if f.endswith(".js"):
                yield os.path.join(d, f)


def test_pages_carry_the_content_security_policy():
    client = TestClient(app)
    for path in ("/", "/static/js/common.js", "/api/health"):
        assert client.get(path).headers.get("content-security-policy") == CONTENT_SECURITY_POLICY
    # Pas de script ni d'envoi de données vers un autre site
    directives = dict(d.split(" ", 1) for d in CONTENT_SECURITY_POLICY.split("; "))
    assert directives["script-src"].split() == ["'self'", "'unsafe-inline'"]
    assert directives["connect-src"].split()[0] == "'self'"
    assert "*" not in CONTENT_SECURITY_POLICY and "https:" not in CONTENT_SECURITY_POLICY


def test_api_docs_keep_working_without_the_policy():
    assert "content-security-policy" not in TestClient(app).get("/docs").headers


def test_inline_handlers_receive_text_through_jsarg():
    """Dans un onclick="f('${x}')", ni .replace(/'/g, "\\'") ni escapeHtml ne protègent la chaîne : le navigateur
    décode &#39; en ' avant d'exécuter le JS, et une barre oblique inverse annule l'échappement. window.jsArg le fait."""
    bad = [
        re.compile(r"'\$\{[^{}]*\.replace\(/'/g"),           # '${x.replace(/'/g, "\\'")}'
        re.compile(r"'\$\{(?:window\.)?escapeHtml\([^{}]*\)\}'"),  # '${escapeHtml(x)}' dans un gestionnaire
    ]
    found = []
    for path in _js_files():
        for n, line in enumerate(open(path, encoding="utf-8"), 1):
            if re.search(r"\son[a-z]+=\"", line) and any(p.search(line) for p in bad):
                found.append(f"{os.path.relpath(path, STATIC_JS)}:{n}")
    assert not found, "Texte passé à un gestionnaire en ligne sans window.jsArg : " + ", ".join(found)


def test_escape_helpers_are_defined_once_in_common_js():
    src = open(os.path.join(STATIC_JS, "common.js"), encoding="utf-8").read()
    assert "window.escapeHtml = function" in src
    assert "window.jsArg = function" in src
    # 0 et false s'affichent, seuls null et undefined deviennent vides
    assert "if (str === null || str === undefined) return '';" in src


def test_known_sinks_stay_escaped():
    """Endroits trouvés exécutant du HTML lors de l'audit du 23/11/2026 (données piégées dans chaque champ)."""
    expected = {
        "views/timeline.js": ['<span class="desc-text">${esc(tx.description)}</span>'],
        "app/notifications.js": ["${window.escapeHtml(displayTitle)}", "${window.escapeHtml(displayContent)}"],
        "views/bank_sync_connections.js": ["${window.escapeHtml(conn.label)}", "⚠️ ${window.escapeHtml(displayError)}"],
        "views/history_manager.js": ["${window.escapeHtml(detail)}"],
        "common.js": ["${window.escapeHtml(message)}"],
    }
    for rel, needles in expected.items():
        src = open(os.path.join(STATIC_JS, *rel.split("/")), encoding="utf-8").read()
        for needle in needles:
            assert needle in src, f"{rel} : {needle}"
