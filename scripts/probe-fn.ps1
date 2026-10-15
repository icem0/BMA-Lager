Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Script:CurlExe = (Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
Write-Host "Script:CurlExe = $Script:CurlExe"

Write-Host "Direct test..."
$r = & $Script:CurlExe -sS --max-time 5 "https://ghcr.io/token?service=ghcr.io&scope=repository:icem0/bma-lager-pwa:pull"
Write-Host "Result len: $($r.Length)"
Write-Host "First 50: $($r.Substring(0, [Math]::Min(50, $r.Length)))"