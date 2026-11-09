$ErrorActionPreference = "Stop"

$pipelineRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..\social_data_pipeline")
$pipelineEnvPath = Join-Path $pipelineRoot ".env"

if (-not (Test-Path -LiteralPath $pipelineEnvPath)) {
    throw "O arquivo de configuracao compartilhado do social_data_pipeline nao foi encontrado."
}

$radarConfig = @{}
Get-Content -LiteralPath $pipelineEnvPath | ForEach-Object {
    if ($_ -match '^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
        $radarConfig[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
    }
}

foreach ($requiredKey in @("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB")) {
    if ([string]::IsNullOrWhiteSpace($radarConfig[$requiredKey])) {
        throw "A variavel $requiredKey nao esta configurada no social_data_pipeline/.env."
    }
}

$escapedUser = [Uri]::EscapeDataString($radarConfig["POSTGRES_USER"])
$escapedPassword = [Uri]::EscapeDataString($radarConfig["POSTGRES_PASSWORD"])
$escapedDatabase = [Uri]::EscapeDataString($radarConfig["POSTGRES_DB"])
$env:POSTGRES_URI = "postgresql://${escapedUser}:${escapedPassword}@radar_postgres:5432/${escapedDatabase}"
$env:GEMMA_MODEL = "gemma3:4b"
$env:GEMMA_PROMPT_VERSION = "gemma3_4b_structured_v2"

$script:RadarPipelineRoot = $pipelineRoot.Path
$script:RadarPipelineEnvPath = $pipelineEnvPath
