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
$SpecFile = Join-Path $ProjectRoot "scripts\packaging\omnibank-api.spec"
if (-not (Test-Path $SpecFile)) {
    $SpecFile = Join-Path $ProjectRoot "build\omnibank-api.spec"
}

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

Write-Host "`n[3/3] Sidecar assets copied." -ForegroundColor Green
$sidecarSize = [math]::Round(((Get-ChildItem $ResourcesDir -Recurse | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
Write-Host "  Sidecar Dir: $ResourcesDir ($sidecarSize MB)"

Write-Host "`n[4/4] Validating sidecar with automated Smoke Test..." -ForegroundColor Yellow
$TestExe = Join-Path $ResourcesDir $ExeName
if (-not (Test-Path $TestExe)) {
    Write-Host "ERROR: Compiled executable not found at $TestExe" -ForegroundColor Red
    exit 1
}

# Smoke test on a temporary data folder, never the machine's real data (see sidecar_smoke.ps1)
. (Join-Path $PSScriptRoot "sidecar_smoke.ps1")
$SmokeStdout = Join-Path $ProjectRoot "build\smoke_stdout.log"
$SmokeStderr = Join-Path $ProjectRoot "build\smoke_stderr.log"
if (-not (Invoke-SidecarSmokeTest -Exe $TestExe -StdoutLog $SmokeStdout -StderrLog $SmokeStderr)) {
    Write-Host "`nCRITICAL ERROR: Sidecar Smoke Test FAILED!" -ForegroundColor Red
    exit 1
}

Write-Host "  Sidecar Smoke Test PASSED! Local engine responded 200 OK." -ForegroundColor Green
Write-Host "`n=== Sidecar build and validation complete! ===" -ForegroundColor Green
