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

# Kill any existing omnibank-api before testing
Get-Process "omnibank-api" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 300

$SmokeStdout = Join-Path $ProjectRoot "build\smoke_stdout.log"
$SmokeStderr = Join-Path $ProjectRoot "build\smoke_stderr.log"
if (Test-Path $SmokeStdout) { Remove-Item -Force $SmokeStdout }
if (Test-Path $SmokeStderr) { Remove-Item -Force $SmokeStderr }

$proc = Start-Process -FilePath $TestExe `
    -RedirectStandardOutput $SmokeStdout `
    -RedirectStandardError $SmokeStderr `
    -PassThru -WindowStyle Hidden

$healthy = $false
for ($i = 0; $i -lt 16; $i++) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) {
        break
    }
    try {
        $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8434/api/health" -Method Get -TimeoutSec 1 -ErrorAction Stop
        if ($resp.status -eq "ok" -or $resp -match "ok") {
            $healthy = $true
            break
        }
    } catch {
        # Waiting for server to become ready
    }
}

# Always terminate test process
if (-not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
Get-Process "omnibank-api" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

if (-not $healthy) {
    Write-Host "`nCRITICAL ERROR: Sidecar Smoke Test FAILED!" -ForegroundColor Red
    Write-Host "The compiled sidecar crashed or did not respond on http://127.0.0.1:8434/api/health." -ForegroundColor Red
    if (Test-Path $SmokeStderr) {
        Write-Host "`n--- Sidecar Stderr Output ---" -ForegroundColor Yellow
        Get-Content $SmokeStderr
        Write-Host "-----------------------------" -ForegroundColor Yellow
    }
    exit 1
}

Write-Host "  Sidecar Smoke Test PASSED! Local engine responded 200 OK." -ForegroundColor Green
Write-Host "`n=== Sidecar build and validation complete! ===" -ForegroundColor Green
