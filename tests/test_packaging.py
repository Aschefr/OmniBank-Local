"""Le build de bureau et le script de release, vérifiés sans construire."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "scripts" / "packaging" / "omnibank-api.spec"
RELEASE = ROOT / "scripts" / "release.ps1"


def test_every_data_file_of_app_is_in_the_desktop_build():
    """PyInstaller n'embarque que le code : un fichier de données oublié manque sans erreur."""
    sources = [
        (SPEC.parent / src).resolve()
        for src in re.findall(r"\('(\.\./\.\./app/[^']+)',", SPEC.read_text(encoding="utf-8"))
    ]
    data_files = [
        p for p in (ROOT / "app").rglob("*")
        if p.is_file() and p.suffix not in {".py", ".pyc"} and "__pycache__" not in p.parts
    ]
    assert data_files
    missing = [
        str(p.relative_to(ROOT)) for p in data_files
        if not any(p == src or src in p.parents for src in sources)
    ]
    assert missing == []


def test_release_version_bump_survives_powershell_quoting():
    """PowerShell 5.1 retire les guillemets doubles passés à python -c : le remplacement ne trouvait rien."""
    script = RELEASE.read_text(encoding="utf-8")
    block = re.search(r'python -c @"(.*?)"@ \$Version', script, re.S)
    assert block, "bloc de changement de version introuvable"
    assert '"' not in block.group(1)
    assert "app/main.py" in block.group(1)
