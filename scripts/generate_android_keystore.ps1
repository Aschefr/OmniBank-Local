<#
.SYNOPSIS
    Génère le Keystore Android (.jks) de signature de production pour Amify Studio
    et affiche sa représentation Base64 prête à coller dans les Secrets GitHub Actions.
#>
param(
    [string]$KeystoreFile = "omnibank-release-key.jks",
    [string]$KeyAlias = "omnibank",
    [string]$Password = ""
)

if (-not $Password) {
    $Password = Read-Host "Choisissez un mot de passe robuste pour le Keystore (min 6 caractères)"
}

keytool -genkeypair -v `
    -keystore $KeystoreFile `
    -alias $KeyAlias `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -storepass $Password `
    -keypass $Password `
    -dname "CN=Amify Studio, OU=Mobile, O=Amify Studio, L=France, S=France, C=FR"

if (Test-Path $KeystoreFile) {
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $KeystoreFile)))
    Write-Host "`n✅ Keystore généré : $KeystoreFile (CONSERVEZ-LE PRÉCIEUSEMENT HORS DU DÉPÔT !)" -ForegroundColor Green
    Write-Host "Secrets GitHub Actions à configurer :" -ForegroundColor Cyan
    Write-Host "  ANDROID_KEY_ALIAS         = $KeyAlias"
    Write-Host "  ANDROID_KEYSTORE_PASSWORD = $Password"
    Write-Host "  ANDROID_KEY_PASSWORD      = $Password"
    Write-Host "  ANDROID_KEYSTORE_BASE64   = (copié dans le presse-papiers ci-dessous)"
    Set-Clipboard -Value $b64
    Write-Host "📋 La chaîne ANDROID_KEYSTORE_BASE64 a été copiée dans votre presse-papiers." -ForegroundColor Yellow
}

