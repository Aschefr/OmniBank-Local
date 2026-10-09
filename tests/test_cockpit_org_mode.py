"""
tests/test_cockpit_org_mode.py — Tests d'intégrité et de conformité pour le Cockpit en Mode Organisation (Chantier 7 / LOT-07).
"""
import json
import re
from pathlib import Path
import pytest


def test_i18n_cockpit_org_mode_integrity():
    """Vérifie la présence et l'alignement bilingue strict FR/EN pour toutes les clés cockpit_org_* avec encodage UTF-8-sig."""
    fr_path = Path("static/i18n/fr.json")
    en_path = Path("static/i18n/en.json")

    assert fr_path.exists(), "fr.json manquant"
    assert en_path.exists(), "en.json manquant"

    # Vérification BOM UTF-8-sig
    with open(fr_path, "rb") as f:
        fr_bytes = f.read(3)
        assert fr_bytes == b"\xef\xbb\xbf", "fr.json doit obligatoirement être encodé en UTF-8 avec BOM (utf-8-sig)"

    with open(fr_path, "r", encoding="utf-8-sig") as f:
        fr_data = json.load(f)

    with open(en_path, "r", encoding="utf-8-sig") as f:
        en_data = json.load(f)

    # Récupérer toutes les clés cockpit_org_*
    org_keys_fr = {k: v for k, v in fr_data.items() if k.startswith("cockpit_org_")}
    assert len(org_keys_fr) >= 40, f"Trop peu de clés cockpit_org trouvées ({len(org_keys_fr)})"

    # Vérifier que chaque clé FR existe en EN avec contenu non vide
    missing_en = []
    placeholder_mismatch = []

    for k, fr_val in org_keys_fr.items():
        if k not in en_data:
            missing_en.append(k)
            continue
        en_val = en_data[k]
        assert en_val and isinstance(en_val, str), f"Clé EN '{k}' est vide ou invalide"

        # Vérifier correspondance des placeholders {var}
        fr_placeholders = set(re.findall(r"\{([a-zA-Z0-9_]+)\}", fr_val))
        en_placeholders = set(re.findall(r"\{([a-zA-Z0-9_]+)\}", en_val))
        if fr_placeholders != en_placeholders:
            placeholder_mismatch.append((k, fr_placeholders, en_placeholders))

    assert not missing_en, f"Clés i18n manquantes dans en.json : {missing_en}"
    assert not placeholder_mismatch, f"Incohérence de variables dans i18n : {placeholder_mismatch}"


def test_cockpit_org_mode_js_architecture():
    """Vérifie que overview.js implémente rigoureusement l'adaptation mode organisation."""
    overview_js_path = Path("static/js/views/overview.js")
    assert overview_js_path.exists()
    content = overview_js_path.read_text(encoding="utf-8")

    # 1. Vérification activation mode organisation
    assert "window.app?.config?.enable_org_mode === 'true'" in content

    # 2. Jauge 1 : Trésorerie disponible & Capacité d'engagement
    assert "cockpit_org_treasury_available_label" in content
    assert "orgAvailableTreasury" in content
    assert "orgGrossBalance" in content
    assert "orgEngagedExpenses" in content

    # 3. Jauge 2 : Exécution budgétaire ou Dépenses décaissées
    assert "cockpit_org_budget_exec_label" in content
    assert "cockpit_org_disbursed_label" in content
    assert "orgBudgetTarget" in content
    assert "orgBudgetSpent" in content

    # 4. Jauge 3 : Réserve opérationnelle / Runway
    assert "cockpit_org_runway_label" in content
    assert "cockpit_org_runway_scale_zero" in content
    assert "cockpit_org_runway_scale_mid" in content
    assert "cockpit_org_runway_scale_max" in content
    assert "runwayMonths" in content
    assert "isRunway" in content
    assert "cockpitRunwayGrad" in content

    # 5. Compact Card 2 : Conformité & Audit comptable
    assert "cockpit_org_audit_title" in content
    assert "missingAttachmentsCount" in content
    assert "pendingCheckSlipsCount" in content
    assert "cockpit-card-badge" in content

    # 6. Drilldown direct vers AllOperationsView depuis la bottom sheet
    assert "window.AllOperationsView.pendingFilter" in content

    # 7. Prévisions Cap sur le mois prochain adaptées organisation
    assert "cockpit_org_forecast_income" in content
    assert "cockpit_org_forecast_fixed" in content
    assert "cockpit_org_forecast_var" in content
    assert "cockpit_org_forecast_net_result" in content

    # 8. Préservation du mode personnel
    assert "cockpit_rav_label" in content
    assert "cockpit_cadence_label" in content
    assert "stats.next_pay_date" in content


def test_cockpit_css_badges():
    """Vérifie que cockpit.css intègre tous les styles de badges requis pour l'audit et le statut."""
    css_path = Path("static/css/views/cockpit.css")
    assert css_path.exists()
    content = css_path.read_text(encoding="utf-8")

    assert ".cockpit-card-badge" in content
    assert ".badge-success" in content
    assert ".badge-info" in content
    assert ".badge-danger" in content
    assert ".badge-warning" in content
