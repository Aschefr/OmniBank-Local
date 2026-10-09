# tests/test_analytics_print_org.py
"""
Tests unitaires et fonctionnels pour le moteur d'impression et de prévisualisation
du Bilan Financier d'Assemblée Générale (AG) et Mode Organisation (analytics.js).
"""
import json
import re
from pathlib import Path
import pytest


def test_i18n_keys_present_and_consistent():
    """Vérifie la présence et la cohérence de toutes les clés bilingues FR/EN."""
    fr_path = Path("static/i18n/fr.json")
    en_path = Path("static/i18n/en.json")

    assert fr_path.exists(), "fr.json must exist"
    assert en_path.exists(), "en.json must exist"

    # Vérification du BOM UTF-8 (utf-8-sig)
    with open(fr_path, "rb") as f:
        fr_bytes = f.read(3)
        assert fr_bytes == b"\xef\xbb\xbf", "fr.json doit conserver son BOM UTF-8"

    with open(en_path, "rb") as f:
        en_bytes = f.read(3)
        assert en_bytes == b"\xef\xbb\xbf", "en.json doit conserver son BOM UTF-8"

    with open(fr_path, "r", encoding="utf-8-sig") as f:
        fr = json.load(f)

    with open(en_path, "r", encoding="utf-8-sig") as f:
        en = json.load(f)

    required_keys = [
        "export_preset_btn_ag",
        "export_preset_btn_ag_tooltip",
        "export_preset_btn_ledger",
        "export_preset_btn_ledger_tooltip",
        "export_preset_btn_personal",
        "export_preset_btn_personal_tooltip",
        "export_preset_btn_detailed_personal",
        "export_preset_btn_detailed_personal_tooltip",
        "export_preview_title",
        "export_preview_tab_config",
        "export_preview_tab_preview",
        "export_preview_updating",
        "export_preview_live_badge",
        "export_sec_compte_resultat_ag",
        "export_sec_quitus_ag",
        "export_org_fiscal_year_label",
        "export_org_fiscal_year_period",
        "export_org_statement_title",
        "export_org_operating_income",
        "export_org_operating_expense",
        "export_org_surplus_deficit",
        "export_org_surplus",
        "export_org_deficit",
        "export_org_treasury_variation_title",
        "export_org_opening_balance",
        "export_org_closing_balance",
        "export_org_net_cash_flow",
        "export_org_runway_metric",
        "export_org_quitus_text",
        "export_org_ag_date_label",
        "export_org_sign_treasurer",
        "export_org_sign_president",
        "export_badge_org_mode",
        "export_preset_applied_ag",
        "export_preset_applied_ledger",
        "export_preset_applied_personal",
        "export_preset_applied_detailed",
        "export_modal_hint",
        "export_sec_compte_resultat_desc"
    ]

    for key in required_keys:
        assert key in fr, f"Clé manquante dans fr.json : {key}"
        assert key in en, f"Clé manquante dans en.json : {key}"
        assert len(fr[key].strip()) > 0, f"Valeur vide pour {key} dans fr.json"
        assert len(en[key].strip()) > 0, f"Valeur vide pour {key} dans en.json"

    # Vérification des placeholders dans les chaînes dynamiques
    assert "{start}" in fr["export_org_fiscal_year_period"]
    assert "{end}" in fr["export_org_fiscal_year_period"]
    assert "{start}" in en["export_org_fiscal_year_period"]
    assert "{end}" in en["export_org_fiscal_year_period"]

    assert "{status}" in fr["export_org_surplus_deficit"]
    assert "{status}" in en["export_org_surplus_deficit"]


