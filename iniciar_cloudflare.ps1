$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

$systemUrl = "http://localhost:3001"
$logsPath = Join-Path $PSScriptRoot "logs"
$appOutLog = Join-Path $logsPath "app.out.log"
$appErrLog = Join-Path $logsPath "app.err.log"
$appPidPath = Join-Path $logsPath "app.pid"
$tunnelOutLog = Join-Path $logsPath "cloudflare.out.log"
$tunnelErrLog = Join-Path $logsPath "cloudflare.err.log"
$tunnelPidPath = Join-Path $logsPath "cloudflare.pid"
$tunnelUrlPath = Join-Path $logsPath "cloudflare.url"

if (-not (Test-Path -LiteralPath $logsPath)) {
    New-Item -ItemType Directory -Path $logsPath | Out-Null
}

function Remove-SafeFile {
    param([string]$LiteralPath)
    try {
        if (Test-Path -LiteralPath $LiteralPath) {
            Remove-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
        }
    } catch {
        # Outro processo pode ter removido o arquivo entre a verificacao e a exclusao.
    }
}

$mutexCreated = $false
$launcherMutex = [System.Threading.Mutex]::new(
    $true,
    "Local\RadarOdioCloudflareLauncher",
    [ref]$mutexCreated
)
if (-not $mutexCreated) {
    Write-Host "O Cloudflare deste projeto ja esta iniciando ou ativo."
    if (Test-Path -LiteralPath $tunnelUrlPath) {
        $activeUrl = Get-Content -LiteralPath $tunnelUrlPath
        Write-Host $activeUrl -ForegroundColor Cyan
        if ($env:RADAR_SKIP_BROWSER_OPEN -ne "1") {
            Start-Process $activeUrl
        }
    } else {
        Write-Host "Aguarde a primeira janela concluir a inicializacao."
    }
    exit 0
}

function Test-SystemReady {
    try {
        $response = Invoke-WebRequest -Uri $systemUrl -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -eq 200 -and $response.Content -match "Radar"
    } catch {
        return $false
    }
}

