# OmniBank Release Script
# Usage: .\scripts\release.ps1 -Version "1.0.7" -Notes "Description des changements"
# Follows BUILD_GUIDE.md procedure exactly.

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [Parameter(Mandatory=$false)]
    [string]$Notes = "Mise a jour v$Version",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipSidecar,
    
    [Parameter(Mandatory=$false)]
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path "$ProjectRoot\package.json")) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
if (-not (Test-Path "$ProjectRoot\package.json")) {
    Write-Host "ERROR: Cannot find project root (package.json not found)" -ForegroundColor Red
    exit 1
}

Set-Location $ProjectRoot
Write-Host "`n=== OmniBank Release v$Version ===" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"

# --- Pre-flight checks ---
Write-Host "`n[0/8] Pre-flight checks..." -ForegroundColor Yellow

# Check tools
foreach ($tool in @("cargo", "npx", "git", "gh")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: $tool not found in PATH" -ForegroundColor Red
        exit 1
    }
}

# Check signing key
$PrivateKeyPath = Join-Path $ProjectRoot "src-tauri\.tauri-private-key"
if (-not (Test-Path $PrivateKeyPath)) {
    Write-Host "ERROR: Private key not found at $PrivateKeyPath" -ForegroundColor Red
    exit 1
}

# Check gen-tauri-keys tool
$SignerExe = Join-Path $ProjectRoot "scripts\gen-keys\target\release\gen-tauri-keys.exe"
if (-not (Test-Path $SignerExe)) {
    Write-Host "Signer tool not found. Building..." -ForegroundColor Yellow
    Push-Location (Join-Path $ProjectRoot "scripts\gen-keys")
    cargo build --release 2>&1 | Out-Null
    Pop-Location
    if (-not (Test-Path $SignerExe)) {
        Write-Host "ERROR: Failed to build signer tool" -ForegroundColor Red
        exit 1
    }
}

# Check for uncommitted changes (informational only — script commits all at step 6)
$dirty = git status --porcelain 2>&1
if ($dirty) {
    Write-Host "INFO: Uncommitted changes will be included in the release commit:" -ForegroundColor Yellow
    Write-Host $dirty
}

Write-Host "  All checks passed" -ForegroundColor Green

# --- Step 1: Version bump ---
Write-Host "`n[1/8] Bumping version to $Version..." -ForegroundColor Yellow

# package.json + tauri.conf.json - use Python per G-07 rule (safe JSON encoding)
python -c @"
import json, sys
v = sys.argv[1]
for path in ['package.json', 'src-tauri/tauri.conf.json']:
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    data['version'] = v
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')
print(f'Bumped to {v}')
"@ $Version

Write-Host "  package.json: $Version" -ForegroundColor Green
Write-Host "  tauri.conf.json: $Version" -ForegroundColor Green

