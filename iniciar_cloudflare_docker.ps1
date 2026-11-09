$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot "scripts\prepare-docker-env.ps1")

& (Join-Path $PSScriptRoot "iniciar_docker.ps1")
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if (-not [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_TUNNEL_TOKEN)) {
    docker compose --env-file $RadarPipelineEnvPath --profile cloudflare up -d cloudflare
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel iniciar o tunel permanente do Cloudflare."
    }
    Write-Host "Tunel permanente do Cloudflare iniciado." -ForegroundColor Green
    exit 0
}

docker compose --env-file $RadarPipelineEnvPath --profile quick-tunnel up -d cloudflare-quick
if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel iniciar o Quick Tunnel do Cloudflare."
}

$publicUrl = $null
$registered = $false
for ($attempt = 1; $attempt -le 45; $attempt++) {
    $logText = docker compose --env-file $RadarPipelineEnvPath logs --no-color cloudflare-quick 2>$null
    $joinedLogs = $logText -join "`n"
    $match = [regex]::Match($joinedLogs, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
    if ($match.Success) {
        $publicUrl = $match.Value
    }
    $registered = $joinedLogs -match 'Registered tunnel connection'
    if ($publicUrl -and $registered) { break }
    Start-Sleep -Seconds 1
}

if (-not $publicUrl -or -not $registered) {
    throw "O Quick Tunnel nao conectou a borda Cloudflare. Libere a saida TCP ou UDP 7844 e execute este script novamente."
}

Write-Host "Radar Odio publico em $publicUrl" -ForegroundColor Green
