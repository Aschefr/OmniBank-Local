# scripts/run_e2e_tests.ps1
# Script PowerShell de lancement des tests E2E automatisés Playwright (OmniBank Local)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrEmpty($ScriptDir)) {
    $ScriptDir = Get-Location
}
$RootDir = Split-Path -Parent $ScriptDir

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " [OMNIBANK LOCAL] LANCEMENT DE LA SUITE DE TESTS E2E" -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

# 1. Vérification de Node.js & Playwright
Write-Host "=== [1/3] Verification de l'environnement Playwright ===" -ForegroundColor Yellow
if (-not (Get-Command "npx" -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js (npx) n'est pas installe ou n'est pas dans le PATH."
    exit 1
}

# 2. Exécution de la suite Playwright
Write-Host "=== [2/3] Execution des 10 scenarios de non-regression E2E ===" -ForegroundColor Yellow
Set-Location $RootDir
& npx playwright test $args

$testExitCode = $LASTEXITCODE

# 3. Rapport final
if ($testExitCode -eq 0) {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host " TOUS LES TESTS E2E SONT PASSES AVEC SUCCES (100% OK) !" -ForegroundColor Green
    Write-Host "========================================================`n" -ForegroundColor Green
} else {
    Write-Host "`n========================================================" -ForegroundColor Red
    Write-Host " DES TESTS E2E ONT ECHOUE. Consultez le rapport HTML :" -ForegroundColor Red
    Write-Host " Commande : npx playwright show-report" -ForegroundColor Yellow
    Write-Host "========================================================`n" -ForegroundColor Red
}

exit $testExitCode
