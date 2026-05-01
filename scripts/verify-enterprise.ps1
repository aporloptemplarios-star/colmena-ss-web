Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    node --check main.js
    node --check renderer.js
    node --check preload.js
    Get-ChildItem src\services\*.js | ForEach-Object { node --check $_.FullName }
    Write-Host "COLMENA enterprise checks OK"
}
finally {
    Pop-Location
}
