"""Tableau « Comment ces modèles ont été choisis » : ses règles doivent retrouver les modèles du catalogue."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services.ai_model_catalog import CATALOG

STUDY_JS = Path(__file__).resolve().parent.parent / "static" / "js" / "views" / "ai_model_study.js"


@pytest.fixture(scope="module")
def study():
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js non disponible")
    script = f"const s = require({json.dumps(str(STUDY_JS))}); console.log(JSON.stringify(s.rank()));"
    out = subprocess.run([node, "-e", script], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def test_rules_find_the_catalog_models(study):
    assert study["tiers"] == {
        **{m["tier"]: m["name"] for m in CATALOG},
        "alternative": "gemma4:31b",
    }


def test_each_card_gets_a_catalog_model(study):
    names = {m["name"] for m in CATALOG}
    advised = {p["card"]: p["model"] for p in study["perCard"]}
    assert advised == {8: "gemma4:e4b", 12: "bonsai-2:27b", 16: "bonsai-2:27b", 24: "gemma4:31b"}
    assert set(advised.values()) <= names


def test_figures_match_the_catalog_cards(study):
    rows = {r["name"]: r for r in study["rows"]}
    for m in CATALOG:
        assert rows[m["name"]]["vram"] == m["vram_gb"]
        assert rows[m["name"]]["seconds"] == m["typical_seconds"]


def test_a_good_advisor_does_not_save_a_bad_statement(study):
    rows = {r["name"]: r for r in study["rows"]}
    for name in ("qwen3.5:9b", "qwen3.5:4b"):
        assert min(rows[name]["chat"]) >= 15          # conseiller au-dessus du seuil de 75 %
        assert rows[name]["excluded"] == "real"         # mais un passage du relevé sous la moitié (60/120)
    assert all(r["tier"] != "rejected" or r["excluded"] for r in study["rows"])


def test_tie_needs_the_note_and_every_task(study):
    """Règle « note et chaque tâche » : e4b et nemotron sont à égalité ; bonsai-2 et gemma4:12b ne le sont pas,
    malgré des notes à 0,02 point, à cause de 4,3 libellés du relevé d'écart par passage."""
    node = shutil.which("node")
    script = (f"const s = require({json.dumps(str(STUDY_JS))}); const m = n => s.MODELS.find(x => x.name === n);"
              "console.log(JSON.stringify([s.tied(m('gemma4:e4b'), m('nemotron-3.5-bolt:e4b')),"
              " s.tied(m('bonsai-2:27b'), m('gemma4:12b'))]));")
    out = subprocess.run([node, "-e", script], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == [True, False]
    assert study["precision"] == {"question": 0.075, "note": 0.3}


def test_rows_are_sorted_by_score(study):
    notes = [r["note"] for r in study["rows"]]
    assert notes == sorted(notes, reverse=True)
