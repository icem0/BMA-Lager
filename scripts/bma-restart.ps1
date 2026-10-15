#!/usr/bin/env pwsh
# bma-restart.ps1 — Frischer Test-Stack.
#
# Stoppt den Stack, entfernt alle named volumes (inkl. anonyme,
# die Docker fuer ungebundene Postgres-Mounts anlegt), zieht die
# aktuellen GHCR-Images und startet den Stack neu.
#
# Ergebnis: leere DB, leerer kein Admin -> PWA zeigt Setup-Formular.
# Foto-Daten unter ./.data/fotos bleiben erhalten (Bind-Mount, kein
# named volume -> wird von `down -v` nicht beruehrt).
#
# Aufruf:
#   pwsh ./scripts/bma-restart.ps1
#   pwsh ./scripts/bma-restart.ps1 -WaitForSha 82877e68...   # nach Push warten
#
# Parameter:
#   -WaitForSha <sha>   Wartet nach 'down', bis das GHCR-Image
#   mit Tag <sha> erreichbar ist (Docker Registry HTTP API).
#   Praktisch fuer Auto-Redeploy via Git post-push-Hook.
#   -WaitTimeoutSec <n> Timeout fuer -WaitForSha (default 300).
#   -SkipPull           Ueberspringt `docker compose pull`.

