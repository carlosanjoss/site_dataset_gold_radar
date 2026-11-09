$ErrorActionPreference = "Stop"
$urlFile = Join-Path $PSScriptRoot "work\ngrok\public-url.txt"
$publicUrl = $null

try {
    $api = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 3
    $tunnel = $api.tunnels |
        Where-Object { $_.proto -eq "https" } |
        Select-Object -First 1
    if ($tunnel) {
        $publicUrl = [string]$tunnel.public_url
    }
} catch {
    # Tenta o ultimo endereco gravado pelo instalador.
}

if (-not $publicUrl -and (Test-Path -LiteralPath $urlFile)) {
    $publicUrl = (Get-Content -LiteralPath $urlFile -Raw).Trim()
}

if (-not $publicUrl) {
    throw "Nenhum endereco ngrok foi encontrado. Execute instalar_ngrok_persistente.ps1."
}

Write-Host "Endereco publico do Radar Odio:" -ForegroundColor Cyan
Write-Host $publicUrl -ForegroundColor Green
