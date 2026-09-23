"""
Test de validation des adaptations visuelles, de la mise en lumière loupe et des accordéons de l'Auto-Pilote.
"""
import os
import re
import pytest

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALL_OPERATIONS_JS = os.path.join(BASE_DIR, "static", "js", "views", "all_operations.js")
AUTOPILOT_VIEW_JS = os.path.join(BASE_DIR, "static", "js", "views", "autopilot_view.js")
AUTOPILOT_CSS = os.path.join(BASE_DIR, "static", "css", "views", "autopilot.css")
TABLES_CSS = os.path.join(BASE_DIR, "static", "css", "components", "tables.css")


def test_all_operations_highlight_integrity():
    with open(ALL_OPERATIONS_JS, "r", encoding="utf-8") as f:
        content = f.read()

    # 1. targetTx must be searched in this.transactions, NOT this.txs
    assert "this.transactions || []).find(t => String(t.id) === String(txId))" in content
    assert "this.txs || []" not in content

    # 2. Must target allOperationsBody
    assert "allOperationsBody" in content
    # Ensure obsolete historyBody is not targeted in scrollToAndHighlight
    assert "document.getElementById('historyBody')" not in content

    # 3. Exactly one scrollToAndHighlight method definition
    matches = re.findall(r"^\s*scrollToAndHighlight\s*\(", content, re.MULTILINE)
    assert len(matches) == 1, f"Expected exactly 1 scrollToAndHighlight definition, found {len(matches)}"

    # 4. highlightRow alias present
    assert "highlightRow(txId, cssClass = 'highlight-flash')" in content


def test_tables_css_row_highlight_keyframes():
    with open(TABLES_CSS, "r", encoding="utf-8") as f:
        content = f.read()

    assert "@keyframes rowHighlightFade" in content
    assert "tr.highlight-flash" in content
    assert "tr.highlight-flash td" in content
    assert "box-shadow: inset" in content


def test_autopilot_css_collapsible_and_themes():
    with open(AUTOPILOT_CSS, "r", encoding="utf-8") as f:
        content = f.read()

    # Collapsible structure
    assert ".ap-collapsible-card" in content
    assert ".ap-collapsible-header" in content
    assert ".ap-collapsible-content" in content
    assert ".ap-summary-pill" in content
    assert ".ap-chevron" in content
    assert ".ap-batch-chevron" in content

    # Themes
    assert "body.theme-titanium-dark .ap-collapsible-card" in content
    assert "body.theme-titanium-light .ap-collapsible-card" in content
    assert "body.theme-classic-light .ap-collapsible-card" in content


def test_autopilot_view_collapsible_methods():
    with open(AUTOPILOT_VIEW_JS, "r", encoding="utf-8") as f:
        content = f.read()

    # HTML structure elements
    assert 'id="apKpiSection"' in content
    assert 'id="apConfigSection"' in content
    assert 'id="apWorkshopSection"' in content
    assert 'id="apKpiSummaryPill"' in content
    assert 'id="apConfigSummaryPill"' in content
    assert 'id="apWorkshopSummaryPill"' in content
    assert 'id="apToggleAllBatchesBtn"' in content

    # Methods
    assert "toggleSection(key)" in content
    assert "initCollapsibleSections()" in content
    assert "updateSummaryPills()" in content
    assert "toggleBatch(batchId)" in content
    assert "toggleAllBatches()" in content

    # Theme cleanups (no hardcoded rgba(255,255,255,0.05) in reasons)
    assert 'class="ap-reason-badge"' in content
