param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$taskName = "RadarOdioNgrok"
$siteUrl = "http://127.0.0.1:$Port"
$runtimeDir = Join-Path $PSScriptRoot "work\ngrok"
$urlFile = Join-Path $runtimeDir "public-url.txt"
$launcherScript = Join-Path $PSScriptRoot "executar_ngrok.ps1"

try {
    $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 5
    if ($response.StatusCode -ne 200 -or $response.Content -notmatch "Radar") {
        throw "resposta inesperada"
    }
} catch {
    throw "O site nao esta pronto em $siteUrl. Inicie primeiro o site pelo Docker."
}

$ngrokCommand = Get-Command ngrok.exe -ErrorAction SilentlyContinue
if (-not $ngrokCommand) {
    throw "ngrok.exe nao foi encontrado no PATH."
}

if (-not (Test-Path -LiteralPath $launcherScript)) {
    throw "O inicializador do ngrok nao foi encontrado: $launcherScript"
}

& $ngrokCommand.Source config check *> $null
if ($LASTEXITCODE -ne 0) {
    throw "A configuracao local do ngrok nao passou na validacao."
}

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$powershellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$action = New-ScheduledTaskAction `
    -Execute $powershellExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherScript`" -Port $Port" `
    -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description "Mantem o site Radar Odio publicado pelo ngrok." `
    -Force | Out-Null

Start-ScheduledTask -TaskName $taskName

$publicUrl = $null
for ($attempt = 1; $attempt -le 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
        $api = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/tunnels" -TimeoutSec 2
        $tunnel = $api.tunnels |
            Where-Object { $_.proto -eq "https" } |
            Select-Object -First 1
        if ($tunnel) {
            $publicUrl = [string]$tunnel.public_url
            break
        }
    } catch {
        # O agente ainda esta conectando.
    }
}

if (-not $publicUrl) {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
    throw "O ngrok nao publicou o site. Resultado da tarefa: $($taskInfo.LastTaskResult)."
}

[System.IO.File]::WriteAllText($urlFile, $publicUrl)
Write-Host "Ngrok persistente iniciado." -ForegroundColor Green
Write-Host "Endereco publico: $publicUrl" -ForegroundColor Green
Write-Host "Tarefa automatica: $taskName" -ForegroundColor Green