param(
    [string]$WaitForSha = "",
    [int]$WaitTimeoutSec = 60,
    [switch]$SkipPull
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# curl.exe-Pfad einmal ermitteln. PowerShell hat einen `curl`-Alias auf
# Invoke-WebRequest, der Vorrang vor Pfaden hat. Ueber den Pfad aus
# Get-Command umgehen wir den Alias.
$Script:CurlExe = (Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (-not $Script:CurlExe) { throw "curl.exe nicht gefunden im PATH" }

# Repo-Root bestimmen (Verzeichnis mit docker-compose.yml).
$RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path
Set-Location $RepoRoot

function Get-GhcrDigest {
    # Returns the sha256 digest of the :latest manifest, or $null.
    # Uses $Script:CurlExe to dodge PowerShell Invoke-WebRequest quirks
    # and the `curl` -> Invoke-WebRequest alias.
    param([string]$Image)

    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $tokenResp = & $Script:CurlExe -sS --max-time 10 "https://ghcr.io/token?service=ghcr.io&scope=repository:icem0/${Image}:pull"
        if ($LASTEXITCODE -ne 0) { return $null }
        $token = ($tokenResp | ConvertFrom-Json).token
    } catch {
        return $null
    } finally {
        $ErrorActionPreference = $oldEap
    }
    if (-not $token) { return $null }

    foreach ($accept in @(
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json"
    )) {
        $headers = & $Script:CurlExe -sS -o $null --max-time 10 -D - `
            -H "Authorization: Bearer $token" `
            -H "Accept: $accept" `
            -X HEAD "https://ghcr.io/v2/icem0/${Image}/manifests/latest"
        if ($LASTEXITCODE -eq 0 -and $headers -match "Docker-Content-Digest:\s*(\S+)") {
            return $Matches[1]
        }
    }
    return $null
}

function Test-GhcrManifest {
    # Returns $true if Image has Tag available at GHCR, $false otherwise.
    # Uses $Script:CurlExe to dodge PowerShell Invoke-WebRequest quirks
    # and the `curl` -> Invoke-WebRequest alias.
    param([string]$Image, [string]$Tag)

    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $tokenResp = & $Script:CurlExe -sS --max-time 10 "https://ghcr.io/token?service=ghcr.io&scope=repository:icem0/${Image}:pull"
        if ($LASTEXITCODE -ne 0) { return $false }
        $token = ($tokenResp | ConvertFrom-Json).token
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $oldEap
    }
    if (-not $token) { return $false }

    foreach ($accept in @(
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json"
    )) {
        $status = & $Script:CurlExe -sS -o $null -w "%{http_code}" --max-time 10 `
            -H "Authorization: Bearer $token" `
            -H "Accept: $accept" `
            -X HEAD "https://ghcr.io/v2/icem0/${Image}/manifests/${Tag}"
        if ($status -eq "200") { return $true }
    }
    return $false
}

if ($WaitForSha) {
    Write-Host "[bma] Warte auf GHCR-Images fuer SHA $WaitForSha..." -ForegroundColor Cyan

    # Strategie: GHCR rewritet SHA-Tags nicht zuverlaessig. Wir pollen
    # daher auf den Digest von :latest und warten, bis sich der Digest
    # aendert ODER das SHA-Tag erreichbar wird (was je nach GHCR-
    # Verhalten eines von beidem zuerst eintrifft).

    $beforeApi = Get-GhcrDigest -Image "bma-lager-api"
    $beforePwa = Get-GhcrDigest -Image "bma-lager-pwa"
    $deadline = (Get-Date).AddSeconds($WaitTimeoutSec)
    $readyApi = $false
    $readyPwa = $false
    while ((Get-Date) -lt $deadline) {
        if (-not $readyApi) {
            $digest = Get-GhcrDigest -Image "bma-lager-api"
            if ($digest -and $digest -ne $beforeApi) {
                $readyApi = $true
                Write-Host "  api :latest digest geaendert -> $digest" -ForegroundColor DarkGray
            } elseif (Test-GhcrManifest -Image "bma-lager-api" -Tag $WaitForSha) {
                $readyApi = $true
                Write-Host "  api :$WaitForSha erreichbar" -ForegroundColor DarkGray
            }
        }
        if (-not $readyPwa) {
            $digest = Get-GhcrDigest -Image "bma-lager-pwa"
            if ($digest -and $digest -ne $beforePwa) {
                $readyPwa = $true
                Write-Host "  pwa :latest digest geaendert -> $digest" -ForegroundColor DarkGray
            } elseif (Test-GhcrManifest -Image "bma-lager-pwa" -Tag $WaitForSha) {
                $readyPwa = $true
                Write-Host "  pwa :$WaitForSha erreichbar" -ForegroundColor DarkGray
            }
        }
        if ($readyApi -and $readyPwa) { break }
        Write-Host "  warte... (api=$readyApi, pwa=$readyPwa)" -ForegroundColor DarkGray
        Start-Sleep -Seconds 5
    }
    if (-not ($readyApi -and $readyPwa)) {
        throw "GHCR-Images fuer SHA $WaitForSha nach $WaitTimeoutSec s nicht verfuegbar. Build noch nicht durch? Siehe .github/workflows/build-and-push.yml."
    }
    Write-Host "  beide Images verfuegbar." -ForegroundColor Green
}

Write-Host "[bma] Stoppe Stack und entferne alle named volumes..." -ForegroundColor Cyan
docker compose down -v | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker compose down -v fehlgeschlagen" }

if (-not $SkipPull) {
    Write-Host "[bma] Ziehe aktuelle Images von GHCR..." -ForegroundColor Cyan
    docker compose pull | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker compose pull fehlgeschlagen" }
} else {
    Write-Host "[bma] Ueberspringe pull (-SkipPull)." -ForegroundColor DarkGray
}

Write-Host "[bma] Starte Stack neu..." -ForegroundColor Cyan
docker compose up -d | Out-Null
if ($LASTEXITCODE -ne 0) { throw "docker compose up -d fehlgeschlagen" }

Write-Host "[bma] Warte auf Healthchecks..." -ForegroundColor Cyan
Start-Sleep -Seconds 20

Write-Host "[bma] Status:" -ForegroundColor Cyan
docker compose ps

Write-Host "[bma] API-Health (direkt):" -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:4242/api/healthz" -UseBasicParsing -TimeoutSec 5
    Write-Host "  HTTP $($resp.StatusCode)"
} catch {
    Write-Host "  nicht erreichbar: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "[bma] Setup-Status (sollte setupRequired:true sein):" -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri "http://localhost:4242/api/auth/setup-status" -UseBasicParsing -TimeoutSec 5
    Write-Host "  $($resp.Content)"
} catch {
    Write-Host "  nicht erreichbar: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[bma] Fertig. PWA: http://localhost:4280  API: http://localhost:4242" -ForegroundColor Green