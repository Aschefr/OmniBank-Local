# Script de lancement des tests automatisés (Docker / Windows PowerShell)

$ErrorActionPreference = "Stop"

# Obtenir le chemin absolu du dossier racine
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrEmpty($ScriptDir)) {
    $ScriptDir = Get-Location
}

Write-Host "=== [1/3] Génération de la base de données de test sur mesure ===" -ForegroundColor Cyan
& python "$ScriptDir\tests\generate_test_db.py"

Write-Host "=== [2/3] Lancement des tests dans le conteneur Docker ===" -ForegroundColor Cyan
# On utilise docker compose run en montant les dossiers tests et data
docker compose run --rm -v "${ScriptDir}/tests:/app/tests" -v "${ScriptDir}/data:/app/data" api pytest tests/

Write-Host "=== [3/3] Nettoyage de la base de données de test ===" -ForegroundColor Cyan
if (Test-Path "$ScriptDir\data\omnibank_test.db") {
    Remove-Item "$ScriptDir\data\omnibank_test.db" -Force
}

Write-Host "=== TOUS LES TESTS SONT PASSÉS AVEC SUCCÈS ! ===" -ForegroundColor Green
