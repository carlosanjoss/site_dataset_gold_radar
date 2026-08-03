$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$systemUrl = "http://localhost:3000"

try {
    $existing = Invoke-WebRequest -Uri $systemUrl -UseBasicParsing -TimeoutSec 3
    if ($existing.StatusCode -eq 200 -and $existing.Content -match "Radar") {
        Start-Process $systemUrl
        Write-Host "O sistema ja estava ativo e foi aberto no navegador."
        exit 0
    }
} catch {
    # O servidor ainda nao esta ativo; a inicializacao continua abaixo.
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules"))) {
    npm install
}

npm run db:check
if ($LASTEXITCODE -ne 0) {
    npm run db:migrate
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel preparar o banco de revisao."
    }
}

$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$server = Start-Process `
    -FilePath $npmCommand `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $PSScriptRoot `
    -NoNewWindow `
    -PassThru

$ready = $false
for ($attempt = 1; $attempt -le 45; $attempt++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -Uri $systemUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200 -and $response.Content -match "Radar") {
            $ready = $true
            break
        }
    } catch {
        # Aguarda o proximo ciclo enquanto o Next.js inicializa.
    }
}

if (-not $ready) {
    throw "O servidor não respondeu em $systemUrl."
}

Start-Process $systemUrl
Write-Host ""
Write-Host "Sistema ativo em $systemUrl"
Write-Host "Mantenha esta janela aberta durante as avaliações."
Wait-Process -Id $server.Id