function Stop-TrackedTunnel {
    if (-not (Test-Path -LiteralPath $tunnelPidPath)) {
        return
    }

    $storedPid = 0
    [void][int]::TryParse(
        (Get-Content -LiteralPath $tunnelPidPath -ErrorAction SilentlyContinue),
        [ref]$storedPid
    )
    if ($storedPid -gt 0) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $storedPid" `
            -ErrorAction SilentlyContinue
        $isThisTunnel = $process `
            -and $process.Name -eq "cloudflared.exe" `
            -and $process.CommandLine -match "\btunnel\b" `
            -and $process.CommandLine -like "*$systemUrl*"
        if ($isThisTunnel) {
            Stop-Process -Id $storedPid -Force -ErrorAction SilentlyContinue
            Wait-Process -Id $storedPid -Timeout 10 -ErrorAction SilentlyContinue
        }
    }

    Remove-SafeFile -LiteralPath $tunnelPidPath
    Remove-SafeFile -LiteralPath $tunnelUrlPath
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules"))) {
    npm install
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel instalar as dependencias."
    }
}

npm run db:check
if ($LASTEXITCODE -ne 0) {
    Write-Host "A estrutura do banco precisa ser preparada..."
    npm run db:migrate
    if ($LASTEXITCODE -ne 0) {
        throw "Nao foi possivel preparar o banco de revisao."
    }
}

Write-Host "Gerando a versao atualizada do sistema..."
npm run build
if ($LASTEXITCODE -ne 0) {
    throw "Nao foi possivel gerar a versao de producao."
}

Stop-TrackedTunnel

$existingListener = Get-NetTCPConnection -LocalPort 3001 -State Listen `
    -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingListener) {
    Stop-Process -Id $existingListener.OwningProcess -Force -ErrorAction Stop
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        Start-Sleep -Milliseconds 250
        $stillListening = Get-NetTCPConnection -LocalPort 3001 -State Listen `
            -ErrorAction SilentlyContinue
        if (-not $stillListening) {
            break
        }
    }
}

Remove-Item -LiteralPath $appOutLog -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $appErrLog -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $appPidPath -Force -ErrorAction SilentlyContinue

$nodeCommand = (Get-Command node.exe -ErrorAction Stop).Source
$nextScript = Join-Path $PSScriptRoot "node_modules\next\dist\bin\next"
$quotedNextScript = "`"$nextScript`""
$appProcess = Start-Process `
    -FilePath $nodeCommand `
    -ArgumentList @($quotedNextScript, "start", "-p", "3001") `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $appOutLog `
    -RedirectStandardError $appErrLog
Set-Content -LiteralPath $appPidPath -Value $appProcess.Id -Encoding ascii

$appReady = $false
for ($attempt = 1; $attempt -le 60; $attempt++) {
    Start-Sleep -Seconds 1
    if (Test-SystemReady) {
        $appReady = $true
        break
    }
    if ($appProcess.HasExited) {
        break
    }
}
if (-not $appReady) {
    $appError = Get-Content -LiteralPath $appErrLog -Tail 20 `
        -ErrorAction SilentlyContinue
    throw "O sistema nao respondeu em $systemUrl. Detalhes: $($appError -join ' ')"
}

$cloudflaredCommand = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
if (-not $cloudflaredCommand) {
    throw "cloudflared.exe nao foi encontrado. Instale o Cloudflare Tunnel e tente novamente."
}

$tunnel = $null
$publicUrl = $null
$publicReady = $false
$lastPublicError = ""

for ($tunnelAttempt = 1; $tunnelAttempt -le 4; $tunnelAttempt++) {
    Stop-TrackedTunnel
    Remove-Item -LiteralPath $tunnelOutLog -Force `
        -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tunnelErrLog -Force `
        -ErrorAction SilentlyContinue

    Write-Host "Criando tunel Cloudflare (tentativa $tunnelAttempt de 4)..."
    $tunnel = Start-Process `
        -FilePath $cloudflaredCommand.Source `
        -ArgumentList @("tunnel", "--url", $systemUrl, "--no-autoupdate") `
        -WorkingDirectory $PSScriptRoot `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput $tunnelOutLog `
        -RedirectStandardError $tunnelErrLog

    Set-Content -LiteralPath $tunnelPidPath -Value $tunnel.Id -Encoding ascii
    $publicUrl = $null

    for ($attempt = 1; $attempt -le 60; $attempt++) {
        Start-Sleep -Seconds 1
        $content = @()
        if (Test-Path -LiteralPath $tunnelOutLog) {
            $content += Get-Content -LiteralPath $tunnelOutLog `
                -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $tunnelErrLog) {
            $content += Get-Content -LiteralPath $tunnelErrLog `
                -ErrorAction SilentlyContinue
        }
        $match = [regex]::Match(
            ($content -join "`n"),
            "https://[a-z0-9-]+\.trycloudflare\.com"
        )
        if ($match.Success) {
            $publicUrl = $match.Value
            break
        }
        if ($tunnel.HasExited) {
            break
        }
    }

    if (-not $publicUrl) {
        $lastPublicError = "O cloudflared nao devolveu um endereco."
        continue
    }

    $publicHost = ([uri]$publicUrl).DnsSafeHost
    for ($attempt = 1; $attempt -le 35; $attempt++) {
        Start-Sleep -Seconds 1
        $ipv4Records = Resolve-DnsName -Name $publicHost -Type A -DnsOnly `
            -Server "1.1.1.1" `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.Type -eq "A" -and $_.IPAddress }
        if (-not $ipv4Records) {
            $lastPublicError = "O DNS publico ainda nao recebeu um endereco IPv4."
            continue
        }

        foreach ($ipv4Record in $ipv4Records) {
            $resolveRule = "${publicHost}:443:$($ipv4Record.IPAddress)"
            $publicContent = & curl.exe `
                --silent `
                --show-error `
                --location `
                --max-time 12 `
                --resolve $resolveRule `
                $publicUrl 2>&1
            if ($LASTEXITCODE -eq 0 -and ($publicContent -join "`n") -match "Radar") {
                $publicReady = $true
                break
            }
            $lastPublicError = ($publicContent -join " ")
        }
        if ($publicReady) {
            break
        }
        if ($tunnel.HasExited) {
            $lastPublicError = "O processo cloudflared foi encerrado."
            break
        }
    }

    if ($publicReady) {
        break
    }
}

if (-not $publicReady) {
    Stop-TrackedTunnel
    throw "Nao foi possivel obter um endereco publico IPv4 funcional apos quatro tentativas. Ultimo erro: $lastPublicError"
}

Set-Content -LiteralPath $tunnelUrlPath -Value $publicUrl -Encoding utf8

$localIpv4 = Resolve-DnsName -Name ([uri]$publicUrl).DnsSafeHost `
    -Type A -DnsOnly -ErrorAction SilentlyContinue |
    Where-Object { $_.Type -eq "A" -and $_.IPAddress }
if (-not $localIpv4) {
    Write-Warning "O tunel esta funcional, mas o DNS do roteador ainda nao recebeu o IPv4. Se o navegador nao abrir, configure DNS seguro 1.1.1.1."
}

Write-Host ""
Write-Host "Sistema publico ativo e testado em:"
Write-Host $publicUrl -ForegroundColor Cyan
Write-Host ""
Write-Host "Mantenha esta janela aberta. O endereco muda a cada nova execucao."
if ($env:RADAR_SKIP_BROWSER_OPEN -ne "1") {
    Start-Process $publicUrl
}

try {
    Wait-Process -Id $tunnel.Id
} finally {
    Remove-SafeFile -LiteralPath $tunnelPidPath
    Remove-SafeFile -LiteralPath $tunnelUrlPath
}
