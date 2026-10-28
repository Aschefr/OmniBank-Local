"""
prepare_capacitor_www.py — Prépare le dossier `www/` pour Capacitor (Android & iOS)
à partir du dossier `static/` sans modifier les fichiers sources Desktop/Web.
"""
import os
import shutil

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(ROOT_DIR, "static")
WWW_DIR = os.path.join(ROOT_DIR, "www")


def main():
    if os.path.exists(WWW_DIR):
        shutil.rmtree(WWW_DIR)

    shutil.copytree(STATIC_DIR, WWW_DIR)

    # Dupliquer i18n et img sous www/static/ pour compatibilité totale des chemins absolus /static/...
    www_static = os.path.join(WWW_DIR, "static")
    os.makedirs(www_static, exist_ok=True)
    for sub in ("i18n", "img", "vendor", "css", "js"):
        src_sub = os.path.join(STATIC_DIR, sub)
        dst_sub = os.path.join(www_static, sub)
        if os.path.exists(src_sub):
            shutil.copytree(src_sub, dst_sub)

    # Réécrire les références /static/ en chemins relatifs dans www/index.html
    index_path = os.path.join(WWW_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()
        html = html.replace('href="/static/', 'href="').replace('src="/static/', 'src="')
        html = html.replace("href='/static/", "href='").replace("src='/static/", "src='")
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(html)

    print(f"[Capacitor] Dossier www/ généré avec succès ({WWW_DIR}).")


if __name__ == "__main__":
    main()

