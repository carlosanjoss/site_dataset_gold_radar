$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot "scripts\prepare-docker-env.ps1")

docker compose --env-file $RadarPipelineEnvPath --profile cloudflare --profile quick-tunnel down
if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel encerrar o site."
}

Push-Location $RadarPipelineRoot
try {
    docker compose --env-file $RadarPipelineEnvPath down
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel encerrar os bancos."
    }
} finally {
    Pop-Location
}

Write-Host "Site e bancos encerrados. Os volumes e dados foram preservados." -ForegroundColor Green
