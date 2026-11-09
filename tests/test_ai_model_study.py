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
    assert advised == {8: "gemma4:e4b", 12: "bonsai-2:27b", 16: "bonsai-2:27b", 24: "qwen3.8:27b"}
    assert set(advised.values()) <= names


def test_figures_match_the_catalog_cards(study):
    rows = {r["name"]: r for r in study["rows"]}
    for m in CATALOG:
        assert rows[m["name"]]["vram"] == m["vram_gb"]
        assert rows[m["name"]]["seconds"] == m["typical_seconds"]


def test_a_model_that_loops_is_not_chosen_even_with_a_good_advisor(study):
    rows = {r["name"]: r for r in study["rows"]}
    assert rows["lfm3:1.7b"]["chat"][0] >= 9
    assert rows["lfm3:1.7b"]["excluded"] == "real"
    assert rows["mistral-nemo"]["excluded"] == "chat"
    assert all(r["tier"] != "rejected" or r["excluded"] for r in study["rows"])


def test_rows_are_sorted_by_score(study):
    notes = [r["note"] for r in study["rows"]]
    assert notes == sorted(notes, reverse=True)
