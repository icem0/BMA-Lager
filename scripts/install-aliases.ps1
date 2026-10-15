#!/usr/bin/env pwsh
# install-aliases.ps1 — einmalig ausfuehren.
#
# Legt PowerShell-Funktionen in $PROFILE an, die bma-restart und
# bma-deploy (push-and-redeploy) aufrufen. Idempotent: gleiche
# Funktionen werden ersetzt.
#
# Aufruf:
#   pwsh ./scripts/install-aliases.ps1
#   # danach PowerShell neu starten

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path
$ProfileDir = Split-Path -Parent $PROFILE
if (-not (Test-Path $ProfileDir)) { New-Item -ItemType Directory -Path $ProfileDir | Out-Null }
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE | Out-Null }

$block = @"

# ---- bma-lager helpers (install-aliases.ps1) ----
function bma-restart {
    # Fresh test stack: down -v + pull + up. DB is wiped.
    & "$RepoRoot\scripts\bma-restart.ps1" @args
}
function bma-deploy {
    # git push, wait for GHCR, fresh redeploy.
    $sha = git -C "$RepoRoot" rev-parse HEAD
    git -C "$RepoRoot" push @args
    if ($LASTEXITCODE -ne 0) { throw "git push failed" }
    & "$RepoRoot\scripts\bma-restart.ps1" -WaitForSha $sha -WaitTimeoutSec 300
}
function bma-logs-api {
    docker compose -f "$RepoRoot\docker-compose.yml" logs -f api
}
function bma-status {
    docker compose -f "$RepoRoot\docker-compose.yml" ps
}
# ---- /bma-lager helpers ----

"@

$existing = Get-Content $PROFILE -Raw -ErrorAction SilentlyContinue
$startMarker = "# ---- bma-lager helpers"
$endMarker = "# ---- /bma-lager helpers"
if ($existing -and $existing.Contains($startMarker) -and $existing.Contains($endMarker)) {
    $pattern = "(?s)$([regex]::Escape($startMarker)).*?$([regex]::Escape($endMarker))"
    $existing = [regex]::Replace($existing, $pattern, "")
    $existing = $existing.TrimEnd() + "`n`n"
    $new = $existing + $block
    Set-Content -Path $PROFILE -Value $new -NoNewline
    Write-Host "Aliasse in $PROFILE aktualisiert." -ForegroundColor Green
} else {
    Add-Content -Path $PROFILE -Value $block
    Write-Host "Aliasse zu $PROFILE hinzugefuegt." -ForegroundColor Green
}

Write-Host ""
Write-Host "Restart PowerShell, then these are available:" -ForegroundColor Cyan
Write-Host "  bma-restart              fresh stack (down -v + pull + up)" -ForegroundColor Cyan
Write-Host "  bma-deploy               git push + wait for GHCR + redeploy" -ForegroundColor Cyan
Write-Host "  bma-status               docker compose ps" -ForegroundColor Cyan
Write-Host "  bma-logs-api             docker compose logs -f api" -ForegroundColor Cyan