# --- Step 2: Build sidecar ---
if (-not $SkipSidecar) {
    Write-Host "`n[2/8] Building sidecar (PyInstaller)..." -ForegroundColor Yellow
    & powershell -ExecutionPolicy Bypass -File ".\scripts\build_sidecar_onedir.ps1"
    $sidecarPath = "src-tauri\resources\omnibank-api"
    if (-not (Test-Path $sidecarPath)) {
        Write-Host "ERROR: Sidecar not found at $sidecarPath" -ForegroundColor Red
        exit 1
    }
    # Calculate folder size
    $sidecarSize = [math]::Round(((Get-ChildItem $sidecarPath -Recurse | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
    Write-Host "  Sidecar Dir: $sidecarSize MB" -ForegroundColor Green
} else {
    Write-Host "`n[2/8] Skipping sidecar build (-SkipSidecar)" -ForegroundColor DarkGray
}

# --- Step 3: Build MSI ---
Write-Host "`n[3/8] Building MSI (npx tauri build)..." -ForegroundColor Yellow
$prevPref = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
npx tauri build 2>&1 | ForEach-Object {
    $line = $_.ToString()
    if ($line -match "Finished|Built|bundle") { Write-Host "  $line" -ForegroundColor Green }
}
$ErrorActionPreference = $prevPref
$msiName = "OmniBank_${Version}_x64_fr-FR.msi"
$msiPath = "src-tauri\target\release\bundle\msi\$msiName"
if (-not (Test-Path $msiPath)) {
    Write-Host "ERROR: MSI not found at $msiPath" -ForegroundColor Red
    exit 1
}
$msiSize = [math]::Round((Get-Item $msiPath).Length / 1MB, 1)
Write-Host "  MSI: $msiSize MB" -ForegroundColor Green

# --- Step 4: Sign MSI ---
Write-Host "`n[4/8] Signing MSI with gen-tauri-keys..." -ForegroundColor Yellow
$signOutput = & $SignerExe sign $msiPath $PrivateKeyPath 2>&1
Write-Host $signOutput

# Extract base64 signature
$sigB64 = ($signOutput | Select-String "=== Base64 signature" -Context 0,1).Context.PostContext[0].Trim()
if (-not $sigB64) {
    Write-Host "ERROR: Failed to extract base64 signature" -ForegroundColor Red
    exit 1
}
Write-Host "  Signature length: $($sigB64.Length) chars" -ForegroundColor Green

# --- Step 5: Update latest.json ---
Write-Host "`n[5/8] Updating latest.json..." -ForegroundColor Yellow
$pubDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latestJson = @{
    version = $Version
    notes = $Notes
    pub_date = $pubDate
    platforms = @{
        "windows-x86_64" = @{
            signature = $sigB64
            url = "https://github.com/Aschefr/OmniBank-Local/releases/download/v$Version/$msiName"
        }
    }
} | ConvertTo-Json -Depth 10

$utf8NoBom = New-Object System.Text.UTF8Encoding $False
[System.IO.File]::WriteAllText((Join-Path $PWD "latest.json"), $latestJson, $utf8NoBom)
Write-Host "  latest.json updated (No BOM)" -ForegroundColor Green

if ($DryRun) {
    Write-Host "`n[DRY RUN] Stopping before git operations." -ForegroundColor Yellow
    Write-Host "  MSI: $msiPath"
    Write-Host "  Signature: $($sigB64.Substring(0, 40))..."
    exit 0
}

# --- Step 6: Git commit + tag ---
Write-Host "`n[6/8] Git commit + tag..." -ForegroundColor Yellow
git add -A
git commit -m "release: v$Version - $Notes"
git tag -a "v$Version" -m "OmniBank v$Version"
Write-Host "  Committed and tagged v$Version" -ForegroundColor Green

# --- Step 7: Git push ---
Write-Host "`n[7/8] Pushing to GitHub..." -ForegroundColor Yellow
git push origin main --tags 2>&1 | ForEach-Object { Write-Host "  $_" }
Write-Host "  Pushed" -ForegroundColor Green

# --- Step 8: GitHub Release ---
Write-Host "`n[8/8] Creating GitHub release..." -ForegroundColor Yellow

# Delete existing release/tag if exists
gh release delete "v$Version" -y 2>&1 | Out-Null

gh release create "v$Version" $msiPath `
    --title "OmniBank v$Version" `
    --notes $Notes

# --- Step 9: Docker Hub Release ---
Write-Host "`n[9/9] Building and pushing Docker image..." -ForegroundColor Yellow

docker build -f docker/Dockerfile.standalone -t aschefr/omnibank-local:$Version -t aschefr/omnibank-local:latest .
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker build failed" -ForegroundColor Red
    exit 1
}

docker push aschefr/omnibank-local:$Version
docker push aschefr/omnibank-local:latest

Write-Host "`n=== Release v$Version complete! ===" -ForegroundColor Green
$releaseUrl = "https://github.com/Aschefr/OmniBank-Local/releases/tag/v$Version"
Write-Host "  GitHub: $releaseUrl"
Write-Host "  Docker: https://hub.docker.com/r/aschefr/omnibank-local"
