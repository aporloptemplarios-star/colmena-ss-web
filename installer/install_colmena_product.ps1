Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
    [string]$InstallPath = "$env:LOCALAPPDATA\ColmenaLauncher",
    [string]$BackendUrl = "",
    [string]$LicenseKey = "",
    [string]$ServerId = ""
)

$source = Split-Path -Parent $PSScriptRoot
$launcherSource = Join-Path $source "launcher"

if (-not (Test-Path $launcherSource)) {
    throw "No se encontro carpeta launcher en el paquete."
}

New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
Copy-Item -LiteralPath (Join-Path $launcherSource "*") -Destination $InstallPath -Recurse -Force

$envExample = Join-Path $InstallPath ".env.example"
$envFile = Join-Path $InstallPath ".env"
if ((Test-Path $envExample) -and -not (Test-Path $envFile)) {
    Copy-Item -LiteralPath $envExample -Destination $envFile -Force
}

if ($BackendUrl) {
    Add-Content -Path $envFile -Value "COLMENA_BACKEND_URL=$BackendUrl"
}
if ($ServerId) {
    Add-Content -Path $envFile -Value "DISCORD_GUILD_ID=$ServerId"
}

Write-Host "Colmena WorkSuite instalado en $InstallPath"
Write-Host "Configura .env y activa licencia desde el launcher."
