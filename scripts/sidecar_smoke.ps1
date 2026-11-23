# Smoke test commun du backend compile (omnibank-api.exe), charge par build_sidecar_onedir.ps1, release.ps1 et
# test_msi_smoke.ps1 avec : . (Join-Path $PSScriptRoot "sidecar_smoke.ps1")
#
# Le backend compile lit les vraies donnees de la machine (%PROGRAMDATA%\OmniBank ou %APPDATA%\OmniBank) quand
# OMNIBANK_DATA_DIR n'est pas defini, et ecoute toujours sur 127.0.0.1:8434. Le test :
#   - refuse de demarrer si le port 8434 est deja pris (OmniBank installe, serveur de test Docker) : il ne tue plus
#     les processus de l'utilisateur et ne prend plus la reponse d'un autre serveur pour celle du build ;
#   - lance le backend sur un dossier de donnees temporaire, supprime ensuite ;
#   - verifie que c'est bien ce processus qui repond, et que les donnees ont ete creees dans le dossier temporaire.

function Test-SmokePortFree {
    $listen = Get-NetTCPConnection -LocalPort 8434 -State Listen -ErrorAction SilentlyContinue
    if ($listen) {
        $owners = ($listen | ForEach-Object {
            $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            if ($p) { "$($p.ProcessName) (pid $($p.Id))" } else { "pid $($_.OwningProcess)" }
        }) -join ", "
        Write-Host "ERREUR : le port 8434 est deja utilise par $owners." -ForegroundColor Red
        Write-Host "  Fermez OmniBank et arretez le serveur de test (docker stop omnibank-local-api-1), puis relancez." -ForegroundColor Red
        return $false
    }
    return $true
}

function Get-ProcessTreeIds([int]$RootId) {
    $ids = @($RootId)
    $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId, ParentProcessId
    $frontier = @($RootId)
    while ($frontier.Count -gt 0) {
        $children = @($all | Where-Object { $frontier -contains $_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId })
        $children = @($children | Where-Object { $ids -notcontains $_ })
        $ids += $children
        $frontier = $children
    }
    return $ids
}

function Invoke-SidecarSmokeTest {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [Parameter(Mandatory = $true)][string]$StdoutLog,
        [Parameter(Mandatory = $true)][string]$StderrLog,
        [int]$Attempts = 40
    )
    if (-not (Test-SmokePortFree)) { return $false }

    foreach ($log in @($StdoutLog, $StderrLog)) { if (Test-Path $log) { Remove-Item -Force $log } }
    $dataDir = Join-Path ([System.IO.Path]::GetTempPath()) ("omnibank_smoke_" + [guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

    $previous = $env:OMNIBANK_DATA_DIR
    $env:OMNIBANK_DATA_DIR = $dataDir
    try {
        $proc = Start-Process -FilePath $Exe -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog `
            -PassThru -WindowStyle Hidden
    } finally {
        # Le processus a herite de la variable : on rend son etat d'origine a la session
        if ($null -eq $previous) { Remove-Item Env:OMNIBANK_DATA_DIR -ErrorAction SilentlyContinue } else { $env:OMNIBANK_DATA_DIR = $previous }
    }

    $healthy = $false
    $reason = "pas de reponse sur http://127.0.0.1:8434/api/health"
    for ($i = 0; $i -lt $Attempts; $i++) {
        Start-Sleep -Milliseconds 500
        if ($proc.HasExited) { $reason = "le backend s'est arrete (code $($proc.ExitCode))"; break }
        try {
            $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8434/api/health" -Method Get -TimeoutSec 1 -ErrorAction Stop
            if ($resp.status -eq "ok" -or $resp -match "ok") {
                $owner = (Get-NetTCPConnection -LocalPort 8434 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
                if ((Get-ProcessTreeIds $proc.Id) -notcontains [int]$owner) { $reason = "un autre processus (pid $owner) repond sur 8434"; break }
                if (-not (Test-Path (Join-Path $dataDir "omnibank.db"))) { $reason = "le backend n'a pas utilise le dossier de donnees temporaire"; break }
                $healthy = $true
                break
            }
        } catch { }
    }

    # N'arreter que le processus du test et ses enfants, jamais un OmniBank de l'utilisateur
    $tree = Get-ProcessTreeIds $proc.Id
    foreach ($id in ($tree | Sort-Object -Descending)) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
    Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue

    if (-not $healthy) {
        Write-Host "ERREUR : smoke test du backend en echec : $reason." -ForegroundColor Red
        if (Test-Path $StderrLog) {
            Write-Host "`n--- Sortie d'erreur du backend ---" -ForegroundColor Yellow
            Get-Content $StderrLog -Tail 40
            Write-Host "----------------------------------" -ForegroundColor Yellow
        }
    }
    return $healthy
}
