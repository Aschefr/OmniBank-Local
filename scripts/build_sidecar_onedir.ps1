# Build the FastAPI sidecar with PyInstaller spec and copy to Tauri resources directory
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== OmniBank Sidecar Builder (spec) ===" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"

# Target directory name
$DirName = "omnibank-api"
$ExeName = "omnibank-api.exe"
$SpecFile = Join-Path $ProjectRoot "build\omnibank-api.spec"

if (-not $SkipBuild) {
    Write-Host "`n[1/3] Building sidecar with PyInstaller spec..." -ForegroundColor Yellow

    if (-not (Test-Path $SpecFile)) {
        Write-Host "ERROR: Spec file not found at $SpecFile" -ForegroundColor Red
        exit 1
    }

    # Find PyInstaller
    $PyInstallerPath = Join-Path $ProjectRoot "venv\Scripts\pyinstaller.exe"
    if (-not (Test-Path $PyInstallerPath)) {
        $PyInstallerPath = "$env:APPDATA\Python\Python314\Scripts\pyinstaller.exe"
    }
    if (-not (Test-Path $PyInstallerPath)) {
        $PyInstallerPath = "pyinstaller"
    }

    # Clean previous build artifacts
    $WorkPath = Join-Path $ProjectRoot "build\pyinstaller"
    $DistPath = Join-Path $ProjectRoot "dist"
    if (Test-Path $WorkPath) { Remove-Item -Recurse -Force $WorkPath }

    Push-Location $ProjectRoot
    & $PyInstallerPath `
        --noconfirm `
        $SpecFile `
        --distpath $DistPath `
        --workpath $WorkPath
    Pop-Location

    if ($LASTEXITCODE -ne 0) {
        Write-Host "PyInstaller build FAILED!" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n[2/3] Copying sidecar to Tauri resources directory..." -ForegroundColor Yellow

$ResourcesDir = Join-Path $ProjectRoot "src-tauri\resources\omnibank-api"
if (Test-Path $ResourcesDir) { Remove-Item -Recurse -Force $ResourcesDir }
New-Item -ItemType Directory -Force -Path (Split-Path $ResourcesDir) | Out-Null

$SourceDir = Join-Path $ProjectRoot "dist\$DirName"
if (-not (Test-Path $SourceDir)) {
    Write-Host "ERROR: Built dir not found at $SourceDir" -ForegroundColor Red
    exit 1
}

Copy-Item -Path $SourceDir -Destination (Split-Path $ResourcesDir) -Recurse -Force

Write-Host "`n[3/3] Done!" -ForegroundColor Green
$sidecarSize = [math]::Round(((Get-ChildItem $ResourcesDir -Recurse | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
Write-Host "  Sidecar Dir: $ResourcesDir ($sidecarSize MB)"
