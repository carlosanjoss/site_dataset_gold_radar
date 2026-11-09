param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$siteUrl = "http://127.0.0.1:$Port"
$runtimeDir = Join-Path $PSScriptRoot "work\ngrok"
$statusFile = Join-Path $runtimeDir "launcher-status.txt"
$urlFile = Join-Path $runtimeDir "public-url.txt"
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Set-LauncherStatus([string]$Status) {
    [System.IO.File]::WriteAllText($statusFile, $Status)
}

Set-LauncherStatus "resolving-ngrok"

# O alias da Microsoft Store nao funciona de forma confiavel no Agendador.
# Resolve o executavel real do pacote a cada inicio, inclusive apos atualizacoes.
$package = Get-AppxPackage -Name "ngrok.ngrok" -ErrorAction SilentlyContinue
if ($package) {
    $ngrokExe = Join-Path $package.InstallLocation "ngrok.exe"
} else {
    $ngrokCommand = Get-Command ngrok.exe -ErrorAction SilentlyContinue
    if (-not $ngrokCommand) {
        exit 3
    }
    $ngrokExe = $ngrokCommand.Source
}

if (-not (Test-Path -LiteralPath $ngrokExe)) {
    Set-LauncherStatus "ngrok-not-found"
    exit 3
}

function Test-RadarSite {
    try {
        $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 3
        return ($response.StatusCode -eq 200 -and $response.Content -match "Radar")
    } catch {
        return $false
    }
}

function Get-RadarTunnel {
    try {
        $api = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 3
        return $api.tunnels |
            Where-Object { $_.proto -eq "https" } |
            Select-Object -First 1
    } catch {
        return $null
    }
}

# Mantem o agente sob supervisao. Alem de recuperar quedas, corrige qualquer
# alteracao acidental do encaminhamento para uma porta diferente da porta do site.
while ($true) {
    Set-LauncherStatus "waiting-for-site"
    while (-not (Test-RadarSite)) {
        Start-Sleep -Seconds 5
    }

    Set-LauncherStatus "starting-ngrok"
    $ngrokProcess = Start-Process `
        -FilePath $ngrokExe `
        -ArgumentList @("http", $siteUrl, "--log=false") `
        -WindowStyle Hidden `
        -PassThru

    $tunnelReady = $false
    for ($attempt = 1; $attempt -le 60; $attempt++) {
        Start-Sleep -Milliseconds 500
        if ($ngrokProcess.HasExited) {
            break
        }

        $tunnel = Get-RadarTunnel
        if ($tunnel -and [string]$tunnel.config.addr -eq $siteUrl) {
            $publicUrl = [string]$tunnel.public_url
            [System.IO.File]::WriteAllText($urlFile, $publicUrl)
            Set-LauncherStatus "online"
            $tunnelReady = $true
            break
        }
    }

    if (-not $tunnelReady) {
        if (-not $ngrokProcess.HasExited) {
            Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Set-LauncherStatus "tunnel-not-ready-restarting"
        Start-Sleep -Seconds 10
        continue
    }

    $healthFailures = 0
    while (-not $ngrokProcess.HasExited) {
        Start-Sleep -Seconds 15
        $tunnel = Get-RadarTunnel
        $tunnelIsCorrect = (
            $tunnel -and
            [string]$tunnel.config.addr -eq $siteUrl -and
            (Test-RadarSite)
        )

        if ($tunnelIsCorrect) {
            $healthFailures = 0
            Set-LauncherStatus "online"
        } else {
            $healthFailures++
        }

        if ($healthFailures -ge 2) {
            Set-LauncherStatus "unhealthy-or-wrong-target-restarting"
            Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
            break
        }
    }

    Start-Sleep -Seconds 10
}
