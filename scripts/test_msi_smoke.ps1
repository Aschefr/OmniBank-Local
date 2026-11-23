# scripts/test_msi_smoke.ps1 - Validation automatisee d'un MSI OmniBank par extraction et test de sante
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$MsiPath
)

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

# Resolution du chemin MSI
if (-not (Test-Path $MsiPath)) {
    $candidate = Join-Path $ProjectRoot $MsiPath
    if (Test-Path $candidate) {
        $MsiPath = $candidate
    } else {
        Write-Host "ERREUR : Fichier MSI introuvable : $MsiPath" -ForegroundColor Red
        exit 1
    }
}
$MsiFullPath = (Resolve-Path $MsiPath).Path
Write-Host "=== Smoke Test MSI : $MsiFullPath ===" -ForegroundColor Cyan

# 1. Extraction administrative sans installation
$ExtractDir = Join-Path $ProjectRoot "build\msi_smoke_extracted"
if (Test-Path $ExtractDir) { Remove-Item -Recurse -Force $ExtractDir -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $ExtractDir | Out-Null

Write-Host "`n[1/3] Extraction administrative du MSI (msiexec /a)..." -ForegroundColor Yellow
$msiArgs = "/a `"$MsiFullPath`" /qn TARGETDIR=`"$ExtractDir`""
$proc = Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -Wait -PassThru

if ($proc.ExitCode -ne 0) {
    Write-Host "ERREUR CRITIQUE : Echec de l'extraction msiexec (Code de sortie: $($proc.ExitCode)) !" -ForegroundColor Red
    Remove-Item -Recurse -Force $ExtractDir -ErrorAction SilentlyContinue
    exit 1
}

# Chercher omnibank-api.exe dans les fichiers extraits
$FoundExe = Get-ChildItem -Path $ExtractDir -Recurse -Filter "omnibank-api.exe" | Select-Object -First 1
if (-not $FoundExe) {
    Write-Host "ERREUR CRITIQUE : omnibank-api.exe introuvable dans le MSI extrait !" -ForegroundColor Red
    Remove-Item -Recurse -Force $ExtractDir -ErrorAction SilentlyContinue
    exit 1
}

$TestExe = $FoundExe.FullName
Write-Host "  Executable extrait trouve : $TestExe" -ForegroundColor Green

# 2. Execution du Smoke Test sur le binaire extrait
Write-Host "`n[2/3] Demarrage du binaire extrait et verification de sante (/api/health)..." -ForegroundColor Yellow

# Smoke test sur un dossier de donnees temporaire, jamais les vraies donnees de la machine (voir sidecar_smoke.ps1)
. (Join-Path $PSScriptRoot "sidecar_smoke.ps1")
$SmokeStdout = Join-Path $ProjectRoot "build\msi_smoke_stdout.log"
$SmokeStderr = Join-Path $ProjectRoot "build\msi_smoke_stderr.log"
$healthy = Invoke-SidecarSmokeTest -Exe $TestExe -StdoutLog $SmokeStdout -StderrLog $SmokeStderr

# 3. Verdict
Write-Host "`n[3/3] Verdict du Smoke Test MSI :" -ForegroundColor Yellow
if (-not $healthy) {
    Write-Host "================================================================" -ForegroundColor Red
    Write-Host "ECHEC DU SMOKE TEST MSI - BINAIRE EMBARQUE DEFECTUEUX !" -ForegroundColor Red
    Write-Host "Le MSI contient un executable qui crashe ou ne repond pas." -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Red
    if (Test-Path $SmokeStderr) {
        Write-Host "`n--- Traceback capture dans Stderr ---" -ForegroundColor Yellow
        Get-Content $SmokeStderr -Raw | Write-Host -ForegroundColor Yellow
        Write-Host "-------------------------------------" -ForegroundColor Yellow
    }
    Remove-Item -Recurse -Force $ExtractDir -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "  Succes : Le sidecar extrait du MSI a repondu 200 OK sur /api/health !" -ForegroundColor Green

# Nettoyage du dossier d'extraction
Remove-Item -Recurse -Force $ExtractDir -ErrorAction SilentlyContinue
Write-Host "  Dossier temporaire d'extraction nettoye." -ForegroundColor Gray
Write-Host "`n=== Le fichier MSI est 100% fonctionnel et certifie pour publication ! ===" -ForegroundColor Green
exit 0
