$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot "scripts\prepare-docker-env.ps1")

Push-Location $RadarPipelineRoot
try {
    docker compose --env-file $RadarPipelineEnvPath up -d mongodb postgres redis
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel iniciar os bancos do Radar Odio."
    }
} finally {
    Pop-Location
}

docker compose --env-file $RadarPipelineEnvPath up -d --build app
if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel construir ou iniciar o site."
}

$siteUrl = "http://localhost:3000"
$ready = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200 -and $response.Content -match "Radar") {
            $ready = $true
            break
        }
    } catch {
        # Aguarda os bancos, migracoes seguras e o servidor web.
    }
    Start-Sleep -Seconds 2
}

if (-not $ready) {
    docker compose logs --tail 100 app
    throw "O site nao respondeu em $siteUrl."
}

Write-Host "Radar Odio ativo em $siteUrl" -ForegroundColor Green
