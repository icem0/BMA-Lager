function Test-GhcrManifest {
    # Returns $true if Image has Tag available at GHCR, $false otherwise.
    # Uses curl.exe to avoid PowerShell's Invoke-WebRequest quirks with
    # non-2xx + ErrorActionPreference=Stop.
    param([string]$Image, [string]$Tag)

    $token = $null
    try {
        $token = (curl.exe -sS --max-time 10 "https://ghcr.io/token?service=ghcr.io&scope=repository:icem0/${Image}:pull" | ConvertFrom-Json).token
    } catch {
        return $false
    }
    if (-not $token) { return $false }

    foreach ($accept in @(
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json"
    )) {
        $status = curl.exe -sS -o /dev/null -w "%{http_code}" --max-time 10 `
            -H "Authorization: Bearer $token" `
            -H "Accept: $accept" `
            -X HEAD "https://ghcr.io/v2/icem0/${Image}/manifests/${Tag}"
        if ($status -eq "200") { return $true }
    }
    return $false
}

function Get-GhcrDigest {
    # Returns the sha256 digest of the :latest manifest, or $null.
    param([string]$Image)

    $token = $null
    try {
        $token = (curl.exe -sS --max-time 10 "https://ghcr.io/token?service=ghcr.io&scope=repository:icem0/${Image}:pull" | ConvertFrom-Json).token
    } catch {
        return $null
    }
    if (-not $token) { return $null }

    foreach ($accept in @(
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.docker.distribution.manifest.v2+json"
    )) {
        $headers = curl.exe -sS -o /dev/null --max-time 10 -D - `
            -H "Authorization: Bearer $token" `
            -H "Accept: $accept" `
            -X HEAD "https://ghcr.io/v2/icem0/${Image}/manifests/latest"
        if ($LASTEXITCODE -eq 0 -and $headers -match "Docker-Content-Digest:\s*(\S+)") {
            return $Matches[1]
        }
    }
    return $null
}