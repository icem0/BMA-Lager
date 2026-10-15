#!/usr/bin/env pwsh
# bma-restart.ps1 — Frischer Test-Stack.
#
# Stoppt den Stack, entfernt alle named volumes (inkl. anonyme,
# die Docker fuer ungebundene Postgres-Mounts anlegt), zieht die
# aktuellen GHCR-Images und startet den Stack neu.
#
# Ergebnis: leere DB, kein Admin -> PWA zeigt Setup-Formular.
# Foto-Daten unter ./.data/fotos bleiben erhalten (Bind-Mount, kein
# named volume -> wird von `down -v` nicht beruehrt).
#
# Aufruf:
#   powershell -File ./scripts/bma-restart.ps1
#   powershell -File ./scripts/bma-restart.ps1 -WaitForSha 82877e68... -WaitTimeoutSec 300
#
# Parameter:
#   -WaitForSha <sha>   Wartet nach 'up', bis die GHCR-Images fuer
#                       diesen SHA verfuegbar sind. Praktisch nach
#                       'git push', um direkt zu deployen sobald CI
#                       die Images gebaut hat.
#   -WaitTimeoutSec <n> Timeout fuer -WaitForSha (default 60).
#   -SkipPull           Ueberspringt `docker compose pull`.
#
# Voraussetzung: Docker Desktop (stellt `docker buildx imagetools`
# fuer die GHCR-Erkennung bereit) und WSL 2.

param(
    [string]$WaitForSha = "",
    [int]$WaitTimeoutSec = 60,
    [switch]$SkipPull
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Repo-Root bestimmen (Verzeichnis mit docker-compose.yml).
$RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path
Set-Location $RepoRoot

function Get-GhcrDigest {
    # Liefert den sha256-Digest des :latest-Manifests ueber
    # `docker buildx imagetools inspect` (das in Docker Desktop
    # enthalten ist). Bei Fehler: $null.
    param([string]$Image)

    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $out = docker buildx imagetools inspect "ghcr.io/icem0/${Image}:latest" 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        # Ausgabe parsen: Zeile "Digest:    sha256:..."
        foreach ($line in $out) {
            if ($line -match "^\s*Digest:\s*(sha256:\S+)") {
                return $Matches[1]
            }
        }
        return $null
    } catch {
        return $null
    } finally {
        $ErrorActionPreference = $oldEap
    }
}

function Test-GhcrManifest {
    # Prueft, ob ein bestimmter Tag am GHCR-Image existiert.
    # Strategie: docker buildx imagetools inspect gibt 0 zurueck,
    # wenn der Tag existiert, != 0 sonst.
    param([string]$Image, [string]$Tag)

    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $null = docker buildx imagetools inspect "ghcr.io/icem0/${Image}:${Tag}" 2>$null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $oldEap
    }
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