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
| **rsign2** | 0.6+ | `cargo install rsign2` |

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
│   └── build_sidecar.ps1         # Script de build PyInstaller
└── src-tauri/
    ├── tauri.conf.json           # Configuration Tauri
    ├── Cargo.toml                # Dépendances Rust
    ├── build.rs                  # Build hook
    ├── src/
    │   └── main.rs               # Launcher Rust (spawn + kill + update)
    ├── capabilities/
    │   └── default.json          # Permissions (shell, updater)
    ├── icons/                    # Icônes (32px, 128px, 256px, ICO)
    ├── bin/                      # ⚡ Sidecar compilé (gitignored)
    │   └── omnibank-api-x86_64-pc-windows-msvc.exe
    ├── .tauri-private-key        # Clé privée updater (gitignored, NE PAS PERDRE)
    └── .tauri-public-key         # Clé publique updater
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

## Mise à jour (nouvelle version)

### Processus complet pas à pas

```powershell
# 1. Bumper la version dans les DEUX fichiers
#    - src-tauri/tauri.conf.json  →  "version": "X.Y.Z"
#    - package.json               →  "version": "X.Y.Z"

# 2. Rebuild sidecar (si le backend Python a changé)
powershell -ExecutionPolicy Bypass -File .\scripts\build_sidecar.ps1

# 3. Build le MSI
npx tauri build

# 4. Signer le MSI manuellement
rsign sign -s src-tauri\.tauri-private-key -W `
    src-tauri\target\release\bundle\msi\OmniBank_X.Y.Z_x64_fr-FR.msi

# 5. Mettre à jour latest.json
#    - "version" → nouvelle version
#    - "signature" → contenu du fichier .minisig généré à l'étape 4
#    - "url" → URL du MSI dans la GitHub Release

# 6. Commit + push
git add -A
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "OmniBank vX.Y.Z"
git push origin main --tags

# 7. Créer la GitHub Release avec le MSI
gh release create vX.Y.Z `
    "src-tauri/target/release/bundle/msi/OmniBank_X.Y.Z_x64_fr-FR.msi" `
    --title "OmniBank vX.Y.Z" `
    --notes "Description des changements"
```

> ⚠️ **L'ordre est important** : Le `latest.json` doit être pushé sur `main`
> **après** que le MSI soit uploadé dans la GitHub Release. Sinon l'updater
> pointera vers un fichier qui n'existe pas encore.

---

## Fonctionnement interne

### Cycle de vie de l'application

```
1. Utilisateur lance OmniBank.exe
2. main.rs → spawn("omnibank-api") → lance omnibank-api.exe
3. main.rs → boucle health check sur http://127.0.0.1:8434/api/health
   └── 30 tentatives × 500ms = 15s max
4. Dès que le sidecar répond → window.show()
5. 3 secondes après → check_for_updates()
   └── Vérifie latest.json sur GitHub
   └── Si mise à jour disponible → confirm() JS → download + install + restart
   └── Les erreurs sont affichées via alert() JS (pas eprintln, invisible en GUI)
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
| `app.windows[0].visible` | `false` | Fenêtre cachée au démarrage (affichée après health check) |
| `app.windows[0].url` | `http://127.0.0.1:8434` | Pointe vers le sidecar FastAPI |
| `app.windows[0].width` | `1600` | Largeur par défaut (augmentée pour éviter le retour à la ligne des noms de pages) |
| `app.windows[0].height` | `900` | Hauteur par défaut |
| `bundle.externalBin` | `["bin/omnibank-api"]` | Déclare le sidecar à inclure |
| `bundle.targets` | `["msi"]` | Format d'installateur Windows |
| `bundle.windows.wix.language` | `"fr-FR"` | Installateur en français |
| `plugins.updater.endpoints` | `[...latest.json]` | URL du manifeste de mise à jour |
| `plugins.updater.pubkey` | `RWS...` | Clé publique pour vérifier les signatures |

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

**Solution** : Utiliser `rsign2` à la place (voir section [Signature et Clés](#signature-et-clés-updater)).

### 6. "failed to decode base64 secret key" lors de la signature

**Cause** : La clé privée a été générée avec un outil incompatible (py-minisign,
minisign Python, etc.). Le format de la ligne de commentaire ou l'encodage
de la clé diffère du format attendu par rsign2/Tauri.

**Solution** : Régénérer les clés avec `rsign generate -f -W -s ... -p ...`.

### 7. Le `.sig` n'est pas généré par `tauri build`

**Cause** : `TAURI_SIGNING_PRIVATE_KEY` n'est pas propagé correctement par
`npx`. Le bundler WiX ne voit pas la variable d'environnement.

**Solution** : Signer manuellement avec `rsign sign` après le build
(voir section [Signature et Clés](#signature-et-clés-updater)).

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
car c'est une tâche en arrière-plan.

---

## Commandes rapides

```powershell
# === BUILD COMPLET (sidecar + MSI + signature) ===
powershell -ExecutionPolicy Bypass -File .\scripts\build_sidecar.ps1
npx tauri build
rsign sign -s src-tauri\.tauri-private-key -W src-tauri\target\release\bundle\msi\OmniBank_X.Y.Z_x64_fr-FR.msi

# === DEV MODE ===
# Terminal 1 : Backend
uvicorn app.main:app --host 127.0.0.1 --port 8434 --reload
# Terminal 2 : Frontend Tauri
npx tauri dev

# === NETTOYAGE ===
Get-Process | Where-Object { $_.ProcessName -like "*omnibank*" } | Stop-Process -Force

# === TEST SIDECAR STANDALONE ===
.\src-tauri\bin\omnibank-api-x86_64-pc-windows-msvc.exe
# Puis : Invoke-WebRequest http://127.0.0.1:8434/api/health

# === GÉNÉRER CLÉS UPDATER ===
cargo install rsign2
rsign generate -f -W -s src-tauri\.tauri-private-key -p src-tauri\.tauri-public-key

# === SIGNER UN MSI ===
rsign sign -s src-tauri\.tauri-private-key -W <chemin_du_msi>

# === VÉRIFIER UNE SIGNATURE ===
rsign verify <chemin_du_msi> -P <clé_publique>

# === PUBLIER UNE RELEASE ===
git add -A && git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "Description" && git push origin main --tags
gh release create vX.Y.Z <msi_path> --title "OmniBank vX.Y.Z" --notes "Changelog"
```
