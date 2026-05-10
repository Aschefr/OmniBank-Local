# 📦 OmniBank — Guide de Build MSI (Windows Desktop)

> Ce document décrit le processus complet de packaging d'OmniBank en application Windows Desktop
> via **Tauri 2.0** + **PyInstaller**. À utiliser comme référence pour les futures versions.

---

## Table des matières

1. [Architecture](#architecture)
2. [Prérequis](#prérequis)
3. [Structure des fichiers](#structure-des-fichiers)
4. [Étape 1 — Build du Sidecar (PyInstaller)](#étape-1--build-du-sidecar-pyinstaller)
5. [Étape 2 — Build du MSI (Tauri)](#étape-2--build-du-msi-tauri)
6. [Signature et Clés (Updater)](#signature-et-clés-updater)
7. [Mise à jour (nouvelle version)](#mise-à-jour-nouvelle-version)
8. [Fonctionnement interne](#fonctionnement-interne)
9. [Problèmes connus et solutions](#problèmes-connus-et-solutions)
10. [Commandes rapides](#commandes-rapides)

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│  OmniBank.exe (Tauri / Rust)                         │
│  ├── Spawne omnibank-api.exe au démarrage            │
│  ├── Affiche WebView → http://127.0.0.1:8434         │
│  ├── Vérifie les mises à jour (3s après démarrage)   │
│  └── Tue omnibank-api.exe à la fermeture             │
├──────────────────────────────────────────────────────┤
│  omnibank-api.exe (PyInstaller / Python)             │
│  ├── Serveur FastAPI sur le port 8434                │
│  ├── Sert les fichiers statiques (bundled)           │
│  └── Lit/écrit dans %APPDATA%/OmniBank/              │
├──────────────────────────────────────────────────────┤
│  %APPDATA%/OmniBank/                                 │
│  ├── omnibank.db          (SQLite)                   │
│  └── uploads/             (fichiers utilisateur)     │
└──────────────────────────────────────────────────────┘
```

**Point clé** : les données utilisateur sont dans `%APPDATA%/OmniBank/`,
**jamais** dans le répertoire d'installation (`C:\Program Files\OmniBank\`).
Cela garantit la persistance lors des mises à jour/réinstallations.

---

## Prérequis

| Outil | Version testée | Installation |
|-------|---------------|-------------|
| **Python** | 3.14 | `python.org` |
| **Rust** | 1.95+ | `rustup.rs` |
| **Node.js** | 20+ | `nodejs.org` |
| **PyInstaller** | 6.20+ | `pip install pyinstaller` |
| **Tauri CLI** | 2.x | Via `package.json` (`npx tauri`) |
| **rsign2** | 0.6+ | `cargo install rsign2` (optionnel, remplace par `scripts/gen-keys`) |

### ⚠️ IMPORTANT — Dépendances Python

PyInstaller utilise le **Python global** (pas le venv). Toutes les dépendances
doivent être installées **dans le Python global** :

```powershell
pip install -r requirements.txt
pip install pyinstaller
```

Si PyInstaller produit un exe de **~9 MB** au lieu de **~50 MB**, c'est que les
dépendances ne sont pas dans le Python global → **le sidecar crashera**.

**Vérification rapide** :
```powershell
python -c "import uvicorn; print('OK')"
# Si ModuleNotFoundError → pip install -r requirements.txt
```

---

## Structure des fichiers

```
OmniBank-Local/
├── app/                          # Backend FastAPI
│   ├── main.py                   # App FastAPI (PyInstaller-aware)
│   ├── database.py               # Paths dynamiques (%APPDATA% ou ./data/)
│   └── routers/                  # Routes API
├── static/                       # Frontend (HTML/CSS/JS)
├── run_server.py                 # Point d'entrée PyInstaller
├── package.json                  # Deps npm (Tauri CLI + plugins)
├── latest.json                   # Manifeste updater (GitHub)
├── scripts/
│   ├── build_sidecar.ps1         # Script de build PyInstaller
│   ├── release.ps1               # Script de release automatise (build+sign+push)
│   └── gen-keys/                 # Outil Rust de signature (remplace rsign2)
│       ├── src/main.rs
│       └── Cargo.toml
└── src-tauri/
    ├── tauri.conf.json           # Configuration Tauri (version, updater, etc.)
    ├── Cargo.toml                # Dependances Rust (version fixe a 1.0.0)
    ├── build.rs                  # Build hook
    ├── src/
    │   └── main.rs               # Launcher Rust (spawn + kill + update + dialog)
    ├── capabilities/
    │   └── default.json          # Permissions (shell, updater, app, dialog)
    ├── icons/                    # Icones (32px, 128px, 256px, ICO)
    ├── bin/                      # Sidecar compile (gitignored)
    │   └── omnibank-api-x86_64-pc-windows-msvc.exe
    ├── .tauri-private-key        # Cle privee updater (gitignored, NE PAS PERDRE)
    └── .tauri-public-key         # Cle publique updater
```

---

## Étape 1 — Build du Sidecar (PyInstaller)

Le script `scripts/build_sidecar.ps1` automatise tout le processus :

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build_sidecar.ps1
```

### Ce que fait le script :

1. Appelle PyInstaller avec `--onefile` sur `run_server.py`
2. Inclut les fichiers statiques (`--add-data "static;static"`)
3. Déclare tous les hidden imports nécessaires (uvicorn, fastapi, starlette, etc.)
4. Utilise `--collect-submodules` pour uvicorn, fastapi et starlette
5. Copie le résultat dans `src-tauri/bin/` avec le nom attendu par Tauri

### Nommage du sidecar (CRUCIAL)

Tauri exige que le binaire sidecar soit nommé avec le **target triple** :

```
omnibank-api-x86_64-pc-windows-msvc.exe
```

Ce nom correspond à `"externalBin": ["bin/omnibank-api"]` dans `tauri.conf.json`.
Tauri ajoute automatiquement `-{target_triple}.exe` au nom.

### Vérification rapide du sidecar

```powershell
# Lancer le sidecar manuellement
.\src-tauri\bin\omnibank-api-x86_64-pc-windows-msvc.exe

# Dans un autre terminal, tester
Invoke-WebRequest http://127.0.0.1:8434/api/health
# Attendu : {"status":"ok"}
```

---

## Étape 2 — Build du MSI (Tauri)

```powershell
npx tauri build
```

### Ce que fait la commande :

1. Compile le code Rust (`src-tauri/src/main.rs`) en mode release
2. Empaquette le sidecar + les fichiers statiques + les icônes
3. Génère le MSI via **WiX Toolset** (téléchargé automatiquement)
4. Produit : `src-tauri/target/release/bundle/msi/OmniBank_X.Y.Z_x64_fr-FR.msi`

### Résultat attendu

| Fichier | Taille typique |
|---------|---------------|
| `omnibank-api-*.exe` (sidecar) | ~50 MB |
| `omnibank.exe` (Tauri wrapper) | ~15 MB |
| `OmniBank_*.msi` (installateur) | ~55 MB |

---

## Signature et Clés (Updater)

Le système de mise à jour Tauri utilise **minisign** pour signer les MSI.
L'app vérifie la signature avant d'installer une mise à jour.

> ⚠️ **DÉCOUVERTE CRITIQUE** : Tauri stocke et vérifie les clés/signatures
> en **base64(contenu_minisign_complet)**. Le format brut minisign
> (tel que produit par rsign2 ou py-minisign) est **INCOMPATIBLE**.
> Ne JAMAIS utiliser rsign2 directement pour la signature.

### Format attendu par Tauri

```
Tauri interne:
  pubkey     = base64( "untrusted comment: ...\n<raw_pubkey_b64>\n" )
  signature  = base64( "untrusted comment: ...\n<raw_sig_b64>\ntrusted comment: ...\n<comment_sig_b64>\n" )

rsign2 brut (INCOMPATIBLE):
  pubkey     = "<raw_pubkey_b64>"
  signature  = "untrusted comment: ...\n<raw_sig_b64>\ntrusted comment: ...\n..."
```

### Outil de signature : `scripts/gen-keys`

Un outil Rust custom utilise la **même version exacte** de la crate `minisign`
que `tauri-cli` (v0.7.3), garantissant la compatibilité.

**Générer des clés** :
```powershell
cd scripts\gen-keys
cargo run --release -- generate
# Produit : tauri-private-key, tauri-public-key, tauri-private-key.b64
# Affiche la pubkey base64 pour tauri.conf.json
```

**Signer un MSI** :
```powershell
cd scripts\gen-keys
.\target\release\gen-tauri-keys.exe sign `
    "..\..\src-tauri\target\release\bundle\msi\OmniBank_X.Y.Z_x64_fr-FR.msi" `
    "..\..\src-tauri\.tauri-private-key"
# Produit : .sig file + affiche la signature base64 pour latest.json
```

### Après génération de clés

1. Copier `tauri-private-key` → `src-tauri/.tauri-private-key`
2. Copier `tauri-public-key` → `src-tauri/.tauri-public-key`
3. Mettre la **pubkey base64** (affichée par l'outil) dans `tauri.conf.json` :

```json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzd...(base64 de la pubkey box complète)..."
    }
  }
}
```

### Pourquoi pas rsign2 ni `tauri signer` ?

| Outil | Problème |
|-------|----------|
| `rsign2` | Produit du minisign brut. Tauri attend base64(minisign). Incompatible. |
| `tauri signer generate` | Utilise `rpassword` qui bloque (lit console Windows, pas stdin). Impossible à automatiser. |
| `tauri signer sign` | Même problème rpassword. Bloque indéfiniment même avec `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`. |
| `py-minisign` | Format de fichier incompatible avec minisign Rust. |
| **`scripts/gen-keys`** ✅ | Utilise `minisign 0.7.3` (même que tauri-cli). Pas de rpassword. Fonctionne. |

### Fichier latest.json

Le champ `"signature"` doit contenir la **signature base64** (PAS le contenu
brut du .sig, mais son encodage base64 complet) :

```json
{
  "version": "X.Y.Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "dW50cnVzd...(base64 du contenu .sig complet)...",
      "url": "https://github.com/Aschefr/OmniBank-Local/releases/download/vX.Y.Z/OmniBank_X.Y.Z_x64_fr-FR.msi"
    }
  }
}
```

### Sécurité des clés

| Fichier | Localisation | Git | Notes |
|---------|-------------|-----|-------|
| **Clé privée** | `src-tauri/.tauri-private-key` | ❌ gitignored | **NE PAS PERDRE** — si perdue, impossible de signer les futures mises à jour |
| **Clé publique** | `src-tauri/.tauri-public-key` | ✅ commité | Référencée (en base64) dans `tauri.conf.json` |

> ⚠️ **Bootstrap** : Si vous changez les clés de signature, les utilisateurs avec
> l'ancienne clé publique ne pourront pas vérifier les nouvelles mises à jour.
> Ils devront réinstaller manuellement le MSI.

---

## Mise a jour (nouvelle version)

### Methode automatisee (RECOMMANDEE)

Le script `scripts/release.ps1` automatise les 8 etapes du process :

```powershell
# Release complete (sidecar + MSI + signature + push + GitHub release)
.\scripts\release.ps1 -Version "X.Y.Z" -Notes "Description des changements"

# Release sans rebuild sidecar (UNIQUEMENT si seul le code Rust change. Si le frontend JS/CSS change, NE PAS utiliser cette option car PyInstaller embarque le dossier static/)
.\scripts\release.ps1 -Version "X.Y.Z" -Notes "Description" -SkipSidecar

# Dry run (build + signer sans pousser)
.\scripts\release.ps1 -Version "X.Y.Z" -DryRun
```

Le script effectue dans l'ordre :
1. Pre-flight checks (outils, cle privee, etc.)
2. Bump version dans `package.json` + `tauri.conf.json` (via Python, regle G-07)
3. Build sidecar PyInstaller (sauf `-SkipSidecar`)
4. Build MSI via `npx tauri build`
5. Signature MSI via `scripts/gen-keys`
6. Mise a jour de `latest.json` avec la signature base64
7. Git commit + tag + push
8. Creation de la GitHub Release avec upload du MSI

### Methode manuelle (si le script echoue)

```powershell
# 1. Bumper la version (via Python, regle G-07)
python -c "import json; [exec(open(p).read()) or None for p in []]" # voir release.ps1

# 2. Rebuild sidecar (si le backend Python a change)
powershell -ExecutionPolicy Bypass -File .\scripts\build_sidecar.ps1

# 3. Build le MSI
npx tauri build

# 4. Signer le MSI
.\scripts\gen-keys\target\release\gen-tauri-keys.exe sign `
    src-tauri\target\release\bundle\msi\OmniBank_X.Y.Z_x64_fr-FR.msi `
    src-tauri\.tauri-private-key
# -> copier la signature base64 affichee dans latest.json

# 5. Mettre a jour latest.json (version, signature base64, url)

# 6. Commit + push
git add -A && git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "OmniBank vX.Y.Z" && git push origin main --tags

# 7. Creer la GitHub Release avec le MSI
gh release create vX.Y.Z <msi_path> --title "OmniBank vX.Y.Z" --notes "Changelog"
```

> **L'ordre est important** : Le `latest.json` doit etre pushe sur `main`
> **apres** que le MSI soit uploade dans la GitHub Release.

---

## Fonctionnement interne

### Cycle de vie de l'application

```
1. Utilisateur lance OmniBank.exe
2. main.rs → spawn("omnibank-api") → lance omnibank-api.exe
3. main.rs → boucle health check sur http://127.0.0.1:8434/api/health
   └── 30 tentatives × 500ms = 15s max
4. Dès que le sidecar répond → window.show()
5. 3 secondes apres -> check_for_updates()
   +-- Verifie latest.json sur GitHub
   +-- Si mise a jour disponible -> dialogue natif Windows (OK/Annuler)
   +-- Les erreurs sont affichees via dialogue natif (tauri-plugin-dialog)
6. L'utilisateur interagit avec l'app via la WebView
7. Fermeture → RunEvent::Exit → kill_sidecar()
   ├── child.kill() (API Tauri)
   ├── taskkill /T /F /PID (arbre de processus)
   └── taskkill /F /IM omnibank-api.exe (filet de sécurité)
```

### Résolution des chemins (PyInstaller)

`run_server.py` et `app/main.py` utilisent cette logique :

```python
# Fichiers statiques (bundled dans l'exe) :
if getattr(sys, 'frozen', False):
    base_path = sys._MEIPASS        # Dossier temporaire d'extraction PyInstaller
else:
    base_path = os.path.abspath('.') # Dossier de travail (dev)

# Données utilisateur (persistées) :
if getattr(sys, 'frozen', False):
    data_dir = os.path.join(os.environ['APPDATA'], 'OmniBank')
else:
    data_dir = './data/'
```

### Configuration Tauri clé

| Paramètre | Valeur | Rôle |
|-----------|--------|------|
| `app.withGlobalTauri` | `true` | Expose `window.__TAURI__` dans le webview |
| `app.windows[0].visible` | `false` | Fenetre cachee au demarrage (affichee apres health check) |
| `app.windows[0].url` | `http://127.0.0.1:8434` | Pointe vers le sidecar FastAPI |
| `app.windows[0].width` | `1600` | Largeur par defaut |
| `app.windows[0].height` | `900` | Hauteur par defaut |
| `bundle.externalBin` | `["bin/omnibank-api"]` | Declare le sidecar a inclure |
| `bundle.targets` | `["msi"]` | Format d'installateur Windows |
| `bundle.windows.wix.language` | `"fr-FR"` | Installateur en francais |
| `plugins.updater.endpoints` | `[...latest.json]` | URL du manifeste de mise a jour |
| `plugins.updater.pubkey` | `dW50cnVzd...` | Cle publique pour verifier les signatures |

### Dependances Rust (`Cargo.toml`)

| Crate | Usage |
|-------|-------|
| `tauri` | Framework desktop |
| `tauri-plugin-shell` | Spawn/kill du sidecar |
| `tauri-plugin-updater` | Auto-update |
| `tauri-plugin-dialog` | Dialogues natifs Windows (confirmation update) |
| `reqwest` | HTTP blocking (health check) |

> **Note** : La version dans `Cargo.toml` est fixe a `1.0.0`. La version reelle
> est dans `tauri.conf.json` et lue via `app.config().version` au runtime.

### Permissions (`capabilities/default.json`)

| Permission | Usage |
|------------|-------|
| `core:default` | Permissions de base Tauri |
| `shell:allow-execute/spawn/kill` | Gestion du sidecar |
| `updater:default` | Auto-update |
| `core:app:default` | Lecture version app depuis JS |

---

## Problèmes connus et solutions

### 1. "No module named 'uvicorn'" au lancement du sidecar

**Cause** : PyInstaller a utilisé un Python qui n'a pas les dépendances installées.
Le venv n'est pas le Python global — PyInstaller utilise `C:\Python314\python.exe`.

**Solution** :
```powershell
pip install -r requirements.txt   # Installer dans le Python GLOBAL
# Puis rebuild le sidecar
```

**Diagnostic** : Si le sidecar fait ~9 MB, les dépendances manquent.
Un build correct produit ~50 MB.

### 2. Processus omnibank-api.exe reste après fermeture

**Cause** : PyInstaller crée un arbre de processus (bootstrap.exe → python.exe).
Un simple `kill()` ne tue que le parent, laissant l'enfant orphelin.

**Solution** : Le `main.rs` actuel utilise un triple mécanisme de cleanup :
- `child.kill()` via l'API Tauri
- `taskkill /T /F /PID` pour tuer l'arbre complet (`/T` = tree kill)
- `taskkill /F /IM omnibank-api.exe` en filet de sécurité par nom

### 3. La fenêtre ne s'affiche pas (app invisible)

**Cause** : Le sidecar ne démarre pas → le health check timeout → la fenêtre
reste cachée (`visible: false`). Après 15s, elle s'affiche avec une page d'erreur.

**Diagnostic** :
```powershell
# Lancer l'app depuis un terminal pour voir les erreurs
& "C:\Program Files\OmniBank\omnibank.exe"

# Ou tester le sidecar directement
& "C:\Program Files\OmniBank\omnibank-api.exe"
```

### 4. Conflit de port 8434

**Cause** : Un processus omnibank-api orphelin occupe déjà le port.

**Solution** :
```powershell
Get-Process | Where-Object { $_.ProcessName -like "*omnibank*" } | Stop-Process -Force
```

### 5. `tauri signer generate` bloque sur "Please enter a password"

**Cause** : La commande utilise `rpassword` qui lit depuis la console Windows
(pas stdin). Il est impossible de pipper ou scripter la réponse.

**Solution** : Utiliser `scripts/gen-keys` a la place (voir section [Signature et Cles](#signature-et-cles-updater)).

### 6. "failed to decode base64 secret key" lors de la signature

**Cause** : La clé privée a été générée avec un outil incompatible (py-minisign,
minisign Python, etc.). Le format de la ligne de commentaire ou l'encodage
de la clé diffère du format attendu par rsign2/Tauri.

**Solution** : Régénérer les clés avec `rsign generate -f -W -s ... -p ...`.

### 7. Le `.sig` n'est pas généré par `tauri build`

**Cause** : `TAURI_SIGNING_PRIVATE_KEY` n'est pas propagé correctement par
`npx`. Le bundler WiX ne voit pas la variable d'environnement.

**Solution** : Signer manuellement avec `scripts/gen-keys` apres le build
(voir section [Signature et Cles](#signature-et-cles-updater)).

### 8. Modification des fichiers i18n (fr.json)

**Rappel** : `fr.json` est encodé en UTF-8 avec BOM. Toujours utiliser Python
avec `encoding='utf-8-sig'` pour le modifier. Ne jamais utiliser PowerShell
pour lire/écrire ce fichier.

### 9. Changement de clé publique = rupture de l'updater

**Cause** : La clé publique est compilée dans le binaire de chaque version.
Si les clés sont régénérées, les versions précédemment installées ne pourront
pas vérifier les nouvelles signatures.

**Solution** : Les utilisateurs devront réinstaller manuellement le nouveau MSI.
**Prévention** : Ne JAMAIS perdre la clé privée `src-tauri/.tauri-private-key`.

### 10. Badge de version invisible dans le header

**Cause** : Le badge utilisait des couleurs hardcodées (`rgba(255,255,255,...)`).
En thème **light**, le header est blanc → le texte blanc est invisible.

**Solution** : Utiliser les variables CSS du thème :
```html
<!-- ✅ Correct -->
color: var(--text-muted); background: var(--bg-base); border: 1px solid var(--border-color);

<!-- ❌ Incorrect -->
color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.1);
```

**Règle** : Ne JAMAIS utiliser de couleurs hardcodées dans le HTML inline.
Toujours utiliser les `var(--...)` du design system pour supporter light/dark.

### 11. L'updater télécharge mais rien ne se passe (aucune erreur visible)

**Cause** : Les erreurs de `download_and_install()` étaient envoyées dans
`eprintln!()` — invisible dans une app GUI avec `#[windows_subsystem = "windows"]`.

**Solution** : Afficher les erreurs dans le navigateur via `window.eval("alert(...)")` :
```rust
Err(e) => {
    let _ = window.eval(&format!("alert('{}');", e));
}
```

### 12. `tokio::time::sleep` ne compile pas dans Tauri

**Cause** : La crate `tokio` n'est pas directement importable dans un projet
Tauri (elle est ré-exportée via `tauri::async_runtime`). `tokio::time::sleep`
et `tokio::time::Duration` ne sont pas disponibles.

**Solution** : Utiliser `std::thread::sleep(Duration::from_secs(N))` à la place.
Dans le contexte de l'updater (spawned async task), bloquer le thread est acceptable
car c'est une tache en arriere-plan. Pour les dialogues (`tauri-plugin-dialog`),
utiliser `std::thread::spawn` pour eviter de deadlock le runtime async (voir #18).

### 13. L'installeur MSI stalle à "Collecte des informations nécessaires"

**Cause** : `omnibank-api.exe` (sidecar) tourne encore quand le MSI essaie de
remplacer les fichiers. Le MSI attend que le fichier soit libéré → stall.

**Solution** : Le callback `on_before_install` de `download_and_install()` doit
appeler `kill_sidecar()` + `taskkill /F /IM omnibank-api.exe` avant l'install :
```rust
move || {
    kill_sidecar(&state);
    let _ = Command::new("taskkill").args(["/F", "/IM", "omnibank-api.exe"]).output();
    std::thread::sleep(Duration::from_millis(500));
}
```

### 14. Format de signature Tauri = base64(minisign), pas minisign brut

**Cause** : `tauri-plugin-updater` appelle `base64_to_string()` sur **pubkey** ET
**signature** avant de les passer à `minisign-verify`. rsign2 produit du minisign
brut → le décodage base64 échoue ou produit des données corrompues.

**Solution** : Utiliser `scripts/gen-keys` qui produit les clés au format natif
minisign, puis base64-encoder le résultat pour `tauri.conf.json` et `latest.json`.

### 15. Doublons omnibank-api.exe après mise à jour

**Cause** : Après un update, `app.restart()` relance l'app mais l'ancien
`omnibank-api.exe` n'a pas été tué (ou a survécu au `kill_sidecar()`).
Le nouveau process spawn un 2ème sidecar → doublons.

**Solution** : Au démarrage dans `setup()`, **avant** de spawner le sidecar,
exécuter `taskkill /F /IM omnibank-api.exe` pour nettoyer les orphelins :
```rust
// Dans setup(), avant le spawn
let _ = std::process::Command::new("taskkill")
    .args(["/F", "/IM", "omnibank-api.exe"])
    .creation_flags(0x08000000)
    .output();
std::thread::sleep(Duration::from_millis(300));
```

---

## Commandes rapides

```powershell
# === RELEASE AUTOMATISE (RECOMMANDE) ===
.\scripts\release.ps1 -Version "X.Y.Z" -Notes "Description"
# Ajouter -SkipSidecar UNIQUEMENT si seul le code Rust change (Pas le frontend, car il est dans le sidecar)
# Ajouter -DryRun pour tester sans git push

# === BUILD COMPLET MANUEL ===
powershell -ExecutionPolicy Bypass -File .\scripts\build_sidecar.ps1
npx tauri build
.\scripts\gen-keys\target\release\gen-tauri-keys.exe sign <msi> src-tauri\.tauri-private-key

# === DEV MODE ===
uvicorn app.main:app --host 127.0.0.1 --port 8434 --reload
npx tauri dev

# === NETTOYAGE ===
Get-Process | Where-Object { $_.ProcessName -like "*omnibank*" } | Stop-Process -Force
```

---

### 16. Permission `app:default` not found (Tauri v2)

**Cause** : En Tauri v2, les permissions core sont prefixees `core:`.

**Solution** : Utiliser `"core:app:default"` dans capabilities.

### 17. Le badge version affiche une ancienne version

**Cause** : La version était lue depuis `/api/version` (sidecar Python).
Le sidecar PyInstaller embarque un `package.json` figé au moment du build.
De plus, l'IPC Tauri n'est pas injecté par défaut sur une URL externe
(`http://127.0.0.1:8434`), même avec `withGlobalTauri: true`.

**Solution** : 
1. Ajouter le domaine dans `src-tauri/capabilities/default.json` sous la clé `"remote": { "urls": ["http://127.0.0.1:8434", "http://127.0.0.1:8434/**"] }`. Cela autorise Tauri à injecter le bridge IPC sur cette URL.
2. Utiliser `window.__TAURI_INTERNALS__.invoke('get_app_version')` (ou `window.__TAURI__.core.invoke`) dans le frontend JS pour appeler la commande Rust.

### 18. blocking_show() deadlock dans async task

**Cause** : `blocking_show()` de `tauri-plugin-dialog` bloque le thread courant.
Appele dans un `tauri::async_runtime::spawn`, il bloque un worker tokio et peut
deadlock le runtime async.

**Solution** : Executer le dialogue dans un `std::thread::spawn` separe et
utiliser un `mpsc::channel` pour recuperer le resultat.

### 19. L'auto-update est cassé (Erreur "error decoding response body")

**Cause** : Le plugin updater Tauri utilise `serde_json` qui est strictement conforme à la norme JSON et refuse de parser un fichier JSON contenant un BOM (Byte Order Mark) UTF-8.
Le script `release.ps1` utilisait `Set-Content -Encoding UTF8`, ce qui dans PowerShell 5.1 (Windows) ajoute automatiquement un BOM. Cela corrompait silencieusement le fichier `latest.json` hébergé sur GitHub.

**Solution** : 
Forcer l'écriture sans BOM en utilisant les classes natives .NET dans PowerShell :
```powershell
$utf8NoBom = New-Object System.Text.UTF8Encoding $False
[System.IO.File]::WriteAllText("latest.json", $latestJson, $utf8NoBom)
```

### 20. ⚠️ IMPORTANT — Pas de migration de schéma DB automatique

**Risque** : SQLAlchemy utilise `Base.metadata.create_all()` qui **crée** les tables
manquantes mais **ne modifie jamais** les tables existantes. Si une mise à jour ajoute
une nouvelle colonne à une table existante (ex: `Transaction`, `Account`, `Budget`),
les utilisateurs existants **ne recevront pas** cette colonne → crash ou données manquantes.

**Pourquoi c'est critique** : L'updater Tauri permet de sauter plusieurs versions d'un coup
(ex: v1.0.15 → v1.0.25). Il n'y a pas de migrations incrémentales.

**Aujourd'hui** : Aucune migration n'est nécessaire (pas de changement de schéma récent).

**Si un jour vous devez ajouter/modifier une colonne** :
1. Ajouter un script de migration au démarrage du sidecar (`run_server.py`)
2. Utiliser `ALTER TABLE ... ADD COLUMN` avec `IF NOT EXISTS` (SQLite 3.35+)
3. Ou intégrer **Alembic** pour des migrations versionnées
4. **Tester** en ouvrant une ancienne DB avec le nouveau code

```python
# Exemple de migration manuelle au démarrage (run_server.py) :
from sqlalchemy import text, inspect
def migrate_db(engine):
    insp = inspect(engine)
    cols = [c['name'] for c in insp.get_columns('transactions')]
    with engine.begin() as conn:
        if 'new_column' not in cols:
            conn.execute(text("ALTER TABLE transactions ADD COLUMN new_column TEXT"))
```
