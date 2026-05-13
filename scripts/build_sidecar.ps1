# Build the FastAPI sidecar with PyInstaller and copy to Tauri bin directory
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== OmniBank Sidecar Builder ===" -ForegroundColor Cyan
Write-Host "Project root: $ProjectRoot"

# Determine target triple
$TargetTriple = "x86_64-pc-windows-msvc"
$ExeName = "omnibank-api-$TargetTriple.exe"

if (-not $SkipBuild) {
    Write-Host "`n[1/3] Building sidecar with PyInstaller..." -ForegroundColor Yellow

    $PyInstallerPath = "$env:APPDATA\Python\Python314\Scripts\pyinstaller.exe"
    if (-not (Test-Path $PyInstallerPath)) {
        $PyInstallerPath = "pyinstaller"
    }

    Push-Location $ProjectRoot
    & $PyInstallerPath `
        --onefile `
        --name $ExeName.Replace(".exe", "") `
        --add-data "static;static" `
        --add-data "app;app" `
        --add-data "package.json;." `
        --hidden-import "uvicorn" `
        --hidden-import "uvicorn.config" `
        --hidden-import "uvicorn.main" `
        --hidden-import "uvicorn.server" `
        --hidden-import "uvicorn.logging" `
        --hidden-import "uvicorn.loops" `
        --hidden-import "uvicorn.loops.auto" `
        --hidden-import "uvicorn.loops.asyncio" `
        --hidden-import "uvicorn.protocols" `
        --hidden-import "uvicorn.protocols.http" `
        --hidden-import "uvicorn.protocols.http.auto" `
        --hidden-import "uvicorn.protocols.http.h11_impl" `
        --hidden-import "uvicorn.protocols.http.httptools_impl" `
        --hidden-import "uvicorn.protocols.websockets" `
        --hidden-import "uvicorn.protocols.websockets.auto" `
        --hidden-import "uvicorn.lifespan" `
        --hidden-import "uvicorn.lifespan.on" `
        --hidden-import "uvicorn.lifespan.off" `
        --hidden-import "fastapi" `
        --hidden-import "fastapi.routing" `
        --hidden-import "fastapi.staticfiles" `
        --hidden-import "fastapi.responses" `
        --hidden-import "fastapi.middleware" `
        --hidden-import "starlette" `
        --hidden-import "starlette.routing" `
        --hidden-import "starlette.staticfiles" `
        --hidden-import "starlette.responses" `
        --hidden-import "starlette.middleware" `
        --hidden-import "starlette.formparsers" `
        --hidden-import "multipart" `
        --hidden-import "multipart.multipart" `
        --hidden-import "python_multipart" `
        --hidden-import "sqlalchemy" `
        --hidden-import "sqlalchemy.sql.default_comparator" `
        --hidden-import "sqlalchemy.ext.declarative" `
        --hidden-import "pydantic" `
        --hidden-import "pydantic_settings" `
        --hidden-import "pandas" `
        --hidden-import "chardet" `
        --hidden-import "httpx" `
        --hidden-import "openpyxl" `
        --hidden-import "dateutil" `
        --hidden-import "app.main" `
        --hidden-import "app.database" `
        --hidden-import "app.models" `
        --hidden-import "app.init_data" `
        --hidden-import "app.routers.transactions" `
        --hidden-import "app.routers.categories" `
        --hidden-import "app.routers.recurrences" `
        --hidden-import "app.routers.stats" `
        --hidden-import "app.routers.accounts" `
        --hidden-import "app.routers.config" `
        --hidden-import "app.routers.chat" `
        --hidden-import "app.routers.csv_manager" `
        --hidden-import "app.routers.csv_parser" `
        --hidden-import "app.routers.ai_helpers" `
        --hidden-import "app.routers.budgets" `
        --hidden-import "app.routers.backup" `
        --hidden-import "app._license_secret" `
        --collect-submodules "uvicorn" `
        --collect-submodules "fastapi" `
        --collect-submodules "starlette" `
        --clean `
        --noconfirm `
        run_server.py
    Pop-Location

    if ($LASTEXITCODE -ne 0) {
        Write-Host "PyInstaller build FAILED!" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n[2/3] Copying sidecar to Tauri bin directory..." -ForegroundColor Yellow

$BinDir = Join-Path $ProjectRoot "src-tauri\bin"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

$SourceExe = Join-Path $ProjectRoot "dist\$ExeName"
if (-not (Test-Path $SourceExe)) {
    Write-Host "ERROR: Built exe not found at $SourceExe" -ForegroundColor Red
    exit 1
}

Copy-Item $SourceExe -Destination $BinDir -Force

$ExeSize = [math]::Round((Get-Item (Join-Path $BinDir $ExeName)).Length / 1MB, 1)
Write-Host "`n[3/3] Done!" -ForegroundColor Green
Write-Host "  Sidecar: $BinDir\$ExeName ($ExeSize MB)"