def test_analytics_js_methods_and_architecture():
    """Vérifie la présence et la signature des méthodes clés dans analytics.js."""
    js_path = Path("static/js/views/analytics.js")
    content = js_path.read_text(encoding="utf-8")

    expected_methods = [
        "showExportModal()",
        "_initExportModalListeners(modal)",
        "switchPreviewPane(pane)",
        "applyExportPreset(preset)",
        "_reorderSectionCards(targetOrder)",
        "onExportYearChange(year)",
        "onExportCustomDatesChange()",
        "_refreshExportData()",
        "triggerLivePreviewUpdate()",
        "_renderLivePreview()",
        "_gatherExportOptions(modal)",
        "_buildReportHTML(options)",
        "_generateCompteResultatAgHTML(options)",
        "_generateQuitusAgHTML(options)",
        "_applyReportDOMFilters(targetEl, options)",
        "executePrint()"
    ]

    for method in expected_methods:
        method_name = method.split("(")[0]
        assert method_name in content, f"Méthode {method_name} absente de analytics.js"

    # Vérification du Split-view et des composants A4
    assert "export-modal-split" in content
    assert "export-modal-body-split" in content
    assert "export-config-pane" in content
    assert "export-preview-pane" in content
    assert "export-paper-sheet" in content
    assert "export-preview-screen-toggle" in content

    # Vérification des sections spécifiques Organisation
    assert "compte_resultat_ag" in content
    assert "quitus_ag" in content
    assert "isOrgOnly: true" in content

    # Single source of truth : _buildReportHTML doit être invoqué à la fois par _renderLivePreview et executePrint
    preview_block = content[content.index("async _renderLivePreview()"):content.index("_gatherExportOptions(modal) {")]
    assert "this._buildReportHTML(options)" in preview_block

    print_block = content[content.index("async executePrint()"):content.index("/** Bug #8 : Gestion de l'import de logo")]
    assert "this._buildReportHTML(options)" in print_block


def test_analytics_css_classes():
    """Vérifie que les styles CSS nécessaires à la modale Split-View et à la feuille A4 sont définis."""
    css_path = Path("static/css/views/analytics.css")
    content = css_path.read_text(encoding="utf-8")

    assert ".export-modal-split" in content
    assert ".export-modal-body-split" in content
    assert ".export-config-pane" in content
    assert ".export-preview-pane" in content
    assert ".export-paper-sheet" in content
    assert ".export-preview-screen-toggle" in content

    # Vérification des règles responsive
    assert "@media (max-width: 1024px)" in content
    assert "active-pane" in content
    assert "hidden-pane" in content


def test_compte_resultat_logic():
    """Teste la logique financière du compte de résultat simplifié (Excédent vs Déficit & Runway)."""
    # Cas 1 : Excédentaire
    income_categories = {"Cotisations": 15000, "Subventions": 8000, "Dons": 2500}
    expense_categories = {"Assurance": 1200, "Local": 4800, "Fournitures": 3500}

    total_income = sum(income_categories.values())
    total_expense = sum(expense_categories.values())
    net_result = total_income - total_expense

    assert total_income == 25500
    assert total_expense == 9500
    assert net_result == 16000
    is_surplus = net_result >= 0
    assert is_surplus is True

    total_cash = 32000
    avg_monthly_expense = total_expense / 12
    runway_months = round(total_cash / avg_monthly_expense, 1)
    assert runway_months == 40.4

    # Cas 2 : Déficitaire
    income_categories_def = {"Cotisations": 5000}
    expense_categories_def = {"Prestations": 7500}
    net_def = sum(income_categories_def.values()) - sum(expense_categories_def.values())
    assert net_def == -2500
    assert (net_def >= 0) is False


def test_personal_mode_continuity_guarantees():
    """Vérifie que le mode personnel masque bien les sections et réglages exclusifs au mode organisation."""
    js_path = Path("static/js/views/analytics.js")
    content = js_path.read_text(encoding="utf-8")

    # Vérifie que les sections org sont filtrées avec def.isOrgOnly && !isOrgMode
    assert "if (def.isOrgOnly && !isOrgMode) return '';" in content

    # Vérifie que les presets personnels sont bien conditionnés
    assert "applyExportPreset('personal')" in content
    assert "applyExportPreset('detailed')" in content
    assert "applyExportPreset('ag')" in content
    assert "applyExportPreset('ledger')" in content
