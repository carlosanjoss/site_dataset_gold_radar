$ErrorActionPreference = "Stop"
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$postgresUri = $env:POSTGRES_URI
if (-not $postgresUri) {
    $candidates = @(
        (Join-Path (Get-Location) ".env.local"),
        (Join-Path (Get-Location) ".env"),
        (Join-Path (Split-Path -Parent (Get-Location)) "social_data_pipeline\.env")
    )
    foreach ($candidate in $candidates) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $line = Get-Content -LiteralPath $candidate | Where-Object {
            $_ -match '^\s*POSTGRES_URI\s*='
        } | Select-Object -First 1
        if ($line) {
            $postgresUri = ($line -replace '^\s*POSTGRES_URI\s*=\s*', '').Trim().Trim('"').Trim("'")
            break
        }
    }
}

if (-not $postgresUri) {
    throw "POSTGRES_URI não foi encontrada."
}

$pgDump = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
if (-not $pgDump) {
    $pgDump = Get-ChildItem "C:\Program Files\PostgreSQL" -Recurse -Filter pg_dump.exe `
        -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $pgDump) {
    throw "pg_dump.exe não foi encontrado."
}
$pgDumpPath = if ($pgDump -is [System.Management.Automation.CommandInfo]) {
    $pgDump.Source
} else {
    $pgDump.FullName
}

$databaseUri = [Uri]$postgresUri
$credentials = $databaseUri.UserInfo.Split(':', 2)
$databaseUser = [Uri]::UnescapeDataString($credentials[0])
$databasePassword = if ($credentials.Count -gt 1) {
    [Uri]::UnescapeDataString($credentials[1])
} else { "" }
$databaseName = [Uri]::UnescapeDataString($databaseUri.AbsolutePath.TrimStart('/'))
$databasePort = if ($databaseUri.Port -gt 0) { $databaseUri.Port } else { 5432 }

$backupDirectory = Join-Path (Get-Location) "backups"
$backupFile = Join-Path $backupDirectory "radar_odio.dump"
if (-not (Test-Path -LiteralPath $backupDirectory)) {
    New-Item -ItemType Directory -Path $backupDirectory | Out-Null
}

$previousPassword = $env:PGPASSWORD
try {
    $env:PGPASSWORD = $databasePassword
    & $pgDumpPath `
        --host $databaseUri.Host `
        --port $databasePort `
        --username $databaseUser `
        --dbname $databaseName `
        --format custom `
        --compress 6 `
        --no-owner `
        --no-privileges `
        --file $backupFile
    if ($LASTEXITCODE -ne 0) {
        throw "O pg_dump terminou com erro."
    }
} finally {
    $env:PGPASSWORD = $previousPassword
}

$sizeMb = [Math]::Round((Get-Item -LiteralPath $backupFile).Length / 1MB, 1)
Write-Host "Backup criado em $backupFile ($sizeMb MB)."
