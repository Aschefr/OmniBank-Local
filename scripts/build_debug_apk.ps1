$ErrorActionPreference = "Stop"

if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem -Path "C:\Program Files\Eclipse Adoptium" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
    if ($jdk) {
        $env:JAVA_HOME = $jdk.FullName
        $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
    }
}

if (-not $env:ANDROID_HOME) {
    $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}

Set-Location (Join-Path $PSScriptRoot "..\android")
.\gradlew.bat assembleDebug
