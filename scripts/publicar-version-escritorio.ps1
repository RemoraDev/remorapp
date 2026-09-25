# Automatiza la parte repetitiva de publicar una versión nueva de la
# app de escritorio: compila, firma, arma latest.json, y deja los
# archivos listos (o los sube directo a GitHub Releases con -SubirAGitHub).
#
# Antes de correr esto: subí package.json Y src-tauri/tauri.conf.json
# al mismo número de versión nuevo -- este script no lo hace por vos.
#
# Uso:
#   .\scripts\publicar-version-escritorio.ps1                 (compila y deja los archivos listos)
#   .\scripts\publicar-version-escritorio.ps1 -SubirAGitHub    (además, crea el release con gh)

param(
  [switch]$SubirAGitHub
)

$ErrorActionPreference = "Stop"

$raiz = Split-Path -Parent $PSScriptRoot
# Ajustá esta ruta si moviste la carpeta de secretos generada al
# configurar el updater (ver docs/publicar-version-escritorio.md).
$secretos = "C:\Users\SQuei\remorapp-tauri-secrets"

if (-not (Test-Path "$secretos\remorapp-updater.key")) {
  Write-Error "No se encontró la clave privada de firma en $secretos\remorapp-updater.key -- sin ella no se puede firmar la actualización."
  exit 1
}

$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$secretos\remorapp-updater.key" -Raw)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content "$secretos\updater-key-password.txt" -Raw).Trim()

Set-Location $raiz

Write-Host "1/4 Compilando la app de escritorio (npm run tauri build)..." -ForegroundColor Cyan
npm run tauri build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "2/4 Generando latest.json..." -ForegroundColor Cyan
node scripts/generar-latest-json.mjs
if ($LASTEXITCODE -ne 0) { exit 1 }

$version = (Get-Content "$raiz\package.json" | ConvertFrom-Json).version
$bundleDir = "$raiz\src-tauri\target\release\bundle"
$exeOriginal = "$bundleDir\nsis\RemorApp_${version}_x64-setup.exe"
$exeEstable = "$bundleDir\RemorApp-Setup.exe"
$latestJson = "$bundleDir\latest.json"

Write-Host "3/4 Preparando los archivos para subir..." -ForegroundColor Cyan
Copy-Item $exeOriginal $exeEstable -Force

Write-Host ""
Write-Host "Listo. Version: $version" -ForegroundColor Green
Write-Host "Archivos listos para subir a GitHub Releases:"
Write-Host "  - $exeEstable"
Write-Host "  - $latestJson"
Write-Host ""

if ($SubirAGitHub) {
  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $gh) {
    Write-Warning "No se encontró 'gh' (GitHub CLI) instalado. Instalalo desde https://cli.github.com/ o subí los dos archivos de arriba a mano desde la web de GitHub Releases."
    exit 1
  }
  Write-Host "4/4 Creando el release v$version en GitHub y subiendo los archivos..." -ForegroundColor Cyan
  gh release create "v$version" "$exeEstable" "$latestJson" --title "RemorApp $version" --notes "Nueva version de RemorApp para escritorio."
} else {
  Write-Host "4/4 (Omitido) Corre este mismo script con -SubirAGitHub para crear el release automatico con 'gh', o subi los dos archivos de arriba a mano en:"
  Write-Host "  https://github.com/RemoraDev/remorapp/releases/new"
}
