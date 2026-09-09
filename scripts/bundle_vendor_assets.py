"""
Script de téléchargement et d'organisation des dépendances vendor locales pour OmniBank.
Permet un fonctionnement 100% offline (Zero-Cloud) sans requêtes externes vers des CDN.
"""

import os
import sys
import urllib.request
import ssl

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")
VENDOR_DIR = os.path.join(STATIC_DIR, "vendor")

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Liste des polices KaTeX woff2
KATEX_FONTS = [
    "KaTeX_AMS-Regular.woff2",
    "KaTeX_Caligraphic-Bold.woff2",
    "KaTeX_Caligraphic-Regular.woff2",
    "KaTeX_Fraktur-Bold.woff2",
    "KaTeX_Fraktur-Regular.woff2",
    "KaTeX_Main-Bold.woff2",
    "KaTeX_Main-BoldItalic.woff2",
    "KaTeX_Main-Italic.woff2",
    "KaTeX_Main-Regular.woff2",
    "KaTeX_Math-BoldItalic.woff2",
    "KaTeX_Math-Italic.woff2",
    "KaTeX_SansSerif-Bold.woff2",
    "KaTeX_SansSerif-Italic.woff2",
    "KaTeX_SansSerif-Regular.woff2",
    "KaTeX_Script-Regular.woff2",
    "KaTeX_Size1-Regular.woff2",
    "KaTeX_Size2-Regular.woff2",
    "KaTeX_Size3-Regular.woff2",
    "KaTeX_Size4-Regular.woff2",
    "KaTeX_Typewriter-Regular.woff2"
]

# Codes de drapeaux supportés par OmniBank
FLAG_CODES = ["fr", "gb", "es", "de", "it", "pt", "nl", "us", "eu"]

# Poids Inter
INTER_WEIGHTS = [400, 500, 600, 700, 800]


def download_file(url: str, dest_path: str):
    """Télécharge un fichier depuis une URL vers un chemin local."""
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    ctx = ssl.create_default_context()
    
    with urllib.request.urlopen(req, context=ctx, timeout=30) as response:
        content = response.read()
        if len(content) == 0:
            raise ValueError(f"Fichier vide téléchargé depuis {url}")
        with open(dest_path, "wb") as f:
            f.write(content)
    print(f"  [OK] {os.path.relpath(dest_path, STATIC_DIR)} ({len(content):,} octets)")


def bundle_inter():
    print("\n--- 1. Téléchargement de la police Inter ---")
    inter_dir = os.path.join(VENDOR_DIR, "inter")
    files_dir = os.path.join(inter_dir, "files")
    os.makedirs(files_dir, exist_ok=True)

    css_rules = []
    for weight in INTER_WEIGHTS:
        filename = f"inter-latin-{weight}-normal.woff2"
        dest = os.path.join(files_dir, filename)
        url = f"https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.0/files/{filename}"
        download_file(url, dest)

        css_rules.append(f"""/* inter-latin-{weight}-normal */
@font-face {{
  font-family: 'Inter';
  font-style: normal;
  font-display: swap;
  font-weight: {weight};
  src: url('./files/{filename}') format('woff2');
}}
""")

    css_content = "\n".join(css_rules)
    css_path = os.path.join(inter_dir, "inter.css")
    with open(css_path, "w", encoding="utf-8") as f:
        f.write(css_content)
    print(f"  [OK] vendor/inter/inter.css généré ({len(css_content)} octets)")


def bundle_flag_icons():
    print("\n--- 2. Téléchargement de flag-icons ---")
    flag_dir = os.path.join(VENDOR_DIR, "flag-icons")
    css_dest = os.path.join(flag_dir, "css", "flag-icons.min.css")
    download_file("https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/css/flag-icons.min.css", css_dest)

    for ratio in ["4x3", "1x1"]:
        ratio_dir = os.path.join(flag_dir, "flags", ratio)
        for code in FLAG_CODES:
            svg_dest = os.path.join(ratio_dir, f"{code}.svg")
            url = f"https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/{ratio}/{code}.svg"
            download_file(url, svg_dest)


def bundle_marked():
    print("\n--- 3. Téléchargement de Marked.js ---")
    dest = os.path.join(VENDOR_DIR, "marked", "marked.min.js")
    download_file("https://cdn.jsdelivr.net/npm/marked/marked.min.js", dest)


def bundle_dompurify():
    print("\n--- 4. Téléchargement de DOMPurify ---")
    dest = os.path.join(VENDOR_DIR, "dompurify", "purify.min.js")
    download_file("https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.0.6/purify.min.js", dest)


def bundle_katex():
    print("\n--- 5. Téléchargement de KaTeX ---")
    katex_dir = os.path.join(VENDOR_DIR, "katex")
    download_file("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css", os.path.join(katex_dir, "katex.min.css"))
    download_file("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js", os.path.join(katex_dir, "katex.min.js"))
    download_file("https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js", os.path.join(katex_dir, "contrib", "auto-render.min.js"))

    fonts_dir = os.path.join(katex_dir, "fonts")
    for font in KATEX_FONTS:
        dest = os.path.join(fonts_dir, font)
        url = f"https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/{font}"
        download_file(url, dest)


def bundle_chartjs():
    print("\n--- 6. Téléchargement de Chart.js & plugins ---")
    download_file("https://cdn.jsdelivr.net/npm/chart.js", os.path.join(VENDOR_DIR, "chartjs", "chart.umd.js"))
    download_file("https://cdn.jsdelivr.net/npm/hammerjs@2.0.8", os.path.join(VENDOR_DIR, "hammerjs", "hammer.min.js"))
    download_file("https://cdn.jsdelivr.net/npm/chartjs-plugin-zoom", os.path.join(VENDOR_DIR, "chartjs-plugin-zoom", "chartjs-plugin-zoom.min.js"))


def main():
    print("Démarrage du bundling des dépendances CDN dans static/vendor/...")
    bundle_inter()
    bundle_flag_icons()
    bundle_marked()
    bundle_dompurify()
    bundle_katex()
    bundle_chartjs()

    # Calcul taille totale
    total_size = 0
    file_count = 0
    for root, _, files in os.walk(VENDOR_DIR):
        for f in files:
            fp = os.path.join(root, f)
            total_size += os.path.getsize(fp)
            file_count += 1

    print(f"\n[SUCCES] Bundling terminé : {file_count} fichiers rapatriés ({total_size / (1024 * 1024):.2f} Mo au total).")


if __name__ == "__main__":
    main()
