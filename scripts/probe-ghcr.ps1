$images = @("bma-lager-api", "bma-lager-pwa")
$tags = @("latest", "22d40c39bd13cede04f8115bb09e05e04e6e461f", "1a862197d5535b23746e8e021d0bb51bd7eddb8d", "209af69d8ac79e835fd9027d8dd39f5da1a6b7ba")
foreach ($img in $images) {
    $tokenResp = Invoke-WebRequest -Uri "https://ghcr.io/token?service=ghcr.io&scope=repository:icem0/$($img):pull" -UseBasicParsing -TimeoutSec 10
    $token = ($tokenResp.Content | ConvertFrom-Json).token
    foreach ($tag in $tags) {
        try {
            $resp = Invoke-WebRequest -Uri "https://ghcr.io/v2/icem0/$img/manifests/$tag" -UseBasicParsing -Method Head -TimeoutSec 10 -Headers @{Authorization = "Bearer $token"; Accept = "application/vnd.oci.image.index.v1+json"}
            Write-Host "$img :$tag  HTTP $($resp.StatusCode)"
        } catch {
            Write-Host "$img :$tag  $($_.Exception.Response.StatusCode.value__)"
        }
    }
}